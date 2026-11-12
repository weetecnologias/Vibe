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
  payRedeem: boolean;
  menuLabel: string | null;
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
  payRedeem: boolean;
  menuLabel: string | null;
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
  memberOnly: boolean; startsAt: string; endsAt: string; active: boolean; reviewStatus: ReviewStatus; reviewNote: string | null; reviewedAt: string | null; autoApproved?: boolean;
};

// ---------- membership plans ----------
export type Plan = { id: string; name: string; interval: 'month' | 'year'; price: number; note: string; savingsLabel: string | null; benefits: string[]; sortOrder: number; active: boolean };
export type PlanInput = Omit<Plan, 'id'>;

// ---------- checkout coupons ----------
/** Where a checkout coupon applies: event tickets, movie seats, court and class bookings (slots), gym and studio memberships (pass). */
export type CouponKind = 'tickets' | 'movie' | 'slots' | 'pass';
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
export type TicketTypeRow = { id?: string; name: string; description: string; price: number; capacity: number; maxPerOrder: number; sold?: number; held?: number };
export type EventRow = {
  id: string; businessId: string | null; businessName: string | null; organiser: string; title: string; kind: string; description: string; venue: string; area: string; startsAt: string;
  gatesOpenAt: string; coverUrl: string | null; ageLimit: number | null; featured: boolean; terms: string[]; status: EventStatus; reviewNote: string | null; ticketTypes: TicketTypeRow[];
};
export type EventListRow = { id: string; title: string; kind: string; organiser: string; venue: string; startsAt: string; status: EventStatus; fromPrice: number; capacity: number; autoApproved?: boolean; sold?: number };
export type EventInput = {
  title: string; kind: string; description: string; venue: string; area: string; startsAt: string; gatesOpenAt: string | null; coverUrl: string | null; ageLimit: number | null; terms: string[];
  organiser?: string | null; featured?: boolean; ticketTypes: (Omit<TicketTypeRow, 'id' | 'sold' | 'held'> & { id?: string })[];
};

// ---------- reservation settings ----------
export type ReservationSettings = { enabled: boolean; tableFee: number | null; slotFee: number | null; policy: string };

// ---------- Pay & Redeem: the merchant's bills screen ----------
export type BillStatus = 'awaiting_bill' | 'bill_ready' | 'paid' | 'expired' | 'cancelled' | 'code_issued' | 'redeemed';
export type BillPaymentStatus = 'not_started' | 'pending' | 'failed' | 'paid';
export type BillInfo = { billRef: string; eligibleAmount: number; discount: number; payable: number; raisedAt: string; expiresAt: string; raisedBy: string; paymentStatus: BillPaymentStatus };
/** mode code: the customer shows a 6-digit code and pays the place; staff confirm it. mode bill: staff raise the bill and the customer pays in VIBE. */
export type BillRow = { id: string; customerName: string; vibeId: string; offerTitle: string; status: BillStatus; requestedAt: string; expiresAt: string; paidAt: string | null; bill: BillInfo | null; mode?: 'bill' | 'code'; code?: string | null; billAmount?: number | null; discountGiven?: number | null };
export type CodeCheck = { id: string; code: string; customerName: string; vibeId: string | null; offerTitle: string; expiresAt: string; billAmount: number | null; discount: number | null; customerPays: number | null; reason: string | null };
export type BillSummary = { paidToday: number; paidTodayAmount: number; savedTodayAmount: number; redeemedToday?: number };
export type BillBoard = { rows: BillRow[]; summary: BillSummary };
export type BillPreview = { eligibleAmount: number; discount: number; discountLabel: string; reason: string | null; vibeFee: number; customerPays: number; needsConfirmation: boolean };
export type BillInput = { lines: { label: string; amount: number }[]; billRef?: string; confirmLarge?: boolean };

// ---------- admin overview, customers, transactions, members ----------
export type DayTotal = { day: string; amount: number; count: number };
export type Overview = {
  customers: number; newCustomers7d: number; activeMembers: number; redemptionsToday: number; paidToday: number; collectedToday: number; collected7d: number; membershipRevenue30d: number; savedByMembers30d: number;
  liveBusinesses: number; pendingOffers: number; pendingEvents: number; pendingApplications: number; pendingDeletions: number; last14Days: DayTotal[];
};
export type MembershipView = { status: 'active' | 'cancelled' | 'none'; plan: { id: string; name: string; interval: string; price: number } | null; memberNo: string | null; validUntil: string | null; payments: { id: string; at: string; amount: number; planName: string }[]; savings: { total: number; redemptions: number; places: number } };
export type CustomerRow = { id: string; name: string; vibeId: string; phoneMasked: string; area: string | null; joinedAt: string; member: boolean; paidRedemptions: number; totalPaid: number };
export type CustomerPage = { items: CustomerRow[]; total: number };
export type CustomerDetail = {
  id: string; name: string; vibeId: string; phoneMasked: string; area: string | null; joinedAt: string; membership: MembershipView; deletionRequested: boolean;
  redemptions: { id: string; businessName: string; offerTitle: string; status: string; payable: number | null; at: string }[];
  payments: { reference: string; kind: string; status: string; payee: string; amount: number; savings: number; at: string }[];
};
export type TransactionRow = { reference: string; kind: string; status: string; method: string; amount: number; savings: number; customerName: string; vibeId: string; payee: string; provider: string; createdAt: string; verifiedAt: string | null };
export type TransactionPage = { items: TransactionRow[]; total: number; totals: { count: number; verifiedAmount: number; savings: number } };
export type TransactionDetail = {
  row: TransactionRow; failureReason: string | null; providerPaymentId: string | null; billRef: string | null; raisedBy: string | null; lines: { label: string; amount: number }[];
  eligibleAmount: number; discount: number; discountLabel: string; providerEvents: string[];
};
export type MemberRow = { customerId: string; name: string; vibeId: string; memberNo: string | null; plan: string; status: string; joinedAt: string; validUntil: string; totalPaid: number; totalSaved: number };
export type MemberPage = { items: MemberRow[]; total: number };
export type DeletionRow = { id: string; customerId: string; name: string; vibeId: string; status: string; requestedAt: string };

// ---------- merchant applications ----------
export type ApplicationStatus = 'pending' | 'changes_requested' | 'approved' | 'rejected';
export type ApplicationRow = { id: string; businessName: string; categoryName: string | null; area: string; contactName: string; email: string; phone: string; status: ApplicationStatus; submittedAt: string };
export type ApplicationDetail = { row: ApplicationRow; categoryId: string | null; address: string; about: string; documents: string[]; reviewNote: string | null; decidedAt: string | null; businessId: string | null };
export type ApplicationApproved = { businessId: string; loginEmail: string; temporaryPassword: string };
export type StaffRole = 'manager' | 'cashier' | 'custom';
export type MerchantSettings = { payRedeem: boolean; menuLabel: string; owner?: boolean; staffRole?: StaffRole | null; permissions?: string[]; areas?: Record<string, string>; acceptsVibePayments?: boolean; slotBooking?: boolean };
export type TeamMember = { id: string; email: string; name: string; active: boolean; owner: boolean; mustChangePassword: boolean; staffRole: StaffRole | null; permissions: string[] };

// ---------- settlements and results ----------
export type SettlementDue = { businessId: string; businessName: string; area: string; commissionBps: number; count: number; gross: number; vibeFees: number; commission: number; payout: number; customerSavings: number; oldest: string; newest: string };
export type SettlementSummary = {
  id: string; reference: string; businessId: string; businessName: string; periodFrom: string; periodTo: string; paymentCount: number; gross: number; vibeFees: number; commissionBps: number;
  commission: number; payout: number; customerSavings: number; status: 'pending' | 'paid'; createdAt: string; paidAt: string | null; payoutRef: string | null; note: string | null;
};
export type SettlementItem = { paymentReference: string; paidAt: string; customerName: string; vibeId: string; billRef: string; offerTitle: string | null; amount: number; vibeFee: number; commission: number; payout: number; customerSaved: number };
export type SettlementDetail = { summary: SettlementSummary; items: SettlementItem[] };
export type SettlementBalance = { count: number; gross: number; commission: number; payout: number };
export type MerchantMoney = { unsettled: SettlementBalance; awaitingPayout: number; paidOut: number; commissionBps: number; settlements: SettlementSummary[] };
export type BusinessTerms = { businessId: string; businessName: string; commissionBps: number; autoApprove: boolean };
export type OfferResult = { offerId: string; title: string; reviewStatus: ReviewStatus; live: boolean; redemptions: number; paid: number; sales: number; discount: number };
export type MerchantResults = {
  days: number; customers: number; repeatCustomers: number; redemptionsStarted: number; paidBills: number; sales: number; discountGiven: number; averageBill: number;
  offersLive: number; offersPending: number; eventsLive: number; eventsPending: number; unsettled: SettlementBalance; awaitingPayout: number; paidOut: number;
  offers: OfferResult[]; lastDays: { day: string; sales: number; bills: number }[]; codesRedeemed?: number; codeDiscountGiven?: number; rating?: number; reviewCount?: number;
};

// ---------- ticket sales ----------
export type TicketTypeSales = { ticketTypeId: string; name: string; price: number; capacity: number; sold: number; held: number; left: number; revenue: number; archived: boolean };
export type TicketBooking = { bookingId: string; customerName: string; vibeId: string; tickets: number; paid: number; saved: number; paidAt: string | null; paymentReference: string | null; checkedIn: number };
export type EventSales = {
  eventId: string; title: string; startsAt: string; status: EventStatus; capacity: number; sold: number; held: number; left: number; checkedIn: number; revenue: number;
  types: TicketTypeSales[]; bookings: TicketBooking[];
};
export type CheckInResult = { result: 'admitted' | 'already' | 'wrong_event' | 'cancelled'; message: string; attendeeName: string; typeName: string; bookingId: string; checkedInAt: string | null; index: number; of: number };

// ---------- ratings ----------
export type ReviewItem = { id: string; businessId: string; businessName: string; customerName: string; vibeId: string; rating: number; comment: string; offerTitle: string; mode: 'bill' | 'code'; hidden: boolean; hiddenReason: string | null; createdAt: string };
export type ReviewStats = { average: number; count: number; byStars: number[] };
export type MerchantReviews = { stats: ReviewStats; items: ReviewItem[] };

// ---------- slot booking (courts, turfs, classes) ----------
export type VenueResource = {
  id: string; sport: string; name: string; kind: 'court' | 'spots'; capacity: number; slotMinutes: number; price: number; peakPrice: number | null; peakFrom: string | null; peakTo: string | null;
  weekendPeak: boolean; active: boolean; sortOrder: number;
};
export type VenueResourceInput = Omit<VenueResource, 'id'>;
export type VenueDayBooking = { bookingId: string; bookingRef: string; customerName: string; vibeId: string; resourceId: string; startsAt: string; endsAt: string; spots: number; status: string; checkedIn: boolean; price: number };
export type VenueBlock = { id: string; resourceId: string; startsAt: string; endsAt: string; reason: string };
/** A monthly plan at a gym, yoga or meditation studio, or trainer. Prices in paise. */
export type VenuePlan = { id: string; name: string; description: string; months: 1 | 3 | 6 | 12; price: number; perMonth: number; benefits: string[]; active: boolean; sortOrder: number };
export type VenuePlanInput = Omit<VenuePlan, 'id' | 'perMonth'>;
export type VenueMember = { passId: string; passRef: string; customerName: string; vibeId: string; planName: string; startsOn: string; endsOn: string; activeNow: boolean; checkIns: number; lastCheckIn: string | null };
export type VenueDay = { date: string; resources: VenueResource[]; bookings: VenueDayBooking[]; blocks: VenueBlock[]; bookedToday: number; salesToday: number };
export type VenueCheckIn = { result: 'admitted' | 'already' | 'not_started' | 'expired'; message: string; bookingRef: string; customerName: string; items: { resourceName: string; sport: string; startsAt: string; endsAt: string; spots: number }[] };
