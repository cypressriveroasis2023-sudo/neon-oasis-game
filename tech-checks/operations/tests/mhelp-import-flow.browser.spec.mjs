import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syntheticTicketPdf } from './fixtures/mhelpSyntheticPdf.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ids={customer:'10000000-0000-4000-8000-000000000001',other:'10000000-0000-4000-8000-000000000002',site:'20000000-0000-4000-8000-000000000001',otherSite:'20000000-0000-4000-8000-000000000002',org:'30000000-0000-4000-8000-000000000001',attachment:'40000000-0000-4000-8000-000000000001',job:'50000000-0000-4000-8000-000000000001'};
const bundle=await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import Panel from'./MhelpTicketImport';function Test(){const[visible,setVisible]=useState(true);return <div id="root-shell" className="operations-shell"><button onClick={()=>setVisible(!visible)}>Navigate elsewhere</button>{visible&&<Panel show={message=>{window.__notice=message}} openJob={id=>{window.__openedJob=id}}/>}</div>}createRoot(document.getElementById('root')).render(<Test/>);`,resolveDir:root+'/src',loader:'tsx'},bundle:true,write:false,format:'esm',outfile:'flow.js',define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'fixture-api-worker',setup(build){build.onResolve({filter:/pdf\.worker\.min\.mjs\?url$/},()=>({path:'pdf-worker-url',namespace:'fixture-worker'}));build.onLoad({filter:/.*/,namespace:'fixture-worker'},()=>({contents:'export default "/mhelp-pdf-worker.mjs";',loader:'js'}));build.onResolve({filter:/^\.\/api$/},()=>({path:'fixture-api',namespace:'fixture-api'}));build.onLoad({filter:/.*/,namespace:'fixture-api'},()=>({contents:'import {api as sessionApi} from '+JSON.stringify(root+'/src/api.ts')+';export const api={captureSession:sessionApi.captureSession,get:async path=>({data:await window.__api(path,"GET")}),post:async(path,body)=>({data:await window.__api(path,"POST",body)})};',loader:'js',resolveDir:root+'/src'}));}}]});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const css=bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
const worker=fs.readFileSync(root+'/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs','utf8');
test.beforeEach(async({page})=>{
  await page.addInitScript(({ids})=>{
    window.__mode='success';window.__requests=[];window.__attachment=null;window.__saved=null;window.__source=null;window.__bytes='';
    window.__api=async(path,method,body)=>{
      window.__requests.push({path,method,body});
      if(path==='/api/customers')return{items:[{id:ids.customer,name:'Fixture Builders',status:'active'},{id:ids.other,name:'Different Customer',status:'active'}]};
      if(path==='/api/sites')return{items:[{id:ids.site,customerId:ids.customer,name:'Fixture Site',addressLine1:'300 Service Road',city:'Example',stateRegion:'TX',postalCode:'77001',status:'active'},{id:ids.otherSite,customerId:ids.other,name:'Wrong customer site',status:'active'}]};
      if(path==='/api/mhelpdesk/imports/stage'){
        window.__source=body.source;window.__bytes=body.bytesBase64;
        window.__attachment={id:ids.attachment,organizationId:ids.org,sha256:body.source.sha256,byteLength:body.source.byteLength,state:'staged',recoverable:true,attemptId:body.attemptId,source:structuredClone(body.source)};
        if(window.__mode==='stage-timeout')throw new Error('Synthetic upload timeout');
        return structuredClone(window.__attachment);
      }
      if(path==='/api/mhelpdesk/imports/commit'){
        if(['duplicate','duplicate-timeout'].includes(window.__mode)){window.__attachment.jobId=ids.job;window.__attachment.disposition='duplicate';if(window.__mode==='duplicate-timeout')throw new Error('Synthetic duplicate response lost');return{jobId:ids.job,disposition:'duplicate'};}
        window.__saved={jobId:ids.job,organizationId:ids.org,attachmentId:ids.attachment,status:'saved',ticket:structuredClone(body.ticket)};
        window.__attachment.jobId=ids.job;
        if(window.__mode==='commit-timeout')throw new Error('Synthetic save timeout');
        return{jobId:ids.job,disposition:'created'};
      }
      if(path==='/api/mhelpdesk/imports/jobs/'+ids.job){
        const result=structuredClone(window.__saved);
        if(window.__mode==='readback-mismatch')result.ticket.contactInstructions='';
        return result;
      }
      if(path.endsWith('/trash')){
        if(window.__mode==='trash-timeout')throw new Error('Synthetic trash timeout');
        window.__attachment.state='trash';return structuredClone(window.__attachment);
      }
      if(path.endsWith('/restore')){window.__attachment.state='staged';return structuredClone(window.__attachment);}
      if(path.endsWith('/download'))return{filename:window.__source.filename,mimeType:'application/pdf',sha256:window.__source.sha256,bytesBase64:window.__bytes};
      if(path.includes('/attempt/'))return structuredClone(window.__attachment);
      if(path==='/api/mhelpdesk/imports/attachments/'+ids.attachment)return structuredClone(window.__attachment);
      if(path==='/api/mhelpdesk/imports')return{complete:true,items:window.__attachment?[{...window.__attachment,filename:window.__source.filename,sourceTicketId:window.__source.sourceTicketId,createdAt:'2026-01-01T00:00:00Z'}]:[]};
      throw new Error('Unexpected fixture route: '+path);
    };
  },{ids});
  await page.route('**/*',route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname==='/mhelp-flow-test')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:16px;background:#10212b;color:#eef7ff;font:14px sans-serif}button,input,select,textarea{font:inherit}button{min-height:44px}label{display:block;margin:14px 0}input,select,textarea{max-width:100%;width:100%}input[type=checkbox]{width:auto}.quote-detail-grid{display:grid;gap:10px}.purchase-actions{display:flex;flex-wrap:wrap;gap:8px}.quote-card{padding:12px}.panelhead,.quote-section-head{display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px}${css}</style><div id="root"></div><script type="module" src="/flow.js"></script>`});
    if(pathname==='/flow.js')return route.fulfill({contentType:'application/javascript',body:js});
    if(pathname==='/mhelp-pdf-worker.mjs')return route.fulfill({contentType:'application/javascript',body:worker});
    return route.abort();
  });
});
async function loadDraft(page){
  await page.goto('/mhelp-flow-test');
  await page.locator('input[type=file]').setInputFiles({name:'Ticket123456_999.pdf',mimeType:'application/pdf',buffer:syntheticTicketPdf()});
  await expect(page.getByRole('heading',{name:'Review Work Order 009001'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Fixture Builders',exact:true})).toBeEnabled();
}
async function reviewDraft(page){
  await page.getByRole('button',{name:'Fixture Builders',exact:true}).click();
  await page.getByLabel('Existing service site').selectOption(ids.site);
  await page.getByRole('checkbox',{name:/I checked the source information/}).check();
}
const writes=page=>page.evaluate(()=>window.__requests.filter(row=>row.method==='POST'));

test('ticket import does not call customers, sites or import routes',async({page})=>{
 await page.goto('/mhelp-flow-test');
 await page.locator('input[type=file]').setInputFiles({name:'Ticket123456_999.pdf',mimeType:'application/pdf',buffer:syntheticTicketPdf()});
 await expect(page.getByRole('alert')).toContainText('not available');
 expect(await page.evaluate(()=>window.__requests)).toEqual([]);
 expect(await writes(page)).toEqual([]);
});
