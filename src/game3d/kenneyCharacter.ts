import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { CLIPS, type AnimState } from "./animations";
import { buildKenneyPoseClips, measureKenneyRest } from "./kenneyClips";

/**
 * Kenney "Animated Characters 1" (CC0 — kenney.nl) — rigged low-poly survivor
 * loaded at runtime with THREE.FBXLoader and used as the player character.
 *
 * Kenney ships 3 animation files for this skeleton, but only the idle is a
 * real animation (the run/jump files contain single static poses), so the
 * idle is used as-is and every gameplay state is AUTHORED DIRECTLY ON THIS
 * SKELETON: the rest geometry (world rotations, joint offsets, segment
 * lengths) is measured once from the loaded skeleton and every keyframe is
 * solved with two-bone IK in the skeleton's own frame, written back as local
 * quaternions for the real bone names (see kenneyClips.ts). No intermediate
 * rig, no retargeting, no mirror/scale hacks — the bones are the ones the
 * mesh is actually weighted to (LeftShoulder swings the arm, LeftArm bends
 * the elbow, …), so the arms swing from the shoulder and the elbows/knees
 * bend where the mesh deforms.
 *
 * Root motion is stripped (the game owns all movement) and the vertical bob
 * is preserved through a "body" wrapper group.
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

/** Tolerant bone lookup: exact name, then |/:: tail segment, then case-insensitive. */
function findBone(skel: THREE.Skeleton, name: string): THREE.Bone | null {
  let b = skel.bones.find((x) => x.name === name) ?? null;
  if (!b) {
    const tail = name.split("|").pop()!.split("::").pop()!;
    b = skel.bones.find(
      (x) => x.name.endsWith(`|${name}`) || x.name.endsWith(`::${name}`) || x.name === tail,
    ) ?? null;
  }
  if (!b) {
    const lower = name.toLowerCase();
    b = skel.bones.find((x) => x.name.toLowerCase() === lower) ?? null;
  }
  return b;
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

  // ---- apply the CC0 skin texture ----------------------------------------
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

  // ---- stand the model upright (the FBX stores the character along +Z) ----
  // Done BEFORE measuring rest so the rest-world rotations include the
  // upright transform (it is part of the final scene too).
  const box0 = new THREE.Box3().setFromObject(modelG);
  if (box0.max.z - box0.min.z > box0.max.y - box0.min.y) {
    modelG.rotation.x = -Math.PI / 2; // Z-up → Y-up
    modelG.updateMatrixWorld(true);
  }

  // ---- author the pose clips directly on the real skeleton ----------------
  const getBone = (name: string): THREE.Bone | null => findBone(skeleton, name);
  const rest = measureKenneyRest(getBone);
  const kenneyPoses = buildKenneyPoseClips(rest);

  // ---- Kenney's own idle animation (the only real animation in the pack) --
  const idleG = await loader.loadAsync(`${DIR}idle.fbx`);
  const idleClip = idleG.animations[0];
  if (!idleClip) throw new Error("Kenney idle.fbx contains no animation clips");
  const kenneyIdle = renameClip(onlyRotations(filterToSkeleton(normalizeFbxNames(idleClip), skeleton)), "idle");

  // The idle also drives FK control bones (HipsCtrl, UpperChest, fingers…).
  // Those control bones are the REST base the pose clips are authored against,
  // so the idle must leave them untouched — otherwise the run/jump/slide poses
  // would rotate on top of a moving base and collapse. Keep only the bones the
  // pose clips also drive (the visible motion).
  {
    const driven = new Set<string>(["body"]);
    for (const state of Object.values(kenneyPoses)) {
      for (const t of state.tracks) driven.add(t.name.split(".")[0]);
    }
    kenneyIdle.tracks = kenneyIdle.tracks.filter((t) => driven.has(t.name.split(".")[0]));
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
    run: kenneyPoses.run,
    jump: kenneyPoses.jump,
    fall: kenneyPoses.fall,
    landing: kenneyPoses.landing,
    slide: kenneyPoses.slide,
    hit: kenneyPoses.hit,
    caught: kenneyPoses.caught,
    grab: kenneyPoses.grab,
  };

  // authored clips keep the game's native 0.55s run cadence
  const runCadence = 1;

  if (import.meta.env.DEV) {
    (window as unknown as { __kenney?: unknown }).__kenney = {
      bones: skeleton.bones.map((b) => b.name),
      parents: skeleton.bones.map((b) => [b.name, b.parent ? b.parent.name : ""]),
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
