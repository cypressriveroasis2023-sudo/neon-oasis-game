import {prepareImmutableIdentityEnvelope} from '../src/verifiedUnitIdentity';
import {reconcileFleetSnapshot} from '../src/fleetSnapshot';
import {cameraFieldProducts} from '../src/cameraFieldProducts';
import {readExactProductConnections} from '../src/exactProductConnection';
/** Server-only projection. No client-provided health is accepted. */
export function completedBoard(health:any,map:any,connections:any,previous:any,at=Date.now()){
 const upload=map?.uploadInventory,ids=upload?.records?.filter((r:any)=>r.placement==='FIELD').map((r:any)=>r.productId);
 if(!upload||!ids?.length||!readExactProductConnections(connections,upload.sourceSha256,ids,at))throw Error('connection_source_incomplete');
 prepareImmutableIdentityEnvelope(health);
 const reconciled=reconcileFleetSnapshot(health,{...map,productConnections:connections,productConnectionsState:'ready'},at);
 const {fleetFieldUnits,...storedHealth}=reconciled.health;
 const pair={...reconciled,health:storedHealth};
 prepareImmutableIdentityEnvelope(pair.health);
 const board=cameraFieldProducts(pair.fieldMap,pair.health,at,true);
 if(!board||!board.healthVerified)throw Error('inventory_source_incomplete');
 const prior=previous?.fleet;
 const priorItems=Array.isArray(previous?.units)?previous.units:[];
 const canonical=(value:any)=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
 const binding=(m:any,id:string)=>{
  const r=m?.uploadInventory?.records?.find((p:any)=>p.productId===id);
  return canonical([r?.placement,r?.uploadLifecycle,r?.binding]);
 };
 // A previously definitive unit going unknown with the same binding means the
 // next batch is incomplete. Keep the entire dated board, not a partial total.
 const lost=board.items.filter(p=>p.status==='unverified'&&priorItems.some((old:any)=>old.productId===p.productId&&['online','offline'].includes(old.status))&&binding(pair.fieldMap,p.productId)===binding(prior?.fieldMap,p.productId));
 if(lost.length)throw Object.assign(Error('checks_incomplete'),{products:lost.map(p=>p.productId)});
 return {contract:'COS_SAVED_FLEET_BOARD_V1',fleet:pair,counts:board.counts,units:board.items.map(p=>({productId:p.productId,unitNumber:p.unitNumber,status:p.status,checkedAt:p.linked?.evidence?.observedAt||null,reason:p.linked?.evidence?.reason||p.linked?.reviewReason||null})),inventory:{total:board.total,field:board.field,shop:board.shop}};
}
