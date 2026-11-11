/**
 * DEMO DATA — offers that can be applied at checkout to ticket orders (events and movies).
 * In production the admin and merchant dashboards manage these. Rates, caps and
 * minimums are data, never hard-coded in the app.
 */
import { r } from './data';
import type { OfferRule } from './pricing';

export const CHECKOUT_KINDS = ['tickets', 'movie'] as const;
export type CheckoutKind = (typeof CHECKOUT_KINDS)[number];

export type CheckoutOfferDef = {
  id: string;
  code: string;
  title: string;
  description: string;
  memberOnly: boolean;
  kinds: CheckoutKind[];
  rule: OfferRule;
  firstBookingOnly?: boolean;
  /** How many times one customer can use it. */
  maxUses?: number;
  terms: string[];
};

export const checkoutOffers: CheckoutOfferDef[] = [
  {
    id: 'co-member-movies', code: 'MEMBERFLIX', title: 'Members: 15% off movie tickets', description: 'Up to ₹150 off bookings of ₹300 or more',
    memberOnly: true, kinds: ['movie'], rule: { kind: 'percentage', rateBps: 1500, maxDiscount: r(150), minBill: r(300) }, maxUses: 4,
    terms: ['For active VIBE members.', 'Up to 4 uses per member.', 'Not valid with other offers.'],
  },
  {
    id: 'co-member-events', code: 'MEMBERLIVE', title: 'Members: 10% off event tickets', description: 'Up to ₹300 off bookings of ₹500 or more',
    memberOnly: true, kinds: ['tickets'], rule: { kind: 'percentage', rateBps: 1000, maxDiscount: r(300), minBill: r(500) },
    terms: ['For active VIBE members.', 'Not valid with other offers.'],
  },
  {
    id: 'co-welcome', code: 'WELCOME50', title: '₹50 off your first booking', description: 'Movies and events, on bookings of ₹250 or more',
    memberOnly: false, kinds: ['movie', 'tickets'], rule: { kind: 'flat', amount: r(50), minBill: r(250) }, firstBookingOnly: true,
    terms: ['One use per customer, on your first paid booking.', 'Not valid with other offers.'],
  },
  {
    id: 'co-group', code: 'GROUP100', title: '₹100 off bigger bookings', description: 'On bookings of ₹1,500 or more. Great for groups',
    memberOnly: false, kinds: ['movie', 'tickets'], rule: { kind: 'flat', amount: r(100), minBill: r(1500) },
    terms: ['Open to everyone.', 'Not valid with other offers.'],
  },
];
