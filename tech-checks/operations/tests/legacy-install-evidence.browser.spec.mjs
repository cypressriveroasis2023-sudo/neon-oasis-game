import {test,expect} from '@playwright/test';
const origin=process.env.COS_TEST_ORIGIN||'http://127.0.0.1:4173',edge='https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const now='2026-10-10T12:00:00.000Z',completed='2026-10-09T12:00:00.000Z';
const uuid=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const checks=Array.from({length:13},(_,i)=>({name:'Synthetic field check '+(i+1),passed:true}));
function snapshot(){return {contract:'cos.legacy-install-evidence.v1',readOnly:true,generatedAt:now,windowStart:'2026-09-10T12:00:00.000Z',limit:10,hasMore:false,items:[{
  prepId:uuid(1),ticketNumber:'900101',siteLabel:'Synthetic Field Site',prepStatus:'released',recordedAt:completed,fieldCompletedAt:completed,ownerVerifiedAt:null,historical:false,reviewStatus:'not_ready',readyForOwnerReview:false,
  units:[['Helios','HEL-001','DELIVERY','installation_recorded'],['Sniper','SN-001','DELIVERY','handoff_only'],['Ranger','RAN-001','SWAP','unused_replacement'],['Spotter','SP-001','BACKUP','truck_spare']].map(([family,unitTag,purpose,disposition],i)=>({itemId:uuid(i+2),family,unitTag,purpose,disposition,itVerifiedAt:completed,serviceReceiptAt:completed,itChecks:[{name:'Power',passed:true},{name:'Functions',passed:true},{name:'Safety',passed:true}],rangerFieldUpdateAt:null})),
  heliosChecks:checks,evidence:[{stage:'it',photos:4,signatures:1,signedAt:completed},{stage:'service',photos:0,signatures:1,signedAt:completed},{stage:'helios_install',photos:1,signatures:1,signedAt:completed}],blockers:['IT or Service assignments remain open.'],fieldMapStatus:'pending_exact_link',fieldMapNote:'Native equipment and site linkage is unverified. This evidence does not move or place a Field Map unit.',
}]};}
const harness='<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0}</style></head><body><iframe id="operations" src="/#owner-review"></iframe><script>window.events=[];window.addEventListener("message",e=>{const f=document.querySelector("iframe");if(e.origin!==location.origin||e.source!==f.contentWindow)return;window.events.push(e.data);if(e.data.type==="COS_OPERATIONS_TOKEN_REQUEST")e.source.postMessage({type:"COS_OPERATIONS_TOKEN_RESPONSE",requestId:e.data.requestId,role:"owner",accessToken:"synthetic-owner"},location.origin);});</script></body></html>';
async function open(page,configure=()=>{}){
  const state={snapshot:snapshot(),requests:[],writes:[],fail:false,hold:false,release:null};configure(state);
  await page.clock.install({time:new Date(now)});
  await page.route('**/*',async route=>{
    const req=route.request(),url=req.url();if(url===origin+'/legacy-harness')return route.fulfill({contentType:'text/html',body:harness});if(url.startsWith(origin+'/'))return route.continue();if(url!==edge)return route.abort();
    const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,content-type'};
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
    const envelope=req.postDataJSON();state.requests.push(envelope);if(envelope.method!=='GET'){state.writes.push(envelope);return route.fulfill({status:403,headers,body:'{}'});}
    let data={items:[]};const path=envelope.path;
    if(path==='/api/session')data={authorized:true,role:'Owner',name:'Synthetic Owner',features:{legacyInstallEvidence:true}};
    if(path==='/api/routers')data={items:[],source:'camera_health',gpsAvailable:false,generatedAt:now};
    if(path==='/api/camera-health/summary-v3')data={totalDevices:0,online:0,offline:0,review:0,shopRoot:0,healthRows:0,fieldDevices:0,refreshedAt:now,rows:[]};
    if(path==='/api/owner-review/legacy-evidence'){
      data=structuredClone(state.snapshot);if(state.hold)await new Promise(resolve=>{state.release=resolve;});if(state.fail)return route.fulfill({status:403,headers,contentType:'application/json',body:JSON.stringify({error:'Access unavailable'})});
    }
    return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('/legacy-harness');const frame=page.frameLocator('#operations'),section=frame.getByRole('region',{name:'Legacy installation evidence'});await expect(section).toBeVisible();return {state,frame,section};
}
async function navigate(page,route){await page.frames().find(f=>f.parentFrame()).evaluate(route=>{location.hash=route;},route);}
test('all-family evidence is readable, explicit about gaps and cannot approve billing or place a unit',async({page})=>{
  const {state,section}=await open(page);await expect(section.getByRole('article')).toContainText('mHelpDesk #900101');await expect(section).toContainText('Sniper · SN-001');await expect(section).toContainText('installation completion pending');await expect(section).toContainText('Unused replacement; not installed');await expect(section).toContainText('Truck spare; not proof of installation');await expect(section).toContainText('does not move or place a Field Map unit');
  await expect(section.getByRole('button',{name:/Approve|Billing|Install complete|Save|Place/i})).toHaveCount(0);await expect(section.locator('img,a')).toHaveCount(0);await section.locator('summary').click();await expect(section).toContainText('Synthetic field check 13');await expect(section).toContainText('Helios final installation: 1 photos · 1 signatures');
  const size=await page.frames().find(f=>f.parentFrame()).evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));expect(size.scroll).toBeLessThanOrEqual(size.width+1);expect(state.writes).toHaveLength(0);
});
test('empty, truncated and failed reads are distinct and failed refresh clears old evidence',async({page})=>{
  const {state,section}=await open(page,s=>{s.snapshot.hasMore=true;});await expect(section).toContainText('More recent records exist');state.snapshot.items=[];state.snapshot.hasMore=false;await section.getByRole('button',{name:'Refresh evidence',exact:true}).click();await expect(section).toContainText('No recent saved handoff');state.fail=true;await section.getByRole('button',{name:'Refresh evidence',exact:true}).click();await expect(section.getByRole('alert')).toContainText('unavailable');await expect(section).not.toContainText('No recent saved handoff');await expect(section.getByRole('article')).toHaveCount(0);expect(state.writes).toHaveLength(0);
});
test('close cancels a pending display and ignores the late response',async({page})=>{
  const {state,section}=await open(page,s=>{s.hold=true;});await expect.poll(()=>Boolean(state.release)).toBe(true);await section.getByRole('button',{name:'Close evidence',exact:true}).click();state.release();await expect(section.getByRole('button',{name:'Load recent evidence',exact:true})).toBeVisible();await expect(section.getByRole('article')).toHaveCount(0);state.hold=false;await section.getByRole('button',{name:'Load recent evidence',exact:true}).click();await expect(section.getByRole('article')).toHaveCount(1);expect(state.writes).toHaveLength(0);
});
test('new navigation and Back recheck source rather than restoring saved evidence in history',async({page})=>{
  const {state,section}=await open(page);await expect(section.getByRole('article')).toHaveCount(1);await navigate(page,'jobs');await expect(section).toHaveCount(0);state.snapshot.items=[];await page.frames().find(f=>f.parentFrame()).evaluate(()=>history.back());await expect(section).toBeVisible();await expect(section.getByRole('article')).toHaveCount(0);await expect(section).toContainText('No recent saved handoff');
  const historyState=await page.frames().find(f=>f.parentFrame()).evaluate(()=>JSON.stringify(history.state));expect(historyState||'').not.toContain('900101');expect(state.writes).toHaveLength(0);
});
test('host hiding and subsequent auth denial remove private evidence',async({page})=>{
  const {state,section}=await open(page);await expect(section.getByRole('article')).toHaveCount(1);await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE'},location.origin));await expect(section.getByRole('article')).toHaveCount(0);state.fail=true;await section.getByRole('button',{name:'Load recent evidence',exact:true}).click();await expect(section.getByRole('alert')).toBeVisible();await expect(section.getByRole('article')).toHaveCount(0);
});
test('expired evidence closes locally and reload revalidates the snapshot time',async({page})=>{
  const {state,section}=await open(page);await expect(section.getByRole('article')).toHaveCount(1);await page.clock.fastForward(61000);await expect(section.getByRole('article')).toHaveCount(0);await expect(section.getByRole('alert')).toContainText('one minute');state.snapshot.generatedAt='2099-10-10T12:00:00.000Z';state.snapshot.windowStart='2099-09-10T12:00:00.000Z';await section.getByRole('button',{name:'Load recent evidence',exact:true}).click();await expect(section.getByRole('alert')).toContainText('unavailable');expect(state.writes).toHaveLength(0);
});
test('existing Owner review navigation clears evidence and does not write',async({page})=>{
  const {state,section}=await open(page);await expect(section.getByRole('article')).toHaveCount(1);await section.getByRole('button',{name:'Open existing Owner Tech Check review',exact:true}).click();await expect(section.getByRole('article')).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>window.events.some(e=>e.type==='COS_OPERATIONS_NAVIGATE'&&e.route==='review'))).toBe(true);expect(state.writes).toHaveLength(0);
});

for(const pending of [false,true])test('shared auth invalidation clears '+(pending?'pending':'settled')+' legacy evidence',async({page})=>{
 const {state,section}=await open(page,s=>{s.hold=pending;});
 if(pending)await expect.poll(()=>Boolean(state.release)).toBe(true);else await expect(section.getByRole('article')).toHaveCount(1);
 await page.frames().find(f=>f.parentFrame()).evaluate(()=>dispatchEvent(new Event('cos-private-data-invalidated')));
 if(pending)state.release();
 await expect(section.getByRole('article')).toHaveCount(0);await expect(section.getByRole('alert')).toContainText('current Owner access');
 expect(state.requests.filter(r=>r.path==='/api/owner-review/legacy-evidence')).toHaveLength(1);expect(state.writes).toHaveLength(0);
});
