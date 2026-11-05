// Dormant bridge: deliberately not routed or deployed. A release must inject the
// existing verified-session/same-person Owner authenticator, never JWT metadata
// or a browser actor UUID. DB Owner assertion is independently repeated per call.
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const IDS=['1910800','2221820','2232675','2232677','2274337','2275201','2336149'];
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,wanted)=>object(v)&&Object.keys(v).sort().join(',')===wanted.sort().join(',');
export function createCanonicalBindingRestorationBridge({authenticateOwner,rpc}){
 if(typeof authenticateOwner!=='function'||typeof rpc!=='function')throw Error('Verified Owner transport required');
 return async function handle(request){
  if(request.method!=='POST')throw Error('POST required');
  const owner=await authenticateOwner(request);
  if(!owner||owner.active!==true||owner.department!=='owner'||owner.roleCode!=='owner'
    ||!UUID.test(owner.actorId)||owner.organizationId!==ORG)throw Error('Verified active Owner required');
  const raw=await request.text();if(raw.length>4096)throw Error('Bounded restoration request required');
  const b=JSON.parse(raw),commit=b?.action==='commit';
  if(!keys(b,commit?['action','requestId','expected','digest','confirmation']:['action','requestId','expected'])
    ||!['stage','commit'].includes(b.action)||!UUID.test(b.requestId)
    ||!keys(b.expected,['sourceSha256','payloadSha256','scopedRevision','scopedSha256'])
    ||!['sourceSha256','payloadSha256','scopedSha256'].every(k=>typeof b.expected[k]==='string'&&HASH.test(b.expected[k]))
    ||!Number.isSafeInteger(b.expected.scopedRevision)||b.expected.scopedRevision<0
    ||commit&&(!HASH.test(b.digest)||typeof b.confirmation!=='string'||b.confirmation.trim().length<24||b.confirmation.length>800))throw Error('Exact restoration review required');
  const result=await rpc('cos_owner_restore_seven_bindings_v1',{
   p_actor:owner.actorId,p_org:owner.organizationId,p_request:b.requestId,p_action:b.action,p_expected:b.expected,
   p_digest:commit?b.digest:null,p_confirmation:commit?b.confirmation:null,
  });
  if(!object(result)||result.contract!==(commit?'COS_SEVEN_BINDING_COMMIT_V1':'COS_SEVEN_BINDING_STAGE_V1')
    ||result.requestId!==b.requestId||result.applied!==commit||!Array.isArray(result.items)||result.items.length!==7
    ||result.items.map(i=>i?.productId).sort().join(',')!==IDS.join(',')
    ||(commit?(result.reviewDigest!==b.digest||result.sourceSha256!==b.expected.sourceSha256||result.actorId!==owner.actorId
      ||result.organizationId!==owner.organizationId||result.revision!==b.expected.scopedRevision+1
      ||!HASH.test(result.authorizationSha256)||!HASH.test(result.afterScopedSha256)||result.beforeScopedSha256!==b.expected.scopedSha256)
     :(!HASH.test(result.digest)||!keys(result.expected,Object.keys(b.expected))||Object.keys(b.expected).some(k=>result.expected[k]!==b.expected[k])
      ||!Number.isFinite(Date.parse(result.expiresAt))||Date.parse(result.expiresAt)<=Date.now())))
   throw Error('Verified restoration receipt unavailable; inspect request status before retrying');
  return result;
 };
}
