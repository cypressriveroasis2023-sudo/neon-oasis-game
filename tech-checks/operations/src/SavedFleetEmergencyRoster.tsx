import {useMemo,useState} from 'react';
import {readMhelpInventoryAuthority} from './mhelpInventoryAuthority';
import {recordedAddressText} from './fleetDisplayAddress';

type SavedProduct={
  productId:string;unitNumber:string;customer:string;address:string;placement:'FIELD'|'SHOP';
};
type Recovery={
  readAt:string;sourceAt:string;sourceStale:boolean;field:number;shop:number;records:SavedProduct[];
};

/** Read-only fallback. Never infers a camera status, assigns a Product ID,
 * opens a connection or renews the saved observation timestamp. */
export function readSavedFleetRecovery(response:unknown,now=Date.now()):Recovery|null{
 try{
  const value=response as any;
  const board=value?.latest?.payload;
  if(value?.contract!=='COS_DURABLE_FLEET_RESPONSE_V1'||board?.contract!=='COS_SAVED_FLEET_BOARD_V1')return null;
  const readAt=board.fleet?.readAt;
  const stamp=typeof readAt==='string'?Date.parse(readAt):NaN;
  if(!Number.isFinite(stamp)||stamp<=0||stamp>now+300000)return null;
  const upload=board.fleet?.fieldMap?.uploadInventory;
  const authority=readMhelpInventoryAuthority(upload,now);
  if(!authority)return null;
  const products=(upload.records as any[]).map(item=>({
    productId:item.productId,
    unitNumber:typeof item.unitNumber==='string'&&item.unitNumber.trim()?item.unitNumber:'Product '+item.productId,
    customer:typeof item.customer==='string'?item.customer:'',
    address:recordedAddressText(item.sourceAddress),
    placement:item.placement as 'FIELD'|'SHOP',
  }));
  if(products.length!==authority.total)return null;
  return {readAt,sourceAt:authority.receivedAt,sourceStale:authority.stale,field:authority.field,shop:authority.shop,records:products};
 }catch{return null;}
}
const format=(value:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value));

export default function SavedFleetEmergencyRoster({response}:{response:unknown}){
 const [query,setQuery]=useState(''),[placement,setPlacement]=useState<'FIELD'|'SHOP'>('FIELD');
 const recovered=useMemo(()=>readSavedFleetRecovery(response),[response]);
 if(!recovered)return <p role="status">The detailed saved equipment roster is unavailable. The completed camera counts above keep their original timestamp.</p>;
 const text=query.trim().toLocaleLowerCase();
 const list=recovered.records.filter(item=>item.placement===placement&&(!text||[item.productId,item.unitNumber,item.customer,item.address].join(' ').toLocaleLowerCase().includes(text)));
 return <section className="cos-fleet-message cos-saved-inventory-recovery" aria-label="Read-only saved mHelp equipment inventory">
  <h3>Saved equipment records</h3>
  <p>The normal Fleet display failed. These are previously verified mHelpDesk Product-ID records, <strong>not live camera checks</strong>. No online, offline, IP, or GPS status is inferred.</p>
  <p>Saved Fleet reading: <time dateTime={recovered.readAt}>{format(recovered.readAt)}</time>.
    Source received: <time dateTime={recovered.sourceAt}>{format(recovered.sourceAt)}</time>.
    {recovered.sourceStale?' The inventory source is stale.':''}</p>
  <div className="cos-fleet-recovery-scope">
    <button type="button" aria-pressed={placement==='FIELD'} onClick={()=>setPlacement('FIELD')}>Field {recovered.field}</button>
    <button type="button" aria-pressed={placement==='SHOP'} onClick={()=>setPlacement('SHOP')}>Shop / ROOT {recovered.shop}</button>
  </div>
  <label>Search saved equipment <input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Unit, Product ID, customer or address"/></label>
  <p role="status">{list.length} matching {placement==='FIELD'?'Field':'Shop'} Product IDs · showing up to 40</p>
  <ul>{list.slice(0,40).map(item=><li key={item.productId}>
    <strong>{item.unitNumber}</strong> · Product {item.productId}
    {item.customer&&<div>{item.customer}</div>}
    <small>{item.address?'mHelp customer/service address: '+item.address:'No recorded service address'}</small>
   </li>)}</ul>
  {list.length===0&&<p>No saved records match this search.</p>}
 </section>;
}
