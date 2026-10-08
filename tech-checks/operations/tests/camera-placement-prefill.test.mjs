import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {placementMatchKey as backendMatchKey,projectOwnerPlacement} from '../../supabase/functions/cos-operations-pages/placementProjection.ts';

const context=vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../../camera-placement-controls.js',import.meta.url),'utf8'),context);
const frontend=value=>context.CameraPlacementControls.placementMatchKey(value);

test('legacy field prefill matches the reviewed backend full placement identity contract',()=>{
  const labels=['RANGER 001','ranger-1','RANGER#1','SNIPER 001','SNIPER 2 001','SNIPER 4 001','SNIPER 001.1','SNIPER 001.10','SNIPER 001HDC2','SNIPER 001HDC2S','SNIPER 001HD4','SOLAR SPOTTER 051','SOLARSPOTTER 51','SOLAR SPOTTER 051HDC2','AXIS SOLAR SPOTTER 051','SOLAR STAND 72 001','SOLAR POLE 72 001','SOLAR SKID 144 001','RECON II 001','RECON2-001','RECON 001','RI001','RII001','CAM V 001','CAMV1','HELIOS 0001','ALPHA 7','Unreviewed Label 001','RANGER 000',null,undefined,{},17,''];
  for(const label of labels)assert.equal(frontend(label),backendMatchKey(label),JSON.stringify(label));
});

test('full family, embedded model digits, decimal precision and suffix remain distinct',()=>{
  const labels=['RANGER 1','SNIPER 1','SNIPER 2 1','SNIPER 4 1','SNIPER 1.1','SNIPER 1.10','SNIPER 1HDC2','SNIPER 1HDC2S','SNIPER 1HD4','SOLAR SPOTTER 1','AXIS SOLAR SPOTTER 1','SOLAR STAND 72 1','SOLAR POLE 72 1','SOLAR SKID 144 1','RECON 1','RECON2 1'];
  assert.equal(new Set(labels.map(frontend)).size,labels.length);
  assert.equal(frontend('Ranger 001'),frontend('RANGER 1'));
  assert.equal(frontend('SNIPER 001.1'),frontend('SNIPER 1.1'));
  assert.equal(frontend('RECON II 001'),frontend('RII 1'));
});

test('unknown placement labels require full exact identity rather than number fallback',()=>{
  assert.notEqual(frontend('Unit 001'),frontend('RANGER 001'));
  assert.notEqual(frontend('Synthetic Client Ranger 001'),frontend('RANGER 001'));
  assert.notEqual(frontend('RANGER 001 at billing site'),frontend('RANGER 001'));
  assert.equal(frontend('  Synthetic   Unit 001  '),frontend('SYNTHETIC UNIT 001'));
});

for(const status of ['installed','returning'])test('effective Owner SHOP overrides retained native '+status+' when resolving the next move',async()=>{
  const id='11111111-1111-4111-8111-111111111111',time='2026-10-07T12:00:00Z';
  const row={id,unitNumber:'Ranger 001',readOnly:false,_sourceField:true,status,currentLocationType:'site',site:'Synthetic former site',address:'100 Former Fixture Rd',latitude:null,longitude:null,locationVerification:'address_only'};
  const audit={id:'100',unit_key:'RANGER 001',contract:'COS_CAMERA_PLACEMENT_V2',placement:'SHOP',action:'MOVE_TO_ROOT',created_at:time,request_id:'22222222-2222-4222-8222-222222222222',control_id:'33333333-3333-4333-8333-333333333333',device_ids:[11],site_label:'',street_address:''};
  const projected=await projectOwnerPlacement({items:[row],inventoryItems:[row],summary:{},generatedAt:time},[audit],[{id:11,unit_key:'RANGER 001'}]);
  assert.equal(projected.items.length,0);assert.equal(projected.inventoryItems[0].status,status);assert.equal(projected.inventoryItems[0].placement,'SHOP');
  const legacy={unitKey:'RANGER 001',placement:'SHOP',auditId:'100',siteLabel:'',streetAddress:'',canMove:true};
  const health={evidenceVersion:2,identityVersion:1,rows:[{id:11,unit:'RANGER 001'}],unitIdentities:[],identityWarnings:[]};
  const result=context.CameraPlacementControls.resolvePlacement(projected,health,legacy,'RANGER 001');assert.equal(result.field,false);
});
