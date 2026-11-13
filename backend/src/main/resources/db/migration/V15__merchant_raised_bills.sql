-- A business can raise a bill for a customer without the customer asking first: they enter the customer's VIBE ID, add the menu items and send it.
-- Such a bill may have no offer (a customer who just wants to pay through VIBE), so a redemption's offer becomes optional.
alter table redemptions alter column offer_id drop not null;
alter table redemptions add column initiated_by text not null default 'customer' check (initiated_by in ('customer', 'merchant'));
-- One open bill without an offer per customer per business (offers already have their own one-open rule).
create unique index redemptions_one_open_plain on redemptions (customer_id, business_id) where offer_id is null and status in ('awaiting_bill', 'bill_ready');
