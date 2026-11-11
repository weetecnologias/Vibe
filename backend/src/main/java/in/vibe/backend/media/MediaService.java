package in.vibe.backend.media;

import in.vibe.backend.common.ApiException;
import in.vibe.backend.security.StaffPrincipal;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Images uploaded from the dashboards (logos, photos, menu pictures, category icons, banners).
 * Development stores files on disk. Production swaps this for object storage behind a CDN; the URLs the dashboards save stay valid links either way.
 *
 * Safety: only real PNG, JPEG and WebP images (checked by their first bytes, not by the file name the browser claims), at most 5 MB,
 * stored under a random name, served with the type we detected and `nosniff`. SVG is not accepted because it can carry scripts.
 */
@Service
public class MediaService {
    public static final long MAX_BYTES = 5L * 1024 * 1024;
    static final int DAILY_LIMIT = 100;
    private static final Pattern NAME = Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(png|jpg|webp)$");

    public record Stored(String id, String url) {}

    public record Loaded(byte[] bytes, String contentType) {}

    private final JdbcClient jdbc;
    private final Path dir;
    private final String publicBase;

    MediaService(JdbcClient jdbc, @Value("${vibe.media.dir}") String dir, @Value("${vibe.media.public-base-url}") String publicBase) throws IOException {
        this.jdbc = jdbc;
        this.dir = Path.of(dir).toAbsolutePath().normalize();
        this.publicBase = publicBase.endsWith("/") ? publicBase.substring(0, publicBase.length() - 1) : publicBase;
        Files.createDirectories(this.dir);
    }

    /** The image type from the file's own first bytes, or empty when it is not a PNG, JPEG or WebP. */
    static Optional<String> sniff(byte[] b) {
        if (b.length >= 8 && (b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G' && b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A) return Optional.of("png");
        if (b.length >= 3 && (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF) return Optional.of("jpg");
        if (b.length >= 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') return Optional.of("webp");
        return Optional.empty();
    }

    private static String contentType(String ext) {
        return switch (ext) { case "png" -> "image/png"; case "jpg" -> "image/jpeg"; default -> "image/webp"; };
    }

    public Stored save(StaffPrincipal who, MultipartFile file) {
        if (file == null || file.isEmpty()) throw ApiException.badRequest("no_file", "Choose an image to upload.");
        if (file.getSize() > MAX_BYTES) throw new ApiException(HttpStatus.CONTENT_TOO_LARGE, "too_large", "That image is over 5 MB. Choose a smaller one.");
        if (jdbc.sql("select count(*) from media where uploaded_by = :u and created_at > now() - interval '1 day'").param("u", who.id()).query(Integer.class).single() >= DAILY_LIMIT) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "too_many_uploads", "You’ve reached today’s upload limit. Try again tomorrow.");
        }
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException e) {
            throw ApiException.badRequest("unreadable", "That file couldn’t be read.");
        }
        String ext = sniff(bytes).orElseThrow(() -> ApiException.badRequest("not_an_image", "Upload a PNG, JPEG or WebP image."));
        UUID id = UUID.randomUUID();
        String name = id + "." + ext;
        try {
            Files.write(dir.resolve(name), bytes);
        } catch (IOException e) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "storage", "The image couldn’t be saved. Try again.");
        }
        jdbc.sql("insert into media (id, filename, content_type, size_bytes, uploaded_by) values (:id, :f, :c, :s, :u)")
                .param("id", id).param("f", name).param("c", contentType(ext)).param("s", (long) bytes.length).param("u", who.id()).update();
        return new Stored(id.toString(), publicBase + "/media/" + name);
    }

    public Loaded load(String filename) {
        if (!NAME.matcher(filename).matches()) throw ApiException.notFound("Image not found.");
        Path p = dir.resolve(filename).normalize();
        if (!p.startsWith(dir) || !Files.isRegularFile(p)) throw ApiException.notFound("Image not found.");
        try {
            return new Loaded(Files.readAllBytes(p), contentType(filename.substring(filename.lastIndexOf('.') + 1)));
        } catch (IOException e) {
            throw ApiException.notFound("Image not found.");
        }
    }
}
