// Which units a group or a count tile shows. Kept apart from the view so the
// rule the screen follows can be checked on its own.
import type {UnitCameraStatus,UnitSource} from '../shared/starUnitStatus';

/** Where a unit's up/down reading comes from. The list is searchable by it. */
export const SOURCE_LABEL:Record<UnitSource,string>={star4live:'Star4Live',ip_check:'Avigilon',reconeyez:'Reconeyez'};
export const sourceOf=(unit:UnitCameraStatus):UnitSource=>unit.source||'star4live';

export type Group='field'|'attention'|'shop-online'|'shop';
export type StateFilter='all'|UnitCameraStatus['state'];

export const GROUPS:{id:Group;label:string;note:string}[]=[
 {id:'field',label:'In the field',note:'Units with a camera reporting from a customer site.'},
 {id:'attention',label:'Needs attention',note:'Field units with at least one camera not reporting as online.'},
 {id:'shop-online',label:'Online in the shop',note:'Online, still in root. It stays in the shop until somebody moves it to a site.'},
 {id:'shop',label:'In the shop',note:'Everything in root, online or not. Shop units never count as a field outage.'},
];

export function groupedUnits(units:UnitCameraStatus[],group:Group,query:string,state:StateFilter='all'):UnitCameraStatus[]{
 const text=query.trim().toLowerCase();
 return units.filter(unit=>{
  if(state!=='all'&&unit.state!==state)return false;
  if(group==='field'&&unit.placement!=='FIELD')return false;
  if(group==='attention'&&!(unit.placement==='FIELD'&&unit.state!=='GREEN'))return false;
  if(group==='shop-online'&&!unit.onlineInShop)return false;
  if(group==='shop'&&unit.placement!=='SHOP')return false;
  if(!text)return true;
  return [unit.unit,unit.site||'',unit.address||'',unit.publicIp||'',SOURCE_LABEL[sourceOf(unit)]].some(field=>field.toLowerCase().includes(text));
 });
}
