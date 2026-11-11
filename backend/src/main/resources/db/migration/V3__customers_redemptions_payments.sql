-- B2: customer sign-in, memberships, Pay & Redeem (redemptions and bills), payments, notifications.
-- Money is bigint paise. All timestamps are UTC (timestamptz).

-- ---- Customers ----
create table customers (
    id          uuid primary key,
    phone       text not null unique check (phone ~ '^[6-9][0-9]{9}$'),
    name        text not null,
    -- Six digits the customer shows to staff. Staff see only the first name, an initial and this number.
    vibe_id     text not null unique check (vibe_id ~ '^[0-9]{6}$'),
    area        text,
    created_at  timestamptz not null default now()
);

-- One-time codes sent by SMS. The code itself is never stored, only a keyed hash.
create table otp_requests (
    id             uuid primary key,
    phone          text not null,
    code_hash      text not null,
    attempts_left  int not null,
    expires_at     timestamptz not null,
    consumed       boolean not null default false,
    created_at     timestamptz not null default now()
);
create index otp_requests_phone_idx on otp_requests (phone, created_at desc);

create table refresh_tokens (
    id           uuid primary key,
    customer_id  uuid not null references customers (id) on delete cascade,
    token_hash   text not null unique,
    expires_at   timestamptz not null,
    revoked      boolean not null default false,
    created_at   timestamptz not null default now()
);
create index refresh_tokens_customer_idx on refresh_tokens (customer_id);

create table memberships (
    customer_id  uuid primary key references customers (id) on delete cascade,
    status       text not null check (status in ('active', 'cancelled')),
    valid_until  timestamptz not null,
    plan_id      uuid references membership_plans (id),
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create table deletion_requests (
    id            uuid primary key,
    customer_id   uuid not null references customers (id),
    status        text not null default 'pending' check (status in ('pending', 'done')),
    requested_at  timestamptz not null default now()
);

create table device_tokens (
    token        text primary key,
    customer_id  uuid not null references customers (id) on delete cascade,
    platform     text not null check (platform in ('android', 'ios', 'web')),
    updated_at   timestamptz not null default now()
);

-- ---- Pay & Redeem ----
create table redemptions (
    id                  uuid primary key,
    customer_id         uuid not null references customers (id),
    offer_id            uuid not null references offers (id),
    business_id         uuid not null references businesses (id),
    status              text not null check (status in ('awaiting_bill', 'bill_ready', 'paid', 'cancelled')),
    expires_at          timestamptz not null,
    payment_request_id  uuid,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    paid_at             timestamptz
);
-- A customer has at most one open redemption per offer.
create unique index redemptions_one_open on redemptions (customer_id, offer_id) where status in ('awaiting_bill', 'bill_ready');
create index redemptions_business_idx on redemptions (business_id, status, created_at desc);
create index redemptions_customer_idx on redemptions (customer_id, created_at desc);

create table payment_requests (
    id               uuid primary key,
    kind             text not null check (kind in ('redemption')),
    redemption_id    uuid references redemptions (id),
    business_id      uuid not null references businesses (id),
    customer_id      uuid not null references customers (id),
    bill_ref         text not null,
    raised_by        text not null,
    raised_at        timestamptz not null default now(),
    eligible_amount  bigint not null check (eligible_amount > 0),
    discount         bigint not null check (discount >= 0),
    discount_label   text not null default '',
    taxes            bigint check (taxes is null or taxes >= 0),
    vibe_fee         bigint not null default 0 check (vibe_fee >= 0),
    payable          bigint not null check (payable >= 0),
    expires_at       timestamptz not null,
    -- open: can be paid. paid: settled. void: withdrawn by the merchant.
    status           text not null default 'open' check (status in ('open', 'paid', 'void')),
    created_at       timestamptz not null default now(),
    check (discount <= eligible_amount),
    check (payable = eligible_amount - discount + vibe_fee)
);
create index payment_requests_customer_idx on payment_requests (customer_id, created_at desc);

create table payment_request_lines (
    payment_request_id  uuid not null references payment_requests (id) on delete cascade,
    position            int not null,
    label               text not null,
    amount              bigint not null check (amount > 0),
    primary key (payment_request_id, position)
);

create table payments (
    id                   uuid primary key,
    reference            text not null unique,
    payment_request_id   uuid not null references payment_requests (id),
    customer_id          uuid not null references customers (id),
    method               text not null check (method in ('upi', 'card', 'netbanking')),
    status               text not null default 'pending' check (status in ('pending', 'verified', 'failed')),
    amount               bigint not null check (amount >= 0),
    savings              bigint not null default 0,
    provider             text not null,
    provider_order_id    text not null unique,
    provider_payment_id  text,
    idempotency_key      text not null unique,
    failure_reason       text,
    created_at           timestamptz not null default now(),
    verified_at          timestamptz
);
-- A bill is paid once: only one payment can be in flight or settled for it. A failed one can be retried.
create unique index payments_one_live on payments (payment_request_id) where status in ('pending', 'verified');

-- Every webhook the payment partner sends, kept as the audit trail. Delivery can repeat, so the provider's event id is unique.
create table provider_events (
    id            bigserial primary key,
    provider      text not null,
    event_id      text not null,
    payload       text not null,
    received_at   timestamptz not null default now(),
    unique (provider, event_id)
);

create table savings_events (
    id           uuid primary key,
    customer_id  uuid not null references customers (id),
    business_id  uuid not null references businesses (id),
    payment_id   uuid not null references payments (id),
    paid         bigint not null,
    saved        bigint not null,
    at           timestamptz not null default now()
);
create index savings_events_customer_idx on savings_events (customer_id, at desc);

create table notifications (
    id           uuid primary key,
    customer_id  uuid not null references customers (id) on delete cascade,
    kind         text not null,
    title        text not null,
    body         text not null,
    target_type  text,
    target_id    text,
    created_at   timestamptz not null default now(),
    read_at      timestamptz
);
create index notifications_customer_idx on notifications (customer_id, created_at desc);
