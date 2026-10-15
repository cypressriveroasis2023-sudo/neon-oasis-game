/** Display only: never an identity key, source join, health match or native binding.
 * Keep source labels untouched; only bounded numeric text may enter marker HTML.
 * Full labels remain available through the map's text-node tooltip and title. */
export function sourceEquipmentMarkerIdentifier(label:string):string{
 if(typeof label!=='string'||label.length>250)return '';
 const wa=/^WA ?(\d{1,6})$/i.exec(label.trim());if(wa)return wa[1];
 const match=/^(?:SOLAR\s*SPOTTER|SS\s*HYBRID|SPOTTER|RANGER|HELIOS|SNIPER(?:\s+[24](?=\s))?|CAM\s*V|RSU|RECON(?:\s*II)?|ST|(?:SOLAR\s+)?(?:STAND|POLE|SKID)S?(?:\s+(?:72|144)(?=\s))?)[\s#-]+(\d{1,6}(?:\.\d{1,3})?)(?:\s*(?:HDC[24]S?|HD4|HD))?(?:\s*-\s*SOLAR\s+COMPATIBLE)?$/i.exec(label.trim());
 return match?.[1]||'';
}
export function sourceEquipmentMarkerMarkup(label:string):string{
 const number=sourceEquipmentMarkerIdentifier(label);
 return '<span class="cos-field-pin cos-field-pin-estimate cos-field-pin-unlinked" data-equipment-kind="source_equipment" style="--pin:#d6a84b"><svg class="cos-reticle-artwork cos-map-status-dot" viewBox="0 0 44 44" width="44" height="44" aria-hidden="true"><rect x="7" y="7" width="30" height="30" rx="5" fill="currentColor" stroke="#071421" stroke-width="2"/></svg><b class="cos-pin-unit-number'+(number.length>3?' cos-reticle-long-id':'')+'" aria-hidden="true">'+(number||'—')+'</b><em class="cos-pin-location-tag">EST</em></span>';
}
