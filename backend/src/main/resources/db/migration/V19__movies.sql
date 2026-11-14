-- Movies: VIBE keeps the film catalogue; each cinema sets up its screens (seat layout and seat classes with prices) and schedules shows.
-- A customer holds seats for a few minutes while paying; once paid, one QR ticket per seat is issued and the cinema checks it at the door.

create table movies (
    id            uuid primary key,
    title         text not null check (length(title) between 1 and 120),
    certificate   text not null check (certificate in ('U', 'UA', 'A')),
    duration_min  int not null check (duration_min between 30 and 300),
    genres        text[] not null default '{}',
    languages     text[] not null check (cardinality(languages) > 0),
    formats       text[] not null default '{2D}' check (formats <@ array['2D', '3D', 'IMAX', 'Dolby Atmos'] and cardinality(formats) > 0),
    rating        numeric(3, 1) check (rating is null or rating between 0 and 10),
    votes         int not null default 0 check (votes >= 0),
    poster_url    text,
    release_date  date not null,
    synopsis      text not null default '',
    director      text not null default '',
    cast_names    text[] not null default '{}',
    -- now_showing / coming_soon are worked out from the release date; archived hides the film everywhere.
    archived      boolean not null default false,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

-- classes: [{"id": "recliner", "name": "Recliner", "price": 45000}]
-- rows:    [{"label": "A", "classId": "recliner", "seats": [1, 2, null, 3, 4]}]   (null = an aisle gap)
create table cinema_screens (
    id           uuid primary key,
    business_id  uuid not null references businesses (id),
    name         text not null check (length(name) between 1 and 40),
    classes      jsonb not null,
    rows         jsonb not null,
    seat_count   int not null check (seat_count between 1 and 1000),
    active       boolean not null default true,
    created_at   timestamptz not null default now(),
    unique (business_id, name)
);

create table movie_shows (
    id           uuid primary key,
    movie_id     uuid not null references movies (id),
    screen_id    uuid not null references cinema_screens (id),
    business_id  uuid not null references businesses (id),
    starts_at    timestamptz not null,
    language     text not null,
    format       text not null check (format in ('2D', '3D', 'IMAX', 'Dolby Atmos')),
    -- The screen's classes and prices when the show was scheduled, so later price changes don't touch it.
    classes      jsonb not null,
    status       text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
    created_at   timestamptz not null default now()
);
create index movie_shows_movie_idx on movie_shows (movie_id, starts_at);
create index movie_shows_business_idx on movie_shows (business_id, starts_at);
create unique index movie_shows_screen_start_idx on movie_shows (screen_id, starts_at) where status = 'scheduled';

create table movie_bookings (
    id                  uuid primary key,
    show_id             uuid not null references movie_shows (id),
    customer_id         uuid not null references customers (id),
    -- held counts against the seats until it expires (or while its payment is in flight). paid: tickets issued. released: let go.
    status              text not null default 'held' check (status in ('held', 'paid', 'released')),
    seats               text[] not null check (cardinality(seats) between 1 and 10),
    total               bigint not null check (total > 0),
    expires_at          timestamptz not null,
    payment_request_id  uuid not null unique references payment_requests (id),
    booking_id          text not null unique,
    created_at          timestamptz not null default now(),
    paid_at             timestamptz
);
create index movie_bookings_show_idx on movie_bookings (show_id, status);
create index movie_bookings_customer_idx on movie_bookings (customer_id, created_at desc);

create table movie_tickets (
    id              uuid primary key,
    booking_id      uuid not null references movie_bookings (id),
    show_id         uuid not null references movie_shows (id),
    customer_id     uuid not null references customers (id),
    seat_id         text not null,
    class_name      text not null,
    price           bigint not null,
    admission_code  text not null unique,
    qr_token        text not null unique,
    position        int not null,
    of_count        int not null,
    status          text not null default 'valid' check (status in ('valid', 'checked_in', 'cancelled')),
    checked_in_at   timestamptz,
    checked_in_by   uuid references staff_users (id),
    created_at      timestamptz not null default now(),
    unique (show_id, seat_id)
);
create index movie_tickets_customer_idx on movie_tickets (customer_id);

-- Seat orders are paid to the cinema like any other bill; reservation_id points at the movie booking.
alter table payment_requests drop constraint payment_requests_kind_check;
alter table payment_requests add constraint payment_requests_kind_check check (kind in ('redemption', 'membership', 'tickets', 'slots', 'pass', 'meetup', 'movie'));
alter table payment_requests drop constraint payment_requests_shape;
alter table payment_requests add constraint payment_requests_shape check (
    (kind = 'redemption' and business_id is not null and plan_id is null and reservation_id is null)
    or (kind = 'membership' and plan_id is not null and business_id is null and reservation_id is null)
    or (kind = 'tickets' and reservation_id is not null and plan_id is null)
    or (kind in ('slots', 'pass') and business_id is not null and plan_id is null and reservation_id is null)
    or (kind = 'meetup' and business_id is not null and meetup_id is not null and plan_id is null and reservation_id is null)
    or (kind = 'movie' and business_id is not null and reservation_id is not null and plan_id is null));
