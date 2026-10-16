export const RECIPIENT='jmartin@camerasonsite.com';
export const DRIVE_FOLDER='1sEOK-nffQB46pcSj7rifT-9Huts4P2B4';
const truck=[
  'Fuel level sufficient for today’s route',
  'Tires appear safe and properly inflated',
  'Headlights / signals / brake lights working',
  'Windshield and mirrors are safe and clear',
  'No visible fluid leaks',
  'Required tools and service supplies onboard',
  'Ladders / cargo / equipment secured',
  'Truck cab and bed organized',
];
const trailer=[
  'Trailer tires appear safe and properly inflated',
  'Hitch / coupler fully secured',
  'Safety chains attached correctly',
  'Trailer plug connected; lights and signals working',
  'Jack / supports secured for travel',
  'Load balanced and equipment tied down',
  'No visible structural damage or unsafe condition',
];
export const escapeHtml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function reportHtml(report:any,photoLinks:Record<string,string>={}) {
 const s=report.snapshot, inventory=s.inventory;
 const row=(a:unknown,b:unknown)=>`<tr><th scope="row">${escapeHtml(a)}</th><td>${escapeHtml(b)}</td></tr>`;
 const checks=(labels:string[],answers:Record<string,boolean>,prefix:string)=>'<table>'+labels.map((label,i)=>row(label,answers?.[prefix+(i+1)]===true?'Yes / Passed':answers?.[prefix+(i+1)]===false?'No / Failed':'Not answered')).join('')+'</table>';
 return '<!doctype html><html lang="en"><meta charset="utf-8"><title>TechCheck daily report</title><body><h1>TechCheck Truck/Trailer/Truck Inventory</h1>'+
 `<p>${escapeHtml(report.actor_name)} · ${escapeHtml(report.check_date)} (America/Chicago)</p><p>Submitted: ${escapeHtml(report.submitted_at)} · Report ${escapeHtml(report.id)}</p>`+
 '<h2>Truck inspection</h2>'+checks(truck,s.truck_checks,'truck_')+`<h2>Trailer inspection</h2><p>Taking a trailer: ${s.taking_trailer?'Yes':'No — trailer inspection not required'}</p>`+
 (s.taking_trailer?checks(trailer,s.trailer_checks,'trailer_'):'')+
 '<h2>Equipment on the truck</h2><table>'+inventory.units.map((u:any)=>row(u.equipment_type,u.unit_tag)).join('')+'</table>'+
 '<h2>SIM cards</h2><table>'+inventory.sims.map((v:any)=>row('SIM slot '+v.slot_no,v.sim_number)).join('')+'</table>'+
 '<h2>Battery stock</h2><table>'+[['Recon batteries','recon_battery_qty'],['AGM 12V 110Ah','agm_12v_110ah_qty'],['LiTime 12V 100Ah','litime_12v_100ah_qty'],['12V 35Ah','battery_12v_35ah_qty']].map(([label,key])=>row(label,inventory.stock[key])).join('')+'</table>'+
 '<h2>Photos</h2>'+report.photos.map((p:any)=>{const url=photoLinks[p.category+':'+p.view];return `<p>${escapeHtml(p.category)} · ${escapeHtml(p.view)}${url?` · <a href="${escapeHtml(url)}">View photo</a>`:''}</p>`;}).join('')+
 '<p>The technician physically verified this stock. The required inspection and inventory passed server validation.</p></body></html>';
}
export function rawEmail(report:any,html:string,folderId:string) {
 const subject=`TechCheck ${report.check_date} — ${report.actor_name}`.replace(/[\r\n]/g,' ');
 const encodedSubject=btoa(unescape(encodeURIComponent(subject)));
 const content=`From: ${RECIPIENT}\r\nTo: ${RECIPIENT}\r\nSubject: =?UTF-8?B?${encodedSubject}?=\r\nMessage-ID: <techcheck-${report.id}@camerasonsite.com>\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n`+btoa(unescape(encodeURIComponent(html+`<p><a href="https://drive.google.com/drive/folders/${folderId}">Daily report and all photos in Drive</a></p>`)));
 return btoa(content).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
