import { checkContact } from '../contactGuard';

const blocked = (text: string) => checkContact(text).ok === false;

describe('contact guard: things that must be blocked', () => {
  it.each([
    ['plain mobile number', '9876543210'],
    ['spaced number', '98765 43210'],
    ['with country code', 'call +91 98765 43210'],
    ['dashes', '98-76-54-32-10'],
    ['dots between each digit', '9.8.7.6.5.4.3.2.1.0'],
    ['digits in a sentence', 'ok it is 9 8 7 6 5 4 3 2 1 0 thanks'],
    ['spelled-out digits', 'nine eight seven six five four three two one zero'],
    ['run-together words', 'nineeightsevensixfivefourthree'],
    ['Devanagari digits', '९८७६५४३२१०'],
    ['Telugu digits', '౯౮౭౬౫౪౩౨౧౦'],
    ['full-width digits', '９８７６５４３２１０'],
    ['email', 'mail me rohan@gmail.com'],
    ['spoken email', 'rohan at the rate gmail dot com'],
    ['handle', 'find me @rohan_123'],
    ['link', 'https://wa.me/919876543210'],
    ['website', 'see www.mysite.in'],
    ['whatsapp', 'ping me on whatsapp'],
    ['spaced-out app name', 'w h a t s a p p'],
    ['instagram', 'my insta is rohan'],
    ['telegram', 'telegram?'],
    ['call me', 'just call me'],
    ['text me', 'text me later'],
    ['asking for a number', 'what is your number'],
    ['sharing number', 'my phone number is'],
  ])('%s', (_name, text) => {
    expect(blocked(text)).toBe(true);
  });

  it('catches a number split across several digit-only messages', () => {
    let streak = 0;
    const first = checkContact('98765', streak);
    expect(first.ok).toBe(true);
    streak = first.digitStreak;
    const second = checkContact('43210', streak);
    expect(second.ok).toBe(false);
  });

  it('reports why', () => {
    expect(checkContact('9876543210')).toMatchObject({ ok: false, reason: 'phone' });
    expect(checkContact('a@b.co')).toMatchObject({ ok: false, reason: 'email' });
    expect(checkContact('www.x.in')).toMatchObject({ ok: false, reason: 'link' });
    expect(checkContact('whatsapp')).toMatchObject({ ok: false, reason: 'app' });
    expect(checkContact('call me')).toMatchObject({ ok: false, reason: 'phrase' });
  });
});

describe('contact guard: normal meeting talk must pass', () => {
  it.each([
    'I’m at table 12',
    'My seat number is 7',
    'Seat 14 row 3',
    'table 4 seat 2 floor 1',
    'I’m wearing a navy blue shirt and black jeans',
    'Near the window, second row from the door',
    'Running 10 minutes late',
    'Reaching at 6:30',
    'Court 3 is free, I’m on court 3',
    'Parked on level 2, coming in now',
    'I’m in the red kurta by the counter',
    'See you at 7',
  ])('%s', (text) => {
    expect(checkContact(text).ok).toBe(true);
  });

  it('does not count seat and table numbers sent across several messages as a phone number', () => {
    let streak = 0;
    for (const t of ['table 12', 'seat 5', 'floor 2', 'row 9']) {
      const r = checkContact(t, streak);
      expect(r.ok).toBe(true);
      streak = r.digitStreak;
    }
  });
});
