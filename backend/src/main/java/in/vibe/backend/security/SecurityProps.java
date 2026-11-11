package in.vibe.backend.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "vibe.security")
public record SecurityProps(String jwtSecret, int tokenMinutes, int customerTokenMinutes) {}
