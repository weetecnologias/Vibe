-- Monthly memberships at gyms, yoga and meditation studios and personal trainers: a customer chooses a plan, picks the month it starts, and pays
-- through VIBE. A trial or a single day is still booked as a session by the slot (V9).
create table venue_plans (
    id           uuid primary key,
    business_id  uuid not null references businesses (id) on delete cascade,
    name         text not null check (length(name) between 2 and 80),
    description  text not null default '' check (length(description) <= 300),
    months       int not null check (months in (1, 3, 6, 12)),
    price        bigint not null check (price > 0),
    benefits     text[] not null default '{}',
    active       boolean not null default true,
    sort_order   int not null default 0,
    created_at   timestamptz not null default now()
);
create index venue_plans_business_idx on venue_plans (business_id, sort_order);

create table venue_passes (
    id                  uuid primary key,
    business_id         uuid not null references businesses (id),
    customer_id         uuid not null references customers (id),
    plan_id             uuid not null references venue_plans (id),
    -- held until paid (or released); paid passes are valid from starts_on to ends_on inclusive.
    status              text not null default 'held' check (status in ('held', 'paid', 'released')),
    starts_on           date not null,
    ends_on             date not null,
    total               bigint not null check (total > 0),
    expires_at          timestamptz not null,
    payment_request_id  uuid not null unique references payment_requests (id),
    pass_ref            text not null unique,
    pass_code           text unique,
    last_check_in       timestamptz,
    check_ins           int not null default 0,
    created_at          timestamptz not null default now(),
    paid_at             timestamptz,
    check (ends_on >= starts_on)
);
create index venue_passes_business_idx on venue_passes (business_id, status, ends_on);
create index venue_passes_customer_idx on venue_passes (customer_id, created_at desc);

alter table payment_requests drop constraint payment_requests_kind_check;
alter table payment_requests add constraint payment_requests_kind_check check (kind in ('redemption', 'membership', 'tickets', 'slots', 'pass'));
alter table payment_requests drop constraint payment_requests_shape;
alter table payment_requests add constraint payment_requests_shape check (
    (kind = 'redemption' and business_id is not null and plan_id is null and reservation_id is null)
    or (kind = 'membership' and plan_id is not null and business_id is null and reservation_id is null)
    or (kind = 'tickets' and reservation_id is not null and plan_id is null)
    or (kind in ('slots', 'pass') and business_id is not null and plan_id is null and reservation_id is null));

-- Checkout coupons (and VIBE member offers) can apply to court and class bookings and to venue memberships too.
alter table checkout_coupons drop constraint checkout_coupons_kinds_check;
alter table checkout_coupons add constraint checkout_coupons_kinds_check check (kinds <@ array['tickets', 'movie', 'slots', 'pass'] and cardinality(kinds) > 0);
