package in.vibe.backend.customer;

import in.vibe.backend.common.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.security.SecureRandom;

/**
 * How sign-in codes are made and delivered. Delivery needs an SMS provider with DLT-registered templates (an India requirement),
 * which is not connected yet. Until it is, only the `dev` profile can sign anyone in, with a fixed code.
 */
public final class SmsPorts {
    private SmsPorts() {}

    /** Makes the six-digit code. */
    public interface OtpCodes {
        String next();
    }

    /** Delivers the code by SMS. The real implementation goes here when a provider is chosen. */
    public interface OtpSender {
        void send(String phone, String code);
    }

    /** DEVELOPMENT ONLY: every code is 123456, so a person can sign in without an SMS. */
    @Component
    @Profile("dev")
    static class FixedCodes implements OtpCodes {
        @Override public String next() { return "123456"; }
    }

    /** DEVELOPMENT ONLY: no SMS is sent. */
    @Component
    @Profile("dev")
    static class LogSender implements OtpSender {
        private static final Logger log = LoggerFactory.getLogger(LogSender.class);

        @Override public void send(String phone, String code) { log.info("DEV: no SMS sent. The sign-in code for the number ending {} is {}", phone.substring(6), code); }
    }

    @Component
    @Profile("!dev")
    static class RandomCodes implements OtpCodes {
        private final SecureRandom random = new SecureRandom();

        @Override public String next() { return String.format("%06d", random.nextInt(1_000_000)); }
    }

    /** Refuses to sign anyone in until an SMS provider is connected, rather than pretending a message was sent. */
    @Component
    @Profile("!dev")
    static class NoSmsProvider implements OtpSender {
        @Override public void send(String phone, String code) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "sms_not_configured", "Sign-in by SMS isn’t available yet. Please try again later.");
        }
    }
}
