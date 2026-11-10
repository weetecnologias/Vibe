/**
 * Detects attempts to take a conversation off VIBE: phone numbers (digits,
 * spelled-out, spaced, Indic numerals, or split across messages), emails,
 * links, social handles and "call/text me" phrases.
 *
 * This is the DEMO adapter's stand-in for the backend. The production backend
 * should run the same checks server-side (plus a maintained pattern list and
 * moderator review) — the app never decides this on its own.
 */
export type ContactReason = 'phone' | 'email' | 'link' | 'app' | 'phrase';
export type GuardResult = { ok: true; digitStreak: number } | { ok: false; reason: ContactReason; digitStreak: number };

const WORDS: Record<string, string> = {
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  shunya: '0', sifar: '0', ek: '1', teen: '3', paanch: '5', panch: '5', chhe: '6', saat: '7', aath: '8', nau: '9',
};
const WORD_KEYS = Object.keys(WORDS).sort((a, b) => b.length - a.length);

const MIN_PHONE_DIGITS = 7;

function normalise(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[٠-٩۰-۹०-९౦-౯]/g, (ch) => {
      const cp = ch.codePointAt(0)!;
      const base = cp >= 0x0c66 ? 0x0c66 : cp >= 0x0966 ? 0x0966 : cp >= 0x06f0 ? 0x06f0 : 0x0660;
      return String(cp - base);
    });
}

/** How many digits a run of letters spells out ("nineeight" -> 2), or null if it isn't only number words. */
function wordDigits(w: string): number | null {
  let i = 0;
  let n = 0;
  while (i < w.length) {
    const hit = WORD_KEYS.find((k) => w.startsWith(k, i));
    if (!hit) return null;
    n += 1;
    i += hit.length;
  }
  return n;
}

/** Longest run of digits (separators allowed between), the total digit count, and whether the text is digits only. */
function digitStats(s: string) {
  let run = 0;
  let max = 0;
  let total = 0;
  let other = false;
  for (const m of s.matchAll(/(\d)|([a-z]+)|([\s\-.,()+/])|(.)/gu)) {
    if (m[1]) {
      run += 1;
      total += 1;
    } else if (m[2]) {
      const n = wordDigits(m[2]);
      if (n === null) {
        run = 0;
        other = true;
      } else {
        run += n;
        total += n;
      }
    } else if (!m[3]) {
      run = 0;
      other = true;
    }
    max = Math.max(max, run);
  }
  return { max, total, digitsOnly: total > 0 && !other };
}

export function checkContact(raw: string, streak = 0): GuardResult {
  const s = normalise(raw);
  const letters = s.replace(/[^a-z]/g, '');
  const fail = (reason: ContactReason, digitStreak = 0): GuardResult => ({ ok: false, reason, digitStreak });

  if (/@/.test(s) || /\bat the rate\b/.test(s) || /\bdot com\b/.test(s) || /(gmail|yahoo|outlook|hotmail|protonmail)/.test(letters)) return fail('email');
  if (/https?:|www\.|\b[a-z0-9-]+\.(com|in|me|co|io|app|net|org|link|ly)\b/.test(s)) return fail('link');
  if (/(whatsapp|whatsap|watsapp|telegram|instagram|snapchat|facebook|linkedin|discord|truecaller)/.test(letters) || /\b(insta|snap|fb)\b/.test(s)) return fail('app');
  if (
    /\b(phone|mobile|cell|contact)\s*(no|num|number)\b/.test(s) ||
    /\b(my|your|ur)\s+(no|num|number|nmbr)\b/.test(s) ||
    /\b(call|text|sms|dm)\s+me\b/.test(s) ||
    /\bgive me a (call|ring)\b/.test(s) ||
    /\bshare (your |ur |my )?(no|number|num|contact|handle|id)\b/.test(s) ||
    /\bmy (handle|username|user name)\b/.test(s)
  ) return fail('phrase');

  const { max, total, digitsOnly } = digitStats(s);
  if (max >= MIN_PHONE_DIGITS) return fail('phone');
  // A number split over several digit-only messages ("98765", then "43210").
  const nextStreak = digitsOnly ? streak + total : 0;
  if (nextStreak >= MIN_PHONE_DIGITS) return fail('phone', nextStreak);
  return { ok: true, digitStreak: nextStreak };
}
