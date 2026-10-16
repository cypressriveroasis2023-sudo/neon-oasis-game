import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {cameraUnitDisplayState,cameraUnitStatusLabel} from '../src/cameraHealthCounts.ts';
import {sniperShopDisplay} from '../src/sniperShopDisplay.ts';
test('Shop wins only targeted card presentation while saved observations and identity warnings remain intact',()=>{
 const group={scope:'shop',state:'shop',providerState:'online',serviceState:'offline',cameraState:'online',rows:[{unit:'Sniper 80'}],observation:{state:'online',label:'ONLINE'}};const before=structuredClone(group);
 assert.equal(cameraUnitDisplayState(group),'shop');assert.equal(cameraUnitStatusLabel(group),'SHOP');assert.deepEqual(group,before);assert.equal(cameraUnitStatusLabel({...group,identityConflict:'unverified'}),'EQUIPMENT LINK UNVERIFIED');assert.equal(cameraUnitStatusLabel({...group,rows:[{unit:'Helios 80'}]}),'ONLINE');assert.equal(cameraUnitStatusLabel({...group,scope:'field'}),'ONLINE');assert(sniperShopDisplay('shop','Thermal Sniper 80'));assert(!sniperShopDisplay('field','Sniper 80'));assert(!sniperShopDisplay('shop','Recon II 80'));
});
test('legacy Shop card hides online/offline summaries without changing source records',()=>{
 const context=vm.createContext({Intl,Date});for(const file of ['camera-health-history.js','camera-health-overview.js'])vm.runInContext(readFileSync(new URL('../../'+file,import.meta.url),'utf8'),context);
 const api=context.CameraHealthOverview,d={id:1,unit_key:'Sniper 80',organization:'SHOP',activation_state:'ACTIVE',device_name:'Synthetic camera',public_ip:null};
 const g={k:'Sniper 80',scope:'shop',state:'shop',serviceState:'offline',providerState:'online',systemKind:'camera',ds:[d]};const before=JSON.stringify(g);
 const html=api.card(g,{esc:String,effectiveHealth:()=> 'online',cameraGroup:()=> 'Sniper',health:{}});assert.match(html,/>SHOP</);assert.doesNotMatch(html,/online|offline|SHOP \/ ROOT/i);assert.equal(JSON.stringify(g),before);
});
test('Shop inventory presentation preserves resolved, stale and unresolved physical-placement evidence',async()=>{
 const context=vm.createContext({Intl,Date,AbortController,setTimeout,clearTimeout});
 const d={id:1,unit_key:'SNIPER 80',organization:'ROOT',activation_state:'deactivated',device_name:'Synthetic camera',public_ip:null};
 const row={id:'11111111-1111-4111-8111-111111111111',unitNumber:'SNIPER 80',readOnly:false,status:'readiness_unverified',currentLocationType:'shop',site:'SHOP / ROOT',address:''};
 let deny=false,unresolved=false;
 vm.runInContext(readFileSync(new URL('../../camera-placement-controls.js',import.meta.url),'utf8'),context);
 context.CameraPlacementControls.readFleetSources=async()=>{
  if(deny)throw Error('Synthetic unavailable read');
  return {snapshot:{inventoryItems:unresolved?[]:[row],items:[],summary:{fieldUnits:0},placementReviews:[],generatedAt:new Date().toISOString()},health:{identityVersion:1,evidenceVersion:2,unitIdentities:[],identityWarnings:[],rows:[{id:1,unit:'SNIPER 80'}]}};
 };
 for(const file of ['camera-effective-placement.js','camera-health-history.js','camera-health-overview.js'])vm.runInContext(readFileSync(new URL('../../'+file,import.meta.url),'utf8'),context);
 const view=context.CameraEffectivePlacement.create({db:{auth:{getSession:async()=>({data:{session:{user:{id:'synthetic-owner'},access_token:'synthetic-only'}}})}},getDevices:()=>[d]});
 const g={k:'SNIPER 80',scope:'shop',state:'shop',serviceState:'offline',providerState:'online',systemKind:'camera',ds:[d]},before=JSON.stringify(g);
 const check=(status,evidence)=>{
  assert.equal(view.get(d).status,status);
  const html=context.CameraHealthOverview.card(g,{esc:String,effectiveHealth:()=> 'online',cameraGroup:()=> 'Sniper',health:{}});
  assert.match(html,/class="compact-unit-site">SHOP<\/span>/);assert.match(html,/class="statuspill[^\"]*">SHOP<\/span>/);
  assert.match(html,evidence);assert.match(html,/Provider organization: ROOT · Activation: deactivated/);
  assert.doesNotMatch(html,/online|offline|Active shop inventory/i);assert.equal(JSON.stringify(g),before);
 };
 try{
  await view.refresh();check('ready',/Exact full unit identifier/);
  deny=true;await view.refresh();check('stale',/Last read placement; current placement is unavailable/);
  deny=false;unresolved=true;await view.refresh();check('unresolved',/No verified equipment link/);
  view.clear();check('unavailable',/Current physical placement unavailable/);
 }finally{view.dispose();}
});
