package in.vibe.backend.security;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import in.vibe.backend.common.ApiError;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import tools.jackson.databind.json.JsonMapper;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Public catalogue reads are open; staff endpoints need a signed token with the right role.
 * The customer's sign-in (phone + OTP) arrives with the identity module; until then no customer-only endpoint exists.
 */
@Configuration
@EnableConfigurationProperties(SecurityProps.class)
public class SecurityConfig {

    @Bean
    SecretKey jwtKey(SecurityProps props) {
        String secret = props.jwtSecret();
        if (secret == null || secret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalStateException("VIBE_JWT_SECRET must be set to at least 32 bytes (the dev profile sets a development-only key).");
        }
        return new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    }

    @Bean
    JwtEncoder jwtEncoder(SecretKey key) {
        return new NimbusJwtEncoder(new ImmutableSecret<>(key));
    }

    @Bean
    JwtDecoder jwtDecoder(SecretKey key) {
        return NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(12);
    }

    @Bean
    // The bean name matters: Spring Security looks for `corsConfigurationSource`.
    CorsConfigurationSource corsConfigurationSource(@Value("${vibe.cors.allowed-origins}") List<String> origins) {
        CorsConfiguration c = new CorsConfiguration();
        // Patterns, so the dev profile can allow `http://localhost:*`. Production lists exact origins.
        c.setAllowedOriginPatterns(origins);
        c.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        c.setAllowedHeaders(List.of("Authorization", "Content-Type", "Idempotency-Key"));
        c.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource src = new UrlBasedCorsConfigurationSource();
        src.registerCorsConfiguration("/v1/**", c);
        return src;
    }

    @Bean
    SecurityFilterChain filters(HttpSecurity http, JsonMapper json, TeamAccess teamAccess, in.vibe.backend.catalogue.MerchantFeatures merchantFeatures, AdminAccess adminAccess) throws Exception {
        JwtGrantedAuthoritiesConverter roles = new JwtGrantedAuthoritiesConverter();
        roles.setAuthoritiesClaimName("role");
        roles.setAuthorityPrefix("ROLE_");
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(roles);

        http.csrf(c -> c.disable())
            .cors(c -> {})
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a -> a
                .requestMatchers("/actuator/health", "/v1/health", "/v1/staff/login").permitAll()
                .requestMatchers(HttpMethod.POST, "/v1/auth/otp", "/v1/auth/otp/verify", "/v1/auth/refresh", "/v1/webhooks/*", "/v1/business-applications").permitAll()
                // A business applying to join checks on their application with the secret they were given, so no sign-in is needed.
                .requestMatchers(HttpMethod.GET, "/v1/business-applications/*").permitAll()
                .requestMatchers(HttpMethod.PUT, "/v1/business-applications/*").permitAll()
                .requestMatchers(HttpMethod.GET, "/v1/offers/*/eligibility").hasRole("CUSTOMER")
                .requestMatchers(HttpMethod.POST, "/v1/events/*/reservations").hasRole("CUSTOMER")
                .requestMatchers(HttpMethod.GET, "/v1/businesses/*/sports", "/v1/businesses/*/slots", "/v1/businesses/*/plans").permitAll()
                .requestMatchers("/v1/slot-bookings", "/v1/slot-bookings/**", "/v1/venue-passes", "/v1/venue-passes/**").hasRole("CUSTOMER")
                .requestMatchers(HttpMethod.GET, "/v1/categories", "/v1/businesses", "/v1/businesses/*", "/v1/home", "/v1/membership/plans", "/v1/events", "/v1/events/*", "/v1/offers", "/v1/offers/*", "/v1/promotions", "/v1/movies", "/media/*").permitAll()
                .requestMatchers(HttpMethod.POST, "/v1/promotions/*/tap").permitAll()
                .requestMatchers(HttpMethod.POST, "/v1/media").hasAnyRole("ADMIN", "MERCHANT")
                .requestMatchers("/v1/auth/logout", "/v1/me", "/v1/me/**", "/v1/redemptions", "/v1/redemptions/**", "/v1/payment-requests/**", "/v1/payments/**", "/v1/tickets/**", "/v1/membership", "/v1/membership/subscriptions", "/v1/membership/plan-change", "/v1/membership/cancel").hasRole("CUSTOMER")
                .requestMatchers("/v1/admin/**").hasRole("ADMIN")
                .requestMatchers("/v1/merchant/**").hasRole("MERCHANT")
                .requestMatchers("/v1/staff/**").hasAnyRole("ADMIN", "MERCHANT")
                .anyRequest().denyAll())
            .oauth2ResourceServer(o -> o.jwt(j -> j.jwtAuthenticationConverter(converter)))
            .addFilterAfter(new PasswordChangeGate(json), BearerTokenAuthenticationFilter.class)
            .addFilterAfter(new MerchantAccessGate(teamAccess, merchantFeatures, json), PasswordChangeGate.class)
            .addFilterAfter(new AdminAccessGate(adminAccess, json), MerchantAccessGate.class)
            .exceptionHandling(e -> e
                .authenticationEntryPoint((req, res, ex) -> write(res, json, 401, new ApiError("unauthorized", "Please sign in.")))
                .accessDeniedHandler((req, res, ex) -> write(res, json, 403, new ApiError("forbidden", "You don’t have access to this."))));
        return http.build();
    }

    private static void write(HttpServletResponse res, JsonMapper json, int status, ApiError body) throws IOException {
        res.setStatus(status);
        res.setContentType(MediaType.APPLICATION_JSON_VALUE);
        res.getWriter().write(json.writeValueAsString(body));
    }
}
