import type {FleetDashboardRow} from './fleetDashboardModel';
import type {UnitCameraHealth} from './fieldCameraHealth';
import type {FieldProduct} from './mhelpFieldHealth';

/** Presentation-only overlay of a verified Product-ID TCP result. Never
 * infer unit identity from names, and do not mutate provider or inventory. */
export function productConnectionFleetRows(
 rows:FleetDashboardRow[],products:{items:FieldProduct[]}|null
):FleetDashboardRow[]{
 if(!products)return rows;
 const byUnitId=new Map<string,FieldProduct[]>();
 for(const product of products.items){
  const evidence=product.evidence;
  if(!product.unitId||!evidence||!['exact_product_id_tracker_endpoint','product_id_connection_unavailable'].includes(evidence?.association||'')||evidence.basis!=='connection')continue;
  const known=evidence.association==='exact_product_id_tracker_endpoint'&&['online','offline'].includes(product.state)
   &&evidence.observations.length===1&&evidence.observations[0].fresh===true
   &&evidence.observations[0].currentState===product.state;
  const unresolved=product.state==='unverified'&&evidence.gap==='no_current_reading'
   &&evidence.observedAt===null&&evidence.observations.length===0;
  if(!known&&!unresolved)continue;
  byUnitId.set(product.unitId,[...(byUnitId.get(product.unitId)||[]),product]);
 }
 return rows.map(row=>{
  const claimed=byUnitId.get(row.id)||[];
  if(claimed.length!==1||row.support||row.retired||row.placement!=='field')return row;
  const product=claimed[0];
  const status=product.state==='unverified'?'unknown':product.state as 'online'|'offline';
  return {...row,cameraState:status,camera:{
   ...row.camera,state:status,basis:'connection',checkedAt:product.evidence!.observedAt,
   reason:product.reason,observation:undefined,
  },review:[...row.review.filter(reason=>reason!==row.camera.reason),
    ...(status==='unknown'?[product.reason]:[])]};
 });
}

/** One native unit detail badge uses the exact same accepted Product-ID
 * connection result as Fleet's headline. Raw provider/channel diagnostics
 * remain untouched in the unit's rows and classification. */
export function productConnectionUnitDetail(
 original:UnitCameraHealth|null,unitId:string,products:readonly FieldProduct[]
):UnitCameraHealth|null{
 if(!original||!unitId||original.state==='support')return original;
 const claims=products.filter(product=>product.unitId===unitId&&product.evidence
   &&['exact_product_id_tracker_endpoint','product_id_connection_unavailable'].includes(product.evidence?.association||'')
   &&product.evidence.basis==='connection'
   &&(product.evidence.association==='exact_product_id_tracker_endpoint'&&(product.state==='online'||product.state==='offline')
     ||product.state==='unverified'&&product.evidence.gap==='no_current_reading'));
 if(claims.length!==1)return original;
 const product=claims[0],status=product.state==='unverified'?'unknown':product.state as 'online'|'offline';
 return {...original,state:status,basis:'connection',checkedAt:product.evidence!.observedAt,reason:product.reason};
}
