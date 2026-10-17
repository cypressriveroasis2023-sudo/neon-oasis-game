import {escapeHtml, RECIPIENT} from './report.ts';

export type TransferPhoto = {kind: 'unit'|'tag'|'signature'; equipment_key?: string; path: string};
export type TransferEvent = {id: string; kind: 'checkout'|'receipt'|'return'|'cancel'; actor_id: string; actor_name: string; signed_at: string; snapshot: any; photos: TransferPhoto[]};
export type TransferDelivery = {version: 1; event_id: string; transfer_id: string; revision: number; kind: TransferEvent['kind']; it_actor: string; service_actor: string; it_name: string; service_name: string; events: TransferEvent[]};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const labels = {checkout: 'IT equipment check out', receipt: 'Service equipment receipt', return: 'IT equipment check in', cancel: 'Cancelled equipment handoff'};
const invalid = () => {throw new Error('Invalid immutable handoff delivery.');};

// Only server-captured events are accepted. No lookup of a later, mutable transfer
// is used while generating an archive or retrying delivery.
export function transferDelivery(value: unknown): TransferDelivery {
 const d = structuredClone(value) as TransferDelivery;
 if (!d || d.version !== 1 || ![d.event_id,d.transfer_id,d.it_actor,d.service_actor].every(v=>typeof v==='string'&&uuid.test(v)) || !labels[d.kind] || !Number.isSafeInteger(d.revision) || d.revision<1 || !Array.isArray(d.events) || d.events.length<1 || d.events.length>3) invalid();
 if (typeof d.it_name!=='string'||typeof d.service_name!=='string'||!d.it_name||!d.service_name) invalid();
 const ids = new Set<string>();
 let prior = 0;
 for (const e of d.events) {
  const s=e.snapshot, sig=s?.signature;
  if (!uuid.test(e.id)||ids.has(e.id)||!labels[e.kind]||!uuid.test(e.actor_id)||!Number.isFinite(Date.parse(e.signed_at)) || !s || s.transfer_id!==d.transfer_id || !Number.isSafeInteger(s.revision)||s.revision<=prior||s.revision>d.revision) invalid();
  ids.add(e.id); prior=s.revision;
  if (e.kind==='receipt' ? e.actor_id!==d.service_actor : !['checkout','return','cancel'].includes(e.kind)) invalid();
  // A different currently verified IT actor may receive returned equipment;
  // checkout must remain bound to the original IT actor.
  if (e.kind==='checkout' && e.actor_id!==d.it_actor) invalid();
  if (!sig || sig.signed_by!==e.actor_id || sig.name!==e.actor_name || !['typed','drawn'].includes(sig.method)||typeof sig.statement!=='string'||!sig.statement || !Number.isFinite(Date.parse(sig.signed_at)) || Date.parse(sig.signed_at)!==Date.parse(e.signed_at)) invalid();
  if (!Array.isArray(s.expected)||!Array.isArray(s.actual)||s.expected.length>20||s.actual.length>20||!Array.isArray(s.differences)||!s.checks||typeof s.checks!=='object'||typeof s.notes!=='string') invalid();
  for (const items of [s.expected,s.actual]) {
   const keys=new Set();
   for (const i of items) {
    if (!i||!['equipment_key','family','unit_tag'].every(k=>typeof i[k]==='string'&&i[k].length>0&&i[k].length<=160)||keys.has(i.equipment_key)||!Array.isArray(i.sims)||i.sims.length>10||!i.sims.every((v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=100)||!Number.isInteger(i.battery_count)||i.battery_count<0||i.battery_count>9999||!Array.isArray(i.parts)||i.parts.length>20||!i.parts.every((p:any)=>typeof p.name==='string'&&p.name.length>0&&p.name.length<=100&&Number.isInteger(p.quantity)&&p.quantity>=0&&p.quantity<=9999)) invalid();
    keys.add(i.equipment_key);
   }
  }
  if (!Array.isArray(e.photos)||e.photos.length>60) invalid();
  const slots=new Set();
  for (const p of e.photos) {
   const slot=p.equipment_key+':'+p.kind;
   if (!['unit','tag','signature'].includes(p.kind)||slots.has(slot)||typeof p.path!=='string'||!new RegExp('^'+e.actor_id+'/'+e.id+'/[a-f0-9]{64}\\.jpg$').test(p.path)||p.kind!=='signature'&&!s.actual.some((i:any)=>i.equipment_key===p.equipment_key)) invalid();
   slots.add(slot);
  }
  const signatures=e.photos.filter(p=>p.kind==='signature');
  if (sig.method==='drawn' ? signatures.length!==1||signatures[0].path!==sig.path : signatures.length!==0) invalid();
  if (s.actual.some((i:any)=>!e.photos.some(p=>p.kind==='unit'&&p.equipment_key===i.equipment_key))) invalid();
 }
 const current=d.events.at(-1)!;
 if (current.id!==d.event_id||current.kind!==d.kind||current.snapshot.revision!==d.revision||d.events[0].kind!=='checkout'||d.events[0].id!==d.transfer_id) invalid();
 if (d.kind==='receipt' && (d.events.length!==2||current.actor_id!==d.service_actor)) invalid();
 if (d.kind==='return' && (d.events.length!==3||d.events[1].kind!=='receipt'||d.events[1].snapshot.state!=='accepted')) invalid();
 if (d.kind==='checkout'&&d.events.length!==1 || d.kind==='cancel'&&d.events.length>2) invalid();
 return d;
}

export function transferReportHtml(value: TransferDelivery, links: Record<string,string> = {}) {
 const d=transferDelivery(value), e=escapeHtml;
 const cell=(a:unknown,b:unknown)=>'<tr><th scope="row">'+e(a)+'</th><td>'+e(b)+'</td></tr>';
 const manifest=(items:any[])=>items.map(i=>'<h4>'+e(i.family)+' '+e(i.unit_tag)+'</h4><table>'+cell('Exact equipment key',i.equipment_key)+cell('SIMs',i.sims.join(', '))+cell('Batteries',i.battery_count)+cell('Parts',i.parts.map((p:any)=>p.name+': '+p.quantity).join(', '))+'</table>').join('') || '<p>No equipment recorded.</p>';
 return '<!doctype html><html lang="en"><meta charset="utf-8"><title>'+e(labels[d.kind])+'</title><body><h1>'+e(labels[d.kind])+'</h1><p>Handoff '+e(d.transfer_id)+' · Event '+e(d.event_id)+' · Revision '+d.revision+'</p><p>IT: '+e(d.it_name)+' · Named Service technician: '+e(d.service_name)+'</p>'+d.events.map(event=>{
  const s=event.snapshot, sig=s.signature;
  return '<section><h2>'+e(labels[event.kind])+' · Revision '+s.revision+'</h2><p>Event '+e(event.id)+' · '+e(event.signed_at)+' · '+e(s.state)+'</p><h3>Expected equipment</h3>'+manifest(s.expected)+'<h3>Equipment physically recorded</h3>'+manifest(s.actual)+'<h3>Checks and differences</h3><pre>'+e(JSON.stringify({checks:s.checks,differences:s.differences,...(event.kind==='return'?{remaining:s.remaining,previous_returns:s.previous_returns}:{})},null,2))+'</pre><p>'+e(s.notes)+'</p><h3>Evidence</h3>'+event.photos.map(p=>'<p>'+e(p.equipment_key||'Sign-off')+' · '+e(p.kind)+(links[p.path]?'<a href="'+e(links[p.path])+'"> View saved image</a>':'')+'</p>').join('')+'<h3>Authenticated sign-off</h3><p>'+e(sig.statement)+'</p><p>'+e(sig.name)+' · '+e(sig.signed_by)+' · '+e(sig.signed_at)+' · '+e(sig.method)+'</p></section>';
 }).join('')+'<p>Returned equipment remains held for inventory review. This report does not release stock or change placement or health.</p></body></html>';
}

export type PdfLine = {text: string; bold?: boolean; image?: string};
export function transferReportPdf(value: TransferDelivery, signatures: Record<string,Uint8Array> = {}): Uint8Array {
 const d=transferDelivery(value), lines:PdfLine[]=[{text:labels[d.kind],bold:true},{text:'Handoff '+d.transfer_id},{text:'Event '+d.event_id+' / Revision '+d.revision},{text:'IT: '+d.it_name},{text:'Named Service: '+d.service_name}];
 const items=(heading:string,items:any[])=>{lines.push({text:heading,bold:true});for(const i of items)lines.push({text:i.family+' '+i.unit_tag+' ['+i.equipment_key+']'},{text:'SIMs: '+i.sims.join(', ')},{text:'Batteries: '+i.battery_count+'; Parts: '+i.parts.map((p:any)=>p.name+': '+p.quantity).join(', ')});};
 for (const event of d.events) {
  const s=event.snapshot,sig=s.signature;
  lines.push({text:labels[event.kind]+' / Revision '+s.revision+' / '+s.state,bold:true},{text:'Event '+event.id});
  items('Expected equipment',s.expected);items('Equipment physically recorded',s.actual);
  lines.push({text:'Checks: '+JSON.stringify(s.checks)},{text:'Differences: '+JSON.stringify(s.differences)},{text:'Notes: '+s.notes});
  if(event.kind==='return'){items('Equipment still assigned after this return',s.remaining||[]);lines.push({text:'Earlier returned items and event references: '+JSON.stringify(s.previous_returns||[])});}
  lines.push({text:'Signed by '+sig.name+' ('+sig.signed_by+')',bold:true},{text:sig.signed_at+' / '+sig.method},{text:sig.statement});
  if(sig.method==='drawn'){if(!signatures[sig.path])throw new Error('Saved handoff signature required.');lines.push({text:'',image:sig.path});}
  lines.push({text:event.photos.length+' supporting images in the verified archive.'});
 }
 lines.push({text:'Returned equipment remains held for inventory review. No stock release or placement / health change.'});
 return paginatedPdf(lines,signatures);
}

export function paginatedPdf(lines:PdfLine[],signatures:Record<string,Uint8Array>) {
 const enc=new TextEncoder(), ascii=(v:string)=>v.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e]/g,'-');
 const safe=(v:string)=>ascii(v).replace(/[\\()]/g,'\\$&');
 const pages:string[]=[''],images:{key:string;bytes:Uint8Array;width:number;height:number}[]=[];
 let y=742;
 const page=()=>{pages.push('');y=742;};
 for(const line of lines){
  if(line.image){
   const bytes=signatures[line.image];let width=0,height=0;
   if(bytes?.[0]!==255||bytes?.[1]!==216||bytes.length>5242880)throw new Error('Invalid handoff signature JPEG.');
   for(let p=2;p+9<bytes.length;){if(bytes[p]!==255)break;const marker=bytes[p+1],n=(bytes[p+2]<<8)+bytes[p+3];if([192,193,194].includes(marker)){if(bytes[p+9]!==3)break;width=(bytes[p+7]<<8)+bytes[p+8];height=(bytes[p+5]<<8)+bytes[p+6];break;}if(n<2||marker===218||marker===217)break;p+=n+2;}
   if(!width||!height)throw new Error('Invalid handoff signature JPEG.');
   let index=images.findIndex(i=>i.key===line.image);if(index<0){index=images.length;images.push({key:line.image,bytes,width,height});}
   const scale=Math.min(280/width,80/height),w=width*scale,h=height*scale;
   if(y-h<55)page();pages[pages.length-1]+=`q ${w} 0 0 ${h} 42 ${y-h} cm /Sig${index} Do Q\n`;y-=h+12;
   continue;
  }
  let rest=ascii(line.text);
  do{
   let n=Math.min(92,rest.length);if(rest.length>92){const space=rest.lastIndexOf(' ',92);if(space>46)n=space;}
   const part=rest.slice(0,n);rest=rest.slice(n).trimStart();
   if(y<55)page();pages[pages.length-1]+=`BT /${line.bold?'F2':'F1'} 10 Tf 1 0 0 1 42 ${y} Tm (${safe(part)}) Tj ET\n`;y-=14;
  }while(rest);
  y-=4;
 }
 const parts:Uint8Array[]=[],offsets=[0];let size=0;
 const put=(v:string|Uint8Array)=>{const b=typeof v==='string'?enc.encode(v):v;parts.push(b);size+=b.length;};
 const obj=(id:number,body:string)=>{offsets[id]=size;put(`${id} 0 obj\n${body}\nendobj\n`);};
 const firstImage=5+pages.length*2;
 put('%PDF-1.4\n');obj(1,'<< /Type /Catalog /Pages 2 0 R >>');obj(2,`<< /Type /Pages /Kids [${pages.map((_,i)=>(5+i*2)+' 0 R').join(' ')}] /Count ${pages.length} >>`);
 obj(3,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');obj(4,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
 pages.forEach((commands,i)=>{
  commands+=`BT /F1 8 Tf 1 0 0 1 42 30 Tm (TechCheck handoff / Page ${i+1} of ${pages.length}) Tj ET\n`;
  obj(5+i*2,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${images.map((_,j)=>'/Sig'+j+' '+(firstImage+j)+' 0 R').join(' ')} >> >> /Contents ${6+i*2} 0 R >>`);
  obj(6+i*2,`<< /Length ${enc.encode(commands).length} >>\nstream\n${commands}endstream`);
 });
 images.forEach((image,i)=>{const id=firstImage+i;offsets[id]=size;put(`${id} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`);put(image.bytes);put('\nendstream\nendobj\n');});
 const start=size,n=firstImage+images.length;put(`xref\n0 ${n}\n0000000000 65535 f \n`);for(let i=1;i<n;i++)put(String(offsets[i]).padStart(10,'0')+' 00000 n \n');put(`trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
 const result=new Uint8Array(size);let p=0;for(const part of parts){result.set(part,p);p+=part.length;}return result;
}

export function transferRawEmail(value:TransferDelivery,html:string,folder:string,pdf:Uint8Array) {
 const d=transferDelivery(value);
 if(!/^[A-Za-z0-9_-]+$/.test(folder))throw new Error('Invalid archive folder.');
 const b64=(bytes:Uint8Array)=>{let s='';for(let n=0;n<bytes.length;n+=8192)s+=String.fromCharCode(...bytes.subarray(n,n+8192));return btoa(s).replace(/.{1,76}/g,'$&\r\n');};
 const enc=new TextEncoder(),boundary='techcheck_handoff_'+d.event_id;
 const subject=b64(enc.encode(labels[d.kind]+' / '+d.service_name.replace(/[\r\n]/g,' ')+' / '+d.event_id)).replace(/\r\n/g,'');
 const body=html+'<p><a href="https://drive.google.com/drive/folders/'+folder+'">Verified handoff archive and all evidence</a></p>';
 const part=(type:string,data:string,disposition='')=>`--${boundary}\r\nContent-Type: ${type}\r\nContent-Transfer-Encoding: base64\r\n${disposition}\r\n${data}\r\n`;
 const raw=`From: ${RECIPIENT}\r\nTo: ${RECIPIENT}\r\nSubject: =?UTF-8?B?${subject}?=\r\nMessage-ID: <techcheck-handoff-${d.event_id}@camerasonsite.com>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`+part('text/html; charset=UTF-8',b64(enc.encode(body)))+part('application/pdf',b64(pdf),`Content-Disposition: attachment; filename="TechCheck-handoff-${d.event_id}.pdf"\r\n`)+`--${boundary}--\r\n`;
 return btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
