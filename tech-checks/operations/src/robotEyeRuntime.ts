import { robotEyeAtlas } from './eyeArtwork';

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
  const full = canvas.dataset.companyLogo === 'full';
  const width = full ? 1490 : 540, height = full ? 530 : 540;
  c.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  c.clearRect(0, 0, width, height);
  if (full) { c.fillStyle = '#111c2c'; c.fillRect(0, 0, width, height); }
  c.save();
  // Full company lockup and eye-only artwork share the exact approved sensor.
  c.translate(full ? -250 : -261, full ? -125 : -118);
  if (full) c.drawImage(image, 0, 0, 1983, 793, 0, 0, 1983, 793);
  else c.drawImage(image, 540, 793, 540, 540, 261, 118, 540, 540);
  c.save(); c.beginPath(); c.arc(531, 401, 119, 0, Math.PI * 2); c.clip();
  c.drawImage(image, 0, 793, 270, 270, 396 + pose.x * .28, 266 + pose.y * .4, 270, 270);
  c.restore();
  // The white upper contour and all four sights stay fixed during every glance.
  c.drawImage(image, 270, 793, 270, 270, 396, 266, 270, 270);
  c.restore();
}

type EyeHandle = {
  host: HTMLElement; canvas: HTMLCanvasElement; motion: EyeMotion;
  visible: boolean; active: boolean; image?: HTMLImageElement;
  resize: ResizeObserver; destroyed: boolean;
};
const handles = new Set<EyeHandle>();
let visibility: IntersectionObserver | undefined;
let preference: MediaQueryList | undefined;
let frame: number | undefined;
let wake: Animation | undefined;
let wakeAt = Infinity;
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
function visualTime() {
  // The document timeline follows displayed frames. Operational timers can
  // advance independently without making the eye replay every missed frame.
  const time = document.timeline?.currentTime;
  return typeof time === 'number' ? time : performance.now();
}
function schedule() {
  const eyes = [...handles].filter(eye => eye.active && eye.image);
  const now = visualTime();
  const delay = Math.min(...eyes.map(({ motion }) => {
    const moving = now < motion.moveStart + motion.moveDuration ||
      motion.position.x !== motion.target.x || motion.position.y !== motion.target.y;
    return moving ? Math.max(0, 1000 / 30 - (now - lastDraw)) : Math.max(0, motion.holdUntil - now);
  }));
  if (delay === 0) {
    if (wake !== undefined) { wake.cancel(); wake = undefined; wakeAt = Infinity; }
    if (frame === undefined) frame = requestAnimationFrame(tick);
  } else {
    if (frame !== undefined) { cancelAnimationFrame(frame); frame = undefined; }
    if (!eyes.length || now + delay < wakeAt) {
      if (wake !== undefined) wake.cancel();
      wake = undefined; wakeAt = Infinity;
      if (eyes.length) {
        wakeAt = now + delay;
        // Wake on the visual timeline, independently of operational timers.
        // Empty keyframes keep the element's appearance and layout intact.
        const animation = eyes[0].host.animate([], { duration: Math.max(1, Math.ceil(delay)) });
        wake = animation;
        void animation.finished.then(() => {
          if (wake !== animation) return;
          wake = undefined; wakeAt = Infinity; schedule();
        }).catch(() => { /* Cancellation accompanies pause or disposal. */ });
      }
    }
  }
}
function tick() {
  frame = undefined;
  const now = visualTime();
  if (now - lastDraw >= 1000 / 30) {
    lastDraw = now;
    for (const eye of handles) if (eye.active && eye.image) paint(eye.canvas, eye.image, stepRobotEye(eye.motion, now), now / 1000);
  }
  schedule();
}
function sync() {
  const staticView = printing || !!preference?.matches;
  const now = visualTime();
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
export function mountRobotEye(host: HTMLElement, canvas: HTMLCanvasElement): () => void {
  startObservers();
  const resize = new ResizeObserver(() => resizeCanvas());
  const eye: EyeHandle = { host, canvas, motion: createEyeMotion(visualTime()), visible: false, active: false, resize, destroyed: false };
  function resizeCanvas() {
    const size = Math.max(32, Math.min(512, Math.round((host.getBoundingClientRect().width || 72) * Math.min(2, window.devicePixelRatio || 1))));
    const height = host.dataset.companyLogo === 'full' ? Math.round(size * 530 / 1490) : size;
    canvas.dataset.companyLogo = host.dataset.companyLogo || 'eye';
    if (canvas.width !== size || canvas.height !== height) { canvas.width = size; canvas.height = height; }
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
