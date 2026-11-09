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
 // Unknown / Unverified is a valid current result for an unrun, stale,
 // technical-error, target-mismatch or source-conflict observation. Publish
 // that current state once the complete source bundle has been reconciled.
 return {contract:'COS_SAVED_FLEET_BOARD_V1',fleet:pair,counts:board.counts,units:board.items.map(p=>({productId:p.productId,unitNumber:p.unitNumber,status:p.status,checkedAt:p.linked?.evidence?.observedAt||null,reason:p.linked?.evidence?.reason||p.linked?.reviewReason||null})),inventory:{total:board.total,field:board.field,shop:board.shop}};
}
