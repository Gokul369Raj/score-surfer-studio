import * as THREE from "three";

/**
 * TIT Campus Run — procedural stylized campus world.
 * Road, gate, buildings, trees, lamps, signs, parking, gardens, obstacles and
 * coins are all pooled and recycled as the player runs — nothing is created
 * per frame and memory stays flat.
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
  const ww = c.width / (cols * 2.4);
  const wh = c.height / (rows * 2.8);
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = c.width * 0.16 + col * (c.width / cols);
      const y = c.height * 0.12 + r * (c.height / rows);
      ctx.fillStyle = "rgba(15,23,42,0.92)";
      ctx.fillRect(x, y, ww, wh);
      ctx.fillStyle = "rgba(170,220,255,0.55)";
      ctx.fillRect(x + ww * 0.08, y + wh * 0.08, ww * 0.3, wh * 0.25);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(x + ww * 0.08, y + wh * 0.08, ww * 0.1, wh * 0.25);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function textTexture(text: string, opts: { fg?: string; bg?: string; } = {}): THREE.CanvasTexture {
  const { fg = "#ffffff", bg = "#0d3b4f" } = opts;
  const W = 1024;
  const H = 430;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
  }
  let size = 210;
  ctx.font = `800 ${size}px "Space Grotesk", Arial, sans-serif`;
  while (ctx.measureText(text).width > W * 0.94 && size > 70) {
    size -= 8;
    ctx.font = `800 ${size}px "Space Grotesk", Arial, sans-serif`;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(12, size * 0.14);
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.strokeText(text, W / 2, H / 2);
  ctx.fillStyle = fg;
  ctx.fillText(text, W / 2, H / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// --------------------------------------------------------------- builders

function makeCoin(): Coin {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffc83d, metalness: 0.75, roughness: 0.3 });
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

  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, 0, rz);
    g.add(mesh);
  };

  const lowR = Math.random();
  if (kind === "low" && lowR < 0.4) {
    // traffic cone
    const coneGeo = new THREE.ConeGeometry(0.24, 0.5, 12);
    add(coneGeo, orange, 0, 0.25, 0);
    add(new THREE.BoxGeometry(0.5, 0.06, 0.5), white, 0, 0.02, 0);
    w = 0.6; d = 0.6; h = 0.55;
  } else if (kind === "low" && lowR < 0.72) {
    // striped barricade
    add(new THREE.BoxGeometry(1.6, 0.14, 0.14), white, 0, 0.55, 0);
    add(new THREE.BoxGeometry(1.7, 0.14, 0.14), white, 0, 0.28, 0);
    for (const s of [-0.65, 0.65]) {
      add(new THREE.CylinderGeometry(0.035, 0.035, 0.75, 8), orange, s, 0.36, 0);
    }
    const stripes = new THREE.BoxGeometry(0.18, 0.16, 0.16);
    for (let i = -3; i <= 3; i++) add(stripes, orange, i * 0.24, 0.56, 0.02);
    w = 1.8; d = 0.3; h = 0.65;
  } else if (kind === "low" && lowR < 0.88) {
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
    // parked car
    const body = new THREE.BoxGeometry(0.95, 0.55, 1.9);
    add(body, mat, 0, 0.62, 0);
    add(new THREE.BoxGeometry(0.85, 0.4, 1.1), white, 0, 1.0, -0.1);
    for (const s of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 10), dark, s * 0.3, 0.16, 0.62);
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 10), dark, s * 0.3, 0.16, -0.62);
    }
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
    // overhead gate — slide under it
    add(new THREE.BoxGeometry(2.6, 0.16, 0.2), orange, 0, 1.05, 0);
    add(new THREE.BoxGeometry(0.14, 1.1, 0.2), grey, -1.2, 0.55, 0);
    add(new THREE.BoxGeometry(0.14, 1.1, 0.2), grey, 1.2, 0.55, 0);
    const warn = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd24a, emissiveIntensity: 1.6 });
    add(new THREE.BoxGeometry(2.1, 0.1, 0.12), warn, 0, 0.86, 0);
    w = 2.6; d = 0.3; h = 1.05;
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
  const leaf = new THREE.MeshStandardMaterial({ color: 0x2e8b57, roughness: 0.85 });
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.2, 8), trunk);
  t.position.y = 0.6;
  g.add(t);
  const c1 = new THREE.Mesh(new THREE.SphereGeometry(0.75, 10, 8), leaf);
  c1.position.y = 1.7;
  g.add(c1);
  const c2 = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), leaf);
  c2.position.set(0.35, 2.2, 0.2);
  g.add(c2);
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
  g.visible = false;
  return g;
}

function makeLamp(): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.MeshStandardMaterial({ color: 0x3a4147, roughness: 0.6, metalness: 0.4 });
  const bulb = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c0, emissiveIntensity: 1.4 });
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.4, 8), pole);
  p.position.y = 1.7;
  g.add(p);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.06), pole);
  arm.position.set(0.35, 3.32, 0);
  g.add(arm);
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.2), bulb);
  b.position.set(0.7, 3.25, 0);
  g.add(b);
  g.visible = false;
  return g;
}

function makeSign(text: string, h = 2.2): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.MeshStandardMaterial({ color: 0x37434a, roughness: 0.6 });
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, h, 8), pole);
  p.position.y = h / 2;
  g.add(p);
  const tex = textTexture(text, { bg: "#0d3b4f" });
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 1.0),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }),
  );
  board.position.y = h + 0.5;
  g.add(board);
  g.visible = false;
  return g;
}

const BUILDING_NAMES = ["TIT MAIN", "TIT EXCELLENCE", "TIT ADVANCE", "TIT SCIENCE"];

function makeBuilding(name: string, kind: number): THREE.Group {
  const g = new THREE.Group();
  const h = 4 + kind * 2.2;
  const w = 4.2 + kind * 0.8;
  const tex = windowTexture(kind % 2 === 0 ? "#d9c8a8" : "#c7b79a", kind === 2 ? 4 : 3, kind === 2 ? 4 : 3);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, 3.2), mat);
  body.position.y = h / 2;
  g.add(body);
  // roof
  const roof = new THREE.MeshStandardMaterial({ color: 0x7a4a2b, roughness: 0.8 });
  const r = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.25, 3.8), roof);
  r.position.y = h + 0.12;
  g.add(r);
  if (kind === 2) {
    // palace-style dome
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), roof);
    dome.position.y = h + 0.25;
    g.add(dome);
  }
  // name boards — on the road-facing sides AND the front/back so the name is
  // readable straight ahead as the player approaches, like the gate banner
  const boardTex = textTexture(name, { bg: "#0d3b4f", fg: "#8ef5c9" });
  const boardMat = new THREE.MeshBasicMaterial({ map: boardTex, side: THREE.DoubleSide });
  const sideBoardGeo = new THREE.PlaneGeometry(3.4, 1.0);
  for (const s of [-1, 1]) {
    const board = new THREE.Mesh(sideBoardGeo, boardMat);
    board.position.set(s * (w / 2 + 0.04), 2.6, 0);
    board.rotation.y = s * (Math.PI / 2);
    g.add(board);
  }
  // big front/back boards facing the runner (buildings run along the road axis)
  const frontBoardGeo = new THREE.PlaneGeometry(w - 0.4, 1.3);
  for (const s of [-1, 1]) {
    const board = new THREE.Mesh(frontBoardGeo, boardMat);
    board.position.set(0, 3.1, s * (3.2 / 2 + 0.05));
    board.rotation.y = s === 1 ? 0 : Math.PI;
    g.add(board);
  }
  g.visible = false;
  return g;
}

function makeGateArch(): THREE.Group {
  // campus arch with TIT banner — decor piece (no collision)
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xd9c9a6, roughness: 0.85 });
  const bannerMat = new THREE.MeshBasicMaterial({ map: textTexture("TIT CAMPUS RUN", { bg: "#0d3b4f", fg: "#8ef5c9" }), side: THREE.DoubleSide });
  const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 6.5, 0.9), stone);
  p1.position.set(-4.2, 3.25, 0);
  g.add(p1);
  const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 6.5, 0.9), stone);
  p2.position.set(4.2, 3.25, 0);
  g.add(p2);
  const top = new THREE.Mesh(new THREE.BoxGeometry(9.6, 1.2, 1.1), stone);
  top.position.y = 6.6;
  g.add(top);
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
  private lampPool: THREE.Group[] = [];
  private signPool: THREE.Group[] = [];
  private benchPool: THREE.Group[] = [];
  private buildingPool: THREE.Group[] = [];
  private archPool: THREE.Group[] = [];
  private lowPool: { mesh: THREE.Group; w: number; d: number; h: number }[] = [];
  private tallPool: { mesh: THREE.Group; w: number; d: number; h: number }[] = [];
  private overheadPool: { mesh: THREE.Group; w: number; d: number; h: number }[] = [];

  // ground + road (static, moves with world origin at 0 — infinite look)
  private ground: THREE.Mesh;
  private road: THREE.Mesh;
  private roadTex: THREE.CanvasTexture;

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

    // build pools
    for (let i = 0; i < 70; i++) this.coinPool.push(makeCoin());
    for (let i = 0; i < 26; i++) this.treePool.push(this.addProp(makeTree()));
    for (let i = 0; i < 30; i++) this.bushPool.push(this.addProp(makeBush()));
    for (let i = 0; i < 14; i++) this.lampPool.push(this.addProp(makeLamp()));
    const signTexts = ["TIT · ANAND NAGAR", "PLACEMENT CELL", "LIBRARY →", "CSE DEPT →", "AUDITORIUM", "HOSTEL →"];
    for (let i = 0; i < 12; i++) this.signPool.push(this.addProp(makeSign(signTexts[i % signTexts.length])));
    for (let i = 0; i < 12; i++) this.benchPool.push(this.addProp(makeBench()));
    for (let i = 0; i < 12; i++) this.buildingPool.push(this.addProp(makeBuilding(BUILDING_NAMES[i % 4], i % 3)));
    // road decorations (manhole covers / pothole patches) — pure visuals
    for (let i = 0; i < 10; i++) this.decoPool.push(this.addProp(makeRoadDeco(i % 2 === 0)));
    for (let i = 0; i < 3; i++) this.archPool.push(this.addProp(makeGateArch()));
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

  private addProp(mesh: THREE.Object3D): THREE.Group {
    mesh.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.scene.add(mesh);
    this.props.push({ mesh, x: 0, z: 0, active: false });
    return mesh as THREE.Group;
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
    // grow pool (keeps memory bounded in practice; only when a chunk over-uses)
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
        m.position.set(side * (6 + this.rng() * 7), 0, z);
        m.rotation.y = rotate ? this.rng() * Math.PI * 2 : 0;
        const p = this.props.find((pr) => pr.mesh === m)!;
        p.x = side * (6 + this.rng() * 7);
        p.z = z;
        p.active = true;
        return;
      }
    }
  }

  /** Spawn one chunk of campus between z and z+CHUNK. */
  private spawnChunk(z0: number) {
    const sideA = this.rng() < 0.5 ? -1 : 1;
    const sideB = (sideA * -1) as -1 | 1;

    // roadside props every few units
    for (let z = z0 + 4; z < z0 + CHUNK; z += 5.5) {
      const r = this.rng();
      if (r < 0.4) this.placeProp(this.treePool, sideA, z);
      else if (r < 0.55) this.placeProp(this.lampPool, sideA, z);
      else if (r < 0.7) this.placeProp(this.signPool, sideA, z);
      else if (r < 0.8) this.placeProp(this.bushPool, sideA, z + 2.5);
      else if (r < 0.9) this.placeProp(this.benchPool, sideB, z);
      else this.placeProp(this.bushPool, sideB, z + 1.5);
      if (this.rng() < 0.3) this.placeProp(this.bushPool, sideB, z + 3);
    }
    // a building every chunk (faces the road so its TIT board shows)
    if (this.rng() < 0.8) {
      const b = this.buildingPool.find((m) => !m.visible);
      if (b) {
        b.visible = true;
        b.rotation.y = 0;
        b.position.set(sideA * (12 + this.rng() * 5), 0, z0 + 10);
        const p = this.props.find((pr) => pr.mesh === b)!;
        p.x = sideA * (12 + this.rng() * 5);
        p.z = z0 + 10;
        p.active = true;
      }
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
    // denser than before: each chunk packs 2-5 rows, always passable
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

    // ground/road drift so markings scroll toward the camera (runner feel)
    this.ground.position.z += dz;
    this.road.position.z += dz;
    if (this.road.position.z > 450) this.road.position.z -= 800;
    if (this.ground.position.z > 450) this.ground.position.z -= 800;

    // spawn new chunks while there's room ahead (relative to world scroll).
    // Chunks are laid at negative z (far ahead) and stream toward the camera.
    this.scrolled += dz;
    while (this.nextChunkZ + this.scrolled > -SPAWN_AHEAD) {
      this.spawnChunk(this.nextChunkZ);
      this.nextChunkZ -= CHUNK;
    }
  }

  /** The start-of-run setup: gate straight ahead, empty first stretch. */
  placeStartGate(z: number) {
    const a = this.archPool.find((m) => !m.visible) ?? this.archPool[0];
    a.visible = true;
    a.position.set(0, 0, z);
    const p = this.props.find((pr) => pr.mesh === a)!;
    p.x = 0;
    p.z = z;
    p.active = true;
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
  }
  g.visible = false;
  return g;
}

function makeSkyTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#2f6f9e");
  grad.addColorStop(0.45, "#8ecbe8");
  grad.addColorStop(0.7, "#cdeef7");
  grad.addColorStop(1, "#e8f7e4");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 256);
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
