// Private, signed equipment handoff reports. One page per unit keeps all checks
// and the independent Service receipt readable even for a twenty-unit handoff.
export {DRIVE_FOLDER,RECIPIENT} from '../service-daily-delivery/report.ts';
import {escapeHtml,rawEmail as dailyEmail} from '../service-daily-delivery/report.ts';
const title=(r:any)=>(({checkout:'Check Out / Hand Off',receipt:'Service Equipment Receipt',return:'Check In / Return',cancel:'Handoff Cancelled'} as Record<string,string>)[r.kind]||'Equipment Handoff');
const time=(r:any)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',dateStyle:'medium',timeStyle:'medium',hour12:false}).format(new Date(r.submitted_at));
function itemLines(i:any,checks:any){
 return [`${i.family} ${i.unit_tag}`,`Equipment ID: ${i.equipment_key}`,`SIMs: ${(i.sims||[]).join(', ')||'None'}`,`Batteries: ${i.battery_count}`,
  `Parts: ${(i.parts||[]).map((p:any)=>p.name+' x '+p.quantity).join(', ')||'None'}`,
  ...Object.entries(checks||{}).map(([k,v])=>`${k.replaceAll('_',' ')}: ${v===true?'PASS':v===false?'NEEDS ATTENTION':String(v)}`)];
}
export function reportHtml(r:any,links:Record<string,string>={}){
 const e=escapeHtml,s=r.snapshot;
 const list=(items:any[],checks:any)=>items.map(i=>'<h3>'+e(i.family+' '+i.unit_tag)+'</h3><ul>'+itemLines(i,checks?.[i.equipment_key]).map(v=>'<li>'+e(v)+'</li>').join('')+'</ul>').join('');
 return '<!doctype html><html lang="en"><meta charset="utf-8"><title>'+e(title(r))+'</title><body style="font:16px Arial;max-width:900px;margin:32px auto"><h1>'+e(title(r))+'</h1><p>'+e(s.it_name)+' → '+e(s.service_name)+'</p><p>'+e(time(r))+' Central Time · '+e(s.state)+'</p><p>Handoff '+e(s.transfer_id)+' · Event '+e(r.id)+' · Revision '+e(s.revision)+'</p><h2>Expected equipment</h2>'+list(s.expected||[],null)+'<h2>Equipment physically recorded</h2>'+list(s.actual||[],s.checks)+'<h2>Discrepancies</h2><pre>'+e(JSON.stringify(s.differences||[],null,2))+'</pre><h2>Notes</h2><p>'+e(s.notes)+'</p><h2>Signed by '+e(s.signature.name)+'</h2><p>'+e(s.signature.statement)+'</p><p>'+e(s.signature.method)+' signature · '+e(s.signature.signed_at)+'</p><h2>Evidence</h2>'+Object.entries(links).map(([name,url])=>'<p><a href="'+e(url)+'">'+e(name)+'</a></p>').join('')+'</body></html>';
}
export function summaryHtml(r:any,folder:string,pdf:string){
 const e=escapeHtml,s=r.snapshot;
 return '<h1>'+e(title(r))+'</h1><p><b>'+e(s.it_name)+' → '+e(s.service_name)+'</b><br>'+e(time(r))+' Central Time</p><p>'+e(s.state)+' · '+(s.actual||[]).length+' equipment items · '+(s.differences||[]).length+' discrepancies</p><p>Signed by '+e(s.signature.name)+'.</p><p><a href="'+e(pdf)+'">Open signed handoff PDF</a> · <a href="https://drive.google.com/drive/folders/'+e(folder)+'">Photos and full answers</a></p>';
}
export function rawEmail(r:any,html:string,folder:string,signature?:Uint8Array,pdf?:Uint8Array){
 // Reuse the verified recipient, MIME encoding and PDF/signature attachments.
 const encoded=dailyEmail(r,html,folder,signature,pdf);
 const raw=atob(encoded.replace(/-/g,'+').replace(/_/g,'/'));
 const subject=btoa(unescape(encodeURIComponent('COS '+title(r)+' — '+r.check_date+' — '+r.actor_name)));
 return btoa(raw.replace(/^Subject:[^\r\n]*/m,'Subject: =?UTF-8?B?'+subject+'?=').replace('Message-ID: <techcheck-','Message-ID: <handoff-').replace('filename="TechCheck-','filename="Handoff-')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function summaryPdf(r:any,signature?:Uint8Array):Uint8Array{
 const enc=new TextEncoder(),s=r.snapshot,contents:string[]=[];
 const ascii=(v:unknown)=>String(v??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e]/g,'-');
 const safe=(v:unknown)=>ascii(v).replace(/[\\()]/g,'\\$&');
 const wrap=(v:string)=>{const out=[];let rest=ascii(v);while(rest.length>94){let n=rest.lastIndexOf(' ',94);if(n<45)n=94;out.push(rest.slice(0,n));rest=rest.slice(n).trimStart();}out.push(rest);return out;};
 let commands='',y=742;
 const text=(v:string,size=10,bold=false)=>{for(const l of wrap(v)){if(y<65)page();commands+=`BT /${bold?'F2':'F1'} ${size} Tf 1 0 0 1 40 ${y} Tm (${safe(l)}) Tj ET\n`;y-=size+5;}};
 const page=()=>{if(commands)contents.push(commands);commands='';y=742;text('CAMERAS ONSITE - '+title(r),16,true);text(s.it_name+' -> '+s.service_name+' | '+time(r)+' Central');text('Handoff '+s.transfer_id+' | Revision '+s.revision);text('Event '+r.id+' | '+s.state);y-=12;};
 page();
 for(const [n,item] of (s.actual||[]).entries()){
  if(n)page();
  for(const [k,line] of itemLines(item,s.checks?.[item.equipment_key]).entries())text(line,k===0?13:10,k===0);
  const expected=(s.expected||[]).find((i:any)=>i.equipment_key===item.equipment_key);
  if(expected&&JSON.stringify(expected)!==JSON.stringify(item)){y-=10;text('Expected:',11,true);for(const line of itemLines(expected,null))text(line);}
 }
 if((s.differences||[]).length){y-=10;text('DISCREPANCIES',11,true);for(const d of s.differences)text(d.equipment_key+' - '+d.field+': expected '+JSON.stringify(d.expected)+'; recorded '+JSON.stringify(d.actual));}
 if(s.notes){y-=10;text('NOTES',11,true);text(s.notes);}
 if(y<220)page();else y-=15;
 text('SIGNED BY '+s.signature.name,12,true);text(s.signature.statement);text(s.signature.signed_at+' | America/Chicago | '+s.signature.method);
 let dimensions:number[]|null=null;
 if(signature){
  for(let p=2;p+9<signature.length;){if(signature[p]!==255)break;const m=signature[p+1],n=(signature[p+2]<<8)+signature[p+3];if([192,193,194].includes(m)){dimensions=[(signature[p+7]<<8)+signature[p+8],(signature[p+5]<<8)+signature[p+6],signature[p+9]];break;}if(m===218||m===217||n<2)break;p+=n+2;}
  if(!dimensions||dimensions[2]!==3)throw new Error('Signature JPEG could not be embedded.');
  if(y<150)page();commands+=`q 240 0 0 72 40 ${y-80} cm /Sig Do Q\n`;y-=90;
 }else if(s.signature.method==='drawn')throw new Error('Handwritten signature required.');
 text('Evidence photos and exact signed answers are in the same private Drive folder.',9);
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
