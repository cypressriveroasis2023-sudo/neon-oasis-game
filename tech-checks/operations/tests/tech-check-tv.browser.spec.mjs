import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Both the host and board are real built code. All backend traffic is synthetic.
const origin = 'http://127.0.0.1:4173';
const edge = 'https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const time = '2026-10-12T15:00:00Z';
const cors = {'access-control-allow-origin': origin};
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const harness = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}iframe{width:100%;height:600px;border:0}.hidden{display:none}</style></head><body><header id="hostToolbar">Host tools</header><div id="appView"><div id="view-owner"><div id="cosOperationsMount"></div><div id="cosOperationsLegacy"></div></div></div><script>window.TechCheckContext={getRole:()=>"owner",getEffectiveRole:()=>"owner",getSession:()=>({user:{id:"fixture-owner"}}),db:{auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session:{user:{id:"fixture-owner"},access_token:"synthetic-owner-session"}}})}}};</script><script type="module" src="/operations-host.js"></script></body></html>`;
async function setup(page, { many = false } = {}) {
  const state = { fail: 0, reads: 0, writes: [], tasks: [{id:'task-1',title:'Shop work update',instructions:'Inspect the return rack',assignedTo:'Tech 1',assignedDepartment:'it',status:'assigned',priority:'high'}], jobs: many ? Array.from({length:10}, (_, index) => ({id:'job-'+index,customer:'Work '+index,technician:'Tech '+index,department:'it',status:'assigned'})) : [], readiness: [] };
  await page.clock.install({ time: new Date(time) });
  state.settings={sections:['shop'],revision:0,updatedAt:null};state.fleetReads=0;
  if(many)state.tasks.push(...Array.from({length:10},(_,index)=>({id:'extra-'+index,title:'More shop work '+index,assignedTo:'Tech '+index,assignedDepartment:'it',status:'assigned',priority:'medium'})));
  const unit={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',unitNumber:'Sniper 312',modelName:'SNIPER',status:'installed',site:'Fixture field site',address:'19017 Lee Rd, Humble, TX 77032',latitude:29.986,longitude:-95.311,locationVerification:'owner_verified',locationVerifiedAt:time,gpsRecordedAt:time};
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if(url.origin===origin){
      if(url.pathname==='/tv-harness')return route.fulfill({contentType:'text/html',body:harness});
      if(url.pathname==='/operations-host.js')return route.fulfill({contentType:'application/javascript',body:await readFile(new URL('../../operations-host.js',import.meta.url),'utf8')});
      if(url.pathname==='/field-map-display-host.js')return route.fulfill({contentType:'application/javascript',body:await readFile(new URL('../../field-map-display-host.js',import.meta.url),'utf8')});
      if(url.pathname.startsWith('/operations/dist/'))return route.fulfill({path:dist+url.pathname.slice('/operations/dist/'.length)});
      return route.continue();
    }
    if(url.href!==edge)return route.abort('blockedbyclient');
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'}});
    const {path,method,body}=request.postDataJSON();
    expect(await request.headerValue('authorization')).toBe('Bearer synthetic-owner-session');
    if(path==='/api/tv-board/settings'){
      if(method==='POST'){
        state.writes.push({path,method,body});
        if(body.expectedRevision!==state.settings.revision)return route.fulfill({status:409,headers:cors,json:{error:'Settings changed. Refresh before saving.'}});
        state.settings={sections:body.sections,revision:state.settings.revision+1,updatedAt:time};
      }
      return route.fulfill({headers:cors,json:state.settings});
    }
    if(method!=='GET'){state.writes.push({path,method,body});return route.fulfill({status:403,headers:cors,json:{error:'Display cannot write'}});}
    if(path==='/api/daily-board'){
      state.reads++;
      if(state.fail)return route.fulfill({status:state.fail,headers:cors,json:{error:state.fail===401?'Sign-in required':'Connection unavailable'}});
      return route.fulfill({headers:cors,json:{jobs:state.jobs,tasks:state.tasks,readiness:state.readiness,asOf:time}});
    }
    if(path==='/api/field-map'){state.fleetReads++;return route.fulfill({headers:cors,json:{items:[unit],summary:{fieldUnits:1,mappedUnits:1,unitGps:1,missingGps:0},generatedAt:time}});}
    if(path==='/api/routers'){state.fleetReads++;return route.fulfill({headers:cors,json:{items:[],generatedAt:time,source:'camera_health',gpsAvailable:false}});}
    if(path==='/api/camera-health/summary-v3'){state.fleetReads++;return route.fulfill({headers:cors,json:{totalDevices:1,online:1,offline:0,review:0,shopRoot:0,healthRows:1,fieldDevices:1,refreshedAt:time,evidenceVersion:2,inventory:{allRecords:1,activeFieldRecords:1,activeShopRecords:0,inactiveRecords:0,unknownScopeRecords:0},rows:[{id:'fixture-resource',name:'Sniper 312 connection',unit:'Sniper 312',status:'online',scope:'field',activationState:'active',serviceEvidence:{kind:'service_port',source:'Saved connection',status:'online',active:true,resource:'service',observedAt:time,lastOnlineAt:time,reachable:true}}]}});}
    return route.fulfill({headers:cors,json:path==='/api/session'?{authorized:true,name:'Fixture Owner',role:'Owner',features:{}}:{items:[]}});
  });
  await page.goto('/tv-harness?tvBoard=1');
  const frame=page.frameLocator('#cosOperationsFrame');
  await expect(frame.getByRole('region',{name:'Tech Check TV Board'})).toBeVisible();
  await expect(frame.getByText('Inspect the return rack',{exact:true})).toBeVisible();
  return {state,frame};
}

test('TV link fills the host and sees a saved update without a remote desktop connection', async ({page}, testInfo) => {
  const {state,frame}=await setup(page);
  await expect(page.locator('#hostToolbar')).toBeHidden();
  await expect(frame.getByRole('button',{name:'Save Schedule & Assignment'})).toHaveCount(0);
  state.tasks[0].instructions='The return rack is ready';
  await page.clock.fastForward(60000);
  await expect(frame.getByText('The return rack is ready',{exact:true})).toBeVisible();
  expect(state.reads).toBeGreaterThanOrEqual(2);
  await page.reload();
  await expect(frame.getByRole('region',{name:'Tech Check TV Board'})).toBeVisible();
  await expect(frame.getByText('The return rack is ready',{exact:true})).toBeVisible();
  expect(state.writes).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('tech-check-tv.png')});
  await frame.getByRole('button',{name:'Exit TV',exact:true}).click();
  await expect(page.locator('#hostToolbar')).toBeVisible();
  await expect(frame.getByRole('region',{name:'COS Daily Board'})).toBeVisible();
  expect(new URL(page.url()).searchParams.has('tvBoard')).toBe(false);
});

test('TV rotates all technician groups without document scrolling', async ({page}) => {
  const {state,frame}=await setup(page,{many:true});
  const board=frame.getByRole('region',{name:'Tech Check TV Board'});
  const first=await board.getAttribute('data-page');
  await page.clock.fastForward(15000);
  await expect(board).not.toHaveAttribute('data-page',first);
  expect(await board.evaluate(node=>node.scrollHeight<=node.clientHeight+1&&node.scrollWidth<=node.clientWidth+1)).toBe(true);
  expect(state.writes).toEqual([]);
});

test('network failure marks delayed data and authentication failure clears private cards', async ({page}) => {
  const {state,frame}=await setup(page);
  state.fail=503;
  await frame.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(frame.getByRole('alert')).toContainText('UPDATES DELAYED');
  await expect(frame.getByText('Inspect the return rack',{exact:true})).toBeVisible();
  state.fail=401;
  await frame.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(frame.getByRole('alert')).toContainText('BOARD UNAVAILABLE');
  await expect(frame.getByText('Inspect the return rack',{exact:true})).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

test('remote choices rotate all pending types, including future and unscheduled jobs',async({page})=>{
 const {state,frame}=await setup(page);
 state.jobs=['PICKUP','SWAP','DELIVERY','SERVICE'].map((jobType,index)=>({id:'pending-'+index,customer:'Pending '+jobType,jobType,status:'scheduled',scheduled:index%2?'':'2026-11-01 08:00',instructions:'Saved '+jobType+' instructions'}));
 state.settings={sections:['pickup','swap','delivery','service'],revision:1,updatedAt:time};
 await page.clock.fastForward(60000);
 for(const [index,key] of ['pickup','swap','delivery','service'].entries()){
  if(index)await page.clock.fastForward(15000);
  await expect(frame.getByRole('region',{name:'Tech Check TV Board'})).toHaveAttribute('data-section',key);
  await expect(frame.getByText('Pending '+key.toUpperCase(),{exact:true})).toBeVisible();
 }
 expect(state.writes).toEqual([]);
});

test('Owner saves switches and can turn every TV section off without changing work records',async({page})=>{
 const {state,frame}=await setup(page);
 await frame.getByRole('button',{name:'Exit TV',exact:true}).click();
 const controls=frame.getByRole('region',{name:'TV board settings'});
 await controls.getByRole('checkbox',{name:'Pending pickups',exact:true}).check();
 await controls.getByRole('button',{name:'Save TV sections',exact:true}).click();
 await expect(controls.getByText('TV sections saved and verified.',{exact:true})).toBeVisible();
 expect(state.settings.sections).toEqual(['pickup','shop']);
 await controls.getByRole('checkbox',{name:'Pending pickups',exact:true}).uncheck();await controls.getByRole('checkbox',{name:'Shop updates',exact:true}).uncheck();
 await controls.getByRole('button',{name:'Save TV sections',exact:true}).click();
 await expect(controls.getByText('TV sections saved and verified.',{exact:true})).toBeVisible();
 await frame.getByRole('button',{name:'TV View',exact:true}).click();
 await expect(frame.getByText('TV sections turned off',{exact:true})).toBeVisible();
 expect(state.writes.every(write=>write.path==='/api/tv-board/settings')).toBe(true);
});

test('Teddy and Victor have no inspection fields and Camera Health rotates with the verified map',async({page},testInfo)=>{
 const {state,frame}=await setup(page);
 state.readiness=['Teddy Hopper','Victor Garcia'].map((name,index)=>({userId:'staff-'+index,name,department:'it',status:'not_started',result:{}}));
 state.settings={sections:['readiness'],revision:1,updatedAt:time};await page.clock.fastForward(60000);
 await expect(frame.getByText('No company vehicle · truck and trailer inspections do not apply.').first()).toBeVisible();
 await expect(frame.getByText('Truck inspection',{exact:true})).toHaveCount(0);await expect(frame.getByText('Trailer inspection',{exact:true})).toHaveCount(0);
 state.settings={sections:['camera','map'],revision:2,updatedAt:time};await page.clock.fastForward(60000);
 await expect(frame.getByRole('region',{name:'Tech Check TV Board'})).toHaveAttribute('data-section','camera');
 await expect(frame.getByText('19017 Lee Rd, Humble, TX 77032',{exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('tv-camera-health.png')});
 const reads=state.fleetReads;expect(reads).toBe(3);await page.clock.fastForward(15000);
 await expect(frame.getByRole('region',{name:'Tech Check TV Board'})).toHaveAttribute('data-section','map');
 await expect(frame.locator('.tv-fleet-map .leaflet-marker-icon')).toHaveCount(1);
 await page.screenshot({path:testInfo.outputPath('tv-field-map.png')});
 await page.clock.fastForward(60000);expect(state.fleetReads).toBe(reads);
 await frame.getByRole('button',{name:'Refresh',exact:true}).click();
 try{await expect.poll(()=>state.fleetReads).toBe(reads+3);}finally{console.log('TV refresh diagnostic',JSON.stringify({reads:state.fleetReads,refresh:await frame.getByRole('region',{name:'Tech Check TV Board'}).getAttribute('data-fleet-refresh'),enabled:await frame.locator('.tv-fleet-view').getAttribute('data-enabled'),running:await frame.locator('.tv-fleet-view').getAttribute('data-running')}));}
 state.fail=401;await frame.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(frame.locator('.tv-fleet-map .leaflet-marker-icon')).toHaveCount(0);
});
