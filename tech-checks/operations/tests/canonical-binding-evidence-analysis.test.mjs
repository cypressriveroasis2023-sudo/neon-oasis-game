import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {analyzeCanonicalBindingEvidence as analyze,sevenProducts} from '../scripts/analyzeCanonicalBindingEvidence.mjs';

// Entirely synthetic objects, identities, source bytes and receipts. Never live
// evidence. JSON.stringify bytes here are intentionally NOT called PG digests.
const hash=text=>createHash('sha256').update(text).digest('hex');
const clone=x=>structuredClone(x);
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
function seal(records,sourceSha256,historical=false){
  const receipt={contract:historical?'COS_MHELP_UPLOAD_V1':'COS_MHELP_API_V1',reviewed:true,complete:true,portalId:'224643',sourceSha256,recordCount:records.length};
  const payloadText=JSON.stringify({receipt,records});return {sourceSha256,payloadText,payloadSha256:hash(payloadText)};
}
function fixture(){
  const current=[],historical=[],guards={};let i=0;
  for(const [productId,unitNumber] of Object.entries(sevenProducts)){
    const nativeUnitId=uuid(++i),trackerId=uuid(100+i);
    const state={tracker:{id:trackerId,organization_id:org,unit_number:unitNumber,ip:'192.0.2.10',sim:'synthetic-sim'},
      native:{id:nativeUnitId,organization_id:org,unit_number:unitNumber,status:'available'},
      sources:[],archives:[],nativeHistory:[{equipment_unit_id:nativeUnitId,synthetic:true}],ownerClaims:[]};
    const guardText=JSON.stringify(state),expectedGuard=hash(guardText);
    const binding={productId,fullLabel:unitNumber,trackerId,nativeUnitId,trackerLabel:unitNumber,nativeLabel:unitNumber,
      matchMethod:'exact_family_unit',canonicalKey:`synthetic:${i}`,reviewEvidence:{synthetic:true},
      evidenceSha256:'e'.repeat(64),representationEvidenceSha256:'f'.repeat(64),representedUnitIds:[nativeUnitId],expectedGuard};
    const row={productId,unitNumber,category:'synthetic-only',placement:'SHOP',lifecycle:'UNFLAGGED',binding:null};
    current.push(row);historical.push({...row,binding});guards[productId]={guardText,sha256:expectedGuard};
  }
  const scopedText=JSON.stringify(current),input={current:seal(current,'a'.repeat(64)),scopedText,
    scopedRevision:3,scopedSha256:hash(scopedText),history:[seal(historical,'b'.repeat(64),true),seal(historical,'c'.repeat(64),true)],guards};
  return {input,expected:{sourceSha256:input.current.sourceSha256,payloadSha256:input.current.payloadSha256,scopedRevision:3,scopedSha256:input.scopedSha256}};
}
function editBatch(f,index,edit){
  const b=index===null?f.input.current:f.input.history[index],p=JSON.parse(b.payloadText);edit(p);
  b.payloadText=JSON.stringify(p);b.payloadSha256=hash(b.payloadText);
  if(index===null)f.expected.payloadSha256=b.payloadSha256;
}
function editScoped(f,edit){const rows=JSON.parse(f.input.scopedText);edit(rows);f.input.scopedText=JSON.stringify(rows);f.input.scopedSha256=hash(f.input.scopedText);f.expected.scopedSha256=f.input.scopedSha256;}
test('seven exact candidates retain evidence, never authorize apply, and leave input bytes untouched',()=>{
  const f=fixture(),before=clone(f),result=analyze(f.input,f.expected);
  assert.equal(result.items.length,7);assert.equal(result.applyAuthorized,false);assert.deepEqual(f,before);
  assert.deepEqual(result.items[0].historicalBinding,JSON.parse(f.input.history[0].payloadText).records[0].binding);
  assert.equal(result.items[0].provenance.length,2);assert.ok(!Object.values(sevenProducts).includes('Sniper 230'));
  result.items[0].historicalBinding.nativeLabel='changed output';assert.deepEqual(f,before);
});
const invalid=[
  ['source advanced',f=>f.expected.sourceSha256='d'.repeat(64)],
  ['scoped revision advanced',f=>f.input.scopedRevision++],
  ['scoped bytes changed',f=>f.input.scopedText+=' '],
  ['payload corrupted',f=>f.input.history[0].payloadText+=' '],
  ['missing history',f=>f.input.history=[]],
  ['duplicate history source',f=>f.input.history.push(clone(f.input.history[0]))],
  ['unreviewed history',f=>editBatch(f,0,p=>p.receipt.reviewed=false)],
  ['incomplete current source',f=>editBatch(f,null,p=>p.receipt.complete=false)],
  ['wrong portal',f=>editBatch(f,null,p=>p.receipt.portalId='other')],
  ['wrong receipt hash',f=>editBatch(f,0,p=>p.receipt.sourceSha256='d'.repeat(64))],
  ['bad record count',f=>editBatch(f,0,p=>p.receipt.recordCount++)],
  ['duplicate historical Product ID',f=>editBatch(f,0,p=>{p.records.push(clone(p.records[0]));p.receipt.recordCount++;})],
  ['missing target in scope',f=>editScoped(f,rows=>rows.pop())],
  ['already bound',f=>editScoped(f,rows=>rows[0].binding={})],
  ['renamed label',f=>editScoped(f,rows=>rows[1].unitNumber='Spotter 028')],
  ['restricted lifecycle',f=>editScoped(f,rows=>rows[0].lifecycle='MISSING')],
  ['scoped override',f=>editScoped(f,rows=>rows[0].scopedAuthority={})],
  ['conflicting old proof',f=>editBatch(f,0,p=>p.records[0].binding.reviewEvidence={different:true})],
  ['different historical guard',f=>editBatch(f,0,p=>p.records[0].binding.expectedGuard='d'.repeat(64))],
  ['different historical category',f=>editBatch(f,0,p=>p.records[0].category='other')],
  ['missing private evidence',f=>{for(let i=0;i<2;i++)editBatch(f,i,p=>delete p.records[0].binding.reviewEvidence);}],
  ['unsupported reviewed-product link inference',f=>{for(let i=0;i<2;i++)editBatch(f,i,p=>p.records[0].binding.matchMethod='reviewed_product_id');}],
  ['changed current guard',f=>f.input.guards['1910800'].sha256='d'.repeat(64)],
  ['changed IP graph bytes',f=>{const g=f.input.guards['1910800'];g.guardText=g.guardText.replace('192.0.2.10','192.0.2.11');}],
  ['competing missing membership',f=>editBatch(f,null,p=>{p.receipt.apiMissingRecords=[{productId:'999',binding:{nativeUnitId:uuid(1)}}];})],
];
for(const [name,edit] of invalid)test(`fails closed: ${name}`,()=>{const f=fixture();edit(f);assert.throws(()=>analyze(f.input,f.expected));});
test('complete protected graph is mandatory even with consistently resealed synthetic history',()=>{
  const f=fixture(),g=f.input.guards['1910800'],state=JSON.parse(g.guardText);delete state.nativeHistory;
  g.guardText=JSON.stringify(state);g.sha256=hash(g.guardText);
  for(let i=0;i<2;i++)editBatch(f,i,p=>p.records[0].binding.expectedGuard=g.sha256);
  assert.throws(()=>analyze(f.input,f.expected),/Incomplete protected/);
});
test('different tenant fails even with consistently resealed synthetic history',()=>{
  const f=fixture(),g=f.input.guards['1910800'],state=JSON.parse(g.guardText);state.native.organization_id=uuid(999);
  g.guardText=JSON.stringify(state);g.sha256=hash(g.guardText);
  for(let i=0;i<2;i++)editBatch(f,i,p=>p.records[0].binding.expectedGuard=g.sha256);
  assert.throws(()=>analyze(f.input,f.expected),/identity changed/);
});
test('offline module has no production imports or dynamic execution',()=>{
  const source=readFileSync(new URL('../scripts/analyzeCanonicalBindingEvidence.mjs',import.meta.url),'utf8');
  assert.deepEqual([...source.matchAll(/from ['"]([^'"]+)['"]/g)].map(m=>m[1]),['node:crypto']);
  assert.doesNotMatch(source,/\b(fetch|eval|exec|writeFile|import\s*\()\s*\(/);
});
