import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {deliveryFixture} from './helpers/transfer-delivery-fixture.mjs';
const root=new URL('../../',import.meta.url).pathname;
async function mount(page,{held=false,missing=false,failed=false,delay=0}={}){
 const delivery=deliveryFixture(),e=delivery.events[1],receipt={event_id:e.id,receipt_revision:2,transfer_id:delivery.transfer_id,transfer_revision:2,snapshot:e.snapshot,remaining:e.snapshot.actual,photos:e.photos};
 const errors=[],calls=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px Arial;margin:16px}article{overflow-wrap:anywhere}input,button{min-height:44px}canvas{max-width:100%}</style><main id="review"></main><button id="complete">Complete</button><p id="result"></p><script type="module">
   import {mountDailyReceiptReview} from '/service-receipts-ui.js';
   import {newSignature} from '/service-signoff-ui.js';
   window.fixture={actor:${JSON.stringify(delivery.service_actor)},draft:{signature:newSignature()},changes:0};
   const original=fixture.actor;
   const context={getSession:()=>({user:{id:fixture.actor}}),getRole:()=> 'service',getProfile:()=>({user_id:fixture.actor,active:true,role:'service',full_name:'Synthetic Service technician'}),db:{rpc:async(name)=>{const r=await fetch('/rpc/'+name);return r.json();}}};
   const review=mountDailyReceiptReview(document.querySelector('#review'),{context,draft:fixture.draft,isCurrent:()=>fixture.actor===original,isBusy:()=>false,onChange:()=>fixture.changes++});
   document.querySelector('#complete').onclick=()=>{try{document.querySelector('#result').textContent=JSON.stringify(review.submission());}catch(e){document.querySelector('#result').textContent=e.message;}};
  </script>`});
  if(url.pathname.startsWith('/rpc/')){
   const name=url.pathname.split('/').at(-1);calls.push(name);if(delay)await new Promise(r=>setTimeout(r,delay));
   if(name==='techcheck_transfer_readiness_v1')return route.fulfill({json:missing?{error:{code:'PGRST202'}}:{data:{version:1,actor_id:delivery.service_actor,role:'service',ready:!held,enabled:!held,dependencies:{read:true,submit:true,privateEvidence:true},release:{reports:!held,receiptLink:!held,custody:!held}}}});
   if(name==='techcheck_daily_receipts_v5')return route.fulfill({json:failed?{error:{message:'Synthetic unavailable'}}:{data:{version:5,actor_id:delivery.service_actor,receipts:[receipt]}}});
   return route.abort();
  }
  const path=resolve(root,'.'+url.pathname);if(!path.startsWith(root)||!['.js'].includes(extname(path)))return route.abort();
  try{return route.fulfill({contentType:'text/javascript',body:await readFile(path)});}catch{return route.abort();}
 });
 await page.goto('http://127.0.0.1:4173/');return {errors,calls,receipt};
}
for(const width of [390,1024,1440]){
 test('daily sign-off shows exact receipt and revision and requires review at '+width,async({page},info)=>{
  await page.setViewportSize({width,height:900});const f=await mount(page);
  await expect(page.getByRole('heading',{name:'Equipment receipts included in this sign-off'})).toBeVisible();await expect(page.locator('article')).toContainText(f.receipt.event_id);await expect(page.locator('article')).toContainText('receipt revision 2');await expect(page.locator('article')).toContainText('00123456789012345670');
  await page.getByRole('button',{name:'Complete',exact:true}).click();await expect(page.locator('#result')).toContainText('Review and confirm');
  await page.getByRole('checkbox',{name:'I reviewed the linked equipment receipts',exact:true}).check();await page.getByRole('radio',{name:'Type signature',exact:true}).check();await page.getByRole('textbox',{name:'Type your full name'}).fill('Synthetic Service technician');await page.getByRole('checkbox',{name:'I confirm this report is accurate',exact:true}).check();
  await page.getByRole('button',{name:'Complete',exact:true}).click();await expect(page.locator('#result')).toContainText('complete_service_daily_report_v5');await expect(page.locator('#result')).toContainText(f.receipt.event_id);
  await page.getByRole('checkbox',{name:'I reviewed the linked equipment receipts',exact:true}).uncheck();await expect(page.getByRole('checkbox',{name:'I confirm this report is accurate',exact:true})).not.toBeChecked();
  expect(f.calls).toEqual(['techcheck_transfer_readiness_v1','techcheck_daily_receipts_v5']);expect(f.errors).toEqual([]);await page.screenshot({path:info.outputPath('daily-receipt-review-'+width+'.png'),fullPage:true});
 });
}
test('held or uninstalled handoffs preserve ordinary daily sign-off without reading receipts',async({page})=>{
 for(const options of [{held:true},{missing:true}]){
  const f=await mount(page,options);await expect(page.getByRole('heading',{name:'Technician signature'})).toBeVisible();await expect(page.locator('article')).toHaveCount(0);await page.locator('#complete').click();await expect(page.locator('#result')).toContainText('complete_service_daily_report_v4');expect(f.calls).toEqual(['techcheck_transfer_readiness_v1']);expect(f.errors).toEqual([]);await page.unroute('**/*');
 }
});
test('failed receipt read and account change cannot use a stale signed receipt list',async({page})=>{
 const f=await mount(page,{failed:true});await expect(page.getByRole('button',{name:'Reload equipment receipts'})).toBeVisible();await page.locator('#complete').click();await expect(page.locator('#result')).toContainText('reload');expect(f.errors).toEqual([]);
 await page.unroute('**/*');const current=await mount(page,{delay:100});await page.evaluate(()=>{fixture.actor='another-account';});await page.waitForTimeout(350);await expect(page.locator('article')).toHaveCount(0);await page.locator('#complete').click();await expect(page.locator('#result')).toContainText('account changed');expect(current.errors).toEqual([]);
});
