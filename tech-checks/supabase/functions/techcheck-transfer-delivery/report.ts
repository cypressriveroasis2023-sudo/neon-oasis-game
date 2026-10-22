// Private, signed equipment handoff reports. One page per unit keeps all checks
// and the independent Service receipt readable even for a twenty-unit handoff.
export {DRIVE_FOLDER,RECIPIENT} from '../service-daily-delivery/report.ts';
import {escapeHtml,rawEmail as dailyEmail} from '../service-daily-delivery/report.ts';
const title=(r:any)=>(({checkout:'Check Out / Hand Off',receipt:'Service Equipment Receipt',return:'Check In / Return',cancel:'Handoff Cancelled',purpose_amendment:'Handoff Purpose Updated'} as Record<string,string>)[r.kind]||'Equipment Handoff');
const time=(r:any)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',dateStyle:'medium',timeStyle:'medium',hour12:false}).format(new Date(r.submitted_at));
const purposeLabel=(s:any)=>s.purpose==='truck_replenishment'?'Truck replenishment':s.purpose==='installation'?'Installation':'Purpose not recorded in this original handoff';
const purposeNote=(s:any)=>s.purpose==='truck_replenishment'?'Equipment for truck spares. Batteries are counted separately in the daily truck inventory.':s.purpose==='installation'?'Equipment and battery package prepared for installation. Receiving equipment does not complete the installation.':'';
const batteryLabels:Record<string,string>={agm_4x_12v_110ah:'4 x 12V 110Ah batteries per Solar Stand',single_12v_350ah:'1 x 12V 350Ah per Solar Stand (historical configuration)',sniper_2x_12v_35ah:'2 x 12V 35Ah batteries',lifepo4_1x:'1 LiFePO4 battery',litime_1x_12v_110ah:'1 x LiTime 12V 110Ah (historical configuration)',helios_battery_box:'1 Helios battery box',recon_configured:'Configured Recon II batteries',none:'No battery package required'};
function batteryLine(i:any,s:any){
 if(s.purpose==='truck_replenishment')return 'Batteries: counted separately in daily truck inventory; not part of this receipt.';
 const quantity=Number.isInteger(i.battery_count)?String(i.battery_count):'Not recorded';
 const configuration=batteryLabels[i.battery_configuration]||i.battery_configuration;
 return 'Batteries recorded: '+quantity+(configuration?' | '+configuration:'')+(Number.isInteger(i.required_battery_count)?' | Required: '+i.required_battery_count:'');
}
function itemLines(i:any,checks:any,s:any){
 return [`${i.family} ${i.unit_tag}`,`Equipment ID: ${i.equipment_key}`,`SIMs: ${(i.sims||[]).join(', ')||'None'}`,batteryLine(i,s),
  `Parts: ${(i.parts||[]).map((p:any)=>p.name+' x '+p.quantity).join(', ')||'None'}`,
  ...Object.entries(checks||{}).map(([k,v])=>`${k.replaceAll('_',' ')}: ${v===true?'PASS':v===false?'NEEDS ATTENTION':String(v)}`)];
}
function recording(r:any){
 const s=r.snapshot;
 if(r.kind==='purpose_amendment')return {label:'Recorded by',name:s.applied_by.name,statement:s.statement,detail:s.recorded_at+' | America/Chicago | '+s.applied_by.role,amendment:true};
 return {label:'Signed by',name:s.signature.name,statement:s.signature.statement,detail:s.signature.signed_at+' | America/Chicago | '+s.signature.method,amendment:false};
}
function originalEvidenceLines(s:any){
 return (s.original_evidence||[]).map((p:any)=>'Original IT checkout photo for '+p.equipment_key+'; recorded by '+p.source_actor_name+' at '+p.source_signed_at+'. Source event '+p.source_event_id+'. This is the IT photo, not a new Service photo.');
}
export function reportHtml(r:any,links:Record<string,string>={}){
 const e=escapeHtml,s=r.snapshot,ack=recording(r);
 const list=(items:any[],checks:any)=>items.map(i=>'<h3>'+e(i.family+' '+i.unit_tag)+'</h3><ul>'+itemLines(i,checks?.[i.equipment_key],s).map(v=>'<li>'+e(v)+'</li>').join('')+'</ul>').join('');
 const equipment=ack.amendment?'<h2>Equipment recorded for this purpose</h2>'+list(s.actual||[],null)+'<p>Original handoff event '+e(s.original_event_id)+' · Previous revision '+e(s.previous_revision)+' · Previous state '+e(s.previous_state)+'</p>':'<h2>Expected equipment</h2>'+list(s.expected||[],null)+'<h2>Equipment physically recorded</h2>'+list(s.actual||[],s.checks);
 return '<!doctype html><html lang="en"><meta charset="utf-8"><title>'+e(title(r))+'</title><body style="font:16px Arial;max-width:900px;margin:32px auto"><h1>'+e(title(r))+'</h1><p><strong>'+e(purposeLabel(s))+'</strong><br>'+e(purposeNote(s))+'</p><p>'+e(s.it_name)+' → '+e(s.service_name)+'</p><p>'+e(time(r))+' Central Time · '+e(s.state)+'</p><p>Handoff '+e(s.transfer_id)+' · Event '+e(r.id)+' · Revision '+e(s.revision)+'</p>'+equipment+'<h2>Discrepancies</h2><pre>'+e(JSON.stringify(s.differences||[],null,2))+'</pre><h2>Notes</h2><p>'+e(s.notes)+'</p><h2>'+e(ack.label)+' '+e(ack.name)+'</h2><p>'+e(ack.statement)+'</p><p>'+e(ack.detail)+'</p><h2>Evidence</h2>'+originalEvidenceLines(s).map((line:string)=>'<p>'+e(line)+'</p>').join('')+Object.entries(links).map(([name,url])=>'<p><a href="'+e(url)+'">'+e(name)+'</a></p>').join('')+'</body></html>';
}
export function summaryHtml(r:any,folder:string,pdf:string){
 const e=escapeHtml,s=r.snapshot,ack=recording(r);
 return '<h1>'+e(title(r))+'</h1><p><b>'+e(purposeLabel(s))+'</b><br>'+e(purposeNote(s))+'</p><p><b>'+e(s.it_name)+' → '+e(s.service_name)+'</b><br>'+e(time(r))+' Central Time</p><p>'+e(s.state)+' · '+(s.actual||[]).length+' equipment items · '+(s.differences||[]).length+' discrepancies</p><p>'+e(ack.label)+' '+e(ack.name)+'.</p>'+(ack.amendment?'<p>'+e(ack.statement)+'</p>':'')+'<p><a href="'+e(pdf)+'">'+(ack.amendment?'Open purpose update PDF':'Open signed handoff PDF')+'</a> · <a href="https://drive.google.com/drive/folders/'+e(folder)+'">Photos and full answers</a></p>';
}
export function rawEmail(r:any,html:string,folder:string,signature?:Uint8Array,pdf?:Uint8Array){
 // Reuse the verified recipient, MIME encoding and PDF/signature attachments.
 const encoded=dailyEmail(r,html,folder,signature,pdf);
 const raw=atob(encoded.replace(/-/g,'+').replace(/_/g,'/'));
 const subject=btoa(unescape(encodeURIComponent('COS '+title(r)+' — '+r.check_date+' — '+r.actor_name)));
 return btoa(raw.replace(/^Subject:[^\r\n]*/m,'Subject: =?UTF-8?B?'+subject+'?=').replace('Message-ID: <techcheck-','Message-ID: <handoff-').replace('filename="TechCheck-','filename="Handoff-')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function summaryPdf(r:any,signature?:Uint8Array):Uint8Array{
 const enc=new TextEncoder(),s=r.snapshot,ack=recording(r),contents:string[]=[];
 const ascii=(v:unknown)=>String(v??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e]/g,'-');
 const safe=(v:unknown)=>ascii(v).replace(/[\\()]/g,'\\$&');
 const wrap=(v:string)=>{const out=[];let rest=ascii(v);while(rest.length>94){let n=rest.lastIndexOf(' ',94);if(n<45)n=94;out.push(rest.slice(0,n));rest=rest.slice(n).trimStart();}out.push(rest);return out;};
 let commands='',y=742;
 const text=(v:string,size=10,bold=false)=>{for(const l of wrap(v)){if(y<65)page();commands+=`BT /${bold?'F2':'F1'} ${size} Tf 1 0 0 1 40 ${y} Tm (${safe(l)}) Tj ET\n`;y-=size+5;}};
 const page=()=>{if(commands)contents.push(commands);commands='';y=742;text('CAMERAS ONSITE - '+title(r),16,true);text(purposeLabel(s),12,true);if(purposeNote(s))text(purposeNote(s));text(s.it_name+' -> '+s.service_name+' | '+time(r)+' Central');text('Handoff '+s.transfer_id+' | Revision '+s.revision);text('Event '+r.id+' | '+s.state);y-=12;};
 page();
 for(const [n,item] of (s.actual||[]).entries()){
  if(n)page();
  for(const [k,line] of itemLines(item,s.checks?.[item.equipment_key],s).entries())text(line,k===0?13:10,k===0);
  const expected=(s.expected||[]).find((i:any)=>i.equipment_key===item.equipment_key);
  if(expected&&JSON.stringify(expected)!==JSON.stringify(item)){y-=10;text('Expected:',11,true);for(const line of itemLines(expected,null,s))text(line);}
 }
 if((s.differences||[]).length){y-=10;text('DISCREPANCIES',11,true);for(const d of s.differences)text(d.equipment_key+' - '+d.field+': expected '+JSON.stringify(d.expected)+'; recorded '+JSON.stringify(d.actual));}
 if(s.notes){y-=10;text('NOTES',11,true);text(s.notes);}
 if(ack.amendment){text('Original handoff event '+s.original_event_id);text('Previous revision '+s.previous_revision+' | Previous state '+s.previous_state);}
 if((s.original_evidence||[]).length){y-=10;text('ORIGINAL IT PHOTO REFERENCES',11,true);for(const line of originalEvidenceLines(s))text(line);}
 if(y<220)page();else y-=15;
 text(ack.label.toUpperCase()+' '+ack.name,12,true);text(ack.statement);text(ack.detail);
 let dimensions:number[]|null=null;
 if(signature){
  for(let p=2;p+9<signature.length;){if(signature[p]!==255)break;const m=signature[p+1],n=(signature[p+2]<<8)+signature[p+3];if([192,193,194].includes(m)){dimensions=[(signature[p+7]<<8)+signature[p+8],(signature[p+5]<<8)+signature[p+6],signature[p+9]];break;}if(m===218||m===217||n<2)break;p+=n+2;}
  if(!dimensions||dimensions[2]!==3)throw new Error('Signature JPEG could not be embedded.');
  if(y<150)page();commands+=`q 240 0 0 72 40 ${y-80} cm /Sig Do Q\n`;y-=90;
 }else if(s.signature?.method==='drawn')throw new Error('Handwritten signature required.');
 text(ack.amendment?'Original signed records remain unchanged. This purpose update does not confirm receipt.':'Evidence photos, their source details and exact signed answers are in the same private Drive folder.',9);
 contents.push(commands);
 const parts:Uint8Array[]=[],offsets:number[]=[0];let length=0;
 const put=(v:string|Uint8Array)=>{const b=typeof v==='string'?enc.encode(v):v;parts.push(b);length+=b.length;};
 const obj=(n:number,body:string)=>{offsets[n]=length;put(`${n} 0 obj\n${body}\nendobj\n`);};
 const imageId=5+contents.length*2;
 put('%PDF-1.4\n');obj(1,'<< /Type /Catalog /Pages 2 0 R >>');obj(2,`<< /Type /Pages /Kids [${contents.map((_,i)=>(5+i*2)+' 0 R').join(' ')}] /Count ${contents.length} >>`);
 obj(3,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');obj(4,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
 contents.forEach((c,i)=>{obj(5+i*2,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> ${dimensions?'/XObject << /Sig '+imageId+' 0 R >>':''} >> /Contents ${6+i*2} 0 R >>`);obj(6+i*2,`<< /Length ${enc.encode(c).length} >>\nstream\n${c}endstream`);});
 if(dimensions){offsets[imageId]=length;put(`${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${dimensions[0]} /Height ${dimensions[1]} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${signature!.length} >>\nstream\n`);put(signature!);put('\nendstream\nendobj\n');}
 const start=length,n=imageId+(dimensions?1:0);put(`xref\n0 ${n}\n0000000000 65535 f \n`);for(let k=1;k<n;k++)put(String(offsets[k]).padStart(10,'0')+' 00000 n \n');put(`trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
 const bytes=new Uint8Array(length);let pos=0;for(const b of parts){bytes.set(b,pos);pos+=b.length;}return bytes;
}
