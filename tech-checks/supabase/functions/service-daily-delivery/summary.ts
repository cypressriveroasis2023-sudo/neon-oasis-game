import {escapeHtml} from './report.ts';
export function summaryLines(r:any){
 const s=r.snapshot,i=s.inventory, sig=s.signature;
 const count=(answers:any,prefix:string,n:number)=>Array.from({length:n},(_,k)=>answers?.[prefix+(k+1)]===true).filter(Boolean).length;
 const truck=count(s.truck_checks,'truck_',8), trailer=count(s.trailer_checks,'trailer_',7);
 const time=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',dateStyle:'medium',timeStyle:'medium',hour12:false}).format(new Date(sig?.signed_at||r.submitted_at));
 return {name:sig?.name||r.actor_name,time,truck:truck===8?'PASSED - 8 of 8 checks':`REVIEW - ${truck} of 8 passed`,trailer:s.taking_trailer?(trailer===7?'PASSED - 7 of 7 checks':`REVIEW - ${trailer} of 7 passed`):'Not taking a trailer - not required',units:i.units.map((u:any)=>`${u.equipment_type}: ${u.unit_tag}`),sims:i.sims.map((v:any)=>`SIM ${v.slot_no}: ${v.sim_number}`),batteries:[['Recon batteries','recon_battery_qty'],['AGM 12V 110Ah','agm_12v_110ah_qty'],['LiTime 12V 100Ah','litime_12v_100ah_qty'],['12V 35Ah','battery_12v_35ah_qty']].map(([label,key])=>`${label}: ${i.stock[key]}`),photos:r.photos.filter((p:any)=>p.category!=='Technician signature').length,signature:sig};
}
export function summaryHtml(r:any,folderId:string,pdfUrl:string){
 const s=summaryLines(r),e=escapeHtml;
 const rows=(items:string[])=>items.map(v=>'<div style="padding:3px 0">'+e(v)+'</div>').join('');
 return `<!doctype html><html><meta charset="utf-8"><body style="font:16px Arial,sans-serif;color:#17212b;background:#fff;max-width:720px;margin:20px auto;padding:20px"><h1 style="font-size:26px">TechCheck Daily Summary</h1><p><b>${e(s.name)}</b><br>${e(s.time)} Central Time</p><p><b>Truck:</b> ${e(s.truck)}<br><b>Trailer:</b> ${e(s.trailer)}</p><h2 style="font-size:18px">Equipment on truck</h2>${rows(s.units)}<h2 style="font-size:18px">SIM cards</h2>${rows(s.sims)}<h2 style="font-size:18px">Battery quantities</h2>${rows(s.batteries)}<p>${s.photos} supporting photos saved in Drive.</p><h2 style="font-size:18px">Technician sign-off</h2>${s.signature?`<p>${e(s.signature.statement)}</p>${s.signature.method==='drawn'?'<img src="cid:techcheck-signature" alt="Technician handwritten signature" style="width:300px;max-width:100%;height:90px;object-fit:contain">':`<p style="font:italic 24px Georgia">${e(s.name)}</p>`}<p><b>${e(s.name)}</b> · ${e(s.time)} Central Time</p>`:'<p>No signature captured in this earlier report.</p>'}<p><a href="${e(pdfUrl)}">Open one-page PDF with signature</a> · <a href="https://drive.google.com/drive/folders/${e(folderId)}">Open all photos and full answers</a></p></body></html>`;
}
// Self-contained one-page PDF; JPEG signature bytes remain embedded privately.
export function summaryPdf(r:any,signature?:Uint8Array):Uint8Array{
 const s=summaryLines(r),enc=new TextEncoder(),parts:Uint8Array[]=[],offsets=[0];let length=0;
 const put=(v:string|Uint8Array)=>{const b=typeof v==='string'?enc.encode(v):v;parts.push(b);length+=b.length;};
 const ascii=(v:string)=>v.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e]/g,'-');
 const safe=(v:string)=>ascii(v).replace(/[\\()]/g,'\\$&');
 let commands='';
 const text=(v:string,x:number,y:number,size=11,bold=false)=>{commands+=`BT /${bold?'F2':'F1'} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${safe(v)}) Tj ET\n`;};
 const wrap=(v:string,max=88)=>{const out=[];let rest=ascii(v);while(rest.length>max){let n=rest.lastIndexOf(' ',max);if(n<max/2)n=max;out.push(rest.slice(0,n));rest=rest.slice(n).trimStart();}out.push(rest);return out;};
 text('CAMERAS ONSITE',40,752,10,true);text('TechCheck Daily Summary',40,724,24,true);
 text(s.name,40,698,13,true);text(s.time+' Central Time',40,680);
 text('TRUCK INSPECTION',40,646,11,true);text(s.truck,220,646);
 text('TRAILER INSPECTION',40,626,11,true);text(s.trailer,220,626);
 let y=592;
 for(const [heading,lines] of [['EQUIPMENT ON TRUCK',s.units],['SIM CARDS',s.sims],['BATTERY QUANTITIES',s.batteries]] as [string,string[]][]){
  text(heading,40,y,11,true);y-=20;
  for(const line of lines)for(const l of wrap(line)){text(l,48,y);y-=16;}
  y-=12;
 }
 // Fixed stock schema has four units, three SIMs and four battery quantities.
 if(y<220)throw new Error('Summary exceeds one-page stock layout.');
 text(`${s.photos} supporting photos saved with the full answers in the same Drive folder.`,40,y,10);
 if(r.snapshot.transfer_receipts?.length){y-=16;text(`${r.snapshot.transfer_receipts.length} signed equipment receipt(s) linked in full answers; exact event IDs preserved.`,40,y,9);}
 y-=30;text('TECHNICIAN SIGN-OFF',40,y,11,true);y-=20;
 if(s.signature){for(const line of wrap(s.signature.statement,94)){text(line,40,y,10);y-=13;}}
 else {text('No signature captured in this earlier report.',40,y);y-=16;}
 let dimensions:number[]|null=null;
 if(signature){
  for(let p=2;p+9<signature.length;){if(signature[p]!==255)break;const marker=signature[p+1];if(marker===218||marker===217)break;const n=(signature[p+2]<<8)+signature[p+3];if([192,193,194].includes(marker)){dimensions=[(signature[p+7]<<8)+signature[p+8],(signature[p+5]<<8)+signature[p+6],signature[p+9]];break;}if(n<2)break;p+=n+2;}
  if(!dimensions||dimensions[2]!==3)throw new Error('Signature JPEG could not be embedded.');
  commands+=`q 240 0 0 72 40 ${y-78} cm /Sig Do Q\n`;y-=90;
 } else if(s.signature?.method==='drawn')throw new Error('Handwritten signature required for summary.');
 else if(s.signature){text(s.name,40,y-22,19);y-=40;}
 text(s.name+' | '+s.time+' Central Time',40,y,10,true);
 text('Report '+r.id,40,35,8);
 const obj=(n:number,body:string)=>{offsets[n]=length;put(`${n} 0 obj\n${body}\nendobj\n`);};
 put('%PDF-1.4\n');obj(1,'<< /Type /Catalog /Pages 2 0 R >>');obj(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
 obj(3,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> ${dimensions?'/XObject << /Sig 7 0 R >>':''} >> /Contents 6 0 R >>`);
 obj(4,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');obj(5,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
 obj(6,`<< /Length ${enc.encode(commands).length} >>\nstream\n${commands}endstream`);
 if(dimensions){offsets[7]=length;put(`7 0 obj\n<< /Type /XObject /Subtype /Image /Width ${dimensions[0]} /Height ${dimensions[1]} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${signature!.length} >>\nstream\n`);put(signature!);put('\nendstream\nendobj\n');}
 const start=length,n=dimensions?8:7;put(`xref\n0 ${n}\n0000000000 65535 f \n`);for(let k=1;k<n;k++)put(String(offsets[k]).padStart(10,'0')+' 00000 n \n');put(`trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
 const bytes=new Uint8Array(length);let pos=0;for(const b of parts){bytes.set(b,pos);pos+=b.length;}return bytes;
}
