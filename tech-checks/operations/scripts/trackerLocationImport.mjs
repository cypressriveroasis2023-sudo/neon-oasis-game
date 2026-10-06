export const trackerUnitKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function safeTrackerAddress(value) {
  return String(value || '').split(/(?:\s*[-,]\s*)?\b(?:gate(?:\s+(?:code|pin))?|password|passcode|access code)\b/i)[0].trim().slice(0, 600);
}
export function trackerAddressKey(value) {
  const address = safeTrackerAddress(value);
  const street = address.match(/\b\d+[A-Za-z]?\s+[A-Za-z].*/)?.[0] || address;
  return trackerUnitKey(street);
}
export function parseTrackerGps(value) {
 const text=String(value||"").trim().replace(/^[([]|[)\]]$/g,'');
 let match=text.match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
 let latitude,longitude;
 if(match){latitude=Number(match[1]);longitude=Number(match[2]);}
 else {
  const decimal=text.match(/^(\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])\s*,?\s*(\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])$/i);
  const dms=text.match(/^(\d{1,2})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:\.\d+)?)["″]\s*([NS])\s*,?\s*(\d{1,3})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:\.\d+)?)["″]\s*([EW])$/i);
  if(decimal){latitude=Number(decimal[1])*(decimal[2].toUpperCase()==='S'?-1:1);longitude=Number(decimal[3])*(decimal[4].toUpperCase()==='W'?-1:1);}
  else if(dms && [dms[2],dms[3],dms[6],dms[7]].every(n=>Number(n)<60)){latitude=(Number(dms[1])+Number(dms[2])/60+Number(dms[3])/3600)*(dms[4].toUpperCase()==='S'?-1:1);longitude=(Number(dms[5])+Number(dms[6])/60+Number(dms[7])/3600)*(dms[8].toUpperCase()==='W'?-1:1);}
  else return null;
 }
 return Number.isFinite(latitude)&&Number.isFinite(longitude)&&Math.abs(latitude)<=90&&Math.abs(longitude)<=180&&!(latitude===0&&longitude===0)?{latitude,longitude}:null;
}
