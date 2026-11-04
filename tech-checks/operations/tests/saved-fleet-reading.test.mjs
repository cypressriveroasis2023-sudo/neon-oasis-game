import test from 'node:test';
import assert from 'node:assert/strict';
import {fleetReadingKey,readFleetReading,saveFleetReading} from '../src/savedFleetReading.ts';

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
