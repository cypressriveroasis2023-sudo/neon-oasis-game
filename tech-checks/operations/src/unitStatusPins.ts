import type {UnitCameraStatus} from '../shared/starUnitStatus';

// Map colours for a unit's camera status. Yellow really is yellow on the map:
// the list's dot uses the board's two-tone set, the map does not.
export const PIN_COLOUR:Record<UnitCameraStatus['state'],string>={GREEN:'#2e9e5b',YELLOW:'#e0a52a',RED:'#d64545',UNKNOWN:'#8a8f98'};
export const PIN_LABEL:Record<UnitCameraStatus['state'],string>={GREEN:'All cameras up',YELLOW:'Some cameras down',RED:'All cameras down',UNKNOWN:'Not verified'};

export type UnitPin={unit:string;state:UnitCameraStatus['state'];colour:string;label:string;latitude:number;longitude:number;site:string|null;address:string|null;online:number;cameras:number};

/** One pin per field unit that has a recorded, matched point. Nothing is placed by guesswork. */
export function unitPins(units:readonly UnitCameraStatus[]):{pins:UnitPin[];fieldUnits:number;withoutPin:number}{
 const field=units.filter(unit=>unit.placement==='FIELD');
 const pins=field.flatMap(unit=>{
  const at=unit.location;
  if(!at||typeof at.latitude!=='number'||typeof at.longitude!=='number'||!Number.isFinite(at.latitude)||!Number.isFinite(at.longitude))return [];
  return [{unit:unit.unit,state:unit.state,colour:PIN_COLOUR[unit.state],label:PIN_LABEL[unit.state],latitude:at.latitude,longitude:at.longitude,
   site:unit.site,address:unit.address??null,online:unit.online,cameras:unit.cameras}];
 });
 // Problems draw last, so a red pin is never hidden under a green one.
 const order={GREEN:0,UNKNOWN:1,YELLOW:2,RED:3} as const;
 pins.sort((a,b)=>order[a.state]-order[b.state]||a.unit.localeCompare(b.unit));
 return {pins,fieldUnits:field.length,withoutPin:field.length-pins.length};
}
