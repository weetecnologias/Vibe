package in.vibe.backend.catalogue;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * What kind of business this is decides how customers pay it. A restaurant, salon or shop uses Pay & Redeem (the merchant raises a bill).
 * A cinema or an event organiser sells tickets instead. Admin sets this on the category, and a business follows its main category and the ones above it:
 * if any category up the tree has bills switched off, the business has none. The item list can be called Menu, Price list, Services and so on.
 */
@Service
public class BillingRules {
    public record Rules(boolean payRedeem, String menuLabel) {}

    private final JdbcClient jdbc;

    BillingRules(JdbcClient jdbc) { this.jdbc = jdbc; }

    public Rules forBusiness(UUID business) {
        return jdbc.sql("""
                with recursive chain as (
                    select c.id, c.parent_id, c.pay_redeem, c.menu_label, 0 depth from categories c join businesses b on b.primary_category_id = c.id where b.id = :b
                    union all
                    select p.id, p.parent_id, p.pay_redeem, p.menu_label, ch.depth + 1 from categories p join chain ch on p.id = ch.parent_id)
                select coalesce(bool_and(pay_redeem), true), (select menu_label from chain where menu_label is not null order by depth limit 1) from chain
                """).param("b", business).query((rs, i) -> new Rules(rs.getBoolean(1), rs.getString(2) == null ? "Menu" : rs.getString(2))).optional().orElse(new Rules(true, "Menu"));
    }
}
