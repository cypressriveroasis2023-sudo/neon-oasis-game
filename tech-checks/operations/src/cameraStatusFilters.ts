// Which units a group or a count tile shows. Kept apart from the view so the
// rule the screen follows can be checked on its own.
import type {UnitCameraStatus,UnitSource} from '../shared/starUnitStatus';
import {canonicalCameraUnit} from './fieldCameraHealth';

/** Where a unit's up/down reading comes from. */
export const SOURCE_LABEL:Record<UnitSource,string>={star4live:'Star4Live',ip_check:'Avigilon',reconeyez:'Reconeyez'};
export const sourceOf=(unit:UnitCameraStatus):UnitSource=>unit.source||'star4live';

/** The three kinds of equipment COS carries, as the shop names them. Snipers,
 * Sniper 2s, Sniper 4s and CAM Vs are Avigilon; Recon IIs are Recon; the rest of
 * the camera units are Alibi. A name that does not parse falls back to whichever
 * system reported the unit. The list is searchable by this. */
export type UnitFamily='avigilon'|'recon'|'alibi';
export const FAMILY_LABEL:Record<UnitFamily,string>={avigilon:'Avigilon',recon:'Recon II',alibi:'Alibi'};
const AVIGILON=new Set(['SNIPER','SNIPER2','SNIPER4','CAMV']);
const BY_SOURCE:Record<UnitSource,UnitFamily>={ip_check:'avigilon',reconeyez:'recon',star4live:'alibi'};
export const unitName=(unit:UnitCameraStatus):string=>unit.displayName||unit.unit;
export function familyOf(unit:UnitCameraStatus):UnitFamily{
 const name=canonicalCameraUnit(unitName(unit))?.split('|')[0];
 if(name&&AVIGILON.has(name))return 'avigilon';
 if(name==='RECON2')return 'recon';
 if(name)return 'alibi';
 return BY_SOURCE[sourceOf(unit)];
}

export type Group='field'|'attention'|'shop-online'|'shop';
export type StateFilter='all'|UnitCameraStatus['state'];
/** Which make of equipment a count tile or the list is narrowed to. 'all' is
 * every family, so a brand tile narrows what is already shown rather than
 * replacing it. */
export type FamilyFilter='all'|UnitFamily;

/** How many field units of each make, for the brand tiles. Counted off the same
 * units the list shows, so a tile can never disagree with the rows under it. */
export function familyFieldCounts(units:UnitCameraStatus[]):Record<UnitFamily,number>{
 const totals:Record<UnitFamily,number>={avigilon:0,recon:0,alibi:0};
 for(const unit of units)if(unit.placement==='FIELD')totals[familyOf(unit)]+=1;
 return totals;
}

/** Every unit of each make on this board, shop included. The field tiles stay
 * on familyFieldCounts so a shop unit is never added to the field number. */
export function familyBoardCounts(units:UnitCameraStatus[]):Record<UnitFamily,number>{
 const totals:Record<UnitFamily,number>={avigilon:0,recon:0,alibi:0};
 for(const unit of units)totals[familyOf(unit)]+=1;
 return totals;
}

export const GROUPS:{id:Group;label:string;note:string}[]=[
 {id:'field',label:'In the field',note:'Units with a camera reporting from a customer site.'},
 {id:'attention',label:'Needs attention',note:'Field units with at least one camera not reporting as online.'},
 {id:'shop-online',label:'Online in the shop',note:'Online, still in root. It stays in the shop until somebody moves it to a site.'},
 {id:'shop',label:'In the shop',note:'Everything in root, online or not. Shop units never count as a field outage.'},
];

export function groupedUnits(units:UnitCameraStatus[],group:Group,query:string,state:StateFilter='all',family:FamilyFilter='all'):UnitCameraStatus[]{
 const text=query.trim().toLowerCase();
 return units.filter(unit=>{
  if(state!=='all'&&unit.state!==state)return false;
  // The make is matched on the parsed family, never on the typed text: a site
  // or address that happens to contain 'alibi' is not an Alibi unit.
  if(family!=='all'&&familyOf(unit)!==family)return false;
  if(group==='field'&&unit.placement!=='FIELD')return false;
  if(group==='attention'&&!(unit.placement==='FIELD'&&unit.state!=='GREEN'))return false;
  if(group==='shop-online'&&!unit.onlineInShop)return false;
  if(group==='shop'&&unit.placement!=='SHOP')return false;
  if(!text)return true;
  return [unit.unit,unit.displayName||'',unit.site||'',unit.address||'',FAMILY_LABEL[familyOf(unit)]].some(field=>field.toLowerCase().includes(text));
 });
}
