-- Model A: customers pay through the payment gateway, the gateway pays the day's total (less its charges) into VIBE's escrow bank account, and
-- VIBE pays each business its share from that account. Three checks keep it honest:
--   1. every customer payment is in a gateway payout (gateway_settlement_items),
--   2. every gateway payout arrived in the escrow account (bank_lines matched to gateway_settlements),
--   3. every payout VIBE marked as paid to a business left the escrow account (bank_lines matched to settlements).

-- What the gateway paid VIBE: one row per gateway payout (its own id and the bank UTR), with what it covered and what it kept.
create table gateway_settlements (
    id                      uuid primary key,
    provider_settlement_id  text not null unique,
    utr                     text,
    settled_on              date,
    payments_amount         bigint not null,
    refunds_amount          bigint not null default 0,
    fees                    bigint not null default 0,
    tax                     bigint not null default 0,
    net                     bigint not null,
    line_count              int not null,
    problems                int not null default 0,
    file_name               text not null,
    imported_by             uuid,
    imported_at             timestamptz not null default now(),
    -- Check 2: the escrow bank credit this payout matched.
    status                  text not null default 'awaiting_bank' check (status in ('awaiting_bank', 'matched', 'amount_mismatch')),
    bank_line_id            uuid
);
create index gateway_settlements_status_idx on gateway_settlements (status, settled_on);

-- Each line of a gateway payout: a payment it collected or a refund it sent back, matched to VIBE's payment.
create table gateway_settlement_items (
    settlement_id  uuid not null references gateway_settlements (id) on delete cascade,
    line_no        int not null,
    type           text not null check (type in ('payment', 'refund', 'adjustment')),
    key            text not null,
    payment_id     uuid references payments (id),
    amount         bigint not null,
    fee            bigint not null default 0,
    tax            bigint not null default 0,
    result         text not null check (result in ('matched', 'amount_mismatch', 'status_mismatch', 'unknown', 'duplicate')),
    primary key (settlement_id, line_no)
);

-- Check 1: the gateway payout that covered each customer payment. A payment can be in only one.
alter table payments add column gateway_settlement_id uuid references gateway_settlements (id);

-- VIBE's escrow bank account statements, uploaded by finance.
create table bank_statements (
    id               uuid primary key,
    file_name        text not null,
    period_from      date,
    period_to        date,
    closing_balance  bigint,
    line_count       int not null,
    new_lines        int not null,
    matched          int not null,
    unmatched        int not null,
    imported_by      uuid,
    imported_at      timestamptz not null default now()
);

-- Every line of every statement. The same bank line uploaded twice (overlapping statements) is kept once.
create table bank_lines (
    id                     uuid primary key,
    statement_id           uuid not null references bank_statements (id) on delete cascade,
    line_no                int not null,
    value_date             date not null,
    narration              text not null default '',
    reference              text not null default '',
    credit                 bigint not null default 0,
    debit                  bigint not null default 0,
    balance                bigint,
    result                 text not null check (result in ('gateway_payout', 'merchant_payout', 'amount_mismatch', 'unknown', 'explained')),
    gateway_settlement_id  uuid references gateway_settlements (id),
    settlement_id          uuid references settlements (id),
    note                   text,
    explained_by           uuid,
    explained_at           timestamptz,
    check ((credit > 0) <> (debit > 0))
);
create unique index bank_lines_once on bank_lines (value_date, reference, credit, debit, narration);
create index bank_lines_result_idx on bank_lines (result, value_date);

-- Check 3: the escrow bank debit that carried each payout to a business.
alter table settlements add column bank_line_id uuid references bank_lines (id);
