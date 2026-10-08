// Synthetic, fully intercepted actual-page regression. No live login, provider read, move or geocode.
import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {key,unitNumber,rowId,otherId,historyId,stamp,oldAddress,newAddress,site,legacyState,nativeRow,envelope,healthEnvelope} from './camera-shop-field-restore-fixtures.mjs';

import {resource,snapshot as evidenceSnapshot} from './fixtures/camera-evidence-fixtures.mjs';

const repo=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const origin='http://127.0.0.1:4173';
async function mount(page,{role='owner',verifiedIt=true,active=true,token=true,native=envelope(),health=healthEnvelope(),legacy=legacyState(),holdNative=false,entry='detail'}={}){
  const fixture={native,health,holdNative,status:200,reads:[],geocodes:[],gates:[],unexpected:[],pageErrors:[]};
  page.on('pageerror',error=>fixture.pageErrors.push(error.message));page.context().on('page',other=>other.on('pageerror',error=>fixture.pageErrors.push(error.message)));
  await page.context().addInitScript(({role,verifiedIt,active,token,legacy,key})=>{
    window.fixtureCalls=[];window.fixtureLegacy=legacy;window.fixtureSubject='synthetic-'+role;window.fixtureHoldWrite=false;window.fixtureWriteDenied=false;window.fixtureReadbackMismatch=false;window.fixtureReadCount=0;
    window.fixtureDevice={id:9101,unit_key:key,device_name:'Synthetic provider label, never a destination',device_type:'camera',monitoring_profile:'solarspotter',organization:legacy.placement==='SHOP'?'root':'Synthetic field organization',source_status:'offline',source:'vigilant_control_center',activation_state:legacy.placement==='SHOP'?'deactivated':'active'};
    window.fixtureDevices=[9101,9102,9103,9104].map(id=>({...fixtureDevice,id,device_name:'Synthetic resource '+id}));window.fixtureDevice=fixtureDevices[0];
    window.fixtureDb={
      auth:{getSession:async()=>({data:{session:{user:{id:window.fixtureSubject},...(token?{access_token:'synthetic-only'}:{})}}})},
      functions:{invoke:async()=>({data:{}})},
      async rpc(name,args){
        fixtureCalls.push({name,args});
        if(name==='cos_verified_fleet_capabilities_v1')return {data:{fleetRead:role==='owner'||role==='it'&&verifiedIt,fleetPlacementEdit:role==='it'&&verifiedIt,fleetConnectionEdit:role==='it'&&verifiedIt}};
        if(name==='owner_camera_unit_placement_state_v2'){
          fixtureReadCount++;const state=structuredClone(fixtureLegacy);if(fixtureReadbackMismatch&&fixtureReadCount>=3)state.streetAddress='999 Wrong Synthetic Readback Rd';return {data:state};
        }
        if(name==='owner_set_camera_unit_placement_v2'){
          if(fixtureHoldWrite)await new Promise(resolve=>window.fixtureReleaseWrite=resolve);
          if(fixtureWriteDenied)return {error:{message:'Synthetic writer denied'}};
          fixtureLegacy={...fixtureLegacy,unitKey:args.p_unit_key,placement:args.p_placement,siteLabel:args.p_site_label,streetAddress:args.p_street_address,auditId:'901'};
          for(const device of fixtureDevices){device.organization=args.p_site_label;device.activation_state='active';device.activation_source='owner_location_override_v2';}
          return {data:{ok:true,unit_key:args.p_unit_key,placement:args.p_placement,request_id:args.p_request_id,audit_id:'901'}};
        }
        return {error:{message:'Unexpected fixture RPC '+name}};
      },
      from(table){let singular=false,selectedId=null;const query={select(){return query},eq(field,value){if(field==='id')selectedId=Number(value);return query},in(){return query},ilike(){return query},order(){return query},range(){return query},limit(){return query},single(){singular=true;return query},maybeSingle(){singular=true;return query},then(done){return Promise.resolve({data:table==='profiles'?{active,role}:table==='camera_devices'?(singular?fixtureDevices.find(row=>selectedId===null||row.id===selectedId):fixtureDevices):table==='camera_health_current'?(singular?{}:[]):[]}).then(done)}};return query;}
    };
    window.supabase={createClient:()=>fixtureDb};
  },{role,verifiedIt,active,token,legacy,key});
  await page.context().route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===origin){
      if(url.pathname==='/synthetic-map-entry')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe src="/tech-checks/operations/dist/index.html#field-map?unitLabel=${encodeURIComponent(unitNumber)}"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'owner',accessToken:'synthetic-only'},location.origin)})</script>`});
      const path=resolve(repo,'.'+decodeURIComponent(url.pathname));
      if(path.startsWith(repo+'/')&&existsSync(path))return route.fulfill({path,contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'}[extname(path)]||'application/octet-stream'});
      return route.abort('blockedbyclient');
    }
    const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
    if(url.href==='https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/camera-field-geocode'){
      fixture.geocodes.push({body:request.postDataJSON(),legacyReads:await page.evaluate(()=>fixtureReadCount)});return route.fulfill({headers,contentType:'application/json',body:'{"ok":true}'});
    }
    if(url.pathname==='/functions/v1/cos-operations-pages'){
      const body=request.postDataJSON();fixture.reads.push({body,headers:request.headers()});
      if(!['/api/field-map','/api/camera-health/summary-v3',...(entry==='map'?['/api/session','/api/routers','/api/daily-board','/api/field-map/'+rowId+'/history']:[])].includes(body.path)||body.method!=='GET'){fixture.unexpected.push(body);return route.fulfill({status:400,headers,body:'{}'});}
      const data=structuredClone(body.path==='/api/field-map'?fixture.native:body.path==='/api/camera-health/summary-v3'?fixture.health:body.path==='/api/session'?{authorized:true,name:'Synthetic Owner',role:'Owner',features:{fieldLocationVerification:true}}:body.path==='/api/routers'?{items:[],source:'camera_health',gpsAvailable:false,generatedAt:stamp}:body.path==='/api/daily-board'?{jobs:[],tasks:[],readiness:[],asOf:stamp}:{items:[]}),status=fixture.status;
      if(fixture.holdNative&&body.path==='/api/field-map')await new Promise(resolve=>fixture.gates.push(resolve));
      return route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(data)});
    }
    return route.abort('blockedbyclient');
  });
  await page.goto(origin+(entry==='map'?'/synthetic-map-entry':entry==='health'?'/tech-checks/camera-health.html?unit='+encodeURIComponent(key)+'&action=edit-field':'/tech-checks/camera-detail.html?id=9101'));
  if(entry==='detail')await expect(page.locator('#content')).toBeVisible();else if(entry==='health')await expect(page.locator('.compact-unit')).toHaveCount(1);else await expect(page.frameLocator('iframe').locator('.field-map-workspace')).toBeVisible();return fixture;
}
const inputs=page=>({site:page.locator('.cos-placement-dialog [name=site]'),address:page.locator('.cos-placement-dialog [name=address]'),reason:page.locator('.cos-placement-dialog [name=reason]'),confirmed:page.locator('.cos-placement-dialog [name=confirmed]'),save:page.getByRole('button',{name:'Save placement',exact:true}),cancel:page.getByRole('button',{name:'Cancel',exact:true})});
const mutations=page=>page.evaluate(()=>fixtureCalls.filter(call=>call.name==='owner_set_camera_unit_placement_v2'));
const fieldReads=fixture=>fixture.reads.filter(read=>read.body.path==='/api/field-map');
async function open(page){await expect(page.locator('#moveShopBtn')).toHaveText('Move to Field');await page.locator('#moveShopBtn').click();await expect(page.locator('.cos-placement-dialog')).toBeVisible();}
async function ready(page){const form=inputs(page);await expect(form.save).toBeEnabled();return form;}
async function blank(page){const form=await ready(page);await expect(form.site).toHaveValue('');await expect(form.address).toHaveValue('');await expect(page.locator('.cos-placement-dialog h2')).toHaveText('Move to Field');return form;}
async function complete(page,address=newAddress){const form=await blank(page);await form.site.fill(site);await form.address.fill(address);await form.reason.fill('Synthetic Owner-confirmed reinstallation');await form.confirmed.check();return form;}
async function noWrites(page,fixture){expect(await mutations(page)).toEqual([]);expect(fixture.geocodes).toEqual([]);expect(fixture.unexpected).toEqual([]);expect(fixture.pageErrors).toEqual([]);}
async function held(page,fixture){await expect(page.locator('.placement-feedback')).toContainText(/unavailable|verified|review|refresh|reload|missing|incomplete|changed|disagree|conflict|unresolved/i);await expect(inputs(page).save).toBeDisabled();await noWrites(page,fixture);}

for(const role of ['owner','it'])test(role+' opens stale native/provider FIELD import from the actual Shop action with an explicit blank destination',async({page},info)=>{
  const fixture=await mount(page,{role}),before=structuredClone(fixture.native);await open(page);const form=await blank(page);
  expect(fieldReads(fixture)).toHaveLength(1);expect(fixture.reads.every(read=>read.headers.authorization==='Bearer synthetic-only')).toBe(true);
  const bounds=await page.locator('.cos-placement-dialog').boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(page.viewportSize().width);expect(bounds.height).toBeLessThanOrEqual(page.viewportSize().height);
  await page.screenshot({path:info.outputPath('synthetic-shop-field-'+role+'.png')});await form.cancel.click();await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);expect(fixture.native).toEqual(before);await noWrites(page,fixture);
});

for(const [name,native,health] of [
  ['camera-only SHOP',envelope([],[]),healthEnvelope({unitIdentities:[]})],
  ['blank native SHOP',envelope([nativeRow({status:'available',currentLocationType:'shop',address:''})],[]),healthEnvelope()],
  ['tracker-only stale FIELD',envelope([nativeRow({readOnly:true,currentLocationType:'field'})]),healthEnvelope({unitIdentities:[]})],
  ['stale imported FIELD and site',envelope([nativeRow({site:'Former synthetic import label'})]),healthEnvelope()]
])test(name+' retains a blank explicit new destination',async({page})=>{const fixture=await mount(page,{native,health});await open(page);await blank(page);await page.keyboard.press('Escape');await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);await noWrites(page,fixture);});

for(const address of [newAddress,oldAddress])test('confirmed SHOP reinstallation at '+(address===oldAddress?'the same former address':'a new address')+' writes once after a fresh reread and readback',async({page})=>{
  const fixture=await mount(page),before=structuredClone(fixture.native);await open(page);const form=await complete(page,address);await page.evaluate(()=>fixtureHoldWrite=true);await form.save.click();
  await expect.poll(async()=>(await mutations(page)).length).toBe(1);await expect(form.cancel).toBeDisabled();await expect(form.save).toBeDisabled();await page.keyboard.press('Escape');await expect(page.locator('.cos-placement-dialog')).toBeVisible();
  await page.evaluate(()=>document.querySelector('.cos-placement-dialog form').dispatchEvent(new Event('submit',{cancelable:true})));expect(await mutations(page)).toHaveLength(1);
  expect(fieldReads(fixture)).toHaveLength(2);expect(fixture.reads.filter(read=>read.body.path==='/api/camera-health/summary-v3')).toHaveLength(2);expect(await page.evaluate(()=>fixtureReadCount)).toBe(2);expect(fixture.geocodes).toEqual([]);
  await page.evaluate(()=>fixtureReleaseWrite());await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);const calls=await mutations(page);expect(calls).toHaveLength(1);
  expect(calls[0].args).toMatchObject({p_unit_key:key,p_placement:'FIELD',p_site_label:site,p_street_address:address,p_reason:'Synthetic Owner-confirmed reinstallation',p_expected_audit_id:null});expect(calls[0].args.p_request_id).toMatch(/^[a-f\d-]{36}$/i);
  expect(fixture.geocodes).toEqual([{body:{unitKey:key,auditId:'901'},legacyReads:3}]);expect(fixture.native).toEqual(before);expect(await page.evaluate(()=>fixtureDevice.source_status)).toBe('offline');await expect(page.locator('#moveShopBtn')).toHaveText('Move unit to Shop / ROOT');expect(fixture.pageErrors).toEqual([]);
});

test('site, address, reason and physical-placement checkbox remain mandatory before any reread or write',async({page})=>{
  const fixture=await mount(page);await open(page);const form=await blank(page);for(const fill of [async()=>{},()=>form.site.fill(site),()=>form.address.fill(newAddress),()=>form.reason.fill('Synthetic move reason')]){await fill();await form.save.click();await noWrites(page,fixture);expect(fieldReads(fixture)).toHaveLength(1);}await form.cancel.click();
});

for(const patch of [
  {installedSiteId:otherId},
  {activeJobNumber:'SYNTHETIC-JOB-901'},
  {currentLocationType:'field'},
  {status:'installed',currentLocationType:'site'},
  {locationVerification:'owner_verified',locationHistoryId:historyId,locationVerifiedAt:stamp,latitude:30,longitude:-95},
  {placement:'FIELD',placementSource:'owner',placementUnitKey:key,placementAuditId:'900'}
])test('stronger '+Object.keys(patch).join('/')+' evidence is never erased by the new-destination mode',async({page})=>{
  const fixture=await mount(page,{native:envelope([nativeRow(patch)])});await open(page);if(patch.placementSource==='owner'){await held(page,fixture);}else{const form=await ready(page);await expect(page.locator('.cos-placement-dialog h2')).toHaveText('Update field address');await expect(form.address).toHaveValue(oldAddress);}await noWrites(page,fixture);
});

test('a complete active FIELD retains its current address and unchanged-address no-op even if the camera card says Shop',async({page})=>{
  const fixture=await mount(page,{native:envelope([nativeRow({site,installedSiteId:otherId,status:'installed',currentLocationType:'site'})])});await open(page);const form=await ready(page);await expect(form.address).toHaveValue(oldAddress);await expect(page.locator('.cos-placement-dialog h2')).toHaveText('Update field address');await form.reason.fill('Synthetic unchanged confirmation');await form.confirmed.check();await form.save.click();await expect(page.locator('.placement-feedback')).toContainText(/unchanged|no move/i);await noWrites(page,fixture);
});

for(const [name,change] of [
  ['old source address',fixture=>fixture.native.items[0].address='300 Changed Synthetic Fixture Rd, Testville, TX 77003'],
  ['old source site',fixture=>fixture.native.items[0].site='Changed former synthetic site'],
  ['native install assignment',fixture=>fixture.native.items[0].installedSiteId=otherId],
  ['native source verification',fixture=>fixture.native.items[0].sourceVerifiedAt=stamp],
  ['provider proof',fixture=>fixture.health.unitIdentities[0].proof='b'.repeat(64)],
  ['provider resource group',fixture=>fixture.health.rows.pop()],
  ['native duplicate alias',fixture=>fixture.native.inventoryItems.push(nativeRow({id:otherId,unitNumber:'Solar Spotter - 987654'}))],
  ['identity warning',fixture=>fixture.health.identityWarnings.push({unitId:rowId,reason:'Synthetic warning',deviceIds:['9101'],unitKeys:[key]})],
  ['source outage',fixture=>fixture.status=503]
])test('fresh '+name+' change stops SHOP submission before a mutation',async({page})=>{
  const fixture=await mount(page);await open(page);const form=await complete(page);change(fixture);await form.save.click();await held(page,fixture);expect(fieldReads(fixture)).toHaveLength(2);
});

for(const patch of [{auditId:'899'},{placement:'FIELD'},{canMove:false},{unitKey:'SOLARSPOTTER 987653'}])test('fresh legacy '+Object.keys(patch)[0]+' change prevents a stale SHOP move',async({page})=>{
  const fixture=await mount(page);await open(page);const form=await complete(page);await page.evaluate(patch=>Object.assign(fixtureLegacy,patch),patch);await form.save.click();await held(page,fixture);
});

test('changing the signed-in synthetic account during editing stops the write',async({page})=>{
  const fixture=await mount(page);await open(page);const form=await complete(page);await page.evaluate(()=>fixtureSubject='synthetic-different-owner');await form.save.click();await held(page,fixture);
});

test('cancel and late native reads cannot populate a reopened current editor',async({page})=>{
  const fixture=await mount(page,{holdNative:true});await open(page);await expect.poll(()=>fixture.gates.length).toBe(1);await expect(inputs(page).save).toBeDisabled();await expect(inputs(page).address).toBeDisabled();await inputs(page).cancel.click();
  fixture.holdNative=false;fixture.native=envelope([nativeRow({site,installedSiteId:otherId,status:'installed',currentLocationType:'site',address:newAddress})]);await page.evaluate(()=>fixtureLegacy.placement='FIELD');await open(page);const form=await ready(page);await expect(form.address).toHaveValue(newAddress);fixture.gates.shift()();await expect(form.address).toHaveValue(newAddress);await expect(page.locator('.cos-placement-dialog')).toHaveCount(1);await form.cancel.click();await noWrites(page,fixture);
});

test('a pending fresh read locks duplicate submissions and Cancel until it completes',async({page})=>{
  const fixture=await mount(page);await open(page);const form=await complete(page);fixture.holdNative=true;await form.save.click();await expect.poll(()=>fixture.gates.length).toBe(1);await expect(form.cancel).toBeDisabled();await expect(form.save).toBeDisabled();await page.evaluate(()=>document.querySelector('.cos-placement-dialog form').dispatchEvent(new Event('submit',{cancelable:true})));expect(fieldReads(fixture)).toHaveLength(2);await noWrites(page,fixture);fixture.holdNative=false;fixture.gates.shift()();await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);expect(await mutations(page)).toHaveLength(1);expect(fixture.geocodes).toHaveLength(1);
});

for(const [role,verifiedIt,active] of [['it',false,true],['service',false,true],['owner',true,false]])test(role+' active='+active+' verifiedIT='+verifiedIt+' keeps existing placement permissions',async({page})=>{
  const fixture=await mount(page,{role,verifiedIt,active});await expect(page.locator('#moveShopBtn')).not.toBeVisible();await expect(page.locator('#editFieldBtn')).not.toBeVisible();expect(fixture.reads).toEqual([]);await noWrites(page,fixture);
});

test('a missing bearer never unlocks the Shop form',async({page})=>{const fixture=await mount(page,{token:false});await open(page);await held(page,fixture);expect(fixture.reads).toEqual([]);});

for(const [flag,feedback] of [['fixtureWriteDenied',/Synthetic writer denied/],['fixtureReadbackMismatch',/could not be verified/i]])test(flag+' never replays an uncertain write or starts geocoding',async({page})=>{
  const fixture=await mount(page);await open(page);const form=await complete(page);await page.evaluate(flag=>window[flag]=true,flag);await form.save.click();await expect(page.locator('.placement-feedback')).toContainText(feedback);await expect(form.save).toBeDisabled();await page.evaluate(()=>document.querySelector('.cos-placement-dialog form').dispatchEvent(new Event('submit',{cancelable:true})));expect(await mutations(page)).toHaveLength(1);expect(fixture.geocodes).toEqual([]);await form.cancel.click();await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);
});

const openField=async page=>{await page.locator('#editFieldBtn').click();await expect(page.locator('.cos-placement-dialog')).toBeVisible();return ready(page);};
for(const placement of ['FIELD','UNKNOWN'])for(const [name,patch] of [['missing site',{site:'',address:oldAddress}],['missing address',{site,address:''}],['missing both',{site:'',address:''}]])test(placement+' '+name+' opens actual field editor and saves a complete confirmed destination',async({page})=>{
  const fixture=await mount(page,{legacy:legacyState({placement}),native:envelope([nativeRow(patch)])});const form=await openField(page);await expect(page.locator('.cos-placement-dialog h2')).toHaveText('Update field address');await expect(form.site).toHaveValue(patch.site);await expect(form.address).toHaveValue(patch.address);await expect(page.locator('.placement-pin-note')).toContainText(/incomplete|current site|complete address/i);
  await form.save.click();await noWrites(page,fixture);await form.site.fill(site);await form.address.fill(newAddress);await form.save.click();await noWrites(page,fixture);await form.reason.fill('Synthetic current installation correction');await form.save.click();await noWrites(page,fixture);await form.confirmed.check();await form.save.click();await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);
  expect(await mutations(page)).toHaveLength(1);expect((await mutations(page))[0].args).toMatchObject({p_unit_key:key,p_placement:'FIELD',p_site_label:site,p_street_address:newAddress,p_expected_audit_id:null});expect(fieldReads(fixture)).toHaveLength(2);expect(fixture.geocodes).toEqual([{body:{unitKey:key,auditId:'901'},legacyReads:3}]);expect(fixture.pageErrors).toEqual([]);
});

test('an unverified missing site may be explicitly completed while retaining its same saved address',async({page})=>{
  const fixture=await mount(page,{legacy:legacyState({placement:'FIELD'})});const form=await openField(page);await form.site.fill(site);await form.reason.fill('Synthetic missing-site correction');await form.confirmed.check();await form.save.click();await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);expect(await mutations(page)).toHaveLength(1);expect((await mutations(page))[0].args.p_street_address).toBe(oldAddress);expect(fixture.geocodes).toHaveLength(1);
});

test('a current verified pin remains a no-op for the same address even with missing site',async({page})=>{
  const row=nativeRow({locationVerification:'owner_verified',locationHistoryId:historyId,locationVerifiedAt:stamp,gpsRecordedAt:stamp,latitude:30,longitude:-95,hasUnitGps:true});const fixture=await mount(page,{legacy:legacyState({placement:'FIELD'}),native:envelope([row])}),before=structuredClone(fixture.native);const form=await openField(page);await form.site.fill(site);await form.reason.fill('Synthetic label-only proposal');await form.confirmed.check();await form.save.click();await expect(page.locator('.placement-feedback')).toContainText(/unchanged|no move/i);expect(fixture.native).toEqual(before);await noWrites(page,fixture);
});

for(const [name,patch] of [['malformed address',{address:{unexpected:'object'}}],['malformed site',{site:['unexpected array']}],['placement review',{placementStatus:'needs_identity_review'}]])test('existing FIELD '+name+' remains unavailable through the actual editor',async({page})=>{
  const fixture=await mount(page,{legacy:legacyState({placement:'FIELD'}),native:envelope([nativeRow(patch)])});await page.locator('#editFieldBtn').click();await held(page,fixture);await expect(inputs(page).address).toBeDisabled();
});

for(const [name,change] of [['source shape',fixture=>fixture.native.items[0].address={unexpected:'object'}],['identity review',fixture=>fixture.health.identityWarnings.push({unitId:rowId,reason:'Synthetic new warning',deviceIds:['9101'],unitKeys:[key]})],['source access',fixture=>fixture.status=403]])test('incomplete existing FIELD correction rechecks '+name+' before save',async({page})=>{
  const fixture=await mount(page,{legacy:legacyState({placement:'FIELD'}),native:envelope([nativeRow({site:'',address:''})])});const form=await openField(page);await form.site.fill(site);await form.address.fill(newAddress);await form.reason.fill('Synthetic correction');await form.confirmed.check();change(fixture);await form.save.click();await held(page,fixture);expect(fieldReads(fixture)).toHaveLength(2);
});

test('proved native suffix alias shows saved FIELD data but cannot use the incompatible legacy writer',async({page})=>{
  const row=nativeRow({unitNumber:'Solar Spotter 987654HDC2'}),health=healthEnvelope();health.unitIdentities[0].unitNumber=row.unitNumber;const fixture=await mount(page,{legacy:legacyState({placement:'FIELD'}),native:envelope([row]),health});await page.locator('#editFieldBtn').click();await expect(page.locator('.placement-feedback')).toContainText(/alias|placement-link review/i);await expect(inputs(page).address).toHaveValue(oldAddress);await expect(inputs(page).address).toBeDisabled();await expect(inputs(page).save).toBeDisabled();await noWrites(page,fixture);
});

for(const role of ['owner','it'])test(role+' actual camera-card edit-field deep link opens incomplete matching FIELD data',async({page},info)=>{
  const fixture=await mount(page,{role,legacy:legacyState({placement:'FIELD'}),entry:'health'});await expect(page.locator('#unitDetailTitle')).toHaveText(key);const form=await ready(page);await expect(page.locator('.placement-unit')).toHaveText(key);await expect(form.address).toHaveValue(oldAddress);await expect(form.site).toHaveValue('');await expect(page.locator('.cos-placement-dialog h2')).toHaveText('Update field address');await page.screenshot({path:info.outputPath('synthetic-incomplete-field-'+role+'.png')});await form.cancel.click();await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);await noWrites(page,fixture);
});

test('unverified IT camera-card edit-field deep link does not open an editor',async({page})=>{
  const fixture=await mount(page,{role:'it',verifiedIt:false,legacy:legacyState({placement:'FIELD'}),entry:'health'});await expect(page.locator('#unitDetailTitle')).toHaveText(key);await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);expect(fixture.reads).toEqual([]);await noWrites(page,fixture);
});

test('actual native map marker reaches matching Camera Health resource and its incomplete field editor',async({page},info)=>{
  const row=nativeRow({site:'',locationVerification:'owner_verified',locationHistoryId:historyId,locationVerifiedAt:stamp,gpsRecordedAt:stamp,latitude:30,longitude:-95,hasUnitGps:true,coordinateSource:'unit'}),native=envelope([row]);native.summary={fieldUnits:1,mappedUnits:1,unitGps:1,missingGps:0};
  const rows=[9101,9102,9103,9104].map(id=>resource(id,key));const health={...evidenceSnapshot(rows),identityVersion:1,unitIdentities:healthEnvelope().unitIdentities,identityWarnings:[]};
  const fixture=await mount(page,{entry:'map',legacy:legacyState({placement:'FIELD'}),native,health}),frame=page.frameLocator('iframe');await expect(frame.locator('.cos-field-pin')).toHaveCount(1);await frame.locator('.cos-field-pin').click();await expect(frame.locator('.camera-unit-detail h3')).toHaveText(unitNumber);await expect(frame.locator('.camera-unit-detail')).toContainText('Camera Health unit: '+key);
  const resourceLink=frame.getByRole('link',{name:'Open saved IP / ports ↗',exact:true}).first();await expect(resourceLink).toHaveAttribute('href','../../camera-detail.html?id=9101');const popupPromise=page.waitForEvent('popup');await resourceLink.click();const popup=await popupPromise;await expect(popup.locator('#content')).toBeVisible();await expect(popup.locator('#unitKey')).toHaveText(key);const form=await openField(popup);await expect(form.site).toHaveValue('');await expect(form.address).toHaveValue(oldAddress);await popup.screenshot({path:info.outputPath('synthetic-map-resource-field-editor.png')});await form.cancel.click();await noWrites(popup,fixture);await popup.close();
});
