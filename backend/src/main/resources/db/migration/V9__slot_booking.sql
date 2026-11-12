-- Slot booking for sports and fitness, the way Playo works: a venue offers sports; each sport has bookable resources (courts, turfs, nets, lanes,
-- classes); a customer picks a date, a start time and a duration, then a resource, holds it while paying, and gets an entry code.
--   court: one booking per slot (a badminton court, a football turf, cricket nets).
--   spots: several people per slot up to the capacity (a swimming session, a yoga class, a gym session).
create table venue_resources (
    id             uuid primary key,
    business_id    uuid not null references businesses (id) on delete cascade,
    sport          text not null check (length(sport) between 2 and 40),
    name           text not null check (length(name) between 1 and 60),
    kind           text not null default 'court' check (kind in ('court', 'spots')),
    capacity       int not null default 1 check (capacity between 1 and 500),
    slot_minutes   int not null default 60 check (slot_minutes in (30, 45, 60, 90, 120)),
    price          bigint not null check (price >= 0),
    -- Peak pricing: a different price between two times of day, optionally on weekends all day.
    peak_price     bigint check (peak_price is null or peak_price >= 0),
    peak_from      time,
    peak_to        time,
    weekend_peak   boolean not null default false,
    active         boolean not null default true,
    sort_order     int not null default 0,
    created_at     timestamptz not null default now(),
    check (kind = 'spots' or capacity = 1),
    check (peak_price is not null or (peak_from is null and peak_to is null and not weekend_peak)),
    check ((peak_from is null) = (peak_to is null))
);
create index venue_resources_business_idx on venue_resources (business_id, sport, sort_order);

-- Times the venue takes a resource out of booking (maintenance, a tournament, walk-ins).
create table resource_blocks (
    id           uuid primary key,
    resource_id  uuid not null references venue_resources (id) on delete cascade,
    starts_at    timestamptz not null,
    ends_at      timestamptz not null,
    reason       text not null default '',
    created_by   uuid references staff_users (id),
    created_at   timestamptz not null default now(),
    check (ends_at > starts_at)
);
create index resource_blocks_idx on resource_blocks (resource_id, starts_at);

create table slot_bookings (
    id                  uuid primary key,
    business_id         uuid not null references businesses (id),
    customer_id         uuid not null references customers (id),
    -- held: counts against availability until it expires (or while its payment is in flight). paid: confirmed. released / cancelled: let go.
    status              text not null default 'held' check (status in ('held', 'paid', 'released', 'cancelled')),
    booking_ref         text not null unique,
    entry_code          text unique,
    total               bigint not null check (total > 0),
    expires_at          timestamptz not null,
    payment_request_id  uuid not null unique references payment_requests (id),
    checked_in_at       timestamptz,
    created_at          timestamptz not null default now(),
    paid_at             timestamptz
);
create index slot_bookings_business_idx on slot_bookings (business_id, status);
create index slot_bookings_customer_idx on slot_bookings (customer_id, created_at desc);

create table slot_booking_items (
    booking_id   uuid not null references slot_bookings (id) on delete cascade,
    resource_id  uuid not null references venue_resources (id),
    starts_at    timestamptz not null,
    ends_at      timestamptz not null,
    spots        int not null default 1 check (spots > 0),
    price        bigint not null check (price >= 0),
    primary key (booking_id, resource_id, starts_at),
    check (ends_at > starts_at)
);
create index slot_booking_items_resource_idx on slot_booking_items (resource_id, starts_at);

-- Slot orders are paid like any other bill and settled to the venue.
alter table payment_requests drop constraint payment_requests_kind_check;
alter table payment_requests add constraint payment_requests_kind_check check (kind in ('redemption', 'membership', 'tickets', 'slots'));
alter table payment_requests drop constraint payment_requests_shape;
alter table payment_requests add constraint payment_requests_shape check (
    (kind = 'redemption' and business_id is not null and plan_id is null and reservation_id is null)
    or (kind = 'membership' and plan_id is not null and business_id is null and reservation_id is null)
    or (kind = 'tickets' and reservation_id is not null and plan_id is null)
    or (kind = 'slots' and business_id is not null and plan_id is null and reservation_id is null));

-- Managers can run court and class bookings; staff added before this area existed get it too.
update staff_users set permissions = array_append(permissions, 'bookings') where staff_role = 'manager' and not ('bookings' = any(permissions));
