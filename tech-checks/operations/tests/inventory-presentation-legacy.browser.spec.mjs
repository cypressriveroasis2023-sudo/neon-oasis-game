import {test,expect} from '@playwright/test';
import {existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(fileURLToPath(new URL('../../..',import.meta.url))),origin='http://127.0.0.1:4173',at='2026-10-16T12:00:00Z';
function setup(){
 const at='2026-10-16T12:00:00Z';Date.now=()=>Date.parse(at);window.presentationWrites=[];
 const tags=['182','252','253','254','263','285','298','310'];
 window.presentationDevices=[...tags.map((tag,index)=>({id:index+1,unit_key:'SOLARSPOTTER '+tag,device_name:'SS'+tag+'_2',source_status:'online',monitoring_profile:'solar_spotter'})),...['046','052','088'].map(tag=>({id:100+Number(tag),unit_key:'SPOTTER '+tag,device_name:'Original Witness '+tag,source_status:'offline',monitoring_profile:'spotter'}))].map(row=>({...row,device_type:'IPC',source:'vigilant_control_center',organization:'Sunfield',activation_state:'active',source_last_seen_at:at,connection_revision:2,public_ip:'192.0.2.10',expected_ports:[443]}));
 window.presentationTracker=[...tags,...['046','052','088']].map(tag=>({canonical_family:'Spotter',unit_tag:tag,source_label:tag==='263'?'Spotter 263HDC4S (SOLAR COMPATIBLE) ':'Spotter '+tag,tracker_state:'field_or_unknown',health_provider:['046','052','088'].includes(tag)?'witness':'vigilant'}));
 const health=presentationDevices.filter(d=>d.id>100).map(d=>({camera_device_id:d.id,checked_at:at,overall_status:'online',ip_reachable:true,port_status:{443:{online:true},_connection:{revision:2,ip:d.public_ip,checkedAt:at,status:'online',reachable:true}}}));
 const db={auth:{getSession:async()=>({data:{session:{access_token:'synthetic-only',user:{id:'fixture-owner'}}}})},rpc:async()=>({data:{},error:null}),functions:{invoke:async()=>({data:{configured:true},error:null})},from(table){const q={filters:[],isSingle:false,select(){return q;},order(){return q;},range(){return q;},eq(k,v){q.filters.push([k,v]);return q;},in(){return q;},ilike(){return q;},limit(){return q;},single(){q.isSingle=true;return q;},maybeSingle(){q.isSingle=true;return q;},then(resolve,reject){let data=table==='profiles'?{role:'owner',active:true}:table==='camera_devices'?presentationDevices.filter(d=>q.filters.every(([k,v])=>d[k]===v)):table==='camera_health_current'?health.filter(h=>q.filters.every(([k,v])=>h[k]===v)):table==='equipment_master'?presentationTracker:[];if(q.isSingle&&Array.isArray(data))data=data[0]||null;return Promise.resolve({data:structuredClone(data),error:null}).then(resolve,reject);},update(){presentationWrites.push(table);throw Error('Unexpected update');},insert(){presentationWrites.push(table);throw Error('Unexpected insert');}};return q;}};window.supabase={createClient:()=>db};
}
async function mount(page,path){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(setup);
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/functions/v1/cos-operations-pages'){
   const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
   const body=route.request().postDataJSON();expect(body.method).toBe('GET');const json=body.path==='/api/session'?{features:{freshAvigilonChecks:false,avigilonSourceWrites:false}}:body.path==='/api/field-map'?{items:[],inventoryItems:[],summary:{fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0},generatedAt:at}:{evidenceVersion:2,identityVersion:1,unitIdentities:[],identityWarnings:[],rows:[],refreshedAt:at};return route.fulfill({headers,json});
  }
  if(url.origin!==origin)return route.abort('blockedbyclient');const file=resolve(repo,'.'+decodeURIComponent(url.pathname));if(file.startsWith(repo+'/')&&existsSync(file))return route.fulfill({path:file,contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp'}[extname(file)]||'application/octet-stream'});return route.abort('blockedbyclient');
 });await page.goto('/tech-checks/'+path);return errors;
}
test('saved board shows eight single Spotter inventories and Witness not checked while retaining provider labels and service diagnostics',async({page})=>{
 const errors=await mount(page,'camera-health.html');await expect(page.locator('.compact-unit')).toHaveCount(11);await expect(page.locator('#allOffline')).toHaveText('0');
 for(const tag of ['182','252','253','254','263','285','298','310']){const card=page.locator('.compact-unit[data-unit="SOLARSPOTTER '+tag+'"]');await expect(card.locator('.compact-unit-title')).toHaveText(tag==='263'?'Spotter 263HDC4S (SOLAR COMPATIBLE)':'Spotter '+tag);await expect(card).toContainText('Source group: SOLARSPOTTER '+tag);}
 for(const tag of ['046','052','088']){const card=page.locator('.compact-unit[data-unit="SPOTTER '+tag+'"]');await expect(card.locator('.statuspill')).toHaveText('STATUS NOT CHECKED');await expect(card).toContainText('Witness status not checked');}
 await page.getByRole('button',{name:'Open SPOTTER 046 unit details'}).click();await expect(page.locator('#unitDetailSubtitle')).toContainText('Witness status not checked');await expect(page.locator('#unitDetailMain')).toContainText('Direct service-port evidence: Reachable');await expect(page.locator('#unitDetailMain')).toContainText('Original Witness 046');
 expect(await page.evaluate(()=>presentationDevices.find(d=>d.id===5).unit_key)).toBe('SOLARSPOTTER 263');expect(await page.evaluate(()=>presentationWrites)).toEqual([]);expect(errors).toEqual([]);
});
test('saved Witness resource detail keeps provider status not checked and disables unsupported verification',async({page})=>{
 const errors=await mount(page,'camera-detail.html?id=146');await expect(page.locator('#content')).toBeVisible();await expect(page.locator('#statusPill')).toHaveText('STATUS NOT CHECKED');await expect(page.locator('#sourceStatus')).toHaveText('Witness status not checked');await expect(page.locator('#sourceDetail')).toContainText('Direct service-port diagnostic: Service reachable');await expect(page.locator('#verifyBtn')).toBeDisabled();await expect(page.locator('#verifyBtn')).toHaveText('Witness check unavailable');await expect(page.locator('#cameraName')).toHaveText('Original Witness 046');await expect(page.locator('#vigilantStatus')).toHaveText('UNKNOWN');expect(await page.evaluate(()=>presentationWrites)).toEqual([]);expect(errors).toEqual([]);
});
