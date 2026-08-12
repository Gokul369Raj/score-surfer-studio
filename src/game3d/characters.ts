import * as THREE from "three";

/**
 * TIT Campus Run — original anime-styled characters rebuilt for the skeletal
 * animation system (see animations.ts).
 *
 *  - GOKUL RAJ  : young engineer, voluminous dark curly hair, red hoodie +
 *                 slate joggers + chunky sneakers (TIT BHOPAL on his back)
 *  - NISCHAY SIR: TNP Cell Head, formal shirt + tie + glasses + hip bag
 *
 * Each character is a named-bone hierarchy (hips → spine → chest → neck →
 * head, plus two-segment arms/legs) driven by THREE.AnimationMixer clips.
 * Everything is generated from shared low-poly primitives — no external
 * model files, no texture downloads, mobile-friendly.
 */

export interface CharacterRig {
  group: THREE.Group;
  hips: THREE.Group;
  spine: THREE.Group;
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

interface Builder {
  group: THREE.Group;
  mats: THREE.Material[];
  geos: THREE.BufferGeometry[];
  castAll(): void;
}

function bone(parent: THREE.Object3D, name: string, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
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
 * Direct jersey print texture: bold auto-fit text with a strong contrasting
 * outline and a soft drop shadow, so names stay crisp on any shirt color —
 * no backing plate needed.
 */
function labelTexture(
  text: string,
  fg: string,
  outline: string,
  shadow: string | null,
): THREE.CanvasTexture {
  const lines = text.split("\n");
  const W = 1024;
  const H = 560;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, W, H);

  // auto-fit the font as large as the plane allows
  const font = (s: number) => `900 ${s}px "Space Grotesk", Arial, sans-serif`;
  let size = 260;
  ctx.font = font(size);
  const measure = () => Math.max(...lines.map((l) => ctx.measureText(l).width));
  let longest = measure();
  const maxW = W * 0.94;
  while (longest > maxW && size > 70) {
    size -= 6;
    ctx.font = font(size);
    longest = measure();
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const lineH = size * 1.12;
  const startY = H / 2 - ((lines.length - 1) * lineH) / 2;
  const lw = Math.max(18, size * 0.18);

  for (let i = 0; i < lines.length; i++) {
    const ly = startY + i * lineH;
    if (shadow) {
      ctx.fillStyle = shadow;
      ctx.fillText(lines[i], W / 2 + 9, ly + 11);
    }
    ctx.lineWidth = lw;
    ctx.strokeStyle = outline;
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
  const eyeGeo = new THREE.SphereGeometry(0.064, 20, 16);
  const irisGeo = new THREE.SphereGeometry(0.046, 16, 14);
  const pupilGeo = new THREE.SphereGeometry(0.022, 12, 10);
  const hlGeo = new THREE.SphereGeometry(0.017, 10, 10);
  b.mats.push(white, irisMat, pupil, hl);
  b.geos.push(eyeGeo, irisGeo, pupilGeo, hlGeo);

  const eyeL = bone(head, "eyeL", -sx, sy, sz);
  const eyeR = bone(head, "eyeR", sx, sy, sz);
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
  const browGeo = new THREE.BoxGeometry(0.095, 0.022, 0.024);
  b.geos.push(browGeo);
  for (const [bx, sgn] of [[-sx, -1], [sx, 1]] as const) {
    const m = new THREE.Mesh(browGeo, skin);
    m.position.set(bx, sy + 0.075, sz + 0.04);
    m.rotation.z = -sgn * 0.14;
    head.add(m);
  }
  // mouth
  const mouthGeo = new THREE.TorusGeometry(0.046, 0.009, 8, 16, Math.PI);
  b.geos.push(mouthGeo);
  const mouth = new THREE.Mesh(mouthGeo, skin);
  mouth.position.set(0, sy - 0.145, sz + 0.014);
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
  const fingerGeo = new THREE.CapsuleGeometry(0.016, 0.055, 4, 8);
  const thumbGeo = new THREE.CapsuleGeometry(0.019, 0.045, 4, 8);
  b.geos.push(fingerGeo, thumbGeo);
  const fingers: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const pivot = bone(hand, "", (i - 1.5) * 0.021 * side, -0.008, 0.062);
    const f = new THREE.Mesh(fingerGeo, skin);
    f.position.set(0, 0.05, 0);
    f.rotation.x = -0.25;
    pivot.add(f);
    fingers.push(f);
  }
  const tp = bone(hand, "", side * 0.052, -0.01, 0.01);
  const thumb = new THREE.Mesh(thumbGeo, skin);
  thumb.position.set(side * 0.012, 0.014, 0.03);
  thumb.rotation.set(0, -side * 0.45, side * 0.55);
  tp.add(thumb);
  return { fingers, thumb };
}

/**
 * Direct jersey print on the character's back, curved to hug the cylindrical
 * torso so it follows the surface naturally.
 */
function addBackLabel(
  b: Builder,
  parent: THREE.Object3D,
  text: string,
  y: number,
  z: number,
  w: number,
  h: number,
  style: { fg: string; outline: string; shadow?: string | null },
  radius: number,
) {
  const tex = labelTexture(text, style.fg, style.outline, style.shadow ?? null);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  b.mats.push(mat);
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

// ------------------------------------------------------------- shared rig

/**
 * Builds the named-bone skeleton every character shares. All bones get names
 * that match the animation clips in animations.ts.
 */
function makeRig(b: Builder): {
  hips: THREE.Group; spine: THREE.Group; chest: THREE.Group; neck: THREE.Group; head: THREE.Group;
  upperArmL: THREE.Group; upperArmR: THREE.Group; forearmL: THREE.Group; forearmR: THREE.Group;
  handL: THREE.Group; handR: THREE.Group;
  thighL: THREE.Group; thighR: THREE.Group; shinL: THREE.Group; shinR: THREE.Group;
  footL: THREE.Group; footR: THREE.Group;
} {
  const { group } = b;

  // `body` is an intermediate group at the character's origin. Clips animate
  // body.position (bob / slide drop) WITHOUT clobbering the hips bone's base
  // height offset, so the character always stays planted on the road.
  const body = bone(group, "body", 0, 0, 0);
  const hips = bone(body, "hips", 0, 0.95, 0);
  const spine = bone(hips, "spine", 0, 0.14, 0);
  const chest = bone(spine, "chest", 0, 0.19, 0);
  const neck = bone(chest, "neck", 0, 0.21, 0);
  const head = bone(neck, "head", 0, 0.1, 0);

  const upperArmL = bone(chest, "upperArmL", -0.26, 0.14, 0);
  const forearmL = bone(upperArmL, "forearmL", 0, -0.24, 0);
  const handL = bone(forearmL, "handL", 0, -0.22, 0);
  const upperArmR = bone(chest, "upperArmR", 0.26, 0.14, 0);
  const forearmR = bone(upperArmR, "forearmR", 0, -0.24, 0);
  const handR = bone(forearmR, "handR", 0, -0.22, 0);

  const thighL = bone(hips, "thighL", -0.115, -0.08, 0);
  const shinL = bone(thighL, "shinL", 0, -0.3, 0);
  const footL = bone(shinL, "footL", 0, -0.28, 0);
  const thighR = bone(hips, "thighR", 0.115, -0.08, 0);
  const shinR = bone(thighR, "shinR", 0, -0.3, 0);
  const footR = bone(shinR, "footR", 0, -0.28, 0);

  return { hips, spine, chest, neck, head, upperArmL, upperArmR, forearmL, forearmR, handL, handR, thighL, thighR, shinL, shinR, footL, footR };
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
  const r = makeRig(b);

  const skin = toon(0xd69a72);
  const hoodie = toon(0xe23b2e); // vivid red hoodie
  const hoodieDark = toon(0x8f1f18); // darker red hems/hood
  const pants = toon(0x2e3d4f); // slate blue joggers
  const pantsDark = toon(0x22303f);
  const shoe = toon(0xf2f4f5); // white sneakers
  const sole = toon(0x16202a);
  const accent = toon(0xffb02e);
  const glow = toon(0x1c2733, { emissive: 0x35f0c8, emissiveIntensity: 1.5 });
  const hairMat = toon(0x33201a);
  const hairHi = toon(0x5c3b28);
  const pouchMat = toon(0x26353f);
  b.mats.push(skin, hoodie, hoodieDark, pants, pantsDark, shoe, sole, accent, glow, hairMat, hairHi, pouchMat);

  // ---- torso ------------------------------------------------------------
  const hipsGeo = new THREE.CapsuleGeometry(0.19, 0.14, 6, 12);
  b.geos.push(hipsGeo);
  const hipsMesh = new THREE.Mesh(hipsGeo, pants);
  hipsMesh.position.set(0, -0.06, 0);
  hipsMesh.scale.set(1.12, 0.85, 0.92);
  r.hips.add(hipsMesh);

  // waistband
  const waistGeo = new THREE.TorusGeometry(0.155, 0.035, 8, 16);
  b.geos.push(waistGeo);
  const waist = new THREE.Mesh(waistGeo, pantsDark);
  waist.position.set(0, -0.13, 0);
  waist.rotation.x = Math.PI / 2;
  r.hips.add(waist);

  // tapered torso (shoulders out, waist in)
  const torsoGeo = new THREE.CylinderGeometry(0.185, 0.15, 0.46, 14);
  b.geos.push(torsoGeo);
  const torso = new THREE.Mesh(torsoGeo, hoodie);
  torso.position.set(0, 0.01, 0);
  r.chest.add(torso);

  // chest volume (pecs) + hem
  const chestPadGeo = new THREE.SphereGeometry(0.15, 12, 10);
  b.geos.push(chestPadGeo);
  const chestPad = new THREE.Mesh(chestPadGeo, hoodie);
  chestPad.position.set(0, 0.06, 0.03);
  chestPad.scale.set(1.3, 1.0, 0.75);
  r.chest.add(chestPad);

  const hemGeo = new THREE.TorusGeometry(0.15, 0.05, 8, 18);
  b.geos.push(hemGeo);
  const hem = new THREE.Mesh(hemGeo, hoodieDark);
  hem.position.set(0, -0.21, 0);
  hem.rotation.x = Math.PI / 2;
  r.chest.add(hem);

  // zipper stripe + kangaroo pocket
  const stripeGeo = new THREE.BoxGeometry(0.045, 0.42, 0.025);
  b.geos.push(stripeGeo);
  const stripe = new THREE.Mesh(stripeGeo, glow);
  stripe.position.set(0, 0.02, 0.185);
  stripe.rotation.x = 0.06;
  r.chest.add(stripe);

  const pocketGeo = new THREE.BoxGeometry(0.18, 0.13, 0.03);
  b.geos.push(pocketGeo);
  const pocket = new THREE.Mesh(pocketGeo, hoodieDark);
  pocket.position.set(-0.06, -0.09, 0.17);
  pocket.rotation.x = 0.06;
  r.chest.add(pocket);

  // hood + drawstrings
  const hoodGeo = new THREE.TorusGeometry(0.155, 0.05, 10, 20, Math.PI);
  b.geos.push(hoodGeo);
  const hoodM = new THREE.Mesh(hoodGeo, hoodieDark);
  hoodM.position.set(0, 0.2, -0.06);
  hoodM.rotation.x = Math.PI * 0.82;
  r.chest.add(hoodM);
  const drawGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.17, 6);
  b.geos.push(drawGeo);
  for (const s of [-1, 1]) {
    const d = new THREE.Mesh(drawGeo, glow);
    d.position.set(s * 0.05, -0.12, 0.21);
    d.rotation.x = s * -0.16;
    r.chest.add(d);
  }

  // hip pouch on the left hip (keeps the back clear for the name)
  const pouchGeo = new THREE.BoxGeometry(0.24, 0.18, 0.09);
  b.geos.push(pouchGeo);
  const pouch = new THREE.Mesh(pouchGeo, pouchMat);
  pouch.position.set(-0.25, 0.05, -0.06);
  pouch.rotation.z = 0.12;
  r.hips.add(pouch);

  // ---- neck + head (bigger anime head) ----------------------------------
  const neckGeo = new THREE.CylinderGeometry(0.055, 0.07, 0.12, 10);
  b.geos.push(neckGeo);
  const neckM = new THREE.Mesh(neckGeo, skin);
  neckM.position.set(0, 0.02, 0);
  r.neck.add(neckM);

  const headGeo = new THREE.SphereGeometry(0.19, 26, 22);
  b.geos.push(headGeo);
  const headM = new THREE.Mesh(headGeo, skin);
  headM.position.set(0, 0.02, 0);
  headM.scale.set(1.04, 1.06, 1.0);
  r.head.add(headM);

  // jaw hint
  const jawGeo = new THREE.SphereGeometry(0.155, 16, 12);
  b.geos.push(jawGeo);
  const jaw = new THREE.Mesh(jawGeo, skin);
  jaw.position.set(0, -0.06, 0.06);
  jaw.scale.set(1.12, 0.75, 0.95);
  r.head.add(jaw);

  const noseGeo = new THREE.SphereGeometry(0.028, 10, 8);
  b.geos.push(noseGeo);
  const nose = new THREE.Mesh(noseGeo, skin);
  nose.position.set(0, 0.0, 0.176);
  nose.scale.set(0.82, 0.92, 1);
  r.head.add(nose);

  addEars(r.head, b, skin, 0.19);
  const eyes = addEyes(r.head, b, 0.075, 0.03, 0.15, skin, 0xb06a2c);
  addBlush(r.head, b, 0.075, 0.03, 0.15);

  // ---- anime curly hair: solid cap + defined curl clumps -----------------
  const capGeo = new THREE.SphereGeometry(0.2, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62);
  b.geos.push(capGeo);
  const cap = new THREE.Mesh(capGeo, hairMat);
  cap.position.set(0, 0.1, -0.012);
  r.head.add(cap);

  const curlGeo = new THREE.SphereGeometry(0.07, 12, 10);
  b.geos.push(curlGeo);
  const hairMeshes: THREE.Mesh[] = [];
  const curl = (x: number, y: number, z: number, sc: number, hi = false) => {
    const m = new THREE.Mesh(curlGeo, hi ? hairHi : hairMat);
    m.position.set(x, y, z);
    m.userData.baseY = y; // stable base for the idle bounce (no drift)
    m.scale.set(sc, sc * 0.9, sc);
    r.head.add(m);
    hairMeshes.push(m);
  };
  const ring = (y: number, rr: number, count: number, sc: number) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + y * 4;
      curl(Math.cos(a) * rr, y + 0.13, Math.sin(a) * rr, sc * (0.92 + (i % 3) * 0.05), i % 4 === 0);
    }
  };
  ring(0.15, 0.135, 9, 1.05); // base
  ring(0.19, 0.115, 8, 0.98); // mid
  ring(0.225, 0.088, 7, 0.92); // top
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    curl(Math.cos(a) * 0.05, 0.27, Math.sin(a) * 0.05, 0.88, i % 2 === 0);
  }
  // forehead fringe (swept)
  for (let i = 0; i < 5; i++) {
    curl(-0.15 + i * 0.075, 0.19 + (i % 2) * 0.025, 0.115 + Math.abs(i - 2) * 0.014, 0.95, i === 2);
  }
  // sideburns
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) curl(s * 0.16, 0.11 + i * 0.055, -0.02 + i * 0.015, 0.62 + i * 0.05);
  }
  // nape volume
  for (let i = 0; i < 3; i++) curl((i - 1) * 0.07, 0.13, -0.175, 0.85);

  // ---- arms (shoulder pad + sleeve hugging the torso) -------------------
  const shoulderGeo = new THREE.SphereGeometry(0.08, 10, 8);
  const sleeveGeo = new THREE.CapsuleGeometry(0.08, 0.2, 6, 10);
  const forearmGeo = new THREE.CapsuleGeometry(0.062, 0.18, 6, 10);
  const cuffGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.05, 10);
  b.geos.push(shoulderGeo, sleeveGeo, forearmGeo, cuffGeo);
  for (const [u, f] of [[r.upperArmL, r.forearmL], [r.upperArmR, r.forearmR]] as const) {
    const sh = new THREE.Mesh(shoulderGeo, hoodie);
    sh.position.set(0, 0.04, 0);
    u.add(sh);
    const s = new THREE.Mesh(sleeveGeo, hoodie);
    s.position.set(0, -0.1, 0);
    u.add(s);
    const fa = new THREE.Mesh(forearmGeo, skin);
    fa.position.set(0, -0.09, 0);
    f.add(fa);
    const cuff = new THREE.Mesh(cuffGeo, hoodieDark);
    cuff.position.set(0, -0.17, 0);
    u.add(cuff);
  }

  // wristband (left)
  const bandGeo = new THREE.CylinderGeometry(0.068, 0.068, 0.035, 10);
  b.geos.push(bandGeo);
  const band = new THREE.Mesh(bandGeo, accent);
  band.position.set(0, -0.035, 0);
  r.handL.add(band);

  // rounded palm + fingers
  const handGeo = new THREE.SphereGeometry(0.055, 12, 10);
  b.geos.push(handGeo);
  for (const h of [r.handL, r.handR]) {
    const hm = new THREE.Mesh(handGeo, skin);
    hm.position.set(0, -0.03, 0.005);
    hm.scale.set(1, 0.92, 1.25);
    h.add(hm);
  }
  const fL = addFingers(r.handL, b, skin, -1);
  const fR = addFingers(r.handR, b, skin, 1);

  // ---- legs -------------------------------------------------------------
  const legGeo = new THREE.CapsuleGeometry(0.085, 0.24, 6, 10);
  const shinGeo = new THREE.CapsuleGeometry(0.085, 0.27, 6, 10);
  const ankleCuffGeo = new THREE.CylinderGeometry(0.088, 0.088, 0.05, 10);
  b.geos.push(legGeo, shinGeo, ankleCuffGeo);
  for (const [t, s] of [[r.thighL, r.shinL], [r.thighR, r.shinR]] as const) {
    const tm = new THREE.Mesh(legGeo, pants);
    tm.position.set(0, -0.15, 0);
    t.add(tm);
    const sm = new THREE.Mesh(shinGeo, pants);
    sm.position.set(0, -0.17, 0);
    s.add(sm);
  }
  // ankle cuffs at the shoe line
  for (const s of [r.shinL, r.shinR]) {
    const cuff = new THREE.Mesh(ankleCuffGeo, pantsDark);
    cuff.position.set(0, -0.25, 0);
    s.add(cuff);
  }

  // chunky sneakers, grounded on the road (sole bottom touches y = 0)
  const shoeCollarGeo = new THREE.CylinderGeometry(0.07, 0.075, 0.09, 12);
  const sneakerGeo = new THREE.BoxGeometry(0.115, 0.13, 0.27);
  const soleGeo = new THREE.BoxGeometry(0.13, 0.12, 0.29);
  const toeGeo = new THREE.BoxGeometry(0.105, 0.09, 0.08);
  const stripe2Geo = new THREE.BoxGeometry(0.12, 0.022, 0.21);
  const laceGeo = new THREE.BoxGeometry(0.12, 0.028, 0.05);
  const heelGeo = new THREE.BoxGeometry(0.09, 0.1, 0.03);
  b.geos.push(shoeCollarGeo, sneakerGeo, soleGeo, toeGeo, stripe2Geo, laceGeo, heelGeo);
  for (const foot of [r.footL, r.footR]) {
    const collar = new THREE.Mesh(shoeCollarGeo, shoe);
    collar.position.set(0, -0.02, 0.02);
    foot.add(collar);
    const sn = new THREE.Mesh(sneakerGeo, shoe);
    sn.position.set(0, -0.08, 0.02);
    foot.add(sn);
    const so = new THREE.Mesh(soleGeo, sole);
    so.position.set(0, -0.2, 0.02);
    foot.add(so);
    const to = new THREE.Mesh(toeGeo, shoe);
    to.position.set(0, -0.1, 0.17);
    foot.add(to);
    const st = new THREE.Mesh(stripe2Geo, glow);
    st.position.set(0, -0.12, 0.02);
    foot.add(st);
    const lc = new THREE.Mesh(laceGeo, shoe);
    lc.position.set(0, -0.02, 0.09);
    foot.add(lc);
    const heel = new THREE.Mesh(heelGeo, accent);
    heel.position.set(0, -0.07, -0.13);
    foot.add(heel);
  }

  // ---- TIT BHOPAL printed directly on the red shirt back ----------------
  addBackLabel(b, r.chest, "TIT BHOPAL", 0.11, -0.185, 0.52, 0.3, { fg: "#ffffff", outline: "#4a0d07", shadow: "rgba(50,8,4,0.6)" }, 0.34);

  b.castAll();

  const rig: CharacterRig = {
    group, ...r,
    eyeL: eyes.eyeL, eyeR: eyes.eyeR,
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
  const r = makeRig(b);

  const skin = toon(0xb47a52);
  const shirt = toon(0xc9d8e2);
  const tie = toon(0xc23b3b);
  const trousers = toon(0x232b33);
  const shoe = toon(0x1d2228);
  const frameMat = toon(0x14181c);
  const lensMat = toon(0x9fb6c4, { transparent: true, opacity: 0.45 });
  const hairMat = toon(0x2b1e16);
  const bagMat = toon(0x6b3f26);
  const watchMat = toon(0x2f363d);
  const beltMat = toon(0x1a1f24);
  b.mats.push(skin, shirt, tie, trousers, shoe, frameMat, lensMat, hairMat, bagMat, watchMat, beltMat);

  // ---- torso ------------------------------------------------------------
  const hipsGeo = new THREE.CapsuleGeometry(0.185, 0.14, 6, 12);
  b.geos.push(hipsGeo);
  const hipsMesh = new THREE.Mesh(hipsGeo, trousers);
  hipsMesh.position.set(0, -0.06, 0);
  hipsMesh.scale.set(1.1, 0.85, 0.9);
  r.hips.add(hipsMesh);

  const beltGeo = new THREE.TorusGeometry(0.15, 0.032, 8, 16);
  b.geos.push(beltGeo);
  const belt = new THREE.Mesh(beltGeo, beltMat);
  belt.position.set(0, -0.13, 0);
  belt.rotation.x = Math.PI / 2;
  r.hips.add(belt);

  const torsoGeo = new THREE.CylinderGeometry(0.18, 0.145, 0.46, 14);
  b.geos.push(torsoGeo);
  const torso = new THREE.Mesh(torsoGeo, shirt);
  torso.position.set(0, 0.01, 0);
  r.chest.add(torso);

  const chestPadGeo = new THREE.SphereGeometry(0.145, 12, 10);
  b.geos.push(chestPadGeo);
  const chestPad = new THREE.Mesh(chestPadGeo, shirt);
  chestPad.position.set(0, 0.05, 0.03);
  chestPad.scale.set(1.28, 1.0, 0.75);
  r.chest.add(chestPad);

  const hemGeo = new THREE.TorusGeometry(0.145, 0.045, 8, 18);
  b.geos.push(hemGeo);
  const hem = new THREE.Mesh(hemGeo, shirt);
  hem.position.set(0, -0.21, 0);
  hem.rotation.x = Math.PI / 2;
  r.chest.add(hem);

  // collar + tie
  const collarGeo = new THREE.BoxGeometry(0.24, 0.06, 0.06);
  b.geos.push(collarGeo);
  for (const s of [-1, 1]) {
    const col = new THREE.Mesh(collarGeo, shirt);
    col.position.set(s * 0.07, 0.27, 0.15);
    col.rotation.z = s * 0.5;
    r.chest.add(col);
  }
  const tieGeo = new THREE.BoxGeometry(0.05, 0.24, 0.02);
  b.geos.push(tieGeo);
  const tieM = new THREE.Mesh(tieGeo, tie);
  tieM.position.set(0, 0.15, 0.175);
  tieM.rotation.x = 0.1;
  r.chest.add(tieM);

  // hip shoulder-bag (kept off the back so the label stays readable)
  const bagGeo = new THREE.BoxGeometry(0.26, 0.22, 0.1);
  b.geos.push(bagGeo);
  const bag = new THREE.Mesh(bagGeo, bagMat);
  bag.position.set(0.27, -0.03, -0.04);
  bag.rotation.z = -0.14;
  r.hips.add(bag);
  const strapGeo = new THREE.BoxGeometry(0.05, 0.34, 0.03);
  b.geos.push(strapGeo);
  const strap = new THREE.Mesh(strapGeo, bagMat);
  strap.position.set(0.26, 0.18, -0.02);
  strap.rotation.z = -0.4;
  r.chest.add(strap);

  // ---- neck + head ------------------------------------------------------
  const neckGeo = new THREE.CylinderGeometry(0.05, 0.065, 0.12, 10);
  b.geos.push(neckGeo);
  const neckM = new THREE.Mesh(neckGeo, skin);
  neckM.position.set(0, 0.02, 0);
  r.neck.add(neckM);

  const headGeo = new THREE.SphereGeometry(0.18, 26, 22);
  b.geos.push(headGeo);
  const headM = new THREE.Mesh(headGeo, skin);
  headM.position.set(0, 0.02, 0);
  headM.scale.set(1.02, 1.05, 1.0);
  r.head.add(headM);

  const jawGeo = new THREE.SphereGeometry(0.148, 16, 12);
  b.geos.push(jawGeo);
  const jaw = new THREE.Mesh(jawGeo, skin);
  jaw.position.set(0, -0.055, 0.055);
  jaw.scale.set(1.12, 0.75, 0.95);
  r.head.add(jaw);

  const noseGeo = new THREE.SphereGeometry(0.027, 10, 8);
  b.geos.push(noseGeo);
  const nose = new THREE.Mesh(noseGeo, skin);
  nose.position.set(0, 0.0, 0.166);
  nose.scale.set(0.8, 0.95, 1);
  r.head.add(nose);

  addEars(r.head, b, skin, 0.18);

  // neat anime side-part hair with a few combed spikes
  const hairCapGeo = new THREE.SphereGeometry(0.185, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.6);
  b.geos.push(hairCapGeo);
  const hairCap = new THREE.Mesh(hairCapGeo, hairMat);
  hairCap.position.set(0, 0.105, -0.008);
  hairCap.rotation.z = -0.12;
  r.head.add(hairCap);
  const sideGeo = new THREE.BoxGeometry(0.18, 0.05, 0.1);
  b.geos.push(sideGeo);
  const sideHair = new THREE.Mesh(sideGeo, hairMat);
  sideHair.position.set(-0.1, 0.1, 0.0);
  sideHair.rotation.z = 0.35;
  r.head.add(sideHair);
  const spikeGeo = new THREE.ConeGeometry(0.032, 0.13, 6);
  b.geos.push(spikeGeo);
  for (const [sx, sz, rz] of [[-0.055, 0.01, -0.15], [0.03, -0.05, 0.08], [0.07, 0.0, 0.22]] as const) {
    const sp = new THREE.Mesh(spikeGeo, hairMat);
    sp.position.set(sx, 0.205, sz);
    sp.rotation.z = rz;
    r.head.add(sp);
  }

  // glasses
  const frameGeo = new THREE.TorusGeometry(0.086, 0.012, 8, 20);
  const lensGeo = new THREE.CircleGeometry(0.073, 16);
  b.geos.push(frameGeo, lensGeo);
  for (const s of [-1, 1]) {
    const fr = new THREE.Mesh(frameGeo, frameMat);
    fr.position.set(s * 0.09, 0.05, 0.15);
    r.head.add(fr);
    const le = new THREE.Mesh(lensGeo, lensMat);
    le.position.set(s * 0.09, 0.05, 0.152);
    r.head.add(le);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.015, 0.015), frameMat);
  bridge.position.set(0, 0.05, 0.153);
  r.head.add(bridge);
  b.geos.push(bridge.geometry);

  const eyes = addEyes(r.head, b, 0.072, 0.05, 0.115, skin, 0x3a2a1c);
  // stern teacher brows
  for (const [bx, sgn] of [[-0.072, -1], [0.072, 1]] as const) {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.024, 0.022), hairMat);
    brow.position.set(bx, 0.115, 0.128);
    brow.rotation.z = sgn * 0.22;
    r.head.add(brow);
  }

  // ---- arms — rolled shirt sleeves + shoulder pads ----------------------
  const shoulderGeo = new THREE.SphereGeometry(0.078, 10, 8);
  const sleeveGeo = new THREE.CapsuleGeometry(0.077, 0.2, 6, 10);
  const forearmGeo = new THREE.CapsuleGeometry(0.06, 0.18, 6, 10);
  b.geos.push(shoulderGeo, sleeveGeo, forearmGeo);
  for (const [u, f] of [[r.upperArmL, r.forearmL], [r.upperArmR, r.forearmR]] as const) {
    const sh = new THREE.Mesh(shoulderGeo, shirt);
    sh.position.set(0, 0.04, 0);
    u.add(sh);
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
  r.handL.add(watch);

  // rounded palm + fingers
  const handGeo = new THREE.SphereGeometry(0.053, 12, 10);
  b.geos.push(handGeo);
  for (const h of [r.handL, r.handR]) {
    const hm = new THREE.Mesh(handGeo, skin);
    hm.position.set(0, -0.03, 0.005);
    hm.scale.set(1, 0.92, 1.25);
    h.add(hm);
  }
  const fL = addFingers(r.handL, b, skin, -1);
  const fR = addFingers(r.handR, b, skin, 1);

  // ---- legs -------------------------------------------------------------
  const legGeo = new THREE.CapsuleGeometry(0.082, 0.24, 6, 10);
  const shinGeo = new THREE.CapsuleGeometry(0.082, 0.27, 6, 10);
  b.geos.push(legGeo, shinGeo);
  for (const [t, s] of [[r.thighL, r.shinL], [r.thighR, r.shinR]] as const) {
    const tm = new THREE.Mesh(legGeo, trousers);
    tm.position.set(0, -0.15, 0);
    t.add(tm);
    const sm = new THREE.Mesh(shinGeo, trousers);
    sm.position.set(0, -0.17, 0);
    s.add(sm);
  }

  // formal shoes, grounded on the road
  const shoeGeo = new THREE.BoxGeometry(0.11, 0.11, 0.26);
  const shoeSole = new THREE.BoxGeometry(0.12, 0.1, 0.28);
  b.geos.push(shoeGeo, shoeSole);
  for (const foot of [r.footL, r.footR]) {
    const sn = new THREE.Mesh(shoeGeo, shoe);
    sn.position.set(0, -0.08, 0.02);
    foot.add(sn);
    const so = new THREE.Mesh(shoeSole, shoe);
    so.position.set(0, -0.19, 0.02);
    foot.add(so);
  }

  // ---- NISCHAY KAUSHAL printed directly on the light shirt back ----------
  addBackLabel(b, r.chest, "NISCHAY\nKAUSHAL", 0.1, -0.185, 0.5, 0.44, { fg: "#12304a", outline: "#e9f2f7", shadow: "rgba(16,42,64,0.45)" }, 0.34);

  b.castAll();

  return {
    group, ...r,
    eyeL: eyes.eyeL, eyeR: eyes.eyeR,
    fingersL: fL.fingers, fingersR: fR.fingers,
    thumbsL: fL.thumb, thumbsR: fR.thumb,
  };
}
