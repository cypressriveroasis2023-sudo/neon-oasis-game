type Row=Record<string,any>;
export class FleetShopError extends Error{constructor(message:string,public status=503){super(message);}}
function fail(message:string,status=503):never{throw new FleetShopError(message,status);}
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const exact=(v:any,keys:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
export type ShopPlacement={contract:'COS_FLEET_SHOP_PLACEMENT_V1';unitId:string;unitNumber:string;proof:string;auditId:string|null;placement:'SHOP'|'UNKNOWN'};
export function checkedShopPlacement(v:any,id:string):ShopPlacement{
 if(v?.contract!=='COS_FLEET_SHOP_PLACEMENT_V1'||v.unitId!==id||typeof v.unitNumber!=='string'||! /\S/.test(v.unitNumber)||! /^(?:[a-f0-9]{64})$/.test(v.proof)||!(v.auditId===null||uuid(v.auditId))||!['SHOP','UNKNOWN'].includes(v.placement))fail('Saved placement could not be verified. Check placement before trying again.');
 return {contract:v.contract,unitId:id,unitNumber:v.unitNumber,proof:v.proof,auditId:v.auditId,placement:v.placement};
}
export function createFleetShopPlacement(options:{rpc:(name:string,body:Row)=>Promise<any>;actorPayload:Row}){
 return async(id:string,method:string,body:any)=>{
  if(!uuid(id))fail('Choose an existing COS equipment unit.',400);
  const args={...options.actorPayload,p_unit_id:id};
  if(method==='GET'){const v=await options.rpc('cos_fleet_shop_action_v1',{...args,p_action:'read'});return {...checkedShopPlacement(v,id),recordedAt:v.recordedAt,sourceBindings:v.sourceBindings||[]};}
  if(method!=='POST')fail('Use the Shop placement action.',405);
  if(!exact(body,['expected','reason','requestId'])||!uuid(body.requestId)||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>1000||!exact(body.expected,['unitId','unitNumber','proof','auditId','placement','contract']))fail('Review the unit and enter a move reason.',400);
  const expected=checkedShopPlacement(body.expected,id);
  const result=await options.rpc('cos_fleet_shop_action_v1',{...args,p_action:'move',p_request_id:body.requestId,p_reason:body.reason.trim(),p_expected:expected});
  const value=checkedShopPlacement(result,id);
  if(result.saved!==true||result.requestId!==body.requestId||value.placement!=='SHOP'||value.auditId!==body.requestId)fail('The move response is uncertain. Check the saved placement before trying again.');
  const after=checkedShopPlacement(await options.rpc('cos_fleet_shop_action_v1',{...args,p_action:'read'}),id);
  if(JSON.stringify(after)!==JSON.stringify(value))fail('The move may be saved. Check placement before trying again.');
  return {...after,saved:true,recordedAt:result.recordedAt,sourceBindings:result.sourceBindings||[],requestId:body.requestId};
 };
}
