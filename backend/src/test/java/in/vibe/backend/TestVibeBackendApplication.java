package in.vibe.backend;

import org.springframework.boot.SpringApplication;

/**
 * Runs the backend against a throwaway PostgreSQL in Docker, with the dev seed:
 * {@code mvn spring-boot:test-run -Dspring-boot.run.profiles=dev}. Data is thrown away when it stops.
 */
public class TestVibeBackendApplication {
    public static void main(String[] args) {
        SpringApplication.from(VibeBackendApplication::main).with(TestcontainersConfiguration.class).run(args);
    }
}
