package in.vibe.backend.catalogue;

import in.vibe.backend.common.ApiException;

import java.time.OffsetDateTime;

/** The rule every discount must satisfy, whether it is a merchant's Pay & Redeem offer or a checkout coupon. */
public final class OfferRules {
    private OfferRules() {}

    /**
     * A percentage needs a rate (and may have a cap); a flat offer needs an amount and has no rate or cap.
     * A flat discount can't exceed the minimum bill, and the offer must end after it starts.
     */
    public static void check(String kind, Integer rateBps, Long flatAmount, Long maxDiscount, Long minBill, OffsetDateTime startsAt, OffsetDateTime endsAt) {
        if ("percentage".equals(kind)) {
            if (rateBps == null) throw ApiException.badRequest("offer_rule", "A percentage offer needs a percentage.");
            if (flatAmount != null) throw ApiException.badRequest("offer_rule", "A percentage offer can’t also have a flat amount.");
        } else if ("flat".equals(kind)) {
            if (flatAmount == null) throw ApiException.badRequest("offer_rule", "A flat offer needs an amount.");
            if (rateBps != null || maxDiscount != null) throw ApiException.badRequest("offer_rule", "A flat offer has no percentage or cap.");
            if (minBill != null && flatAmount > minBill) throw ApiException.badRequest("offer_rule", "The flat discount can’t be more than the minimum bill.");
        } else {
            throw ApiException.badRequest("offer_rule", "Choose percentage or flat.");
        }
        if (startsAt == null || endsAt == null || !endsAt.isAfter(startsAt)) throw ApiException.badRequest("offer_dates", "The offer must end after it starts.");
    }
}
