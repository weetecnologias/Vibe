/**
 * DEMO DATA — development and testing only. Every person here is fictional.
 * Members are shown by first name, age band and initials only — never photos,
 * surnames, phone numbers or exact ages.
 */
import type { MemberCard, OneOnOneInvite, SocialActivity, SocialGroup } from '../types';
import { businesses } from './catalog';
import { atIST, nextDow, r, sat, sun } from './data';
import { img } from './images';

/** A time `min` minutes from now, rounded up to 5 minutes, so "Within an hour" always has something. */
const inMin = (min: number) => new Date(Math.ceil((Date.now() + min * 60_000) / 300_000) * 300_000).toISOString();
/** A few hours from now but still today (IST) where possible, so "Today" always has something. */
function laterToday(): string {
  const now = Date.now();
  const t = Math.min(now + 3 * 3_600_000, Date.parse(atIST(0, 23, 0)));
  return new Date(Math.ceil((t > now + 75 * 60_000 ? t : now + 80 * 60_000) / 300_000) * 300_000).toISOString();
}
const km = (businessId: string) => businesses.find((b) => b.id === businessId)?.distanceKm ?? 5;

const act = (a: Omit<SocialActivity, 'myStatus' | 'hostVerified' | 'ageRange' | 'requiresIdVerification' | 'featured' | 'coverUrl'> & Partial<SocialActivity> & { key: string }): SocialActivity => {
  const { key, ...rest } = a;
  return { hostVerified: true, ageRange: null, requiresIdVerification: false, featured: false, myStatus: 'none', coverUrl: img(key, 960), ...rest };
};

export const socialActivities: SocialActivity[] = [
  // Hosted social events
  act({ id: 'sa-dinner', distanceKm: 1.2, section: 'social_event', key: 'dinner', title: 'Table for Eight: Deccan Flavours', kind: 'Dinner meetup', startsAt: atIST(nextDow(4, 1), 20),
    place: 'Saffron Courtyard', area: 'Jubilee Hills', price: r(1500), hostName: 'VIBE Hosts', hostId: 'h-vibe-hosts', going: 5, capacity: 8, approvalRequired: true, featured: true }),
  act({ id: 'sa-games', distanceKm: 3.4, section: 'social_event', key: 'boardgames', title: 'Game Night for New-in-Town', kind: 'Hosted social', startsAt: atIST(nextDow(5, 1), 19, 30),
    place: 'Meeple Café', area: 'Kondapur', price: r(349), hostName: 'VIBE Hosts', hostId: 'h-vibe-hosts', going: 12, capacity: 20, approvalRequired: false }),
  act({ id: 'sa-speed', distanceKm: 1.6, section: 'social_event', key: 'finedining', title: 'Speed Dating Night · 25–35', kind: 'Speed dating', startsAt: atIST(sat + 7, 19),
    place: 'Private venue', area: 'Jubilee Hills', price: r(999), hostName: 'VIBE Hosts', hostId: 'h-vibe-hosts', going: 14, capacity: 24, approvalRequired: true,
    ageRange: { min: 25, max: 35 }, requiresIdVerification: true }),
  // Member-run activities
  act({ id: 'sa-chai-soon', distanceKm: 1.0, section: 'activity', key: 'chai', title: 'Chai & quick board games', kind: 'Coffee meetup', startsAt: inMin(40),
    place: 'Irani Chai Corner', area: 'Jubilee Hills', price: null, hostName: 'Jubilee Hills Socials', hostId: 'h-jh-socials', going: 4, capacity: 8, approvalRequired: false }),
  act({ id: 'sa-doubles-today', distanceKm: 3.2, section: 'activity', key: 'badminton', title: 'Badminton doubles drop-in', kind: 'Sports meetup', startsAt: laterToday(),
    place: 'Smash Arena', area: 'Kondapur', price: r(150), hostName: 'Kondapur Smashers', hostId: 'h-kondapur-smashers', going: 6, capacity: 8, approvalRequired: false }),
  act({ id: 'sa-run', distanceKm: 6.8, section: 'activity', key: 'running', title: 'Sunday Sunrise Run · 5 km', kind: 'Running', startsAt: atIST(sun, 6),
    place: 'Necklace Road', area: 'Hussain Sagar', price: null, hostName: 'Deccan Runners', hostId: 'h-deccan-runners', going: 24, capacity: 40, approvalRequired: false }),
  act({ id: 'sa-cycle', distanceKm: 6, section: 'activity', key: 'cycling', title: 'Saturday Sunrise Ride · 30 km', kind: 'Cycling', startsAt: atIST(sat, 5, 45),
    place: 'Gachibowli cycling track', area: 'Gachibowli', price: null, hostName: 'Deccan Cyclists', hostId: 'h-deccan-cyclists', going: 18, capacity: 30, approvalRequired: false }),
  act({ id: 'sa-code', distanceKm: 0.8, section: 'activity', key: 'workcafe', title: 'Coffee & Code', kind: 'Coffee meetup', startsAt: atIST(nextDow(3, 1), 19, 30),
    place: 'Brew & Bloom Café', area: 'Banjara Hills', price: r(199), hostName: 'Ravi T.', hostId: 'h-ravi-t', going: 11, capacity: 20, approvalRequired: false }),
  act({ id: 'sa-books', distanceKm: 2.2, section: 'activity', key: 'books', title: 'Book Circle: Indian fiction', kind: 'Reading group', startsAt: atIST(sat, 17),
    place: 'Reading Room Café', area: 'Banjara Hills', price: null, hostName: 'Hyderabad Readers', hostId: 'h-hyderabad-readers', going: 9, capacity: 15, approvalRequired: true }),
  act({ id: 'sa-movie', distanceKm: 5.1, section: 'activity', key: 'movie', title: 'Movie Club: Friday classics', kind: 'Movie activity', startsAt: atIST(nextDow(5, 1), 21),
    place: 'Galleria Cinemas', area: 'Hitech City', price: r(250), hostName: 'Hyderabad Film Circle', hostId: 'h-film-circle', going: 16, capacity: 25, approvalRequired: false }),
];

const group = (id: string, kind: SocialGroup['kind'], name: string, description: string, privacy: SocialGroup['privacy'], memberCount: number, key: string): SocialGroup =>
  ({ id, kind, name, description, privacy, memberCount, myStatus: 'none', coverUrl: img(key) });

export const socialGroups: SocialGroup[] = [
  group('sg-runners', 'group', 'Deccan Runners', 'Running group · 3 runs a week', 'public', 1240, 'running'),
  group('sg-cyclists', 'group', 'Deccan Cyclists', 'Cycling group · weekend rides', 'public', 820, 'cycling'),
  group('sg-readers', 'group', 'Hyderabad Readers', 'Reading group · monthly picks', 'public', 460, 'books'),
  group('sg-food', 'community', 'Hyderabad Food Trail', 'Food community', 'public', 2100, 'biryani'),
  group('sg-pros', 'community', 'Hyderabad Professionals', 'Professional networking', 'public', 1560, 'workcafe'),
  group('sg-parents', 'community', 'Gachibowli Parents', 'Parents’ community · playdates & tips', 'private', 540, 'kids'),
  group('sg-founders', 'community', 'Founders’ Brunch Club', 'Entrepreneur community', 'private', 310, 'brunch'),
];

// ---------- One-on-one ----------
const member = (id: string, firstName: string, gender: MemberCard['gender'], ageBand: string, verified = true): MemberCard => ({ id, firstName, gender, ageBand, verified });

type Seed = Omit<OneOnOneInvite, 'status' | 'myStatus' | 'requests' | 'matchedWith' | 'coverUrl' | 'durationMin' | 'distanceKm'> & { key: string; durationMin?: number };
const invite = ({ key, durationMin = 60, ...s }: Seed): OneOnOneInvite =>
  ({ ...s, durationMin, distanceKm: km(s.venueBusinessId), status: 'open', myStatus: 'none', requests: [], matchedWith: null, coverUrl: img(key, 960) });

export const oneOnOnes: OneOnOneInvite[] = [
  invite({ id: 'oo-soon', key: 'coffee', kind: 'coffee', activity: 'Quick coffee before my next meeting', note: 'Free for 45 minutes. Happy to chat about anything.',
    venueName: 'Brew & Bloom Café', venueBusinessId: 'b-brew', area: 'Banjara Hills', startsAt: inMin(45), durationMin: 45, costNote: 'Each pays their own',
    host: member('m-kavya', 'Kavya', 'woman', '25–29'), openTo: 'anyone' }),
  invite({ id: 'oo-today', key: 'matcha', kind: 'coffee', activity: 'Matcha after work', note: 'Trying the new matcha place. Join me?',
    venueName: 'Matcha Lab', venueBusinessId: 'b-matcha', area: 'Madhapur', startsAt: laterToday(), costNote: 'Each pays their own',
    host: member('m-aditya', 'Aditya', 'man', '30–34'), openTo: 'anyone' }),
  invite({ id: 'oo-coffee', key: 'coffee', kind: 'coffee', activity: 'Coffee & conversation', note: 'New to Hyderabad. Happy to talk books, food and travel.',
    venueName: 'Brew & Bloom Café', venueBusinessId: 'b-brew', area: 'Banjara Hills', startsAt: atIST(sat, 17), costNote: 'Each pays their own',
    host: member('m-ananya', 'Ananya', 'woman', '25–29'), openTo: 'anyone' }),
  invite({ id: 'oo-badminton', key: 'badminton', kind: 'sport', activity: 'Shuttle badminton · singles', note: 'Intermediate level. Looking for a regular Sunday partner.',
    venueName: 'Smash Arena', venueBusinessId: 'b-smash', area: 'Kondapur', startsAt: atIST(sun, 7), costNote: 'Court ₹400, split equally',
    host: member('m-rohan', 'Rohan', 'man', '30–34'), openTo: 'anyone' }),
  invite({ id: 'oo-chai', key: 'chai', kind: 'coffee', activity: 'Chai & chat after work', note: 'Women only, please. Unwinding with Irani chai and bun maska.',
    venueName: 'Irani Chai Corner', venueBusinessId: 'b-irani', area: 'Jubilee Hills', startsAt: atIST(nextDow(4, 1), 18, 30), durationMin: 45, costNote: 'Each pays their own',
    host: member('m-farah', 'Farah', 'woman', '30–34'), openTo: 'women' }),
  invite({ id: 'oo-tennis', key: 'tennis', kind: 'sport', activity: 'Tennis rally · beginners', note: 'Just started lessons. Easy rallies, no scoring.',
    venueName: 'Baseline Tennis Club', venueBusinessId: 'b-baseline', area: 'Jubilee Hills', startsAt: atIST(sat, 7), costNote: 'Court ₹600, split equally',
    host: member('m-vikram', 'Vikram', 'man', '25–29'), openTo: 'men' }),
  invite({ id: 'oo-dinner', key: 'biryani', kind: 'food', activity: 'Dinner for two · Hyderabadi', note: 'Biryani fan looking for someone to share a table with.',
    venueName: 'Saffron Courtyard', venueBusinessId: 'b-saffron', area: 'Jubilee Hills', startsAt: atIST(nextDow(5, 1), 20), durationMin: 90, costNote: 'Bill split equally',
    host: member('m-karthik', 'Karthik', 'man', '30–34'), openTo: 'women' }),
  invite({ id: 'oo-doubles', key: 'badminton', kind: 'sport', activity: 'Badminton practice partner', note: 'Training for a club tournament. Women players, any level.',
    venueName: 'Smash Arena', venueBusinessId: 'b-smash', area: 'Kondapur', startsAt: atIST(nextDow(2, 1), 19), costNote: 'Court ₹400, split equally',
    host: member('m-divya', 'Divya', 'woman', '25–29'), openTo: 'women' }),
];

/** Fictional members who "ask to join" in the demo. */
export const demoRequesters: MemberCard[] = [
  member('m-priya', 'Priya', 'woman', '25–29'), member('m-arjun', 'Arjun', 'man', '30–34'), member('m-neha', 'Neha', 'woman', '30–34'), member('m-imran', 'Imran', 'man', '25–29'),
];
