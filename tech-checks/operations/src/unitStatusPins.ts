import type {UnitCameraStatus} from '../shared/starUnitStatus';
import {canonicalCameraUnit} from './fieldCameraHealth';

// Map colours for a unit's camera status. Yellow really is yellow on the map:
// the list's dot uses the board's two-tone set, the map does not.
export const PIN_COLOUR:Record<UnitCameraStatus['state'],string>={GREEN:'#2e9e5b',YELLOW:'#e0a52a',RED:'#d64545',UNKNOWN:'#8a8f98'};
export const PIN_LABEL:Record<UnitCameraStatus['state'],string>={GREEN:'All cameras up',YELLOW:'Some cameras down',RED:'All cameras down',UNKNOWN:'Not verified'};

/** A saved field address from the unit list, already matched to a point by the Fleet map. */
export type SavedAddressPin={unitNumber:string;address:string;point:[number,number]};
export type UnitPin={unit:string;state:UnitCameraStatus['state'];colour:string;label:string;latitude:number;longitude:number;site:string|null;address:string|null;online:number;cameras:number;
 // 'hand' is an address a person typed on this page. 'saved' is the address already
 // on the unit list, which the Fleet map draws too; nobody has confirmed it on site.
 source:'hand'|'saved'};

/** Index saved addresses by unit, so one unit never takes another unit's address. */
export function savedAddressByUnit(saved:readonly SavedAddressPin[]|null|undefined):Map<string,SavedAddressPin>{
 const counts=new Map<string,number>(),found=new Map<string,SavedAddressPin>();
 for(const pin of saved||[]){
  const key=canonicalCameraUnit(String(pin?.unitNumber||''));
  if(!key||!Array.isArray(pin.point))continue;
  const [latitude,longitude]=pin.point;
  if(typeof latitude!=='number'||typeof longitude!=='number'||!Number.isFinite(latitude)||!Number.isFinite(longitude)
   ||Math.abs(latitude)>90||Math.abs(longitude)>180||(latitude===0&&longitude===0))continue;
  counts.set(key,(counts.get(key)||0)+1);
  found.set(key,pin);
 }
 // Two saved addresses under one unit name prove nothing about which is right.
 for(const [key,count] of counts)if(count>1)found.delete(key);
 return found;
}

/** One pin per field unit that has a recorded, matched point. Nothing is placed by guesswork. */
export function unitPins(units:readonly UnitCameraStatus[],saved?:readonly SavedAddressPin[]|null):{pins:UnitPin[];fieldUnits:number;withoutPin:number;handPins:number;savedPins:number}{
 const field=units.filter(unit=>unit.placement==='FIELD');
 const bySaved=savedAddressByUnit(saved);
 const pins:UnitPin[]=field.flatMap((unit):UnitPin[]=>{
  const at=unit.location;
  const common={unit:unit.unit,state:unit.state,colour:PIN_COLOUR[unit.state],label:PIN_LABEL[unit.state],site:unit.site,online:unit.online,cameras:unit.cameras};
  // An address a person typed wins over the one already on the unit list.
  if(at&&typeof at.latitude==='number'&&typeof at.longitude==='number'&&Number.isFinite(at.latitude)&&Number.isFinite(at.longitude))
   return [{...common,latitude:at.latitude,longitude:at.longitude,address:unit.address??null,source:'hand' as const}];
  const key=canonicalCameraUnit(unit.unit),fallback=key?bySaved.get(key):undefined;
  if(!fallback)return [];
  return [{...common,latitude:fallback.point[0],longitude:fallback.point[1],address:fallback.address||null,source:'saved' as const}];
 });
 // Problems draw last, so a red pin is never hidden under a green one.
 const order={GREEN:0,UNKNOWN:1,YELLOW:2,RED:3} as const;
 pins.sort((a,b)=>order[a.state]-order[b.state]||a.unit.localeCompare(b.unit));
 return {pins,fieldUnits:field.length,withoutPin:field.length-pins.length,
  handPins:pins.filter(pin=>pin.source==='hand').length,savedPins:pins.filter(pin=>pin.source==='saved').length};
}
