import test from 'node:test';
import { Script } from 'node:vm';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { robotEyeAtlas, posterArtwork } from '../src/eyeArtwork.ts';
import { createEyeMotion, chooseRobotGlance, stepRobotEye } from '../src/robotEyeRuntime.ts';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const bytes = value => Buffer.from(value.split(',')[1], 'base64');

test('React and generated legacy branding use the exact approved self-contained artwork', () => {
  for (const [value, name] of [[robotEyeAtlas, 'robot-eye-atlas.webp'], [posterArtwork, 'robot-eye-poster.webp']]) {
    assert.ok(value.startsWith('data:image/webp;base64,'));
    assert.deepEqual(bytes(value), readFileSync(new URL('../public/resources/' + name, import.meta.url)));
    assert.equal(bytes(value).toString('ascii', 8, 12), 'WEBP');
    assert.ok(read('../../cos-eye-branding.js').includes(JSON.stringify(value)));
  }
  assert.ok(read('../public/resources/vision-eye-round.svg').includes(posterArtwork));
  const runtime = ['../src/robotEyeMechanics.ts', '../src/robotEyeRuntime.ts'].map(read).join('\n');
  assert.ok(read('../../cos-eye-branding.js').includes('Runtime SHA-256: ' + createHash('sha256').update(runtime).digest('hex')));
  assert.doesNotThrow(() => new Script(read('../../cos-eye-branding.js')));
});

test('random scans cover all directions with bounded turns and varied pauses', () => {
  let seed=193;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
  const state=createEyeMotion(),seen=new Set(),durations=new Set(),pauses=new Set();
  for(let i=0;i<120;i++){
    const before=state.lastDirection,now=i*4000;
    chooseRobotGlance(state,now,random);
    assert.notEqual(state.lastDirection,before);seen.add(state.lastDirection);
    assert.ok(Math.abs(state.target.x)<=88);assert.ok(Math.abs(state.target.y)<=42);
    assert.ok(state.moveDuration>=140&&state.moveDuration<290);
    const pause=state.holdUntil-now-state.moveDuration;assert.ok(pause>=550&&pause<2050);
    durations.add(Math.round(state.moveDuration));pauses.add(Math.round(pause));
    for(const part of [0,.25,.5,.75,1]){
      const p=stepRobotEye(state,now+state.moveDuration*part,random);
      assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));assert.ok(Math.abs(p.x)<=88&&Math.abs(p.y)<=42);
    }
    assert.ok(Math.abs(state.position.x-state.target.x)<1e-9);assert.ok(Math.abs(state.position.y-state.target.y)<1e-9);
  }
  assert.equal(seen.size,9);assert.ok(durations.size>20);assert.ok(pauses.size>40);
});

test('initial and settled poses stay still until their next glance is due',()=>{
  const state=createEyeMotion(20);assert.deepEqual(stepRobotEye(state,600),{x:0,y:0});
  chooseRobotGlance(state,700,()=>.5);stepRobotEye(state,1000);const settled={...state.position};
  assert.deepEqual(stepRobotEye(state,state.holdUntil-1),settled);
  stepRobotEye(state,state.holdUntil+1);assert.deepEqual(state.origin,settled);
});

test('the shared renderer preserves accessibility, pause/cleanup, print and document boundaries without operational calls',()=>{
  const react=read('../src/AnimatedEye.tsx'),runtime=read('../src/robotEyeRuntime.ts'),adapter=read('../scripts/eye-branding-adapter.js');
  assert.match(react,/aria-label='Cameras Onsite'/);assert.match(react,/return mountRobotEye/);
  for(const pattern of [/IntersectionObserver/,/ResizeObserver/,/visibilitychange/,/prefers-reduced-motion/,/beforeprint/,/afterprint/,/cancelAnimationFrame/,/eye\.destroyed/,/unobserve/,/512/,/1000 \/ 30/])assert.match(runtime,pattern);
  assert.match(adapter,/image\.closest\(ignored\)/);assert.match(adapter,/dispose\(\)/);
  assert.doesNotMatch(runtime+adapter,/fetch\(|XMLHttpRequest|WebSocket|supabase|localStorage|sessionStorage|geolocation/);
  for(const name of ['../src/animatedEye.css','../../cos-eye-branding.css'])assert.match(read(name),/@media print/);
});

test('every existing branding entrypoint and install icon has a fresh cache version',()=>{
  for(const name of ['index','onsite-vision','camera-health','camera-detail','it-send-repair']){
    const html=read('../../'+name+'.html');
    assert.match(html,/cos-eye-branding\.css\?v=20261018-cos-logo/);assert.match(html,/cos-eye-branding\.js\?v=20261018-cos-logo/);
    for(const [tag] of html.matchAll(/<link[^>]+rel=["'](?:icon|apple-touch-icon)["'][^>]*>/g))assert.match(tag,/techcheck-eye-(?:favicon-32|apple-180)\.png\?v=20261018-cos-logo/);
  }
  const worker=read('../../sw.js');assert.match(worker,/tech-check-cos-logo-20261018/);
  assert.match(worker,/icon: '\.\/techcheck-eye-192\.png\?v=20261018-cos-logo'/);
  assert.match(worker,/badge: '\.\/techcheck-eye-favicon-32\.png\?v=20261018-cos-logo'/);
  assert.deepEqual(JSON.parse(read('../../manifest.webmanifest')).icons,[{src:'./techcheck-eye-192.png?v=20261018-cos-logo',sizes:'192x192',type:'image/png',purpose:'any'}]);
  for(const [name,size] of [['favicon-32',32],['192',192],['apple-180',180]]){
    const icon=readFileSync(new URL('../../techcheck-eye-'+name+'.png',import.meta.url));
    assert.equal(icon.readUInt32BE(16),size);assert.equal(icon.readUInt32BE(20),size);
    assert.deepEqual(icon,readFileSync(new URL('../../../cameras-on-site/tech-check-netlify/techcheck-eye-'+name+'.png',import.meta.url)));
  }
});
