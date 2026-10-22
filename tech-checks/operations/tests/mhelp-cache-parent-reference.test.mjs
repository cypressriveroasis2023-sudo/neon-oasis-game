import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {projectInventoryCache,createInventoryCache} from '../../supabase/functions/cos-mhelp-inventory-sync/cache.ts';
import {readInventorySource} from '../../supabase/functions/cos-mhelp-inventory-sync/source.ts';
const path='/customers/3/servicelocations?pageSize=200&rowIndex=0&Fields=serviceLocationId,customerId,portalId,name,isActive,address1,city,state,zip,countryId';
const key='224643:'+path;
const parentEntry={serviceLocationId:3,customerId:99,portalId:224643,name:'Unrelated parent label',address1:'999 Unrelated Street'};
const child={serviceLocationId:4,customerId:3,portalId:224643,name:'Actual site',address1:'123 Main St',city:'Houston',state:'TX',zip:'77002'};
const page={totalRows:28,results:[parentEntry,...Array.from({length:27},(_,i)=>({...child,serviceLocationId:4+i}))]};
test('parent references retain only original identity/portal and cannot bless another mismatched child',()=>{
 const projected=projectInventoryCache(path,page);
 assert.equal(projected.totalRows,28);assert.equal(projected.results.length,28);
 assert.deepEqual(projected.results[0],{serviceLocationId:3,portalId:224643});assert.deepEqual(projected.results[1],child);
 assert(!JSON.stringify(projected).includes('Unrelated'));assert.deepEqual(projectInventoryCache(path,projected),projected);
 assert.deepEqual(projectInventoryCache(path,{totalRows:1,results:[{...parentEntry,customerId:3}]}).results,[{serviceLocationId:3,portalId:224643}]);
 for(const results of [[parentEntry,{...child,customerId:9}],[parentEntry,parentEntry],[child,child],[{...parentEntry,portalId:9},child]])assert.throws(()=>projectInventoryCache(path,{totalRows:results.length,results}));
 assert.throws(()=>projectInventoryCache(path,{...page,totalRows:29}));
});
test('complete cached source uses the verified parent only for self assignment and real child membership for child assignment',async()=>{
 let now=Date.parse('2026-10-22T00:00:00Z'),vendorReads=0,secondPasses=0;
 const equipment=site=>({equipmentId:String(site),portalId:'224643',name:'Ranger '+site,model:null,active:true,equipmentTypeId:'2',customerId:'3',serviceLocationId:String(site)});
 const review={liveAccessVerified:true,verifiedPortalId:'224643',partial:false,totalRows:2,items:[equipment(4),equipment(3)]};
 const baseline={sourceSha256:'a'.repeat(64),companyCustomerIds:['11'],records:review.items.map(e=>({productId:e.equipmentId,unitNumber:e.name,customerId:'3',category:'Ranger'}))};
 const parent={customerId:3,portalId:224643,name:'Verified parent',isServiceLocation:false,address1:'456 Verified Parent St',city:'Houston',state:'TX',zip:'77002'};
 const saved=new Map();
 const vendor=async resource=>{vendorReads++;return resource.startsWith('/equipmentTypes')?{totalRows:1,results:[{equipmentTypeId:2,portalId:224643,category:'Ranger'}]}:resource.includes('/servicelocations')?page:parent;};
 const cache=async(action,k,payload,observedAt)=>{if(action==='read'){const row=saved.get(k);return row?{hit:true,...row}:{hit:false};}saved.set(k,{payload,observedAt});return {saved:true};};
 const run=async(verify=review)=>{const resources=createInventoryCache({read:vendor,cache,now:()=>now});return readInventorySource({review,baseline,read:resources.read,observedAt:resources.observedAt,verifyEquipment:async()=>{secondPasses++;return verify;},now:()=>new Date(now).toISOString()});};
 const first=await run();assert.equal(vendorReads,3);assert.equal(secondPasses,1);assert.equal(first.records[0].sourceAddress.street,child.address1);assert.equal(first.records[1].sourceAddress.street,parent.address1);assert(first.records.every(r=>r.apiAssignment.placementProof.version===1&&r.apiAssignment.placementProof.serviceVerified));assert(!JSON.stringify(first).includes('Unrelated'));
 now+=15*60*1000;const second=await run();assert.equal(vendorReads,3);assert.equal(secondPasses,2);assert.equal(second.records[0].sourceDates.apiAddressObservedAt,first.records[0].sourceDates.apiAddressObservedAt);assert.notEqual(second.readAt,first.readAt);assert.equal(saved.get(key).payload.results.length,28);assert.deepEqual(saved.get(key).payload.results[0],{serviceLocationId:3,portalId:224643});
 await assert.rejects(run({...review,items:[{...review.items[0],serviceLocationId:'5'},review.items[1]]}),/Equipment changed during source read/);
});
test('guarded SQL migration preserves ACLs and admits only the exact identity-only parent reference',async()=>{
 const db=new PGlite();try{
  await db.exec("create schema cos_mhelp_placement_private;create schema auth;create role anon;create role authenticated;create role service_role;create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;set request.jwt.claim.role='service_role';");
  const migration=await readFile(new URL('../db/mhelp-cache-parent-reference.sql',import.meta.url),'utf8');
  const old=migration.match(/\$old\$([\s\S]*?)\$old\$/)[1],next=migration.match(/\$new\$([\s\S]*?)\$new\$/)[1];
  const fresh=await readFile(new URL('../db/mhelp-inventory-cache.sql',import.meta.url),'utf8');assert(fresh.includes(next));await db.exec(fresh.replace(next,old));
  const definition=async()=>(await db.query("select pg_get_functiondef('public.cos_mhelp_inventory_cache(text,text,jsonb,timestamptz)'::regprocedure) d")).rows[0].d;
  const acl=async()=>(await db.query("select proacl::text,prosecdef,proconfig from pg_proc where oid='public.cos_mhelp_inventory_cache(text,text,jsonb,timestamptz)'::regprocedure")).rows[0];
  const before=await definition(),beforeAcl=await acl();assert.equal(createHash('md5').update(before).digest('hex'),'9147de2d58b413a3c4fc490640a12604');
  const call=async(action,payload=null,at=null)=>(await db.query('select public.cos_mhelp_inventory_cache($1,$2,$3::jsonb,$4::timestamptz) r',[action,key,payload===null?null:JSON.stringify(payload),at])).rows[0].r;
  const projected=projectInventoryCache(path,page);await assert.rejects(call('write',projected,new Date().toISOString()));
  await db.exec(migration);assert.equal(await definition(),before.replace(old,next));assert.deepEqual(await acl(),beforeAcl);
  const observed=new Date().toISOString();assert.equal((await call('write',projected,observed)).saved,true);const stored=await call('read');assert.deepEqual(stored.payload,projected);assert.equal(Date.parse(stored.observedAt),Date.parse(observed));
  assert.equal((await call('write',projected,new Date(Date.now()-2000).toISOString())).saved,false);
  for(const row of [parentEntry,{...parentEntry,customerId:3},{serviceLocationId:3,portalId:9},{...child,customerId:9}])await assert.rejects(call('write',{totalRows:1,results:[row]},new Date().toISOString()));
  assert.deepEqual((await call('read')).payload,projected);await assert.rejects(db.exec(migration),/Unexpected inventory cache definition/);
  await db.exec("update cos_mhelp_placement_private.inventory_resource_cache set observed_at=clock_timestamp()-interval '4 hours'");assert.equal((await call('read')).hit,false);
  for(const role of ['anon','authenticated']){await db.exec('set role '+role+";set request.jwt.claim.role='service_role'");await assert.rejects(call('read'),e=>e.code==='42501');await db.exec('reset role');}
  await db.exec("set role service_role;set request.jwt.claim.role='service_role'");await assert.rejects(db.query('select * from cos_mhelp_placement_private.inventory_resource_cache'),e=>e.code==='42501');
 }finally{await db.close();}
});
