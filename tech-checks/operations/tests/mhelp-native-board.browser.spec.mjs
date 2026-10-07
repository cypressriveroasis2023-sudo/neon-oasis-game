import { test, expect } from '@playwright/test';
import { syntheticTicketPdf } from './fixtures/mhelpSyntheticPdf.mjs';
const origin='http://127.0.0.1:4173';
const edge='https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const customer='10000000-0000-4000-8000-000000000001',site='20000000-0000-4000-8000-000000000001';
async function mount(page,authorized=true,importEnabled=true){
  const writes=[];
  await page.route('**/*',route=>{
    const request=route.request(),url=request.url();
    if(url===origin+'/mhelp-native-fixture')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe id="operations" src="/#daily-board" title="Synthetic import board"></iframe><script>addEventListener('message',event=>{const frame=document.getElementById('operations');if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data.type!=='COS_OPERATIONS_TOKEN_REQUEST')return;event.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:event.data.requestId,accessToken:'synthetic-owner-only',role:'owner'},location.origin)});</script>`});
    if(url.startsWith(origin+'/'))return route.continue();
    if(url!==edge)return route.abort();
    const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
    const{method,path,body}=request.postDataJSON();
    const answer=data=>route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
    if(method==='POST'){writes.push({path,body});return route.fulfill({headers,status:503,contentType:'application/json',body:'{"error":"Synthetic backend unavailable"}'});}
    if(path==='/api/session')return answer({authorized,name:'Fixture Owner',role:'Owner',features:{mhelpTicketImport:importEnabled}});
    if(path==='/api/jobs')return answer({items:[]});
    if(path==='/api/owner/control-data')return answer({sites:[],truckChecks:[],itTechnicians:[],serviceTechnicians:[]});
    if(path==='/api/daily-board')return answer({jobs:[],tasks:[],readiness:[],asOf:new Date().toISOString()});
    if(path==='/api/customers')return answer({items:[{id:customer,name:'Fixture Builders',status:'active'}]});
    if(path==='/api/sites')return answer({items:[{id:site,customerId:customer,name:'Fixture Site',addressLine1:'300 Service Road',city:'Example',stateRegion:'TX',postalCode:'77001',status:'active'}]});
    throw new Error('Unexpected synthetic GET '+path);
  });
  await page.goto('/mhelp-native-fixture');
  return{frame:page.frameLocator('#operations'),writes};
}
test('production bundle on native board loads its local PDF worker and preserves responsive review',async({page},info)=>{
  const{frame,writes}=await mount(page);
  const panel=frame.getByRole('region',{name:'mHelpDesk ticket import',exact:true});
  await expect(panel.getByRole('heading',{name:'Import mHelpDesk ticket'})).toBeVisible();
  await panel.locator('input[type=file]').setInputFiles({name:'Ticket123456_999.pdf',mimeType:'application/pdf',buffer:syntheticTicketPdf()});
  await expect(panel.getByRole('heading',{name:'Review Work Order 009001'})).toBeVisible();
  await panel.getByRole('button',{name:'Fixture Builders',exact:true}).click();
  await panel.getByLabel('Existing service site').selectOption(site);
  await expect(panel.getByLabel('Source contact instructions and restrictions')).toHaveValue(/Excluded Person/);
  await expect(panel.getByLabel('Work instructions',{exact:true})).not.toHaveValue(/Excluded Person/);
  expect(await frame.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(writes).toEqual([]);
  await page.screenshot({path:info.outputPath('mhelp-native-review.png'),fullPage:true});
});
test('unauthorized native board never exposes PDF import or source history',async({page})=>{
  const{frame,writes}=await mount(page,false);
  await expect(frame.getByRole('heading',{name:'Operations access needs attention'})).toBeVisible();
  await expect(frame.getByRole('heading',{name:'Import mHelpDesk ticket'})).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('native board with an older backend never exposes import actions before capability is enabled',async({page})=>{
 const {frame,writes}=await mount(page,true,false);
 await expect(frame.getByText('OPERATIONS CONNECTED',{exact:true})).toBeVisible();
 await expect(frame.getByRole('heading',{name:'Import mHelpDesk ticket',exact:true})).toHaveCount(0);
 expect(writes).toEqual([]);
});
