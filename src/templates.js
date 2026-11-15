// Starter palettes and event templates. A template is a starting layout at real sizes, coloured from the active
// palette, so "Baby shower" in Sage & ivory and in Blush & gold are the same plan in different colours.
import { color } from './units.js'

export const PALETTES = {
  'Blush & gold': ['blush', 'gold', 'ivory'],
  'Sage & ivory': ['sage', 'ivory', 'gold'],
  'White & gold': ['white', 'gold', 'champagne'],
  'Dusty rose & mauve': ['dusty rose', 'mauve', 'ivory'],
  'Navy & gold': ['navy', 'gold', 'white'],
  'Black & gold': ['black', 'gold', 'white'],
  'Burgundy & champagne': ['burgundy', 'champagne', 'gold'],
  'Terracotta boho': ['terracotta', 'cream', 'sage'],
  'Baby blue & silver': ['baby blue', 'white', 'silver'],
  'Pastel rainbow': ['pink', 'pastel yellow', 'baby blue', 'lavender', 'sage'],
}

// the palette's lightest colour (for linens, drapes, cakes) and its strongest (for flowers, uplights)
const lum = c => { const h = color(c).replace('#', ''); const n = parseInt(h.length === 3 ? h.replace(/./g, x => x + x) : h, 16); return ((n >> 16) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) }
export const lightest = pal => [...pal].sort((a, b) => lum(b) - lum(a))[0]
export const accent = pal => pal.find(c => lum(c) < 200 && !/gold|silver|champagne/.test(c)) || pal[0]

// Colour the quick-add pieces from the palette.
export function withPalette(kind, params, pal) {
  if (!pal?.length) return params
  const p = { ...params }
  if (['balloonArch', 'balloonGarland'].includes(kind)) p.colors = pal.slice(0, 4)
  if (kind === 'balloonColumn') p.colors = pal.slice(0, 2)
  if (['roundTable', 'banquetTable'].includes(kind)) p.linen = lightest(pal)
  if (['drapery', 'cake', 'backdrop'].includes(kind)) p.color = lightest(pal)
  if (['centerpiece', 'uplight'].includes(kind)) p.color = accent(pal)
  return p
}

// ---------- building blocks (feet) ----------
const ft = v => `${+v.toFixed(2)}ft`
let uid = 0
const id = k => `${k}-${++uid}`
const piece = (kind, label, params, x = 0, z = 0, rot = 0) => ({ id: id(kind), kind, label, params, position: [ft(x), '0ft', ft(z)], rotationY: rot })

// a round table with its chairs facing it, and a centrepiece (centrepieces sit on tables automatically)
function roundSet(pal, x, z, { dia = 60, chairs = 8, center = 'flowers' } = {}) {
  const out = [piece('roundTable', `Round table ${dia}″`, { diameter: `${dia}in`, linen: lightest(pal) }, x, z)]
  const r = dia / 24 + 1.5
  for (let i = 0; i < chairs; i++) {
    const a = (i / chairs) * Math.PI * 2
    out.push(piece('chair', 'Chair', { color: 'white' }, x + Math.sin(a) * r, z + Math.cos(a) * r, Math.round((a * 180 / Math.PI + 180) % 360)))
  }
  if (center) out.push({ ...piece('centerpiece', 'Centrepiece', { style: center, color: accent(pal) }), position: [ft(x), '2.5ft', ft(z)] })
  return out
}
const room = (w, d, h) => piece('room', `Room ${w}′ × ${d}′`, { width: `${w}ft`, depth: `${d}ft`, height: `${h}ft` }, 0, 0)
const cakeOn = (pal, x, z, tiers, h = 2.5) => ({ ...piece('cake', `${tiers}-tier cake`, { tiers, color: lightest(pal) }), position: [ft(x), `${h}ft`, ft(z)] })

export const TEMPLATES = {
  babyShower: {
    name: 'Baby shower', about: '24 × 30 ft · arch backdrop with garland, dessert table, 3 guest tables (24 seats)',
    build: pal => [room(24, 30, 10),
      piece('backdrop', 'Backdrop', { width: '7ft', height: '7ft', shape: 'arch', color: lightest(pal) }, 0, -14.2),
      piece('balloonGarland', 'Balloon garland', { width: '7ft', height: '7.3ft', shape: 'cascade', colors: pal.slice(0, 4) }, 0, -13.8),
      piece('banquetTable', 'Dessert table 6′', { length: '6ft', linen: lightest(pal) }, 0, -11.5), cakeOn(pal, 0, -11.5, 2),
      ...roundSet(pal, -7, -2), ...roundSet(pal, 7, -2), ...roundSet(pal, 0, 6)],
  },
  birthday: {
    name: 'Birthday party', about: '20 × 24 ft · 8 ft organic arch, cake table between two columns, 2 guest tables',
    build: pal => [room(20, 24, 10),
      piece('balloonArch', 'Balloon arch', { height: '8ft', colors: pal.slice(0, 4), style: 'organic' }, 0, -11),
      piece('banquetTable', 'Cake table 6′', { length: '6ft', linen: lightest(pal) }, 0, -8.5), cakeOn(pal, 0, -8.5, 2),
      piece('balloonColumn', 'Balloon column', { height: '6ft', colors: pal.slice(0, 2) }, -5, -8.5),
      piece('balloonColumn', 'Balloon column', { height: '6ft', colors: pal.slice(0, 2) }, 5, -8.5),
      ...roundSet(pal, -4.5, 2, { chairs: 6 }), ...roundSet(pal, 4.5, 2, { chairs: 6 }),
      piece('uplight', 'Uplight', { color: accent(pal) }, -8.5, -11.3), piece('uplight', 'Uplight', { color: accent(pal) }, 8.5, -11.3)],
  },
  bridalShower: {
    name: 'Bridal shower', about: '24 × 30 ft · sheer drapery with a swag garland, gift and cake tables, 3 guest tables',
    build: pal => [room(24, 30, 10),
      piece('drapery', 'Drapery', { width: '12ft', height: '9ft', panels: 3, color: lightest(pal), sheer: true }, 0, -14.6),
      piece('balloonGarland', 'Swag garland', { width: '12ft', height: '9ft', shape: 'swag', colors: pal.slice(0, 4) }, 0, -14.2),
      piece('banquetTable', 'Cake table 6′', { length: '6ft', linen: lightest(pal) }, -4, -11.5), cakeOn(pal, -4, -11.5, 3),
      piece('banquetTable', 'Gift table 6′', { length: '6ft', linen: lightest(pal) }, 4, -11.5),
      ...roundSet(pal, -7, -1, { center: 'tall' }), ...roundSet(pal, 7, -1, { center: 'tall' }), ...roundSet(pal, 0, 7, { center: 'tall' })],
  },
  wedding: {
    name: 'Wedding reception', about: '40 × 60 ft · dance floor, sweetheart table with drapery, cake table, 8 tables (64 seats), uplights',
    build: pal => [room(40, 60, 14),
      piece('drapery', 'Drapery', { width: '16ft', height: '12ft', panels: 4, color: lightest(pal), sheer: true }, 0, -29.5),
      piece('balloonGarland', 'Garland', { width: '16ft', height: '12ft', shape: 'swag', colors: pal.slice(0, 4) }, 0, -29.1),
      piece('banquetTable', 'Sweetheart table', { length: '6ft', linen: lightest(pal) }, 0, -25.5),
      piece('chair', 'Chair', { color: 'white' }, -1.2, -27, 0), piece('chair', 'Chair', { color: 'white' }, 1.2, -27, 0),
      piece('roundTable', 'Cake table 36″', { diameter: '36in', linen: lightest(pal) }, 12, -24), cakeOn(pal, 12, -24, 3),
      piece('danceFloor', 'Dance floor 20′ × 20′', { width: '20ft', depth: '20ft', style: 'white' }, 0, -10),
      ...[-14, 14].flatMap(x => [-16, -4, 8, 20].map(z => roundSet(pal, x, z, { center: 'tall' }))).flat(),
      ...[-18, -6, 6, 18].map(z => piece('uplight', 'Uplight', { color: accent(pal) }, -19.3, z, 90)),
      ...[-18, -6, 6, 18].map(z => piece('uplight', 'Uplight', { color: accent(pal) }, 19.3, z, 270))],
  },
  graduation: {
    name: 'Graduation party', about: '24 × 30 ft · organic arch photo spot, 2 food tables, 2 columns, 2 guest tables',
    build: pal => [room(24, 30, 10),
      piece('balloonArch', 'Photo arch', { height: '8ft', colors: pal.slice(0, 4), style: 'organic' }, 0, -14),
      piece('balloonColumn', 'Balloon column', { height: '6ft', colors: pal.slice(0, 2), topper: '36in' }, -6, -12),
      piece('balloonColumn', 'Balloon column', { height: '6ft', colors: pal.slice(0, 2), topper: '36in' }, 6, -12),
      piece('banquetTable', 'Food table 8′', { length: '8ft', linen: lightest(pal) }, -9, 0, 90),
      piece('banquetTable', 'Food table 8′', { length: '8ft', linen: lightest(pal) }, 9, 0, 90),
      ...roundSet(pal, -3.5, 4, { chairs: 6 }), ...roundSet(pal, 3.5, 4, { chairs: 6 })],
  },
  gala: {
    name: 'Corporate / gala', about: '40 × 50 ft · 10 ft backdrop with uplights, entrance columns, 6 tables of 10 with candles',
    build: pal => [room(40, 50, 14),
      piece('backdrop', 'Stage backdrop', { width: '16ft', height: '10ft', shape: 'rectangle', color: lightest(pal) }, 0, -24.5),
      ...[-6, -2, 2, 6].map(x => piece('uplight', 'Uplight', { color: accent(pal) }, x, -23.5)),
      piece('balloonColumn', 'Entrance column', { height: '7ft', colors: pal.slice(0, 2) }, -5, 22),
      piece('balloonColumn', 'Entrance column', { height: '7ft', colors: pal.slice(0, 2) }, 5, 22),
      ...[-12, 0, 12].flatMap(x => [-12, 2].map(z => roundSet(pal, x, z, { dia: 72, chairs: 10, center: 'candles' }))).flat()],
  },
}

export function buildTemplate(key, pal) {
  uid = 0
  return { units: 'imperial', parts: TEMPLATES[key].build(pal) }
}
