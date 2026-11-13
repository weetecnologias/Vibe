-- 1. The merchant agreement: VIBE publishes versions of its terms. A business accepts the current version (an applicant when applying, or the owner
--    on first sign-in), and the acceptance is kept with who, when and from where. Publishing a new version asks every business to accept it again.
create table agreement_versions (
    id           uuid primary key,
    version      int not null unique,
    title        text not null check (length(title) between 3 and 120),
    body         text not null check (length(body) between 20 and 50000),
    published_at timestamptz not null default now(),
    published_by uuid
);
create table agreement_acceptances (
    id          uuid primary key,
    version_id  uuid not null references agreement_versions (id),
    business_id uuid not null references businesses (id),
    staff_id    uuid references staff_users (id),
    accepted_at timestamptz not null default now(),
    ip          text,
    source      text not null default 'dashboard' check (source in ('application', 'dashboard'))
);
create unique index agreement_acceptances_once on agreement_acceptances (version_id, business_id);
create index agreement_acceptances_business_idx on agreement_acceptances (business_id, accepted_at desc);
-- What an applicant accepted when applying, carried to the business when it is approved.
alter table merchant_applications
    add column terms_version_id uuid references agreement_versions (id),
    add column terms_accepted_at timestamptz,
    add column terms_accepted_ip text;

-- 2. KYC: who the business legally is and where VIBE pays it. VIBE checks the details automatically (formats, the GSTIN's own check digit,
--    the PAN inside the GSTIN) and a person approves. A business can't be paid out until it is verified; changing the details sends it back.
create table business_kyc (
    business_id       uuid primary key references businesses (id) on delete cascade,
    legal_name        text not null,
    pan               text not null,
    gstin             text,
    fssai             text,
    bank_account_name text not null,
    bank_account_no   text not null,
    bank_ifsc         text not null,
    bank_name         text,
    documents         text[] not null default '{}',
    status            text not null default 'submitted' check (status in ('submitted', 'verified', 'rejected')),
    review_note       text,
    submitted_at      timestamptz not null default now(),
    submitted_by      uuid,
    reviewed_at       timestamptz,
    reviewed_by       uuid
);
create index business_kyc_status_idx on business_kyc (status, submitted_at);

-- 3. Disputes: a customer reports a problem with a payment. VIBE resolves it with a refund (full or part, and who bears it) or declines with a reason.
create table disputes (
    id              uuid primary key,
    reference       text not null unique,
    payment_id      uuid not null references payments (id),
    customer_id     uuid not null references customers (id),
    business_id     uuid references businesses (id),
    reason          text not null check (reason in ('not_received', 'wrong_amount', 'charged_twice', 'poor_service', 'other')),
    details         text not null default '' check (length(details) <= 1000),
    status          text not null default 'open' check (status in ('open', 'refund', 'rejected')),
    resolution_note text,
    refund_amount   bigint,
    resolved_by     uuid,
    resolved_at     timestamptz,
    due_by          timestamptz not null,
    created_at      timestamptz not null default now()
);
create unique index disputes_one_open on disputes (payment_id) where status = 'open';
create index disputes_status_idx on disputes (status, due_by);

-- 4. Reconciliation: the payment partner's settlement file is matched to VIBE's payments, and every difference is kept.
create table reconciliation_runs (
    id                 uuid primary key,
    file_name          text not null,
    period_from        date,
    period_to          date,
    uploaded_by        uuid,
    uploaded_at        timestamptz not null default now(),
    partner_rows       int not null,
    matched            int not null,
    mismatched         int not null,
    missing_in_vibe    int not null,
    missing_at_partner int not null,
    partner_amount     bigint not null,
    vibe_amount        bigint not null
);
create table reconciliation_items (
    run_id            uuid not null references reconciliation_runs (id) on delete cascade,
    line_no           int not null,
    key               text not null,
    result            text not null check (result in ('matched', 'amount_mismatch', 'status_mismatch', 'missing_in_vibe', 'missing_at_partner')),
    partner_amount    bigint,
    vibe_amount       bigint,
    partner_status    text,
    payment_reference text,
    primary key (run_id, line_no)
);
