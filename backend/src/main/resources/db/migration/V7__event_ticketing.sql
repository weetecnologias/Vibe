-- Event ticketing: a customer holds tickets for a few minutes, pays, and gets one QR ticket per person.

-- Ticket orders are paid like any other bill. VIBE's own events have no business; a merchant's event is paid to (and settled with) that merchant.
alter table payment_requests drop constraint payment_requests_kind_check;
alter table payment_requests add constraint payment_requests_kind_check check (kind in ('redemption', 'membership', 'tickets'));
alter table payment_requests add column reservation_id uuid;
-- A VIBE checkout coupon applied to the order, and how much of the discount VIBE pays for (the merchant still receives the full price).
alter table payment_requests add column coupon_id uuid references checkout_coupons (id);
alter table payment_requests add column vibe_funded bigint not null default 0 check (vibe_funded >= 0);
alter table payment_requests drop constraint payment_requests_shape;
alter table payment_requests add constraint payment_requests_shape check (
    (kind = 'redemption' and business_id is not null and plan_id is null and reservation_id is null)
    or (kind = 'membership' and plan_id is not null and business_id is null and reservation_id is null)
    or (kind = 'tickets' and reservation_id is not null and plan_id is null));
alter table payment_requests add constraint payment_requests_vibe_funded check (vibe_funded <= discount);

-- A ticket type that has been sold is never deleted (tickets point at it); removing it from the event hides it instead.
alter table ticket_types add column archived boolean not null default false;

create table ticket_reservations (
    id                  uuid primary key,
    event_id            uuid not null references events (id),
    customer_id         uuid not null references customers (id),
    -- held: counts against what's left until it expires (or while its payment is in flight). paid: tickets issued. released: let go.
    status              text not null default 'held' check (status in ('held', 'paid', 'released')),
    attendees           text[] not null,
    total               bigint not null check (total > 0),
    expires_at          timestamptz not null,
    payment_request_id  uuid not null unique references payment_requests (id),
    booking_id          text not null unique,
    created_at          timestamptz not null default now(),
    paid_at             timestamptz
);
create index ticket_reservations_event_idx on ticket_reservations (event_id, status);
create index ticket_reservations_customer_idx on ticket_reservations (customer_id, created_at desc);

create table ticket_reservation_items (
    reservation_id  uuid not null references ticket_reservations (id) on delete cascade,
    ticket_type_id  uuid not null references ticket_types (id),
    quantity        int not null check (quantity > 0),
    unit_price      bigint not null check (unit_price >= 0),
    primary key (reservation_id, ticket_type_id)
);
create index ticket_reservation_items_type_idx on ticket_reservation_items (ticket_type_id);

create table tickets (
    id              uuid primary key,
    reservation_id  uuid not null references ticket_reservations (id),
    event_id        uuid not null references events (id),
    ticket_type_id  uuid not null references ticket_types (id),
    customer_id     uuid not null references customers (id),
    attendee_name   text not null,
    admission_code  text not null unique,
    qr_token        text not null unique,
    position        int not null,
    of_count        int not null,
    status          text not null default 'valid' check (status in ('valid', 'checked_in', 'cancelled')),
    checked_in_at   timestamptz,
    checked_in_by   uuid references staff_users (id),
    created_at      timestamptz not null default now()
);
create index tickets_customer_idx on tickets (customer_id);
create index tickets_event_idx on tickets (event_id, status);
