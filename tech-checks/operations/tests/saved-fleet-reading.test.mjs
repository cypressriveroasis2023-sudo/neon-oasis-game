import test from 'node:test';
import assert from 'node:assert/strict';
import {fleetReadingKey,readFleetReading,saveFleetReading} from '../src/savedFleetReading.ts';
import {ownerSessionFingerprint} from '../src/operationsSessionRecovery.ts';

test('completed readings survive a new reader and stay scoped to the verified Owner',()=>{
 const records=new Map();
 const storage={getItem:key=>records.get(key),setItem:(key,value)=>records.set(key,value)};
 const session={authorized:true,legacyOwner:true,role:'Owner',productionOwnerUserId:'00000000-0000-4000-8000-000000000001',features:{fleetAccess:true}};
 const key=fleetReadingKey(session,'');
 const reading={checkedAt:1000,field:282,shop:643,online:122,offline:34,unverified:44};
 saveFleetReading(storage,key,reading,1200);
 saveFleetReading(storage,key,{...reading,checkedAt:900,online:81},1200);
 saveFleetReading(storage,key,{...reading,checkedAt:1100,unverified:300},1200);
 assert.deepEqual(readFleetReading(storage,fleetReadingKey(structuredClone(session),''),5000),reading);
 assert.equal(readFleetReading(storage,fleetReadingKey({...session,productionOwnerUserId:'00000000-0000-4000-8000-000000000002'},''),5000),null);
 assert.equal(readFleetReading(storage,fleetReadingKey({...session,authorized:false},''),5000),null);
});

const it={authorized:true,legacyOwner:false,role:'IT',name:'Synthetic technician',
 productionTechnicianUserId:'00000000-0000-4000-8000-000000000001',
 features:{fleetAccess:true,vrmRead:true,fieldLocationVerification:false}};
test('IT saved readings use the verified actor, role, mode and exact boolean feature set',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 const key=fleetReadingKey(it,'fleet'),reading={checkedAt:1000,field:5,shop:2,online:2,offline:1,unverified:2};
 assert.ok(key);saveFleetReading(storage,key,reading,1200);
 assert.deepEqual(readFleetReading(storage,fleetReadingKey({...it,name:'Renamed synthetic technician',features:{fieldLocationVerification:false,vrmRead:true,fleetAccess:true}},'fleet'),500000),reading);
 for(const [session,mode] of [
  [{...it,productionTechnicianUserId:'00000000-0000-4000-8000-000000000002'},'fleet'],
  [it,''],[it,'staff'],[it,'owner'],
  [{...it,features:{...it.features,vrmRead:false}},'fleet'],
  [{...it,features:{...it.features,newCapability:false}},'fleet'],
  [{...it,legacyOwner:true,role:'Owner',productionOwnerUserId:it.productionTechnicianUserId},'fleet'],
 ])assert.equal(readFleetReading(storage,fleetReadingKey(session,mode),500000),null);
 assert.equal(ownerSessionFingerprint(it,'fleet'),null,'IT display caching must not enable Owner session recovery');
});
test('old, unverified, malformed or wrong-role IT sessions cannot read or write a durable cache',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 for(const change of [
  {authorized:false},{authorized:'true'},{legacyOwner:true},{legacyOwner:undefined},
  {role:'Service'},{role:'Owner'},{role:'it'},
  {productionTechnicianUserId:undefined},{productionTechnicianUserId:null},
  {productionTechnicianUserId:'Synthetic technician'},{productionTechnicianUserId:'not-a-uuid'},
  {features:null},{features:[]},{features:{}},{features:{fleetAccess:'true'}},
 ]){
  const key=fleetReadingKey({...it,...change},'fleet');assert.equal(key,null,JSON.stringify(change));
  saveFleetReading(storage,key,{checkedAt:1000,field:1,shop:0,online:1,offline:0,unverified:0},1200);
  assert.equal(readFleetReading(storage,key,1200),null);
 }
 assert.equal(values.size,0);
});
