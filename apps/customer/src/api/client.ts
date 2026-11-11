import type {
  AuthResult, BusinessDetail, CheckoutOffers, CheckoutRequest, CinemaShows, MovieDetail, MovieShows, MovieSummary, Page, SeatHold, SeatMap, BusinessQuery, BusinessSummary, CategoryNode, EventDetail, EventKind, EventSummary,
  HomeFeed, ID, Membership, MembershipPlan, OfferDetail, OfferEligibility, OfferSummary, OfferView, OtpChallenge, Payment, PaymentMethod,
  ChatSendInput, ChatSendResult, OneOnOneChat, OneOnOneInput, OneOnOneInvite, PaymentKind, PaymentRequest, PaymentStart, Redemption, SocialFilter, SocialProfile, SocialProfileInput, ReportInput, ReservationItem, SocialActivity, SocialGroup, Ticket, TicketReservation, User,
} from './types';

/**
 * The customer app's view of the VIBE backend. Every screen talks to this
 * interface only, so the demo adapter and the real HTTP API are interchangeable.
 */
export interface VibeApi {
  readonly mode: 'demo' | 'http';

  // Auth
  requestOtp(phone: string): Promise<OtpChallenge>;
  verifyOtp(requestId: ID, code: string): Promise<AuthResult>;
  logout(): Promise<void>;

  // Profile
  me(): Promise<User>;
  updateMe(patch: Partial<Pick<User, 'name' | 'area'>>): Promise<User>;
  requestAccountDeletion(): Promise<{ requestId: ID; message: string }>;

  // Discovery
  getCategories(): Promise<CategoryNode[]>;
  getHome(area: string | null): Promise<HomeFeed>;
  /** Everything that matches (up to the server cap). Prefer searchBusinessesPage for long lists. */
  searchBusinesses(query: BusinessQuery): Promise<BusinessSummary[]>;
  searchBusinessesPage(query: BusinessQuery, offset?: number, limit?: number): Promise<Page<BusinessSummary>>;
  getBusiness(id: ID): Promise<BusinessDetail>;

  // Offers, Pay & Redeem
  getOffers(view: OfferView): Promise<OfferSummary[]>;
  getOffer(id: ID): Promise<OfferDetail>;
  getOfferEligibility(id: ID): Promise<OfferEligibility>;
  createRedemption(offerId: ID): Promise<Redemption>;
  getRedemption(id: ID): Promise<Redemption>;
  cancelRedemption(id: ID): Promise<void>;
  /** A server-priced bill (redemption, ticket order or membership). */
  getPaymentRequest(id: ID): Promise<PaymentRequest & { payeeName: string; kind: PaymentKind }>;
  /** Offers that could apply to a ticket order (movie or event), with the reason for any that can't. */
  getCheckoutOffers(paymentRequestId: ID): Promise<CheckoutOffers>;
  /** Apply an offer by id (tapped from the list) or by a typed code. One offer per order; the server reprices the bill. */
  applyOffer(paymentRequestId: ID, codeOrId: string): Promise<CheckoutRequest>;
  removeOffer(paymentRequestId: ID): Promise<CheckoutRequest>;
  /** Starts payment for a server-priced payment request. Requires an idempotency key. */
  startPayment(paymentRequestId: ID, method: PaymentMethod, idempotencyKey: string): Promise<PaymentStart>;
  /** Server-verified payment status. The app shows success only when status === 'verified'. */
  getPayment(reference: string): Promise<Payment>;

  // Movies & cinema booking. Showtimes and seat availability come from each cinema's system; see docs/movie-booking-integration.md.
  getMovies(filter?: { status?: MovieSummary['status']; language?: string }): Promise<MovieSummary[]>;
  getMovie(id: ID): Promise<MovieDetail>;
  /** The cinemas playing a film on a day (YYYY-MM-DD, India time), nearest first. */
  getMovieShows(movieId: ID, date: string): Promise<CinemaShows[]>;
  /** The films a cinema runs on a day. */
  getCinemaShows(cinemaId: ID, date: string): Promise<MovieShows[]>;
  getSeatMap(showId: ID): Promise<SeatMap>;
  /** Holds seats for a few minutes and returns a payment request to pay through startPayment. */
  /** `meetId` books the seats as the reservation of a one-on-one movie plan: exactly 2 seats, at that cinema, on the plan's day. */
  holdSeats(showId: ID, seatIds: string[], opts?: { meetId?: ID }): Promise<SeatHold>;

  // Events & tickets
  getEvents(filter: { kind?: EventKind; day?: string }): Promise<EventSummary[]>;
  getEvent(id: ID): Promise<EventDetail>;
  reserveTickets(eventId: ID, items: ReservationItem[], attendees: string[]): Promise<TicketReservation>;
  getMyTickets(): Promise<Ticket[]>;
  getTicket(id: ID): Promise<Ticket>;

  // Membership
  getMembership(): Promise<Membership>;
  getMembershipPlans(): Promise<MembershipPlan[]>;
  /** Returns a payment request id to pay through startPayment. */
  subscribe(planId: ID): Promise<{ paymentRequestId: ID; amount: number }>;
  changePlan(planId: ID): Promise<Membership>;
  cancelMembership(): Promise<Membership>;

  // Social
  /** Filters apply to activities and social events; groups are always returned. */
  getSocialFeed(filter?: SocialFilter): Promise<{ activities: SocialActivity[]; groups: SocialGroup[] }>;
  joinActivity(id: ID): Promise<SocialActivity>;
  leaveActivity(id: ID): Promise<SocialActivity>;
  joinGroup(id: ID): Promise<SocialGroup>;
  report(input: ReportInput): Promise<{ reportId: ID }>;
  block(userId: ID): Promise<void>;

  // Social: one-on-one meetups (18+). The backend only returns invites that match both people's preferences.
  getSocialProfile(): Promise<SocialProfile | null>;
  saveSocialProfile(input: SocialProfileInput): Promise<SocialProfile>;
  /** Filters apply to open invites only; my own plans are always returned. */
  getOneOnOnes(filter?: SocialFilter): Promise<OneOnOneInvite[]>;
  createOneOnOne(input: OneOnOneInput): Promise<OneOnOneInvite>;
  requestOneOnOne(id: ID): Promise<OneOnOneInvite>;
  /** Withdraws my request, or cancels my own invite. */
  cancelOneOnOne(id: ID): Promise<void>;
  /** Host only: starts the payment for a table or slot at the venue. Movie plans reserve through holdSeats with meetId. Paid and verified by the server, then shared in the chat. */
  reserveMeetVenue(inviteId: ID): Promise<{ paymentRequestId: ID }>;
  /** Host accepts or declines someone who asked to join. */
  respondOneOnOne(id: ID, memberId: ID, accept: boolean): Promise<OneOnOneInvite>;
  /** Chat opens only after a match is accepted. Rules (30 messages, no contact details) are enforced server-side. */
  getOneOnOneChat(inviteId: ID): Promise<OneOnOneChat>;
  sendOneOnOneMessage(inviteId: ID, input: ChatSendInput): Promise<ChatSendResult>;

  /** Demo-only helpers. Undefined in the HTTP adapter. */
  demo?: {
    simulateMerchantBill(redemptionId: ID, eligibleAmount: number): Promise<Redemption>;
    simulateHostAccepts(inviteId: ID): Promise<OneOnOneInvite>;
    simulateJoinRequest(inviteId: ID): Promise<OneOnOneInvite>;
    simulateChatReply(inviteId: ID): Promise<OneOnOneChat>;
    moderationLog(): Promise<{ kind: string; inviteId: ID; userId: ID; reason: string; at: string }[]>;
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type TokenSource = { getAccessToken(): Promise<string | null> };

/** REST adapter for the Spring Boot backend (`/v1`). Paths here are the API contract. */
export function createHttpApi(baseUrl: string, tokens: TokenSource): VibeApi {
  async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const token = await tokens.getAccessToken();
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/v1${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError('Can’t reach VIBE right now. Check your connection.', 0, 'network');
    }
    if (res.status === 204) return undefined as T;
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ApiError(json?.message ?? `Request failed (${res.status})`, res.status, json?.code ?? 'http_error');
    }
    return json as T;
  }
  const qs = (o: Record<string, unknown>) => {
    const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '');
    return p.length ? '?' + p.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&') : '';
  };

  return {
    mode: 'http',
    requestOtp: (phone) => call('POST', '/auth/otp', { phone }),
    verifyOtp: (requestId, code) => call('POST', '/auth/otp/verify', { requestId, code }),
    logout: () => call('POST', '/auth/logout'),
    me: () => call('GET', '/me'),
    updateMe: (patch) => call('PATCH', '/me', patch),
    requestAccountDeletion: () => call('POST', '/me/deletion-request'),
    getCategories: () => call('GET', '/categories'),
    getHome: (area) => call('GET', `/home${qs({ area })}`),
    searchBusinesses: (q) => call<Page<BusinessSummary>>('GET', `/businesses${qs({ ...q, limit: 100 })}`).then((p) => p.items),
    searchBusinessesPage: (q, offset = 0, limit = 12) => call('GET', `/businesses${qs({ ...q, offset, limit })}`),
    getBusiness: (id) => call('GET', `/businesses/${id}`),
    getOffers: (view) => call('GET', `/offers${qs({ view })}`),
    getOffer: (id) => call('GET', `/offers/${id}`),
    getOfferEligibility: (id) => call('GET', `/offers/${id}/eligibility`),
    createRedemption: (offerId) => call('POST', '/redemptions', { offerId }),
    getRedemption: (id) => call('GET', `/redemptions/${id}`),
    cancelRedemption: (id) => call('POST', `/redemptions/${id}/cancel`),
    getPaymentRequest: (id) => call('GET', `/payment-requests/${id}`),
    getCheckoutOffers: (id) => call('GET', `/payment-requests/${id}/offers`),
    applyOffer: (id, code) => call('POST', `/payment-requests/${id}/offer`, { code }),
    removeOffer: (id) => call('DELETE', `/payment-requests/${id}/offer`),
    startPayment: (paymentRequestId, method, idempotencyKey) =>
      call('POST', `/payment-requests/${paymentRequestId}/payments`, { method }, { 'Idempotency-Key': idempotencyKey }),
    getPayment: (reference) => call('GET', `/payments/${reference}`),
    getMovies: (f) => call('GET', `/movies${qs({ status: f?.status, language: f?.language })}`),
    getMovie: (id) => call('GET', `/movies/${id}`),
    getMovieShows: (movieId, date) => call('GET', `/movies/${movieId}/showtimes${qs({ date })}`),
    getCinemaShows: (cinemaId, date) => call('GET', `/cinemas/${cinemaId}/showtimes${qs({ date })}`),
    getSeatMap: (showId) => call('GET', `/shows/${showId}/seats`),
    holdSeats: (showId, seatIds, opts) => call('POST', `/shows/${showId}/holds`, { seatIds, meetId: opts?.meetId }),
    getEvents: (f) => call('GET', `/events${qs(f)}`),
    getEvent: (id) => call('GET', `/events/${id}`),
    reserveTickets: (eventId, items, attendees) => call('POST', `/events/${eventId}/reservations`, { items, attendees }),
    getMyTickets: () => call('GET', '/me/tickets'),
    getTicket: (id) => call('GET', `/tickets/${id}`),
    getMembership: () => call('GET', '/membership'),
    getMembershipPlans: () => call('GET', '/membership/plans'),
    subscribe: (planId) => call('POST', '/membership/subscriptions', { planId }),
    changePlan: (planId) => call('POST', '/membership/plan-change', { planId }),
    cancelMembership: () => call('POST', '/membership/cancel'),
    getSocialFeed: (f) => call('GET', `/social/feed${qs({ when: f?.when, nearMe: f?.nearMe })}`),
    joinActivity: (id) => call('POST', `/social/activities/${id}/join`),
    leaveActivity: (id) => call('POST', `/social/activities/${id}/leave`),
    joinGroup: (id) => call('POST', `/social/groups/${id}/join`),
    report: (input) => call('POST', '/reports', input),
    block: (userId) => call('POST', '/blocks', { userId }),
    getSocialProfile: () =>
      call<SocialProfile | null>('GET', '/social/profile').catch((e) => (e instanceof ApiError && e.status === 404 ? null : Promise.reject(e))),
    saveSocialProfile: (input) => call('PUT', '/social/profile', input),
    getOneOnOnes: (f) => call('GET', `/social/one-on-ones${qs({ when: f?.when, nearMe: f?.nearMe })}`),
    createOneOnOne: (input) => call('POST', '/social/one-on-ones', input),
    requestOneOnOne: (id) => call('POST', `/social/one-on-ones/${id}/requests`),
    cancelOneOnOne: (id) => call('POST', `/social/one-on-ones/${id}/cancel`),
    reserveMeetVenue: (id) => call('POST', `/social/one-on-ones/${id}/reservation`),
    getOneOnOneChat: (id) => call('GET', `/social/one-on-ones/${id}/chat`),
    sendOneOnOneMessage: (id, input) => call('POST', `/social/one-on-ones/${id}/chat/messages`, input),
    respondOneOnOne: (id, memberId, accept) => call('POST', `/social/one-on-ones/${id}/requests/${memberId}/respond`, { accept }),
  };
}
