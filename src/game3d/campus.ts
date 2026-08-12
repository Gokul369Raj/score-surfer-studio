import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * TIT Campus Run — procedural stylized campus world (visual-upgrade edition).
 *
 * Road + sidewalks + kerbs, gate, buildings, shops, cars, trees, lamps, signs,
 * benches, bus stops, fences, flowers, obstacles and coins are all pooled and
 * recycled as the player runs — nothing is created per frame and memory stays
 * flat. The distant city silhouette is drawn with a single InstancedMesh.
 *
 * Gameplay contract (unchanged): obstacle positions, patterns and collision
 * boxes, coin arcs, start gate and recycling behavior are identical to the
 * original — only the art changed.
 */

export type ObstacleKind = "low" | "tall" | "overhead";

export interface Obstacle {
  id: number;
  mesh: THREE.Group;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  kind: ObstacleKind;
  active: boolean;
}

export interface Coin {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  y: number;
  active: boolean;
}

const LANES = [-2.1, 0, 2.1];
const CHUNK = 42;
const SPAWN_AHEAD = 220;
// Objects spawn far AHEAD of the player (negative z, at the horizon) and
// stream TOWARD the camera (+z) — Subway Surfers style. They are recycled
// once they pass behind the camera.
const KILL_Z = 40;

let OID = 1;

// ----------------------------------------------------------- procedural tex

function windowTexture(tint: string, rows: number, cols: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, c.width, c.height);
  // subtle facade panel lines
  ctx.strokeStyle = "rgba(0,0,0,0.10)";
  ctx.lineWidth = 6;
  for (let col = 0; col <= cols; col++) {
    const x = c.width * 0.16 + col * (c.width / cols);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, c.height);
    ctx.stroke();
  }
  const ww = c.width / (cols * 2.4);
  const wh = c.height / (rows * 2.8);
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = c.width * 0.16 + col * (c.width / cols);
      const y = c.height * 0.12 + r * (c.height / rows);
      // frame
      ctx.fillStyle = "rgba(10,16,26,0.95)";
      ctx.fillRect(x - 3, y - 3, ww + 6, wh + 6);
      // glass
      const grad = ctx.createLinearGradient(0, y, 0, y + wh);
      grad.addColorStop(0, "rgba(150,205,240,0.5)");
      grad.addColorStop(1, "rgba(70,120,160,0.5)");
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, ww, wh);
      // glint
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(x + ww * 0.08, y + wh * 0.08, ww * 0.28, wh * 0.2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function textTexture(text: string, opts: { fg?: string; bg?: string; w?: number } = {}): THREE.CanvasTexture {
  const { fg = "#ffffff", bg = "#0d3b4f" } = opts;
  const W = opts.w ?? 1024;
  const H = 430;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 18;
    ctx.strokeRect(14, 14, W - 28, H - 28);
  }
  let size = 240;
  ctx.font = `900 ${size}px "Space Grotesk", Arial, sans-serif`;
  while (ctx.measureText(text).width > W * 0.96 && size > 70) {
    size -= 8;
    ctx.font = `900 ${size}px "Space Grotesk", Arial, sans-serif`;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(14, size * 0.16);
  ctx.strokeStyle = "rgba(6,18,28,0.85)";
  ctx.strokeText(text, W / 2, H / 2);
  ctx.fillStyle = fg;
  ctx.fillText(text, W / 2, H / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeSkyTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, "#2f6f9e");
  grad.addColorStop(0.42, "#8ecbe8");
  grad.addColorStop(0.68, "#cdeef7");
  grad.addColorStop(1, "#e8f7e4");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 512);
  // sun glow
  const sun = ctx.createRadialGradient(96, 120, 8, 96, 120, 90);
  sun.addColorStop(0, "rgba(255,246,214,0.95)");
  sun.addColorStop(0.18, "rgba(255,236,180,0.55)");
  sun.addColorStop(1, "rgba(255,236,180,0)");
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, 128, 300);
  ctx.fillStyle = "#fff8e0";
  ctx.beginPath();
  ctx.arc(96, 120, 16, 0, Math.PI * 2);
  ctx.fill();
  // soft clouds
  const cloud = (x: number, y: number, s: number) => {
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    for (const [dx, dy, r] of [[0, 0, 10], [12, -2, 8], [-12, 2, 8], [4, 5, 9], [-6, 6, 7]] as const) {
      ctx.beginPath();
      ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  cloud(24, 235, 1.25);
  cloud(104, 300, 1.6);
  cloud(58, 360, 1.1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRoadTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#3c4146";
  ctx.fillRect(0, 0, 256, 512);
  // asphalt noise
  for (let i = 0; i < 900; i++) {
    const v = 40 + Math.floor(Math.random() * 24);
    ctx.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + Math.random() * 0.4})`;
    const w = 1 + Math.random() * 2.5;
    ctx.fillRect(Math.random() * 256, Math.random() * 512, w, 1 + Math.random() * 2);
  }
  // lane dividers (dashed) — road runs along -z so texture V maps to z
  ctx.fillStyle = "#f5f2e8";
  for (let y = 0; y < 512; y += 64) {
    ctx.fillRect(128 - 4, y, 8, 32);
  }
  // side lines
  ctx.fillStyle = "#e8e4d4";
  ctx.fillRect(0, 0, 6, 512);
  ctx.fillRect(250, 0, 6, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 48);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeAwningTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#e23b2e" : "#f5f2e8";
    ctx.fillRect(i * 16, 0, 16, 64);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGlowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(255,240,190,0.85)");
  g.addColorStop(0.5, "rgba(255,225,150,0.28)");
  g.addColorStop(1, "rgba(255,225,150,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// --------------------------------------------------------------- builders

function makeCoin(): Coin {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffc83d, metalness: 0.75, roughness: 0.3, emissive: 0x7a4d00, emissiveIntensity: 0.25 });
  const geo = new THREE.CylinderGeometry(0.16, 0.16, 0.045, 18);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.z = Math.PI / 2;
  mesh.visible = false;
  return { mesh, x: 0, z: 0, y: 0.55, active: false };
}

function makeObstacleMesh(kind: ObstacleKind): { mesh: THREE.Group; w: number; d: number; h: number } {
  const g = new THREE.Group();
  let w = 1;
  let d = 1;
  let h = 1;
  const mat = new THREE.MeshStandardMaterial({ color: 0xf4a13b, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.7 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x8a9499, roughness: 0.75 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xe76f3a, roughness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f4f3, roughness: 0.5 });
  const warn = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd24a, emissiveIntensity: 1.6 });

  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, 0, rz);
    g.add(mesh);
  };

  const lowR = Math.random();
  if (kind === "low" && lowR < 0.45) {
    // striped barricade
    add(new THREE.BoxGeometry(1.6, 0.14, 0.14), white, 0, 0.55, 0);
    add(new THREE.BoxGeometry(1.7, 0.14, 0.14), white, 0, 0.28, 0);
    for (const s of [-0.65, 0.65]) {
      add(new THREE.CylinderGeometry(0.035, 0.035, 0.75, 8), orange, s, 0.36, 0);
    }
    const stripes = new THREE.BoxGeometry(0.18, 0.16, 0.16);
    for (let i = -3; i <= 3; i++) add(stripes, orange, i * 0.24, 0.56, 0.02);
    w = 1.8; d = 0.3; h = 0.65;
  } else if (kind === "low" && lowR < 0.78) {
    // bench
    add(new THREE.BoxGeometry(1.5, 0.08, 0.35), dark, 0, 0.62, 0);
    add(new THREE.BoxGeometry(1.5, 0.06, 0.3), dark, 0, 0.9, 0);
    for (const s of [-0.6, 0.6]) add(new THREE.BoxGeometry(0.08, 0.6, 0.35), grey, s, 0.3, 0);
    w = 1.6; d = 0.5; h = 1.0;
  } else if (kind === "low") {
    // crate stack
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        add(new THREE.BoxGeometry(0.42, 0.42, 0.42), mat, (i - 0.5) * 0.44, 0.21 + j * 0.42, 0);
      }
    }
    w = 0.9; d = 0.5; h = 0.9;
  } else if (kind === "tall" && Math.random() < 0.5) {
    // campus cart
    add(new THREE.BoxGeometry(1.1, 0.7, 0.7), grey, 0, 0.6, 0);
    add(new THREE.BoxGeometry(0.9, 0.35, 0.5), orange, 0, 1.05, -0.1);
    for (const s of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 10), dark, s * 0.4, 0.16, 0.3);
      add(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 10), dark, s * 0.4, 0.16, -0.3);
    }
    w = 1.2; d = 0.9; h = 1.3;
  } else if (kind === "tall" && Math.random() < 0.6) {
    // parked car (improved)
    const body = new THREE.BoxGeometry(0.95, 0.55, 1.9);
    add(body, mat, 0, 0.62, 0);
    add(new THREE.BoxGeometry(0.85, 0.4, 1.1), white, 0, 1.0, -0.1);
    add(new THREE.BoxGeometry(0.9, 0.12, 1.86), dark, 0, 0.42, 0);
    for (const s of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 10), dark, s * 0.3, 0.16, 0.62);
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 10), dark, s * 0.3, 0.16, -0.62);
    }
    add(new THREE.BoxGeometry(0.08, 0.06, 0.1), warn, 0.34, 0.72, 0.75);
    add(new THREE.BoxGeometry(0.08, 0.06, 0.1), warn, -0.34, 0.72, 0.75);
    w = 1.1; d = 2.1; h = 1.25;
  } else if (kind === "tall") {
    // construction barricade
    add(new THREE.BoxGeometry(1.7, 0.16, 0.16), orange, 0, 1.15, 0);
    add(new THREE.BoxGeometry(1.7, 0.16, 0.16), white, 0, 0.75, 0);
    add(new THREE.BoxGeometry(1.7, 0.14, 0.18), grey, 0, 0.35, 0);
    add(new THREE.BoxGeometry(1.8, 0.1, 0.2), dark, 0, 1.35, 0);
    for (const s of [-0.7, 0.7]) add(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 8), orange, s, 0.7, 0);
    w = 1.9; d = 0.3; h = 1.5;
  } else {
    // tall slide-gate — its top is above jump height so it can never be
    // jumped; the only way through is sliding under the low glowing lip
    add(new THREE.BoxGeometry(2.7, 0.22, 0.26), orange, 0, 2.95, 0); // top beam
    add(new THREE.BoxGeometry(0.22, 3.0, 0.26), grey, -1.35, 1.5, 0); // left pillar
    add(new THREE.BoxGeometry(0.22, 3.0, 0.26), grey, 1.35, 1.5, 0); // right pillar
    add(new THREE.BoxGeometry(2.5, 1.85, 0.12), orange, 0, 2.05, 0); // solid panel (1.13→2.98)
    const gateStripe = new THREE.BoxGeometry(0.15, 1.9, 0.15);
    for (let i = -7; i <= 7; i++) add(gateStripe, white, i * 0.18, 2.05, 0.02);
    add(new THREE.BoxGeometry(2.5, 0.16, 0.18), warn, 0, 1.13, 0); // glowing low lip — slide under
    w = 2.6; d = 0.35; h = 3.0;
  }
  g.visible = false;
  return { mesh: g, w, d, h };
}

function makeRoadDeco(isManhole: boolean): THREE.Group {
  const g = new THREE.Group();
  if (isManhole) {
    const rim = new THREE.MeshStandardMaterial({ color: 0x2c3338, roughness: 0.85, metalness: 0.3 });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.28, 14), rim);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.012;
    g.add(disc);
  } else {
    const patch = new THREE.MeshStandardMaterial({ color: 0x2e3338, roughness: 1 });
    const p = new THREE.Mesh(new THREE.CircleGeometry(0.5, 10), patch);
    p.rotation.x = -Math.PI / 2;
    p.position.y = 0.01;
    p.scale.set(1.6, 0.7, 1);
    g.add(p);
  }
  g.visible = false;
  return g;
}

function makeTree(): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.9 });
  const leafA = new THREE.MeshStandardMaterial({ color: 0x2e8b57, roughness: 0.85 });
  const leafB = new THREE.MeshStandardMaterial({ color: 0x3fa06a, roughness: 0.85 });
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.16, 1.1, 7), trunk);
  t.position.y = 0.55;
  g.add(t);
  const c1 = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8), leafA);
  c1.position.set(0, 1.5, 0);
  c1.scale.set(1.25, 0.95, 1.2);
  g.add(c1);
  const c2 = new THREE.Mesh(new THREE.SphereGeometry(0.48, 10, 8), leafB);
  c2.position.set(0.22, 1.95, 0.12);
  g.add(c2);
  const c3 = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), leafA);
  c3.position.set(-0.12, 2.28, -0.1);
  g.add(c3);
  g.visible = false;
  return g;
}

function makeBush(): THREE.Group {
  const g = new THREE.Group();
  const leaf = new THREE.MeshStandardMaterial({ color: 0x3f9d63, roughness: 0.9 });
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), leaf);
  s.position.y = 0.4;
  s.scale.set(1.4, 0.9, 1.2);
  g.add(s);
  const s2 = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), leaf);
  s2.position.set(0.35, 0.42, 0.25);
  g.add(s2);
  g.visible = false;
  return g;
}

function makeFlowers(): THREE.Group {
  const g = new THREE.Group();
  const stem = new THREE.MeshStandardMaterial({ color: 0x3c7a3a, roughness: 0.9 });
  const petals = [0xf06a8a, 0xf2b632, 0xb06ae0, 0x4db8e8, 0xf2f2f2].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }));
  const stemGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.22, 5);
  const headGeo = new THREE.SphereGeometry(0.05, 8, 6);
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.16 + (Math.random() - 0.5) * 0.08;
    const st = new THREE.Mesh(stemGeo, stem);
    st.position.set(x, 0.11, (Math.random() - 0.5) * 0.5);
    st.rotation.z = (Math.random() - 0.5) * 0.3;
    g.add(st);
    const hd = new THREE.Mesh(headGeo, petals[i % petals.length]);
    hd.position.set(st.position.x, 0.24, st.position.z);
    g.add(hd);
  }
  g.visible = false;
  return g;
}

function makeLamp(): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.MeshStandardMaterial({ color: 0x3a4147, roughness: 0.6, metalness: 0.4 });
  const bulb = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c0, emissiveIntensity: 1.4 });
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, 3.6, 8), pole);
  p.position.y = 1.8;
  g.add(p);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.05, 0.05), pole);
  arm.position.set(0.48, 3.55, 0);
  g.add(arm);
  const droop = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.05), pole);
  droop.position.set(0.9, 3.47, 0);
  droop.rotation.z = 0.12;
  g.add(droop);
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.2), bulb);
  b.position.set(0.98, 3.4, 0);
  g.add(b);
  // warm glow disc on the ground (pure emissive texture — no lights)
  const glowMat = new THREE.MeshBasicMaterial({
    map: makeGlowTexture(),
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), glowMat);
  glow.position.set(0.98, 0.02, 0);
  glow.rotation.x = -Math.PI / 2;
  g.add(glow);
  g.visible = false;
  return g;
}

function makeSign(text: string, h = 2.2): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.MeshStandardMaterial({ color: 0x37434a, roughness: 0.6 });
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, h, 8), pole);
  p.position.y = h / 2;
  g.add(p);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), pole);
  cap.position.y = h + 0.05;
  g.add(cap);
  const tex = textTexture(text, { bg: "#0d3b4f" });
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 1.0),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }),
  );
  board.position.y = h + 0.5;
  g.add(board);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x37434a, roughness: 0.6 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.06, 0.06), frameMat);
  frame.position.y = h + 0.5;
  g.add(frame);
  g.visible = false;
  return g;
}

function makeBench(): THREE.Group {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.8 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x9aa3a8, roughness: 0.7 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.4), dark);
  seat.position.y = 0.45;
  g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.06), dark);
  back.position.set(0, 0.7, -0.17);
  g.add(back);
  for (const s of [-0.65, 0.65]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.4), grey);
    leg.position.set(s, 0.22, 0);
    g.add(leg);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.06), grey);
    arm.position.set(s, 0.6, 0.02);
    g.add(arm);
  }
  g.visible = false;
  return g;
}

function makeBusStop(): THREE.Group {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.6, metalness: 0.35 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x2f6f9e, roughness: 0.7 });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 1.2), roofMat);
  roof.position.y = 2.2;
  g.add(roof);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 8), metal);
    post.position.set(s * 1.1, 1.1, 0);
    g.add(post);
  }
  const bench = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.07, 0.4), roofMat);
  bench.position.set(0, 0.42, 0);
  g.add(bench);
  const tex = textTexture("BUS STOP", { bg: "#0d3b4f", fg: "#8ef5c9" });
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 0.55),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }),
  );
  sign.position.set(0, 1.95, 0.62);
  g.add(sign);
  g.visible = false;
  return g;
}

function makeFence(): THREE.Group {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x5d6b75, roughness: 0.6, metalness: 0.3 });
  const railGeo = new THREE.BoxGeometry(0.06, 0.06, 3.4);
  const postGeo = new THREE.BoxGeometry(0.08, 1.0, 0.08);
  const r1 = new THREE.Mesh(railGeo, metal);
  r1.position.y = 0.5;
  g.add(r1);
  const r2 = new THREE.Mesh(railGeo, metal);
  r2.position.y = 0.92;
  g.add(r2);
  for (const s of [-1.55, -0.5, 0.5, 1.55]) {
    const post = new THREE.Mesh(postGeo, metal);
    post.position.set(0, 0.5, s);
    g.add(post);
  }
  g.visible = false;
  return g;
}

const CAR_COLORS = [0xe8452c, 0x2f7fd1, 0x2aa876, 0xe8d9a8, 0x9aa5ad, 0xe8e8e8];

function makeParkedCar(): THREE.Group {
  const g = new THREE.Group();
  const color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.25 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x14202c, roughness: 0.15, metalness: 0.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1f24, roughness: 0.8 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.85 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.35, metalness: 0.6 });
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6d8, emissiveIntensity: 1.1 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 3.2), bodyMat);
  body.position.y = 0.55;
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.38, 1.8), bodyMat);
  cabin.position.set(0, 0.94, -0.25);
  g.add(cabin);
  const wind = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.28, 0.04), glassMat);
  wind.position.set(0, 0.96, 0.35);
  wind.rotation.x = -0.22;
  g.add(wind);
  const rear = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.24, 0.04), glassMat);
  rear.position.set(0, 0.95, -1.12);
  rear.rotation.x = 0.2;
  g.add(rear);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.14, 0.16), darkMat);
  bumper.position.set(0, 0.42, 1.62);
  g.add(bumper);
  for (const sx of [-0.68, 0.68]) {
    const w1 = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.2, 10), wheelMat);
    w1.position.set(sx, 0.28, 1.05);
    w1.rotation.z = Math.PI / 2;
    g.add(w1);
    const w2 = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.2, 10), wheelMat);
    w2.position.set(sx, 0.28, -1.05);
    w2.rotation.z = Math.PI / 2;
    g.add(w2);
    const h1 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.22, 8), hubMat);
    h1.position.set(sx, 0.28, 1.05);
    h1.rotation.z = Math.PI / 2;
    g.add(h1);
    const h2 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.22, 8), hubMat);
    h2.position.set(sx, 0.28, -1.05);
    h2.rotation.z = Math.PI / 2;
    g.add(h2);
  }
  const hl1 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.06), lightMat);
  hl1.position.set(0.55, 0.62, 1.62);
  g.add(hl1);
  const hl2 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.06), lightMat);
  hl2.position.set(-0.55, 0.62, 1.62);
  g.add(hl2);
  g.visible = false;
  return g;
}

const BUILDING_NAMES = ["TIT MAIN", "TIT EXCELLENCE", "TIT ADVANCE", "TIT SCIENCE"];
const BUILDING_TINTS = ["#d9c8a8", "#c7b79a", "#b9c6cf", "#d8c2a8"];
const KENNEY_CITY_ASSETS = [
  "building-type-a.glb",
  "building-type-c.glb",
  "building-type-f.glb",
  "building-type-j.glb",
  "building-type-m.glb",
  "building-type-r.glb",
] as const;
const KENNEY_DETAIL_ASSETS = [
  "tree-large.glb",
  "tree-small.glb",
  "fence.glb",
  "fence-2x3.glb",
  "planter.glb",
  "path-stones-short.glb",
] as const;

function makeBuilding(name: string, kind: number): THREE.Group {
  const g = new THREE.Group();
  const h = 4 + kind * 2.2;
  const w = 4.2 + kind * 0.8;
  const tex = windowTexture(BUILDING_TINTS[kind % BUILDING_TINTS.length], kind === 2 ? 4 : 3, kind === 2 ? 4 : 3);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.72, metalness: 0.06 });
  const bodyGeo = new THREE.BoxGeometry(w, h, 3.2);
  const body = new THREE.Mesh(bodyGeo, mat);
  body.position.y = h / 2;
  g.add(body);

  const trimMat = new THREE.MeshStandardMaterial({ color: 0xf3ead8, roughness: 0.42, metalness: 0.12 });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x385160, transparent: true, opacity: 0.52 });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeo), edgeMat);
  edges.position.copy(body.position);
  g.add(edges);
  const cornerGeo = new THREE.BoxGeometry(0.14, h + 0.12, 0.15);
  for (const x of [-w / 2, w / 2]) {
    for (const z of [-1.6, 1.6]) {
      const corner = new THREE.Mesh(cornerGeo, trimMat);
      corner.position.set(x, h / 2, z);
      g.add(corner);
    }
  }

  // podium + parapet
  const podiumMat = new THREE.MeshStandardMaterial({ color: 0x8d6f52, roughness: 0.85 });
  const podium = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.6, 3.4), podiumMat);
  podium.position.y = 0.3;
  g.add(podium);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x7a4a2b, roughness: 0.8 });
  const parapet = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.35, 3.6), roofMat);
  parapet.position.y = h + 0.18;
  g.add(parapet);
  const roofGlowMat = new THREE.MeshStandardMaterial({ color: 0xffd36e, emissive: 0xb55e13, emissiveIntensity: 1.2, roughness: 0.45 });
  const roofGlow = new THREE.Mesh(new THREE.BoxGeometry(w + 0.32, 0.08, 3.48), roofGlowMat);
  roofGlow.position.y = h + 0.41;
  g.add(roofGlow);
  // rooftop AC units
  const acMat = new THREE.MeshStandardMaterial({ color: 0x9aa3a8, roughness: 0.7, metalness: 0.3 });
  const acGeo = new THREE.BoxGeometry(0.7, 0.4, 0.7);
  for (const [ax, az] of [[-w * 0.22, -0.7], [w * 0.24, 0.6]] as const) {
    const ac = new THREE.Mesh(acGeo, acMat);
    ac.position.set(ax, h + 0.42, az);
    g.add(ac);
  }
  if (kind === 2) {
    // palace-style dome
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), roofMat);
    dome.position.y = h + 0.4;
    g.add(dome);
  }
  // entrance canopy
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x5d7d9c, roughness: 0.7 });
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, 0.1, 1.3), canopyMat);
  canopy.position.set(0, 1.5, 1.75);
  g.add(canopy);
  for (const s of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.5, 0.18), podiumMat);
    pillar.position.set(s * w * 0.2, 0.75, 1.75);
    g.add(pillar);
  }
  const entranceMat = new THREE.MeshStandardMaterial({ color: 0x2f5972, metalness: 0.48, roughness: 0.24, emissive: 0x102a3b, emissiveIntensity: 0.45 });
  const doorGeo = new THREE.BoxGeometry(0.72, 1.4, 0.07);
  for (const x of [-0.38, 0.38]) {
    const door = new THREE.Mesh(doorGeo, entranceMat);
    door.position.set(x, 0.72, 1.63);
    g.add(door);
  }
  const doorBar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.48, 0.11), trimMat);
  doorBar.position.set(0, 0.73, 1.66);
  g.add(doorBar);

  // name boards — bigger + higher-res so they stay readable from far on mobile
  const boardTex = textTexture(name, { bg: "#0d3b4f", fg: "#8ef5c9", w: 1536 });
  const boardMat = new THREE.MeshBasicMaterial({ map: boardTex, side: THREE.DoubleSide });
  const sideBoardGeo = new THREE.PlaneGeometry(5.2, 1.5);
  for (const s of [-1, 1]) {
    const board = new THREE.Mesh(sideBoardGeo, boardMat);
    board.position.set(s * (w / 2 + 0.06), 2.8, 0);
    board.rotation.y = s * (Math.PI / 2);
    g.add(board);
  }
  const frontBoardGeo = new THREE.PlaneGeometry(w + 0.1, 1.7);
  for (const s of [-1, 1]) {
    const board = new THREE.Mesh(frontBoardGeo, boardMat);
    board.position.set(0, 3.2, s * (3.2 / 2 + 0.06));
    board.rotation.y = s === 1 ? 0 : Math.PI;
    g.add(board);
  }
  g.visible = false;
  return g;
}

const SHOP_NAMES = ["TIT CAFETERIA", "BOOK DEPOT", "TIT STORE", "XEROX & PRINT", "TIT CHAI"];
const SHOP_TINTS = ["#e0d5c2", "#c9b8a0", "#d8c9c0", "#c8d4d8"];

function makeShop(): THREE.Group {
  const g = new THREE.Group();
  const tint = SHOP_TINTS[Math.floor(Math.random() * SHOP_TINTS.length)];
  const name = SHOP_NAMES[Math.floor(Math.random() * SHOP_NAMES.length)];
  const bodyMat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.7, 2.9), bodyMat);
  body.position.y = 1.35;
  g.add(body);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.85 });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.22, 3.1), roofMat);
  roof.position.y = 2.82;
  g.add(roof);
  // storefront window
  const winTex = windowTexture("#22293a", 2, 3);
  const win = new THREE.Mesh(
    new THREE.PlaneGeometry(3.3, 1.15),
    new THREE.MeshBasicMaterial({ map: winTex }),
  );
  win.position.set(0, 1.35, 1.46);
  g.add(win);
  // awning (striped, tilted)
  const awningMat = new THREE.MeshStandardMaterial({ map: makeAwningTexture(), roughness: 0.85, side: THREE.DoubleSide });
  const awning = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.06, 0.85), awningMat);
  awning.position.set(0, 2.12, 1.2);
  awning.rotation.x = -0.5;
  g.add(awning);
  // sign board
  const signTex = textTexture(name, { bg: "#0d3b4f", fg: "#ffd23f" });
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(4.0, 0.85),
    new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide }),
  );
  sign.position.set(0, 2.52, 1.46);
  g.add(sign);
  // door
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 0.06), new THREE.MeshStandardMaterial({ color: 0x4a5a68, roughness: 0.6 }));
  door.position.set(-1.35, 0.75, 1.46);
  g.add(door);
  g.visible = false;
  return g;
}

function makeModelBadge(text: string): THREE.Mesh {
  const tex = textTexture(text, { bg: "#0d3b4f", fg: "#8ef5c9", w: 1024 });
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2.8, 0.72),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }),
  );
  mesh.position.set(0, 2.45, 1.52);
  return mesh;
}

function gateBannerTexture(name: string, fg: string): THREE.CanvasTexture {
  // single-line college banner for one gate
  const W = 1024;
  const H = 430;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0d3b4f";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#8ef5c9";
  ctx.lineWidth = 12;
  ctx.strokeRect(12, 12, W - 24, H - 24);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  let size = 220;
  ctx.font = `900 ${size}px "Space Grotesk", Arial, sans-serif`;
  while (ctx.measureText(name).width > W * 0.9 && size > 70) {
    size -= 6;
    ctx.font = `900 ${size}px "Space Grotesk", Arial, sans-serif`;
  }
  ctx.lineWidth = Math.max(12, size * 0.16);
  ctx.strokeStyle = "rgba(6,18,28,0.9)";
  ctx.strokeText(name, W / 2, H / 2);
  ctx.fillStyle = fg;
  ctx.fillText(name, W / 2, H / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeGateArch(name: string): THREE.Group {
  // campus arch with a college banner — decor piece (no collision)
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xd9c9a6, roughness: 0.85 });
  const bannerMat = new THREE.MeshBasicMaterial({ map: gateBannerTexture(name, name === "MADARCHOD COLLEGE" ? "#8ef5c9" : "#ffd23f"), side: THREE.DoubleSide });
  const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 6.5, 0.9), stone);
  p1.position.set(-4.2, 3.25, 0);
  g.add(p1);
  const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 6.5, 0.9), stone);
  p2.position.set(4.2, 3.25, 0);
  g.add(p2);
  const top = new THREE.Mesh(new THREE.BoxGeometry(9.6, 1.2, 1.1), stone);
  top.position.y = 6.6;
  g.add(top);
  const cap1 = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.3), stone);
  cap1.position.set(-4.2, 7.1, 0);
  g.add(cap1);
  const cap2 = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.3), stone);
  cap2.position.set(4.2, 7.1, 0);
  g.add(cap2);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(7, 2.2), bannerMat);
  banner.position.y = 6.4;
  banner.position.z = 0.6;
  g.add(banner);
  g.visible = false;
  return g;
}

// ----------------------------------------------------------------- campus

export class Campus {
  scene: THREE.Scene;
  obstacles: Obstacle[] = [];
  coins: Coin[] = [];
  private props: { mesh: THREE.Object3D; x: number; z: number; active: boolean }[] = [];
  private nextChunkZ = -55;
  private scrolled = 0;
  private rngState = 7;

  private materials: { dispose(): void }[] = [];
  private geometries: { dispose(): void }[] = [];

  // pools
  private coinPool: Coin[] = [];
  private decoPool: THREE.Group[] = [];
  private treePool: THREE.Group[] = [];
  private bushPool: THREE.Group[] = [];
  private flowerPool: THREE.Group[] = [];
  private lampPool: THREE.Group[] = [];
  private signPool: THREE.Group[] = [];
  private benchPool: THREE.Group[] = [];
  private busStopPool: THREE.Group[] = [];
  private fencePool: THREE.Group[] = [];
  private carPool: THREE.Group[] = [];
  private buildingPool: THREE.Group[] = [];
  private kenneyBuildingPool: THREE.Group[] = [];
  private kenneyDetailPool: THREE.Group[] = [];
  private shopPool: THREE.Group[] = [];
  private archPool: THREE.Group[] = [];
  private lowPool: { mesh: THREE.Group; w: number; d: number; h: number }[] = [];
  private tallPool: { mesh: THREE.Group; w: number; d: number; h: number }[] = [];
  private overheadPool: { mesh: THREE.Group; w: number; d: number; h: number }[] = [];

  // ground + road (static, moves with world origin at 0 — infinite look)
  private ground: THREE.Mesh;
  private road: THREE.Mesh;
  private roadTex: THREE.CanvasTexture;
  private scrollers: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // sky gradient dome
    const skyGeo = new THREE.SphereGeometry(220, 16, 12);
    const skyMat = new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      map: makeSkyTexture(),
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    scene.add(sky);
    this.materials.push(skyMat);
    this.geometries.push(skyGeo);

    // ground
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x77b34c, roughness: 1 });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 1200), groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.z = -400;
    this.ground.receiveShadow = true;
    scene.add(this.ground);
    this.materials.push(groundMat);
    this.geometries.push(this.ground.geometry);

    // road (3 lanes, procedural texture with lane markings)
    this.roadTex = makeRoadTexture();
    const roadMat = new THREE.MeshStandardMaterial({ map: this.roadTex, roughness: 0.95 });
    this.road = new THREE.Mesh(new THREE.PlaneGeometry(10.4, 1200), roadMat);
    this.road.rotation.x = -Math.PI / 2;
    this.road.position.z = -400;
    this.road.position.y = 0.02;
    this.road.receiveShadow = true;
    scene.add(this.road);
    this.materials.push(roadMat, this.roadTex);
    this.geometries.push(this.road.geometry);

    // sidewalks + kerbs (scroll with the road)
    const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0xb9b5ab, roughness: 0.95 });
    const kerbMat = new THREE.MeshStandardMaterial({ color: 0x8f8b82, roughness: 0.9 });
    const sidewalkGeo = new THREE.PlaneGeometry(2.4, 1200);
    const kerbGeo = new THREE.BoxGeometry(0.26, 0.14, 1200);
    this.geometries.push(sidewalkGeo, kerbGeo);
    this.materials.push(sidewalkMat, kerbMat);
    for (const s of [-1, 1] as const) {
      const sw = new THREE.Mesh(sidewalkGeo, sidewalkMat);
      sw.rotation.x = -Math.PI / 2;
      sw.position.set(s * (6.6 + 1.2), 0.035, -400);
      scene.add(sw);
      this.scrollers.push(sw);
      const kerb = new THREE.Mesh(kerbGeo, kerbMat);
      kerb.position.set(s * 5.85, 0.075, -400);
      scene.add(kerb);
      this.scrollers.push(kerb);
    }
    this.scrollers.push(this.ground, this.road);

    // distant city silhouette — single InstancedMesh (2 draw calls)
    this.buildCityRing();

    // build pools
    for (let i = 0; i < 70; i++) this.coinPool.push(makeCoin());
    for (let i = 0; i < 26; i++) this.treePool.push(this.addProp(makeTree()));
    for (let i = 0; i < 26; i++) this.bushPool.push(this.addProp(makeBush()));
    for (let i = 0; i < 10; i++) this.flowerPool.push(this.addProp(makeFlowers()));
    for (let i = 0; i < 14; i++) this.lampPool.push(this.addProp(makeLamp()));
    const signTexts = ["TIT · ANAND NAGAR", "PLACEMENT CELL", "LIBRARY →", "CSE DEPT →", "AUDITORIUM", "HOSTEL →"];
    for (let i = 0; i < 12; i++) this.signPool.push(this.addProp(makeSign(signTexts[i % signTexts.length])));
    for (let i = 0; i < 12; i++) this.benchPool.push(this.addProp(makeBench()));
    for (let i = 0; i < 3; i++) this.busStopPool.push(this.addProp(makeBusStop()));
    for (let i = 0; i < 8; i++) this.fencePool.push(this.addProp(makeFence()));
    for (let i = 0; i < 12; i++) this.carPool.push(this.addProp(makeParkedCar()));
    for (let i = 0; i < 12; i++) this.buildingPool.push(this.addProp(makeBuilding(BUILDING_NAMES[i % 4], i % 3)));
    for (let i = 0; i < 7; i++) this.shopPool.push(this.addProp(makeShop()));
    this.loadKenneyCityKit();
    // road decorations (manhole covers / pothole patches) — pure visuals
    for (let i = 0; i < 10; i++) this.decoPool.push(this.addProp(makeRoadDeco(i % 2 === 0)));
    // separate gates: GANDU COLLEGE at the start, MADARCHOD COLLEGE mid-run
    this.archPool.push(this.addProp(makeGateArch("GANDU COLLEGE")));
    this.archPool.push(this.addProp(makeGateArch("MADARCHOD COLLEGE")));
    this.archPool.push(this.addProp(makeGateArch("GANDU COLLEGE")));
    for (let i = 0; i < 22; i++) {
      const o = makeObstacleMesh("low");
      this.scene.add(o.mesh);
      this.lowPool.push(o);
    }
    for (let i = 0; i < 14; i++) {
      const o = makeObstacleMesh("tall");
      this.scene.add(o.mesh);
      this.tallPool.push(o);
    }
    for (let i = 0; i < 12; i++) {
      const o = makeObstacleMesh("overhead");
      this.scene.add(o.mesh);
      this.overheadPool.push(o);
    }
  }

  /** Distant background buildings drawn with two InstancedMesh draw calls. */
  private buildCityRing() {
    const N = 110;
    const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
    const roofGeo = new THREE.BoxGeometry(1.12, 0.18, 1.12);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x9fb4c4, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x7c8ea0, roughness: 0.9 });
    this.geometries.push(bodyGeo, roofGeo);
    this.materials.push(bodyMat, roofMat);

    const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, N);
    const roofs = new THREE.InstancedMesh(roofGeo, roofMat, N);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + this.rng() * 0.3;
      const radius = 42 + this.rng() * 18;
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius;
      const h = 4 + this.rng() * 9;
      const w = 3 + this.rng() * 3;
      dummy.position.set(x, h / 2, z);
      dummy.scale.set(w, h, w * (0.7 + this.rng() * 0.5));
      dummy.rotation.y = this.rng() * Math.PI;
      dummy.updateMatrix();
      bodies.setMatrixAt(i, dummy.matrix);
      color.setHSL(0.56 + this.rng() * 0.1, 0.18 + this.rng() * 0.2, 0.42 + this.rng() * 0.2);
      bodies.setColorAt(i, color);
      roofs.setMatrixAt(i, dummy.matrix);
    }
    bodies.instanceMatrix.needsUpdate = true;
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    roofs.instanceMatrix.needsUpdate = true;
    this.scene.add(bodies, roofs);
  }

  private addProp(mesh: THREE.Object3D): THREE.Group {
    mesh.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.scene.add(mesh);
    this.props.push({ mesh, x: 0, z: 0, active: false });
    return mesh as THREE.Group;
  }

  private loadKenneyCityKit() {
    const loader = new GLTFLoader();
    const base = "/models/kenney-city-suburban/";
    const load = (file: string) =>
      new Promise<THREE.Group>((resolve, reject) => {
        loader.load(
          base + file,
          (gltf) => resolve(gltf.scene),
          undefined,
          reject,
        );
      });

    Promise.all(KENNEY_CITY_ASSETS.map(load))
      .then((templates) => {
        for (let i = 0; i < 18; i++) {
          const root = new THREE.Group();
          const model = templates[i % templates.length].clone(true);
          model.scale.setScalar(1.35);
          model.rotation.y = Math.PI / 2;
          model.position.set(0, 0, 0);
          model.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) {
              o.castShadow = true;
              o.receiveShadow = true;
            }
          });
          const badge = makeModelBadge(BUILDING_NAMES[i % BUILDING_NAMES.length]);
          badge.position.x = 0;
          badge.rotation.y = 0;
          root.add(model, badge);
          root.visible = false;
          this.kenneyBuildingPool.push(this.addProp(root));
        }
      })
      .catch(() => {
        // Procedural campus stays active when external assets are unavailable.
      });

    Promise.all(KENNEY_DETAIL_ASSETS.map(load))
      .then((templates) => {
        for (let i = 0; i < 24; i++) {
          const root = templates[i % templates.length].clone(true);
          root.scale.setScalar(i % 6 < 2 ? 1.35 : 1.15);
          root.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) {
              o.castShadow = true;
              o.receiveShadow = true;
            }
          });
          root.visible = false;
          this.kenneyDetailPool.push(this.addProp(root));
        }
      })
      .catch(() => {
        // Decorative fallback pools already cover trees, fences and planters.
      });
  }

  private rng() {
    // deterministic-ish but varied
    this.rngState = (this.rngState * 1103515245 + 12345) & 0x7fffffff;
    return this.rngState / 0x7fffffff;
  }

  /** Returns a free pooled obstacle of the given kind, or null. */
  private takeObstacle(kind: ObstacleKind): { mesh: THREE.Group; w: number; d: number; h: number } | null {
    const pool = kind === "low" ? this.lowPool : kind === "tall" ? this.tallPool : this.overheadPool;
    for (const o of pool) {
      if (!o.mesh.visible) return o;
    }
    const o = makeObstacleMesh(kind);
    this.scene.add(o.mesh);
    if (kind === "low") this.lowPool.push(o);
    else if (kind === "tall") this.tallPool.push(o);
    else this.overheadPool.push(o);
    return o;
  }

  private takeCoin(): Coin | null {
    for (const c of this.coinPool) {
      if (!c.active) {
        this.scene.add(c.mesh);
        return c;
      }
    }
    const c = makeCoin();
    this.scene.add(c.mesh);
    this.coinPool.push(c);
    return c;
  }

  private placeProp(pool: THREE.Group[], side: -1 | 1, z: number, rotate = true) {
    for (const m of pool) {
      if (!m.visible) {
        m.visible = true;
        const x = side * (6 + this.rng() * 7);
        m.position.set(x, 0, z);
        m.rotation.y = rotate ? this.rng() * Math.PI * 2 : 0;
        const p = this.props.find((pr) => pr.mesh === m)!;
        p.x = x;
        p.z = z;
        p.active = true;
        return;
      }
    }
  }

  private placeCar(z: number, side: -1 | 1) {
    for (const m of this.carPool) {
      if (!m.visible) {
        m.visible = true;
        const x = side * (6.5 + this.rng() * 8);
        m.position.set(x, 0, z);
        m.rotation.y = this.rng() < 0.5 ? 0 : Math.PI;
        const p = this.props.find((pr) => pr.mesh === m)!;
        p.x = x;
        p.z = z;
        p.active = true;
        return;
      }
    }
  }

  private placeKenneyBuilding(side: -1 | 1, z: number) {
    for (const m of this.kenneyBuildingPool) {
      if (!m.visible) {
        m.visible = true;
        const x = side * (11 + this.rng() * 5);
        m.position.set(x, 0, z);
        m.rotation.y = side < 0 ? -Math.PI / 2 : Math.PI / 2;
        const p = this.props.find((pr) => pr.mesh === m)!;
        p.x = x;
        p.z = z;
        p.active = true;
        return true;
      }
    }
    return false;
  }

  private placeKenneyDetail(side: -1 | 1, z: number) {
    for (const m of this.kenneyDetailPool) {
      if (!m.visible) {
        m.visible = true;
        const x = side * (6.2 + this.rng() * 4.4);
        m.position.set(x, 0, z);
        m.rotation.y = this.rng() * Math.PI * 2;
        const p = this.props.find((pr) => pr.mesh === m)!;
        p.x = x;
        p.z = z;
        p.active = true;
        return true;
      }
    }
    return false;
  }

  /** Spawn one chunk of campus between z and z+CHUNK. */
  private spawnChunk(z0: number) {
    const sideA = this.rng() < 0.5 ? -1 : 1;
    const sideB = (sideA * -1) as -1 | 1;

    // roadside props every few units
    for (let z = z0 + 4; z < z0 + CHUNK; z += 5.5) {
      const r = this.rng();
      if (r < 0.36) this.placeProp(this.treePool, sideA, z);
      else if (r < 0.5) this.placeProp(this.lampPool, sideA, z);
      else if (r < 0.62) this.placeProp(this.signPool, sideA, z);
      else if (r < 0.72) this.placeProp(this.bushPool, sideA, z + 2.5);
      else if (r < 0.8) this.placeProp(this.benchPool, sideB, z);
      else if (r < 0.9) this.placeCar(z, sideB);
      else this.placeProp(this.flowerPool, sideB, z + 1.5);
      if (this.rng() < 0.22) this.placeKenneyDetail(sideB, z + 1.4);
      if (this.rng() < 0.28) this.placeProp(this.bushPool, sideB, z + 3);
    }
    // fence stretch along the road edge
    if (this.rng() < 0.3) {
      const z = z0 + 4 + this.rng() * 20;
      this.placeProp(this.fencePool, sideB, z, false);
    }
    // a building every chunk (faces the road so its TIT board shows)
    if (this.rng() < 0.8) {
      if (!this.placeKenneyBuilding(sideA, z0 + 10)) {
        const b = this.buildingPool.find((m) => !m.visible);
        if (b) {
        b.visible = true;
        b.rotation.y = 0;
        const x = sideA * (12 + this.rng() * 5);
        b.position.set(x, 0, z0 + 10);
        const p = this.props.find((pr) => pr.mesh === b)!;
        p.x = x;
        p.z = z0 + 10;
        p.active = true;
        }
      }
    }
    // a shop facade every few chunks
    if (this.rng() < 0.35) {
      const s = this.shopPool.find((m) => !m.visible);
      if (s) {
        s.visible = true;
        s.rotation.y = 0;
        const x = sideA * (11 + this.rng() * 5);
        s.position.set(x, 0, z0 + 24);
        const p = this.props.find((pr) => pr.mesh === s)!;
        p.x = x;
        p.z = z0 + 24;
        p.active = true;
      }
    }
    // rare bus stop
    if (this.rng() < 0.14) {
      this.placeProp(this.busStopPool, sideA, z0 + 20, false);
    }
    // road decorations on random lanes
    if (this.rng() < 0.8) {
      const d = this.decoPool.find((m) => !m.visible);
      if (d) {
        d.visible = true;
        d.rotation.y = this.rng() * Math.PI * 2;
        d.position.set(LANES[Math.floor(this.rng() * 3)] + (this.rng() - 0.5) * 0.4, 0, z0 + 6 + this.rng() * 10);
        const p = this.props.find((pr) => pr.mesh === d)!;
        p.x = d.position.x;
        p.z = d.position.z;
        p.active = true;
      }
    }
    if (this.rng() < 0.3) {
      const a = this.archPool.find((m) => !m.visible);
      if (a) {
        a.visible = true;
        a.position.set(0, 0, z0 + 18);
        const p = this.props.find((pr) => pr.mesh === a)!;
        p.x = 0;
        p.z = z0 + 18;
        p.active = true;
      }
    }

    // ---- obstacles (fair patterns: every row leaves a dodge path) -------
    const pattern = Math.floor(this.rng() * 6);
    if (pattern === 0) {
      // single jumpable in one lane + a second staggered row
      const lane = Math.floor(this.rng() * 3);
      this.addObstacle("low", LANES[lane], z0 + 14);
      this.maybeCoinArc(LANES[lane], z0 + 14);
      if (this.rng() < 0.55) {
        this.addObstacle("low", LANES[(lane + 1 + Math.floor(this.rng() * 2)) % 3], z0 + 26);
      }
    } else if (pattern === 1) {
      // two lanes blocked with tall, one lane free + follow-up low
      const free = Math.floor(this.rng() * 3);
      for (let i = 0; i < 3; i++) {
        if (i !== free) this.addObstacle("tall", LANES[i], z0 + 16);
      }
      this.coinLine(LANES[free], z0 + 8, 5);
      if (this.rng() < 0.5) this.addObstacle("low", LANES[free], z0 + 30);
    } else if (pattern === 2) {
      // overhead slide + a second overhead row in another lane
      const lane = Math.floor(this.rng() * 3);
      this.addObstacle("overhead", LANES[lane], z0 + 15);
      this.maybeCoinArc(LANES[lane], z0 + 15);
      this.coinLine(LANES[(lane + 1) % 3], z0 + 4, 4);
      if (this.rng() < 0.5) {
        this.addObstacle("overhead", LANES[(lane + 1) % 3], z0 + 28);
      }
    } else if (pattern === 3) {
      // double row of single-lane obstacles + a third row
      const l1 = Math.floor(this.rng() * 3);
      const l2 = Math.floor(this.rng() * 3);
      this.addObstacle("low", LANES[l1], z0 + 12);
      this.addObstacle("low", LANES[l2], z0 + 24);
      this.maybeCoinArc(LANES[l1], z0 + 12);
      if (this.rng() < 0.6) {
        const kind = this.rng() < 0.5 ? "low" : "overhead";
        this.addObstacle(kind as "low" | "overhead", LANES[(l2 + 1) % 3], z0 + 36);
      }
    } else if (pattern === 4) {
      // slalom: three staggered single-lane rows + a 4th
      const lanes = [0, 1, 2].sort(() => this.rng() - 0.5);
      this.addObstacle("low", LANES[lanes[0]], z0 + 12);
      this.addObstacle("low", LANES[lanes[1]], z0 + 22);
      this.addObstacle("low", LANES[lanes[2]], z0 + 32);
      if (this.rng() < 0.5) {
        this.addObstacle("overhead", LANES[lanes[0]], z0 + 38);
      }
    } else {
      // two-lane jumpable wall + coin arc + follow-up overhead
      const free = Math.floor(this.rng() * 3);
      for (let i = 0; i < 3; i++) {
        if (i !== free) this.addObstacle("low", LANES[i], z0 + 15);
      }
      this.maybeCoinArc(LANES[free], z0 + 15);
      if (this.rng() < 0.5) this.addObstacle("overhead", LANES[free], z0 + 32);
    }
    // extra rows deep in the chunk keep the road busy
    if (this.rng() < 0.8) {
      const lane = Math.floor(this.rng() * 3);
      const kind = this.rng() < 0.6 ? "low" : "overhead";
      this.addObstacle(kind as "low" | "overhead", LANES[lane], z0 + 34);
    }
    if (this.rng() < 0.4) {
      this.addObstacle("low", LANES[Math.floor(this.rng() * 3)], z0 + 39);
    }

    // scattered coins
    if (this.rng() < 0.8) {
      const lane = Math.floor(this.rng() * 3);
      const n = 4 + Math.floor(this.rng() * 4);
      this.coinLine(LANES[lane], z0 + 26, n);
    }
    if (this.rng() < 0.4) {
      // zigzag across lanes
      for (let i = 0; i < 3; i++) {
        this.coinLine(LANES[(i * 2) % 3], z0 + 32 + i * 3, 2);
      }
    }
  }

  private addObstacle(kind: ObstacleKind, x: number, z: number) {
    const o = this.takeObstacle(kind);
    if (!o) return;
    o.mesh.visible = true;
    o.mesh.position.set(x, 0, z);
    const ob: Obstacle = {
      id: OID++,
      mesh: o.mesh,
      x,
      z,
      w: o.w,
      d: o.d,
      h: o.h,
      kind,
      active: true,
    };
    this.obstacles.push(ob);
  }

  private coinLine(x: number, z: number, n: number) {
    for (let i = 0; i < n; i++) {
      const c = this.takeCoin();
      if (!c) return;
      c.x = x;
      c.z = z + i * 1.6;
      c.y = 0.55;
      c.active = true;
      c.mesh.visible = true;
      c.mesh.position.set(c.x, c.y, c.z);
      this.coins.push(c);
    }
  }

  private maybeCoinArc(x: number, z: number) {
    if (this.rng() < 0.55) {
      for (let i = 0; i < 5; i++) {
        const c = this.takeCoin();
        if (!c) return;
        c.x = x;
        c.z = z - 3 + i * 1.4;
        c.y = 0.5 + 1.1 * Math.sin((i / 4) * Math.PI);
        c.active = true;
        c.mesh.visible = true;
        c.mesh.position.set(c.x, c.y, c.z);
        this.coins.push(c);
      }
    }
  }

  /** Move the world toward the player and recycle everything that falls behind. */
  update(dt: number, speed: number) {
    const dz = speed * dt;

    // coins
    for (const c of this.coins) {
      if (!c.active) continue;
      c.z += dz;
      c.mesh.rotation.y += dt * 6;
      if (c.z > KILL_Z) {
        c.active = false;
        c.mesh.visible = false;
        this.scene.remove(c.mesh);
        const idx = this.coins.indexOf(c);
        if (idx >= 0) this.coins.splice(idx, 1);
      } else {
        c.mesh.position.set(c.x, c.y + Math.sin(c.mesh.rotation.y) * 0.06, c.z);
      }
    }

    // obstacles
    for (const o of this.obstacles) {
      if (!o.active) continue;
      o.z += dz;
      o.mesh.position.z = o.z;
      if (o.z > KILL_Z) {
        o.active = false;
        o.mesh.visible = false;
      }
    }

    // props
    for (const p of this.props) {
      if (!p.active) continue;
      p.z += dz;
      p.mesh.position.z = p.z;
      if (p.z > KILL_Z) {
        p.active = false;
        p.mesh.visible = false;
      }
    }

    // ground/road/sidewalk drift so markings scroll toward the camera
    for (const m of this.scrollers) {
      m.position.z += dz;
      if (m.position.z > 450) m.position.z -= 800;
    }

    // spawn new chunks while there's room ahead (relative to world scroll)
    this.scrolled += dz;
    while (this.nextChunkZ + this.scrolled > -SPAWN_AHEAD) {
      this.spawnChunk(this.nextChunkZ);
      this.nextChunkZ -= CHUNK;
    }
  }

  /** The start-of-run setup: gate straight ahead, empty first stretch. */
  placeStartGate(z: number) {
    // GANDU COLLEGE gate at the start line
    const a = this.archPool[0];
    a.visible = true;
    a.position.set(0, 0, z);
    const p = this.props.find((pr) => pr.mesh === a)!;
    p.x = 0;
    p.z = z;
    p.active = true;
    // MADARCHOD COLLEGE gate further into the run — a separate gate
    const b = this.archPool[1];
    b.visible = true;
    b.position.set(0, 0, z - 150);
    const pb = this.props.find((pr) => pr.mesh === b)!;
    pb.x = 0;
    pb.z = z - 150;
    pb.active = true;
    // a few side props near start
    this.placeProp(this.treePool, -1, z - 10);
    this.placeProp(this.treePool, 1, z - 14);
    this.placeProp(this.lampPool, -1, z - 4);
    this.placeProp(this.lampPool, 1, z + 4);
    this.placeProp(this.buildingPool, -1, z + 12);
  }

  reset(runStartZ: number) {
    this.scrolled = 0;
    this.nextChunkZ = -(runStartZ + CHUNK);
    this.obstacles.length = 0;
    for (const c of this.coinPool) {
      c.active = false;
      c.mesh.visible = false;
      this.scene.remove(c.mesh);
    }
    this.coins.length = 0;
    for (const o of [...this.lowPool, ...this.tallPool, ...this.overheadPool]) o.mesh.visible = false;
    for (const p of this.props) {
      p.active = false;
      p.mesh.visible = false;
    }
  }

  dispose() {
    for (const m of this.materials) m.dispose();
    for (const g of this.geometries) g.dispose();
    for (const o of this.obstacles) this.scene.remove(o.mesh);
    for (const c of this.coinPool) this.scene.remove(c.mesh);
    for (const p of this.props) this.scene.remove(p.mesh);
  }
}
