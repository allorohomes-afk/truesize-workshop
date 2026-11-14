// Turn a TrueSize Scan room scan into Workshop pieces. The scan is Apple RoomPlan output: every wall, door, window and
// piece of furniture with its true size (metres), centre and heading. We square the room up (longest wall along the
// x axis), centre it, set the floor at 0, and hand back ordinary "add" operations, so Undo, Measure and Pull apart all
// work on a scan the same way they do on anything else.
import { formatLength } from './units.js'

const m = v => `${v.toFixed(3)}m`
const title = s => String(s || 'item').replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim()

export function scanToOps(scan, units) {
  const items = scan.items || []
  const walls = items.filter(i => i.type === 'wall')
  if (!walls.length) throw new Error('This scan has no walls. Try scanning again, slowly, pointing at every wall.')
  const floorY = Math.min(...items.map(i => i.y - i.h / 2))
  // square up: turn the scan so the longest wall runs left to right
  const turn = -walls.reduce((a, b) => (b.w > a.w ? b : a)).yaw
  const rot = (x, z) => [x * Math.cos(turn) + z * Math.sin(turn), -x * Math.sin(turn) + z * Math.cos(turn)]
  const placed = items.map(i => { const [x, z] = rot(i.x, i.z); return { ...i, x, z, yaw: i.yaw + turn } })
  // centre on the walls' corners
  const xs = [], zs = []
  for (const w of placed.filter(i => i.type === 'wall')) for (const s of [-1, 1]) {
    xs.push(w.x + s * Math.cos(w.yaw) * w.w / 2); zs.push(w.z - s * Math.sin(w.yaw) * w.w / 2)
  }
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2
  const width = Math.max(...xs) - Math.min(...xs), depth = Math.max(...zs) - Math.min(...zs)
  const deg = r => Math.round((r * 180 / Math.PI) * 10) / 10
  const ops = [{ op: 'add', id: 'scan-floor', kind: 'floor', label: `Floor ${formatLength(width, units)} × ${formatLength(depth, units)}`, params: { width: m(width), depth: m(depth) }, position: ['0m', '0m', '0m'] }]
  const n = {}
  // the wall nearest the viewer (front, +z) is see-through, like the open side of a drawn room
  const front = placed.filter(i => i.type === 'wall').reduce((a, b) => (b.z > a.z ? b : a))
  for (const i of placed) {
    const k = i.type === 'object' ? i.category : i.type; n[k] = (n[k] || 0) + 1
    const pos = [m(i.x - cx), m(Math.max(0, i.y - i.h / 2 - floorY)), m(i.z - cz)]
    const base = { op: 'add', id: `scan-${k}-${n[k]}`, position: pos, rotationY: deg(i.yaw) }
    if (i.type === 'wall') ops.push({ ...base, kind: 'wall', label: `Wall ${formatLength(i.w, units)}`, params: { width: m(i.w), height: m(i.h), thickness: '0.1m', ...(i === front ? { seeThrough: true } : {}) }, position: [pos[0], '0m', pos[2]] })
    else if (['door', 'window', 'opening'].includes(i.type)) ops.push({ ...base, kind: 'opening', label: `${title(i.type)} ${formatLength(i.w, units)}`, params: { width: m(i.w), height: m(i.h), type: i.type } })
    else ops.push({ ...base, kind: 'furniture', label: title(i.category), params: { width: m(i.w), height: m(i.h), depth: m(i.d || 0.5) } })
  }
  const height = Math.max(...walls.map(w => w.h))
  return { ops, width, depth, height, counts: n }
}
