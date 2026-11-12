-- 1. What a merchant gets depends on the category it onboarded in. Each category can list the merchant features its businesses use
--    (bills, offers, menu, reservations, bookings, memberships, events, promotions). Null means "same as the parent"; a business follows the
--    nearest category up its tree that sets them. An empty list means the category isn't for merchants (VIBE Social, Offers & Benefits).
alter table categories add column features text[]
    check (features is null or features <@ array['bills', 'offers', 'menu', 'reservations', 'bookings', 'memberships', 'events', 'promotions']);

-- 2. Roles inside VIBE's own team. super_admin: everything, including the team. admin: everything except other admins' accounts.
--    staff: only the areas ticked (admin_areas), and optionally only some categories (admin_category_ids; empty means all categories).
alter table staff_users
    add column admin_role text check (admin_role in ('super_admin', 'admin', 'staff')),
    add column admin_areas text[] not null default '{}',
    add column admin_category_ids uuid[] not null default '{}';
-- The first admin ever created becomes the super admin; the rest stay full admins, as they were.
update staff_users set admin_role = 'super_admin' where role = 'ADMIN' and id = (select id from staff_users where role = 'ADMIN' order by created_at, id limit 1);
update staff_users set admin_role = 'admin' where role = 'ADMIN' and admin_role is null;
alter table staff_users add constraint staff_users_admin_role check ((role = 'ADMIN') = (admin_role is not null));

-- 3. Refunds. A verified payment can be marked "refund due" (an event was cancelled, a customer was charged for something they didn't get),
--    then "refunded" once the money has gone back through the payment partner, with the partner's reference. A payment with a refund is not
--    settled to the business.
alter table payments
    add column refund_status text check (refund_status in ('due', 'refunded')),
    add column refund_reason text,
    add column refund_amount bigint check (refund_amount is null or refund_amount > 0),
    add column refund_requested_at timestamptz,
    add column refund_requested_by uuid,
    add column refunded_at timestamptz,
    add column refunded_by uuid,
    add column refund_reference text,
    add constraint payments_refund_shape check (refund_status is null or (status = 'verified' and refund_amount is not null and refund_reason is not null));
create index payments_refund_idx on payments (refund_status, refund_requested_at) where refund_status is not null;
create index payments_status_created_idx on payments (status, created_at desc);
