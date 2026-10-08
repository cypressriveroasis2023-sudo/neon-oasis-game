import {parseAddress,compareAddress,type Parts} from './censusAddress.ts';
export type Installation={street:string;city:string|null;state:string;zip:string|null};
const states=new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP'.split(' '));
const unsafe=/[\r\n<>@=]|https?:|password|passwd|pwd|passcode|token|secret|credential|username|login|lockbox|gate[\s-]*code|access[\s-]*code|\bpin\b|\b(?:apt|apartment|suite|ste|unit|floor|bldg|building|contact|call|customer|phone|telephone|tel|email|login|username|password|passwd|pwd|token|secret|credential|code|note|notes)\b|\d{3}[-.]\d{3}[-.]\d{4}/i;
export function validInstallation(v:unknown):v is Installation{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;const p=v as Installation;
 return typeof p.street==='string'&&p.street.length<=300&&/^\d+[A-Z]?\s+[A-Za-z0-9 .'-]+$/i.test(p.street)&&p.street===p.street.trim()
  &&typeof p.state==='string'&&states.has(p.state)&&((typeof p.city==='string'&&p.city.length<=100&&/^[A-Za-z .'-]+$/.test(p.city)&&p.city===p.city.trim()&&p.city.length>0)||p.city===null)
  &&((typeof p.zip==='string'&&/^\d{5}(?:-\d{4})?$/.test(p.zip))||p.zip===null)&&(p.city!==null||p.zip!==null)
  &&![p.street,p.city,p.state,p.zip].filter(v=>v!==null).some(v=>unsafe.test(v!));
}
export const installationAddress=(p:Installation)=>[p.street,p.city,[p.state,p.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
export const suppliedComponents=(p:Installation)=>({street:true,city:p.city!==null,state:true,zip:p.zip!==null});
export function fullMatchedParts(value:unknown):Parts|null{
 const p=parseAddress(value);if(!p||typeof value!=='string'||unsafe.test(value))return null;
 const zip=/(\d{5}(?:-\d{4})?)\s*$/.exec(value)?.[1];return zip?{...p,zip}:null;
}
export function matchesInstallation(expected:Installation,matchedAddress:unknown):boolean{
 if(!validInstallation(expected))return false;const actual=fullMatchedParts(matchedAddress);if(!actual)return false;
 return compareAddress({street:expected.street,city:expected.city??actual.city,state:expected.state,zip:expected.zip??actual.zip},actual);
}
