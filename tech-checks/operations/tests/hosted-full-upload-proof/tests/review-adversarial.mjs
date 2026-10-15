// Synthetic differential regressions retained from independent review.
import {PGlite,smallFixture,representativeFixture,t,n,sha,org,testDir,dbDir} from './fixture-loader.mjs';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';




const root=dbDir,out=testDir;
const baseline=await readFile(root+'/upload-baseline.sql','utf8'),candidate=await readFile(root+'/upload-setbased.sql','utf8'),digests=await readFile(testDir+'/diagnostic-digests.sql','utf8');
const db=new PGlite();await db.exec("set timezone='UTC';set statement_timeout='8s';set work_mem='2184kB'");const f=await smallFixture(db);await f.call();
const original=(await db.query('select receipt,records from cos_mhelp_placement_private.upload_batches')).rows[0];
const report={syntheticOnly:true,productionReads:0,productionWrites:0,sourceTreeEdits:0,candidateSha256:createHash('sha256').update(candidate).digest('hex'),cases:[]};
const save=()=>writeFile(out+'/review-adversarial-results.json',JSON.stringify(report,null,2)+'\n');
async function attempt(){await db.exec('savepoint probe');try{const r=(await db.query('select cos_mhelp_placement_private.upload_snapshot()::text value')).rows[0].value;await db.exec('release savepoint probe');return {value:r};}catch(e){await db.exec('rollback to savepoint probe;release savepoint probe');return {error:{code:e.code,message:e.message,detail:e.detail??null,hint:e.hint??null}};}}
async function compare(name,mutate=async()=>{}){await db.exec('begin');try{await mutate();await db.exec(baseline);const before=await attempt();await db.exec(candidate);const after=await attempt();assert.deepEqual(after,before,name);let count=null;if(!after.error){const ds=(await db.query(digests)).rows;for(const x of ds)assert.equal(x.current_digest,x.original_digest,name+' exact digest');count=ds.length;}report.cases.push({name,equal:true,error:after.error??null,digestPairsCompared:count});console.log('PASS',name,after.error?.code??'',count??'');await save();}finally{await db.exec('rollback');}}
const records=fn=>async()=>{const r=structuredClone(original.records);fn(r);await db.query('update cos_mhelp_placement_private.upload_batches set records=$1',[r]);};
const receipt=fn=>async()=>{const r=structuredClone(original.receipt);fn(r);await db.query('update cos_mhelp_placement_private.upload_batches set receipt=$1',[r]);};
const sql=(s,p=[])=>()=>db.query(s,p);
try{
 await compare('admitted valid fixture exact JSON text');
 await compare('source and tracker input reversed',async()=>{const r=structuredClone(original.receipt);r.trackerRecords.reverse();await db.query('update cos_mhelp_placement_private.upload_batches set receipt=$1,records=$2',[r,[...original.records].reverse()]);});
 await compare('duplicate binding triples across source and tracker',records(r=>{r.push({...r[0],productId:'999',sourceRow:99});r.push({...r[0],productId:'998',sourceRow:98});}));
 await compare('same pair distinct expected null missing guards',records(r=>{r.push({...r[0],productId:'999',sourceRow:99,binding:{...r[0].binding,expectedGuard:null}});r.push({...r[0],productId:'998',sourceRow:98,binding:{...r[0].binding,expectedGuard:'f'.repeat(64)}});const b={...r[0].binding};delete b.expectedGuard;r.push({...r[0],productId:'997',sourceRow:97,binding:b});}));
 await compare('source duplicate sort keys',records(r=>{r[1].sourceRow=r[0].sourceRow;}));
 await compare('source all missing sort keys',records(r=>r.forEach(x=>delete x.sourceRow)));
 await compare('tracker duplicate sort keys',receipt(r=>{r.trackerRecords[1].recordId=r.trackerRecords[0].recordId;}));
 await compare('tracker all missing sort keys',receipt(r=>r.trackerRecords.forEach(x=>delete x.recordId)));
 for(const value of [null,{},[],false,3,'x']){
  await compare('source scalar/empty binding '+JSON.stringify(value),records(r=>{r[0].binding=value;}));
  await compare('tracker scalar/empty binding '+JSON.stringify(value),receipt(r=>{r.trackerRecords[0].binding=value;}));
 }
 for(const value of [null,[],false,3,'x']){
  await compare('source scalar record '+JSON.stringify(value),records(r=>{r[0]=value;}));
  await compare('tracker scalar record '+JSON.stringify(value),receipt(r=>{r.trackerRecords[0]=value;}));
 }
 for(const value of ['',0,false,[],{},'bad']){
  await compare('source malformed tracker ID '+JSON.stringify(value),records(r=>{r[0].binding.trackerId=value;}));
  await compare('tracker malformed native ID '+JSON.stringify(value),receipt(r=>{r.trackerRecords[0].binding.nativeUnitId=value;}));
 }
 for(const state of ['linked','held','unlinked',null,'missing',false,0,{},[]]){
  await compare('tracker eligibility '+JSON.stringify(state)+' with malformed ID',receipt(r=>{r.trackerRecords[0].binding.trackerId='bad';if(state==='missing')delete r.trackerRecords[0].binding.state;else r.trackerRecords[0].binding.state=state;}));
 }
 for(const val of [null,{},[],true,3,'x'])await compare('expectedGuard type '+JSON.stringify(val),records(r=>{r[0].binding.expectedGuard=val;}));
 await compare('nonexistent tracker and native IDs',records(r=>{r[0].binding.trackerId=t(999);r[0].binding.nativeUnitId=n(999);}));
 await compare('native-only binding',records(r=>{r[0].binding.trackerId=null;}));
 await compare('tracker-only binding',records(r=>{r[0].binding.nativeUnitId=null;}));
 await compare('both identities null',records(r=>{r[0].binding.trackerId=null;r[0].binding.nativeUnitId=null;}));
 await compare('two source rows through distinct OR legs',records(r=>{r[0].binding.nativeUnitId=n(2);}));
 await compare('empty source and tracker arrays',sql("update cos_mhelp_placement_private.upload_batches set records='[]',receipt=jsonb_set(receipt,'{trackerRecords}','[]')"));
 await compare('all source unbound and tracker held',async()=>{const r=structuredClone(original.receipt);r.trackerRecords.forEach(x=>{x.binding.state='held';x.binding.trackerId='bad';});const rs=structuredClone(original.records);rs.forEach(x=>x.binding=null);await db.query('update cos_mhelp_placement_private.upload_batches set receipt=$1,records=$2',[r,rs]);});
 await compare('archive one row matches two OR legs and repeated bindings',async()=>{await db.query(`insert into app_private.cos_archived_representations(organization_id,archived_native_id,canonical_native_id,archived_tracker_id,canonical_tracker_id,reviewed_before,source_evidence,review_sha256,evidence_sha256) values($1,$2,$3,$4,$5,'{}','{}',$6,$6)`,[org,n(900),n(1),t(900),t(1),sha]);await records(r=>{r.push({...r[0],productId:'999',sourceRow:99});})();});
 await compare('archive row selected by one binding and irrelevant to others',sql(`insert into app_private.cos_archived_representations(organization_id,archived_native_id,canonical_native_id,archived_tracker_id,canonical_tracker_id,reviewed_before,source_evidence,review_sha256,evidence_sha256) values($1,$2,$3,$4,$5,'{}','{}',$6,$6)`,[org,n(900),n(1),t(901),t(902),sha]));
 await compare('duplicate and null history rows retained',()=>db.exec(`insert into public.equipment_unit_location_history values('${n(1)}','Z'),('${n(1)}','A'),('${n(1)}','A'),('${n(1)}',null),(null,'irrelevant');insert into app_private.cos_owner_identity_claims values('${n(1)}','Z'),('${n(1)}','A'),('${n(1)}','A'),('${n(1)}',null),(null,'irrelevant')`));
 for(const table of ['app_private.vision_tracker_locations','public.equipment_units','app_private.cos_geocode_sources','app_private.cos_archived_representations','public.equipment_unit_location_history','app_private.cos_owner_identity_claims'])await compare('whole row appended column '+table,async()=>{if(table.includes('archived_representations'))await db.query(`insert into app_private.cos_archived_representations(organization_id,archived_native_id,canonical_native_id,archived_tracker_id,canonical_tracker_id,reviewed_before,source_evidence,review_sha256,evidence_sha256) values($1,$2,$3,$4,$5,'{}','{}',$6,$6)`,[org,n(900),n(1),t(900),t(1),sha]);if(table.includes('location_history'))await db.query('insert into '+table+' values($1,$2)',[n(1),'synthetic']);if(table.includes('identity_claims'))await db.query('insert into '+table+' values($1,$2)',[n(1),'synthetic']);await db.exec(`alter table ${table} add column synthetic_extra jsonb default '{"z":[null,false,{"unicode":"é中文"}],"x":1}'`);});
 for(const timezone of ['America/New_York','Asia/Kolkata','Etc/GMT+6'])await compare('session timezone '+timezone,sql('set local timezone='+"'"+timezone+"'"));
 await compare('latest continuity head rejects prior matching head',sql(`insert into cos_mhelp_placement_private.source_continuity(request_id,action,source_sha256,payload_sha256,tracker_id,native_id,original_guard,before_guard,after_guard,before_graph,after_graph,authorization_sha256,created_at) select request_id,action,source_sha256,payload_sha256,tracker_id,native_id,original_guard,before_guard,$1,before_graph,after_graph,authorization_sha256,'2001-01-01' from cos_mhelp_placement_private.source_continuity`,['f'.repeat(64)]));
 await compare('latest wrong payload continuity ignored',sql(`insert into cos_mhelp_placement_private.source_continuity(request_id,action,source_sha256,payload_sha256,tracker_id,native_id,original_guard,before_guard,after_guard,before_graph,after_graph,authorization_sha256) select request_id,action,source_sha256,$1,tracker_id,native_id,original_guard,before_guard,$1,before_graph,after_graph,authorization_sha256 from cos_mhelp_placement_private.source_continuity`,['f'.repeat(64)]));
 await compare('latest wrong source continuity ignored',sql(`insert into cos_mhelp_placement_private.source_continuity(request_id,action,source_sha256,payload_sha256,tracker_id,native_id,original_guard,before_guard,after_guard,before_graph,after_graph,authorization_sha256) select request_id,action,$1,payload_sha256,tracker_id,native_id,original_guard,before_guard,$1,before_graph,after_graph,authorization_sha256 from cos_mhelp_placement_private.source_continuity`,['f'.repeat(64)]));
 await compare('latest wrong original guard continuity ignored',sql(`insert into cos_mhelp_placement_private.source_continuity(request_id,action,source_sha256,payload_sha256,tracker_id,native_id,original_guard,before_guard,after_guard,before_graph,after_graph,authorization_sha256) select request_id,action,source_sha256,payload_sha256,tracker_id,native_id,$1,before_guard,$1,before_graph,after_graph,authorization_sha256 from cos_mhelp_placement_private.source_continuity`,['f'.repeat(64)]));
 await compare('active pointer switches batch with no matching continuity',async()=>{await db.query('insert into cos_mhelp_placement_private.upload_batches select $1,payload_sha256,receipt,records,admitted_at from cos_mhelp_placement_private.upload_batches',['f'.repeat(64)]);await db.query('update cos_mhelp_placement_private.upload_control set active_sha256=$1',['f'.repeat(64)]);});
 report.complete=true;await save();console.log('COMPLETE',report.cases.length);
}catch(e){report.failure={message:e.message,stack:e.stack};await save();throw e;}finally{await db.close();}
