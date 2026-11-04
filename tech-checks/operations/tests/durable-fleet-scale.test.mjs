import test from 'node:test';import assert from 'node:assert/strict';
import {largeFleetFixture} from './fixtures/durable-large-fleet.mjs';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
import {completedBoard} from '../durable-board/project.ts';
import {prepareImmutableIdentityEnvelope,resolveVerifiedUnitIdentity} from '../src/verifiedUnitIdentity.ts';
import {fieldCameraHealth} from '../src/fieldCameraHealth.ts';
test('a complete 925-record / 739-resource batch fits the Edge CPU budget and preserves Product-ID counts',t=>{
 const f=largeFleetFixture(),started=process.cpuUsage();const result=completedBoard(f.health,f.map,f.connections,null,f.now);const cpu=process.cpuUsage(started),ms=(cpu.user+cpu.system)/1000;
 assert.deepEqual(result.inventory,{total:925,field:286,shop:639});assert.equal(result.counts.online,203);assert.equal(result.counts.support,83);assert.equal(result.units.length,286);
 assert.equal(result.fleet.health.fleetFieldUnits,undefined,'derived duplicate inventory is restored by clients instead of being stored twice');
 assert.ok(ms<1500,`Classification consumed ${Math.round(ms)}ms CPU; leave headroom under the 2000ms Edge limit.`);t.diagnostic(`925 inventory / 739 resources: ${Math.round(ms)}ms CPU`);
});
test('immutable identity validation cannot be mutated, bypass collision checks or freeze observation freshness',()=>{
 const f=fieldProductFixture();prepareImmutableIdentityEnvelope(f.health);
 assert.throws(()=>{f.health.unitIdentities[0].unitNumber='changed';},TypeError);
 assert.equal(resolveVerifiedUnitIdentity({...f.units[0],unitNumber:'changed'},f.health,f.now).state,'conflict');
 assert.equal(fieldCameraHealth(f.units[0],f.units,f.health,f.now).state,'online');
 assert.equal(fieldCameraHealth(f.units[0],f.units,f.health,f.now+21*60000).state,'unknown');
 const g=fieldProductFixture();g.health.unitIdentities[1].deviceIds=[...g.health.unitIdentities[0].deviceIds];prepareImmutableIdentityEnvelope(g.health);
 assert.equal(resolveVerifiedUnitIdentity(g.units[0],g.health,g.now).state,'conflict');
 const bad=fieldProductFixture();bad.health.unitIdentities[0].proof='bad';assert.throws(()=>prepareImmutableIdentityEnvelope(bad.health),/malformed/);
});
