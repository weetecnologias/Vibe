-- What each member of a merchant's team may do. The owner can do everything and is not limited by this.
-- staff_role is the preset the owner picked: manager (everything except the team), cashier (bills only), or custom (the areas ticked).
alter table staff_users
    add column staff_role text check (staff_role in ('manager', 'cashier', 'custom')),
    add column permissions text[] not null default '{}';

-- Staff added before roles existed could do everything except manage the team. Keep that, as managers.
update staff_users set staff_role = 'manager', permissions = '{bills,offers,events,menu,profile,reservations,money}'
where role = 'MERCHANT' and not owner;
