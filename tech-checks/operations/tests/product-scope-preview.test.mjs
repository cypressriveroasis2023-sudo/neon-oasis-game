import test from 'node:test';import assert from 'node:assert/strict';
import {createScopePreview,readScopePreview} from '../src/productScopePreviewModel.ts';
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import FleetFieldHealthCounts from '../src/FleetFieldHealthCounts.tsx';
const hash='a'.repeat(64),id='123';
const group=()=>({productId:id,nativeUnitId:'11111111-1111-4111-8111-111111111111',family:'Spotter',verifiedAt:'2026-10-29T01:00:00Z',devices:[{id:'7',ip:'11.22.33.44',ports:[80,443],revision:'3',profile:'spotter'}],...Object.fromEntries(['authorityGuard','sourceSha256','trackerSha256','identityGuard','bindingGuard','epochGuard','crosswalkRevision'].map(k=>[k,hash]))});
const eligible=()=>({contract:'COS_PRODUCT_TCP_PREVIEW_V1',productIds:[id],groups:[group()],held:[]});
const held=()=>({contract:'COS_PRODUCT_TCP_PREVIEW_V1',productIds:[id],groups:[],held:[{productId:id,reason:'identity_or_lifecycle_hold'}]});
function fixture(){const states=[],calls=[];let session=true;const api={captureSession:()=>()=>session,post:(path,body,options)=>new Promise((resolve,reject)=>calls.push({path,body,options,resolve,reject}))};return {states,calls,changeSession:()=>{session=false;},action:createScopePreview(api,id,s=>states.push(s))};}
test('manual exact-row request is single-ID, cancellable, duplicate-click safe and read-only',async()=>{
 const f=fixture();assert.equal(f.calls.length,0);const p=f.action.load();void f.action.load();assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].path,'/api/product-tcp-preview');assert.deepEqual(f.calls[0].body,{productIds:[id]});assert.ok(f.calls[0].options.signal instanceof AbortSignal);
 f.calls[0].resolve({data:eligible()});await p;assert.equal(f.states.at(-1).result.kind,'eligible');assert.deepEqual(f.states.at(-1).result.group.devices[0].ports,[80,443]);assert.equal(f.calls.length,1);
});
test('held evidence remains held; malformed, foreign, mixed or missing scope never becomes eligible',()=>{
 assert.deepEqual(readScopePreview(held(),id),{kind:'held',reason:'identity_or_lifecycle_hold'});
 for(const mutate of [v=>v.contract='COS_PRODUCT_TCP_SOURCE_V2',v=>v.productIds=['999'],v=>v.groups[0].productId='999',v=>v.groups=[],v=>v.held=held().held,v=>v.groups.push(group()),v=>v.groups[0].devices[0].ports=[],v=>v.groups[0].devices[0].revision=-1,v=>v.groups[0].authorityGuard='bad',v=>v.groups[0].devices.push(v.groups[0].devices[0])]){const v=eligible();mutate(v);assert.throws(()=>readScopePreview(v,id));}
});
test('cancel and replacement suppress late responses even when transport ignores abort',async()=>{
 const f=fixture(),old=f.action.load();f.action.clear();assert.equal(f.calls[0].options.signal.aborted,true);const next=f.action.load();f.calls[1].resolve({data:held()});await next;f.calls[0].resolve({data:eligible()});await old;assert.equal(f.states.at(-1).result.kind,'held');
 f.action.clear();assert.deepEqual(f.states.at(-1),{status:'idle'});
});
test('session change, private invalidation and unmount cannot reveal late scope',async()=>{
 for(const mode of ['session','clear','dispose']){const f=fixture(),p=f.action.load();if(mode==='session')f.changeSession();else f.action[mode]();f.calls[0].resolve({data:eligible()});await p;assert.equal(f.states.some(s=>s.status==='ready'),false);if(mode!=='session')assert.equal(f.calls[0].options.signal.aborted,true);}
});
test('auth denial and unavailable backend fail closed with no retry or status result',async()=>{
 for(const status of [401,403,409,503]){const f=fixture(),p=f.action.load();f.calls[0].reject({response:{status}});await p;assert.equal(f.states.at(-1).status,'error');assert.equal(f.states.at(-1).result,undefined);assert.equal(f.calls.length,1);}
});
test('current field row has optional preview control without changing existing details',()=>{
 const value={total:1,sourceSha256:hash,receivedAt:'2026-10-29T01:00:00Z',counts:{unverified:1},items:[{productId:id,unitNumber:'Synthetic',state:'unverified',reason:'No reading',unitId:'unit',recordId:'record'}]};
 const render=enabled=>renderToStaticMarkup(React.createElement(FleetFieldHealthCounts,{value,onOpen:()=>{},previewSavedScope:enabled}));
 assert.doesNotMatch(render(false),/Preview saved connection scope/);const html=render(true);assert.match(html,/Preview saved connection scope/);assert.match(html,/Saved connection scope for Product 123/);assert.match(html,/Unit details and troubleshooting/);assert.doesNotMatch(html,/11\.22\.33\.44/);
});

test('display parser accepts the actual validated backend projection, including decimal-string revisions',async()=>{
 const {productSource}=await import('./fixtures/product-tcp-source.mjs');const {buildProductGroups}=await import('../../supabase/functions/_shared/exact-product-producer/fullSource.ts');
 const f=await productSource(),plan=await buildProductGroups(f.source,['101'],f.now,f.review),g=plan.groups[0];
 const response={contract:'COS_PRODUCT_TCP_PREVIEW_V1',productIds:['101'],held:[],groups:[{...g,devices:g.devices.map(d=>({id:d.id,ip:d.ip,ports:d.ports,revision:d.revision,profile:d.profile}))}]};
 const parsed=readScopePreview(response,'101');assert.equal(parsed.kind,'eligible');assert.equal(parsed.group.devices.length,4);assert.equal(typeof parsed.group.devices[0].revision,'string');assert.equal('serial' in parsed.group.devices[0],false);
});
