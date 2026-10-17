import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {schema as nativeSchema} from './fixtures/mhelp-placement-schema.mjs';

// Synthetic PostgreSQL 17 execution only. Never connect to COS production.
if(process.env.COS_OWNER_POSTGRES_CI!=='1')throw Error('Synthetic PostgreSQL CI opt-in required');
const db='cos_owner_import_ci',actor='22222222-2222-4222-8222-222222222222';
const org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',previous='a'.repeat(64),censusHash='c'.repeat(64);
const source=Buffer.from('ProductId,ProductModel,CustomerId,CustomerName,Category,Address,City,State,Zip\n11,Ranger 007,100,Domain Builders,Ranger,Site,Houston,TX,77064\n12,Ranger 024,200,Cameras OnSite,Ranger,Shop,Houston,TX,77064\n13,Sniper 230,200,Cameras OnSite,Sniper,Shop,Houston,TX,77064\n14,ST 239,300,CAMERAS ONSITE - TEST UNITS,Stand,Test Yard,Houston,TX,77064\n');
const sourceHash=createHash('sha256').update(source).digest('hex');
const records=[
 {productId:'11',unitNumber:'Ranger 007',customerId:'100',customer:'Domain Builders',category:'Ranger',placement:'FIELD',lifecycle:'UNFLAGGED',sourceRow:2,sourceAddress:{street:'Site',city:'Houston',state:'TX',zip:'77064'}},
 {productId:'12',unitNumber:'Ranger 024',customerId:'200',customer:'Cameras OnSite',category:'Ranger',placement:'SHOP',lifecycle:'UNFLAGGED',sourceRow:3,sourceAddress:{street:'Shop',city:'Houston',state:'TX',zip:'77064'}},
 {productId:'13',unitNumber:'Sniper 230',customerId:'200',customer:'Cameras OnSite',category:'Sniper',placement:'SHOP',lifecycle:'UNFLAGGED',sourceRow:4,sourceAddress:{street:'Shop',city:'Houston',state:'TX',zip:'77064'}},
 {productId:'14',unitNumber:'ST 239',customerId:'300',customer:'CAMERAS ONSITE - TEST UNITS',category:'Stand',placement:'SHOP',lifecycle:'UNFLAGGED',sourceRow:5,sourceAddress:{street:'Test Yard',city:'Houston',state:'TX',zip:'77064'}}
];
const census=records.map(r=>({productId:r.productId,family:r.category,unitLabel:r.unitNumber,placement:r.placement,customer:r.customer}));
function pg(sql){
 return execFileSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-U','postgres','-d',db,'-f','-'],{
  input:sql,env:{...process.env,PGPASSWORD:'synthetic-ci-only'},encoding:'utf8',timeout:45000,stdio:['pipe','pipe','pipe'],
 }).trim();
}
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
function call(name,args){
 return JSON.parse(pg("SELECT public."+name+"("+args.join(',')+")::text"));
}
const stage=(id,opts={})=>call('cos_owner_mhelp_equipment_stage_v1',[
 quote(opts.actor||actor)+'::uuid',quote(org)+'::uuid',quote(id)+'::uuid',
 quote('ServiceItem_List_20261016131754.csv'),quote(opts.sourceHash||sourceHash),
 quote(opts.oldSource||previous),quote(censusHash),quote(JSON.stringify(opts.census||census))+'::jsonb',
 quote(source.toString('base64')),quote(JSON.stringify(records))+'::jsonb'
]);
const commit=(id,note='I reviewed and approve the current COS Field and Shop equipment.',sha=censusHash)=>call('cos_owner_mhelp_equipment_commit_v1',[
 quote(actor)+'::uuid',quote(org)+'::uuid',quote(id)+'::uuid',
 quote(previous),quote(sha),quote(note)
]);

pg("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA app_private;CREATE SCHEMA cos_mhelp_placement_private;");
pg("CREATE TABLE cos_mhelp_placement_private.upload_control(singleton boolean primary key,active_sha256 text);CREATE TABLE cos_mhelp_placement_private.upload_batches(source_sha256 text primary key,payload_sha256 text not null,receipt jsonb not null,records jsonb not null,admitted_at timestamptz not null default clock_timestamp());");
pg("INSERT INTO cos_mhelp_placement_private.upload_control VALUES(true,"+quote(previous)+")");
pg("CREATE FUNCTION app_private.appdeploy_assume_actor(p uuid,o uuid) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN IF p IS DISTINCT FROM '22222222-2222-4222-8222-222222222222'::uuid OR o IS DISTINCT FROM 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid THEN RAISE EXCEPTION 'actor denied' USING ERRCODE='42501';END IF;END $f$;");
pg("CREATE FUNCTION app_private.has_permission(o uuid,p text) RETURNS boolean LANGUAGE sql AS $f$ SELECT o='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid AND p='equipment.manage' $f$;");
pg("CREATE FUNCTION cos_mhelp_placement_private.review_upload(receipt jsonb,records jsonb,expected text,apply_it boolean default false) RETURNS jsonb LANGUAGE plpgsql AS $f$ DECLARE old text;total int;field int;shop int;BEGIN SELECT active_sha256 INTO old FROM cos_mhelp_placement_private.upload_control WHERE singleton FOR UPDATE;IF old IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Active source changed' USING ERRCODE='40001';END IF;SELECT count(*),count(*) FILTER(WHERE r->>'placement'='FIELD'),count(*) FILTER(WHERE r->>'placement'='SHOP') INTO total,field,shop FROM jsonb_array_elements(records) r; IF total::text IS DISTINCT FROM receipt->>'recordCount' OR jsonb_array_length(receipt->'trackerRecords')<>total OR receipt->>'libraryFileId' !~ '^libfile_[a-z0-9]+$' THEN RAISE EXCEPTION 'incomplete source receipt';END IF;IF apply_it THEN INSERT INTO cos_mhelp_placement_private.upload_batches(source_sha256,payload_sha256,receipt,records) VALUES(receipt->>'sourceSha256','b',receipt,records);UPDATE cos_mhelp_placement_private.upload_control SET active_sha256=receipt->>'sourceSha256' WHERE singleton;END IF;RETURN jsonb_build_object('sourceSha256',receipt->>'sourceSha256','applied',apply_it,'records',total,'recordedField',field,'recordedShop',shop);END $f$;");
const oldReceipt={contract:'COS_MHELP_UPLOAD_V1',reviewed:true,sourceSha256:previous,filename:'ServiceItem_List_20261013141848.csv',recordCount:3,trackerRecords:[{recordId:'old:ranger7',unitNumber:'Ranger 007',matchedProductId:'11',binding:{state:'linked',trackerId:'00000000-0000-4000-8000-000000000011',unitIds:['00000000-0000-4000-8000-000000000011'],unitLabels:{'00000000-0000-4000-8000-000000000011':'Ranger 007'},guardCurrent:true}}],companyCustomerIds:['200']};
const oldRows=[{...records[0],placement:'SHOP',customerId:'200',customer:'Cameras OnSite',sourceAddress:{street:'Old Shop',city:'Houston',state:'TX',zip:'77064'},binding:{productId:'11',fullLabel:'Ranger 007',trackerId:'00000000-0000-4000-8000-000000000011'}},{...records[1],binding:null},{...records[2],productId:'99',binding:null},{...records[3],binding:null}];
pg("INSERT INTO cos_mhelp_placement_private.upload_batches(source_sha256,payload_sha256,receipt,records) VALUES("+quote(previous)+",'b',"+quote(JSON.stringify(oldReceipt))+"::jsonb,"+quote(JSON.stringify(oldRows))+"::jsonb)");
// Exercise the deployed reviewed-upload implementation, rather than the setup
// stand-in above. Empty native tables provide its source-only locking surface;
// this is deliberately not proof of linked identity-graph admission.
pg(nativeSchema.slice(nativeSchema.indexOf(' create table '),nativeSchema.indexOf(' create function ')));
pg('CREATE TABLE cos_mhelp_placement_private.upload_audit(id bigint generated always as identity,action text,source_sha256 text,previous_sha256 text,authorization_sha256 text)');
pg('DROP FUNCTION cos_mhelp_placement_private.review_upload(jsonb,jsonb,text,boolean)');
const overlay=readFileSync(new URL('../db/mhelp_upload_overlay.sql',import.meta.url),'utf8');
pg(overlay.slice(overlay.indexOf('create function cos_mhelp_placement_private.upload_binding_guard('),overlay.indexOf('create function cos_mhelp_placement_private.review_upload(')));
pg(overlay.slice(overlay.indexOf('create function cos_mhelp_placement_private.review_upload('),overlay.indexOf('create function cos_mhelp_placement_private.rollback_upload(')));
pg('CREATE TABLE cos_mhelp_placement_private.scoped_control(base_sha256 text primary key,revision bigint,active_id uuid);CREATE TABLE cos_mhelp_placement_private.scoped_batches(id uuid primary key,base_sha256 text,records jsonb)');
const scoped=readFileSync(new URL('../db/scoped_inventory_overlay.sql',import.meta.url),'utf8');
const scopedStart=scoped.indexOf('create function cos_mhelp_placement_private.scoped_records(');
pg(scoped.slice(scopedStart,scoped.indexOf('$$;',scopedStart)+3));
pg(readFileSync(new URL('../docs/drafts/cos-owner-equipment-stage-commit-20261016.sql',import.meta.url),'utf8'));

const id=randomUUID(),staged=stage(id);
assert.equal(staged.contract,'COS_OWNER_EQUIPMENT_STAGE_V1');
assert.equal(staged.productIdsMatched,4);
assert.equal(staged.recordedField,1);
assert.equal(staged.recordedShop,3);
assert.equal(staged.readyToCommit,false);
assert.equal(pg("SELECT encode(source_bytes,'hex') FROM cos_mhelp_placement_private.owner_equipment_stages WHERE id="+quote(id)+"::uuid"),source.toString('hex'));
const r=JSON.parse(pg("SELECT records::text FROM cos_mhelp_placement_private.owner_equipment_stages WHERE id="+quote(id)+"::uuid"));
assert.equal(r.find(x=>x.productId==='13').binding,null);
assert.equal(r.find(x=>x.productId==='13').placementHeld,true);
// Customer/placement movement remains in the full current source census but
// cannot inherit its previous protected camera/native installation link.
assert.equal(r.find(x=>x.productId==='11').binding,null);
assert.equal(r.find(x=>x.productId==='11').placementHeld,true);
assert.equal(r.find(x=>x.productId==='11').placement,'FIELD');
assert.equal(r.find(x=>x.productId==='14').placement,'SHOP');
assert.equal(r.find(x=>x.productId==='14').customer,'CAMERAS ONSITE - TEST UNITS');
const stagedSource=JSON.parse(pg("SELECT receipt::text FROM cos_mhelp_placement_private.owner_equipment_stages WHERE id="+quote(id)+"::uuid"));
const heldTracker=stagedSource.trackerRecords.find(x=>x.matchedProductId==='11');
assert.equal(heldTracker.binding.state,'held');
assert.deepEqual(heldTracker.binding.unitIds,[]);
assert.equal(heldTracker.placement,'FIELD');
assert.equal(pg('SELECT active_sha256 FROM cos_mhelp_placement_private.upload_control'),previous);
assert.throws(()=>stage(randomUUID(),{sourceHash:'d'.repeat(64)}),/checksum mismatch/);
assert.throws(()=>stage(randomUUID(),{oldSource:'d'.repeat(64)}),/source changed/);
assert.throws(()=>stage(randomUUID(),{census:[{...census[0],productId:'999'},...census.slice(1)]}),/Product ID authority mismatch/);
assert.throws(()=>stage(randomUUID(),{actor:'33333333-3333-4333-8333-333333333333'}),/actor denied/);
assert.throws(()=>commit(id,'yes'),/Explicit source approval/);
assert.throws(()=>commit(id,'I reviewed all source changes but have an obsolete census.','d'.repeat(64)),/Equipment source review is stale/);
// A scoped correction can advance without changing the raw upload SHA.
pg('INSERT INTO cos_mhelp_placement_private.scoped_control VALUES('+quote(previous)+',1,NULL)');
assert.throws(()=>commit(id),/scoped source changed/);
assert.equal(pg('SELECT active_sha256 FROM cos_mhelp_placement_private.upload_control'),previous);
const refreshedId=randomUUID();stage(refreshedId);
const applied=commit(refreshedId);
assert.equal(applied.applied,true);
assert.equal(applied.contract,'COS_OWNER_EQUIPMENT_COMMIT_V1');
assert.equal(pg('SELECT active_sha256 FROM cos_mhelp_placement_private.upload_control'),sourceHash);
const repeated=commit(refreshedId);
assert.equal(repeated.idempotent,true);
assert.equal(repeated.contract,applied.contract);
assert.equal(repeated.stageId,applied.stageId);
assert.equal(repeated.sourceReceiptsApplied,true);
assert.equal(pg('SELECT count(*) FROM cos_mhelp_placement_private.upload_audit'),'1');
// Full-size synthetic admission: exercise the same 1001 / 287 / 714 shape
// without committing the private customer CSV or using a live Sheets proof.
const loadRows=Array.from({length:1001},(_,i)=>({productId:String(i+1),unitNumber:'ST '+String(i+1),
 customerId:i<287?'100':i===287?'300':'200',customer:i<287?'Synthetic Builder':i===287?'CAMERAS ONSITE - TEST UNITS':'Cameras OnSite',
 category:'Stand',placement:i<287?'FIELD':'SHOP',lifecycle:'UNFLAGGED',sourceRow:i+2,
 sourceAddress:{street:'Synthetic Site',city:'Houston',state:'TX',zip:'77064'}}));
const loadBytes=Buffer.from('ProductId,ProductModel,CustomerId,CustomerName,Category,Address,City,State,Zip\n'+loadRows.map(r=>[r.productId,r.unitNumber,r.customerId,r.customer,r.category,'Synthetic Site','Houston','TX','77064'].join(',')).join('\n')+'\n');
const loadHash=createHash('sha256').update(loadBytes).digest('hex'),loadId=randomUUID();
const loadCensus=loadRows.map(r=>({productId:r.productId,family:r.category,unitLabel:r.unitNumber,placement:r.placement,customer:r.customer}));
const loadPreview=call('cos_owner_mhelp_equipment_stage_v1',[
 quote(actor)+'::uuid',quote(org)+'::uuid',quote(loadId)+'::uuid',quote('ServiceItem_List_20261016131754.csv'),
 quote(loadHash),quote(sourceHash),quote(censusHash),quote(JSON.stringify(loadCensus))+'::jsonb',
 quote(loadBytes.toString('base64')),quote(JSON.stringify(loadRows))+'::jsonb']);
assert.equal(loadPreview.productIdsMatched,1001);assert.equal(loadPreview.recordedField,287);assert.equal(loadPreview.recordedShop,714);
const loadCommit=()=>call('cos_owner_mhelp_equipment_commit_v1',[quote(actor)+'::uuid',quote(org)+'::uuid',quote(loadId)+'::uuid',quote(sourceHash),quote(censusHash),quote('I approve the complete synthetic 1001-product source-only load test.')]);
const full=loadCommit();assert.equal(full.records,1001);assert.equal(full.recordedField,287);assert.equal(full.recordedShop,714);
assert.equal(loadCommit().idempotent,true);assert.equal(pg('SELECT count(*) FROM cos_mhelp_placement_private.upload_audit'),'2');
console.log('PostgreSQL 17 Owner guarded stage/commit: source CAS, 2027 membership, Owner denial, held identities and byte evidence verified.');
console.log('PostgreSQL 17 full-size synthetic stage/commit/retry: 1001 products, 287 Field, 714 Shop, exact internal Test Units account verified.');
