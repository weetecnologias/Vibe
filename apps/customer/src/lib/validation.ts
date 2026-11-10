/** Indian mobile numbers: 10 digits starting 6–9. */
export function isValidIndianMobile(digits: string): boolean {
  return /^[6-9]\d{9}$/.test(digits);
}

/** Attendee / display names: 2–60 letters, spaces, dots, apostrophes and hyphens. */
export function isValidPersonName(name: string): boolean {
  return /^[\p{L}][\p{L} .'-]{1,59}$/u.test(name.trim());
}
