import * as THREE from "three";
import type { AnimState } from "./animations";

/**
 * Kenney-native animation clips for the player character.
 *
 * The imported Kenney model (see kenneyCharacter.ts) has its own rig with real
 * rest orientations, real joint offsets and a non-uniform internal scale. The
 * earlier approach retargeted hand-authored clips through a fake "scaffold"
 * rig, which needed mirror hacks and broke as soon as a bone carried a large
 * rest rotation (the shoulder) — the arm never swung from the shoulder and
 * the elbow flipped around.
 *
 * This module instead AUTHORES the clips DIRECTLY on the Kenney skeleton:
 * the rest geometry (world rotations, child directions, world-space segment
 * lengths) is measured from the loaded skeleton once, then every keyframe is
 * solved with two-bone IK in the skeleton's own frame and written back as
 * local quaternions for the real bone names. No scaffold, no retarget, no
 * mirroring beyond the authored pose data (the pose keys are written in the
 * old rig's convention, left = −X; the Kenney frame is left = +X, so targets
 * get their X mirrored and yaw/roll eulers get negated here).
 *
 * Pose-key space used below: up = +Y, face/forward = +Z, left foot at −X.
 */

type V3 = [number, number, number];
type Euler = [number, number, number];

interface TorsoPose {
  hips?: Euler;
  spine?: Euler;
  chest?: Euler;
  neck?: Euler;
  head?: Euler;
}

interface LimbsKey {
  /** World-space ankle targets (relative to the body origin, before lean). */
  footL: V3;
  footR: V3;
  /** Toe pitch (radians) — positive dips the toes down toward the road. */
  footRxL?: number;
  footRxR?: number;
  /** World-space WRIST targets (the hand bone hangs beyond the wrist). */
  handL: V3;
  handR: V3;
}

interface PoseKey {
  t: number;
  torso: TorsoPose;
  limbs: LimbsKey;
  /** Vertical body bob / drop (drives the "body.position" track). */
  bob?: number;
}

// ------------------------------------------------------------------ clips

const RUN: PoseKey[] = [
  {
    t: 0,
    torso: { hips: [0.06, 0.14, 0], spine: [0, 0, 0.02], chest: [0.14, 0, 0.05], neck: [-0.12, 0, 0], head: [-0.08, 0, -0.05] },
    limbs: {
      footL: [-0.13, 0.3, -0.35], footRxL: -0.12, // behind, heel lifting
      footR: [0.13, 0.05, 0.35], footRxR: 0.2, // forward, planting
      handL: [-0.27, 1.36, 0.28], handR: [0.27, 1.36, -0.28],
    },
    bob: 0,
  },
  {
    t: 0.1375,
    torso: { hips: [0.04, 0, 0], spine: [0, 0, 0], chest: [0.16, 0, 0], neck: [-0.12, 0, 0], head: [-0.08, 0, 0] },
    limbs: {
      footL: [-0.13, 0.35, 0.0], footRxL: -0.05, // swinging under the body
      footR: [0.13, 0.05, 0.12], footRxR: 0.05, // stance, pushing
      handL: [-0.27, 1.37, 0.0], handR: [0.27, 1.37, 0.0],
    },
    bob: 0.04,
  },
  {
    t: 0.275,
    torso: { hips: [0.06, -0.14, 0], spine: [0, 0, -0.02], chest: [0.14, 0, -0.05], neck: [-0.12, 0, 0], head: [-0.08, 0, 0.05] },
    limbs: {
      footL: [-0.13, 0.05, 0.35], footRxL: 0.2, // forward, planting
      footR: [0.13, 0.3, -0.35], footRxR: -0.12, // behind, lifting
      handL: [-0.27, 1.36, -0.28], handR: [0.27, 1.36, 0.28],
    },
    bob: 0,
  },
  {
    t: 0.4125,
    torso: { hips: [0.04, 0, 0], spine: [0, 0, 0], chest: [0.16, 0, 0], neck: [-0.12, 0, 0], head: [-0.08, 0, 0] },
    limbs: {
      footL: [-0.13, 0.05, 0.12], footRxL: 0.05, // stance
      footR: [0.13, 0.35, 0.0], footRxR: -0.05, // swinging
      handL: [-0.27, 1.37, 0.0], handR: [0.27, 1.37, 0.0],
    },
    bob: 0.04,
  },
];

const JUMP: PoseKey[] = [
  {
    t: 0,
    torso: { hips: [0.12, 0, 0], chest: [0.1, 0, 0], neck: [-0.1, 0, 0], head: [-0.25, 0, 0] },
    limbs: {
      footL: [-0.12, 0.5, 0.05], footRxL: 0.15, // knees tucked up
      footR: [0.12, 0.5, 0.05], footRxR: 0.15,
      handL: [-0.35, 1.75, -0.05], handR: [0.35, 1.75, -0.05],
    },
    bob: 0.06,
  },
  {
    t: 0.3,
    torso: { hips: [0.1, 0, 0], chest: [0.08, 0, 0.04], neck: [-0.12, 0, 0], head: [-0.2, 0, 0.06] },
    limbs: {
      footL: [-0.12, 0.45, 0.12], footRxL: 0.1,
      footR: [0.12, 0.5, -0.05], footRxR: 0.18,
      handL: [-0.38, 1.7, 0.05], handR: [0.38, 1.72, -0.08],
    },
    bob: 0.05,
  },
];

const FALL: PoseKey[] = [
  {
    t: 0,
    torso: { hips: [-0.06, 0, 0], chest: [-0.12, 0, 0], neck: [0.2, 0, 0], head: [0.18, 0, 0] },
    limbs: {
      footL: [-0.13, 0.2, 0.4], footRxL: -0.2, // reaching forward-down
      footR: [0.13, 0.2, 0.4], footRxR: -0.2,
      handL: [-0.45, 1.35, 0.1], handR: [0.45, 1.35, 0.1],
    },
    bob: 0.02,
  },
  {
    t: 0.35,
    torso: { hips: [-0.04, 0, 0], chest: [-0.1, 0, 0.03], neck: [0.22, 0, 0], head: [0.15, 0, 0.05] },
    limbs: {
      footL: [-0.13, 0.18, 0.45], footRxL: -0.25,
      footR: [0.13, 0.18, 0.45], footRxR: -0.25,
      handL: [-0.5, 1.3, 0.15], handR: [0.5, 1.3, 0.15],
    },
    bob: 0.01,
  },
];

const LANDING: PoseKey[] = [
  {
    t: 0,
    torso: { hips: [0.1, 0, 0], chest: [0.02, 0, 0], neck: [-0.1, 0, 0], head: [0.15, 0, 0] },
    limbs: {
      footL: [-0.15, 0.05, -0.1], footRxL: 0.15,
      footR: [0.15, 0.05, -0.1], footRxR: 0.15,
      handL: [-0.3, 1.25, 0.15], handR: [0.3, 1.25, 0.15],
    },
    bob: 0,
  },
  {
    t: 0.14,
    torso: { hips: [0.2, 0, 0], chest: [0.32, 0, 0], neck: [-0.2, 0, 0], head: [0.05, 0, 0] },
    limbs: {
      footL: [-0.15, 0.05, -0.05], footRxL: 0.1,
      footR: [0.15, 0.05, -0.05], footRxR: 0.1,
      handL: [-0.3, 1.15, 0.1], handR: [0.3, 1.15, 0.1],
    },
    bob: -0.16, // deep knee-bend absorbing the impact
  },
  {
    t: 0.32,
    torso: { hips: [0.08, 0, 0], chest: [0.18, 0, 0], neck: [-0.14, 0, 0], head: [0.1, 0, 0] },
    limbs: {
      footL: [-0.13, 0.05, -0.02], footRxL: 0.05,
      footR: [0.13, 0.05, -0.02], footRxR: 0.05,
      handL: [-0.3, 1.2, 0.1], handR: [0.3, 1.2, 0.1],
    },
    bob: 0.02,
  },
];

const SLIDE: PoseKey[] = [
  {
    t: 0,
    torso: { hips: [-0.85, 0, 0], chest: [0.55, 0, 0], neck: [-0.3, 0, 0], head: [-0.1, 0, 0] },
    limbs: {
      footL: [-0.13, 0.1, 0.55], footRxL: 0.25, // legs stretched forward, low
      footR: [0.13, 0.1, 0.55], footRxR: 0.25,
      handL: [-0.28, 1.32, -0.28], handR: [0.28, 1.32, -0.28],
    },
    bob: -0.18,
  },
  {
    t: 0.4,
    torso: { hips: [-0.87, 0, 0.03], chest: [0.53, 0, 0.03], neck: [-0.32, 0, 0], head: [-0.12, 0, 0.04] },
    limbs: {
      footL: [-0.13, 0.12, 0.5], footRxL: 0.2,
      footR: [0.13, 0.12, 0.5], footRxR: 0.2,
      handL: [-0.28, 1.34, -0.24], handR: [0.28, 1.34, -0.24],
    },
    bob: -0.16,
  },
];

const HIT: PoseKey[] = [
  {
    t: 0,
    torso: { hips: [0.04, 0, 0], chest: [0.16, 0, 0], neck: [-0.12, 0, 0], head: [-0.08, 0, 0] },
    limbs: {
      footL: [-0.13, 0.08, -0.1], footRxL: 0.1,
      footR: [0.13, 0.08, -0.1], footRxR: 0.1,
      handL: [-0.3, 1.25, 0.0], handR: [0.3, 1.25, 0.0],
    },
    bob: 0,
  },
  {
    t: 0.09,
    torso: { hips: [0.3, 0, 0], chest: [-0.35, 0, 0], neck: [0.15, 0, 0], head: [0.4, 0, 0.08] },
    limbs: {
      footL: [-0.13, 0.08, -0.15], footRxL: 0.1,
      footR: [0.13, 0.08, -0.15], footRxR: 0.1,
      handL: [-0.4, 1.45, 0.15], handR: [0.3, 1.25, -0.2],
    },
    bob: 0.02,
  },
  {
    t: 0.27,
    torso: { hips: [-0.2, 0, 0], chest: [0.3, 0, 0], neck: [-0.15, 0, 0], head: [-0.1, 0, -0.08] },
    limbs: {
      footL: [-0.13, 0.08, -0.12], footRxL: 0.1,
      footR: [0.13, 0.08, -0.12], footRxR: 0.1,
      handL: [0.3, 1.25, -0.15], handR: [-0.4, 1.4, 0.1],
    },
    bob: -0.03,
  },
  {
    t: 0.42,
    torso: { hips: [0.05, 0, 0], chest: [0.18, 0, 0], neck: [-0.12, 0, 0], head: [-0.08, 0, 0] },
    limbs: {
      footL: [-0.13, 0.08, -0.08], footRxL: 0.1,
      footR: [0.13, 0.08, -0.08], footRxR: 0.1,
      handL: [-0.3, 1.25, 0.0], handR: [0.3, 1.25, 0.0],
    },
    bob: 0.01,
  },
];

const CAUGHT: PoseKey[] = [
  {
    t: 0,
    torso: { hips: [0.2, 0, 0], spine: [0.95, 0, 0], chest: [0.45, 0, 0], neck: [0.3, 0, 0], head: [-0.15, 0, 0.06] },
    limbs: {
      footL: [-0.13, 0.1, -0.08], footRxL: 0.1,
      footR: [0.13, 0.1, -0.08], footRxR: 0.1,
      handL: [-0.3, 1.2, 0.2], handR: [0.3, 1.2, 0.2], // braced forward-down
    },
    bob: -0.1,
  },
  {
    t: 0.8,
    torso: { hips: [0.24, 0, 0], spine: [0.91, 0, 0.03], chest: [0.48, 0, 0.03], neck: [0.28, 0, 0], head: [-0.18, 0, -0.06] },
    limbs: {
      footL: [-0.13, 0.1, -0.06], footRxL: 0.1,
      footR: [0.13, 0.1, -0.06], footRxR: 0.1,
      handL: [-0.3, 1.22, 0.18], handR: [0.3, 1.22, 0.18],
    },
    bob: -0.12,
  },
];

const GRAB: PoseKey[] = [
  {
    t: 0,
    torso: { hips: [0.18, 0, 0], chest: [0.5, 0, 0], neck: [-0.22, 0, 0], head: [-0.28, 0, 0.05] },
    limbs: {
      footL: [-0.15, 0.1, -0.2], footRxL: 0.1,
      footR: [0.15, 0.1, -0.2], footRxR: 0.1,
      handL: [-0.28, 1.3, 0.25], handR: [0.28, 1.3, 0.25], // reaching forward
    },
    bob: -0.02,
  },
  {
    t: 0.5,
    torso: { hips: [0.22, 0, 0], chest: [0.48, 0, 0.03], neck: [-0.25, 0, 0], head: [-0.32, 0, -0.05] },
    limbs: {
      footL: [-0.15, 0.1, -0.18], footRxL: 0.1,
      footR: [0.15, 0.1, -0.18], footRxR: 0.1,
      handL: [-0.28, 1.32, 0.22], handR: [0.28, 1.32, 0.22],
    },
    bob: -0.03,
  },
];

const SOURCES: Record<Exclude<AnimState, "idle">, PoseKey[]> = {
  run: RUN,
  jump: JUMP,
  fall: FALL,
  landing: LANDING,
  slide: SLIDE,
  hit: HIT,
  caught: CAUGHT,
  grab: GRAB,
};

// -------------------------------------------------------------------- IK

/**
 * Two-bone IK: given the joint origin, a world-space target and the two
 * segment lengths, returns unit directions for both segments. `bendDir`
 * selects which side of the origin→target line the middle joint goes
 * (knees point forward, elbows point backward).
 */
function twoBoneIK(
  origin: THREE.Vector3,
  target: THREE.Vector3,
  lenA: number,
  lenB: number,
  bendDir: THREE.Vector3,
): { dirA: THREE.Vector3; dirB: THREE.Vector3 } {
  const toT = new THREE.Vector3().copy(target).sub(origin);
  const d = toT.length();
  const dClamped = THREE.MathUtils.clamp(d, Math.abs(lenA - lenB) + 0.02, lenA + lenB - 0.02);
  const dir = toT.normalize();
  const along = (lenA * lenA - lenB * lenB + dClamped * dClamped) / (2 * dClamped);
  const mid = new THREE.Vector3().copy(origin).addScaledVector(dir, along);

  const perp = new THREE.Vector3().copy(bendDir).addScaledVector(dir, -bendDir.dot(dir));
  const perpLen = perp.length();
  perp.normalize();
  const h = Math.sqrt(Math.max(0, lenA * lenA - along * along));
  const knee = perp.clone().multiplyScalar(perpLen > 1e-6 ? h : 0).add(mid);

  const dirA = knee.clone().sub(origin).normalize();
  const dirB = target.clone().sub(knee).normalize();
  return { dirA, dirB };
}

// ------------------------------------------------------------ skeleton rest

/**
 * Rest measurements taken from the REAL skeleton so the IK solves against the
 * exact geometry the mesh is skinned to.
 */
export interface KenneyRestData {
  /** Animated chain: Hips, Spine, Chest, Neck, Head (+ UpperChest as a rest child of Chest). */
  torso: Record<"Hips" | "Spine" | "Chest" | "Neck" | "Head" | "UpperChest" | "HipsCtrl", RestBone>;
  /** IK chains: Left/Right Shoulder→Arm→ForeArm, Left/Right UpLeg→Leg→Foot.
   *  The mid bones carry childDir/segLen; the end bones (foreL/foreR/footL/
   *  footR) are plain rest bones the IK targets and pitches. */
  chains: Record<
    "shoulderL" | "armL" | "shoulderR" | "armR" | "thighL" | "shinL" | "thighR" | "shinR",
    ChainBone
  > & Record<"foreL" | "foreR" | "footL" | "footR", RestBone>;
}

export interface RestBone {
  restWorld: THREE.Quaternion;
  restLocal: THREE.Quaternion;
  restPos: THREE.Vector3;
  /** Name of this bone's actual parent in the skeleton ("" for the root). */
  parentName: string;
}

export interface ChainBone extends RestBone {
  /** Rest world direction toward the next joint (unit). */
  childDir: THREE.Vector3;
  /** World-space segment length to the next joint. */
  segLen: number;
}

/** Extract the rest measurements from the loaded skeleton. */
export function measureKenneyRest(getBone: (name: string) => THREE.Bone | null): KenneyRestData {
  const q = (b: THREE.Bone) => {
    const w = new THREE.Quaternion();
    b.getWorldQuaternion(w);
    return w;
  };
  const p = (b: THREE.Bone) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);

  const mk = (name: string): RestBone => {
    const b = getBone(name);
    if (!b) throw new Error(`Kenney skeleton missing rest bone: ${name}`);
    const parent = b.parent as THREE.Bone | null;
    return {
      restWorld: q(b),
      restLocal: b.quaternion.clone(),
      restPos: p(b),
      parentName: parent && parent.isBone ? parent.name : "",
    };
  };

  const chain = (boneName: string, childName: string): ChainBone => {
    const a = mk(boneName);
    const b = mk(childName);
    return {
      ...a,
      childDir: new THREE.Vector3().subVectors(b.restPos, a.restPos).normalize(),
      segLen: a.restPos.distanceTo(b.restPos),
    };
  };

  const Hips = mk("Hips");
  const Spine = mk("Spine");
  const Chest = mk("Chest");
  const UpperChest = mk("UpperChest");
  const Neck = mk("Neck");
  const Head = mk("Head");
  const HipsCtrl = mk("HipsCtrl");

  return {
    torso: { Hips, Spine, Chest, Neck, Head, UpperChest, HipsCtrl },
    chains: {
      shoulderL: chain("LeftShoulder", "LeftArm"),
      armL: chain("LeftArm", "LeftForeArm"),
      foreL: mk("LeftForeArm"),
      shoulderR: chain("RightShoulder", "RightArm"),
      armR: chain("RightArm", "RightForeArm"),
      foreR: mk("RightForeArm"),
      thighL: chain("LeftUpLeg", "LeftLeg"),
      shinL: chain("LeftLeg", "LeftFoot"),
      footL: mk("LeftFoot"),
      thighR: chain("RightUpLeg", "RightLeg"),
      shinR: chain("RightLeg", "RightFoot"),
      footR: mk("RightFoot"),
    },
  };
}

// ----------------------------------------------------------------- emit

const FWD = new THREE.Vector3(0, 0, 1);
const BACK = new THREE.Vector3(0, 0, -1);

/** The pose keys are authored at 1.75 m scale in the old frame (left = −X);
 *  the skeleton is smaller and left = +X, so targets are X-mirrored and
 *  scaled into the skeleton's own rest frame (hips/ground aligned). */
const toSkel = (v: V3, s: number, dy: number): THREE.Vector3 =>
  new THREE.Vector3(-v[0] * s, v[1] * s + dy, v[2] * s);

function eulerQuat(e: Euler, out: THREE.Quaternion): THREE.Quaternion {
  const eu = new THREE.Euler(e[0], -e[1], -e[2], "XYZ"); // mirror yaw/roll
  return out.setFromEuler(eu);
}

/** Build one clip for a state directly on the Kenney skeleton. */
function emitState(
  keys: PoseKey[],
  loop: boolean,
  rest: KenneyRestData,
  boneTrackValues: Map<string, number[]>,
): { times: number[]; loop: boolean } {
  const wrapT = keys[keys.length - 1].t + (keys.length > 1 ? keys[1].t - keys[0].t : 0.55);
  const all = [...keys];
  if (loop) all.push({ t: wrapT, torso: keys[0].torso, limbs: keys[0].limbs, bob: keys[0].bob });
  const times = all.map((k) => k.t);

  const T = rest.torso;
  const C = rest.chains;

  // Author at the game's 1.75 m scale, then scale/translate into the skeleton's
  // own rest frame so the IK solves against the real geometry. The authored
  // foot-low (~0.05) maps to the skeleton's ankle-rest height.
  const groundSkel = Math.min(C.footL.restPos.y, C.footR.restPos.y);
  const s = Math.max(0.001, (T.Head.restPos.y - groundSkel) / 1.75);
  const dy = groundSkel - 0.05 * s;

  const qA = new THREE.Quaternion();
  const qB = new THREE.Quaternion();
  const qC = new THREE.Quaternion();
  const qD = new THREE.Quaternion();
  const qE = new THREE.Quaternion();

  // per-bone local-quat accumulation (map name → [x,y,z,w] per keyframe)
  const push = (boneName: string, q: THREE.Quaternion) => {
    let arr = boneTrackValues.get(boneName);
    if (!arr) {
      arr = [];
      boneTrackValues.set(boneName, arr);
    }
    arr.push(q.x, q.y, q.z, q.w);
  };

  for (const key of all) {
    const { torso, limbs } = key;

    // ---- torso chain (local = rest × authored delta, world propagated) ----
    const W = new Map<string, THREE.Quaternion>(); // animated world quats
    const parentFor = (name: string): THREE.Quaternion =>
      W.get(name) ?? T[name as keyof typeof T]?.restWorld ?? new THREE.Quaternion();
    // Parents are always processed before children in a standard spine, so the
    // world quats compose correctly whatever the real hierarchy looks like
    // (UpperChest between Chest and Neck, or Chest → Neck directly).
    const torsoList = ["Hips", "Spine", "Chest", "UpperChest", "Neck", "Head"] as const;
    for (const boneName of torsoList) {
      const rb = T[boneName];
      const delta = torso[boneName.toLowerCase() as keyof TorsoPose];
      if (delta) eulerQuat(delta, qA);
      else qA.identity();
      qB.copy(rb.restLocal).multiply(qA); // local = rest × delta
      push(boneName, qB);
      const parentW = rb.parentName === "HipsCtrl" ? T.HipsCtrl.restWorld : parentFor(rb.parentName);
      const w = qC.copy(parentW).multiply(qB);
      W.set(boneName, w.clone());
    }

    // ---- legs ----
    const solveLeg = (
      thigh: ChainBone, shin: ChainBone, foot: RestBone,
      targetV3: V3, footRx: number, prefix: string,
    ) => {
      const origin = thigh.restPos;
      const target = toSkel(targetV3, s, dy);
      const { dirA, dirB } = twoBoneIK(origin, target, thigh.segLen, shin.segLen, FWD);
      // thigh: rotate so its rest child direction points along dirA
      qA.setFromUnitVectors(thigh.childDir, dirA).multiply(thigh.restWorld);
      const hipsW = parentFor(thigh.parentName);
      qB.copy(hipsW).invert().multiply(qA);
      push(prefix + "UpLeg", qB);
      const thighWorld = qC.copy(hipsW).multiply(qB);
      // shin
      qD.setFromUnitVectors(shin.childDir, dirB).multiply(shin.restWorld);
      qE.copy(thighWorld).invert().multiply(qD);
      push(prefix + "Leg", qE);
      // foot: rest orientation × toe-pitch delta (keeps the toes pointing down)
      qA.set(-Math.sin(footRx / 2), 0, 0, Math.cos(footRx / 2));
      qB.copy(foot.restLocal).multiply(qA);
      push(prefix + "Foot", qB);
    };
    solveLeg(C.thighL, C.shinL, C.footL, limbs.footL, limbs.footRxL ?? 0, "Left");
    solveLeg(C.thighR, C.shinR, C.footR, limbs.footR, limbs.footRxR ?? 0, "Right");

    // ---- arms (shoulder pivots — the wrist is the IK end, the hand hangs) ----
    const solveArm = (
      shoulder: ChainBone, arm: ChainBone, fore: RestBone,
      targetV3: V3, prefix: string,
    ) => {
      const origin = shoulder.restPos;
      const target = toSkel(targetV3, s, dy);
      const { dirA, dirB } = twoBoneIK(origin, target, shoulder.segLen, arm.segLen, BACK);
      qA.setFromUnitVectors(shoulder.childDir, dirA).multiply(shoulder.restWorld);
      const parentW = parentFor(shoulder.parentName);
      qB.copy(parentW).invert().multiply(qA);
      push(prefix + "Shoulder", qB);
      const shoulderWorld = qC.copy(parentW).multiply(qB);
      qD.setFromUnitVectors(arm.childDir, dirB).multiply(arm.restWorld);
      qE.copy(shoulderWorld).invert().multiply(qD);
      push(prefix + "Arm", qE);
      // wrist keeps its rest orientation (the hand bone beyond it is unmapped)
      push(prefix + "ForeArm", fore.restLocal);
    };
    solveArm(C.shoulderL, C.armL, C.foreL, limbs.handL, "Left");
    solveArm(C.shoulderR, C.armR, C.foreR, limbs.handR, "Right");
  }

  return { times, loop };
}

/**
 * Build the Kenney-native pose clips for every gameplay state (idle is the
 * model's own real animation and is supplied separately by kenneyCharacter).
 */
export function buildKenneyPoseClips(rest: KenneyRestData): Record<Exclude<AnimState, "idle">, THREE.AnimationClip> {
  const out = {} as Record<Exclude<AnimState, "idle">, THREE.AnimationClip>;
  for (const [state, keys] of Object.entries(SOURCES) as [Exclude<AnimState, "idle">, PoseKey[]][]) {
    const values = new Map<string, number[]>();
    const { times, loop } = emitState(keys, state !== "landing" && state !== "hit", rest, values);

    const tracks: THREE.KeyframeTrack[] = [];
    for (const [boneName, vals] of values) {
      tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, vals));
    }
    // vertical body bob / drop
    const bobT: number[] = [];
    const bobV: number[] = [];
    for (const k of keys) {
      bobT.push(k.t);
      bobV.push(0, k.bob ?? 0, 0);
    }
    tracks.push(new THREE.VectorKeyframeTrack("body.position", bobT, bobV));

    const duration = times[times.length - 1];
    const clip = new THREE.AnimationClip(state, loop ? undefined : duration, tracks);
    if (!loop) clip.duration = duration;
    out[state] = clip;
  }
  return out;
}
