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

// Balloons along a path (arch frame, garland line, column pole): clusters evenly spaced along it, "classic" = four
// balloons of one size round the line, "organic" = mixed sizes. Every balloon carries its number, size, colour and
// finish, and can be changed alone through p.overrides. Returns the shopping counts. outward(pos) = which way a
// cluster moves when pulled apart.
function balloonsAlong(g, pts, p, d, outward) {
  const colors = (p.colors && p.colors.length ? p.colors : ['white', 'gold']).map(c => color(c))
  const organic = String(p.style || 'classic').toLowerCase().startsWith('organic')
  const overrides = p.overrides || {}
  const N = pts.length - 1
  const lens = [0]; for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]))
  const total = lens[lens.length - 1]
  const clusters = Math.max(2, Math.round(total / (d * 0.85)))
  const count = {}
  let n = 0
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const add = (pos, local, dia, c) => {
    const o = overrides[n] || {}
    const sizeIn = o.size ? Number(o.size) : Math.round(dia / 0.0254)
    const hex = o.color ? color(o.color) : c
    const finish = o.finish || p.finish || defaultFinish(hex)
    const s = mesh(new THREE.SphereGeometry(sizeIn * 0.0254 / 2, 20, 14), balloonMaterial(hex, finish)); s.position.copy(pos).add(local)
    const out = outward(pos)
    part(s, 'Balloon', [out.x + local.x * 4, out.y + local.y * 4, out.z + local.z * 5 + (rnd() - 0.5) * 0.15])
    s.userData.balloon = { number: n, size: sizeIn, color: colorName(hex), finish, changed: !!overrides[n] }
    const key = `${sizeIn}in ${colorName(hex)} ${finish}`; count[key] = (count[key] || 0) + 1
    g.add(s); n++
  }
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
      const r = d * 0.42
      for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) add(p0, normal.clone().multiplyScalar(nx * r).add(new THREE.Vector3(0, 0, nz * r)), d, c)
    }
  }
  const shopping = Object.entries(count).sort().map(([k, v]) => `${v} × ${k}`)
  return { balloons: n, shopping, arcLength: total }
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
    const g = new THREE.Group()
    const a = W / 2 - d / 2, b = H - d / 2
    const pts = []; const N = 400
    for (let i = 0; i <= N; i++) { const t = Math.PI * i / N; pts.push(new THREE.Vector3(-a * Math.cos(t), b * Math.sin(t) + d / 2, 0)) }
    // pulled apart: the arch grows outward from its middle and every cluster opens up
    const info = balloonsAlong(g, pts, p, d, pos => new THREE.Vector3(pos.x, pos.y - d / 2, 0).multiplyScalar(0.45))
    return { group: g, size: { w: W, h: H, d: d * 1.6 }, info }
  },

  // Garland hung on a backdrop or wall, in its own vertical plane. width = how far it runs, height = its highest point.
  // shape: "swag" (dips in the middle), "cascade" (across the top, then down one side), "line" (straight across).
  balloonGarland(p) {
    const W = toMeters(p.width, toMeters('8ft')), H = toMeters(p.height, toMeters('8ft'))
    const d = balloonDiameter(p.balloon || '11in'), shape = String(p.shape || 'cascade').toLowerCase()
    const g = new THREE.Group(), pts = [], N = 300
    for (let i = 0; i <= N; i++) {
      const t = i / N
      if (shape.startsWith('swag')) pts.push(new THREE.Vector3(-W / 2 + W * t, H - Math.sin(Math.PI * t) * Math.min(H * 0.3, W * 0.15), 0))
      else if (shape.startsWith('line')) pts.push(new THREE.Vector3(-W / 2 + W * t, H, 0))
      else {   // cascade: along the top from the left, curving down the right side to about a third of the height
        const turn = 0.6
        if (t < turn) pts.push(new THREE.Vector3(-W / 2 + W * (t / turn), H - Math.sin(Math.PI * t / turn) * 0.05 * W, 0))
        else { const u = (t - turn) / (1 - turn); pts.push(new THREE.Vector3(W / 2 + Math.sin(Math.PI * u) * 0.05 * W, H - u * H * 0.65, 0)) }
      }
    }
    const info = balloonsAlong(g, pts, { style: 'organic', ...p }, d, pos => new THREE.Vector3(pos.x * 0.25, (pos.y - H / 2) * 0.25, 0.5))
    return { group: g, size: { w: W, h: H, d: d * 1.6 }, info: { ...info, item: 'balloon garland' } }
  },

  // Balloon column: quad clusters stacked on a weighted base, optional big topper balloon.
  balloonColumn(p) {
    const H = toMeters(p.height, toMeters('6ft')), d = balloonDiameter(p.balloon || '11in')
    const baseH = 0.1, g = new THREE.Group()
    const base = mesh(new THREE.BoxGeometry(0.4, baseH, 0.4), mat(p.baseColor || '#dddddd')); base.position.y = baseH / 2
    g.add(part(base, 'Weighted base'))
    const topper = p.topper === false || String(p.topper) === 'false' ? 0 : balloonDiameter(p.topper || '24in')
    const top = H - topper
    const pts = []; for (let i = 0; i <= 200; i++) pts.push(new THREE.Vector3(0, baseH + d / 2 + (top - baseH - d) * i / 200, 0))
    const info = balloonsAlong(g, pts, { style: 'classic', ...p }, d, pos => new THREE.Vector3(0, (pos.y - baseH) * 0.35, 0))
    if (topper) {
      const c = color((p.topperColor || (p.colors || ['gold'])[0]))
      const t = mesh(new THREE.SphereGeometry(topper / 2, 28, 18), new THREE.MeshStandardMaterial({ color: c, roughness: 0.15, metalness: 0.6 }))
      t.position.y = H - topper / 2; g.add(part(t, 'Topper balloon', [0, H * 0.4, 0]))
      const k = `${Math.round(topper / 0.0254)}in ${colorName(c)} topper`
      info.shopping = [...info.shopping, `1 × ${k}`]
    }
    return { group: g, size: { w: d * 2, h: H, d: d * 2 }, info: { ...info, item: 'balloon column' } }
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

  // ---------- table-top and room decor ----------
  // Centrepiece. style "flowers" (low and round), "candles" (three pillars), "tall" (glass stem with a bloom on top).
  // Placed on a table by the Workshop automatically.
  centerpiece(p) {
    const style = String(p.style || 'flowers').toLowerCase(), c = p.color || 'blush', g = new THREE.Group()
    let w, h
    if (style.startsWith('candle')) {
      h = toMeters(p.height, toMeters('12in')); w = 0.3
      ;[[-0.08, 1], [0.0, 0.75], [0.08, 0.55]].forEach(([x, f], i) => {
        const pillar = mesh(new THREE.CylinderGeometry(0.04, 0.04, h * f, 24), mat(p.color || 'ivory')); pillar.position.set(x, h * f / 2, (i % 2) * 0.04)
        g.add(part(pillar, 'Candle', [x * 3, 0.15 + i * 0.05, 0]))
        const flame = mesh(new THREE.ConeGeometry(0.012, 0.04, 12), new THREE.MeshBasicMaterial({ color: '#ffb84d' })); flame.position.set(0, h * f / 2 + 0.025, 0); pillar.add(flame)
      })
    } else if (style.startsWith('tall')) {
      h = toMeters(p.height, toMeters('30in')); w = toMeters(p.diameter, toMeters('18in'))
      const stem = mesh(new THREE.CylinderGeometry(0.05, 0.08, h * 0.7, 24), mat('#dff3ff', { transparent: true, opacity: 0.35 })); stem.position.y = h * 0.35
      g.add(part(stem, 'Glass vase', [0, 0, 0]))
      const bloom = new THREE.Group(); bloom.position.y = h * 0.7
      for (let i = 0; i < 24; i++) { const f = mesh(new THREE.SphereGeometry(0.05, 12, 8), mat(i % 4 ? c : '#6f8f5a')); const a = i * 2.4, r = (i / 24) * w / 2; f.position.set(Math.cos(a) * r, Math.sin(i) * 0.06 + 0.08, Math.sin(a) * r); bloom.add(f) }
      g.add(part(bloom, 'Flowers', [0, 0.35, 0]))
    } else {
      h = toMeters(p.height, toMeters('10in')); w = toMeters(p.diameter, toMeters('14in'))
      const bowl = mesh(new THREE.CylinderGeometry(w * 0.3, w * 0.22, h * 0.35, 28), mat(p.vaseColor || 'gold')); bowl.position.y = h * 0.175
      g.add(part(bowl, 'Bowl', [0, 0, 0]))
      const flowers = new THREE.Group(); flowers.position.y = h * 0.35
      for (let i = 0; i < 30; i++) { const f = mesh(new THREE.SphereGeometry(0.035 + (i % 3) * 0.01, 12, 8), mat(i % 5 ? c : '#6f8f5a')); const a = i * 2.4, r = Math.sqrt(i / 30) * w / 2; f.position.set(Math.cos(a) * r, (1 - r / (w / 2)) * h * 0.55, Math.sin(a) * r); flowers.add(f) }
      g.add(part(flowers, 'Flowers', [0, 0.3, 0]))
    }
    return { group: g, size: { w, h, d: w }, info: { item: 'centrepiece' } }
  },

  // Tiered cake: tiers (count), diameter of the bottom tier, tierHeight. Sits on a table automatically.
  cake(p) {
    const tiers = Math.max(1, Math.min(7, Number(p.tiers) || 3)), D = toMeters(p.diameter, toMeters('12in')), th = toMeters(p.tierHeight, toMeters('5in'))
    const g = new THREE.Group()
    const board = mesh(new THREE.CylinderGeometry(D / 2 + 0.04, D / 2 + 0.04, 0.015, 40), mat('gold')); board.position.y = 0.0075; g.add(part(board, 'Cake board'))
    for (let i = 0; i < tiers; i++) {
      const d = D * (1 - i * 0.22)
      const tier = mesh(new THREE.CylinderGeometry(d / 2, d / 2, th, 40), mat(p.color || 'ivory')); tier.position.y = 0.015 + th * i + th / 2
      g.add(part(tier, `Tier ${i + 1}`, [0, 0.18 * (i + 1), 0]))
    }
    return { group: g, size: { w: D, h: 0.015 + th * tiers, d: D }, info: { item: `${tiers}-tier cake` } }
  },

  // Drapery: fabric panels with soft folds. panels (count), sheer (see-through).
  drapery(p) {
    const W = toMeters(p.width, toMeters('10ft')), H = toMeters(p.height, toMeters('10ft')), panels = Math.max(1, Math.min(8, Number(p.panels) || 2))
    const sheer = p.sheer === true || String(p.sheer) === 'true'
    const g = new THREE.Group(), pw = W / panels
    for (let k = 0; k < panels; k++) {
      const geo = new THREE.PlaneGeometry(pw, H, 48, 1), pos = geo.attributes.position
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin((pos.getX(i) / pw + 0.5) * Math.PI * 8) * 0.04)
      geo.computeVertexNormals()
      const m = mesh(geo, mat(p.color || 'ivory', { side: THREE.DoubleSide, ...(sheer ? { transparent: true, opacity: 0.45 } : {}) }))
      m.position.set(-W / 2 + pw * (k + 0.5), H / 2, 0)
      g.add(part(m, 'Drape panel', [(k - (panels - 1) / 2) * 0.4, 0, 0.3]))
    }
    return { group: g, size: { w: W, h: H, d: 0.1 }, info: { item: `drape set (${panels} panel${panels > 1 ? 's' : ''})` } }
  },

  // Dance floor: style "checker", "white", "black" or "wood", laid in 2 ft tiles.
  danceFloor(p) {
    const W = toMeters(p.width, toMeters('16ft')), D = toMeters(p.depth, W), style = String(p.style || 'checker').toLowerCase()
    const tile = toMeters('2ft'), nx = Math.max(1, Math.round(W / tile)), nz = Math.max(1, Math.round(D / tile))
    const looks = { checker: ['#111111', '#f5f5f5'], white: ['#f5f5f5', '#ececec'], black: ['#111111', '#1c1c1c'], wood: ['#a0784f', '#b08a5a'] }[style] || ['#111111', '#f5f5f5']
    const mats = looks.map(c => mat(c, { roughness: 0.2, metalness: 0.05 }))
    const g = new THREE.Group(), tw = W / nx, td = D / nz
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(tw * 0.995, 0.02, td * 0.995), mats[(i + j) % 2]); t.receiveShadow = true
      t.position.set(-W / 2 + tw * (i + 0.5), 0.01, -D / 2 + td * (j + 0.5)); g.add(t)
    }
    return { group: g, size: { w: W, h: 0.02, d: D }, info: { item: `dance floor (${nx * nz} tiles, 2 ft)` } }
  },

  // Uplight: a small floor light washing colour up the wall behind it (turn it to face the wall).
  uplight(p) {
    const c = color(p.color || 'blush'), g = new THREE.Group()
    const body = mesh(new THREE.BoxGeometry(0.2, 0.14, 0.2), mat('#222222')); body.position.y = 0.07; g.add(part(body, 'Light'))
    const light = new THREE.SpotLight(c, 25, 6, 0.45, 0.6); light.position.set(0, 0.15, 0)
    const aim = new THREE.Object3D(); aim.position.set(0, 3, -0.8); g.add(aim); light.target = aim; g.add(light)
    const beam = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.4, 24, 1, true), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }))
    beam.rotation.x = Math.PI - 0.32; beam.position.set(0, 1.3, -0.38); g.add(beam)
    return { group: g, size: { w: 0.2, h: 0.14, d: 0.2 }, info: { item: 'uplight' } }
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
