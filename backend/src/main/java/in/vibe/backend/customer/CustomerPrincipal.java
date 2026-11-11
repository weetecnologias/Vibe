package in.vibe.backend.customer;

import org.springframework.security.oauth2.jwt.Jwt;

import java.util.UUID;

/** The signed-in customer, read from the verified token. */
public record CustomerPrincipal(UUID id) {
    public static CustomerPrincipal from(Jwt jwt) {
        return new CustomerPrincipal(UUID.fromString(jwt.getSubject()));
    }
}
