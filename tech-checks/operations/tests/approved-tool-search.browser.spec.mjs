import {test,expect} from '@playwright/test';
import {snapshot,fresh} from './fixtures/camera-evidence-fixtures.mjs';
const origin='http://127.0.0.1:4173';
const owner={authorized:true,legacyOwner:true,role:'Owner',name:'Synthetic Owner',productionOwnerUserId:'11111111-1111-4111-8111-111111111111',features:{fleetAccess:true,unitTracker:true,vrmRead:true,fleetPlacementEdit:false,fieldLocationVerification:false}};

// Full compiled App, existing parent handshake, synthetic read responses only.
// No real sign-in, external request, operational write, or invented unit identity.
async function mount(page,{tracker=true,it=false}={}) {
  const state={calls:[],errors:[],writes:[]};
  page.on('pageerror',error=>state.errors.push(error.message));
  const session={...owner,features:{...owner.features,unitTracker:tracker},...(it?{legacyOwner:false,role:'IT',productionOwnerUserId:null}:{})};
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===origin&&url.pathname==='/approved-tool-search-fixture')return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}header{height:24px;font:12px/24px sans-serif;background:#fff;color:#111;text-align:center}iframe{display:block;width:100%;height:calc(100vh - 24px);border:0}</style></head><body><header>SYNTHETIC TEST — NOT LIVE OPERATIONS</header><iframe title="COS test application" src="/${it?'?mode=fleet':''}#operations"></iframe><script>addEventListener('message',e=>{const f=document.querySelector('iframe');if(e.origin!==location.origin||e.source!==f.contentWindow||e.data?.type!=='COS_OPERATIONS_TOKEN_REQUEST')return;e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'${it?'it':'owner'}',accessToken:'synthetic-test-only'},location.origin)})</script></body></html>`});
    if(url.origin===origin)return route.continue();
    if(!url.pathname.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
    const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
    const body=request.postDataJSON();state.calls.push(body.path);
    if(body.method!=='GET'){state.writes.push(body.path);return route.fulfill({status:400,headers,json:{error:'Synthetic writes prohibited'}});}
    const data=body.path==='/api/session'?session:body.path==='/api/field-map'?{items:[],inventoryItems:[],summary:{fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0},generatedAt:fresh}:body.path==='/api/camera-health/summary-v3'?snapshot([]):body.path==='/api/vrm-fleet'?{items:[],power:[]}:body.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:fresh}:{items:[]};
    return route.fulfill({headers,json:data});
  });
  await page.goto('/approved-tool-search-fixture');
  const app=page.frameLocator('iframe');
  await expect(app.getByText('OPERATIONS CONNECTED',{exact:true})).toBeVisible();
  if(!it)await expect(app.getByRole('searchbox',{name:'Find a tool'})).toBeVisible();
  return {app,state};
}
const directory=app=>app.locator('main').getByRole('region',{name:'Operations workspaces',exact:true});
const safe=state=>{expect(state.errors).toEqual([]);expect(state.writes).toEqual([]);};

test('More search finds existing tools without fetching data and fits the viewport',async({page},info)=>{
  const {app,state}=await mount(page),tools=directory(app),before=state.calls.length;
  await tools.getByRole('searchbox',{name:'Find a tool'}).fill('  POWER  ');
  await expect(tools.getByRole('button',{name:'Victron Power',exact:true})).toBeVisible();
  await expect(tools.locator('.operations-directory-links button')).toHaveCount(1);
  await expect(tools.getByRole('status')).toHaveText('1 tool matches your search.');
  expect(state.calls.length).toBe(before);
  const geometry=await tools.locator('.cos-approved-tool-search').evaluate(element=>{const box=element.getBoundingClientRect();return {x:box.x,right:box.right,width:document.documentElement.clientWidth,input:element.querySelector('input').getBoundingClientRect().height,button:element.querySelector('button').getBoundingClientRect().height};});
  expect(geometry.x).toBeGreaterThanOrEqual(0);expect(geometry.right).toBeLessThanOrEqual(geometry.width+1);expect(geometry.input).toBeGreaterThanOrEqual(48);expect(geometry.button).toBeGreaterThanOrEqual(48);
  await page.screenshot({path:info.outputPath('more-search.png'),fullPage:true});safe(state);
});
test('missing results and Clear preserve focus, groups and tracker eligibility',async({page})=>{
  const {app,state}=await mount(page,{tracker:false}),tools=directory(app),input=tools.getByRole('searchbox',{name:'Find a tool'});
  await input.fill('tracker');await expect(tools.getByRole('status')).toContainText('No tools match');await expect(tools.getByRole('button',{name:'Unit Tracker',exact:true})).toHaveCount(0);
  await tools.getByRole('button',{name:'Clear search',exact:true}).click();await expect(input).toBeFocused();await expect(input).toHaveValue('');await expect(tools.locator('details')).toHaveCount(5);
  await input.fill('[]');await expect(tools.locator('.operations-directory-links button')).toHaveCount(0);await tools.getByRole('button',{name:'Clear search',exact:true}).click();await input.fill('shop inventory');
  await expect(tools.getByRole('button',{name:'Shop inventory',exact:true})).toBeVisible();safe(state);
});
test('primary More selection and responsive drawer keyboard controls remain usable',async({page},info)=>{
  const {app,state}=await mount(page);
  const mobile=info.project.use.viewport.width<=700;
  const nav=app.getByRole('navigation',{name:mobile?'Mobile Operations navigation':'COS Operations',exact:true});
  const more=nav.getByRole('button',{name:'More',exact:true});await expect(more).toHaveClass(/cos-approved-selected/);await expect(more).toHaveCSS('background-color','rgb(200, 13, 36)');
  await expect(nav.getByRole('button')).toHaveCount(4); // Fleet, Tech Check, Team, More
  if(mobile){
    await more.click();const menu=app.getByRole('dialog',{name:'Operations navigation'});await expect(menu).toBeVisible();
    await expect(app.locator('main')).toHaveAttribute('inert','');const input=menu.getByRole('searchbox',{name:'Find a tool'});await input.fill('camera');await expect(menu.getByRole('button',{name:'Camera Health',exact:true})).toBeVisible();
    await input.press('Escape');await expect(menu).toHaveCount(0);await expect(more).toBeFocused();await expect(app.locator('main')).not.toHaveAttribute('inert','');
  }else{await more.click();await expect(directory(app).getByRole('searchbox',{name:'Find a tool'})).toBeVisible();}
  safe(state);
});
test('a search result opens the unchanged exact Camera Health route',async({page})=>{
  const {app,state}=await mount(page),tools=directory(app);await tools.getByRole('searchbox',{name:'Find a tool'}).fill('camera');
  await tools.getByRole('button',{name:'Camera Health',exact:true}).click();await expect.poll(()=>app.locator('body').evaluate(()=>location.hash)).toBe('#camera-health');
  await expect(app.getByRole('region',{name:'COS Fleet Dashboard',exact:true})).toBeVisible();safe(state);
});
test('existing IT-only restrictions never expose Owner More search',async({page})=>{
  const {app,state}=await mount(page,{it:true});await expect.poll(()=>app.locator('body').evaluate(()=>location.hash)).toBe('#fleet-dashboard');
  await expect(app.locator('.cos-approved-shell')).toHaveCount(0);await expect(app.getByRole('searchbox',{name:'Find a tool'})).toHaveCount(0);await expect(app.getByRole('region',{name:'Operations workspaces',exact:true})).toHaveCount(0);safe(state);
});
