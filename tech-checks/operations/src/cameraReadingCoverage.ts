import type {UnitCameraStatus,UnitSource} from '../shared/starUnitStatus';
import {sourceOf} from './cameraStatusFilters';

export const READING_SOURCES:readonly UnitSource[]=['star4live','ip_check','reconeyez'];
/** Scope and source times only. Never reclassifies health or substitutes a request time. */
export function cameraReadingCoverage(units:readonly UnitCameraStatus[]){
 return READING_SOURCES.map(source=>{
  const field=units.filter(unit=>unit.placement==='FIELD'&&sourceOf(unit)===source);
  const times=field.map(unit=>unit.observedAt?Date.parse(unit.observedAt):NaN).filter(Number.isFinite).sort((a,b)=>a-b);
  return {source,field:field.length,unknown:field.filter(unit=>unit.state==='UNKNOWN').length,
   missingTime:field.length-times.length,oldest:times.length?new Date(times[0]).toISOString():null,
   newest:times.length?new Date(times[times.length-1]).toISOString():null};
 });
}

/** Explains existing GREEN groups only; connection success is not camera proof. */
export function cameraUpEvidence(units:readonly UnitCameraStatus[]){
 const up=units.filter(unit=>unit.placement==='FIELD'&&unit.state==='GREEN');
 return {connections:up.filter(unit=>sourceOf(unit)==='ip_check').length,
  cameraGroups:up.filter(unit=>sourceOf(unit)==='star4live').length,
  detectorGroups:up.filter(unit=>sourceOf(unit)==='reconeyez').length};
}

/** Historical provider evidence is not a current health result. */
export function priorCameraReading(camera:{status:string;lastReportedStatus?:string;lastReportedAt?:string|null}){
 if(camera.status!=='unknown'||!['online','offline'].includes(camera.lastReportedStatus||'')||!camera.lastReportedAt||!Number.isFinite(Date.parse(camera.lastReportedAt)))return null;
 return {status:camera.lastReportedStatus!,at:camera.lastReportedAt};
}
