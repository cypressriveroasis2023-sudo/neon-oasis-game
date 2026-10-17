import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(new URL('../../',import.meta.url).pathname),owner='00000000-0000-4000-8000-000000000003',id='00000000-0000-4000-8000-000000000011',event='00000000-0000-4000-8000-000000000012';
async function mount(page,{role='owner',passed=true,hold=false,lose=false}={}){
 const errors=[],proofs=[];page.on('pageerror',e=>errors.push(e.message));
 const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px Arial;margin:10px}textarea{display:block;width:90%}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{min-height:44px}article{padding:8px}section{overflow-wrap:anywhere}</style><div id="view-owner" data-owner-route="handoffs"><div id="ownerRouteView"><h1>Existing Owner handoffs</h1></div></div><script>
 window.fixture={role:${JSON.stringify(role)},actor:'${owner}',passed:${passed},hold:${hold},lose:${lose},calls:[],listeners:[]};
 const session=()=>({user:{id:fixture.actor},access_token:'synthetic-only'});
 window.TechCheckContext={getRole:()=>fixture.role,getEffectiveRole:()=>fixture.role,getSession:session,getProfile:()=>({user_id:fixture.actor,role:fixture.role,active:true,archived_at:null}),db:{auth:{getSession:async()=>({data:{session:session()}}),onAuthStateChange:fn=>fixture.listeners.push(fn)},rpc:async(name,args={})=>{
 fixture.calls.push({name,args});
 if(name==='owner_techcheck_return_reviews_v6'){if(fixture.hold)await new Promise(resolve=>window.releaseRead=resolve);return {data:{version:6,actor_id:'${owner}',items:[{transfer_id:'${id}',equipment_key:'sniper:001',return_event_id:'${event}',passed:fixture.passed,family:'Sniper',unit_tag:'001',snapshot:{notes:'<script>unsafe text</scr'+'ipt>',checks:{physical_condition_ok:fixture.passed},signature:{name:'Synthetic IT',signed_by:'${id}'}},photos:[]}]}};}
 if(name==='owner_release_techcheck_return_v7'){if(fixture.lose){fixture.lose=false;return {error:{message:'Synthetic response lost'}};}return {data:{id:args.p_request_id,equipment_key:args.p_equipment_key,released:true}};}
 return {error:{message:'Unexpected synthetic call'}};
 }}};
 window.signOut=()=>{fixture.actor=null;fixture.listeners.forEach(fn=>fn('SIGNED_OUT'));};
 </script><script type="module" src="/tech-checks/owner-transfer-review-host.js"></script>`;
 await page.route('**/*',async route=>{const url=new URL(route.request().url());
  if(url.pathname==='/fixture')return route.fulfill({contentType:'text/html',body:html});
  if(url.pathname.endsWith('/cos-operations-pages')){const headers={'access-control-allow-origin':'http://127.0.0.1:4173','access-control-allow-headers':'*'};if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});const body=route.request().postDataJSON();proofs.push(body);return route.fulfill({headers,json:{payload:JSON.stringify(body.body),signature:'a'.repeat(64)}});}
  if(url.pathname.startsWith('/tech-checks/'))return route.fulfill({contentType:'text/javascript',body:await readFile(resolve(root,url.pathname.slice('/tech-checks/'.length)))});
  return route.abort();
 });await page.goto('http://127.0.0.1:4173/fixture');return {errors,proofs};
}
for(const width of [390,1024,1440])test('Owner reviews exact return and obtains current Shop proof before release at '+width,async({page},info)=>{
 await page.setViewportSize({width,height:900});const f=await mount(page);await expect(page.getByRole('heading',{name:'Sniper 001',exact:true})).toBeVisible();await expect(page.getByText('<script>unsafe text</script>',{exact:true})).toBeVisible();
 await page.getByLabel('Inventory review notes for Sniper 001').fill('MHelpDesk inventory reconciled against the signed IT intake.');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Verify Shop & release this unit',exact:true}).click();
 await expect(page.getByText('Inventory review completed. This unit is released to Shop inventory.',{exact:true})).toBeVisible();const calls=await page.evaluate(()=>fixture.calls);const save=calls.find(c=>c.name==='owner_release_techcheck_return_v7');expect(save.args.p_return_event_id).toBe(event);expect(f.proofs[0].body.request_id).toBe(save.args.p_request_id);expect(f.proofs[0].body.purpose).toBe('inventory_release');expect(f.proofs[0].body.items).toEqual([{equipment_key:'sniper:001',family:'Sniper',unit_tag:'001'}]);expect(f.errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('owner-return-'+width+'.png'),fullPage:true});
});
test('repair hold offers no release and other roles never load Owner records',async({page})=>{
 const f=await mount(page,{passed:false});await expect(page.getByText('Repair hold. IT must complete and sign a new physical inspection after repair.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Verify Shop & release this unit'})).toHaveCount(0);expect(f.proofs).toHaveLength(0);
 await page.evaluate(()=>{fixture.role='it';dispatchEvent(new Event('techcheck:view-changed'));});await expect(page.getByRole('region',{name:'Named handoff inventory reviews'})).toHaveCount(0);expect(f.errors).toEqual([]);
});
test('late Owner review read cannot recreate private content after sign-out',async({page})=>{
 const f=await mount(page,{hold:true});await expect.poll(()=>page.evaluate(()=>typeof releaseRead)).toBe('function');await page.evaluate(()=>{signOut();releaseRead();});await expect(page.getByRole('region',{name:'Named handoff inventory reviews'})).toHaveCount(0);expect(f.errors).toEqual([]);
});
test('lost release response freezes signed review details and retries the exact request ID',async({page})=>{
 await mount(page,{lose:true});await page.getByLabel('Inventory review notes for Sniper 001').fill('MHelpDesk inventory reconciled with this exact return.');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Verify Shop & release this unit'}).click();await expect(page.getByRole('button',{name:'Retry same inventory review'})).toBeVisible();await expect(page.getByLabel('Inventory review notes for Sniper 001')).toBeDisabled();await page.getByRole('button',{name:'Retry same inventory review'}).click();await expect(page.getByText('Inventory review completed. This unit is released to Shop inventory.')).toBeVisible();const saves=await page.evaluate(()=>fixture.calls.filter(c=>c.name==='owner_release_techcheck_return_v7'));expect(saves).toHaveLength(2);expect(saves[0].args).toEqual(saves[1].args);
});
