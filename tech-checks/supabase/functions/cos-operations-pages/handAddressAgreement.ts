// Conservative agreement for hand-entered addresses. This never changes saved text.
const WORDS: Record<string,string> = {
 STREET:'ST', ROAD:'RD', DRIVE:'DR', AVENUE:'AVE', BOULEVARD:'BLVD', LANE:'LN', COURT:'CT',
 CIRCLE:'CIR', PARKWAY:'PKWY', HIGHWAY:'HWY', FREEWAY:'FWY', TERRACE:'TER', PLACE:'PL',
 TRAIL:'TRL', WAY:'WAY', NORTH:'N', SOUTH:'S', EAST:'E', WEST:'W',
 NORTHEAST:'NE', NORTHWEST:'NW', SOUTHEAST:'SE', SOUTHWEST:'SW',
};
const SUFFIX = new Set(['ST','RD','DR','AVE','BLVD','LN','CT','CIR','PKWY','HWY','FWY','TER','PL','TRL','WAY']);
const words = (s:string) => s.toUpperCase().replace(/[.]/g,'').replace(/\s+/g,' ').trim().split(' ').map(w=>WORDS[w]||w);
function addressParts(value:unknown): {number:string;street:string;city:string;state:string}|null {
 if(typeof value!=='string'||value.length>200||/[\r\n<>]/.test(value))return null;
 const raw=value.trim().toUpperCase();
 // Ranges, fractions, PO boxes and intersections are deliberately unresolved.
 const numbered=/^(\d+[A-Z]?)\s+(.+)$/.exec(raw);if(!numbered)return null;
 const tail=numbered[2].replace(/,?\s+\d{5}(?:-\d{4})?$/,'');
 const region=/^(.*?)[,\s]+([A-Z]{2})$/.exec(tail);if(!region)return null;
 const pieces=region[1].split(',').map(s=>s.trim()).filter(Boolean);
 let street:string[],city:string[];
 if(pieces.length===2){street=words(pieces[0]);city=words(pieces[1]);}
 else if(pieces.length===1){
  const all=words(pieces[0]);
  const end=all.findIndex((w,i)=>i>0&&SUFFIX.has(w));
  if(end<1||end===all.length-1)return null;
  street=all.slice(0,end+1);city=all.slice(end+1);
 }else return null;
 if(!street.length||!city.length||!street.every(w=>/^[A-Z0-9'-]+$/.test(w))||!city.every(w=>/^[A-Z'-]+$/.test(w)))return null;
 return {number:numbered[1],street:street.join(' '),city:city.join(' '),state:region[2]};
}
export function handAddressDisagreement(supplied:unknown,matched:unknown):string|null {
 const wanted=addressParts(supplied),found=addressParts(matched);
 if(!wanted||!found)return 'The house number, street and city could not be verified from the address service result. Address saved without a pin.';
 if(wanted.number!==found.number)return 'The address service returned a different house number. Address saved without a pin; check the street number before retrying.';
 if(wanted.street!==found.street||wanted.city!==found.city||wanted.state!==found.state)
  return 'The address service returned a different street, city or state. Address saved without a pin.';
 return null;
}
