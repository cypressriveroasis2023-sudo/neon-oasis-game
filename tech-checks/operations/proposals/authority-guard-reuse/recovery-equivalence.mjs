import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite(),root=new URL('../../db/',import.meta.url);
await db.exec(`create schema cos_mhelp_placement_private; create table cos_mhelp_placement_private.upload_batches(source_sha256 text,payload_sha256 text,receipt jsonb,records jsonb);`);
for(const kind of ['original','candidate'])await db.exec(readFileSync(new URL(`20261113_identity_recovery_${kind}.sql`,root),'utf8').replace('FUNCTION cos_mhelp_placement_private.recover_identity_evidence_records(',`FUNCTION cos_mhelp_placement_private.${kind}(`));
let n=0;
async function compare(input,name){let results=[];for(const fn of ['original','candidate'])try{results.push({value:(await db.query(`select cos_mhelp_placement_private.${fn}($1::jsonb) value`,[JSON.stringify(input)])).rows[0].value});}catch(e){results.push({error:e.message,code:e.code});}assert.deepEqual(results[0],results[1],name);n++;return results[1];}
for(const [name,input] of Object.entries({empty:[],null:null,object:{},duplicate:[{productId:'1'},{productId:'1'}],missingid:[{}],nullid:[{productId:null}],noBinding:[{productId:'1'}],nullBinding:[{productId:'1',binding:null}],reviewed:[{productId:'1',binding:{matchMethod:'reviewed_product_id'}}],evidence:[{productId:'1',binding:{reviewEvidence:{}}}],scalar:[{productId:'1',binding:'bad'}],array:[{productId:'1',binding:[]}],invalidMethod:[{productId:'1',unitNumber:'U1',binding:{matchMethod:'bad',canonicalKey:'u1',productId:'1',fullLabel:'U1'}}],nullMethod:[{productId:'1',unitNumber:'U1',binding:{canonicalKey:'u1',productId:'1',fullLabel:'U1'}}]}))await compare(input,name);
const binding={matchMethod:'exact_family_unit',canonicalKey:'u1',productId:'1',fullLabel:'U1',trackerId:'tracker1'},row={productId:'1',unitNumber:'U1',binding};
async function history(rows,source='s1',tamper=false){const receipt={contract:'COS_MHELP_UPLOAD_V1',reviewed:true,sourceSha256:source,recordCount:rows.length};await db.query(`insert into cos_mhelp_placement_private.upload_batches select $1,case when $4 then 'bad' else encode(sha256(convert_to(jsonb_build_object('receipt',$2::jsonb,'records',$3::jsonb)::text,'UTF8')),'hex') end,$2::jsonb,$3::jsonb`,[source,JSON.stringify(receipt),JSON.stringify(rows),tamper]);}
for(const method of ['exact_family_unit','archived_alias','owner_confirmed_alias']){await db.exec('truncate cos_mhelp_placement_private.upload_batches');const r=structuredClone(row);r.binding.matchMethod=method;await history([{...r,binding:{...r.binding,reviewEvidence:{approved:true}}}]);const result=await compare([r],method);assert.equal(result.value.bindings['1'].binding.reviewEvidence.approved,true);}
for(const scenario of ['noHistory','corrupt','conflicting','duplicateRow','multipleSources','mixed']){await db.exec('truncate cos_mhelp_placement_private.upload_batches');const h={...row,binding:{...binding,reviewEvidence:{approved:true}}};if(scenario!=='noHistory')await history(scenario==='duplicateRow'?[h,h]:[h],'s1',scenario==='corrupt');if(scenario==='conflicting')await history([{...h,binding:{...h.binding,reviewEvidence:{approved:false}}}],'s2');if(scenario==='multipleSources')await history([h],'s2');await compare(scenario==='mixed'?[{productId:'2',binding:null},row,{productId:'3',binding:{reviewEvidence:{a:1}}}]:[row],scenario);}
for(const change of [r=>r.binding.fullLabel='other',r=>r.binding.productId='2',r=>r.binding.canonicalKey='',r=>r.binding.reviewEvidence=null,r=>r.binding.matchMethod=null]){const r=structuredClone(row);change(r);await compare([r],'invalid legacy');}
await compare(Array.from({length:10001},(_,i)=>({productId:String(i)})),'oversized');
await compare(Array.from({length:1001},(_,i)=>({productId:String(i+1),binding:{matchMethod:'reviewed_product_id',reviewEvidence:{proof:'x'.repeat(1000)}}})),'large direct set');
for(const value of [true,false,1,0])await compare([{productId:'1',binding:value}],'scalar binding');
await compare([{productId:'2',binding:null},{...row,binding:{...binding,fullLabel:'wrong'}},{productId:'3'}],'ordered mixed invalid');
const nullResults=[];for(const fn of ['original','candidate'])nullResults.push((await db.query(`select cos_mhelp_placement_private.${fn}(null::jsonb) value`).catch(e=>({error:e.message,code:e.code}))));assert.deepEqual(nullResults[0],nullResults[1]);n++;
await compare(Array.from({length:10000},(_,i)=>({productId:String(i)})),'maximum boundary');
await db.exec(readFileSync(new URL('20261113_identity_recovery_original.sql',root),'utf8'));
await db.exec('revoke all on function cos_mhelp_placement_private.recover_identity_evidence_records(jsonb) from public');
const install=readFileSync(new URL('20261113_identity_recovery_install.sql',root),'utf8'),rollback=readFileSync(new URL('20261113_identity_recovery_rollback.sql',root),'utf8');
await db.exec(install);n++;await db.exec(rollback);n++;
await db.exec("alter function cos_mhelp_placement_private.recover_identity_evidence_records(jsonb) set work_mem='32MB'");
await assert.rejects(db.exec(install),/Function drift or permission mismatch/);await db.exec('rollback');n++;
console.log(`${n} recovery equivalence/rejection/install/rollback checks passed`);await db.close();
