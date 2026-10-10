/** Focused real-browser component regression, independent of Playwright's test collector.
 * Run: node tests/mhelp-ticket-preview-direct-browser.mjs
 * Uses only a synthetic api.post module; no parent session or production endpoint is contacted.
 */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ticketPreviewFixture,ticketPreviewEvidenceFixture} from './fixtures/mhelpTicketPreview.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),artifacts=await mkdtemp(path.join(tmpdir(),'mhelp-ticket-preview-browser-'));
const source=path.join(root,'src/MhelpTicketPreview.tsx');
const result=await build({stdin:{contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import Preview from ${JSON.stringify(source)};function Harness(){const[show,setShow]=useState(true);return <><button id="toggle" onClick={()=>setShow(!show)}>{show?'Leave preview':'Return to preview'}</button><div className="unit-tracker mhelp-partner-review">{show&&<Preview/>}</div></>;}createRoot(document.getElementById('root')).render(<Harness/>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',plugins:[{
  name:'synthetic-api-only',setup(plugin){
    plugin.onResolve({filter:/^\.\/api$/},args=>[source,path.join(root,'src/mhelpTicketPreviewError.ts')].includes(args.importer)?{path:'synthetic-api',namespace:'fixture'}:undefined);
    plugin.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:`export class OperationsApiError extends Error{constructor(message,status=503){super(message);this.response={status,data:{error:message}};}}export const api={post:async(path,body)=>{window.fixtureCalls.push({path,body});const mode=window.fixtureMode;const value=structuredClone(window.fixtureValue);if(mode==='hold')await new Promise(resolve=>{window.releaseFixture=resolve;});if(mode==='transport')throw new OperationsApiError('The save could not be confirmed. Refresh this workspace before trying again.',503);if(mode==='denied')throw new OperationsApiError('private provider text',403);return{data:value};}};`}));
  }
}]});
const css=await readFile(path.join(root,'src/unitTracker.css'),'utf8');
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
const summary=[];
try{
  for(const width of [390,1440]){
    const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    // Every network request is denied. The component must use the synthetic imported API only.
    const network=[];await page.route('**/*',route=>{network.push(route.request().url());return route.abort();});
    await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#111827;color:#f3f6fb;font:15px Arial,sans-serif}button{padding:12px;max-width:100%;white-space:normal}section{max-width:100%}${css}</style><div id="root"></div>`);
    await page.evaluate(value=>{window.fixtureCalls=[];window.fixtureMode='success';window.fixtureValue=value;},ticketPreviewEvidenceFixture());
    await page.addScriptTag({content:result.outputFiles[0].text});
    const region=page.getByRole('region',{name:'mHelpDesk ticket type preview'}),button=region.getByRole('button',{name:/^(?:Preview|Reading) today’s ticket types/});
    await button.waitFor();assert.equal((await page.evaluate(()=>window.fixtureCalls)).length,0,'mount must not read');
    assert.match(await region.innerText(),/This is a read-only preview/);
    await page.evaluate(()=>{window.fixtureMode='hold';});
    await button.evaluate(element=>{element.click();element.click();});
    await page.waitForFunction(()=>window.fixtureCalls.length===1&&typeof window.releaseFixture==='function');
    assert.equal(await button.isDisabled(),true);assert.deepEqual(await page.evaluate(()=>window.fixtureCalls),[{path:'/api/mhelpdesk/partner/tickets/preview',body:{evidence:'operational_structure_v1'}}]);
    await page.evaluate(()=>{window.releaseFixture();window.fixtureMode='success';});
    await region.getByRole('status').waitFor();assert.match(await region.innerText(),/3 tickets/);assert.match(await region.innerText(),/Type ID 11/);assert.match(await region.innerText(),/12:00 AM CDT/);assert.match(await region.innerText(),/3:00 PM CDT/);
    const statuses=region.getByRole('table',{name:'Verified mHelpDesk statuses and counts'});
    assert.match(await statuses.innerText(),/Awaiting review/);assert.match(await statuses.innerText(),/Review queue/);
    assert.equal(await statuses.getByRole('columnheader',{name:'Display text',exact:true}).isVisible(),true);
    assert.equal(await statuses.getByRole('row',{name:'2 Awaiting review Review queue 1 No 0 1',exact:true}).count(),1);
    assert.match(await region.innerText(),/3 tickets sampled/);assert.match(await region.innerText(),/2 nonempty · 1 empty/);
    assert.match(await region.innerText(),/scheduledDate and neededBy are deprecated/);assert.match(await region.innerText(),/equipment linkage remains unverified/);
    assert.match(await region.innerText(),/assignment unknown/);assert.equal(await region.evaluate(element=>element.scrollWidth<=element.clientWidth),true,'no horizontal component overflow');
    await page.screenshot({path:path.join(artifacts,`preview-${width}.png`),fullPage:true});
    await page.evaluate(()=>{window.fixtureValue.automaticSync=true;});await button.click();await region.getByRole('alert').waitFor();
    assert.equal(await region.getByRole('table').count(),0);assert.equal(await region.getByRole('status').count(),0,'invalid refresh clears old counts');
    await page.evaluate(value=>{window.fixtureValue=value;window.fixtureMode='transport';},ticketPreviewEvidenceFixture());await button.click();await region.getByRole('alert').waitFor();
    assert.equal(await region.getByRole('alert').innerText(),'The ticket preview could not be verified. Try again.');
    assert.equal((await page.evaluate(()=>window.fixtureCalls)).length,3,'failure does not retry automatically');
    await page.evaluate(()=>{window.fixtureMode='success';window.fixtureValue.window.createdBefore='2026-10-09T21:00:00.000Z';window.fixtureValue.readAt='2026-10-09T21:00:01.000Z';});
    await button.click();await region.getByRole('status').waitFor();assert.match(await region.innerText(),/4:00 PM CDT/);assert.doesNotMatch(await region.innerText(),/3:00 PM CDT/);
    await page.evaluate(()=>{window.fixtureMode='denied';});await button.click();await region.getByRole('alert').waitFor();
    assert.match(await region.getByRole('alert').innerText(),/Owner session could not be verified/);assert.doesNotMatch(await region.innerText(),/private provider text/);
    await page.evaluate(()=>{window.fixtureMode='hold';window.releaseFixture=null;});await button.click();await page.waitForFunction(()=>typeof window.releaseFixture==='function');
    await page.getByRole('button',{name:'Leave preview',exact:true}).click();assert.equal(await region.count(),0);
    await page.getByRole('button',{name:'Return to preview',exact:true}).click();await region.waitFor();await page.evaluate(()=>{window.releaseFixture();window.fixtureMode='success';});
    // Let the resolved request finish its microtasks before checking the new component instance.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await region.getByRole('status').count(),0,'old request must not populate the remounted component');assert.equal(await region.getByRole('table').count(),0);
    assert.equal((await page.evaluate(()=>window.fixtureCalls)).length,6,'returning does not trigger another preview');
    await page.evaluate(value=>{window.fixtureValue=value;},ticketPreviewFixture());await button.click();await region.getByRole('status').waitFor();
    assert.match(await region.innerText(),/Operational field evidence is unavailable in this response/);assert.equal(await region.getByRole('table',{name:'Sampled ticket field shapes'}).count(),0);
    const prior=ticketPreviewEvidenceFixture({ticketCount:80,itemEntries:124,customEntries:72});prior.window={createdAfter:'2026-10-08T05:00:00.000Z',createdBefore:'2026-10-09T05:00:00.000Z'};
    await page.evaluate(value=>{window.fixtureValue=value;window.fixtureMode='hold';window.releaseFixture=null;},prior);
    const previous=region.getByRole('button',{name:/^(?:Preview|Reading) previous day’s ticket types/});await previous.click();
    await page.waitForFunction(()=>typeof window.releaseFixture==='function');assert.equal(await button.isDisabled(),true);assert.equal(await previous.isDisabled(),true);
    assert.equal(await region.getByRole('status').count(),0);assert.equal(await region.getByRole('table').count(),0);
    await previous.evaluate(element=>{element.click();element.click();});assert.equal((await page.evaluate(()=>window.fixtureCalls)).length,8);
    await page.evaluate(()=>{window.releaseFixture();window.fixtureMode='success';});await region.getByRole('status').waitFor();
    assert.match(await region.innerText(),/80 tickets/);assert.match(await region.innerText(),/50 tickets sampled/);
    assert.match(await region.innerText(),/124 array entries within sampled tickets · 50 nested entries sampled/);
    assert.match(await region.innerText(),/72 array entries within sampled tickets · 50 nested entries sampled/);
    assert.match(await region.innerText(),/Preview: previous day \(Central Time\)/);assert.match(await region.innerText(),/after Oct 8, 2026/);
    assert.match(await region.innerText(),/They do not prove total-window coverage/);assert.doesNotMatch(await region.innerText(),/Operational field evidence is unavailable/);
    assert.equal(await region.evaluate(element=>element.scrollWidth<=element.clientWidth),true,'sample-limit view must not overflow');
    assert.deepEqual((await page.evaluate(()=>window.fixtureCalls)).at(-1),{path:'/api/mhelpdesk/partner/tickets/preview',body:{evidence:'operational_structure_v1',day:'previous'}});
    await page.evaluate(value=>{window.fixtureValue=value;},ticketPreviewEvidenceFixture({ticketCount:0}));await button.click();await region.getByRole('status').waitFor();
    assert.match(await region.innerText(),/0 tickets/);assert.match(await region.innerText(),/The empty sample provides no operational field evidence/);
    assert.equal(await region.getByText('No nested entries were available to inspect in this sample.',{exact:true}).count(),2);
    assert.match(await region.innerText(),/No observations/);assert.match(await region.innerText(),/No string observations/);
    await page.evaluate(value=>{window.fixtureValue=value;window.fixtureValue.operationalEvidence.collections.customFields.fields.fieldValue.raw='synthetic private secret@example.test';},ticketPreviewEvidenceFixture());
    await previous.click();await region.getByRole('alert').waitFor();assert.equal(await region.getByRole('table').count(),0);assert.equal(await region.getByRole('status').count(),0);assert.doesNotMatch(await region.innerText(),/synthetic private|secret@example/);
    await page.evaluate(value=>{window.fixtureValue=value;},ticketPreviewEvidenceFixture());await button.click();await region.getByRole('status').waitFor();
    assert.equal((await page.evaluate(()=>window.fixtureCalls)).length,11);assert.match(await region.innerText(),/3 tickets sampled/);
    assert.deepEqual(network,[]);assert.deepEqual(errors,[]);
    summary.push({width,passed:true,checks:['explicit read','fixed read-only evidence capability on both days','shared duplicate click guard','today and previous-day Central windows','aggregate type IDs and gaps','status dictionary hierarchy and counts','bounded ticket and nested evidence','empty sample','legacy evidence unavailable','malformed nested value redaction','no overflow','invalid-result clearing','read-only transport error','click-only retry','new returned window','denied Owner session','late response after unmount','no network requests','no browser errors']});
    await page.close();
  }
  await writeFile(path.join(artifacts,'results.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify({passed:true,artifacts,viewports:summary},null,2));
}finally{await browser.close();}
