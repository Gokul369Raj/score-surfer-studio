import * as THREE from "three";
import { buildGokul, buildNischay, makePose, resetPose, applyPose, type CharacterRig, type Pose } from "./characters";
import { Campus } from "./campus";
import { GameAudio } from "./audio";

export type Screen = "menu" | "playing" | "paused" | "gameover";

export interface GameStats {
  score: number;
  coins: number;
  distance: number;
}

export interface GameEvents {
  onStats(s: GameStats): void;
  onHits(hits: number): void;
  onChase(bar: number, onTail: boolean): void;
  onGameOver(s: GameStats): void;
}

const LANE_X = [-2.1, 0, 2.1];
const GRAVITY = 26;
const JUMP_VY = 9.4; // higher, anime-style jump (~1.7 units peak)
const SLIDE_TIME = 0.85;
const BASE_SPEED = 13;
const MAX_SPEED = 30;
const RAMP = 0.07; // speed gained per second of play
const DIST_RAMP = 0.004; // speed gained per meter covered (keeps ramping as you run)

export class TitCampusRun {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private events: GameEvents;
  private audio = new GameAudio();

  private gokul: CharacterRig & { hair: THREE.Mesh[] };
  private nischay: CharacterRig;
  private campus: Campus;

  private poseIdle = makePose();
  private poseRun = makePose();
  private poseJump = makePose();
  private poseSlide = makePose();
  private poseCaught = makePose();
  private poseChase = makePose();
  private poseCatch = makePose();
  private w = { idle: 1, run: 0, jump: 0, slide: 0, caught: 0 };

  screen: Screen = "menu";
  private quality: "high" | "low";

  // player state — lane is a discrete index so every press moves exactly one
  // lane (no swallowed or double-skipped inputs mid-transition)
  private laneIdx = 1;
  private playerX = 0;
  private playerY = 0;
  private vy = 0;
  private grounded = true;
  private sliding = false;
  private slideTimer = 0;
  private laneLean = 0;

  // run state
  private speed = BASE_SPEED;
  private elapsed = 0;
  private runTime = 0;
  private score = 0;
  private coins = 0;
  private distance = 0;

  // hits / chase
  private hits = 0;
  private hitCooldown = 0;
  private chaseTimer = 0; // seconds Nischay actively chases (10s at start & after each hit)
  private warningFired = false;
  private chaseSoundOn = false; // pakad-mc loop state
  private plOn = false; // 3-song playlist state (plays when not chasing)
  private chaseGap = 7.5;
  private chaseTarget = 7.5;
  private gameOverTimer = 0;
  private timeScale = 1;

  // camera
  private camPos = new THREE.Vector3(0, 2.9, 8.4);
  private camLook = new THREE.Vector3(0, 1.2, -3);
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private menuTheta = 0;

  private clockLast = performance.now();
  private rafId = 0;
  private disposed = false;

  constructor(container: HTMLElement, events: GameEvents) {
    this.container = container;
    this.events = events;

    const isMobile = Math.min(window.innerWidth, window.innerHeight) < 820;
    this.quality = isMobile ? "low" : "high";

    this.renderer = new THREE.WebGLRenderer({ antialias: this.quality === "high", alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality === "high" ? 2 : 1.6));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(62, container.clientWidth / Math.max(1, container.clientHeight), 0.1, 400);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    // fog + lights
    this.scene.fog = new THREE.FogExp2(0xbfe2ee, 0.0065);
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x77b34c, 0.75);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d8, 2.2);
    sun.position.set(8, 14, 6);
    sun.castShadow = this.quality === "high";
    sun.shadow.mapSize.set(this.quality === "high" ? 2048 : 1024, this.quality === "high" ? 2048 : 1024);
    sun.shadow.camera.left = -22;
    sun.shadow.camera.right = 22;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -18;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 70;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);
    this.scene.add(sun.target);
    const rim = new THREE.DirectionalLight(0x9fd8ff, 0.7);
    rim.position.set(-6, 4, -8);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffe9c9, 0.4);
    fill.position.set(-4, 3, 6);
    this.scene.add(fill);

    this.campus = new Campus(this.scene);
    this.campus.placeStartGate(-16);

    this.gokul = buildGokul();
    this.scene.add(this.gokul.group);
    this.gokul.group.position.set(0, 0, 0);
    this.gokul.group.rotation.y = Math.PI;

    this.nischay = buildNischay();
    this.scene.add(this.nischay.group);
    this.nischay.group.position.set(0, 0, this.chaseGap);
    this.nischay.group.rotation.y = Math.PI;

    window.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVisibility);
    if (import.meta.env.DEV) {
      (window as unknown as { __titGame?: unknown }).__titGame = this;
    }
    this.rafId = requestAnimationFrame(this.tick);
  }

  // ------------------------------------------------------------- public API

  unlockAudio() {
    this.audio.unlock();
  }

  setMuted(m: boolean) {
    this.audio.setMuted(m);
  }

  start() {
    this.audio.click();
    // reset run state — Nischay chases hard for the first 10 seconds
    this.hits = 0;
    this.chaseTimer = 10;
    this.warningFired = false;
    this.chaseGap = 6.0;
    this.chaseTarget = 7.5;
    this.speed = BASE_SPEED;
    this.elapsed = 0;
    this.runTime = 0;
    this.score = 0;
    this.coins = 0;
    this.distance = 0;
    this.playerX = 0;
    this.playerY = 0;
    this.vy = 0;
    this.grounded = true;
    this.sliding = false;
    this.laneIdx = 1;
    this.laneLean = 0;
    this.hitCooldown = 0;
    this.gameOverTimer = 0;
    this.timeScale = 1;
    this.campus.reset(20);
    this.campus.placeStartGate(-30);
    this.audio.stopChase();
    this.audio.stopPlaylist();
    this.chaseSoundOn = false;
    this.plOn = false;
    this.screen = "playing";
    this.w.idle = 0;
    this.w.run = 1;
    this.emitStats();
    this.events.onHits(0);
  }

  backToMenu() {
    this.audio.stopChase();
    this.audio.stopPlaylist();
    this.chaseSoundOn = false;
    this.plOn = false;
    this.audio.click();
    this.screen = "menu";
    this.w.run = 0;
    this.w.idle = 1;
    this.camera.position.set(0, 2.8, 8.4);
  }

  pause() {
    if (this.screen !== "playing") return;
    this.audio.stopChase();
    this.audio.stopPlaylist();
    this.chaseSoundOn = false;
    this.plOn = false;
    this.screen = "paused";
  }

  resume() {
    if (this.screen !== "paused") return;
    this.screen = "playing";
    this.clockLast = performance.now();
  }

  moveLeft() {
    if (this.screen !== "playing") return;
    if (this.laneIdx <= 0) return;
    this.laneIdx--;
    this.audio.lane();
  }

  moveRight() {
    if (this.screen !== "playing") return;
    if (this.laneIdx >= 2) return;
    this.laneIdx++;
    this.audio.lane();
  }

  jump() {
    if (this.screen !== "playing") return;
    if (!this.grounded) return;
    if (this.sliding) this.sliding = false;
    this.vy = JUMP_VY;
    this.grounded = false;
    this.audio.jump();
  }

  slide() {
    if (this.screen !== "playing") return;
    if (this.grounded) {
      this.sliding = true;
      this.slideTimer = SLIDE_TIME;
      this.audio.slide();
    }
  }

  dispose() {
    this.disposed = true;
    this.audio.stopChase();
    this.audio.stopPlaylist();
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.campus.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
      else if (mat) mat.dispose();
    });
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  // ---------------------------------------------------------------- events

  private onVisibility = () => {
    if (document.hidden && this.screen === "playing") this.pause();
  };

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private emitStats() {
    this.events.onStats({ score: Math.floor(this.score), coins: this.coins, distance: Math.floor(this.distance) });
  }

  // ------------------------------------------------------------------ loop

  private tick = () => {
    if (this.disposed) return;
    const now = performance.now();
    let dt = Math.min((now - this.clockLast) / 1000, 0.05);
    this.clockLast = now;
    if (this.screen === "playing") {
      dt *= this.timeScale;
      this.updatePlay(dt);
    } else if (this.screen === "menu") {
      this.updateMenu(dt);
    }

    this.updatePoses(dt);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.tick);
  };

  private updatePlay(rawDt: number) {
    const dt = Math.min(rawDt, 0.033);

    // speed ramp — faster the longer you run AND the further you get
    this.elapsed += dt;
    this.speed = Math.min(MAX_SPEED, BASE_SPEED + this.elapsed * RAMP + this.distance * DIST_RAMP);
    this.distance += this.speed * dt;
    this.score += this.speed * dt * 0.5;

    // world
    this.campus.update(dt, this.speed);

    // lane lerp + lean (discrete lane input, smooth x position)
    const targetX = LANE_X[this.laneIdx];
    this.playerX = THREE.MathUtils.damp(this.playerX, targetX, 12, dt);
    this.laneLean = THREE.MathUtils.damp(
      this.laneLean,
      Math.abs(targetX - this.playerX) > 0.12 ? Math.sign(targetX - this.playerX) : 0,
      12,
      dt,
    );

    // jump / slide
    if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      this.playerY += this.vy * dt;
      if (this.playerY <= 0) {
        this.playerY = 0;
        this.vy = 0;
        this.grounded = true;
      }
    }
    if (this.sliding) {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0) this.sliding = false;
    }

    // character transform
    this.gokul.group.position.set(this.playerX, this.playerY, 0);
    this.gokul.group.rotation.z = -this.laneLean * 0.22;
    this.gokul.group.rotation.y = Math.PI;

    // Nischay chase — 10s of hot pursuit (at the start and after every hit),
    // then he backs off for breathing room until the next collision. The
    // second collision catches him instantly.
    if (this.chaseTimer > 0) this.chaseTimer -= dt;
    const gameOverSeq = this.gameOverTimer > 0;
    const chasing = this.chaseTimer > 0 || gameOverSeq;
    this.chaseTarget = gameOverSeq ? 1.4 : chasing ? 2.8 : 7.5 + Math.min(5.5, this.elapsed * 0.35);
    this.chaseGap = Math.max(this.chaseGap, 1.6);
    const rate = THREE.MathUtils.clamp((this.chaseTarget - this.chaseGap) * 0.35, -5, 4.5);
    this.chaseGap += rate * dt;
    // Nischay runs BEHIND Gokul (positive z = toward the camera) so his back
    // is what the player sees; he falls out of frame as he drops back.
    // Nischay mirrors Gokul's lane (same x target, slight lag) so the chase
    // always trails exactly behind him.
    this.nischay.group.position.set(
      THREE.MathUtils.damp(this.nischay.group.position.x, this.playerX, 4.5, dt),
      0,
      this.chaseGap,
    );
    this.nischay.group.rotation.y = Math.PI;

    // audio state machine:
    //  - hot pursuit (10s windows)  → pakad-mc chase loop
    //  - Nischay backs off          → 3-song playlist, one after another, looping
    //  - catch sequence             → everything stops (out sound plays)
    const chaseActive = this.chaseTimer > 0 && !gameOverSeq;
    if (gameOverSeq) {
      if (this.chaseSoundOn) {
        this.chaseSoundOn = false;
        this.audio.stopChase();
      }
      if (this.plOn) {
        this.plOn = false;
        this.audio.stopPlaylist();
      }
    } else if (chaseActive) {
      if (!this.chaseSoundOn) {
        this.chaseSoundOn = true;
        this.audio.startChase();
      }
      if (this.plOn) {
        this.plOn = false;
        this.audio.stopPlaylist();
      }
    } else {
      if (this.chaseSoundOn) {
        this.chaseSoundOn = false;
        this.audio.stopChase();
      }
      if (!this.plOn) {
        this.plOn = true;
        this.audio.startPlaylist();
      }
    }

    const bar = THREE.MathUtils.clamp(1 - (this.chaseGap - 2.2) / (13 - 2.2), 0, 1);
    const onTail = bar > 0.86;
    if (onTail && !this.warningFired) {
      this.warningFired = true;
      this.audio.chaseWarning();
    }
    this.events.onChase(bar, onTail);

    // run cycle phase
    this.runTime += dt * (0.9 + this.speed / MAX_SPEED * 0.3);

    // collisions
    if (this.hitCooldown > 0) this.hitCooldown -= dt;
    this.checkCoins();
    this.checkObstacles();

    // game over sequence
    if (this.gameOverTimer > 0) {
      this.gameOverTimer -= dt;
      this.timeScale = THREE.MathUtils.damp(this.timeScale, 0.28, 2.5, dt);
      if (this.gameOverTimer <= 0) {
        this.screen = "gameover";
        this.timeScale = 1;
        this.events.onGameOver({ score: Math.floor(this.score), coins: this.coins, distance: Math.floor(this.distance) });
      }
    }

    this.emitStats();
  }

  private updateMenu(dt: number) {
    this.menuTheta += dt * 0.25;
    this.gokul.group.position.set(0, 0, 0);
    this.gokul.group.rotation.y = Math.PI;
    this.nischay.group.position.set(0, 0, -4.6);
    this.nischay.group.rotation.y = Math.PI;
  }

  private checkCoins() {
    for (const c of this.campus.coins) {
      if (!c.active) continue;
      if (Math.abs(c.x - this.playerX) < 0.62 && Math.abs(c.z) < 0.8 && Math.abs(c.y - (this.playerY + 0.55)) < 1.15) {
        c.active = false;
        c.mesh.visible = false;
        this.coins++;
        this.score += 25;
        this.audio.coin();
        // pop effect: scale burst handled by reusing mesh? just hide
        this.campus.scene.remove(c.mesh);
        const idx = this.campus.coins.indexOf(c);
        if (idx >= 0) this.campus.coins.splice(idx, 1);
      }
    }
  }

  private checkObstacles() {
    for (const o of this.campus.obstacles) {
      if (!o.active) continue;
      if (Math.abs(o.z) > 1.6) continue;
      if (Math.abs(o.x - this.playerX) > o.w / 2 + 0.3) continue;

      let blocked = true;
      if (o.kind === "overhead") {
        blocked = !this.sliding;
      } else {
        blocked = this.playerY < o.h + 0.12;
      }
      if (!blocked) continue;

      // landed a hit
      if (this.hitCooldown > 0) continue;
      this.hitCooldown = 1.4;
      this.audio.hit();
      o.active = false;
      o.mesh.visible = false;

      this.hits++;
      if (this.hits >= 3) {
        // caught! play the out sound (kya_re_lund_ke.mp3)
        this.audio.out();
        this.gameOverTimer = 1.6;
        this.w.caught = 1;
        this.chaseTarget = 1.3;
        this.chaseGap = Math.min(this.chaseGap, 3.4);
      } else {
        this.chaseTimer = 10; // 10s of hot pursuit, then he backs off again
        this.events.onHits(this.hits); // "1/3" then "2/3"
        // stumble: brief slow-down
        this.speed = Math.max(BASE_SPEED, this.speed * 0.72);
        this.stumble = 1;
      }
    }
  }

  private stumble = 0;

  // ---------------------------------------------------------------- poses

  private updatePoses(dt: number) {
    const t = this.runTime;
    // --- Gokul
    const g = this.gokul;
    const gW = this.w;

    // smooth weights
    const isCaughtSeq = this.screen === "gameover" || this.gameOverTimer > 0;
    const target = this.screen === "playing" ? { idle: 0, run: 1, jump: 0, slide: 0, caught: isCaughtSeq ? 1 : 0 } : this.screen === "gameover" ? { idle: 0, run: 0, jump: 0, slide: 0, caught: 1 } : { idle: 1, run: 0, jump: 0, slide: 0, caught: 0 };
    const k = 1 - Math.exp(-8 * dt);
    gW.idle += (target.idle - gW.idle) * k;
    gW.run += (target.run - gW.run) * k;
    gW.jump += (target.jump - gW.jump) * k;
    gW.slide += (target.slide - gW.slide) * k;
    gW.caught += (target.caught - gW.caught) * k;

    // active pose blending: jump overrides run, slide overrides both
    const jw = this.grounded ? 0 : 1;
    const sw = this.sliding ? 1 : 0;
    const wRun = gW.run * (1 - jw) * (1 - sw);
    const wJump = jw;
    const wSlide = sw;
    const wIdle = gW.idle;
    const wCaught = gW.caught;
    const sum = wRun + wJump + wSlide + wIdle + wCaught;
    const n = sum > 0 ? 1 / sum : 1;

    resetPose(this.poseRun);
    resetPose(this.poseJump);
    resetPose(this.poseSlide);
    resetPose(this.poseCaught);
    fillGokulIdle(this.poseIdle, this.elapsed);
    fillGokulRun(this.poseRun, t);
    fillJump(this.poseJump);
    fillSlide(this.poseSlide);
    fillCaught(this.poseCaught, this.elapsed);

    applyPose(g, { idle: wIdle * n, run: wRun * n, jump: wJump * n, slide: wSlide * n, caught: wCaught * n }, {
      idle: this.poseIdle,
      run: this.poseRun,
      jump: this.poseJump,
      slide: this.poseSlide,
      caught: this.poseCaught,
    });

    // lane lean onto the whole body
    g.group.rotation.z = -this.laneLean * 0.22;

    // stumble wobble after a hit
    if (this.stumble > 0) {
      this.stumble = Math.max(0, this.stumble - dt * 2.4);
      g.group.rotation.z += Math.sin(this.elapsed * 30) * 0.08 * this.stumble;
    }

    // blink
    if (Math.sin(this.elapsed * 0.9) > 0.995) {
      g.eyeL.scale.y = 0.1;
      g.eyeR.scale.y = 0.1;
    } else {
      g.eyeL.scale.y = 1;
      g.eyeR.scale.y = 1;
    }
    // hair bounces — subtle, synchronized, and anchored to baseY (no drift)
    for (const h of g.hair) {
      const baseY = (h.userData.baseY as number) ?? 0;
      h.position.y = baseY + Math.sin(this.elapsed * 5) * 0.005;
    }

    // fingers curl with pose
    const curl = wRun * 1.0 + wIdle * 0.3 + wJump * 0.15 + wSlide * 0.6;
    for (const f of g.fingersL) f.rotation.x = -curl;
    for (const f of g.fingersR) f.rotation.x = -curl;

    // --- Nischay
    const cg = this.nischay;
    const catching = this.gameOverTimer > 0 || this.chaseGap < 2.6;
    resetPose(this.poseChase);
    resetPose(this.poseCatch);
    fillNischayRun(this.poseChase, t * 1.02);
    fillCatch(this.poseCatch);
    applyPose(cg, { idle: 0, run: catching ? 0 : 1, jump: 0, slide: 0, caught: catching ? 1 : 0 }, {
      idle: this.poseIdle,
      run: this.poseChase,
      jump: this.poseJump,
      slide: this.poseSlide,
      caught: this.poseCatch,
    });
  }

  private updateCamera(dt: number) {
    if (this.screen === "menu") {
      const th = this.menuTheta;
      const tx = Math.sin(th) * 3.6;
      const tz = 4.2 + Math.cos(th) * 3.6;
      this.camPos.set(
        THREE.MathUtils.damp(this.camPos.x, tx, 3, dt),
        THREE.MathUtils.damp(this.camPos.y, 2.4, 3, dt),
        THREE.MathUtils.damp(this.camPos.z, tz, 3, dt),
      );
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(0, 1.15, -1.5);
      this.camera.fov = 55;
      this.camera.updateProjectionMatrix();
      return;
    }

    if (this.screen === "gameover") {
      // frame the caught moment
      const tx = 0.5;
      const tz = 6.4;
      this.camPos.lerp(this.tmpA.set(tx, 2.3, tz), 1 - Math.exp(-4 * dt));
      this.camLook.lerp(this.tmpB.set(0, 1.25, -1.2), 1 - Math.exp(-5 * dt));
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camLook);
      return;
    }

    // classic behind-the-back chase cam: Gokul's back fills the frame,
    // the track recedes ahead, and Nischay's back slides into view when close
    const pull = Math.max(0, 4.8 - this.chaseGap) * 0.5;
    const targetPos = this.tmpA.set(
      this.playerX * 0.3,
      2.85 + this.playerY * 0.42 + pull * 0.4,
      8.4 + pull * 0.6,
    );
    const targetLook = this.tmpB.set(this.playerX * 0.22, 1.18 + this.playerY * 0.3, -3.5);
    this.camPos.lerp(targetPos, 1 - Math.exp(-7 * dt));
    this.camLook.lerp(targetLook, 1 - Math.exp(-9 * dt));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    const targetFov = 58 + Math.min(10, (this.speed - BASE_SPEED) * 0.5);
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 3, dt);
    this.camera.updateProjectionMatrix();
  }
}

// ------------------------------------------------------------------ poses

function fillGokulIdle(p: Pose, t: number): void {
  resetPose(p);
  p.hips.rz = Math.sin(t * 0.9) * 0.02;
  p.chest.rx = 0.04;
  p.chest.rz = Math.sin(t * 0.9 + 0.6) * 0.02;
  p.neck.rx = 0.06;
  p.head.ry = Math.sin(t * 0.45) * 0.4;
  p.head.rx = 0.02;
  p.upperArmL.rz = 0.1;
  p.upperArmR.rz = -0.1;
  p.upperArmL.rx = Math.sin(t * 0.8) * 0.05;
  p.upperArmR.rx = Math.sin(t * 0.8 + 0.5) * 0.05;
  p.forearmL.rx = -0.35;
  p.forearmR.rx = -0.35;
  p.handL.rz = 0.12;
  p.handR.rz = -0.12;
}

function fillGokulRun(p: Pose, t: number): void {
  resetPose(p);
  const ph = t * 10;
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  p.thighL.rx = s * 0.85;
  p.thighR.rx = -s * 0.85;
  p.shinL.rx = Math.max(0, -Math.sin(ph + 0.9)) * 1.4;
  p.shinR.rx = Math.max(0, Math.sin(ph + 0.9)) * 1.4;
  p.footL.rx = -0.2 - 0.15 * c;
  p.footR.rx = -0.2 + 0.15 * c;
  p.upperArmL.rx = -s * 1.0;
  p.upperArmR.rx = s * 1.0;
  p.upperArmL.rz = 0.12;
  p.upperArmR.rz = -0.12;
  p.forearmL.rx = -(0.7 + Math.max(0, s) * 0.4);
  p.forearmR.rx = -(0.7 + Math.max(0, -s) * 0.4);
  p.handL.rz = -0.28;
  p.handR.rz = 0.28;
  p.hips.rx = 0.08;
  p.hips.ry = s * 0.1;
  p.chest.rx = 0.16 + c * 0.03;
  p.chest.rz = c * 0.03;
  p.neck.rx = -0.13;
  p.head.rz = -s * 0.035;
}

function fillJump(p: Pose): void {
  resetPose(p);
  p.hips.rx = 0.12;
  p.chest.rx = 0.1;
  p.neck.rx = -0.08;
  p.head.rx = -0.15;
  p.thighL.rx = 1.0;
  p.thighR.rx = 1.0;
  p.shinL.rx = -1.05;
  p.shinR.rx = -1.05;
  p.footL.rx = -0.3;
  p.footR.rx = -0.3;
  p.upperArmL.rx = -1.4;
  p.upperArmR.rx = -1.4;
  p.upperArmL.rz = 0.3;
  p.upperArmR.rz = -0.3;
  p.forearmL.rx = 0.5;
  p.forearmR.rx = 0.5;
}

function fillSlide(p: Pose): void {
  resetPose(p);
  p.hips.rx = -1.15; // hips back, chest down
  p.chest.rx = 0.85;
  p.neck.rx = -0.3;
  p.head.rx = -0.25;
  p.thighL.rx = -0.9; // legs forward
  p.thighR.rx = -0.9;
  p.shinL.rx = 0.9;
  p.shinR.rx = 0.9;
  p.footL.rx = -0.2;
  p.footR.rx = -0.2;
  p.upperArmL.rx = 1.2; // arms trailing back
  p.upperArmR.rx = 1.2;
  p.upperArmL.rz = 0.25;
  p.upperArmR.rz = -0.25;
  p.forearmL.rx = -0.8;
  p.forearmR.rx = -0.8;
}

function fillCaught(p: Pose, t: number): void {
  resetPose(p);
  p.chest.rx = 0.08 + Math.sin(t * 10) * 0.03;
  p.neck.rx = -0.1;
  p.head.rx = -0.3 + Math.sin(t * 12) * 0.05;
  p.upperArmL.rx = -2.9; // arms up — surrender!
  p.upperArmR.rx = -2.9;
  p.upperArmL.rz = 0.5;
  p.upperArmR.rz = -0.5;
  p.forearmL.rx = -0.4;
  p.forearmR.rx = -0.4;
  p.thighL.rx = 0.15;
  p.thighR.rx = 0.15;
  p.shinL.rx = 0.3;
  p.shinR.rx = 0.3;
}

function fillNischayRun(p: Pose, t: number): void {
  resetPose(p);
  const ph = t * 10;
  const s = Math.sin(ph);
  p.thighL.rx = s * 0.95;
  p.thighR.rx = -s * 0.95;
  p.shinL.rx = Math.max(0, -Math.sin(ph + 0.9)) * 1.5;
  p.shinR.rx = Math.max(0, Math.sin(ph + 0.9)) * 1.5;
  p.upperArmL.rx = -s * 1.15;
  p.upperArmR.rx = s * 1.15;
  p.forearmL.rx = -0.85;
  p.forearmR.rx = -0.85;
  p.hips.rx = 0.1;
  p.chest.rx = 0.2;
  p.neck.rx = -0.18;
  p.head.rx = -0.12;
}

function fillCatch(p: Pose): void {
  resetPose(p);
  p.chest.rx = 0.35; // lunging forward
  p.hips.rx = 0.15;
  p.neck.rx = -0.3;
  p.head.rx = -0.2;
  p.upperArmL.rx = -1.5; // arms reaching out to grab
  p.upperArmR.rx = -1.5;
  p.upperArmL.rz = 0.35;
  p.upperArmR.rz = -0.35;
  p.forearmL.rx = 0.9;
  p.forearmR.rx = 0.9;
  p.thighL.rx = 0.7;
  p.thighR.rx = 0.7;
  p.shinL.rx = 0.6;
  p.shinR.rx = 0.6;
}
