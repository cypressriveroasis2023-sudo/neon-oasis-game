import {test,expect} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const origin='http://127.0.0.1:4173';
const html=readFileSync(resolve(repo,'tech-checks/camera-health.html'),'utf8');
const fixtures=[
{id:11,unit_key:'RANGER 022',device_name:'RANGER 022 / Camera 1',device_type:'camera',monitoring_profile:'ranger',organization:'Synthetic east site',source_status:'offline',source:'vigilant_control_center',source_last_seen_at:'2026-10-06T12:29:00Z',last_online_at:'2026-10-06T10:00:00Z',activation_state:'active'},
{id:12,unit_key:'RANGER 023',device_name:'RANGER 023 / Camera 1',device_type:'camera',monitoring_profile:'ranger',organization:'Synthetic west site',source_status:'online',source:'vigilant_control_center',source_last_seen_at:'2026-10-06T12:29:00Z',last_online_at:'2026-10-06T12:29:00Z',activation_state:'active'},
{id:13,unit_key:'RII-028',device_name:'RII-028 / Detector 1',device_type:'detector',monitoring_profile:'reconeyez',source:'reconeyez',external_device_id:'DETECTOR-TEST',organization:'Synthetic Recon site',source_status:'online',source_last_seen_at:'2026-10-06T12:29:00Z',last_online_at:'2026-10-06T12:29:00Z',activation_state:'active',source_metadata:{area:'Synthetic Recon site',battery_percent:7}}
];
const mock=`window.reads=[];window.originalSetInterval=window.setInterval;window.setInterval=(fn,ms)=>{if(ms===60000)window.freshnessCheck=fn;return window.originalSetInterval(fn,ms)};Date.now=()=>Date.parse('2026-10-06T12:30:00Z');window.fixtureDevices=${JSON.stringify(fixtures)};window.componentEvents=[{id:50,external_device_id:'BRIDGE-TEST',component_guid:'BRIDGE-TEST',component_type:'bridge_4g',component_name:'Bridge test',component_area:'Synthetic Recon site',observed_at:'2026-10-06T12:29:00Z',event_type:'YC',battery_percent:6},{id:51,external_device_id:'SIREN-TEST',component_guid:'SIREN-TEST',component_type:'siren_v1',component_name:'Siren test',component_area:'Synthetic Recon site',observed_at:'2026-10-06T12:29:00Z',event_type:'RP',battery_percent:75}];
window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'test-owner'}}}})},functions:{invoke:async(name)=>{if(window.holdChecks&&name==='camera-provider-reconcile')await new Promise(resolve=>window.releaseCheck=resolve);return {data:{configured:true}}}},from(table){const q={filters:[],select(){return q},order(){return q},range(){return q},limit(){return q},eq(k,v){q.filters.push([k,v]);return q},in(k,v){q.filters.push([k,v]);return q},single(){return q},then(resolve){window.reads.push({table,filters:q.filters});let data=table==='profiles'?{active:true,role:'owner'}:table==='camera_devices'?window.fixtureDevices:table==='equipment_master'?(window.fixtureTracker||[]):table==='camera_health_current'?(window.fixtureHealth||[]):table==='camera_integrations'?(window.fixtureIntegrations||[]):table==='camera_integration_events'?window.componentEvents.filter(x=>q.filters.every(([k,v])=>k==='provider'?true:k==='payload->device_info->>area'?x.component_area===v:x[k]===v)):table==='camera_health_history'?[{id:1,camera_device_id:11,observed_at:'2026-10-06T10:00:00Z',status:'online',check_source:'Historical east observation'},{id:2,camera_device_id:12,observed_at:'2026-10-06T12:29:00Z',status:'online',check_source:'Other unit only'}].filter(x=>q.filters.every(([k,v])=>Array.isArray(v)?v.includes(x[k]):x[k]===v)):[];return Promise.resolve(window.failHistory&&table==='camera_health_history'?{error:{message:'Synthetic history failure'}}:{data}).then(resolve)}};return q}})};`;
async function mount(page){
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin)return route.abort('blockedbyclient');if(url.pathname==='/tech-checks/camera-health.html')return route.fulfill({contentType:'text/html',body:html.replace('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>','<script>'+mock+'</script>')});const path=resolve(repo,'.'+decodeURIComponent(url.pathname));if(path.startsWith(repo+'/')&&existsSync(path))return route.fulfill({path,contentType:{'.js':'text/javascript','.css':'text/css','.woff':'font/woff','.png':'image/png','.jpg':'image/jpeg'}[extname(path)]||'application/octet-stream'});return route.abort('blockedbyclient')});
 await page.goto('/tech-checks/camera-health.html');await expect(page.locator('.compact-unit')).toHaveCount(3);
}
test('automatic reloads wait fifteen minutes, skip hidden tabs and share in-flight inventory loads',async({page})=>{
 await mount(page);const initial=await page.evaluate(()=>reads.filter(x=>x.table==='camera_devices').length);
 await page.evaluate(async()=>{Date.now=()=>Date.parse('2026-10-06T12:44:59Z');await liveRefresh(true)});
 expect(await page.evaluate(()=>reads.filter(x=>x.table==='camera_devices').length)).toBe(initial);
 await page.evaluate(async()=>{Date.now=()=>Date.parse('2026-10-06T12:45:00Z');Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});await liveRefresh(true)});
 expect(await page.evaluate(()=>reads.filter(x=>x.table==='camera_devices').length)).toBe(initial);
 await page.evaluate(async()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});await liveRefresh(true)});
 expect(await page.evaluate(()=>reads.filter(x=>x.table==='camera_devices').length)).toBe(initial+1);
 await page.evaluate(async()=>{document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('online'));await liveRefresh(true)});
 expect(await page.evaluate(()=>reads.filter(x=>x.table==='camera_devices').length)).toBe(initial+1);
 const same=await page.evaluate(()=>{const one=load();const two=load();window.reloadPair=Promise.all([one,two]);return one===two});expect(same).toBe(true);await page.evaluate(()=>window.reloadPair);
 expect(await page.evaluate(()=>reads.filter(x=>x.table==='camera_devices').length)).toBe(initial+2);
 await page.evaluate(async()=>{const before=load();const after=loadAfterWrite();await Promise.all([before,after])});
 expect(await page.evaluate(()=>reads.filter(x=>x.table==='camera_devices').length)).toBe(initial+4);
});
test('overview is quiet; unit cards open scoped history and preserve Back and keyboard navigation',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await mount(page);
 await expect(page.locator('.health-kpis>.stat')).toHaveCount(4);await expect(page.locator('#diag')).not.toBeVisible();await expect(page.locator('#statAllOnline')).toContainText('SYSTEMS ONLINE');
 for(const id of ['eventsArea','issuesArea','troubleArea','unitDetailDialog'])await expect(page.locator('#'+id)).not.toBeVisible();
 expect(await page.evaluate(()=>reads.filter(x=>x.table==='camera_health_history').length)).toBe(0);
 const east=page.getByRole('button',{name:'Open RANGER 022 unit details'});await east.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('dialog')).toBeVisible();await expect(page.locator('#unitDetailTitle')).toHaveText('RANGER 022');await expect(page).toHaveURL(/unit=RANGER\+022/);
 await page.locator('#eventsArea summary').click();await expect(page.locator('#recentChanges')).toContainText('Historical east observation');await expect(page.locator('#recentChanges')).not.toContainText('Other unit only');
 await expect(page.locator('#recentChanges')).toContainText('ONLINE');await expect(page.locator('#cameraIssues')).toContainText('OFFLINE');
 await expect(page.locator('#unitDetailMain .time-attempt')).toContainText('Reported OFFLINE');await expect(page.locator('#unitDetailMain .time-history')).toContainText('Historical record');
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();await expect(east).toBeFocused();await expect(page).not.toHaveURL(/unit=/);
 await east.click();await page.goBack();await expect(page.getByRole('dialog')).not.toBeVisible();await page.goForward();await expect(page.getByRole('dialog')).toBeVisible();
 await page.getByRole('button',{name:'Back to units'}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
 await page.getByLabel('Search units',{exact:true}).fill('RII');await expect(page.locator('.compact-unit')).toHaveCount(1);await page.locator('.compact-unit').click();await expect(page.locator('#bridgeComponents')).toBeVisible();await expect(page.locator('#unitDetailSubtitle')).toContainText('System status: ONLINE');await expect(page.locator('#unitDetailMain')).toContainText('DETECTOR · BATTERY 7%');await expect(page.locator('[data-component-id="BRIDGE-TEST"]')).toContainText('OFFLINE');await expect(page.locator('[data-component-id="BRIDGE-TEST"]')).toContainText('6% · Critical');await expect(page.locator('[data-component-id="SIREN-TEST"]')).toContainText('Siren');await expect(page.locator('.unit-component')).toHaveCount(1);
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});const bounds=await page.locator('#unitDetailDialog').evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth,page:document.documentElement.scrollWidth,view:innerWidth}));expect(bounds.scroll).toBeLessThanOrEqual(bounds.width+1);expect(bounds.page).toBeLessThanOrEqual(bounds.view+1);if(width===390)await page.screenshot({path:info.outputPath('unit-details-mobile.png')})}
 await page.screenshot({path:info.outputPath('unit-details-desktop.png')});await page.keyboard.press('Escape');await page.getByLabel('Search units',{exact:true}).fill('');await page.screenshot({path:info.outputPath('camera-overview-desktop.png')});await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath('camera-overview-mobile.png'),fullPage:true});expect(errors).toEqual([]);
});

test('interrupted diagnostics and failed history never leak another unit’s result',async({page})=>{
 await mount(page);await page.evaluate(()=>{window.holdChecks=true});
 await page.getByRole('button',{name:'Open RANGER 022 unit details'}).click();await page.locator('[data-diag="connectivity"]').click();
 await expect(page.locator('#troubleResult')).toContainText('Running diagnostic');
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Open RANGER 023 unit details'}).click();
 await page.evaluate(()=>{window.releaseCheck?.()});
 await expect(page.locator('#unitDetailTitle')).toHaveText('RANGER 023');await expect(page.locator('#troubleResult')).toHaveText('Choose a diagnostic for this unit.');
 await page.keyboard.press('Escape');await page.evaluate(()=>{window.failHistory=true});
 await page.getByRole('button',{name:'Open RANGER 022 unit details'}).click();await page.locator('#eventsArea summary').click();await expect(page.locator('#unitHistoryStatus')).toContainText('Synthetic history failure');await expect(page.locator('#recentChanges')).not.toContainText('Other unit only');
});

test('offline totals exclude shop, inactive, port-only and unmapped records while conflicts remain visible',async({page},info)=>{
 await mount(page);
 await page.evaluate(async()=>{
  const base={device_type:'IPC',source:'vigilant_control_center',source_status:'offline',source_last_seen_at:'2026-10-06T12:29:00Z',activation_state:'active',organization:'Customer site'};
  window.fixtureDevices=[{...base,id:1,unit_key:'FIELD 001'},{...base,id:2,unit_key:'FIELD 001'},{...base,id:3,unit_key:'RANGER 901'},{...base,id:4,unit_key:'SHOP 001',organization:'ROOT'},{...base,id:5,unit_key:'INACTIVE 001',activation_state:'deactivated'},{...base,id:6,unit_key:'SNIPER 903',source:'2026_unit_tracker',source_status:null,source_last_seen_at:null,device_type:'Sniper'},{...base,id:7,unit_key:'SPOTTER 902',device_type:'NVR'}];
  window.fixtureTracker=[{source_label:'RANGER 901',canonical_family:'Ranger',unit_tag:'901',tracker_state:'shop'},{source_label:'SPOTTER 902',canonical_family:'Spotter',unit_tag:'902',tracker_state:'shop'},{source_label:'SPOTTER 904',canonical_family:'Spotter',unit_tag:'904',tracker_state:'field_or_unknown',health_provider:'witness'}];
  window.fixtureHealth=[{camera_device_id:6,overall_status:'offline',ip_reachable:false,confirmed_outage:true,consecutive_failures:3,checked_at:'2026-10-06T12:29:00Z'}];
  window.fixtureIntegrations=[{provider:'witness',metadata:{units:{'spotter|904':{status:'offline',checked_at:'2026-10-06T12:29:00Z'}}}}];
  await load();
 });
 await expect(page.locator('#allOffline')).toHaveText('3');await expect(page.locator('#shopTotal')).toHaveText('2');await expect(page.locator('#inactiveTotal')).toHaveText('1');await expect(page.locator('#mappingTotal')).toHaveText('3');await page.screenshot({path:info.outputPath('camera-classification-hotfix.png'),fullPage:true});
 await page.locator('#statAllOffline').click();await expect(page.locator('.compact-unit')).toHaveCount(3);await expect(page.locator('.compact-unit[data-unit="RANGER 901"]')).toContainText('LOCATION REVIEW');
 await page.locator('.compact-unit[data-unit="RANGER 901"]').click();await expect(page.locator('#cameraIssues')).toContainText('OFFLINE');await page.keyboard.press('Escape');
 await page.locator('[data-scope-filter="Mapping"]').click();await expect(page.locator('.compact-unit')).toHaveCount(3);await expect(page.locator('.compact-unit[data-unit="SPOTTER 904"]')).toContainText('STATUS UNVERIFIED');await expect(page.locator('[data-unit="SPOTTER 904"] .statuspill')).not.toContainText('OFFLINE');await expect(page.locator('.compact-unit[data-unit="SPOTTER 902"]')).toContainText('RECORDER OFFLINE');
 await page.locator('#statShop').click();await expect(page.locator('.compact-unit')).toHaveCount(2);await expect(page.locator('[data-unit="SHOP 001"] .statuspill')).toHaveText('SHOP / ROOT');await expect(page.locator('[data-unit="INACTIVE 001"] .statuspill')).toHaveText('INACTIVE');
 await page.locator('[data-scope-filter="Deactivated"]').click();await expect(page.locator('.compact-unit')).toHaveCount(1);await expect(page.locator('.compact-unit .statuspill')).toHaveText('INACTIVE');
});
test('current evidence expires in both overview and open details without fresh reads',async({page})=>{
 await mount(page);await page.getByRole('button',{name:'Open RANGER 022 unit details'}).click();await expect(page.locator('#unitDetailSubtitle')).toContainText('OFFLINE');
 const reads=await page.evaluate(()=>window.reads.length);
 await page.evaluate(()=>{Date.now=()=>Date.parse('2026-10-06T12:51:00Z');window.freshnessCheck()});
 await expect(page.locator('#allOffline')).toHaveText('0');await expect(page.locator('#unitDetailSubtitle')).toContainText('NOT VERIFIED');expect(await page.evaluate(()=>window.reads.length)).toBe(reads);
});
test('duplicate source refresh clears totals and cannot be revived by freshness timer',async({page})=>{
 await mount(page);await page.evaluate(async()=>{window.fixtureDevices.push(window.fixtureDevices[0]);await load()});
 await expect(page.locator('#allOffline')).toHaveText('—');await expect(page.locator('#empty')).toContainText('duplicate identities');await expect(page.locator('.provider-breakdown b')).toHaveText(Array(8).fill('—'));
 await page.evaluate(()=>window.freshnessCheck());await expect(page.locator('#allOffline')).toHaveText('—');await expect(page.locator('#unitCards')).not.toBeVisible();
});

test('provider recorders restore system health and ports stay separate with mixed-source details',async({page},info)=>{
 await mount(page);await page.evaluate(async()=>{
  const base={activation_state:'active',organization:'Synthetic customer',source:'vigilant_control_center',source_status:'online',source_last_seen_at:'2026-10-06T12:29:00Z'};
  fixtureDevices=[{...base,id:91,unit_key:'RECORDER 901',device_type:'NVR'},{...base,id:92,unit_key:'SERVICE 902',device_type:'Sniper',source:'2026_unit_tracker',source_status:null,source_last_seen_at:null},{...base,id:93,unit_key:'MIXED 903',device_type:'IPC'},{...base,id:94,unit_key:'MIXED 903',device_type:'NVR',source_status:'offline'}];
  fixtureHealth=[{camera_device_id:92,overall_status:'online',ip_reachable:true,checked_at:'2026-10-06T12:29:00Z'}];await load();
 });
 await expect(page.locator('#allOnline')).toHaveText('1');await expect(page.locator('#allOffline')).toHaveText('0');await expect(page.locator('#allPending')).toHaveText('2');await expect(page.locator('#serviceTotal')).toHaveText('1');
 await expect(page.locator('[data-unit="RECORDER 901"] .statuspill')).toHaveText('RECORDER ONLINE');await expect(page.locator('.compact-unit[data-unit="RECORDER 901"]')).toContainText('Camera channel status unavailable');
 await expect(page.locator('[data-unit="SERVICE 902"] .statuspill')).toHaveText('IP / PORT ONLINE');await expect(page.locator('.compact-unit[data-unit="SERVICE 902"]')).toHaveClass(/\bonline\b/);
 await expect(page.locator('.compact-unit[data-unit="MIXED 903"]')).toContainText('Mixed provider status');await expect(page.locator('#cameraCoverage')).toContainText('1 online · 0 offline · 0 mixed/unverified · 2');
 await page.screenshot({path:info.outputPath('system-camera-evidence-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath('system-camera-evidence-mobile.png'),fullPage:true});
 await page.locator('.compact-unit[data-unit="MIXED 903"]').click();await expect(page.locator('#unitDetailMain')).toContainText('RECORDER OFFLINE');await expect(page.locator('#cameraIssues')).toContainText('recorder OFFLINE');await expect(page.locator('#cameraIssues .eventstatus')).toContainText(['OFFLINE']);
});

test('missing Recon receiver-test metadata does not assert a failed or stopped feed',async({page})=>{await mount(page);await expect(page.locator('#providerOtherHealth')).toContainText('Receiver test not recorded in current metadata');await expect(page.locator('#reconLiveStatus')).toContainText('RECEIVER TEST NOT RECORDED');await expect(page.locator('#reconLiveStatus')).toContainText('does not establish that live events stopped');});


test('legacy Sniper and CAM V cards preserve online offline unknown service states and resource ports flow',async({page},info)=>{
 await mount(page);await page.evaluate(async()=>{
  const base={activation_state:'active',organization:'Synthetic customer',source:'2026_unit_tracker',source_status:null,source_last_seen_at:null,monitoring_profile:'sniper',public_ip:'192.0.2.20',expected_ports:[80,443,8443,38880,38881]};
  fixtureDevices=[{...base,id:101,unit_key:'SNIPER 2 005',device_type:'Sniper 2'},{...base,id:102,unit_key:'CAM V 002',device_type:'CAMV'},{...base,id:103,unit_key:'CAM V 003',device_type:'CAMV'}];
  fixtureHealth=[{camera_device_id:101,overall_status:'online',ip_reachable:true,checked_at:'2026-10-06T12:29:00Z'},{camera_device_id:102,overall_status:'offline',ip_reachable:false,confirmed_outage:true,consecutive_failures:3,checked_at:'2026-10-06T12:29:00Z'}];await load();
 });
 await expect(page.locator('#allOnline')).toHaveText('0');await expect(page.locator('#allOffline')).toHaveText('0');
 await page.getByLabel('Filter units').selectOption('SniperOnline');await expect(page.locator('.compact-unit')).toHaveCount(1);await expect(page.locator('.compact-unit .statuspill')).toHaveText('IP / PORT ONLINE');await expect(page.locator('.compact-unit')).toHaveClass(/\bonline\b/);await page.locator('.compact-unit').screenshot({path:info.outputPath('legacy-sniper-online-card.png')});
 await page.locator('.compact-unit').click();await expect(page.locator('#unitDetailSubtitle')).toContainText('IP / port status: ONLINE');await expect(page.locator('#unitDetailMain').getByRole('link',{name:'Open resource & ports'})).toHaveAttribute('href','./camera-detail.html?id=101');await page.keyboard.press('Escape');
 await page.getByLabel('Filter units').selectOption('CamVOffline');await expect(page.locator('.compact-unit')).toHaveCount(1);await expect(page.locator('.compact-unit .statuspill')).toHaveText('IP / PORT OFFLINE');await expect(page.locator('.compact-unit')).toHaveClass(/\boffline\b/);
 await page.getByLabel('Filter units').selectOption('CAM V');await expect(page.locator('.compact-unit')).toHaveCount(2);await expect(page.locator('[data-unit="CAM V 003"] .statuspill')).toHaveText('IP / PORT UNVERIFIED');
 await page.getByLabel('Filter units').selectOption('Avigilon');await expect(page.locator('.compact-unit')).toHaveCount(3);
 await page.evaluate(()=>{Date.now=()=>Date.parse('2026-10-06T12:51:00Z');window.freshnessCheck();});await expect(page.locator('.compact-unit .statuspill')).toHaveText(['IP / PORT UNVERIFIED','IP / PORT UNVERIFIED','IP / PORT UNVERIFIED']);
});

test('fleet breakdown counts each unit once and exposes familiar provider groups',async({page})=>{
 await mount(page);await page.evaluate(async()=>{
  const base={activation_state:'active',organization:'Synthetic site',source:'vigilant_control_center',source_status:'online',source_last_seen_at:'2026-10-06T12:29:00Z'};
  fixtureDevices=[{...base,id:91,unit_key:'RANGER 091',device_type:'NVR',monitoring_profile:'ranger'},{...base,id:92,unit_key:'SNIPER 092',device_type:'Sniper',source:'2026_unit_tracker',source_status:null,monitoring_profile:'sniper'},{...base,id:93,unit_key:'CAMV 093',device_type:'CAMV',source:'2026_unit_tracker',source_status:null,monitoring_profile:'sniper'},{...base,id:94,unit_key:'RII-094',device_type:'detector',source:'reconeyez',source_status:'offline',monitoring_profile:'reconeyez'}];
  fixtureHealth=[{camera_device_id:91,overall_status:'online',ip_reachable:true,checked_at:'2026-10-06T12:29:00Z'},{camera_device_id:92,overall_status:'online',ip_reachable:true,checked_at:'2026-10-06T12:29:00Z'},{camera_device_id:93,overall_status:'offline',ip_reachable:false,confirmed_outage:true,consecutive_failures:3,checked_at:'2026-10-06T12:29:00Z'}];await load();
 });
 await expect(page.locator('#fleetConnectedOnline')).toHaveText('2');await expect(page.locator('#fleetConnectedOffline')).toHaveText('2');await expect(page.locator('#vigilantOnline')).toHaveText('1');await expect(page.locator('#avigilonOnline')).toHaveText('1');await expect(page.locator('#avigilonOffline')).toHaveText('1');await expect(page.locator('#reconOffline')).toHaveText('1');
 await page.locator('[data-scope-filter="AvigilonOnline"]').click();await expect(page.locator('.compact-unit')).toHaveCount(1);await expect(page.locator('.compact-unit')).toContainText('SNIPER 092');
 await page.locator('[data-scope-filter="FleetOffline"]').click();await expect(page.locator('.compact-unit')).toHaveCount(2);
});

test('front placement confirmation moves shop and field without changing health',async({page},info)=>{
 await mount(page);
 await page.evaluate(()=>{window.moves=[];window.placementState={unitKey:'RANGER 022',placement:'FIELD',siteLabel:'Synthetic site',streetAddress:'10 Synthetic Road',auditId:null,canMove:true};db.rpc=async(name,args)=>{
  if(name==='owner_camera_unit_placement_state_v2')return {data:placementState,error:null};
  moves.push({name,args});await new Promise(resolve=>window.releaseMove=resolve);
  placementState={...placementState,placement:args.p_placement,siteLabel:args.p_site_label,streetAddress:args.p_street_address,auditId:String(moves.length)};
  fixtureDevices=fixtureDevices.map(d=>d.unit_key===args.p_unit_key?{...d,organization:args.p_placement==='SHOP'?'ROOT':args.p_site_label,activation_state:args.p_placement==='SHOP'?'deactivated':'active'}:d);
  return {data:{ok:true,unit_key:args.p_unit_key,placement:args.p_placement,request_id:args.p_request_id,audit_id:placementState.auditId},error:null};};});
 const card=page.locator('[data-unit="RANGER 022"].compact-unit');await card.getByRole('button',{name:'Move to ROOT / SHOP',exact:true}).click();
 const dialog=page.locator('.cos-placement-dialog');await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'Cancel'}).click();await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>moves.length)).toBe(0);
 await card.getByRole('button',{name:'Move to ROOT / SHOP',exact:true}).click();await dialog.getByLabel('Reason for move').fill('Returned to shop');await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Save placement'}).click();await expect(dialog.getByRole('button',{name:'Save placement'})).toBeDisabled();await page.keyboard.press('Escape');await expect(dialog).toBeVisible();expect(await page.evaluate(()=>moves.length)).toBe(1);
 await page.evaluate(()=>releaseMove());await expect(dialog).toHaveCount(0);await page.getByRole('button',{name:'Shop / ROOT folder',exact:true}).click();await expect(card).toBeVisible();await expect(card.getByRole('button',{name:'Move to Field',exact:true})).toBeVisible();await expect(card.getByRole('link',{name:'Field View'})).toHaveAttribute('href','./?fieldUnit=RANGER%20022');
 await card.getByRole('button',{name:'Move to Field',exact:true}).click();await dialog.getByLabel('Current job / site').fill('New synthetic site');await dialog.getByLabel('Current installation address (street, city, state and ZIP)').fill('20 Test Road');await dialog.getByLabel('Reason for move').fill('Installed');await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Save placement'}).click();expect(await page.evaluate(()=>moves.length)).toBe(2);await page.evaluate(()=>releaseMove());await expect(dialog).toHaveCount(0);
 await page.getByRole('button',{name:'Field / Job Sites',exact:true}).click();await expect(card).toContainText('New synthetic site');await expect(card).toContainText('OFFLINE');
 await page.screenshot({path:info.outputPath('shop-field-synthetic.png'),fullPage:true});
});

test('visible folders and global search include deactivated ROOT units without family collisions',async({page})=>{
 await mount(page);await page.evaluate(async()=>{fixtureDevices.push({id:999,unit_key:'SNIPER 312',device_name:'Shop camera 312',organization:'ROOT',activation_state:'deactivated',device_type:'Sniper',source:'2026_unit_tracker'});await load();});
 await page.getByRole('button',{name:'Shop / ROOT folder',exact:true}).click();await expect(page.locator('.compact-unit')).toHaveCount(1);await expect(page.locator('.compact-unit')).toContainText('SNIPER 312');
 await page.getByRole('button',{name:'Field / Job Sites',exact:true}).click();await page.getByLabel('Search units').fill('312');await expect(page.locator('.compact-unit')).toHaveCount(1);await expect(page.locator('#boardTitle')).toContainText('Search all inventory');await expect(page.locator('.compact-unit')).toContainText('SHOP / ROOT');
});

test('online and offline edges stay bright without selection while stale and shop stay neutral',async({page},info)=>{
 await mount(page);const online=page.locator('[data-unit="RANGER 023"].compact-unit'),offline=page.locator('[data-unit="RANGER 022"].compact-unit');
 for(const [card,color] of [[online,'rgb(32, 231, 140)'],[offline,'rgb(255, 70, 86)']]){await expect(card).toHaveCSS('border-top-color',color);await expect(card).toHaveCSS('border-top-width','3px');}
 await page.locator('#unitCards').screenshot({path:info.outputPath('bright-card-edges-and-front-actions.png')});
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});const bounds=await page.locator('#unitCards').evaluate(el=>({page:document.documentElement.scrollWidth,view:innerWidth}));expect(bounds.page).toBeLessThanOrEqual(bounds.view+1);}
 await page.evaluate(()=>{Date.now=()=>Date.parse('2026-10-06T12:51:00Z');window.freshnessCheck();});await expect(online).toHaveCSS('border-top-color','rgb(83, 97, 116)');await expect(offline).toHaveCSS('border-top-color','rgb(83, 97, 116)');
 await page.evaluate(async()=>{fixtureDevices=fixtureDevices.map(d=>d.unit_key==='RANGER 023'?{...d,organization:'ROOT'}:d);await load();});await page.locator('#statShop').click();await expect(page.locator('.compact-unit')).toHaveCSS('border-top-color','rgb(83, 97, 116)');
});


test('unavailable placement reads show an error without submitting changes',async({page})=>{
 await mount(page);await page.evaluate(()=>{window.writes=0;db.rpc=async name=>{if(name==='owner_set_camera_unit_placement_v2')writes++;return {error:{message:'Synthetic denied'}};};});
 await page.locator('.compact-unit[data-unit="RANGER 022"]').getByRole('button',{name:'Move to ROOT / SHOP',exact:true}).click();await expect(page.locator('.cos-placement-dialog')).toContainText('Synthetic denied');await expect(page.locator('.cos-placement-dialog [type=submit]')).toBeDisabled();expect(await page.evaluate(()=>writes)).toBe(0);await page.locator('.cos-placement-dialog').getByRole('button',{name:'Cancel'}).click();
});
