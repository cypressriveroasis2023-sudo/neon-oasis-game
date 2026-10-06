import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const base = 'https://cypressriveroasis2023-sudo.github.io/neon-oasis-game/';
const walk = dir => readdirSync(dir).flatMap(name => {
  const path = dir + '/' + name;
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const files = [
  'tech-checks/index.html',
  'tech-checks/operations-host.js',
  'tech-checks/production-assignments-host.js',
  'tech-checks/operations-host.css',
  'tech-checks/vision-platform.css',
  'tech-checks/vision-workspace.js',
  'tech-checks/company-host-theme.css',
  'tech-checks/company-tools-theme.css',
  'tech-checks/camera-health.html',
  'tech-checks/camera-health-history.js',
  'tech-checks/camera-health-history.css',
  'tech-checks/camera-detail.html',
  'tech-checks/onsite-vision.html',
  'tech-checks/onsite-vision.js',
  'tech-checks/onsite-vision-composer.css',
  'tech-checks/it-send-repair.html',
  'tech-checks/app.js',
  'tech-checks/technician-wizard-owner-dashboard-v5.js',
  ...walk('tech-checks/resources/fonts'),
  ...walk('tech-checks/operations/dist')
];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const expected = new Map(files.map(path => [path, digest(readFileSync(path))]));
const deadline = Date.now() + 240000;
let pending = files;
while (pending.length && Date.now() < deadline) {
  const results = await Promise.all(pending.map(async path => {
    try {
      const url = new URL(path, base);
      url.searchParams.set('cos_verify', process.env.GITHUB_SHA || 'current');
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (digest(bytes) !== expected.get(path)) throw new Error('published bytes differ from checked-out commit');
      console.log('Verified ' + path + ' (' + bytes.length + ' bytes)');
      return null;
    } catch (error) {
      console.log('Waiting for ' + path + ': ' + error.message);
      return path;
    }
  }));
  pending = results.filter(Boolean);
  if (pending.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10000));
}
if (pending.length) throw new Error('Pages verification failed for: ' + pending.join(', '));
console.log('GitHub Pages serves all ' + files.length + ' verified Operations and preserved technician files.');
