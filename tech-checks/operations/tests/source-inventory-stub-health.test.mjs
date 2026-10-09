import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cameraSummary} from '../../supabase/functions/cos-operations-pages/cameraPlacementEvidence.ts';
import {fieldCameraHealth,unitHealthLabel} from '../src/fieldCameraHealth.ts';
const now=Date.parse('2026-10-06T18:00:00Z'),observedAt='2026-10-06T17:55:00Z';
// Existing public-address parser fixture; these pure tests make no network calls.
const types=[['CAMV 901','CAMV','CAM V & RSU','root'],['Sniper 2 901','Sniper 2','SNIPERS','TRACKER FIELD']];
for(const [label,type,family,organization] of types)test(type+' source inventory stays unknown without bound observations and can later show real connection evidence',()=>{
 const device={id:901,device_name:label,unit_key:label.toUpperCase(),device_type:type,source:'2026_unit_tracker',organization,activation_state:'active',external_device_id:null,connection_revision:0,public_ip:'8.8.4.4',expected_ports:[80,554]};
 const unit={id:'11111111-1111-4111-8111-111111111111',unitNumber:label,modelName:family,readOnly:true,recordSource:'mHelpDesk product import'};
 const before=structuredClone(device),classify=health=>fieldCameraHealth(unit,[unit],cameraSummary([device],health,now),now);
 for(const health of [[],[{camera_device_id:901,overall_status:'online',checked_at:observedAt,ip_reachable:true,port_status:{'80':{online:true},'554':{online:true}}}]]){
  const result=classify(health);assert.equal(result.state,'unknown');assert.equal(result.classification.cameraState,'mapping');assert.match(result.reason,/connection status; camera video is not verified/);
 }
 const proof={ip:device.public_ip,revision:0,checkedAt:observedAt,status:'online',reachable:true,confirmedOutage:false,consecutiveFailures:0};
 const health={camera_device_id:901,overall_status:'online',checked_at:observedAt,ip_reachable:true,port_status:{'80':{online:true},'554':{online:true},_connection:proof}};
 const known=classify([health]);assert.equal(known.state,'online');assert.equal(known.basis,'connection');assert.match(known.reason,/saved IP \/ port check responded/);assert.notEqual(unitHealthLabel(known),'CAMERA RECORDS ONLINE');assert.equal(known.classification.cameraState,'mapping');
 assert.equal(classify([{...health,port_status:{...health.port_status,_connection:{...proof,revision:1}}}]).state,'unknown');
 assert.deepEqual(device,before);
});
