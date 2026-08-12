import * as THREE from "three";

/**
 * Skeletal animation system for TIT Campus Run.
 *
 * Every character rig exposes named bone Groups (hips → spine → chest → neck →
 * head, plus arms and legs). The clips below are hand-authored keyframe
 * animations (quaternion tracks per bone) played through a single
 * THREE.AnimationMixer per character, with cross-fades between states so
 * transitions are always smooth:
 *
 *   Idle ⇄ Run → Jump → Fall → Landing → Run
 *   Run ⇄ Slide → Run
 *   Run → Hit → Run
 *   (any) → Caught
 *
 * The run clip is time-scaled to the player's current speed so the stride
 * rate always matches the ground scrolling past.
 */

export const BONES = [
  "hips", "spine", "chest", "neck", "head",
  "upperArmL", "upperArmR", "forearmL", "forearmR", "handL", "handR",
  "thighL", "thighR", "shinL", "shinR", "footL", "footR",
] as const;

export type BoneName = (typeof BONES)[number];

export type AnimState =
  | "idle" | "run" | "jump" | "fall" | "landing" | "slide" | "hit" | "caught" | "grab";

/** Local-space Euler rotations (radians) per bone — positive rx swings back. */
type EulerPose = Partial<Record<BoneName, [number, number, number]>>;

interface ClipKey {
  t: number;
  pose: EulerPose;
  /** Optional local offset for the hips bone (body height / bob). */
  pos?: [number, number, number];
}

const ONE_SHOTS: ReadonlySet<AnimState> = new Set(["landing", "hit"]);

// ------------------------------------------------------------------ clips

function buildClip(name: string, keys: ClipKey[], loop: boolean): THREE.AnimationClip {
  const euler = new THREE.Euler();
  const quat = new THREE.Quaternion();
  const tracks: THREE.KeyframeTrack[] = [];

  for (const bone of BONES) {
    const t: number[] = [];
    const v: number[] = [];
    for (const k of keys) {
      const e = k.pose[bone];
      if (!e) continue;
      t.push(k.t);
      euler.set(e[0], e[1], e[2], "XYZ");
      quat.setFromEuler(euler);
      v.push(quat.x, quat.y, quat.z, quat.w);
    }
    if (t.length) tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, t, v));
  }

  const posKeys = keys.filter((k) => k.pos);
  if (posKeys.length) {
    const t: number[] = [];
    const v: number[] = [];
    for (const k of posKeys) {
      const p = k.pos;
      if (!p) continue;
      t.push(k.t);
      v.push(p[0], p[1], p[2]);
    }
    tracks.push(new THREE.VectorKeyframeTrack("body.position", t, v));
  }

  const duration = keys[keys.length - 1].t;
  const clip = new THREE.AnimationClip(name, loop ? duration : undefined, tracks);
  if (!loop) clip.duration = duration;
  return clip;
}

/** Shortcut: one pose, optionally wrapped to loop back to itself. */
function loopClip(name: string, period: number, keys: ClipKey[]): THREE.AnimationClip {
  const full = [...keys];
  // wrap: duplicate the first key at the end for a seamless loop
  full.push({ t: period, pose: keys[0].pose, pos: keys[0].pos });
  return buildClip(name, full, true);
}

// ------------------------------------------------------- idle (2.6s loop)

const idle = loopClip("idle", 2.6, [
  {
    t: 0,
    pose: {
      hips: [0.02, 0, 0.03],
      chest: [0.03, 0, -0.02],
      neck: [0.05, 0, 0],
      head: [0.03, -0.35, 0],
      upperArmL: [0, 0, 0.14],
      upperArmR: [0, 0, -0.14],
      forearmL: [0, 0, -0.5],
      forearmR: [0, 0, 0.5],
      handL: [0, 0, 0.12],
      handR: [0, 0, -0.12],
      thighL: [0.05, 0, 0],
      thighR: [-0.03, 0, 0],
    },
    pos: [0, 0, 0],
  },
  {
    t: 1.3,
    pose: {
      hips: [-0.02, 0, -0.03],
      chest: [0.05, 0, 0.02],
      neck: [0.03, 0, 0],
      head: [0.01, 0.35, 0],
      upperArmL: [0, 0, 0.12],
      upperArmR: [0, 0, -0.12],
      forearmL: [0, 0, -0.45],
      forearmR: [0, 0, 0.45],
      handL: [0, 0, 0.1],
      handR: [0, 0, -0.1],
      thighL: [-0.03, 0, 0],
      thighR: [0.05, 0, 0],
    },
    pos: [0, 0, 0],
  },
]);

// -------------------------------------------------------- run (0.55s loop)

const run = loopClip("run", 0.55, [
  {
    t: 0,
    pose: {
      thighL: [0.85, 0, 0], thighR: [-0.72, 0, 0],
      shinL: [1.25, 0, 0], shinR: [0.18, 0, 0],
      footL: [-0.35, 0, 0], footR: [0.12, 0, 0],
      upperArmL: [-0.72, 0, 0.14], upperArmR: [0.72, 0, -0.14],
      forearmL: [-0.55, 0, 0], forearmR: [-1.05, 0, 0],
      handL: [0, 0, -0.35], handR: [0, 0, 0.35],
      hips: [0.06, 0.14, 0], spine: [0, 0, 0.02], chest: [0.14, 0, 0.05],
      neck: [-0.12, 0, 0], head: [-0.08, 0, -0.05],
    },
    pos: [0, 0, 0],
  },
  {
    t: 0.1375,
    pose: {
      thighL: [0.05, 0, 0], thighR: [-0.05, 0, 0],
      shinL: [0.95, 0, 0], shinR: [0.95, 0, 0],
      footL: [-0.2, 0, 0], footR: [-0.2, 0, 0],
      upperArmL: [0, 0, 0.14], upperArmR: [0, 0, -0.14],
      forearmL: [-0.8, 0, 0], forearmR: [-0.8, 0, 0],
      handL: [0, 0, -0.35], handR: [0, 0, 0.35],
      hips: [0.04, 0, 0], spine: [0, 0, 0], chest: [0.16, 0, 0],
      neck: [-0.12, 0, 0], head: [-0.08, 0, 0],
    },
    pos: [0, 0.05, 0],
  },
  {
    t: 0.275,
    pose: {
      thighL: [-0.72, 0, 0], thighR: [0.85, 0, 0],
      shinL: [0.18, 0, 0], shinR: [1.25, 0, 0],
      footL: [0.12, 0, 0], footR: [-0.35, 0, 0],
      upperArmL: [0.72, 0, 0.14], upperArmR: [-0.72, 0, -0.14],
      forearmL: [-1.05, 0, 0], forearmR: [-0.55, 0, 0],
      handL: [0, 0, -0.35], handR: [0, 0, 0.35],
      hips: [0.06, -0.14, 0], spine: [0, 0, -0.02], chest: [0.14, 0, -0.05],
      neck: [-0.12, 0, 0], head: [-0.08, 0, 0.05],
    },
    pos: [0, 0, 0],
  },
  {
    t: 0.4125,
    pose: {
      thighL: [-0.05, 0, 0], thighR: [0.05, 0, 0],
      shinL: [0.95, 0, 0], shinR: [0.95, 0, 0],
      footL: [-0.2, 0, 0], footR: [-0.2, 0, 0],
      upperArmL: [0, 0, 0.14], upperArmR: [0, 0, -0.14],
      forearmL: [-0.8, 0, 0], forearmR: [-0.8, 0, 0],
      handL: [0, 0, -0.35], handR: [0, 0, 0.35],
      hips: [0.04, 0, 0], spine: [0, 0, 0], chest: [0.16, 0, 0],
      neck: [-0.12, 0, 0], head: [-0.08, 0, 0],
    },
    pos: [0, 0.05, 0],
  },
]);

// ------------------------------------------------------- jump (0.6s loop)

const jump = loopClip("jump", 0.6, [
  {
    t: 0,
    pose: {
      hips: [0.12, 0, 0], chest: [0.1, 0, 0], neck: [-0.1, 0, 0], head: [-0.25, 0, 0],
      thighL: [-1.05, 0, 0], thighR: [-1.05, 0, 0],
      shinL: [1.25, 0, 0], shinR: [1.25, 0, 0],
      footL: [-0.5, 0, 0], footR: [-0.5, 0, 0],
      upperArmL: [-1.85, 0, 0.12], upperArmR: [-1.85, 0, -0.12],
      forearmL: [-0.45, 0, 0], forearmR: [-0.45, 0, 0],
      handL: [0, 0, 0.2], handR: [0, 0, -0.2],
    },
    pos: [0, 0.06, 0],
  },
  {
    t: 0.3,
    pose: {
      hips: [0.1, 0, 0], chest: [0.08, 0, 0.04], neck: [-0.12, 0, 0], head: [-0.2, 0, 0.06],
      thighL: [-1.0, 0, 0], thighR: [-1.1, 0, 0],
      shinL: [1.3, 0, 0], shinR: [1.2, 0, 0],
      footL: [-0.45, 0, 0], footR: [-0.55, 0, 0],
      upperArmL: [-1.7, 0, 0.16], upperArmR: [-2.0, 0, -0.08],
      forearmL: [-0.5, 0, 0], forearmR: [-0.4, 0, 0],
      handL: [0, 0, 0.2], handR: [0, 0, -0.2],
    },
    pos: [0, 0.05, 0],
  },
]);

// -------------------------------------------------------- fall (0.7s loop)

const fall = loopClip("fall", 0.7, [
  {
    t: 0,
    pose: {
      hips: [-0.06, 0, 0], chest: [-0.12, 0, 0], neck: [0.2, 0, 0], head: [0.18, 0, 0],
      thighL: [0.35, 0, 0], thighR: [-0.1, 0, 0],
      shinL: [0.45, 0, 0], shinR: [0.35, 0, 0],
      footL: [-0.5, 0, 0], footR: [-0.35, 0, 0],
      upperArmL: [-1.3, 0, 0.5], upperArmR: [-1.15, 0, -0.45],
      forearmL: [-0.6, 0, 0], forearmR: [-0.7, 0, 0],
    },
    pos: [0, 0.02, 0],
  },
  {
    t: 0.35,
    pose: {
      hips: [-0.04, 0, 0], chest: [-0.1, 0, 0.03], neck: [0.22, 0, 0], head: [0.15, 0, 0.05],
      thighL: [-0.1, 0, 0], thighR: [0.35, 0, 0],
      shinL: [0.35, 0, 0], shinR: [0.45, 0, 0],
      footL: [-0.35, 0, 0], footR: [-0.5, 0, 0],
      upperArmL: [-1.15, 0, 0.42], upperArmR: [-1.3, 0, -0.52],
      forearmL: [-0.7, 0, 0], forearmR: [-0.6, 0, 0],
    },
    pos: [0, 0.01, 0],
  },
]);

// -------------------------------------------------- landing (0.32s once)

const landing = buildClip("landing", [
  {
    t: 0,
    pose: {
      hips: [0.1, 0, 0], chest: [0.02, 0, 0], neck: [-0.1, 0, 0], head: [0.15, 0, 0],
      thighL: [-0.25, 0, 0], thighR: [-0.25, 0, 0],
      shinL: [0.35, 0, 0], shinR: [0.35, 0, 0],
      footL: [-0.15, 0, 0], footR: [-0.15, 0, 0],
      upperArmL: [-1.2, 0, 0.3], upperArmR: [-1.2, 0, -0.3],
      forearmL: [-0.5, 0, 0], forearmR: [-0.5, 0, 0],
    },
    pos: [0, 0, 0],
  },
  {
    t: 0.14,
    pose: {
      hips: [0.2, 0, 0], chest: [0.32, 0, 0], neck: [-0.2, 0, 0], head: [0.05, 0, 0],
      thighL: [-0.85, 0, 0], thighR: [-0.85, 0, 0],
      shinL: [1.0, 0, 0], shinR: [1.0, 0, 0],
      footL: [-0.3, 0, 0], footR: [-0.3, 0, 0],
      upperArmL: [0.35, 0, 0.7], upperArmR: [0.35, 0, -0.7],
      forearmL: [-0.9, 0, 0], forearmR: [-0.9, 0, 0],
    },
    pos: [0, -0.16, 0],
  },
  {
    t: 0.32,
    pose: {
      hips: [0.08, 0, 0], chest: [0.18, 0, 0], neck: [-0.14, 0, 0], head: [0.1, 0, 0],
      thighL: [-0.35, 0, 0], thighR: [-0.35, 0, 0],
      shinL: [0.55, 0, 0], shinR: [0.55, 0, 0],
      footL: [-0.2, 0, 0], footR: [-0.2, 0, 0],
      upperArmL: [-0.6, 0, 0.35], upperArmR: [-0.6, 0, -0.35],
      forearmL: [-0.7, 0, 0], forearmR: [-0.7, 0, 0],
    },
    pos: [0, 0.02, 0],
  },
], false);

// ------------------------------------------------------- slide (0.8s loop)

const slide = loopClip("slide", 0.8, [
  {
    t: 0,
    pose: {
      hips: [-0.95, 0, 0], chest: [0.8, 0, 0], neck: [-0.35, 0, 0], head: [-0.2, 0, 0],
      thighL: [-0.95, 0, 0], thighR: [-1.15, 0, 0],
      shinL: [0.65, 0, 0], shinR: [0.85, 0, 0],
      footL: [-0.15, 0, 0], footR: [-0.15, 0, 0],
      upperArmL: [0.85, 0, 0.4], upperArmR: [0.85, 0, -0.4],
      forearmL: [-0.6, 0, 0], forearmR: [-0.6, 0, 0],
    },
    pos: [0, -0.2, 0],
  },
  {
    t: 0.4,
    pose: {
      hips: [-0.97, 0, 0], chest: [0.78, 0, 0.03], neck: [-0.37, 0, 0], head: [-0.22, 0, 0.04],
      thighL: [-1.15, 0, 0], thighR: [-0.95, 0, 0],
      shinL: [0.85, 0, 0], shinR: [0.65, 0, 0],
      footL: [-0.15, 0, 0], footR: [-0.15, 0, 0],
      upperArmL: [0.8, 0, 0.45], upperArmR: [0.8, 0, -0.45],
      forearmL: [-0.55, 0, 0], forearmR: [-0.55, 0, 0],
    },
    pos: [0, -0.18, 0],
  },
]);

// ---------------------------------------------------------- hit (0.55s once)

const hit = buildClip("hit", [
  {
    t: 0,
    pose: {
      hips: [0.04, 0, 0], chest: [0.16, 0, 0], neck: [-0.12, 0, 0], head: [-0.08, 0, 0],
      thighL: [-0.2, 0, 0], thighR: [0.2, 0, 0],
      shinL: [0.5, 0, 0], shinR: [0.5, 0, 0],
      upperArmL: [-0.3, 0, 0.2], upperArmR: [-0.3, 0, -0.2],
      forearmL: [-0.8, 0, 0], forearmR: [-0.8, 0, 0],
    },
    pos: [0, 0, 0],
  },
  {
    t: 0.09,
    pose: {
      hips: [0.3, 0, 0], chest: [-0.35, 0, 0], neck: [0.15, 0, 0], head: [0.4, 0, 0.08],
      thighL: [0.5, 0, 0], thighR: [0.45, 0, 0],
      shinL: [0.6, 0, 0], shinR: [0.55, 0, 0],
      upperArmL: [-1.0, 0, 0.9], upperArmR: [0.5, 0, -0.4],
      forearmL: [-0.9, 0, 0], forearmR: [-0.9, 0, 0],
      handL: [0, 0, 0.3], handR: [0, 0, -0.3],
    },
    pos: [0, 0.02, 0],
  },
  {
    t: 0.27,
    pose: {
      hips: [-0.2, 0, 0], chest: [0.3, 0, 0], neck: [-0.15, 0, 0], head: [-0.1, 0, -0.08],
      thighL: [-0.5, 0, 0], thighR: [-0.55, 0, 0],
      shinL: [0.85, 0, 0], shinR: [0.9, 0, 0],
      upperArmL: [0.45, 0, -0.5], upperArmR: [-0.95, 0, 0.8],
      forearmL: [-0.95, 0, 0], forearmR: [-0.85, 0, 0],
      handL: [0, 0, -0.3], handR: [0, 0, 0.3],
    },
    pos: [0, -0.03, 0],
  },
  {
    t: 0.42,
    pose: {
      hips: [0.05, 0, 0], chest: [0.18, 0, 0], neck: [-0.12, 0, 0], head: [-0.08, 0, 0],
      thighL: [-0.25, 0, 0], thighR: [0.15, 0, 0],
      shinL: [0.6, 0, 0], shinR: [0.55, 0, 0],
      upperArmL: [-0.35, 0, 0.2], upperArmR: [-0.3, 0, -0.2],
      forearmL: [-0.85, 0, 0], forearmR: [-0.8, 0, 0],
    },
    pos: [0, 0.01, 0],
  },
], false);

// ------------------------------------------------------ caught (1.6s loop)
// Gokul caught from behind — bent forward at the waist, braced on his
// knees, while Nischay closes right in behind him (fully clothed, comedic
// "caught mid-run" pose).

const caught = loopClip("caught", 1.6, [
  {
    t: 0,
    pose: {
      // bend at the WAIST (spine) so the torso stays connected to the hips
      hips: [0.2, 0, 0], spine: [0.95, 0, 0], chest: [0.45, 0, 0], neck: [0.3, 0, 0], head: [-0.15, 0, 0.06],
      upperArmL: [-1.2, 0, 0.4], upperArmR: [-1.2, 0, -0.4],
      forearmL: [-1.0, 0, 0], forearmR: [-1.0, 0, 0],
      handL: [0, 0, 0.3], handR: [0, 0, -0.3],
      thighL: [0.45, 0, 0], thighR: [0.45, 0, 0],
      shinL: [0.5, 0, 0], shinR: [0.5, 0, 0],
      footL: [-0.12, 0, 0], footR: [-0.12, 0, 0],
    },
    pos: [0, -0.1, -0.07], // bent over, pulled back toward Nischay
  },
  {
    t: 0.8,
    pose: {
      hips: [0.24, 0, 0], spine: [0.91, 0, 0.03], chest: [0.48, 0, 0.03], neck: [0.28, 0, 0], head: [-0.18, 0, -0.06],
      upperArmL: [-1.25, 0, 0.45], upperArmR: [-1.15, 0, -0.35],
      forearmL: [-0.95, 0, 0], forearmR: [-1.05, 0, 0],
      handL: [0, 0, 0.35], handR: [0, 0, -0.25],
      thighL: [0.4, 0, 0], thighR: [0.5, 0, 0],
      shinL: [0.45, 0, 0], shinR: [0.55, 0, 0],
      footL: [-0.1, 0, 0], footR: [-0.14, 0, 0],
    },
    pos: [0, -0.12, -0.06],
  },
]);

// --------------------------------------------------------- grab (1.0s loop)
// Nischay right behind Gokul, leaning in with both hands on Gokul's hips.

const grab = loopClip("grab", 1.0, [
  {
    t: 0,
    pose: {
      hips: [0.18, 0, 0], chest: [0.5, 0, 0], neck: [-0.22, 0, 0], head: [-0.28, 0, 0.05],
      upperArmL: [-0.85, 0, 0.4], upperArmR: [-0.85, 0, -0.4],
      forearmL: [-0.55, 0, 0], forearmR: [-0.55, 0, 0],
      handL: [0, 0, 0.45], handR: [0, 0, -0.45],
      thighL: [0.35, 0, 0], thighR: [0.35, 0, 0],
      shinL: [0.3, 0, 0], shinR: [0.3, 0, 0],
      footL: [-0.15, 0, 0], footR: [-0.15, 0, 0],
    },
    pos: [0, -0.02, 0.08], // closing in behind Gokul
  },
  {
    t: 0.5,
    pose: {
      hips: [0.22, 0, 0], chest: [0.48, 0, 0.03], neck: [-0.25, 0, 0], head: [-0.32, 0, -0.05],
      upperArmL: [-0.8, 0, 0.45], upperArmR: [-0.9, 0, -0.35],
      forearmL: [-0.5, 0, 0], forearmR: [-0.6, 0, 0],
      handL: [0, 0, 0.5], handR: [0, 0, -0.4],
      thighL: [0.3, 0, 0], thighR: [0.4, 0, 0],
      shinL: [0.25, 0, 0], shinR: [0.35, 0, 0],
      footL: [-0.12, 0, 0], footR: [-0.18, 0, 0],
    },
    pos: [0, -0.03, 0.06],
  },
]);

export const CLIPS: Record<AnimState, THREE.AnimationClip> = {
  idle, run, jump, fall, landing, slide, hit, caught, grab,
};

// ------------------------------------------------------- character wrapper

export class RiggedCharacter {
  readonly root: THREE.Group;
  readonly mixer: THREE.AnimationMixer;
  readonly actions: Record<AnimState, THREE.AnimationAction>;
  state: AnimState = "idle";

  constructor(root: THREE.Group) {
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    const actions = {} as Record<AnimState, THREE.AnimationAction>;
    const states: AnimState[] = [
      "idle", "run", "jump", "fall", "landing", "slide", "hit", "caught", "grab",
    ];
    for (const s of states) {
      const act = this.mixer.clipAction(CLIPS[s]);
      act.setEffectiveWeight(s === "idle" ? 1 : 0);
      act.setEffectiveTimeScale(1);
      if (ONE_SHOTS.has(s)) {
        act.loop = THREE.LoopOnce;
        act.clampWhenFinished = true;
      }
      actions[s] = act;
    }
    this.actions = actions;
    actions.idle.play();
  }

  /** Cross-fade into `state`. One-shot states replay if they already finished. */
  play(state: AnimState, fade = 0.16) {
    const to = this.actions[state];
    if (state === this.state) {
      if (to.isRunning()) return;
      to.reset();
      to.play();
      return;
    }
    const from = this.actions[this.state];
    to.reset();
    to.setEffectiveWeight(1);
    to.play();
    from.crossFadeTo(to, fade, true);
    this.state = state;
  }

  /** Jump straight to a state with no blend (start / reset). */
  snap(state: AnimState) {
    for (const s of Object.keys(this.actions) as AnimState[]) {
      const a = this.actions[s];
      a.setEffectiveWeight(s === state ? 1 : 0);
      if (s === state) {
        a.reset();
        a.play();
      } else {
        a.stop();
      }
    }
    this.state = state;
  }

  /** Scale run-cadence to the player's current speed (BASE_SPEED = 1). */
  setRunScale(s: number) {
    this.actions.run.timeScale = s;
  }

  update(dt: number) {
    this.mixer.update(dt);
  }
}
