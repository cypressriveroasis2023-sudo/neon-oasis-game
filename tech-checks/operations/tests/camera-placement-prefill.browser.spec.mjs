// Regression fixtures only: no real sessions, provider reads, geocoding or operational writes.
// The acceptance address/pin is user-supplied; every resource ID, actor and proof is synthetic.
import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';

const repo=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const origin='http://127.0.0.1:4173';
const address='2045 Spring Cypress Rd, Spring, TX 77388';
const site='Synthetic installation site';
const rowId='11111111-1111-4111-8111-111111111111';
const historyId='22222222-2222-4222-8222-222222222222';
const stamp='2026-10-07T12:00:00.000Z';
const nativeRow=(patch={})=>({id:rowId,unitNumber:'Ranger 001',modelName:'RANGER',status:'field',currentLocationType:'site',installedSiteId:'33333333-3333-4333-8333-333333333333',site,address,addressSource:'Current installation address',addressUpdatedAt:stamp,readOnly:false,recordSource:'Native equipment',hasUnitGps:true,latitude:30.069759,longitude:-95.446072,coordinateSource:'unit',gpsRecordedAt:stamp,locationVerification:'owner_verified',locationVerifiedAt:stamp,locationHistoryId:historyId,locationNote:'Synthetic verified location proof',...patch});
const envelope=(rows=[nativeRow()])=>({items:rows,inventoryItems:rows,placementReviews:[],summary:{fieldUnits:rows.length,mappedUnits:rows.length,unitGps:rows.length,missingGps:0},generatedAt:stamp});
const healthEnvelope=(key='RANGER 001')=>({evidenceVersion:2,identityVersion:1,rows:[{id:11,unit:key,trackerOnly:false}],unitIdentities:[],identityWarnings:[]});
const fieldReads=fixture=>fixture.reads.filter(read=>read.body.path==='/api/field-map');
const legacyState=(key='RANGER 001',patch={})=>({unitKey:key,placement:'FIELD',siteLabel:'',streetAddress:'',auditId:null,canMove:true,...patch});

async function mount(page,{role='owner',verifiedIt=true,organization='Synthetic billing label must never prefill',key='RANGER 001',native=envelope(),legacy=legacyState(key),health=healthEnvelope(key),status=200,token=true,holdNative=false}={}){
  const fixture={native,health,status,holdNative,reads:[],geocodes:[],unexpected:[],gates:[],pageErrors:[]};
  page.on('pageerror',error=>fixture.pageErrors.push(error.message));
  await page.addInitScript(({role,verifiedIt,organization,key,legacy,token})=>{
    window.fixtureCalls=[];window.fixtureLegacy=legacy;window.fixtureSubject='synthetic-'+role;window.fixtureHoldRead=false;window.fixtureHoldWrite=false;window.fixtureWriteDenied=false;window.fixtureReadDenied=false;window.fixtureSaved=[];
    window.fixtureDevice={id:11,unit_key:key,device_name:'Synthetic provider label must never prefill',device_type:'camera',monitoring_profile:'ranger',organization,source_status:'offline',source:'vigilant_control_center',source_last_seen_at:'2026-10-07T12:00:00.000Z',activation_state:'active'};
    window.fixtureDb={
      auth:{getSession:async()=>({data:{session:{user:{id:window.fixtureSubject},...(token?{access_token:'synthetic-only'}:{})}}})},
      functions:{invoke:async()=>({data:{}})},
      async rpc(name,args){
        window.fixtureCalls.push({name,args});
        if(name==='cos_verified_fleet_capabilities_v1')return {data:{fleetRead:role==='owner'||role==='it'&&verifiedIt,fleetPlacementEdit:role==='it'&&verifiedIt,fleetConnectionEdit:role==='it'&&verifiedIt}};
        if(name==='owner_camera_unit_placement_state_v2'){
          const snapshot=structuredClone(window.fixtureLegacy);
          if(window.fixtureHoldRead)await new Promise(resolve=>window.fixtureReleaseRead=resolve);
          return window.fixtureReadDenied?{error:{message:'Synthetic legacy read denied'}}:{data:snapshot};
        }
        if(name==='owner_set_camera_unit_placement_v2'){
          if(window.fixtureHoldWrite)await new Promise(resolve=>window.fixtureReleaseWrite=resolve);
          if(window.fixtureWriteDenied)return {error:{message:'Synthetic mutation denied'}};
          window.fixtureLegacy={...window.fixtureLegacy,unitKey:args.p_unit_key,placement:args.p_placement,siteLabel:args.p_site_label,streetAddress:args.p_street_address,auditId:'101'};
          window.fixtureDevice.organization=args.p_placement==='SHOP'?'root':args.p_site_label;
          window.fixtureDevice.activation_source='owner_location_override_v2';
          return {data:{ok:true,unit_key:args.p_unit_key,placement:args.p_placement,request_id:args.p_request_id,audit_id:'101'}};
        }
        return {error:{message:'Unexpected fixture RPC '+name}};
      },
      from(table){const query={select(){return query},eq(){return query},ilike(){return query},order(){return query},limit(){return query},single(){return query},maybeSingle(){return query},then(done){return Promise.resolve({data:table==='profiles'?{active:true,role}:table==='camera_devices'?window.fixtureDevice:table==='camera_health_current'?{}:[]}).then(done)}};return query;}
    };
    window.supabase={createClient:()=>window.fixtureDb};
  },{role,verifiedIt,organization,key,legacy,token});
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===origin){
      const path=resolve(repo,'.'+decodeURIComponent(url.pathname));
      if(path.startsWith(repo+'/')&&existsSync(path))return route.fulfill({path,contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'}[extname(path)]||'application/octet-stream'});
      return route.abort('blockedbyclient');
    }
    const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
    if(url.href==='https://goqrnolcvqnirjmzaeyk.supabase.co/functions/v1/camera-field-geocode'){
      fixture.geocodes.push(request.postDataJSON());return route.fulfill({headers,contentType:'application/json',body:'{"ok":true}'});
    }
    if(url.pathname==='/functions/v1/cos-operations-pages'){
      const body=request.postDataJSON();fixture.reads.push({body,headers:request.headers()});
      if(!['/api/field-map','/api/camera-health/summary-v3'].includes(body.path)||body.method!=='GET'){fixture.unexpected.push(body);return route.fulfill({status:400,headers,body:'{}'});}
      const data=structuredClone(body.path==='/api/field-map'?fixture.native:fixture.health),status=fixture.status;
      if(fixture.holdNative&&body.path==='/api/field-map')await new Promise(resolve=>fixture.gates.push(resolve));
      if(status===0)return route.abort('failed');
      return route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(data)});
    }
    return route.abort('blockedbyclient');
  });
  await page.goto(origin+'/tech-checks/camera-detail.html?id=11');
  await expect(page.locator('#content')).toBeVisible();
  return fixture;
}
const inputs=page=>({site:page.locator('.cos-placement-dialog [name=site]'),address:page.locator('.cos-placement-dialog [name=address]'),reason:page.locator('.cos-placement-dialog [name=reason]'),confirmed:page.locator('.cos-placement-dialog [name=confirmed]'),save:page.getByRole('button',{name:'Save placement',exact:true}),cancel:page.getByRole('button',{name:'Cancel',exact:true})});
const mutations=page=>page.evaluate(()=>window.fixtureCalls.filter(call=>call.name==='owner_set_camera_unit_placement_v2'));
const legacyReads=page=>page.evaluate(()=>window.fixtureCalls.filter(call=>call.name==='owner_camera_unit_placement_state_v2').length);
async function open(page){await page.locator('#editFieldBtn').click();await expect(page.locator('.cos-placement-dialog')).toBeVisible();}
async function ready(page){const form=inputs(page);await expect(form.save).toBeEnabled();return form;}
async function confirm(page){const form=inputs(page);await form.reason.fill('Synthetic owner-reviewed correction');await form.confirmed.check();return form;}
async function assertNoWrites(page,fixture){expect(await mutations(page)).toEqual([]);expect(fixture.geocodes).toEqual([]);expect(fixture.unexpected).toEqual([]);expect(fixture.pageErrors).toEqual([]);}

for(const role of ['owner','it'])test(role+' prefills the effective Ranger address and cancel preserves the verified pin and proof',async({page},info)=>{
  const fixture=await mount(page,{role});const before=structuredClone(fixture.native);await open(page);const form=await ready(page);
  await expect(form.site).toHaveValue(site);await expect(form.address).toHaveValue(address);
  await expect(page.locator('.cos-placement-dialog h2')).toHaveText('Update field address');
  expect(fieldReads(fixture)).toHaveLength(1);expect(fixture.reads[0].headers.authorization).toBe('Bearer synthetic-only');
  const bounds=await page.locator('.cos-placement-dialog').boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(page.viewportSize().width);expect(bounds.height).toBeLessThanOrEqual(page.viewportSize().height);
  await page.screenshot({path:info.outputPath('ranger-prefilled-'+role+'.png')});
  await form.cancel.click();await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);
  expect(fixture.native).toEqual(before);expect(before.items[0]).toMatchObject({latitude:30.069759,longitude:-95.446072,locationHistoryId:historyId,locationVerification:'owner_verified'});
  await assertNoWrites(page,fixture);
});

test('unchanged effective FIELD site/address and trimming are non-mutating',async({page})=>{
  const fixture=await mount(page);const before=structuredClone(fixture.native);await open(page);const form=await ready(page);
  await form.site.fill('  '+site+'  ');await form.address.fill('  '+address+'  ');await confirm(page);await form.save.click();
  await expect.poll(async()=>await page.locator('.cos-placement-dialog').count()===0||/no change|unchanged|already/i.test(await page.locator('.placement-feedback').textContent())).toBe(true);
  await assertNoWrites(page,fixture);expect(fixture.native).toEqual(before);
});

test('site-only display changes never make a physical move or invalidate proof',async({page})=>{
  const fixture=await mount(page);const before=structuredClone(fixture.native);await open(page);const form=await ready(page);
  await form.site.fill('Synthetic alternate display label');await confirm(page);await form.save.click();
  await expect.poll(async()=>await page.locator('.cos-placement-dialog').count()===0||/no change|unchanged|site|physical|address/i.test(await page.locator('.placement-feedback').textContent())).toBe(true);
  await assertNoWrites(page,fixture);expect(fixture.native).toEqual(before);
});

for(const [name,native,status] of [
  ['empty field map',envelope([]),200],['missing items',{summary:{}},200],['malformed address',envelope([nativeRow({address:{billing:'must not display'}})]),200],
  ['denied',{error:'Synthetic access denied'},403],['unavailable',{error:'Synthetic source unavailable'},503],['network failure',{},0],
  ['duplicate exact aliases',envelope([nativeRow(),nativeRow({id:'44444444-4444-4444-8444-444444444444',unitNumber:'Ranger 1'})]),200],
  ['mismatched family',envelope([nativeRow({unitNumber:'Sniper 001'})]),200],['decimal sibling',envelope([nativeRow({unitNumber:'Ranger 001.1'})]),200],['suffix sibling',envelope([nativeRow({unitNumber:'Ranger 001HDC2'})]),200],
  ['identity review',envelope([nativeRow({placementStatus:'needs_identity_review',placement:'UNKNOWN'})]),200]
])test(name+' fails closed instead of supplying a blank editable source',async({page})=>{
  const fixture=await mount(page,{native,status});await open(page);const form=inputs(page);
  await expect(page.locator('.placement-feedback')).toContainText(/unavailable|verified|review|reload|refresh|failed|denied|could not/i);
  await expect(form.save).toBeDisabled();await expect(form.site).toBeDisabled();await expect(form.address).toBeDisabled();
  await page.evaluate(()=>document.querySelector('.cos-placement-dialog form').dispatchEvent(new Event('submit',{cancelable:true})));
  await assertNoWrites(page,fixture);
});

test('missing bearer cannot create an editable native source',async({page})=>{
  const fixture=await mount(page,{token:false});await open(page);await expect(inputs(page).save).toBeDisabled();
  await expect(page.locator('.placement-feedback')).toContainText(/unavailable|sign in|verified|session/i);expect(fixture.reads).toEqual([]);await assertNoWrites(page,fixture);
});

for(const [role,verifiedIt] of [['it',false],['service',false]])test(role+' without existing verified edit authority has no field editor',async({page})=>{
  const fixture=await mount(page,{role,verifiedIt});await expect(page.locator('#editFieldBtn')).not.toBeVisible();expect(fixture.reads).toEqual([]);await assertNoWrites(page,fixture);
});

test('a pending native read cannot be edited or saved and closing it cannot overwrite a different reopened unit',async({page})=>{
  const fixture=await mount(page,{holdNative:true});await open(page);await expect.poll(()=>fixture.gates.length).toBe(1);const form=inputs(page);
  await expect(form.save).toBeDisabled();await expect(form.site).toBeDisabled();await expect(form.address).toBeDisabled();
  await page.evaluate(()=>CameraPlacementControls.open({db:fixtureDb,key:'RANGER 001',placement:'FIELD'}));await expect(page.locator('.cos-placement-dialog')).toHaveCount(1);
  await form.cancel.click();fixture.holdNative=false;fixture.health=healthEnvelope('SNIPER 203.1');fixture.native=envelope([nativeRow({unitNumber:'Sniper 203.1',site:'Synthetic second site',address:'200 Other Fixture Rd, Houston, TX 77001'})]);
  await page.evaluate(()=>{fixtureLegacy={unitKey:'SNIPER 203.1',placement:'FIELD',siteLabel:'',streetAddress:'',auditId:null,canMove:true};void CameraPlacementControls.open({db:fixtureDb,key:'SNIPER 203.1',placement:'FIELD'});});
  const second=await ready(page);await expect(second.site).toHaveValue('Synthetic second site');fixture.gates.shift()();
  await expect(second.address).toHaveValue('200 Other Fixture Rd, Houston, TX 77001');await expect(page.locator('.placement-unit')).toHaveText('SNIPER 203.1');
  await second.cancel.click();await assertNoWrites(page,fixture);
});

for(const [name,change] of [
  ['native address',native=>{native.items[0].address='201 Changed Fixture Rd, Houston, TX 77001';}],
  ['native identity',native=>{native.items[0].id='55555555-5555-4555-8555-555555555555';}],
  ['native audit',native=>{native.items[0].placementAuditId='99';}],
  ['native location history',native=>{native.items[0].locationHistoryId='66666666-6666-4666-8666-666666666666';}],
  ['native verified pin',native=>{native.items[0].latitude=30.070001;}],
  ['native source outage',(_native,fixture)=>{fixture.status=503;}],
  ['native duplicate alias',native=>{native.items.push(nativeRow({id:'77777777-7777-4777-8777-777777777777',unitNumber:'Ranger 1'}));}]
])test('changing '+name+' while editing blocks a genuine move before mutation',async({page})=>{
  const fixture=await mount(page);await open(page);const form=await ready(page);await form.address.fill('300 Proposed Fixture Rd, Houston, TX 77001');await confirm(page);change(fixture.native,fixture);await form.save.click();
  await expect(page.locator('.placement-feedback')).toContainText(/changed|refresh|reload|unavailable|could not|verified/i);await expect(form.save).toBeDisabled();
  expect(fieldReads(fixture).length).toBeGreaterThanOrEqual(2);await assertNoWrites(page,fixture);
});

for(const patch of [{auditId:'99'},{streetAddress:'201 Changed Fixture Rd, Houston, TX 77001'},{unitKey:'RANGER 002'},{canMove:false}])test('changed legacy '+Object.keys(patch)[0]+' blocks a genuine move before mutation',async({page})=>{
  const fixture=await mount(page);await open(page);const form=await ready(page);await form.address.fill('300 Proposed Fixture Rd, Houston, TX 77001');await confirm(page);
  await page.evaluate(patch=>Object.assign(fixtureLegacy,patch),patch);await form.save.click();
  await expect(page.locator('.placement-feedback')).toContainText(/changed|refresh|reload|verified|could not/i);expect(await legacyReads(page)).toBeGreaterThanOrEqual(2);await assertNoWrites(page,fixture);
});

test('a real address change keeps required confirmation, refetches both states, writes once and verifies before geocoding',async({page})=>{
  const fixture=await mount(page);await open(page);const form=await ready(page);const changed='300 Proposed Fixture Rd, Houston, TX 77001';await form.address.fill(changed);
  await form.save.click();await assertNoWrites(page,fixture);await form.reason.fill('Synthetic physical move');await form.save.click();await assertNoWrites(page,fixture);
  await form.confirmed.check();await page.evaluate(()=>fixtureHoldWrite=true);await form.save.click();
  await expect.poll(async()=>(await mutations(page)).length).toBe(1);await expect(form.cancel).toBeDisabled();await expect(form.save).toBeDisabled();await page.keyboard.press('Escape');await expect(page.locator('.cos-placement-dialog')).toBeVisible();
  await page.evaluate(()=>document.querySelector('.cos-placement-dialog form').dispatchEvent(new Event('submit',{cancelable:true})));expect(await mutations(page)).toHaveLength(1);
  expect(fieldReads(fixture)).toHaveLength(2);expect(await legacyReads(page)).toBe(2);expect(fixture.geocodes).toEqual([]);
  await page.evaluate(()=>fixtureReleaseWrite());await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);
  const calls=await mutations(page);expect(calls).toHaveLength(1);expect(calls[0].args).toMatchObject({p_unit_key:'RANGER 001',p_placement:'FIELD',p_site_label:site,p_street_address:changed,p_expected_audit_id:null});
  expect(await legacyReads(page)).toBe(3);expect(fixture.geocodes).toEqual([{unitKey:'RANGER 001',auditId:'101'}]);expect(fixture.pageErrors).toEqual([]);
});

for(const key of ['SNIPER 203.1','SNIPER 2 031','SOLAR SPOTTER 051HDC2'])test('exact '+key+' prefill excludes same-number family, decimal and suffix neighbors',async({page})=>{
  const neighbors=['RANGER 203.1','SNIPER 203','SNIPER 203.10','SNIPER 203.1HDC2','SNIPER 031','SNIPER 4 031','SOLAR SPOTTER 051','SOLAR SPOTTER 051HDC4'];
  const rows=[nativeRow({unitNumber:key}),...neighbors.map((unitNumber,index)=>nativeRow({id:`aaaaaaaa-aaaa-4aaa-8aaa-${String(index+1).padStart(12,'0')}`,unitNumber,site:'Wrong neighbor',address:'Wrong neighbor address'}))];
  const fixture=await mount(page,{key,native:envelope(rows)});await open(page);const form=await ready(page);await expect(form.site).toHaveValue(site);await expect(form.address).toHaveValue(address);await form.cancel.click();await assertNoWrites(page,fixture);
});

test('latest effective Owner override is shown ahead of stale raw provider/billing metadata',async({page})=>{
  const ownerAddress='400 Owner Fixture Rd, Houston, TX 77001',ownerSite='Synthetic owner override';
  const row=nativeRow({placement:'FIELD',placementSource:'owner',placementUnitKey:'RANGER 001',placementAuditId:'100',placementUpdatedAt:stamp,address:ownerAddress,site:ownerSite});
  const legacy=legacyState('RANGER 001',{auditId:'100',siteLabel:ownerSite,streetAddress:ownerAddress});
  const fixture=await mount(page,{native:envelope([row]),legacy});const before=structuredClone(fixture.native);await open(page);const form=await ready(page);await expect(form.site).toHaveValue(ownerSite);await expect(form.address).toHaveValue(ownerAddress);
  await confirm(page);await form.save.click();await expect.poll(async()=>await page.locator('.cos-placement-dialog').count()===0||/no change|unchanged|already/i.test(await page.locator('.placement-feedback').textContent())).toBe(true);
  await assertNoWrites(page,fixture);expect(fixture.native).toEqual(before);
});

const provedHealth=()=>({...healthEnvelope(),unitIdentities:[{unitId:rowId,unitNumber:'Ranger 001',kind:'native_provider',deviceIds:['11'],unitKeys:['RANGER 001'],proof:'a'.repeat(64)}]});
test('verified identity association remains intact when opening and dismissing the editor',async({page})=>{
  const fixture=await mount(page,{health:provedHealth()});const before=structuredClone(fixture.health);await open(page);const form=await ready(page);await expect(form.address).toHaveValue(address);await page.keyboard.press('Escape');await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);expect(fixture.health).toEqual(before);await assertNoWrites(page,fixture);
});

for(const [name,change] of [
  ['identity proof',health=>{health.unitIdentities[0].proof='b'.repeat(64);}],
  ['resource set',health=>{health.rows.push({id:12,unit:'RANGER 001',trackerOnly:false});}],
  ['resource reassignment',health=>{health.rows[0].unit='RANGER 002';}],
  ['identity warning',health=>{health.identityWarnings.push({unitId:rowId,reason:'Synthetic identity changed',deviceIds:['11'],unitKeys:['RANGER 001']});}]
])test('changed native '+name+' prevents a stale address move',async({page})=>{
  const fixture=await mount(page,{health:provedHealth()});await open(page);const form=await ready(page);await form.address.fill('300 Proposed Fixture Rd, Houston, TX 77001');await confirm(page);change(fixture.health);await form.save.click();
  await expect(page.locator('.placement-feedback')).toContainText(/changed|refresh|reload|verified|review|could not/i);await expect(form.save).toBeDisabled();await assertNoWrites(page,fixture);
});

for(const [name,health] of [
  ['missing health identity version',{rows:[]}],
  ['identity warning',{...provedHealth(),identityWarnings:[{unitId:rowId,reason:'Synthetic identity review',deviceIds:['11'],unitKeys:['RANGER 001']}]}],
  ['competing resource claim',{...provedHealth(),unitIdentities:[...provedHealth().unitIdentities,{unitId:'88888888-8888-4888-8888-888888888888',unitNumber:'Synthetic other unit',kind:'native_provider',deviceIds:['11'],unitKeys:['RANGER 001'],proof:'b'.repeat(64)}]}],
  ['extra provider alias',{...healthEnvelope(),rows:[...healthEnvelope().rows,{id:12,unit:'RANGER 1',trackerOnly:false}]}]
])test(name+' does not authorize editable field metadata',async({page})=>{
  const fixture=await mount(page,{health});await open(page);await expect(page.locator('.placement-feedback')).toContainText(/unavailable|verified|review|reload|could not|incomplete|changed/i);await expect(inputs(page).save).toBeDisabled();await assertNoWrites(page,fixture);
});

test('duplicate inventory alias outside the visible field list blocks a seemingly unique row',async({page})=>{
  const native=envelope();native.inventoryItems=[native.items[0],nativeRow({id:'99999999-9999-4999-8999-999999999999',unitNumber:'Ranger 1',currentLocationType:'shop',status:'available'})];
  const fixture=await mount(page,{native});await open(page);await expect(page.locator('.placement-feedback')).toContainText(/unavailable|verified|review|reload|could not|unique/i);await expect(inputs(page).save).toBeDisabled();await assertNoWrites(page,fixture);
});

test('preflight remains locked under repeated submission and cancellation until source verification completes',async({page})=>{
  const fixture=await mount(page);await open(page);const form=await ready(page);await form.address.fill('300 Proposed Fixture Rd, Houston, TX 77001');await confirm(page);fixture.holdNative=true;await form.save.click();await expect.poll(()=>fixture.gates.length).toBe(1);
  await expect(form.save).toBeDisabled();await expect(form.cancel).toBeDisabled();await page.evaluate(()=>document.querySelector('.cos-placement-dialog form').dispatchEvent(new Event('submit',{cancelable:true})));expect(fieldReads(fixture)).toHaveLength(2);await assertNoWrites(page,fixture);
  fixture.holdNative=false;fixture.gates.shift()();await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);expect(await mutations(page)).toHaveLength(1);expect(fixture.geocodes).toHaveLength(1);
});

test('an uncertain rejected mutation is not replayed or geocoded',async({page})=>{
  const fixture=await mount(page);await open(page);const form=await ready(page);await form.address.fill('300 Proposed Fixture Rd, Houston, TX 77001');await confirm(page);await page.evaluate(()=>fixtureWriteDenied=true);await form.save.click();
  await expect(page.locator('.placement-feedback')).toContainText('Synthetic mutation denied');await expect(form.save).toBeDisabled();await page.evaluate(()=>document.querySelector('.cos-placement-dialog form').dispatchEvent(new Event('submit',{cancelable:true})));expect(await mutations(page)).toHaveLength(1);expect(fixture.geocodes).toEqual([]);await form.cancel.click();await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);
});

for(const placement of ['SHOP','UNKNOWN'])test('effective FIELD unchanged address is safe when legacy placement says '+placement,async({page})=>{
  const fixture=await mount(page,{legacy:legacyState('RANGER 001',{placement})});await open(page);const form=await ready(page);await expect(form.address).toHaveValue(address);await confirm(page);await form.save.click();
  await expect.poll(async()=>await page.locator('.cos-placement-dialog').count()===0||/no change|unchanged|already/i.test(await page.locator('.placement-feedback').textContent())).toBe(true);await assertNoWrites(page,fixture);
});

test('empty field results cannot downgrade a native field inventory row into an editable new destination',async({page})=>{
  const native=envelope();native.items=[];const fixture=await mount(page,{native});await open(page);await expect(page.locator('.placement-feedback')).toContainText(/unavailable|verified|review|reload|inconsistent|disagree|incomplete/i);await expect(inputs(page).save).toBeDisabled();await assertNoWrites(page,fixture);
});

test('changed saved location proof note blocks a genuine move before mutation',async({page})=>{
  const fixture=await mount(page);await open(page);const form=await ready(page);await form.address.fill('300 Proposed Fixture Rd, Houston, TX 77001');await confirm(page);fixture.native.items[0].locationNote='Synthetic corrected location-history proof';await form.save.click();
  await expect(page.locator('.placement-feedback')).toContainText(/changed|refresh|reload|verified|review|could not/i);await expect(form.save).toBeDisabled();await assertNoWrites(page,fixture);
});

test('a known camera-only SHOP unit retains its deliberate move-to-Field workflow',async({page})=>{
  const fixture=await mount(page,{native:envelope([]),legacy:legacyState('RANGER 001',{placement:'SHOP',auditId:'100'}),organization:'ROOT'});await page.locator('#moveShopBtn').click();const form=await ready(page);await expect(form.address).toHaveValue('');await expect(form.site).toHaveValue('');
  await form.site.fill('Synthetic newly installed site');await form.address.fill('500 New Fixture Rd, Houston, TX 77001');await confirm(page);await form.save.click();await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);
  expect(await mutations(page)).toHaveLength(1);expect((await mutations(page))[0].args).toMatchObject({p_unit_key:'RANGER 001',p_expected_audit_id:'100',p_placement:'FIELD'});expect(fixture.geocodes).toHaveLength(1);
});

test('durable suffix alias prefills read-only and cannot move through a differently keyed legacy writer',async({page})=>{
  const row=nativeRow({unitNumber:'Ranger 001HDC2'}),health=provedHealth();health.unitIdentities[0].unitNumber=row.unitNumber;
  const fixture=await mount(page,{native:envelope([row]),health});await open(page);const form=inputs(page);await expect(form.address).toHaveValue(address);await expect(form.site).toHaveValue(site);await expect(form.address).toBeDisabled();await expect(form.save).toBeDisabled();
  await expect(page.locator('.placement-feedback')).toContainText(/identity|different|alias|review|refresh|reload|could not|safe/i);await page.evaluate(()=>document.querySelector('.cos-placement-dialog form').dispatchEvent(new Event('submit',{cancelable:true})));await assertNoWrites(page,fixture);
});

test('missing inventory cannot misclassify an existing FIELD row as camera-only SHOP',async({page})=>{
  const native=envelope();native.inventoryItems=[];const fixture=await mount(page,{native,legacy:legacyState('RANGER 001',{placement:'SHOP',auditId:'100'})});await open(page);
  await expect(page.locator('.placement-feedback')).toContainText(/unavailable|verified|review|reload|inconsistent|disagree|incomplete|missing/i);await expect(inputs(page).save).toBeDisabled();await expect(inputs(page).address).toBeDisabled();await assertNoWrites(page,fixture);
});

test('hash navigation, Back and Forward dismiss stale editors without any save',async({page})=>{
  const fixture=await mount(page,{holdNative:true});await open(page);await expect.poll(()=>fixture.gates.length).toBe(1);
  await page.evaluate(()=>location.hash='synthetic-navigation');await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);fixture.holdNative=false;fixture.gates.shift()();
  await open(page);await ready(page);await page.goBack();await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);
  await open(page);await ready(page);await page.goForward();await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);await assertNoWrites(page,fixture);
});

test('a signed-in subject change during initial loading fails closed',async({page})=>{
  const fixture=await mount(page,{holdNative:true});await open(page);await expect.poll(()=>fixture.gates.length).toBe(1);await page.evaluate(()=>fixtureSubject='synthetic-other-owner');fixture.holdNative=false;fixture.gates.shift()();
  await expect(page.locator('.placement-feedback')).toContainText(/account changed|sign.in|reopen/i);await expect(inputs(page).save).toBeDisabled();await expect(inputs(page).address).toBeDisabled();await assertNoWrites(page,fixture);
});

test('a signed-in subject change after prefill blocks a genuine move',async({page})=>{
  const fixture=await mount(page);await open(page);const form=await ready(page);await form.address.fill('300 Proposed Fixture Rd, Houston, TX 77001');await confirm(page);await page.evaluate(()=>fixtureSubject='synthetic-other-owner');await form.save.click();
  await expect(page.locator('.placement-feedback')).toContainText(/changed|refresh|reopen/i);await expect(form.save).toBeDisabled();await assertNoWrites(page,fixture);
});

test('a late legacy response after cancellation cannot replace another unit prefill',async({page})=>{
  const fixture=await mount(page);await page.evaluate(()=>fixtureHoldRead=true);await open(page);await expect.poll(()=>legacyReads(page)).toBe(1);await page.keyboard.press('Escape');await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);
  fixture.native=envelope([nativeRow({unitNumber:'SNIPER 203.1',site:'Synthetic reopened site',address:'200 Other Fixture Rd, Houston, TX 77001'})]);fixture.health=healthEnvelope('SNIPER 203.1');
  await page.evaluate(()=>{fixtureHoldRead=false;fixtureLegacy={unitKey:'SNIPER 203.1',placement:'FIELD',siteLabel:'',streetAddress:'',auditId:null,canMove:true};void CameraPlacementControls.open({db:fixtureDb,key:'SNIPER 203.1',placement:'FIELD'});});
  const form=await ready(page);await expect(form.site).toHaveValue('Synthetic reopened site');await page.evaluate(()=>fixtureReleaseRead());await expect(form.address).toHaveValue('200 Other Fixture Rd, Houston, TX 77001');await expect(page.locator('.placement-unit')).toHaveText('SNIPER 203.1');await form.cancel.click();await assertNoWrites(page,fixture);
});

for(const phase of ['initial','preflight'])test('a hung '+phase+' legacy read times out safely and unlocks cancellation',async({page})=>{
  const fixture=await mount(page);
  if(phase==='preflight'){await open(page);await ready(page);await inputs(page).address.fill('300 Proposed Fixture Rd, Houston, TX 77001');await confirm(page);}
  await page.evaluate(()=>{const timeout=AbortSignal.timeout.bind(AbortSignal);AbortSignal.timeout=milliseconds=>timeout(Math.min(milliseconds,500));fixtureHoldRead=true;});
  if(phase==='initial')await open(page);else await inputs(page).save.click();
  await expect.poll(()=>legacyReads(page)).toBe(phase==='initial'?1:2);await expect(inputs(page).save).toBeDisabled();
  await expect(page.locator('.placement-feedback')).toContainText(/timed out|timeout|abort|unavailable|refresh/i);await expect(inputs(page).cancel).toBeEnabled();
  await inputs(page).cancel.click();await expect(page.locator('.cos-placement-dialog')).toHaveCount(0);await page.evaluate(()=>fixtureReleaseRead());await assertNoWrites(page,fixture);
});
