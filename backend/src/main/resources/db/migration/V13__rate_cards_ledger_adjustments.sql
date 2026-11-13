-- 1. Rate cards: VIBE's commission can be set for the whole platform, for a category (and everything under it), or for one business, and keeps its
--    history. The rate that applies to a payment is the business's own card, else the nearest category card up the tree, else the platform card,
--    as of when the payment was confirmed. Each payment keeps the rate it was charged, so changing a rate never rewrites the past.
create table rate_cards (
    id             uuid primary key,
    category_id    uuid references categories (id),
    business_id    uuid references businesses (id),
    commission_bps int not null check (commission_bps between 0 and 5000),
    effective_from timestamptz not null default now(),
    reason         text not null default '',
    created_by     uuid,
    created_at     timestamptz not null default now(),
    check (category_id is null or business_id is null)
);
create index rate_cards_business_idx on rate_cards (business_id, effective_from desc) where business_id is not null;
create index rate_cards_category_idx on rate_cards (category_id, effective_from desc) where category_id is not null;
create index rate_cards_platform_idx on rate_cards (effective_from desc) where business_id is null and category_id is null;
-- A commission already agreed with a business becomes its own rate card, so nothing changes for it.
insert into rate_cards (id, business_id, commission_bps, effective_from, reason)
select gen_random_uuid(), id, commission_bps, '2000-01-01', 'Agreed before rate cards' from businesses where commission_bps > 0;

-- Platform-wide settings an admin can change (the GST rate on VIBE's commission).
create table platform_settings (
    key        text primary key,
    value      text not null,
    updated_at timestamptz not null default now(),
    updated_by uuid
);

-- 2. What each payment was charged, kept on the payment: the commission rate and amount, and GST on the commission. For refunds: who bears it
--    (the business or VIBE), how much comes off the business, and whether the whole sale is reversed (then it isn't settled at all).
alter table payments
    add column commission_bps int,
    add column commission bigint,
    add column gst_bps int,
    add column gst bigint,
    add column refund_bearer text check (refund_bearer in ('merchant', 'vibe')),
    add column refund_merchant_share bigint not null default 0,
    add column refund_full_reversal boolean not null default false;
update payments p set commission_bps = b.commission_bps, commission = ((p.amount + pr.vibe_funded - pr.vibe_fee) * b.commission_bps) / 10000, gst_bps = 0, gst = 0
from payment_requests pr join businesses b on b.id = pr.business_id
where pr.id = p.payment_request_id and p.status = 'verified' and pr.business_id is not null;
update payments set refund_bearer = 'merchant', refund_full_reversal = true where refund_status is not null;

-- 3. Settlements carry the GST, refund deductions and adjustments, and the payout adds up from them.
do $$
declare r record;
begin
    for r in select conname from pg_constraint where conrelid = 'settlements'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%gross%' loop
        execute format('alter table settlements drop constraint %I', r.conname);
    end loop;
    for r in select conname from pg_constraint where conrelid = 'settlement_items'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%amount%' loop
        execute format('alter table settlement_items drop constraint %I', r.conname);
    end loop;
end $$;
alter table settlements
    add column gst bigint not null default 0,
    add column refund_deductions bigint not null default 0,
    add column adjustments bigint not null default 0,
    add constraint settlements_payout_adds_up check (payout = gross - vibe_fees - commission - gst - refund_deductions + adjustments);
alter table settlement_items
    add column gst bigint not null default 0,
    add column refund_share bigint not null default 0,
    add constraint settlement_items_payout_adds_up check (payout = amount - vibe_fee - commission - gst - refund_share);

-- Manual adjustments to what a business is owed: a credit (VIBE owes more), or a recovery or penalty (VIBE takes back), each with a reason.
-- They are included in the business's next settlement.
create table settlement_adjustments (
    id            uuid primary key,
    business_id   uuid not null references businesses (id),
    kind          text not null check (kind in ('credit', 'recovery', 'penalty', 'correction')),
    amount        bigint not null check (amount <> 0),
    reason        text not null check (length(reason) between 3 and 300),
    created_by    uuid,
    created_at    timestamptz not null default now(),
    settlement_id uuid references settlements (id),
    check ((kind = 'credit' and amount > 0) or (kind in ('recovery', 'penalty') and amount < 0) or kind = 'correction')
);
create index settlement_adjustments_open_idx on settlement_adjustments (business_id) where settlement_id is null;

-- 4. The ledger: every movement of money is a set of debit and credit lines that add up to nothing, so what VIBE holds, owes and has earned
--    can be proven at any time (admin → Ledger shows the trial balance).
create table ledger_entries (
    id        bigserial primary key,
    txn_id    uuid not null,
    txn_type  text not null,
    at        timestamptz not null default now(),
    account   text not null,
    debit     bigint not null default 0 check (debit >= 0),
    credit    bigint not null default 0 check (credit >= 0),
    ref_type  text,
    ref_id    text,
    memo      text,
    check ((debit = 0) <> (credit = 0))
);
create index ledger_txn_idx on ledger_entries (txn_id);
create index ledger_account_idx on ledger_entries (account, at desc);
create index ledger_ref_idx on ledger_entries (ref_type, ref_id);
