import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {beforeFleetCountTrustSource} from './fleet-count-trust-source.mjs';

const expected={
 'fleet-dashboard.browser.spec.mjs':'04c0e9a61b384c14eeedee7e437a211efccaa6f6',
 'FleetDashboard.tsx':'27a6ad9858a1685ff449a232c4bee7286c5c710f',
 'fleetBoardLayout.css':'8c4962032a589287f75854b581dfc57f5d579b8f',
};
const blob=source=>{const bytes=Buffer.from(source);return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');};
for(const [name,baseline] of Object.entries(expected)){
 const source=readFileSync(new URL((name.endsWith('.browser.spec.mjs')?'./':'../src/')+name,import.meta.url),'utf8');
 test(name+' reverses to the original reviewed main blob',()=>{
  assert.equal(blob(beforeFleetCountTrustSource(name,source)),baseline);
 });
 test(name+' rejects even one undeclared byte and never treats earlier source as the candidate',()=>{
  assert.throws(()=>beforeFleetCountTrustSource(name,source+'\n'),/exact count-trust candidate/);
  assert.throws(()=>beforeFleetCountTrustSource(name,beforeFleetCountTrustSource(name,source)),/exact count-trust candidate/);
 });
}
test('files outside the declared count-trust delta remain byte-identical',()=>{
 assert.equal(beforeFleetCountTrustSource('App.tsx','unchanged source\n'),'unchanged source\n');
});
