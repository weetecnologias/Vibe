-- VIBE's checkout coupons and member offers can apply to a bill at a restaurant, salon or shop too ("bill"), not only to tickets, bookings and memberships.
alter table checkout_coupons drop constraint checkout_coupons_kinds_check;
alter table checkout_coupons add constraint checkout_coupons_kinds_check check (kinds <@ array['tickets', 'movie', 'slots', 'pass', 'bill'] and cardinality(kinds) > 0);
