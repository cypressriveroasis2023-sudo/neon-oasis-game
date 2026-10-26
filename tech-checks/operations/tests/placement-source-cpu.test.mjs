import test from 'node:test';import assert from 'node:assert/strict';
import {projectMhelpUploadPlacement as beforeUpload} from './fixtures/mhelpUploadPlacement-cpu-baseline.mjs';
import {projectEffectiveFleetPlacement as beforeEffective} from './fixtures/effectiveFleetPlacement-cpu-baseline.mjs';
import {projectMhelpUploadPlacement as afterUpload} from '../../supabase/functions/cos-operations-pages/mhelpUploadPlacement.ts';
import {projectEffectiveFleetPlacement as afterEffective} from '../../supabase/functions/cos-operations-pages/effectiveFleetPlacement.ts';
import {sourceFixture} from './fixtures/placement-source-cpu-population.mjs';
const run=(f,upload,effective)=>{try{const value=upload(f.snapshot,f.upload,f.audits,f.identity,f.now);return {value:effective(value.snapshot,f.audits,{authorizedUploadPlacements:value.authorities})};}catch(e){return {error:e.message};}};
function compare(f){const saved=structuredClone(f);assert.deepEqual(run(f,afterUpload,afterEffective),run(f,beforeUpload,beforeEffective));assert.deepEqual(f,saved);}
test('full 1001-record source/Owner history pipeline preserves complete outputs',()=>compare(sourceFixture()));
test('newer history, duplicate claims, stale guards, missing/partial receipts and malformed records preserve denials',()=>{
 for(const mutate of [f=>f.audits[0].created_at='2026-10-26T12:00:00Z',f=>f.audits[0].created_at=null,f=>f.audits[0].unit_key='RI 1',f=>f.upload.records[0].binding.guardCurrent=false,f=>f.upload.records.push(structuredClone(f.upload.records[0])),f=>f.upload.records.pop(),f=>f.upload.complete=false,f=>f.upload.records[0].binding.nativeLabel='wrong',f=>f.snapshot.inventoryItems[0].placementReviewReason='held',f=>f.snapshot.inventoryItems[0].hasUnitGps=true,f=>f.identity.identityWarnings.push({unitId:f.snapshot.inventoryItems[0].id}),f=>f.audits.push(null),f=>f.audits=[],f=>f.upload=null]){const f=sourceFixture(8);mutate(f);compare(f);}
});
test('normalization cache cannot survive a later source, audit or identity read',()=>{
 const f=sourceFixture(8);compare(f);f.audits[0].unit_key='RECON 008';f.audits[0].created_at='2026-10-26T12:00:00Z';compare(f);f.upload.records[7].binding.guardCurrent=false;compare(f);
});
test('fixed-seed variant/decimal/ROOT conflicts retain exact whole-pipeline results',()=>{
 let seed=12345;const next=()=>((seed=(1664525*seed+1013904223)>>>0)/2**32);
 for(let i=0;i<50;i++){const f=sourceFixture(8);for(const a of f.audits){a.unit_key=['RI 1','RECON 001','RECON 1.1','RECON 1HDC4','RECON 8',null,''][Math.floor(next()*7)];a.created_at=next()<.3?null:next()<.5?'2026-10-26T12:00:00Z':a.created_at;}compare(f);}
});
