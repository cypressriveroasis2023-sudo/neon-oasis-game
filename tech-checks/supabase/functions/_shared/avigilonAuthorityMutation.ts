import type {Actor,Roster} from './avigilonCheckRun.ts';
/** Server-only protocol for EVERY writer of eligibility/identity/endpoint sources.
 * A fence is an exclusive durable hold, not a time lease. No automatic takeover.
 * A crash, timeout or readback/admission failure intentionally leaves it closed.
 * Calls must never be accepted as arbitrary client-selected operations. */
export async function withAvigilonAuthorityFence<T>(actor:Actor,d:{
 fence:(actor:Actor)=>Promise<number|string>;
 mutate:()=>Promise<T>;
 readVerifiedRoster:()=>Promise<Roster>;
 admit:(actor:Actor,generation:number|string,roster:Roster)=>Promise<void>;
}):Promise<T>{
 if(!actor.canCheck||!actor.actorId||!actor.tenantId)throw Error('Existing authorized actor required');
 const generation=await d.fence(actor);
 const result=await d.mutate();
 const roster=await d.readVerifiedRoster();
 if(roster.tenantId!==actor.tenantId)throw Error('Authority tenant changed');
 await d.admit(actor,generation,roster);
 return result;
}
