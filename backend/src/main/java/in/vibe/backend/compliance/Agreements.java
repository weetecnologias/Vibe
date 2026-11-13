package in.vibe.backend.compliance;

import in.vibe.backend.audit.AuditService;
import in.vibe.backend.common.ApiException;
import in.vibe.backend.notify.StaffNotifications;
import in.vibe.backend.security.StaffPrincipal;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * The merchant agreement. VIBE publishes versions of its terms; each business accepts the current one (an applicant when applying, or the owner
 * on first sign-in) and the acceptance is kept with who, when and from where. While no version is published nothing is required; once one is, a
 * business that hasn't accepted the current version can't use the merchant dashboard until its owner does. A new version asks everyone again.
 */
@Service
public class Agreements {
    public record Version(String id, int version, String title, String body, OffsetDateTime publishedAt, String publishedBy, int accepted) {}

    public record PublishInput(@NotBlank @Size(min = 3, max = 120) String title, @NotBlank @Size(min = 20, max = 50000) String body) {}

    /** required: a version is published; accepted: this business has accepted it. */
    public record Status(boolean required, boolean accepted, Version current, OffsetDateTime acceptedAt, String acceptedBy) {}

    public record Acceptance(String businessId, String businessName, int version, OffsetDateTime acceptedAt, String acceptedBy, String source, String ip) {}

    private final JdbcClient jdbc;
    private final AuditService audit;
    private final StaffNotifications staffNotifications;

    Agreements(JdbcClient jdbc, AuditService audit, StaffNotifications staffNotifications) {
        this.jdbc = jdbc;
        this.audit = audit;
        this.staffNotifications = staffNotifications;
    }

    private static final String SELECT = "select v.*, u.name uname, (select count(*) from agreement_acceptances a where a.version_id = v.id) accepted from agreement_versions v left join staff_users u on u.id = v.published_by ";

    private Version version(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Version(rs.getString("id"), rs.getInt("version"), rs.getString("title"), rs.getString("body"), rs.getObject("published_at", OffsetDateTime.class), rs.getString("uname"), rs.getInt("accepted"));
    }

    public Optional<Version> current() {
        return jdbc.sql(SELECT + "order by v.version desc limit 1").query((rs, i) -> version(rs)).optional();
    }

    public List<Version> versions() {
        return jdbc.sql(SELECT + "order by v.version desc").query((rs, i) -> version(rs)).list();
    }

    @Transactional
    public Version publish(StaffPrincipal who, PublishInput in) {
        int next = jdbc.sql("select coalesce(max(version), 0) + 1 from agreement_versions").query(Integer.class).single();
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into agreement_versions (id, version, title, body, published_by) values (:id, :v, :t, :b, :by)").param("id", id).param("v", next).param("t", in.title().trim()).param("b", in.body().trim()).param("by", who.id()).update();
        audit.record(who, "publish", "agreement", id, "Version " + next + ": " + in.title().trim());
        if (next > 1) {
            // Everyone has to accept the new version before they carry on.
            for (UUID biz : jdbc.sql("select distinct business_id from staff_users where role = 'MERCHANT' and active").query(UUID.class).list()) {
                staffNotifications.toBusiness(biz, "agreement_new", "New VIBE merchant agreement", "VIBE has published version " + next + " of the merchant agreement. The owner needs to accept it to keep using the dashboard.", "/agreement");
            }
        }
        return jdbc.sql(SELECT + "where v.id = :id").param("id", id).query((rs, i) -> version(rs)).single();
    }

    /** Has this business accepted what's current? True when nothing is published. */
    public boolean isAccepted(UUID business) {
        return jdbc.sql("select not exists (select 1 from agreement_versions) or exists (select 1 from agreement_acceptances a join agreement_versions v on v.id = a.version_id "
                        + "where a.business_id = :b and v.version = (select max(version) from agreement_versions))").param("b", business).query(Boolean.class).single();
    }

    public Status status(UUID business) {
        Optional<Version> cur = current();
        if (cur.isEmpty()) return new Status(false, true, null, null, null);
        var acc = jdbc.sql("select a.accepted_at, u.name from agreement_acceptances a left join staff_users u on u.id = a.staff_id where a.business_id = :b and a.version_id = :v")
                .param("b", business).param("v", UUID.fromString(cur.get().id())).query((rs, i) -> new Object[]{rs.getObject(1, OffsetDateTime.class), rs.getString(2)}).optional();
        return new Status(true, acc.isPresent(), cur.get(), acc.map(a -> (OffsetDateTime) a[0]).orElse(null), acc.map(a -> (String) a[1]).orElse(null));
    }

    /** The owner accepts the current version for the business. Once. */
    @Transactional
    public Status accept(StaffPrincipal who, String ip) {
        UUID business = who.requireBusiness();
        Version cur = current().orElseThrow(() -> ApiException.conflict("nothing_to_accept", "There is no agreement to accept right now."));
        if (!isAccepted(business)) {
            jdbc.sql("insert into agreement_acceptances (id, version_id, business_id, staff_id, ip, source) values (:id, :v, :b, :s, :ip, 'dashboard') on conflict do nothing")
                    .param("id", UUID.randomUUID()).param("v", UUID.fromString(cur.id())).param("b", business).param("s", who.id()).param("ip", ip).update();
            audit.record(who, "accept", "agreement", cur.id(), "Version " + cur.version());
        }
        return status(business);
    }

    /** An applicant accepted the terms in the application; once approved, that counts for the business (if it is still the current version). */
    @Transactional
    public void carryOver(UUID applicationId, UUID business, UUID owner) {
        jdbc.sql("insert into agreement_acceptances (id, version_id, business_id, staff_id, accepted_at, ip, source) "
                        + "select gen_random_uuid(), a.terms_version_id, :b, :o, a.terms_accepted_at, a.terms_accepted_ip, 'application' from merchant_applications a where a.id = :a and a.terms_version_id is not null on conflict do nothing")
                .param("b", business).param("o", owner).param("a", applicationId).update();
    }

    /** Who has accepted which version, newest first (for audits). */
    public List<Acceptance> acceptances(Integer version, String scope) {
        return jdbc.sql("select b.id bid, b.name bname, v.version, a.accepted_at, u.name uname, a.source, a.ip from agreement_acceptances a join agreement_versions v on v.id = a.version_id join businesses b on b.id = a.business_id "
                        + "left join staff_users u on u.id = a.staff_id where true" + (version == null ? "" : " and v.version = :v") + scope + " order by a.accepted_at desc limit 500")
                .param("v", version == null ? 0 : version).query((rs, i) -> new Acceptance(rs.getString("bid"), rs.getString("bname"), rs.getInt("version"), rs.getObject("accepted_at", OffsetDateTime.class),
                        rs.getString("uname"), rs.getString("source"), rs.getString("ip"))).list();
    }
}
