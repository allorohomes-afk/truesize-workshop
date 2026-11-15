import * as THREE from 'three'
// TrueSize Workshop: wires the bench, the build log, the assistant's panel and the toolbar together.
import { Bench } from './bench.js'
import { formatLength, toMeters, colorNames, color } from './units.js'
import { FINISHES, BALLOON_SIZES } from './parts.js'
import { holdToTalk } from './voice.js'
import { renderIt, setRenderUrl } from './render.js'
import { scanToOps } from './scan.js'
import { PALETTES, TEMPLATES, buildTemplate, withPalette } from './templates.js'

const $ = s => document.querySelector(s)
function esc(t) { return String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]) }
const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } },
                set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } } }

const bench = new Bench($('#bench'), { onPick: showSelected, onMeasure: m => say(`That's ${formatLength(m.distance, bench.units)} (rise ${formatLength(m.rise, bench.units)}, ${m.angle.toFixed(0)}°).`) })
let project = 'Untitled'
const history = []
let counter = 0

// ---------- preferences ----------
function setTheme(t) { document.documentElement.dataset.theme = t; $('#theme').value = t; store.set('ws.theme', t); bench.applyTheme() }
$('#theme').value = store.get('ws.theme', 'bench'); setTheme($('#theme').value)
$('#theme').onchange = e => { setTheme(e.target.value); saveSettings() }
$('#voice').value = store.get('ws.voice-name', 'bf_emma')
$('#voice').onchange = e => { store.set('ws.voice-name', e.target.value); saveSettings(); say('Hello, this is my new voice.') }
$('#units').value = store.get('ws.units', 'imperial'); bench.units = $('#units').value
$('#units').onchange = e => { bench.units = e.target.value; store.set('ws.units', bench.units); saveSettings(); refreshInfo() }
// Workspaces and the render address come from the server (WORKSHOP_SPACES, RENDER_URL).
let assistant = 'Ada'
async function loadConfig() {
  let cfg = { spaces: [{ id: 'shared', label: 'Shared' }], renderUrl: '' }
  try { cfg = await (await fetch('/api/config')).json() } catch { /* older server: one shared workspace */ }
  $('#space').innerHTML = cfg.spaces.map(s => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('')
  const saved = store.get('ws.space', '')
  $('#space').value = cfg.spaces.some(s => s.id === saved) ? saved : cfg.spaces[0].id
  setRenderUrl(cfg.renderUrl)
  assistant = cfg.assistant || 'Ada'
}
$('#space').onchange = e => { store.set('ws.space', e.target.value); loadSettings() }
const space = () => $('#space').value

// ---------- per-workspace settings: look, units, voice, palettes (saved on the server, so they follow the person) ----------
let settings = {}
async function loadSettings() {
  try { settings = await (await fetch(`/api/settings?space=${space()}`)).json() } catch { settings = {} }
  if (settings.theme) setTheme(settings.theme)
  if (settings.units) { $('#units').value = bench.units = settings.units; refreshInfo() }
  if (settings.voice) $('#voice').value = settings.voice
  fillPalettes()
}
let saveTimer
function saveSettings() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => fetch(`/api/settings?space=${space()}`, { method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...settings, theme: $('#theme').value, units: bench.units, voice: $('#voice').value, palette: $('#palette').value }) }).catch(() => {}), 500)
}
const allPalettes = () => ({ ...(settings.palettes || {}), ...PALETTES })
const palette = () => allPalettes()[$('#palette').value] || PALETTES['Blush & gold']
function fillPalettes() {
  const mine = Object.keys(settings.palettes || {}), all = allPalettes()
  $('#palette').innerHTML = (mine.length ? `<optgroup label="Mine">${mine.map(n => `<option>${esc(n)}</option>`).join('')}</optgroup>` : '')
    + `<optgroup label="Starters">${Object.keys(PALETTES).map(n => `<option>${esc(n)}</option>`).join('')}</optgroup>`
  $('#palette').value = all[settings.palette] ? settings.palette : 'Blush & gold'
  showSwatches()
}
function showSwatches() { $('#palette-swatches').innerHTML = palette().map(c => `<span class="swatch-dot" title="${esc(c)}" style="background:${esc(color(c))}"></span>`).join('') }
$('#palette').onchange = () => { settings.palette = $('#palette').value; showSwatches(); saveSettings() }
$('#btn-palette').onclick = () => {
  const name = $('#palette').value, mine = !!(settings.palettes || {})[name]
  $('#pal-name').value = mine ? name : `My ${name}`
  const cur = palette()
  $('#pal-colors').innerHTML = [0, 1, 2, 3, 4].map(i => `<label><span class="swatch-dot" id="pal-dot-${i}"></span><select id="pal-c${i}">${i > 2 ? '<option value="">(none)</option>' : ''}${BALLOON_COLORS.map(c => `<option${c === cur[i] ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>`).join('')
  const dots = () => [0, 1, 2, 3, 4].forEach(i => { const v = $(`#pal-c${i}`).value; $(`#pal-dot-${i}`).style.background = v ? color(v) : 'transparent' })
  ;[0, 1, 2, 3, 4].forEach(i => { if (i > 2 && !cur[i]) $(`#pal-c${i}`).value = ''; $(`#pal-c${i}`).onchange = dots }); dots()
  $('#pal-delete').hidden = !mine
  $('#palette-dialog').showModal()
}
$('#pal-save').onclick = () => {
  const name = $('#pal-name').value.trim().slice(0, 40) || 'My palette'
  const cols = [0, 1, 2, 3, 4].map(i => $(`#pal-c${i}`).value).filter(Boolean)
  settings.palettes = { ...(settings.palettes || {}), [name]: cols }; settings.palette = name
  fillPalettes(); saveSettings(); $('#palette-dialog').close(); log(`Palette “${name}” saved`)
}
$('#pal-delete').onclick = () => {
  const name = $('#palette').value; const p = { ...(settings.palettes || {}) }; delete p[name]
  settings.palettes = p; settings.palette = 'Blush & gold'; fillPalettes(); saveSettings(); $('#palette-dialog').close()
}

// ---------- log + chat ----------
function log(text, cls = '') { const li = document.createElement('li'); li.textContent = text; if (cls) li.className = cls; $('#log').appendChild(li); li.scrollIntoView({ block: 'nearest' }) }
function bubble(text, who) { const d = document.createElement('div'); d.className = `msg ${who}`; d.textContent = text; $('#chat').appendChild(d); d.scrollIntoView({ block: 'end' }) }
// The assistant's voice: an accented Kokoro voice from the voice service, falling back to this device's own voice.
let playing = null
function deviceSpeak(text) {
  if (!('speechSynthesis' in window)) return
  const u = new SpeechSynthesisUtterance(text); u.rate = 1.05; speechSynthesis.cancel(); speechSynthesis.speak(u)
}
async function say(text) {
  bubble(text, 'assistant')
  const voice = $('#voice').value
  if (voice === 'off') return
  if (voice === 'device') return deviceSpeak(text)
  try {
    const r = await fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice }) })
    if (!r.ok) throw new Error(r.status)
    const url = URL.createObjectURL(await r.blob())
    if (playing) playing.pause()
    playing = new Audio(url); playing.onended = () => URL.revokeObjectURL(url)
    await playing.play()
  } catch { deviceSpeak(text) }
}
function busy(on, text) { $('#orb').classList.toggle('busy', on); $('#assistant-status').textContent = text || (on ? `${assistant} is building…` : `${assistant} is ready`) }

// ---------- operations: the AI only names them; this code applies them ----------
const wait = ms => new Promise(r => setTimeout(r, ms))
function snapshotForUndo() { history.push(JSON.stringify(bench.toJSON())); if (history.length > 50) history.shift() }

// Software owns placement: plain numbers mean the user's units (the model often writes feet as bare numbers),
// event pieces stand on the floor, and nothing is placed outside the room's walls.
const FLOOR_KINDS = new Set(['room', 'balloonArch', 'roundTable', 'banquetTable', 'chair', 'backdrop', 'balloonGarland', 'balloonColumn', 'drapery', 'danceFloor', 'uplight'])
// these sit on a table: software finds the table and puts them on top, centred
const ON_TABLE = new Set(['centerpiece', 'cake'])
function placement(op) {
  if (ON_TABLE.has(op.kind)) return onTable(op)
  if (!op.position) return op.position
  const unit = bench.units === 'imperial' ? 'ft' : 'm'
  let [x, y, z] = [0, 1, 2].map(i => { const v = op.position[i]; return typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(String(v ?? '').trim()) ? toMeters(`${v ?? 0}${unit}`) : toMeters(v, 0) })
  if (FLOOR_KINDS.has(op.kind)) y = 0
  const room = [...bench.parts.values()].find(p => p.spec.kind === 'room')
  if (room && op.kind !== 'room') {
    const halfW = room.size.w / 2 - 0.35, halfD = room.size.d / 2 - 0.35
    x = Math.max(room.home.x - halfW, Math.min(room.home.x + halfW, x))
    z = Math.max(room.home.z - halfD, Math.min(room.home.z + halfD, z))
  }
  return [x, y, z]
}

function onTable(op) {
  const tables = [...bench.parts.values()].filter(p => p.spec.kind.endsWith('Table'))
  if (!tables.length) return op.position ? [0, 1, 2].map(i => toMeters(op.position[i], 0)) : undefined
  const busy = new Set([...bench.parts.values()].filter(p => p.spec.kind === op.kind && p.spec.id !== op.id).map(p => p.group.position.x.toFixed(2) + p.group.position.z.toFixed(2)))
  let pick
  if (op.position) {   // the table nearest to where it was asked for
    const [x, , z] = [0, 1, 2].map(i => toMeters(op.position[i], 0))
    pick = tables.reduce((a, b) => (Math.hypot(b.home.x - x, b.home.z - z) < Math.hypot(a.home.x - x, a.home.z - z) ? b : a))
  } else pick = tables.find(t => !busy.has(t.home.x.toFixed(2) + t.home.z.toFixed(2))) || tables[0]   // next table without one
  return [pick.home.x, pick.size.h, pick.home.z]
}

async function applyOps(ops) {
  snapshotForUndo()
  for (const op of ops) {
    try {
      switch (op.op) {
        case 'add': {
          const id = op.id || `${op.kind}-${++counter}`
          const p = bench.add({ id, kind: op.kind, label: op.label || op.kind, params: op.params || {}, position: placement(op), rotationY: op.rotationY })
          log(`Added ${p.spec.label} (${describe(p)})`)
          break
        }
        case 'update': { const kind = bench.parts.get(op.id)?.spec.kind; const p = bench.update(op.id, { ...op, position: op.position ? placement({ ...op, kind }) : undefined }); log(`Changed ${p.spec.label} (${describe(p)})`); break }
        case 'remove': bench.remove(op.id); log(`Removed ${op.id}`); break
        case 'explode': bench.explode(Number(op.amount) || Number($('#explode-amt').value)); syncExplode(); log('Pulled it apart'); break
        case 'assemble': bench.assemble(); syncExplode(); log('Put it back together'); break
        case 'clear': bench.clear(); log('Cleared the bench'); break
        default: log(`Skipped an unknown step "${op.op}"`, 'err')
      }
    } catch (e) { log(String(e.message || e), 'err') }
    await wait(ops.length > 12 ? 40 : 220)   // build step by step, so you can watch it come together
  }
  refreshInfo()
}

function describe(p) {
  const u = bench.units
  const s = `${formatLength(p.size.w, u)} wide × ${formatLength(p.size.h, u)} tall`
  return p.info?.balloons ? `${s}, ${p.info.balloons} balloons` : s
}

// ---------- the assistant: words -> operations ----------
$('#ask').onsubmit = async e => {
  e.preventDefault()
  const text = $('#ask-text').value.trim(); if (!text) return
  $('#ask-text').value = ''; bubble(text, 'you'); busy(true, `${assistant} is planning…`)
  try {
    const scene = bench.toJSON().parts.map(s => ({ id: s.id, kind: s.kind, label: s.label, params: s.params, position: s.position }))
    const r = await fetch('/api/command', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, scene, units: bench.units, palette: palette() }) })
    const d = await r.json()
    busy(true)
    if (d.ops?.length) await applyOps(d.ops)
    say(d.reply || 'Done.')
  } catch (err) { say(`I couldn't reach the workshop server (${err.message}).`) }
  busy(false)
}
$('#ask-text').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#ask').requestSubmit() } })
holdToTalk($('#btn-mic'), {
  onState: t => $('#assistant-status').textContent = t,
  onText: t => { $('#ask-text').value = t; $('#ask').requestSubmit() },
})

// ---------- toolbar: quick pieces at sensible real sizes ----------
const QUICK = {
  room: { label: 'Room', params: { width: '20ft', depth: '30ft', height: '10ft' } },
  balloonArch: { label: 'Balloon arch', params: { width: '8ft', height: '8ft', balloon: '11in', colors: ['blush', 'gold', 'ivory'], style: 'classic' } },
  roundTable: { label: 'Round table 60″', params: { diameter: '60in' } },
  banquetTable: { label: 'Banquet table 6′', params: { length: '6ft' } },
  chair: { label: 'Chair', params: { color: 'white' } },
  backdrop: { label: 'Backdrop', params: { width: '8ft', height: '8ft', shape: 'arch', color: 'white' } },
  balloonGarland: { label: 'Balloon garland', params: { width: '8ft', height: '8ft', shape: 'cascade', colors: ['blush', 'gold', 'ivory'] } },
  balloonColumn: { label: 'Balloon column', params: { height: '6ft', colors: ['blush', 'gold'], topper: '24in' } },
  centerpiece: { label: 'Centrepiece', params: { style: 'flowers', color: 'blush' } },
  cake: { label: 'Cake', params: { tiers: 3, color: 'ivory' } },
  drapery: { label: 'Drapery', params: { width: '10ft', height: '10ft', panels: 2, color: 'ivory', sheer: true } },
  danceFloor: { label: 'Dance floor', params: { width: '16ft', depth: '16ft', style: 'checker' } },
  uplight: { label: 'Uplight', params: { color: 'blush' } },
}
document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => {
  const kind = b.dataset.tool; const q = QUICK[kind]
  const offset = kind === 'room' ? [0, 0, 0] : [`${(counter % 4) * 3 - 4}ft`, 0, `${Math.floor(counter / 4) * 4}ft`]
  applyOps([{ op: 'add', id: `${kind}-${++counter}`, kind, label: q.label, params: withPalette(kind, q.params, palette()), position: offset }])
})
$('#btn-measure').onclick = e => { bench.measuring = !bench.measuring; e.target.classList.toggle('on', bench.measuring); if (bench.measuring) say('Click two points and I will measure between them.'); else bench.clearMeasures() }
function syncExplode() {
  $('#btn-explode').textContent = bench.exploded ? 'Put together' : 'Pull apart'
  $('#btn-explode').classList.toggle('on', bench.exploded)
  $('#explode-wrap').hidden = !bench.exploded
}
$('#btn-explode').onclick = () => applyOps([{ op: bench.exploded ? 'assemble' : 'explode' }])
$('#explode-amt').oninput = e => bench.explode(Number(e.target.value))
$('#balloon-tags').onchange = e => bench.setBalloonTags(e.target.checked)
let labelsOn = true
$('#btn-labels').onclick = () => { labelsOn = !labelsOn; bench.setLabels(labelsOn) }
$('#btn-frame').onclick = () => bench.frameAll()
$('#btn-eye').onclick = () => bench.eyeLevel()
$('#btn-undo').onclick = () => { const prev = history.pop(); if (prev) { bench.load(JSON.parse(prev)); log('Undid the last change'); refreshInfo() } }
$('#btn-import').onclick = async () => {
  const list = $('#scan-list'); list.innerHTML = '<li class="muted">Looking for scans…</li>'
  $('#import-dialog').showModal()
  try {
    const { scans } = await (await fetch(`/api/scans?space=${space()}`)).json()
    list.innerHTML = scans.length ? '' : '<li class="muted">No scans in this workspace yet. Scan a room with TrueSize Scan and tap Send to Workshop.</li>'
    for (const name of scans) {
      const li = document.createElement('li'); li.textContent = name
      li.onclick = () => { $('#import-dialog').close(); importTrueSizeScan(name) }
      list.appendChild(li)
    }
  } catch { list.innerHTML = '<li class="muted">Could not reach the workshop server.</li>' }
}
const plural = (n = 0, w) => `${n} ${w}${n === 1 ? '' : 's'}`
async function importTrueSizeScan(name) {
  try {
    const scan = await (await fetch(`/api/scans/${encodeURIComponent(name)}?space=${space()}`)).json()
    const s = scanToOps(scan, bench.units)
    // a scanned room replaces a drawn one
    const drawn = [...bench.parts.values()].filter(p => ['room', 'wall', 'opening', 'furniture', 'floor'].includes(p.spec.kind)).map(p => ({ op: 'remove', id: p.spec.id }))
    await applyOps([...drawn, ...s.ops]); bench.frameAll()
    const c = s.counts
    say(`Your room "${name}" is in: ${formatLength(s.width, bench.units)} by ${formatLength(s.depth, bench.units)}, ${formatLength(s.height, bench.units)} tall, with ${plural(c.wall, 'wall')}, ${plural(c.door, 'door')} and ${plural(c.window, 'window')}.`)
  } catch (err) { say(String(err.message || err)); log(String(err.message || err), 'err') }
}
$('#scan').onchange = async e => {
  const f = e.target.files[0]; if (!f) return
  $('#import-dialog').close()
  try { const s = await bench.importScan(f); log(`Imported scan ${f.name}`); say(`Your scan is in: about ${formatLength(s.width, bench.units)} by ${formatLength(s.depth, bench.units)}, ${formatLength(s.height, bench.units)} tall.`); bench.frameAll() }
  catch (err) { log(String(err.message || err), 'err') }
}
$('#btn-render').onclick = async e => {
  const btn = e.currentTarget; btn.disabled = true; busy(true, 'Rendering…')
  try {
    const r = await renderIt(bench, { onState: t => $('#assistant-status').textContent = t })
    $('#render-before').src = r.before; $('#render-after').src = r.image
    $('#render-prompt').textContent = `Painted as: ${r.prompt}. Sizes and positions come from the 3D view; the render is an artist's impression.`
    $('#render-save').onclick = () => { const a = document.createElement('a'); a.href = r.image; a.download = `${project}-render.png`; a.click() }
    $('#render-dialog').showModal(); log('Rendered the view')
    say('Here is your render.')
  } catch (err) { say(err.message); log(err.message, 'err') }
  btn.disabled = false; busy(false)
}
$('#btn-snap').onclick = () => { const a = document.createElement('a'); a.href = bench.snapshot(); a.download = `${project}.png`; a.click() }

// ---------- selected piece + shopping list ----------
function showSelected(p, component) {
  if (!p) { $('#selected').textContent = 'Click a piece to see its size. Pull apart, then click a single balloon to change it.'; return }
  if (component?.userData.balloon) return showBalloon(p, component.userData.balloon)
  if (component?.userData.part) {
    component.geometry.computeBoundingBox()
    const v = component.geometry.boundingBox.getSize(new THREE.Vector3()), u = bench.units
    $('#selected').innerHTML = `<div><b>${esc(component.userData.part)}</b> of ${esc(p.spec.label)}</div><div>${formatLength(v.x, u)} W × ${formatLength(v.z, u)} D × ${formatLength(v.y, u)} H</div>`
    return
  }
  const u = bench.units
  const lines = [`${p.spec.label}`, `${formatLength(p.size.w, u)} W × ${formatLength(p.size.d, u)} D × ${formatLength(p.size.h, u)} H`]
  if (p.info?.balloons) lines.push(`${p.info.balloons} balloons · arc ${formatLength(p.info.arcLength, u)}`)
  if (p.info?.seats) lines.push(`seats about ${p.info.seats}`)
  if (p.info?.floorArea) lines.push(`floor ${(p.info.floorArea * 10.7639).toFixed(0)} sq ft`)
  $('#selected').innerHTML = lines.map(l => `<div>${l.replace(/</g, '&lt;')}</div>`).join('') + `<div class="muted">id: ${p.spec.id}</div>`
}

function refreshInfo() {
  const counts = {}; let seats = 0, tables = 0, chairs = 0
  for (const p of bench.parts.values()) {
    for (const line of p.info?.shopping || []) { const [n, ...rest] = line.split(' × '); const k = rest.join(' × '); counts[k] = (counts[k] || 0) + Number(n) }
    if (p.spec.kind.endsWith('Table')) { tables++; seats += p.info?.seats || 0 }
    if (p.spec.kind === 'chair') chairs++
  }
  const items = Object.entries(counts).map(([k, n]) => `${n} × ${k} balloons`)
  if (tables) items.push(`${tables} table${tables > 1 ? 's' : ''} (seat about ${seats})`)
  if (chairs) items.push(`${chairs} chair${chairs > 1 ? 's' : ''}`)
  const other = {}
  for (const p of bench.parts.values()) if (p.info?.item && !p.spec.kind.endsWith('Table')) other[p.info.item] = (other[p.info.item] || 0) + 1
  const plural = (n, w) => (n === 1 ? w : w.replace(/^([^(]*?)(\s*\(|$)/, (m, a, b) => `${a.replace(/y$/, 'ie')}s${b}`))
  for (const [item, n] of Object.entries(other)) items.push(`${n} × ${plural(n, item)}`)
  $('#shopping').innerHTML = items.length ? `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>` : 'Add an arch or tables to see counts.'
}

// ---------- one balloon: see it and change it (size, colour, finish), alone or with every balloon like it ----------
const BALLOON_COLORS = [...new Set(colorNames.filter(n => !['wood', 'oak', 'brown', 'chrome', 'blush pink', 'sage green', 'lilac'].includes(n)))]
function showBalloon(p, b) {
  const opts = (list, cur, fmt = x => x) => list.map(v => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(fmt(v))}</option>`).join('')
  $('#selected').innerHTML = `<div class="balloon-card">
    <div><b>Balloon ${b.number + 1}</b> of ${esc(p.spec.label)} ${b.changed ? '<span class="muted">(changed)</span>' : ''}</div>
    <div><span class="swatch" style="background:${esc(color(b.color))}"></span>${b.size}″ ${esc(b.color)} · ${esc(b.finish)}</div>
    <label>Size <select id="b-size">${opts([...new Set([...BALLOON_SIZES, b.size])].sort((x, y) => x - y), b.size, v => `${v}″`)}</select></label>
    <label>Colour <select id="b-color">${opts([...new Set([b.color, ...BALLOON_COLORS])], b.color)}</select></label>
    <label>Finish <select id="b-finish">${opts(FINISHES, b.finish)}</select></label>
    <label style="grid-template-columns:auto 1fr"><input id="b-all" type="checkbox" /> every ${b.size}″ ${esc(b.color)} ${esc(b.finish)} balloon in this arch</label>
    <div class="row"><button id="b-apply" class="primary">Change</button>${b.changed ? '<button id="b-reset">Back to original</button>' : ''}</div>
  </div>`
  const targets = () => {
    if (!$('#b-all').checked) return [b.number]
    const same = []
    p.group.traverse(o => { const x = o.userData.balloon; if (x && x.size === b.size && x.color === b.color && x.finish === b.finish) same.push(x.number) })
    return same
  }
  const change = async patch => {
    const overrides = { ...(p.spec.params.overrides || {}) }
    for (const n of targets()) {
      if (patch) overrides[n] = { ...overrides[n], ...patch }
      else delete overrides[n]
    }
    await applyOps([{ op: 'update', id: p.spec.id, params: { overrides } }])
    const again = bench.balloon(p.spec.id, b.number)
    showSelected(bench.parts.get(p.spec.id), again)
  }
  $('#b-apply').onclick = () => change({ size: Number($('#b-size').value), color: $('#b-color').value, finish: $('#b-finish').value })
  if ($('#b-reset')) $('#b-reset').onclick = () => change(null)
}

// ---------- projects (saved per workspace on the server) ----------
function setProject(name) { project = name; $('#project-name').textContent = `· ${name}` }
function startFrom(data, name) {
  snapshotForUndo(); bench.assemble(); bench.load(data); setProject(name); refreshInfo(); syncExplode()
}
$('#btn-new').onclick = async () => {
  const pal = palette()
  const list = $('#template-list')
  list.innerHTML = '<li data-key="blank"><b>Blank</b><span class="muted">An empty bench</span></li>'
    + Object.entries(TEMPLATES).map(([k, t]) => `<li data-key="${k}"><b>${esc(t.name)}</b><span class="muted">${esc(t.about)}</span></li>`).join('')
  list.querySelectorAll('li').forEach(li => li.onclick = () => {
    const k = li.dataset.key; $('#new-dialog').close()
    if (k === 'blank') { startFrom({ units: bench.units, parts: [] }, 'Untitled'); log('New project'); return }
    startFrom({ ...buildTemplate(k, pal), units: bench.units }, TEMPLATES[k].name)   // sizes are exact in any units
    log(`Started from the ${TEMPLATES[k].name} template in ${$('#palette').value}`)
    say(`Here's a ${TEMPLATES[k].name.toLowerCase()} layout in ${$('#palette').value}. Change anything you like.`)
  })
  const mine = $('#my-template-list'); mine.innerHTML = '<li class="muted">Loading…</li>'
  $('#new-dialog').showModal()
  try {
    const d = await (await fetch(`/api/projects?space=${space()}&folder=templates`)).json()
    mine.innerHTML = (d.projects || []).length ? '' : '<li class="muted">None yet. Build a layout you reuse, then “Save what\'s on screen as a template”.</li>'
    for (const n of d.projects || []) {
      const li = document.createElement('li'); li.innerHTML = `<b>${esc(n)}</b>`
      li.onclick = async () => { $('#new-dialog').close(); startFrom(await (await fetch(`/api/projects/${encodeURIComponent(n)}?space=${space()}&folder=templates`)).json(), `${n} (copy)`); log(`Started from your template “${n}”`) }
      mine.appendChild(li)
    }
  } catch { mine.innerHTML = '<li class="muted">Could not reach the workshop server.</li>' }
}
$('#save-template').onclick = async () => {
  const name = (prompt('Name this template', project === 'Untitled' ? 'My layout' : project) || '').replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 80)
  if (!name) return
  const r = await fetch(`/api/projects/${encodeURIComponent(name)}?space=${space()}&folder=templates`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bench.toJSON()) })
  if (r.ok) { $('#new-dialog').close(); log(`Saved template “${name}”`); say(`Saved “${name}” as a template.`) } else log('Saving the template failed', 'err')
}
$('#btn-save').onclick = async () => {
  let name = project === 'Untitled' ? prompt('Name this project', 'My event') : project
  if (!name) return
  name = name.replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 80)
  const r = await fetch(`/api/projects/${encodeURIComponent(name)}?space=${space()}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bench.toJSON()) })
  if (r.ok) { setProject(name); log(`Saved “${name}” in ${space()}'s workspace`) } else log('Save failed', 'err')
}
$('#btn-open').onclick = async () => {
  const d = await (await fetch(`/api/projects?space=${space()}`)).json()
  const ul = $('#project-list'); ul.innerHTML = ''
  for (const n of d.projects || []) {
    const li = document.createElement('li'); li.textContent = n
    li.onclick = async () => { bench.load(await (await fetch(`/api/projects/${encodeURIComponent(n)}?space=${space()}`)).json()); setProject(n); log(`Opened “${n}”`); refreshInfo(); $('#open-dialog').close() }
    ul.appendChild(li)
  }
  if (!ul.children.length) ul.innerHTML = '<li class="muted">No projects yet in this workspace.</li>'
  $('#open-dialog').showModal()
}

setProject('Untitled')
loadConfig().then(loadSettings).then(() => { busy(false); say(`Hi, I’m ${assistant}. Tell me what to build, or start with a room and an arch from the bar below.`) })
