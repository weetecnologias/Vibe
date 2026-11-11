package in.vibe.backend.billing;

/**
 * Works out a discount from an offer's rule. The server is the only place this happens: the app and the merchant dashboard
 * show what it returns and never compute a discount themselves. All amounts are integer paise.
 */
public final class Pricing {
    private Pricing() {}

    /** `reason` is set when the offer doesn't apply to this bill (for example it is below the minimum). */
    public record Quote(long discount, String reason) {}

    public static Quote quote(String kind, Integer rateBps, Long flatAmount, Long maxDiscount, Long minBill, long eligible) {
        if (eligible <= 0) throw new IllegalArgumentException("The bill must be a positive amount");
        if (minBill != null && eligible < minBill) return new Quote(0, "Bill is below the minimum for this offer");
        long discount;
        if ("percentage".equals(kind)) {
            if (rateBps == null || rateBps <= 0 || rateBps > 10_000) throw new IllegalArgumentException("rateBps must be between 1 and 10000");
            // Rounded down to the paisa, so the customer is never charged a fraction.
            discount = Math.multiplyExact(eligible, (long) rateBps) / 10_000;
            if (maxDiscount != null) discount = Math.min(discount, maxDiscount);
        } else {
            if (flatAmount == null || flatAmount <= 0) throw new IllegalArgumentException("A flat offer needs an amount");
            discount = Math.min(flatAmount, eligible);
        }
        return new Quote(discount, null);
    }
}
