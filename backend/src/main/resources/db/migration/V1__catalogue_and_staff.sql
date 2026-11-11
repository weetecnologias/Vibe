-- B0/B1: staff accounts (admin and merchant dashboards), catalogue, menus, offers, audit trail.
-- Money is bigint paise. All timestamps are UTC (timestamptz).

create table categories (
    id          uuid primary key,
    parent_id   uuid references categories (id),
    slug        text not null unique,
    name        text not null,
    -- One of the customer app's built-in icon names, or an uploaded icon (icon_url wins when set).
    icon        text,
    icon_url    text,
    image_url   text,
    sort_order  int not null default 0,
    active      boolean not null default true,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index categories_parent_idx on categories (parent_id);

create table businesses (
    id                   uuid primary key,
    name                 text not null,
    primary_category_id  uuid not null references categories (id),
    area                 text not null,
    address              text not null default '',
    lat                  double precision,
    lng                  double precision,
    description          text not null default '',
    logo_url             text,
    cover_url            text,
    price_level          smallint not null default 2 check (price_level between 1 and 4),
    cost_for_two         bigint check (cost_for_two is null or cost_for_two >= 0),
    verified             boolean not null default false,
    is_new               boolean not null default false,
    booking_enabled      boolean not null default false,
    terms                text[] not null default '{}',
    active               boolean not null default true,
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now()
);
create index businesses_primary_category_idx on businesses (primary_category_id);
create index businesses_name_idx on businesses (lower(name));

create table business_categories (
    business_id  uuid not null references businesses (id) on delete cascade,
    category_id  uuid not null references categories (id),
    primary key (business_id, category_id)
);

create table business_photos (
    id           uuid primary key,
    business_id  uuid not null references businesses (id) on delete cascade,
    url          text not null,
    sort_order   int not null default 0
);
create index business_photos_business_idx on business_photos (business_id, sort_order);

-- dow: 0 = Monday .. 6 = Sunday. A day without a row, or with null times, is closed.
create table business_hours (
    business_id  uuid not null references businesses (id) on delete cascade,
    dow          smallint not null check (dow between 0 and 6),
    opens        time,
    closes       time,
    primary key (business_id, dow)
);

create table menu_items (
    id           uuid primary key,
    business_id  uuid not null references businesses (id) on delete cascade,
    name         text not null,
    note         text not null default '',
    price        bigint not null check (price >= 0),
    section      text,
    image_url    text,
    sort_order   int not null default 0,
    active       boolean not null default true
);
create index menu_items_business_idx on menu_items (business_id, sort_order);

create table offers (
    id              uuid primary key,
    business_id     uuid not null references businesses (id) on delete cascade,
    title           text not null,
    kind            text not null check (kind in ('percentage', 'flat')),
    rate_bps        int check (rate_bps is null or rate_bps between 1 and 10000),
    flat_amount     bigint check (flat_amount is null or flat_amount > 0),
    max_discount    bigint check (max_discount is null or max_discount > 0),
    min_bill        bigint check (min_bill is null or min_bill >= 0),
    member_only     boolean not null default false,
    schedule_label  text not null default 'Every day',
    starts_at       timestamptz not null,
    ends_at         timestamptz not null,
    active          boolean not null default true,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    check (ends_at > starts_at),
    check ((kind = 'percentage' and rate_bps is not null and flat_amount is null)
        or (kind = 'flat' and flat_amount is not null and rate_bps is null))
);
create index offers_business_idx on offers (business_id);

create table staff_users (
    id             uuid primary key,
    email          text not null unique,
    name           text not null,
    password_hash  text not null,
    role           text not null check (role in ('ADMIN', 'MERCHANT')),
    -- A merchant sees and edits only this business. Admins have none.
    business_id    uuid references businesses (id),
    active         boolean not null default true,
    created_at     timestamptz not null default now(),
    check ((role = 'MERCHANT' and business_id is not null) or (role = 'ADMIN' and business_id is null))
);

create table audit_log (
    id          bigserial primary key,
    at          timestamptz not null default now(),
    actor_id    uuid,
    actor_role  text not null,
    action      text not null,
    entity      text not null,
    entity_id   text not null,
    detail      text not null default ''
);
create index audit_log_entity_idx on audit_log (entity, entity_id);
create index audit_log_at_idx on audit_log (at desc);
