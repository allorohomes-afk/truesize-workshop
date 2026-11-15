// "Render it": snapshot the 3D view and ask the render relay (ComfyUI on the Mac with the GPU) to repaint it as a
// photo. The prompt is written by code from what's in the scene. The result is an artist's impression; exact sizes
// always come from the 3D view and the measure tool.
import { colorName } from './units.js'

const NOUNS = {
  room: () => 'an elegant event room',
  balloonArch: p => `a ${String(p.style || 'classic').startsWith('organic') ? 'organic ' : ''}balloon garland arch made of round latex balloons in ${(p.colors || []).map(colorName).join(', ')}`,
  roundTable: p => `round tables with ${colorName(p.linen || 'ivory')} linens`,
  banquetTable: p => `long banquet tables with ${colorName(p.linen || 'ivory')} linens`,
  chair: p => `${colorName(p.color || 'white')} chairs`,
  backdrop: p => `a ${colorName(p.color || 'white')} ${p.shape || ''} backdrop`,
  balloonGarland: p => `an organic balloon garland in ${(p.colors || []).map(colorName).join(', ')}`,
  balloonColumn: p => `balloon columns in ${(p.colors || []).map(colorName).join(', ')}`,
  centerpiece: p => String(p.style || 'flowers').startsWith('candle') ? 'candle centrepieces' : `${colorName(p.color || 'blush')} flower centrepieces`,
  cake: p => `a ${p.tiers || 3}-tier ${colorName(p.color || 'ivory')} wedding cake`,
  drapery: p => `${p.sheer ? 'sheer ' : ''}${colorName(p.color || 'ivory')} draped fabric`,
  danceFloor: p => `a ${p.style || 'checker'} dance floor`,
  uplight: p => `${colorName(p.color || 'blush')} uplighting on the walls`,
}

export function scenePrompt(parts) {
  const seen = new Set(), bits = []
  for (const s of parts) {
    const f = NOUNS[s.kind]; if (!f) continue
    const t = f(s.params || {}).replace(/\s+/g, ' ').trim()
    if (!seen.has(t)) { seen.add(t); bits.push(t) }
  }
  return bits.length ? bits.join(', ') : 'a beautifully styled space'
}

// The server says where renders go (RENDER_URL); otherwise the render relay on this same computer.
let configured = ''
export function setRenderUrl(url) { configured = url || '' }
export function renderUrl() { return configured || 'http://127.0.0.1:8882/render' }

export async function renderIt(bench, { onState }) {
  bench.setLabels(false); bench.grid.visible = false
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  const image = bench.snapshot()
  const depth = bench.depthSnapshot()
  bench.setLabels(true); bench.grid.visible = true
  const prompt = scenePrompt(bench.toJSON().parts)
  onState('Rendering… (usually 1–3 minutes)')
  let r
  try {
    r = await fetch(renderUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image, depth, prompt }) })
  } catch {
    throw new Error('The render computer is off or away. Renders need it on and online.')
  }
  const d = await r.json()
  if (!r.ok || !d.image) throw new Error(d.error || `render failed (${r.status})`)
  return { image: d.image, before: image, prompt }
}
