/**
 * DEMO DATA — development and testing only.
 * Fictional businesses, people and prices. Never ship this as production content.
 * Dates are generated relative to "now" so the demo stays current.
 */
import type {
  BusinessDetail, CategoryNode, EventDetail, MembershipPlan, OfferDetail,
} from '../types';
import type { OfferRule } from './pricing';

export const r = (rupees: number) => Math.round(rupees * 100);

/** ISO timestamp for `days` from today at hh:mm IST. */
export function atIST(days: number, hh: number, mm = 0, now = new Date()): string {
  const istNow = new Date(now.getTime() + 330 * 60_000);
  const d = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() + days, hh, mm);
  return new Date(d - 330 * 60_000).toISOString();
}
/** Days from today until the next given weekday (0=Sun..6=Sat), at least `min` days ahead. */
export function nextDow(dow: number, min = 1, now = new Date()): number {
  const today = new Date(now.getTime() + 330 * 60_000).getUTCDay();
  let diff = (dow - today + 7) % 7;
  if (diff < min) diff += 7;
  return diff;
}

const node = (id: string, name: string, children: CategoryNode[] = [], icon?: string): CategoryNode => ({
  id, slug: id.split('.').pop()!, name, icon, children,
});
/** "Men's Fashion" -> "mens-fashion", "Dessert Cafés" -> "dessert-cafes". */
export const slugify = (n: string) =>
  n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const leaves = (parent: string, names: string[]) => names.map((n) => node(`${parent}.${slugify(n)}`, n));

/** Mirrors what the admin dashboard will manage. The app renders whatever tree the API returns. */
export const categories: CategoryNode[] = [
  node('food', 'Food & Dining', [
    node('food.restaurants', 'Restaurants', leaves('food.restaurants', ['Multi-cuisine', 'Indian', 'South Indian', 'North Indian', 'Chinese', 'Continental', 'Italian'])),
    node('food.cafes', 'Cafés', leaves('food.cafes', ['Coffee Shops', 'Dessert Cafés', 'Work Cafés'])),
    node('food.bakeries', 'Bakeries & Desserts'),
    node('food.cloud-kitchens', 'Cloud Kitchens'),
    node('food.food-courts', 'Food Courts'),
    node('food.fine-dining', 'Fine Dining'),
    node('food.buffets', 'Buffets'),
  ], 'food'),
  node('shopping', 'Shopping', [
    node('shopping.fashion', 'Fashion', leaves('shopping.fashion', ["Men's Fashion", "Women's Fashion", "Kids' Fashion", 'Ethnic Wear', 'Western Wear'])),
    node('shopping.footwear', 'Footwear', leaves('shopping.footwear', ["Men's Footwear", "Women's Footwear", "Kids' Footwear", 'Sports Footwear'])),
    node('shopping.accessories', 'Accessories', leaves('shopping.accessories', ['Bags', 'Watches', 'Jewellery', 'Sunglasses'])),
    node('shopping.lifestyle', 'Lifestyle', leaves('shopping.lifestyle', ['Home Décor', 'Personal Care', 'Gifts', 'Stationery'])),
    node('shopping.electronics', 'Electronics', leaves('shopping.electronics', ['Mobiles', 'Gadgets', 'Electronics Accessories'])),
    node('shopping.boutiques', 'Local Boutiques'),
    node('shopping.multi-brand', 'Multi-brand Stores'),
  ], 'shopping'),
  node('fitness', 'Fitness & Wellness', [
    node('fitness.gyms', 'Gyms'),
    node('fitness.yoga', 'Yoga & Meditation'),
    node('fitness.sports', 'Sports', leaves('fitness.sports', ['Badminton', 'Swimming', 'Cricket', 'Football', 'Tennis', 'Skating', 'Martial Arts'])),
    node('fitness.wellness', 'Wellness'),
    node('fitness.training', 'Personal Training'),
  ], 'fitness'),
  node('beauty', 'Beauty & Personal Care', [
    node('beauty.salons', 'Salons'), node('beauty.skin-hair', 'Skin & Hair'), node('beauty.spa', 'Spa & Massage'),
    node('beauty.grooming', 'Grooming'), node('beauty.bridal', 'Bridal Services'),
  ], 'beauty'),
  node('kids', 'Kids & Family', [
    node('kids.indoor-play', 'Indoor Play'),
    node('kids.learning', 'Learning', leaves('kids.learning', ['Tuition', 'Music', 'Dance', 'Arts', 'Coding'])),
    node('kids.sports', 'Kids Sports', leaves('kids.sports', ['Swimming', 'Skating', 'Martial Arts'])),
    node('kids.celebrations', 'Celebrations', leaves('kids.celebrations', ['Birthday Venues', 'Decorations', 'Cakes', 'Photography'])),
    node('kids.family', 'Family Experiences'), node('kids.childcare', 'Childcare'),
  ], 'kids'),
  node('events', 'Events & Experiences', [
    node('events.workshops', 'Workshops'), node('events.meetups', 'Meetups'), node('events.tours', 'Tours'),
    node('events.live', 'Live Events'), node('events.experiences', 'Experiences'),
  ], 'ticket'),
  node('social', 'VIBE Social', [
    node('social.meet', 'Meet People'), node('social.groups', 'Groups'), node('social.activities', 'Activities'),
    node('social.communities', 'Communities'), node('social.events', 'Social Events'),
  ], 'social'),
  node('offers', 'Offers & Benefits', [
    node('offers.all', 'All Offers'), node('offers.nearby', 'Nearby Offers'), node('offers.trending', 'Trending Offers'),
    node('offers.new', 'Newly Added'), node('offers.ending', 'Ending Soon'), node('offers.member', 'Member Exclusive'),
  ], 'offer'),
];

export const open = (label = 'Open now') => ({ open: true, label, tone: 'success' as const });
export const closing = (label: string) => ({ open: true, label, tone: 'warning' as const });

export const week = (weekday: string, weekend: string) => {
  const today = new Date(Date.now() + 330 * 60_000).getUTCDay();
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, i) => ({
    day, hours: i === 5 || i === 6 ? weekend : weekday, today: i === today,
  }));
};

export type Biz = Omit<BusinessDetail, 'offers'>;
export const base = {
  verified: true, coverUrl: null, photos: [] as string[], isNew: false, hasMemberOffer: false, offerBadge: null, bookingEnabled: false,
  menu: [], branches: [], reviews: [], terms: ['Prices include applicable taxes unless stated.', 'Offers are subject to availability.'],
};

export const businesses: Biz[] = [
  {
    ...base, id: 'b-saffron', name: 'Saffron Courtyard', primaryCategoryId: 'food.restaurants',
    categoryIds: ['food.restaurants', 'food.restaurants.north-indian', 'food.buffets'],
    categoryNames: [{ id: 'food.restaurants', name: 'Restaurants', primary: true }, { id: 'food.restaurants.north-indian', name: 'North Indian', primary: false }, { id: 'food.buffets', name: 'Buffets', primary: false }],
    categoryLabel: 'Hyderabadi · North Indian', area: 'Jubilee Hills', distanceKm: 1.2, rating: 4.6, reviewCount: 1284, priceLevel: 3,
    costForTwo: r(1400), status: closing('Closes 11:30 PM'), offerBadge: '30% OFF · MEMBERS', hasMemberOffer: true, bookingEnabled: true,
    description: 'Slow-cooked Hyderabadi classics served in a lantern-lit courtyard. Dum biryani from a family recipe, kebabs off the charcoal grill and Irani chai to finish.',
    address: 'Road No. 36, Jubilee Hills, Hyderabad 500033', location: { lat: 17.4306, lng: 78.4071 },
    hours: week('12:00 PM – 11:30 PM', '12:00 PM – 12:30 AM'),
    menu: [
      { id: 'm1', name: 'Hyderabadi dum biryani', note: 'Chicken or mutton · serves 1', price: r(480), section: 'Mains' },
      { id: 'm2', name: 'Charcoal seekh kebab', note: '6 pieces', price: r(390), section: 'Starters' },
      { id: 'm3', name: 'Qubani ka meetha', note: 'Apricot dessert, cream', price: r(220), section: 'Desserts' },
      { id: 'm4', name: 'Irani chai & Osmania biscuits', note: 'Pot for two', price: r(120), section: 'Drinks' },
    ],
    branches: [
      { id: 'br1', name: 'Jubilee Hills', address: 'Road No. 36', distanceKm: 1.2, status: open() },
      { id: 'br2', name: 'Gachibowli', address: 'Financial District', distanceKm: 6.4, status: open() },
    ],
    reviews: [
      { id: 'rv1', authorName: 'Priya R.', rating: 5, text: 'The courtyard at night is gorgeous and the biryani is the real deal. Paying through VIBE applied the 30% off without any back-and-forth.', createdAt: atIST(-14, 21), verifiedVisit: true },
      { id: 'rv2', authorName: 'Arjun K.', rating: 4, text: 'Great kebabs, a bit of a wait on Friday evening. Book ahead on weekends.', createdAt: atIST(-30, 20), verifiedVisit: true },
    ],
  },
  {
    ...base, id: 'b-brew', name: 'Brew & Bloom Café', primaryCategoryId: 'food.cafes', categoryIds: ['food.cafes', 'food.cafes.work-cafes', 'food.cafes.coffee-shops'],
    categoryNames: [{ id: 'food.cafes', name: 'Cafés', primary: true }, { id: 'food.cafes.work-cafes', name: 'Work Cafés', primary: false }],
    categoryLabel: 'Café · Work-friendly', area: 'Banjara Hills', distanceKm: 0.8, rating: 4.7, reviewCount: 642, priceLevel: 2, costForTwo: r(600),
    status: open(), offerBadge: '1+1 COFFEE', hasMemberOffer: true,
    description: 'Specialty coffee, all-day breakfast and quiet corners with plugs. Beans roasted in small batches every week.',
    address: 'Road No. 12, Banjara Hills, Hyderabad 500034', location: { lat: 17.4126, lng: 78.4392 }, hours: week('8:00 AM – 10:00 PM', '8:00 AM – 11:00 PM'),
    menu: [
      { id: 'm1', name: 'Pour-over coffee', note: 'Single origin, Chikmagalur', price: r(220) },
      { id: 'm2', name: 'Avocado toast', note: 'Sourdough, chilli oil', price: r(340) },
    ],
  },
  {
    ...base, id: 'b-pulse', name: 'Pulse Studio', primaryCategoryId: 'fitness.gyms', categoryIds: ['fitness.gyms', 'fitness.training'],
    categoryNames: [{ id: 'fitness.gyms', name: 'Gyms', primary: true }, { id: 'fitness.training', name: 'Personal Training', primary: false }],
    categoryLabel: 'Gym · HIIT & strength', area: 'Kondapur', distanceKm: 3.4, rating: 4.8, reviewCount: 908, priceLevel: 3, costForTwo: null,
    status: open(), offerBadge: '₹500 OFF', hasMemberOffer: true, bookingEnabled: true,
    description: 'Small-group HIIT and strength classes with certified coaches. Class sizes capped at 14.',
    address: 'Botanical Garden Road, Kondapur, Hyderabad 500084', location: { lat: 17.4632, lng: 78.3634 }, hours: week('5:30 AM – 10:00 PM', '6:00 AM – 8:00 PM'),
    menu: [{ id: 'm1', name: 'Monthly membership', note: 'Unlimited classes', price: r(2999) }, { id: 'm2', name: 'Drop-in class', note: '50 minutes', price: r(450) }],
  },
  {
    ...base, id: 'b-lumiere', name: 'Lumière Salon', primaryCategoryId: 'beauty.salons', categoryIds: ['beauty.salons', 'beauty.skin-hair'],
    categoryNames: [{ id: 'beauty.salons', name: 'Salons', primary: true }, { id: 'beauty.skin-hair', name: 'Skin & Hair', primary: false }],
    categoryLabel: 'Hair & skin', area: 'Banjara Hills', distanceKm: 2.1, rating: 4.7, reviewCount: 455, priceLevel: 3, costForTwo: null,
    status: open(), offerBadge: '20% OFF', hasMemberOffer: true, bookingEnabled: true,
    description: 'Hair, skin and nail studio with senior stylists and appointment-only slots.',
    address: 'Road No. 2, Banjara Hills, Hyderabad 500034', location: { lat: 17.4183, lng: 78.4488 }, hours: week('10:00 AM – 8:30 PM', '9:00 AM – 9:00 PM'),
    menu: [{ id: 'm1', name: 'Haircut & styling', note: '45 min', price: r(900) }, { id: 'm2', name: 'Hydra facial', note: '60 min', price: r(2800) }],
  },
  {
    ...base, id: 'b-deccan', name: 'The Deccan Table', primaryCategoryId: 'food.fine-dining', categoryIds: ['food.fine-dining', 'food.restaurants.indian'],
    categoryNames: [{ id: 'food.fine-dining', name: 'Fine Dining', primary: true }],
    categoryLabel: 'Fine dining · Deccani', area: 'Gachibowli', distanceKm: 6.0, rating: 4.5, reviewCount: 380, priceLevel: 4, costForTwo: r(3200),
    status: open(), offerBadge: 'FREE DESSERT', description: 'A tasting-menu take on Deccani cuisine.',
    address: 'Financial District, Gachibowli, Hyderabad 500032', location: { lat: 17.4189, lng: 78.3418 }, hours: week('7:00 PM – 11:30 PM', '12:30 PM – 11:30 PM'),
  },
  {
    ...base, id: 'b-coastal', name: 'Coastal Curry House', primaryCategoryId: 'food.restaurants', categoryIds: ['food.restaurants', 'food.restaurants.south-indian'],
    categoryNames: [{ id: 'food.restaurants', name: 'Restaurants', primary: true }, { id: 'food.restaurants.south-indian', name: 'South Indian', primary: false }],
    categoryLabel: 'South Indian · Seafood', area: 'Banjara Hills', distanceKm: 2.0, rating: 4.5, reviewCount: 702, priceLevel: 2, costForTwo: r(1100),
    status: open(), offerBadge: 'FREE DESSERT', description: 'Andhra and Malabar coast seafood.',
    address: 'Road No. 10, Banjara Hills', location: { lat: 17.4152, lng: 78.4351 }, hours: week('12:00 PM – 11:00 PM', '12:00 PM – 11:30 PM'),
  },
  {
    ...base, id: 'b-dragon', name: 'Dragon Lane', primaryCategoryId: 'food.restaurants', categoryIds: ['food.restaurants', 'food.restaurants.chinese'],
    categoryNames: [{ id: 'food.restaurants', name: 'Restaurants', primary: true }, { id: 'food.restaurants.chinese', name: 'Chinese', primary: false }],
    categoryLabel: 'Chinese · Pan-Asian', area: 'Film Nagar', distanceKm: 2.6, rating: 4.3, reviewCount: 410, priceLevel: 2, costForTwo: r(900),
    status: closing('Closes 10 PM'), offerBadge: '15% OFF', description: 'Wok-fired Indo-Chinese and dim sum.',
    address: 'Film Nagar, Hyderabad 500096', location: { lat: 17.4124, lng: 78.4106 }, hours: week('12:00 PM – 10:00 PM', '12:00 PM – 10:30 PM'),
  },
  {
    ...base, id: 'b-trattoria', name: 'Trattoria Nove', primaryCategoryId: 'food.restaurants', categoryIds: ['food.restaurants', 'food.restaurants.italian'],
    categoryNames: [{ id: 'food.restaurants', name: 'Restaurants', primary: true }, { id: 'food.restaurants.italian', name: 'Italian', primary: false }],
    categoryLabel: 'Italian · Wood-fired', area: 'Jubilee Hills', distanceKm: 1.9, rating: 4.7, reviewCount: 530, priceLevel: 3, costForTwo: r(1800),
    status: open(), offerBadge: '1+1 PIZZA · TUE', description: 'Neapolitan pizza from a wood-fired oven, fresh pasta daily.',
    address: 'Road No. 45, Jubilee Hills', location: { lat: 17.4277, lng: 78.4011 }, hours: week('12:00 PM – 11:00 PM', '12:00 PM – 11:30 PM'),
  },
  {
    ...base, id: 'b-glow', name: 'Glow Grooming Lounge', primaryCategoryId: 'beauty.grooming', categoryIds: ['beauty.grooming'],
    categoryNames: [{ id: 'beauty.grooming', name: 'Grooming', primary: true }],
    categoryLabel: 'Grooming · Men', area: 'Film Nagar', distanceKm: 1.5, rating: 4.6, reviewCount: 311, priceLevel: 2, costForTwo: null,
    status: closing('Closes 9 PM'), offerBadge: '20% OFF', hasMemberOffer: true, bookingEnabled: true, description: 'Haircuts, beard care and express facials.',
    address: 'Film Nagar, Hyderabad 500096', location: { lat: 17.4141, lng: 78.4123 }, hours: week('10:00 AM – 9:00 PM', '9:00 AM – 9:00 PM'),
  },
  {
    ...base, id: 'b-irani', name: 'Irani Chai Corner', primaryCategoryId: 'food.cafes', categoryIds: ['food.cafes', 'food.cafes.coffee-shops'],
    categoryNames: [{ id: 'food.cafes', name: 'Cafés', primary: true }],
    categoryLabel: 'Café · Irani chai', area: 'Jubilee Hills', distanceKm: 1.0, rating: 4.4, reviewCount: 1210, priceLevel: 1, costForTwo: r(250),
    status: open(), offerBadge: '10% OFF', description: 'Irani chai, bun maska and Osmania biscuits since breakfast.',
    address: 'Road No. 1, Jubilee Hills', location: { lat: 17.4239, lng: 78.4155 }, hours: week('6:00 AM – 11:00 PM', '6:00 AM – 11:30 PM'),
  },
  {
    ...base, id: 'b-atelier', name: 'Atelier 36', primaryCategoryId: 'shopping.boutiques', categoryIds: ['shopping.boutiques', 'shopping.fashion.ethnic-wear'],
    categoryNames: [{ id: 'shopping.boutiques', name: 'Local Boutiques', primary: true }, { id: 'shopping.fashion.ethnic-wear', name: 'Ethnic Wear', primary: false }],
    categoryLabel: 'Boutique · Ethnic wear', area: 'Jubilee Hills', distanceKm: 1.4, rating: 4.6, reviewCount: 96, priceLevel: 3, costForTwo: null,
    status: open(), offerBadge: '15% OFF', isNew: true, hasMemberOffer: true, description: 'Handloom and contemporary ethnic wear by local designers.',
    address: 'Road No. 36, Jubilee Hills', location: { lat: 17.4311, lng: 78.4069 }, hours: week('11:00 AM – 9:00 PM', '11:00 AM – 9:30 PM'),
  },
  {
    ...base, id: 'b-explorers', name: 'Little Explorers', primaryCategoryId: 'kids.indoor-play', categoryIds: ['kids.indoor-play', 'kids.celebrations.birthday-venues'],
    categoryNames: [{ id: 'kids.indoor-play', name: 'Indoor Play', primary: true }, { id: 'kids.celebrations.birthday-venues', name: 'Birthday Venues', primary: false }],
    categoryLabel: 'Indoor play · Ages 2–10', area: 'Kokapet', distanceKm: 9.8, rating: 4.5, reviewCount: 188, priceLevel: 2, costForTwo: null,
    status: open(), offerBadge: null, isNew: true, bookingEnabled: true, description: 'Soft play, sensory zones and supervised sessions. Parents stay on site.',
    address: 'Kokapet, Hyderabad 500075', location: { lat: 17.3984, lng: 78.3283 }, hours: week('10:00 AM – 8:00 PM', '9:00 AM – 9:00 PM'),
  },
  {
    ...base, id: 'b-matcha', name: 'Matcha Lab', primaryCategoryId: 'food.cafes', categoryIds: ['food.cafes', 'food.cafes.dessert-cafes'],
    categoryNames: [{ id: 'food.cafes', name: 'Cafés', primary: true }, { id: 'food.cafes.dessert-cafes', name: 'Dessert Cafés', primary: false }],
    categoryLabel: 'Café · Matcha & desserts', area: 'Madhapur', distanceKm: 4.2, rating: 4.4, reviewCount: 64, priceLevel: 2, costForTwo: r(700),
    status: open(), offerBadge: null, isNew: true, description: 'Ceremonial-grade matcha drinks and Japanese-style desserts.',
    address: 'Madhapur, Hyderabad 500081', location: { lat: 17.4483, lng: 78.3915 }, hours: week('11:00 AM – 11:00 PM', '11:00 AM – 12:00 AM'),
  },
];

export type DemoOffer = OfferDetail & { rule: OfferRule };

export const offers: Omit<DemoOffer, 'coverUrl'>[] = [
  {
    id: 'o-saffron-30', businessId: 'b-saffron', businessName: 'Saffron Courtyard', area: 'Jubilee Hills', title: '30% off your total bill',
    type: 'percentage', headline: '30%', headlineSub: 'OFF', memberOnly: true, scheduleLabel: 'Mon–Thu, 12 PM – 11 PM', endsAt: atIST(21, 23, 59),
    maxDiscount: r(600), minBill: r(500), appliesTo: 'Food and non-alcoholic drinks on the dine-in bill', excludes: 'Alcohol, service charge, takeaway and gift cards',
    channels: ['Dine-in'], terms: [
      'One redemption per member per visit. Not valid with other offers.',
      'Discount is applied only when you pay the bill through VIBE.',
      'Taxes and charges are shown as billed by the merchant before you pay.',
      'The merchant issues its own tax invoice separately.',
    ],
    example: { bill: r(1000), discount: r(300), payable: r(700) },
    rule: { kind: 'percentage', rateBps: 3000, maxDiscount: r(600), minBill: r(500) },
  },
  {
    id: 'o-brew-bogo', businessId: 'b-brew', businessName: 'Brew & Bloom Café', area: 'Banjara Hills', title: 'Any handcrafted coffee, 1+1',
    type: 'bogo', headline: '1+1', headlineSub: 'COFFEE', memberOnly: true, scheduleLabel: 'Every day, 8 AM – 12 PM', endsAt: atIST(40, 12),
    maxDiscount: r(250), minBill: null, appliesTo: 'Handcrafted coffee from the bar menu', excludes: 'Packaged beans and merchandise', channels: ['Dine-in', 'Takeaway'],
    terms: ['Lower-priced coffee is free.', 'Pay through VIBE to apply.'], example: null,
    rule: { kind: 'flat', amount: r(220), minBill: r(400) },
  },
  {
    id: 'o-pulse-500', businessId: 'b-pulse', businessName: 'Pulse Studio', area: 'Kondapur', title: '₹500 off your first month',
    type: 'flat', headline: '₹500', headlineSub: 'OFF', memberOnly: true, scheduleLabel: 'New joiners only', endsAt: atIST(30, 22),
    maxDiscount: r(500), minBill: r(2000), appliesTo: 'Monthly unlimited membership', excludes: 'Personal training packs', channels: ['In-studio'],
    terms: ['Valid once per customer.', 'Pay through VIBE to apply.'], example: { bill: r(2999), discount: r(500), payable: r(2499) },
    rule: { kind: 'flat', amount: r(500), minBill: r(2000) },
  },
  {
    id: 'o-lumiere-20', businessId: 'b-lumiere', businessName: 'Lumière Salon', area: 'Banjara Hills', title: '20% off hair & skin services',
    type: 'percentage', headline: '20%', headlineSub: 'OFF', memberOnly: true, scheduleLabel: 'Weekdays', endsAt: atIST(14, 20),
    maxDiscount: r(1000), minBill: null, appliesTo: 'All hair and skin services', excludes: 'Retail products', channels: ['In-salon'],
    terms: ['Book ahead to guarantee a slot.'], example: { bill: r(2800), discount: r(560), payable: r(2240) },
    rule: { kind: 'percentage', rateBps: 2000, maxDiscount: r(1000), minBill: null },
  },
  {
    id: 'o-saffron-dessert', businessId: 'b-saffron', businessName: 'Saffron Courtyard', area: 'Jubilee Hills', title: 'Free dessert over ₹2,000',
    type: 'free_addon', headline: 'FREE', headlineSub: 'DESSERT', memberOnly: false, scheduleLabel: 'All week · dine-in', endsAt: atIST(10, 23),
    maxDiscount: r(220), minBill: r(2000), appliesTo: 'One Qubani ka meetha per table', excludes: 'Takeaway', channels: ['Dine-in'],
    terms: ['Available to all VIBE users.'], example: null, rule: { kind: 'flat', amount: r(220), minBill: r(2000) },
  },
  {
    id: 'o-glow-20', businessId: 'b-glow', businessName: 'Glow Grooming Lounge', area: 'Film Nagar', title: '20% off any grooming service',
    type: 'percentage', headline: '20%', headlineSub: 'OFF', memberOnly: true, scheduleLabel: 'Mon–Fri', endsAt: atIST(3, 21),
    maxDiscount: r(400), minBill: null, appliesTo: 'All services', excludes: 'Products', channels: ['In-store'], terms: ['One per visit.'], example: null,
    rule: { kind: 'percentage', rateBps: 2000, maxDiscount: r(400), minBill: null },
  },
];

export const sat = nextDow(6, 1);
export const sun = nextDow(0, 1);

export const events: EventDetail[] = [
  {
    id: 'e-jazz', title: 'Sunset Rooftop Jazz', kind: 'Live Events', startsAt: atIST(sat + 7, 19), gatesOpenAt: atIST(sat + 7, 18, 30), venue: 'Skyline Terrace', area: 'Hitech City',
    fromPrice: r(799), coverUrl: null, tag: { label: 'Few VIP left', tone: 'warning' }, soldOut: false, featured: true, organiser: 'Deccan Sound Co.', ageLimit: 18,
    description: 'A live jazz quartet as the sun goes down over the city, with a small-plates menu at the bar. Seating is first come, first served within each ticket type.',
    ticketTypes: [
      { id: 'tt-jazz-eb', name: 'Early Bird', description: 'Standing, limited release', price: r(799), remaining: 0, maxPerOrder: 4 },
      { id: 'tt-jazz-gen', name: 'General', description: 'Standing area', price: r(999), remaining: 120, maxPerOrder: 6 },
      { id: 'tt-jazz-vip', name: 'VIP', description: 'Reserved lounge seating + welcome drink', price: r(1499), remaining: 18, maxPerOrder: 4 },
    ],
    terms: ['18+ only. ID checked at the gate.', 'Tickets are non-transferable once checked in.', 'Full refund if cancelled 48 hours before the event.'],
  },
  {
    id: 'e-pottery', title: 'Pottery for Beginners', kind: 'Workshops', startsAt: atIST(nextDow(5, 1), 18), gatesOpenAt: atIST(nextDow(5, 1), 17, 45), venue: 'Clay Studio', area: 'Madhapur',
    fromPrice: r(1200), coverUrl: null, tag: { label: '6 seats left', tone: 'warning' }, soldOut: false, featured: false, organiser: 'Clay Studio', ageLimit: null,
    description: 'Learn to centre and throw on the wheel. All materials, aprons and firing included.',
    ticketTypes: [{ id: 'tt-pot', name: 'General', description: 'Includes materials and firing', price: r(1200), remaining: 6, maxPerOrder: 2 }],
    terms: ['Pieces are ready for pickup in 2 weeks.'],
  },
  {
    id: 'e-heritage', title: 'Old City Heritage Walk', kind: 'Tours', startsAt: atIST(sat, 6, 30), gatesOpenAt: atIST(sat, 6, 15), venue: 'Starts at Charminar', area: 'Old City',
    fromPrice: r(499), coverUrl: null, tag: { label: 'Early Bird', tone: 'pinkSoft' }, soldOut: false, featured: false, organiser: 'Hyderabad Walks', ageLimit: null,
    description: 'Two and a half hours through the lanes around Charminar, ending with breakfast at a century-old café.',
    ticketTypes: [
      { id: 'tt-her-eb', name: 'Early Bird', description: 'Walk + breakfast', price: r(499), remaining: 12, maxPerOrder: 4 },
      { id: 'tt-her-gen', name: 'General', description: 'Walk + breakfast', price: r(649), remaining: 25, maxPerOrder: 6 },
    ],
    terms: ['Wear comfortable shoes.'],
  },
  {
    id: 'e-standup', title: 'Stand-up Night', kind: 'Live Events', startsAt: atIST(sat, 20, 30), gatesOpenAt: atIST(sat, 20), venue: 'The Loft', area: 'Film Nagar',
    fromPrice: r(399), coverUrl: null, tag: { label: 'General · VIP', tone: 'muted' }, soldOut: false, featured: false, organiser: 'Loft Comedy', ageLimit: 16,
    description: 'Four comics, one host, ninety minutes.',
    ticketTypes: [
      { id: 'tt-su-gen', name: 'General', description: 'Unreserved seating', price: r(399), remaining: 60, maxPerOrder: 6 },
      { id: 'tt-su-vip', name: 'VIP', description: 'Front two rows', price: r(799), remaining: 10, maxPerOrder: 4 },
    ],
    terms: ['16+ only.'],
  },
  {
    id: 'e-brunch', title: 'Founders’ Sunday Brunch', kind: 'Meetups', startsAt: atIST(sun, 11), gatesOpenAt: atIST(sun, 10, 45), venue: 'Jubilee Hills', area: 'Jubilee Hills',
    fromPrice: r(650), coverUrl: null, tag: { label: 'Members first', tone: 'pink' }, soldOut: false, featured: false, organiser: 'VIBE Hosts', ageLimit: null,
    description: 'An unhurried brunch for founders and operators. No pitches, just good conversation.',
    ticketTypes: [{ id: 'tt-br', name: 'General', description: 'Brunch included', price: r(650), remaining: 14, maxPerOrder: 2 }],
    terms: [],
  },
  {
    id: 'e-boardgames', title: 'Board Game Night', kind: 'Experiences', startsAt: atIST(sun, 19), gatesOpenAt: atIST(sun, 18, 45), venue: 'Meeple Café', area: 'Kondapur',
    fromPrice: r(349), coverUrl: null, tag: { label: 'Sold out', tone: 'muted' }, soldOut: true, featured: false, organiser: 'Meeple Café', ageLimit: null,
    description: 'Hosted tables with 200+ games and a guide at every table.',
    ticketTypes: [{ id: 'tt-bg', name: 'General', description: 'Includes one drink', price: r(349), remaining: 0, maxPerOrder: 4 }],
    terms: [],
  },
];

export const membershipPlans: MembershipPlan[] = [
  { id: 'plan-monthly', name: 'Monthly', interval: 'month', price: r(299), note: 'Billed every month · cancel anytime', savingsLabel: null },
  { id: 'plan-annual', name: 'Annual', interval: 'year', price: r(2999), note: 'Billed yearly · about ₹250 a month', savingsLabel: 'SAVE ₹589' },
];

export const demoUser = { id: 'u-demo', name: 'Aarav Reddy', vibeId: '4821', memberNo: 'VB 4821 7730' };
export const DEMO_OTP = '123456';
