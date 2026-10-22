import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
import {createInventoryCache,projectInventoryCache} from '../../supabase/functions/cos-mhelp-inventory-sync/cache.ts';
const path='/customers/3?Fields=customerId,portalId,name,isServiceLocation,isActive,address1,city,state,zip,countryId',key='224643:'+path;
const parent={customerId:3,portalId:224643,name:'Synthetic customer',isServiceLocation:false,address1:'Original service street'};
test('only fixed projected portal/customer/service/category identities enter the cache',()=>{
 assert.equal(projectInventoryCache(path,{...parent,password:'synthetic-unrequested'}).password,undefined);
 for(const v of [{...parent,portalId:9},{...parent,customerId:4},{...parent,name:{token:'synthetic'}},{...parent,address1:'password: synthetic'}])assert.throws(()=>projectInventoryCache(path,v));
 for(const p of [path+'&Fields=portalId',path+'&url=https://attacker.invalid','/customers/3?Fields=password','https://attacker.invalid'+path])assert.throws(()=>projectInventoryCache(p,parent));
 const service='/customers/3/servicelocations?pageSize=200&rowIndex=0&Fields=serviceLocationId,customerId,portalId,name,isActive,address1,city,state,zip,countryId';const page={totalRows:1,results:[{...parent,serviceLocationId:4}]};assert.equal(projectInventoryCache(service,page).results[0].isServiceLocation,undefined);assert.throws(()=>projectInventoryCache(service,{...page,totalRows:2}));assert.throws(()=>projectInventoryCache(service,{...page,results:[{...parent,customerId:9,serviceLocationId:4}]}));
});
test('only the projected street field permits source-supported formatting whitespace',()=>{
 const service='/customers/3/servicelocations?pageSize=200&rowIndex=0&Fields=serviceLocationId,customerId,portalId,name,isActive,address1,city,state,zip,countryId';
 const address1='123 Main St\r\nSuite 2\tNorth';
 assert.equal(projectInventoryCache(path,{...parent,address1}).address1,address1);
 assert.equal(projectInventoryCache(service,{totalRows:1,results:[{...parent,serviceLocationId:4,address1}]}).results[0].address1,address1);
 for(const value of ['gate code: synthetic','access-code=synthetic','passwd: synthetic','credential=synthetic','token: synthetic','secret=synthetic'])for(const suffix of ['', '\r\nSuite 2'])assert.throws(()=>projectInventoryCache(path,{...parent,address1:value+suffix}));
 for(const code of [0,1,8,11,12,14,31,127])assert.throws(()=>projectInventoryCache(path,{...parent,address1:'Street'+String.fromCharCode(code)+'Suite'}));
 for(const name of ['name','city','state','zip'])assert.throws(()=>projectInventoryCache(path,{...parent,[name]:'Line 1\nLine 2'}));
 assert.throws(()=>projectInventoryCache(service,{totalRows:1,results:[{...parent,serviceLocationId:4,customerId:9,address1}]}));
});
test('cold workers reuse actual observations, refresh expired or newly assigned resources, and never claim an unconfirmed cache write',async()=>{
 let now=Date.parse('2026-10-20T00:00:00Z'),calls=0,street=parent.address1;const store=new Map();
 const cache=async(action,k,value,observedAt)=>{const entry=store.get(k);if(action==='read')return entry&&now-Date.parse(entry.observedAt)<3*3600000?{hit:true,...entry,observedAt:entry.observedAt.replace('Z','+00:00')}:{hit:false};store.set(k,{payload:value,observedAt});return {saved:true};};
 const make=()=>createInventoryCache({cache,now:()=>now,read:async()=>{calls++;return {...parent,address1:street};}});
 const a=make();await Promise.all([a.read(path),a.read(path)]);assert.equal(calls,1);const observed=a.observedAt(path);now+=15*60000;street='Changed service street';const b=make();assert.equal((await b.read(path)).address1,parent.address1);assert.equal(b.observedAt(path),observed);assert.equal(calls,1);
 assert.equal((await b.read(path,true)).address1,street);assert.equal(calls,2);now+=3*3600000;await make().read(path);assert.equal(calls,3);
 const uncertain=createInventoryCache({read:async()=>parent,cache:async a=>a==='read'?{hit:false}:{saved:false}});await assert.rejects(uncertain.read(path),/unconfirmed/);
 const unavailable=createInventoryCache({read:async()=>{throw Error('must not read vendor');},cache:async()=>{throw Error('authority unavailable');}});await assert.rejects(unavailable.read(path),/authority unavailable/);
});
test('actual cache SQL enforces server-side keys/portal/projection, older-write CAS, observation TTL and client denial',async()=>{
 const db=new PGlite();try{await db.exec("create schema cos_mhelp_placement_private;create schema auth;create role anon;create role authenticated;create role service_role;create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;set request.jwt.claim.role='service_role';");await db.exec(await readFile(new URL('../db/mhelp-inventory-cache.sql',import.meta.url),'utf8'));
 const call=async(action,k=key,payload=null,at=null)=>(await db.query('select public.cos_mhelp_inventory_cache($1,$2,$3::jsonb,$4::timestamptz) r',[action,k,payload===null?null:JSON.stringify(payload),at])).rows[0].r;
 const observed=new Date(Date.now()-1000).toISOString();assert.equal((await call('write',key,parent,observed)).saved,true);const first=await call('read');assert.equal(first.hit,true);assert.equal(Date.parse(first.observedAt),Date.parse(observed));
 assert.equal((await call('write',key,{...parent,address1:'Older response'},new Date(Date.now()-2000).toISOString())).saved,false);assert.equal((await call('read')).payload.address1,parent.address1);
 const multiline=projectInventoryCache(path,{...parent,address1:'123 Main St\r\nSuite 2\tNorth'}),multilineAt=new Date().toISOString();assert.equal((await call('write',key,multiline,multilineAt)).saved,true);const multilineRead=await call('read');assert.equal(multilineRead.payload.address1,multiline.address1);assert.equal(Date.parse(multilineRead.observedAt),Date.parse(multilineAt));
 for(const v of [{...parent,portalId:9},{...parent,customerId:4},{...parent,password:'synthetic'},{...parent,name:{token:'synthetic'}}])await assert.rejects(call('write',key,v,new Date().toISOString()));
 await assert.rejects(call('write',key,parent,'2020-01-01T00:00:00Z'));await assert.rejects(call('write',key+'&other=1',parent,new Date().toISOString()));
 await db.exec("update cos_mhelp_placement_private.inventory_resource_cache set observed_at=clock_timestamp()-interval '4 hours'");assert.equal((await call('read')).hit,false);
 for(const role of ['anon','authenticated']){await db.exec('set role '+role+";set request.jwt.claim.role='service_role'");await assert.rejects(call('read'),e=>e.code==='42501');await db.exec('reset role');}
 await db.exec("set role service_role;set request.jwt.claim.role='service_role'");await assert.rejects(db.query('select * from cos_mhelp_placement_private.inventory_resource_cache'),e=>e.code==='42501');
 }finally{await db.close();}
});
