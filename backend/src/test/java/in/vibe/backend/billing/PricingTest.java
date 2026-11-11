package in.vibe.backend.billing;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

/** The same rules as the customer app's demo pricing: the real backend must give the same answers. */
class PricingTest {
    @Test
    void aPercentageIsRoundedDownToThePaisaAndCapped() {
        assertEquals(30_000, Pricing.quote("percentage", 3000, null, null, null, 100_000).discount());
        assertEquals(333, Pricing.quote("percentage", 3333, null, null, null, 1_000).discount()); // 333.3 -> 333, never rounded up
        assertEquals(50_000, Pricing.quote("percentage", 3000, null, 50_000L, null, 400_000).discount()); // 30% would be 120,000; capped
        assertEquals(0, Pricing.quote("percentage", 1, null, null, null, 99).discount()); // a fraction of a paisa is nothing
    }

    @Test
    void aFlatOfferNeverExceedsTheBill() {
        assertEquals(10_000, Pricing.quote("flat", null, 10_000L, null, null, 50_000).discount());
        assertEquals(5_000, Pricing.quote("flat", null, 10_000L, null, null, 5_000).discount());
    }

    @Test
    void belowTheMinimumThereIsNoDiscountAndTheReasonIsGiven() {
        var q = Pricing.quote("percentage", 3000, null, null, 50_000L, 49_999);
        assertEquals(0, q.discount());
        assertEquals("Bill is below the minimum for this offer", q.reason());
        assertNull(Pricing.quote("percentage", 3000, null, null, 50_000L, 50_000).reason());
    }

    @Test
    void largeBillsDoNotOverflow() {
        assertEquals(30_000_000, Pricing.quote("percentage", 3000, null, null, null, 100_000_000).discount());
    }

    @Test
    void impossibleInputIsRefused() {
        assertThrows(IllegalArgumentException.class, () -> Pricing.quote("percentage", 3000, null, null, null, 0));
        assertThrows(IllegalArgumentException.class, () -> Pricing.quote("percentage", 3000, null, null, null, -5));
        assertThrows(IllegalArgumentException.class, () -> Pricing.quote("percentage", 0, null, null, null, 100));
        assertThrows(IllegalArgumentException.class, () -> Pricing.quote("percentage", 10_001, null, null, null, 100));
        assertThrows(IllegalArgumentException.class, () -> Pricing.quote("flat", null, null, null, null, 100));
    }
}
