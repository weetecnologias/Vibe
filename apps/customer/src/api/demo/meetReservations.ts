/**
 * DEMO DATA — what a host can reserve at the venue when they post a one-on-one.
 * In production each venue sets its own table or slot fee and policy in the
 * merchant dashboard. Fees here are examples, not real venue prices.
 */
import type { MeetReservation, MeetReservationOption, OneOnOneKind } from '../types';
import { r } from './data';

/** Shown before paying and again on the booking. */
export const RESERVATION_POLICY =
  'Cancelling less than 2 hours before the start, or not turning up, forfeits the fee. Refunds are issued by our payment partner.';

export const reservationOptions: Record<OneOnOneKind, MeetReservationOption> = {
  coffee: { kind: 'table', title: 'Table for two', description: 'A table held for you, 15 minutes past the start time. The fee is adjusted against your bill.', fee: r(150), policy: RESERVATION_POLICY },
  food: { kind: 'table', title: 'Table for two', description: 'A table held for you, 15 minutes past the start time. The fee is adjusted against your bill.', fee: r(300), policy: RESERVATION_POLICY },
  sport: { kind: 'slot', title: 'Court slot for 60 min', description: 'The court is booked in your name for the hour. The fee goes towards the court charge.', fee: r(200), policy: RESERVATION_POLICY },
  movie: { kind: 'movie', title: 'Two seats together', description: 'Pick a film and two seats at this cinema. The seats are shared in your chat once paid.', fee: null, policy: RESERVATION_POLICY },
};

/** A demo invite that is already reserved, so reserved plans show up in the feed. */
export const seededReservations: Record<string, MeetReservation> = {
  'oo-dinner': {
    kind: 'table', title: 'Table for two', detail: null, amount: r(300), reference: 'VB-DEMO-RSV1',
    confirmedAt: new Date().toISOString(), policy: RESERVATION_POLICY,
  },
};
