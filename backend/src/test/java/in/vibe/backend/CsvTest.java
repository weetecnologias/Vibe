package in.vibe.backend;

import in.vibe.backend.common.Csv;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;

class CsvTest {
    private static String body(Csv csv) { return new String(csv.download("x.csv").getBody(), StandardCharsets.UTF_8); }

    @Test
    void cellsAreQuotedWhenNeededAndFormulasCannotRun() {
        String out = body(new Csv().row("Name", "Note").row("=HYPERLINK(\"http://evil\")", "a, \"b\"").row("+91", "@sum").row(12, null));
        assertEquals("﻿Name,Note\r\n\"'=HYPERLINK(\"\"http://evil\"\")\",\"a, \"\"b\"\"\"\r\n'+91,'@sum\r\n12,\r\n", out);
    }

    @Test
    void moneyIsRupeesWithTwoDecimals() {
        assertEquals("700.00", Csv.rupees(70000));
        assertEquals("0.05", Csv.rupees(5));
        assertEquals("1234.50", Csv.rupees(123450));
    }
}
