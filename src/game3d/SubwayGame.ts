// 3D Gokul Runner — a Three.js endless runner inspired by Subway Surfers.
// Gokul, an engineering student at TIT Bhopal, is running from Nischay Sir
// through the campus railway yard: dodge trains, jump barriers, slide under
// gates, and grab coins before Sir catches up.

import * as THREE from "three";

// ─── Public API ─────────────────────────────────────────────────────────

export interface ChaseState {
  strikes: number; // obstacle hits this run (0, 1, or 2)
  heat: number; // 0..1 — how close Sir is (1 = right behind, 0 = fell far back)
  chasing: boolean; // true while Sir is in full pursuit
}

export interface GameCallbacks {
  onScore: (
    score: number,
    coins: number,
    highScore: number,
    chase: ChaseState,
  ) => void;
  onGameOver: (score: number, coins: number, highScore: number) => void;
}

// ─── Tuning ────────────────────────────────────────────────────────────

const LANE_X = [-2.6, 0, 2.6];
const PLAYER_Z = 0;
const CHASER_Z = 2.6;

// Chase mechanic — Nischay Sir pursues at full tilt for a while, then
// gradually loses steam so the player gets a breather. Hitting an obstacle
// makes Sir sprint back in; the 2nd hit means he catches Gokul.
const CHASE_FULL_TIME = 8; // seconds of close pursuit after start / after a hit
const CHASE_FALLBACK = 1.1; // z-units/sec Sir drifts back once his steam runs out
const CHASE_RELIEF_Z = 10; // max distance behind Gokul (out of frame)
const COLLISION_COOLDOWN = 1.6; // seconds before the same crash can count again
const STRIKES_TO_CAUGHT = 2; // obstacle hits before Sir catches Gokul

const SPAWN_Z = -80;
const DESPAWN_Z = 16;

const BASE_SPEED = 13;
const MAX_SPEED = 34;
const ACCEL = 0.55;
const GRAVITY = 32;
const JUMP_V = 10.6;
const SLIDE_TIME = 0.85;
const WARMUP = 4.5;

const HIGH_SCORE_KEY = "subwayRunnerHighScore";

// Gokul — white tee, black inner layer, cargo pants, sneakers (per ref)
const GOKUL_COLORS = {
  skin: 0xffd9b0,
  hair: 0x1b1b1f,
  tee: 0xffffff,
  inner: 0x141416,
  pants: 0x3a4048,
  cuff: 0x4a5058,
  shoe: 0xffffff,
  shoeRed: 0xd64545,
  sole: 0x2b2b2b,
  sock: 0xf5f5f5,
  wristband: 0x141416,
  chain: 0xc8ccd4,
  eye: 0x1a1a2e,
};

// Nischay Sir — white button-down, dark trousers, belt, messenger bag
const SIR_COLORS = {
  skin: 0xf0b58a,
  hair: 0x1f2128,
  shirt: 0xf2f4f7,
  shirtRoll: 0xdfe4ea,
  pants: 0x2f3542,
  shoe: 0xffffff,
  shoeDark: 0x33373d,
  belt: 0x6b4a2f,
  bag: 0x7a5230,
  watch: 0x141416,
  book: 0x7b2fbe,
  bookEdge: 0x9a5fd8,
};

const TRAIN_COLORS = [0xe03131, 0x1971c2, 0x2f9e44, 0x9c36b5, 0xf08c00];
const BUILDING_COLORS = [
  0x4dabf7, 0xfab005, 0x69db7c, 0xda77f2, 0xffa94d, 0x74c0fc, 0xf783ac,
  0xa9e34b,
];
const BILLBOARD_SPACING = 17;
const BILLBOARD_COUNT = 10;

type ObstacleKind = "barrier" | "train" | "overhead";

interface Obstacle {
  group: THREE.Group;
  kind: ObstacleKind;
  lane: number;
  z: number;
  w: number;
  h: number;
  d: number;
  hit: boolean;
}

interface Coin {
  mesh: THREE.Mesh;
  lane: number;
  z: number;
  taken: boolean;
  phase: number;
}

interface Particle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

interface Building {
  mesh: THREE.Mesh;
  windows: THREE.Mesh[];
  baseZ: number;
  w: number;
  h: number;
}

interface Billboard {
  group: THREE.Group;
  board: THREE.Mesh;
  baseZ: number;
}

type Phase = "ready" | "running" | "over";

// ─── Engine ─────────────────────────────────────────────────────────────

export class SubwayGame {
  private container: HTMLElement;
  private callbacks: GameCallbacks;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private resizeObserver: ResizeObserver | null = null;

  // World
  private worldZ = 0;
  private speed = BASE_SPEED;
  private phase: Phase = "ready";
  private score = 0;
  private coinsCount = 0;
  private highScore = 0;

  // Gokul (player)
  private player = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private shadow!: THREE.Mesh;
  private shadowMat!: THREE.MeshBasicMaterial;

  // Nischay Sir (chaser)
  private chaser = new THREE.Group();
  private chaserLegL = new THREE.Group();
  private chaserLegR = new THREE.Group();
  private chaserArmL = new THREE.Group();
  private chaserArmR = new THREE.Group();
  private chaserShadow!: THREE.Mesh;
  private chaserShadowMat!: THREE.MeshBasicMaterial;
  private chaserCatchT = 1; // 1 = done, 0 = just caught

  // Chase + strike system
  private collisionCount = 0;
  private collisionCooldown = 0;
  private chaseTimer = 0;
  private chaserTargetZ = CHASER_Z;
  private knockT = 0;

  private lane = 1; // 0 | 1 | 2
  private x = 0;
  private prevX = 0;
  private camX = 0;
  private jumpY = 0;
  private vy = 0;
  private onGround = true;
  private slideTimer = 0;
  private slideDuration = SLIDE_TIME;
  private runPhase = 0;

  // Spawning
  private distSinceSpawn = 0;
  private nextGap = 12;
  private distSinceCoin = 0;
  private lastSpawnWasTrain = false;

  // Entities
  private obstacles: Obstacle[] = [];
  private coins: Coin[] = [];
  private particles: Particle[] = [];
  private sleepers: THREE.Mesh[] = [];
  private buildings: Building[] = [];
  private billboards: Billboard[] = [];
  private trees: THREE.Group[] = [];
  private clouds: THREE.Group[] = [];

  // Sun (moves with player so shadows stay crisp)
  private sun!: THREE.DirectionalLight;

  // TIT billboard texture (cached)
  private titTexture: THREE.CanvasTexture | null = null;

  // Crash fx
  private shake = 0;

  constructor(container: HTMLElement, callbacks: GameCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.highScore = parseInt(
      localStorage.getItem(HIGH_SCORE_KEY) || "0",
      10,
    );

    this.initRenderer();
    this.initScene();
    this.initPlayer();
    this.buildChaser();
    this.initEnvironment();
    this.initEvents();
    this.loop();
  }

  // ── Setup ───────────────────────────────────────────────────────────

  private initRenderer(): void {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const initW = Math.max(1, this.container.clientWidth || window.innerWidth);
    const initH = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.renderer.setSize(initW, initH);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.display = "block";
    this.container.appendChild(this.renderer.domElement);

    this.resizeObserver = new ResizeObserver(() => {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (w === 0 || h === 0) return;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    });
    this.resizeObserver.observe(this.container);
  }

  private initScene(): void {
    this.scene = new THREE.Scene();

    // Sky gradient background
    const sky = document.createElement("canvas");
    sky.width = 2;
    sky.height = 256;
    const g = sky.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#3aa0f0");
    grad.addColorStop(0.45, "#8ed0f8");
    grad.addColorStop(0.75, "#d9f1fb");
    grad.addColorStop(1, "#fdf4d8");
    g.fillStyle = grad;
    g.fillRect(0, 0, 2, 256);
    const skyTex = new THREE.CanvasTexture(sky);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = skyTex;

    this.scene.fog = new THREE.Fog(0xd9f1fb, 55, 170);

    this.camera = new THREE.PerspectiveCamera(
      62,
      Math.max(1, this.container.clientWidth || window.innerWidth) /
        Math.max(1, this.container.clientHeight || window.innerHeight),
      0.1,
      400,
    );
    this.camera.position.set(0, 4.5, 7.2);
    this.camera.lookAt(0, 1.0, -12);

    // Lights
    const hemi = new THREE.HemisphereLight(0xfff4d6, 0xbf8f5f, 1.05);
    this.scene.add(hemi);

    this.sun = new THREE.DirectionalLight(0xfff2d0, 1.7);
    this.sun.position.set(18, 30, 12);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 80;
    this.sun.shadow.camera.left = -16;
    this.sun.shadow.camera.right = 16;
    this.sun.shadow.camera.top = 16;
    this.sun.shadow.camera.bottom = -16;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Sun disc
    const sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(4, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff3b0 }),
    );
    sunDisc.position.set(-60, 60, -220);
    this.scene.add(sunDisc);
  }

  private makeNameTexture(text: string): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 128;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, 256, 128);
    g.font = "italic 900 66px 'Arial Black', Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    // Slight tilt for a graffiti feel
    g.save();
    g.translate(128, 60);
    g.rotate(-0.06);
    g.strokeStyle = "#111111";
    g.lineWidth = 9;
    g.strokeText(text, 0, 0);
    g.fillStyle = "#111111";
    g.fillText(text, 0, 0);
    g.restore();
    // Paint drips
    g.fillStyle = "#111111";
    g.fillRect(128 - g.measureText(text).width / 2 + 18, 92, 4, 18);
    g.fillRect(128 + 8, 96, 4, 13);
    g.fillRect(128 + g.measureText(text).width / 2 - 26, 90, 4, 16);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private namePlate(text: string, w: number, h: number): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshLambertMaterial({
        map: this.makeNameTexture(text),
        transparent: true,
      }),
    );
    return mesh;
  }

  private initPlayer(): void {
    const skin = this.mat(GOKUL_COLORS.skin);
    const hair = this.mat(GOKUL_COLORS.hair);
    const tee = this.mat(GOKUL_COLORS.tee);
    const inner = this.mat(GOKUL_COLORS.inner);
    const pants = this.mat(GOKUL_COLORS.pants);
    const cuff = this.mat(GOKUL_COLORS.cuff);
    const shoe = this.mat(GOKUL_COLORS.shoe);
    const shoeRed = this.mat(GOKUL_COLORS.shoeRed);
    const sole = this.mat(GOKUL_COLORS.sole);
    const sock = this.mat(GOKUL_COLORS.sock);
    const wrist = this.mat(GOKUL_COLORS.wristband);
    const chain = this.mat(GOKUL_COLORS.chain);
    const eye = this.mat(GOKUL_COLORS.eye);

    // Legs (pivot at hip) — cargo pants, feet reach the ground
    this.legL = this.makeLimbSmooth(0.14, 0.9, pants, 0, 0.36, 0);
    this.legR = this.makeLimbSmooth(0.14, 0.9, pants, 0, 0.36, 0);
    this.legL.position.set(-0.16, 0.96, 0);
    this.legR.position.set(0.16, 0.96, 0);
    this.player.add(this.legL, this.legR);

    // Cargo side pockets
    const pocketGeo = new THREE.BoxGeometry(0.12, 0.18, 0.07);
    const pocketL = new THREE.Mesh(pocketGeo, pants);
    pocketL.position.set(-0.16, -0.42, 0);
    const pocketR = new THREE.Mesh(pocketGeo, pants);
    pocketR.position.set(0.16, -0.42, 0);
    this.legL.add(pocketL);
    this.legR.add(pocketR);

    // Cuffed ankles
    for (const leg of [this.legL, this.legR]) {
      const c = new THREE.Mesh(
        new THREE.CylinderGeometry(0.145, 0.14, 0.1, 10),
        cuff,
      );
      c.position.set(0, -0.82, 0);
      leg.add(c);
    }

    // White socks + sneakers (white, red heel panel, thick black sole)
    for (const leg of [this.legL, this.legR]) {
      const sockM = new THREE.Mesh(
        new THREE.CylinderGeometry(0.115, 0.12, 0.16, 10),
        sock,
      );
      sockM.position.set(0, -0.72, 0.04);
      leg.add(sockM);
      const shoeM = this.box(0.3, 0.12, 0.46, shoe);
      shoeM.position.set(0, -0.87, 0.12);
      leg.add(shoeM);
      const heel = this.box(0.28, 0.1, 0.1, shoeRed);
      heel.position.set(0, -0.87, 0.3);
      leg.add(heel);
      const soleM = this.box(0.32, 0.06, 0.48, sole);
      soleM.position.set(0, -0.93, 0.12);
      leg.add(soleM);
    }

    // Rounded torso — white tee
    const torso = this.sph(0.34, tee);
    torso.scale.set(1, 0.95, 0.62);
    torso.position.set(0, 1.32, 0);
    this.player.add(torso);

    // Black inner-shirt collar
    const collar = this.box(0.22, 0.12, 0.22, inner);
    collar.position.set(0, 1.7, 0);
    this.player.add(collar);

    // Graffiti name on the back — "GOKUL"
    const name = this.namePlate("GOKUL", 0.46, 0.2);
    name.position.set(0, 1.38, 0.228);
    this.player.add(name);

    // Head (bigger for anime proportions) + curly hair + face
    const head = this.sph(0.26, skin);
    head.position.set(0, 1.98, 0);
    this.player.add(head);

    for (const sx of [-1, 1]) {
      const e = this.sph(0.042, eye);
      e.position.set(sx * 0.1, 2.02, -0.215);
      e.scale.set(1, 1, 0.45);
      this.player.add(e);
    }
    const mouth = this.box(0.1, 0.022, 0.02, this.mat(0xb3413d));
    mouth.position.set(0, 1.88, -0.235);
    this.player.add(mouth);

    const curls: Array<[number, number, number]> = [
      [0, 2.34, 0],
      [-0.14, 2.29, 0.03],
      [0.14, 2.29, 0.03],
      [0, 2.31, -0.14],
      [-0.16, 2.18, -0.12],
      [0.16, 2.18, -0.12],
      [0, 2.27, 0.15],
      [-0.07, 2.36, 0.1],
      [0.07, 2.36, 0.1],
      [-0.2, 2.24, 0.04],
      [0.2, 2.24, 0.04],
    ];
    for (const [cx, cy, cz] of curls) {
      const c = this.sph(0.105, hair);
      c.position.set(cx, cy, cz);
      c.scale.set(1, 0.92, 1);
      this.player.add(c);
    }

    // Arms — white short sleeves, black wristbands
    this.armL = this.makeLimbSmooth(0.09, 0.58, skin, 0, 0.29, 0);
    this.armR = this.makeLimbSmooth(0.09, 0.58, skin, 0, 0.29, 0);
    this.armL.position.set(-0.4, 1.68, 0);
    this.armR.position.set(0.4, 1.68, 0);
    this.player.add(this.armL, this.armR);
    for (const arm of [this.armL, this.armR]) {
      const sleeve = new THREE.Mesh(
        new THREE.CylinderGeometry(0.105, 0.1, 0.24, 10),
        tee,
      );
      sleeve.position.y = -0.13;
      arm.add(sleeve);
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, 0.07, 10),
        wrist,
      );
      band.position.set(0, -0.48, 0);
      arm.add(band);
    }

    // Silver chain from left hip to back pocket
    const chainA = new THREE.Vector3(-0.2, 0.98, 0.02);
    const chainB = new THREE.Vector3(-0.04, 0.9, 0.16);
    const chainMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.26, 6),
      chain,
    );
    chainMesh.position.copy(chainA).add(chainB).multiplyScalar(0.5);
    chainMesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      chainB.clone().sub(chainA).normalize(),
    );
    this.player.add(chainMesh);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.032, 0.009, 8, 14),
      chain,
    );
    ring.position.copy(chainA);
    this.player.add(ring);

    // Shadow blob
    this.shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 24),
      this.shadowMat,
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.02;
    this.scene.add(this.shadow);

    this.player.position.set(0, 0, PLAYER_Z);
    this.scene.add(this.player);
  }

  private buildChaser(): void {
    const skin = this.mat(SIR_COLORS.skin);
    const hair = this.mat(SIR_COLORS.hair);
    const shirt = this.mat(SIR_COLORS.shirt);
    const shirtRoll = this.mat(SIR_COLORS.shirtRoll);
    const pants = this.mat(SIR_COLORS.pants);
    const shoe = this.mat(SIR_COLORS.shoe);
    const shoeDark = this.mat(SIR_COLORS.shoeDark);
    const belt = this.mat(SIR_COLORS.belt);
    const bag = this.mat(SIR_COLORS.bag);
    const watch = this.mat(SIR_COLORS.watch);
    const book = this.mat(SIR_COLORS.book);
    const bookEdge = this.mat(SIR_COLORS.bookEdge);

    // Legs — dark trousers, white sneakers with dark accents
    this.chaserLegL = this.makeLimbSmooth(0.12, 0.86, pants, 0, 0.34, 0);
    this.chaserLegR = this.makeLimbSmooth(0.12, 0.86, pants, 0, 0.34, 0);
    this.chaserLegL.position.set(-0.15, 0.94, 0);
    this.chaserLegR.position.set(0.15, 0.94, 0);
    this.chaser.add(this.chaserLegL, this.chaserLegR);
    for (const leg of [this.chaserLegL, this.chaserLegR]) {
      const s = this.box(0.28, 0.11, 0.42, shoe);
      s.position.set(0, -0.8, 0.08);
      leg.add(s);
      const heel = this.box(0.26, 0.09, 0.09, shoeDark);
      heel.position.set(0, -0.8, 0.24);
      leg.add(heel);
      const soleM = this.box(0.3, 0.05, 0.44, shoeDark);
      soleM.position.set(0, -0.87, 0.08);
      leg.add(soleM);
    }

    // Rounded torso — white button-down shirt
    const torso = this.sph(0.31, shirt);
    torso.scale.set(1, 0.95, 0.6);
    torso.position.set(0, 1.28, 0);
    this.chaser.add(torso);

    // Brown belt + buckle
    const beltM = this.box(0.36, 0.08, 0.26, belt);
    beltM.position.set(0, 1.02, 0);
    this.chaser.add(beltM);
    const buckle = this.box(0.07, 0.07, 0.04, this.mat(0xc8ccd4));
    buckle.position.set(0, 1.02, -0.14);
    this.chaser.add(buckle);

    // Graffiti name on the back — "NISCHAY"
    const name = this.namePlate("NISCHAY", 0.52, 0.22);
    name.position.set(0, 1.3, 0.2);
    this.chaser.add(name);

    // Arms — rolled-up sleeves
    this.chaserArmL = this.makeLimbSmooth(0.08, 0.56, skin, 0, 0.28, 0);
    this.chaserArmR = this.makeLimbSmooth(0.08, 0.56, skin, 0, 0.28, 0);
    this.chaserArmL.position.set(-0.37, 1.6, 0);
    this.chaserArmR.position.set(0.37, 1.6, 0);
    this.chaser.add(this.chaserArmL, this.chaserArmR);
    for (const arm of [this.chaserArmL, this.chaserArmR]) {
      const sleeve = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.085, 0.22, 10),
        shirt,
      );
      sleeve.position.y = -0.12;
      arm.add(sleeve);
      const roll = new THREE.Mesh(
        new THREE.CylinderGeometry(0.095, 0.1, 0.08, 10),
        shirtRoll,
      );
      roll.position.y = -0.2;
      arm.add(roll);
    }

    // Black watch on the left wrist
    const watchM = new THREE.Mesh(
      new THREE.CylinderGeometry(0.095, 0.095, 0.06, 12),
      watch,
    );
    watchM.rotation.z = Math.PI / 2;
    watchM.position.set(0, -0.5, 0.02);
    this.chaserArmL.add(watchM);

    // Purple book held in the right hand
    const bookM = this.box(0.15, 0.22, 0.06, book);
    bookM.position.set(0, -0.52, -0.04);
    bookM.castShadow = false;
    this.chaserArmR.add(bookM);
    const bookEdgeM = this.box(0.16, 0.23, 0.03, bookEdge);
    bookEdgeM.position.set(0, -0.52, -0.08);
    bookEdgeM.castShadow = false;
    this.chaserArmR.add(bookEdgeM);

    // Brown messenger bag with strap across the torso
    const strap = this.box(0.07, 0.8, 0.06, bag);
    strap.position.set(0, 1.24, 0.2);
    strap.rotation.z = -0.6;
    this.chaser.add(strap);
    const bagM = this.box(0.3, 0.32, 0.12, bag);
    bagM.position.set(0.24, 1.0, 0.16);
    this.chaser.add(bagM);
    const flap = this.box(0.32, 0.12, 0.14, this.mat(0x8a5f38));
    flap.position.set(0.24, 1.12, 0.16);
    this.chaser.add(flap);

    // Head with dark curly hair
    const head = this.sph(0.23, skin);
    head.position.set(0, 1.9, 0);
    this.chaser.add(head);

    const curls: Array<[number, number, number]> = [
      [0, 2.2, 0],
      [-0.13, 2.17, 0.03],
      [0.13, 2.17, 0.03],
      [0, 2.18, -0.12],
      [-0.16, 2.08, -0.08],
      [0.16, 2.08, -0.08],
      [-0.08, 2.23, 0.08],
      [0.08, 2.23, 0.08],
      [-0.2, 2.12, 0.05],
      [0.2, 2.12, 0.05],
    ];
    for (const [cx, cy, cz] of curls) {
      const c = this.sph(0.1, hair);
      c.position.set(cx, cy, cz);
      c.scale.set(1, 0.9, 1);
      this.chaser.add(c);
    }

    // Shadow blob
    this.chaserShadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    this.chaserShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 24),
      this.chaserShadowMat,
    );
    this.chaserShadow.rotation.x = -Math.PI / 2;
    this.chaserShadow.position.y = 0.02;
    this.scene.add(this.chaserShadow);

    this.chaser.position.set(0, 0, CHASER_Z);
    this.scene.add(this.chaser);
  }

  private initEnvironment(): void {
    // Ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      this.mat(0xd8bd8e),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.06;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Track platform
    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(13.5, 0.24, 240),
      this.mat(0xc9b78f),
    );
    platform.position.set(0, 0, -80);
    platform.receiveShadow = true;
    this.scene.add(platform);

    // Rails
    const railMat = this.mat(0x9aa0a6);
    for (const rx of [-3.9, -1.3, 1.3, 3.9]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.1, 240),
        railMat,
      );
      rail.position.set(rx, 0.14, -80);
      this.scene.add(rail);
    }

    // Sleepers (recycled)
    const sleeperMat = this.mat(0x8b5e3c);
    const SLEEPER_SPACING = 2.1;
    const SLEEPER_COUNT = 120;
    for (let i = 0; i < SLEEPER_COUNT; i++) {
      const s = new THREE.Mesh(
        new THREE.BoxGeometry(2.9, 0.12, 0.5),
        sleeperMat,
      );
      s.position.set(0, 0.05, -i * SLEEPER_SPACING + 10);
      this.scene.add(s);
      this.sleepers.push(s);
    }

    // Buildings on both sides (recycled)
    const SIDE_SPACING = 9;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 16; i++) {
        this.buildings.push(
          this.makeBuilding(side * (16 + Math.random() * 8), -i * SIDE_SPACING + 14),
        );
      }
    }

    // Trees
    for (let i = 0; i < 20; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const t = this.makeTree();
      t.position.set(
        side * (9.5 + Math.random() * 3.5),
        0,
        -i * 9 - Math.random() * 4,
      );
      this.scene.add(t);
      this.trees.push(t);
    }

    // TIT Bhopal ad billboards along the track (recycled)
    for (let i = 0; i < BILLBOARD_COUNT; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      this.billboards.push(
        this.makeBillboard(
          side * (7.4 + Math.random() * 1.2),
          -i * BILLBOARD_SPACING + 12,
        ),
      );
    }

    // Clouds
    for (let i = 0; i < 8; i++) {
      const c = this.makeCloud();
      c.position.set(
        (Math.random() - 0.5) * 120,
        26 + Math.random() * 14,
        -30 - Math.random() * 120,
      );
      this.scene.add(c);
      this.clouds.push(c);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private mat(color: number): THREE.MeshLambertMaterial {
    return new THREE.MeshLambertMaterial({ color });
  }

  private sph(r: number, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), material);
    mesh.castShadow = true;
    return mesh;
  }

  private box(
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.castShadow = true;
    return mesh;
  }

  private makeLimbSmooth(
    radius: number,
    h: number,
    material: THREE.Material,
    px: number,
    py: number,
    pz: number,
  ): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(px, py, pz);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 0.82, h, 10),
      material,
    );
    mesh.position.y = -h / 2;
    mesh.castShadow = true;
    pivot.add(mesh);
    return pivot;
  }

  private makeBuilding(x: number, z: number): Building {
    const w = 6 + Math.random() * 4;
    const h = 7 + Math.random() * 10;
    const d = 6 + Math.random() * 4;
    const color = BUILDING_COLORS[
      Math.floor(Math.random() * BUILDING_COLORS.length)
    ];
    const mesh = this.box(w, h, d, this.mat(color));
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    // Window grid
    const winMat = this.mat(0xffffff);
    const windows: THREE.Mesh[] = [];
    const cols = Math.floor(w / 1.3);
    const rows = Math.floor(h / 1.6);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const win = new THREE.Mesh(
          new THREE.BoxGeometry(0.55, 0.8, 0.06),
          winMat,
        );
        win.position.set(
          -w / 2 + 1 + c * 1.3,
          -h / 2 + 1.2 + r * 1.6,
          Math.abs(x) / x * d / 2 + 0.04,
        );
        mesh.add(win);
        windows.push(win);
      }
    }

    return { mesh, windows, baseZ: z, w, h };
  }

  private getTitTexture(): THREE.CanvasTexture {
    if (this.titTexture) return this.titTexture;
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 144;
    const g = c.getContext("2d")!;
    // Navy board with orange frame — TIT Bhopal branding
    g.fillStyle = "#0e2f6d";
    g.fillRect(0, 0, 256, 144);
    g.strokeStyle = "#ff8c1a";
    g.lineWidth = 8;
    g.strokeRect(4, 4, 248, 136);
    g.fillStyle = "#ffffff";
    g.font = "bold 62px Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("TIT", 128, 64);
    g.fillStyle = "#ffb35c";
    g.font = "bold 28px Arial, sans-serif";
    g.fillText("BHOPAL", 128, 112);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.titTexture = tex;
    return tex;
  }

  private makeBillboard(x: number, z: number): Billboard {
    const group = new THREE.Group();
    const boardMat = new THREE.MeshLambertMaterial({
      map: this.getTitTexture(),
    });
    const board = this.box(3.6, 2.0, 0.12, boardMat);
    board.position.y = 2.7;
    board.castShadow = true;
    group.add(board);

    const frameMat = this.mat(0xffffff);
    const top = this.box(3.72, 0.16, 0.14, frameMat);
    top.position.y = 3.78;
    group.add(top);
    const bottom = this.box(3.72, 0.16, 0.14, frameMat);
    bottom.position.y = 1.62;
    group.add(bottom);
    for (const sx of [-1, 1]) {
      const side = this.box(0.16, 2.32, 0.14, frameMat);
      side.position.set(sx * 1.78, 2.7, 0);
      group.add(side);
    }

    const legMat = this.mat(0x4b5563);
    for (const lx of [-1, 1]) {
      const leg = this.box(0.14, 2.6, 0.14, legMat);
      leg.position.set(lx * 1.3, 1.3, 0);
      group.add(leg);
    }

    group.position.set(x, 0, z);
    this.scene.add(group);
    return { group, board, baseZ: z };
  }

  private makeTree(): THREE.Group {
    const g = new THREE.Group();
    const trunk = this.box(0.5, 1.6, 0.5, this.mat(0x8a5a2b));
    trunk.position.y = 0.8;
    g.add(trunk);
    for (let i = 0; i < 3; i++) {
      const leaf = new THREE.Mesh(
        new THREE.ConeGeometry(1.4 - i * 0.35, 1.4, 8),
        this.mat(i === 0 ? 0x2f9e44 : 0x37b24d),
      );
      leaf.position.y = 2 + i * 0.9;
      leaf.castShadow = true;
      g.add(leaf);
    }
    return g;
  }

  private makeCloud(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
    });
    for (let i = 0; i < 4; i++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(1.6 + Math.random() * 1.2, 10, 8),
        mat,
      );
      puff.position.set(i * 1.8 - 2.7, Math.random() * 0.8, (Math.random() - 0.5) * 1.4);
      puff.scale.y = 0.6;
      g.add(puff);
    }
    return g;
  }

  // ── Public controls ─────────────────────────────────────────────────

  start(): void {
    if (this.phase === "running") return;
    // Reset state
    this.phase = "running";
    this.score = 0;
    this.coinsCount = 0;
    this.speed = BASE_SPEED;
    this.lane = 1;
    this.x = 0;
    this.prevX = 0;
    this.camX = 0;
    this.jumpY = 0;
    this.vy = 0;
    this.onGround = true;
    this.slideTimer = 0;
    this.distSinceSpawn = 0;
    this.distSinceCoin = 0;
    this.nextGap = 14;
    this.lastSpawnWasTrain = false;
    this.shake = 0;
    this.collisionCount = 0;
    this.collisionCooldown = 0;
    this.chaseTimer = 0;
    this.chaserTargetZ = CHASER_Z;
    this.knockT = 0;

    for (const o of this.obstacles) {
      this.scene.remove(o.group);
      this.disposeGroup(o.group);
    }
    for (const c of this.coins) {
      this.scene.remove(c.mesh);
      c.mesh.geometry.dispose();
    }
    for (const p of this.particles) {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
    }
    this.obstacles = [];
    this.coins = [];
    this.particles = [];

    this.player.rotation.set(0, 0, 0);
    this.player.position.set(0, 0, PLAYER_Z);
    this.player.scale.set(1, 1, 1);
    this.player.visible = true;
    this.shadow.visible = true;

    // Reset the chaser
    this.chaser.position.set(0, 0, CHASER_Z);
    this.chaser.rotation.set(0, 0, 0);
    this.chaser.scale.set(1, 1, 1);
    this.chaserCatchT = 1;
    this.chaserShadow.visible = true;

    // Reset camera + FOV
    this.camera.position.set(0, 4.5, 7.2);
    this.camera.fov = 62;
    this.camera.updateProjectionMatrix();

    this.emitScore();
  }

  jump(): void {
    if (this.phase !== "running") return;
    if (!this.onGround) return;
    this.slideTimer = 0; // jumping pops you out of a slide
    this.vy = JUMP_V;
    this.onGround = false;
  }

  slide(): void {
    if (this.phase !== "running") return;
    if (this.slideTimer > 0) return;
    this.slideTimer = this.slideDuration;
  }

  moveLeft(): void {
    if (this.phase !== "running") return;
    if (this.lane > 0) this.lane--;
  }

  moveRight(): void {
    if (this.phase !== "running") return;
    if (this.lane < 2) this.lane++;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.handleKey);
    this.resizeObserver?.disconnect();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  // ── Loop ────────────────────────────────────────────────────────────

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.phase === "running") {
      this.updateGame(dt);
    } else {
      this.updateAmbient(dt);
    }

    this.renderer.render(this.scene, this.camera);
  };

  private updateAmbient(dt: number): void {
    this.runPhase += dt * 6;
    this.animateRunCycle();
    for (const c of this.coins) {
      c.mesh.rotation.y += dt * 2.5;
    }
    for (const cl of this.clouds) {
      cl.position.z += dt * 1.2;
      if (cl.position.z > 40) cl.position.z -= 160;
    }

    if (this.phase === "ready") {
      // Nischay Sir idles right behind Gokul on the start screen
      this.chaser.position.set(0, 0, CHASER_Z);
      this.chaser.rotation.x = 0;
      this.chaser.scale.y = 1;
      this.chaserArmL.rotation.x = 0.25;
      this.chaserArmR.rotation.x = 0.25;
      this.chaserLegL.rotation.x = 0.08;
      this.chaserLegR.rotation.x = -0.08;
      this.chaserShadow.position.set(
        this.chaser.position.x,
        0.02,
        this.chaser.position.z,
      );
      this.chaserShadow.scale.set(1, 1, 1);
    } else if (this.chaserCatchT < 1) {
      // Caught! Nischay Sir sprints to the spot and celebrates
      this.chaserCatchT = Math.min(1, this.chaserCatchT + dt * 2.2);
      const t = this.chaserCatchT;
      const e = t * t * (3 - 2 * t);
      this.chaser.position.x = this.x + (this.player.position.x - this.x) * e;
      this.chaser.position.z = CHASER_Z - CHASER_Z * e;
      this.chaser.position.y = Math.abs(Math.sin(t * Math.PI * 2)) * 0.1;
      this.chaser.rotation.x = 0;
      this.chaser.scale.y = 1;
      this.chaserArmL.rotation.x = Math.PI;
      this.chaserArmR.rotation.x = Math.PI;
      this.chaserLegL.rotation.x = 0.5;
      this.chaserLegR.rotation.x = 0.5;
      this.chaserShadow.position.set(
        this.chaser.position.x,
        0.02,
        this.chaser.position.z,
      );
    }
  }

  private updateGame(dt: number): void {
    // Speed up — recovers faster after a knock so the hit doesn't feel unfair
    const accel = this.knockT > 0 ? ACCEL * 3.2 : ACCEL;
    this.speed = Math.min(MAX_SPEED, this.speed + accel * dt);
    const move = this.speed * dt;
    this.worldZ += move;

    // Score
    this.score = Math.floor(this.worldZ / 8) + this.coinsCount * 10;
    this.emitScore();

    // Lane movement
    const targetX = LANE_X[this.lane];
    const dx = targetX - this.x;
    this.x += dx * Math.min(1, dt * 9);
    if (Math.abs(dx) < 0.001) this.x = targetX;

    // Jump physics
    if (!this.onGround) {
      this.jumpY += this.vy * dt;
      this.vy -= GRAVITY * dt;
      if (this.jumpY <= 0) {
        this.jumpY = 0;
        this.vy = 0;
        this.onGround = true;
      }
    }

    // Slide
    if (this.slideTimer > 0) this.slideTimer -= dt;

    // Chase clock: Sir pursues hard for CHASE_FULL_TIME, then gradually
    // falls back so the player gets a breather. A hit restarts the clock.
    this.chaseTimer += dt;
    if (this.collisionCooldown > 0) this.collisionCooldown -= dt;
    if (this.knockT > 0) this.knockT -= dt;

    let chaserZTarget = CHASER_Z;
    if (this.knockT > 0) {
      chaserZTarget = CHASER_Z - 0.35; // Sir dives right in on a hit
    } else if (this.chaseTimer > CHASE_FULL_TIME) {
      chaserZTarget = Math.min(
        CHASE_RELIEF_Z,
        CHASER_Z + (this.chaseTimer - CHASE_FULL_TIME) * CHASE_FALLBACK,
      );
    }
    const chaserLerp = this.knockT > 0 ? 12 : 3;
    this.chaserTargetZ +=
      (chaserZTarget - this.chaserTargetZ) * Math.min(1, dt * chaserLerp);

    // Player visual state
    this.runPhase += dt * this.speed;
    this.animatePose();

    const sliding = this.slideTimer > 0;
    const slideT = sliding
      ? Math.max(0, Math.min(1, this.slideTimer / this.slideDuration))
      : 0;
    const slideProgress = sliding ? 1 - slideT : 0; // 0 → 1 over the slide

    // Lean into lane changes
    const xVel = (this.x - this.prevX) / Math.max(dt, 1e-4);
    this.prevX = this.x;
    const lean = Math.max(-0.22, Math.min(0.22, xVel * 0.05));

    // Forward tumble + squat for the slide
    const TUCK_IN = 0.3;
    const TUCK_HOLD = 0.72;
    let pitch = 0;
    let squash = 1;
    if (sliding) {
      if (slideProgress < TUCK_IN) {
        const t = slideProgress / TUCK_IN;
        pitch = -1.15 * t;
        squash = 1 - 0.22 * t;
      } else if (slideProgress < TUCK_HOLD) {
        pitch = -1.15;
        squash = 0.78;
      } else {
        const t = (slideProgress - TUCK_HOLD) / (1 - TUCK_HOLD);
        pitch = -1.15 * (1 - t);
        squash = 0.78 + 0.22 * t;
      }
    }

    const stumble = this.knockT > 0 ? Math.sin(this.knockT * 28) * 0.14 : 0;
    this.player.position.x = this.x;
    this.player.position.y = this.jumpY;
    this.player.rotation.x = pitch;
    this.player.rotation.y = 0;
    this.player.rotation.z = (sliding ? lean * 0.4 : lean) + stumble;
    this.player.scale.y = squash;

    this.shadow.position.x = this.x;
    const shadowScale = Math.max(0.45, 1 - this.jumpY * 0.055);
    this.shadow.scale.set(shadowScale, shadowScale, 1);
    this.shadowMat.opacity = 0.28 - this.jumpY * 0.02;

    // Nischay Sir keeps pace right behind, mirroring Gokul
    this.chaser.position.x = this.x;
    this.chaser.position.z = this.chaserTargetZ;
    this.chaser.position.y = this.onGround ? 0 : this.jumpY * 0.95;
    if (sliding) {
      this.chaser.rotation.x = -0.6;
      this.chaser.scale.y = 0.85;
      this.chaserLegL.rotation.x = 1.3;
      this.chaserLegR.rotation.x = 1.3;
      this.chaserArmL.rotation.x = 0.8;
      this.chaserArmR.rotation.x = 0.8;
    } else if (!this.onGround) {
      this.chaser.rotation.x = 0;
      this.chaser.scale.y = 1;
      this.chaserLegL.rotation.x = 1.5;
      this.chaserLegR.rotation.x = 1.5;
      this.chaserArmL.rotation.x = 1.6;
      this.chaserArmR.rotation.x = 1.6;
    } else {
      this.chaser.rotation.x = 0;
      this.chaser.scale.y = 1;
      const cSwing = Math.sin(this.runPhase * 0.9 + Math.PI) * 0.85;
      this.chaserLegL.rotation.x = cSwing;
      this.chaserLegR.rotation.x = -cSwing;
      this.chaserArmL.rotation.x = -cSwing * 0.8;
      this.chaserArmR.rotation.x = cSwing * 0.8;
    }
    this.chaserShadow.position.set(this.x, 0.02, this.chaser.position.z);
    const chScale = Math.max(0.5, 1 - this.jumpY * 0.05);
    this.chaserShadow.scale.set(chScale, chScale, 1);

    // Sun follows player for consistent shadows
    this.sun.position.set(this.x + 18, 30, PLAYER_Z + 12);
    this.sun.target.position.set(this.x, 0, PLAYER_Z - 20);

    // Move world
    for (const s of this.sleepers) {
      s.position.z += move;
      if (s.position.z > DESPAWN_Z) s.position.z -= 120 * 2.1;
    }
    for (const b of this.buildings) {
      b.mesh.position.z += move;
      if (b.mesh.position.z > DESPAWN_Z + 20) {
        b.mesh.position.z -= 16 * 9;
        b.mesh.position.y = b.h / 2;
      }
    }
    for (const t of this.trees) {
      t.position.z += move;
      if (t.position.z > DESPAWN_Z) t.position.z -= 20 * 9;
    }
    for (const b of this.billboards) {
      b.group.position.z += move;
      if (b.group.position.z > DESPAWN_Z + 10) {
        b.group.position.z -= BILLBOARD_COUNT * BILLBOARD_SPACING;
      }
    }
    for (const cl of this.clouds) {
      cl.position.z += dt * 1.4;
      if (cl.position.z > 40) cl.position.z -= 160;
    }

    // Move obstacles + coins, check collisions
    this.moveEntities(dt);

    // Spawn
    this.spawnObstacles(dt);
    this.spawnCoins(dt);

    // Particles
    this.updateParticles(dt);

    // Chase camera gently follows the player's lane
    const targetCamX = this.x * 0.55;
    this.camX += (targetCamX - this.camX) * Math.min(1, dt * 5);
    this.camera.position.z = 7.2;

    // Camera shake on crash
    if (this.shake > 0) {
      this.shake -= dt;
      this.camera.position.x = this.camX + (Math.random() - 0.5) * 0.35;
      this.camera.position.y = 4.5 + (Math.random() - 0.5) * 0.3;
    } else {
      this.camera.position.x = this.camX;
      this.camera.position.y = 4.5;
    }
    this.camera.lookAt(this.camX, 1.0, -12);

    // FOV widens slightly with speed for a rush of speed
    const targetFov =
      62 + ((this.speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED)) * 5;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 2.5);
      this.camera.updateProjectionMatrix();
    }
  }

  private moveEntities(dt: number): void {
    const move = this.speed * dt;

    for (const o of this.obstacles) {
      o.z += move;
      o.group.position.z = o.z;
    }
    for (const c of this.coins) {
      c.z += move;
      c.mesh.position.z = c.z;
      c.mesh.rotation.y += dt * 3;
      c.mesh.position.y = 1.05 + Math.sin(c.phase + this.worldZ * 0.05) * 0.12;
    }

    // Player hitbox
    const sliding = this.slideTimer > 0;
    const pw = 0.8;
    const ph = sliding ? 0.85 : 1.75;
    const pBottom = this.jumpY;
    const pTop = pBottom + ph;

    // Obstacle collision
    for (const o of this.obstacles) {
      if (o.hit) continue;
      if (o.z > 3 || o.z < -4) continue;

      const ox = LANE_X[o.lane];
      if (Math.abs(this.x - ox) > (pw + o.w) / 2) continue;

      if (o.kind === "overhead") {
        // Gate beam hangs between 1.3 and 1.8 — slide under it
        if (pTop > 1.3 && pBottom < 1.8) {
          this.onObstacleHit(o);
          return;
        }
      } else if (pTop > 0 && pBottom < o.h) {
        this.onObstacleHit(o);
        return;
      }
    }

    // Coin collection
    for (const c of this.coins) {
      if (c.taken) continue;
      if (Math.abs(c.z - PLAYER_Z) > 1.4) continue;
      const cx = LANE_X[c.lane];
      if (Math.abs(this.x - cx) > 1.05) continue;
      if (this.jumpY > 2.2) continue; // coins are low, skip when high in air
      c.taken = true;
      c.mesh.visible = false;
      this.coinsCount++;
      this.burstCoins(cx, 1.1, c.z);
      this.emitScore();
    }

    // Recycle obstacles and coins that have passed the player
    this.obstacles = this.obstacles.filter((o) => {
      if (o.z > DESPAWN_Z) {
        this.scene.remove(o.group);
        this.disposeGroup(o.group);
        return false;
      }
      return true;
    });
    this.coins = this.coins.filter((c) => {
      if (c.taken || c.z > DESPAWN_Z) {
        this.scene.remove(c.mesh);
        c.mesh.geometry.dispose();
        return false;
      }
      return true;
    });
  }

  private spawnObstacles(dt: number): void {
    this.distSinceSpawn += this.speed * dt;
    const warm = this.worldZ > WARMUP * BASE_SPEED;
    if (!warm || this.distSinceSpawn < this.nextGap) return;

    this.distSinceSpawn = 0;
    // Gap shrinks with speed for rising difficulty
    const gap = Math.max(16, 30 - (this.speed - BASE_SPEED) * 0.55);
    this.nextGap = gap + Math.random() * 7;

    const roll = Math.random();
    let kind: ObstacleKind;
    if (this.lastSpawnWasTrain && roll < 0.5) {
      kind = roll < 0.25 ? "barrier" : "overhead";
    } else {
      kind = roll < 0.4 ? "train" : roll < 0.72 ? "barrier" : "overhead";
    }

    if (kind === "train") {
      const lane = Math.floor(Math.random() * 3);
      this.spawnObstacle(kind, lane);
      // Occasionally block two lanes
      if (Math.random() < 0.35) {
        const other = (lane + (Math.random() < 0.5 ? 1 : 2)) % 3;
        this.spawnObstacle("train", other, -3.5);
      }
      this.lastSpawnWasTrain = true;
    } else if (kind === "barrier") {
      const free = Math.floor(Math.random() * 3);
      const lanesToFill = Math.random() < 0.45 ? 2 : 1;
      for (let l = 0; l < 3; l++) {
        if (l !== free && (lanesToFill === 2 || l === free)) {
          this.spawnObstacle("barrier", l);
        }
      }
      // 1-lane case fills one random non-free lane
      if (lanesToFill === 1) {
        const pick = free === 0 ? 1 : free === 2 ? 1 : Math.random() < 0.5 ? 0 : 2;
        this.spawnObstacle("barrier", pick);
      }
      this.lastSpawnWasTrain = false;
    } else {
      const free = Math.floor(Math.random() * 3);
      this.spawnObstacle("overhead", free);
      if (Math.random() < 0.3) {
        const other = (free + 1) % 3;
        this.spawnObstacle("overhead", other, -3.5);
      }
      this.lastSpawnWasTrain = false;
    }
  }

  private spawnObstacle(
    kind: ObstacleKind,
    lane: number,
    zOffset = 0,
  ): void {
    const group = new THREE.Group();
    let w = 1.5;
    let h = 1.1;
    let d = 0.4;

    if (kind === "train") {
      w = 2.3;
      h = 3.3;
      d = 6.5;
      const color =
        TRAIN_COLORS[Math.floor(Math.random() * TRAIN_COLORS.length)];
      const body = this.box(w, 2.5, d, this.mat(color));
      body.position.y = 1.35;
      body.castShadow = true;
      group.add(body);

      const roof = this.box(w * 0.92, 0.35, d * 0.94, this.mat(0xdadfe3));
      roof.position.y = 2.75;
      group.add(roof);

      const stripe = this.box(w + 0.06, 0.28, d + 0.06, this.mat(0xfff2d0));
      stripe.position.y = 0.55;
      group.add(stripe);

      const winMat = this.mat(0x9ad0f5);
      for (let i = 0; i < 3; i++) {
        const win = this.box(w * 0.72, 1.0, 0.08, winMat);
        win.position.set(0, 1.9, -d / 2 + 1 + i * 1.8);
        group.add(win);
        const win2 = win.clone();
        win2.position.z = d / 2 - 1 - i * 1.8;
        group.add(win2);
      }

      // Wheels
      const wheelMat = this.mat(0x2b2b2b);
      for (let i = 0; i < 4; i++) {
        for (const sx of [-1, 1]) {
          const wheel = new THREE.Mesh(
            new THREE.CylinderGeometry(0.42, 0.42, 0.18, 12),
            wheelMat,
          );
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(
            sx * (w / 2 + 0.12),
            0.42,
            -2.4 + i * 1.6,
          );
          group.add(wheel);
        }
      }
    } else if (kind === "barrier") {
      const bar = this.box(w, 0.55, 0.35, this.mat(0xf59f00));
      bar.position.y = 0.6;
      group.add(bar);
      // Stripes
      const stripeMat = this.mat(0xffffff);
      for (let i = 0; i < 3; i++) {
        const st = this.box(0.3, 0.55, 0.37, stripeMat);
        st.position.set(-0.45 + i * 0.45, 0.6, 0);
        group.add(st);
      }
      // Legs
      const legMat = this.mat(0x8a5a2b);
      for (const lx of [-1, 1]) {
        const leg = this.box(0.12, 0.62, 0.12, legMat);
        leg.position.set(lx * (w / 2 - 0.08), 0.31, 0);
        group.add(leg);
      }
    } else {
      // Overhead gate: two posts + beam to slide under
      w = 1.9;
      h = 1.35;
      d = 0.4;
      const beam = this.box(w + 0.6, 0.5, 0.35, this.mat(0xf08c00));
      beam.position.y = 1.55;
      beam.castShadow = true;
      group.add(beam);
      const sign = this.box(w + 0.2, 0.35, 0.3, this.mat(0xffffff));
      sign.position.y = 1.55;
      group.add(sign);
      const stripe = this.box(0.4, 0.35, 0.32, this.mat(0xf03e3e));
      stripe.position.y = 1.55;
      group.add(stripe);
      const postMat = this.mat(0x6c6f75);
      for (const lx of [-1, 1]) {
        const post = this.box(0.16, 1.8, 0.16, postMat);
        post.position.set(lx * (w / 2 + 0.5), 0.9, 0);
        group.add(post);
      }
    }

    group.position.set(LANE_X[lane], 0, SPAWN_Z + zOffset);
    this.scene.add(group);

    this.obstacles.push({ group, kind, lane, z: SPAWN_Z + zOffset, w, h, d, hit: false });
  }

  private spawnCoins(dt: number): void {
    this.distSinceCoin += this.speed * dt;
    if (this.distSinceCoin < 7 + Math.random() * 3) return;
    this.distSinceCoin = 0;

    const lane = Math.floor(Math.random() * 3);
    // Avoid placing coins right on top of a freshly spawned obstacle
    const blocked = this.obstacles.some(
      (o) => o.lane === lane && o.z < -10 && o.z > -30,
    );
    if (blocked) return;

    const count = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const coin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.28, 0.09, 20),
        new THREE.MeshLambertMaterial({
          color: 0xffc300,
          emissive: 0x664d00,
        }),
      );
      coin.rotation.x = Math.PI / 2;
      coin.position.set(LANE_X[lane], 1.05, SPAWN_Z - i * 2.4);
      this.scene.add(coin);
      this.coins.push({
        mesh: coin,
        lane,
        z: SPAWN_Z - i * 2.4,
        taken: false,
        phase: i * 0.7,
      });
    }
  }

  private burstCoins(x: number, y: number, z: number): void {
    const mat = new THREE.MeshLambertMaterial({
      color: 0xffd43b,
      emissive: 0x664d00,
    });
    for (let i = 0; i < 10; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), mat);
      p.position.set(x, y, z);
      this.scene.add(p);
      this.particles.push({
        mesh: p,
        vx: (Math.random() - 0.5) * 5,
        vy: 2 + Math.random() * 4,
        vz: (Math.random() - 0.5) * 5,
        life: 0.7 + Math.random() * 0.3,
      });
    }
  }

  private onObstacleHit(o: Obstacle): void {
    o.hit = true;
    // Cooldown stops the same crash from counting multiple times
    if (this.collisionCooldown > 0) return;

    this.collisionCooldown = COLLISION_COOLDOWN;
    this.collisionCount++;
    this.knockT = 0.9;
    this.speed = Math.max(BASE_SPEED, this.speed * 0.45);
    this.chaseTimer = 0; // Sir dashes close and the pursuit restarts
    this.shake = 0.3;
    this.burstHit();

    if (this.collisionCount >= STRIKES_TO_CAUGHT) {
      this.caught();
    } else {
      this.emitScore(); // reflect the new strike in the HUD
    }
  }

  private burstHit(): void {
    const colors = [GOKUL_COLORS.tee, GOKUL_COLORS.pants, GOKUL_COLORS.skin];
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshLambertMaterial({
        color: colors[i % colors.length],
      });
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), mat);
      p.position.copy(this.player.position);
      this.scene.add(p);
      this.particles.push({
        mesh: p,
        vx: (Math.random() - 0.5) * 8,
        vy: 2 + Math.random() * 4,
        vz: (Math.random() - 0.5) * 6,
        life: 0.6 + Math.random() * 0.35,
      });
    }
  }

  private caught(): void {
    this.phase = "over";
    this.shake = 0.45;
    this.chaserTargetZ = CHASER_Z;
    this.chaser.position.z = CHASER_Z;

    // Gokul trips — a burst of stars
    const colors = [
      GOKUL_COLORS.tee,
      GOKUL_COLORS.pants,
      GOKUL_COLORS.skin,
      GOKUL_COLORS.hair,
    ];
    for (let i = 0; i < 26; i++) {
      const mat = new THREE.MeshLambertMaterial({
        color: colors[i % colors.length],
      });
      const p = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.22, 0.22),
        mat,
      );
      p.position.copy(this.player.position);
      this.scene.add(p);
      this.particles.push({
        mesh: p,
        vx: (Math.random() - 0.5) * 10,
        vy: 2 + Math.random() * 6,
        vz: (Math.random() - 0.5) * 8,
        life: 1.1 + Math.random() * 0.6,
      });
    }
    this.player.visible = false;
    this.shadow.visible = false;

    // Nischay Sir lunges in to catch him
    this.chaserCatchT = 0;

    // Save high score
    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem(HIGH_SCORE_KEY, String(this.highScore));
    }
    this.callbacks.onGameOver(this.score, this.coinsCount, this.highScore);
  }

  private updateParticles(dt: number): void {
    const alive: Particle[] = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        continue;
      }
      p.vy -= GRAVITY * 0.55 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      if (p.mesh.position.y < 0.1) {
        p.mesh.position.y = 0.1;
        p.vy *= -0.4;
        p.vx *= 0.8;
        p.vz *= 0.8;
      }
      p.mesh.rotation.x += dt * 6;
      p.mesh.rotation.y += dt * 5;
      alive.push(p);
    }
    this.particles = alive;
  }

  private animateRunCycle(): void {
    const swing = this.phase === "running"
      ? Math.sin(this.runPhase * 0.9) * 0.9
      : Math.sin(this.runPhase * 0.9) * 0.12;

    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.85;
    this.armR.rotation.x = swing * 0.85;

    const bob = this.phase === "running"
      ? Math.abs(Math.sin(this.runPhase * 0.9)) * 0.08
      : 0;
    this.player.position.y = this.jumpY + bob;
  }

  private animatePose(): void {
    const sliding = this.slideTimer > 0;
    const airborne = !this.onGround;

    if (sliding) {
      // Tucked roll: knees up, arms braced forward
      this.legL.rotation.x = 1.4;
      this.legR.rotation.x = 1.4;
      this.armL.rotation.x = 1.15;
      this.armR.rotation.x = 1.15;
      return;
    }
    if (airborne) {
      // Jump: tuck the legs, pump the arms
      this.legL.rotation.x = 1.55;
      this.legR.rotation.x = 1.55;
      this.armL.rotation.x = 2.4;
      this.armR.rotation.x = 2.4;
      return;
    }
    const swing = Math.sin(this.runPhase * 0.9) * 0.9;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.85;
    this.armR.rotation.x = swing * 0.85;
  }

  private emitScore(): void {
    const heat = Math.max(
      0,
      Math.min(
        1,
        1 - (this.chaserTargetZ - CHASER_Z) / (CHASE_RELIEF_Z - CHASER_Z),
      ),
    );
    this.callbacks.onScore(this.score, this.coinsCount, this.highScore, {
      strikes: this.collisionCount,
      heat,
      chasing: heat > 0.55,
    });
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
      else if (m) m.dispose();
    });
  }

  private initEvents(): void {
    window.addEventListener("keydown", this.handleKey);
  }

  private handleKey = (e: KeyboardEvent): void => {
    if (this.phase === "ready") return;
    switch (e.key) {
      case "ArrowLeft":
      case "a":
      case "A":
        e.preventDefault();
        this.moveLeft();
        break;
      case "ArrowRight":
      case "d":
      case "D":
        e.preventDefault();
        this.moveRight();
        break;
      case "ArrowUp":
      case "w":
      case "W":
        e.preventDefault();
        this.jump();
        break;
      case "ArrowDown":
      case "s":
      case "S":
        e.preventDefault();
        this.slide();
        break;
      case " ":
        e.preventDefault();
        this.jump();
        break;
    }
  };
}
