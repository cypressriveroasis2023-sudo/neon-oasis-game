import {test,expect} from '@playwright/test';
import {existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const origin='http://127.0.0.1:4173',dist=resolve(fileURLToPath(new URL('../dist',import.meta.url)));
const workbook='1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA',email='cos-unit-tracker@synthetic-fixture.iam.gserviceaccount.com';
const tabs=[[568394918,'SOLAR SPOTTERS'],[2017346590,'SPOTTERS'],[426115083,'HELIOS'],[386511683,'RANGERS'],[826256700,'SNIPERS'],[651684134,'CAM V & RSU'],[451969219,'RECONS'],[135363149,'RECON II'],[1975227208,'SOLAR STANDS 72'],[828079282,'SOLAR POLES & SKIDS']];
const status=configured=>({contract:'cos-google-sheets-connection-v1',workbookId:workbook,state:configured?'ready_to_test':'setup_required',credentialConfigured:configured,serviceAccountEmail:configured?email:null,readAccessVerified:false,checkedAt:null,mode:'read_only',sheetsPublisher:false,automaticSync:false,equipmentRows:0,duplicateLabelRows:0,formulaRows:0,placementReviewRows:0,tabs:[]});
const checked=()=>({...status(true),state:'read_access_verified',readAccessVerified:true,checkedAt:'2026-10-09T19:00:00Z',equipmentRows:20,tabs:tabs.map(([tabId,title])=>({tabId,title,equipmentRows:2,formulaRows:0,placementReviewRows:0}))});
async function mount(page,{role='owner',configured=false,fail=false,malformed=false,hold=false}={}){
 const requests=[],errors=[];let release;const held=new Promise(r=>release=r);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url===origin+'/sheets-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe src="/${role==='owner'?'':'?mode=fleet'}#unit-tracker"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:${JSON.stringify(role)},accessToken:'synthetic-only'},location.origin)})</script>`});
  if(url.startsWith(origin+'/')){const path=resolve(dist,new URL(url).pathname==='/'?'index.html':'.'+decodeURIComponent(new URL(url).pathname));if(path.startsWith(dist+'/')&&existsSync(path))return route.fulfill({path,contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff':'font/woff'}[extname(path)]||'application/octet-stream'});return route.abort();}
  if(!url.endsWith('/functions/v1/cos-operations-pages'))return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const req=route.request().postDataJSON();requests.push(req);
  const answer=(data,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(data)});
  if(req.path==='/api/session')return answer({authorized:true,legacyOwner:role==='owner',role:role==='owner'?'Owner':'IT',name:'Synthetic',features:{fleetAccess:true,unitTracker:true}});
  if(req.path==='/api/field-map')return answer({items:[],inventoryItems:[],summary:{fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0},generatedAt:'2026-10-09T19:00:00Z'});
  if(req.path==='/api/unit-tracker')return answer({contract:'COS_UNIT_TRACKER_OUTBOX_V1',workbookId:workbook,connector:{enabled:false,state:'awaiting_sheets_connection'},queueEnabled:false,availability:'unavailable',sources:[],requests:[],sourcesTruncated:false,requestsTruncated:false,sourcesHeld:0});
  if(req.path==='/api/unit-tracker/sheets/status')return answer(status(configured));
  if(req.path==='/api/unit-tracker/sheets/check'){if(hold)await held;return fail?answer({error:'Enable the Google Sheets API and share the 2027 tracker with the service-account email shown here.'},503):answer(malformed?{...checked(),tabs:[]}:checked());}
  return answer({items:[]});
 });
 await page.goto('/sheets-fixture');const frame=page.frameLocator('iframe'),workspace=frame.getByRole('region',{name:'Unit Tracker workspace',exact:true});await expect(workspace).toBeVisible();
 return {frame,panel:workspace.getByRole('region',{name:'Sheets connection status',exact:true}),requests,errors,release};
}
test('missing Google authorization shows actionable setup without pretending to be connected',async({page})=>{
 const f=await mount(page);await f.panel.getByRole('button',{name:'Check Sheets connection',exact:true}).click();await expect(f.panel).toContainText('Google authorization is needed for COS');await expect(f.panel.getByRole('link',{name:'Connection setup'})).toHaveAttribute('href',/google-sheets-connection.md/);await expect(f.panel).not.toContainText('read access verified');expect(f.requests.filter(r=>r.path==='/api/unit-tracker/sheets/check')).toHaveLength(0);expect(f.errors).toEqual([]);
});
test('verified read access displays all equipment tabs and keeps publishing paused',async({page})=>{
 const f=await mount(page,{configured:true,hold:true});const button=f.panel.getByRole('button',{name:'Check Sheets connection',exact:true});await button.click();await expect(f.panel.getByRole('button',{name:'Checking Sheets…'})).toBeDisabled();f.release();await expect(f.panel).toContainText('Google Sheets read access verified');await expect(f.panel).toContainText('20 equipment rows across 10 equipment tabs');await expect(f.panel).toContainText('Publishing changes and automatic fleet updates are still pending');await f.panel.getByText('Equipment tabs checked',{exact:true}).click();await expect(f.panel.locator('li')).toHaveCount(10);expect(f.requests.filter(r=>r.path==='/api/unit-tracker/sheets/check')).toHaveLength(1);expect(f.requests.filter(r=>r.method==='POST'&&!r.path.endsWith('/sheets/check'))).toHaveLength(0);const dimensions=await page.locator('iframe').evaluate(el=>({width:el.contentWindow.innerWidth,scroll:el.contentDocument.documentElement.scrollWidth}));expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width+1);expect(f.errors).toEqual([]);
});
for(const fail of [true,false])test('failed or incomplete checks retain the sharing email without a connected state '+fail,async({page})=>{
 const f=await mount(page,{configured:true,fail,malformed:!fail});await f.panel.getByRole('button',{name:'Check Sheets connection',exact:true}).click();await expect(f.panel.getByRole('alert')).toBeVisible();await expect(f.panel).toContainText(email);await expect(f.panel).not.toContainText('read access verified');expect(f.errors).toEqual([]);
});
test('verified IT users keep their tracker access without an Owner Google setup control',async({page})=>{
 const f=await mount(page,{role:'it'});await expect(f.panel.getByRole('link',{name:'Open 2027 tracker'})).toBeVisible();await expect(f.panel.getByRole('button',{name:'Check Sheets connection'})).toHaveCount(0);expect(f.requests.filter(r=>r.path.includes('/sheets/'))).toHaveLength(0);expect(f.errors).toEqual([]);
});
