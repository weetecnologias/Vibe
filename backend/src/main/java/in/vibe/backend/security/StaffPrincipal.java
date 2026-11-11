package in.vibe.backend.security;

import in.vibe.backend.common.ApiException;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.UUID;

/** Who is calling a back-office endpoint, read from the verified token. A merchant is tied to one business. */
public record StaffPrincipal(UUID id, String role, UUID businessId) {
    public static StaffPrincipal from(Jwt jwt) {
        String bid = jwt.getClaimAsString("bid");
        return new StaffPrincipal(UUID.fromString(jwt.getSubject()), jwt.getClaimAsString("role"), bid == null ? null : UUID.fromString(bid));
    }

    /** The business this merchant may act on. Never taken from the request. */
    public UUID requireBusiness() {
        if (businessId == null) throw ApiException.forbidden("This account isn’t linked to a business.");
        return businessId;
    }
}
