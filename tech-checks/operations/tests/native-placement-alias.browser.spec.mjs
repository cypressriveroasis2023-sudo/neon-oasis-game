// Entire browser flow uses synthetic data and an injected legacy writer; no external writes.
import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {projectOwnerPlacement} from '../../supabase/functions/cos-operations-pages/placementProjection.ts';
import {fixture,audit,key,unitId,controlId,address} from './native-placement-alias-fixtures.mjs';
const js=fs.readFileSync(new URL('../../camera-placement-controls.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../../camera-placement-controls.css',import.meta.url),'utf8');
async function mount(page,{placement='FIELD',canMove=true}={}){
 const f=await fixture(),calls=[],reads=[],geocodes=[];
 const legacy={unitKey:key,placement:'FIELD',siteLabel:'Synthetic provider site',streetAddress:'',auditId:null,canMove};
 const state={f,legacy,calls,reads,geocodes,afterWrite:null,changeMap:null,changeHealth:null,hold:null};
 await page.exposeFunction('fixtureRpc',async(name,args)=>{
  calls.push({name,args});
  if(name==='owner_camera_unit_placement_state_v2')return {data:structuredClone(legacy)};
  if(name!=='owner_set_camera_unit_placement_v2')throw new Error('Unexpected synthetic RPC');
  if(state.hold)await state.hold;
  const a=audit({id:String(100+f.sources.audits.length),placement:args.p_placement,action:args.p_placement==='FIELD'?'MOVE_TO_FIELD':'MOVE_TO_ROOT',site_label:args.p_site_label,street_address:args.p_street_address,request_id:args.p_request_id});
  f.sources.audits.push(a);Object.assign(legacy,{placement:args.p_placement,siteLabel:args.p_site_label,streetAddress:args.p_street_address,auditId:a.id});
  await state.afterWrite?.();
  return {data:{ok:true,unit_key:key,placement:args.p_placement,request_id:args.p_request_id,audit_id:a.id}};
 });
 await page.route('https://**.supabase.co/**',async route=>{
  const r=route.request(),headers={'access-control-allow-origin':'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(r.method()==='OPTIONS')return route.fulfill({status:204,headers});
  const body=r.postDataJSON();
  if(r.url().endsWith('/camera-field-geocode')){geocodes.push(body);return route.fulfill({status:200,headers,body:'{}'});}
  reads.push(body.path);let data;
  if(body.path==='/api/field-map'){
   try{data=await projectOwnerPlacement(f.snapshot,f.sources.audits,f.sources.devices,await f.identity(),f.sources.units);state.changeMap?.(data);}
   catch(error){return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({error:error.message})});}
  }else if(body.path==='/api/camera-health/summary-v3'){
   data={evidenceVersion:2,rows:f.sources.devices.map(d=>({id:d.id,unit:d.unit_key,trackerOnly:false})),...await f.identity()};state.changeHealth?.(data);
  }else throw new Error('Unexpected synthetic read');
  return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.route('http://127.0.0.1:4173/**',route=>route.fulfill({contentType:'text/html',body:'<html><head></head><body></body></html>'}));await page.goto('http://127.0.0.1:4173/synthetic-alias-test');await page.addStyleTag({content:css});await page.addScriptTag({content:js});
 await page.evaluate(({key,placement})=>{window.saved=[];window.db={auth:{getSession:async()=>({data:{session:{access_token:'synthetic-only',user:{id:'synthetic-owner'}}}})},rpc:window.fixtureRpc};void CameraPlacementControls.open({db,key,placement,onSaved:r=>window.saved.push(r)});},{key,placement});
 return state;
}
const inputs=page=>({site:page.locator('[name=site]'),address:page.locator('[name=address]'),reason:page.locator('[name=reason]'),confirmed:page.locator('[name=confirmed]'),save:page.locator('[type=submit]'),cancel:page.locator('.placement-cancel')});
const moves=s=>s.calls.filter(c=>c.name==='owner_set_camera_unit_placement_v2');
async function ready(page){await expect(inputs(page).save).toBeEnabled();return inputs(page);}
async function confirm(page){const p=inputs(page);await p.reason.fill('Synthetic verified physical move');await p.confirmed.check();return p;}
async function changed(page){const p=await ready(page);await p.address.fill('300 Synthetic Fixture Rd, Testville, TX 77003');await confirm(page);return p;}
test('native alias first save, address update, Shop and redeployment verify one native row and never a shadow',async({page})=>{
 const s=await mount(page),p=await changed(page);await p.save.click();await expect(page.locator('dialog')).toHaveCount(0);expect(moves(s)).toHaveLength(1);expect(s.geocodes).toHaveLength(1);expect(s.reads.filter(p=>p==='/api/field-map')).toHaveLength(3);
 const check=async()=>{const map=await projectOwnerPlacement(s.f.snapshot,s.f.sources.audits,s.f.sources.devices,await s.f.identity(),s.f.sources.units);expect(map.inventoryItems.map(r=>r.id)).toEqual([unitId]);expect(map.inventoryItems.some(r=>r.id===controlId)).toBe(false);return map;};
 expect((await check()).items[0].placementAuditId).toBe('100');
 for(const placement of ['FIELD','SHOP','FIELD']){
  await page.evaluate(({key,placement})=>CameraPlacementControls.open({db,key,placement,onSaved:r=>window.saved.push(r)}),{key,placement});const form=await ready(page);
  if(placement==='FIELD'){await form.site.fill('Synthetic redeployment site');await form.address.fill('400 Synthetic Fixture Rd, Testville, TX 77004');}
  await confirm(page);await form.save.click();await expect(page.locator('dialog')).toHaveCount(0);const map=await check();expect(map.items.length).toBe(placement==='FIELD'?1:0);
 }
 expect(moves(s)).toHaveLength(4);expect(moves(s).map(c=>c.args.p_expected_audit_id)).toEqual([null,'100','101','102']);expect(s.geocodes).toHaveLength(3);
});
test('unchanged native alias address is a no-op preserving current pin',async({page})=>{
 const s=await mount(page);await ready(page);await confirm(page);await inputs(page).save.click();await expect(page.locator('.placement-feedback')).toContainText('unchanged');expect(moves(s)).toEqual([]);expect(s.geocodes).toEqual([]);expect(s.f.snapshot.items[0].latitude).toBe(30);expect(s.f.snapshot.items[0].address).toBe(address);
});
for(const change of ['proof','revoked proof','capability','device','serial','version','audit','warning'])test(change+' changing after open blocks save before the existing writer',async({page})=>{
 const s=await mount(page),p=await changed(page);
 if(change==='revoked proof')s.f.review.native={};
 if(change==='proof')s.changeHealth=data=>data.unitIdentities[0].proof='b'.repeat(64);
 if(change==='capability')s.changeMap=data=>data.nativePlacementAliases[0].writerContract='unsupported';
 if(change==='device')s.f.sources.devices[0].id=9102;
 if(change==='serial')s.f.sources.devices[0].device_serial='different-synthetic';
 if(change==='version')s.changeMap=data=>data.placementProjectionVersion=1;
 if(change==='audit')s.legacy.auditId='99';
 if(change==='warning')s.changeHealth=data=>data.identityWarnings.push({unitId,reason:'Synthetic changed proof',deviceIds:['9101'],unitKeys:[key]});
 await p.save.click();await expect(page.locator('.placement-feedback')).toContainText(/No move was saved|review|changed|capability/i);expect(moves(s)).toEqual([]);expect(s.geocodes).toEqual([]);await expect(p.save).toBeDisabled();
});
for(const problem of ['stale map','changed identity','shadow','readback mismatch'])test(problem+' after write is uncertain and never replays or geocodes',async({page})=>{
 const s=await mount(page),p=await changed(page);
 s.afterWrite=()=>{
  if(problem==='stale map')s.changeMap=data=>{delete data.inventoryItems[0].placementAuditId;delete data.items[0].placementAuditId;};
  if(problem==='changed identity')s.f.sources.devices[0].device_serial='changed-after-write';
  if(problem==='shadow')s.changeMap=data=>{const shadow={...data.inventoryItems[0],id:controlId,unitNumber:key,readOnly:true,recordSource:'Owner camera placement'};data.items.push(shadow);data.inventoryItems.push(shadow);data.summary.fieldUnits++;};
  if(problem==='readback mismatch')s.legacy.streetAddress='Different synthetic address';
 };
 await p.save.click();await expect(page.locator('.placement-feedback')).toContainText('could not be confirmed');await expect(p.save).toBeDisabled();expect(moves(s)).toHaveLength(1);expect(s.geocodes).toEqual([]);
 await page.evaluate(()=>document.querySelector('form').dispatchEvent(new Event('submit',{cancelable:true})));expect(moves(s)).toHaveLength(1);await p.cancel.click();await expect(page.locator('dialog')).toHaveCount(0);
});
test('pending alias write stays locked across repeated clicks, Escape and Back events',async({page})=>{
 const s=await mount(page),p=await changed(page);let release;s.hold=new Promise(resolve=>release=resolve);await p.save.click();await expect.poll(()=>moves(s).length).toBe(1);
 await expect(p.cancel).toBeDisabled();await page.keyboard.press('Escape');await page.evaluate(()=>{document.querySelector('form').dispatchEvent(new Event('submit',{cancelable:true}));window.dispatchEvent(new PopStateEvent('popstate'));});expect(moves(s)).toHaveLength(1);await expect(page.locator('dialog')).toBeVisible();release();await expect(page.locator('dialog')).toHaveCount(0);expect(moves(s)).toHaveLength(1);
});
test('revoked canMove blocks alias editing and mutation',async({page})=>{
 const s=await mount(page,{canMove:false});await expect(page.locator('.placement-feedback')).toContainText('could not be verified');await expect(inputs(page).save).toBeDisabled();expect(moves(s)).toEqual([]);
});
for(const placement of ['FIELD','SHOP'])for(const failure of ['all resources gone','native source gone','native and resources gone','proof revoked'])test(placement+' readback with '+failure+' remains uncertain without shadow, stale pin or replay',async({page})=>{
 const s=await mount(page,{placement}),p=placement==='FIELD'?await changed(page):await ready(page);if(placement==='SHOP')await confirm(page);
 s.afterWrite=()=>{if(failure.includes('resources'))s.f.sources.devices=[];if(failure.startsWith('native'))s.f.sources.units=[];if(failure==='proof revoked')s.f.review.native={};};
 await p.save.click();await expect(page.locator('.placement-feedback')).toContainText('could not be confirmed');expect(moves(s)).toHaveLength(1);expect(s.geocodes).toEqual([]);await expect(p.save).toBeDisabled();expect(await page.evaluate(()=>saved)).toEqual([]);
 if(!failure.startsWith('native')){const map=await projectOwnerPlacement(s.f.snapshot,s.f.sources.audits,s.f.sources.devices,await s.f.identity(),s.f.sources.units);expect(map.items).toEqual([]);expect(map.inventoryItems.map(r=>r.id)).toEqual([unitId]);expect(map.inventoryItems[0]).toMatchObject({placement:'UNKNOWN',latitude:null,longitude:null,locationVerifiedAt:null,locationHistoryId:null,historicalLatitude:30,historicalLongitude:-95});}
 await page.evaluate(()=>document.querySelector('form').dispatchEvent(new Event('submit',{cancelable:true})));expect(moves(s)).toHaveLength(1);await p.cancel.click();
});
