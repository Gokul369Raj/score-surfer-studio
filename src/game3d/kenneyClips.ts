import * as THREE from "three";
import type { AnimState, BoneName } from "./animations";

/**
 * Kenney-native animation clips for the player character.
 *
 * The imported Kenney model (see kenneyCharacter.ts) has human proportions —
 * longer limbs than the chunky procedural rig the game's hand-authored clips
 * were built for. Retargeting those clips bone-for-bone made the feet tuck up
 * above the hips during the run (identical world rotations + longer limbs =
 * feet swinging way too high).
 *
 * Instead of retargeting, this module AUTHORES new clips with inverse
 * kinematics: every keyframe defines where each foot and hand should be in
 * space (relative to the hips/chest), and a two-bone IK solve places the
 * knee/elbow using the Kenney model's real segment lengths. The result is a
 * natural stride — feet planted near the road at contact, hands swinging at
 * chest height — while the torso/head lean comes from the same style of
 * authored eulers the rest of the game uses.
 *
 * The output clips are written in the game's OLD rig convention (bone names
 * like "thighL", local-space quaternion tracks, plus a "body.position" bob
 * track) and are fed through the existing retarget pass so the Kenney
 * skeleton plays them natively.
 *
 * Character space used here: up = +Y, face/forward = +Z, left foot at −X.
 * This matches the old rig's local frame (the game rotates the whole
 * character by π when placing it).
 */

type V3 = [number, number, number];
type Euler = [number, number, number];

/** Kenney model segment lengths (measured from the FBX skeleton at rest). */
const LEN = {
  thigh: 0.34,
  shin: 0.33,
  upperArm: 0.3,
  foreArm: 0.35,
};

interface TorsoPose {
  hips?: Euler;
  spine?: Euler;
  chest?: Euler;
  neck?: Euler;
  head?: Euler;
}

interface LimbsKey {
  /** World-space foot targets (relative to body origin, before torso lean). */
  footL: V3;
  footR: V3;
  /** Toe pitch (radians) — positive dips the toes down toward the road. */
  footRxL?: number;
  footRxR?: number;
  /** World-space hand targets (relative to body origin, before torso lean). */
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
      handL: [-0.3, 1.15, 0.3], handR: [0.3, 1.1, -0.3],
    },
    bob: 0,
  },
  {
    t: 0.1375,
    torso: { hips: [0.04, 0, 0], spine: [0, 0, 0], chest: [0.16, 0, 0], neck: [-0.12, 0, 0], head: [-0.08, 0, 0] },
    limbs: {
      footL: [-0.13, 0.35, 0.0], footRxL: -0.05, // swinging under the body
      footR: [0.13, 0.05, 0.12], footRxR: 0.05, // stance, pushing
      handL: [-0.3, 1.1, -0.25], handR: [0.3, 1.15, 0.25],
    },
    bob: 0.04,
  },
  {
    t: 0.275,
    torso: { hips: [0.06, -0.14, 0], spine: [0, 0, -0.02], chest: [0.14, 0, -0.05], neck: [-0.12, 0, 0], head: [-0.08, 0, 0.05] },
    limbs: {
      footL: [-0.13, 0.05, 0.35], footRxL: 0.2, // forward, planting
      footR: [0.13, 0.3, -0.35], footRxR: -0.12, // behind, lifting
      handL: [-0.3, 1.1, -0.3], handR: [0.3, 1.15, 0.3],
    },
    bob: 0,
  },
  {
    t: 0.4125,
    torso: { hips: [0.04, 0, 0], spine: [0, 0, 0], chest: [0.16, 0, 0], neck: [-0.12, 0, 0], head: [-0.08, 0, 0] },
    limbs: {
      footL: [-0.13, 0.05, 0.12], footRxL: 0.05, // stance
      footR: [0.13, 0.35, 0.0], footRxR: -0.05, // swinging
      handL: [-0.3, 1.15, 0.25], handR: [0.3, 1.1, -0.25],
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
      handL: [-0.5, 1.35, 0.1], handR: [0.5, 1.35, 0.1],
    },
    bob: 0.02,
  },
  {
    t: 0.35,
    torso: { hips: [-0.04, 0, 0], chest: [-0.1, 0, 0.03], neck: [0.22, 0, 0], head: [0.15, 0, 0.05] },
    limbs: {
      footL: [-0.13, 0.18, 0.45], footRxL: -0.25,
      footR: [0.13, 0.18, 0.45], footRxR: -0.25,
      handL: [-0.55, 1.3, 0.15], handR: [0.55, 1.3, 0.15],
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
      handL: [-0.3, 1.2, 0.2], handR: [0.3, 1.2, 0.2],
    },
    bob: 0,
  },
  {
    t: 0.14,
    torso: { hips: [0.2, 0, 0], chest: [0.32, 0, 0], neck: [-0.2, 0, 0], head: [0.05, 0, 0] },
    limbs: {
      footL: [-0.15, 0.05, -0.05], footRxL: 0.1,
      footR: [0.15, 0.05, -0.05], footRxR: 0.1,
      handL: [-0.3, 1.05, 0.15], handR: [0.3, 1.05, 0.15],
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
      handL: [-0.3, 0.85, -0.45], handR: [0.3, 0.85, -0.45],
    },
    bob: -0.18,
  },
  {
    t: 0.4,
    torso: { hips: [-0.87, 0, 0.03], chest: [0.53, 0, 0.03], neck: [-0.32, 0, 0], head: [-0.12, 0, 0.04] },
    limbs: {
      footL: [-0.13, 0.12, 0.5], footRxL: 0.2,
      footR: [0.13, 0.12, 0.5], footRxR: 0.2,
      handL: [-0.3, 0.9, -0.4], handR: [0.3, 0.9, -0.4],
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
      handL: [-0.3, 1.15, 0], handR: [0.3, 1.15, 0],
    },
    bob: 0,
  },
  {
    t: 0.09,
    torso: { hips: [0.3, 0, 0], chest: [-0.35, 0, 0], neck: [0.15, 0, 0], head: [0.4, 0, 0.08] },
    limbs: {
      footL: [-0.13, 0.08, -0.15], footRxL: 0.1,
      footR: [0.13, 0.08, -0.15], footRxR: 0.1,
      handL: [-0.4, 1.45, 0.15], handR: [0.3, 0.95, -0.25],
    },
    bob: 0.02,
  },
  {
    t: 0.27,
    torso: { hips: [-0.2, 0, 0], chest: [0.3, 0, 0], neck: [-0.15, 0, 0], head: [-0.1, 0, -0.08] },
    limbs: {
      footL: [-0.13, 0.08, -0.12], footRxL: 0.1,
      footR: [0.13, 0.08, -0.12], footRxR: 0.1,
      handL: [0.3, 1.0, -0.2], handR: [-0.4, 1.4, 0.1],
    },
    bob: -0.03,
  },
  {
    t: 0.42,
    torso: { hips: [0.05, 0, 0], chest: [0.18, 0, 0], neck: [-0.12, 0, 0], head: [-0.08, 0, 0] },
    limbs: {
      footL: [-0.13, 0.08, -0.08], footRxL: 0.1,
      footR: [0.13, 0.08, -0.08], footRxR: 0.1,
      handL: [-0.3, 1.15, 0], handR: [0.3, 1.15, 0],
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
      handL: [-0.3, 0.7, 0.35], handR: [0.3, 0.7, 0.35], // braced forward-down
    },
    bob: -0.1,
  },
  {
    t: 0.8,
    torso: { hips: [0.24, 0, 0], spine: [0.91, 0, 0.03], chest: [0.48, 0, 0.03], neck: [0.28, 0, 0], head: [-0.18, 0, -0.06] },
    limbs: {
      footL: [-0.13, 0.1, -0.06], footRxL: 0.1,
      footR: [0.13, 0.1, -0.06], footRxR: 0.1,
      handL: [-0.3, 0.72, 0.32], handR: [0.3, 0.72, 0.32],
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
      handL: [-0.3, 1.05, 0.5], handR: [0.3, 1.05, 0.5], // reaching forward
    },
    bob: -0.02,
  },
  {
    t: 0.5,
    torso: { hips: [0.22, 0, 0], chest: [0.48, 0, 0.03], neck: [-0.25, 0, 0], head: [-0.32, 0, -0.05] },
    limbs: {
      footL: [-0.15, 0.1, -0.18], footRxL: 0.1,
      footR: [0.15, 0.1, -0.18], footRxR: 0.1,
      handL: [-0.3, 1.08, 0.48], handR: [0.3, 1.08, 0.48],
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

// ---------------------------------------------------------------- scaffold

interface Scaffold {
  group: THREE.Group;
  bones: Record<BoneName, THREE.Group>;
}

/**
 * A plain object hierarchy mirroring the game rig's bone names with the
 * Kenney model's real joint positions (hips 0.8m, thigh 0.34m, …). Rest
 * rotations are identity — exactly like the old rig — so a clip authored in
 * this space plays back through the existing retarget pass unchanged.
 */
function buildScaffold(): Scaffold {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.name = "body";
  group.add(body);

  const mk = (parent: THREE.Object3D, name: string, x: number, y: number, z: number): THREE.Group => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };

  const hips = mk(body, "hips", 0, 0.8, 0);
  const spine = mk(hips, "spine", 0, 0.21, 0);
  const chest = mk(spine, "chest", 0, 0.19, 0);
  const neck = mk(chest, "neck", 0, 0.37, 0);
  const head = mk(neck, "head", 0, 0.17, 0);

  // Segment offsets mirror the Kenney model's REST WORLD child directions
  // (elbows/hands hang down-out, legs hang down). The IK solve below swings
  // each bone from ITS OWN rest axis, so a pose always reads as a rotation
  // relative to the character's natural stance.
  // NOTE: this scaffold is built in the KENNEY convention (left limb at +X,
  // forward = +Z, up = +Y) — it is the pose the retarget reproduces on the
  // real skeleton, so its frame must match the skeleton's frame (the FBX
  // stores LeftUpLeg at +X relative to Hips). The pose keys below are
  // authored in the old rig's convention (left = −X); applyKey mirrors the
  // limb targets and the yaw/roll eulers when solving, so the emitted local
  // quats come out in this +X-left frame with no scale tricks involved.
  const upperArmL = mk(chest, "upperArmL", 0.21, 0.32, -0.08);
  const forearmL = mk(upperArmL, "forearmL", 0.12, -0.26, 0.1);
  const handL = mk(forearmL, "handL", 0.09, -0.31, -0.14);
  const upperArmR = mk(chest, "upperArmR", -0.21, 0.32, -0.08);
  const forearmR = mk(upperArmR, "forearmR", -0.12, -0.26, 0.1);
  const handR = mk(forearmR, "handR", -0.09, -0.31, -0.14);

  const thighL = mk(hips, "thighL", 0.13, 0.04, -0.02);
  const shinL = mk(thighL, "shinL", 0.05, -0.34, -0.05);
  const footL = mk(shinL, "footL", -0.05, -0.33, 0.21);
  const thighR = mk(hips, "thighR", -0.13, 0.04, -0.02);
  const shinR = mk(thighR, "shinR", -0.05, -0.34, -0.05);
  const footR = mk(shinR, "footR", 0.05, -0.33, 0.21);

  const bones: Record<BoneName, THREE.Group> = {
    hips, spine, chest, neck, head,
    upperArmL, upperArmR, forearmL, forearmR, handL, handR,
    thighL, thighR, shinL, shinR, footL, footR,
  };
  return { group, bones };
}

// -------------------------------------------------------------------- IK

/**
 * Two-bone IK: given the joint origin, a world-space target and the two
 * segment lengths, returns unit directions for both segments. `bendDir`
 * selects which side of the hip-shoulder→target line the middle joint goes
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

/**
 * Unit direction of a scaffold bone's own rest segment (toward its child).
 * The child's position is stored IN THE BONE'S LOCAL FRAME (the child is a
 * direct child of the bone), so it is the segment axis directly.
 */
function restAxisOf(_bone: THREE.Group, child: THREE.Group): THREE.Vector3 {
  return new THREE.Vector3().copy(child.position).normalize();
}

// ----------------------------------------------------------------- emit

const BONES_ALL: BoneName[] = [
  "hips", "spine", "chest", "neck", "head",
  "upperArmL", "upperArmR", "forearmL", "forearmR", "handL", "handR",
  "thighL", "thighR", "shinL", "shinR", "footL", "footR",
];

const FWD = new THREE.Vector3(0, 0, 1);
const BACK = new THREE.Vector3(0, 0, -1);

/** Apply a pose key to the scaffold and return the resulting local quats. */
function applyKey(s: Scaffold, key: PoseKey, quats: Map<BoneName, THREE.Quaternion>) {
  const { torso, limbs } = key;
  // The pose keys are authored in the old rig's frame (left = −X); this
  // scaffold is built in the Kenney frame (left = +X), which is an X
  // reflection of the old frame. Under that reflection an X-rotation keeps
  // its sign but Y (yaw) and Z (roll) rotations flip, so the authored eulers
  // are mirrored here (rx, −ry, −rz).
  const setE = (name: BoneName, e: Euler | undefined) => {
    const b = s.bones[name];
    if (e) b.rotation.set(e[0], -e[1], -e[2]);
    else b.rotation.set(0, 0, 0);
  };
  for (const n of BONES_ALL) setE(n, torso[n as keyof TorsoPose] as Euler | undefined);

  s.group.updateMatrixWorld(true);  // solve legs from the hip joints. Each bone's LOCAL rotation is derived from
  // its parent's world rotation (parent⁻¹ × target-world) so the FK chain ends
  // up pointing exactly at the IK targets.
  const _pw = new THREE.Quaternion();
  const _wr = new THREE.Quaternion();
  const orientTo = (bone: THREE.Group, parentWorld: THREE.Quaternion, restAxis: THREE.Vector3, dir: THREE.Vector3) => {
    _wr.setFromUnitVectors(restAxis, dir);
    _pw.copy(parentWorld).invert().multiply(_wr);
    bone.quaternion.copy(_pw);
  };

  const solve = (hip: THREE.Group, footTarget: V3, footRx: number, leg: "L" | "R") => {
    const origin = new THREE.Vector3().setFromMatrixPosition(hip.matrixWorld);
    // mirror the authored X into the +X-left scaffold frame
    const target = new THREE.Vector3(-footTarget[0], footTarget[1], footTarget[2]);
    const { dirA, dirB } = twoBoneIK(origin, target, LEN.thigh, LEN.shin, FWD);
    const thigh = s.bones[leg === "L" ? "thighL" : "thighR"];
    const shin = s.bones[leg === "L" ? "shinL" : "shinR"];
    const foot = s.bones[leg === "L" ? "footL" : "footR"];
    const hipW = new THREE.Quaternion().setFromRotationMatrix(hip.matrixWorld);
    orientTo(thigh, hipW, restAxisOf(thigh, shin), dirA);
    s.group.updateMatrixWorld(true);
    const thighW = new THREE.Quaternion().setFromRotationMatrix(thigh.matrixWorld);
    orientTo(shin, thighW, restAxisOf(shin, foot), dirB);
    // toe pitch about the foot's LOCAL X axis (the sideways axis). The
    // retarget keeps the Kenney foot's rest orientation and applies this
    // delta on top, so a positive footRx dips the toes toward the road. The
    // sign is mirrored here because the live skeleton's world frame is a
    // 180° Y rotation away from the authoring frame.
    foot.quaternion.set(-Math.sin(footRx / 2), 0, 0, Math.cos(footRx / 2));
  };
  solve(s.bones.thighL, limbs.footL, limbs.footRxL ?? 0, "L");
  solve(s.bones.thighR, limbs.footR, limbs.footRxR ?? 0, "R");

  // solve arms from the shoulders (same parent-frame compensation)
  const solveArm = (shoulder: THREE.Group, handTarget: V3, side: "L" | "R") => {
    const origin = new THREE.Vector3().setFromMatrixPosition(shoulder.matrixWorld);
    // mirror the authored X into the +X-left scaffold frame
    const target = new THREE.Vector3(-handTarget[0], handTarget[1], handTarget[2]);
    const { dirA, dirB } = twoBoneIK(origin, target, LEN.upperArm, LEN.foreArm, BACK);
    const ua = s.bones[side === "L" ? "upperArmL" : "upperArmR"];
    const fa = s.bones[side === "L" ? "forearmL" : "forearmR"];
    const hand = s.bones[side === "L" ? "handL" : "handR"];
    const chestW = new THREE.Quaternion().setFromRotationMatrix(s.bones.chest.matrixWorld);
    orientTo(ua, chestW, restAxisOf(ua, fa), dirA);
    s.group.updateMatrixWorld(true);
    const uaW = new THREE.Quaternion().setFromRotationMatrix(ua.matrixWorld);
    orientTo(fa, uaW, restAxisOf(fa, hand), dirB);
    hand.quaternion.set(0, 0, 0, 1);
  };
  solveArm(s.bones.upperArmL, limbs.handL, "L");
  solveArm(s.bones.upperArmR, limbs.handR, "R");

  for (const n of BONES_ALL) quats.get(n)!.copy(s.bones[n].quaternion);
}

let _scaffold: Scaffold | null = null;
function scaffold(): Scaffold {
  if (!_scaffold) _scaffold = buildScaffold();
  return _scaffold;
}

/** Build one clip from its pose keys (looping clips wrap back to key 0). */
function emitClip(name: string, keys: PoseKey[], loop: boolean): THREE.AnimationClip {
  const s = scaffold();
  const quats = new Map<BoneName, THREE.Quaternion>();
  for (const n of BONES_ALL) quats.set(n, new THREE.Quaternion());

  // loop: append a copy of the first key at the end for a seamless cycle
  const wrapT = keys[keys.length - 1].t + (keys.length > 1 ? keys[1].t - keys[0].t : 0.55);
  const all = [...keys];
  if (loop) all.push({ t: wrapT, torso: keys[0].torso, limbs: keys[0].limbs, bob: keys[0].bob });

  const times: number[] = [];
  for (const k of all) times.push(k.t);

  // evaluate every key once, snapshotting all bone local quats per key
  const frames: THREE.Quaternion[][] = [];
  for (const k of all) {
    applyKey(s, k, quats);
    frames.push(BONES_ALL.map((n) => quats.get(n)!.clone()));
  }

  const tracks: THREE.KeyframeTrack[] = [];
  for (let bi = 0; bi < BONES_ALL.length; bi++) {
    const vals: number[] = [];
    for (const f of frames) {
      const q = f[bi];
      vals.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${BONES_ALL[bi]}.quaternion`, times, vals));
  }

  // vertical body bob / drop
  const bobT: number[] = [];
  const bobV: number[] = [];
  for (const k of all) {
    bobT.push(k.t);
    bobV.push(0, k.bob ?? 0, 0);
  }
  tracks.push(new THREE.VectorKeyframeTrack("body.position", bobT, bobV));

  const duration = all[all.length - 1].t;
  const clip = new THREE.AnimationClip(name, loop ? undefined : duration, tracks);
  if (!loop) clip.duration = duration;
  return clip;
}

// -------------------------------------------------------------- public API

/**
 * Build the Kenney-native pose clips for every gameplay state (idle is the
 * model's own real animation and is supplied separately by kenneyCharacter).
 */
export function buildKenneyPoseClips(): Record<Exclude<AnimState, "idle">, THREE.AnimationClip> {
  const out = {} as Record<Exclude<AnimState, "idle">, THREE.AnimationClip>;
  for (const [state, keys] of Object.entries(SOURCES) as [Exclude<AnimState, "idle">, PoseKey[]][]) {
    out[state] = emitClip(state, keys, state !== "landing" && state !== "hit");
  }
  return out;
}

/** The scaffold rig the pose clips are authored against (for the retarget). */
export function kenneyPoseScaffold(): THREE.Group {
  return scaffold().group;
}

// ---- DEV diagnostics ------------------------------------------------------

/** Re-pose the scaffold at a keyframe and report bone world positions. */
export function kenneyPoseDebug(state: string, keyIdx: number): Record<string, number[]> | null {
  if (!import.meta.env.DEV) return null;
  const keys = SOURCES[state as Exclude<AnimState, "idle">];
  if (!keys) return null;
  const s = scaffold();
  const quats = new Map<BoneName, THREE.Quaternion>();
  for (const n of BONES_ALL) quats.set(n, new THREE.Quaternion());
  applyKey(s, keys[keyIdx], quats);
  s.group.updateMatrixWorld(true);
  const out: Record<string, number[]> = {};
  for (const n of BONES_ALL) {
    const p = new THREE.Vector3().setFromMatrixPosition(s.bones[n].matrixWorld);
    const q = new THREE.Quaternion().setFromRotationMatrix(s.bones[n].matrixWorld);
    out[n] = [...[p.x, p.y, p.z].map((v) => Math.round(v * 100) / 100), ...[q.x, q.y, q.z, q.w].map((v) => Math.round(v * 100) / 100)];
  }
  return out;
}
