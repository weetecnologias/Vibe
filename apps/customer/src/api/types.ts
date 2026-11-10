/**
 * Domain types shared by the customer app and (later) the backend API contract.
 * Money is always integer paise (₹1 = 100 paise) — never floating rupees.
 * Dates are ISO-8601 strings in UTC.
 */
export type ID = string;
export type Paise = number;
export type ISODate = string;

// ---------- Auth & user ----------
export type OtpChallenge = { requestId: ID; maskedPhone: string; expiresInSec: number; resendInSec: number; attemptsLeft: number };
export type AuthResult = { accessToken: string; refreshToken: string; user: User; isNewUser: boolean };
export type User = { id: ID; name: string; phoneMasked: string; vibeId: string; area: string | null; isMember: boolean };

// ---------- Categories (admin-managed, 3 levels) ----------
export type CategoryNode = { id: ID; slug: string; name: string; icon?: string; imageUrl?: string | null; children: CategoryNode[] };

// ---------- Businesses ----------
export type OpenStatus = { open: boolean; label: string; tone: 'success' | 'warning' | 'muted' };

export type BusinessSummary = {
  id: ID;
  name: string;
  primaryCategoryId: ID;
  categoryIds: ID[];
  categoryLabel: string;
  area: string;
  distanceKm: number;
  rating: number;
  reviewCount: number;
  priceLevel: 1 | 2 | 3 | 4;
  costForTwo: Paise | null;
  status: OpenStatus;
  coverUrl: string | null;
  offerBadge: string | null;
  hasMemberOffer: boolean;
  isNew: boolean;
};

export type OpeningHours = { day: string; hours: string; today: boolean };
export type MenuItem = { id: ID; name: string; note: string; price: Paise; imageUrl?: string | null };
export type Branch = { id: ID; name: string; address: string; distanceKm: number; status: OpenStatus };
export type Review = { id: ID; authorName: string; rating: number; text: string; createdAt: ISODate; verifiedVisit: boolean };

export type BusinessDetail = BusinessSummary & {
  description: string;
  verified: boolean;
  categoryNames: { id: ID; name: string; primary: boolean }[];
  address: string;
  location: { lat: number; lng: number };
  hours: OpeningHours[];
  /** Gallery, first photo is the hero. */
  photos: string[];
  menu: MenuItem[];
  offers: OfferSummary[];
  branches: Branch[];
  reviews: Review[];
  terms: string[];
  bookingEnabled: boolean;
};

// ---------- Offers ----------
export type OfferType = 'percentage' | 'flat' | 'bogo' | 'free_addon';

export type OfferSummary = {
  id: ID;
  businessId: ID;
  businessName: string;
  area: string;
  title: string;
  type: OfferType;
  headline: string; // e.g. "30%"
  headlineSub: string; // e.g. "OFF"
  memberOnly: boolean;
  coverUrl: string | null;
  scheduleLabel: string;
  endsAt: ISODate;
  maxDiscount: Paise | null;
  minBill: Paise | null;
};

export type OfferDetail = OfferSummary & {
  appliesTo: string;
  excludes: string;
  channels: string[];
  terms: string[];
  /** Server-computed worked example for display only. */
  example: { bill: Paise; discount: Paise; payable: Paise } | null;
};

/** Matches the admin-managed "Offers & Benefits" subcategories. */
export type OfferView = 'all' | 'nearby' | 'trending' | 'new' | 'ending' | 'member';

export type OfferEligibility = { eligible: boolean; reason: string; redemptionsLeftToday: number | null; memberValidUntil: ISODate | null };

// ---------- Pay & Redeem ----------
export type BillLine = { label: string; amount: Paise };

/** A bill raised by the merchant, priced by the backend. The app never computes discounts itself. */
export type PaymentRequest = {
  id: ID;
  billRef: string;
  raisedBy: string;
  raisedAt: ISODate;
  lines: BillLine[];
  eligibleAmount: Paise;
  discount: Paise;
  discountLabel: string;
  taxes: Paise | null; // null = included in merchant bill
  vibeFee: Paise;
  payable: Paise;
  currency: 'INR';
  expiresAt: ISODate;
};

export type RedemptionStatus = 'awaiting_bill' | 'bill_ready' | 'paid' | 'expired' | 'cancelled';

export type Redemption = {
  id: ID;
  offerId: ID;
  businessName: string;
  branchName: string;
  customerDisplayName: string;
  vibeId: string;
  status: RedemptionStatus;
  expiresAt: ISODate;
  paymentRequest: PaymentRequest | null;
};

export type PaymentMethod = 'upi' | 'card' | 'netbanking';
export type PaymentStatus = 'created' | 'pending' | 'verified' | 'failed' | 'refunded';
export type PaymentKind = 'redemption' | 'tickets' | 'membership';

/**
 * How to collect money. `provider` = open the payment aggregator's checkout SDK.
 * `demo` exists only in the demo adapter and must never be returned in production.
 */
export type Checkout =
  | { mode: 'provider'; provider: string; orderId: string; publicKey: string }
  | { mode: 'demo' };

export type PaymentStart = { reference: string; checkout: Checkout };

export type Payment = {
  reference: string; // VIBE transaction reference
  kind: PaymentKind;
  status: PaymentStatus;
  method: PaymentMethod;
  amount: Paise;
  savings: Paise;
  payeeName: string;
  providerPaymentId: string | null;
  verifiedAt: ISODate | null;
  failureReason: string | null;
  lines: BillLine[];
  ticketIds: ID[];
};

// ---------- Events & tickets ----------
export type EventKind = 'Workshops' | 'Meetups' | 'Tours' | 'Live Events' | 'Experiences';

export type EventSummary = {
  id: ID;
  title: string;
  kind: EventKind;
  startsAt: ISODate;
  venue: string;
  area: string;
  fromPrice: Paise;
  coverUrl: string | null;
  tag: { label: string; tone: 'warning' | 'pinkSoft' | 'pink' | 'muted' | 'dark' } | null;
  soldOut: boolean;
  featured: boolean;
};

export type TicketType = { id: ID; name: string; description: string; price: Paise; remaining: number; maxPerOrder: number };

export type EventDetail = EventSummary & {
  description: string;
  gatesOpenAt: ISODate;
  organiser: string;
  ageLimit: number | null;
  ticketTypes: TicketType[];
  terms: string[];
};

export type ReservationItem = { ticketTypeId: ID; quantity: number };

/** Inventory is held server-side until `expiresAt`; unpaid holds are released. */
export type TicketReservation = {
  id: ID;
  eventId: ID;
  items: (ReservationItem & { name: string; unitPrice: Paise })[];
  attendees: string[];
  total: Paise;
  expiresAt: ISODate;
  paymentRequestId: ID;
};

export type TicketStatus = 'valid' | 'checked_in' | 'cancelled';

export type Ticket = {
  id: ID;
  bookingId: string;
  eventId: ID;
  eventTitle: string;
  eventKind: EventKind;
  startsAt: ISODate;
  gatesOpenAt: ISODate;
  venue: string;
  area: string;
  typeName: string;
  attendeeName: string;
  admissionCode: string;
  /** Opaque signed token encoded in the QR. Verified only by the backend at the gate. */
  qrToken: string;
  coverUrl: string | null;
  status: TicketStatus;
  index: number;
  of: number;
  paidTotal: Paise;
};

// ---------- Membership ----------
export type MembershipPlan = { id: ID; name: string; interval: 'month' | 'year'; price: Paise; note: string; savingsLabel: string | null };

export type Membership = {
  status: 'active' | 'none' | 'cancelled' | 'past_due';
  plan: MembershipPlan | null;
  memberNo: string | null;
  validUntil: ISODate | null;
  renewsAt: ISODate | null;
  autoRenew: boolean;
  savings: { total: Paise; thisMonth: Paise; redemptions: number; places: number; since: ISODate | null; byCategory: { name: string; amount: Paise }[] };
  recentSavings: { id: ID; businessName: string; at: ISODate; paid: Paise; saved: Paise }[];
  payments: { id: ID; at: ISODate; amount: Paise; status: 'paid' | 'failed' | 'refunded'; planName: string }[];
};

// ---------- Social ----------
export type JoinStatus = 'none' | 'requested' | 'joined';

export type SocialActivity = {
  id: ID;
  title: string;
  kind: string;
  startsAt: ISODate;
  place: string;
  area: string;
  price: Paise | null;
  hostName: string;
  hostId: ID;
  hostVerified: boolean;
  going: number;
  capacity: number;
  approvalRequired: boolean;
  ageRange: { min: number; max: number | null } | null;
  requiresIdVerification: boolean;
  featured: boolean;
  myStatus: JoinStatus;
  /** 'activity' = member-run meetups; 'social_event' = hosted, ticketed social events. */
  section: 'activity' | 'social_event';
  coverUrl: string | null;
};

export type SocialGroup = {
  id: ID; name: string; description: string; privacy: 'public' | 'private'; memberCount: number; myStatus: JoinStatus;
  /** 'group' = interest groups (running, cycling, reading); 'community' = larger communities (parents, founders, food). */
  kind: 'group' | 'community';
  coverUrl: string | null;
};

// ---------- Social: one-on-one meetups (18+) ----------
export type Gender = 'man' | 'woman' | 'nonbinary' | 'undisclosed';
/** Who someone is open to meeting one-on-one. */
export type MeetPreference = 'men' | 'women' | 'anyone';

/** The only personal details ever shown to other members. No phone, surname or exact age. */
export type SocialProfile = {
  firstName: string;
  gender: Gender;
  meetPreference: MeetPreference;
  /** Self-declared until an ID/KYC provider is connected. */
  ageConfirmed18: boolean;
  ageBand: string | null;
};
export type SocialProfileInput = Pick<SocialProfile, 'gender' | 'meetPreference' | 'ageConfirmed18' | 'ageBand'>;

/** What one member sees of another in one-on-one. */
export type MemberCard = { id: ID; firstName: string; ageBand: string | null; gender: Gender; verified: boolean };

export type OneOnOneKind = 'coffee' | 'sport' | 'food' | 'walk' | 'movie';
export type OneOnOneStatus = 'open' | 'matched' | 'cancelled';
/** My relationship to an invite. `host` = I posted it. */
export type OneOnOneMyStatus = 'none' | 'requested' | 'confirmed' | 'host';

export type OneOnOneInvite = {
  id: ID;
  kind: OneOnOneKind;
  /** e.g. "Coffee & conversation", "Shuttle badminton, singles". */
  activity: string;
  note: string;
  /** Always a public venue; ideally a VIBE partner business. */
  venueName: string;
  venueBusinessId: ID | null;
  area: string;
  startsAt: ISODate;
  durationMin: number;
  costNote: string;
  host: MemberCard;
  /** Who the host is open to meeting. Enforced by the backend, not just hidden in the UI. */
  openTo: MeetPreference;
  status: OneOnOneStatus;
  myStatus: OneOnOneMyStatus;
  /** People asking to join. Only ever returned to the host. */
  requests: MemberCard[];
  /** Set once the host accepts someone. Only returned to the two people involved. */
  matchedWith: MemberCard | null;
  coverUrl: string | null;
};

export type OneOnOneInput = {
  kind: OneOnOneKind;
  activity: string;
  venueName: string;
  venueBusinessId: ID | null;
  area: string;
  startsAt: ISODate;
  openTo: MeetPreference;
  note?: string;
};

export type ReportReason = 'harassment' | 'unsafe' | 'spam' | 'inappropriate' | 'underage' | 'other';
export type ReportInput = { targetType: 'activity' | 'group' | 'user'; targetId: ID; reason: ReportReason; note?: string };

// ---------- Home ----------
export type HomeFeed = {
  banners: { id: ID; eyebrow: string; title: string; subtitle: string; cta: string; imageUrl: string | null; target: { type: 'offer' | 'events' | 'category'; id?: ID } }[];
  trending: BusinessSummary[];
  offers: OfferSummary[];
  events: EventSummary[];
  nearby: BusinessSummary[];
  experiences: EventSummary[];
  activities: { id: ID; name: string; note: string; categoryId: ID; imageUrl: string | null }[];
  recentlyAdded: BusinessSummary[];
  membershipPromo: { price: Paise; interval: 'month' | 'year' } | null;
};

export type SearchScope = 'all' | 'places' | 'services' | 'experiences' | 'events';
export type SortKey = 'nearest' | 'rating' | 'popular';

export type BusinessQuery = {
  q?: string;
  categoryId?: ID;
  scope?: SearchScope;
  openNow?: boolean;
  memberOffers?: boolean;
  minRating?: number;
  maxDistanceKm?: number;
  maxPriceLevel?: number;
  sort?: SortKey;
};
