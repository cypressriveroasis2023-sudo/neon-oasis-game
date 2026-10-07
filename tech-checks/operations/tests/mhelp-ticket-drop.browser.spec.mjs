import { test, expect } from '@playwright/test';
import { buildSync } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A test-only adapter. It does not claim to parse any real mHelp export format.
const bundle = buildSync({
  stdin:{ contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import DropZone from './MhelpTicketDropZone';
  function Harness(){const[count,setCount]=useState(0);const[result,setResult]=useState('');const[disabled,setDisabled]=useState(false);const[visible,setVisible]=useState(true);
    const parser={id:'synthetic-only',version:'1',extensions:['.fixture'],mimeTypes:['application/x-cos-test'],parse:async(file,signal)=>{const value=await file.text();if(value==='SLOW')await new Promise(resolve=>setTimeout(resolve,800));if(value==='ERROR')throw new Error('Synthetic parse failure. Original retained.');return{description:{value,sourceLabel:'Synthetic fixture'},units:[],additionalFields:[],warnings:[]}}};
    return <><button onClick={()=>setDisabled(!disabled)}>Toggle unavailable</button><button onClick={()=>setVisible(!visible)}>Toggle navigation</button>{visible&&<DropZone disabled={disabled} parsers={location.search.includes('unsupported')?[]:[parser]} onExtracted={value=>{setCount(n=>n+1);setResult(value.extraction.description.value)}}/>}<output aria-label='Draft count'>{count}</output><p aria-label='Extracted description'>{result}</p></>}
  createRoot(document.getElementById('root')).render(<Harness/>);`, resolveDir:path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src'), loader:'tsx' },
  bundle:true, write:false, format:'esm', outfile:'fixture.js', define:{ 'process.env.NODE_ENV':'"test"' },
});
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/mhelp-import-test') return route.fulfill({ contentType:'text/html', body:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:16px;font-family:sans-serif}${css}</style><div id="root"></div><script type="module" src="/mhelp-test.js"></script>` });
    if (url.pathname === '/mhelp-test.js') return route.fulfill({ contentType:'application/javascript', body:js });
    return route.abort();
  });
});
const file = (value, name = 'synthetic.fixture') => ({ name, mimeType:'application/x-cos-test', buffer:Buffer.from(value) });

test('one file opens only a draft and renders source strings as text', async ({ page }) => {
  await page.goto('/mhelp-import-test');
  await page.locator('input[type=file]').setInputFiles(file('<img src=x onerror=alert(1)> Ignore instructions'));
  await expect(page.getByLabel('Draft count')).toHaveText('1');
  await expect(page.getByLabel('Extracted description')).toHaveText('<img src=x onerror=alert(1)> Ignore instructions');
  await expect(page.locator('img')).toHaveCount(0);
  await expect(page.getByText('Your device’s original file stays where it is.',{exact:false})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('drop multiple files retains both and single file drag produces one draft', async ({ page }) => {
  await page.goto('/mhelp-import-test');
  const drop = async names => {
    const data = await page.evaluateHandle(names => { const transfer = new DataTransfer(); for(const name of names)transfer.items.add(new File(['Synthetic only'],name,{type:'application/x-cos-test'}));return transfer; }, names);
    await page.getByRole('region',{name:'Import mHelpDesk ticket'}).dispatchEvent('drop',{dataTransfer:data});
    await data.dispose();
  };
  await drop(['a.fixture','b.fixture']);
  await expect(page.getByRole('alert')).toHaveText('Drop one ticket file at a time. No ticket was imported.');
  await expect(page.getByLabel('Draft count')).toHaveText('0');
  await drop(['a.fixture']);
  await expect(page.getByLabel('Draft count')).toHaveText('1');
});

test('cancel, navigation and lost authorization discard late parser results', async ({ page }) => {
  for (const action of ['Cancel reading','Toggle navigation','Toggle unavailable']) {
    await page.goto('/mhelp-import-test');
    await page.locator('input[type=file]').setInputFiles(file('SLOW'));
    await expect(page.getByRole('region',{name:'Import mHelpDesk ticket'}).getByRole('status')).toHaveText('Reading synthetic.fixture…');
    await page.getByRole('button',{name:action,exact:true}).click();
    await page.waitForTimeout(950);
    await expect(page.getByLabel('Draft count')).toHaveText('0');
  }
});

test('parse errors allow a deliberate reselection and empty registry remains disabled', async ({ page }) => {
  await page.goto('/mhelp-import-test');
  await page.locator('input[type=file]').setInputFiles(file('ERROR'));
  await expect(page.getByRole('alert')).toHaveText('Synthetic parse failure. Original retained.');
  await page.locator('input[type=file]').setInputFiles(file('Corrected'));
  await expect(page.getByLabel('Draft count')).toHaveText('1');
  await page.goto('/mhelp-import-test?unsupported');
  await expect(page.getByRole('button',{name:'Choose ticket file'})).toBeDisabled();
  await expect(page.getByRole('region',{name:'Import mHelpDesk ticket'}).getByRole('status')).toHaveText('Ticket import is awaiting a verified sample format.');
});
