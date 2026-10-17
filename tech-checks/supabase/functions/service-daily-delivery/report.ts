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
export function receiptLinksHtml(report:any){
 const rows=report.snapshot.receipt_links;if(!Array.isArray(rows))return '';
 return '<h2>Reviewed equipment receipts</h2>'+(rows.length?rows.map((r:any)=>'<section><h3>Receipt '+escapeHtml(r.event_id)+'</h3><p>Receipt revision '+escapeHtml(r.receipt_revision)+' · Handoff '+escapeHtml(r.transfer_id)+' · Handoff revision '+escapeHtml(r.transfer_revision)+'</p><p>IT: '+escapeHtml(r.snapshot.it_name)+' · Service: '+escapeHtml(r.snapshot.service_name)+'</p><h4>Equipment still assigned at sign-off</h4><pre>'+escapeHtml(JSON.stringify(r.remaining,null,2))+'</pre><h4>Original signed receipt</h4><pre>'+escapeHtml(JSON.stringify(r.snapshot,null,2))+'</pre></section>').join(''):'<p>No accepted equipment receipts were assigned at this sign-off.</p>');
}
function signoffHtml(report:any,links:Record<string,string>){
 const signature=report.snapshot.signature;
 if(!signature)return '<h2>Technician signature</h2><p>No signature captured in this earlier report version.</p>';
 const at=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',dateStyle:'long',timeStyle:'long',hour12:false}).format(new Date(signature.signed_at));
 const url=links['Technician signature:signature'];
 return '<h2>Technician signature</h2><table><tr><th>Signed by</th><td>'+escapeHtml(signature.name)+'</td></tr><tr><th>Account</th><td>'+escapeHtml(signature.username||signature.signed_by)+'</td></tr><tr><th>Completion date and time</th><td>'+escapeHtml(at)+' (America/Chicago)</td></tr><tr><th>Signature method</th><td>'+escapeHtml(signature.method)+'</td></tr></table><p>'+escapeHtml(signature.statement)+'</p>'+(url?'<p><a href="'+escapeHtml(url)+'">View handwritten signature</a></p>':'');
}
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
 '<h2>Photos and image attachments</h2>'+report.photos.filter((p:any)=>p.category!=='Technician signature').map((p:any)=>{const url=photoLinks[p.category+':'+p.view];return `<p>${escapeHtml(p.category)} · ${escapeHtml(p.view)}${p.filename?' · '+escapeHtml(p.filename):''}${url?` · <a href="${escapeHtml(url)}">View photo</a>`:''}</p>`;}).join('')+
 '<p>The required inspection and inventory passed server validation.</p>'+receiptLinksHtml(report)+signoffHtml(report,photoLinks)+'</body></html>';
}
export function rawEmail(report:any,html:string,folderId:string,signature?:Uint8Array,pdf?:Uint8Array) {
 const subject=`TechCheck ${report.check_date} — ${report.actor_name}`.replace(/[\r\n]/g,' ');
 const encodedSubject=btoa(unescape(encodeURIComponent(subject)));
 const base64=(bytes:Uint8Array)=>{let raw='';for(let n=0;n<bytes.length;n+=8192)raw+=String.fromCharCode(...bytes.subarray(n,n+8192));return btoa(raw).replace(/.{1,76}/g,'$&\r\n');};
 const boundary='techcheck_'+report.id;
 const html64=btoa(unescape(encodeURIComponent(html+`<p><a href="https://drive.google.com/drive/folders/${folderId}">Daily report and all photos in Drive</a></p>`))).replace(/.{1,76}/g,'$&\r\n');
 const headers=`From: ${RECIPIENT}\r\nTo: ${RECIPIENT}\r\nSubject: =?UTF-8?B?${encodedSubject}?=\r\nMessage-ID: <techcheck-${report.id}@camerasonsite.com>\r\nMIME-Version: 1.0\r\n`;
 const part=(type:string,data:string,extra='')=>`--${boundary}\r\nContent-Type: ${type}\r\nContent-Transfer-Encoding: base64\r\n${extra}\r\n${data}\r\n`;
 const content=pdf?headers+`Content-Type: multipart/related; boundary="${boundary}"\r\n\r\n`+
  part('text/html; charset=UTF-8',html64)+
  (signature?part('image/jpeg',base64(signature),'Content-ID: <techcheck-signature>\r\nContent-Disposition: inline; filename="signature.jpg"\r\n'):'')+
  part('application/pdf',base64(pdf),`Content-Disposition: attachment; filename="TechCheck-${report.check_date}.pdf"\r\n`)+`--${boundary}--\r\n`:
  headers+'Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'+html64;
 return btoa(content).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
