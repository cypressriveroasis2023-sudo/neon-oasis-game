import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {transferDelivery,transferReportHtml,transferReportPdf,transferRawEmail} from '../../supabase/functions/service-daily-delivery/transfer-report.ts';
import {deliveryFixture,signatureJpeg,transferIds} from './helpers/transfer-delivery-fixture.mjs';

test('checkout, receipt, return and cancellation archive exact immutable event history',()=>{
 for(const kind of ['checkout','receipt','return','cancel']){
  const value=deliveryFixture({kind}),copy=transferDelivery(value);
  assert.deepEqual(copy,value);value.events[0].snapshot.actual[0].unit_tag='changed after capture';
  assert.equal(copy.events[0].snapshot.actual[0].unit_tag,'001');
  const html=transferReportHtml(copy);
  assert.match(html,/00123456789012345670/);assert.match(html,/Synthetic &lt;IT&gt; &amp; technician/);assert.ok(!html.includes('<IT>'));
  assert.match(html,/No|does not release stock/);assert.ok(html.includes(copy.event_id));
  if(kind==='return')assert.ok(html.includes(transferIds.receipt));
 }
});

test('rejects wrong actor, foreign evidence, altered signature, missing receipt and mixed transfer history',()=>{
 const changes=[
  d=>d.events[1].actor_id=d.it_actor,
  d=>d.events[0].photos[0].path=d.events[0].photos[0].path.replace(d.it_actor,d.service_actor),
  d=>d.events[1].snapshot.signature.signed_by=d.it_actor,
  d=>d.events[1].snapshot.signature.name='Someone else',
  d=>d.events[1].snapshot.signature.signed_at='2026-10-18T12:00:00Z',
  d=>d.events[0].snapshot.transfer_id=transferIds.receipt,
  d=>d.events[0].snapshot.actual[0].sims=[123456789012345670],
  d=>d.events[0].photos=[],
  d=>d.events[0].photos.push({...d.events[0].photos[0]}),
  d=>d.revision=3,
 ];
 for(const change of changes){const d=deliveryFixture();change(d);assert.throws(()=>transferDelivery(d),/Invalid immutable/);}
 const returned=deliveryFixture({kind:'return'});returned.events.splice(1,1);assert.throws(()=>transferDelivery(returned),/Invalid immutable/);
});

test('twenty equipment units and long notes survive actual multi-page PDF parsing',async()=>{
 const d=deliveryFixture({kind:'return',count:20});
 d.events.at(-1).snapshot.notes='First note. '+('Long condition description. '.repeat(55))+' Final note.';
 const pdf=transferReportPdf(d),loading=getDocument({data:pdf,useSystemFonts:true,isEvalSupported:false}),document=await loading.promise;
 assert.ok(document.numPages>3);
 const text=[];for(let i=1;i<=document.numPages;i++){const page=await document.getPage(i);text.push((await page.getTextContent()).items.map(x=>x.str).join(' '));}
 const all=text.join(' ');
 for(const value of ['sniper:001','sniper:020','001234567890123456719','Final note.',transferIds.it,transferIds.service,transferIds.receipt])assert.ok(all.includes(value),value);
 assert.ok(all.includes('Page '+document.numPages+' of '+document.numPages));await loading.destroy();
});

test('drawn IT and Service signatures are required, bound to their own event and embedded',()=>{
 const d=deliveryFixture({drawn:true}),signatures=Object.fromEntries(d.events.map(e=>[e.snapshot.signature.path,signatureJpeg]));
 assert.throws(()=>transferReportPdf(d),/Saved handoff signature required/);
 const pdf=new TextDecoder().decode(transferReportPdf(d,signatures));
 assert.equal((pdf.match(/\/Subtype \/Image/g)||[]).length,2);assert.match(pdf,/\/Sig0 Do/);assert.match(pdf,/\/Sig1 Do/);
 signatures[d.events[1].snapshot.signature.path]=new Uint8Array([1,2]);assert.throws(()=>transferReportPdf(d,signatures),/Invalid handoff signature JPEG/);
 d.events[1].snapshot.signature.path=d.events[0].snapshot.signature.path;assert.throws(()=>transferDelivery(d),/Invalid immutable/);
});

test('delivery email has fixed recipient, event-specific identity and PDF attachment',()=>{
 const d=deliveryFixture(),raw=Buffer.from(transferRawEmail(d,transferReportHtml(d),'verified_folder',transferReportPdf(d)),'base64url').toString();
 assert.match(raw,/To: jmartin@camerasonsite\.com\r\n/);assert.match(raw,new RegExp('Message-ID: <techcheck-handoff-'+d.event_id+'@camerasonsite.com>'));
 assert.match(raw,/application\/pdf/);assert.match(raw,/Content-Disposition: attachment/);assert.ok(!raw.includes('private/'));
 assert.throws(()=>transferRawEmail(d,'','folder\r\nBcc: somebody',new Uint8Array()),/Invalid archive/);
});
