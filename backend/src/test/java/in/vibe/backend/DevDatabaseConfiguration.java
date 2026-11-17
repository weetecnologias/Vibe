package in.vibe.backend;

import com.github.dockerjava.api.model.Bind;
import com.github.dockerjava.api.model.Volume;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.utility.DockerImageName;

import java.time.Duration;

/**
 * The local dev server's PostgreSQL: the same Docker image as the tests, but its data lives in the named Docker volume
 * {@value #VOLUME}, so sign-ins, orders and anything added in the dashboards survive restarts. The dev seed loads only into an
 * empty database. To start over: stop the backend and run {@code docker volume rm vibe-dev-pgdata}.
 * Tests don't use this; they keep a throwaway database ({@link TestcontainersConfiguration}).
 */
@TestConfiguration(proxyBeanMethods = false)
public class DevDatabaseConfiguration {
    static final String VOLUME = "vibe-dev-pgdata";

    @Bean
    @ServiceConnection
    PostgreSQLContainer postgresContainer() {
        return new PostgreSQLContainer(DockerImageName.parse("postgres:17-alpine"))
                // The default waits for "ready to accept connections" twice, which only a brand-new database prints (it starts once to
                // initialise, then again). A kept database starts once, so wait for its port instead: it opens only when it's really ready.
                .waitingFor(Wait.forListeningPort().withStartupTimeout(Duration.ofSeconds(90)))
                // A fixed name: if the last run's container is still shutting down, Docker refuses a second one rather than letting two
                // databases open the same data. Wait a few seconds and start again.
                .withCreateContainerCmdModifier(cmd -> cmd.withName("vibe-dev-postgres")
                        .getHostConfig().withBinds(new Bind(VOLUME, new Volume("/var/lib/postgresql/data"))));
    }
}
