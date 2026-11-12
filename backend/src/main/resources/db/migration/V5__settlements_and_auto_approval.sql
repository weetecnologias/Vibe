-- Commercial terms per business: VIBE's commission on what customers pay there, and whether its offers and events go live without review.
alter table businesses
    add column commission_bps int not null default 0 check (commission_bps between 0 and 5000),
    add column auto_approve boolean not null default false;

-- So the admin can see which items went live on trust rather than after a review.
alter table offers add column auto_approved boolean not null default false;
alter table events add column auto_approved boolean not null default false;

-- A settlement is one payout to one business: every confirmed payment at that business up to a date, which no earlier settlement included.
create table settlements (
    id                uuid primary key,
    reference         text not null unique,
    business_id       uuid not null references businesses (id),
    period_from       timestamptz not null,
    period_to         timestamptz not null,
    payment_count     int not null check (payment_count > 0),
    gross             bigint not null check (gross >= 0),
    vibe_fees         bigint not null check (vibe_fees >= 0),
    commission_bps    int not null,
    commission        bigint not null check (commission >= 0),
    payout            bigint not null check (payout >= 0),
    customer_savings  bigint not null default 0,
    status            text not null default 'pending' check (status in ('pending', 'paid')),
    created_by        uuid references staff_users (id),
    created_at        timestamptz not null default now(),
    paid_at           timestamptz,
    paid_by           uuid references staff_users (id),
    payout_ref        text,
    note              text,
    check (payout = gross - vibe_fees - commission),
    check ((status = 'paid') = (paid_at is not null and payout_ref is not null))
);
create index settlements_business_idx on settlements (business_id, created_at desc);
create index settlements_status_idx on settlements (status, created_at desc);

-- A payment can be in one settlement only, ever.
create table settlement_items (
    settlement_id  uuid not null references settlements (id) on delete cascade,
    payment_id     uuid not null unique references payments (id),
    amount         bigint not null,
    vibe_fee       bigint not null,
    commission     bigint not null,
    payout         bigint not null,
    primary key (settlement_id, payment_id),
    check (payout = amount - vibe_fee - commission)
);
