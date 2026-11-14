// Parts library. Every builder takes params in the user's words, converts with toMeters(), and returns a THREE.Group
// standing on the floor (y = 0) at true size. Generic shapes let the assistant build anything; event pieces are parametric.
import * as THREE from 'three'
import { toMeters, balloonDiameter, color, colorName } from './units.js'

const mat = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: color(c), roughness: 0.55, metalness: 0.05, ...extra })
const shiny = c => mat(c, { roughness: 0.25, metalness: /gold|silver|chrome|#d4af37|#c0c0c0|#c9a227/.test(String(c)) ? 0.7 : 0.1 })

// Balloon finishes: how each one looks in the 3D view (and what the shopping list calls it).
export const FINISHES = ['latex', 'chrome', 'pearl', 'satin', 'matte', 'clear']
export const BALLOON_SIZES = [5, 11, 16, 18, 24, 36]
const defaultFinish = hex => (/^#(d4af37|c9a227|c0c0c0|dcdcdc|b76e79)$/.test(hex) ? 'chrome' : 'latex')
function balloonMaterial(hex, finish) {
  const look = { latex: { roughness: 0.45, metalness: 0.05 }, chrome: { roughness: 0.15, metalness: 0.75 },
    pearl: { roughness: 0.3, metalness: 0.3 }, satin: { roughness: 0.3, metalness: 0.15 }, matte: { roughness: 0.85, metalness: 0 },
    clear: { roughness: 0.1, metalness: 0, transparent: true, opacity: 0.4 } }[finish] || {}
  return new THREE.MeshStandardMaterial({ color: hex, ...look })
}

// Tag a component for "Pull apart": its name (shown as a label) and which way it moves, in metres per step.
function part(m, name, explode = [0, 0, 0]) { m.userData.part = name; m.userData.explode = explode; return m }

function mesh(geo, material) {
  const m = new THREE.Mesh(geo, material)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

// ---------- generic shapes ----------
export const builders = {
  box(p) {
    const w = toMeters(p.width, 0.5), h = toMeters(p.height, 0.5), d = toMeters(p.depth, 0.5)
    const g = new THREE.Group(); const m = mesh(new THREE.BoxGeometry(w, h, d), mat(p.color)); m.position.y = h / 2; g.add(m)
    return { group: g, size: { w, h, d } }
  },
  cylinder(p) {
    const r = toMeters(p.radius, toMeters(p.diameter, 0.5) / 2), h = toMeters(p.height, 0.5)
    const g = new THREE.Group(); const m = mesh(new THREE.CylinderGeometry(toMeters(p.topRadius, r), r, h, 48), mat(p.color)); m.position.y = h / 2; g.add(m)
    return { group: g, size: { w: 2 * r, h, d: 2 * r } }
  },
  sphere(p) {
    const r = toMeters(p.radius, toMeters(p.diameter, 0.4) / 2)
    const g = new THREE.Group(); const m = mesh(new THREE.SphereGeometry(r, 40, 24), shiny(p.color)); m.position.y = r; g.add(m)
    return { group: g, size: { w: 2 * r, h: 2 * r, d: 2 * r } }
  },
  cone(p) {
    const r = toMeters(p.radius, 0.3), h = toMeters(p.height, 0.6)
    const g = new THREE.Group(); const m = mesh(new THREE.ConeGeometry(r, h, 40), mat(p.color)); m.position.y = h / 2; g.add(m)
    return { group: g, size: { w: 2 * r, h, d: 2 * r } }
  },
  torus(p) {
    const R = toMeters(p.radius, 0.4), t = toMeters(p.thickness, 0.06)
    const g = new THREE.Group(); const m = mesh(new THREE.TorusGeometry(R, t, 24, 64), shiny(p.color)); m.position.y = R + t; g.add(m)
    return { group: g, size: { w: 2 * (R + t), h: 2 * (R + t), d: 2 * t } }
  },

  // ---------- event pieces ----------
  // Balloon arch along a half-ellipse. "classic" = 4-balloon clusters of one size; "organic" = mixed sizes.
  // Returns a shopping count per colour and size: software counts, not the AI.
  balloonArch(p) {
    const W = toMeters(p.width, toMeters('8ft')), H = toMeters(p.height, toMeters('8ft'))
    const d = balloonDiameter(p.balloon || '11in')
    const colors = (p.colors && p.colors.length ? p.colors : ['white', 'gold']).map(c => color(c))
    const organic = String(p.style || 'classic').toLowerCase().startsWith('organic')
    const overrides = p.overrides || {}   // per-balloon changes, by balloon number: { 12: { size: 16, color: 'sage', finish: 'pearl' } }
    const g = new THREE.Group()
    const a = W / 2 - d / 2, b = H - d / 2
    // sample the arc length so clusters are evenly spaced
    const pts = []; const N = 400
    for (let i = 0; i <= N; i++) { const t = Math.PI * i / N; pts.push(new THREE.Vector3(-a * Math.cos(t), b * Math.sin(t) + d / 2, 0)) }
    const lens = [0]; for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]))
    const total = lens[lens.length - 1]
    const step = d * 0.85
    const clusters = Math.max(2, Math.round(total / step))
    const count = {}
    let n = 0
    // pos = where it sits on the frame; local = its offset from the cluster's centre (pulled apart further, so every
    // balloon stands on its own)
    const add = (pos, local, dia, c) => {
      const o = overrides[n] || {}
      const sizeIn = o.size ? Number(o.size) : Math.round(dia / 0.0254)
      const hex = o.color ? color(o.color) : c
      const finish = o.finish || p.finish || defaultFinish(hex)
      const s = mesh(new THREE.SphereGeometry(sizeIn * 0.0254 / 2, 20, 14), balloonMaterial(hex, finish)); s.position.copy(pos).add(local)
      // pulled apart: the arch grows outward from its middle and every cluster opens up, so each balloon stands alone
      const out = new THREE.Vector3(pos.x, pos.y - d / 2, 0).multiplyScalar(0.45)
      part(s, 'Balloon', [out.x + local.x * 4, out.y + local.y * 4, local.z * 5 + (rnd() - 0.5) * 0.15])
      s.userData.balloon = { number: n, size: sizeIn, color: colorName(hex), finish, changed: !!overrides[n] }
      const key = `${sizeIn}in ${colorName(hex)} ${finish}`; count[key] = (count[key] || 0) + 1
      g.add(s); n++
    }
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let k = 0; k <= clusters; k++) {
      const target = total * k / clusters
      let i = lens.findIndex(l => l >= target); if (i < 1) i = 1
      const p0 = pts[i]; const tangent = pts[Math.min(i + 1, N)].clone().sub(pts[i - 1]).normalize()
      const normal = new THREE.Vector3(-tangent.y, tangent.x, 0)
      const c = colors[k % colors.length]
      if (organic) {
        const sizes = [d, d * 1.45, d * 0.45]
        for (let j = 0; j < 3; j++) {
          const dia = sizes[Math.floor(rnd() * sizes.length)]
          const off = normal.clone().multiplyScalar((rnd() - 0.5) * d).add(new THREE.Vector3(0, 0, (rnd() - 0.5) * d))
          add(p0, off, dia, colors[Math.floor(rnd() * colors.length)])
        }
      } else {
        // classic quad: four balloons around the frame line
        const r = d * 0.42
        for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) add(p0, normal.clone().multiplyScalar(nx * r).add(new THREE.Vector3(0, 0, nz * r)), d, c)
      }
    }
    const shopping = Object.entries(count).sort().map(([k, v]) => `${v} × ${k}`)
    return { group: g, size: { w: W, h: H, d: d * 1.6 }, info: { balloons: n, shopping, arcLength: total } }
  },

  roundTable(p) {
    const D = toMeters(p.diameter, toMeters('60in')), h = toMeters(p.height, toMeters('30in'))
    const g = new THREE.Group()
    const top = mesh(new THREE.CylinderGeometry(D / 2, D / 2, 0.04, 64), mat(p.color || 'wood')); top.position.y = h - 0.02; g.add(part(top, 'Table top', [0, 0.75, 0]))
    if (p.linen !== false && !['false', 'none', 'no'].includes(String(p.linen).toLowerCase())) { const cloth = mesh(new THREE.CylinderGeometry(D / 2 + 0.02, D / 2 + 0.25, h - 0.01, 64, 1, true), mat(p.linen || 'ivory', { side: THREE.DoubleSide })); cloth.position.y = (h - 0.01) / 2; g.add(part(cloth, 'Linen', [0, 0.4, 0])) }
    const leg = mesh(new THREE.CylinderGeometry(0.04, 0.04, h - 0.04, 16), mat('#333')); leg.position.y = (h - 0.04) / 2; g.add(part(leg, 'Base'))
    return { group: g, size: { w: D, h, d: D }, info: { seats: Math.max(2, Math.floor(Math.PI * D / 0.6)) } }
  },

  banquetTable(p) {
    const L = toMeters(p.length, toMeters('6ft')), Wd = toMeters(p.width, toMeters('30in')), h = toMeters(p.height, toMeters('30in'))
    const g = new THREE.Group()
    const top = mesh(new THREE.BoxGeometry(L, 0.04, Wd), mat(p.color || 'wood')); top.position.y = h - 0.02; g.add(part(top, 'Table top', [0, 0.7, 0]))
    if (p.linen !== false && !['false', 'none', 'no'].includes(String(p.linen).toLowerCase())) { const cloth = mesh(new THREE.BoxGeometry(L + 0.04, h - 0.02, Wd + 0.04), mat(p.linen || 'ivory')); cloth.position.y = (h - 0.02) / 2; g.add(part(cloth, 'Linen', [0, 0.3, 0])) }
    return { group: g, size: { w: L, h, d: Wd }, info: { seats: Math.floor(L / 0.6) * 2 } }
  },

  chair(p) {
    const s = toMeters(p.seatHeight, toMeters('18in')), w = 0.42, back = 0.45
    const g = new THREE.Group(); const c = p.color || 'white'
    const seat = mesh(new THREE.BoxGeometry(w, 0.04, w), mat(c)); seat.position.y = s; g.add(part(seat, 'Seat', [0, 0.25, 0]))
    const bk = mesh(new THREE.BoxGeometry(w, back, 0.04), mat(c)); bk.position.set(0, s + back / 2, -w / 2 + 0.02); g.add(part(bk, 'Back', [0, 0.45, -0.3]))
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const l = mesh(new THREE.CylinderGeometry(0.015, 0.015, s, 8), mat(c)); l.position.set(x * (w / 2 - 0.03), s / 2, z * (w / 2 - 0.03)); g.add(part(l, 'Leg', [x * 0.22, 0, z * 0.22])) }
    return { group: g, size: { w, h: s + back, d: w } }
  },

  backdrop(p) {
    const W = toMeters(p.width, toMeters('8ft')), H = toMeters(p.height, toMeters('8ft'))
    const g = new THREE.Group(); const shape = String(p.shape || 'rectangle').toLowerCase()
    let geo
    if (shape.startsWith('arch')) {
      const sh = new THREE.Shape(); const r = W / 2
      sh.moveTo(-r, 0); sh.lineTo(-r, H - r); sh.absarc(0, H - r, r, Math.PI, 0, true); sh.lineTo(r, 0); sh.lineTo(-r, 0)
      geo = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false })
    } else if (shape.startsWith('circle')) {
      geo = new THREE.CylinderGeometry(W / 2, W / 2, 0.03, 64); geo.rotateX(Math.PI / 2); geo.translate(0, W / 2, 0)
    } else {
      geo = new THREE.BoxGeometry(W, H, 0.03); geo.translate(0, H / 2, 0)
    }
    const m = mesh(geo, mat(p.color || 'white')); g.add(part(m, 'Backdrop'))
    return { group: g, size: { w: W, h: shape.startsWith('circle') ? W : H, d: 0.03 } }
  },

  // ---------- pieces from a TrueSize Scan room scan (Apple RoomPlan, exact sizes in metres) ----------
  wall(p) {
    const w = toMeters(p.width, 3), h = toMeters(p.height, 2.5), t = toMeters(p.thickness, 0.1)
    const look = p.seeThrough ? mat(p.color || '#e9e4dc', { transparent: true, opacity: 0.18, depthWrite: false }) : mat(p.color || '#e9e4dc')
    const g = new THREE.Group(); const m = mesh(new THREE.BoxGeometry(w, h, t), look); m.position.y = h / 2
    g.add(part(m, 'Wall', [0, 0, 0])); return { group: g, size: { w, h, d: t } }
  },
  opening(p) {   // door, window or open doorway, drawn a little proud of the wall so it shows from both sides
    const w = toMeters(p.width, 0.9), h = toMeters(p.height, 2), type = String(p.type || 'door')
    const look = { door: mat('#8a6a4a'), window: mat('#9fd3ff', { transparent: true, opacity: 0.55 }), opening: mat('#ffffff', { transparent: true, opacity: 0.25 }) }[type] || mat('#8a6a4a')
    const g = new THREE.Group(); const m = mesh(new THREE.BoxGeometry(w, h, 0.16), look); m.position.y = h / 2
    g.add(part(m, type[0].toUpperCase() + type.slice(1))); return { group: g, size: { w, h, d: 0.16 } }
  },
  furniture(p) {  // what the scan found in the room (table, sofa, storage…): a see-through box at its true size
    const w = toMeters(p.width, 1), h = toMeters(p.height, 0.8), d = toMeters(p.depth, 1)
    const g = new THREE.Group()
    const m = mesh(new THREE.BoxGeometry(w, h, d), mat(p.color || '#7f93a3', { transparent: true, opacity: 0.45 })); m.position.y = h / 2; g.add(m)
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x333333 })); edges.position.y = h / 2; g.add(edges)
    return { group: g, size: { w, h, d } }
  },
  floor(p) {
    const w = toMeters(p.width, 6), d = toMeters(p.depth, 8)
    const g = new THREE.Group(); const m = mesh(new THREE.BoxGeometry(w, 0.02, d), mat(p.color || '#b9a58a')); m.position.y = -0.01
    g.add(m); return { group: g, size: { w, h: 0.02, d } }
  },

  // Room shell from dimensions: floor + three walls (front left open so you can see in).
  room(p) {
    const W = toMeters(p.width, 6), D = toMeters(p.depth, 8), H = toMeters(p.height, toMeters('10ft'))
    const g = new THREE.Group(); const wall = mat(p.wallColor || '#e9e4dc'); const floor = mat(p.floorColor || '#b9a58a')
    const f = mesh(new THREE.BoxGeometry(W, 0.02, D), floor); f.position.y = -0.01; g.add(part(f, 'Floor'))
    // Each wall hangs from a hinge along its bottom edge, so "Pull apart" folds it down and outward like an opening box:
    // it can never pass through what's inside. fold = [axis, direction the top falls].
    const hinged = (geo, name, at, fold) => {
      const hinge = new THREE.Group(); hinge.position.copy(at); hinge.userData.fold = fold
      const m = mesh(geo, wall); m.position.y = H / 2; m.userData.part = name; hinge.add(m); g.add(hinge)
    }
    hinged(new THREE.BoxGeometry(W, H, 0.1), 'Back wall', new THREE.Vector3(0, 0, -D / 2), ['x', -1])
    hinged(new THREE.BoxGeometry(0.1, H, D), 'Left wall', new THREE.Vector3(-W / 2, 0, 0), ['z', 1])
    hinged(new THREE.BoxGeometry(0.1, H, D), 'Right wall', new THREE.Vector3(W / 2, 0, 0), ['z', -1])
    return { group: g, size: { w: W, h: H, d: D }, info: { floorArea: W * D } }
  },
}

export const kinds = Object.keys(builders)
