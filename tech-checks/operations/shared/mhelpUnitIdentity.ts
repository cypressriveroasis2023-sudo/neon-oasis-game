/** Full equipment labels only; family variants and numbered accessories stay distinct. */
export function mhelpUnitIdentity(value:unknown):{key:string;family:string;label:string}|null{
 if(typeof value!=='string'||value.length>160||/[\x00-\x1f\x7f<>]/.test(value))return null;
 const name=value.trim(),match=/^(SNIPER\s*[24]|RECON\s*(?:II|2))(?=\s|[-#])\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)(HD4|HDC[24]S?|HD)?$/i.exec(name)
  || /^(HELIOS|RANGER|SOLAR\s*SPOTTER|SPOTTER|SS\s*HYBRID|SNIPER|CAM\s*V|RSU|RECON|RII|RI|SOLAR\s*POLE|SOLAR\s*STAND|ST)\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)(HD4|HDC[24]S?|HD)?$/i.exec(name);
 if(!match||Number(match[2].split('.')[0])===0)return null;
 const raw=match[1].toUpperCase().replace(/\s/g,''),family=({RECONII:'RECON2',RII:'RECON2',RI:'RECON',RSU:'CAMV',SOLARSTAND:'SOLARPOLE',ST:'SOLARPOLE'} as Record<string,string>)[raw]||raw;
 const [base,...tail]=match[2].split('.'),tag=Number(base)+(tail.length?'.'+tail.join('.'):''),variant=(match[3]||'').toUpperCase();
 return {key:family+'|'+tag+'|'+variant,family,label:name};
}
