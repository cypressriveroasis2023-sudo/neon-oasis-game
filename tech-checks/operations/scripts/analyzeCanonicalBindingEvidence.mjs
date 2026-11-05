import {createHash} from 'node:crypto';

// Offline evidence analysis only. No database, HTTP, stage, approval or apply path.
// Exact PostgreSQL jsonb::text bytes must come from an authorized private export.
// A passing analysis is NOT proof that an export is authentic or still current.
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const hash = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const org = 'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
export const sevenProducts = Object.freeze({
  '1910800':'Radar Sniper 500', '2221820':'Spotter 028.1',
  '2232675':'Solar Spotter 010', '2232677':'Solar Spotter 012',
  '2274337':'Spotter 145', '2275201':'Solar Spotter 039',
  '2336149':'Spotter 182HDC2S',
});
const fail = message => { throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : object(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const equal = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function sealed(text, digest) {
  if(typeof text !== 'string' || !hash.test(digest) || sha(text)!==digest) fail('Invalid exact-byte checksum');
  return JSON.parse(text);
}
function records(rows) {
  if(!Array.isArray(rows) || !rows.length || rows.length>10000
    || rows.some(r=>!object(r) || typeof r.productId!=='string' || !/^[1-9][0-9]{0,14}$/.test(r.productId))
    || new Set(rows.map(r=>r.productId)).size!==rows.length) fail('Missing or duplicate Product IDs');
  return rows;
}
function batch(exported, historical=false) {
  const b=sealed(exported.payloadText, exported.payloadSha256), r=b.receipt;
  if(!object(r) || !hash.test(exported.sourceSha256) || r.sourceSha256!==exported.sourceSha256
    || r.reviewed!==true || r.recordCount!==records(b.records).length
    || (historical ? r.contract!=='COS_MHELP_UPLOAD_V1'
      : r.contract!=='COS_MHELP_API_V1' || r.complete!==true || r.portalId!=='224643')) fail('Invalid complete reviewed batch');
  return b;
}

/** Input is a private evidence export, never a request body for an Owner RPC.
 * `expected` is captured independently at review; it cannot establish freshness.
 * `guardText` is the full six-domain upload_binding_guard input, NOT a projection.
 * Extra camera/link/source conflict checks remain mandatory in the future server.
 */
export function analyzeCanonicalBindingEvidence(input, expected) {
  if(!object(input) || !object(expected)) fail('Evidence export required');
  const current=batch(input.current);
  if(input.current.sourceSha256!==expected.sourceSha256
    || input.current.payloadSha256!==expected.payloadSha256
    || !Number.isSafeInteger(input.scopedRevision) || input.scopedRevision<0
    || input.scopedRevision!==expected.scopedRevision
    || input.scopedSha256!==expected.scopedSha256) fail('Source or scoped revision changed');
  const scoped=records(sealed(input.scopedText,input.scopedSha256));
  if(!equal(scoped.map(r=>r.productId).sort(),current.records.map(r=>r.productId).sort())) fail('Scoped membership changed');
  if(!Array.isArray(input.history) || !input.history.length
    || new Set(input.history.map(h=>h.sourceSha256)).size!==input.history.length) fail('Missing or duplicate historical batches');
  // Validate every exported batch before filtering candidates. Never discard a
  // corrupt or conflicting historical row merely because a newer row is usable.
  const history=input.history.map(h=>({...h, parsed:batch(h,true)}));
  if(!object(input.guards)) fail('Full protected-state guards required');
  const items=[];
  const claimed=new Map();
  for(const [productId,unitNumber] of Object.entries(sevenProducts)) {
    const row=scoped.find(r=>r.productId===productId);
    const source=current.records.find(r=>r.productId===productId);
    if(!row || row.binding!==null || source.binding!==null || row.unitNumber!==unitNumber
      || source.unitNumber!==unitNumber || row.lifecycle!=='UNFLAGGED' || source.lifecycle!=='UNFLAGGED'
      || row.scopedAuthority || row.sourceLabelAuthority) fail(`Current identity not an exact null hold: ${productId}`);
    const matches=history.flatMap(h=>h.parsed.records.filter(r=>r.productId===productId && r.binding!==null && r.binding!==undefined)
      .map(r=>({row:r,sourceSha256:h.sourceSha256,payloadSha256:h.payloadSha256})));
    if(!matches.length) fail(`Missing historical identity: ${productId}`);
    const b=matches[0].row.binding;
    if(!object(b) || matches.some(m=>m.row.unitNumber!==unitNumber || m.row.category!==row.category || !equal(m.row.binding,b))
      || b.productId!==productId || b.fullLabel!==unitNumber
      || !['exact_family_unit','archived_alias','owner_confirmed_alias'].includes(b.matchMethod)
      || typeof b.canonicalKey!=='string' || !b.canonicalKey || !object(b.reviewEvidence)
      || !hash.test(b.evidenceSha256) || !hash.test(b.representationEvidenceSha256)
      || !hash.test(b.expectedGuard)) fail(`Ambiguous or incomplete historical identity: ${productId}`);
    // No inferred target, label normalization, guard refresh, or newest-wins rule.
    const ids=[b.trackerId,b.nativeUnitId].filter(v=>v!==null);
    if(!ids.length || ids.some(id=>typeof id!=='string' || !uuid.test(id))
      || !Array.isArray(b.representedUnitIds) || !b.representedUnitIds.length
      || new Set(b.representedUnitIds).size!==b.representedUnitIds.length
      || b.representedUnitIds.some(id=>!ids.includes(id))) fail(`Invalid historical targets: ${productId}`);
    const g=input.guards[productId];
    if(!g || g.sha256!==b.expectedGuard) fail(`Protected state changed: ${productId}`);
    const state=sealed(g.guardText,g.sha256);
    if(!object(state) || !equal(Object.keys(state).sort(),['archives','native','nativeHistory','ownerClaims','sources','tracker'])
      || ['archives','nativeHistory','ownerClaims','sources'].some(k=>!Array.isArray(state[k]))) fail('Incomplete protected-state graph');
    for(const [id,label,entity] of [[b.trackerId,b.trackerLabel,state.tracker],[b.nativeUnitId,b.nativeLabel,state.native]]) {
      if(id===null ? entity!==null : !object(entity) || entity.id!==id || entity.organization_id!==org || entity.unit_number!==label)
        fail(`Current native/tracker identity changed: ${productId}`);
    }
    if(state.native && (['retired','deleted'].includes(state.native.status) || state.native.retired_at!=null)) fail('Retired target');
    if(state.sources.some(s=>s.active===true && s.product_id!==productId)) fail('Competing geocode source');
    for(const id of new Set(ids)) {
      if(claimed.has(id) && claimed.get(id)!==productId) fail('Competing historical targets');
      claimed.set(id,productId);
      const membership=[...scoped,...current.records,...(current.receipt.apiMissingRecords??[])];
      if(membership.some(r=>r.productId!==productId && (r.binding?.trackerId===id || r.binding?.nativeUnitId===id
        || r.binding?.representedUnitIds?.includes(id)))) fail('Competing current or missing Product ID');
    }
    items.push({productId,unitNumber,historicalBinding:structuredClone(b),protectedStateSha256:g.sha256,
      provenance:matches.map(m=>({sourceSha256:m.sourceSha256,payloadSha256:m.payloadSha256}))});
  }
  return {contract:'COS_SEVEN_BINDING_OFFLINE_ANALYSIS_V1',applyAuthorized:false,
    sourceSha256:input.current.sourceSha256,scopedRevision:input.scopedRevision,scopedSha256:input.scopedSha256,
    items,remainingServerChecks:['fresh complete source and private history reread','verified Owner session and tenant',
      'historical evidence semantics and immutable storage','full guard function definition and camera graph',
      'all links, archives, aliases and missing memberships','PR358 coordination','transactional stage, approval and immutable audit']};
}
