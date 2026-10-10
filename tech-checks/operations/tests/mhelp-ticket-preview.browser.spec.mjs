import {test,expect} from '@playwright/test';
import {ticketPreviewFixture,ticketPreviewEvidenceFixture} from './fixtures/mhelpTicketPreview.mjs';
const origin='http://127.0.0.1:4173',path='/api/mhelpdesk/partner/tickets/preview';
const dayButton=(preview,day='today')=>preview.getByRole('button',{name:day==='previous'?/^(?:Preview|Reading) previous day’s ticket types/:/^(?:Preview|Reading) today’s ticket types/});
async function expectNoDiagnostics(preview){
  await expect(preview.getByRole('region',{name:'mHelpDesk operational structural evidence'})).toHaveCount(0);
  await expect(preview.getByRole('table',{name:'Verified mHelpDesk statuses and counts'})).toHaveCount(0);
}
async function mount(page,{role='owner'}={}){
  const calls=[],state={bad:false,fail:false,denied:false,diagnostic:null,delay:null,preview:ticketPreviewEvidenceFixture()};
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
  expect(calls.filter(call=>call.method==='POST').map(call=>({path:call.path,body:call.body}))).toEqual([{path,body:{evidence:'operational_structure_v1'}}]);
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
  expect(calls.filter(call=>call.method==='POST').map(call=>({path:call.path,body:call.body}))).toEqual([{path,body:{evidence:'operational_structure_v1'}},{path,body:{evidence:'operational_structure_v1',day:'previous'}},{path,body:{evidence:'operational_structure_v1'}}]);
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
  expect(calls.filter(call=>call.method==='POST').map(call=>({path:call.path,body:call.body}))).toEqual(Array.from({length:3},()=>({path,body:{evidence:'operational_structure_v1'}})));
});
test('verified IT has no ticket preview button and makes no ticket request',async({page})=>{
  const {preview,calls}=await mount(page,{role:'it'});await expect(preview).toHaveCount(0);expect(calls.some(call=>call.path===path)).toBe(false);
});
test('legacy success explicitly marks operational evidence unavailable and replacement evidence stays bounded',async({page})=>{
  const {preview,calls,state}=await mount(page);state.preview=ticketPreviewFixture();
  await dayButton(preview).click();await expect(preview.getByRole('status')).toContainText('3 tickets');
  await expect(preview).toContainText('Operational field evidence is unavailable in this response');
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
