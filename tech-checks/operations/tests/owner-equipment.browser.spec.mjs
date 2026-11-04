import {test,expect} from '@playwright/test';
import {mountFleet} from './fleet-dashboard-fixtures.mjs';
import {fieldProductFixture} from './fixtures/mhelp-field-health-fixtures.mjs';
import {projectOwnerMap,projectOwnerConnections} from '../src/ownerEquipmentCore.ts';
const defaults={placement:'FIELD',customer:'Fixture customer',site:'Synthetic site',address:'100 Synthetic Road',publicIp:'8.8.8.8',ports:[1400,1500],monitoringEnabled:true,latitude:null,longitude:null};
async function setup(page,{existing=false,it=false}={}){
 const f=fieldProductFixture(),at=new Date(f.now).toISOString();
 let saved=existing?{contract:'COS_OWNER_EQUIPMENT_V1',productId:'1006',id:'00000000-0000-4000-8000-000000000555',revision:1,connectionRevision:1,active:true,settings:{...defaults},updatedAt:at,sourceLifecycle:'UNFLAGGED',currentSourcePresent:true,lastCompleted:null}:null;
 const source={productId:'1006',unitNumber:'Ranger 902',category:'Ranger',placement:'FIELD',customer:'Fixture customer',address:{street:'100 Synthetic Road'},lifecycle:'UNFLAGGED'};
 const initial=existing?projectOwnerMap(f.field,[saved]):f.field;
 const {app,state}=await mountFleet(page,it,{field:initial,health:f.health,productConnections:existing?projectOwnerConnections(f.connections,[saved]):f.connections,skipInitialFieldCount:true,productionOwnerUserId:it?undefined:'00000000-0000-4000-8000-000000000001'});
 const mock={writes:0,checks:0,conflict:false,technical:false};
 const publish=()=>{state.field=projectOwnerMap(f.field,saved?[saved]:[]);state.productConnections=projectOwnerConnections(f.connections,saved?[saved]:[]);};
 await page.route('**/functions/v1/cos-owner-equipment',async route=>{
  if(route.request().method()==='OPTIONS')return route.fallback();const p=route.request().postDataJSON();if(!p.path.startsWith('/api/owner-equipment/'))return route.fallback();
  const headers={'access-control-allow-origin':'http://127.0.0.1:4173'};let value;
  if(p.path.endsWith('/tracker'))value={productId:'1006',publicIp:'8.8.8.8',observedAt:at};
  else if(p.path.endsWith('/check')){mock.checks++;if(mock.technical){saved.lastAttempt={state:'failed',reason:'Synthetic checker temporarily unavailable'};value={...saved,checkSaved:false};}else{saved.lastCompleted={status:'online',connectionRevision:saved.connectionRevision,checkedAt:at,publicIp:saved.settings.publicIp,ports:saved.settings.ports,outcomes:saved.settings.ports.map(port=>({port,outcome:'responded',latencyMs:2}))};saved.lastAttempt={state:'completed'};value={...saved,checkSaved:true};}publish();}
  else if(p.method==='GET')value={contract:'COS_OWNER_EQUIPMENT_RECORD_V1',source,saved};
  else {mock.writes++;if(mock.conflict)return route.fulfill({status:409,headers,json:{error:'This equipment was edited elsewhere. Reload its saved settings.'}});
   if(p.body.action==='release')saved={...saved,revision:saved.revision+1,active:false};
   else {const changed=JSON.stringify([saved?.settings.publicIp,saved?.settings.ports,saved?.settings.monitoringEnabled])!==JSON.stringify([p.body.settings.publicIp,p.body.settings.ports,p.body.settings.monitoringEnabled]);saved={...saved,contract:'COS_OWNER_EQUIPMENT_V1',id:'00000000-0000-4000-8000-000000000555',productId:'1006',revision:(saved?.revision||0)+1,connectionRevision:(saved?.connectionRevision||0)+(changed?1:0),active:true,settings:p.body.settings,updatedAt:at,sourceLifecycle:'UNFLAGGED',currentSourcePresent:true,lastCompleted:saved?.lastCompleted||null};}publish();value=saved;
  }
  return route.fulfill({headers,json:value});
 });
 const open=async()=>{await app.getByRole('button',{name:'Open Ranger 902 Product 1006',exact:true}).click();return app.getByRole('region',{name:'Owner equipment settings',exact:true});};
 return {app,state,mock,open,settings:()=>saved};
}
test('Owner edits unlinked Field address without GPS or camera and saves across full reload',async({page},info)=>{
 const h=await setup(page),editor=await h.open();await expect(editor.getByLabel('Owner service address')).toHaveValue('100 Synthetic Road');
 await editor.getByLabel('Owner service address').fill('200 Synthetic Road');await editor.getByLabel('Owner site').fill('Corrected site');await editor.getByLabel('Owner correction reason').fill('Correct service address');await editor.getByRole('button',{name:'Save settings',exact:true}).click();
 await expect(editor).toContainText('Settings saved and read back');expect(h.mock.checks).toBe(0);expect(h.mock.writes).toBe(1);
 await h.app.getByRole('button',{name:'Close equipment details',exact:true}).click();await page.reload();const again=await h.open();await expect(again.getByLabel('Owner service address')).toHaveValue('200 Synthetic Road');await expect(again.getByLabel('Owner site')).toHaveValue('Corrected site');await expect(again.getByLabel('Owner latitude')).toHaveValue('');expect(h.mock.checks).toBe(0);expect(h.state.errors).toEqual([]);await page.screenshot({path:info.outputPath('owner-unlinked-editor.png'),fullPage:true});
});
test('IP and ports save once; explicit check persists; reopening never probes',async({page})=>{
 const h=await setup(page),editor=await h.open();await expect(editor.getByRole('button',{name:'Read current 2027 tracker IP'})).toBeEnabled();await editor.getByRole('button',{name:'Read current 2027 tracker IP'}).click();await expect(editor.getByLabel('Owner public IP')).toHaveValue('8.8.8.8');
 await editor.getByLabel('Owner service ports').fill('1400, 1500');await editor.getByLabel('Enable automatic connection checks').check();await editor.getByLabel(/I confirm this IP/).check();await editor.getByLabel('Owner correction reason').fill('Configure exact Product target');await editor.getByRole('button',{name:'Save and check',exact:true}).click();await expect(editor).toContainText('New connection reading saved: ONLINE');expect(h.mock.checks).toBe(1);
 await h.app.getByRole('button',{name:'Close equipment details',exact:true}).click();await page.reload();const again=await h.open();await expect(again.getByLabel('Owner public IP')).toHaveValue('8.8.8.8');await expect(again.getByLabel('Owner service ports')).toHaveValue('1400, 1500');await expect(again.getByRole('region',{name:'Saved Owner connection reading'})).toContainText('ONLINE');expect(h.mock.checks).toBe(1);expect(h.state.errors).toEqual([]);
});
test('technical check failure preserves previous completed result and saved settings',async({page})=>{
 const h=await setup(page,{existing:true}),editor=await h.open();await expect(editor.getByRole('button',{name:'Check saved target',exact:true})).toBeEnabled();await editor.getByRole('button',{name:'Check saved target',exact:true}).click();await expect(editor).toContainText('New connection reading saved: ONLINE');h.mock.technical=true;await editor.getByRole('button',{name:'Check saved target',exact:true}).click();await expect(editor).toContainText('Synthetic checker temporarily unavailable');await expect(editor.getByRole('region',{name:'Saved Owner connection reading'})).toContainText('Last completed: ONLINE');await expect(editor.getByLabel('Owner public IP')).toHaveValue('8.8.8.8');expect(h.settings().lastCompleted.status).toBe('online');expect(h.mock.writes).toBe(0);expect(h.state.errors).toEqual([]);
});
test('conflicting saves require readback instead of repeating an uncertain write',async({page})=>{
 const h=await setup(page,{existing:true}),editor=await h.open();await expect(editor.getByLabel('Owner service address')).toBeEnabled();h.mock.conflict=true;await editor.getByLabel('Owner service address').fill('300 Synthetic Road');await editor.getByLabel('Owner correction reason').fill('Concurrent edit test');await editor.getByRole('button',{name:'Save settings',exact:true}).click();await expect(editor).toContainText('edited elsewhere');await expect(editor.getByRole('button',{name:'Save settings',exact:true})).toBeDisabled();expect(h.mock.writes).toBe(1);await editor.getByRole('button',{name:'Reload settings',exact:true}).click();await expect(editor.getByLabel('Owner service address')).toHaveValue('100 Synthetic Road');await expect(editor.getByRole('button',{name:'Save settings',exact:true})).toBeEnabled();expect(h.mock.writes).toBe(1);
});
test('Owner can move to Shop without checking a camera and release the override',async({page})=>{
 const h=await setup(page,{existing:true}),editor=await h.open();await expect(editor.getByLabel('Owner placement')).toBeEnabled();await editor.getByLabel('Owner placement').selectOption('SHOP');await editor.getByLabel('Owner correction reason').fill('Return to Shop');await editor.getByRole('button',{name:'Save settings',exact:true}).click();await expect(editor).toContainText('Settings saved and read back');expect(h.settings().settings.placement).toBe('SHOP');await editor.getByLabel('Owner correction reason').fill('Restore mHelp source');await editor.getByRole('button',{name:'Use source settings again'}).click();await expect(editor).toContainText('Owner override released');expect(h.settings().active).toBe(false);expect(h.mock.checks).toBe(0);expect(h.state.errors).toEqual([]);
});
test('IT cannot use Owner editing controls on an unlinked record',async({page})=>{
 const h=await setup(page,{it:true});await h.app.getByRole('button',{name:'Open Ranger 902 Product 1006',exact:true}).click();await expect(h.app.getByRole('region',{name:'Owner equipment settings',exact:true})).toHaveCount(0);expect(h.mock.writes).toBe(0);expect(h.mock.checks).toBe(0);
});
