-- Every business gets its own Merchant ID, like a customer's VIBE ID: VM- and 6 digits, given in the order businesses joined and never reused.
-- Payments, settlements and reports already point at the business; the Merchant ID is how people read and search them.
create sequence merchant_id_seq start 100001;

alter table businesses add column merchant_id text;

with ordered as (select id, row_number() over (order by created_at, name, id) n from businesses)
update businesses b set merchant_id = 'VM-' || (100000 + o.n) from ordered o where o.id = b.id;

select setval('merchant_id_seq', 100000 + (select count(*) from businesses) + 1, false);

alter table businesses alter column merchant_id set default 'VM-' || nextval('merchant_id_seq');
alter table businesses alter column merchant_id set not null;
alter table businesses add constraint businesses_merchant_id_key unique (merchant_id);
alter table businesses add constraint businesses_merchant_id_format check (merchant_id ~ '^VM-[0-9]{6,}$');
