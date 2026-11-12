package in.vibe.backend.security;

import in.vibe.backend.common.ApiError;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.util.Arrays;

/**
 * Enforces team roles on the server, not just in the dashboard's menu: a cashier who types the address of the settlements page,
 * or calls the API directly, is refused. The owner passes everywhere; the team itself is the owner's alone.
 */
class MerchantAccessGate extends OncePerRequestFilter {
    private final TeamAccess access;
    private final in.vibe.backend.catalogue.MerchantFeatures features;
    private final JsonMapper json;

    MerchantAccessGate(TeamAccess access, in.vibe.backend.catalogue.MerchantFeatures features, JsonMapper json) {
        this.access = access;
        this.features = features;
        this.json = json;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        String path = request.getRequestURI();
        if (a instanceof JwtAuthenticationToken t && "MERCHANT".equals(t.getToken().getClaimAsString("role")) && path.startsWith("/v1/merchant/")) {
            TeamAccess.Access me = access.access(StaffPrincipal.from(t.getToken()));
            if (!me.signedIn()) { // switched off by the owner, or the login is gone: sign them out
                write(response, 401, new ApiError("unauthorized", "Please sign in."));
                return;
            }
            // First: is this part of VIBE for this kind of business at all? (A café has no court bookings; an event organiser has no bills.)
            String feature = TeamAccess.featureFor(request.getMethod(), path);
            StaffPrincipal who = StaffPrincipal.from(t.getToken());
            if (feature != null && who.businessId() != null) {
                in.vibe.backend.catalogue.MerchantFeatures.Profile p = features.forBusiness(who.businessId());
                if (Arrays.stream(feature.split("\\|")).noneMatch(p::has)) {
                    String what = in.vibe.backend.catalogue.MerchantFeatures.ALL.get(feature.split("\\|")[0]).split(":")[0];
                    write(response, 403, new ApiError("feature_off", what + " isn’t part of VIBE for " + p.categoryName() + " businesses. Ask VIBE if you need it."));
                    return;
                }
            }
            String area = TeamAccess.areaFor(request.getMethod(), path);
            if (area != null) {
                boolean ok = "team".equals(area) ? me.owner() : Arrays.stream(area.split("\\|")).anyMatch(me::can);
                if (!ok) {
                    String what = "team".equals(area) ? "the team" : TeamAccess.AREAS.getOrDefault(area.split("\\|")[0], area).split(":")[0].toLowerCase();
                    write(response, 403, new ApiError("no_permission", "Your role doesn’t include " + what + ". Ask the owner if you need it."));
                    return;
                }
            }
        }
        chain.doFilter(request, response);
    }

    private void write(HttpServletResponse response, int status, ApiError error) throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write(json.writeValueAsString(error));
    }
}
