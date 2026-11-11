/** Shapes the admin and merchant APIs return and accept. Mirrors the backend records. */
export type Hour = { dow: number; opens: string | null; closes: string | null };

export type Profile = {
  name: string;
  area: string;
  address: string;
  lat: number | null;
  lng: number | null;
  description: string;
  logoUrl: string | null;
  coverUrl: string | null;
  priceLevel: number;
  costForTwo: number | null;
  terms: string[];
  bookingEnabled: boolean;
  photos: string[];
  hours: Hour[];
};

export type Editable = Profile & {
  id: string;
  primaryCategoryId: string;
  categoryIds: string[];
  verified: boolean;
  isNew: boolean;
  active: boolean;
};

export type AdminInput = { primaryCategoryId: string; categoryIds: string[]; verified: boolean; isNew: boolean; active: boolean; profile: Profile };

export type CategoryRow = {
  id: string;
  parentId: string | null;
  level: number;
  slug: string;
  name: string;
  icon: string | null;
  iconUrl: string | null;
  imageUrl: string | null;
  sortOrder: number;
  active: boolean;
  businessCount: number;
};

export type CategoryInput = {
  parentId: string | null;
  slug: string;
  name: string;
  icon: string | null;
  iconUrl: string | null;
  imageUrl: string | null;
  sortOrder: number;
  active: boolean;
};

export type BusinessListRow = { id: string; name: string; primaryCategoryId: string; categoryName: string; area: string; verified: boolean; active: boolean; merchantAccounts: number };
export type BusinessList = { items: BusinessListRow[]; total: number };

export type MenuRow = { id: string; name: string; note: string; price: number; section: string | null; imageUrl: string | null; sortOrder: number; active: boolean };
export type MenuInput = { name: string; note: string; price: number; section: string | null; imageUrl: string | null; sortOrder: number; active: boolean };

export type OfferKind = 'percentage' | 'flat';
export type OfferRow = {
  id: string;
  title: string;
  kind: OfferKind;
  rateBps: number | null;
  flatAmount: number | null;
  maxDiscount: number | null;
  minBill: number | null;
  memberOnly: boolean;
  scheduleLabel: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
};
export type OfferInput = Omit<OfferRow, 'id'>;

export type AuditEntry = { id: number; at: string; actorId: string | null; actorRole: string; action: string; entity: string; entityId: string; detail: string };

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** The customer app's built-in icon names, for categories that don't have an uploaded icon. */
export const BUILT_IN_ICONS = [
  'food', 'shopping', 'fitness', 'beauty', 'kids', 'film', 'ticket', 'calendar', 'social', 'offer', 'sparkle', 'star', 'heart', 'wallet', 'map', 'pin',
] as const;
