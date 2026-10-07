import {canonicalCameraUnit} from './fieldCameraHealth';
/** Deep links retain family and variant. Never choose the first ambiguous asset. */
export function fieldMapLabelMatches<T extends {id:string;unitNumber:string}>(items:T[],label:string):T[]{
 const key=canonicalCameraUnit(label),exact=label.trim().toUpperCase();
 if(!exact||exact.length>120)return [];
 return items.filter(unit=>key?canonicalCameraUnit(unit.unitNumber)===key:unit.unitNumber.trim().toUpperCase()===exact);
}
