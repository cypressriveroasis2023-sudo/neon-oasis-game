import {buildProductGroups,type FullSource} from './fullSource.ts';
import {targetsValid} from './model.ts';
import type {IdentityReview} from '../../cos-operations-pages/verifiedHealthIdentity.ts';
/** Read-only fleet limit. Explicit probe/publication targets remain capped at 8. */
export const FLEET_RECEIPT_LIMIT=100;
export function fleetReadTargets(ids:unknown):ids is string[]{
 return Array.isArray(ids)&&ids.length>0&&ids.length<=FLEET_RECEIPT_LIMIT&&new Set(ids).size===ids.length
  &&ids.every((_,i)=>i%64!==0||targetsValid(ids.slice(i,i+64)));
}
function freezeSnapshot<T>(value:T):T{
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freezeSnapshot(child);}
 return value;
}
/** One immutable per-request snapshot is reused across planner chunks. No cache,
 * cross-actor sharing, source refresh or remote IO occurs between chunks. */
export async function buildFleetReadPlan(source:FullSource,ids:string[],now:number,review?:IdentityReview){
 if(!fleetReadTargets(ids))throw Error('Bounded fleet IDs required');
 const snapshot=freezeSnapshot(structuredClone(source)),groups=[],held=[];
 for(let i=0;i<ids.length;i+=64){const plan=await buildProductGroups(snapshot,ids.slice(i,i+64),now,review);groups.push(...plan.groups);held.push(...plan.held);}
 return {groups,held};
}
