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
export type ReviewStatus = 'pending' | 'approved' | 'rejected';

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
  reviewStatus: ReviewStatus;
  reviewNote: string | null;
};
export type OfferInput = Omit<OfferRow, 'id' | 'reviewStatus' | 'reviewNote'>;

export type AuditEntry = { id: number; at: string; actorId: string | null; actorRole: string; action: string; entity: string; entityId: string; detail: string };

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** The customer app's built-in icon names, for categories that don't have an uploaded icon. */
export const BUILT_IN_ICONS = [
  'food', 'shopping', 'fitness', 'beauty', 'kids', 'film', 'ticket', 'calendar', 'social', 'offer', 'sparkle', 'star', 'heart', 'wallet', 'map', 'pin',
] as const;

// ---------- admin: offer review ----------
export type ReviewOffer = {
  id: string; businessId: string; businessName: string; title: string; kind: OfferKind; rateBps: number | null; flatAmount: number | null; maxDiscount: number | null; minBill: number | null;
  memberOnly: boolean; startsAt: string; endsAt: string; active: boolean; reviewStatus: ReviewStatus; reviewNote: string | null; reviewedAt: string | null;
};

// ---------- membership plans ----------
export type Plan = { id: string; name: string; interval: 'month' | 'year'; price: number; note: string; savingsLabel: string | null; benefits: string[]; sortOrder: number; active: boolean };
export type PlanInput = Omit<Plan, 'id'>;

// ---------- checkout coupons ----------
export type CouponKind = 'tickets' | 'movie';
export type Coupon = {
  id: string; code: string; title: string; description: string; memberOnly: boolean; kinds: CouponKind[]; kind: OfferKind; rateBps: number | null; flatAmount: number | null; maxDiscount: number | null;
  minBill: number | null; firstBookingOnly: boolean; maxUsesPerUser: number | null; terms: string[]; startsAt: string; endsAt: string; active: boolean;
};
export type CouponInput = Omit<Coupon, 'id'>;

// ---------- home content ----------
export type BannerTarget = 'offer' | 'events' | 'category';
export type BannerRow = {
  id: string; eyebrow: string; title: string; subtitle: string; cta: string; imageUrl: string | null; targetType: BannerTarget; targetId: string | null; sortOrder: number; active: boolean;
  startsAt: string | null; endsAt: string | null; liveNow: boolean;
};
export type BannerInput = Omit<BannerRow, 'id' | 'liveNow'>;
export type Pick = { id: string; label: string; sub: string };
export type PickSection = 'trending' | 'offers' | 'events';

// ---------- events ----------
export const EVENT_KINDS = ['Workshops', 'Meetups', 'Tours', 'Live Events', 'Experiences', 'Movies'] as const;
export type EventStatus = 'pending' | 'published' | 'rejected' | 'cancelled';
export type TicketTypeRow = { id?: string; name: string; description: string; price: number; capacity: number; maxPerOrder: number };
export type EventRow = {
  id: string; businessId: string | null; businessName: string | null; organiser: string; title: string; kind: string; description: string; venue: string; area: string; startsAt: string;
  gatesOpenAt: string; coverUrl: string | null; ageLimit: number | null; featured: boolean; terms: string[]; status: EventStatus; reviewNote: string | null; ticketTypes: TicketTypeRow[];
};
export type EventListRow = { id: string; title: string; kind: string; organiser: string; venue: string; startsAt: string; status: EventStatus; fromPrice: number; capacity: number };
export type EventInput = {
  title: string; kind: string; description: string; venue: string; area: string; startsAt: string; gatesOpenAt: string | null; coverUrl: string | null; ageLimit: number | null; terms: string[];
  organiser?: string | null; featured?: boolean; ticketTypes: Omit<TicketTypeRow, 'id'>[];
};

// ---------- reservation settings ----------
export type ReservationSettings = { enabled: boolean; tableFee: number | null; slotFee: number | null; policy: string };
