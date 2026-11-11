package in.vibe.backend.catalogue;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Open or closed is decided in India time, from the hours the merchant set. */
class OpenStatusTest {
    static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    /** Monday 10 Nov 2026 at the given India time. */
    static Businesses at(String hhmm) {
        Instant t = java.time.ZonedDateTime.of(2026, 11, 9, Integer.parseInt(hhmm.substring(0, 2)), Integer.parseInt(hhmm.substring(3)), 0, 0, IST).toInstant();
        return new Businesses(null, Clock.fixed(t, IST));
    }

    static Map<Integer, LocalTime[]> everyDay(String opens, String closes) {
        Map<Integer, LocalTime[]> m = new HashMap<>();
        for (int d = 0; d < 7; d++) m.put(d, new LocalTime[]{LocalTime.parse(opens), LocalTime.parse(closes)});
        return m;
    }

    @Test
    void openInTheMiddleOfTheDay() {
        var s = at("14:00").status(everyDay("11:00", "23:00"));
        assertTrue(s.open());
        assertEquals("Open · closes 11 PM", s.label());
        assertEquals("success", s.tone());
    }

    @Test
    void closingSoonInTheLastHour() {
        var s = at("22:30").status(everyDay("11:00", "23:00"));
        assertTrue(s.open());
        assertEquals("warning", s.tone());
        assertEquals("Closing soon · 11 PM", s.label());
    }

    @Test
    void closedBeforeOpeningTimeSaysWhenItOpens() {
        var s = at("08:15").status(everyDay("11:30", "23:00"));
        assertFalse(s.open());
        assertEquals("Closed · opens 11:30 AM", s.label());
    }

    @Test
    void closedAfterClosingTimeSaysTomorrow() {
        var s = at("23:30").status(everyDay("11:00", "23:00"));
        assertFalse(s.open());
        assertEquals("Closed · opens tomorrow 11 AM", s.label());
    }

    @Test
    void aCinemaOpenPastMidnightIsStillOpenAfterMidnight() {
        // Monday 00:30, open Sunday 09:00 to Monday 01:00.
        var s = at("00:30").status(everyDay("09:00", "01:00"));
        assertTrue(s.open());
        // Monday 13:00 is inside Monday's 09:00 to 01:00 as well.
        assertTrue(at("13:00").status(everyDay("09:00", "01:00")).open());
        // Monday 02:00 is after yesterday's 01:00 close and before today's 09:00 open.
        assertFalse(at("02:00").status(everyDay("09:00", "01:00")).open());
    }

    @Test
    void closedDaysAndMissingHours() {
        Map<Integer, LocalTime[]> week = everyDay("11:00", "23:00");
        week.put(0, null); // Monday closed
        assertEquals("Closed · opens tomorrow 11 AM", at("14:00").status(week).label());
        var none = at("14:00").status(new HashMap<>());
        assertFalse(none.open());
        assertEquals("Hours not set", none.label());
    }
}
