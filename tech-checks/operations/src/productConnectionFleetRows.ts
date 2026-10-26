import type {FleetDashboardRow} from './fleetDashboardModel';
import type {FieldProduct} from './mhelpFieldHealth';

/** Read-only presentation overlay. Use only status already accepted for the
 * exact Product ID, not a legacy family/name or provider channel result.
 * Do not mutate native inventory, identity proofs, raw source rows or history.
 */
export function productConnectionFleetRows(
 rows:FleetDashboardRow[],products:{items:FieldProduct[]}|null
):FleetDashboardRow[]{
 if(!products)return rows;
 const byUnitId=new Map<string,FieldProduct[]>();
 for(const product of products.items){
  if(!product.unitId||!['online','offline'].includes(product.state)
   ||product.evidence?.association!=='exact_product_id_tracker_endpoint'
   ||product.evidence.basis!=='connection'||product.evidence.observations.length!==1
   ||product.evidence.observations[0].fresh!==true||product.evidence.observations[0].currentState!==product.state)continue;
  byUnitId.set(product.unitId,[...(byUnitId.get(product.unitId)||[]),product]);
 }
 return rows.map(row=>{
  const claimed=byUnitId.get(row.id)||[];
  if(claimed.length!==1||row.support||row.retired||row.placement!=='field')return row;
  const proof=claimed[0];
  if(proof.state!=='online'&&proof.state!=='offline')return row;
  return {...row,cameraState:proof.state,camera:{
   ...row.camera,state:proof.state,basis:'connection',checkedAt:proof.evidence!.observedAt,
   reason:proof.reason,observation:undefined,
  },review:row.review.filter(reason=>reason!==row.camera.reason)};
 });
}
