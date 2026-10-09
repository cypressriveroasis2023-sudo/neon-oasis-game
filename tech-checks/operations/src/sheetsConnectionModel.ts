import {trackerWorkbookId} from './unitTracker';
export type SheetsConnection={contract:'cos-google-sheets-connection-v1';workbookId:string;
 state:'setup_required'|'ready_to_test'|'read_access_verified';credentialConfigured:boolean;serviceAccountEmail:string|null;
 readAccessVerified:boolean;checkedAt:string|null;mode:'read_only';sheetsPublisher:false;automaticSync:false;
 equipmentRows:number;duplicateLabelRows:number;formulaRows:number;placementReviewRows:number;
 tabs:{tabId:number;title:string;equipmentRows:number;formulaRows:number;placementReviewRows:number}[]};
const expectedTabs:Record<number,string>={568394918:'SOLAR SPOTTERS',2017346590:'SPOTTERS',426115083:'HELIOS',386511683:'RANGERS',826256700:'SNIPERS',651684134:'CAM V & RSU',451969219:'RECONS',135363149:'RECON II',1975227208:'SOLAR STANDS 72',828079282:'SOLAR POLES & SKIDS'};
const object=(v:unknown):v is Record<string,any>=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const count=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=100000;
const invalid=():never=>{throw Error('The Sheets connection response could not be verified. Retry the check.');};
export function checkedSheetsConnection(v:unknown):SheetsConnection {
 if(!object(v)||v.contract!=='cos-google-sheets-connection-v1'||v.workbookId!==trackerWorkbookId
  ||!['setup_required','ready_to_test','read_access_verified'].includes(v.state)||typeof v.credentialConfigured!=='boolean'
  ||typeof v.readAccessVerified!=='boolean'||v.mode!=='read_only'||v.sheetsPublisher!==false||v.automaticSync!==false
  ||!Array.isArray(v.tabs)||v.tabs.length>10||!['equipmentRows','duplicateLabelRows','formulaRows','placementReviewRows'].every(k=>count(v[k])))return invalid();
 if(v.credentialConfigured?typeof v.serviceAccountEmail!=='string'||v.serviceAccountEmail.length>254||!/^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9.-]*\.iam\.gserviceaccount\.com$/.test(v.serviceAccountEmail):v.serviceAccountEmail!==null)return invalid();
 if(v.state==='read_access_verified'){
  if(!v.credentialConfigured||!v.readAccessVerified||typeof v.checkedAt!=='string'||!Number.isFinite(Date.parse(v.checkedAt))||v.tabs.length!==10)return invalid();
  const seen=new Set<number>();let rows=0,formulas=0,placements=0;
  for(const t of v.tabs){if(!object(t)||!Number.isSafeInteger(t.tabId)||!Object.hasOwn(expectedTabs,t.tabId)||expectedTabs[t.tabId]!==t.title||seen.has(t.tabId)||!count(t.equipmentRows)||!count(t.formulaRows)||!count(t.placementReviewRows)||t.formulaRows>t.equipmentRows||t.placementReviewRows>t.equipmentRows)return invalid();seen.add(t.tabId);rows+=t.equipmentRows;formulas+=t.formulaRows;placements+=t.placementReviewRows;}
  if(rows!==v.equipmentRows||formulas!==v.formulaRows||placements!==v.placementReviewRows||v.duplicateLabelRows>rows)return invalid();
 }else if(v.readAccessVerified||v.checkedAt!==null||v.tabs.length||v.equipmentRows||v.formulaRows||v.placementReviewRows||v.duplicateLabelRows||v.credentialConfigured!==(v.state==='ready_to_test'))return invalid();
 return v as SheetsConnection;
}
