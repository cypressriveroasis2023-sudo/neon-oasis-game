/* Read-only placement candidates from the existing protected COS MHelp import
 * and combined fleet roster. Candidate links NEVER certify a source-to-camera
 * identity or authorize Field service/Shop placement.
 */
type Row = Record<string,any>;
const obj = (v:unknown):v is Row => !!v && typeof v==='object'&&!Array.isArray(v);
const str = (v:unknown) => typeof v==='string'?v.trim():'';
const time = (v:unknown,now:number) => typeof v==='string'&&
  Number.isFinite(Date.parse(v))&&Date.parse(v)>0&&Date.parse(v)<=now;
const positiveId = (v:unknown)=>typeof v==='string'&&/^[1-9]\d{0,18}$/.test(v);
const hash = (v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/i.test(v);
const typedUnit=(v:unknown):{key:string;concern:string;suffix:string}|null=>{
  const upper=str(v).toUpperCase().replace(/[\s#_-]+/g,'');
  const matched=/^(AXISSOLARSPOTTER|AXISSPOTTER|SOLARSPOTTER|SNIPER4|SNIPER2|RECONII|RECON2|RANGER|SPOTTER|SNIPER|HELIOS|CAMV|RECON|RSU|SSHYBRID)(0*[1-9]\d{0,5}(?:\.\d+)?)(.*)$/.exec(upper);
  if(!matched)return null;
  const family=matched[1]==='RECONII'?'RECON2':matched[1];
  const [integer,fraction]=matched[2].split('.');
  const unitNumber=String(Number(integer))+(fraction===undefined?'':'.'+fraction);
  const suffix=matched[3]||'';
  // A suffix variant is never silently equated to an unsuffixed resource.
  return {key:family+'|'+unitNumber+'|'+suffix,concern:family+'|'+unitNumber,suffix};
};
type Candidate={
  state:'exact_mhelp_product_candidate'|'unit_variant_review'|'ambiguous_source_products';
  product_id:string|null; mhelp_unit:string|null; placement:'FIELD'|'SHOP'|'UNKNOWN'|null;
  customer:string|null; source_address:string|null; source_received_at:string|null;
  basis:string;
};
export function readMhelpCandidates(fieldMap:unknown,now=Date.now()):Map<string,Candidate> {
  const found=new Map<string,Candidate>();
  if(!obj(fieldMap)||!obj(fieldMap.uploadInventory)||!obj(fieldMap.fleetRoster))return found;
  const upload=fieldMap.uploadInventory,roster=fieldMap.fleetRoster;
  if(upload.contract!=='COS_MHELP_UPLOAD_INVENTORY_V1'||
     roster.contract!=='COS_COMBINED_FLEET_ROSTER_V1'||
     !hash(upload.sourceSha256)||!time(upload.receivedAt,now)||
     !Array.isArray(upload.records)||!Array.isArray(roster.items)||
     upload.records.length>3000||roster.items.length>5000||
     !obj(upload.summary)||!obj(roster.summary)||
     upload.summary.totalRecords!==upload.records.length||
     roster.summary.totalRecords!==roster.items.length)return found;
  const uploads=new Map<string,Row>(),counts=new Map<string,number>();
  for(const item of upload.records){
    if(!obj(item)||!positiveId(item.productId)||
      item.recordId!=='mhelp_product:'+item.productId||
      !str(item.unitNumber)||!['FIELD','SHOP'].includes(str(item.placement).toUpperCase())||
      !Array.isArray(item.binding?.unitIds)||!Array.isArray(item.binding?.candidateUnitIds))return found;
    if(uploads.has(item.productId))return new Map(); // Duplicate primary Product ID.
    uploads.set(item.productId,item);
  }
  // The combined roster must contain each imported product exactly once.
  for(const row of roster.items){
    if(!obj(row)||!Array.isArray(row.productIds)||row.productIds.some((v:unknown)=>!positiveId(v))||
      new Set(row.productIds).size!==row.productIds.length)return new Map();
    for(const id of row.productIds)counts.set(id,(counts.get(id)||0)+1);
  }
  const exact=new Map<string,Row[]>(),variants=new Map<string,Row[]>();
  for(const row of roster.items){
    if(row.productIds.length!==1||!str(row.unitNumber)||row.active!==true||row.lifecycle!=='active')continue;
    const id=row.productIds[0],source=uploads.get(id);
    if(!source||counts.get(id)!==1||!['FIELD','SHOP'].includes(str(source.placement).toUpperCase()))continue;
    const unit=typedUnit(row.unitNumber),importUnit=typedUnit(source.unitNumber);
    if(!unit||!importUnit||unit.key!==importUnit.key)continue;
    const product={...row,productId:id,importPlacement:str(source.placement).toUpperCase()};
    variants.set(unit.concern,[...(variants.get(unit.concern)||[]),product]);
    // The combined roster's own placement must agree with the current
    // protected MHelp source; conflicting Owner movement stays unverified.
    if(!unit.suffix&&!importUnit.suffix&&['field','shop'].includes(str(row.placement).toLowerCase())&&
        str(row.placement).toUpperCase()===product.importPlacement){
      exact.set(unit.key,[...(exact.get(unit.key)||[]),product]);
    }else if(unit.suffix&&unit.suffix===importUnit.suffix&&['field','shop'].includes(str(row.placement).toLowerCase())&&
        str(row.placement).toUpperCase()===product.importPlacement){
      exact.set(unit.key,[...(exact.get(unit.key)||[]),product]);
    }
  }
  // Product-specific, review-only authority. Provider device IDs/serials are
  // deliberately absent from this file and cannot be manufactured here.
  for(const [key,rows] of exact){
    if(rows.length!==1)continue;
    const row=rows[0];
    found.set(key,{
      state:'exact_mhelp_product_candidate',product_id:row.productId,
      mhelp_unit:row.unitNumber,placement:row.importPlacement,
      customer:str(row.customer)||null,source_address:str(row.sourceAddress)||null,
      source_received_at:upload.receivedAt,
      basis:'Unique full family, number and suffix plus one protected MHelp Product ID; CAMERA RESOURCE IDENTITY NOT VERIFIED',
    });
  }
  for(const [concern,rows] of variants){
    const keys=new Set(rows.map(row=>typedUnit(row.unitNumber)?.key).filter(Boolean));
    if(rows.length>1||keys.size>1){
      for(const row of rows){const key=typedUnit(row.unitNumber)?.key;if(key)found.set('review:'+concern,{
        state:'ambiguous_source_products',product_id:null,mhelp_unit:null,placement:null,
        customer:null,source_address:null,source_received_at:upload.receivedAt,
        basis:'Multiple imported products share a related equipment number. Check product IDs manually.',
      });}
      continue;
    }
    const row=rows[0];
    // Retain the exact full-key candidate AND a separate concern-key review
    // hint for an unsuffixed provider label. The hint never contains Field,
    // Shop, customer or address evidence and cannot promote placement.
    found.set('review:'+concern,{
      state:'unit_variant_review',product_id:row.productId,mhelp_unit:row.unitNumber,
      placement:null,customer:null,source_address:null,
      source_received_at:upload.receivedAt,
      basis:'Similar family and number, but model suffix/description differs. No Field/Shop or customer match is inferred.',
    });
  }
  return found;
}
export function candidateForSourceUnit(label:unknown,candidates:Map<string,Candidate>):Candidate|null {
  const parsed=typedUnit(label);
  if(!parsed)return null;
  return candidates.get(parsed.key)||candidates.get('review:'+parsed.concern)||null;
}
