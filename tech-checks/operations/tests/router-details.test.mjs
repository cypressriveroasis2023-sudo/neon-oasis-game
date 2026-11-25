import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseRouterDetails, readRouterDetails, linkRouter, signalWord, milesBetween, suggestUnit, unitKeyOf} from '../src/routerDetails.ts';

const reply = (status, body) => async () => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

test('router details: card fields parsed, junk and SIM numbers never kept', () => {
  const d = parseRouterDetails({routers: [{unit: 'SPOTTER 183', serial: 'RF6151234', model: 'IR615', status: 'online', at: '2026-11-25T18:07:00Z',
    ip: '166.1.2.3', ipFrom: 'inhand', cosDiffers: true, port: 8080, iccid: '8901', imsi: '3102',
    sig: {level: 4, radio: '4G', band: 'B12', rsrp: -88, junk: 'x'}, carrier: 'T-Mobile', fw: '2.3.0', gps: {lat: 33.1, lng: -97.2}},
    {unit: 'BAD', serial: 'X', gps: {lat: 200, lng: 0}}], unmatched: [{serial: 'RF61599', name: 'SS 052', model: 'IR615', online: true}], units: ['SOLARSPOTTER 052']});
  const r = d.routers[0];
  assert.equal(r.ip, '166.1.2.3'); assert.equal(r.port, 8080); assert.equal(r.cosDiffers, true);
  assert.equal(r.sig.rsrp, -88); assert.equal('junk' in r.sig, false);
  assert.equal(JSON.stringify(d).includes('8901'), false, 'no ICCID');
  assert.equal(JSON.stringify(d).includes('3102'), false, 'no IMSI');
  assert.equal(d.routers[1]?.gps, undefined, 'out-of-range GPS dropped');
  assert.equal(d.unmatched[0].serial, 'RF61599');
});

test('router details: refused read is quiet, failures say so', async () => {
  const denied = await readRouterDetails(reply(403, {error: 'Owner or IT only.'}), 'tok');
  assert.deepEqual([denied.ok, denied.denied], [false, true]);
  const down = await readRouterDetails(async () => { throw new Error('net'); }, 'tok');
  assert.deepEqual([down.ok, down.denied], [false, false]);
  const ok = await readRouterDetails(reply(200, {routers: [], unmatched: [], units: []}), 'tok');
  assert.equal(ok.ok, true);
});

test('link router: only an ok answer counts as linked', async () => {
  assert.deepEqual(await linkRouter('SPOTTER 271', 'RF1', reply(200, {ok: true, message: 'Linked.'}), 'tok'), {ok: true, message: 'Linked.'});
  const refused = await linkRouter('SPOTTER 271', 'RF1', reply(409, {ok: false, message: 'That unit already has a router.'}), 'tok');
  assert.equal(refused.ok, false); assert.match(refused.message, /already has a router/);
});

test('signal words, distance, suggestions and keys', () => {
  assert.equal(signalWord({rsrp: -85}), 'Good'); assert.equal(signalWord({rsrp: -100}), 'Fair'); assert.equal(signalWord({rsrp: -115}), 'Poor');
  assert.equal(signalWord({level: 1}), 'Poor'); assert.equal(signalWord(undefined), null);
  const mi = milesBetween({lat: 32.7767, lng: -96.797}, {lat: 32.7555, lng: -97.3308});
  assert.ok(mi > 29 && mi < 33, 'Dallas to Fort Worth is about 31 miles, got ' + mi);
  assert.equal(suggestUnit('SS 052', ['SOLARSPOTTER 052', 'SPOTTER 183']), 'SOLARSPOTTER 052');
  assert.equal(suggestUnit('Spare router', ['SPOTTER 183']), null);
  assert.equal(suggestUnit('SPOTTER 1', ['SPOTTER 1', 'Spotter-1']), null, 'two matches means no guess');
  assert.equal(unitKeyOf('  Spotter   183 '), 'spotter 183');
});

test('unit card draws the router box with the :8080 button and never a SIM number', () => {
  const src = fs.readFileSync(new URL('../src/cosBoard/boardApp.ts', import.meta.url), 'utf8');
  assert.match(src, /camsBox\(v\), routerBox\(v\)/);
  assert.match(src, /"http:\/\/"\+r\.ip\+":"\+\(r\.port\|\|8080\)/);
  assert.match(src, /Router status is a hint, not camera health/);
  assert.doesNotMatch(src.slice(src.indexOf('function routerBox'), src.indexOf('async function loadRouters')), /iccid|imsi|imei/i);
  const landing = fs.readFileSync(new URL('../src/CosBoardLanding.tsx', import.meta.url), 'utf8');
  assert.match(landing, /loadRouters: \(\) => readRouterDetails\(\)/);
});
