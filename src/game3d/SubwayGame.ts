// 3D Gokul Runner — a Three.js endless runner inspired by Subway Surfers.
// Gokul, an engineering student at TIT Bhopal, is running from Nischay Sir
// through the campus railway yard: dodge trains, jump barriers, slide under
// gates, and grab coins before Sir catches up.
//
// Characters are fully rigged, procedurally-built 3D models with stylized
// proportions, detailed faces, structured curly hair, layered clothing and
// PBR-style materials — built from primitives so they load instantly and
// stay mobile-friendly (no GLB downloads, no skinning, minimal draw calls).

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
  hairHi: 0x2e2e34,
  tee: 0xfdfdfb,
  inner: 0x141416,
  pants: 0x3a4048,
  cuff: 0x4a5058,
  shoe: 0xffffff,
  shoeRed: 0xd64545,
  sole: 0x2b2b2b,
  sock: 0xf5f5f5,
  wristband: 0x141416,
  chain: 0xd8dbe2,
  brow: 0x2a2a30,
  mouth: 0x9c3b34,
};

// Nischay Sir — white button-down, dark trousers, belt, messenger bag
const SIR_COLORS = {
  skin: 0xf0b58a,
  hair: 0x23262e,
  hairHi: 0x4a4f5a,
  shirt: 0xf4f6f9,
  shirtRoll: 0xdde3ea,
  tie: 0x1f3a5f,
  pants: 0x2f3542,
  belt: 0x5f4630,
  buckle: 0xd8dbe2,
  shoe: 0xffffff,
  shoeDark: 0x2e3338,
  sole: 0x22262a,
  bag: 0x6e4a2e,
  bagFlap: 0x7d5636,
  strap: 0x5a3d26,
  watch: 0x2b2b2f,
  watchFace: 0xe8ecf2,
  book: 0x7b2fbe,
  bookEdge: 0x9a5fd8,
  glasses: 0x2b2f36,
  brow: 0x2a2d35,
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

// Rigged character — a hierarchy of pivots that let us animate hips, knees,
// shoulders, elbows, torso lean and head motion like a lightweight skeleton.
interface CharacterRig {
  root: THREE.Group; // positioned at the feet
  hips: THREE.Group; // hip height — holds legs + chest
  chest: THREE.Group; // torso — holds arms, head, name plate
  head: THREE.Group; // neck pivot
  hair: THREE.Group; // separate so it can sway independently
  legL: THREE.Group;
  legR: THREE.Group;
  legLowerL: THREE.Group; // knee pivots
  legLowerR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  armLowerL: THREE.Group; // elbow pivots
  armLowerR: THREE.Group;
  chain?: THREE.Group; // Gokul
  bag?: THREE.Group; // Nischay
}

interface RigPose {
  hipL: number;
  hipR: number;
  kneeL: number;
  kneeR: number;
  shL: number;
  shR: number;
  elL: number;
  elR: number;
  torsoX: number;
  torsoZ: number;
  headX: number;
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
  private playerRig!: CharacterRig;
  private shadow!: THREE.Mesh;
  private shadowMat!: THREE.MeshBasicMaterial;

  // Nischay Sir (chaser)
  private chaser = new THREE.Group();
  private chaserRig!: CharacterRig;
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
  private ambientT = 0;

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

  // Shared geometry for the character meshes (fewer allocations)
  private geoBox = new THREE.BoxGeometry(1, 1, 1);
  private geoSph = new THREE.SphereGeometry(1, 22, 16);
  private pmatCache = new Map<string, THREE.MeshStandardMaterial>();

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
    // Filmic tone mapping + sRGB gives materials a rich, premium look
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
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

    // Lights — key + fill + rim so the characters read as part of the world
    const hemi = new THREE.HemisphereLight(0xfff6e0, 0x9c7c58, 1.15);
    this.scene.add(hemi);

    this.sun = new THREE.DirectionalLight(0xfff4d8, 1.55);
    this.sun.position.set(16, 26, 10);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 70;
    this.sun.shadow.camera.left = -11;
    this.sun.shadow.camera.right = 11;
    this.sun.shadow.camera.top = 11;
    this.sun.shadow.camera.bottom = -11;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Cool fill from the opposite side — softens the key light
    const fill = new THREE.DirectionalLight(0xa8c8ff, 0.5);
    fill.position.set(-14, 6, 8);
    this.scene.add(fill);

    // Warm rim from ahead of the runners — lights their backs so the
    // silhouettes pop against the environment
    const rim = new THREE.DirectionalLight(0xffe8c0, 0.9);
    rim.position.set(5, 9, -18);
    this.scene.add(rim);

    // Sun disc
    const sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(4, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff3b0 }),
    );
    sunDisc.position.set(-60, 60, -220);
    this.scene.add(sunDisc);
  }

  private makeNameTexture(text: string, fontPx: number): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 256;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, 512, 256);
    g.font = `italic 900 ${fontPx}px 'Arial Black', Arial, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    g.save();
    g.translate(256, 116);
    g.rotate(-0.05);
    // Soft drop shadow for depth, then the graffiti fill + outline
    g.fillStyle = "rgba(0,0,0,0.28)";
    g.fillText(text, 4, 6);
    g.strokeStyle = "#111111";
    g.lineWidth = 14;
    g.strokeText(text, 0, 0);
    g.fillStyle = "#141414";
    g.fillText(text, 0, 0);
    g.restore();
    // Paint drips
    g.fillStyle = "#141414";
    const half = g.measureText(text).width / 2;
    g.fillRect(256 - half + 30, 192, 6, 32);
    g.fillRect(256 + 26, 198, 6, 26);
    g.fillRect(256 + half - 40, 190, 6, 30);
    g.fillRect(256 - 8, 202, 5, 20);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private namePlate(text: string, w: number, h: number, fontPx = 120): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      this.pmat(0xffffff, {
        map: this.makeNameTexture(text, fontPx),
        transparent: true,
      }),
    );
    mesh.castShadow = false;
    return mesh;
  }

  // ── Character rig helpers ───────────────────────────────────────────

  private rigBase(shoulderX: number): CharacterRig {
    const root = new THREE.Group();
    const hips = new THREE.Group();
    hips.position.set(0, 1.02, 0);
    root.add(hips);
    const chest = new THREE.Group();
    chest.position.set(0, 0.34, 0);
    hips.add(chest);
    const head = new THREE.Group();
    head.position.set(0, 0.62, 0);
    chest.add(head);
    const hair = new THREE.Group();
    hair.position.set(0, 0.03, 0.02);
    head.add(hair);

    const legL = new THREE.Group();
    legL.position.set(-0.17, 0, 0.02);
    const legR = new THREE.Group();
    legR.position.set(0.17, 0, 0.02);
    hips.add(legL, legR);
    const legLowerL = new THREE.Group();
    legLowerL.position.set(0, -0.5, 0);
    const legLowerR = new THREE.Group();
    legLowerR.position.set(0, -0.5, 0);
    legL.add(legLowerL);
    legR.add(legLowerR);

    const armL = new THREE.Group();
    armL.position.set(-shoulderX, 0.36, 0);
    const armR = new THREE.Group();
    armR.position.set(shoulderX, 0.36, 0);
    chest.add(armL, armR);
    const armLowerL = new THREE.Group();
    armLowerL.position.set(0, -0.32, 0);
    const armLowerR = new THREE.Group();
    armLowerR.position.set(0, -0.32, 0);
    armL.add(armLowerL);
    armR.add(armLowerR);

    return {
      root,
      hips,
      chest,
      head,
      hair,
      legL,
      legR,
      legLowerL,
      legLowerR,
      armL,
      armR,
      armLowerL,
      armLowerR,
    };
  }

  private buildGokul(): CharacterRig {
    const rig = this.rigBase(0.46);
    const skin = this.pmat(GOKUL_COLORS.skin, { roughness: 0.6 });
    const hair = this.pmat(GOKUL_COLORS.hair, { roughness: 0.85 });
    const hairHi = this.pmat(GOKUL_COLORS.hairHi, { roughness: 0.75 });
    const tee = this.pmat(GOKUL_COLORS.tee, { roughness: 0.92 });
    const inner = this.pmat(GOKUL_COLORS.inner, { roughness: 0.9 });
    const pants = this.pmat(GOKUL_COLORS.pants, { roughness: 0.85 });
    const cuff = this.pmat(GOKUL_COLORS.cuff, { roughness: 0.85 });
    const shoe = this.pmat(GOKUL_COLORS.shoe, { roughness: 0.45 });
    const shoeRed = this.pmat(GOKUL_COLORS.shoeRed, { roughness: 0.5 });
    const sole = this.pmat(GOKUL_COLORS.sole, { roughness: 0.4 });
    const sock = this.pmat(GOKUL_COLORS.sock, { roughness: 0.8 });
    const wrist = this.pmat(GOKUL_COLORS.wristband, { roughness: 0.75 });
    const chain = this.pmat(GOKUL_COLORS.chain, { roughness: 0.2, metalness: 0.95 });
    const brow = this.pmat(GOKUL_COLORS.brow, { roughness: 0.8 });

    // Pelvis + cargo pants
    const pelvis = this.box(0.36, 0.3, 0.26, pants);
    pelvis.position.set(0, 0.02, 0.01);
    rig.hips.add(pelvis);

    for (const side of [-1, 1] as const) {
      const leg = side < 0 ? rig.legL : rig.legR;
      const lower = side < 0 ? rig.legLowerL : rig.legLowerR;
      const thigh = this.cyl(0.15, 0.12, 0.5, pants);
      thigh.position.y = -0.25;
      leg.add(thigh);
      const pocket = this.box(0.13, 0.19, 0.07, pants);
      pocket.position.set(side * 0.13, -0.28, 0.04);
      leg.add(pocket);
      const cuffM = this.cyl(0.125, 0.115, 0.09, cuff);
      cuffM.position.y = -0.45;
      leg.add(cuffM);
      const shin = this.cyl(0.115, 0.09, 0.4, pants);
      shin.position.y = -0.2;
      lower.add(shin);
      const sockM = this.cyl(0.105, 0.095, 0.14, sock);
      sockM.position.set(0, -0.36, 0.04);
      lower.add(sockM);
      lower.add(this.buildSneaker(shoe, shoeRed, sole, sock));
    }

    // Oversized white tee — two stacked spheres + hem + black inner collar
    const chestLow = this.sph(0.37, tee);
    chestLow.scale.set(1, 0.82, 0.72);
    chestLow.position.set(0, 0.02, 0.01);
    rig.chest.add(chestLow);
    const chestUp = this.sph(0.36, tee);
    chestUp.scale.set(1, 0.78, 0.7);
    chestUp.position.set(0, 0.27, 0);
    rig.chest.add(chestUp);
    const hem = this.cyl(0.355, 0.36, 0.09, tee);
    hem.position.set(0, -0.02, 0.01);
    rig.chest.add(hem);
    const innerM = this.cyl(0.125, 0.12, 0.09, inner);
    innerM.position.set(0, 0.41, 0);
    rig.chest.add(innerM);

    // "GOKUL" graffiti on the back of the shirt
    const name = this.namePlate("GOKUL", 0.5, 0.2, 120);
    name.position.set(0, 0.2, 0.262);
    rig.chest.add(name);

    // Neck
    const neck = this.cyl(0.075, 0.085, 0.11, skin);
    neck.position.set(0, 0.47, 0);
    rig.chest.add(neck);

    // Arms — short sleeves, wristbands, hands with fingers
    for (const side of [-1, 1] as const) {
      const arm = side < 0 ? rig.armL : rig.armR;
      const lower = side < 0 ? rig.armLowerL : rig.armLowerR;
      const upper = this.cyl(0.1, 0.088, 0.32, skin);
      upper.position.y = -0.16;
      arm.add(upper);
      const sleeve = this.cyl(0.118, 0.11, 0.17, tee);
      sleeve.position.y = -0.05;
      arm.add(sleeve);
      const forearm = this.cyl(0.085, 0.075, 0.28, skin);
      forearm.position.y = -0.14;
      lower.add(forearm);
      const band = this.cyl(0.095, 0.095, 0.06, wrist);
      band.position.y = -0.26;
      lower.add(band);
      const hand = this.buildHand(skin);
      hand.position.y = -0.3;
      lower.add(hand);
    }

    // Head + face + structured curly hair
    const head = this.sph(0.3, skin);
    head.scale.set(1, 0.95, 0.95);
    head.position.y = 0.03;
    rig.head.add(head);
    this.buildFace(rig.head, skin, brow, {});
    this.buildCurlHair(rig.hair, hair, hairHi);

    // Silver chain from left hip to back pocket (sways while running)
    const chainGroup = new THREE.Group();
    const hipP = new THREE.Vector3(-0.2, -0.06, 0.02);
    const pocketP = new THREE.Vector3(-0.02, -0.2, 0.15);
    const sag = 0.06;
    for (let i = 0; i < 3; i++) {
      const t = (i + 0.5) / 3;
      const link = this.torus(0.028, 0.009, chain);
      const p = hipP.clone().lerp(pocketP, t);
      p.y -= Math.sin(t * Math.PI) * sag;
      link.position.copy(p);
      chainGroup.add(link);
    }
    const ring = this.torus(0.034, 0.01, chain);
    ring.position.copy(hipP);
    chainGroup.add(ring);
    rig.hips.add(chainGroup);
    rig.chain = chainGroup;

    return rig;
  }

  private buildNischay(): CharacterRig {
    const rig = this.rigBase(0.44);
    const skin = this.pmat(SIR_COLORS.skin, { roughness: 0.6 });
    const hair = this.pmat(SIR_COLORS.hair, { roughness: 0.85 });
    const hairHi = this.pmat(SIR_COLORS.hairHi, { roughness: 0.75 });
    const shirt = this.pmat(SIR_COLORS.shirt, { roughness: 0.9 });
    const shirtRoll = this.pmat(SIR_COLORS.shirtRoll, { roughness: 0.85 });
    const tie = this.pmat(SIR_COLORS.tie, { roughness: 0.7 });
    const pants = this.pmat(SIR_COLORS.pants, { roughness: 0.8 });
    const belt = this.pmat(SIR_COLORS.belt, { roughness: 0.65 });
    const buckle = this.pmat(SIR_COLORS.buckle, { roughness: 0.2, metalness: 0.9 });
    const shoe = this.pmat(SIR_COLORS.shoe, { roughness: 0.45 });
    const shoeDark = this.pmat(SIR_COLORS.shoeDark, { roughness: 0.4 });
    const sole = this.pmat(SIR_COLORS.sole, { roughness: 0.45 });
    const bag = this.pmat(SIR_COLORS.bag, { roughness: 0.7 });
    const bagFlap = this.pmat(SIR_COLORS.bagFlap, { roughness: 0.7 });
    const strap = this.pmat(SIR_COLORS.strap, { roughness: 0.75 });
    const watch = this.pmat(SIR_COLORS.watch, { roughness: 0.35, metalness: 0.5 });
    const watchFace = this.pmat(SIR_COLORS.watchFace, { roughness: 0.2 });
    const book = this.pmat(SIR_COLORS.book, { roughness: 0.6 });
    const bookEdge = this.pmat(SIR_COLORS.bookEdge, { roughness: 0.55 });
    const brow = this.pmat(SIR_COLORS.brow, { roughness: 0.8 });
    const glasses = this.pmat(SIR_COLORS.glasses, { roughness: 0.3, metalness: 0.6 });

    // Pelvis + trousers + belt
    const pelvis = this.box(0.34, 0.3, 0.26, pants);
    pelvis.position.set(0, 0.02, 0.01);
    rig.hips.add(pelvis);
    const beltM = this.box(0.38, 0.07, 0.28, belt);
    beltM.position.set(0, 0.0, 0.02);
    rig.hips.add(beltM);
    const buckleM = this.box(0.06, 0.06, 0.03, buckle);
    buckleM.position.set(0, 0.0, -0.16);
    rig.hips.add(buckleM);

    for (const side of [-1, 1] as const) {
      const leg = side < 0 ? rig.legL : rig.legR;
      const lower = side < 0 ? rig.legLowerL : rig.legLowerR;
      const thigh = this.cyl(0.13, 0.105, 0.5, pants);
      thigh.position.y = -0.25;
      leg.add(thigh);
      const shin = this.cyl(0.1, 0.085, 0.4, pants);
      shin.position.y = -0.2;
      lower.add(shin);
      lower.add(this.buildFormalShoe(shoe, shoeDark, sole));
    }

    // White button-down with a navy tie
    const chestLow = this.sph(0.35, shirt);
    chestLow.scale.set(1, 0.8, 0.7);
    chestLow.position.set(0, 0.02, 0.01);
    rig.chest.add(chestLow);
    const chestUp = this.sph(0.34, shirt);
    chestUp.scale.set(1, 0.78, 0.7);
    chestUp.position.set(0, 0.27, 0);
    rig.chest.add(chestUp);
    const collarBand = this.cyl(0.115, 0.115, 0.07, shirt);
    collarBand.position.set(0, 0.44, 0);
    rig.chest.add(collarBand);
    const tieKnot = this.box(0.075, 0.06, 0.03, tie);
    tieKnot.position.set(0, 0.42, -0.21);
    rig.chest.add(tieKnot);
    const tieBody = this.box(0.055, 0.24, 0.02, tie);
    tieBody.position.set(0, 0.27, -0.225);
    rig.chest.add(tieBody);

    // "NISCHAY" on the back of the shirt
    const name = this.namePlate("NISCHAY", 0.56, 0.22, 96);
    name.position.set(0, 0.2, 0.252);
    rig.chest.add(name);

    const neck = this.cyl(0.07, 0.08, 0.11, skin);
    neck.position.set(0, 0.47, 0);
    rig.chest.add(neck);

    // Arms — rolled-up sleeves
    for (const side of [-1, 1] as const) {
      const arm = side < 0 ? rig.armL : rig.armR;
      const lower = side < 0 ? rig.armLowerL : rig.armLowerR;
      const upper = this.cyl(0.09, 0.08, 0.32, skin);
      upper.position.y = -0.16;
      arm.add(upper);
      const sleeve = this.cyl(0.1, 0.09, 0.17, shirt);
      sleeve.position.y = -0.06;
      arm.add(sleeve);
      const roll = this.cyl(0.102, 0.108, 0.07, shirtRoll);
      roll.position.y = -0.19;
      arm.add(roll);
      const forearm = this.cyl(0.075, 0.068, 0.28, skin);
      forearm.position.y = -0.14;
      lower.add(forearm);
      const hand = this.buildHand(skin);
      hand.position.y = -0.3;
      lower.add(hand);
    }
    // Black watch on the left wrist
    const watchBand = this.torus(0.09, 0.025, watch);
    watchBand.rotation.x = Math.PI / 2;
    watchBand.position.set(0, -0.25, 0);
    rig.armLowerL.add(watchBand);
    const watchFaceM = this.cyl(0.052, 0.052, 0.02, watchFace);
    watchFaceM.rotation.x = Math.PI / 2;
    watchFaceM.position.set(0, -0.25, 0.075);
    rig.armLowerL.add(watchFaceM);
    // Purple book held in the right hand
    const bookM = this.box(0.13, 0.19, 0.05, book);
    bookM.position.set(0, -0.36, -0.02);
    bookM.castShadow = false;
    rig.armLowerR.add(bookM);
    const edge = this.box(0.14, 0.2, 0.025, bookEdge);
    edge.position.set(0, -0.36, -0.065);
    edge.castShadow = false;
    rig.armLowerR.add(edge);

    // Brown messenger bag with a strap across the torso (sways while running)
    const bagGroup = new THREE.Group();
    bagGroup.position.set(0.3, 0.14, 0.1);
    const strapM = this.box(0.08, 0.95, 0.05, strap);
    strapM.position.set(-0.14, 0.2, 0.04);
    strapM.rotation.z = 0.62;
    bagGroup.add(strapM);
    const bagBody = this.box(0.3, 0.3, 0.14, bag);
    bagBody.position.set(0.22, -0.28, 0.04);
    bagGroup.add(bagBody);
    const flapM = this.box(0.32, 0.12, 0.16, bagFlap);
    flapM.position.set(0.22, -0.14, 0.04);
    bagGroup.add(flapM);
    const bagBuckle = this.box(0.05, 0.05, 0.04, buckle);
    bagBuckle.position.set(0.22, -0.19, 0.11);
    bagGroup.add(bagBuckle);
    rig.chest.add(bagGroup);
    rig.bag = bagGroup;

    // Head + face (with glasses) + curly hair with grey streaks
    const head = this.sph(0.3, skin);
    head.scale.set(1, 0.95, 0.95);
    head.position.y = 0.03;
    rig.head.add(head);
    this.buildFace(rig.head, skin, brow, { glasses: true, glassesFrame: glasses });
    this.buildCurlHair(rig.hair, hair, hairHi);

    return rig;
  }

  private buildHand(skin: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const palm = this.box(0.13, 0.11, 0.1, skin);
    g.add(palm);
    for (let i = 0; i < 3; i++) {
      const f = this.box(0.035, 0.05, 0.034, skin);
      f.position.set(-0.033 + i * 0.033, -0.078, 0.012);
      g.add(f);
    }
    const thumb = this.box(0.042, 0.046, 0.034, skin);
    thumb.position.set(0.064, -0.028, -0.01);
    thumb.rotation.z = 0.55;
    g.add(thumb);
    return g;
  }

  private buildFace(
    head: THREE.Group,
    skin: THREE.Material,
    brow: THREE.Material,
    o: { glasses?: boolean; glassesFrame?: THREE.Material } = {},
  ): void {
    for (const sx of [-1, 1]) {
      // Eye whites
      const sclera = this.sph(0.052, this.pmat(0xffffff, { roughness: 0.3 }));
      sclera.scale.set(1, 1.35, 0.5);
      sclera.position.set(sx * 0.105, 0.05, -0.26);
      head.add(sclera);
      // Iris
      const iris = this.sph(0.032, this.pmat(0x2b2440, { roughness: 0.25 }));
      iris.scale.set(1, 1, 0.4);
      iris.position.set(sx * 0.105, 0.055, -0.283);
      head.add(iris);
      // Catch-light
      const glint = this.sph(0.011, this.pmat(0xffffff, { roughness: 0.1 }));
      glint.scale.set(1, 1, 0.4);
      glint.position.set(sx * 0.09, 0.068, -0.29);
      head.add(glint);
      // Eyebrow
      const b = this.box(0.09, 0.024, 0.02, brow);
      b.position.set(sx * 0.105, 0.135, -0.27);
      b.rotation.z = -sx * 0.18;
      head.add(b);
      // Ear
      const ear = this.sph(0.06, skin);
      ear.scale.set(0.5, 0.85, 0.55);
      ear.position.set(sx * 0.285, 0.02, -0.01);
      head.add(ear);
    }
    // Nose
    const nose = this.sph(0.036, skin);
    nose.scale.set(0.78, 1.15, 0.55);
    nose.position.set(0, -0.02, -0.29);
    head.add(nose);
    // Smile
    const smile = new THREE.Mesh(
      new THREE.TorusGeometry(0.05, 0.011, 6, 14, Math.PI, Math.PI),
      this.pmat(GOKUL_COLORS.mouth, { roughness: 0.6 }),
    );
    smile.position.set(0, -0.1, -0.275);
    smile.rotation.x = -0.1;
    head.add(smile);
    // Glasses (Nischay)
    if (o.glasses && o.glassesFrame) {
      for (const sx of [-1, 1]) {
        const frame = this.torus(0.058, 0.014, o.glassesFrame);
        frame.position.set(sx * 0.115, 0.055, -0.26);
        head.add(frame);
      }
      const bridge = this.box(0.055, 0.02, 0.014, o.glassesFrame);
      bridge.position.set(0, 0.055, -0.26);
      head.add(bridge);
      for (const sx of [-1, 1]) {
        const temple = this.box(0.02, 0.016, 0.13, o.glassesFrame);
        temple.position.set(sx * 0.115, 0.055, -0.2);
        head.add(temple);
      }
    }
  }

  private buildCurlHair(
    group: THREE.Group,
    hair: THREE.Material,
    hi: THREE.Material,
  ): void {
    // Base cap
    const cap = this.sph(0.31, hair);
    cap.scale.set(1.04, 0.85, 1.03);
    cap.position.set(0, 0.1, 0);
    group.add(cap);
    // Structured curls — layered rings + back mass so the silhouette reads
    const spots: Array<[number, number, number, number]> = [
      [0, 0.26, 0, 0.14], // crown
      [0, 0.22, -0.13, 0.115],
      [0.11, 0.23, -0.07, 0.11],
      [-0.11, 0.23, -0.07, 0.11],
      [0.12, 0.23, 0.06, 0.11],
      [-0.12, 0.23, 0.06, 0.11],
      [0.19, 0.17, -0.06, 0.12],
      [-0.19, 0.17, -0.06, 0.12],
      [0.2, 0.17, 0.06, 0.12],
      [-0.2, 0.17, 0.06, 0.12],
      [0.12, 0.2, 0.13, 0.115],
      [-0.12, 0.2, 0.13, 0.115],
      [0, 0.18, 0.16, 0.12],
      [0.07, 0.12, 0.2, 0.13],
      [-0.07, 0.12, 0.2, 0.13],
      [0, 0.16, 0.13, 0.135],
    ];
    for (const [x, y, z, r] of spots) {
      const c = this.sph(r, hair);
      c.scale.set(1.08, 0.82, 1.05);
      c.position.set(x, y, z);
      group.add(c);
    }
    // Highlight curls on top for controlled sheen
    const hiSpots: Array<[number, number, number, number]> = [
      [0, 0.28, 0.03, 0.075],
      [0.07, 0.27, -0.02, 0.06],
      [-0.07, 0.27, -0.02, 0.06],
      [0, 0.27, 0.09, 0.06],
    ];
    for (const [x, y, z, r] of hiSpots) {
      const c = this.sph(r, hi);
      c.scale.set(1, 0.8, 1);
      c.position.set(x, y, z);
      group.add(c);
    }
  }

  private buildSneaker(
    shoe: THREE.Material,
    shoeRed: THREE.Material,
    sole: THREE.Material,
    sock: THREE.Material,
  ): THREE.Group {
    const g = new THREE.Group();
    const soleM = this.box(0.3, 0.07, 0.47, sole);
    soleM.position.set(0, -0.045, 0.06);
    g.add(soleM);
    const upper = this.box(0.26, 0.12, 0.36, shoe);
    upper.position.set(0, 0.02, 0.02);
    g.add(upper);
    const toe = this.sph(0.09, shoe);
    toe.scale.set(1, 0.82, 1.12);
    toe.position.set(0, 0.01, 0.2);
    g.add(toe);
    const heel = this.box(0.24, 0.11, 0.09, shoeRed);
    heel.position.set(0, 0.02, 0.29);
    g.add(heel);
    const lace = this.box(0.02, 0.07, 0.22, shoe);
    lace.position.set(0, 0.09, 0.04);
    g.add(lace);
    const sockLip = this.box(0.23, 0.05, 0.3, sock);
    sockLip.position.set(0, 0.09, 0.02);
    g.add(sockLip);
    g.position.y = -0.42;
    return g;
  }

  private buildFormalShoe(
    shoe: THREE.Material,
    dark: THREE.Material,
    sole: THREE.Material,
  ): THREE.Group {
    const g = new THREE.Group();
    const soleM = this.box(0.29, 0.06, 0.45, sole);
    soleM.position.set(0, -0.045, 0.06);
    g.add(soleM);
    const upper = this.box(0.25, 0.11, 0.35, shoe);
    upper.position.set(0, 0.02, 0.02);
    g.add(upper);
    const toe = this.sph(0.085, shoe);
    toe.scale.set(1, 0.82, 1.1);
    toe.position.set(0, 0.01, 0.19);
    g.add(toe);
    const heel = this.box(0.23, 0.1, 0.09, dark);
    heel.position.set(0, 0.02, 0.28);
    g.add(heel);
    g.position.y = -0.42;
    return g;
  }

  private initPlayer(): void {
    const rig = this.buildGokul();
    this.playerRig = rig;
    this.player = rig.root;

    // Shadow blob for crisp ground contact
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
    const rig = this.buildNischay();
    this.chaserRig = rig;
    this.chaser = rig.root;

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

  private pmat(
    color: number,
    opts: {
      roughness?: number;
      metalness?: number;
      map?: THREE.Texture;
      transparent?: boolean;
      opacity?: number;
    } = {},
  ): THREE.MeshStandardMaterial {
    const key = `${color}|${opts.roughness ?? 0.75}|${opts.metalness ?? 0}|${
      opts.map?.uuid ?? ""
    }|${opts.transparent ? 1 : 0}|${opts.opacity ?? 1}`;
    let m = this.pmatCache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color,
        roughness: opts.roughness ?? 0.75,
        metalness: opts.metalness ?? 0,
        ...(opts.map ? { map: opts.map } : {}),
        ...(opts.transparent ? { transparent: true } : {}),
        ...(opts.opacity !== undefined ? { opacity: opts.opacity } : {}),
      });
      this.pmatCache.set(key, m);
    }
    return m;
  }

  private box(
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geoBox, material);
    mesh.scale.set(w, h, d);
    mesh.castShadow = true;
    return mesh;
  }

  private sph(r: number, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geoSph, material);
    mesh.scale.setScalar(r);
    mesh.castShadow = true;
    return mesh;
  }

  private cyl(
    rTop: number,
    rBot: number,
    h: number,
    material: THREE.Material,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(rTop, rBot, h, 14),
      material,
    );
    mesh.castShadow = true;
    return mesh;
  }

  private torus(r: number, tube: number, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(r, tube, 8, 18),
      material,
    );
    mesh.castShadow = true;
    return mesh;
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
    this.applyPose(this.playerRig, this.idlePose(0));

    // Reset the chaser
    this.chaser.position.set(0, 0, CHASER_Z);
    this.chaser.rotation.set(0, 0, 0);
    this.chaser.scale.set(1, 1, 1);
    this.chaserCatchT = 1;
    this.chaserShadow.visible = true;
    this.applyPose(this.chaserRig, this.idlePose(0));

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
    this.pmatCache.forEach((m) => m.dispose());
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  // ── Animation ───────────────────────────────────────────────────────

  private applyPose(rig: CharacterRig, p: RigPose): void {
    rig.legL.rotation.x = p.hipL;
    rig.legR.rotation.x = p.hipR;
    rig.legLowerL.rotation.x = p.kneeL;
    rig.legLowerR.rotation.x = p.kneeR;
    rig.armL.rotation.x = p.shL;
    rig.armR.rotation.x = p.shR;
    rig.armLowerL.rotation.x = p.elL;
    rig.armLowerR.rotation.x = p.elR;
    rig.chest.rotation.x = p.torsoX;
    rig.chest.rotation.z = p.torsoZ;
    rig.head.rotation.x = p.headX;
  }

  private idlePose(time: number): RigPose {
    const br = Math.sin(time * 2.2) * 0.02;
    return {
      hipL: 0.1,
      hipR: -0.1,
      kneeL: 0.08,
      kneeR: 0.08,
      shL: 0.22 + br,
      shR: 0.22 - br,
      elL: 0.4,
      elR: 0.4,
      torsoX: 0.05,
      torsoZ: 0,
      headX: 0.06,
    };
  }

  private runPose(t: number, amp: number): RigPose {
    const s = Math.sin(t);
    const c = Math.cos(t);
    const hipL = s * 0.8 * amp;
    const hipR = -s * 0.8 * amp;
    // Knees fold as each leg swings — natural heel lift
    const kneeL = Math.max(0, Math.sin(t + 0.9)) * 1.2 * amp;
    const kneeR = Math.max(0, Math.sin(t + 0.9 + Math.PI)) * 1.2 * amp;
    return {
      hipL,
      hipR,
      kneeL,
      kneeR,
      shL: -hipL * 0.85,
      shR: -hipR * 0.85,
      elL: 0.7 + c * 0.2,
      elR: 0.7 - c * 0.2,
      torsoX: -0.05 + Math.abs(s) * 0.05,
      torsoZ: s * 0.09,
      headX: c * 0.05,
    };
  }

  private jumpPose(): RigPose {
    return {
      hipL: 1.25,
      hipR: 1.25,
      kneeL: 2.0,
      kneeR: 2.0,
      shL: 2.3,
      shR: 2.3,
      elL: 0.9,
      elR: 0.9,
      torsoX: -0.12,
      torsoZ: 0,
      headX: -0.06,
    };
  }

  private slidePose(): RigPose {
    return {
      hipL: 1.35,
      hipR: 1.35,
      kneeL: -1.2,
      kneeR: -1.2,
      shL: 0.9,
      shR: 0.9,
      elL: 0.6,
      elR: 0.6,
      torsoX: 0.3,
      torsoZ: 0,
      headX: 0.12,
    };
  }

  private knockPose(t: number): RigPose {
    const fl = Math.sin(t * 26);
    return {
      hipL: 0.4,
      hipR: -0.3,
      kneeL: 0.6,
      kneeR: 0.35,
      shL: 2.2 + fl * 0.5,
      shR: -2.2 - fl * 0.5,
      elL: 1.2,
      elR: 1.2,
      torsoX: 0.3 + fl * 0.12,
      torsoZ: 0.18,
      headX: -0.22,
    };
  }

  private catchPose(): RigPose {
    return {
      hipL: 0.5,
      hipR: 0.5,
      kneeL: 0.4,
      kneeR: 0.4,
      shL: Math.PI * 0.96,
      shR: Math.PI * 0.96,
      elL: 0.4,
      elR: -0.4,
      torsoX: -0.28,
      torsoZ: 0,
      headX: 0.16,
    };
  }

  // Lightweight secondary motion — hair, chain and bag follow the run
  private applySecondary(rig: CharacterRig, t: number): void {
    const s = Math.sin(t * 0.9);
    const c = Math.cos(t * 0.9);
    rig.hair.rotation.z = s * 0.09;
    rig.hair.rotation.x = c * 0.03;
    rig.chest.position.y = 0.34 + Math.abs(s) * 0.012;
    if (rig.chain) {
      rig.chain.rotation.x = 0.14 + s * 0.2;
      rig.chain.rotation.z = c * 0.1;
    }
    if (rig.bag) {
      rig.bag.rotation.z = s * 0.1;
      rig.bag.rotation.x = -c * 0.05;
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
    this.ambientT += dt;
    this.runPhase += dt * 6;
    this.animateRunCycle();
    for (const c of this.coins) {
      c.mesh.rotation.y += dt * 2.5;
    }
    for (const cl of this.clouds) {
      cl.position.z += dt * 1.2;
      if (cl.position.z > 40) cl.position.z -= 160;
    }
    if (this.phase === "over") this.updateParticles(dt);

    if (this.phase === "ready") {
      // Nischay Sir idles right behind Gokul on the start screen
      this.chaser.position.set(0, 0, CHASER_Z);
      this.chaser.rotation.set(0, 0, 0);
      this.chaser.scale.set(1, 1, 1);
      this.applyPose(this.chaserRig, this.idlePose(this.ambientT));
      this.applySecondary(this.chaserRig, this.runPhase);
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
      this.chaser.position.y = Math.abs(Math.sin(t * Math.PI * 2)) * 0.12;
      this.chaser.rotation.set(0, 0, 0);
      this.chaser.scale.set(1, 1, 1);
      this.applyPose(this.chaserRig, this.catchPose());
      this.applySecondary(this.chaserRig, this.ambientT * 3);
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

    // Forward tumble + squash for the slide
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
      this.applyPose(this.chaserRig, this.slidePose());
    } else if (!this.onGround) {
      this.chaser.rotation.x = 0;
      this.chaser.scale.y = 1;
      this.applyPose(this.chaserRig, this.jumpPose());
    } else {
      this.chaser.rotation.x = 0;
      this.chaser.scale.y = 1;
      this.applyPose(
        this.chaserRig,
        this.runPose(this.runPhase * 0.9 + Math.PI, 0.9),
      );
    }
    this.applySecondary(this.chaserRig, this.runPhase);
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

  private animateRunCycle(): void {
    const t = this.runPhase * 0.9;
    const amp = this.phase === "ready" ? 0.55 : 0.15;
    this.applyPose(this.playerRig, this.runPose(t, amp));
    this.applySecondary(this.playerRig, this.runPhase);
    const bob =
      this.phase === "ready"
        ? Math.abs(Math.sin(t)) * 0.07
        : Math.sin(this.ambientT * 2) * 0.012;
    this.player.position.y = this.jumpY + bob;
  }

  private animatePose(): void {
    const t = this.runPhase * 0.9;
    if (this.slideTimer > 0) {
      this.applyPose(this.playerRig, this.slidePose());
    } else if (!this.onGround) {
      this.applyPose(this.playerRig, this.jumpPose());
    } else if (this.knockT > 0) {
      this.applyPose(this.playerRig, this.knockPose(this.knockT));
    } else {
      this.applyPose(this.playerRig, this.runPose(t, 1));
    }
    this.applySecondary(this.playerRig, this.runPhase);
  }

  // ── Entities ────────────────────────────────────────────────────────

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
