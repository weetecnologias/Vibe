-- P1: staff notifications, category billing rules, membership purchase, merchant onboarding with approval.

-- ---- Notifications for merchant staff and VIBE admins ----
-- A merchant's notifications are shared by everyone on that business's team (one person reading it marks it read).
create table staff_notifications (
    id           uuid primary key,
    audience     text not null check (audience in ('merchant', 'admin')),
    business_id  uuid references businesses (id) on delete cascade,
    kind         text not null,
    title        text not null,
    body         text not null default '',
    link         text,
    created_at   timestamptz not null default now(),
    read_at      timestamptz,
    check ((audience = 'merchant' and business_id is not null) or (audience = 'admin' and business_id is null))
);
create index staff_notifications_business_idx on staff_notifications (business_id, created_at desc);
create index staff_notifications_admin_idx on staff_notifications (audience, created_at desc);

-- ---- Category rules: does Pay & Redeem (a bill) apply, and what is the item list called ----
alter table categories
    add column pay_redeem boolean not null default true,
    add column menu_label text;

-- ---- Membership purchase ----
alter table memberships
    add column member_no     text,
    add column started_at    timestamptz not null default now(),
    add column auto_renew    boolean not null default false,
    add column cancelled_at  timestamptz;
update memberships m set member_no = 'VB ' || (select c.vibe_id from customers c where c.id = m.customer_id) || ' ' || lpad((floor(random() * 10000))::int::text, 4, '0') where member_no is null;

-- A membership payment has no business behind it.
alter table payment_requests drop constraint payment_requests_kind_check;
alter table payment_requests add constraint payment_requests_kind_check check (kind in ('redemption', 'membership'));
alter table payment_requests alter column business_id drop not null;
alter table payment_requests add column plan_id uuid references membership_plans (id);
alter table payment_requests add constraint payment_requests_shape check (
    (kind = 'redemption' and business_id is not null and plan_id is null) or (kind = 'membership' and plan_id is not null and business_id is null));

create table membership_payments (
    id            uuid primary key,
    customer_id   uuid not null references customers (id),
    plan_id       uuid not null references membership_plans (id),
    payment_id    uuid references payments (id),
    amount        bigint not null,
    period_start  timestamptz not null,
    period_end    timestamptz not null,
    -- paid: a customer's purchase. granted: given by VIBE staff (a trial or goodwill), with the reason recorded.
    source        text not null check (source in ('paid', 'granted')),
    note          text,
    created_at    timestamptz not null default now()
);
create index membership_payments_customer_idx on membership_payments (customer_id, created_at desc);

-- ---- Merchant onboarding ----
alter table staff_users add column must_change_password boolean not null default false;

create table merchant_applications (
    id               uuid primary key,
    business_name    text not null,
    category_id      uuid references categories (id),
    area             text not null,
    address          text not null default '',
    contact_name     text not null,
    email            text not null,
    phone            text not null,
    about            text not null default '',
    -- Links to uploaded documents (for example a GST or FSSAI certificate). What VIBE must collect is a business and legal decision.
    documents        text[] not null default '{}',
    status           text not null default 'pending' check (status in ('pending', 'changes_requested', 'approved', 'rejected')),
    review_note      text,
    decided_at       timestamptz,
    decided_by       uuid,
    business_id      uuid references businesses (id),
    -- The applicant checks their status with this secret; only its hash is stored.
    token_hash       text not null unique,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);
create index merchant_applications_status_idx on merchant_applications (status, created_at);
