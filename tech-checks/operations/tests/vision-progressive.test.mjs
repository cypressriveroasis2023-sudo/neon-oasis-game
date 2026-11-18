import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardSources, emptyTodayDashboard, loadTodayDashboard, loadCompanyEquipment, summarizeTodayDashboard } from '../src/todayDashboardData.ts';
import { resource, snapshot, now } from './fixtures/camera-evidence-fixtures.mjs';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('initial dashboard shells show checking and unknown values rather than premature zero or success', () => {
  const compiled = buildSync({
    stdin: {
      contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import VisionAreas from './src/VisionAreas.tsx';import CompanyOverview from './src/CompanyOverview';import {emptyTodayDashboard} from './src/todayDashboardData';export const fleet=()=>renderToStaticMarkup(<VisionAreas api={{get:async()=>{throw new Error('Not requested during server render');}}} navigate={()=>{}}/>);export const company=()=>renderToStaticMarkup(<CompanyOverview data={emptyTodayDashboard()} equipment={null} openWorkspace={()=>{}} browseStage={()=>{}} stageFilter={null}/>);`,
      resolveDir: dirname(fileURLToPath(new URL('../package.json', import.meta.url))), loader: 'tsx',
    },
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
    resolveExtensions: ['.ts', '.tsx', '.mjs', '.js', '.json'],
    loader: { '.css': 'empty' }, external: ['react', 'react-dom/server'],
  }).outputFiles[0].text;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(createRequire(import.meta.url), module, module.exports);
  const fleet = module.exports.fleet(), company = module.exports.company();
  assert.equal((fleet.match(/Checking connected records…/g) || []).length, 6);
  assert.doesNotMatch(fleet, /0 routers|0 field units|0 confirmed on hand/);
  assert.match(company, /Equipment systems/);
  assert.doesNotMatch(company, /company-health-card/);
  assert.match(company, /Quote: Checking…/);
  assert.match(company, /Total unverified/);
  assert.doesNotMatch(company, /0 review items|Nothing currently needs Owner attention|No provider systems flagged|0 stored router records/);
});

test('Today no longer waits on job, quote, invoice, purchasing or owner-task sources', async () => {
  const seen = [];
  const result = await loadTodayDashboard({ get: async path => { seen.push(path); throw new Error('not called'); } });
  assert.deepEqual(dashboardSources, []);
  assert.deepEqual(seen, []);
  assert.equal(result.jobs, null);
  assert.equal(summarizeTodayDashboard(emptyTodayDashboard()).attention, null);
});

test('company equipment publishes camera and router results separately and isolates malformed sources', async () => {
  for (const cameraFirst of [true, false]) {
    const camera = deferred(), routers = deferred(), updates = [];
    const pending = loadCompanyEquipment({ get: path => path.includes('camera-health') ? camera.promise : routers.promise }, value => updates.push(value));
    const cameraData = snapshot([resource(1)]);
    const routerData = { items: [], source: 'camera_health', gpsAvailable: false, generatedAt: new Date(now).toISOString() };
    if (cameraFirst) camera.resolve({ data: cameraData });
    else routers.resolve({ data: routerData });
    await tick();
    assert.equal(updates.length, 1);
    assert.ok(updates[0][cameraFirst ? 'camera' : 'routers']);
    assert.equal(updates[0][cameraFirst ? 'routers' : 'camera'], null);
    if (cameraFirst) routers.resolve({ data: { ...routerData, gpsAvailable: true } });
    else camera.resolve({ data: { ...cameraData, totalDevices: 99 } });
    const result = await pending;
    assert.equal(updates.length, 2);
    assert.match(result.errors[cameraFirst ? 'routers' : 'camera'], /could not be loaded/);
    assert.deepEqual(updates[0].errors, {});
    assert.equal(result[cameraFirst ? 'routers' : 'camera'], null);
  }
});
