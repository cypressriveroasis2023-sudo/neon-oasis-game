import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMhelpWorkOrder, pdfTextLines, suggestWorkOrderDefaults, workInstructionsForReview } from '../src/mhelpWorkOrderPdf.ts';

// Synthetic text and identities only. Layout follows the inspected export.
export function syntheticPages() {
  const items = [];
  const add = (x,y,str) => items.push({x,y,str,width:str.length*5,height:12});
  add(30,50,'Work');add(30,75,'Order');add(30,100,'for');
  add(25,120,'Fixture Builders');add(25,140,'100 Office Lane');add(25,160,'Example City, TX 77000');add(25,180,'555-010-0100');
  add(420,130,'200 Provider Way');add(420,160,'555-010-0200');
  add(30,240,'Work Order No. 009001');add(180,240,'Issued on Jan 1, 2026');
  add(34,280,'Created');add(89,280,'Jan 1, 2026');add(178,280,'Priority');add(275,280,'Standard');
  add(34,300,'Status');add(89,300,'New');
  add(34,320,'Type');add(89,320,'*DELIVERY*');add(178,320,'Assign/Appointment');add(275,320,'Fixture, Dispatcher');
  add(34,340,'Job Name');add(89,340,'Fixture Site');
  add(34,360,'Description');add(89,360,'Address: 300 Service Road, Example, TX 77001');
  add(89,375,'Add an extra unit. Ask the site contact for placement.');
  add(89,390,'Monitoring times are: Mon-Fri 6pm-6am, all Sunday');
  add(89,405,'Site contacts: Fixture Contact 555-010-0300 ***Do not add');
  add(89,420,'Excluded Person to the call list***');
  add(34,480,'Quantity');add(88,480,'Item Name');add(191,480,'Notes');
  add(81,500,'1 Solar Device-4 Cam 4');add(191,500,'Video System with 4');
  add(88,515,'Monitored');add(191,515,'Monitored Cameras');
  add(81,535,'1 Protection');add(191,535,'Protection Plan');add(88,550,'Plan');
  add(35,570,'01hr 00min Setup and Delivery*');add(191,570,'Setup and Delivery');
  return [{page:1,width:612,height:792,items},{page:2,width:612,height:792,items:[{x:191,y:100,str:'Added by: Fixture, Dispatcher on Thu',width:200,height:12},{x:191,y:115,str:'Jan 1, 2026 14:15',width:120,height:12}]}];
}

test('printed work-order reference takes precedence over filename and keeps leading zeroes', () => {
  const result = extractMhelpWorkOrder(syntheticPages(),'Ticket123456_999.pdf');
  assert.equal(result.sourceTicketId.value,'009001');
  assert.ok(result.warnings.some(message => message.includes('filename contains a different number')));
  assert.equal(result.sourceTicketId.sourceLabel,'Work Order No.');
});

test('separates customer office, provider and actual service-site address', () => {
  const result = extractMhelpWorkOrder(syntheticPages(),'file.pdf');
  assert.equal(result.customer.value,'Fixture Builders');
  assert.equal(result.site.value,'Fixture Site');
  assert.equal(result.address.value,'300 Service Road, Example, TX 77001');
  assert.equal(result.additionalFields.find(row => row.sourceLabel === 'Customer mailing address').value,'100 Office Lane\nExample City, TX 77000');
  assert.equal(result.additionalFields.find(row => row.sourceLabel === 'Customer office phone').value,'555-010-0100');
  assert.ok(!result.address.value.includes('Provider'));
});

test('preserves wrapped instructions, restrictions, original monitoring hours and continuation-page note', () => {
  const result = extractMhelpWorkOrder(syntheticPages(),'file.pdf');
  assert.match(result.description.value,/Do not add\nExcluded Person to the call list/);
  assert.match(result.contact.value,/Do not add\nExcluded Person/);
  assert.equal(result.additionalFields.find(row => row.sourceLabel === 'Monitoring instructions').value,'Mon-Fri 6pm-6am, all Sunday');
  assert.equal(result.additionalFields.find(row => row.sourceLabel === 'Continuation page').page,2);
  assert.match(result.documentText,/Added by: Fixture, Dispatcher on Thu\nJan 1, 2026 14:15/);
  assert.match(result.documentText,/200 Provider Way/);
});

test('line items retain quantity, equipment count, protection line and hourly delivery charge', () => {
  const result = extractMhelpWorkOrder(syntheticPages(),'file.pdf');
  assert.deepEqual(result.lineItems,[
    {quantity:'1',itemName:'Solar Device-4 Cam 4 Monitored',notes:'Video System with 4 Monitored Cameras',page:1},
    {quantity:'1',itemName:'Protection Plan',notes:'Protection Plan',page:1},
    {quantity:'01hr 00min',itemName:'Setup and Delivery*',notes:'Setup and Delivery',page:1},
  ]);
  assert.deepEqual(result.units,[]);
  assert.equal(result.requestedDate,undefined);
  assert.equal(result.requestedTime,undefined);
  assert.deepEqual(suggestWorkOrderDefaults(result),{jobType:'DELIVERY',priority:'normal'});
});

test('unrecognized type and priority remain review fields, not invented defaults', () => {
  const result = extractMhelpWorkOrder(syntheticPages(),'file.pdf');
  assert.deepEqual(suggestWorkOrderDefaults({...result,jobType:{value:'EXOTIC'},priority:{value:'Critical-ish'}}),{jobType:undefined,priority:undefined});
});

test('missing/scanned/malformed and multiple-order documents fail closed', () => {
  const pages=syntheticPages();
  assert.throws(()=>extractMhelpWorkOrder([{...pages[0],items:[]}],'file.pdf'),/no readable text/);
  for(const label of ['for','Work Order No.','Description','Item Name']) {
    const changed=syntheticPages();changed[0].items=changed[0].items.filter(row=>!row.str.startsWith(label));
    assert.throws(()=>extractMhelpWorkOrder(changed,'file.pdf'));
  }
  const multi=syntheticPages();multi[1].items.push({x:30,y:240,str:'Work Order No. 009002 Issued on Jan 2, 2026',width:200,height:12});
  assert.throws(()=>extractMhelpWorkOrder(multi,'file.pdf'),/one supported/);
  assert.throws(()=>pdfTextLines([{...pages[0],items:[{x:NaN,y:1,width:1,height:1,str:'x'}]}]),/positions/);
});

test('shuffled PDF drawing order yields the same columns and lines', () => {
  const original=syntheticPages();
  const shuffled=original.map(page=>({...page,items:[...page.items].reverse()}));
  assert.deepEqual(extractMhelpWorkOrder(original,'file.pdf'),extractMhelpWorkOrder(shuffled,'file.pdf'));
});

test('review fields avoid stale duplicate contact/monitoring text while preserving full source', () => {
  const result=extractMhelpWorkOrder(syntheticPages(),'file.pdf');
  const work=workInstructionsForReview(result);
  assert.match(work,/300 Service Road/);assert.match(work,/Ask the site contact for placement/);
  assert.ok(!work.includes('Excluded Person'));assert.ok(!work.includes('Mon-Fri'));
  assert.match(result.contact.value,/Excluded Person/);assert.match(result.description.value,/Excluded Person/);
  assert.match(result.additionalFields.find(field=>field.sourceLabel==='Monitoring instructions').value,/Mon-Fri/);
});
