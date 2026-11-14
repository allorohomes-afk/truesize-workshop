// Units and colours. Software owns the numbers: the AI passes the user's words ("9 ft", "108in", "2.7 m"),
// this file turns them into metres. Everything inside the scene is metres.

const UNIT = { m: 1, cm: 0.01, mm: 0.001, in: 0.0254, inch: 0.0254, inches: 0.0254, '"': 0.0254,
  ft: 0.3048, foot: 0.3048, feet: 0.3048, "'": 0.3048, yd: 0.9144 }

// "9 ft 6 in", "9'6\"", "108in", "2.7m", "11", 2.7  ->  metres (a bare number is metres)
export function toMeters(v, fallback = 0) {
  if (v === null || v === undefined || v === '') return fallback
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback
  const s = String(v).trim().toLowerCase().replace(/,/g, '')
  let total = 0, found = false
  const re = /(-?\d+(?:\.\d+)?)\s*(mm|cm|m(?!m)|inches|inch|in|"|feet|foot|ft|'|yd)?/g
  let m
  while ((m = re.exec(s))) {
    if (m[0].trim() === '') { re.lastIndex++; continue }
    found = true
    total += parseFloat(m[1]) * (UNIT[m[2] || 'm'] ?? 1)
  }
  return found ? total : fallback
}

// Balloon sizes are named by diameter in inches.
export function balloonDiameter(v) {
  if (typeof v === 'number') return v > 1 ? v * 0.0254 : v
  const s = String(v || '11in').toLowerCase()
  const n = parseFloat(s)
  if (!Number.isFinite(n)) return 11 * 0.0254
  return /cm|mm|m\b/.test(s) && !/in/.test(s) ? toMeters(s) : n * 0.0254
}

export function formatLength(m, units = 'imperial') {
  if (units === 'metric') return m >= 1 ? `${m.toFixed(2)} m` : `${Math.round(m * 100)} cm`
  const totalIn = m / 0.0254
  const ft = Math.floor(totalIn / 12)
  const inch = Math.round((totalIn - ft * 12) * 2) / 2
  return ft ? `${ft}′ ${inch}″` : `${inch}″`
}

// Event-planning colour names (approximations of common balloon and linen shades) plus CSS names and hex.
const NAMED = {
  blush: '#f4c2c2', 'blush pink': '#f4c2c2', 'rose gold': '#b76e79', gold: '#d4af37', 'metallic gold': '#c9a227',
  champagne: '#f7e7ce', ivory: '#fffff0', cream: '#fffdd0', white: '#ffffff', 'pearl white': '#f8f6f0',
  sage: '#9caf88', 'sage green': '#9caf88', eucalyptus: '#5f8575', emerald: '#2e8b57', 'forest green': '#228b22',
  navy: '#1f2f5a', 'royal blue': '#2c4fa3', 'baby blue': '#a7c7e7', 'pastel blue': '#aec6cf', teal: '#2a8c8c',
  lavender: '#c8a2c8', lilac: '#c8a2c8', purple: '#6a3d9a', mauve: '#b784a7', 'dusty rose': '#c4878c',
  peach: '#ffcba4', coral: '#ff7f50', terracotta: '#c8644a', burgundy: '#800020', red: '#c8102e', black: '#111111',
  silver: '#c0c0c0', chrome: '#dcdcdc', clear: '#e8f4f8', 'pastel yellow': '#fdfd96', yellow: '#f5d000',
  orange: '#f28c28', pink: '#ff8fb1', 'hot pink': '#ff3e96', brown: '#7b5236', wood: '#a0784f', oak: '#b08a5a',
}
export function color(c, fallback = '#cccccc') {
  if (!c) return fallback
  const s = String(c).trim().toLowerCase()
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/.test(s)) return s
  return NAMED[s] || s || fallback
}
export const colorNames = Object.keys(NAMED)

// "#f4c2c2" -> "blush" for shopping lists (first name that maps to that hex; hex if none)
export function colorName(hex) {
  const h = color(hex)
  const hit = Object.entries(NAMED).find(([, v]) => v === h)
  return hit ? hit[0] : h
}
