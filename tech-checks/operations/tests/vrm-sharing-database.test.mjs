import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,sql,begin,finish,snapshot,allowNextAttempt,asRole} from './fixtures/vrm-fleet-database-fixture.mjs';
test('sharing flags persist with lease-bound fleet sync, old publishers clear to unknown, end users remain denied',async()=>{
 const db=await fixture();try{
 await db.exec(await sql('20261012171124_helios_victron_power_measurements.sql'));
 await db.exec(await sql('20261103_cos_vrm_sharing_status.sql'));
 await db.exec('begin');
 const items=[{installationId:1001,name:'HELIOS 001',sharingEnabled:true},{installationId:1002,name:'HELIOS 002',sharingEnabled:false}];
 assert.equal(await finish(db,await begin(db),items),true);
 let s=await snapshot(db);assert.deepEqual(s.items.filter(i=>i.available).map(i=>i.sharingEnabled),[true,false]);
 await allowNextAttempt(db);assert.equal(await finish(db,await begin(db),items.map(({sharingEnabled,...i})=>i)),true);
 s=await snapshot(db);assert.ok(s.items.filter(i=>i.available).every(i=>i.sharingEnabled===null));
 await assert.rejects(()=>asRole(db,'authenticated','select public.cos_vrm_fleet_snapshot()'),/permission denied/);
 await db.exec('rollback');
 }finally{await db.close();}
});
