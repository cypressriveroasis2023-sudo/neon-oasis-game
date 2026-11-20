import {prepareImmutableIdentityEnvelope} from '../src/verifiedUnitIdentity';
import {reconcileFleetSnapshot} from '../src/fleetSnapshot';
import {cameraFieldProducts} from '../src/cameraFieldProducts';
import {readExactProductConnections} from '../src/exactProductConnection';
import {ageFeed, type FeedId} from '../src/feedFreshness';
function feedStamp(id:FeedId,value:unknown,at:number){
 const age=ageFeed(typeof value==='string'||typeof value==='number'?value:null,at,id);
 return {readAt:age.readAt===null?null:new Date(age.readAt).toISOString(),fresh:age.state==='fresh',reason:age.reason};
}
/** Server-only projection. No client-provided health is accepted.
 * A late mHelp list or tracker does not block the camera read. The last good
 * list is published with its own time and is not marked live. */
export function completedBoard(health:any,map:any,connections:any,previous:any,at=Date.now()){
 const upload=map?.uploadInventory,ids=upload?.records?.filter((r:any)=>r.placement==='FIELD').map((r:any)=>r.productId);
 if(!upload||!ids?.length||!(readExactProductConnections(connections,upload.sourceSha256,ids,at)||readExactProductConnections(connections,upload.sourceSha256,ids,at,'lastGood')))throw Error('connection_source_incomplete');
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
 return {contract:'COS_SAVED_FLEET_BOARD_V1',fleet:pair,counts:board.counts,units:board.items.map(p=>({productId:p.productId,unitNumber:p.unitNumber,status:p.status,checkedAt:p.linked?.evidence?.observedAt||null,reason:p.linked?.evidence?.reason||p.linked?.reviewReason||null})),inventory:{total:board.total,field:board.field,shop:board.shop},feeds:{mhelp:feedStamp('mhelp',upload.receivedAt??upload.lastApiReadAt,at),tracker:feedStamp('tracker',connections?.trackerVerifiedAt,at),cameras:feedStamp('cameras',health?.refreshedAt??at,at)}};
}
