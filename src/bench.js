// The 3D bench: renderer, camera, lights, grid, labels, picking, measuring, explode/assemble.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { builders } from './parts.js'
import { toMeters, color, formatLength } from './units.js'

// Pieces that stay on the floor when pulled apart (walls and openings from a scan).
const FIXED_KINDS = new Set(['wall', 'opening', 'floor', 'furniture'])

export class Bench {
  constructor(host, { onPick, onMeasure } = {}) {
    this.host = host
    this.onPick = onPick || (() => {})
    this.onMeasure = onMeasure || (() => {})
    this.units = 'imperial'
    this.parts = new Map()      // id -> { spec, group, size, info, label }
    this.exploded = false
    this.tagBalloons = true
    this.measuring = false
    this.measurePts = []

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(this.renderer.domElement)
    this.labels = new CSS2DRenderer()
    this.labels.domElement.className = 'label-layer'
    host.appendChild(this.labels.domElement)

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500)
    this.camera.position.set(1, 6, 11)   // from the room's open front, above the walls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(0, 1, 0)
    this.controls.enableDamping = true

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.1))
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.position.set(6, 12, 8); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048)
    Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15 })
    this.scene.add(sun)
    this.grid = new THREE.GridHelper(40, 40 * 4, 0x3b6e8f, 0x1d2b36)   // 25 cm squares
    this.scene.add(this.grid)
    this.measureGroup = new THREE.Group(); this.scene.add(this.measureGroup)

    this.ray = new THREE.Raycaster(); this.mouse = new THREE.Vector2()
    this.renderer.domElement.addEventListener('pointerdown', e => this._down = [e.clientX, e.clientY])
    this.renderer.domElement.addEventListener('pointerup', e => {
      if (!this._down || Math.hypot(e.clientX - this._down[0], e.clientY - this._down[1]) > 4) return
      this._click(e)
    })
    new ResizeObserver(() => this.resize()).observe(host)
    this.resize()
    this.clock = new THREE.Clock()
    this.renderer.setAnimationLoop(() => { this._tickExplode(this.clock.getDelta()); this._cullTags(); this.controls.update(); this.renderer.render(this.scene, this.camera); this.labels.render(this.scene, this.camera) })
    this.applyTheme()
  }

  applyTheme() {
    const css = getComputedStyle(document.documentElement)
    this.scene.background = new THREE.Color(css.getPropertyValue('--bench-bg').trim() || '#0b1016')
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight
    this.renderer.setSize(w, h); this.labels.setSize(w, h)
    this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix()
  }

  // ---------- parts ----------
  add(spec) {
    const build = builders[spec.kind]
    if (!build) throw new Error(`I don't know how to build a "${spec.kind}" yet`)
    if (this.parts.has(spec.id)) this.remove(spec.id)
    const built = build(spec.params || {})
    const g = built.group
    g.userData.partId = spec.id
    g.traverse(o => { o.userData.partId = spec.id })
    this._place(g, spec)
    const label = this._label(spec.label || spec.id)
    label.position.set(0, built.size.h + 0.15, 0)
    g.add(label)
    this.scene.add(g)
    const isNewRoom = spec.kind === 'room' && !this.parts.has(spec.id)
    this.parts.set(spec.id, { spec, group: g, size: built.size, info: built.info || {}, label, home: g.position.clone() })
    if (isNewRoom) this.frameAll()   // a new room changes the whole picture: show it from the open front
    if (this.explodeAmt) { this._componentLabels(false); this._applyExplode(this.explodeAmt) }
    return this.parts.get(spec.id)
  }

  update(id, changes) {
    const p = this.parts.get(id)
    if (!p) throw new Error(`there's no part called "${id}"`)
    const spec = { ...p.spec, ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)), params: { ...p.spec.params, ...(changes.params || {}) } }
    if (changes.color && !changes.params?.color) spec.params.color = changes.color
    return this.add(spec)
  }

  remove(id) {
    const p = this.parts.get(id)
    if (!p) return
    if (this._compLabels) this._componentLabels(false)   // tags are rebuilt for the pieces that remain
    p.label.element.remove()
    this.scene.remove(p.group)
    this.parts.delete(id)
  }

  clear() { for (const id of [...this.parts.keys()]) this.remove(id); this.clearMeasures() }

  _place(g, spec) {
    const [x, y, z] = (spec.position || [0, 0, 0]).map(v => toMeters(v, 0))
    g.position.set(x, y, z)
    g.rotation.y = THREE.MathUtils.degToRad(Number(spec.rotationY || 0))
  }

  _label(text) {
    const el = document.createElement('div'); el.className = 'part-label'; el.textContent = text
    const o = new CSS2DObject(el); o.visible = true
    return o
  }

  setLabels(on) { for (const p of this.parts.values()) p.label.element.style.display = on ? '' : 'none' }

  // ---------- pull apart: pieces glide away from each other and each piece separates into its named components ----
  // amount 0 = together, 1 = apart, up to 2 = far apart. Software moves things; nothing is resized.
  explode(amount = 1) { this.explodeTarget = Math.max(0, Math.min(2, amount)); this.exploded = this.explodeTarget > 0 }
  assemble() { this.explodeTarget = 0; this.exploded = false; this.highlight(null) }
  setBalloonTags(on) { this.tagBalloons = on; if (this._compLabels) { this._componentLabels(false); this._componentLabels(true) } }

  _tickExplode(dt) {
    const target = this.explodeTarget || 0, now = this.explodeAmt || 0
    if (Math.abs(target - now) < 1e-3) { if (now !== target) this._applyExplode(target); return }
    this._applyExplode(now + (target - now) * Math.min(1, dt * 6))   // ease toward the target (about half a second)
  }

  _applyExplode(a) {
    this.explodeAmt = a
    const fold = Math.min(1, a) * THREE.MathUtils.degToRad(84)   // walls fold flat by the time a = 1
    // the room's floor area: pieces stay inside it, so nothing is pushed through a wall
    const shell = [...this.parts.values()].find(p => p.spec.kind === 'room' || p.spec.kind === 'floor')
    const pieces = [...this.parts.values()].filter(p => !['room', 'floor'].includes(p.spec.kind) && !FIXED_KINDS.has(p.spec.kind))
    const centre = new THREE.Vector3()
    for (const p of pieces) centre.add(p.home)
    if (pieces.length) centre.divideScalar(pieces.length)
    pieces.forEach((p, i) => {
      const dir = p.home.clone().sub(centre).setY(0)
      if (dir.lengthSq() < 1e-4) dir.set(Math.cos(i * 2.4), 0, Math.sin(i * 2.4))   // pieces in the same spot fan out
      const pos = p.home.clone().add(dir.normalize().multiplyScalar(a * 0.9))
      if (shell) {
        const r = Math.max(p.size.w, p.size.d) / 2 + 0.1
        const hw = Math.max(0, shell.size.w / 2 - r), hd = Math.max(0, shell.size.d / 2 - r)
        // never further out than the room edge, and never further out than the piece already was
        const clampAxis = (v, c, h, home) => Math.max(Math.min(c - h, home), Math.min(Math.max(c + h, home), v))
        pos.x = clampAxis(pos.x, shell.home.x, hw, p.home.x)
        pos.z = clampAxis(pos.z, shell.home.z, hd, p.home.z)
      }
      p.group.position.copy(pos).add(new THREE.Vector3(0, a * 0.35, 0))
    })
    for (const p of this.parts.values()) {
      if (p.spec.kind === 'room') p.group.position.copy(p.home)
      p.group.traverse(o => {
        if (o.userData.fold) { const [axis, dir] = o.userData.fold; o.rotation[axis] = dir * fold; return }
        const e = o.userData.explode
        if (!e) return
        if (!o.userData.home) o.userData.home = o.position.clone()
        o.position.set(o.userData.home.x + e[0] * a, o.userData.home.y + e[1] * a, o.userData.home.z + e[2] * a)
      })
      // scanned walls fold outward about their own bottom edge; doors and windows hide while the room is open
      if (p.spec.kind === 'wall' && shell) {
        const out = p.home.clone().sub(shell.home)
        const localZ = new THREE.Vector3(Math.sin(p.group.rotation.y), 0, Math.cos(p.group.rotation.y))
        p.group.rotation.order = 'YXZ'
        p.group.rotation.x = Math.sign(out.dot(localZ) || 1) * fold
      }
      if (p.spec.kind === 'opening') p.group.visible = a < 0.15
    }
    this._componentLabels(a > 0.35)
  }

  // Balloon tags only show near the camera: far away you see the arch, zoom in and each balloon reads its tag.
  _cullTags() {
    if (!this._compLabels || !this.tagBalloons) return
    const cam = this.camera.position, w = new THREE.Vector3()
    for (const l of this._compLabels) {
      if (!l.element.classList.contains('balloon-tag')) continue
      l.visible = l.element.classList.contains('changed') || l.getWorldPosition(w).distanceTo(cam) < 2.4
    }
  }

  // Name tags on the components while pulled apart (one per name per piece; balloons and legs are counted, not tagged).
  _componentLabels(show) {
    if (show === !!this._compLabels) return
    if (!show) { for (const l of this._compLabels) { l.element.remove(); l.parent?.remove(l) } this._compLabels = null; return }
    this._compLabels = []
    for (const p of this.parts.values()) {
      const seen = new Map()
      p.group.traverse(o => { if (o.userData.part && o.userData.part !== 'Floor') seen.set(o.userData.part, [...(seen.get(o.userData.part) || []), o]) })
      for (const [name, objs] of seen) {
        if (name === 'Balloon' && this.tagBalloons) {   // every balloon gets its own tag: size, colour, finish
          for (const o of objs) {
            const b = o.userData.balloon
            const l = this._label(`${b.size}″ ${b.color} · ${b.finish}`); l.element.classList.add('component-label', 'balloon-tag')
            if (b.changed) l.element.classList.add('changed')
            l.position.set(0, b.size * 0.0254 / 2 + 0.03, 0); o.add(l); this._compLabels.push(l)
          }
          continue
        }
        if (seen.size < 2) continue
        const text = objs.length > 1 ? `${objs.length} × ${name.toLowerCase()}s` : name
        const l = this._label(text); l.element.classList.add('component-label')
        const host = objs[Math.floor(objs.length / 2)]
        host.geometry.computeBoundingBox()
        l.position.set(0, host.geometry.boundingBox.max.y + 0.08, 0)
        host.add(l); this._compLabels.push(l)
      }
    }
  }

  // ---------- picking + measuring ----------
  _click(e) {
    const r = this.renderer.domElement.getBoundingClientRect()
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.ray.setFromCamera(this.mouse, this.camera)
    const targets = [...[...this.parts.values()].map(p => p.group), ...this._importedRoots()]
    const hits = this.ray.intersectObjects(targets, true)
    if (this.measuring) {
      const pt = hits[0]?.point || this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3())
      if (pt) this._measurePoint(pt)
      return
    }
    const hit = hits.find(h => h.object.visible && h.object.isMesh)
    const id = hit?.object?.userData?.partId
    // while pulled apart, a click picks the single component (one balloon, a table top…), not the whole piece
    const component = this.exploded && hit?.object?.userData?.part ? hit.object : null
    this.highlight(component)
    this.onPick(id ? this.parts.get(id) : null, component)
  }

  highlight(obj) {
    if (this._lit) { this._lit.material.emissive?.setHex(0x000000); this._lit = null }
    if (obj?.material?.emissive) { obj.material = obj.material.clone(); obj.material.emissive.setHex(0x553300); this._lit = obj }
  }

  // Find one balloon again after its arch was rebuilt (e.g. after a change), and light it up.
  balloon(id, number) {
    let found = null
    this.parts.get(id)?.group.traverse(o => { if (o.userData.balloon?.number === number) found = o })
    this.highlight(found)
    return found
  }

  _importedRoots() { return this.scene.children.filter(o => o.userData.imported) }

  _measurePoint(pt) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd400 }))
    dot.position.copy(pt); this.measureGroup.add(dot)
    this.measurePts.push(pt.clone())
    if (this.measurePts.length === 2) {
      const [a, b] = this.measurePts
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0xffd400 }))
      this.measureGroup.add(line)
      const dist = a.distanceTo(b), rise = Math.abs(b.y - a.y), run = Math.hypot(b.x - a.x, b.z - a.z)
      const angle = THREE.MathUtils.radToDeg(Math.atan2(rise, run))
      const tag = this._label(`${formatLength(dist, this.units)}  ·  ↕ ${formatLength(rise, this.units)}  ·  ${angle.toFixed(0)}°`)
      tag.element.classList.add('measure-label'); tag.position.copy(a.clone().add(b).multiplyScalar(0.5)); this.measureGroup.add(tag)
      this.onMeasure({ distance: dist, rise, run, angle })
      this.measurePts = []
    }
  }

  clearMeasures() {
    for (const o of [...this.measureGroup.children]) { if (o.element) o.element.remove(); this.measureGroup.remove(o) }
    this.measurePts = []
  }

  // ---------- scans (GLB/GLTF/OBJ in real metres from LiDAR apps) ----------
  async importScan(file) {
    const url = URL.createObjectURL(file)
    const name = file.name.toLowerCase()
    let root
    if (name.endsWith('.glb') || name.endsWith('.gltf')) root = (await new GLTFLoader().loadAsync(url)).scene
    else if (name.endsWith('.obj')) root = await new OBJLoader().loadAsync(url)
    else throw new Error('Scans can be .glb, .gltf or .obj (Scaniverse and 3d Scanner App can export these)')
    URL.revokeObjectURL(url)
    root.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true } })
    // sit it on the floor; keep its real scale
    const box = new THREE.Box3().setFromObject(root)
    root.position.y -= box.min.y
    root.userData.imported = file.name
    this.scene.add(root)
    const size = box.getSize(new THREE.Vector3())
    return { width: size.x, depth: size.z, height: size.y }
  }

  snapshot() { return this.renderer.domElement.toDataURL('image/png') }

  // Exact depth map of the current view, straight from the 3D geometry (near = white, far = black). The render uses
  // it to keep every piece where it is and the shape it is, instead of guessing from the picture.
  depthSnapshot() {
    const box = new THREE.Box3()
    for (const p of this.parts.values()) box.expandByObject(p.group)
    for (const o of this._importedRoots()) box.expandByObject(o)
    const cam = this.camera, saved = { near: cam.near, far: cam.far, bg: this.scene.background }
    if (!box.isEmpty()) {
      const sphere = box.getBoundingSphere(new THREE.Sphere())
      const d = cam.position.distanceTo(sphere.center)
      cam.near = Math.max(0.05, d - sphere.radius * 1.1); cam.far = d + sphere.radius * 1.1
      cam.updateProjectionMatrix()
    }
    this.scene.overrideMaterial = new THREE.MeshDepthMaterial()
    this.scene.background = new THREE.Color(0x000000)
    this.grid.visible = false; this.measureGroup.visible = false
    this.renderer.render(this.scene, cam)
    const url = this.renderer.domElement.toDataURL('image/png')
    this.scene.overrideMaterial = null; this.scene.background = saved.bg
    this.grid.visible = true; this.measureGroup.visible = true
    cam.near = saved.near; cam.far = saved.far; cam.updateProjectionMatrix()
    return url
  }

  frameAll() {
    const box = new THREE.Box3()
    for (const p of this.parts.values()) box.expandByObject(p.group)
    for (const o of this._importedRoots()) box.expandByObject(o)
    if (box.isEmpty()) return
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()).length()
    this.controls.target.copy(c)
    this.camera.position.copy(c.clone().add(new THREE.Vector3(0.12, 0.62, 1).normalize().multiplyScalar(s * 1.3 + 1)   /* from the open front, above the walls */))
  }

  // Eye-level view, like a photo taken by a guest: camera at 5'4" (1.63 m), standing near the front of the room,
  // looking at the focal piece (an arch or backdrop if there is one, else the middle of the scene).
  eyeLevel() {
    const all = [...this.parts.values()]
    const room = all.find(p => p.spec.kind === 'room')
    const focus = all.find(p => p.spec.kind === 'balloonArch') || all.find(p => p.spec.kind === 'backdrop') || all.find(p => p !== room)
    const target = focus ? focus.group.position.clone().setY(Math.min(1.4, focus.size.h * 0.55)) : new THREE.Vector3(0, 1.2, 0)
    const depth = room ? room.size.d : 8
    const from = room ? room.home.clone().add(new THREE.Vector3(0, 0, depth / 2 - 0.6)) : target.clone().add(new THREE.Vector3(0, 0, 6))
    from.y = 1.63
    if (from.distanceTo(target) > 9) from.copy(target.clone().add(from.clone().sub(target).setY(0).normalize().multiplyScalar(7)).setY(1.63))
    this.camera.position.copy(from); this.controls.target.copy(target); this.camera.updateProjectionMatrix()
  }

  toJSON() { return { units: this.units, parts: [...this.parts.values()].map(p => p.spec) } }
  load(data) { this.clear(); this.units = data.units || this.units; for (const s of data.parts || []) this.add(s); this.frameAll() }
}

export { color }
