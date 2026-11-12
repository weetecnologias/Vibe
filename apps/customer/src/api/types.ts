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
export type CategoryNode = {
  id: ID; slug: string; name: string;
  /** One of the app's built-in icons, by name. */
  icon?: string;
  /** An uploaded icon (SVG or PNG). Used instead of `icon` when present. */
  iconUrl?: string | null;
  imageUrl?: string | null;
  children: CategoryNode[];
};

// ---------- Businesses ----------
export type OpenStatus = { open: boolean; label: string; tone: 'success' | 'warning' | 'muted' };

export type BusinessSummary = {
  /** Merchant-uploaded logo. When missing, the app shows the business initials. */
  logoUrl?: string | null;
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
  /** The main category's slug, e.g. movies.cinemas. In demo mode the id is the slug. */
  primaryCategorySlug?: string;
  /** Set when the place takes slot bookings (courts, turfs, classes): the lowest price per slot. */
  slotFromPrice?: Paise | null;
};

export type OpeningHours = { day: string; hours: string; today: boolean };
export type MenuItem = { id: ID; name: string; note: string; price: Paise; imageUrl?: string | null; /** e.g. "Starters", "Mains". Items without one are grouped under "Other". */ section?: string };
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
  businessLogoUrl?: string | null;
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
  /** How this place can be redeemed: show a code and pay at the counter, and/or get the bill in the app. */
  redeemModes?: RedeemMode[];
};

/** code: show a 6-digit code (valid 5 minutes) and pay the place directly; staff confirm it. bill: the place sends the bill to the app and you pay through VIBE. */
export type RedeemMode = 'code' | 'bill';

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
  /** The offer applied to this bill, if any. The server reprices the bill whenever it changes. */
  appliedOffer?: AppliedOffer | null;
  expiresAt: ISODate;
};

export type RedemptionStatus = 'awaiting_bill' | 'bill_ready' | 'paid' | 'expired' | 'cancelled' | 'code_issued' | 'redeemed';

export type Redemption = {
  id: ID;
  offerId: ID;
  businessName: string;
  branchName: string;
  customerDisplayName: string;
  vibeId: string;
  status: RedemptionStatus;
  /** For a code: when the code stops working. */
  expiresAt: ISODate;
  paymentRequest: PaymentRequest | null;
  mode?: RedeemMode;
  /** The 6-digit code while it is live; null once used or expired. */
  code?: string | null;
  /** Where to redeem, shown with the code. */
  place?: { name: string; address: string; area: string; lat: number | null; lng: number | null } | null;
  review?: { rating: number; comment: string } | null;
  /** True once the code was confirmed or the bill paid, until the visit is rated. */
  canReview?: boolean;
};

export type PaymentMethod = 'upi' | 'card' | 'netbanking';
export type PaymentStatus = 'created' | 'pending' | 'verified' | 'failed' | 'refunded';
export type PaymentKind = 'redemption' | 'tickets' | 'membership' | 'movie' | 'meetup' | 'slots' | 'pass';

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
  /** Title of the offer used on this payment, for the receipt. */
  offerTitle?: string | null;
  /** The redemption a bill payment belongs to, so the receipt can ask for a rating. */
  redemptionId?: ID | null;
  /** The court or class booking a slot payment confirmed. */
  slotBookingId?: ID | null;
  /** The gym, studio or trainer membership a pass payment confirmed. */
  passId?: ID | null;
};

// ---------- Slot booking: sports and fitness (like Playo) ----------
/** court: one group per slot (badminton court, football turf, cricket net). spots: several people per slot up to a capacity (swimming, yoga, gym). */
export type SlotKind = 'court' | 'spots';
export type VenueSport = { sport: string; kind: SlotKind; resources: number; fromPrice: Paise; slotMinutes: number };
export type SlotOption = { resourceId: ID; name: string; available: boolean; spotsLeft: number; price: Paise };
/** label is the whole range for the chosen duration ("6–7 AM", "6–8 AM", "11 AM–1 PM"); startLabel is the start alone ("6:00 AM"). fromPrice covers the whole duration. */
export type SlotTime = { startsAt: ISODate; endsAt: ISODate; label: string; startLabel: string; available: boolean; fromPrice: Paise; options: SlotOption[] };
export type SlotGrid = { date: string; sport: string; minutes: number; slotMinutes: number; durations: number[]; kind: SlotKind; slots: SlotTime[]; closedReason: string | null };
export type SlotPick = { resourceId: ID; startsAt: ISODate; minutes: number; spots?: number };
export type SlotBookingItem = { resourceId: ID; resourceName: string; sport: string; startsAt: ISODate; endsAt: ISODate; spots: number; price: Paise };
export type SlotBooking = {
  id: ID; businessId: ID; businessName: string; area: string; address: string; status: 'held' | 'paid' | 'released' | 'cancelled'; bookingRef: string;
  /** Shown at the venue's front desk; only once paid. */
  entryCode: string | null;
  total: Paise; expiresAt: ISODate; paymentRequestId: ID; items: SlotBookingItem[]; paidAt: ISODate | null; checkedInAt: ISODate | null;
};

// ---------- Monthly memberships at gyms, yoga and meditation studios, and trainers ----------
export type VenuePlan = { id: ID; name: string; description: string; months: 1 | 3 | 6 | 12; price: Paise; perMonth: Paise; benefits: string[]; active: boolean; sortOrder: number };
export type VenuePass = {
  id: ID; businessId: ID; businessName: string; area: string; address: string; planName: string; months: number; status: 'held' | 'paid' | 'released';
  /** YYYY-MM-DD, valid from the start of startsOn to the end of endsOn (India time). */
  startsOn: string; endsOn: string; activeNow: boolean; daysLeft: number; passRef: string;
  /** Shown at the front desk; only once paid. */
  passCode: string | null;
  total: Paise; expiresAt: ISODate; paymentRequestId: ID; paidAt: ISODate | null; checkIns: number;
};

// ---------- Events & tickets ----------
export type EventKind = 'Workshops' | 'Meetups' | 'Tours' | 'Live Events' | 'Experiences' | 'Movies';

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
  /** Set for cinema tickets, e.g. "C7". */
  seatLabel?: string | null;
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
  /** From the member's chosen area, worked out by the backend. */
  distanceKm: number;
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

export type OneOnOneKind = 'coffee' | 'sport' | 'food' | 'movie';
export type OneOnOneStatus = 'open' | 'matched' | 'cancelled';
/** My relationship to an invite. `host` = I posted it. */
export type OneOnOneMyStatus = 'none' | 'requested' | 'confirmed' | 'host';

export type OneOnOneInvite = {
  id: ID;
  kind: OneOnOneKind;
  /** e.g. "Coffee & conversation", "Shuttle badminton, singles". */
  activity: string;
  note: string;
  /** Always a VIBE-recommended place (a listed business), never a free-typed address. */
  venueName: string;
  venueBusinessId: ID;
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
  /** From the member's chosen area to the venue, worked out by the backend. */
  distanceKm: number;
  /** Set once the host has paid to reserve the table, slot or seats. Everyone sees that it is reserved; the details only go to the two people involved. */
  reservation: MeetReservation | null;
  /** What the host can still reserve here. Null when it is already reserved, too late, or not the host. */
  reservationOption: MeetReservationOption | null;
};

export type MeetReservationKind = 'table' | 'slot' | 'movie';
export type MeetReservationOption = {
  kind: MeetReservationKind;
  title: string;
  description: string;
  /** Null for movies: the price comes from the seats chosen. */
  fee: Paise | null;
  policy: string;
};
export type MeetReservation = {
  kind: MeetReservationKind;
  title: string;
  /** e.g. "Seats F5, F6 · Screen 2". Only returned to the two people involved. */
  detail: string | null;
  amount: Paise;
  /** VIBE booking reference. Only returned to the two people involved. */
  reference: string | null;
  confirmedAt: ISODate;
  policy: string;
};

/** The place must be a VIBE business that suits the activity; its name and area come from the listing. */
export type OneOnOneInput = {
  kind: OneOnOneKind;
  activity: string;
  venueBusinessId: ID;
  startsAt: ISODate;
  openTo: MeetPreference;
  note?: string;
};

// ---------- Social: one-on-one chat (meeting details only) ----------
export type QuickTemplate = 'dress' | 'table' | 'seat' | 'spot' | 'status';

export type ChatMessage = {
  id: ID;
  from: 'me' | 'them' | 'system';
  text: string;
  at: ISODate;
  /** True when it was built from a quick reply. */
  quick: boolean;
};

export type ChatClosedReason = 'contact_shared' | 'cancelled' | 'blocked' | 'ended';

export type OneOnOneChat = {
  inviteId: ID;
  counterpart: MemberCard;
  venueName: string;
  startsAt: ISODate;
  /** open = can send; limit_reached = all messages used; closed = ended (see closedReason). */
  status: 'open' | 'limit_reached' | 'closed';
  closedReason: ChatClosedReason | null;
  messages: ChatMessage[];
  /** Messages used by both people together (system notes don't count). */
  used: number;
  limit: number;
  closesAt: ISODate;
  /** The reserved table, slot or seats, so both people see it in the chat. */
  reservation: MeetReservation | null;
};

export type ChatSendInput = { template: QuickTemplate; value: string } | { text: string };

/**
 * delivered=false with rejection='contact_shared' means the message was NOT sent:
 * a contact detail was detected, the chat was closed and both people were blocked.
 */
export type ChatSendResult = { delivered: boolean; rejection: 'contact_shared' | null; chat: OneOnOneChat };

/** Social filters. 'week' = the next 7 days; times are in India Standard Time. */
export type SocialWhen = 'any' | 'hour' | 'today' | 'week';
/** nearMe = within a few km of the member's chosen area (the backend sets the radius). */
export type SocialFilter = { when?: SocialWhen; nearMe?: boolean };

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

// ---------- Discover: offers near you, and promotions ----------
/** An offer with how far the place is, what kind of place it is, and whether it's open now. */
export type NearbyOffer = OfferSummary & { distanceKm: number; categoryLabel: string; primaryCategorySlug: string | null; status: OpenStatus };
export type OfferSort = 'nearest' | 'saving' | 'ending';
/** category: a category id (or slug); everything under it is included. */
export type NearbyOfferQuery = { category?: string; q?: string; sort?: OfferSort; openNow?: boolean; maxDistanceKm?: number; memberOnly?: boolean };
/** A place promoting itself in Discover. imageUrl falls back to the place's cover; offerId is set when it links to a live offer. */
export type Promotion = {
  id: ID; businessId: ID; businessName: string; businessLogoUrl: string | null; area: string; distanceKm: number; categoryLabel: string; primaryCategorySlug: string | null;
  status: OpenStatus | null; title: string; message: string; imageUrl: string | null; offerId: ID | null; offerHeadline: string | null; endsAt: ISODate;
};

export type SearchScope = 'all' | 'places' | 'services' | 'experiences' | 'events';
export type SortKey = 'nearest' | 'rating' | 'popular';

/** One page of a long list. nextOffset is null on the last page. */
export type Page<T> = { items: T[]; total: number; nextOffset: number | null };

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

// ---------- Movies & cinema booking ----------
export type MovieFormat = '2D' | '3D' | 'IMAX' | 'Dolby Atmos';
export type MovieCertificate = 'U' | 'UA' | 'A';

export type MovieSummary = {
  id: ID;
  title: string;
  certificate: MovieCertificate;
  durationMin: number;
  genres: string[];
  languages: string[];
  formats: MovieFormat[];
  /** Audience rating out of 10; null before release. */
  rating: number | null;
  votes: number;
  /** Poster from the film data provider; null shows a branded placeholder. */
  posterUrl: string | null;
  releaseDate: ISODate;
  status: 'now_showing' | 'coming_soon';
};
export type MovieDetail = MovieSummary & { synopsis: string; director: string; cast: string[] };

export type ShowAvailability = 'available' | 'filling_fast' | 'almost_full' | 'sold_out';
export type ShowSummary = {
  id: ID;
  startsAt: ISODate;
  language: string;
  format: MovieFormat;
  screenName: string;
  priceFrom: Paise;
  availability: ShowAvailability;
};
export type ShowDetail = ShowSummary & {
  movieId: ID; movieTitle: string; certificate: MovieCertificate;
  cinemaId: ID; cinemaName: string; area: string;
};

/** The cinemas playing one film on one day, nearest first. */
export type CinemaShows = { cinema: { id: ID; name: string; area: string; distanceKm: number }; shows: ShowSummary[] };
/** The films one cinema runs on one day. */
export type MovieShows = { movie: MovieSummary; shows: ShowSummary[] };

export type SeatClass = { id: ID; name: string; price: Paise };
/** unavailable = already sold, or held by someone who is paying right now. */
export type SeatCell = { id: ID; number: number; status: 'available' | 'unavailable' };
/** seats has null where there is an aisle gap. */
export type SeatRow = { label: string; classId: ID; seats: (SeatCell | null)[] };
export type SeatMap = { show: ShowDetail; classes: SeatClass[]; rows: SeatRow[]; maxSeats: number; holdMinutes: number };

/** Seats are held for holdMinutes while the customer pays; unpaid holds are released. */
export type SeatHold = {
  holdId: ID;
  showId: ID;
  seats: { id: ID; label: string; classId: ID; className: string; price: Paise }[];
  total: Paise;
  expiresAt: ISODate;
  paymentRequestId: ID;
};

// ---------- Offers at checkout ----------
export type AppliedOffer = { id: ID; code: string; title: string; memberOnly: boolean };

/** An offer that could apply to a ticket order. When it can't, `reason` says why. */
export type CheckoutOffer = {
  id: ID;
  code: string;
  title: string;
  description: string;
  memberOnly: boolean;
  eligible: boolean;
  reason: string | null;
  /** What it would save on this order; 0 when not eligible. */
  saving: Paise;
  terms: string[];
};
export type CheckoutOffers = { applied: AppliedOffer | null; available: CheckoutOffer[] };
export type CheckoutRequest = PaymentRequest & { payeeName: string; kind: PaymentKind };
