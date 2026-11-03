import test from 'node:test';
import assert from 'node:assert/strict';
import {readProductCheckSource} from '../../supabase/functions/cos-operations-pages/productCheckSource.ts';
function ioFixture(){
 let reads=0;const calls=[];const source={sourceSha256:'a'.repeat(64),candidate:[{productId:'1'}],census:{sourceSha256:'a'.repeat(64),records:[{productId:'1',placement:'FIELD',uploadLifecycle:'UNFLAGGED',binding:{state:'linked'}}]}};
 return {calls,source,receipt:async()=>{calls.push('receipt');return{upload:structuredClone(source)};},census:v=>v,tracker:async()=>{calls.push('tracker');return{records:[{productId:'1',publicIp:'8.8.8.8'}]};},devices:async()=>{calls.push('devices');return[{id:41,unit_key:'HELIOS 001',public_ip:'8.8.8.8',expected_ports:[80],connection_revision:1,monitoring_enabled:true,activation_state:'active'}];},checks:async()=>{calls.push('checks');return[{camera_device_id:41,port_status:{80:{online:true}}}];}};
}
test('manual source reads inventory, tracker and saved ports without global identity/provider/map dependencies',async()=>{
 const io=ioFixture(),r=await readProductCheckSource(io,new AbortController().signal);
 assert.deepEqual(io.calls.sort(),['checks','devices','receipt','receipt','tracker']);assert.equal(r.endpoints[0].deviceId,41);assert.equal(r.endpoints[0].portStatus[80].online,true);
});
test('inventory changes, duplicate saved records and cancellation fail closed',async()=>{
 const io=ioFixture();let calls=0;const receipt=io.receipt;io.receipt=async()=>{const r=await receipt();if(++calls===2)r.upload.census.records[0].placement='SHOP';return r;};await assert.rejects(()=>readProductCheckSource(io,new AbortController().signal),/inventory_changed/);
 const duplicate=ioFixture();duplicate.checks=async()=>[{camera_device_id:41},{camera_device_id:41}];await assert.rejects(()=>readProductCheckSource(duplicate,new AbortController().signal),/saved_configuration_invalid/);
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(()=>readProductCheckSource(ioFixture(),cancelled.signal));
});
