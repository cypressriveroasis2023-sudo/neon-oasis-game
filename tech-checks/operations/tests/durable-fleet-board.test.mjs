import test from 'node:test';import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';
import {completedBoard} from '../durable-board/project.ts';
import {savedFleetBoard} from '../durable-board/runtime.mjs';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
test('the server publishes current Unknown instead of retaining stale red or green',()=>{
 const f=fieldProductFixture(),map={...f.field};const first=completedBoard(f.health,map,f.connections,null,f.now);
 assert.equal(first.counts.online,1);assert.equal(first.counts.offline,1);
 const missing=structuredClone(f.connections);missing.items.find(p=>p.productId==='1001').status='unknown';missing.items.find(p=>p.productId==='1001').checkedAt=null;missing.items.find(p=>p.productId==='1001').resourceId=null;
 const staleHealth=structuredClone(f.health);staleHealth.rows[0].evidence.observedAt='2026-01-01T00:00:00Z';
 const next=completedBoard(staleHealth,map,missing,first,f.now);
 assert.equal(next.counts.online,0);assert.ok(next.counts.unverified>=1);
 const conflict=structuredClone(f.connections);Object.assign(conflict.items.find(p=>p.productId==='1001'),{status:'offline',checkedAt:f.fresh,resourceId:'1'});
 const conflictBoard=completedBoard(f.health,map,conflict,first,f.now);
 assert.equal(conflictBoard.units.find(p=>p.productId==='1001').status,'unverified');
 assert.throws(()=>completedBoard(f.health,map,{...f.connections,sourceSha256:'b'.repeat(64)},first,f.now),/connection_source_incomplete/);
});
test('refresh returns the stored board while a bounded background batch runs; failure does not publish',async()=>{
 const calls=[],tasks=[];let release;const gate=new Promise(r=>release=r);const rpc=async(name,args)=>{calls.push(name);return name.endsWith('begin')?{id:'run'}:name.endsWith('read')?{latest:{payload:{old:true}}}:true;};
 const response=await savedFleetBoard({rpc,force:true,read:async()=>{await gate;throw Error('private raw error');},waitUntil:p=>tasks.push(p),project:()=>{throw Error('must not project failed reads');}});
 assert.equal(response.latest.payload.old,true);assert.equal(calls.includes('cos_fleet_board_finish'),false);release();await tasks[0];assert.equal(calls.at(-1),'cos_fleet_board_fail');
});
test('database persists whole batches, denies browser roles, fences overlap and keeps the last board after failure',async()=>{
 const db=new PGlite();await db.exec('create role service_role bypassrls;create role anon;create role authenticated;');await db.exec(readFileSync(new URL('../db/fleet-durable-board-install.sql',import.meta.url),'utf8'));await db.exec(readFileSync(new URL('../db/fleet-board-staging.sql',import.meta.url),'utf8'));
 await assert.rejects(()=>db.exec('set role authenticated;select public.cos_fleet_board_read();'));
 await db.exec('reset role;set role service_role;');const a=(await db.query('select public.cos_fleet_board_begin(false) lease')).rows[0].lease;assert.ok(a.id);assert.equal((await db.query('select public.cos_fleet_board_stage($1,$2::jsonb) staged',[a.id,JSON.stringify({capturedAt:1,health:{source:'test'}})])).rows[0].staged,true);
 assert.equal((await db.query('select public.cos_fleet_board_begin(true) lease')).rows[0].lease,null);
 const payload={contract:'COS_SAVED_FLEET_BOARD_V1',fleet:{readAt:'2026-11-03T20:00:00Z',fieldMap:{sharedFleetView:true}},counts:{online:7,offline:1},units:[{productId:'1001',status:'online'}]};
 await assert.rejects(()=>db.query('select public.cos_fleet_board_finish($1,$2::jsonb)',[a.id,JSON.stringify({...payload,fleet:{...payload.fleet,fieldMap:{sharedFleetView:false}}})]),/Invalid completed board/);
 assert.equal((await db.query('select public.cos_fleet_board_finish($1,$2::jsonb) ok',[a.id,JSON.stringify(payload)])).rows[0].ok,true);assert.equal((await db.query('select staged from cos_fleet_board_private.runs where id=$1',[a.id])).rows[0].staged,null);
 await db.exec("reset role;update cos_fleet_board_private.runs set started_at=started_at-interval '61 seconds';set role service_role;");
 const b=(await db.query('select public.cos_fleet_board_begin(true) lease')).rows[0].lease;
 await db.query("select public.cos_fleet_board_fail($1,'source_read_failed','[]')",[b.id]);
 const result=(await db.query('select public.cos_fleet_board_read() board')).rows[0].board;
 assert.equal(result.latest.payload.counts.online,7);assert.equal(result.history.length,2);assert.equal(result.refresh.state,'failed');
 assert.equal((await db.query('select public.cos_fleet_board_finish($1,$2::jsonb) ok',[a.id,JSON.stringify(payload)])).rows[0].ok,false);
 await db.exec("reset role;update cos_fleet_board_private.runs set started_at=started_at-interval '61 seconds';set role service_role;");
 const c=(await db.query('select public.cos_fleet_board_begin(true) lease')).rows[0].lease;await db.query('select public.cos_fleet_board_finish($1,$2::jsonb)',[c.id,JSON.stringify({...payload,counts:{online:8,offline:0}})]);
 const old=(await db.query('select public.cos_fleet_board_history($1) record',[a.id])).rows[0].record;assert.equal(old.counts.online,7);assert.equal(old.units[0].status,'online');assert.equal((await db.query('select payload from cos_fleet_board_private.runs where id=$1',[a.id])).rows[0].payload,null);await db.close();
});

test('ordinary saved-board read never claims a refresh lease or touches live sources',async()=>{
 const calls=[];const rpc=async(name)=>{calls.push(name);return name.endsWith('read')?{latest:{payload:{old:true}},refresh:{state:'completed'}}:{id:'unexpected'};};
 const value=await savedFleetBoard({rpc,read:async()=>{throw Error('open must not read live sources');},waitUntil:()=>{throw Error('open must not schedule work');},project:()=>{throw Error('open must not project');}});
 assert.equal(value.latest.payload.old,true);assert.deepEqual(calls,['cos_fleet_board_read']);
});
