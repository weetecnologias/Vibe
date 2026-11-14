-- Social, part 1: member profiles with community guidelines, verified hosts, and one-on-one meetups that must reserve a place at a
-- verified venue before they go live. The creator pays the venue's deposit (in full, or their half when the cost is split); the table
-- is booked when the other person joins (and, when split, pays their half). Deposits are taken off the bill at the venue. Cancel up to
-- 3 hours before the start for a refund; after that the venue keeps the deposit. Nobody joins by then: the meetup expires and is refunded.
-- The table is held until 30 minutes after the start.

-- What a venue offers for meetups, on top of its reservation settings (enabled, table_fee, slot_fee, policy).
alter table reservation_settings add column meetups_per_hour int not null default 2 check (meetups_per_hour between 1 and 20);

-- A member's Social profile. Other members see only the first name, gender, age band and whether they are a verified host.
create table social_profiles (
    customer_id             uuid primary key references customers (id) on delete cascade,
    member_id               uuid not null unique,
    gender                  text not null check (gender in ('man', 'woman', 'nonbinary', 'undisclosed')),
    meet_preference         text not null check (meet_preference in ('men', 'women', 'anyone')),
    age_confirmed_18        boolean not null check (age_confirmed_18),
    age_band                text check (age_band is null or age_band in ('18-24', '25-34', '35-44', '45+')),
    guidelines_version      int not null,
    guidelines_accepted_at  timestamptz not null,
    status                  text not null default 'active' check (status in ('active', 'suspended')),
    suspended_reason        text,
    suspended_at            timestamptz,
    suspended_by            uuid,
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now()
);

-- Members who want to host activities and communities apply; VIBE checks their ID details and approves. Only the last 4 characters
-- of the ID number are stored.
create table social_hosts (
    customer_id                 uuid primary key references customers (id) on delete cascade,
    status                      text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'revoked')),
    legal_name                  text not null check (length(legal_name) between 2 and 120),
    id_type                     text not null check (id_type in ('aadhaar', 'pan', 'passport', 'driving_licence', 'voter_id')),
    id_last4                    text not null check (id_last4 ~ '^[0-9A-Z]{4}$'),
    date_of_birth               date not null,
    city                        text not null default 'Hyderabad',
    about                       text not null default '',
    host_guidelines_accepted_at timestamptz not null,
    submitted_at                timestamptz not null default now(),
    reviewed_at                 timestamptz,
    reviewed_by                 uuid,
    review_note                 text
);
create index social_hosts_status_idx on social_hosts (status, submitted_at);

-- A one-on-one meetup and its reservation at the venue.
create table meetups (
    id                          uuid primary key,
    host_id                     uuid not null references customers (id),
    kind                        text not null check (kind in ('coffee', 'sport', 'food', 'movie')),
    activity                    text not null check (length(activity) between 2 and 60),
    note                        text not null default '',
    business_id                 uuid not null references businesses (id),
    starts_at                   timestamptz not null,
    duration_min                int not null default 90,
    open_to                     text not null check (open_to in ('men', 'women', 'anyone')),
    pay_mode                    text not null check (pay_mode in ('full', 'split')),
    reservation_kind            text not null check (reservation_kind in ('table', 'slot')),
    deposit                     bigint not null check (deposit > 0),
    -- draft: waiting for the creator's payment (only the creator sees it) · open: live, people can ask to join · awaiting_payment: the
    -- creator accepted someone who must pay their half · matched: both in, the table is booked · completed · cancelled · expired
    status                      text not null default 'draft' check (status in ('draft', 'open', 'awaiting_payment', 'matched', 'completed', 'cancelled', 'expired')),
    partner_id                  uuid references customers (id),
    partner_pay_by              timestamptz,
    host_payment_request_id     uuid references payment_requests (id),
    partner_payment_request_id  uuid references payment_requests (id),
    reservation_ref             text not null unique,
    -- What the venue sees: pending (not booked yet) · confirmed · arrived · no_show · released (cancelled, expired or not paid)
    reservation_status          text not null default 'pending' check (reservation_status in ('pending', 'confirmed', 'arrived', 'no_show', 'released')),
    chat_status                 text not null default 'open' check (chat_status in ('open', 'closed')),
    chat_closed_reason          text check (chat_closed_reason is null or chat_closed_reason in ('contact_shared', 'cancelled', 'blocked', 'ended')),
    cancelled_by                text check (cancelled_by is null or cancelled_by in ('host', 'partner', 'vibe', 'system')),
    cancel_reason               text,
    cancelled_at                timestamptz,
    refunded                    boolean not null default false,
    created_at                  timestamptz not null default now(),
    updated_at                  timestamptz not null default now()
);
create index meetups_status_idx on meetups (status, starts_at);
create index meetups_business_idx on meetups (business_id, starts_at);
create index meetups_host_idx on meetups (host_id, created_at desc);

create table meetup_requests (
    meetup_id    uuid not null references meetups (id) on delete cascade,
    customer_id  uuid not null references customers (id),
    status       text not null default 'requested' check (status in ('requested', 'accepted', 'declined', 'withdrawn', 'lapsed')),
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    primary key (meetup_id, customer_id)
);

-- Chat between the two people, about meeting details only. sender null = a note from VIBE.
create table meetup_messages (
    id          uuid primary key,
    meetup_id   uuid not null references meetups (id) on delete cascade,
    sender_id   uuid references customers (id),
    text        text not null check (length(text) between 1 and 300),
    quick       boolean not null default false,
    created_at  timestamptz not null default now()
);
create index meetup_messages_idx on meetup_messages (meetup_id, created_at);

create table social_blocks (
    blocker_id  uuid not null references customers (id) on delete cascade,
    blocked_id  uuid not null references customers (id) on delete cascade,
    created_at  timestamptz not null default now(),
    primary key (blocker_id, blocked_id)
);

-- Reports from members, and ones VIBE raises itself (a contact detail shared in chat). reporter null = raised by VIBE.
create table social_reports (
    id           uuid primary key,
    reporter_id  uuid references customers (id),
    target_type  text not null check (target_type in ('user', 'meetup', 'activity', 'group')),
    target_id    text not null,
    reason       text not null check (reason in ('harassment', 'unsafe', 'spam', 'inappropriate', 'underage', 'contact_shared', 'other')),
    note         text not null default '',
    status       text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
    resolution   text,
    handled_by   uuid,
    handled_at   timestamptz,
    created_at   timestamptz not null default now()
);
create index social_reports_status_idx on social_reports (status, created_at);

-- Meetup deposits are payments to the venue.
alter table payment_requests add column meetup_id uuid references meetups (id);
alter table payment_requests drop constraint payment_requests_kind_check;
alter table payment_requests add constraint payment_requests_kind_check check (kind in ('redemption', 'membership', 'tickets', 'slots', 'pass', 'meetup'));
alter table payment_requests drop constraint payment_requests_shape;
alter table payment_requests add constraint payment_requests_shape check (
    (kind = 'redemption' and business_id is not null and plan_id is null and reservation_id is null)
    or (kind = 'membership' and plan_id is not null and business_id is null and reservation_id is null)
    or (kind = 'tickets' and reservation_id is not null and plan_id is null)
    or (kind in ('slots', 'pass') and business_id is not null and plan_id is null and reservation_id is null)
    or (kind = 'meetup' and business_id is not null and meetup_id is not null and plan_id is null and reservation_id is null));
