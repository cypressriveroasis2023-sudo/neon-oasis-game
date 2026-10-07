import {test,expect} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const origin='http://127.0.0.1:4173';
const list=readFileSync(resolve(repo,'tech-checks/camera-health.html'),'utf8');
const detail=readFileSync(resolve(repo,'tech-checks/camera-detail.html'),'utf8');
const overview=readFileSync(resolve(repo,'tech-checks/camera-health-overview.js'),'utf8');
const helper=readFileSync(resolve(repo,'tech-checks/camera-health-history.js'),'utf8');
function section(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);if(a<0||b<0)throw new Error('Missing real presentation function');return source.slice(a,b);}
const listRender=section(list,'function renderUnits()','\nfunction ');
const detailRender=section(detail,'function render(){','  const liveNow=')+'}';
const portRender=section(detail,"  $('ports').innerHTML=",'\n');
const portSetup=section(detail,'  const ps=current?.port_status||{},expected=','\n');
const connectionFunction=section(detail,'function interfaceLinks()','\n');
const connectionRender=section(detail,'  const actionLinks=',"\n  $('history')");
const detailEffective=section(detail,'function effectiveHealth(d,h)','\n\nfunction sourceStatusText');
const sourceFresh=section(detail,'function sourceFresh(d','\nfunction checkFresh');
const freshCheck=section(detail,'function checkFresh(h','\nfunction hasDirectLiveProof');
const effective=section(list,'function effectiveHealth(d)','\nfunction isCountedCamera');
const escape="const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#039;'}[c]));";
const shared=`${helper}\n${escape}
 const $=id=>document.getElementById(id);const cameraGroup=d=>d.group||'Vigilant';
 const fixedNow=Date.parse('2026-10-06T12:30:00Z');Date.now=()=>fixedNow;
 const evidenceFresh=value=>CameraHealthHistory.timestamp(value).state==='fresh';
 ${effective}
 window.fixture={device:{id:159,source:'vigilant_control_center',device_type:'IPC',activation_state:'active',device_name:'RANGER 022',unit_key:'RANGER 022',organization:'Synthetic test site',group:'Vigilant',source_status:'offline',source_last_seen_at:'2026-10-06T12:25:10Z',last_online_at:'2026-10-06T10:55:10Z',last_probe_online_at:null,vigilant_status:'Offline'},current:{overall_status:'online',ip_reachable:true,checked_at:'2026-09-30T01:00:00Z',port_status:{80:{online:true,latency_ms:5}}}};
`;
const listScript=`${shared}
 ${overview}
 let boardDataReady=true;let devices=[fixture.device],health={159:fixture.current},history=[],unitPage=1;const UNITS_PER_PAGE=25;
 const fleetGroups=()=>[{k:'RANGER 022',state:effectiveHealth(fixture.device),ds:[fixture.device]}];
 const fleetMatches=()=>true,syncMobileCameraLayout=()=>{},isShop=()=>false,isCountedCamera=()=>true;
 const isCameraIssue=d=>effectiveHealth(d)!=='online',isReconAwaitingStatus=()=>false,cameraIssueReason=()=> 'Provider reports offline';
 const healthAssessment=()=>({reason:'Provider reports offline'}),cameraPlatform=cameraGroup,reconBatteryBadge=()=> 'Unknown',fmtDown=()=> '',outageSummary=()=>({events:[]}),reconMeta=()=>({}),reconCloudLink=()=> '#';
 ${listRender}
 window.repaint=()=>{renderUnits();$('unitDetailMain').innerHTML=CameraHealthOverview.details(fleetGroups()[0],{health,cameraGroup,effectiveHealth,reconBatteryBadge});};$('authGate').classList.add('hidden');repaint();$('unitDetailDialog').showModal();
`;
const detailScript=`${shared}
 ${sourceFresh}
 ${detailEffective}
 let device=fixture.device,current=fixture.current;const issueReason=()=>'',sourceStatusText=()=> 'Vigilant: '+String(device.source_status).toUpperCase(),sourceDetailText=()=> 'Provider observation; direct diagnostic is separate';
 ${detailRender}
 ${freshCheck}
 const effectivePublicIP=()=>fixture.device.public_ip;
 ${connectionFunction}
 function renderConnections(){const isRecon=false;${connectionRender}}
 function renderPorts(){${portSetup}
${portRender}}
 window.repaint=()=>{device=fixture.device;current=fixture.current;render();renderPorts();renderConnections();};$('loading').classList.add('hidden');$('content').classList.remove('hidden');repaint();
`;
async function mount(page,name){
 await page.emulateMedia({colorScheme:'dark'});
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());if(url.origin!==origin)return route.abort('blockedbyclient');
  if(url.pathname===`/tech-checks/${name}.html`){const source=name==='camera-health'?list:detail,script=name==='camera-health'?listScript:detailScript;return route.fulfill({contentType:'text/html',body:source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>',`<script>${script}</script></body>`)});}
  const path=resolve(repo,'.'+decodeURIComponent(url.pathname));if(path.startsWith(repo+'/')&&existsSync(path))return route.fulfill({path,contentType:{'.css':'text/css','.woff':'font/woff','.png':'image/png'}[extname(path)]||'application/octet-stream'});return route.abort('blockedbyclient');
 });
 await page.goto(`/tech-checks/${name}.html`);
}
test.use({timezoneId:'America/Chicago'});
test('actual unit details separate provider attempt and historical connection at every width',async({page},info)=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));await mount(page,'camera-health');
 const card=page.locator('#unitDetailMain .unit-component');await expect(card).toHaveCount(1);await expect(page.locator('#unitCards .unitcard')).toHaveClass(/offline/);
 await expect(card.locator('.time-attempt')).toContainText('Last check attempted');await expect(card.locator('.time-attempt')).toContainText('7:25:10 AM CDT');await expect(card.locator('.time-attempt')).toContainText('Reported OFFLINE');
 await expect(card.locator('.time-history')).toContainText('5:55:10 AM CDT');await expect(card.locator('.time-history')).toContainText('Historical record');
 await expect(card.locator('.time-good')).toHaveCount(0);await expect(page.locator('#unitCards .unitcard')).toContainText('0 online');
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:900});
  await expect(card.locator('.time-history b')).toHaveCSS('color','rgb(230, 237, 247)');
  await expect(card.locator('.time-history')).toHaveCSS('background-color','rgb(23, 35, 55)');
  const bounds=await card.locator('.unit-time-strip').evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth,page:document.documentElement.scrollWidth,view:innerWidth}));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.width+1);expect(bounds.page).toBeLessThanOrEqual(bounds.view+1);
  if(width===390)await card.screenshot({path:info.outputPath('offline-camera-history-mobile.png')});
 }
 await page.evaluate(()=>{fixture.device.source_last_seen_at='2026-10-06T12:29:10Z';repaint();});
 await expect(card.locator('.time-attempt')).toContainText('7:29:10 AM CDT');await expect(card.locator('.time-history')).toContainText('5:55:10 AM CDT');
 await page.evaluate(()=>{fixture.device.source_status='online';fixture.device.last_online_at=fixture.device.source_last_seen_at;repaint();});
 await expect(page.locator('#unitCards .unitcard')).toHaveClass(/online/);await expect(card.locator('.time-history')).toContainText('7:29:10 AM CDT');
 await expect(card.locator('.time-history b')).toHaveCSS('color','rgb(230, 237, 247)');expect(errors).toEqual([]);
});
test('actual detail preserves offline success, rejects offline Reconeyez events and flags bad dates',async({page})=>{
 await mount(page,'camera-detail');await expect(page.locator('#lastPing')).toContainText('5:55:10 AM CDT');await expect(page.locator('#lastChecked')).toContainText('7:25:10 AM CDT');await expect(page.locator('#lastCheckedAgo')).toContainText('Reported OFFLINE');await expect(page.locator('#sourceStatusCard')).toHaveClass('card bad');
 await expect(page.locator('#ports .port')).toHaveClass('port pending');await expect(page.locator('#ports')).toContainText('previous result; not current');await expect(page.locator('#ports')).not.toContainText('5ms');await expect(page.locator('#ports')).not.toContainText('✓');
 await page.evaluate(()=>{fixture.current.checked_at='2026-10-06T12:29:10Z';repaint();});await expect(page.locator('#ports')).toContainText('5ms');await expect(page.locator('#ports')).toContainText('✓');
 await page.evaluate(()=>{fixture.device.group='Reconeyez';fixture.device.last_online_at=null;repaint();});
 await expect(page.locator('#lastCheckedLabel')).toHaveText('Last cloud status update');await expect(page.locator('#lastPing')).toHaveText('Never recorded');
 await page.evaluate(()=>{fixture.device.last_online_at='2030-01-01T00:00:00Z';fixture.device.source_last_seen_at='invalid';repaint();});
 await expect(page.locator('#lastPing')).toHaveText('Unknown (invalid timestamp)');await expect(page.locator('#lastChecked')).toHaveText('Unknown (invalid timestamp)');await expect(page.locator('#sourceStatusCard')).toHaveClass('card warn');
});

test('actual direct-port detail distinguishes unchecked, failed and stale evidence',async({page},info)=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await mount(page,'camera-detail');
 await page.evaluate(()=>{
  fixture.device={...fixture.device,device_name:'Synthetic direct unit',group:'Sniper',monitoring_profile:'sniper',expected_ports:[80,443,8443,38880,38881]};
  fixture.current={overall_status:'online',ip_reachable:true,checked_at:'2026-10-06T12:29:10Z',port_status:{
   80:{online:true,latency_ms:5},443:{online:false,error:'timeout'},
   38880:{online:'false'},38881:{online:true,latency_ms:4,checked_at:'2026-10-06T10:55:10Z'}
  }};repaint();
 });
 const row=p=>page.locator('#ports .port').filter({hasText:new RegExp('^Port '+p+'(?: /| ·| ✓)')});
 await expect(page.locator('#ports .port')).toHaveCount(5);
 await expect(row(80)).toHaveClass('port');await expect(row(80)).toContainText('✓ · 5ms');
 await expect(row(443)).toHaveClass('port off');await expect(row(443)).toContainText('No response');await expect(row(443)).not.toContainText('previous result');
 for(const p of [8443,38880]){await expect(row(p)).toHaveClass('port pending');await expect(row(p)).toContainText('Not checked');await expect(row(p)).not.toContainText('No response');}
 await expect(row(38881)).toHaveClass('port pending');await expect(row(38881)).toContainText('No recent result');await expect(row(38881)).not.toContainText('4ms');
 await expect(page.locator('#statusPill')).toHaveText('ONLINE');
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:900});
  const bounds=await page.locator('#ports').evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth,page:document.documentElement.scrollWidth,view:innerWidth}));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.width+1);expect(bounds.page).toBeLessThanOrEqual(bounds.view+1);
  if(width===390)await page.locator('#ports').screenshot({path:info.outputPath('direct-port-evidence-mobile.png')});
 }
 await page.evaluate(()=>{fixture.current.port_status[8443]={online:false};repaint();});
 await expect(row(8443)).toHaveClass('port off');await expect(row(8443)).toContainText('No response');
 await page.evaluate(()=>{fixture.current.checked_at='2026-10-06T10:55:10Z';repaint();});
 for(const p of [80,443,8443,38881]){await expect(row(p)).toHaveClass('port pending');await expect(row(p)).toContainText('No recent result');}
 await expect(row(38880)).toContainText('Not checked');
 await expect(page.locator('#ports')).not.toContainText('✓');await expect(page.locator('#ports')).not.toContainText('No response');
 await page.evaluate(()=>{fixture.current.port_status={};fixture.current.checked_at='2026-10-06T12:29:10Z';repaint();});
 for(const p of [80,443,8443,38880,38881])await expect(row(p)).toContainText('Not checked');
 expect(errors).toEqual([]);
});


test('saved IP and Unity endpoints remain visible through failed, stale and missing observations',async({page})=>{
 await mount(page,'camera-detail');
 await page.evaluate(()=>{fixture.device={...fixture.device,public_ip:'192.0.2.20',expected_ports:[80,443,8443,38880,38881],port_labels:{38880:'Unity client',38881:'Unity service'}};fixture.current={checked_at:'2026-10-06T12:29:10Z',port_status:{443:{online:false}}};repaint();});
 const actions=page.locator('#interfaceActions');
 for(const stage of ['failed','stale','missing']){
  if(stage==='stale')await page.evaluate(()=>{fixture.current.checked_at='2020-01-01T00:00:00Z';repaint();});
  if(stage==='missing')await page.evaluate(()=>{fixture.current={};repaint();});
  await expect(actions.locator('a[href="https://192.0.2.20"]')).toBeVisible();
  await expect(actions.locator('a[href="https://192.0.2.20:8443"]')).toBeVisible();
  await expect(actions).toContainText('Unity client · 192.0.2.20:38880');await expect(actions).toContainText('Unity service · 192.0.2.20:38881');
  await expect(actions.locator('a[href*="38880"],a[href*="38881"]')).toHaveCount(0);
  await expect(page.locator('#connectionNote')).toContainText('Links do not verify video');
 }
 await page.evaluate(()=>{fixture.device.public_ip=null;repaint();});await expect(actions.locator('a')).toHaveCount(0);await expect(page.locator('#connectionNote')).toContainText('No saved public IP');
});
