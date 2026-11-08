// src/scripts/avatar.ts: the animated 3D avatar on the chat page.
// Loaded on demand by index.astro, so three.js and the .vrm model are only
// downloaded once the avatar is about to be on screen.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rand = (min: number, max: number) => Math.random() * (max - min) + min;
const randSign = () => (Math.random() < 0.5 ? -1 : 1);
const damp = (a: number, b: number, lambda: number, dt: number) =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));
const noise = (t: number, f: number, p: number) =>
  Math.sin(t * f + p) * Math.cos(t * f * 0.43 + p * 1.9);

type Spring = { v: number; vel: number };
function smoothDamp(s: Spring, to: number, smoothTime: number, dt: number, maxSpeed = Infinity) {
  smoothTime = Math.max(0.0001, smoothTime);
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const maxChange = maxSpeed * smoothTime;
  const change = clamp(s.v - to, -maxChange, maxChange);
  const adj = s.v - change;
  const temp = (s.vel + omega * change) * dt;
  s.vel = (s.vel - omega * temp) * e;
  let out = adj + (change + temp) * e;
  if (to - s.v > 0 === out > to) { out = to; s.vel = 0; }
  s.v = out;
  return out;
}

type Pose = {
  headYaw: number; headPitch: number; headRoll: number;
  chestYaw: number; chestPitch: number; chestRoll: number;
  hipsYaw: number; hipsRoll: number;
  leftUpperArmZ: number; rightUpperArmZ: number;
  rightUpperArmX: number; leftUpperArmX: number;
  rightLowerArmY: number; leftLowerArmY: number;
  leftUpperLegX: number; rightUpperLegX: number;
  leftLowerLegX: number; rightLowerLegX: number;
};

const idlePose: Pose = {
  headYaw: 0, headPitch: 0, headRoll: 0,
  chestYaw: 0, chestPitch: 0, chestRoll: 0,
  hipsYaw: 0, hipsRoll: 0,
  leftUpperArmZ: 1.25, rightUpperArmZ: -1.25,
  rightUpperArmX: 0, leftUpperArmX: 0,
  rightLowerArmY: 0.3, leftLowerArmY: -0.3,
  leftUpperLegX: 0, rightUpperLegX: 0,
  leftLowerLegX: 0, rightLowerLegX: 0,
};
const KEYS = Object.keys(idlePose) as (keyof Pose)[];

const springs = {} as Record<keyof Pose, Spring>;
for (const k of KEYS) springs[k] = { v: idlePose[k], vel: 0 };
const ov: Pose = { ...idlePose };

export type AvatarState = {
  typing: boolean; thinking: boolean; talking: boolean;
  hover: boolean; lastChunkAt: number;
};
// Shared with the chat code on the page, which sets typing/thinking/talking.
let S: AvatarState;

const THINK: Partial<Pose> = {
  headPitch: 0.22, headRoll: 0.15,
  rightUpperArmZ: -0.9, rightUpperArmX: 1.1, rightLowerArmY: 1.5,
};

export type ActionType =
  | "idle" | "look" | "think" | "wave" | "shrug" | "lookAround"
  | "weightShift" | "walk" | "nod" | "jump" | "spin" | "bow";

type Action = {
  type: ActionType; t: number; dur: number;
  dir: number; p: number; x: number; forced: boolean;
};

const DURATIONS: Record<ActionType, number> = {
  idle: 0, look: 2.2, think: 2.6, wave: 2.4, shrug: 1.3, lookAround: 2.6,
  weightShift: 2.4, walk: 6, nod: 1.1, jump: 1.2, spin: 3, bow: 1.6,
};
const IDLE_TABLE: [ActionType, number][] = [
  ["look", 3], ["think", 2], ["wave", 2], ["shrug", 2],
  ["lookAround", 3], ["weightShift", 3], ["walk", 2.5], ["nod", 1],
];
const REACTIONS: ActionType[] = ["wave", "jump", "spin", "bow", "nod"];

const action: Action = { type: "idle", t: 0, dur: 0, dir: 1, p: 0, x: 0, forced: false };
let cooldown = 1.5;
let lastType: ActionType = "idle";
let lastReaction: ActionType | null = null;

const WALK_LIMIT = 0.7;
const xs: Spring = { v: 0, vel: 0 };
const ys: Spring = { v: 0, vel: 0 };
let spinOffset = 0;
let jumpY = 0, jumpV = 0, landKick = 0;
let gaitPhase = 0;
let currentVRM: any = null;
let baseYaw = 0;
let leanX = 0;

function startAction(type: ActionType, forced = false) {
  action.type = type;
  action.t = 0;
  action.dur = DURATIONS[type];
  action.dir = randSign();
  action.p = rand(-0.2, 0.15);
  action.forced = forced;
  lastType = type;
  if (type === "walk") {
    const dir = xs.v > 0.35 ? -1 : xs.v < -0.35 ? 1 : randSign();
    action.dir = dir;
    action.x = clamp(xs.v + dir * rand(0.3, 0.65), -WALK_LIMIT, WALK_LIMIT);
  }
  if (type === "jump") jumpV = 2.0;
  if (type === "spin") spinOffset = action.dir * Math.PI * 2;
}
function endAction() {
  if (action.type === "spin" && spinOffset !== 0) { ys.v -= spinOffset; spinOffset = 0; }
  action.type = "idle";
  action.forced = false;
  cooldown = rand(2.5, 5.5);
}
function pickIdle(): ActionType {
  const pool = IDLE_TABLE.filter(([t]) => t !== lastType && !(reduceMotion && t === "walk"));
  let r = Math.random() * pool.reduce((s, [, w]) => s + w, 0);
  for (const [t, w] of pool) { if ((r -= w) <= 0) return t; }
  return "look";
}
function react(type?: ActionType) {
  if (!currentVRM) return;
  if (action.forced && action.t < 0.4) return;
  const pool = REACTIONS.filter(
    (r) => r !== lastReaction && !(reduceMotion && (r === "jump" || r === "spin")),
  );
  const t = type ?? pool[Math.floor(Math.random() * pool.length)];
  lastReaction = t;
  startAction(t, true);
}
function mix(tgt: Pose, key: keyof Pose, to: number, w: number) {
  tgt[key] = lerp(tgt[key], to, w);
}
function applyActionPose(a: Action, tgt: Pose, o: Pose) {
  const prog = clamp(a.t / Math.max(a.dur, 0.001), 0, 1);
  const peak = Math.sin(Math.PI * prog);
  const env = clamp(Math.min(a.t / 0.3, (a.dur - a.t) / 0.35), 0, 1);
  switch (a.type) {
    case "look":
      tgt.headYaw = a.dir * 0.6; tgt.headPitch = a.p; break;
    case "think":
      Object.assign(tgt, THINK);
      tgt.headYaw = a.dir * 0.1;
      o.headRoll += Math.sin(a.t * 1.2) * 0.02;
      break;
    case "wave":
      Object.assign(tgt, {
        rightUpperArmZ: -0.3, rightUpperArmX: 0.2, rightLowerArmY: 1.7,
        headYaw: -0.15, headPitch: -0.05,
      });
      o.rightLowerArmY += Math.sin(a.t * 10) * 0.28 * env;
      o.rightUpperArmZ += Math.sin(a.t * 10 + 0.8) * 0.05 * env;
      break;
    case "shrug":
      mix(tgt, "leftUpperArmZ", 1.0, peak);
      mix(tgt, "rightUpperArmZ", -1.0, peak);
      mix(tgt, "leftUpperArmX", 0.15, peak);
      mix(tgt, "rightUpperArmX", 0.15, peak);
      tgt.headRoll = a.dir * 0.15 * peak;
      break;
    case "lookAround": {
      const first = a.t < a.dur * 0.5;
      tgt.headYaw = first ? a.dir * 0.55 : -a.dir * 0.4;
      tgt.chestYaw = tgt.headYaw * 0.4;
      break;
    }
    case "weightShift":
      tgt.hipsRoll = a.dir * 0.08 * env;
      tgt.chestRoll = -a.dir * 0.05 * env;
      tgt.headRoll = a.dir * 0.04 * env;
      break;
    case "nod":
      o.headPitch += Math.abs(Math.sin(a.t * 7)) * 0.18 * env; break;
    case "bow":
      tgt.chestPitch = 0.45 * peak; tgt.headPitch = 0.15 * peak; break;
    case "jump":
      tgt.leftUpperArmZ = 0.55; tgt.rightUpperArmZ = -0.55; break;
    case "spin":
      tgt.leftUpperArmZ = 1.0; tgt.rightUpperArmZ = -1.0; break;
  }
}
function applyChatPose(tgt: Pose) {
  if (S.talking) {
    Object.assign(tgt, {
      headPitch: 0.02, rightUpperArmZ: -0.6, rightUpperArmX: 0.25,
      rightLowerArmY: 0.8, leftUpperArmZ: 1.15,
    });
  } else if (S.thinking) {
    Object.assign(tgt, THINK, { headYaw: -0.1 });
  } else if (S.typing) {
    Object.assign(tgt, { headPitch: 0.14, chestPitch: 0.03 });
  }
}

/** Builds the 3D avatar inside `container` and returns a function that plays a reaction. */
export function initAvatar(container: HTMLElement, state: AvatarState) {
  S = state;
  const loadingEl = document.getElementById("avatar-loading");
  const hint = document.getElementById("avatar-hint");

  const getSize = () => ({
    w: Math.max(1, container.clientWidth),
    h: Math.max(1, container.clientHeight),
  });
  const { w, h } = getSize();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, w / h, 0.1, 20);
  camera.position.set(0, 1.3, 2.9);
  camera.lookAt(0, 1.05, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(1.5, 2.5, 1.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xd42a32, 0.7);
  rim.position.set(-2, 1.5, -1.5);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xf2ede4, 0.5);
  fill.position.set(0, 1, 3);
  scene.add(fill);

  const lookTarget = new THREE.Object3D();
  lookTarget.position.set(0, 1.35, 2);
  scene.add(lookTarget);

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  loader.load(
    "/models/viverse_avatar_model_214316.vrm",
    (gltf) => {
      const vrm = gltf.userData.vrm;
      if (!vrm) return;
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.combineSkeletons(gltf.scene);
      VRMUtils.rotateVRM0(vrm);
      baseYaw = vrm.scene.rotation.y;
      scene.add(vrm.scene);
      vrm.scene.position.set(0, 0, 0);
      if (vrm.lookAt) vrm.lookAt.target = lookTarget;
      currentVRM = vrm;
      loadingEl?.remove();
      container.classList.add("is-ready");
      setTimeout(() => react("wave"), 900);
      setTimeout(() => hint?.classList.add("is-hidden"), 9000);
    },
    undefined,
    (error) => {
      console.error("VRM Load Error:", error);
      if (loadingEl) loadingEl.textContent = "Assistant offline";
    },
  );

  const pointer = { x: 0, y: 0, tx: 0, ty: 0, last: 0 };
  window.addEventListener("pointermove", (e) => {
    const r = container.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height * 0.3;
    pointer.tx = clamp((e.clientX - cx) / (window.innerWidth * 0.45), -1, 1);
    pointer.ty = clamp(-(e.clientY - cy) / (window.innerHeight * 0.45), -1, 1);
    pointer.last = performance.now();
  }, { passive: true });
  container.addEventListener("pointerenter", () => (S.hover = true));
  container.addEventListener("pointerleave", () => (S.hover = false));
  container.addEventListener("pointerdown", () => {
    hint?.classList.add("is-hidden");
    react();
  });

  let visible = true;
  new IntersectionObserver(([entry]) => (visible = entry.isIntersecting)).observe(container);
  new ResizeObserver(() => {
    const s = getSize();
    camera.aspect = s.w / s.h;
    camera.updateProjectionMatrix();
    renderer.setSize(s.w, s.h);
  }).observe(container);

  const clock = new THREE.Clock();
  let time = 0;
  let talkEnv = 0, gestEnv = 0;
  let blinkT = -1, nextBlink = rand(2, 4), doubleBlink = false;
  let jitterT = 0;
  const jitter = { x: 0, y: 0 };
  const ex = { aa: 0, ih: 0, oh: 0, happy: 0.15 };

  function updateAvatar(vrm: any, dt: number) {
    const hum = vrm.humanoid;
    const now = performance.now();
    const chat = S.talking || S.thinking || S.typing;
    const speed = Math.abs(xs.vel);

    if (chat && !action.forced && action.type !== "idle") endAction();
    if (action.type === "idle") {
      cooldown -= dt;
      if (cooldown <= 0 && !chat) startAction(pickIdle());
    } else {
      action.t += dt;
      let done = false;
      switch (action.type) {
        case "walk":
          done = (Math.abs(xs.v - action.x) < 0.03 && speed < 0.06) || action.t > action.dur;
          break;
        case "jump":
          done = action.t > 0.15 && jumpY <= 0.001 && jumpV === 0;
          break;
        case "spin":
          done = action.t > 0.5 && Math.abs(ys.v - spinOffset) < 0.2;
          break;
        default:
          done = action.t >= action.dur;
      }
      if (done) endAction();
    }

    const tgt: Pose = { ...idlePose };
    for (const k of KEYS) ov[k] = 0;
    if (action.type !== "idle") applyActionPose(action, tgt, ov);
    if (chat && !action.forced) applyChatPose(tgt);

    const lw = S.talking ? 0.4 : S.thinking ? 0.15 : S.typing ? 0.25
              : action.type === "walk" ? 0.3 : 1;
    tgt.headYaw += pointer.x * 0.55 * lw;
    tgt.headPitch += -pointer.y * 0.3 * lw;
    tgt.chestYaw += pointer.x * 0.15 * lw;

    const br = Math.sin(time * 1.7);
    ov.chestPitch += br * 0.018;
    ov.headPitch += -br * 0.008 + Math.sin(time * 1.1) * 0.02;
    ov.headYaw += Math.sin(time * 0.8) * 0.03;
    ov.leftUpperArmZ += br * 0.012;
    ov.rightUpperArmZ -= br * 0.012;

    gestEnv = damp(gestEnv, S.talking ? 1 : 0, 3, dt);
    if (gestEnv > 0.01) {
      const g = gestEnv;
      ov.headYaw += noise(time, 2.1, 0) * 0.09 * g;
      ov.headPitch += noise(time, 2.7, 1) * 0.07 * g;
      ov.headRoll += noise(time, 1.3, 2) * 0.06 * g;
      ov.rightUpperArmZ += noise(time, 2.2, 3) * 0.18 * g;
      ov.rightUpperArmX += noise(time, 1.7, 4) * 0.22 * g;
      ov.rightLowerArmY += noise(time, 2.9, 5) * 0.25 * g;
      ov.leftUpperArmZ += noise(time, 1.9, 6) * 0.08 * g;
      ov.chestYaw += noise(time, 1.1, 7) * 0.05 * g;
    }
    if (S.typing && !S.talking) ov.headPitch += Math.sin(time * 5) * 0.012;
    if (S.thinking) ov.headRoll += Math.sin(time * 0.9) * 0.03;

    if (action.type === "walk") smoothDamp(xs, action.x, 0.45, dt, 0.7);
    else { xs.vel = damp(xs.vel, 0, 8, dt); xs.v += xs.vel * dt; }
    xs.v = clamp(xs.v, -WALK_LIMIT, WALK_LIMIT);

    const amp = clamp(Math.abs(xs.vel) / 0.4, 0, 1);
    if (amp > 0.03) gaitPhase += dt * (3.5 + 6.5 * amp);

    const spA = Math.sin(gaitPhase);
    const spB = Math.sin(gaitPhase + Math.PI);
    ov.rightUpperLegX += (spA > 0 ? spA * 0.62 : spA * 0.45) * amp;
    ov.leftUpperLegX  += (spB > 0 ? spB * 0.62 : spB * 0.45) * amp;
    ov.rightLowerLegX += Math.max(0, Math.sin(gaitPhase - 1.4)) * 0.85 * amp;
    ov.leftLowerLegX  += Math.max(0, Math.sin(gaitPhase + Math.PI - 1.4)) * 0.85 * amp;

    const armPhaseR = Math.sin(gaitPhase + Math.PI + 0.25);
    const armPhaseL = Math.sin(gaitPhase + 0.25);
    ov.rightUpperArmX += armPhaseR * 0.32 * amp;
    ov.leftUpperArmX  += armPhaseL * 0.32 * amp;
    ov.rightLowerArmY += Math.max(0, armPhaseR) * 0.25 * amp;
    ov.leftLowerArmY  -= Math.max(0, armPhaseL) * 0.25 * amp;

    ov.hipsYaw   += spA * 0.12 * amp;
    ov.chestYaw  -= spA * 0.10 * amp;
    ov.chestRoll += spA * 0.025 * amp;
    ov.headYaw   -= spA * 0.04 * amp;
    ov.hipsRoll  += Math.sin(gaitPhase + Math.PI / 2) * 0.05 * amp;

    const smoothTime = S.talking || action.forced ? 0.15 : 0.24;
    for (const k of KEYS) smoothDamp(springs[k], tgt[k], smoothTime, dt);
    const val = (k: keyof Pose) => springs[k].v + ov[k];

    const node = (n: string) => hum.getNormalizedBoneNode(n);
    const head = node("head"), chest = node("chest"), hips = node("hips");
    const lUA = node("leftUpperArm"), rUA = node("rightUpperArm");
    const lLA = node("leftLowerArm"), rLA = node("rightLowerArm");
    const lUL = node("leftUpperLeg"), rUL = node("rightUpperLeg");
    const lLL = node("leftLowerLeg"), rLL = node("rightLowerLeg");

    if (head) head.rotation.set(val("headPitch"), val("headYaw"), val("headRoll"));
    if (chest) chest.rotation.set(val("chestPitch"), val("chestYaw"), val("chestRoll"));
    if (hips) { hips.rotation.y = val("hipsYaw"); hips.rotation.z = val("hipsRoll"); }
    if (lUA) { lUA.rotation.z = val("leftUpperArmZ"); lUA.rotation.x = val("leftUpperArmX"); }
    if (rUA) { rUA.rotation.z = val("rightUpperArmZ"); rUA.rotation.x = val("rightUpperArmX"); }
    if (lLA) lLA.rotation.y = val("leftLowerArmY");
    if (rLA) rLA.rotation.y = val("rightLowerArmY");
    if (lUL) lUL.rotation.x = val("leftUpperLegX");
    if (rUL) rUL.rotation.x = val("rightUpperLegX");
    if (lLL) lLL.rotation.x = val("leftLowerLegX");
    if (rLL) rLL.rotation.x = val("rightLowerLegX");

    const walking = action.type === "walk" && Math.abs(xs.vel) > 0.05;
    const facing = walking ? Math.sign(xs.vel) * 0.95
                  : pointer.x * (S.talking ? 0.1 : 0.22);
    smoothDamp(ys, facing + spinOffset, spinOffset !== 0 ? 0.3 : 0.22, dt);

    if (jumpY > 0 || jumpV !== 0) {
      jumpV -= 8 * dt;
      jumpY += jumpV * dt;
      if (jumpY <= 0) { jumpY = 0; jumpV = 0; landKick = 1; }
    }
    landKick = damp(landKick, 0, 9, dt);
    const bob = Math.abs(Math.sin(gaitPhase)) * 0.018 * amp;
    const targetLean = walking ? amp * 0.035 * Math.sign(xs.vel || 1) : 0;
    leanX = damp(leanX, targetLean, 6, dt);

    vrm.scene.position.set(xs.v, jumpY + bob, 0);
    vrm.scene.rotation.y = ys.v + baseYaw;
    vrm.scene.rotation.x = leanX;
    vrm.scene.scale.set(1 + 0.015 * landKick, 1 - 0.035 * landKick, 1 + 0.015 * landKick);

    jitterT -= dt;
    if (jitterT <= 0) {
      jitterT = rand(0.8, 2.5);
      jitter.x = rand(-0.08, 0.08);
      jitter.y = rand(-0.05, 0.05);
    }
    let gx = pointer.x * 1.2;
    let gy = 1.35 + pointer.y * 0.5;
    if (S.thinking) { gx = -0.5; gy = 1.75; }
    else if (S.typing) { gx = 0; gy = 0.95; }
    else if (S.hover) { gx = 0; gy = 1.4; }
    lookTarget.position.x = damp(lookTarget.position.x, gx + xs.v + jitter.x, 10, dt);
    lookTarget.position.y = damp(lookTarget.position.y, gy + jitter.y, 10, dt);
    lookTarget.position.z = 2;

    const em = vrm.expressionManager;
    nextBlink -= dt;
    if (blinkT < 0 && nextBlink <= 0) {
      blinkT = 0;
      doubleBlink = Math.random() < 0.2;
    }
    let blinkVal = 0;
    if (blinkT >= 0) {
      blinkT += dt;
      const p = blinkT / 0.16;
      blinkVal = p < 1 ? Math.sin(p * Math.PI) : 0;
      if (p >= 1) {
        blinkT = -1;
        if (doubleBlink) { nextBlink = 0.12; doubleBlink = false; }
        else nextBlink = rand(2.5, 5.5);
      }
    }
    em?.setValue("blink", blinkVal);

    const chunkFresh = now - S.lastChunkAt < 350;
    talkEnv = damp(talkEnv, S.talking ? (chunkFresh ? 1 : 0.2) : 0, 12, dt);
    const m1 = Math.abs(Math.sin(time * 11.3)) * (0.6 + 0.4 * Math.sin(time * 3.1));
    ex.aa = damp(ex.aa, talkEnv * 0.65 * m1, 22, dt);
    ex.ih = damp(ex.ih, talkEnv * 0.3 * Math.abs(Math.cos(time * 8.7)), 22, dt);
    ex.oh = damp(ex.oh, talkEnv * 0.25 * Math.abs(Math.sin(time * 5.9 + 1)), 22, dt);
    const excited =
      action.type === "wave" || action.type === "jump" || action.type === "spin" || S.hover;
    const happyT = S.talking ? 0.45 : excited ? 0.75 : S.thinking ? 0.02
                 : 0.15 + Math.sin(time * 0.7) * 0.05;
    ex.happy = damp(ex.happy, happyT, 6, dt);
    em?.setValue("aa", ex.aa);
    em?.setValue("ih", ex.ih);
    em?.setValue("oh", ex.oh);
    em?.setValue("happy", ex.happy);

    const ds = S.talking ? "talking" : S.thinking ? "thinking" : "idle";
    if (container!.dataset.state !== ds) container!.dataset.state = ds;

    vrm.update(dt);
  }

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 1 / 30);
    if (document.hidden || !visible) return;
    time += dt;
    if (performance.now() - pointer.last > 5000) { pointer.tx = 0; pointer.ty = 0; }
    pointer.x = damp(pointer.x, pointer.tx, 5, dt);
    pointer.y = damp(pointer.y, pointer.ty, 5, dt);
    camera.position.x = damp(camera.position.x, pointer.x * 0.12, 3, dt);
    camera.position.y = damp(camera.position.y, 1.3 + pointer.y * 0.05, 3, dt);
    camera.lookAt(0, 1.05, 0);
    if (currentVRM?.humanoid) updateAvatar(currentVRM, dt);
    renderer.render(scene, camera);
  }
  frame();

  return react;
}
