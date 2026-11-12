-- Promotions: a business promotes itself in the customer app's Discover tab (a headline, a short message, a photo, and where a tap goes:
-- the business page or one of its live offers). VIBE reviews each one before customers see it, like offers; trusted businesses
-- (businesses.auto_approve) go live straight away.
create table promotions (
    id             uuid primary key,
    business_id    uuid not null references businesses (id) on delete cascade,
    title          text not null check (length(title) between 3 and 80),
    message        text not null default '' check (length(message) <= 240),
    image_url      text check (image_url is null or length(image_url) <= 1000),
    offer_id       uuid references offers (id) on delete set null,
    starts_at      timestamptz not null,
    ends_at        timestamptz not null,
    active         boolean not null default true,
    review_status  text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
    auto_approved  boolean not null default false,
    review_note    text,
    reviewed_at    timestamptz,
    reviewed_by    uuid,
    taps           int not null default 0,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    check (ends_at > starts_at)
);
create index promotions_live_idx on promotions (review_status, active, ends_at);
create index promotions_business_idx on promotions (business_id, created_at desc);
