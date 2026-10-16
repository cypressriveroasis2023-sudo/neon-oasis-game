import type {Actor,Roster} from './avigilonCheckRun.ts';
export type SourceCommand={table?:string;action:'update'|'insert'|'upsert'|'delete'|'rpc';name?:string;args?:Record<string,unknown>;legacyActorId?:string;values?:Record<string,unknown>;eq?:Record<string,unknown>;onConflict?:string};
type Ticket={id:string;tenantId:string;generation:string;commands:SourceCommand[];admission?:unknown};
export function createAvigilonSourceCoordinator(d:{actor:Actor;native:(action:'state'|'begin'|'finish',payload:any)=>Promise<any>;applyLegacy:(ticket:Ticket)=>Promise<any>;readLegacySeal:()=>Promise<any>;cancelLegacy?:(ticket:Ticket)=>Promise<any>;readRoster:()=>Promise<Roster>;id?:()=>string}){
 const actor=d.actor;
 if(!actor.canCheck||!actor.actorId||!actor.tenantId)throw Error('Existing authorized source actor required');
 const state=async()=>{const s=await d.native('state',{});if(s.tenantId!==actor.tenantId||!/^\d+$/.test(s.generation))throw Error('Invalid source authority');return s;};
 const sealed=(r:any,t:Ticket)=>{if(r?.contract!=='COS_AVIGILON_SOURCE_SEAL_V1'||r.sealed!==true||r.id!==t.id||r.tenantId!==t.tenantId||r.generation!==t.generation)throw Error('Legacy writer is not durably sealed');return r;};
 async function execute(id:string,commands:SourceCommand[],cancel=false){
  const started=await d.native('begin',{id,commands});
  if(started.admission)return {admission:started.admission,receipt:started.legacyReceipt,replayed:true};
  const ticket:Ticket={id:started.id,tenantId:started.tenantId,generation:started.generation,commands:started.commands};
  if(ticket.tenantId!==actor.tenantId||ticket.id!==id)throw Error('Source ticket mismatch');
  // apply commits source DML + immutable seal together. An ambiguous response
  // leaves the native operation pending; resume replays this exact ticket only.
  const receipt=sealed(await (cancel?d.cancelLegacy?d.cancelLegacy(ticket):Promise.reject(Error('Reviewed cancellation transport unavailable')):d.applyLegacy(ticket)),ticket);
  const before=await state();
  if(before.admitted||before.pending?.id!==id)throw Error('Source operation changed');
  sealed(await d.readLegacySeal(),ticket);
  const roster=await d.readRoster();
  sealed(await d.readLegacySeal(),ticket);
  const after=await state();
  if(after.admitted||after.pending?.id!==id||after.generation!==before.generation||roster.tenantId!==actor.tenantId)throw Error('Sources changed during verified readback');
  const admission=await d.native('finish',{id,generation:before.generation,legacyReceipt:receipt,roster});
  return {admission,receipt,replayed:false};
 }
 return {
  mutate:(commands:SourceCommand[],id=(d.id||(()=>crypto.randomUUID()))())=>execute(id,commands),
  cancelPending:async()=>{const current=await state();if(!current.pending||current.pending.actorId!==actor.actorId)throw Error('Owned pending operation required');return execute(current.pending.id,current.pending.commands,true);},
  // Durable queue: every native source hook closes authority. No time lease or
  // takeover is used. Resume stored commands, never substitute a new operation.
  reconcile:async()=>{const current=await state();if(current.admitted&&!current.pending)return {unchanged:true};if(current.pending){if(current.pending.actorId!==actor.actorId)throw Error('Pending source operation belongs to another actor');return execute(current.pending.id,current.pending.commands);}return execute((d.id||(()=>crypto.randomUUID()))(),[]);},
 };
}
