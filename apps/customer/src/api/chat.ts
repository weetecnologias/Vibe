import type { QuickTemplate } from './types';

/**
 * One-on-one chat rules. The app uses these to build the quick replies; the
 * backend enforces the same rules and is the source of truth.
 */
export const CHAT_LIMIT = 30; // messages in total, both people together
export const CHAT_FREE_TEXT_MAX = 80; // characters in a typed message
export const CHAT_AFTER_MEETUP_MIN = 180; // chat stays open this long after the plan ends

export const DRESS_COLOURS = [
  'Red', 'Black', 'White', 'Navy blue', 'Blue', 'Green', 'Yellow', 'Pink', 'Grey', 'Brown', 'Orange', 'Purple', 'Maroon', 'Beige',
];

export const MEET_SPOTS = [
  'I’m at the entrance', 'I’m at the reception', 'I’m near the counter', 'I’m by the window',
  'I’m in the corner', 'I’m outside the venue', 'I’m in the parking area', 'I’m upstairs',
];

export const MEET_STATUS = ['I’m here', 'On my way', 'Running 10 minutes late', 'Running 20 minutes late'];

/** Turns a quick-reply choice into message text, or null if the choice isn't valid. */
export function renderQuick(template: QuickTemplate, value: string): string | null {
  switch (template) {
    case 'dress':
      return DRESS_COLOURS.includes(value) ? `I’m wearing ${value.toLowerCase()}` : null;
    case 'table':
      return /^[1-9]\d?$/.test(value) ? `I’m at table ${value}` : null;
    case 'seat':
      return /^[1-9]\d?$/.test(value) ? `My seat number is ${value}` : null;
    case 'spot':
      return MEET_SPOTS.includes(value) ? value : null;
    case 'status':
      return MEET_STATUS.includes(value) ? value : null;
    default:
      return null;
  }
}
