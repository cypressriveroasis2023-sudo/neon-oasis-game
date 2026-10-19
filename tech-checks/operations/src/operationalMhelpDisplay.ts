import type {MhelpAddressMapResult} from './mhelpAddressMapPins';

type Row=Record<string,unknown>;
const obj=(v:unknown):v is Row=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==='string'&&/^[1-9][0-9]{0,14}$/.test(v);
/** The verified current mHelp upload is kept intact. On-screen Owner moves
 * supersede its old address pins only for the same exact Product ID. */
export function currentOperationalMhelp(
 upload:unknown,overrides:unknown,raw:MhelpAddressMapResult|null
){
 if(!obj(upload)||!Array.isArray(upload.records))return {display:raw,field:null,shop:null,moved:new Set<string>()};
 const records=upload.records as Row[];
 if(records.length>10000||records.some(r=>!obj(r)||!id(r.productId)||!['FIELD','SHOP'].includes(String(r.placement)))
   ||new Set(records.map(r=>r.productId)).size!==records.length)
  return {display:null,field:null,shop:null,moved:new Set<string>()};
 const mapping=new Map<string,'FIELD'|'SHOP'>();
 if(obj(overrides)&&overrides.contract==='COS_OPERATIONAL_OVERRIDES_V1'
   &&overrides.sourceSha256===upload.sourceSha256&&Array.isArray(overrides.items)
   &&overrides.items.length<=records.length){
  for(const raw of overrides.items){
   if(!obj(raw)||!id(raw.productId)||mapping.has(raw.productId)||!['FIELD','SHOP'].includes(String(raw.placement))
    ||!records.some(r=>r.productId===raw.productId&&r.unitNumber===raw.unitNumber))
    return {display:null,field:null,shop:null,moved:new Set<string>()};
   mapping.set(raw.productId,raw.placement as 'FIELD'|'SHOP');
  }
 }
 let field=0,shop=0;
 for(const r of records){if((mapping.get(r.productId as string)||r.placement)==='FIELD')field++;else shop++;}
 if(!raw)return {display:raw,field,shop,moved:new Set(mapping.keys())};
 const pins=raw.pins.filter(p=>!mapping.has(p.productId));
 const reviews=raw.reviews.filter(p=>!mapping.has(p.productId));
 const display={...raw,pins,reviews,
  totalField:pins.length+reviews.length,
  matched:pins.filter(p=>p.state==='matched').length,
  addressReview:pins.filter(p=>p.state==='address_review').length,
  unlocated:reviews.length
 };
 return {display,field,shop,moved:new Set(mapping.keys())};
}
