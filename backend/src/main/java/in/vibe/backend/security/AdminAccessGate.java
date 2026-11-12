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

/**
 * Every /v1/admin request is checked against the person's admin role here, so a staff member who types a URL or calls the API directly is
 * refused just as if the page were hidden. Super admins and admins pass; the team page is theirs alone.
 */
class AdminAccessGate extends OncePerRequestFilter {
    private final AdminAccess access;
    private final JsonMapper json;

    AdminAccessGate(AdminAccess access, JsonMapper json) {
        this.access = access;
        this.json = json;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        String path = request.getRequestURI();
        if (a instanceof JwtAuthenticationToken t && "ADMIN".equals(t.getToken().getClaimAsString("role")) && path.startsWith("/v1/admin")) {
            AdminAccess.Access me = access.access(StaffPrincipal.from(t.getToken()));
            if (!me.signedIn()) {
                write(response, 401, new ApiError("unauthorized", "Please sign in."));
                return;
            }
            String area = AdminAccess.areaFor(path);
            boolean ok = area == null || ("team".equals(area) || "full".equals(area) ? me.full() : me.can(area));
            if (!ok) {
                String what = "team".equals(area) ? "VIBE team accounts" : "full".equals(area) ? "this" : AdminAccess.AREAS.get(area).split(":")[0].toLowerCase();
                write(response, 403, new ApiError("no_permission", "Your access doesn’t include " + what + ". Ask a VIBE admin if you need it."));
                return;
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
