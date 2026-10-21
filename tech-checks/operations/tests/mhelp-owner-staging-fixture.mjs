import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
/** Disposable in-memory PostgreSQL-style proof. Never connects to COS production. */
const actor='22222222-2222-4222-8222-222222222222';
const org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const previous='a'.repeat(64),censusSha='c'.repeat(64);
const source=Buffer.from('ProductId,ProductModel,CustomerId,CustomerName,Category,Address,City,State,Zip\n11,Ranger 007,100,Domain Builders,Ranger,Site,Houston,TX,77064\n12,Ranger 024,200,Cameras OnSite,Ranger,Shop,Houston,TX,77064\n13,Sniper 230,200,Cameras OnSite,Sniper,Shop,Houston,TX,77064\n');
const digest=createHash('sha256').update(source).digest('hex');
const records=[
 {productId:'11',unitNumber:'Ranger 007',customerId:'100',customer:'Domain Builders',category:'Ranger',placement:'FIELD',lifecycle:'UNFLAGGED',sourceRow:2,sourceAddress:{street:'Site',city:'Houston',state:'TX',zip:'77064'}},
 {productId:'12',unitNumber:'Ranger 024',customerId:'200',customer:'Cameras OnSite',category:'Ranger',placement:'SHOP',lifecycle:'UNFLAGGED',sourceRow:3,sourceAddress:{street:'Shop',city:'Houston',state:'TX',zip:'77064'}},
 {productId:'13',unitNumber:'Sniper 230',customerId:'200',customer:'Cameras OnSite',category:'Sniper',placement:'SHOP',lifecycle:'UNFLAGGED',sourceRow:4,sourceAddress:{street:'Shop',city:'Houston',state:'TX',zip:'77064'}}
];
const census=records.map(r=>({productId:r.productId,family:r.category,unitLabel:r.unitNumber,placement:r.placement,customer:r.customer}));
const draft=readFileSync(new URL('../docs/drafts/cos-owner-equipment-stage-commit-20261016.sql',import.meta.url),'utf8');
async function setup(db=new PGlite()){
 await db.exec("create role anon; create role authenticated; create role service_role; create schema app_private; create schema cos_mhelp_placement_private;");
 await db.exec("create table cos_mhelp_placement_private.upload_control(singleton boolean primary key,active_sha256 text);");
 await db.exec("create table cos_mhelp_placement_private.upload_batches(source_sha256 text primary key,payload_sha256 text not null,receipt jsonb not null,records jsonb not null,admitted_at timestamptz not null default clock_timestamp());");
 await db.query("insert into cos_mhelp_placement_private.upload_control values(true,$1)",[previous]);
 await db.exec("create function app_private.appdeploy_assume_actor(p uuid,o uuid) returns void language plpgsql as $f$ begin if p is distinct from '22222222-2222-4222-8222-222222222222'::uuid or o is distinct from 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid then raise exception 'no actor' using errcode='42501'; end if; end $f$;");
 await db.exec("create function app_private.has_permission(o uuid,p text) returns boolean language sql as $f$ select o='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid and p='equipment.manage' $f$;");
 await db.exec("create function cos_mhelp_placement_private.review_upload(receipt jsonb,records jsonb,expected text,apply_it boolean default false) returns jsonb language plpgsql as $f$ declare old text; total int; field int; shop int; begin select active_sha256 into old from cos_mhelp_placement_private.upload_control where singleton for update; if old is distinct from expected then raise exception 'Active source changed' using errcode='40001'; end if; select count(*),count(*) filter(where x->>'placement'='FIELD'),count(*) filter(where x->>'placement'='SHOP') into total,field,shop from jsonb_array_elements(records) x; if total::text is distinct from receipt->>'recordCount' or jsonb_array_length(receipt->'trackerRecords')<>total or receipt->>'libraryFileId' !~ '^libfile_[a-z0-9]+$' then raise exception 'incomplete receipt'; end if; if apply_it then insert into cos_mhelp_placement_private.upload_batches(source_sha256,payload_sha256,receipt,records) values(receipt->>'sourceSha256','b',receipt,records); update cos_mhelp_placement_private.upload_control set active_sha256=receipt->>'sourceSha256' where singleton; end if; return jsonb_build_object('applied',apply_it,'sourceSha256',receipt->>'sourceSha256','records',total,'recordedField',field,'recordedShop',shop); end $f$;");
 const oldReceipt={contract:'COS_MHELP_UPLOAD_V1',reviewed:true,sourceSha256:previous,filename:'ServiceItem_List_20261013141848.csv',recordCount:3,trackerRecords:[{recordId:'old:ranger7',unitNumber:'Ranger 007',matchedProductId:'11',binding:{state:'unlinked',unitIds:[],unitLabels:{},guardCurrent:null}}],companyCustomerIds:['200']};
 const oldRows=[{...records[0],binding:null},{...records[1],binding:null},{...records[2],productId:'99',binding:null}];
 await db.query("insert into cos_mhelp_placement_private.upload_batches(source_sha256,payload_sha256,receipt,records) values($1,'b',$2,$3)",[previous,JSON.stringify(oldReceipt),JSON.stringify(oldRows)]);
 await db.exec("create table cos_mhelp_placement_private.scoped_control(base_sha256 text primary key,revision bigint,active_id uuid);create table cos_mhelp_placement_private.scoped_batches(id uuid primary key,base_sha256 text,records jsonb);");
 const scoped=readFileSync(new URL('../db/scoped_inventory_overlay.sql',import.meta.url),'utf8');
 const start=scoped.indexOf('create function cos_mhelp_placement_private.scoped_records(');
 await db.exec(scoped.slice(start,scoped.indexOf('$$;',start)+3));
 await db.exec("create function cos_mhelp_placement_private.upload_binding_guard(uuid,uuid) returns text language sql stable as $$select repeat('d',64)$$;");
 await db.exec(readFileSync(new URL('../docs/drafts/cos-shop-address-evidence.sql',import.meta.url),'utf8'));
 await db.exec(draft);
 return db;
}
const params=(requestId=randomUUID(),overrides={})=>[actor,org,requestId,'ServiceItem_List_20261016131754.csv',overrides.sourceSha||digest,overrides.prevSha||previous,censusSha,JSON.stringify(overrides.census||census),source.toString('base64'),JSON.stringify(records)];
const stage=(db,args)=>db.query("select public.cos_owner_mhelp_equipment_stage_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::text,$8::jsonb,$9::text,$10::jsonb) result",args).then(r=>r.rows[0].result);
const commit=(db,id,note='I reviewed and approve the current COS Field and Shop inventory.',sha=censusSha)=>db.query("select public.cos_owner_mhelp_equipment_commit_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text) result",[actor,org,id,previous,sha,note]).then(r=>r.rows[0].result);
async function installActualReview(db){
 await db.exec("create table cos_mhelp_placement_private.upload_audit(id bigint generated always as identity,action text,source_sha256 text,previous_sha256 text,authorization_sha256 text)");
 await db.exec('drop function cos_mhelp_placement_private.review_upload(jsonb,jsonb,text,boolean)');
 const overlay=readFileSync(new URL('../db/mhelp_upload_overlay.sql',import.meta.url),'utf8');
 await db.exec(overlay.slice(overlay.indexOf('create function cos_mhelp_placement_private.review_upload('),overlay.indexOf('create function cos_mhelp_placement_private.rollback_upload(')));
}

export {setup,installActualReview,actor,org,previous,censusSha,source,digest,records,census,params,stage,commit};
