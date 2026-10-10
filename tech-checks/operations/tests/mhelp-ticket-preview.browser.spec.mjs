import {test,expect} from '@playwright/test';
import {traverseIframeHistory} from './helpers/iframeHistory.mjs';
import {ticketPreviewAppointmentFixture} from './fixtures/mhelpAppointmentTicketPreview.mjs';
import {syntheticAppointment} from './fixtures/mhelpAppointmentPreview.mjs';
import {ticketPreviewFixture,ticketPreviewEvidenceFixture,ticketPreviewDetailFixture} from './fixtures/mhelpTicketPreview.mjs';
const origin='http://127.0.0.1:4173',path='/api/mhelpdesk/partner/tickets/preview';
const dayButton=(preview,day='today')=>preview.getByRole('button',{name:day==='previous'?/^(?:Preview|Reading) previous day’s ticket types/:/^(?:Preview|Reading) today’s ticket types/});
async function expectNoDiagnostics(preview){
  await expect(preview.getByRole('region',{name:'mHelpDesk operational structural evidence'})).toHaveCount(0);
  await expect(preview.getByRole('region',{name:'mHelpDesk single-ticket detail structural evidence'})).toHaveCount(0);
  await expect(preview.getByRole('region',{name:'mHelpDesk appointment structural evidence'})).toHaveCount(0);
  await expect(preview.getByRole('table',{name:'Verified mHelpDesk statuses and counts'})).toHaveCount(0);
}
async function mount(page,{role='owner'}={}){
  const calls=[],state={bad:false,fail:false,denied:false,diagnostic:null,delay:null,preview:ticketPreviewDetailFixture({ticketCount:3})};
  // Only local test assets may reach a server. Specific mocks registered below
  // take precedence, including the production-shaped API URL with synthetic data.
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.route(origin+'/ticket-preview-fixture',route=>route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{border:0;width:100%;height:100vh}</style><iframe src="/${role==='it'?'?mode=fleet':''}#unit-tracker"></iframe><script>addEventListener('message',e=>{if(e.origin===location.origin&&e.data.type==='COS_OPERATIONS_TOKEN_REQUEST')e.source.postMessage({type:'COS_OPERATIONS_TOKEN_RESPONSE',requestId:e.data.requestId,role:'${role}',accessToken:'synthetic-only'},location.origin)})</script>`}));
  await page.route('**/functions/v1/cos-operations-pages',async route=>{
    const headers={'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, content-type'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    const request=route.request().postDataJSON();calls.push(request);const answer=data=>route.fulfill({headers,contentType:'application/json',body:JSON.stringify(data)});
    if(request.path==='/api/session')return answer({authorized:true,legacyOwner:role==='owner',role:role==='owner'?'Owner':'IT',features:{unitTracker:true,fleetAccess:true}});
    if(request.path==='/api/unit-tracker')return answer({contract:'COS_UNIT_TRACKER_OUTBOX_V1',workbookId:'1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA',connector:{enabled:false,state:'awaiting_sheets_connection'},queueEnabled:false,sources:[],requests:[],sourcesTruncated:false,requestsTruncated:false,sourcesHeld:0});
    if(request.path==='/api/field-map')return answer({items:[],inventoryItems:[],summary:{fieldUnits:0,mappedUnits:0,unitGps:0,missingGps:0}});
    if(request.path===path){
      // Capture this request's response before waiting, so later fixture changes
      // cannot accidentally turn a stale-response test into a fresh response.
      const {delay,fail,denied,diagnostic}=state,payload=structuredClone({...state.preview,...(state.bad?{automaticSync:true}:{})});
      if(delay)await delay;
      if(fail)return route.abort('failed');
      if(denied)return route.fulfill({status:403,headers,contentType:'application/json',body:JSON.stringify({error:'synthetic private provider text'})});
      if(diagnostic)return route.fulfill({status:503,headers,contentType:'application/json',body:JSON.stringify({error:diagnostic,detail:'synthetic private provider text'})});
      return answer(payload);
    }
    return answer({});
  });
  await page.goto(origin+'/ticket-preview-fixture');
  const frame=page.frameLocator('iframe'),preview=frame.getByRole('region',{name:'mHelpDesk ticket type preview'});
  await expect(frame.getByRole('region',{name:'Unit Tracker workspace'})).toBeVisible();
  return {frame,preview,calls,state};
}
test('today ticket preview is explicit, aggregate-only and preserves equipment controls',async({page})=>{
  const {frame,preview,calls}=await mount(page);await expect(preview).toBeVisible();expect(calls.some(call=>call.path===path)).toBe(false);
  await expect(frame.getByRole('button',{name:'Check mHelpDesk connection'})).toBeVisible();
  await dayButton(preview).click();
  await expect(preview.getByRole('status')).toContainText('3 tickets');await expect(preview).toContainText('Type ID 11');await expect(preview).toContainText('Installation');
  await expect(preview).toContainText('assignment unknown');await expect(preview).toContainText('1 ticket missing a service-location ID');await expect(preview).toContainText('This is a read-only preview');
  const statuses=preview.getByRole('table',{name:'Verified mHelpDesk statuses and counts'});
  await expect(statuses.getByRole('columnheader',{name:'Status ID',exact:true})).toBeVisible();
  await expect(statuses.getByRole('columnheader',{name:'Display text',exact:true})).toBeVisible();
  await expect(statuses.getByRole('row',{name:'2 Awaiting review Review queue 1 No 0 1',exact:true})).toBeVisible();
  await expect(preview).toContainText('3 tickets sampled');await expect(preview).toContainText('no ticket text or nested values are displayed');
  await expect(preview.getByRole('table',{name:'Sampled ticket field shapes'}).getByRole('row',{name:'subject string: 3 2 nonempty · 1 empty Other string: 3',exact:true})).toBeVisible();
  await expect(preview).toContainText('scheduledDate and neededBy are deprecated');await expect(preview).toContainText('equipment linkage remains unverified');
  await expect(preview).toContainText('12:00 AM CDT');await expect(preview).toContainText('3:00 PM CDT');
  expect(calls.filter(call=>call.method==='POST').map(call=>({path:call.path,body:call.body}))).toEqual([{path,body:{evidence:'appointment_structure_v1'}}]);
  expect(await preview.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
});
test('previous-day read is explicit, shares the busy guard and clears stale results across day switches',async({page})=>{
  const {preview,calls,state}=await mount(page);await dayButton(preview).click();await expect(preview.getByRole('status')).toContainText('3 tickets');
  await expect(preview).toContainText('Preview: today (Central Time).');
  state.preview.window={createdAfter:'2026-10-08T05:00:00.000Z',createdBefore:'2026-10-09T05:00:00.000Z'};
  let release;state.delay=new Promise(resolve=>{release=resolve});await dayButton(preview,'previous').click();
  await expect(dayButton(preview)).toBeDisabled();await expect(dayButton(preview,'previous')).toBeDisabled();
  await expect(preview.getByRole('status')).toHaveCount(0);await expect(preview.getByRole('table')).toHaveCount(0);
  await expectNoDiagnostics(preview);
  await preview.getByRole('button').evaluateAll(buttons=>{for(const button of buttons){button.click();button.click();}});
  await expect.poll(()=>calls.filter(call=>call.path===path).length).toBe(2);
  release();state.delay=null;await expect(preview.getByRole('status')).toContainText('3 tickets');
  await expect(preview).toContainText('Preview: previous day (Central Time).');
  await expect(preview).toContainText('after Oct 8, 2026');await expect(preview).toContainText('before Oct 9, 2026');
  await expect(preview.getByRole('columnheader',{name:'mHelpDesk type'})).toBeVisible();
  await expect(preview.getByRole('columnheader',{name:'mHelpDesk type'})).toHaveAttribute('scope','col');
  await expect(preview.getByRole('columnheader',{name:'Tickets in window'})).toBeVisible();
  await expect(preview.getByRole('columnheader',{name:'Tickets in window'})).toHaveAttribute('scope','col');
  await expect(preview).toContainText('does not import historical tickets');
  expect(await preview.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  state.bad=true;await dayButton(preview).click();await expect(preview.getByRole('alert')).toContainText('could not be verified');
  await expect(preview.getByRole('status')).toHaveCount(0);await expect(preview.getByRole('table')).toHaveCount(0);await expect(preview).not.toContainText('Preview: previous day');
  expect(calls.filter(call=>call.method==='POST').map(call=>({path:call.path,body:call.body}))).toEqual([{path,body:{evidence:'appointment_structure_v1'}},{path,body:{evidence:'appointment_structure_v1',day:'previous'}},{path,body:{evidence:'appointment_structure_v1'}}]);
});
test('repeated clicks issue one request and a failed refresh clears previous counts',async({page})=>{
  const {preview,calls,state}=await mount(page);let release;state.delay=new Promise(resolve=>{release=resolve});
  const button=dayButton(preview);await button.click();await expect(dayButton(preview)).toBeDisabled();
  await dayButton(preview).evaluate(button=>{button.click();button.click();});await expect.poll(()=>calls.filter(call=>call.path===path).length).toBe(1);
  release();await expect(preview.getByRole('status')).toContainText('3 tickets');state.delay=null;state.bad=true;
  await dayButton(preview).click();await expect(preview.getByRole('alert')).toContainText('could not be verified');await expect(preview.getByRole('table')).toHaveCount(0);await expect(preview.getByRole('status')).toHaveCount(0);
});
test('transport failures describe a read failure and retry requires another click',async({page})=>{
  const {preview,calls,state}=await mount(page);state.fail=true;await dayButton(preview).click();await expect(preview.getByRole('alert')).toHaveText('The ticket preview could not be verified. Try again.');
  await expect(preview).not.toContainText('save could not be confirmed');expect(calls.filter(call=>call.path===path)).toHaveLength(1);
  state.fail=false;state.preview.window.createdBefore='2026-10-09T21:00:00.000Z';state.preview.readAt='2026-10-09T21:00:01.000Z';
  await dayButton(preview).click();await expect(preview).toContainText('4:00 PM CDT');expect(calls.filter(call=>call.path===path)).toHaveLength(2);
});
for(const day of ['today','previous'])test(`${day}: navigating away discards an unfinished preview and does not auto-read when returning`,async({page})=>{
  const {frame,preview,calls,state}=await mount(page);let release;state.delay=new Promise(resolve=>{release=resolve});
  await dayButton(preview,day).click();await expect(dayButton(preview,day)).toBeDisabled();
  await expect.poll(()=>calls.filter(call=>call.path===path).length).toBe(1);
  await frame.locator('body').evaluate(()=>{location.hash='#field-map';});await expect(preview).toHaveCount(0);
  await frame.locator('body').evaluate(()=>{location.hash='#unit-tracker';});await expect(preview).toBeVisible();
  await expectNoDiagnostics(preview);
  const response=page.waitForResponse(response=>response.url().endsWith('/functions/v1/cos-operations-pages')&&response.request().method()==='POST'&&response.request().postDataJSON()?.path===path);
  release();state.delay=null;await (await response).finished();
  // Observe after the completed old response has had a rendering opportunity.
  await frame.locator('body').evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(preview.getByRole('status')).toHaveCount(0);expect(calls.filter(call=>call.path===path)).toHaveLength(1);
  await expectNoDiagnostics(preview);
});
for(const day of ['today','previous'])test(`${day}: an expired Owner session clears old aggregates and does not display provider text`,async({page})=>{
  const {preview,calls,state}=await mount(page);await dayButton(preview).click();await expect(preview.getByRole('status')).toContainText('3 tickets');
  state.denied=true;await dayButton(preview,day).click();
  await expect(preview.getByRole('alert')).toHaveText('Your Owner session could not be verified. Return to Tech Check and sign in again.');
  await expect(preview.getByRole('table')).toHaveCount(0);await expect(preview.getByRole('status')).toHaveCount(0);await expect(preview).not.toContainText('synthetic private');
  await expectNoDiagnostics(preview);
  expect(calls.filter(call=>call.path===path)).toHaveLength(2);
});
test('known safe diagnostic explains the read failure, clears old counts and redacts unknown codes',async({page})=>{
  const {preview,calls,state}=await mount(page);await dayButton(preview).click();await expect(preview.getByRole('status')).toContainText('3 tickets');
  state.diagnostic='MHELP_PREVIEW_TIMESTAMP_TIMEZONE';await dayButton(preview).click();
  await expect(preview.getByRole('alert')).toHaveText('The ticket timestamps do not include a supported timezone. Review the source date format before retrying. Reference: MHELP_PREVIEW_TIMESTAMP_TIMEZONE.');
  await expect(preview.getByRole('table')).toHaveCount(0);await expect(preview.getByRole('status')).toHaveCount(0);
  await expect(preview).toContainText('This is a read-only preview');await expect(preview).not.toContainText('synthetic private');
  expect(calls.filter(call=>call.path===path)).toHaveLength(2);
  state.diagnostic='MHELP_PREVIEW_TIMESTAMP_TIMEZONE synthetic private';await dayButton(preview).click();
  await expect(preview.getByRole('alert')).toHaveText('The ticket preview could not be verified. Try again.');
  await expect(preview).not.toContainText('MHELP_PREVIEW_');await expect(preview).not.toContainText('synthetic private');
  expect(calls.filter(call=>call.method==='POST').map(call=>({path:call.path,body:call.body}))).toEqual(Array.from({length:3},()=>({path,body:{evidence:'appointment_structure_v1'}})));
});
test('verified IT has no ticket preview button and makes no ticket request',async({page})=>{
  const {preview,calls}=await mount(page,{role:'it'});await expect(preview).toHaveCount(0);expect(calls.some(call=>call.path===path)).toBe(false);
});
test('legacy success explicitly marks operational evidence unavailable and replacement evidence stays bounded',async({page})=>{
  const {preview,calls,state}=await mount(page);state.preview=ticketPreviewFixture();
  await dayButton(preview).click();await expect(preview.getByRole('status')).toContainText('3 tickets');
  await expect(preview).toContainText('Operational field evidence is unavailable in this response');
  await expect(preview).toContainText('Single-ticket detail evidence is unavailable in this response');
  await expect(preview.getByRole('table',{name:'Verified mHelpDesk statuses and counts'})).toBeVisible();
  await expect(preview.getByRole('table',{name:'Sampled ticket field shapes'})).toHaveCount(0);
  state.preview=ticketPreviewEvidenceFixture({ticketCount:80,itemEntries:124,customEntries:72});
  await dayButton(preview).click();await expect(preview.getByRole('status')).toContainText('80 tickets');
  await expect(preview).toContainText('50 tickets sampled');await expect(preview).toContainText('At most 50 nested entries per collection');
  await expect(preview).toContainText('124 array entries within sampled tickets · 50 nested entries sampled');
  await expect(preview).toContainText('72 array entries within sampled tickets · 50 nested entries sampled');
  await expect(preview).toContainText('They do not prove total-window coverage');
  await expect(preview).not.toContainText('Operational field evidence is unavailable');
  expect(calls.filter(call=>call.path===path)).toHaveLength(2);
  expect(await preview.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
});
test('empty ticket and nested samples keep absent evidence explicit',async({page})=>{
  const {preview,state}=await mount(page);state.preview=ticketPreviewEvidenceFixture({ticketCount:0});
  await dayButton(preview).click();await expect(preview.getByRole('status')).toContainText('0 tickets');
  await expect(preview).toContainText('The empty sample provides no operational field evidence');
  await expect(preview.getByText('No nested entries were available to inspect in this sample.',{exact:true})).toHaveCount(2);
  await expect(preview).toContainText('No observations');await expect(preview).toContainText('No string observations');
  state.preview=ticketPreviewEvidenceFixture({itemEntries:0,customEntries:0});
  await dayButton(preview,'previous').click();await expect(preview.getByRole('status')).toContainText('3 tickets');
  await expect(preview.getByRole('region',{name:'Items structural evidence'})).toContainText('3 empty arrays · 0 nonempty arrays · 0 array entries within sampled tickets · 0 nested entries sampled');
  await expect(preview.getByRole('table',{name:'Sampled ticket field shapes'})).toContainText('absent: 3');
});
test('malformed nested and sampled-count evidence clears all aggregates without revealing hostile values',async({page})=>{
  const {preview,state}=await mount(page);await dayButton(preview).click();await expect(preview.getByRole('status')).toContainText('3 tickets');
  state.preview.operationalEvidence.collections.customFields.fields.fieldValue.raw='synthetic private secret@example.test';
  await dayButton(preview,'previous').click();await expect(preview.getByRole('alert')).toHaveText('The ticket preview could not be verified. Try again.');
  await expect(preview.getByRole('table')).toHaveCount(0);await expect(preview.getByRole('status')).toHaveCount(0);await expect(preview).not.toContainText('synthetic private');
  state.preview=ticketPreviewEvidenceFixture();state.preview.operationalEvidence.collections.items.sampledEntries=49;
  await dayButton(preview).click();await expect(preview.getByRole('alert')).toHaveText('The ticket preview could not be verified. Try again.');
  await expect(preview.getByRole('table')).toHaveCount(0);
  state.preview=ticketPreviewEvidenceFixture();await dayButton(preview).click();await expect(preview.getByRole('status')).toContainText('3 tickets');
  await expect(preview.getByRole('table',{name:'Sampled ticket field shapes'})).toBeVisible();
});
test('a late abandoned evidence response cannot replace a newer explicit result after navigation',async({page})=>{
  const {frame,preview,calls,state}=await mount(page);let release;state.delay=new Promise(resolve=>{release=resolve;});
  await dayButton(preview).click();await expect.poll(()=>calls.filter(call=>call.path===path).length).toBe(1);
  await frame.locator('body').evaluate(()=>{location.hash='#field-map';});await expect(preview).toHaveCount(0);
  await frame.locator('body').evaluate(()=>{location.hash='#unit-tracker';});await expect(preview).toBeVisible();
  state.delay=null;state.preview=ticketPreviewEvidenceFixture({ticketCount:80,itemEntries:124});
  await dayButton(preview,'previous').click();await expect(preview.getByRole('status')).toContainText('80 tickets');
  const response=page.waitForResponse(response=>response.url().endsWith('/functions/v1/cos-operations-pages')&&response.request().method()==='POST'&&response.request().postDataJSON()?.path===path);
  release();await (await response).finished();
  await frame.locator('body').evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(preview.getByRole('status')).toContainText('80 tickets');await expect(preview).toContainText('124 array entries within sampled tickets');
  expect(calls.filter(call=>call.path===path)).toHaveLength(2);
});

for(const day of ['today','previous'])test(`${day}: explicit singleton detail renders fixed shapes and bounded nested counts only`,async({page})=>{
  const {preview,calls,state}=await mount(page);
  state.preview=ticketPreviewDetailFixture({itemEntries:124,customEntries:72,equipmentEntries:51});
  if(day==='previous')state.preview.window={createdAfter:'2026-10-08T05:00:00.000Z',createdBefore:'2026-10-09T05:00:00.000Z'};
  await expect(preview).toContainText('at most one additional ticket detail read');
  await expect(preview).toContainText('cannot enter or select a ticket ID');
  await expect(preview).toContainText('No detail is read automatically');
  expect(calls.filter(call=>call.path===path)).toHaveLength(0);
  await dayButton(preview,day).click();
  await expect(preview.getByRole('status')).toContainText('1 ticket');
  const detail=preview.getByRole('region',{name:'mHelpDesk single-ticket detail structural evidence'});
  await expect(detail).toContainText('One server-selected ticket detail was read from the same creation window');
  await expect(detail).toContainText('Nonempty text is present in at least one of subject, summary or comment');
  await expect(detail).toContainText('Site remains unresolved');await expect(detail).toContainText('Schedule remains unverified');
  await expect(detail.getByRole('table',{name:'Single-ticket detail field shapes'}).getByRole('row',{name:'subject string: 1 1 nonempty · 0 empty Other string: 1',exact:true})).toBeVisible();
  await expect(detail.getByRole('table',{name:'Detail items sampled nested field shapes'}).getByRole('row',{name:'ticketId integer: 50 0 nonempty · 0 empty No string observations',exact:true})).toBeVisible();
  await expect(detail).toContainText('124 array entries within sampled tickets · 50 nested entries sampled');
  await expect(detail).toContainText('72 array entries within sampled tickets · 50 nested entries sampled');
  const equipment=detail.getByRole('region',{name:'Detail equipment candidate structural evidence'});
  await expect(equipment).toContainText('51 array entries within sampled tickets · 50 nested entries sampled');
  await expect(equipment.getByRole('table')).toHaveCount(0);
  await expect(detail).toContainText('POST/PUT write-model candidate');await expect(detail).toContainText('a GET equipment contract has not been verified');
  await expect(detail).toContainText('Items and custom fields remain unmapped structures');
  expect(calls.filter(call=>call.method==='POST').map(call=>({path:call.path,body:call.body}))).toEqual([{path,body:{evidence:'appointment_structure_v1',...(day==='previous'?{day:'previous'}:{})}}]);
  expect(await preview.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
});
test('zero or multiple tickets show explicit unavailable detail reasons while list evidence stays available',async({page})=>{
  const {preview,calls,state}=await mount(page);
  for(const ticketCount of [0,3]){
    state.preview=ticketPreviewDetailFixture({ticketCount});await dayButton(preview,ticketCount?'previous':'today').click();
    const detail=preview.getByRole('region',{name:'mHelpDesk single-ticket detail structural evidence'});
    await expect(preview.getByRole('status')).toContainText(`${ticketCount} tickets`);
    await expect(detail).toContainText(ticketCount?'More than one ticket was found':'No tickets were found');
    await expect(detail).toContainText('No ticket detail was read');await expect(detail.getByRole('table')).toHaveCount(0);
    await expect(preview.getByRole('table',{name:'Sampled ticket field shapes',exact:true})).toBeVisible();
  }
  expect(calls.filter(call=>call.path===path)).toHaveLength(2);
});
test('single-detail absent text and empty nested samples do not imply operational availability',async({page})=>{
  const {preview,state}=await mount(page);state.preview=ticketPreviewDetailFixture({hasDescription:false,itemEntries:0,customEntries:0,equipmentEntries:0});
  await dayButton(preview).click();
  const detail=preview.getByRole('region',{name:'mHelpDesk single-ticket detail structural evidence'});
  await expect(detail).toContainText('No nonempty text was found in subject, summary or comment');
  await expect(detail.getByText('No nested entries were available to inspect in this sample.',{exact:true})).toHaveCount(3);
  await expect(detail).toContainText('No observations');await expect(detail).toContainText('No string observations');
});
test('detail busy guard clears old evidence through day changes, repeated clicks and access denial',async({page})=>{
  const {preview,calls,state}=await mount(page);state.preview=ticketPreviewDetailFixture();
  await dayButton(preview).click();await expect(preview.getByRole('table',{name:'Single-ticket detail field shapes'})).toBeVisible();
  let release;state.delay=new Promise(resolve=>{release=resolve;});state.preview=ticketPreviewDetailFixture({hasDescription:false});
  await dayButton(preview,'previous').click();
  await expect(dayButton(preview)).toBeDisabled();await expect(dayButton(preview,'previous')).toBeDisabled();
  await expectNoDiagnostics(preview);await expect(preview.getByRole('status')).toHaveCount(0);
  await preview.getByRole('button').evaluateAll(buttons=>{for(const button of buttons){button.click();button.click();}});
  await expect.poll(()=>calls.filter(call=>call.path===path).length).toBe(2);
  release();state.delay=null;await expect(preview).toContainText('No nonempty text was found');
  await expect(preview).not.toContainText('Nonempty text is present');await expect(preview).toContainText('Preview: previous day');
  state.denied=true;await dayButton(preview).click();
  await expect(preview.getByRole('alert')).toHaveText('Your Owner session could not be verified. Return to Tech Check and sign in again.');
  await expectNoDiagnostics(preview);await expect(preview.getByRole('table')).toHaveCount(0);await expect(preview).not.toContainText('synthetic private');
  expect(calls.filter(call=>call.path===path)).toHaveLength(3);
});
test('malformed or private detail evidence fails closed at every level and requires explicit retry',async({page})=>{
  const {preview,calls,state}=await mount(page);state.preview=ticketPreviewDetailFixture();
  await dayButton(preview).click();await expect(preview.getByRole('table',{name:'Single-ticket detail field shapes'})).toBeVisible();
  const mutations=[
    d=>{d.ticketId='synthetic private ticket';},d=>{d.fields.customerId.value='synthetic private customer';},
    d=>{d.collections.items.fields.notes.raw='synthetic private secret@example.test';},
    d=>{d.collections.customFields.fields.fieldValue.formats['synthetic private']=1;},
    d=>{d.collections.equipment.fields.serialNumber={value:'synthetic private equipment'};},
    d=>{d.availability.site='synthetic private address';},d=>{d.collections.items.sampledEntries=50;},
    d=>{d.availability.description='nonempty_text_absent';},
  ];
  for(const mutate of mutations){
    state.preview=ticketPreviewDetailFixture();mutate(state.preview.detailEvidence);await dayButton(preview,'previous').click();
    await expect(preview.getByRole('alert')).toHaveText('The ticket preview could not be verified. Try again.');
    await expectNoDiagnostics(preview);await expect(preview.getByRole('status')).toHaveCount(0);await expect(preview.getByRole('table')).toHaveCount(0);
    await expect(preview).not.toContainText('synthetic private');
  }
  state.preview=ticketPreviewDetailFixture();await dayButton(preview).click();await expect(preview.getByRole('table',{name:'Single-ticket detail field shapes'})).toBeVisible();
  expect(calls.filter(call=>call.path===path)).toHaveLength(mutations.length+2);
});
for(const diagnostic of ['DETAIL_IDENTITY_MISMATCH','DETAIL_CHANGED','DETAIL_WINDOW_MISMATCH','DETAIL_SCHEMA','DETAIL_PROJECTION_INVALID'])test(`${diagnostic}: a fixed detail diagnostic clears old evidence without exposing provider text`,async({page})=>{
  const {preview,state}=await mount(page);state.preview=ticketPreviewDetailFixture();await dayButton(preview).click();
  await expect(preview.getByRole('table',{name:'Single-ticket detail field shapes'})).toBeVisible();
  state.diagnostic='MHELP_PREVIEW_'+diagnostic;await dayButton(preview,'previous').click();
  await expect(preview.getByRole('alert')).toContainText('Reference: MHELP_PREVIEW_'+diagnostic+'.');
  await expectNoDiagnostics(preview);await expect(preview.getByRole('status')).toHaveCount(0);await expect(preview).not.toContainText('synthetic private');
});
test('a late single-ticket detail cannot restore evidence after navigation or replace a newer window',async({page})=>{
  const {frame,preview,calls,state}=await mount(page);state.preview=ticketPreviewDetailFixture();
  let release;state.delay=new Promise(resolve=>{release=resolve;});await dayButton(preview).click();
  await expect.poll(()=>calls.filter(call=>call.path===path).length).toBe(1);
  await frame.locator('body').evaluate(()=>{location.hash='#field-map';});await expect(preview).toHaveCount(0);
  await frame.locator('body').evaluate(()=>{location.hash='#unit-tracker';});await expect(preview).toBeVisible();await expectNoDiagnostics(preview);
  expect(calls.filter(call=>call.path===path)).toHaveLength(1);
  state.delay=null;state.preview=ticketPreviewDetailFixture({ticketCount:0});await dayButton(preview,'previous').click();
  await expect(preview).toContainText('No ticket detail was read');
  const response=page.waitForResponse(response=>response.url().endsWith('/functions/v1/cos-operations-pages')&&response.request().method()==='POST'&&response.request().postDataJSON()?.path===path);
  release();await (await response).finished();
  await frame.locator('body').evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(preview.getByRole('status')).toContainText('0 tickets');await expect(preview).toContainText('No ticket detail was read');
  await expect(preview.getByRole('table',{name:'Single-ticket detail field shapes'})).toHaveCount(0);
  expect(calls.filter(call=>call.path===path)).toHaveLength(2);
});

for(const day of ['today','previous'])test(`${day}: appointment preview discloses one seven-day scheduled period and shows only returned structural evidence`,async({page})=>{
  const {preview,calls,state}=await mount(page);
  state.preview=ticketPreviewAppointmentFixture(day==='previous'?{createdAfter:'2026-10-08T05:00:00.000Z'}:{});
  await expect(preview).toContainText('one seven-calendar-day scheduled period');
  await expect(preview).toContainText('same server-selected ticket');await expect(preview).toContainText('No appointments are read for empty or multiple-ticket windows');
  await expect(preview).toContainText('does not require equipment or a Ticket Lead');await expect(preview).toContainText('Technicians choose the unit later');await expect(preview).toContainText('ticket notes hold the work instructions');
  expect(await preview.evaluate(element=>{const button=element.querySelector('button');return [...element.querySelectorAll('p')].some(p=>p.textContent.includes('seven-calendar-day')&&!!(p.compareDocumentPosition(button)&Node.DOCUMENT_POSITION_FOLLOWING));})).toBe(true);
  expect(calls.filter(call=>call.path===path)).toHaveLength(0);
  await expect(preview.locator('input,select,textarea')).toHaveCount(0);
  await dayButton(preview,day).click();
  const evidence=preview.getByRole('region',{name:'mHelpDesk appointment structural evidence'});
  await expect(evidence).toContainText(`Server-defined scheduled period: Oct ${day==='previous'?'8':'9'}, 2026, 12:00 AM CDT to Oct ${day==='previous'?'15':'16'}, 2026, 12:00 AM CDT`);
  await expect(evidence).toContainText('(end excluded). 7 calendar days in America/Chicago');
  await expect(evidence).toContainText('1 appointment rows inspected; reported total: 1');
  await expect(evidence).toContainText('One structural match was found');await expect(evidence).toContainText('does not verify an operational schedule or technician assignment');
  await expect(evidence).toContainText('No staff lookup was performed; the technician remains unresolved');
  await expect(evidence.getByRole('table',{name:'Inspected appointment field shapes'})).toBeVisible();
  await expect(evidence.getByRole('row',{name:'StartUTC string: 1 1 nonempty · 0 empty ISO with timezone: 1',exact:true})).toBeVisible();
  await expect(evidence).not.toContainText('synthetic-private');await expect(evidence).not.toContainText('2026-10-11T12:00');await expect(evidence).not.toContainText('781234');
  await expect(preview.getByRole('table',{name:'Single-ticket detail field shapes'})).toBeVisible();await expect(preview.getByRole('table',{name:'Sampled ticket field shapes',exact:true})).toBeVisible();
  expect(calls.filter(call=>call.method==='POST').map(call=>({path:call.path,body:call.body}))).toEqual([{path,body:{evidence:'appointment_structure_v1',...(day==='previous'?{day:'previous'}:{})}}]);
  expect(await preview.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
});
test('appointment evidence distinguishes unavailable selection, no match, incomplete and ambiguous without claiming no schedule',async({page})=>{
  const {preview,calls,state}=await mount(page);
  const evidence=preview.getByRole('region',{name:'mHelpDesk appointment structural evidence'});
  for(const count of [0,3]){
    state.preview=ticketPreviewAppointmentFixture({count});await dayButton(preview).click();
    await expect(evidence).toContainText(count?'More than one ticket was found':'No tickets were found');await expect(evidence).toContainText('No appointments were read');await expect(evidence.getByRole('table')).toHaveCount(0);
  }
  state.preview=ticketPreviewAppointmentFixture({appointments:[]});await dayButton(preview).click();
  await expect(evidence).toContainText('No match was found within this inspected schedule window');await expect(evidence).toContainText('An appointment may exist outside this period');await expect(evidence).not.toContainText('unscheduled');
  state.preview=ticketPreviewAppointmentFixture({reportedTotal:2});await dayButton(preview,'previous').click();
  await expect(evidence).toContainText('appointment page is incomplete');await expect(evidence).toContainText('Ticket-to-appointment linkage remains unverified');await expect(evidence).not.toContainText('One structural match was found');
  state.preview=ticketPreviewAppointmentFixture({appointments:[syntheticAppointment(),syntheticAppointment({ID:991235})]});await dayButton(preview).click();
  await expect(evidence).toContainText('Multiple structural matches were found');await expect(evidence).toContainText('scheduling and assignment remain unverified');await expect(evidence).not.toContainText('unscheduled');
  expect(calls.filter(call=>call.path===path)).toHaveLength(5);
});
test('deleted, hidden, team and recurring appointment candidates stay unverified and reveal only review counters',async({page})=>{
  const {preview,calls,state}=await mount(page);
  state.preview=ticketPreviewAppointmentFixture({appointments:[syntheticAppointment({IsDeleted:true,IsHidden:true,TeamId:5,RecurrenceRule:'synthetic-private-rule',UserId:null,StartUTC:'2026-10-11T12:00:00'})]});
  await dayButton(preview).click();const evidence=preview.getByRole('region',{name:'mHelpDesk appointment structural evidence'});
  await expect(evidence).toContainText('The structural match requires review');
  for(const text of ['Deleted ticket or appointment: 1','Hidden appointment: 1','Team assignment needing review: 1','Recurrence needing review: 1','Missing or unsupported user reference: 1','Unverified time or all-day state: 1'])await expect(evidence.getByRole('list',{name:'Appointment review reasons'})).toContainText(text);
  await expect(evidence).not.toContainText('synthetic-private');await expect(evidence).not.toContainText('2026-10-11T12:00:00');await expect(evidence).not.toContainText('One structural match was found');
  expect(calls.filter(call=>call.path===path)).toHaveLength(1);
});
test('appointment busy guard removes old evidence, rejects repeated clicks and clears all results on Owner denial',async({page})=>{
  const {preview,calls,state}=await mount(page);state.preview=ticketPreviewAppointmentFixture();await dayButton(preview).click();
  await expect(preview.getByRole('table',{name:'Inspected appointment field shapes'})).toBeVisible();
  let release;state.delay=new Promise(resolve=>{release=resolve;});state.preview=ticketPreviewAppointmentFixture({appointments:[]});await dayButton(preview,'previous').click();
  await expect(dayButton(preview)).toBeDisabled();await expect(dayButton(preview,'previous')).toBeDisabled();await expectNoDiagnostics(preview);
  await preview.getByRole('button').evaluateAll(buttons=>{for(const button of buttons){button.click();button.click();}});await expect.poll(()=>calls.filter(call=>call.path===path).length).toBe(2);
  release();state.delay=null;await expect(preview).toContainText('No match was found within this inspected schedule window');await expect(preview).not.toContainText('One structural match was found');
  state.denied=true;await dayButton(preview).click();await expect(preview.getByRole('alert')).toContainText('Your Owner session could not be verified');
  await expectNoDiagnostics(preview);await expect(preview.getByRole('table')).toHaveCount(0);await expect(preview.getByRole('status')).toHaveCount(0);await expect(preview).not.toContainText('synthetic private');expect(calls.filter(call=>call.path===path)).toHaveLength(3);
});
test('malformed appointment bounds, private values and forged safe states fail closed before any evidence renders',async({page})=>{
  const {preview,calls,state}=await mount(page);state.preview=ticketPreviewAppointmentFixture();await dayButton(preview).click();await expect(preview.getByRole('table',{name:'Inspected appointment field shapes'})).toBeVisible();
  const mutations=[
    e=>{e.window.endDateUtc='2026-10-15T05:00:00.000Z';},e=>{e.ticketId='synthetic private';},e=>{e.fields.UserId.value='synthetic private@example.test';},
    e=>{e.fields.StartUTC.formats['synthetic private']=1;},e=>{e.reviewCounts.technician='synthetic private';},e=>{e.reviewCounts.hidden=1;},
    e=>{e.linkage='no_match_in_window';},e=>{e.sampledAppointments=501;},e=>{e.fields.StartUTC.raw='synthetic private'.repeat(16000);},
  ];
  for(const mutation of mutations){state.preview=ticketPreviewAppointmentFixture();mutation(state.preview.appointmentEvidence);await dayButton(preview,'previous').click();
    await expect(preview.getByRole('alert')).toHaveText('The ticket preview could not be verified. Try again.');await expectNoDiagnostics(preview);await expect(preview.getByRole('table')).toHaveCount(0);await expect(preview.getByRole('status')).toHaveCount(0);await expect(preview).not.toContainText('synthetic private');}
  state.preview=ticketPreviewAppointmentFixture();await dayButton(preview).click();await expect(preview.getByRole('table',{name:'Inspected appointment field shapes'})).toBeVisible();expect(calls.filter(call=>call.path===path)).toHaveLength(mutations.length+2);
});
for(const diagnostic of ['APPOINTMENT_PROJECTION_INVALID','APPOINTMENT_COUNT_LIMIT','APPOINTMENT_WINDOW_INVALID'])test(`${diagnostic}: appointment failures clear evidence with only an allowlisted diagnostic`,async({page})=>{
  const {preview,calls,state}=await mount(page);state.preview=ticketPreviewAppointmentFixture();await dayButton(preview).click();await expect(preview.getByRole('table',{name:'Inspected appointment field shapes'})).toBeVisible();
  state.diagnostic='MHELP_PREVIEW_'+diagnostic;await dayButton(preview,'previous').click();await expect(preview.getByRole('alert')).toContainText('Reference: MHELP_PREVIEW_'+diagnostic+'.');await expectNoDiagnostics(preview);await expect(preview).not.toContainText('synthetic private');expect(calls.filter(call=>call.path===path)).toHaveLength(2);
});
test('appointment evidence cannot return from an abandoned request or Back/Forward navigation',async({page})=>{
  const {frame,preview,calls,state}=await mount(page);state.preview=ticketPreviewAppointmentFixture();let release;state.delay=new Promise(resolve=>{release=resolve;});await dayButton(preview).click();await expect.poll(()=>calls.filter(call=>call.path===path).length).toBe(1);
  await frame.locator('body').evaluate(()=>{location.hash='#field-map';});await expect(preview).toHaveCount(0);
  await traverseIframeHistory(frame,'back','#unit-tracker');await expect(preview).toBeVisible();await expectNoDiagnostics(preview);expect(calls.filter(call=>call.path===path)).toHaveLength(1);
  state.delay=null;state.preview=ticketPreviewAppointmentFixture({appointments:[]});await dayButton(preview,'previous').click();await expect(preview).toContainText('No match was found within this inspected schedule window');
  const response=page.waitForResponse(response=>response.url().endsWith('/functions/v1/cos-operations-pages')&&response.request().method()==='POST'&&response.request().postDataJSON()?.path===path);release();await (await response).finished();await frame.locator('body').evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(preview).toContainText('No match was found within this inspected schedule window');await expect(preview).not.toContainText('One structural match was found');
  await traverseIframeHistory(frame,'forward','#field-map');await expect(preview).toHaveCount(0);await traverseIframeHistory(frame,'back','#unit-tracker');await expect(preview).toBeVisible();await expectNoDiagnostics(preview);expect(calls.filter(call=>call.path===path)).toHaveLength(2);
});
