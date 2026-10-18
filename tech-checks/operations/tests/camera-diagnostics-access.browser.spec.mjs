import {test,expect} from '@playwright/test';
import {readFileSync,existsSync,statSync} from 'node:fs';import {resolve,extname} from 'node:path';import {fileURLToPath} from 'node:url';
import {itHomeFixture} from './it-home-fixture.mjs';import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
const origin='http://127.0.0.1:4173',root=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const read=path=>readFileSync(resolve(root,'tech-checks',path),'utf8');
const owner=`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><div id="appView"><div id="view-owner"><div id="cosOperationsMount"></div><div id="cosOperationsLegacy"></div></div></div><script>window.TechCheckContext={getRole:()=> 'owner',getEffectiveRole:()=> 'owner',getSession:()=>({user:{id:'synthetic-owner'}}),db:{auth:{onAuthStateChange:()=>{},getSession:async()=>({data:{session:{user:{id:'synthetic-owner'},access_token:'synthetic-only'}}})}}};</script><script type="module" src="/operations-host.js"></script>`;
for(const kind of ['owner','verified-it','daily-it'])test(kind+' troubleshooting opens the actual diagnostics tools without bouncing to Fleet',async({page},info)=>{
 test.skip(kind==='daily-it'&&info.project.use.viewport.width<700,'The IT phone workflow is equipment check in/out.');
 const fixture=fieldProductFixture(),role=kind==='owner'?'owner':'it',calls=[];
 await page.clock.setFixedTime(new Date(fixture.now));
 const device={id:11,unit_key:'RANGER 022',device_name:'RANGER 022 / Camera 1',device_type:'camera',monitoring_profile:'ranger',organization:'Synthetic customer',source:'vigilant_control_center',source_status:'online',source_last_seen_at:fixture.fresh,activation_state:'active',public_ip:'192.0.2.11',expected_ports:[80,443]};
 const legacyMock=`window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'synthetic-only'},access_token:'synthetic-only'}}})},rpc:async()=>({data:{fleetRead:true}}),functions:{invoke:async()=>({data:{configured:false}})},from(table){const q={select(){return q},order(){return q},range(){return q},in(){return q},eq(){return q},single(){return q},then(resolve){return Promise.resolve({data:table==='profiles'?{active:true,role:${JSON.stringify(role)}}:table==='camera_devices'?[${JSON.stringify(device)}]:[]}).then(resolve)}};return q}})};`;
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin===origin){
   if(url.pathname==='/diagnostics-host')return route.fulfill({contentType:'text/html',body:kind==='owner'?owner:itHomeFixture('it',true,{dashboard:kind==='daily-it'})});
   if(url.pathname==='/fleet-host-fixture.js')return route.fulfill({contentType:'text/javascript',body:read(kind==='daily-it'?'it-daily-host.js':'verified-it-fleet-host.js')});
   if(url.pathname==='/camera-health.html')return route.fulfill({contentType:'text/html',body:read('camera-health.html').replace('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>','<script>'+legacyMock+'</script>')});
   if(url.pathname==='/operations/dist/index.html')return route.fulfill({status:302,headers:{location:'/'+url.search+'#fleet-dashboard'}});
   const file=resolve(root,'tech-checks','.'+url.pathname);
   if(file.startsWith(root+'/tech-checks/')&&existsSync(file)&&statSync(file).isFile())return route.fulfill({path:file,contentType:{'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.jpg':'image/jpeg','.woff':'font/woff'}[extname(file)]||'application/octet-stream'});
   return route.continue();
  }
  if(url.pathname!=='/functions/v1/cos-operations-pages')return route.abort('blockedbyclient');
  const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization,content-type'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();calls.push(request);
  const data=request.path==='/api/session'?{authorized:true,legacyOwner:kind==='owner',role:kind==='owner'?'Owner':'IT',name:'Synthetic operator',features:{fleetAccess:true}}:request.path==='/api/field-map'?fixture.field:request.path==='/api/camera-health/summary-v3'?fixture.health:request.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:fixture.fresh}:{items:[]};
  return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('/diagnostics-host');if(kind==='verified-it')await page.getByRole('button',{name:'Fleet Dashboard',exact:true}).click();
 const app=page.frameLocator('iframe');await app.locator('.cos-fleet-unit-row').filter({hasText:'Helios 1'}).click();
 await app.locator('.cos-fleet-troubleshooting > summary').click();
 await app.getByRole('button',{name:'Open Camera Health diagnostics',exact:true}).click();
 await expect(page).toHaveURL(/camera-health\.html\?(?:itDaily=1&)?diagnostics=1$/);
 await page.getByRole('button',{name:'Open RANGER 022 unit details',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.locator('.diagnostic-tabs button')).toHaveText(['Connectivity','Cameras','InHand Router','NVR / Recorder','Ports','Logs','Diagnostic report']);
 expect(calls.every(call=>call.method==='GET')).toBe(true);
});
