import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalCameraUnit,fieldCameraHealth,isSupportEquipment} from '../src/fieldCameraHealth.ts';
import {resource,port,snapshot,now} from './fixtures/camera-evidence-fixtures.mjs';
import {importedFamilyPolicy} from './fixtures/imported-family-policy.mjs';
const direct=key=>['SNIPER','SNIPER2','SNIPER4','CAMV'].includes(key?.split('|')[0]);
const field=r=>({id:'synthetic-unit',unitNumber:r.unit,modelName:r.equipmentType});
const evidence=r=>resource(1,r.unit,direct(r.key)?{type:'tracker_unit',evidence:undefined,serviceEvidence:port()}:{type:r.family.startsWith('RECON')?'detector':'IPC'});

test('policy fixtures cover all ten observed equipment labels and eighteen family labels',()=>{
 assert.equal(importedFamilyPolicy.length,19);
 assert.equal(new Set(importedFamilyPolicy.map(r=>r.equipmentType)).size,10);
 assert.equal(new Set(importedFamilyPolicy.map(r=>r.family)).size,18);
});
for(const row of importedFamilyPolicy)test('imported labels: '+row.equipmentType+' / '+row.family,()=>{
 const unit=field(row),record=evidence(row),health=snapshot([record]);
 assert.equal(canonicalCameraUnit(row.unit),row.key);
 const result=fieldCameraHealth(unit,[unit],health,now);
 if(row.policy==='supported'){
  assert.equal(result.identity,'matched');assert.equal(result.state,'online');
  assert.equal(result.basis,direct(row.key)?'connection':'camera');
  const collision=fieldCameraHealth(unit,[unit,{...unit,id:'synthetic-collision'}],health,now);
  assert.equal(collision.identity,'ambiguous');assert.equal(collision.state,'unknown');
  const other=row.family==='RANGER'?'Helios 901':'Ranger 901';
  assert.equal(fieldCameraHealth(unit,[unit],snapshot([{...record,unit:other}]),now).identity,'missing');
  assert.equal(fieldCameraHealth({...unit,modelName:'Unverified equipment'},[{...unit,modelName:'Unverified equipment'}],health,now).identity,'missing');
 }else{
  assert.equal(result.identity,'missing');assert.equal(result.state,isSupportEquipment(unit)?'support':'unknown');assert.equal(result.classification,null);
  // A camera, responding router/service port, or matching numeric tag cannot make this family supported.
  for(const label of [row.unit,'Ranger 901','Spotter 901','Solar Spotter 901','CAM V 901'])assert.equal(fieldCameraHealth(unit,[unit],snapshot([resource(1,label,{serviceEvidence:port()})]),now).state,isSupportEquipment(unit)?'support':'unknown');
 }
});
test('known intrinsic family names remain valid separately from ambiguous source-tab grouping',()=>{
 for(const family of ['SPOTTER','SS HYBRID']){
  const unit={id:'synthetic-known',unitNumber:family+' 901',modelName:family};
  assert.equal(fieldCameraHealth(unit,[unit],snapshot([resource(1,unit.unitNumber)]),now).identity,'matched');
 }
});
test('base Sniper and Recon asset digits cannot be consumed as generation discriminators',()=>{
 for(let number=1;number<=999;number++)for(const family of ['SNIPER','SNIPER 2','SNIPER 4','RECON','RECON 2']){
  const key=family.replace(/ /g,'')+'|'+number;
  assert.equal(canonicalCameraUnit(family+' '+number),key);
  assert.equal(canonicalCameraUnit(family+' '+String(number).padStart(3,'0')),key);
 }
 assert.equal(canonicalCameraUnit('Sniper201'),'SNIPER|201');
 for(const [label,key] of [['Sniper2 901','SNIPER2|901'],['Sniper4-901','SNIPER4|901'],['Sniper 2 #901','SNIPER2|901'],['Recon2 901','RECON2|901'],['Recon II 901','RECON2|901'],['RII-901','RECON2|901'],['RI901','RECON|901']])assert.equal(canonicalCameraUnit(label),key);
 const labels=['Sniper 201','Sniper 2 001','Sniper 401','Sniper 4 001','Recon 201','Recon 2 001'];
 assert.equal(new Set(labels.map(canonicalCameraUnit)).size,labels.length);
});
test('same-number Sniper generations and Recon generations never cross-link health',()=>{
 for(const families of [['Sniper','Sniper 2','Sniper 4'],['Recon','Recon 2']])for(const family of families){
  const unit={id:'synthetic-generation',unitNumber:family+' 901',modelName:family};
  for(const other of families){const result=fieldCameraHealth(unit,[unit],snapshot([resource(1,other+' 901',{serviceEvidence:port()})]),now);assert.equal(result.identity,other===family?'matched':'missing');}
 }
});
test('RECONS exact model alias preserves tag, generation, ambiguity and recency guards',()=>{
 const unit={id:'synthetic-recon',unitNumber:'Recon 901',modelName:'RECONS'};
 const row=resource(1,'RI901',{type:'detector'});
 assert.equal(fieldCameraHealth(unit,[unit],snapshot([row]),now).state,'online');
 for(const label of ['Recon 902','RII-901','Sniper 901'])assert.equal(fieldCameraHealth(unit,[unit],snapshot([{...row,unit:label}]),now).identity,'missing');
 assert.equal(fieldCameraHealth(unit,[unit,{...unit,id:'synthetic-duplicate'}],snapshot([row]),now).identity,'ambiguous');
 assert.equal(fieldCameraHealth(unit,[unit],snapshot([{...row,evidence:{...row.evidence,observedAt:'2000-01-01T00:00:00Z'}}]),now).state,'unknown');
});
test('decorated or historic labels remain unresolved until independently proved',()=>{
 for(const label of ['Solar Spotter 901HD4','Solar Spotter 901HDC2','Solar Spotter 901HDC4','Spotter 901HD','Spotter 901HDC2S','Spotter 901HDC4S','SS Hybrid 901HD4','SS Hybrid 901HDC4','SS Hybrid 901HDC2S','Had Been 902 Solar Spotter 901HDC2','Spotter 901HDC2(Solar Compatible)','Spotter 901HDC4 Solar Hybrid','Sniper 901 Radar','Sniper 4 901 - Shop Demo','Sniper 4 901 Shop Demo','Solar Pole 72 901(solar stand)','901','Camera for Sniper 901','Sniper 901 / 902'])assert.equal(canonicalCameraUnit(label),null,label);
 assert.notEqual(canonicalCameraUnit('Spotter 901.1'),canonicalCameraUnit('Spotter 901'));
});
