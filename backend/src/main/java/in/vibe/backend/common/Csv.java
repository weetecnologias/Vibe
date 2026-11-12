package in.vibe.backend.common;

import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

/**
 * A spreadsheet download that opens straight in Excel: UTF-8 with a byte-order mark (so ₹ and names show correctly), quoted where needed,
 * and with cells that start like a formula neutralised, so a customer's name can never run as a formula on an admin's computer.
 */
public final class Csv {
    private static final DateTimeFormatter WHEN = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneId.of("Asia/Kolkata"));
    private final StringBuilder out = new StringBuilder("﻿");

    public Csv row(Object... cells) {
        for (int i = 0; i < cells.length; i++) {
            if (i > 0) out.append(',');
            out.append(cell(cells[i]));
        }
        out.append("\r\n");
        return this;
    }

    private static String cell(Object v) {
        if (v == null) return "";
        if (v instanceof Number || v instanceof Boolean) return v.toString();
        String s = v instanceof OffsetDateTime t ? WHEN.format(t) : v.toString();
        if (!s.isEmpty() && "=+-@\t\r".indexOf(s.charAt(0)) >= 0) s = "'" + s;
        return s.contains(",") || s.contains("\"") || s.contains("\n") || s.contains("\r") ? "\"" + s.replace("\"", "\"\"") + "\"" : s;
    }

    /** Paise as rupees with two decimals, as a plain number Excel can add up. */
    public static String rupees(long paise) {
        return String.format("%d.%02d", paise / 100, Math.abs(paise % 100));
    }

    public ResponseEntity<byte[]> download(String filename) {
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(filename, StandardCharsets.UTF_8).build().toString())
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .body(out.toString().getBytes(StandardCharsets.UTF_8));
    }
}
