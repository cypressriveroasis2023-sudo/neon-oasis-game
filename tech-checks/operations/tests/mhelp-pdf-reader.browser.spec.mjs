import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syntheticTicketPdf } from './fixtures/mhelpSyntheticPdf.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bundle=await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import Drop from'./MhelpTicketDropZone';import{sampleVerifiedMhelpParsers}from'./mhelpPdfParser';function Test(){const[result,setResult]=useState(null);return <><Drop parsers={sampleVerifiedMhelpParsers} onExtracted={setResult}/>{result&&<><output aria-label="Work order">{result.extraction.sourceTicketId.value}</output><pre aria-label="Extracted data">{JSON.stringify(result.extraction,null,2)}</pre></>}</>}createRoot(document.getElementById('root')).render(<Test/>);`,resolveDir:root+'/src',loader:'tsx'},bundle:true,write:false,format:'esm',outfile:'reader.js',define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'fixture-worker-url',setup(build){build.onResolve({filter:/pdf\.worker\.min\.mjs\?url$/},()=>({path:'pdf-worker-url',namespace:'fixture-worker'}));build.onLoad({filter:/.*/,namespace:'fixture-worker'},()=>({contents:'export default "/mhelp-pdf-worker.mjs";',loader:'js'}));}}]});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const css=bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
const worker=fs.readFileSync(root+'/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs','utf8');
test.beforeEach(async({page})=>{
  await page.route('**/*',route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname==='/mhelp-pdf-test')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere}${css}</style><div id="root"></div><script type="module" src="/reader.js"></script>`});
    if(pathname==='/reader.js')return route.fulfill({contentType:'application/javascript',body:js});
    if(pathname==='/mhelp-pdf-worker.mjs')return route.fulfill({contentType:'application/javascript',body:worker});
    return route.abort();
  });
});
test('real bundled PDF reader extracts synthetic two-page export without network upload',async({page})=>{
  const writes=[];page.on('request',request=>{if(request.method()!=='GET')writes.push(request.url());});
  await page.goto('/mhelp-pdf-test');
  await page.locator('input[type=file]').setInputFiles({name:'Ticket123456_999.pdf',mimeType:'application/pdf',buffer:syntheticTicketPdf()});
  await expect(page.getByLabel('Work order')).toHaveText('009001');
  const result=JSON.parse(await page.getByLabel('Extracted data').textContent());
  expect(result.customer.value).toBe('Fixture Builders');expect(result.site.value).toBe('Fixture Site');
  expect(result.address.value).toBe('300 Service Road, Example, TX 77001');
  expect(result.lineItems).toHaveLength(3);expect(result.units).toEqual([]);
  expect(result.documentText).toContain('Added by: Fixture Dispatcher');
  expect(result.contact.value).toContain('Do not add Excluded Person');
  expect(writes).toEqual([]);
});
test('PDF MIME with non-PDF bytes fails and retains the original',async({page})=>{
  await page.goto('/mhelp-pdf-test');
  await page.locator('input[type=file]').setInputFiles({name:'invalid.pdf',mimeType:'application/pdf',buffer:Buffer.from('not a PDF')});
  await expect(page.getByRole('alert')).toHaveText('The file is not a readable PDF. The original is retained.');
  await expect(page.getByLabel('Work order')).toHaveCount(0);
});
