package in.vibe.backend.common;

import org.springframework.http.HttpStatus;

/** An error the API client can act on. `code` is stable and machine-readable; `message` is safe to show. */
public class ApiException extends RuntimeException {
    private final HttpStatus status;
    private final String code;

    public ApiException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus status() { return status; }
    public String code() { return code; }

    public static ApiException notFound(String message) { return new ApiException(HttpStatus.NOT_FOUND, "not_found", message); }
    public static ApiException badRequest(String code, String message) { return new ApiException(HttpStatus.BAD_REQUEST, code, message); }
    public static ApiException conflict(String code, String message) { return new ApiException(HttpStatus.CONFLICT, code, message); }
    public static ApiException forbidden(String message) { return new ApiException(HttpStatus.FORBIDDEN, "forbidden", message); }
}
