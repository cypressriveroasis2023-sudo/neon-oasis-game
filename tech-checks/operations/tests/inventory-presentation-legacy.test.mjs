import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=name=>readFileSync(new URL('../../'+name,import.meta.url),'utf8');
const list=source('camera-health.html'),detail=source('camera-detail.html'),line=prefix=>list.split('\n').find(value=>value.startsWith(prefix));
function context(){const c=vm.createContext({Date});for(const name of ['inventory-presentation-rules.js','camera-health-history.js','camera-health-overview.js'])vm.runInContext(source(name),c);return c;}
const tags=['182','252','253','254','263','285','298','310'];
const master=tag=>({canonical_family:'Spotter',unit_tag:tag,source_label:'Spotter '+tag,tracker_state:'field_or_unknown'});
test('actual legacy inventory deduplicates only authorized integer Spotter provider aliases without modifying device identities',()=>{
 const c=context();c.devices=tags.map((tag,index)=>({id:index+1,unit_key:'SOLARSPOTTER '+tag,device_name:'SS'+tag+'_2',activation_state:'active',device_type:'IPC',source:'vigilant_control_center',organization:'Synthetic site'}));c.trackerMaster=tags.map(master);c.integrationMeta={};
 vm.runInContext('let trackerStateIndex=new Map(),trackerLabelStateIndex=new Map();'+['function trackerKey(','function trackerLabelNorm(','function rebuildTrackerStateIndex(','function trackerIdentityForDevice(','function fleetInventory('].map(line).join('\n')+'\nrebuildTrackerStateIndex();',c);
 const before=JSON.stringify(c.devices),inventory=c.fleetInventory();assert.equal(inventory.length,8);assert.equal(JSON.stringify(c.devices),before);for(const d of c.devices)assert.match(c.trackerIdentityForDevice(d),/^spotter\|/);
 c.devices=[{id:20,unit_key:'SOLARSPOTTER 263.1',device_name:'Original decimal serial name'}];c.trackerMaster=[master('263')];assert.equal(c.fleetInventory().length,2);assert.notEqual(c.trackerIdentityForDevice(c.devices[0]),'spotter|263');
 c.devices=[{id:21,unit_key:'SOLARSPOTTER 263 DO NOT USE'}];assert.equal(c.fleetInventory().length,2);assert.notEqual(c.trackerIdentityForDevice(c.devices[0]),'spotter|263');
 c.devices=[{id:22,unit_key:'SOLARSPOTTER 263'}];c.trackerMaster=[master('263'),{...master('263'),canonical_family:'Solar Spotter',source_label:'SOLARSPOTTER 263'}];assert.equal(c.trackerIdentityForDevice(c.devices[0]),'solar spotter|263');assert.equal(c.fleetInventory().length,2,'a newer exact separate master identity is preserved');
});
test('exact Witness units cannot inherit Star4Live camera or recorder outages and show not checked with separate TCP evidence',()=>{
 const c=context(),api=c.CameraHealthOverview,at='2026-10-16T12:00:00Z',now=Date.parse(at);
 for(const tag of ['046','052','088'])for(const status of ['online','offline']){
  const d={id:Number(tag),unit_key:'SPOTTER '+tag,device_name:'Original '+tag,device_type:'IPC',activation_state:'active',organization:'Sunfield',source:'vigilant_control_center',source_status:status,source_last_seen_at:at,connection_revision:2,public_ip:'192.0.2.10',expected_ports:[443]};
  const h={camera_device_id:d.id,checked_at:at,overall_status:'online',ip_reachable:true,port_status:{443:{online:true},_connection:{revision:2,ip:d.public_ip,checkedAt:at,status:'online',reachable:true}}},health={[d.id]:h};
  assert.equal(api.cameraState(d,now),'verifying');assert.equal(api.providerState(d,now),'verifying');assert.equal(api.providerRecord(d),false);assert.equal(api.serviceState(d,health,now),'online');assert.equal(api.classifyUnit([{...d,device_type:'NVR'}],[],now,health).recorderOffline,false);
  const group={k:d.unit_key,ds:[d],...api.classifyUnit([d],[],now,health)};assert.equal(group.providerState,'verifying');assert.notEqual(group.state,'offline');
  const options={health,cameraGroup:()=> 'Witness',effectiveHealth:x=>api.cameraState(x,now),isShop:()=>false,reconBatteryBadge:()=>''};
  const card=api.card(group,options),details=api.details(group,options);assert.match(card,/STATUS NOT CHECKED/);assert.match(card,/Witness status not checked/);assert.match(details,/Witness status not checked/);assert.match(details,/Direct service-port evidence/);assert.doesNotMatch(card,/RECORDER OFFLINE/);
  c.device=d;c.current=h;c.cameraGroup=()=> 'Witness';c.sourceFresh=()=>true;c.fmt=()=>at;
  const effective=detail.slice(detail.indexOf('function effectiveHealth(d,h)'),detail.indexOf('\n\nfunction sourceStatusText'));
  const statusText=detail.split('\n').find(row=>row.startsWith('function sourceStatusText()'));
  vm.runInContext(effective+'\n'+statusText,c);assert.equal(c.effectiveHealth(d,h),'verifying');assert.equal(c.sourceStatusText(),'Witness status not checked');
 }
 const decimal={unit_key:'SPOTTER 046.1',device_type:'IPC',activation_state:'active',source:'vigilant_control_center',source_status:'online',source_last_seen_at:at};assert.equal(api.cameraState(decimal,now),'online');
});
test('normalized inventory display retains original provider group and resource links',()=>{
 const c=context(),d={id:10,unit_key:'SOLARSPOTTER 263',device_name:'SS263_2',activation_state:'active',device_type:'IPC',organization:'Synthetic site',source:'vigilant_control_center'};
 const html=c.CameraHealthOverview.card({k:d.unit_key,displayLabel:'Spotter 263',ds:[d],scope:'field',state:'verifying',providerState:'verifying',serviceState:'verifying'},{effectiveHealth:()=> 'verifying',cameraGroup:()=> 'Vigilant',isShop:()=>false});
 assert.match(html,/compact-unit-title">Spotter 263/);assert.match(html,/Source group: SOLARSPOTTER 263/);assert.match(html,/data-unit="SOLARSPOTTER 263"/);assert.equal(d.device_name,'SS263_2');assert.equal(d.unit_key,'SOLARSPOTTER 263');
});
