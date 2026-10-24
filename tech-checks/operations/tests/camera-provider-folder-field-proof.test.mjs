import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraScope,cameraSummary,classifyCameraUnit,resourceKind} from '../../supabase/functions/cos-operations-pages/cameraPlacementEvidence.ts';

const NOW=Date.parse('2026-10-24T17:40:00Z');
const observed=new Date(NOW-120000).toISOString();
const device=(id,unit,organization,status='offline',verified=null,type='ipc')=>({
  id,device_name:unit+' channel '+id,device_type:type,unit_key:unit,
  organization,activation_state:'active',source:'vigilant_control_center',
  source_status:status,source_last_seen_at:observed,last_online_at:null,
  ...(verified?{__ownerPlacement:verified}:{})
});
const tracker=[
  {canonical_family:'Solar Spotter',unit_tag:'029',source_label:'Solar Spotter 029',tracker_state:'shop'},
  {canonical_family:'Solar Spotter',unit_tag:'039',source_label:'Solar Spotter 039',tracker_state:'shop'},
  {canonical_family:'Spotter',unit_tag:'309',source_label:'Spotter 309',tracker_state:'shop'}
];

test('customer folders cannot certify eight offline IPC channels or one offline NVR as deployed outages',()=>{
  const rows=[
    ...Array.from({length:4},(_,i)=>device(990100+i,'SOLARSPOTTER 029','Synthetic Former Customer A')),
    ...Array.from({length:4},(_,i)=>device(990110+i,'SOLARSPOTTER 039','Synthetic Former Customer B')),
    device(990120,'SPOTTER 309','Synthetic Former Customer C','offline',null,'nvr')
  ];
  const summary=cameraSummary(rows,[],NOW,tracker,[]);
  assert.equal(summary.inventory.sourceDeviceRecords,9);
  assert.equal(summary.inventory.unknownScopeRecords,9);
  assert.equal(summary.inventory.activeFieldRecords,0);
  assert.equal(summary.offline,0);
  assert.equal(summary.online,0);
  assert.equal(summary.rows.filter(x=>x.evidence?.status==='offline').length,9);
  assert.equal(summary.rows.filter(x=>resourceKind(x)==='cameras').length,8);
  assert.equal(summary.rows.filter(x=>resourceKind(x)==='recorders').length,1);
  assert.equal(summary.rows.filter(x=>x.status==='offline').length,8);
  assert.ok(summary.rows.every(x=>x.scope==='unknown'));
  const recorder=summary.rows.find(x=>x.id===990120);
  assert.equal(recorder.status,'review'); // NVR is never an individual IPC camera
  assert.equal(classifyCameraUnit([recorder],NOW).providerState,'offline');
});

test('customer folder and tracker field_or_unknown cannot create a positive Field placement',()=>{
  const row=device(990201,'RANGER 020','Synthetic Customer');
  assert.equal(cameraScope(row,[]),'unknown');
  assert.equal(cameraScope(row,[{canonical_family:'Ranger',unit_tag:'020',source_label:'Ranger 020',tracker_state:'field_or_unknown'}]),'unknown');
  assert.equal(cameraScope({...row,unit_key:'Solar Spotter 029HDC2'},tracker),'unknown');
});

test('audited Owner/mHelpDesk placement proof retains Field IPC and Field NVR despite older tracker Shop',()=>{
  const field=device(990301,'RANGER 020','Synthetic Customer','offline','FIELD');
  const shop=device(990302,'SOLARSPOTTER 029','Synthetic Former Customer','offline','SHOP');
  const review=device(990303,'SOLARSPOTTER 039','Synthetic Former Customer','offline','UNKNOWN');
  const fieldNvr=device(990304,'SPOTTER 309','Synthetic Customer','offline','FIELD','nvr');
  const summary=cameraSummary([field,shop,review,fieldNvr],[],NOW,tracker,[]);
  assert.deepEqual([field,shop,review,fieldNvr].map(x=>cameraScope(x,tracker)),['field','shop','unknown','field']);
  assert.equal(summary.inventory.activeFieldRecords,2);
  assert.equal(summary.inventory.activeShopRecords,1);
  assert.equal(summary.inventory.unknownScopeRecords,1);
  assert.equal(summary.offline,1); // IPC only; the NVR has a distinct provider state
  assert.equal(summary.rows.find(x=>x.id===990302).evidence.status,'offline');
  assert.equal(summary.rows.find(x=>x.id===990302).status,'review');
  const nvrGroup=classifyCameraUnit([summary.rows.find(x=>x.id===990304)],NOW);
  assert.equal(nvrGroup.scope,'field');
  assert.equal(nvrGroup.systemKind,'recorder');
  assert.equal(nvrGroup.providerState,'offline');
  assert.equal(nvrGroup.recorderOffline,true);
});

test('existing inactive and explicit ROOT handling remains unchanged',()=>{
  assert.equal(cameraScope(device(990401,'RANGER 020','ROOT'),tracker),'shop');
  assert.equal(cameraScope({...device(990402,'RANGER 020','Synthetic Customer'),activation_state:'deactivated'},tracker),'inactive');
  assert.equal(cameraScope(device(990403,'RANGER 020','Synthetic Customer','online'),tracker),'unknown');
});
