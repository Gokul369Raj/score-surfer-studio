import * as THREE from "three";
import { buildGokul, buildNischay, type CharacterRig } from "./characters";
import { RiggedCharacter, type AnimState } from "./animations";
import type { KenneyPlayerModel } from "./kenneyCharacter";
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

/** Minimal player rig — either the procedural character or the Kenney model. */
interface PlayerRig {
  group: THREE.Group;
  hair?: THREE.Mesh[];
  eyeL?: THREE.Group;
  eyeR?: THREE.Group;
  fingersL?: THREE.Mesh[];
  fingersR?: THREE.Mesh[];
}

const LANE_X = [-2.1, 0, 2.1];
const GRAVITY = 25.5;
const JUMP_VY = 12.2; // big anime-style jump with enough hang time for coin arcs
const SLIDE_TIME = 0.85;
const INPUT_BUFFER = 0.18;
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

  private gokul: PlayerRig;
  private nischay: CharacterRig;
  private campus: Campus;

  private gChar!: RiggedCharacter;
  private nChar!: RiggedCharacter;
  private gAnim: AnimState = "idle";
  private nAnim: AnimState = "idle";
  private gLandingT = 0;
  private gHitT = 0;
  private wasGrounded = true;

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
  private inputBuffer: "jump" | "slide" | null = null;
  private inputBufferT = 0;

  // run state
  private speed = BASE_SPEED;
  private elapsed = 0;
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

  constructor(container: HTMLElement, events: GameEvents, playerModel?: KenneyPlayerModel | null) {
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

    if (playerModel) {
      // Kenney CC0 character — same rig interface, same animation states
      this.gokul = { group: playerModel.group };
      this.gChar = new RiggedCharacter(playerModel.group, playerModel.clips, playerModel.runCadence);
    } else {
      this.gokul = buildGokul();
      this.gChar = new RiggedCharacter(this.gokul.group);
    }
    this.scene.add(this.gokul.group);
    this.gokul.group.position.set(0, 0, 0);
    this.gokul.group.rotation.y = Math.PI;

    this.nischay = buildNischay();
    this.scene.add(this.nischay.group);
    this.nischay.group.position.set(0, 0, this.chaseGap);
    this.nischay.group.rotation.y = Math.PI;

    this.nChar = new RiggedCharacter(this.nischay.group);

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
    this.inputBuffer = null;
    this.inputBufferT = 0;
    this.hitCooldown = 0;
    this.gameOverTimer = 0;
    this.timeScale = 1;
    this.campus.reset(20);
    this.campus.placeStartGate(-30);
    this.audio.stopChase();
    this.audio.resetPlaylist(); // new run → shuffle to a different song
    this.chaseSoundOn = false;
    this.plOn = false;
    this.screen = "playing";
    this.gChar.snap("run");
    this.gAnim = "run";
    this.nChar.snap("run");
    this.nAnim = "run";
    this.gLandingT = 0;
    this.gHitT = 0;
    this.wasGrounded = true;
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
    this.gChar.play("idle", 0.35);
    this.gAnim = "idle";
    this.nChar.play("idle", 0.35);
    this.nAnim = "idle";
    this.gLandingT = 0;
    this.gHitT = 0;
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
    if (!this.grounded) {
      this.inputBuffer = "jump";
      this.inputBufferT = INPUT_BUFFER;
      return;
    }
    this.performJump();
  }

  private performJump() {
    if (this.sliding) this.sliding = false;
    this.vy = JUMP_VY;
    this.grounded = false;
    this.inputBuffer = null;
    this.inputBufferT = 0;
    this.audio.jump();
  }

  slide() {
    if (this.screen !== "playing") return;
    if (!this.grounded) {
      this.inputBuffer = "slide";
      this.inputBufferT = INPUT_BUFFER;
      return;
    }
    this.performSlide();
  }

  private performSlide() {
    this.sliding = true;
    this.slideTimer = SLIDE_TIME;
    this.inputBuffer = null;
    this.inputBufferT = 0;
    this.audio.slide();
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
    if (this.inputBufferT > 0) {
      this.inputBufferT -= dt;
      if (this.grounded && this.inputBuffer) {
        if (this.inputBuffer === "jump") this.performJump();
        else this.performSlide();
      } else if (this.inputBufferT <= 0) {
        this.inputBuffer = null;
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
    this.chaseTarget = gameOverSeq ? 0.3 : chasing ? 2.8 : 7.5 + Math.min(5.5, this.elapsed * 0.35);
    this.chaseGap = Math.max(this.chaseGap, gameOverSeq ? 0.22 : 1.6);
    const rate = THREE.MathUtils.clamp((this.chaseTarget - this.chaseGap) * (gameOverSeq ? 6 : 0.35), -9, 4.5);
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
      this.events.onHits(this.hits); // "1/3", "2/3", then "3/3"
      if (this.hits === 3) {
        // caught! play the out sound (kya_re_lund_ke.mp3)
        this.audio.out();
        this.gameOverTimer = 2.4; // slow-mo catch stays on screen longer
        this.chaseTarget = 0.3; // Nischay closes right in and grabs him
        this.chaseGap = Math.min(this.chaseGap, 3.2);
      } else {
        this.chaseTimer = 10; // 10s of hot pursuit, then he backs off again
        // stumble: brief slow-down
        this.speed = Math.max(BASE_SPEED, this.speed * 0.72);
        this.stumble = 1;
        this.gHitT = 0.5; // one-shot hit reaction animation
      }
    }
  }

  private stumble = 0;

  // ---------------------------------------------------------------- poses

  // ------------------------------------------------------------ animations

  private updatePoses(dt: number) {
    // ---- Gokul: gameplay-driven animation state machine -------------------
    const playing = this.screen === "playing";
    const caughtSeq = this.screen === "gameover" || this.gameOverTimer > 0;

    if (this.gLandingT > 0) this.gLandingT -= dt;
    if (this.gHitT > 0) this.gHitT -= dt;

    // landing trigger: just touched down after being airborne
    if (this.grounded && !this.wasGrounded && playing && !caughtSeq) {
      this.gLandingT = 0.34;
    }
    this.wasGrounded = this.grounded;

    let target: AnimState;
    if (caughtSeq) target = "caught";
    else if (!playing) target = "idle";
    else if (this.sliding) target = "slide";
    else if (!this.grounded) target = this.vy > 0 ? "jump" : "fall";
    else if (this.gLandingT > 0) target = "landing";
    else if (this.gHitT > 0) target = "hit";
    else target = "run";

    if (target !== this.gAnim) {
      const fade = target === "landing" ? 0.12 : target === "hit" ? 0.09 : 0.2;
      this.gChar.play(target, fade);
      this.gAnim = target;
    }
    this.gChar.setRunScale(THREE.MathUtils.clamp(this.speed / BASE_SPEED, 0.75, 2.1));

    // lane lean onto the whole body
    this.gokul.group.rotation.z = -this.laneLean * 0.22;

    const scaleTarget =
      target === "slide" ? this.tmpA.set(1.08, 0.82, 1.14)
        : target === "landing" ? this.tmpA.set(1.1, 0.9, 1.08)
          : target === "jump" ? this.tmpA.set(0.96, 1.08, 0.96)
            : this.tmpA.set(1, 1, 1);
    this.gokul.group.scale.lerp(scaleTarget, 1 - Math.exp(-12 * dt));

    // stumble wobble after a hit
    if (this.stumble > 0) {
      this.stumble = Math.max(0, this.stumble - dt * 2.4);
      this.gokul.group.rotation.z += Math.sin(this.elapsed * 30) * 0.08 * this.stumble;
    }

    // blink (procedural rig only — the Kenney model has baked eyes)
    if (this.gokul.eyeL) {
      if (Math.sin(this.elapsed * 0.9) > 0.995) {
        this.gokul.eyeL.scale.y = 0.1;
        this.gokul.eyeR!.scale.y = 0.1;
      } else {
        this.gokul.eyeL.scale.y = 1;
        this.gokul.eyeR!.scale.y = 1;
      }
    }
    // hair bounces — subtle, synchronized, and anchored to baseY (no drift)
    if (this.gokul.hair) {
      for (const h of this.gokul.hair) {
        const baseY = (h.userData.baseY as number) ?? 0;
        h.position.y = baseY + Math.sin(this.elapsed * 5) * 0.005;
      }
    }

    // fingers curl with pose (procedural rig only)
    if (this.gokul.fingersL) {
      const curl =
        target === "run" ? 1.0
          : target === "idle" ? 0.3
            : target === "slide" ? 0.6
              : target === "jump" || target === "fall" ? 0.15
                : 0.45;
      for (const f of this.gokul.fingersL) f.rotation.x = -curl;
      for (const f of this.gokul.fingersR!) f.rotation.x = -curl;
    }

    // ---- Nischay: run, or lunge to grab when he catches up ----------------
    const catching = this.gameOverTimer > 0 || this.chaseGap < 2.6;
    const nTarget: AnimState = this.screen === "menu" ? "idle" : catching ? "grab" : "run";
    if (nTarget !== this.nAnim) {
      this.nChar.play(nTarget, 0.2);
      this.nAnim = nTarget;
    }
    this.nChar.setRunScale(THREE.MathUtils.clamp(this.speed / BASE_SPEED, 0.75, 2.1));

    // advance the animation mixers
    this.gChar.update(dt);
    this.nChar.update(dt);
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

    const catchSeq = this.screen === "gameover" || this.gameOverTimer > 0;
    if (catchSeq) {
      // frame the caught moment from the side — Nischay's arms clearly
      // wrapped around Gokul, both characters in frame
      const tx = 1.75;
      const tz = 1.3;
      this.camPos.lerp(this.tmpA.set(tx, 2.0, tz), 1 - Math.exp(-4 * dt));
      this.camLook.lerp(this.tmpB.set(0.0, 1.1, 0.12), 1 - Math.exp(-5 * dt));
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
    this.camera.rotation.z += this.laneLean * 0.035;
    const targetFov = 58 + Math.min(10, (this.speed - BASE_SPEED) * 0.5);
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 3, dt);
    this.camera.updateProjectionMatrix();
  }
}
