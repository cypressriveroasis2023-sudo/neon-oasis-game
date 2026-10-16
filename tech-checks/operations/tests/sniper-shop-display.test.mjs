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
