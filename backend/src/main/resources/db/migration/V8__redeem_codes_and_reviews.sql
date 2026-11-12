-- Two ways to redeem an offer:
--   bill: the merchant sends the bill to the app and the customer pays through VIBE (settled later), as before.
--   code: the customer shows a 6-digit code (valid 5 minutes), pays the place directly, and staff confirm it on their dashboard.
alter table redemptions drop constraint redemptions_status_check;
alter table redemptions add constraint redemptions_status_check check (status in ('awaiting_bill', 'bill_ready', 'paid', 'cancelled', 'code_issued', 'redeemed'));
alter table redemptions
    add column mode           text not null default 'bill' check (mode in ('bill', 'code')),
    add column code           text check (code is null or code ~ '^[0-9]{6}$'),
    add column redeemed_at    timestamptz,
    add column redeemed_by    uuid references staff_users (id),
    -- What staff typed as the bill when confirming a code (optional), and the discount VIBE worked out for it. No money moves through VIBE.
    add column bill_amount    bigint check (bill_amount is null or bill_amount > 0),
    add column discount_given bigint check (discount_given is null or discount_given >= 0);
alter table redemptions add constraint redemptions_code_shape check ((mode = 'code') = (code is not null));
-- A live code is unique at its place, so staff typing it find exactly one customer.
create unique index redemptions_live_code on redemptions (business_id, code) where status = 'code_issued';

-- Some places don't take payment through VIBE yet: their customers can only use a code.
alter table businesses add column accepts_vibe_payments boolean not null default true;

-- A customer's rating of a visit. One per redemption (code confirmed or bill paid), so every review is from a real visit.
create table reviews (
    id             uuid primary key,
    customer_id    uuid not null references customers (id),
    business_id    uuid not null references businesses (id),
    redemption_id  uuid not null unique references redemptions (id),
    rating         smallint not null check (rating between 1 and 5),
    comment        text not null default '' check (length(comment) <= 500),
    hidden         boolean not null default false,
    hidden_reason  text,
    created_at     timestamptz not null default now()
);
create index reviews_business_idx on reviews (business_id, created_at desc);
