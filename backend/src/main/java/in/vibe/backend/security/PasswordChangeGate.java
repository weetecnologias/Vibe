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
import java.util.Set;

/**
 * A login that someone else created (the admin who made it, or the owner who added a team member) has a password that person knows.
 * Until its owner chooses a new one, the only things that login may do are look at who it is and change the password.
 */
class PasswordChangeGate extends OncePerRequestFilter {
    private static final Set<String> ALLOWED = Set.of("/v1/staff/password", "/v1/staff/me");

    private final JsonMapper json;

    PasswordChangeGate(JsonMapper json) { this.json = json; }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        if (a instanceof JwtAuthenticationToken t && Boolean.TRUE.equals(t.getToken().getClaim("pwc")) && !ALLOWED.contains(request.getRequestURI())) {
            response.setStatus(403);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write(json.writeValueAsString(new ApiError("password_change_required", "Choose a new password before you continue.")));
            return;
        }
        chain.doFilter(request, response);
    }
}
