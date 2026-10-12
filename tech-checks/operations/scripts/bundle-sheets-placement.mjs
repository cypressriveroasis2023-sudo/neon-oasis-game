/** Reproducible single-file Edge upload from repository code; never reads credentials. */
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const output=process.argv[2];
if(!output)throw Error('Supply a local output JSON path');
const result=await build({entryPoints:[fileURLToPath(new URL('../../supabase/functions/cos-sheets-placement-publish/serve.ts',import.meta.url))],bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['jose'],write:false,logLevel:'silent'});
const content=result.outputFiles[0].text.replace('from "jose"','from "npm:jose@6.2.12"');
await writeFile(output,JSON.stringify({name:'index.ts',content}));
process.stdout.write(JSON.stringify({file:output,sha256:createHash('sha256').update(content).digest('hex'),bytes:Buffer.byteLength(content)})+'\n');
