import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { BONES, CLIPS, type AnimState, type BoneName } from "./animations";
import { buildKenneyPoseClips, kenneyPoseDebug, kenneyPoseScaffold } from "./kenneyClips";

/**
 * Kenney "Animated Characters 1" (CC0 — kenney.nl) — rigged low-poly survivor
 * loaded at runtime with THREE.FBXLoader and used as the player character.
 *
 * Kenney ships 3 animation files for this skeleton, but only the idle is a
 * real animation (the run/jump files contain single static poses), so the
 * idle is used as-is and every gameplay state is RE-TARGETED from the game's
 * existing procedural clips: each keyframe's world-space bone rotation is
 * computed on the old rig and written back into the Kenney skeleton's local
 * space. The imported character therefore moves exactly like the character
 * it replaces. Root motion is stripped (the game owns all movement) and the
 * vertical bob is preserved through a "body" wrapper group.
 */

const BASE = import.meta.env.BASE_URL;
const DIR = `${BASE}models/kenney-character/`;

export interface KenneyPlayerModel {
  /** Root group the game positions/rotates (feet planted at y = 0). */
  group: THREE.Group;
  /** One clip per animation state, all bound to the Kenney skeleton. */
  clips: Record<AnimState, THREE.AnimationClip>;
  /** Kenney run-cycle duration ÷ the game's base 0.55s cycle. */
  runCadence: number;
}

const loader = new FBXLoader();
const texLoader = new THREE.TextureLoader();

let cached: Promise<KenneyPlayerModel> | null = null;

export function loadKenneyPlayer(): Promise<KenneyPlayerModel> {
  if (!cached) {
    cached = buildKenneyPlayer().catch((err) => {
      cached = null; // allow retry on the next call
      throw err;
    });
  }
  return cached;
}

// ---------------------------------------------------------------- helpers

/** FBX track names can look like "Model::Bone|Hips.position" — normalize. */
function normalizeFbxNames(clip: THREE.AnimationClip): THREE.AnimationClip {
  for (const tr of clip.tracks) {
    const dot = tr.name.indexOf(".");
    if (dot <= 0) continue;
    let obj = tr.name.slice(0, dot);
    obj = obj.split("|").pop() ?? obj;
    const seg = obj.split("::");
    obj = seg[seg.length - 1];
    tr.name = `${obj}${tr.name.slice(dot)}`;
  }
  return clip;
}

/** Keep only tracks whose target bone actually exists in the skeleton. */
function filterToSkeleton(clip: THREE.AnimationClip, skel: THREE.Skeleton): THREE.AnimationClip {
  const names = new Set(skel.bones.map((b) => b.name));
  const tracks = clip.tracks.filter((t) => names.has(t.name.split(".")[0]));
  const out = new THREE.AnimationClip(clip.name, clip.duration, tracks);
  out.duration = clip.duration;
  return out;
}

/** Drop position tracks — the game owns all root motion (forward + height). */
function onlyRotations(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.filter((t) => t instanceof THREE.QuaternionKeyframeTrack);
  const out = new THREE.AnimationClip(clip.name, clip.duration, tracks);
  out.duration = clip.duration;
  return out;
}

function renameClip(clip: THREE.AnimationClip, name: string): THREE.AnimationClip {
  const out = new THREE.AnimationClip(name, clip.duration, clip.tracks.map((t) => t.clone()));
  out.duration = clip.duration;
  return out;
}

/** Rebuild the vertical body bob for a clip's own duration (one bob per cycle). */
function bobTrackFor(src: THREE.VectorKeyframeTrack, duration: number): THREE.VectorKeyframeTrack {
  const srcDur = Math.max(...src.times, 0.001);
  const times = src.times.map((t) => (t / srcDur) * duration);
  return new THREE.VectorKeyframeTrack("body.position", times, src.values.slice());
}

function findBone(skel: THREE.Skeleton, candidates: string[]): THREE.Bone | null {
  const lower = candidates.map((c) => c.toLowerCase());
  return skel.bones.find((b) => lower.includes(b.name.toLowerCase())) ?? null;
}

const BONE_CANDIDATES: Record<BoneName, string[]> = {
  hips: ["Hips", "hips", "Pelvis", "pelvis"],
  spine: ["Spine", "spine"],
  chest: ["Chest", "chest", "Spine2", "spine2", "Spine1", "spine1"],
  neck: ["Neck", "neck"],
  head: ["Head", "head"],
  upperArmL: ["LeftArm", "LeftUpperArm", "LeftUpArm", "leftarm"],
  upperArmR: ["RightArm", "RightUpperArm", "RightUpArm", "rightarm"],
  forearmL: ["LeftForeArm", "LeftLowerArm", "leftforearm"],
  forearmR: ["RightForeArm", "RightLowerArm", "rightforearm"],
  handL: ["LeftHand", "lefthand"],
  handR: ["RightHand", "righthand"],
  thighL: ["LeftUpLeg", "LeftThigh", "LeftUpperLeg", "leftupleg"],
  thighR: ["RightUpLeg", "RightThigh", "RightUpperLeg", "rightupleg"],
  shinL: ["LeftLeg", "LeftShin", "LeftLowerLeg", "leftleg"],
  shinR: ["RightLeg", "RightShin", "RightLowerLeg", "rightleg"],
  footL: ["LeftFoot", "leftfoot"],
  footR: ["RightFoot", "rightfoot"],
};

interface RetargetNode {
  myObj: THREE.Object3D | null; // matching bone group on the OLD rig (null = kenney root)
  kBone: THREE.Bone;
  parent: RetargetNode | null;
  children: RetargetNode[];
}

/**
 * Re-author one of the game's procedural clips onto the Kenney skeleton.
 * For every keyframe the source rig's bone world rotations are computed by
 * forward kinematics; each Kenney bone's local quaternion is then derived as
 * parentWorld⁻¹ × targetWorld so the Kenney character poses identically.
 */
function retargetClip(
  src: THREE.AnimationClip,
  myRoot: THREE.Group,
  rootNode: RetargetNode,
): THREE.AnimationClip {

  const timesSet = new Set<number>();
  for (const tr of src.tracks) {
    if (tr instanceof THREE.QuaternionKeyframeTrack) for (const t of tr.times) timesSet.add(t);
  }
  const times = [...timesSet].sort((a, b) => a - b);

  const nodeList: RetargetNode[] = [];
  (function collect(n: RetargetNode) {
    nodeList.push(n);
    for (const c of n.children) collect(c);
  })(rootNode);

  const values = new Map<RetargetNode, number[]>();
  for (const n of nodeList) values.set(n, []);

  const mixer = new THREE.AnimationMixer(myRoot);
  const action = mixer.clipAction(src);
  action.play();

  // The Kenney deform bones store their child joints along their LOCAL +Y
  // axis (LeftLeg sits at (0, 0.53, 0) in LeftUpLeg's frame) and their local
  // POSITIONS do not match the world segment geometry (the FBX was exported
  // in a different internal space and reconciled by scale), so multiplying a
  // rest-world quaternion by a local offset does NOT reproduce the child
  // direction. Instead, each bone gets the rotation that maps its local child
  // axis onto the source rig's rest segment axis — the child joints then land
  // exactly where the source rig's children do, and end bones (feet/hands)
  // simply inherit the source rig's orientation.
  const boneQ = new Map<RetargetNode, THREE.Quaternion>();
  for (const n of nodeList) {
    if (!n.myObj) continue;
    // The child's position lives IN THIS BONE'S LOCAL FRAME (it is a direct
    // child), so it is the local child axis directly.
    const kChild = n.kBone.children.find((c) => (c as THREE.Bone).isBone) as THREE.Bone | undefined;
    const kDir = kChild ? new THREE.Vector3().copy(kChild.position).normalize() : new THREE.Vector3(0, 1, 0);
    const myChild = n.myObj.children.find((c) => c !== undefined && c !== null) as THREE.Object3D | undefined;
    let myAxis = new THREE.Vector3(0, 1, 0);
    if (kChild && myChild) {
      myAxis = new THREE.Vector3().copy(myChild.position).normalize();
    } else {
      // end bone (foot/hand): keep the source rig's orientation
      boneQ.set(n, new THREE.Quaternion());
      continue;
    }
    boneQ.set(n, new THREE.Quaternion().setFromUnitVectors(kDir, myAxis));
  }

  const tmp = new THREE.Quaternion();
  const target = new THREE.Quaternion();
  const kWorld = new Map<RetargetNode, THREE.Quaternion>();

  for (const t of times) {
    mixer.setTime(t);
    myRoot.updateMatrixWorld(true);
    kWorld.clear();
    for (const n of nodeList) {
      let local: THREE.Quaternion;
      if (n.myObj === null) {
        if (n.parent === null) {
          // skeleton root — its ACTUAL world rotation is the FK base (it sits
          // under the model's upright transform, not under an animated bone)
          n.kBone.getWorldQuaternion(tmp);
          local = tmp.clone();
        } else {
          // intermediate control bone — stays at its local rest pose
          local = n.kBone.quaternion;
        }
      } else {
        n.myObj.getWorldQuaternion(target); // source rig's world rotation
        target.multiply(boneQ.get(n) ?? new THREE.Quaternion()); // + child-axis correction
        const pw = kWorld.get(n.parent!)!;
        local = tmp.copy(pw).invert().multiply(target);
      }
      const arr = values.get(n)!;
      arr.push(local.x, local.y, local.z, local.w);
      const pw = n.parent ? kWorld.get(n.parent)! : null;
      kWorld.set(n, pw ? pw.clone().multiply(local) : local.clone());
    }
  }
  mixer.stopAllAction();

  // Write a track for EVERY mapped bone — including bones the source clip
  // leaves unkeyed (e.g. the spine in jump/fall/slide). Those bones carry big
  // rest rotations in this rig, so leaving them unkeyed would make them swing
  // on top of the retargeted pose and collapse the torso. The FK pass above
  // already derived the correct local quaternion for them (identity-relative).
  const tracks: THREE.KeyframeTrack[] = [];
  for (const n of nodeList) {
    if (!n.myObj) continue;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${n.kBone.name}.quaternion`, times, values.get(n)!));
  }
  const pos = src.tracks.find((t) => t.name === "body.position");
  if (pos) tracks.push(pos.clone());

  const clip = new THREE.AnimationClip(src.name, src.duration, tracks);
  clip.duration = src.duration;
  return clip;
}

// ------------------------------------------------------------------ build

async function buildKenneyPlayer(): Promise<KenneyPlayerModel> {
  const [modelG, skinTex] = await Promise.all([
    loader.loadAsync(`${DIR}characterMedium.fbx`),
    texLoader.loadAsync(`${DIR}survivorMaleB.png`),
  ]);
  skinTex.colorSpace = THREE.SRGBColorSpace;

  // ---- find the skinned mesh + skeleton ----------------------------------
  const skinnedMeshes: THREE.SkinnedMesh[] = [];
  modelG.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) skinnedMeshes.push(m);
  });
  const skinned = skinnedMeshes[0];
  if (!skinned) throw new Error("Kenney characterMedium.fbx has no skinned mesh");
  const skeleton = skinned.skeleton;

  // ---- apply the CC0 skin texture ---------------------------------------
  const mats = Array.isArray(skinned.material) ? skinned.material : [skinned.material];
  for (const m of mats) {
    const mat = m as THREE.MeshPhongMaterial;
    if (mat.map && mat.map !== skinTex) mat.map.dispose();
    mat.map = skinTex;
    mat.needsUpdate = true;
  }
  skinned.castShadow = true;

  // avoid name collisions with the "body" wrapper the clips target
  modelG.traverse((o) => {
    if (o.name.toLowerCase() === "body") o.name = `${o.name}_mesh`;
  });

  // ---- map old-rig bone names → Kenney bone names -------------------------
  const boneMap = new Map<BoneName, THREE.Bone>();
  for (const b of BONES) {
    const k = findBone(skeleton, BONE_CANDIDATES[b]);
    if (k) boneMap.set(b, k);
  }
  if (boneMap.size < BONES.length) {
    const missing = BONES.filter((b) => !boneMap.has(b));
    throw new Error(
      `Kenney skeleton missing bones: ${missing.join(", ")} — have: ${skeleton.bones.map((b) => b.name).join(", ")}`,
    );
  }

  // ---- stand the model upright (the FBX stores the character along +Z) ----
  // Done BEFORE the retarget so the skeleton's world rotations used as the FK
  // base include the upright transform (it is part of the final scene too).
  const box0 = new THREE.Box3().setFromObject(modelG);
  if (box0.max.z - box0.min.z > box0.max.y - box0.min.y) {
    modelG.rotation.x = -Math.PI / 2; // Z-up → Y-up
    modelG.updateMatrixWorld(true);
  }

  // ---- retarget rig + FK base --------------------------------------------
  // The pose scaffold mirrors the game rig's bone names with the Kenney
  // model's real joint positions; the IK-authored clips play on it and the
  // retarget samples its world rotations (see kenneyClips.ts).
  const myRoot = kenneyPoseScaffold();

  // The Kenney rig has IK/FK control bones (HipsCtrl, LeftFootCtrl, …) above
  // the deform bones — the skeleton root is the top-most bone that is an
  // ancestor of the Hips deform bone.
  const hipsBone = boneMap.get("hips")!;
  let kRoot = hipsBone;
  while (kRoot.parent && (kRoot.parent as THREE.Bone).isBone) kRoot = kRoot.parent as THREE.Bone;

  // Build the retarget node tree over the REAL skeleton chain (kRoot → all
  // mapped deform bones), keeping intermediate control bones (LeftShoulder,
  // UpperChest, …) as unanimated nodes so the world-space math stays exact.
  const boneToMyName = new Map<THREE.Bone, BoneName>();
  for (const [myName, kB] of boneMap) boneToMyName.set(kB, myName);

  const needed = new Set<THREE.Bone>([kRoot]);
  for (const kB of boneMap.values()) {
    let p: THREE.Bone | null = kB;
    while (p && !needed.has(p)) {
      needed.add(p);
      p = p.parent as THREE.Bone | null;
    }
  }

  const rootNode: RetargetNode = { myObj: null, kBone: kRoot, parent: null, children: [] };
  const nodeOf = new Map<THREE.Bone, RetargetNode>([[kRoot, rootNode]]);
  for (const b of needed) {
    if (b === kRoot) continue;
    const myName = boneToMyName.get(b);
    const myObj = myName ? (myRoot.getObjectByName(myName) ?? null) : null;
    if (myName && !myObj) throw new Error(`old rig missing bone group: ${myName}`);
    nodeOf.set(b, { myObj, kBone: b, parent: null, children: [] });
  }
  for (const [b, node] of nodeOf) {
    if (b === kRoot) continue;
    const p = b.parent as THREE.Bone | null;
    if (!p || !nodeOf.has(p)) throw new Error(`Kenney bone ${b.name} is not connected to the skeleton root`);
    node.parent = nodeOf.get(p)!;
    nodeOf.get(p)!.children.push(node);
  }

  // ---- retarget every gameplay state onto the Kenney skeleton ------------
  // The source clips are IK-authored for the Kenney's real proportions so the
  // feet stay planted near the road and the hands swing naturally (the old
  // hand-authored clips made the longer Kenney limbs tuck up above the hips).
  const kenneyPoses = buildKenneyPoseClips();
  const retargeted = {} as Record<AnimState, THREE.AnimationClip>;
  for (const state of ["run", "jump", "fall", "landing", "slide", "hit", "caught", "grab"] as const) {
    retargeted[state] = retargetClip(kenneyPoses[state], myRoot, rootNode);
  }

  // ---- Kenney's own idle animation (the only real animation in the pack) --
  const idleG = await loader.loadAsync(`${DIR}idle.fbx`);
  const idleClip = idleG.animations[0];
  if (!idleClip) throw new Error("Kenney idle.fbx contains no animation clips");
  const kenneyIdle = renameClip(onlyRotations(filterToSkeleton(normalizeFbxNames(idleClip), skeleton)), "idle");

  // The idle also drives FK control bones (HipsCtrl, UpperChest, LeftShoulder,
  // fingers…). Those control bones are the REST base the retargeted clips are
  // authored against, so the idle must leave them untouched — otherwise the
  // run/jump/slide poses would rotate on top of a moving base and collapse.
  // Keep only the deform bones the retarget also drives (the visible motion).
  {
    const deform = new Set([...boneMap.values()].map((b) => b.name));
    deform.add("body");
    kenneyIdle.tracks = kenneyIdle.tracks.filter((t) => deform.has(t.name.split(".")[0]));
  }
  // preserve the game's vertical body bob (rescaled to the idle cycle)
  const idlePos = CLIPS.idle.tracks.find((t) => t.name === "body.position");
  if (idlePos && kenneyIdle.duration > 0) {
    kenneyIdle.tracks.push(bobTrackFor(idlePos as THREE.VectorKeyframeTrack, kenneyIdle.duration));
  }

  // ---- reconcile the skeleton with the rendered mesh ----------------------
  // This FBX stores the mesh and its skeleton at different internal scales
  // (a Blender export quirk that Unity's importer normalises away on import).
  // The rendered mesh is ~1.4× taller than the bone bind pose, so the skinned
  // pivots would bend at the wrong heights. We rescale the armature's "Root"
  // group (bones only — the mesh is its sibling) to the mesh's size, then
  // re-derive the bind inverses so rest-skinning stays an identity.
  const meshBox = new THREE.Box3().setFromObject(modelG);
  const footBones = skeleton.bones.filter((b) => /foot|toe/i.test(b.name));
  const skelFeetY = footBones.length
    ? Math.min(...footBones.map((b) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).y))
    : 0;
  const headBone = skeleton.bones.find((b) => b.name === "Head");
  const skelHeadY = headBone ? new THREE.Vector3().setFromMatrixPosition(headBone.matrixWorld).y : 0;
  const skelH = Math.max(0.001, skelHeadY - skelFeetY);
  const meshH = Math.max(0.001, meshBox.max.y - meshBox.min.y);
  const k = meshH / skelH;
  const root = skeleton.bones[0].parent; // "Root" armature group (all bones hang off it)
  if (Math.abs(k - 1) > 0.05 && root) {
    root.scale.multiplyScalar(k);
    root.position.y += meshBox.min.y - skelFeetY * k; // skeleton feet → mesh feet
    root.updateMatrixWorld(true);
    skeleton.calculateInverses();
  }

  // ---- ground + normalize height -----------------------------------------
  const box = new THREE.Box3().setFromObject(modelG);
  const h = Math.max(0.001, box.max.y - box.min.y);
  const scale = 1.75 / h; // match the old character's height
  const feetY = box.min.y;

  const offset = new THREE.Group();
  offset.scale.setScalar(scale);
  offset.position.y = -feetY * scale;

  const body = new THREE.Group();
  body.name = "body"; // the clips' "body.position" track drives this
  body.add(offset);
  offset.add(modelG);
  // the character faces the camera by default like the old rig; the game
  // still applies its own rotation.y = Math.PI on top
  modelG.rotation.y = 0;

  const group = new THREE.Group();
  group.add(body);

  const clips: Record<AnimState, THREE.AnimationClip> = {
    idle: kenneyIdle,
    run: retargeted.run,
    jump: retargeted.jump,
    fall: retargeted.fall,
    landing: retargeted.landing,
    slide: retargeted.slide,
    hit: retargeted.hit,
    caught: retargeted.caught,
    grab: retargeted.grab,
  };

  // retargeted clips keep the game's native 0.55s run cadence
  const runCadence = 1;

  if (import.meta.env.DEV) {
    (window as unknown as { __poseDebug?: unknown }).__poseDebug = kenneyPoseDebug;
    (window as unknown as { __kenney?: unknown }).__kenney = {
      bones: skeleton.bones.map((b) => b.name),
      map: [...boneMap].map(([k, v]) => [k, v.name]),
      clips: Object.fromEntries(
        Object.entries(clips).map(([k, c]) => [
          k,
          { dur: +c.duration.toFixed(3), tracks: c.tracks.map((t) => t.name) },
        ]),
      ),
      height: +h.toFixed(3),
      scale: +scale.toFixed(3),
      feetY: +feetY.toFixed(3),
      skelH: +skelH.toFixed(3),
      meshH: +meshH.toFixed(3),
      k: +k.toFixed(3),
      box: { min: box.min.toArray().map((v) => +v.toFixed(2)), max: box.max.toArray().map((v) => +v.toFixed(2)) },
      runCadence: +runCadence.toFixed(3),
    };
  }

  return { group, clips, runCadence };
}
