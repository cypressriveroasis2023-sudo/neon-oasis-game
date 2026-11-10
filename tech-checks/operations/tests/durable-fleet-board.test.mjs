import test from 'node:test';import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';
import {completedBoard} from '../durable-board/project.ts';
import {savedFleetBoard,savedFleetResponse,produceFleetBoard,forgetSavedFleetPayload,FLEET_BATCH_BUDGET_MS} from '../durable-board/runtime.mjs';
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
const stored=(id='old',state='completed')=>({contract:'COS_DURABLE_FLEET_RESPONSE_V1',latest:{id,completedAt:'2026-11-09T01:37:00Z'},refresh:{id,state},history:[]});
test('refresh returns the stored board while a bounded background batch runs; failure does not publish',async()=>{
 forgetSavedFleetPayload();
 const calls=[],tasks=[];let release;const gate=new Promise(r=>release=r);const rpc=async(name,args)=>{calls.push([name,args]);return name.endsWith('begin')?{id:'run'}:name.endsWith('status')?stored():true;};
 const response=JSON.parse(await savedFleetBoard({rpc,payloadText:async()=>'{"old":true}',force:true,read:async()=>{await gate;throw Error('private raw error');},waitUntil:p=>tasks.push(p),project:()=>{throw Error('must not project failed reads');}}));
 assert.equal(response.latest.payload.old,true);assert.equal(response.latest.completedAt,'2026-11-09T01:37:00Z');assert.equal(calls.some(c=>c[0]==='cos_fleet_board_finish'),false);release();await tasks[0];
 const [name,args]=calls.at(-1);assert.equal(name,'cos_fleet_board_fail');assert.equal(args.p_code,'source_read_failed');
 assert.equal(args.p_diagnostics.failedStep,'map');assert.deepEqual(args.p_diagnostics.steps.map(x=>[x.step,x.ok,x.kind]),[['map',false,'error']]);assert.doesNotMatch(JSON.stringify(args),/private raw error/);
});
test('database persists whole batches, denies browser roles, fences overlap and keeps the last board after failure',async()=>{
 const db=new PGlite();await db.exec('create role service_role bypassrls;create role anon;create role authenticated;');await db.exec(readFileSync(new URL('../db/fleet-durable-board-install.sql',import.meta.url),'utf8'));await db.exec(readFileSync(new URL('../db/fleet-board-staging.sql',import.meta.url),'utf8'));await db.exec(readFileSync(new URL('../db/fleet-board-reliability-20261109.sql',import.meta.url),'utf8'));
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
 forgetSavedFleetPayload();
 const calls=[];const rpc=async(name)=>{calls.push(name);return name.endsWith('status')?stored():{id:'unexpected'};};
 const value=JSON.parse(await savedFleetBoard({rpc,payloadText:async()=>{calls.push('payload');return '{"old":true}';},read:async()=>{throw Error('open must not read live sources');},waitUntil:()=>{throw Error('open must not schedule work');},project:()=>{throw Error('open must not project');}}));
 assert.equal(value.latest.payload.old,true);assert.deepEqual(calls,['cos_fleet_board_status','payload']);
});

test('polling reuses the immutable completed payload and reloads it only for a new board',async()=>{
 forgetSavedFleetPayload();
 let current=stored('one','running'),payloads=0;const rpc=async name=>{assert.equal(name,'cos_fleet_board_status');return current;};
 const payloadText=async id=>{payloads++;return JSON.stringify({board:id,text:'"@@COS_SAVED_FLEET_BOARD_PAYLOAD@@" $& $1'});};
 for(let i=0;i<5;i++){const value=JSON.parse(await savedFleetResponse({rpc,payloadText}));assert.equal(value.latest.payload.board,'one');assert.equal(value.latest.payload.text,'"@@COS_SAVED_FLEET_BOARD_PAYLOAD@@" $& $1');assert.equal(value.refresh.state,'running');}
 assert.equal(payloads,1);
 current=stored('two');const next=JSON.parse(await savedFleetResponse({rpc,payloadText}));assert.equal(next.latest.payload.board,'two');assert.equal(payloads,2);
 // First-ever state: no completed board, nothing to load.
 current={contract:'COS_DURABLE_FLEET_RESPONSE_V1',latest:null,refresh:null,history:[]};assert.equal(JSON.parse(await savedFleetResponse({rpc,payloadText})).latest,null);assert.equal(payloads,2);
});
test('a board replaced between the status and payload reads is re-read, never mixed',async()=>{
 forgetSavedFleetPayload();
 const ids=['one','two'];let reads=0;const rpc=async()=>stored(ids[Math.min(reads++,1)]);
 const value=JSON.parse(await savedFleetResponse({rpc,payloadText:async id=>id==='one'?'null':'{"board":"two"}'}));
 assert.equal(value.latest.id,'two');assert.equal(value.latest.payload.board,'two');
 forgetSavedFleetPayload();await assert.rejects(()=>savedFleetResponse({rpc:async()=>stored('gone'),payloadText:async()=>'null'}),/saved_board_unavailable/);
});
const batch=(overrides={})=>{
 const calls=[],reads=[];let clock=1000;
 const rpc=async(name,args)=>{calls.push([name,structuredClone(args)]);return overrides.rpc?.(name,args)??true;};
 const read=async(path,limits)=>{reads.push([path,limits]);clock+=overrides.readMs??10;const value=await overrides.read?.(path,limits);if(value!==undefined)return value;return {value:{path},attempts:1};};
 return {calls,reads,run:()=>produceFleetBoard({run:'run',rpc,read,now:()=>clock,project:overrides.project??((health,map,connections,previous,at)=>({contract:'COS_SAVED_FLEET_BOARD_V1',health,map,connections,previous,at})),abort:()=>calls.push(['abort'])})};
};
test('a completed batch reads the three sources in order, records progress and commits once',async()=>{
 const b=batch();assert.equal(await b.run(),true);
 assert.deepEqual(b.reads.map(r=>r[0]),['/api/fleet-map-source','/api/product-connections','/api/camera-health/summary-v3']);
 assert.deepEqual(b.calls.map(c=>c[0]),['cos_fleet_board_progress','cos_fleet_board_progress','cos_fleet_board_progress','cos_fleet_board_finish']);
 const finish=b.calls.at(-1)[1];assert.equal(finish.p_payload.previous,null);assert.equal(finish.p_payload.map.path,'/api/fleet-map-source');assert.equal(finish.p_payload.health.path,'/api/camera-health/summary-v3');
 assert.deepEqual(finish.p_diagnostics.steps.map(s=>[s.step,s.ok]),[['map',true],['connections',true],['health',true],['project',true]]);
 assert.deepEqual(b.calls[1][1].p_diagnostics.reached,'connections');
 // Every read is bounded by the batch deadline minus the commit reserve.
 for(const [,limits] of b.reads){assert.ok(limits.attemptMs<=70000);assert.equal(limits.until,1000+FLEET_BATCH_BUDGET_MS-25000);}
});
test('a failing source is named with bounded categories and nothing is committed',async()=>{
 const b=batch({read:async path=>{if(path==='/api/product-connections')throw Object.assign(Error('source_read_failed'),{detail:{kind:'http',status:503,attempts:3,stage:'tracker_source',code:'timeout',secret:'10.1.2.3',message:'raw private text'}});}});
 assert.equal(await b.run(),false);assert.deepEqual(b.reads.map(r=>r[0]),['/api/fleet-map-source','/api/product-connections']);
 assert.equal(b.calls.some(c=>c[0]==='cos_fleet_board_finish'),false);assert.ok(b.calls.some(c=>c[0]==='abort'));
 const [name,args]=b.calls.at(-1);assert.equal(name,'cos_fleet_board_fail');assert.equal(args.p_code,'source_read_failed');assert.equal(args.p_diagnostics.failedStep,'connections');
 assert.deepEqual(args.p_diagnostics.steps.at(-1),{step:'connections',ok:false,ms:10,kind:'http',status:503,attempts:3,stage:'tracker_source',code:'timeout'});
 assert.doesNotMatch(JSON.stringify(args),/10\.1\.2\.3|raw private/);
});
test('projection holds keep their existing codes; an unconfirmed commit is recorded as a failure',async()=>{
 const hold=batch({project:()=>{throw Object.assign(Error('checks_incomplete'),{products:['1001']});}});assert.equal(await hold.run(),false);
 assert.equal(hold.calls.at(-1)[1].p_code,'checks_incomplete');assert.deepEqual(hold.calls.at(-1)[1].p_products,['1001']);assert.equal(hold.calls.at(-1)[1].p_diagnostics.failedStep,'project');
 const lost=batch({rpc:name=>name==='cos_fleet_board_finish'?false:true});assert.equal(await lost.run(),false);
 assert.equal(lost.calls.at(-1)[0],'cos_fleet_board_fail');assert.equal(lost.calls.at(-1)[1].p_diagnostics.failedStep,'commit');assert.equal(lost.calls.at(-1)[1].p_diagnostics.steps.at(-1).kind,'lease_lost');
});
test('a batch that runs out of time stops before the lease expires instead of being interrupted',async()=>{
 const b=batch({readMs:80000});assert.equal(await b.run(),false);
 // map and connections each took 80 seconds; health may not start inside the commit reserve.
 assert.deepEqual(b.reads.map(r=>r[0]),['/api/fleet-map-source','/api/product-connections']);
 const args=b.calls.at(-1)[1];assert.equal(b.calls.at(-1)[0],'cos_fleet_board_fail');assert.equal(args.p_diagnostics.failedStep,'health');assert.equal(args.p_diagnostics.steps.at(-1).kind,'batch_deadline');assert.equal(b.calls.some(c=>c[0]==='cos_fleet_board_finish'),false);
});
test('refresh hands the batch to the dedicated worker and runs it here only when that is unavailable',async()=>{
 for(const [label,dispatch,inline] of [['accepted',async()=>true,false],['declined',async()=>false,true],['unreachable',async()=>{throw Error('offline');},true],['none',undefined,true]]){
  forgetSavedFleetPayload();const calls=[],tasks=[],sources=[];
  const rpc=async name=>{calls.push(name);return name.endsWith('begin')?{id:'run'}:name.endsWith('status')?stored():true;};
  await savedFleetBoard({rpc,payloadText:async()=>'{"old":true}',force:true,dispatch,read:async path=>{sources.push(path);return {value:{},attempts:1};},waitUntil:p=>tasks.push(p),project:()=>({contract:'COS_SAVED_FLEET_BOARD_V1'})});
  await Promise.all(tasks);assert.equal(tasks.length,1,label);assert.equal(sources.length,inline?3:0,label);assert.equal(calls.includes('cos_fleet_board_finish'),inline,label);
 }
});
test('database keeps diagnostics, a 180-second lease, payload-free status and the stored board through failure and interruption',async()=>{
 const db=new PGlite();await db.exec('create role service_role bypassrls;create role anon;create role authenticated;');
 for(const file of ['fleet-durable-board-install.sql','fleet-board-staging.sql','fleet-board-reliability-20261109.sql'])await db.exec(readFileSync(new URL('../db/'+file,import.meta.url),'utf8'));
 for(const call of ['cos_fleet_board_status()',"cos_fleet_board_payload('00000000-0000-0000-0000-000000000000')","cos_fleet_board_progress('00000000-0000-0000-0000-000000000000','{}')"])for(const role of ['anon','authenticated'])await assert.rejects(()=>db.exec('set role '+role+';select public.'+call+';'),label=>{return true;});
 await db.exec('reset role;set role service_role;');
 const one=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 const age=seconds=>db.exec("reset role;update cos_fleet_board_private.runs set started_at=started_at-interval '"+seconds+" seconds';set role service_role;");
 const payload={contract:'COS_SAVED_FLEET_BOARD_V1',fleet:{readAt:'2026-11-09T19:37:00Z',fieldMap:{sharedFleetView:true}},counts:{online:7,offline:1},units:[{productId:'1001',status:'online'}]};
 const a=await one('select public.cos_fleet_board_begin(true)');
 // A run older than the previous 120-second lease can still commit inside 180 seconds.
 await age(150);
 assert.equal(await one('select public.cos_fleet_board_begin(true)'),null,'overlapping refresh must not start a second batch');
 assert.equal(await one('select public.cos_fleet_board_progress($1,$2::jsonb)',[a.id,JSON.stringify({reached:'map'})]),true);
 assert.equal(await one('select public.cos_fleet_board_progress($1,$2::jsonb)',[a.id,JSON.stringify({big:'x'.repeat(21000)})]),false);
 assert.equal(await one('select public.cos_fleet_board_finish($1,$2::jsonb,$3::jsonb)',[a.id,JSON.stringify(payload),JSON.stringify({reached:'commit',steps:[]})]),true);
 const queued=await one('select public.cos_fleet_board_status()');
 assert.equal(queued.latest.id,a.id);assert.equal('payload' in queued.latest,false);assert.equal(queued.refresh.state,'queued');assert.equal(queued.refresh.diagnostics.reached,'commit');
 assert.deepEqual(await one('select public.cos_fleet_board_payload($1)',[a.id]),payload);
 // The overlapping request is owed one follow-up, which may start as soon as the batch has ended.
 const live=await one('select public.cos_fleet_board_begin(false)');assert.ok(live.id);assert.equal(await one('select public.cos_fleet_board_finish($1,$2::jsonb)',[live.id,JSON.stringify(payload)]),true);
 const first=await one('select public.cos_fleet_board_status()');assert.equal(first.latest.id,live.id);assert.equal(first.refresh.state,'completed');
 await age(61);assert.equal(await one('select public.cos_fleet_board_begin(false)'),null,'nothing is owed, so an unforced request starts nothing before the cadence');
 // Source failure: recorded with diagnostics; stored board and its completion time unchanged.
 const b=await one('select public.cos_fleet_board_begin(true)');
 await one("select public.cos_fleet_board_fail($1,'source_read_failed','[]',$2::jsonb)",[b.id,JSON.stringify({failedStep:'connections',steps:[{step:'connections',ok:false,kind:'http',status:503}]})]);
 const failed=await one('select public.cos_fleet_board_status()');
 assert.equal(failed.latest.id,live.id);assert.equal(failed.latest.completedAt,first.latest.completedAt);assert.equal(failed.refresh.state,'failed');assert.equal(failed.refresh.error,'source_read_failed');assert.equal(failed.refresh.diagnostics.failedStep,'connections');assert.equal(failed.history[0].diagnostics.failedStep,'connections');
 // Interruption after progress: reported failed once the lease lapses, keeping the last step reached.
 await age(61);const c=await one('select public.cos_fleet_board_begin(true)');await one('select public.cos_fleet_board_progress($1,$2::jsonb)',[c.id,JSON.stringify({reached:'health'})]);
 await age(170);assert.equal((await one('select public.cos_fleet_board_status()')).refresh.state,'running');
 await age(11);const cut=await one('select public.cos_fleet_board_status()');
 assert.equal(cut.refresh.state,'failed');assert.equal(cut.refresh.error,'worker_interrupted');assert.equal(cut.refresh.diagnostics.reached,'health');assert.equal(cut.latest.id,live.id);assert.equal(cut.latest.completedAt,first.latest.completedAt);
 assert.equal(await one('select public.cos_fleet_board_finish($1,$2::jsonb)',[c.id,JSON.stringify(payload)]),false,'a lapsed batch can no longer publish');
 // The next refresh closes the interrupted run and a real new board replaces the old one.
 const d=await one('select public.cos_fleet_board_begin(true)');assert.ok(d.id);
 assert.equal((await db.query('select state,error_code from cos_fleet_board_private.runs where id=$1',[c.id])).rows[0].error_code,'worker_interrupted');
 assert.equal(await one('select public.cos_fleet_board_finish($1,$2::jsonb)',[d.id,JSON.stringify({...payload,counts:{online:8,offline:0}})]),true);
 assert.equal(await one('select public.cos_fleet_board_payload($1)',[live.id]),null);assert.equal((await one('select public.cos_fleet_board_payload($1)',[d.id])).counts.online,8);
 assert.equal((await one('select public.cos_fleet_board_status()')).latest.id,d.id);
 // Callers that still pass the original arguments keep working.
 await age(61);const e=await one('select public.cos_fleet_board_begin(true)');await one("select public.cos_fleet_board_fail($1,'checks_incomplete')",[e.id]);assert.equal((await one('select public.cos_fleet_board_read()')).refresh.error,'checks_incomplete');
 await db.close();
});
test('a queued follow-up starts only when one is owed, after the spacing, and a refused hand-off is recorded',async()=>{
 const {continueQueuedFleetBoard}=await import('../durable-board/runtime.mjs');
 const scene=(state,dispatch,lease={id:'next'})=>{const calls=[],waits=[];return {calls,waits,run:()=>continueQueuedFleetBoard({rpc:async(name,args)=>{calls.push([name,args]);return name.endsWith('status')?stored('old',state):name.endsWith('begin')?lease:true;},dispatch:dispatch&&(async id=>{calls.push(['dispatch',id]);return dispatch(id);}),startedAt:0,now:()=>20000,sleep:async ms=>{waits.push(ms);}})};};
 for(const state of ['completed','failed','running']){const s=scene(state,async()=>true);assert.equal(await s.run(),false);assert.deepEqual(s.calls.map(c=>c[0]),['cos_fleet_board_status']);}
 const none=scene('queued',null);assert.equal(await none.run(),false);assert.deepEqual(none.calls,[]);
 const owed=scene('queued',async()=>true);assert.equal(await owed.run(),true);assert.deepEqual(owed.waits,[41000]);assert.deepEqual(owed.calls.map(c=>c[0]),['cos_fleet_board_status','cos_fleet_board_begin','dispatch']);assert.deepEqual(owed.calls[1][1],{p_force:false});
 const early=scene('queued',async()=>true,null);assert.equal(await early.run(),false);assert.equal(early.calls.some(c=>c[0]==='dispatch'),false);
 const refused=scene('queued',async()=>false);assert.equal(await refused.run(),false);assert.equal(refused.calls.at(-1)[0],'cos_fleet_board_fail');assert.equal(refused.calls.at(-1)[1].p_diagnostics.failedStep,'dispatch');
 const broken=scene('queued',async()=>{throw Error('offline');});assert.equal(await broken.run(),false);
});
