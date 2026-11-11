package in.vibe.backend.security;

import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

@Service
public class JwtService {
    private final JwtEncoder encoder;
    private final Clock clock;
    private final Duration ttl;
    private final Duration customerTtl;

    JwtService(JwtEncoder encoder, Clock clock, SecurityProps props) {
        this.encoder = encoder;
        this.clock = clock;
        this.ttl = Duration.ofMinutes(props.tokenMinutes());
        this.customerTtl = Duration.ofMinutes(props.customerTokenMinutes());
    }

    public record Issued(String token, Instant expiresAt) {}

    public Issued issue(UUID staffId, String role, UUID businessId) {
        return issue(staffId, role, businessId, ttl, false);
    }

    /** `mustChangePassword` limits the token to changing the password until it has been changed. */
    public Issued issue(UUID staffId, String role, UUID businessId, boolean mustChangePassword) {
        return issue(staffId, role, businessId, ttl, mustChangePassword);
    }

    /** A customer's access token. Customers renew it with their refresh token. */
    public Issued issueCustomer(UUID customerId) {
        return issue(customerId, "CUSTOMER", null, customerTtl, false);
    }

    private Issued issue(UUID subject, String role, UUID businessId, Duration lifetime, boolean mustChangePassword) {
        Instant now = clock.instant();
        Instant exp = now.plus(lifetime);
        JwtClaimsSet.Builder claims = JwtClaimsSet.builder().issuer("vibe-backend").subject(subject.toString())
                .issuedAt(now).expiresAt(exp).claim("role", role);
        if (businessId != null) claims.claim("bid", businessId.toString());
        if (mustChangePassword) claims.claim("pwc", true);
        String token = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims.build())).getTokenValue();
        return new Issued(token, exp);
    }
}
