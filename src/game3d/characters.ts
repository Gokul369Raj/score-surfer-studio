import * as THREE from "three";

/**
 * Original anime-styled characters for TIT Campus Run — professional
 * mobile-game look built from shared primitives (no external models).
 *  - GOKUL RAJ  : young engineer, voluminous dark curly hair, hoodie + joggers
 *  - NISCHAY SIR: TNP Cell Head, formal shirt + glasses + hip bag
 * Rigged hips→chest→neck→head, full limbs with fingers; animated with a
 * procedural pose-blend system. Materials use MeshToonMaterial with a
 * stepped gradient map for clean anime cel-shading.
 */

export interface CharacterRig {
  group: THREE.Group;
  hips: THREE.Group;
  chest: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  upperArmL: THREE.Group;
  upperArmR: THREE.Group;
  forearmL: THREE.Group;
  forearmR: THREE.Group;
  handL: THREE.Group;
  handR: THREE.Group;
  thighL: THREE.Group;
  thighR: THREE.Group;
  shinL: THREE.Group;
  shinR: THREE.Group;
  footL: THREE.Group;
  footR: THREE.Group;
  eyeL: THREE.Group;
  eyeR: THREE.Group;
  fingersL: THREE.Mesh[];
  fingersR: THREE.Mesh[];
  thumbsL: THREE.Mesh;
  thumbsR: THREE.Mesh;
}

export type PoseKey =
  | "hips" | "chest" | "neck" | "head"
  | "upperArmL" | "upperArmR" | "forearmL" | "forearmR" | "handL" | "handR"
  | "thighL" | "thighR" | "shinL" | "shinR" | "footL" | "footR";

export type Pose = Record<PoseKey, { rx: number; ry: number; rz: number }>;

const POSE_KEYS: PoseKey[] = [
  "hips", "chest", "neck", "head",
  "upperArmL", "upperArmR", "forearmL", "forearmR", "handL", "handR",
  "thighL", "thighR", "shinL", "shinR", "footL", "footR",
];

export function makePose(): Pose {
  return Object.fromEntries(POSE_KEYS.map((k) => [k, { rx: 0, ry: 0, rz: 0 }])) as Pose;
}

export function resetPose(p: Pose): void {
  for (const k of POSE_KEYS) {
    p[k].rx = 0;
    p[k].ry = 0;
    p[k].rz = 0;
  }
}

export function applyPose(
  rig: CharacterRig,
  weights: { idle: number; run: number; jump: number; slide: number; caught: number },
  poses: Record<"idle" | "run" | "jump" | "slide" | "caught", Pose>,
) {
  for (const k of POSE_KEYS) {
    const b = rig[k];
    const i = poses.idle[k];
    const r = poses.run[k];
    const j = poses.jump[k];
    const s = poses.slide[k];
    const c = poses.caught[k];
    b.rotation.x = i.rx * weights.idle + r.rx * weights.run + j.rx * weights.jump + s.rx * weights.slide + c.rx * weights.caught;
    b.rotation.y = i.ry * weights.idle + r.ry * weights.run + j.ry * weights.jump + s.ry * weights.slide + c.ry * weights.caught;
    b.rotation.z = i.rz * weights.idle + r.rz * weights.run + j.rz * weights.jump + s.rz * weights.slide + c.rz * weights.caught;
  }
}

// ------------------------------------------------------------------ helpers

interface Builder {
  group: THREE.Group;
  mats: THREE.Material[];
  geos: THREE.BufferGeometry[];
  castAll(): void;
}

function bone(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// ---- anime cel-shading ----------------------------------------------------

let _toonTex: THREE.Texture | null = null;

/** 3-band stepped gradient for clean toon shading. */
function toonTex(): THREE.Texture {
  if (_toonTex) return _toonTex;
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 8;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; // lit band (top = v=1)
  ctx.fillRect(0, 0, 8, 3);
  ctx.fillStyle = "#8f8f8f"; // mid band
  ctx.fillRect(0, 3, 8, 3);
  ctx.fillStyle = "#4d4d4d"; // shadow band
  ctx.fillRect(0, 6, 8, 2);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  _toonTex = tex;
  return tex;
}

function toon(
  color: number,
  opts: { emissive?: number; emissiveIntensity?: number; transparent?: boolean; opacity?: number } = {},
): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    color,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    gradientMap: toonTex(),
  });
}

/**
 * Text label texture with auto-fit typography and optional dark backing panel —
 * guaranteed to fit the target plane so names stay readable.
 */
function labelTexture(text: string, fg: string, backing: string | null): THREE.CanvasTexture {
  // multi-line support ("NAME\nSURNAME") — each line centered, big font
  const lines = text.split("\n");
  const W = 1024;
  const H = 560;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, W, H);
  if (backing) {
    const pad = 26;
    const r = 40;
    ctx.fillStyle = backing;
    ctx.beginPath();
    ctx.roundRect(pad, pad, W - pad * 2, H - pad * 2, r);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 5;
    ctx.stroke();
  }
  // auto-fit the font to the longest line
  const font = (s: number) => `800 ${s}px "Space Grotesk", Arial, sans-serif`;
  let size = 210;
  ctx.font = font(size);
  const measure = () => Math.max(...lines.map((l) => ctx.measureText(l).width));
  let longest = measure();
  const maxW = backing ? W * 0.84 : W * 0.95;
  while (longest > maxW && size > 60) {
    size -= 8;
    ctx.font = font(size);
    longest = measure();
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(10, size * 0.13);
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  const lineH = size * 1.16;
  const startY = H / 2 - ((lines.length - 1) * lineH) / 2;
  for (let i = 0; i < lines.length; i++) {
    const ly = startY + i * lineH;
    ctx.strokeText(lines[i], W / 2, ly);
    ctx.fillStyle = fg;
    ctx.fillText(lines[i], W / 2, ly);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Big expressive anime eyes: white sclera, colored iris, dark pupil, star highlight. */
function addEyes(
  head: THREE.Group,
  b: Builder,
  browMat: THREE.Material,
  sx: number,
  sy: number,
  sz: number,
  skin: THREE.Material,
  iris: number,
): { eyeL: THREE.Group; eyeR: THREE.Group } {
  const white = toon(0xffffff);
  const irisMat = toon(iris);
  const pupil = toon(0x14191f);
  const hl = toon(0xffffff);
  const eyeGeo = new THREE.SphereGeometry(0.062, 20, 16);
  const irisGeo = new THREE.SphereGeometry(0.044, 16, 14);
  const pupilGeo = new THREE.SphereGeometry(0.021, 12, 10);
  const hlGeo = new THREE.SphereGeometry(0.017, 10, 10);
  b.mats.push(white, irisMat, pupil, hl);
  b.geos.push(eyeGeo, irisGeo, pupilGeo, hlGeo);

  const eyeL = bone(head, -sx, sy, sz);
  const eyeR = bone(head, sx, sy, sz);
  for (const eye of [eyeL, eyeR]) {
    const w = new THREE.Mesh(eyeGeo, white);
    const ir = new THREE.Mesh(irisGeo, irisMat);
    ir.position.set(0, 0, 0.034);
    const p = new THREE.Mesh(pupilGeo, pupil);
    p.position.set(0, 0, 0.052);
    const h = new THREE.Mesh(hlGeo, hl);
    h.position.set(-0.021, 0.026, 0.06);
    eye.add(w, ir, p, h);
  }

  // eyebrows
  const browGeo = new THREE.BoxGeometry(0.09, 0.022, 0.024);
  b.geos.push(browGeo);
  for (const [bx, sgn] of [[-sx, -1], [sx, 1]] as const) {
    const m = new THREE.Mesh(browGeo, browMat);
    m.position.set(bx, sy + 0.075, sz + 0.04);
    m.rotation.z = -sgn * 0.14;
    head.add(m);
  }
  // mouth
  const mouthGeo = new THREE.TorusGeometry(0.044, 0.009, 8, 16, Math.PI);
  b.geos.push(mouthGeo);
  const mouth = new THREE.Mesh(mouthGeo, skin);
  mouth.position.set(0, sy - 0.14, sz + 0.014);
  mouth.rotation.z = Math.PI;
  head.add(mouth);
  return { eyeL, eyeR };
}

function addEars(head: THREE.Group, b: Builder, skin: THREE.Material, r: number) {
  const earGeo = new THREE.SphereGeometry(0.05, 10, 8);
  b.geos.push(earGeo);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(earGeo, skin);
    ear.position.set(s * (r + 0.004), -0.005, 0.02);
    ear.scale.set(0.4, 0.8, 0.5);
    head.add(ear);
  }
}

function addBlush(head: THREE.Group, b: Builder, sx: number, sy: number, sz: number) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xf2918e,
    roughness: 0.6,
    transparent: true,
    opacity: 0.5,
  });
  b.mats.push(mat);
  const geo = new THREE.SphereGeometry(0.024, 10, 8);
  b.geos.push(geo);
  for (const s of [-1, 1]) {
    const bl = new THREE.Mesh(geo, mat);
    bl.position.set(s * sx * 0.85, sy - 0.05, sz + 0.06);
    bl.scale.set(1.2, 0.7, 0.6);
    head.add(bl);
  }
}

function addFingers(
  hand: THREE.Group,
  b: Builder,
  skin: THREE.Material,
  side: -1 | 1,
): { fingers: THREE.Mesh[]; thumb: THREE.Mesh } {
  const fingerGeo = new THREE.CapsuleGeometry(0.017, 0.055, 4, 8);
  const thumbGeo = new THREE.CapsuleGeometry(0.02, 0.045, 4, 8);
  b.geos.push(fingerGeo, thumbGeo);
  const fingers: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const pivot = bone(hand, (i - 1.5) * 0.021 * side, 0.005, 0.055);
    const f = new THREE.Mesh(fingerGeo, skin);
    f.position.set(0, 0.045, 0);
    f.rotation.x = -0.3;
    pivot.add(f);
    fingers.push(f);
  }
  const tp = bone(hand, side * 0.05, 0.005, 0.005);
  const thumb = new THREE.Mesh(thumbGeo, skin);
  thumb.position.set(side * 0.012, 0.012, 0.03);
  thumb.rotation.set(0, -side * 0.45, side * 0.55);
  tp.add(thumb);
  return { fingers, thumb };
}

/** Big readable name label on the character's back. */
/**
 * Fabric-printed name label: no backing patch, text printed straight onto the
 * shirt and curved to hug the cylindrical body so it follows the surface
 * naturally (like a real jersey print).
 */
function addBackLabel(
  b: Builder,
  parent: THREE.Object3D,
  text: string,
  y: number,
  z: number,
  w: number,
  h: number,
  fg: string,
  radius: number,
) {
  const tex = labelTexture(text, fg, null);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  b.mats.push(mat);
  // bend a wide-segmented plane around the body cylinder (edges bow toward
  // the camera so the print wraps the shirt like real fabric)
  const segs = 24;
  const geo = new THREE.PlaneGeometry(w, h, segs, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const ang = x / radius;
    pos.setX(i, radius * Math.sin(ang));
    pos.setZ(i, radius * (1 - Math.cos(ang)));
  }
  geo.computeVertexNormals();
  b.geos.push(geo);
  const plane = new THREE.Mesh(geo, mat);
  plane.position.set(0, y, z);
  plane.rotation.y = Math.PI;
  parent.add(plane);
}

// --------------------------------------------------------------- GOKUL

export function buildGokul(): CharacterRig & { hair: THREE.Mesh[] } {
  const b: Builder = {
    group: new THREE.Group(),
    mats: [],
    geos: [],
    castAll() {
      this.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
    },
  };
  const { group } = b;

  const skin = toon(0xcf8f68);
  const hoodie = toon(0xd94436); // red t-shirt
  const hoodieDark = toon(0x9c2b22); // darker red hem/cuffs/hood
  const pants = toon(0xc8a24a); // mud-yellow (earth ochre) joggers
  const shoe = toon(0xf4f6f5);
  const sole = toon(0x0b1f2a);
  const accent = toon(0xffb02e);
  const glow = toon(0x1c2733, { emissive: 0x9dffd8, emissiveIntensity: 1.4 });
  const hairMat = toon(0x2b1a12);
  const hairHi = toon(0x5a3a22);
  const pouchMat = toon(0x26353f);
  b.mats.push(skin, hoodie, hoodieDark, pants, shoe, sole, accent, glow, hairMat, hairHi, pouchMat);

  // ---- torso ------------------------------------------------------------
  const hips = bone(group, 0, 0.98, 0);
  const chest = bone(hips, 0, 0.3, 0);
  const neck = bone(chest, 0, 0.27, 0);
  const head = bone(neck, 0, 0.11, 0);

  const hipsGeo = new THREE.BoxGeometry(0.4, 0.27, 0.28);
  b.geos.push(hipsGeo);
  const hipsMesh = new THREE.Mesh(hipsGeo, pants);
  hipsMesh.position.set(0, -0.05, 0);
  hips.add(hipsMesh);

  // hoodie body with hem
  const chestGeo = new THREE.CapsuleGeometry(0.27, 0.3, 8, 16);
  b.geos.push(chestGeo);
  const chestMesh = new THREE.Mesh(chestGeo, hoodie);
  chestMesh.position.set(0, 0.03, 0);
  chest.add(chestMesh);

  const hemGeo = new THREE.TorusGeometry(0.2, 0.045, 8, 18);
  b.geos.push(hemGeo);
  const hem = new THREE.Mesh(hemGeo, hoodieDark);
  hem.position.set(0, -0.21, 0);
  hem.rotation.x = Math.PI / 2;
  chest.add(hem);

  // zipper stripe + chest pocket
  const stripeGeo = new THREE.BoxGeometry(0.045, 0.5, 0.025);
  b.geos.push(stripeGeo);
  const stripe = new THREE.Mesh(stripeGeo, glow);
  stripe.position.set(0, 0.03, 0.27);
  stripe.rotation.x = 0.08;
  chest.add(stripe);

  const pocketGeo = new THREE.BoxGeometry(0.16, 0.12, 0.02);
  b.geos.push(pocketGeo);
  const pocket = new THREE.Mesh(pocketGeo, hoodieDark);
  pocket.position.set(-0.13, -0.04, 0.265);
  pocket.rotation.x = 0.08;
  chest.add(pocket);

  // hood + drawstrings
  const hoodGeo = new THREE.TorusGeometry(0.17, 0.05, 10, 20, Math.PI);
  b.geos.push(hoodGeo);
  const hoodM = new THREE.Mesh(hoodGeo, hoodieDark);
  hoodM.position.set(0, 0.27, -0.07);
  hoodM.rotation.x = Math.PI * 0.82;
  chest.add(hoodM);
  const drawGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.17, 6);
  b.geos.push(drawGeo);
  for (const s of [-1, 1]) {
    const d = new THREE.Mesh(drawGeo, glow);
    d.position.set(s * 0.05, -0.09, 0.3);
    d.rotation.x = s * -0.18;
    chest.add(d);
  }

  // hip pouch on the left hip (keeps the back clear for the name)
  const pouchGeo = new THREE.BoxGeometry(0.24, 0.18, 0.09);
  b.geos.push(pouchGeo);
  const pouch = new THREE.Mesh(pouchGeo, pouchMat);
  pouch.position.set(-0.25, 0.05, -0.06);
  pouch.rotation.z = 0.12;
  hips.add(pouch);

  // ---- neck + head (bigger anime head) ----------------------------------
  const neckGeo = new THREE.CylinderGeometry(0.06, 0.075, 0.13, 10);
  b.geos.push(neckGeo);
  const neckM = new THREE.Mesh(neckGeo, skin);
  neckM.position.set(0, 0.02, 0);
  neck.add(neckM);

  const headGeo = new THREE.SphereGeometry(0.19, 26, 22);
  b.geos.push(headGeo);
  const headM = new THREE.Mesh(headGeo, skin);
  headM.position.set(0, 0.02, 0);
  head.add(headM);

  const noseGeo = new THREE.SphereGeometry(0.028, 10, 8);
  b.geos.push(noseGeo);
  const nose = new THREE.Mesh(noseGeo, skin);
  nose.position.set(0, 0.0, 0.176);
  nose.scale.set(0.82, 0.92, 1);
  head.add(nose);

  addEars(head, b, skin, 0.19);
  const { eyeL, eyeR } = addEyes(head, b, skin, 0.075, 0.035, 0.152, skin, 0xb06a2c);
  addBlush(head, b, 0.075, 0.035, 0.152);

  // ---- anime curly hair: solid cap + defined curl clumps -----------------
  const capGeo = new THREE.SphereGeometry(0.2, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62);
  b.geos.push(capGeo);
  const cap = new THREE.Mesh(capGeo, hairMat);
  cap.position.set(0, 0.1, -0.012);
  head.add(cap);

  const curlGeo = new THREE.SphereGeometry(0.07, 12, 10);
  b.geos.push(curlGeo);
  const hairMeshes: THREE.Mesh[] = [];
  const curl = (x: number, y: number, z: number, sc: number, hi = false) => {
    const m = new THREE.Mesh(curlGeo, hi ? hairHi : hairMat);
    m.position.set(x, y, z);
    m.userData.baseY = y; // stable base for the idle bounce (no drift)
    m.scale.set(sc, sc * 0.9, sc);
    head.add(m);
    hairMeshes.push(m);
  };
  const ring = (y: number, r: number, count: number, sc: number) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + y * 4;
      curl(Math.cos(a) * r, y + 0.13, Math.sin(a) * r, sc * (0.92 + (i % 3) * 0.05), i % 4 === 0);
    }
  };
  ring(0.15, 0.135, 9, 1.05); // base
  ring(0.19, 0.115, 8, 0.98); // mid
  ring(0.225, 0.088, 7, 0.92); // top
  // crown
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    curl(Math.cos(a) * 0.05, 0.27, Math.sin(a) * 0.05, 0.88, i % 2 === 0);
  }
  // forehead fringe
  for (let i = 0; i < 5; i++) {
    curl(-0.15 + i * 0.075, 0.19 + (i % 2) * 0.025, 0.115 + Math.abs(i - 2) * 0.014, 0.95, i === 2);
  }
  // sideburns
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) curl(s * 0.16, 0.11 + i * 0.055, -0.02 + i * 0.015, 0.62 + i * 0.05);
  }
  // nape volume
  for (let i = 0; i < 3; i++) curl((i - 1) * 0.07, 0.13, -0.175, 0.85);

  // ---- arms -------------------------------------------------------------
  const upperArmL = bone(chest, -0.3, 0.17, 0);
  const forearmL = bone(upperArmL, 0, -0.25, 0);
  const handL = bone(forearmL, 0, -0.23, 0);
  const upperArmR = bone(chest, 0.3, 0.17, 0);
  const forearmR = bone(upperArmR, 0, -0.25, 0);
  const handR = bone(forearmR, 0, -0.23, 0);

  const sleeveGeo = new THREE.CapsuleGeometry(0.077, 0.2, 6, 10);
  const forearmGeo = new THREE.CapsuleGeometry(0.062, 0.18, 6, 10);
  b.geos.push(sleeveGeo, forearmGeo);
  for (const [u, f] of [[upperArmL, forearmL], [upperArmR, forearmR]] as const) {
    const s = new THREE.Mesh(sleeveGeo, hoodie);
    s.position.set(0, -0.1, 0);
    u.add(s);
    const fa = new THREE.Mesh(forearmGeo, skin);
    fa.position.set(0, -0.09, 0);
    f.add(fa);
    // sleeve cuff
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.05, 10), hoodieDark);
    cuff.position.set(0, -0.17, 0);
    u.add(cuff);
    b.geos.push(cuff.geometry);
  }

  // wristband (left)
  const bandGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.035, 10);
  b.geos.push(bandGeo);
  const band = new THREE.Mesh(bandGeo, accent);
  band.position.set(0, -0.035, 0);
  handL.add(band);

  const handGeo = new THREE.BoxGeometry(0.082, 0.07, 0.105);
  b.geos.push(handGeo);
  for (const h of [handL, handR]) {
    const hm = new THREE.Mesh(handGeo, skin);
    hm.position.set(0, -0.03, 0.005);
    h.add(hm);
  }
  const fL = addFingers(handL, b, skin, -1);
  const fR = addFingers(handR, b, skin, 1);

  // ---- legs -------------------------------------------------------------
  const thighL = bone(hips, -0.115, -0.12, 0);
  const shinL = bone(thighL, 0, -0.32, 0);
  const footL = bone(shinL, 0, -0.3, 0);
  const thighR = bone(hips, 0.115, -0.12, 0);
  const shinR = bone(thighR, 0, -0.32, 0);
  const footR = bone(shinR, 0, -0.3, 0);

  const legGeo = new THREE.CapsuleGeometry(0.09, 0.24, 6, 10);
  b.geos.push(legGeo);
  for (const [t, s] of [[thighL, shinL], [thighR, shinR]] as const) {
    const tm = new THREE.Mesh(legGeo, pants);
    tm.position.set(0, -0.15, 0);
    t.add(tm);
    const sm = new THREE.Mesh(legGeo, pants);
    sm.position.set(0, -0.15, 0);
    s.add(sm);
  }

  // chunkier sneakers
  const sneakerGeo = new THREE.BoxGeometry(0.115, 0.095, 0.27);
  const soleGeo = new THREE.BoxGeometry(0.13, 0.05, 0.29);
  const toeGeo = new THREE.BoxGeometry(0.105, 0.08, 0.08);
  const stripe2Geo = new THREE.BoxGeometry(0.12, 0.02, 0.21);
  const laceGeo = new THREE.BoxGeometry(0.12, 0.025, 0.05);
  b.geos.push(sneakerGeo, soleGeo, toeGeo, stripe2Geo, laceGeo);
  for (const foot of [footL, footR]) {
    const sn = new THREE.Mesh(sneakerGeo, shoe);
    sn.position.set(0, -0.05, 0.02);
    foot.add(sn);
    const so = new THREE.Mesh(soleGeo, sole);
    so.position.set(0, -0.115, 0.02);
    foot.add(so);
    const to = new THREE.Mesh(toeGeo, shoe);
    to.position.set(0, -0.06, 0.17);
    foot.add(to);
    const st = new THREE.Mesh(stripe2Geo, glow);
    st.position.set(0, -0.075, 0.02);
    foot.add(st);
    const lc = new THREE.Mesh(laceGeo, shoe);
    lc.position.set(0, -0.015, 0.09);
    foot.add(lc);
  }

  // ---- TIT BHOPAL printed on the red shirt back (no backing) -------------
  addBackLabel(b, chest, "TIT BHOPAL", 0.13, -0.29, 0.6, 0.3, "#ffffff", 0.3);

  b.castAll();

  const rig: CharacterRig = {
    group, hips, chest, neck, head,
    upperArmL, upperArmR, forearmL, forearmR, handL, handR,
    thighL, thighR, shinL, shinR, footL, footR,
    eyeL, eyeR,
    fingersL: fL.fingers, fingersR: fR.fingers,
    thumbsL: fL.thumb, thumbsR: fR.thumb,
  };
  return { ...rig, hair: hairMeshes };
}

// -------------------------------------------------------------- NISCHAY

export function buildNischay(): CharacterRig {
  const b: Builder = {
    group: new THREE.Group(),
    mats: [],
    geos: [],
    castAll() {
      this.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
    },
  };
  const { group } = b;

  const skin = toon(0xa86b47);
  const shirt = toon(0xb9cdd9);
  const jacket = toon(0x1d3a52);
  const trousers = toon(0x22292f);
  const shoe = toon(0x1d2228);
  const tie = toon(0xc23b3b);
  const frameMat = toon(0x14181c);
  const lensMat = toon(0x9fb6c4, { transparent: true, opacity: 0.45 });
  const hairMat = toon(0x2b1e16);
  const bagMat = toon(0x6b3f26);
  const watchMat = toon(0x2f363d);
  b.mats.push(skin, shirt, jacket, trousers, shoe, tie, frameMat, lensMat, hairMat, bagMat, watchMat);

  const hips = bone(group, 0, 0.98, 0);
  const chest = bone(hips, 0, 0.3, 0);
  const neck = bone(chest, 0, 0.27, 0);
  const head = bone(neck, 0, 0.11, 0);

  const hipsGeo = new THREE.BoxGeometry(0.4, 0.27, 0.27);
  b.geos.push(hipsGeo);
  const hipsMesh = new THREE.Mesh(hipsGeo, trousers);
  hipsMesh.position.set(0, -0.05, 0);
  hips.add(hipsMesh);

  // formal shirt + tie + collar
  const chestGeo = new THREE.CapsuleGeometry(0.27, 0.3, 8, 16);
  b.geos.push(chestGeo);
  const chestMesh = new THREE.Mesh(chestGeo, shirt);
  chestMesh.position.set(0, 0.03, 0);
  chest.add(chestMesh);

  const collarGeo = new THREE.BoxGeometry(0.24, 0.06, 0.06);
  b.geos.push(collarGeo);
  for (const s of [-1, 1]) {
    const col = new THREE.Mesh(collarGeo, shirt);
    col.position.set(s * 0.07, 0.29, 0.17);
    col.rotation.z = s * 0.5;
    chest.add(col);
  }
  const tieGeo = new THREE.BoxGeometry(0.05, 0.22, 0.02);
  b.geos.push(tieGeo);
  const tieM = new THREE.Mesh(tieGeo, tie);
  tieM.position.set(0, 0.16, 0.27);
  tieM.rotation.x = 0.12;
  chest.add(tieM);



  // hip shoulder-bag (kept off the back so the label stays readable)
  const bagGeo = new THREE.BoxGeometry(0.26, 0.22, 0.1);
  b.geos.push(bagGeo);
  const bag = new THREE.Mesh(bagGeo, bagMat);
  bag.position.set(0.27, -0.03, -0.04);
  bag.rotation.z = -0.14;
  hips.add(bag);
  const strapGeo = new THREE.BoxGeometry(0.05, 0.34, 0.03);
  b.geos.push(strapGeo);
  const strap = new THREE.Mesh(strapGeo, bagMat);
  strap.position.set(0.26, 0.18, -0.02);
  strap.rotation.z = -0.4;
  chest.add(strap);

  // neck + head (bigger anime head)
  const neckGeo = new THREE.CylinderGeometry(0.06, 0.075, 0.13, 10);
  b.geos.push(neckGeo);
  const neckM = new THREE.Mesh(neckGeo, skin);
  neckM.position.set(0, 0.02, 0);
  neck.add(neckM);

  const headGeo = new THREE.SphereGeometry(0.18, 26, 22);
  b.geos.push(headGeo);
  const headM = new THREE.Mesh(headGeo, skin);
  headM.position.set(0, 0.02, 0);
  head.add(headM);

  const noseGeo = new THREE.SphereGeometry(0.027, 10, 8);
  b.geos.push(noseGeo);
  const nose = new THREE.Mesh(noseGeo, skin);
  nose.position.set(0, 0.0, 0.166);
  nose.scale.set(0.8, 0.95, 1);
  head.add(nose);

  addEars(head, b, skin, 0.18);

  // neat anime side-part hair with a few combed spikes
  const hairCapGeo = new THREE.SphereGeometry(0.185, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.6);
  b.geos.push(hairCapGeo);
  const hairCap = new THREE.Mesh(hairCapGeo, hairMat);
  hairCap.position.set(0, 0.105, -0.008);
  hairCap.rotation.z = -0.12;
  head.add(hairCap);
  const sideGeo = new THREE.BoxGeometry(0.18, 0.05, 0.1);
  b.geos.push(sideGeo);
  const sideHair = new THREE.Mesh(sideGeo, hairMat);
  sideHair.position.set(-0.1, 0.1, 0.0);
  sideHair.rotation.z = 0.35;
  head.add(sideHair);
  const spikeGeo = new THREE.ConeGeometry(0.032, 0.13, 6);
  b.geos.push(spikeGeo);
  for (const [sx, sz, rz] of [[-0.055, 0.01, -0.15], [0.03, -0.05, 0.08], [0.07, 0.0, 0.22]] as const) {
    const sp = new THREE.Mesh(spikeGeo, hairMat);
    sp.position.set(sx, 0.205, sz);
    sp.rotation.z = rz;
    head.add(sp);
  }

  // glasses
  const frameGeo = new THREE.TorusGeometry(0.086, 0.012, 8, 20);
  const lensGeo = new THREE.CircleGeometry(0.073, 16);
  b.geos.push(frameGeo, lensGeo);
  for (const s of [-1, 1]) {
    const fr = new THREE.Mesh(frameGeo, frameMat);
    fr.position.set(s * 0.09, 0.05, 0.15);
    head.add(fr);
    const le = new THREE.Mesh(lensGeo, lensMat);
    le.position.set(s * 0.09, 0.05, 0.152);
    head.add(le);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.015, 0.015), frameMat);
  bridge.position.set(0, 0.05, 0.153);
  head.add(bridge);
  b.geos.push(bridge.geometry);

  const { eyeL, eyeR } = addEyes(head, b, hairMat, 0.072, 0.05, 0.115, skin, 0x3a2a1c);
  // stern teacher brows
  for (const [bx, sgn] of [[-0.072, -1], [0.072, 1]] as const) {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.024, 0.022), hairMat);
    brow.position.set(bx, 0.115, 0.128);
    brow.rotation.z = sgn * 0.22;
    head.add(brow);
  }

  // arms — rolled shirt sleeves
  const upperArmL = bone(chest, -0.3, 0.17, 0);
  const forearmL = bone(upperArmL, 0, -0.25, 0);
  const handL = bone(forearmL, 0, -0.23, 0);
  const upperArmR = bone(chest, 0.3, 0.17, 0);
  const forearmR = bone(upperArmR, 0, -0.25, 0);
  const handR = bone(forearmR, 0, -0.23, 0);

  const sleeveGeo = new THREE.CapsuleGeometry(0.075, 0.2, 6, 10);
  const forearmGeo = new THREE.CapsuleGeometry(0.06, 0.18, 6, 10);
  b.geos.push(sleeveGeo, forearmGeo);
  for (const [u, f] of [[upperArmL, forearmL], [upperArmR, forearmR]] as const) {
    const s = new THREE.Mesh(sleeveGeo, shirt);
    s.position.set(0, -0.1, 0);
    u.add(s);
    const fa = new THREE.Mesh(forearmGeo, skin);
    fa.position.set(0, -0.09, 0);
    f.add(fa);
  }

  // watch on left wrist
  const watchGeo = new THREE.BoxGeometry(0.052, 0.052, 0.03);
  b.geos.push(watchGeo);
  const watch = new THREE.Mesh(watchGeo, watchMat);
  watch.position.set(0, -0.045, 0.012);
  watch.rotation.z = 0.15;
  handL.add(watch);

  const handGeo = new THREE.BoxGeometry(0.08, 0.07, 0.1);
  b.geos.push(handGeo);
  for (const h of [handL, handR]) {
    const hm = new THREE.Mesh(handGeo, skin);
    hm.position.set(0, -0.03, 0.005);
    h.add(hm);
  }
  const fL = addFingers(handL, b, skin, -1);
  const fR = addFingers(handR, b, skin, 1);

  // legs
  const thighL = bone(hips, -0.115, -0.12, 0);
  const shinL = bone(thighL, 0, -0.32, 0);
  const footL = bone(shinL, 0, -0.3, 0);
  const thighR = bone(hips, 0.115, -0.12, 0);
  const shinR = bone(thighR, 0, -0.32, 0);
  const footR = bone(shinR, 0, -0.3, 0);

  const legGeo = new THREE.CapsuleGeometry(0.085, 0.24, 6, 10);
  b.geos.push(legGeo);
  for (const [t, s] of [[thighL, shinL], [thighR, shinR]] as const) {
    const tm = new THREE.Mesh(legGeo, trousers);
    tm.position.set(0, -0.15, 0);
    t.add(tm);
    const sm = new THREE.Mesh(legGeo, trousers);
    sm.position.set(0, -0.15, 0);
    s.add(sm);
  }

  const shoeGeo = new THREE.BoxGeometry(0.11, 0.095, 0.26);
  const shoeSole = new THREE.BoxGeometry(0.12, 0.045, 0.28);
  b.geos.push(shoeGeo, shoeSole);
  for (const foot of [footL, footR]) {
    const sn = new THREE.Mesh(shoeGeo, shoe);
    sn.position.set(0, -0.05, 0.02);
    foot.add(sn);
    const so = new THREE.Mesh(shoeSole, shoe);
    so.position.set(0, -0.11, 0.02);
    foot.add(so);
  }

  // ---- NISCHAY KAUSHAL printed on the light shirt back (no backing) ------
  // two lines, big dark print — readable from the chase camera
  addBackLabel(b, chest, "NISCHAY\nKAUSHAL", 0.12, -0.29, 0.6, 0.46, "#16324a", 0.3);

  b.castAll();

  return {
    group, hips, chest, neck, head,
    upperArmL, upperArmR, forearmL, forearmR, handL, handR,
    thighL, thighR, shinL, shinR, footL, footR,
    eyeL, eyeR,
    fingersL: fL.fingers, fingersR: fR.fingers,
    thumbsL: fL.thumb, thumbsR: fR.thumb,
  };
}
