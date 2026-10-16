import {test,expect} from '@playwright/test';
import {existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(fileURLToPath(new URL('../../..',import.meta.url))),origin='http://127.0.0.1:4173';
function setup({wrongOwner,reassign=false,initialMove=false}){
 window.snapshotGeneration='1';window.snapshotWrites=[];window.snapshotReads=[];window.nativeRequests=[];window.denyPlacement=false;window.mapMismatch=false;window.reorder=false;window.closedAuthority=false;window.moveAfterSummary=initialMove?3:0;window.summaryCount=0;
 const unitId='11111111-1111-4111-8111-111111111111';
 const device={id:10,unit_key:'Sniper 1',device_name:'Sniper 1 / Camera',connection_revision:2,public_ip:'8.8.8.8',expected_ports:[443],monitoring_profile:'sniper',device_type:'Sniper',organization:'Synthetic site',activation_state:'active'};
 window.authority=()=>{const a={contract:'COS_AVIGILON_AUTHORITY_V1',tenantId:'fixture',generation:snapshotGeneration,rosterRevision:'r'+snapshotGeneration,admitted:!closedAuthority};return reorder?Object.fromEntries(Object.entries(a).reverse()):a;};
 window.nativeSnapshot=()=>{const moved=snapshotGeneration!=='1',unit=reassign&&moved?'Sniper 2':'Sniper 1',at=new Date().toISOString();return {evidenceVersion:2,identityVersion:1,avigilonAuthority:authority(),unitIdentities:[],ownerConfirmedIdentityVersion:1,ownerConfirmedUnitIdentities:[{kind:'owner_confirmed_native',unitId:wrongOwner?'22222222-2222-4222-8222-222222222222':unitId,unitNumber:unit,deviceIds:['10'],unitKeys:[unit],proof:'a'.repeat(64)}],identityWarnings:[],rows:[{id:10,unit,scope:'field',type:'Sniper',connection:{publicIp:'8.8.8.8',ports:[443]},avigilonPublication:moved?null:{receiptId:'73',unitId,rosterUnitId:'33333333-3333-4333-8333-333333333333',endpointRevision:'2'},serviceEvidence:{observedAt:moved?null:at,status:moved?'unknown':'offline',reachable:moved?null:false,confirmedOutage:!moved,consecutiveFailures:moved?0:3}}]};};
 window.nativeMap=()=>{const row={id:unitId,unitNumber:reassign&&snapshotGeneration!=='1'?'Sniper 2':'Sniper 1',readOnly:false,currentLocationType:'field',site:'Site '+snapshotGeneration,address:'1 Synthetic Road'};return {avigilonAuthority:mapMismatch?{...authority(),generation:'999'}:authority(),items:[row],inventoryItems:[row],summary:{fieldUnits:1},placementReviews:[],generatedAt:new Date().toISOString()};};
 const db={auth:{getSession:async()=>({data:{session:{access_token:'synthetic-only',user:{id:'fixture-owner'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},functions:{invoke:async()=>({data:{configured:false}})},rpc:async()=>({data:{},error:null}),from(table){const q={isSingle:false,select(){return q;},order(){return q;},range(){return q;},eq(){return q;},in(){return q;},ilike(){return q;},limit(){return q;},single(){q.isSingle=true;return q;},maybeSingle(){q.isSingle=true;return q;},then(resolve,reject){snapshotReads.push(table);if(table==='camera_health_current'&&reassign)snapshotGeneration='2';let data=table==='profiles'?{role:'owner',active:true}:table==='camera_devices'?structuredClone(device):table==='camera_health_current'?{camera_device_id:10,checked_at:new Date().toISOString(),overall_status:'offline',confirmed_outage:true,consecutive_failures:3,ip_reachable:false}:[];if(!q.isSingle&&!Array.isArray(data))data=[data];return Promise.resolve({data,error:null}).then(resolve,reject);},update(){snapshotWrites.push({table,method:'update'});throw Error('Unexpected write');},insert(){snapshotWrites.push({table,method:'insert'});throw Error('Unexpected write');}};return q;}};
 window.exposedOutages=[];new MutationObserver(()=>{if(document.querySelector('#statusPill')?.textContent==='OFFLINE'||document.querySelector('#fleetConnectedOffline')?.textContent==='1')exposedOutages.push(snapshotGeneration);}).observe(document,{subtree:true,childList:true,characterData:true});
 window.supabase={createClient:()=>db};
}
async function mount(page,name,{wrongOwner=false,reassign=false,initialMove=false}={}){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(setup,{wrongOwner,reassign,initialMove});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/functions/v1/cos-operations-pages'){
   const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
   const request=route.request().postDataJSON();expect(request.method).toBe('GET');expect(route.request().headers().authorization).toBe('Bearer synthetic-only');expect(['/api/session','/api/camera-health/summary-v3','/api/field-map']).toContain(request.path);
   const response=await page.evaluate(path=>{nativeRequests.push(path);if(path==='/api/session')return {json:{features:{freshAvigilonChecks:true}}};if(denyPlacement)return {deny:true};if(path==='/api/field-map')return {json:nativeMap()};const json=nativeSnapshot();summaryCount++;if(moveAfterSummary===summaryCount)snapshotGeneration='2';return {json};},request.path);
   if(response.deny)return route.fulfill({status:403,headers,json:{error:'Synthetic denied'}});return route.fulfill({headers,json:response.json});
  }
  if(url.origin!==origin)return route.abort('blockedbyclient');
  const file=resolve(repo,'.'+decodeURIComponent(url.pathname));if(file.startsWith(repo+'/')&&existsSync(file))return route.fulfill({path:file,contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp'}[extname(file)]||'application/octet-stream'});
  return route.abort('blockedbyclient');
 });
 await page.goto('/tech-checks/'+name+'.html?id=10');await expect.poll(()=>page.evaluate(()=>snapshotReads.includes('camera_devices'))).toBe(true);return errors;
}
async function settled(page,name){await expect.poll(()=>page.evaluate(n=>n==='camera-health'?cameraLoadPromise===null:detailLoadPromise===null,name)).toBe(true);}
async function receipt(page,name){return page.evaluate(n=>n==='camera-health'?health[10]?.native_publication_receipt:current?.native_publication_receipt,name);}
async function assertCleared(page,name){await expect.poll(()=>receipt(page,name)).toBeFalsy();if(name==='camera-health'){await expect(page.locator('#fleetConnectedOffline')).not.toHaveText('1');await expect(page.locator('#avigilonOffline')).not.toHaveText('1');}else await expect(page.locator('#statusPill')).not.toHaveText('OFFLINE');}
for(const name of ['camera-health','camera-detail']){
 test(name+' rejects reassignment between identity and health without current receipt',async({page})=>{
  const errors=await mount(page,name,{reassign:true});await settled(page,name);await assertCleared(page,name);expect(await page.evaluate(()=>snapshotWrites)).toEqual([]);expect(errors).toEqual([]);
 });
 test(name+' rejects conflicting current receipt ownership',async({page})=>{
  const errors=await mount(page,name,{wrongOwner:true});await settled(page,name);await assertCleared(page,name);expect(await page.evaluate(()=>snapshotWrites)).toEqual([]);expect(errors).toEqual([]);
 });
 test(name+' stable native receipt survives reordered authority without reload loop',async({page})=>{
  const errors=await mount(page,name);await expect.poll(()=>receipt(page,name)).toBe('73');await settled(page,name);
  const count=await page.evaluate(()=>snapshotReads.filter(x=>x==='camera_devices').length);
  await page.evaluate(async()=>{reorder=true;await refreshEffectivePlacement();});await settled(page,name);
  expect(await receipt(page,name)).toBe('73');expect(await page.evaluate(()=>snapshotReads.filter(x=>x==='camera_devices').length)).toBe(count);expect(errors).toEqual([]);
 });
 test(name+' delayed G2 Field move clears G1 receipt73 and outage',async({page})=>{
  const errors=await mount(page,name);await expect.poll(()=>receipt(page,name)).toBe('73');await settled(page,name);
  await page.evaluate(async()=>{snapshotGeneration='2';await refreshEffectivePlacement();});await settled(page,name);await assertCleared(page,name);
  if(name==='camera-health'){await expect(page.locator('#fleetConnectedOffline')).toHaveText('0');await expect(page.locator('#avigilonOffline')).toHaveText('0');}
  expect(await page.evaluate(()=>snapshotWrites)).toEqual([]);expect(errors).toEqual([]);
 });
 for(const mode of ['denyPlacement','mapMismatch','closedAuthority'])test(name+' '+mode+' invalidates current evidence across exhausted retries',async({page})=>{
  const errors=await mount(page,name);await expect.poll(()=>receipt(page,name)).toBe('73');await settled(page,name);
  if(name==='camera-health')await page.evaluate(()=>{selectedUnitKey='Sniper 1';document.querySelector('#unitDetailMain').textContent='OLD RECEIPT73 OFFLINE';document.querySelector('#unitDetailDialog').showModal();});
  await page.evaluate(async mode=>{window[mode]=true;await refreshEffectivePlacement();},mode);await settled(page,name);await assertCleared(page,name);
  if(name==='camera-health')await expect(page.locator('#unitDetailMain')).not.toContainText('OLD RECEIPT73');
  // Subsequent explicit reads must remain closed rather than exempting retries.
  for(let retry=0;retry<3;retry++){await page.evaluate(async()=>{await refreshEffectivePlacement();});await settled(page,name);await assertCleared(page,name);}
  const readsAfterRetries=await page.evaluate(()=>nativeRequests.length);
  await page.waitForTimeout(150);
  expect(await page.evaluate(()=>nativeRequests.length)).toBe(readsAfterRetries);
  expect(await page.evaluate(()=>snapshotWrites)).toEqual([]);expect(errors).toEqual([]);
 });
 test(name+' G1 health followed by G2 initial placement never publishes stale receipt',async({page})=>{
  // The first map/summary pair precedes the bridge's two summary reads.
  const errors=await mount(page,name,{initialMove:true});await settled(page,name);await assertCleared(page,name);expect(await page.evaluate(()=>snapshotGeneration)).toBe('2');expect(await page.evaluate(()=>exposedOutages)).toEqual([]);expect(errors).toEqual([]);
 });
}
test('obsolete activation, acknowledgment and ticket buttons are disabled before any guarded or ticket write',async({page})=>{
 await mount(page,'camera-health');await page.evaluate(()=>{for(const name of ['activate-unit','activate','ack-unit','ticket-unit']){const button=document.createElement('button');button.className=name;button.textContent='Obsolete control';document.body.append(button);}});
 for(const name of ['activate-unit','activate','ack-unit','ticket-unit']){const button=page.locator('button.'+name);await expect(button).toBeDisabled();await expect(button).toContainText(/unavailable/);await expect(button).toHaveAttribute('aria-describedby','guardedActionStatus');}
 await expect(page.locator('#guardedActionStatus')).toContainText('use Operations Job flow');expect(await page.evaluate(()=>snapshotWrites)).toEqual([]);
});
