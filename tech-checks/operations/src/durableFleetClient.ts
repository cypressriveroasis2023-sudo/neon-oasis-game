import {prepareImmutableIdentityEnvelope} from './verifiedUnitIdentity';
import {reconcileFleetSnapshot,type FleetSnapshot} from './fleetSnapshot';
export function restoredFleet(value:any):FleetSnapshot|null{
 if(!value?.latest)return null;
 const raw=value.latest.payload;
 if(value.contract!=='COS_DURABLE_FLEET_RESPONSE_V1'||raw?.contract!=='COS_SAVED_FLEET_BOARD_V1')throw Error('Saved fleet record is invalid.');
 const at=Date.parse(raw.fleet?.readAt);
 if(!Number.isFinite(at)||at>Date.now()+300000)throw Error('Saved fleet time is invalid.');
 const health = prepareImmutableIdentityEnvelope(raw.fleet.health);
 const pair = reconcileFleetSnapshot(health, raw.fleet.fieldMap, at);
 prepareImmutableIdentityEnvelope(pair.health);
 return {...pair,fieldMap:{...pair.fieldMap,savedBoardReadAt:pair.readAt} as FleetSnapshot['fieldMap'],readStartedAt:Date.now()};
}
/** All clients read one server-published pair. Opening never clears its record. */
export async function durableFleetRead(io:{read:(force:boolean)=>Promise<any>;current:()=>boolean;status:(value:any)=>void;publish:(value:FleetSnapshot)=>void;failed:()=>void;delay?:(ms:number)=>Promise<void>},force=false){
 const delay=io.delay||((ms:number)=>new Promise<void>(resolve=>window.setTimeout(resolve,ms)));
 const first=await io.read(force);if(!io.current())throw Error('Your fleet session changed.');
 io.status(first);const saved=restoredFleet(first);
 const poll=async()=>{
  let value=first;const deadline=Date.now()+240000;
  for(let i=0;i<80&&Date.now()<deadline&&(!value.latest||['running','queued'].includes(value.refresh?.state));i++){
   await delay(3000);if(!io.current())return null;
   value=await io.read(false);if(!io.current())return null;io.status(value);
   const next=value.latest?.id!==first.latest?.id?restoredFleet(value):null;
   if(next&&value.latest?.id!==first.latest?.id){io.publish(next);return next;}
  }
  if(value.refresh?.state!=='completed')io.failed();
  return saved||restoredFleet(value);
 };
 if(saved){if(['running','queued'].includes(first.refresh?.state))void poll().catch(()=>{if(io.current())io.failed();});else if(first.refresh?.state==='failed')io.failed();return saved;}
 const next=await poll();if(!next)throw Error('The first complete fleet update is not available yet. The server will keep completed results once a batch succeeds.');return next;
}
