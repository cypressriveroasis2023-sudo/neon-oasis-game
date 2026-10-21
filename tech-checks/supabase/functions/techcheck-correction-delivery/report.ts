// Correction records are separate from the technician's signed handoff.
// This renderer never reuses a signature image or claims Service acceptance.
export {RECIPIENT} from '../service-daily-delivery/report.ts';
import {RECIPIENT,escapeHtml} from '../service-daily-delivery/report.ts';

export const SOURCE_HOSTS=new Set(['drive.google.com','docs.google.com','mail.google.com']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const textValue=(v:unknown,max=2000)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
export function evidenceSource(value:unknown):string|null {
 if(typeof value!=='string'||!value||value.length>2000||/[\s\u0000-\u001f<>]/.test(value))return null;
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&u.pathname!=='/'&&SOURCE_HOSTS.has(u.hostname)?u.href:null;}catch{return null;}
}
const person=(p:any)=>Boolean(p&&UUID.test(p.id)&&textValue(p.name,240));
const timestamp=(v:any)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const day=(value:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
export const centralTime=(value:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',dateStyle:'medium',timeStyle:'long',hour12:true}).format(new Date(value));

export function correctionRecord(job:any):any {
 const r={...(job?.snapshot||{}),...job};
 r.id=r.correction_id||r.id;
 r.applied_by=r.applied_by||{id:r.actor_id,name:r.actor_name};
 r.original_technician=r.original_technician||{id:r.technician_id,name:r.technician_name};
 r.confirmation=r.confirmation||{mode:r.mode,technician_id:r.original_technician.id,technician_name:r.original_technician.name,confirmed_at:r.confirmed_by?.confirmed_at,recorded_by:r.confirmation_recorded_by||r.applied_by.id,technician_reply:r.technician_reply,evidence_reference:r.evidence_reference};
 r.confirmed_by=r.confirmed_by||{id:r.confirmation.technician_id,name:r.confirmation.technician_name,confirmed_at:r.confirmation.confirmed_at};
 r.mode=r.mode||r.confirmation.mode;
 r.technician_reply=r.technician_reply??r.confirmation.technician_reply;
 r.evidence_reference=r.evidence_reference??r.confirmation.evidence_reference;
 r.confirmation_recorded_by=r.confirmation_recorded_by||r.confirmation.recorded_by;
 r.submitted_at=r.submitted_at||r.created_at;
 const validManifest=(items:any)=>Array.isArray(items)&&items.length>0&&items.length<=20&&new Set(items.map((x:any)=>x.equipment_key)).size===items.length&&items.every((x:any)=>textValue(x.equipment_key,240)&&textValue(x.family,100)&&textValue(x.unit_tag,100)&&Array.isArray(x.sims)&&x.sims.length<=10&&x.sims.every((s:any)=>textValue(s,100))&&Number.isInteger(x.battery_count)&&x.battery_count>=0&&x.battery_count<=9999&&Array.isArray(x.parts)&&x.parts.length<=20&&x.parts.every((p:any)=>textValue(p.name,240)&&Number.isInteger(p.quantity)&&p.quantity>=0&&p.quantity<=9999));
 if(!UUID.test(r.id)||!UUID.test(r.transfer_id)||!UUID.test(r.original_event_id)||!Number.isInteger(r.revision)||r.revision<2||r.state!=='awaiting_service'||!person(r.original_technician)||!person(r.service_recipient)||!person(r.applied_by)||!person(r.confirmed_by)||r.confirmed_by.id!==r.original_technician.id||r.confirmed_by.name!==r.original_technician.name||!['self','cited'].includes(r.mode)||!timestamp(r.submitted_at)||!timestamp(r.original_submitted_at)||!timestamp(r.confirmation.confirmed_at)||Date.parse(r.confirmation.confirmed_at)<Date.parse(r.original_submitted_at)||Date.parse(r.confirmation.confirmed_at)>Date.parse(r.submitted_at)||!textValue(r.reason)||(r.mode==='cited'&&!textValue(r.technician_reply,5000))||!validManifest(r.before)||!validManifest(r.after)||r.original_check_date!==day(r.original_submitted_at))throw new Error('Correction provenance is incomplete.');
 if(r.confirmation.technician_id!==r.original_technician.id||r.confirmation.technician_name!==r.original_technician.name||r.confirmation.mode!==r.mode||r.confirmation.recorded_by!==r.applied_by.id||r.confirmation_recorded_by!==r.applied_by.id||(r.confirmed_by.confirmed_at&&Date.parse(r.confirmed_by.confirmed_at)!==Date.parse(r.confirmation.confirmed_at))||(r.confirmed_by.mode&&r.confirmed_by.mode!==r.mode)||r.technician_reply!==r.confirmation.technician_reply||r.evidence_reference!==r.confirmation.evidence_reference)throw new Error('Correction confirmation does not match its audit.');
 // The UUID is authoritative in the saved audit. Resolve its display name only
 // through the exact authenticated actor identity captured in the same snapshot.
 r.recorded_by=r.applied_by;
 if((r.mode==='self'&&r.applied_by.id!==r.original_technician.id)||(r.mode==='cited'&&(!evidenceSource(r.evidence_reference)||r.applied_by.id===r.original_technician.id)))throw new Error('Correction confirmation mode is invalid.');
 if(r.evidence_reference&&!evidenceSource(r.evidence_reference))throw new Error('Correction evidence reference is invalid.');
 return r;
}

export type CorrectionLinks={originalFolder:string;originalPdf:string;correctionFolder:string;correctionPdf:string;answers:string;evidence:Array<{label:string;url:string}>};
const itemLines=(i:any)=>[`${i.family} ${i.unit_tag}`,`Exact equipment key: ${i.equipment_key}`,`SIMs listed: ${i.sims.join(', ')||'None listed'}`,`Batteries / battery boxes: ${i.battery_count}`,`Additional parts: ${i.parts.map((p:any)=>p.name+' x '+p.quantity).join(', ')||'None listed'}`];
const confirmationText=(r:any)=>r.mode==='self'?'The original technician confirmed this correction in their authenticated account.':`The technician's documented confirmation was recorded and applied by ${r.applied_by.name}. It is not a new technician login or signature.`;

function detailsHtml(r:any,links:CorrectionLinks){
 const e=escapeHtml,row=(label:string,value:any)=>'<tr><th scope="row">'+e(label)+'</th><td>'+e(value)+'</td></tr>';
 const manifest=(items:any[])=>items.map(i=>'<section><h3>'+e(i.family+' '+i.unit_tag)+'</h3><ul>'+itemLines(i).slice(1).map(l=>'<li>'+e(l)+'</li>').join('')+'</ul></section>').join('');
 const source=evidenceSource(r.evidence_reference);
 return '<h1>Equipment handoff correction</h1><p><strong>'+e(r.original_technician.name)+' → '+e(r.service_recipient.name)+'</strong></p><p>Revision '+e(r.revision)+' · '+e(centralTime(r.submitted_at))+'</p>'+
 '<p class="notice">Awaiting Service acceptance when this correction was saved. This correction does not record equipment acceptance, an installation, or a return.</p>'+
 '<table>'+row('Handoff ID',r.transfer_id)+row('Original signed event',r.original_event_id)+row('Correction ID',r.id)+row('Original submission',centralTime(r.original_submitted_at)+' · '+r.original_submitted_at)+row('Original technician',r.original_technician.name+' · '+r.original_technician.id)+row('Confirmation supplied by',r.confirmed_by.name+' · '+r.confirmed_by.id)+row('Technician confirmation time',centralTime(r.confirmation.confirmed_at)+' · '+r.confirmation.confirmed_at)+row('Confirmation recorded by',r.recorded_by.name+' · '+r.recorded_by.id)+row('Correction applied by',r.applied_by.name+' · '+r.applied_by.id)+row('Correction applied at',centralTime(r.submitted_at)+' · '+r.submitted_at)+'</table>'+
 '<h2>Why it changed</h2><p class="multiline">'+e(r.reason)+'</p><h2>Technician confirmation</h2><p>'+e(confirmationText(r))+'</p>'+(r.technician_reply?'<blockquote class="multiline">'+e(r.technician_reply)+'</blockquote>':'')+(r.mode==='self'&&r.confirmation.statement?'<p class="multiline">'+e(r.confirmation.statement)+'</p>':'')+(source?'<p><a href="'+e(source)+'">Open cited technician confirmation</a></p>':'')+
 '<h2>Before this correction · revision '+e(r.revision-1)+'</h2>'+manifest(r.before)+'<h2>After this correction · revision '+e(r.revision)+'</h2>'+manifest(r.after)+
 '<h2>Original and correction records</h2><ul><li><a href="'+e(links.originalPdf)+'">Original signed handoff PDF</a></li><li><a href="'+e(links.originalFolder)+'">Original package, photographs and signature</a></li><li><a href="'+e(links.correctionPdf)+'">This correction PDF</a></li><li><a href="'+e(links.correctionFolder)+'">This correction and its evidence</a></li><li><a href="'+e(links.answers)+'">Complete correction audit JSON</a></li>'+links.evidence.map(p=>'<li><a href="'+e(p.url)+'">'+e(p.label)+'</a></li>').join('')+'</ul><p>The original signed answers, PDF, signature and photographs are unchanged. This separate correction records who supplied confirmation and who applied it.</p>';
}

export function correctionHtml(job:any,links:CorrectionLinks):string {
 const r=correctionRecord(job);
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Handoff correction revision '+r.revision+'</title><style>body{font:16px/1.55 Arial,sans-serif;color:#20252c;max-width:860px;margin:24px auto;padding:0 20px}h1{border-top:5px solid #ba2635;padding-top:18px}h2{margin-top:28px}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #ddd;padding:10px;overflow-wrap:anywhere}th{width:32%}.notice{padding:14px;background:#f3f5f7;border-left:4px solid #667085}.multiline{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#a41728;overflow-wrap:anywhere}blockquote{margin-left:0;padding-left:16px;border-left:3px solid #ddd}</style><body><small>CAMERAS ONSITE</small>'+detailsHtml(r,links)+'</body></html>';
}
export function correctionEmailHtml(job:any,links:CorrectionLinks):string{return '<div style="font:16px/1.5 Arial,sans-serif;max-width:860px">'+detailsHtml(correctionRecord(job),links)+'</div>';}
export function correctionAnswers(job:any,links:CorrectionLinks):string {
 const r=correctionRecord(job);
 const photos=(r.photos||[]).map((p:any,n:number)=>({kind:p.kind,equipment_key:p.equipment_key,storage_path:p.path,sha256:p.path?.split('/').pop()?.replace(/\.jpg$/,''),drive_url:links.evidence[n]?.url}));
 return JSON.stringify({contract:'COS_HANDOFF_CORRECTION_ARCHIVE_V1',correction_id:r.id,transfer_id:r.transfer_id,original_event_id:r.original_event_id,base_revision:r.revision-1,revision:r.revision,state_at_correction:r.state,timezone:'America/Chicago',original_submitted_at:r.original_submitted_at,original_check_date:r.original_check_date,applied_at:r.submitted_at,original_technician:r.original_technician,service_recipient:r.service_recipient,applied_by:r.applied_by,confirmed_by:r.confirmed_by,confirmation_recorded_by:r.confirmation_recorded_by,confirmation:r.confirmation,reason:r.reason,before:r.before,after:r.after,photos,original_unchanged:true,service_acceptance_recorded:false,links},null,2);
}

// A text-only additive PDF. There is deliberately no signature field or image.
export function correctionPdf(job:any,links:CorrectionLinks):Uint8Array {
 const r=correctionRecord(job),enc=new TextEncoder(),pages:string[]=[];
 const regular='278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584'.split(' ').map(Number);
 const boldWidths='278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584'.split(' ').map(Number);
 const ascii=(v:unknown)=>String(v??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e\n]/g,'-');
 const safe=(v:string)=>ascii(v).replace(/[\\()]/g,'\\$&');
 const wrap=(v:string,size:number,bold:boolean)=>ascii(v).split('\n').flatMap(line=>{const out:string[]=[],widths=bold?boldWidths:regular;let rest=line;while(rest){let count=0,width=0;while(count<rest.length&&width+widths[rest.charCodeAt(count)-32]*size/1000<=532){width+=widths[rest.charCodeAt(count)-32]*size/1000;count++;}if(count===rest.length){out.push(rest);break;}let cut=rest.lastIndexOf(' ',count);if(cut<count/2)cut=count;out.push(rest.slice(0,cut));rest=rest.slice(cut).trimStart();}return out.length?out:[''];});
 let commands='',y=0;
 const page=()=>{if(commands)pages.push(commands);commands='0.73 0.15 0.21 rg 40 747 532 5 re f\n0.12 0.14 0.17 rg\n';y=723;line('CAMERAS ONSITE',10,true);y-=6;line('Equipment handoff correction',19,true);line('Handoff '+r.transfer_id,9);line('Correction '+r.id+' | Revision '+r.revision,9);y-=12;};
 const line=(v:string,size=10,bold=false)=>{for(const part of wrap(v,size,bold)){if(y<58)page();commands+=`BT /${bold?'F2':'F1'} ${size} Tf 1 0 0 1 40 ${y} Tm (${safe(part)}) Tj ET\n`;y-=size+5;}};
 const section=(label:string)=>{if(y<115)page();else y-=10;line(label,12,true);};
 page();line(r.original_technician.name+' -> '+r.service_recipient.name,13,true);line('Applied: '+centralTime(r.submitted_at));line('Awaiting Service acceptance at correction save. This is not an acceptance or return.');
 section('Original submission');line('Original event: '+r.original_event_id);line('Submitted: '+centralTime(r.original_submitted_at)+' | '+r.original_submitted_at);line('Original technician: '+r.original_technician.name+' | '+r.original_technician.id);
 section('Confirmation and application');line('Confirmation supplied by: '+r.confirmed_by.name+' | '+r.confirmed_by.id);line('Confirmed: '+centralTime(r.confirmation.confirmed_at)+' | '+r.confirmation.confirmed_at);line('Confirmation recorded by: '+r.recorded_by.name+' | '+r.recorded_by.id);line('Applied by: '+r.applied_by.name+' | '+r.applied_by.id);line('Applied at: '+r.submitted_at);line(confirmationText(r));
 section('Reason');line(r.reason);if(r.technician_reply){section('Technician reply');line(r.technician_reply);}else if(r.mode==='self'&&r.confirmation.statement){section('Authenticated confirmation');line(r.confirmation.statement);}const source=evidenceSource(r.evidence_reference);if(source)line('Confirmation source: '+source,9);
 for(const [label,items] of [['Before this correction - revision '+(r.revision-1),r.before],['After this correction - revision '+r.revision,r.after]] as const){section(label);for(const item of items){if(y<150)page();for(const [i,value] of itemLines(item).entries())line(value,i===0?11:10,i===0);y-=8;}}
 section('Original and correction links');for(const [label,url] of [['Original signed PDF',links.originalPdf],['Original package',links.originalFolder],['Correction PDF',links.correctionPdf],['Correction folder',links.correctionFolder],['Full audit JSON',links.answers],...links.evidence.map(e=>[e.label,e.url])])line(label+': '+url,9);
 section('Record integrity');line('The original signed answers, PDF, signature and photographs remain unchanged.');line('No signature was copied or applied for another person. Service acceptance remains separate.');
 pages.push(commands);
 const chunks:string[]=[],offsets:number[]=[0];let length=0;
 const put=(s:string)=>{chunks.push(s);length+=enc.encode(s).length;};
 const obj=(n:number,body:string)=>{offsets[n]=length;put(`${n} 0 obj\n${body}\nendobj\n`);};
 put('%PDF-1.4\n');obj(1,'<< /Type /Catalog /Pages 2 0 R >>');obj(2,`<< /Type /Pages /Kids [${pages.map((_,i)=>`${5+i*2} 0 R`).join(' ')}] /Count ${pages.length} >>`);obj(3,`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 126 /Widths [${regular.join(' ')}] >>`);obj(4,`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 126 /Widths [${boldWidths.join(' ')}] >>`);
 pages.forEach((content,i)=>{const footer=`BT /F1 9 Tf 0.4 0.4 0.4 rg 1 0 0 1 40 32 Tm (Correction revision ${r.revision} - Page ${i+1} of ${pages.length}) Tj ET\n`;obj(5+i*2,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6+i*2} 0 R >>`);obj(6+i*2,`<< /Length ${enc.encode(content+footer).length} >>\nstream\n${content}${footer}endstream`);});
 const xref=length,count=5+pages.length*2;put(`xref\n0 ${count}\n0000000000 65535 f \n`);for(let n=1;n<count;n++)put(String(offsets[n]).padStart(10,'0')+' 00000 n \n');put(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);return enc.encode(chunks.join(''));
}

export function correctionRawEmail(job:any,html:string,pdf:Uint8Array):string {
 const r=correctionRecord(job),utf8=(s:string)=>new TextEncoder().encode(s);
 const b64=(bytes:Uint8Array)=>{let s='';for(let n=0;n<bytes.length;n+=8192)s+=String.fromCharCode(...bytes.subarray(n,n+8192));return btoa(s);};
 const wrap=(s:string)=>s.replace(/.{1,76}/g,'$&\r\n'),boundary='cos_correction_'+r.id;
 const subject=b64(utf8('COS handoff correction - revision '+r.revision+' - '+r.original_technician.name));
 const raw=`From: ${RECIPIENT}\r\nTo: ${RECIPIENT}\r\nSubject: =?UTF-8?B?${subject}?=\r\nMessage-ID: <handoff-correction-${r.id}@camerasonsite.com>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(b64(utf8(html)))}\r\n--${boundary}\r\nContent-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="Handoff-correction-revision-${r.revision}.pdf"\r\n\r\n${wrap(b64(pdf))}\r\n--${boundary}--\r\n`;
 return b64(utf8(raw)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
