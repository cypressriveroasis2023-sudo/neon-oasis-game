import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {key,rowId,otherId,historyId,stamp,oldAddress,site,legacyState,nativeRow,envelope,healthEnvelope} from './camera-shop-field-restore-fixtures.mjs';

const context=vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../../camera-placement-controls.js',import.meta.url),'utf8'),context);
const resolve=(snapshot=envelope(),health=healthEnvelope(),state=legacyState())=>context.CameraPlacementControls.resolvePlacement(snapshot,health,state,key);
const blank=result=>{assert.equal(result.field,false);assert.equal(result.newInstallation,true);assert.equal(result.writerCompatible,true);assert.equal(result.site,'');assert.equal(result.address,'');};

test('SHOP with no native candidate preserves explicit blank-destination control',()=>{
  const result=resolve(envelope([],[]),healthEnvelope({unitIdentities:[]}));blank(result);assert.equal(result.row,null);
});

for(const currentLocationType of [null,'shop'])test('blank native SHOP can begin a confirmed installation with location '+currentLocationType,()=>{
  blank(resolve(envelope([nativeRow({status:'available',currentLocationType,site:'',address:''})],[])));
});

for(const [name,patch] of [['native import',{currentLocationType:null}],['tracker-only import',{readOnly:true,currentLocationType:'field'}]])test('known SHOP and unique identity ignores stale unassigned FIELD address for '+name,()=>{
  const snapshot=envelope([nativeRow(patch)]),before=structuredClone(snapshot);const result=resolve(snapshot,patch.readOnly?healthEnvelope({unitIdentities:[]}):healthEnvelope());blank(result);
  assert.equal(result.row.id,rowId);assert.equal(result.row.address,oldAddress);assert.equal(JSON.stringify(snapshot),JSON.stringify(before));
});

test('native SHOP inventory never prefills its former site and address',()=>{
  blank(resolve(envelope([nativeRow({status:'available',currentLocationType:'shop',site:'Former synthetic site'})],[])));
});

test('current Owner SHOP override starts a new installation despite retained prior native status',()=>{
  const row=nativeRow({placement:'SHOP',placementSource:'owner',placementUnitKey:key,placementAuditId:'900',currentLocationType:'shop',status:'installed',site:'Former synthetic site'});
  blank(resolve(envelope([row],[]),healthEnvelope(),legacyState({auditId:'900'})));
});

test('a stale imported site label is never reused as the new SHOP destination',()=>{
  blank(resolve(envelope([nativeRow({site:'Former synthetic import label'})])));
});

test('blank presentation retains the stale source row in the freshness revision',()=>{
  const before=resolve();for(const patch of [{address:'300 Changed Synthetic Rd, Testville, TX 77003'},{site:'Different old import label'},{sourceVerifiedAt:stamp},{snapshotImportedAt:stamp},{historicalLatitude:30},{historicalLongitude:-95}]){
    const after=resolve(envelope([nativeRow(patch)]));blank(after);assert.notEqual(after.revision,before.revision,JSON.stringify(patch));
  }
});

for(const patch of [
  {installedSiteId:otherId},
  {activeJobNumber:'SYNTHETIC-JOB-901'},
  {currentLocationType:'field'},
  {status:'installed',currentLocationType:'site'},
  {status:'assigned',currentLocationType:'site'},
  {status:'in_transit',currentLocationType:'site'},
  {locationVerification:'owner_verified',locationHistoryId:historyId,locationVerifiedAt:stamp,latitude:30,longitude:-95},
  {placement:'FIELD',placementSource:'owner',placementUnitKey:key,placementAuditId:'901'}
])test('known SHOP cannot silently erase stronger current evidence '+Object.keys(patch).join('/'),()=>{
  if(patch.placementSource==='owner')assert.throws(()=>resolve(envelope([nativeRow(patch)])),/incomplete|missing|review|changed|disagree|conflict|verified|unresolved/i);else{const result=resolve(envelope([nativeRow(patch)]));assert.equal(result.field,true);assert.equal(result.newInstallation,false);assert.equal(result.address,oldAddress);}
});

test('a complete active FIELD installation keeps address and unchanged-address no-op semantics',()=>{
  const row=nativeRow({site,address:oldAddress,installedSiteId:otherId,status:'installed',currentLocationType:'site'}),result=resolve(envelope([row]));
  assert.equal(result.field,true);assert.equal(result.site,site);assert.equal(result.address,oldAddress);
});

for(const placement of ['FIELD','UNKNOWN'])test('incomplete imported FIELD with legacy '+placement+' is intentionally correctable after identity verification',()=>{
  const result=resolve(envelope(),healthEnvelope(),legacyState({placement}));assert.equal(result.field,true);assert.equal(result.writerCompatible,true);assert.equal(result.site,'');assert.equal(result.address,oldAddress);
});

test('native inventory alias duplicates never become editable through the SHOP fallback',()=>{
  const row=nativeRow(),duplicate=nativeRow({id:otherId,unitNumber:'Solar Spotter - 987654'});
  assert.throws(()=>resolve(envelope([row,duplicate],[row])),/matches|duplicate|identity|unique/i);
});

test('verified association with an incompatible native alias does not authorize the legacy writer',()=>{
  const row=nativeRow({unitNumber:'Ranger 987654'}),health=healthEnvelope();health.unitIdentities[0].unitNumber=row.unitNumber;
  try{assert.equal(resolve(envelope([row]),health).writerCompatible,false);}catch(error){assert.match(error.message,/identity|alias|review|matches|incomplete|unresolved/i);}
});

for(const [name,change] of [
  ['incomplete device group',health=>health.rows.pop()],
  ['competing resource claim',health=>health.unitIdentities.push({...health.unitIdentities[0],unitId:otherId})],
  ['proof warning',health=>health.identityWarnings.push({unitId:rowId,reason:'Synthetic warning',deviceIds:['9101'],unitKeys:[key]})],
  ['provider alias',health=>health.rows.push({id:9105,unit:'Solar Spotter - 987654',trackerOnly:false})],
  ['malformed proof',health=>health.unitIdentities[0].proof='invalid']
])test(name+' keeps the SHOP destination unavailable',()=>{
  const health=healthEnvelope();change(health);assert.throws(()=>resolve(envelope(),health),/identity|source|proof|alias|matches|association|group|review/i);
});

for(const patch of [{site:'',address:''},{site:'',address:oldAddress},{site, address:''},{site:null,address:null}])test('valid FIELD missing '+JSON.stringify(patch)+' remains correctable without inventing metadata',()=>{
  const result=resolve(envelope([nativeRow(patch)]),healthEnvelope(),legacyState({placement:'FIELD'}));assert.equal(result.field,true);assert.equal(result.newInstallation,false);assert.equal(result.writerCompatible,true);assert.equal(result.site,patch.site||'');assert.equal(result.address,patch.address||'');
});

for(const patch of [{site:{name:'wrong type'}},{address:['wrong type']},{site:42},{address:true},{placementStatus:'needs_identity_review'},{placement:'UNKNOWN'}])test('incomplete-address repair retains malformed and placement-review hold '+JSON.stringify(patch),()=>{
  assert.throws(()=>resolve(envelope([nativeRow(patch)]),healthEnvelope(),legacyState({placement:'FIELD'})),/malformed|missing|incomplete|review|type/i);
});

test('proved native suffix alias stays read-only for the existing differently keyed writer',()=>{
  const row=nativeRow({unitNumber:'Solar Spotter 987654HDC2'}),health=healthEnvelope();health.unitIdentities[0].unitNumber=row.unitNumber;
  const result=resolve(envelope([row]),health,legacyState({placement:'FIELD'}));assert.equal(result.field,true);assert.equal(result.writerCompatible,false);assert.equal(result.address,oldAddress);
});
