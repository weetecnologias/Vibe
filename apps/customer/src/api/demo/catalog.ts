/**
 * DEMO DATA — development and testing only.
 * Builds the full demo catalogue: at least one fictional business in every
 * subcategory, generated offers, and placeholder photos for everything.
 */
import type { CategoryNode, EventDetail, OfferType } from '../types';
import { atIST, base, categories as tree, closing, events as coreEvents, offers as coreOffers, open, r, week, businesses as core, type Biz, type DemoOffer } from './data';
import { img } from './images';

// ---------- category photos ----------
const CATEGORY_IMAGE: Record<string, string> = {
  food: 'food', 'food.restaurants': 'restaurant', 'food.cafes': 'coffee', 'food.bakeries': 'bakery', 'food.cloud-kitchens': 'cloudkitchen',
  'food.food-courts': 'foodcourt', 'food.fine-dining': 'finedining', 'food.buffets': 'buffet',
  shopping: 'shopping', 'shopping.fashion': 'western', 'shopping.footwear': 'mensshoes', 'shopping.accessories': 'watches',
  'shopping.lifestyle': 'homedecor', 'shopping.electronics': 'gadgets', 'shopping.boutiques': 'boutique', 'shopping.multi-brand': 'multibrand',
  fitness: 'fitness', 'fitness.gyms': 'gym', 'fitness.yoga': 'yoga', 'fitness.sports': 'badminton', 'fitness.wellness': 'wellness', 'fitness.training': 'training',
  beauty: 'beauty', 'beauty.salons': 'salon', 'beauty.skin-hair': 'skin', 'beauty.spa': 'spa', 'beauty.grooming': 'grooming', 'beauty.bridal': 'bridal',
  kids: 'kids', 'kids.indoor-play': 'kids', 'kids.learning': 'tuition', 'kids.sports': 'swimming', 'kids.celebrations': 'birthday',
  'kids.family': 'family', 'kids.childcare': 'childcare',
  movies: 'movie',
  events: 'events', 'events.workshops': 'pottery', 'events.meetups': 'brunch', 'events.tours': 'charminar', 'events.live': 'jazz', 'events.experiences': 'boardgames',
  social: 'social', 'social.meet': 'coffee', 'social.groups': 'running', 'social.activities': 'cycling', 'social.communities': 'books', 'social.events': 'dinner',
  offers: 'offers',
};

function withImages(nodes: CategoryNode[], parentKey?: string): CategoryNode[] {
  return nodes.map((n) => {
    const key = CATEGORY_IMAGE[n.id] ?? parentKey;
    return { ...n, imageUrl: key ? img(key) : null, children: withImages(n.children, key) };
  });
}
export const categories: CategoryNode[] = withImages(tree);

const index = new Map<string, CategoryNode>();
(function walk(nodes: CategoryNode[]) { for (const n of nodes) { index.set(n.id, n); walk(n.children); } })(tree);

// ---------- core businesses: add photos ----------
const CORE: Record<string, { photos: string[]; menu?: string[] }> = {
  'b-saffron': { photos: ['biryani', 'restaurant', 'kebab'], menu: ['biryani', 'kebab', 'dessert', 'chai'] },
  'b-brew': { photos: ['coffee', 'workcafe'], menu: ['coffee', 'brunch'] },
  'b-pulse': { photos: ['gym', 'training'] },
  'b-lumiere': { photos: ['salon', 'skin'] },
  'b-deccan': { photos: ['finedining', 'indian'] },
  'b-coastal': { photos: ['southindian', 'indian'] },
  'b-dragon': { photos: ['chinese', 'restaurant'] },
  'b-trattoria': { photos: ['italian', 'restaurant'] },
  'b-glow': { photos: ['grooming'] },
  'b-irani': { photos: ['chai', 'workcafe'] },
  'b-atelier': { photos: ['boutique', 'ethnic'] },
  'b-explorers': { photos: ['kids', 'birthday'] },
  'b-matcha': { photos: ['matcha', 'dessert'] },
};
const urls = (keys: string[], w: 500 | 960) => keys.map((k) => img(k, w)).filter((u): u is string => !!u);

const KIDS_TERMS = [
  'A parent or guardian must accept the venue’s consent form before the first session.',
  'Children’s details are shared with the venue only for the booked session.',
];

const coreBusinesses: Biz[] = core.map((b) => {
  const c = CORE[b.id];
  if (!c) return b;
  return {
    ...b,
    coverUrl: img(c.photos[0]),
    photos: urls(c.photos, 960),
    menu: b.menu.map((m, i) => ({ ...m, imageUrl: c.menu?.[i] ? img(c.menu[i]) : null })),
    terms: b.primaryCategoryId.startsWith('kids') ? [...b.terms, ...KIDS_TERMS] : b.terms,
  };
});

// ---------- one fictional business per subcategory ----------
type OfferSpec = {
  pct?: number; flat?: number; member?: boolean; max?: number; minBill?: number;
  title?: string; headline?: string; sub?: string; type?: OfferType;
};
type OfferSpecEntry = { bizId: string; name: string; area: string; key: string; spec: OfferSpec };
const specs: OfferSpecEntry[] = [];

/** Core businesses whose cards advertise an offer get a real, redeemable one. */
const CORE_OFFERS: Record<string, OfferSpec> = {
  'b-deccan': { flat: 350, title: 'Free dessert with any tasting menu', headline: 'FREE', sub: 'DESSERT', type: 'free_addon', minBill: 2500 },
  'b-coastal': { flat: 180, title: 'Free dessert over ₹1,200', headline: 'FREE', sub: 'DESSERT', type: 'free_addon', minBill: 1200 },
  'b-dragon': { pct: 15, max: 300 },
  'b-trattoria': { flat: 450, title: 'Buy one pizza, get one free on Tuesdays', headline: '1+1', sub: 'PIZZA', type: 'bogo', minBill: 900 },
  'b-irani': { pct: 10, max: 100 },
  'b-atelier': { pct: 15, member: true, max: 1500 },
};
for (const b of coreBusinesses) {
  const spec = CORE_OFFERS[b.id];
  if (spec) specs.push({ bizId: b.id, name: b.name, area: b.area, key: CORE[b.id].photos[0], spec });
}

type Item = [name: string, note: string, rupees: number];
type Opts = { two?: number; book?: boolean; isNew?: boolean; closes?: string; offer?: OfferSpec; terms?: string[] };

const AREA: Record<string, [number, number]> = {
  'Jubilee Hills': [17.4306, 78.4071], 'Banjara Hills': [17.4126, 78.4392], Gachibowli: [17.4401, 78.3489], 'Hitech City': [17.4474, 78.3762],
  Madhapur: [17.4483, 78.3915], Kondapur: [17.4632, 78.3634], Kukatpally: [17.4849, 78.4138], Secunderabad: [17.4399, 78.4983],
  Begumpet: [17.4447, 78.4664], Himayatnagar: [17.4012, 78.4867], Kokapet: [17.3984, 78.3283], 'Old City': [17.3616, 78.4747],
};
const HOURS: Record<string, [string, string]> = {
  food: ['11:00 AM – 11:00 PM', '11:00 AM – 11:30 PM'], shopping: ['10:30 AM – 9:30 PM', '10:30 AM – 10:00 PM'],
  fitness: ['6:00 AM – 10:00 PM', '6:00 AM – 9:00 PM'], beauty: ['10:00 AM – 8:30 PM', '9:30 AM – 9:00 PM'], kids: ['9:30 AM – 7:30 PM', '9:30 AM – 8:00 PM'],
  movies: ['10:00 AM – 12:30 AM', '9:00 AM – 1:30 AM'],
};

function badgeOf(s: OfferSpec): string {
  const head = s.headline ? `${s.headline} ${s.sub ?? ''}`.trim() : s.pct ? `${s.pct}% OFF` : `₹${s.flat} OFF`;
  return s.member ? `${head} · MEMBERS` : head;
}

let n = 0;
function biz(
  id: string, name: string, cat: string, label: string, area: string, km: number, rating: number, reviews: number,
  price: 1 | 2 | 3 | 4, key: string, description: string, items: Item[], o: Opts = {},
): Biz {
  const parts = cat.split('.');
  const root = parts[0];
  const ids = parts.slice(1).map((_, i) => parts.slice(0, i + 2).join('.'));
  const [lat, lng] = AREA[area];
  const [wd, we] = HOURS[root];
  n += 1;
  if (o.offer) specs.push({ bizId: id, name, area, key, spec: o.offer });
  return {
    ...base, id, name, primaryCategoryId: cat, categoryIds: ids,
    categoryNames: [...ids].reverse().map((cid) => ({ id: cid, name: index.get(cid)?.name ?? cid, primary: cid === cat })),
    categoryLabel: label, area, distanceKm: km, rating, reviewCount: reviews, priceLevel: price,
    costForTwo: o.two ? r(o.two) : null,
    status: o.closes ? closing(o.closes) : open(),
    coverUrl: img(key), photos: urls([key, CATEGORY_IMAGE[ids[0]] ?? root].filter((k, i, a) => a.indexOf(k) === i), 960),
    offerBadge: o.offer ? badgeOf(o.offer) : null, hasMemberOffer: !!o.offer?.member,
    isNew: !!o.isNew, bookingEnabled: !!o.book,
    description, address: `${area}, Hyderabad`,
    location: { lat: lat + (n % 7) * 0.0011, lng: lng + (n % 5) * 0.0013 },
    hours: week(wd, we),
    menu: items.map(([iname, note, rupees], i) => ({ id: `${id}-m${i + 1}`, name: iname, note, price: r(rupees), imageUrl: null })),
    terms: root === 'kids' ? [...base.terms, ...KIDS_TERMS, ...(o.terms ?? [])] : [...base.terms, ...(o.terms ?? [])],
  };
}

const extraBusinesses: Biz[] = [
  // Food & Dining
  biz('b-junction', 'Deccan Junction', 'food.restaurants.multi-cuisine', 'Multi-cuisine · Family dining', 'Madhapur', 4.4, 4.3, 870, 2, 'restaurant',
    'All-day family restaurant with North Indian, Chinese and continental favourites under one roof.',
    [['Paneer tikka platter', 'Serves 2', 360], ['Veg hakka noodles', 'Wok-tossed', 240]], { two: 1000, offer: { pct: 15, max: 400 } }),
  biz('b-oakember', 'Oak & Ember', 'food.restaurants.continental', 'Continental · Grill', 'Jubilee Hills', 2.3, 4.5, 412, 3, 'continental',
    'Wood-fired grills, roasts and salads with a short seasonal menu.',
    [['Herb-grilled chicken', 'With roast vegetables', 520], ['Mushroom risotto', 'Arborio, parmesan', 460]], { two: 1900, book: true }),
  biz('b-crumb', 'Crumb & Co. Bakery', 'food.bakeries', 'Bakery · Desserts', 'Banjara Hills', 1.7, 4.6, 530, 2, 'bakery',
    'Sourdough, croissants and celebration cakes baked fresh every morning.',
    [['Butter croissant', 'Baked at 7 AM', 140], ['Chocolate truffle cake', '500 g', 650]], { two: 500, offer: { pct: 10, member: true, max: 200 } }),
  biz('b-tiffinlab', 'Tiffin Lab', 'food.cloud-kitchens', 'Cloud kitchen · Pickup only', 'Kondapur', 3.9, 4.2, 1340, 1, 'cloudkitchen',
    'Home-style meal boxes cooked to order. Order ahead and pick up from the counter.',
    [['Andhra meal box', 'Rice, dal, 2 curries', 180], ['Millet khichdi bowl', 'With papad', 160]], { two: 350, isNew: true }),
  biz('b-galleria', 'Galleria Food Court', 'food.food-courts', 'Food court · 14 counters', 'Hitech City', 5.1, 4.1, 2210, 2, 'foodcourt',
    'Fourteen counters from dosas to dim sum, with shared seating for 300.',
    [['Counter meal combo', 'Main + drink at any counter', 260]], { two: 600 }),
  biz('b-nawabi', 'Nawabi Spread', 'food.buffets', 'Buffet · Hyderabadi & North Indian', 'Begumpet', 6.2, 4.4, 960, 3, 'buffet',
    'Lunch and dinner buffets with live kebab and chaat counters.',
    [['Weekday lunch buffet', '12–3:30 PM', 799], ['Weekend dinner buffet', '7–11 PM', 1099]],
    { two: 1800, book: true, offer: { flat: 200, title: '₹200 off the dinner buffet for two', minBill: 1500 } }),

  // Shopping
  biz('b-tailoredco', 'The Tailored Co.', 'shopping.fashion.mens-fashion', 'Men’s fashion · Formals & casuals', 'Banjara Hills', 2.4, 4.4, 310, 3, 'mens',
    'Shirts, suits and smart casuals with in-store alterations.',
    [['Linen shirt', 'Slim and regular fit', 1899], ['Made-to-measure suit', '2 fittings', 14999]], { offer: { pct: 15, member: true, max: 1500 } }),
  biz('b-meraki', 'Meraki Label', 'shopping.fashion.womens-fashion', 'Women’s fashion · Contemporary', 'Jubilee Hills', 1.6, 4.5, 268, 3, 'womens',
    'Contemporary dresses, co-ords and workwear from Indian designers.', [['Cotton midi dress', 'XS–XL', 2499]]),
  biz('b-tinythreads', 'Tiny Threads', 'shopping.fashion.kids-fashion', 'Kids’ fashion · 0–12 years', 'Kondapur', 3.6, 4.5, 190, 2, 'kidswear',
    'Soft cotton everyday wear and festive outfits for children up to 12.', [['Organic cotton set', '2-piece', 899]], { isNew: true }),
  biz('b-zari', 'Zari House', 'shopping.fashion.ethnic-wear', 'Ethnic wear · Sarees & lehengas', 'Himayatnagar', 7.4, 4.6, 720, 3, 'ethnic',
    'Handloom sarees, lehengas and festive wear from weavers across Telangana.',
    [['Pochampally ikat saree', 'Handloom silk-cotton', 4800], ['Gadwal silk saree', 'With zari border', 9500]], { offer: { pct: 10, max: 1000 } }),
  biz('b-denimdock', 'Denim Dock', 'shopping.fashion.western-wear', 'Western wear · Denim & tees', 'Madhapur', 4.1, 4.2, 455, 2, 'western',
    'Jeans, tees and jackets with free hemming while you wait.', [['Straight-fit jeans', 'Free hemming', 1799]]),
  biz('b-solebrothers', 'Sole Brothers', 'shopping.footwear.mens-footwear', 'Men’s footwear · Leather', 'Banjara Hills', 2.2, 4.4, 233, 3, 'mensshoes',
    'Hand-finished leather formals and loafers.', [['Leather Oxford', 'Hand-finished', 3499]]),
  biz('b-heelhouse', 'Heel House', 'shopping.footwear.womens-footwear', 'Women’s footwear · Heels & flats', 'Jubilee Hills', 1.8, 4.3, 198, 2, 'womensshoes',
    'Heels, flats and festive juttis in half sizes.', [['Block-heel sandals', 'Sizes 35–41', 1999]], { offer: { pct: 20, member: true, max: 800 } }),
  biz('b-littlesteps', 'Little Steps', 'shopping.footwear.kids-footwear', 'Kids’ footwear · First walkers to school', 'Kukatpally', 8.3, 4.5, 144, 2, 'kidsshoes',
    'Properly fitted shoes for growing feet, with free foot measuring.', [['School shoes', 'Free fitting', 1099]]),
  biz('b-stride', 'Stride Sports', 'shopping.footwear.sports-footwear', 'Sports footwear · Running & court', 'Gachibowli', 5.6, 4.6, 520, 3, 'sportsshoes',
    'Running, badminton and football shoes with gait analysis on a treadmill.', [['Running shoes', 'With gait analysis', 5499]], { offer: { pct: 10, max: 700 } }),
  biz('b-carryall', 'Carryall Studio', 'shopping.accessories.bags', 'Bags · Leather & travel', 'Banjara Hills', 2.6, 4.3, 176, 3, 'bags',
    'Totes, backpacks and travel bags, with monogramming in store.', [['Leather tote', 'Monogramming included', 3299]]),
  biz('b-tictoc', 'Tic Toc Timepieces', 'shopping.accessories.watches', 'Watches · Sales & service', 'Secunderabad', 9.1, 4.5, 388, 3, 'watches',
    'Analogue and smart watches, plus battery and strap service on site.',
    [['Automatic watch', '2-year warranty', 12500], ['Battery replacement', '15 minutes', 250]]),
  biz('b-nizamjewels', 'Nizam Heritage Jewels', 'shopping.accessories.jewellery', 'Jewellery · Gold & pearls', 'Old City', 11.5, 4.7, 940, 4, 'jewellery',
    'Hyderabadi pearls and hallmarked gold from a fourth-generation family jeweller.',
    [['Hyderabadi pearl string', 'Single line, certified', 6500]],
    { offer: { flat: 1000, member: true, title: '₹1,000 off making charges', headline: '₹1,000', sub: 'OFF', minBill: 20000 } }),
  biz('b-shadesclub', 'Shades Club', 'shopping.accessories.sunglasses', 'Sunglasses · Eyewear', 'Hitech City', 5.3, 4.2, 131, 2, 'sunglasses',
    'Polarised sunglasses and prescription frames with same-day lenses.', [['Polarised sunglasses', 'UV400', 1899]]),
  biz('b-neststory', 'Nest Story', 'shopping.lifestyle.home-decor', 'Home décor · Furnishings', 'Jubilee Hills', 2.0, 4.5, 265, 3, 'homedecor',
    'Hand-block cushions, brassware and lighting from Indian makers.',
    [['Block-print cushion set', 'Set of 2', 1299], ['Brass table lamp', 'Handmade', 3800]]),
  biz('b-glowbar', 'The Glow Bar', 'shopping.lifestyle.personal-care', 'Personal care · Skincare & fragrance', 'Madhapur', 4.5, 4.4, 302, 2, 'personalcare',
    'Skincare, haircare and fragrance with testers for everything on the shelf.', [['Skincare starter kit', '3 products', 1499]],
    { offer: { pct: 15, member: true, max: 500 } }),
  biz('b-wrapped', 'Wrapped Gifting Co.', 'shopping.lifestyle.gifts', 'Gifts · Hampers', 'Banjara Hills', 2.8, 4.6, 221, 2, 'gifts',
    'Custom hampers and same-day gift wrapping for birthdays, weddings and festivals.', [['Festive hamper', 'Customisable', 1999]]),
  biz('b-papertrail', 'Paper Trail', 'shopping.lifestyle.stationery', 'Stationery · Art supplies', 'Himayatnagar', 7.0, 4.6, 410, 1, 'stationery',
    'Notebooks, fountain pens and art supplies for students and hobbyists.', [['Dotted notebook', 'A5, 160 pages', 349]]),
  biz('b-dialup', 'Dial Up Mobiles', 'shopping.electronics.mobiles', 'Mobiles · Sales & exchange', 'Kukatpally', 8.6, 4.2, 1180, 3, 'mobiles',
    'New phones, exchange offers and same-day screen repairs.', [['Screen protection plan', '1 year', 999]]),
  biz('b-gizmo', 'Gizmo Garage', 'shopping.electronics.gadgets', 'Gadgets · Audio & wearables', 'Hitech City', 5.0, 4.4, 640, 3, 'gadgets',
    'Headphones, smartwatches and smart-home gear you can try before you buy.', [['Wireless earbuds', '1-year warranty', 3999]],
    { offer: { pct: 10, max: 1000 } }),
  biz('b-plugnplay', 'Plug & Play', 'shopping.electronics.electronics-accessories', 'Accessories · Cases & chargers', 'Madhapur', 4.3, 4.1, 520, 1, 'eaccessories',
    'Cases, chargers and cables for most phone and laptop models.', [['Fast charger', '65 W', 1299], ['Phone case', 'Most models', 399]]),
  biz('b-centralsq', 'Central Square', 'shopping.multi-brand', 'Multi-brand · 60+ labels', 'Gachibowli', 6.1, 4.3, 1650, 3, 'multibrand',
    'Fashion, footwear and home across three floors, with a personal shopper on request.', [['Gift card', 'Any amount from', 500]],
    { offer: { pct: 5, max: 500 } }),

  // Fitness & Wellness
  biz('b-stillpoint', 'Still Point Yoga', 'fitness.yoga', 'Yoga & meditation', 'Jubilee Hills', 1.3, 4.8, 356, 2, 'yoga',
    'Hatha, vinyasa and guided meditation in batches of 12.', [['Drop-in class', '60 minutes', 400], ['Monthly pass', 'Unlimited', 2800]],
    { book: true, offer: { flat: 400, title: 'First class free', headline: 'FREE', sub: 'TRIAL', type: 'free_addon' } }),
  biz('b-smash', 'Smash Arena', 'fitness.sports.badminton', 'Badminton · 6 synthetic courts', 'Kondapur', 3.2, 4.6, 780, 2, 'badminton',
    'Six synthetic courts with coaching for beginners and club players.',
    [['Court hire', '1 hour, up to 4 players', 400], ['Coaching batch', '12 sessions a month', 2500]], { book: true, offer: { pct: 20, member: true, max: 300 } }),
  biz('b-bluelane', 'Blue Lane Aquatics', 'fitness.sports.swimming', 'Swimming · 25 m pool', 'Gachibowli', 5.9, 4.5, 430, 3, 'swimming',
    'A 25-metre temperature-controlled pool with lane swimming and adult lessons.', [['Lane swim', '45 minutes', 300], ['Learn-to-swim', '12 lessons', 4500]], { book: true }),
  biz('b-coverdrive', 'Cover Drive Academy', 'fitness.sports.cricket', 'Cricket · Nets & coaching', 'Kukatpally', 8.8, 4.4, 290, 2, 'cricket',
    'Turf and matting nets with bowling machines and weekend coaching.', [['Net session', '30 minutes with bowling machine', 350]], { book: true }),
  biz('b-turf5', 'Turf 5', 'fitness.sports.football', 'Football · 5-a-side turf', 'Madhapur', 4.7, 4.5, 910, 2, 'football',
    'Two floodlit 5-a-side pitches, open till midnight.', [['Turf hire', '1 hour, floodlit', 1400]], { book: true, offer: { pct: 10, max: 200 } }),
  biz('b-baseline', 'Baseline Tennis Club', 'fitness.sports.tennis', 'Tennis · Clay & hard courts', 'Jubilee Hills', 2.5, 4.6, 240, 3, 'tennis',
    'Four courts, ball machine hire and certified coaches.', [['Court hire', '1 hour', 600], ['Private lesson', 'With certified coach', 1200]], { book: true }),
  biz('b-rollhouse', 'Roll House', 'fitness.sports.skating', 'Skating · Indoor rink', 'Kokapet', 9.6, 4.3, 175, 2, 'skating',
    'An indoor rink with skate hire and open sessions every evening.', [['Rink session', '1 hour, skates included', 350]], { book: true }),
  biz('b-dojo', 'Dragon Dojo', 'fitness.sports.martial-arts', 'Martial arts · Karate & kickboxing', 'Begumpet', 6.5, 4.7, 320, 2, 'martial',
    'Karate, kickboxing and self-defence for adults, taught by black-belt instructors.',
    [['Trial class', '60 minutes', 300], ['Monthly training', '3 days a week', 2200]], { book: true }),
  biz('b-recover', 'Recover Wellness', 'fitness.wellness', 'Wellness · Physio & recovery', 'Banjara Hills', 2.9, 4.6, 210, 3, 'wellness',
    'Physiotherapy, sports massage and recovery sessions by appointment.', [['Sports massage', '45 minutes', 1500], ['Physio assessment', 'With plan', 900]], { book: true }),
  biz('b-coach', 'Coach Collective', 'fitness.training', 'Personal training · 1:1 coaching', 'Hitech City', 5.4, 4.7, 188, 3, 'training',
    'Certified personal trainers for strength, weight loss and return from injury.',
    [['Single PT session', '60 minutes', 1200], ['12-session pack', 'Valid 6 weeks', 12000]], { book: true, offer: { pct: 10, member: true, max: 1200 } }),

  // Beauty & Personal Care
  biz('b-dermaglow', 'Derma Glow Clinic', 'beauty.skin-hair', 'Skin & hair · Dermatologist-led', 'Jubilee Hills', 1.5, 4.5, 505, 3, 'skin',
    'Dermatologist-led skin and hair treatments with a consultation first.', [['Skin consultation', 'With a dermatologist', 700], ['Hair spa', '60 minutes', 1800]], { book: true }),
  biz('b-serenity', 'Serenity Spa', 'beauty.spa', 'Spa & massage', 'Banjara Hills', 2.7, 4.7, 610, 4, 'spa',
    'Quiet treatment rooms, trained therapists and a steam room.', [['Swedish massage', '60 minutes', 2800], ['Aromatherapy', '90 minutes', 3900]],
    { book: true, offer: { pct: 25, member: true, max: 1000 } }),
  biz('b-shaadi', 'Shaadi Studio', 'beauty.bridal', 'Bridal · Makeup & mehndi', 'Secunderabad', 9.4, 4.8, 277, 4, 'bridal',
    'Bridal makeup, hair and mehndi with a trial session before the big day.', [['Bridal makeup', 'HD, with trial', 18000], ['Bridal mehndi', 'Both hands and feet', 6000]], { book: true }),

  // Kids & Family
  biz('b-brightdesk', 'Bright Desk Tuitions', 'kids.learning.tuition', 'Tuition · Classes 1–10', 'Kukatpally', 8.1, 4.5, 165, 2, 'tuition',
    'Small-batch maths and science tuition for classes 1 to 10. Ages 6–16.', [['Maths & science', 'Monthly, 3 days a week', 2500]], { book: true }),
  biz('b-littlemaestro', 'Little Maestro', 'kids.learning.music', 'Music · Piano, guitar, vocals', 'Banjara Hills', 2.3, 4.7, 204, 2, 'music',
    'One-to-one and group music lessons with graded exams. Ages 5 and up.', [['Piano lessons', '4 classes a month', 3200]],
    { book: true, offer: { flat: 800, title: 'Free trial class', headline: 'FREE', sub: 'TRIAL', type: 'free_addon' } }),
  biz('b-twirl', 'Twirl Dance Studio', 'kids.learning.dance', 'Dance · Ages 4–14', 'Madhapur', 4.0, 4.6, 233, 2, 'dance',
    'Bollywood, classical and contemporary batches grouped by age.', [['Kids dance batch', '8 classes a month', 2400]], { book: true }),
  biz('b-splatter', 'Splatter Art Room', 'kids.learning.arts', 'Arts · Painting & craft', 'Jubilee Hills', 1.9, 4.6, 149, 2, 'arts',
    'A messy-play art studio with aprons, non-toxic paints and weekly themes. Ages 3–12.', [['Open studio', '90 minutes, materials included', 600]], { book: true }),
  biz('b-codecubs', 'Code Cubs', 'kids.learning.coding', 'Coding · Ages 7–15', 'Gachibowli', 5.7, 4.5, 172, 3, 'coding',
    'Scratch, Python and robotics in groups of six.', [['Scratch & Python', '8 classes a month', 3500]], { book: true, isNew: true }),
  biz('b-tadpoles', 'Tadpoles Swim School', 'kids.sports.swimming', 'Kids swimming · Ages 4+', 'Gachibowli', 6.0, 4.6, 260, 3, 'swimming',
    'Warm-water learner pool with one coach for every four children and lifeguards on deck.', [['Learn-to-swim', '8 lessons', 3600]], { book: true }),
  biz('b-miniwheels', 'Mini Wheels Skating', 'kids.sports.skating', 'Kids skating · Ages 5+', 'Kokapet', 9.7, 4.4, 118, 2, 'skating',
    'Beginner and speed-skating batches with helmets and pads provided.', [['Beginner batch', '8 classes, gear included', 2000]], { book: true }),
  biz('b-littleninjas', 'Little Ninjas', 'kids.sports.martial-arts', 'Kids martial arts · Ages 5–14', 'Begumpet', 6.6, 4.7, 196, 2, 'martial',
    'Karate and taekwondo with a focus on discipline, balance and confidence.', [['Kids karate', '8 classes a month', 1800]], { book: true }),
  biz('b-partybarn', 'The Party Barn', 'kids.celebrations.birthday-venues', 'Birthday venue · Up to 60 guests', 'Kondapur', 3.8, 4.5, 221, 3, 'birthday',
    'A private party hall with a soft-play corner, host and catering options.', [['Party package', '3 hours, up to 30 guests', 18000]], { book: true }),
  biz('b-balloon', 'Balloon & Bloom', 'kids.celebrations.decorations', 'Decorations · Themed set-ups', 'Madhapur', 4.4, 4.4, 133, 2, 'decorations',
    'Themed balloon and backdrop set-ups at your home or venue.', [['Themed decoration', 'Set-up and take-down', 4500]]),
  biz('b-sugardust', 'Sugar Dust Cakery', 'kids.celebrations.cakes', 'Cakes · Custom orders', 'Banjara Hills', 2.1, 4.7, 480, 2, 'cakes',
    'Custom theme cakes and cupcakes, with eggless options.', [['Custom theme cake', '1 kg, 2 days’ notice', 1800]], { offer: { pct: 10, max: 300 } }),
  biz('b-tinyframes', 'Tiny Frames', 'kids.celebrations.photography', 'Photography · Birthdays & families', 'Jubilee Hills', 2.6, 4.6, 97, 3, 'photography',
    'Birthday and family photography with an edited online gallery.', [['Birthday coverage', '3 hours, edited gallery', 9000]], { book: true }),
  biz('b-wonderworld', 'Wonder World', 'kids.family', 'Family experiences · Rides & games', 'Kokapet', 10.2, 4.3, 1420, 3, 'family',
    'Rides, arcade games and a toddler zone for a full family day out.', [['Day pass', 'All rides', 899]], { book: true, offer: { pct: 15, member: true, max: 400 } }),
  biz('b-nestcare', 'Little Nest Daycare', 'kids.childcare', 'Childcare · 6 months to 6 years', 'Gachibowli', 5.5, 4.6, 142, 3, 'childcare',
    'Licensed daycare with CCTV access for parents and background-checked carers.',
    [['Full-day care', 'Monthly', 9500], ['Half-day care', 'Monthly', 6000]],
    { book: true, terms: ['VIBE checks childcare licences and staff verification before listing a provider.'] }),

  // Movies
  biz('b-galleriacine', 'Galleria Cinemas', 'movies.cinemas.multiplex', 'Multiplex · 8 screens', 'Hitech City', 5.2, 4.4, 3120, 2, 'movie',
    'Eight screens with Dolby sound, recliner seats in two auditoriums and a food court on the same floor.',
    [['Standard ticket', 'Weekday show', 250], ['Recliner seat', 'Weekend show', 450], ['Popcorn & drink combo', 'Large', 320]],
    { book: true, offer: { pct: 20, member: true, max: 300, title: '20% off tickets on Tuesdays' } }),
  biz('b-lotus', 'Lotus Talkies', 'movies.cinemas.single-screen', 'Single screen · Since 1974', 'Secunderabad', 9.0, 4.3, 1450, 1, 'movie',
    'A one-screen neighbourhood cinema with a balcony, first-day-first-show crowds and the most affordable tickets around.',
    [['Stalls', 'Per ticket', 120], ['Balcony', 'Per ticket', 180]], { book: true }),
  biz('b-luxe', 'Luxe Screens', 'movies.cinemas.premium-imax', 'Premium · IMAX & Dolby Atmos', 'Gachibowli', 6.1, 4.6, 980, 3, 'movie',
    'IMAX and Dolby Atmos screens with luxury recliners and in-seat dining.',
    [['IMAX ticket', 'Evening show', 550], ['Lounge recliner', 'With meal service', 900]],
    { book: true, offer: { flat: 150, member: true, title: '₹150 off premium tickets', headline: '₹150', sub: 'OFF', minBill: 500 } }),
  biz('b-screeningroom', 'The Screening Room', 'movies.private-theatres', 'Private theatre · 2 to 20 guests', 'Jubilee Hills', 1.8, 4.7, 260, 3, 'movie',
    'Book a private screen for birthdays, anniversaries or a film marathon. Bring your own film or choose from the catalogue.',
    [['2-hour private slot', 'Up to 6 guests', 1800], ['Celebration package', 'Decor and cake included', 3500]], { book: true }),
  biz('b-starlight', 'Starlight Open-Air Cinema', 'movies.open-air-screenings', 'Open-air screenings · Weekends', 'Kokapet', 9.9, 4.5, 310, 2, 'movie',
    'Weekend screenings under the sky with bean bags, blankets and a snack stall.',
    [['Bean bag seat', 'Weekend screening', 399], ['Blanket & snack pack', 'Add-on', 199]], { book: true, isNew: true }),
  biz('b-cinebox', 'CineBox Private Screens', 'movies.private-theatres', 'Private theatre · 2 to 12 guests', 'Gachibowli', 6.4, 4.6, 410, 3, 'movie',
    'Three soundproof private screens with recliners, 4K projection and Dolby sound. Stream your own film or pick from the library.',
    [['Private screen, per hour', 'Up to 12 guests', 1499], ['Birthday add-on', 'Balloons, cake and fog entry', 1999]], { book: true, offer: { pct: 15, title: '15% off weekday screenings', minBill: 1500 } }),
  biz('b-reellounge', 'Reel Lounge', 'movies.private-theatres', 'Private theatre · Couples and small groups', 'Banjara Hills', 2.7, 4.5, 190, 3, 'movie',
    'A cosy private cinema for two to eight, made for date nights, proposals and anniversaries.',
    [['Couple screening', '2 guests, 3 hours', 2499], ['Proposal setup', 'Flowers, lights and a photographer', 4999]], { book: true, isNew: true }),
  biz('b-rooftopreels', 'Rooftop Reels', 'movies.open-air-screenings', 'Open-air theatre · Rooftop', 'Hitech City', 5.6, 4.4, 280, 2, 'movie',
    'Cult classics and new indies on a rooftop screen, with wireless headphones, bean bags and a café bar.',
    [['Rooftop seat', 'With headphones', 449], ['Bean bag for two', 'With popcorn', 899]], { book: true, offer: { flat: 100, member: true, title: '₹100 off for members', headline: '₹100', sub: 'OFF', minBill: 400 } }),
  biz('b-lakeview', 'Lakeview Open-Air Cinema', 'movies.open-air-screenings', 'Open-air theatre · By Durgam Cheruvu', 'Madhapur', 4.9, 4.6, 350, 2, 'movie',
    'Family screenings on the lawn by the lake every Friday to Sunday. Blankets, picnic hampers and a kids’ corner.',
    [['Lawn seat', 'Weekend screening', 349], ['Picnic hamper', 'For two', 599]], { book: true }),
  biz('b-filmsociety', 'Hyderabad Film Society', 'movies.clubs-festivals', 'Movie club · Festivals & talks', 'Himayatnagar', 7.1, 4.8, 540, 1, 'movie',
    'A film society with weekly classic and world-cinema screenings, director talks and an annual short-film festival.',
    [['Monthly membership', 'All screenings', 400], ['Single screening', 'Per ticket', 150]], { book: true, offer: { pct: 10, max: 100 } }),
];

export const businesses: Biz[] = [...coreBusinesses, ...extraBusinesses];

// ---------- offers ----------
const OFFER_IMAGE: Record<string, string> = {
  'o-saffron-30': 'biryani', 'o-brew-bogo': 'coffee', 'o-pulse-500': 'gym', 'o-lumiere-20': 'salon', 'o-saffron-dessert': 'dessert', 'o-glow-20': 'grooming',
};

function makeOffer(e: OfferSpecEntry, i: number): DemoOffer {
  const s = e.spec;
  const pct = s.pct;
  const title = s.title ?? (pct ? `${pct}% off your bill` : `₹${s.flat} off`);
  const maxDiscount = pct ? r(s.max ?? 500) : r(s.flat!);
  const minBill = s.minBill ? r(s.minBill) : null;
  return {
    id: `o-${e.bizId.slice(2)}`, businessId: e.bizId, businessName: e.name, area: e.area, title,
    type: s.type ?? (pct ? 'percentage' : 'flat'),
    headline: s.headline ?? (pct ? `${pct}%` : `₹${s.flat}`), headlineSub: s.sub ?? 'OFF',
    memberOnly: !!s.member, coverUrl: img(e.key, 960), scheduleLabel: 'All week', endsAt: atIST(12 + ((i * 5) % 30), 22),
    maxDiscount, minBill,
    appliesTo: 'Your eligible bill at this branch', excludes: 'Gift cards and items already on sale', channels: ['In-store'],
    terms: ['One redemption per customer per day.', 'Discount is applied only when you pay the bill through VIBE.', 'The merchant issues its own tax invoice separately.'],
    example: pct ? { bill: r(2000), discount: Math.min(r(2000) * pct / 100, maxDiscount), payable: r(2000) - Math.min(r(2000) * pct / 100, maxDiscount) } : null,
    rule: pct ? { kind: 'percentage', rateBps: pct * 100, maxDiscount, minBill } : { kind: 'flat', amount: r(s.flat!), minBill },
  };
}

export const offers: DemoOffer[] = [
  ...coreOffers.map((o) => ({ ...o, coverUrl: img(OFFER_IMAGE[o.id] ?? 'offers', 960) })),
  ...specs.map(makeOffer),
];

// ---------- events ----------
const EVENT_IMAGE: Record<string, string> = {
  'e-jazz': 'jazz', 'e-pottery': 'pottery', 'e-heritage': 'charminar', 'e-standup': 'comedy', 'e-brunch': 'brunch', 'e-boardgames': 'boardgames',
};
/** Days from today (India) to the next given weekday (0 = Sunday), never today. */
const daysTo = (dow: number) => { const d = new Date(Date.now() + 330 * 60_000).getUTCDay(); return ((dow - d + 7) % 7) || 7; };
/** Open-air screenings: ticketed like events, shown under Movies → Open-air theatres. */
const openAir: EventDetail[] = [
  ['e-oa-starlight', 'Under the Stars: 3 Idiots', 'Starlight Open-Air Cinema', 'Kokapet', 6, 19, 399, 'Bean bags, blankets and the film everyone can quote. Snack stall open from 6 PM.'],
  ['e-oa-rooftop', 'Rooftop Reels: Cult Classics Night', 'Rooftop Reels', 'Hitech City', 5, 20, 449, 'A double bill of cult classics on the rooftop, with wireless headphones for every seat.'],
  ['e-oa-lakeview', 'Lakeside Family Screening', 'Lakeview Open-Air Cinema', 'Madhapur', 0, 18, 349, 'An animated favourite on the lawn by the lake. Kids under 3 go free.'],
].map(([id, title, venue, area, dow, hour, price, description]) => ({
  id: id as string, title: title as string, kind: 'Movies' as const, startsAt: atIST(daysTo(dow as number), hour as number), gatesOpenAt: atIST(daysTo(dow as number), (hour as number) - 1),
  venue: venue as string, area: area as string, fromPrice: r(price as number), coverUrl: img('movie', 960), tag: null, soldOut: false, featured: false, organiser: venue as string, ageLimit: null,
  description: description as string,
  ticketTypes: [
    { id: `${id}-gen`, name: 'Lawn or rooftop seat', description: 'Free seating', price: r(price as number), remaining: 80, maxPerOrder: 6 },
    { id: `${id}-duo`, name: 'Bean bag for two', description: 'Front row, with popcorn', price: r((price as number) * 2 + 99), remaining: 12, maxPerOrder: 2 },
  ],
  terms: ['Screenings are weather permitting; full refund if called off.', 'Outside food is not allowed.'],
}));
export const events: EventDetail[] = [...coreEvents.map((e) => ({ ...e, coverUrl: img(EVENT_IMAGE[e.id] ?? 'events', 960) })), ...openAir];

export const eventImageKey = (eventId: string) => EVENT_IMAGE[eventId] ?? 'events';
