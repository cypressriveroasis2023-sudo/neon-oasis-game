// Router evidence for the troubleshooting checks.
//
// A router belongs to the unit whose name it carries. Matching is on the
// canonical unit key, the same one the rest of the board uses, so one unit
// never picks up another unit's router.
//
// Nothing here decides anything about cameras. A reachable router means the
// router answered, and that is all it means.
import {routerStatus,type RouterRow} from '../../supabase/functions/cos-operations-pages/routers';
import type {UnitCameraStatus} from '../shared/starUnitStatus';
import {canonicalCameraUnit} from './fieldCameraHealth';

export type RouterEvidence={
 /** A router record exists for this unit. */
 linked:boolean;
 /** Its port answered on a current check. Undefined where the check is stale,
  * missing or was never made: that is Not checked, not a failure. */
 reachable?:boolean;
};

/**
 * Index router evidence by canonical unit key.
 * A stale or unverified probe yields `reachable: undefined` rather than false,
 * because an old reading is not evidence that something is down.
 */
export function routerEvidenceByUnit(routers:unknown,now=Date.now()):Map<string,RouterEvidence>{
 const found=new Map<string,RouterEvidence>();
 const items=(routers as {items?:RouterRow[]})?.items;
 if(!Array.isArray(items))return found;
 for(const row of items){
  const key=canonicalCameraUnit(String(row?.unitKey||''));
  if(!key)continue;
  const status=routerStatus(row,now);
  const reachable=status==='reachable'?true:status==='unreachable'?false:undefined;
  const already=found.get(key);
  // A unit with more than one router is healthy only if none is unreachable;
  // an unreachable one is kept so it is not hidden by a reachable sibling.
  if(already===undefined)found.set(key,{linked:true,reachable});
  else if(already.reachable!==false&&reachable===false)found.set(key,{linked:true,reachable:false});
  else if(already.reachable===undefined&&reachable===true)found.set(key,{linked:true,reachable:true});
 }
 return found;
}

/** The evidence for one unit, or an unlinked answer when it has no router. */
export function routerEvidenceFor(unit:UnitCameraStatus,index:Map<string,RouterEvidence>):RouterEvidence{
 const key=canonicalCameraUnit(unit.unit);
 return (key&&index.get(key))||{linked:false};
}
