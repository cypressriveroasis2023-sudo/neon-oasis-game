/** Owner-authenticated, local-only Product-ID operational transfers.
 * The RPC commits COS placement and its durable Sheets outbox atomically.
 * Never read map/geocodes, camera/video health, GPS, vendor or Sheets here. */
type Row=Record<string,unknown>;
const obj=(v:unknown):v is Row=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==='string'&&/^[1-9][0-9]{0,14}$/.test(v);
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const safe=(v:unknown,max:number)=>typeof v==='string'&&v===v.trim()&&v.length<=max&&!/[\x00-\x1f\x7f<>]/.test(v)&&!/^[-+=@]/.test(v);
export const OPERATIONAL_MOVES_CONTRACT='COS_OPERATIONAL_TRANSFER_V1';

export class OperationalMoveError extends Error {
 constructor(message:string,public status=400){super(message);this.name='OperationalMoveError';}
}
function fail(message:string,status=400):never{throw new OperationalMoveError(message,status);}
export type MoveCommand={productId:string;expectedSourceSha256:string;expectedRevision:number;requestId:string;placement:'SHOP'|'FIELD';customer:string;site:string;address:string};
export function checkedMoveCommand(value:unknown):MoveCommand{
 if(!obj(value)||Object.keys(value).sort().join(',')!=='address,customer,expectedRevision,expectedSourceSha256,placement,productId,requestId,site'
    ||!id(value.productId)||!hash(value.expectedSourceSha256)
    ||!Number.isSafeInteger(value.expectedRevision)||(value.expectedRevision as number)<0
    ||!uuid(value.requestId)||!['SHOP','FIELD'].includes(String(value.placement)))
  fail('Refresh the unit and choose an exact Product ID before moving it.');
 if(!safe(value.customer,250)||!safe(value.site,250)||!safe(value.address,600))fail('The selected site or address contains unsupported text.');
 if(value.placement==='FIELD'&&((value.customer as string).length<2||(value.site as string).length<2||(value.address as string).length<8))
  fail('To deploy to Field, choose a customer, site/project, and complete street address.');
 return value as MoveCommand;
}
export function checkedOperationalSnapshot(value:unknown){
 if(!obj(value)||value.contract!==OPERATIONAL_MOVES_CONTRACT||!hash(value.sourceSha256)||!Array.isArray(value.items)||value.items.length<1||value.items.length>10000)
  fail('The saved equipment census is unavailable. No transfer can be started.',503);
 const seen=new Set<string>();
 const items=value.items.map((v:unknown)=>{
  if(!obj(v)||!id(v.productId)||seen.has(v.productId)||!safe(v.unitNumber,250)||!(v.unitNumber as string)
   ||!['FIELD','SHOP'].includes(String(v.placement))||!['FIELD','SHOP'].includes(String(v.sourcePlacement))
   ||!['UNFLAGGED','DO_NOT_USE','MISSING'].includes(String(v.lifecycle))
   ||!Number.isSafeInteger(v.revision)||(v.revision as number)<0
   ||typeof v.operationalOverride!=='boolean'
   ||!['source_recorded','pending','published','conflict','failed'].includes(String(v.syncState)))
    fail('The equipment census contains conflicting identities. Changes are blocked.',503);
  seen.add(v.productId);
  return {
   productId:v.productId as string,unitNumber:v.unitNumber as string,
   placement:v.placement as 'FIELD'|'SHOP',sourcePlacement:v.sourcePlacement as 'FIELD'|'SHOP',
   lifecycle:v.lifecycle as string,customer:typeof v.customer==='string'?v.customer:'',site:typeof v.site==='string'?v.site:'',
   address:typeof v.address==='string'?v.address:'',sourceAddress:v.sourceAddress,
   revision:v.revision as number,operationalOverride:v.operationalOverride as boolean,
   syncState:v.syncState as string,changedAt:typeof v.changedAt==='string'?v.changedAt:null
  };
 });
 return {contract:OPERATIONAL_MOVES_CONTRACT,sourceSha256:value.sourceSha256 as string,items};
}
export function checkedMoveReceipt(value:unknown,command:MoveCommand){
 if(!obj(value)||value.committed!==true||typeof value.replayed!=='boolean'
  ||value.productId!==command.productId||value.placement!==command.placement
  ||!Number.isSafeInteger(value.revision)||(value.revision as number)<command.expectedRevision+1
  ||!['pending','pending_or_published'].includes(String(value.syncState)))
   fail('The move response could not be verified. Recheck this exact unit before retrying.',503);
 return value;
}
export function createOperationalMoves(options:{
 rpc:(name:string,parameters:Row)=>Promise<unknown>;actorPayload:Row
}){
 return async function(path:string,method:string,body:unknown){
  if(path==='/api/operational-units'&&method==='GET'){
   return checkedOperationalSnapshot(await options.rpc('cos_operational_transfer_snapshot',options.actorPayload));
  }
  if(path==='/api/operational-units/move'&&method==='POST'){
   const command=checkedMoveCommand(body);
   const receipt=await options.rpc('cos_operational_transfer_apply',{
    ...options.actorPayload,p_product_id:command.productId,
    p_expected_source_sha256:command.expectedSourceSha256,p_expected_revision:command.expectedRevision,
    p_request_id:command.requestId,p_placement:command.placement,
    p_customer:command.customer,p_site:command.site,p_address:command.address,
   });
   return checkedMoveReceipt(receipt,command);
  }
  fail('This transfer operation is not available.',405);
 };
}
