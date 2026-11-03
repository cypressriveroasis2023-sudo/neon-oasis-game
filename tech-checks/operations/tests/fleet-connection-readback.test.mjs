import test from 'node:test';import assert from 'node:assert/strict';
import {fleetConnectionReadback,preferredFleetMap} from '../src/fleetConnectionReadback.ts';
const at=Date.now(),sha='a'.repeat(64),other='b'.repeat(64);
const receipt=hash=>({contract:'COS_EXACT_PRODUCT_CONNECTIONS_V2',sourceSha256:hash,trackerVerifiedAt:new Date(at).toISOString(),items:[{productId:'1001',status:'online',basis:'tcp_service_port',checkedAt:new Date(at).toISOString(),resourceId:'41',reason:'Completed saved TCP response.'}]});
const map=(hash,time=at)=>({generatedAt:new Date(time).toISOString(),uploadInventory:{sourceSha256:hash,receivedAt:new Date(time).toISOString(),records:[{productId:'1001',placement:'FIELD'}]},productConnections:receipt(hash)});
test('a newer inventory receipt causes one authority reload rather than discarding the verified result',async()=>{
 const old=map(sha,at-60000),fresh=map(other);let reads=0;
 const result=await fleetConnectionReadback(receipt(other),old,{current:()=>true,now:()=>at,readReceipt:async()=>{throw Error('No repeated TCP read');},readMap:async hash=>{assert.equal(hash,other);reads++;return fresh;}});
 assert.equal(reads,1);assert.equal(result.map,fresh);assert.equal(result.connections.sourceSha256,other);
 assert.equal(preferredFleetMap(old,fresh),fresh);assert.equal(preferredFleetMap(fresh,old),fresh);
});
test('inventory refresh cannot relabel old proof, bypass a session change or accept malformed observations',async()=>{
 for(const kind of ['wrong-source','session','malformed']){
  const value=receipt(other);if(kind==='malformed')value.items[0].checkedAt='invalid';let current=true;
  await assert.rejects(()=>fleetConnectionReadback(value,map(sha),{current:()=>current,now:()=>at,readReceipt:async()=>value,readMap:async()=>{if(kind==='session')current=false;const m=map(other);if(kind==='wrong-source')m.uploadInventory.sourceSha256='c'.repeat(64);return m;}}));
 }
});
test('failed same-source refresh preserves completed results but changed inventory and completed negatives replace them',()=>{
 const old={...map(sha),productConnectionsState:'ready'};
 const failed={...map(sha,at+60000),productConnections:null,productConnectionsState:'timeout'};
 assert.equal(preferredFleetMap(old,failed),old);
 const changed={...failed,uploadInventory:{...failed.uploadInventory,sourceSha256:other}};
 assert.equal(preferredFleetMap(old,changed),changed);
 const completed={...failed,productConnections:receipt(sha),productConnectionsState:'ready'};
 completed.productConnections.items[0].status='offline';
 assert.equal(preferredFleetMap(old,completed),completed);
});
