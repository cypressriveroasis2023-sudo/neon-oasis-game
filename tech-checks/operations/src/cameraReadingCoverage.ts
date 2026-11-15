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
