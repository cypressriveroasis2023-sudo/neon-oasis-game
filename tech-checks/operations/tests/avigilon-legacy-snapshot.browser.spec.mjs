import {test,expect} from '@playwright/test';
import {existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(fileURLToPath(new URL('../../..',import.meta.url))),origin='http://127.0.0.1:4173';
function setup({wrongOwner}){
 window.snapshotGeneration='1';window.snapshotWrites=[];window.snapshotReads=[];
 const at='2026-10-16T12:00:00Z',device={id:10,unit_key:'Sniper 1',device_name:'Sniper 1 / Camera',connection_revision:2,public_ip:'8.8.8.8',expected_ports:[443],monitoring_profile:'sniper',device_type:'Sniper',organization:'Synthetic site',activation_state:'active'};
 window.nativeSnapshot=()=>{const unit=snapshotGeneration==='1'?'Sniper 1':'Sniper 2',owner=snapshotGeneration==='1'?'native-old':'native-new';return {evidenceVersion:2,avigilonAuthority:{contract:'COS_AVIGILON_AUTHORITY_V1',tenantId:'fixture',generation:snapshotGeneration,rosterRevision:'r'+snapshotGeneration,admitted:true},unitIdentities:[{unitId:wrongOwner?'wrong-owner':owner,deviceIds:['10'],unitKeys:[unit]}],rows:[{id:10,unit,scope:'field',type:'Sniper',connection:{publicIp:'8.8.8.8',ports:[443]},avigilonPublication:{receiptId:'73',unitId:owner,rosterUnitId:'roster-'+owner,endpointRevision:'2'},serviceEvidence:{observedAt:at,status:'online',reachable:true,confirmedOutage:false,consecutiveFailures:0}}]};};
 const db={auth:{getSession:async()=>({data:{session:{access_token:'synthetic-only',user:{id:'fixture-owner'}}}})},rpc:async()=>({data:{},error:null}),from(table){const q={isSingle:false,select(){return q;},order(){return q;},range(){return q;},eq(){return q;},in(){return q;},ilike(){return q;},limit(){return q;},single(){q.isSingle=true;return q;},maybeSingle(){q.isSingle=true;return q;},then(resolve,reject){snapshotReads.push(table);if(table==='camera_health_current'&&!wrongOwner)snapshotGeneration='2';let data=table==='profiles'?{role:'owner',active:true}:table==='camera_devices'?structuredClone(device):table==='camera_health_current'?{camera_device_id:10,checked_at:at,overall_status:'online',ip_reachable:true}:[];if(!q.isSingle&&!Array.isArray(data))data=[data];return Promise.resolve({data,error:null}).then(resolve,reject);},update(){snapshotWrites.push({table,method:'update'});throw Error('Unexpected write');},insert(){snapshotWrites.push({table,method:'insert'});throw Error('Unexpected write');}};return q;}};
 window.supabase={createClient:()=>db};
}
async function mount(page,name,{wrongOwner=false}={}){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(setup,{wrongOwner});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/functions/v1/cos-operations-pages'){
   const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
   const request=route.request().postDataJSON();expect(request.method).toBe('GET');expect(route.request().headers().authorization).toBe('Bearer synthetic-only');expect(['/api/session','/api/camera-health/summary-v3']).toContain(request.path);
   const json=request.path==='/api/session'?{features:{freshAvigilonChecks:true}}:await page.evaluate(()=>nativeSnapshot());return route.fulfill({headers,json});
  }
  if(url.origin!==origin)return route.abort('blockedbyclient');
  const file=resolve(repo,'.'+decodeURIComponent(url.pathname));if(file.startsWith(repo+'/')&&existsSync(file))return route.fulfill({path:file,contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp'}[extname(file)]||'application/octet-stream'});
  return route.abort('blockedbyclient');
 });
 await page.goto('/tech-checks/'+name+'.html?id=10');return errors;
}
for(const name of ['camera-health','camera-detail']){
 test(name+' fails closed when reassignment lands between identity and health reads',async({page})=>{
  const errors=await mount(page,name);await expect(page.locator(name==='camera-health'?'#empty':'#error')).toContainText('authority changed during read');
  expect(await page.evaluate(()=>snapshotReads.filter(table=>['camera_devices','camera_health_current'].includes(table)))).toEqual(['camera_devices','camera_health_current']);
  if(name==='camera-health'){expect(await page.evaluate(()=>devices)).toEqual([]);await expect(page.locator('.compact-unit')).toHaveCount(0);}else{expect(await page.evaluate(()=>device)).toBe(null);await expect(page.locator('#content')).not.toBeVisible();}
  expect(await page.evaluate(()=>snapshotWrites)).toEqual([]);expect(errors).toEqual([]);
 });
 test(name+' rejects a current-generation receipt with conflicting unit ownership',async({page})=>{
  const errors=await mount(page,name,{wrongOwner:true});await expect(page.locator(name==='camera-health'?'#empty':'#error')).toContainText('receipt ownership does not match');expect(await page.evaluate(()=>snapshotWrites)).toEqual([]);expect(errors).toEqual([]);
 });
}
test('obsolete activation, acknowledgment and ticket buttons are disabled before any guarded or ticket write',async({page})=>{
 await mount(page,'camera-health');await page.evaluate(()=>{for(const name of ['activate-unit','activate','ack-unit','ticket-unit']){const button=document.createElement('button');button.className=name;button.textContent='Obsolete control';document.body.append(button);}});
 for(const name of ['activate-unit','activate','ack-unit','ticket-unit']){const button=page.locator('button.'+name);await expect(button).toBeDisabled();await expect(button).toContainText(/unavailable/);await expect(button).toHaveAttribute('aria-describedby','guardedActionStatus');}
 await expect(page.locator('#guardedActionStatus')).toContainText('use Operations Job flow');expect(await page.evaluate(()=>snapshotWrites)).toEqual([]);
});
