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
test('overview is quiet; unit cards open scoped history and preserve Back and keyboard navigation',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await mount(page);
 await expect(page.locator('.health-kpis>.stat')).toHaveCount(4);await expect(page.locator('#diag')).not.toBeVisible();await expect(page.locator('#statAllOnline')).toContainText('CAMERA SYSTEMS ONLINE');
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
 await page.getByLabel('Search units',{exact:true}).fill('RII');await expect(page.locator('.compact-unit')).toHaveCount(1);await page.locator('.compact-unit').click();await expect(page.locator('#bridgeComponents')).toBeVisible();await expect(page.locator('#unitDetailSubtitle')).toContainText('Detector health: ONLINE');await expect(page.locator('#unitDetailMain')).toContainText('DETECTOR · BATTERY 7%');await expect(page.locator('[data-component-id="BRIDGE-TEST"]')).toContainText('OFFLINE');await expect(page.locator('[data-component-id="BRIDGE-TEST"]')).toContainText('6% · Critical');await expect(page.locator('[data-component-id="SIREN-TEST"]')).toContainText('Siren');await expect(page.locator('.unit-component')).toHaveCount(1);
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
 await expect(page.locator('#allOffline')).toHaveText('2');await expect(page.locator('#shopTotal')).toHaveText('1');await expect(page.locator('#inactiveTotal')).toHaveText('1');await expect(page.locator('#mappingTotal')).toHaveText('3');await page.screenshot({path:info.outputPath('camera-classification-hotfix.png'),fullPage:true});
 await page.locator('#statAllOffline').click();await expect(page.locator('.compact-unit')).toHaveCount(2);await expect(page.locator('[data-unit="RANGER 901"]')).toContainText('LOCATION REVIEW');
 await page.locator('[data-unit="RANGER 901"]').click();await expect(page.locator('#cameraIssues')).toContainText('OFFLINE');await page.keyboard.press('Escape');
 await page.locator('[data-scope-filter="Mapping"]').click();await expect(page.locator('.compact-unit')).toHaveCount(3);await expect(page.locator('[data-unit="SPOTTER 904"]')).toContainText('NEEDS MAPPING');await expect(page.locator('[data-unit="SPOTTER 904"] .statuspill')).not.toContainText('OFFLINE');await expect(page.locator('[data-unit="SPOTTER 902"]')).toContainText('Recorder provider reports OFFLINE');
 await page.locator('#statShop').click();await expect(page.locator('.compact-unit')).toHaveCount(1);await expect(page.locator('.compact-unit .statuspill')).toHaveText('SHOP / ROOT');
 await page.locator('[data-scope-filter="Deactivated"]').click();await expect(page.locator('.compact-unit')).toHaveCount(1);await expect(page.locator('.compact-unit .statuspill')).toHaveText('INACTIVE');
});
test('current evidence expires in both overview and open details without fresh reads',async({page})=>{
 await mount(page);await page.getByRole('button',{name:'Open RANGER 022 unit details'}).click();await expect(page.locator('#unitDetailSubtitle')).toContainText('OFFLINE');
 const reads=await page.evaluate(()=>window.reads.length);
 await page.evaluate(()=>{Date.now=()=>Date.parse('2026-10-06T12:46:00Z');window.freshnessCheck()});
 await expect(page.locator('#allOffline')).toHaveText('0');await expect(page.locator('#unitDetailSubtitle')).toContainText('NOT VERIFIED');expect(await page.evaluate(()=>window.reads.length)).toBe(reads);
});
test('duplicate source refresh clears totals and cannot be revived by freshness timer',async({page})=>{
 await mount(page);await page.evaluate(async()=>{window.fixtureDevices.push(window.fixtureDevices[0]);await load()});
 await expect(page.locator('#allOffline')).toHaveText('—');await expect(page.locator('#empty')).toContainText('duplicate identities');
 await page.evaluate(()=>window.freshnessCheck());await expect(page.locator('#allOffline')).toHaveText('—');await expect(page.locator('#unitCards')).not.toBeVisible();
});
