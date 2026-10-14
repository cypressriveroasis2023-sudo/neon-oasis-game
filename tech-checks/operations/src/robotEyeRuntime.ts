import { robotEyeAtlas } from './eyeArtwork';
import { drawMechanicalSocket } from './robotEyeMechanics';

export type EyePose = { x: number; y: number };
export type EyeMotion = {
  position: EyePose; origin: EyePose; target: EyePose;
  moveStart: number; moveDuration: number; holdUntil: number; lastDirection: number;
};
const directions = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -.7], [1, -.7], [-1, .7], [1, .7]];
export function createEyeMotion(now = 0): EyeMotion {
  return { position: { x: 0, y: 0 }, origin: { x: 0, y: 0 }, target: { x: 0, y: 0 }, moveStart: now, moveDuration: 1, holdUntil: now + 650, lastDirection: 0 };
}
export function chooseRobotGlance(state: EyeMotion, now: number, random = Math.random) {
  const candidates = directions.map((_, index) => index).filter(index => index !== state.lastDirection);
  const index = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
  state.lastDirection = index;
  const direction = directions[index];
  state.origin = { ...state.position };
  state.target = { x: direction[0] * (58 + random() * 30), y: direction[1] * (24 + random() * 18) };
  state.moveStart = now;
  state.moveDuration = 140 + random() * 150;
  state.holdUntil = now + state.moveDuration + 550 + random() * 1500;
}
export function stepRobotEye(state: EyeMotion, now: number, random = Math.random): EyePose {
  if (now > state.holdUntil) chooseRobotGlance(state, now, random);
  const u = Math.max(0, Math.min(1, (now - state.moveStart) / state.moveDuration));
  const ease = 1 - Math.pow(1 - u, 4);
  const settle = Math.sin(u * Math.PI * 3) * (1 - u) * u * 1.7;
  state.position = {
    x: Math.max(-88, Math.min(88, state.origin.x + (state.target.x - state.origin.x) * ease + settle)),
    y: Math.max(-42, Math.min(42, state.origin.y + (state.target.y - state.origin.y) * ease + settle * .45)),
  };
  return state.position;
}

function paint(canvas: HTMLCanvasElement, image: HTMLImageElement, pose: EyePose, time: number) {
  const c = canvas.getContext('2d');
  if (!c) return;
  c.setTransform(canvas.width / 720, 0, 0, canvas.height / 720, 0, 0);
  const background = c.createRadialGradient(360, 360, 20, 360, 360, 510);
  background.addColorStop(0, '#141619'); background.addColorStop(1, '#060708');
  c.fillStyle = background; c.fillRect(0, 0, 720, 720);
  drawMechanicalSocket(c, pose, time);
  const ratio = Math.min(1, Math.hypot(pose.x / 88, pose.y / 42));
  const width = 312 * (1 - Math.abs(pose.x) / 88 * .12);
  const height = 312 * (1 - Math.abs(pose.y) / 42 * .08);
  c.save(); c.beginPath(); c.ellipse(359, 357, 222, 155, 0, 0, Math.PI * 2); c.clip();
  c.drawImage(image, 1120, 195, 490, 490, 359 + pose.x - width / 2, 357 + pose.y - height / 2 + ratio * 1.5, width, height);
  c.restore();
  c.drawImage(image, 45, 0, 900, 887, 45, 49.55, 630, 620.9);
}

type EyeHandle = {
  host: SVGSVGElement; canvas: HTMLCanvasElement; motion: EyeMotion;
  visible: boolean; active: boolean; image?: HTMLImageElement;
  resize: ResizeObserver; destroyed: boolean;
};
const handles = new Set<EyeHandle>();
let visibility: IntersectionObserver | undefined;
let preference: MediaQueryList | undefined;
let frame: number | undefined;
let lastDraw = -Infinity;
let printing = false;
let atlasPromise: Promise<HTMLImageElement> | undefined;
function atlas() {
  return atlasPromise ??= new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Eye artwork could not load'));
    image.src = robotEyeAtlas;
  }).catch(error => { atlasPromise = undefined; throw error; });
}
function activeEyes() { return [...handles].some(eye => eye.active && eye.image); }
function schedule() {
  if (activeEyes() && frame === undefined) frame = requestAnimationFrame(tick);
  if (!activeEyes() && frame !== undefined) { cancelAnimationFrame(frame); frame = undefined; }
}
function tick(now: number) {
  frame = undefined;
  if (now - lastDraw >= 1000 / 30) {
    lastDraw = now;
    for (const eye of handles) if (eye.active && eye.image) paint(eye.canvas, eye.image, stepRobotEye(eye.motion, now), now / 1000);
  }
  schedule();
}
function sync() {
  const staticView = printing || !!preference?.matches;
  const now = performance.now();
  for (const eye of handles) {
    const active = eye.visible && !document.hidden && !staticView;
    if (active && !eye.active) {
      // Resume from the visible pose; do not fast-forward an offscreen eye.
      eye.motion.origin = { ...eye.motion.position }; eye.motion.target = { ...eye.motion.position };
      eye.motion.moveStart = now; eye.motion.moveDuration = 1; eye.motion.holdUntil = now + 650;
    }
    eye.active = active;
    eye.host.dataset.motionPaused = String(!active);
    if (staticView && eye.image) paint(eye.canvas, eye.image, { x: 0, y: 0 }, 0);
  }
  schedule();
}
function beforePrint() { printing = true; sync(); }
function afterPrint() { printing = false; sync(); }
function startObservers() {
  if (visibility) return;
  preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  preference.addEventListener('change', sync);
  visibility = new IntersectionObserver(entries => {
    for (const entry of entries) for (const eye of handles) if (eye.host === entry.target) eye.visible = entry.isIntersecting;
    sync();
  });
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('beforeprint', beforePrint);
  window.addEventListener('afterprint', afterPrint);
}

/** One shared scheduler and decoded atlas; no operational reads or actions. */
export function mountRobotEye(host: SVGSVGElement, canvas: HTMLCanvasElement): () => void {
  startObservers();
  const resize = new ResizeObserver(() => resizeCanvas());
  const eye: EyeHandle = { host, canvas, motion: createEyeMotion(performance.now()), visible: false, active: false, resize, destroyed: false };
  function resizeCanvas() {
    const size = Math.max(32, Math.min(512, Math.round((host.getBoundingClientRect().width || 72) * Math.min(2, window.devicePixelRatio || 1))));
    if (canvas.width !== size || canvas.height !== size) { canvas.width = size; canvas.height = size; }
    if (eye.image) paint(canvas, eye.image, printing || preference?.matches ? { x: 0, y: 0 } : eye.motion.position, 0);
  }
  handles.add(eye); resizeCanvas(); resize.observe(host); visibility!.observe(host);
  host.dataset.motionPaused = 'true';
  void atlas().then(image => {
    if (eye.destroyed) return;
    eye.image = image; resizeCanvas(); host.dataset.eyeReady = 'true'; sync();
  }).catch(() => { if (!eye.destroyed) host.dataset.eyeReady = 'false'; });
  return () => {
    eye.destroyed = true; resize.disconnect(); visibility?.unobserve(host); handles.delete(eye); schedule();
    if (!handles.size) {
      visibility?.disconnect(); visibility = undefined;
      preference?.removeEventListener('change', sync); preference = undefined;
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('beforeprint', beforePrint); window.removeEventListener('afterprint', afterPrint);
      printing = false; lastDraw = -Infinity;
    }
  };
}
