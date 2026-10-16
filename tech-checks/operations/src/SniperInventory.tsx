type InventoryRow={inventoryOnlyReason?:'no_sim';observedAt?:string;recordId:string;productId:string;sourceUnitNumber:string;category:string;customer:string;placement:'FIELD'|'SHOP';uploadLifecycle:'UNFLAGGED'|'DO_NOT_USE'|'MISSING';binding:{state:'linked'|'unlinked'|'held'}};
const families=new Set(['Sniper','Sniper ES','Sniper 2','Sniper 2 SA','Sniper 4','Radar - Sniper','Thermal - Sniper','CAM-V']);
/** Source inventory only: never changes operational eligibility or resource identity. */
export function sniperInventory(value:unknown){
 const v=value as {contract?:string;countBasis?:string;receivedAt?:string;records?:InventoryRow[];summary?:{totalRecords:number}}|null;
 if(!v||v.contract!=='COS_MHELP_UPLOAD_INVENTORY_V1'||v.countBasis!=='mhelp_product_records_not_unique_physical_units'||!Array.isArray(v.records)||v.records.length!==v.summary?.totalRecords||!v.receivedAt||!Number.isFinite(Date.parse(v.receivedAt)))return null;
 const ids=new Set<string>();
 for(const r of v.records){
  if(!r||typeof r.productId!=='string'||!/^\d+$/.test(r.productId)||ids.has(r.productId)||r.recordId!=='mhelp_product:'+r.productId||typeof r.sourceUnitNumber!=='string'||!r.sourceUnitNumber||typeof r.category!=='string'||typeof r.customer!=='string'||!['FIELD','SHOP'].includes(r.placement)||!['UNFLAGGED','DO_NOT_USE','MISSING'].includes(r.uploadLifecycle)||!['linked','unlinked','held'].includes(r.binding?.state))return null;
  if(r.inventoryOnlyReason!==undefined&&(r.inventoryOnlyReason!=='no_sim'||r.placement!=='SHOP'||r.binding.state==='linked'))return null;
  ids.add(r.productId);
 }
 const records=v.records.filter(r=>families.has(r.category)).slice().sort((a,b)=>a.sourceUnitNumber.localeCompare(b.sourceUnitNumber));
 return {records,receivedAt:v.receivedAt,field:records.filter(r=>r.placement==='FIELD').length,shop:records.filter(r=>r.placement==='SHOP').length,restricted:records.filter(r=>r.uploadLifecycle==='DO_NOT_USE').length};
}
export default function SniperInventory({value}:{value:unknown}){
 const inventory=sniperInventory(value);
 if(!inventory)return <p role='status'>Sniper / CAM V source inventory is unavailable.</p>;
 return <details className='cos-fleet-count-note'><summary>Sniper / CAM V inventory · {inventory.records.length} records</summary>
  <p>{inventory.field} recorded FIELD · {inventory.shop} SHOP · {inventory.restricted} DO NOT USE. Includes restricted equipment and records without a COS unit link. These are mHelp inventory assignments, not live health or activation status.</p>
  <p>Base source received {new Date(inventory.receivedAt).toISOString()}; reviewed row corrections retain their own source times. This complete source list is independent of the fleet filters above.</p>
  <div style={{overflowX:'auto'}}><table><thead><tr><th>Unit</th><th>Customer</th><th>Assignment</th><th>Restriction</th><th>Equipment link</th><th>Connection</th><th>Recorded</th></tr></thead><tbody>{inventory.records.map(r=><tr key={r.productId}><td>{r.sourceUnitNumber}</td><td>{r.customer}</td><td>{r.placement}</td><td>{r.uploadLifecycle==='UNFLAGGED'?'None recorded':r.uploadLifecycle==='DO_NOT_USE'?'DO NOT USE':'MISSING'}</td><td>{r.binding.state==='linked'?'Linked':r.binding.state==='held'?'Identity review':'Unlinked'}</td><td>{r.inventoryOnlyReason==='no_sim'?'No SIM / no current IP':'See linked equipment details'}</td><td>{r.observedAt||inventory.receivedAt}</td></tr>)}</tbody></table></div>
 </details>;
}
