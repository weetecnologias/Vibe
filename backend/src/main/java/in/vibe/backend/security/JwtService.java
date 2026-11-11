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

    JwtService(JwtEncoder encoder, Clock clock, SecurityProps props) {
        this.encoder = encoder;
        this.clock = clock;
        this.ttl = Duration.ofMinutes(props.tokenMinutes());
    }

    public record Issued(String token, Instant expiresAt) {}

    public Issued issue(UUID staffId, String role, UUID businessId) {
        Instant now = clock.instant();
        Instant exp = now.plus(ttl);
        JwtClaimsSet.Builder claims = JwtClaimsSet.builder().issuer("vibe-backend").subject(staffId.toString())
                .issuedAt(now).expiresAt(exp).claim("role", role);
        if (businessId != null) claims.claim("bid", businessId.toString());
        String token = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims.build())).getTokenValue();
        return new Issued(token, exp);
    }
}
