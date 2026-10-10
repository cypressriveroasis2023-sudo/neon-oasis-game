const CONTRACT='cos.legacy-install-evidence.v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Check={name:string;passed:boolean};
export type LegacyUnitEvidence={itemId:string;family:string;unitTag:string;purpose:string;disposition:string;itVerifiedAt:string|null;serviceReceiptAt:string|null;itChecks:Check[];rangerFieldUpdateAt:string|null};
export type LegacyInstallRecord={prepId:string;ticketNumber:string;siteLabel:string;prepStatus:string;recordedAt:string|null;fieldCompletedAt:string|null;ownerVerifiedAt:string|null;historical:boolean;reviewStatus:string;readyForOwnerReview:boolean;units:LegacyUnitEvidence[];heliosChecks:Check[];evidence:{stage:string;photos:number;signatures:number;signedAt:string|null}[];blockers:string[];fieldMapStatus:string;fieldMapNote:string};
export type LegacyInstallSnapshot={contract:string;readOnly:true;generatedAt:string;windowStart:string;limit:10;hasMore:boolean;items:LegacyInstallRecord[]};
const object=(v:any)=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const text=(v:any,max=240)=>typeof v==='string'&&v.length<=max&&!/[\x00-\x1f<>]|https?:|www\.|@|bearer\s|(?:password|token|secret|api[_ -]?key)\s*[:=]/i.test(v);
const date=(v:any)=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT/.test(v)&&Number.isFinite(Date.parse(v));
const optionalDate=(v:any)=>v===null||date(v);
const array=(v:any,max:number,valid:(row:any)=>boolean)=>Array.isArray(v)&&v.length<=max&&Array.from(v).every(valid);
const keys=(v:any,names:string[])=>object(v)&&Object.keys(v).length===names.length&&names.every(name=>Object.hasOwn(v,name));
const check=(v:any)=>keys(v,['name','passed'])&&text(v.name)&&typeof v.passed==='boolean';
export function checkedLegacyInstallEvidence(value:any,now=Date.now()):LegacyInstallSnapshot {
  const ids=new Set<string>();
  const valid=keys(value,['contract','readOnly','generatedAt','windowStart','limit','hasMore','items'])&&value.contract===CONTRACT&&value.readOnly===true&&value.limit===10&&typeof value.hasMore==='boolean'&&date(value.generatedAt)&&Math.abs(now-Date.parse(value.generatedAt))<=300000&&date(value.windowStart)&&Date.parse(value.generatedAt)-Date.parse(value.windowStart)===30*86400000&&
    array(value.items,10,row=>{
      if(!keys(row,['prepId','ticketNumber','siteLabel','prepStatus','recordedAt','fieldCompletedAt','ownerVerifiedAt','historical','reviewStatus','readyForOwnerReview','units','heliosChecks','evidence','blockers','fieldMapStatus','fieldMapNote'])||!UUID.test(row.prepId)||ids.has(row.prepId)||!/^\d{1,24}$/.test(row.ticketNumber)||!text(row.siteLabel)||!['closed','released'].includes(row.prepStatus)||!optionalDate(row.recordedAt)||!optionalDate(row.fieldCompletedAt)||!optionalDate(row.ownerVerifiedAt)||typeof row.historical!=='boolean'||typeof row.readyForOwnerReview!=='boolean'||!['ready','not_ready','correction_requested','closed','review_needed'].includes(row.reviewStatus)||row.fieldMapStatus!=='pending_exact_link'||!text(row.fieldMapNote))return false;
      ids.add(row.prepId);const unitIds=new Set<string>();
      if(!row.siteLabel.trim()||[row.recordedAt,row.fieldCompletedAt,row.ownerVerifiedAt].some(t=>t&&Date.parse(t)>Date.parse(value.generatedAt))||row.ownerVerifiedAt&&(!row.fieldCompletedAt||Date.parse(row.ownerVerifiedAt)<Date.parse(row.fieldCompletedAt))||row.readyForOwnerReview&&(row.historical||row.prepStatus!=='closed'||row.reviewStatus!=='ready'||!Array.isArray(row.blockers)||row.blockers.length))return false;
      return array(row.units,100,unit=>{
        if(!keys(unit,['itemId','family','unitTag','purpose','disposition','itVerifiedAt','serviceReceiptAt','itChecks','rangerFieldUpdateAt'])||!UUID.test(unit.itemId)||unitIds.has(unit.itemId)||!text(unit.family,60)||!text(unit.unitTag,80)||!['DELIVERY','SWAP','BACKUP','UNKNOWN'].includes(unit.purpose)||!['handoff_only','truck_spare','unused_replacement','review_needed','installation_recorded','swap_installation_recorded'].includes(unit.disposition)||!optionalDate(unit.itVerifiedAt)||!optionalDate(unit.serviceReceiptAt)||!optionalDate(unit.rangerFieldUpdateAt)||!array(unit.itChecks,3,check)||unit.itChecks.length!==3)return false;
        unitIds.add(unit.itemId);return Boolean(unit.family.trim()&&unit.unitTag.trim())&&![unit.itVerifiedAt,unit.serviceReceiptAt,unit.rangerFieldUpdateAt].some(t=>t&&Date.parse(t)>Date.parse(value.generatedAt))&&
          (unit.disposition!=='installation_recorded'||unit.family==='Helios'&&['DELIVERY','SWAP'].includes(unit.purpose)&&row.fieldCompletedAt!==null)&&
          (unit.disposition!=='swap_installation_recorded'||unit.purpose==='SWAP')&&(unit.disposition!=='truck_spare'||unit.purpose==='BACKUP');
      })&&array(row.heliosChecks,13,check)&&[0,13].includes(row.heliosChecks.length)&&array(row.blockers,12,(v:any)=>text(v))&&array(row.evidence,3,e=>keys(e,['stage','photos','signatures','signedAt'])&&['it','service','helios_install'].includes(e.stage)&&Number.isSafeInteger(e.photos)&&e.photos>=0&&e.photos<=300&&Number.isSafeInteger(e.signatures)&&e.signatures>=0&&e.signatures<=300&&optionalDate(e.signedAt)&&(!e.signedAt||Date.parse(e.signedAt)<=Date.parse(value.generatedAt)))&&row.evidence.length===3&&new Set(row.evidence.map((e:any)=>e.stage)).size===3&&
        (!row.fieldCompletedAt||row.heliosChecks.length===13&&row.heliosChecks.every((check:Check)=>check.passed)&&row.evidence.some((e:any)=>e.stage==='helios_install'&&e.photos>0&&e.photos>=row.units.filter((u:any)=>u.disposition==='installation_recorded').length&&e.signatures>0&&e.signedAt&&Date.parse(e.signedAt)<=Date.parse(row.fieldCompletedAt)));
    });
  if(!valid)throw new Error('Legacy installation evidence could not be verified. Refresh to try again.');
  return value;
}
export const legacyDispositionLabels:Record<string,string>={
  installation_recorded:'Helios field installation submitted',swap_installation_recorded:'SWAP recorded installed; final installation review still required',
  handoff_only:'Service handoff evidence only; installation completion pending',unused_replacement:'Unused replacement; not installed',truck_spare:'Truck spare; not proof of installation',review_needed:'Equipment identity or outcome needs review',
};
