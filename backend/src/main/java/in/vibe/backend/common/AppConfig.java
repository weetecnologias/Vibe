package in.vibe.backend.common;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;
import java.time.ZoneId;

@Configuration
public class AppConfig {
    public static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    /** Injected so tests can fix the time. Business hours and offer validity are evaluated in India time. */
    @Bean
    Clock clock() {
        return Clock.system(IST);
    }
}
