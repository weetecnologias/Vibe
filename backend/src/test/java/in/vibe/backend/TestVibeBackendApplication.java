package in.vibe.backend;

import org.springframework.boot.SpringApplication;

/**
 * Runs the backend against PostgreSQL in Docker, with the dev seed:
 * {@code mvn spring-boot:test-run -Dspring-boot.run.profiles=dev}. Data is kept in the Docker volume {@code vibe-dev-pgdata}
 * between runs (see {@link DevDatabaseConfiguration}); the dev seed loads only the first time, into an empty database.
 */
public class TestVibeBackendApplication {
    public static void main(String[] args) {
        SpringApplication.from(VibeBackendApplication::main).with(DevDatabaseConfiguration.class).run(args);
    }
}
