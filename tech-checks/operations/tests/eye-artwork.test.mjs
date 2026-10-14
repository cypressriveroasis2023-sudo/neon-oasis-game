import test from 'node:test';
import { Script } from 'node:vm';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { housingArtwork, lensArtwork } from '../src/eyeArtwork.ts';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const decode = value => Buffer.from(value.split(',')[1], 'base64').toString();
test('both self-contained layers preserve the exact original JPEG bytes', () => {
  const original = readFileSync(new URL('../public/resources/vision-approved-eye.jpeg', import.meta.url));
  const expected = 'data:image/jpeg;base64,' + original.toString('base64');
  for (const value of [housingArtwork, lensArtwork]) {
    assert.ok(value.startsWith('data:image/svg+xml;base64,'));
    const svg = decode(value);
    assert.ok(svg.includes(expected));
    assert.match(svg, /viewBox="205 0 914 914"/);
    assert.doesNotMatch(svg, /<script|https?:\/\/(?!www.w3.org)/);
  }
  assert.ok(read('../public/resources/vision-eye-round.svg').includes(expected));
  assert.deepEqual(readFileSync(new URL('../../resources/vision-ai.jpg', import.meta.url)), original);
  assert.match(decode(lensArtwork), /circle cx="659" cy="428" r="138"/);
});
test('React and legacy use the same original layers and bounded optical socket', () => {
  const legacy = read('../../cos-eye-branding.js');
  assert.doesNotThrow(() => new Script(legacy));
  assert.ok(legacy.includes(JSON.stringify(housingArtwork)));
  assert.ok(legacy.includes(JSON.stringify(lensArtwork)));
  const react = read('../src/AnimatedEye.tsx');
  for (const source of [legacy, react]) {
    assert.ok(source.includes('622.875'));
    assert.ok(source.includes('587.204'));
    assert.ok(source.includes('189.335'));
  }
  assert.match(react, /x='0' y='0' width='1254' height='1254'/);
  assert.match(legacy, /x="0" y="0" width="1254" height="1254"/);
});
test('both renderers preserve gaze timing, accessibility, offscreen pause and reduced-motion', () => {
  for (const file of ['../src/animatedEye.css', '../../cos-eye-branding.css']) {
    const css = read(file);
    for (const pattern of [/12s/, /translateX\(-10px\)/, /translateX\(10px\)/, /prefers-reduced-motion: reduce|prefers-reduced-motion:reduce/, /animation-play-state:\s*paused/, /@media print/]) assert.match(css, pattern);
  }
  for (const file of ['../src/AnimatedEye.tsx', '../../cos-eye-branding.js']) {
    const source = read(file);
    for (const pattern of [/aria-label/, /visibilitychange/, /IntersectionObserver/, /clipPath/]) assert.match(source, pattern);
  }
  const legacy = read('../../cos-eye-branding.js');
  assert.match(legacy, /image\.closest\(ignored\)/);
  assert.doesNotMatch(legacy, /leaflet-marker|map-marker|fleet-marker/);
});

test('static branding consumers and service-worker cache advance with the supplied artwork',()=>{
 for(const name of ['index.html','onsite-vision.html','camera-health.html']){
  const html=readFileSync(new URL('../../'+name,import.meta.url),'utf8');
  assert.match(html,/cos-eye-branding\.css\?v=20261014-original/);
  const icons=[...html.matchAll(/<link[^>]+rel=["'](?:icon|apple-touch-icon)["'][^>]*>/g)];assert.ok(icons.length>0,name);
  for(const [tag] of icons){assert.match(tag,/\?v=20261014["']/);assert.match(tag,/techcheck-eye-(?:favicon-32|apple-180)\.png/);}
 }
 const worker=readFileSync(new URL('../../sw.js',import.meta.url),'utf8');
 assert.match(worker,/tech-check-reference-eye-20261014/);
 assert.match(worker,/icon: '\.\/techcheck-eye-192\.png\?v=20261014'/);
 assert.match(worker,/badge: '\.\/techcheck-eye-favicon-32\.png\?v=20261014'/);
});

test('the install icon declares its actual square PNG dimensions',()=>{const manifest=JSON.parse(read('../../manifest.webmanifest'));assert.deepEqual(manifest.icons,[{src:'./techcheck-eye-192.png?v=20261014',sizes:'192x192',type:'image/png',purpose:'any'}]);});
