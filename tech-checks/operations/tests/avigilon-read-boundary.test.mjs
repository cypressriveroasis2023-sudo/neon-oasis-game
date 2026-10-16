import test from 'node:test';import assert from 'node:assert/strict';
import {withStableAvigilonRead,validateReceiptMembership} from '../../supabase/functions/_shared/avigilonReadBoundary.ts';
const authority={contract:'COS_AVIGILON_AUTHORITY_V1',tenantId:'tenant',generation:'1',rosterRevision:'r1',admitted:true};
test('reassignment between dependent reads fails closed even when roster revision is reused',async()=>{
 for(const change of [{generation:'2'},{rosterRevision:'r2'},{admitted:false},{tenantId:'other'}]){
 let current={...authority},reads=0;
 await assert.rejects(()=>withStableAvigilonRead('tenant',async()=>{reads++;return {authority:{...current}};},async()=>{current={...current,...change};return {oldIdentity:'u1',newPlacement:'u2'};}));assert.equal(reads,2);
 }
 const result=await withStableAvigilonRead('tenant',async()=>({authority}),async()=>({ok:true}));assert.deepEqual(result,{value:{ok:true},token:authority});
});
test('receipt membership rejects reassignment, duplicate owners and claims with unchanged endpoint',()=>{
 const endpoint={deviceId:'10',revision:'1',ip:'8.8.8.8',profile:'sniper',ports:[443]},owner={id:'r1',nativeUnitId:'u1',placement:'FIELD',restricted:false,identityVerified:true,endpoint},item={deviceId:'10',endpoint,receipt:{unitId:'r1'}};
 const envelope={tenantId:'tenant',authority,roster:{tenantId:'tenant',revision:'r1',units:[owner]}},summary={unitIdentities:[{unitId:'u1',deviceIds:['10']}]};
 assert.equal(validateReceiptMembership(summary,envelope,item),owner);
 for(const claims of [[{unitId:'u2',deviceIds:['10']}],[],[...summary.unitIdentities,...summary.unitIdentities]])assert.throws(()=>validateReceiptMembership({...summary,unitIdentities:claims},envelope,item),/membership/);
 for(const change of [{nativeUnitId:'u2'},{id:'r2'},{placement:'SHOP'},{restricted:true}])assert.throws(()=>validateReceiptMembership(summary,{...envelope,roster:{...envelope.roster,units:[{...owner,...change}]}},item),/membership/);
 assert.throws(()=>validateReceiptMembership(summary,{...envelope,roster:{...envelope.roster,units:[owner,owner]}},item),/membership/);
});
