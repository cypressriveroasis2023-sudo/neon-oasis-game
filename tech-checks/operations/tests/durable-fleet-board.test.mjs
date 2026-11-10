import test from 'node:test';import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';import {readFileSync} from 'node:fs';
import {completedBoard} from '../durable-board/project.ts';
import {savedFleetBoard,savedFleetResponse,produceFleetBoard,startFleetBatch,acceptFleetBatch,claimFleetBatch,continueQueuedFleetBoard,forgetSavedFleetPayload,FLEET_BATCH_BUDGET_MS,COMMIT_RESERVE_MS,COMMIT_REQUEST_MAX_MS,UNCERTAIN_DELIVERY_GRACE_MS} from '../durable-board/runtime.mjs';
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
 const calls=[],tasks=[];let release;const gate=new Promise(r=>release=r);const rpc=async(name,args)=>{calls.push([name,args]);return name.endsWith('begin')?{id:'run'}:name.endsWith('status')?stored():name.endsWith('claim')?{claimed:true,leaseRemainingMs:179000}:true;};
 const response=JSON.parse(await savedFleetBoard({rpc,payloadText:async()=>'{"old":true}',force:true,read:async()=>{await gate;throw Error('private raw error');},waitUntil:p=>tasks.push(p),project:()=>{throw Error('must not project failed reads');}}));
 assert.equal(response.latest.payload.old,true);assert.equal(response.latest.completedAt,'2026-11-09T01:37:00Z');assert.equal(calls.some(c=>c[0]==='cos_fleet_board_finish'),false);release();await tasks[0];
 assert.deepEqual(calls.map(c=>c[0]).slice(0,3).sort(),['cos_fleet_board_begin','cos_fleet_board_claim','cos_fleet_board_status']);
 const [name,args]=calls.find(c=>c[0]==='cos_fleet_board_fail');assert.equal(args.p_code,'source_read_failed');assert.equal(args.p_producer,calls.find(c=>c[0]==='cos_fleet_board_claim')[1].p_producer);assert.match(args.p_producer,/^[a-f0-9-]{36}$/);
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
 const calls=[],reads=[],bounds=[];let clock=1000;
 const rpc=async(name,args,signal)=>{calls.push([name,structuredClone(args)]);if(name.endsWith('finish'))assert.equal(signal,'bounded','the publish request must carry its time limit');return overrides.rpc?.(name,args)??true;};
 const read=async(path,limits)=>{reads.push([path,limits]);clock+=overrides.readMs??10;const value=await overrides.read?.(path,limits);if(value!==undefined)return value;return {value:{path},attempts:1};};
 return {calls,reads,bounds,run:()=>produceFleetBoard({run:'run',producer:'token-a',leaseRemainingMs:overrides.leaseRemainingMs,timeoutSignal:ms=>{bounds.push(ms);return 'bounded';},rpc,read,now:()=>clock,project:overrides.project??((health,map,connections,previous,at)=>({contract:'COS_SAVED_FLEET_BOARD_V1',health,map,connections,previous,at})),abort:()=>calls.push(['abort'])})};
};
test('a completed batch reads the three sources in order, records progress and commits once',async()=>{
 const b=batch();assert.equal(await b.run(),true);
 assert.deepEqual(b.reads.map(r=>r[0]),['/api/fleet-map-source','/api/product-connections','/api/camera-health/summary-v3']);
 assert.deepEqual(b.calls.map(c=>c[0]),['cos_fleet_board_progress','cos_fleet_board_progress','cos_fleet_board_progress','cos_fleet_board_finish']);
 const finish=b.calls.at(-1)[1];assert.equal(finish.p_payload.previous,null);assert.ok(b.calls.every(c=>c[1].p_producer==='token-a'),'every write carries the claimant token');assert.equal(finish.p_payload.map.path,'/api/fleet-map-source');assert.equal(finish.p_payload.health.path,'/api/camera-health/summary-v3');
 assert.deepEqual(finish.p_diagnostics.steps.map(s=>[s.step,s.ok]),[['map',true],['connections',true],['health',true],['project',true]]);
 assert.deepEqual(b.calls[1][1].p_diagnostics.reached,'connections');
 // Every read is bounded by the batch deadline minus the commit reserve.
 for(const [,limits] of b.reads){assert.ok(limits.attemptMs<=70000);assert.equal(limits.until,1000+FLEET_BATCH_BUDGET_MS-COMMIT_RESERVE_MS);}
 assert.deepEqual(b.bounds,[COMMIT_REQUEST_MAX_MS]);
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
test('database keeps diagnostics, a 180-second lease, payload-free status and the stored board through failure and interruption',async()=>{
 const db=new PGlite();await db.exec('create role service_role bypassrls;create role anon;create role authenticated;');
 for(const file of ['fleet-durable-board-install.sql','fleet-board-staging.sql','fleet-board-reliability-20261109.sql'])await db.exec(readFileSync(new URL('../db/'+file,import.meta.url),'utf8'));
 for(const call of ['cos_fleet_board_status()',"cos_fleet_board_payload('00000000-0000-0000-0000-000000000000')","cos_fleet_board_progress('00000000-0000-0000-0000-000000000000','{}')"])for(const role of ['anon','authenticated'])await assert.rejects(()=>db.exec('set role '+role+';select public.'+call+';'),label=>{return true;});
 await db.exec('reset role;set role service_role;');
 const one=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 const age=seconds=>db.exec("reset role;update cos_fleet_board_private.runs set started_at=started_at-interval '"+seconds+" seconds';update cos_fleet_board_private.control set next_at=next_at-interval '"+seconds+" seconds';set role service_role;");
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
 // Producer claim: one token per run, and only the claimant can record, publish or fail it.
 await age(61);const g=await one('select public.cos_fleet_board_begin(true)');const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 assert.equal((await one('select public.cos_fleet_board_claim($1,$2)',[d.id,A])).claimed,false,'a finished run cannot be claimed');assert.equal((await one('select public.cos_fleet_board_claim($1,null)',[g.id])).claimed,false);
 const granted=await one('select public.cos_fleet_board_claim($1,$2)',[g.id,A]);assert.equal(granted.claimed,true);assert.ok(granted.leaseRemainingMs>170000&&granted.leaseRemainingMs<=180000);
 assert.deepEqual(await one('select public.cos_fleet_board_claim($1,$2)',[g.id,B]),{claimed:false});
 // The same token asking again (its first reply was lost) is confirmed, with the lease still measured from the grant.
 await age(40);const again=await one('select public.cos_fleet_board_claim($1,$2)',[g.id,A]);assert.equal(again.claimed,true);assert.ok(again.leaseRemainingMs>125000&&again.leaseRemainingMs<=140000,String(again.leaseRemainingMs));assert.deepEqual(await one('select public.cos_fleet_board_claim($1,$2)',[g.id,B]),{claimed:false});
 assert.equal((await one('select public.cos_fleet_board_status()')).refresh.claimed,true);
 for(const other of [B,null]){
  assert.equal(await one("select public.cos_fleet_board_fail($1,'source_read_failed','[]','{}'::jsonb,$2)",[g.id,other]),false);
  assert.equal(await one('select public.cos_fleet_board_progress($1,$2::jsonb,$3)',[g.id,JSON.stringify({reached:'intruder'}),other]),false);
  assert.equal(await one('select public.cos_fleet_board_finish($1,$2::jsonb,null,$3)',[g.id,JSON.stringify({...payload,counts:{online:0,offline:99}}),other]),false);
 }
 const held=await one('select public.cos_fleet_board_status()');assert.equal(held.refresh.state,'running','a duplicate producer cannot stop the claimant');assert.equal(held.latest.id,d.id);
 assert.equal(await one('select public.cos_fleet_board_begin(true)'),null,'and cannot release its lease');
 assert.equal(await one('select public.cos_fleet_board_progress($1,$2::jsonb,$3)',[g.id,JSON.stringify({reached:'map'}),A]),true);
 assert.equal(await one('select public.cos_fleet_board_finish($1,$2::jsonb,$3::jsonb,$4)',[g.id,JSON.stringify({...payload,counts:{online:9,offline:0}}),JSON.stringify({reached:'commit'}),A]),true);
 assert.equal((await one('select public.cos_fleet_board_payload($1)',[g.id])).counts.online,9);
 // The overlapping request above left one follow-up owed; a lease whose hand-off definitely failed is released at once.
 assert.equal((await one('select public.cos_fleet_board_status()')).refresh.state,'queued');
 assert.equal(await one('select public.cos_fleet_board_begin(false)'),null);await age(61);
 const h=await one('select public.cos_fleet_board_begin(false)');assert.ok(h.id);assert.equal((await one('select public.cos_fleet_board_status()')).refresh.claimed,false);
 assert.equal(await one("select public.cos_fleet_board_fail($1,'source_read_failed','[]',$2::jsonb)",[h.id,JSON.stringify({failedStep:'dispatch'})]),true);
 const released=await one('select public.cos_fleet_board_status()');assert.equal(released.refresh.state,'failed');assert.equal(released.refresh.diagnostics.failedStep,'dispatch');assert.equal(released.latest.id,g.id);
 assert.equal((await one('select public.cos_fleet_board_claim($1,$2)',[h.id,A])).claimed,false,'a released run cannot be claimed afterwards');
 // A refresh that arrives after a quick batch has already ended is queued, and is granted once the spacing has passed.
 await age(61);const quick=await one('select public.cos_fleet_board_begin(true)');assert.equal((await one('select public.cos_fleet_board_claim($1,$2)',[quick.id,A])).claimed,true);
 assert.equal(await one('select public.cos_fleet_board_finish($1,$2::jsonb,null,$3)',[quick.id,JSON.stringify(payload),A]),true);assert.equal((await one('select public.cos_fleet_board_status()')).refresh.state,'completed');
 assert.equal(await one('select public.cos_fleet_board_begin(true)'),null);assert.equal((await one('select public.cos_fleet_board_status()')).refresh.state,'queued');
 assert.equal(await one('select public.cos_fleet_board_begin(false)'),null,'not before the 60-second spacing');
 await age(61);const late=await one('select public.cos_fleet_board_begin(false)');assert.ok(late.id,'the queued refresh is granted, not stranded');
 assert.equal((await one('select public.cos_fleet_board_status()')).refresh.state,'running');assert.equal(await one('select public.cos_fleet_board_begin(false)'),null,'and only once');
 await one("select public.cos_fleet_board_fail($1,'source_read_failed')",[late.id]);
 // Callers that still pass the original arguments keep working.
 await age(61);const e=await one('select public.cos_fleet_board_begin(true)');await one("select public.cos_fleet_board_fail($1,'checks_incomplete')",[e.id]);assert.equal((await one('select public.cos_fleet_board_read()')).refresh.error,'checks_incomplete');
 await db.close();
});

// One shared in-memory lease with the same ownership rules as the database:
// a single conditional claim, and writes accepted only from the claimant.
const ledger=(state='completed')=>{
 const runs={run:{state:'running',producer:null}},calls=[],sources=[],waits=[];let tokens=0,queued=state==='queued';const lease=175000;
 const rpc=async(name,args={})=>{
  calls.push([name,structuredClone(args)]);const r=runs[args.p_run];
  if(name==='cos_fleet_board_claim'){if(!r||r.state!=='running'||(r.producer&&r.producer!==args.p_producer))return {claimed:false};r.producer=args.p_producer;return {claimed:true,leaseRemainingMs:lease};}
  if(name==='cos_fleet_board_progress')return !!r&&r.state==='running'&&r.producer===(args.p_producer??null);
  if(name==='cos_fleet_board_finish'){if(!r||r.state!=='running'||r.producer!==(args.p_producer??null))return false;r.state='completed';return true;}
  if(name==='cos_fleet_board_fail'){if(!r||r.state!=='running'||(r.producer&&r.producer!==(args.p_producer??null)))return false;r.state='failed';r.failure=args.p_diagnostics;return true;}
  if(name==='cos_fleet_board_status'){const shown=queued?'queued':state==='queued'?'completed':state;return {...stored('old',shown),refresh:{id:'old',state:shown,startedAt:new Date(0).toISOString()}};}
  if(name==='cos_fleet_board_begin'){
   assert.match(String(args.p_request),/^token-\d+$/,'every lease request carries a request token');
   const again=Object.keys(runs).find(id=>runs[id].request===args.p_request);if(again)return {id:again,replayed:true};
   if(args.p_force){runs.run.request=args.p_request;return {id:'run'};}if(!queued)return null;queued=false;runs.next={state:'running',producer:null,request:args.p_request};return {id:'next'};}
  throw Error('unexpected '+name);
 };
 const common={rpc,read:async path=>{sources.push(path);return {value:{},attempts:1};},project:()=>({contract:'COS_SAVED_FLEET_BOARD_V1'}),now:()=>20000,sleep:async ms=>{waits.push(ms);},token:()=>'token-'+(++tokens),abort:()=>{}};
 return {runs,calls,sources,waits,rpc,common,names:()=>calls.map(c=>c[0])};
};
test('two producers for one run: exactly one claims it, reads the sources and publishes',async()=>{
 const l=ledger();const results=await Promise.all([startFleetBatch({...l.common,run:'run',inline:true}),startFleetBatch({...l.common,run:'run',inline:true})]);
 assert.deepEqual(results.sort(),['owned_elsewhere','ran_here']);assert.equal(l.sources.length,3);assert.equal(l.runs.run.state,'completed');
 assert.equal(l.calls.filter(c=>c[0]==='cos_fleet_board_finish').length,1);assert.equal(l.calls.some(c=>c[0]==='cos_fleet_board_fail'),false);
});
test('uncertain delivery where the worker did start: this request waits, loses the claim and touches nothing',async()=>{
 const l=ledger();
 // The worker claimed the run but its acknowledgment never arrived.
 const lost=async run=>{await l.rpc('cos_fleet_board_claim',{p_run:run,p_producer:'worker'});throw Error('acknowledgment timed out');};
 assert.equal(await startFleetBatch({...l.common,run:'run',targets:[lost],inline:true}),'owned_elsewhere');
 assert.deepEqual(l.waits,[UNCERTAIN_DELIVERY_GRACE_MS]);assert.deepEqual(l.sources,[]);assert.equal(l.runs.run.producer,'worker');assert.equal(l.runs.run.state,'running');
 assert.equal(l.calls.some(c=>/fail|finish|progress/.test(c[0])),false,'the healthy worker is never failed or overwritten by the fallback');
 // Even a deliberately failing duplicate cannot stop or replace the claimant.
 assert.equal(await l.rpc('cos_fleet_board_fail',{p_run:'run',p_code:'source_read_failed',p_producer:'token-9'}),false);assert.equal(await l.rpc('cos_fleet_board_fail',{p_run:'run',p_code:'source_read_failed'}),false);
 assert.equal(await l.rpc('cos_fleet_board_finish',{p_run:'run',p_producer:'token-9',p_payload:{}}),false);assert.equal(l.runs.run.state,'running');
 assert.equal(await l.rpc('cos_fleet_board_finish',{p_run:'run',p_producer:'worker',p_payload:{}}),true);
});
test('uncertain delivery where the worker never started: this request claims the run after the grace and completes it',async()=>{
 for(const target of [async()=>'uncertain',async()=>{throw Error('connection reset');}]){
  const l=ledger();assert.equal(await startFleetBatch({...l.common,run:'run',targets:[target],inline:true}),'ran_here');
  assert.deepEqual(l.waits,[UNCERTAIN_DELIVERY_GRACE_MS]);assert.equal(l.sources.length,3);assert.equal(l.runs.run.state,'completed');assert.equal(l.runs.run.producer,'token-1');
 }
});
test('a worker that claims late, after the fallback took the run, is refused and the fallback result stands',async()=>{
 const l=ledger();assert.equal(await startFleetBatch({...l.common,run:'run',targets:[async()=>'uncertain'],inline:true}),'ran_here');
 assert.deepEqual(await l.rpc('cos_fleet_board_claim',{p_run:'run',p_producer:'late-worker'}),{claimed:false});assert.equal(l.runs.run.producer,'token-1');assert.equal(l.runs.run.state,'completed');
});
test('definite rejection: no grace; the run starts here at once, or is failed at once when it cannot run here',async()=>{
 const here=ledger();assert.equal(await startFleetBatch({...here.common,run:'run',targets:[async()=>'rejected'],inline:true}),'ran_here');assert.deepEqual(here.waits,[]);assert.equal(here.runs.run.state,'completed');
 const accepted=ledger();assert.equal(await startFleetBatch({...accepted.common,run:'run',targets:[async()=>'rejected',async()=>'accepted'],inline:true}),'handed');assert.deepEqual(accepted.names(),[]);assert.deepEqual(accepted.sources,[]);
 const away=ledger();assert.equal(await startFleetBatch({...away.common,run:'run',targets:[async()=>'rejected',async()=>'rejected'],inline:false}),'failed');
 assert.deepEqual(away.waits,[]);assert.deepEqual(away.names(),['cos_fleet_board_claim','cos_fleet_board_fail']);assert.equal(away.runs.run.state,'failed','the lease is released immediately, not at expiry');
 assert.deepEqual(away.runs.run.failure,{version:1,steps:[{step:'dispatch',ok:false,kind:'delivery_rejected',attempts:2}],reached:'dispatch',failedStep:'dispatch'});
});
test('uncertain delivery that cannot run here: failed only if nobody claimed it, recorded as uncertain',async()=>{
 const idle=ledger();assert.equal(await startFleetBatch({...idle.common,run:'run',targets:[async()=>{throw Error('offline');}],inline:false}),'failed');
 assert.deepEqual(idle.waits,[UNCERTAIN_DELIVERY_GRACE_MS]);assert.equal(idle.runs.run.state,'failed');assert.equal(idle.runs.run.failure.steps[0].kind,'delivery_uncertain');
 const taken=ledger();const lost=async run=>{await taken.rpc('cos_fleet_board_claim',{p_run:run,p_producer:'worker'});return 'uncertain';};
 assert.equal(await startFleetBatch({...taken.common,run:'run',targets:[lost],inline:false}),'owned_elsewhere');assert.equal(taken.runs.run.state,'running');assert.equal(taken.calls.some(c=>c[0]==='cos_fleet_board_fail'),false);
});
test('an error while confirming ownership releases an unclaimed lease instead of leaving it to expire',async()=>{
 const l=ledger();const rpc=async(name,args)=>{if(name==='cos_fleet_board_claim'){l.calls.push([name,args]);throw Error('database unreachable');}return l.rpc(name,args);};
 assert.equal(await startFleetBatch({...l.common,rpc,run:'run',targets:[async()=>'rejected'],inline:true}),'failed');
 assert.equal(l.runs.run.state,'failed');assert.equal(l.runs.run.failure.steps[0].kind,'claim_unconfirmed');assert.deepEqual(l.sources,[]);assert.deepEqual(l.waits,[1500,1500,1500]);
 // If a worker does hold the run, the same release attempt changes nothing.
 const held=ledger();await held.rpc('cos_fleet_board_claim',{p_run:'run',p_producer:'worker'});const broken=async(name,args)=>{if(name==='cos_fleet_board_claim')throw Error('database unreachable');return held.rpc(name,args);};
 assert.equal(await startFleetBatch({...held.common,rpc:broken,run:'run',inline:true}),'failed');assert.equal(held.runs.run.state,'running');assert.equal(held.runs.run.producer,'worker');
 // Nothing here may throw into the request, whatever fails.
 assert.equal(await startFleetBatch({run:'run',rpc:async()=>{throw Error('down');},targets:[async()=>{throw Error('down');}],sleep:async()=>{},inline:true}),'failed');
});
test('refresh request: accepted hand-off does no work here; otherwise the claimed batch runs here',async()=>{
 for(const [label,target,inline] of [['accepted',async()=>'accepted',false],['rejected',async()=>'rejected',true],['uncertain',async()=>'uncertain',true],['thrown',async()=>{throw Error('offline');},true],['none',null,true]]){
  forgetSavedFleetPayload();const l=ledger(),tasks=[];
  await savedFleetBoard({...l.common,payloadText:async()=>'{"old":true}',force:true,targets:[target],waitUntil:p=>tasks.push(p)});
  await Promise.all(tasks);assert.equal(tasks.length,1,label);assert.equal(l.sources.length,inline?3:0,label);assert.equal(l.runs.run.state,inline?'completed':'running',label);
 }
});
test('a queued follow-up starts only when one is owed, after the spacing, and is never left unowned',async()=>{
 for(const state of ['completed','failed','running']){const l=ledger(state);assert.equal(await continueQueuedFleetBoard({...l.common,targets:[async()=>'accepted']}),false);assert.deepEqual(l.names(),['cos_fleet_board_status']);}
 const none=ledger('queued');assert.equal(await continueQueuedFleetBoard({...none.common,targets:[],inline:false}),false);assert.deepEqual(none.calls,[]);
 const owed=ledger('queued'),handed=[];assert.equal(await continueQueuedFleetBoard({...owed.common,targets:[async id=>{handed.push(id);return 'accepted';}]}),true);
 assert.deepEqual(owed.waits,[41000]);assert.deepEqual(owed.names(),['cos_fleet_board_status','cos_fleet_board_begin']);assert.deepEqual(owed.calls[1][1],{p_force:false,p_request:'token-1'});assert.deepEqual(handed,['next']);
 const refused=ledger('queued');assert.equal(await continueQueuedFleetBoard({...refused.common,targets:[async()=>'rejected']}),false);assert.equal(refused.runs.next.state,'failed');assert.equal(refused.runs.next.failure.steps[0].kind,'delivery_rejected');
 const broken=ledger('queued');assert.equal(await continueQueuedFleetBoard({...broken.common,targets:[async()=>{throw Error('offline');}]}),false);assert.equal(broken.runs.next.state,'failed');assert.equal(broken.runs.next.failure.steps[0].kind,'delivery_uncertain');
});
test('a refresh queued after the previous batch already ended is still processed by the request that queued it',async()=>{
 // No batch is running, so no producer will pick this up: the queued request must.
 forgetSavedFleetPayload();const l=ledger('queued'),tasks=[];let begins=0;
 const rpc=async(name,args)=>{if(name==='cos_fleet_board_begin'&&args.p_force){l.calls.push([name,args]);return null;}if(name==='cos_fleet_board_begin'&&++begins===1){l.calls.push([name,args]);return null;}return l.rpc(name,args);};
 const response=JSON.parse(await savedFleetBoard({...l.common,rpc,payloadText:async()=>'{"old":true}',force:true,targets:[],followTargets:[async()=>'rejected'],waitUntil:p=>tasks.push(p)}));
 assert.equal(response.refresh.state,'queued');assert.equal(response.latest.payload.old,true);assert.equal(tasks.length,1);await Promise.all(tasks);
 // Waited out the spacing, retried once while the lease was not yet due, then ran the follow-up here.
 assert.deepEqual(l.waits,[41000,2000]);assert.deepEqual(l.calls.filter(c=>c[0]==='cos_fleet_board_begin').map(c=>c[1].p_force),[true,false,false]);
 assert.equal(l.runs.next.state,'completed');assert.match(l.runs.next.producer,/^token-\d+$/);assert.notEqual(l.runs.next.producer,l.runs.next.request);assert.equal(l.sources.length,3);
 // An ordinary open in the same state starts nothing.
 forgetSavedFleetPayload();const open=ledger('queued'),none=[];await savedFleetBoard({...open.common,payloadText:async()=>'{"old":true}',waitUntil:p=>none.push(p)});assert.equal(none.length,0);assert.deepEqual(open.names(),['cos_fleet_board_status']);
});

// A database call that takes effect but whose reply never arrives.
const lostReplies=(l,name,count)=>{let left=count;return async(n,args,signal)=>{if(n===name&&left>0){left--;await l.rpc(n,args,signal);throw new TypeError('reply lost');}return l.rpc(n,args,signal);};};
test('claim committed but its reply was lost: the same token asks again, is confirmed and runs the batch once',async()=>{
 const l=ledger();assert.equal(await startFleetBatch({...l.common,rpc:lostReplies(l,'cos_fleet_board_claim',1),run:'run',inline:true}),'ran_here');
 const claims=l.calls.filter(c=>c[0]==='cos_fleet_board_claim');assert.equal(claims.length,2);assert.equal(claims[0][1].p_producer,claims[1][1].p_producer,'the attempted token is retained');
 assert.deepEqual(l.waits,[1500]);assert.equal(l.runs.run.state,'completed');assert.equal(l.runs.run.producer,'token-1');assert.equal(l.sources.length,3);assert.equal(l.calls.some(c=>c[0]==='cos_fleet_board_fail'),false);
});
test('claim committed and never confirmed: the run is released with the attempted token, not left claimed with no worker',async()=>{
 const l=ledger();assert.equal(await startFleetBatch({...l.common,rpc:lostReplies(l,'cos_fleet_board_claim',99),run:'run',inline:true}),'failed');
 assert.equal(l.runs.run.producer,'token-1','the claim did commit');assert.equal(l.runs.run.state,'failed','and the run was released by its claimant');
 const release=l.calls.find(c=>c[0]==='cos_fleet_board_fail');assert.equal(release[1].p_producer,'token-1');assert.equal(release[1].p_diagnostics.steps[0].kind,'claim_unconfirmed');assert.deepEqual(l.sources,[]);
 // Direct helper contract.
 const idle=ledger();assert.deepEqual(await claimFleetBatch({rpc:idle.rpc,run:'run',producer:'p',sleep:async()=>{}}),{claimed:true,leaseRemainingMs:175000});assert.deepEqual(await claimFleetBatch({rpc:idle.rpc,run:'run',producer:'q',sleep:async()=>{}}),{claimed:false});
 assert.deepEqual(await claimFleetBatch({rpc:async()=>{throw Error('down');},run:'run',producer:'p',sleep:async()=>{}}),{claimed:null});
});
test('worker entry: only a confirmed claim is accepted; an unanswered claim is reconciled by the worker that sent it',async()=>{
 const entry=(l,rpc=l.rpc)=>{const tasks=[];return {tasks,run:()=>acceptFleetBatch({...l.common,rpc,run:'run',waitUntil:p=>tasks.push(p)})};};
 const ok=ledger(),a=entry(ok);assert.equal(await a.run(),'accepted');await Promise.all(a.tasks);assert.equal(ok.runs.run.state,'completed');assert.equal(ok.sources.length,3);
 const taken=ledger();await taken.rpc('cos_fleet_board_claim',{p_run:'run',p_producer:'first'});const b=entry(taken);assert.equal(await b.run(),'refused');assert.equal(b.tasks.length,0);assert.deepEqual(taken.sources,[]);
 // Claim committed, reply lost: not acknowledged as accepted, but this worker owns the run and must run it.
 const lost=ledger(),c=entry(lost,lostReplies(lost,'cos_fleet_board_claim',1));assert.equal(await c.run(),'unknown');assert.equal(lost.runs.run.producer,'token-1');
 // Meanwhile the refresh request treats the hand-off as uncertain and is refused the claim.
 assert.equal(await startFleetBatch({...lost.common,token:()=>'fallback',run:'run',targets:[async()=>'uncertain'],inline:true}),'owned_elsewhere');
 await Promise.all(c.tasks);assert.equal(lost.runs.run.state,'completed');assert.equal(lost.runs.run.producer,'token-1');assert.equal(lost.sources.length,3,'run once, by the worker');
 // Claim never sent successfully and the fallback took the run: the worker stands down.
 const raced=ledger();let first=true;const d=entry(raced,async(n,args,s)=>{if(n==='cos_fleet_board_claim'&&first){first=false;await raced.rpc(n,{...args,p_producer:'fallback'});throw new TypeError('not delivered');}return raced.rpc(n,args,s);});
 assert.equal(await d.run(),'unknown');await Promise.all(d.tasks);assert.equal(raced.runs.run.producer,'fallback');assert.deepEqual(raced.sources,[]);assert.equal(raced.runs.run.state,'running');
 // Claim committed and the database stays unreachable: released by the token that holds it.
 const dead=ledger(),e=entry(dead,lostReplies(dead,'cos_fleet_board_claim',99));assert.equal(await e.run(),'unknown');await Promise.all(e.tasks);assert.equal(dead.runs.run.state,'failed');assert.equal(dead.runs.run.failure.steps[0].kind,'claim_unconfirmed');
});
test('queued lease granted but its reply was lost: the same request token recovers that lease and it gets a producer',async()=>{
 const l=ledger('queued');assert.equal(await continueQueuedFleetBoard({...l.common,rpc:lostReplies(l,'cos_fleet_board_begin',1),inline:true}),true);
 const begins=l.calls.filter(c=>c[0]==='cos_fleet_board_begin');assert.equal(begins.length,2);assert.equal(begins[0][1].p_request,begins[1][1].p_request);assert.deepEqual(begins.map(c=>c[1].p_force),[false,false]);
 assert.deepEqual(Object.keys(l.runs).sort(),['next','run'],'no second follow-up was created');assert.equal(l.runs.next.state,'completed');assert.ok(l.runs.next.producer);assert.equal(l.sources.length,3);
 // The same for a forced refresh.
 forgetSavedFleetPayload();const f=ledger(),tasks=[];await savedFleetBoard({...f.common,rpc:lostReplies(f,'cos_fleet_board_begin',2),payloadText:async()=>'{"old":true}',force:true,waitUntil:p=>tasks.push(p)});await Promise.all(tasks);
 const forced=f.calls.filter(c=>c[0]==='cos_fleet_board_begin');assert.equal(forced.length,3);assert.equal(new Set(forced.map(c=>c[1].p_request)).size,1);assert.equal(f.runs.run.state,'completed');assert.equal(f.sources.length,3);
 // If the database never answers, the request reports the failure instead of pretending a refresh started.
 forgetSavedFleetPayload();const down=ledger();await assert.rejects(()=>savedFleetBoard({...down.common,rpc:async()=>{throw new TypeError('down');},payloadText:async()=>'{}',force:true,waitUntil:()=>{throw Error('nothing may be scheduled');}}),/down/);
});
test('deadlines come from the remaining database lease, and the publish request is bounded inside it',async()=>{
 // 20 seconds of the lease were already spent on hand-off and grace before this worker claimed it.
 const b=batch({leaseRemainingMs:160000});assert.equal(await b.run(),true);
 for(const [,limits] of b.reads)assert.equal(limits.until,1000+160000-COMMIT_RESERVE_MS);assert.deepEqual(b.bounds,[COMMIT_REQUEST_MAX_MS]);assert.equal(b.calls.at(-1)[1].p_diagnostics.budgetMs,160000);
 // Little lease left at publish time: the request is cut to what remains, never past the lease.
 const tight=batch({leaseRemainingMs:160000,readMs:46000});assert.equal(await tight.run(),true);assert.equal(tight.bounds.length,1);assert.equal(tight.bounds[0],160000-3*46000-3000);assert.ok(tight.bounds[0]<COMMIT_REQUEST_MAX_MS);
 // Too little lease left to read anything: no source is read and nothing is published.
 const late=batch({leaseRemainingMs:30000});assert.equal(await late.run(),false);assert.deepEqual(late.reads,[]);assert.equal(late.calls.at(-1)[1].p_diagnostics.steps.at(-1).kind,'batch_deadline');assert.deepEqual(late.bounds,[]);
});
test('a publish request that is cut off is reported, and the failure cannot undo a publish that did land',async()=>{
 const cut=batch({rpc:name=>{if(name==='cos_fleet_board_finish')throw new DOMException('timed out','TimeoutError');return true;}});assert.equal(await cut.run(),false);
 const [name,args]=cut.calls.at(-1);assert.equal(name,'cos_fleet_board_fail');assert.equal(args.p_producer,'token-a');assert.equal(args.p_diagnostics.failedStep,'commit');assert.equal(args.p_diagnostics.steps.at(-1).kind,'commit_timeout');
 // Ledger with database rules: the publish landed, its reply was lost, and the follow-up failure is refused.
 const l=ledger();await l.rpc('cos_fleet_board_claim',{p_run:'run',p_producer:'token-a'});
 assert.equal(await produceFleetBoard({...l.common,rpc:lostReplies(l,'cos_fleet_board_finish',1),run:'run',producer:'token-a',leaseRemainingMs:170000,timeoutSignal:()=>undefined}),false);
 assert.equal(l.runs.run.state,'completed','the published board stands');
});
test('database: lost replies are recoverable and an unclaimed token-requested lease cannot block refresh',async()=>{
 const db=new PGlite();await db.exec('create role service_role bypassrls;create role anon;create role authenticated;');
 for(const file of ['fleet-durable-board-install.sql','fleet-board-staging.sql','fleet-board-reliability-20261109.sql'])await db.exec(readFileSync(new URL('../db/'+file,import.meta.url),'utf8'));
 await db.exec('set role service_role;');
 const one=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 const age=seconds=>db.exec("reset role;update cos_fleet_board_private.runs set started_at=started_at-interval '"+seconds+" seconds';update cos_fleet_board_private.control set next_at=next_at-interval '"+seconds+" seconds';set role service_role;");
 const count=async()=>Number(await one('select count(*) from cos_fleet_board_private.runs'));
 const R1='11111111-1111-4111-8111-111111111111',R2='22222222-2222-4222-8222-222222222222',R3='33333333-3333-4333-8333-333333333333',P='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',Q='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const payload={contract:'COS_SAVED_FLEET_BOARD_V1',fleet:{fieldMap:{sharedFleetView:true}},counts:{online:1}};
 // Forced lease: the reply is lost, the same request asks again and gets the same lease.
 const a=await one('select public.cos_fleet_board_begin(true,$1)',[R1]);const replay=await one('select public.cos_fleet_board_begin(true,$1)',[R1]);
 assert.equal(replay.id,a.id);assert.equal(replay.replayed,true);assert.equal(await count(),1);
 assert.equal(await one('select public.cos_fleet_board_begin(true,$1)',[R2]),null,'a different request is still refused while the lease is active');
 // Claim reply lost: the same token is confirmed, another is refused, and the claimant publishes.
 assert.equal((await one('select public.cos_fleet_board_claim($1,$2)',[a.id,P])).claimed,true);assert.equal((await one('select public.cos_fleet_board_claim($1,$2)',[a.id,P])).claimed,true);assert.equal((await one('select public.cos_fleet_board_claim($1,$2)',[a.id,Q])).claimed,false);
 await age(100);assert.equal(await one('select public.cos_fleet_board_finish($1,$2::jsonb,null,$3)',[a.id,JSON.stringify(payload),P]),true);
 // Queued follow-up lease: granted, reply lost, same request recovers it; the queue is consumed exactly once.
 assert.equal((await one('select public.cos_fleet_board_status()')).refresh.state,'queued');
 const b=await one('select public.cos_fleet_board_begin(false,$1)',[R2]);assert.ok(b.id);assert.equal((await one('select public.cos_fleet_board_status()')).refresh.state,'running');
 const again=await one('select public.cos_fleet_board_begin(false,$1)',[R2]);assert.equal(again.id,b.id);assert.equal(again.replayed,true);assert.equal(await count(),2);
 assert.equal((await one('select public.cos_fleet_board_claim($1,$2)',[b.id,Q])).claimed,true,'the recovered lease gets its producer');
 assert.equal(await one("select public.cos_fleet_board_fail($1,'source_read_failed','[]',null,$2)",[b.id,Q]),true);
 // Last resort: a token-requested lease nobody claimed stops blocking after 60 seconds.
 await age(61);const c=await one('select public.cos_fleet_board_begin(true,$1)',[R3]);assert.ok(c.id);
 await age(59);assert.equal((await one('select public.cos_fleet_board_status()')).refresh.state,'running');assert.equal(await one('select public.cos_fleet_board_begin(true)'),null);
 await age(2);const orphan=await one('select public.cos_fleet_board_status()');assert.equal(orphan.refresh.state,'failed');assert.equal(orphan.refresh.error,'worker_interrupted');assert.equal(orphan.latest.id,a.id,'the stored board is untouched');
 assert.equal((await one('select public.cos_fleet_board_claim($1,$2)',[c.id,P])).claimed,false,'too late to claim');
 const next=await one('select public.cos_fleet_board_begin(true)');assert.ok(next.id,'the next refresh is not blocked for the rest of the lease');
 assert.equal((await db.query('select state,error_code from cos_fleet_board_private.runs where id=$1',[c.id])).rows[0].error_code,'worker_interrupted');
 // A replay of the abandoned request returns its own (now closed) lease and creates nothing.
 const before=await count();assert.equal((await one('select public.cos_fleet_board_begin(true,$1)',[R3])).id,c.id);assert.equal(await count(),before);
 // A lease requested without a token (the previous handler never claims) keeps the full 180 seconds.
 await age(150);assert.equal((await one('select public.cos_fleet_board_status()')).refresh.state,'running');assert.equal((await one('select public.cos_fleet_board_read()')).refresh.state,'running');
 assert.equal(await one('select public.cos_fleet_board_begin(true)'),null);assert.equal(await one('select public.cos_fleet_board_finish($1,$2::jsonb)',[next.id,JSON.stringify(payload)]),true);
 await db.close();
});
