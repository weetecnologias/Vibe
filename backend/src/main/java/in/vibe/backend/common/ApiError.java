package in.vibe.backend.common;

/** The error body every endpoint returns: `{ "code": "...", "message": "..." }`. */
public record ApiError(String code, String message) {}
