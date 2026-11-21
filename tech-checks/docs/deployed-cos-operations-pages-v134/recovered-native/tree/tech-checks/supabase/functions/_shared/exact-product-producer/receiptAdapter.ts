import {fleetReadTargets} from './fleetReadPlan.ts';
import {RECEIPT_CONTRACT,type GroupProof} from './fullSource.ts';
export type ReceiptPayload={contract:typeof RECEIPT_CONTRACT;runId:string;proof:GroupProof;ports:Record<string,unknown>;checkedAt:string};
export type ReceiptAck={ok:boolean;receiptKey?:string;payloadSha256?:string;state?:string;reason?:string};
/** The RPC closure is the existing LEGACY service-side client, never a client
 * JWT upgraded/overwritten with a role. No credentials are read by this module. */
export type ReceiptRpc=(name:string,args:Record<string,unknown>,signal:AbortSignal)=>Promise<unknown>;
export const receiptKeyFor=(runId:string,productId:string)=>shaText(RECEIPT_CONTRACT+'|'+runId+'|'+productId);
const shaText=async(text:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
export function createReceiptStore(rpc:ReceiptRpc){
 return {
  async reserveRun(runId:string,productIds:string[],scopeSha256:string,signal:AbortSignal){
   const r=await rpc('cos_product_tcp_claim_run_v3',{p_run_id:runId,p_product_ids:[...productIds].sort(),p_scope_sha256:scopeSha256},signal) as Record<string,unknown>;
   if(r?.ok!==true)return {claimed:false,reason:typeof r?.reason==='string'?r.reason:'run_claim_rejected'};
   if(r.claimed!==true||r.runId!==runId||r.scopeSha256!==scopeSha256)throw Error('Run reservation uncertain');
   return {claimed:true};
  },
  async inspect(receiptKey:string,signal:AbortSignal){
   if(!/^[a-f0-9]{64}$/.test(receiptKey))throw Error('Invalid receipt key');
   return await rpc('cos_product_tcp_receipt_v2',{p_receipt_key:receiptKey},signal) as ReceiptAck|null;
  },
  async stage(payload:ReceiptPayload,signal:AbortSignal){
   const receiptKey=await receiptKeyFor(payload.runId,payload.proof.productId),text=JSON.stringify(payload),payloadSha256=await shaText(text);
   const ack=await rpc('cos_product_tcp_stage_v2',{p_receipt_key:receiptKey,p_payload_text:text},signal) as ReceiptAck;
   if(ack?.ok!==true)return {ok:false,reason:ack?.reason??'stage_rejected'} as ReceiptAck;
   if(ack.receiptKey!==receiptKey||ack.payloadSha256!==payloadSha256||!['pending','accepted'].includes(ack.state!))throw Error('Stage receipt uncertain');
   return ack;
  },
  async accept(ack:ReceiptAck,guard:string,signal:AbortSignal){
   const result=await rpc('cos_product_tcp_accept_v2',{p_receipt_key:ack.receiptKey,p_payload_sha256:ack.payloadSha256,p_authority_guard:guard},signal) as ReceiptAck;
   if(result?.ok!==true)return {ok:false,reason:result?.reason??'accept_rejected'} as ReceiptAck;
   if(result.receiptKey!==ack.receiptKey||result.payloadSha256!==ack.payloadSha256||result.state!=='accepted')throw Error('Acceptance receipt uncertain');
   return result;
  },
  async readMany(proofs:GroupProof[],signal:AbortSignal){
   if(!fleetReadTargets(proofs.map(p=>p.productId)))throw Error('Bounded unique receipt targets required');
   const rows=await rpc('cos_product_tcp_read_batch_v2',{p_targets:proofs.map(p=>({productId:p.productId,authorityGuard:p.authorityGuard}))},signal);
   if(!Array.isArray(rows)||rows.length!==proofs.length||new Set(rows.map(r=>r?.productId)).size!==proofs.length
    ||rows.some(r=>!proofs.some(p=>p.productId===r?.productId)||!Object.hasOwn(r,'receipt')))throw Error('Incomplete receipt batch');
   return new Map(rows.map(r=>[r.productId,r.receipt]));
  },
  async read(proof:GroupProof,signal:AbortSignal){return await rpc('cos_product_tcp_read_v2',{p_product_id:proof.productId,p_authority_guard:proof.authorityGuard},signal) as Record<string,any>|null;}
 };
}

export function createSupabaseReceiptRpc(client:{rpc:(name:string,args:Record<string,unknown>)=>{abortSignal:(signal:AbortSignal)=>PromiseLike<{data:unknown;error:unknown}>}}):ReceiptRpc{
 return async(name,args,signal)=>{
  if(!['cos_product_tcp_stage_v2','cos_product_tcp_accept_v2','cos_product_tcp_read_v2','cos_product_tcp_receipt_v2','cos_product_tcp_read_batch_v2','cos_product_tcp_claim_run_v3'].includes(name))throw Error('Unsupported receipt operation');
  const result=await client.rpc(name,args).abortSignal(signal);if(result.error)throw Error('Receipt operation unverified');return result.data;
 };
}
