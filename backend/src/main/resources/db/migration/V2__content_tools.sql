-- Content tools: offer review, merchant team owners, membership plans, home content, checkout coupons,
-- events and ticket types, reservation settings, and uploaded media. Money is bigint paise.

-- ---- Offer review: a merchant's offer goes live only after VIBE approves it ----
alter table offers
    add column review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
    add column review_note   text,
    add column reviewed_at   timestamptz,
    add column reviewed_by   uuid;
-- Offers that already exist were live before review was introduced.
update offers set review_status = 'approved', reviewed_at = now();

-- ---- Merchant team: the first login for a business is its owner and can add staff ----
alter table staff_users add column owner boolean not null default false;
update staff_users set owner = true where role = 'MERCHANT';

-- ---- Membership plans ----
create table membership_plans (
    id             uuid primary key,
    name           text not null,
    interval       text not null check (interval in ('month', 'year')),
    price          bigint not null check (price >= 0),
    note           text not null default '',
    savings_label  text,
    benefits       text[] not null default '{}',
    sort_order     int not null default 0,
    active         boolean not null default true,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

-- ---- Home content ----
create table home_banners (
    id           uuid primary key,
    eyebrow      text not null default '',
    title        text not null,
    subtitle     text not null default '',
    cta          text not null default 'Explore',
    image_url    text,
    target_type  text not null check (target_type in ('offer', 'events', 'category')),
    target_id    uuid,
    sort_order   int not null default 0,
    active       boolean not null default true,
    starts_at    timestamptz,
    ends_at      timestamptz,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    check (target_type = 'events' or target_id is not null),
    check (ends_at is null or starts_at is null or ends_at > starts_at)
);

-- What an admin pins to a section of the home screen, in order. With nothing pinned the app falls back to automatic picks.
create table home_picks (
    section     text not null check (section in ('trending', 'offers', 'events')),
    ref_id      uuid not null,
    sort_order  int not null default 0,
    primary key (section, ref_id)
);

-- ---- Checkout coupons (applied at the payment step for movie and event tickets) ----
create table checkout_coupons (
    id                  uuid primary key,
    code                text not null unique check (code = upper(code) and code ~ '^[A-Z0-9]{3,20}$'),
    title               text not null,
    description         text not null default '',
    member_only         boolean not null default false,
    kinds               text[] not null check (kinds <@ array['tickets', 'movie'] and cardinality(kinds) > 0),
    kind                text not null check (kind in ('percentage', 'flat')),
    rate_bps            int check (rate_bps is null or rate_bps between 1 and 9000),
    flat_amount         bigint check (flat_amount is null or flat_amount > 0),
    max_discount        bigint check (max_discount is null or max_discount > 0),
    min_bill            bigint check (min_bill is null or min_bill >= 0),
    first_booking_only  boolean not null default false,
    max_uses_per_user   int check (max_uses_per_user is null or max_uses_per_user > 0),
    terms               text[] not null default '{}',
    starts_at           timestamptz not null,
    ends_at             timestamptz not null,
    active              boolean not null default true,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    check (ends_at > starts_at),
    check ((kind = 'percentage' and rate_bps is not null and flat_amount is null)
        or (kind = 'flat' and flat_amount is not null and rate_bps is null))
);

-- ---- Events and tickets (selling tickets and holds arrive with the ticketing module) ----
create table events (
    id            uuid primary key,
    business_id   uuid references businesses (id),
    organiser     text not null,
    title         text not null,
    kind          text not null check (kind in ('Workshops', 'Meetups', 'Tours', 'Live Events', 'Experiences', 'Movies')),
    description   text not null default '',
    venue         text not null,
    area          text not null,
    starts_at     timestamptz not null,
    gates_open_at timestamptz not null,
    cover_url     text,
    age_limit     int check (age_limit is null or age_limit between 5 and 99),
    featured      boolean not null default false,
    terms         text[] not null default '{}',
    -- A merchant's event starts as pending. VIBE publishes or rejects it; VIBE's own events publish straight away.
    status        text not null default 'pending' check (status in ('pending', 'published', 'rejected', 'cancelled')),
    review_note   text,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    check (gates_open_at <= starts_at)
);
create index events_status_start_idx on events (status, starts_at);
create index events_business_idx on events (business_id);

create table ticket_types (
    id             uuid primary key,
    event_id       uuid not null references events (id) on delete cascade,
    name           text not null,
    description    text not null default '',
    price          bigint not null check (price >= 0),
    capacity       int not null check (capacity >= 0),
    max_per_order  int not null default 6 check (max_per_order between 1 and 20),
    sort_order     int not null default 0
);
create index ticket_types_event_idx on ticket_types (event_id, sort_order);

-- ---- What a venue charges to reserve a table or slot for a one-on-one, and its policy ----
create table reservation_settings (
    business_id  uuid primary key references businesses (id) on delete cascade,
    enabled      boolean not null default false,
    table_fee    bigint check (table_fee is null or table_fee > 0),
    slot_fee     bigint check (slot_fee is null or slot_fee > 0),
    policy       text not null default '',
    updated_at   timestamptz not null default now()
);

-- ---- Uploaded images ----
create table media (
    id            uuid primary key,
    filename      text not null unique,
    content_type  text not null,
    size_bytes    bigint not null,
    uploaded_by   uuid not null,
    created_at    timestamptz not null default now()
);
