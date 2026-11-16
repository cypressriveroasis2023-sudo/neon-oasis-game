import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const originalBlob='eab5e2dbf42f1085128cec573a2bee4b0a0beca4';
export const correctedSHA256='dd5f2676599d1aa8e179dad763438d84cbf9303b7dcaebf9ad6a59a668159db0';
export const addition=`
/* The phone More drawer contains secondary tools, not a duplicate primary menu. */
@media (max-width:700px) {
  #root .operations-shell.cos-approved-shell > .operations-sidebar.operations-sidebar-open > .operations-area-nav {
    display:none !important;
  }
}

/* The approved panels follow the COS look: dark surfaces, red actions. A white
   card on a black phone screen reads as a different application. The ink
   variables are redefined here so every descendant inherits readable text,
   rather than only the elements named below. */
#root .operations-shell.cos-approved-shell {
  --approved-ink: #E6EDF7;
  --approved-muted: #A3B3CA;
}
#root .operations-shell.cos-approved-shell .cos-approved-checks,
#root .operations-shell.cos-approved-shell .cos-approved-tool-group {
  background:#111B2A !important;
  border-color:#2C3B51 !important;
  color:var(--approved-ink) !important;
}
#root .operations-shell.cos-approved-shell .operations-tool-grid > button {
  background:#172337 !important;
  border-color:#2C3B51 !important;
  color:#E6EDF7 !important;
}
#root .operations-shell.cos-approved-shell .operations-tool-grid > button:not(.secondary) {
  background:#C8102E !important;
  border-color:#FF8A93 !important;
}
#root .operations-shell.cos-approved-shell .operations-tool-grid > button :is(b,span) {
  color:#E6EDF7 !important;
}
#root .operations-shell.cos-approved-shell .operations-tool-grid > button:not(.secondary) :is(b,span) {
  color:#FFFFFF !important;
}
`;
const blob=text=>createHash('sha1').update('blob '+Buffer.byteLength(text)+'\0').update(text).digest('hex');
export function verify(text){
 if(!text.endsWith(addition)||blob(text.slice(0,-addition.length))!==originalBlob)throw Error('Unreviewed navigation CSS change');
 if(createHash('sha256').update(text).digest('hex')!==correctedSHA256)throw Error('Corrected CSS mismatch');
}
if(process.argv[2]){
 const mode=process.argv[2],path=new URL('../src/approvedCosNavigation.css',import.meta.url),text=readFileSync(path,'utf8');
 if(mode==='apply'){if(blob(text)!==originalBlob)throw Error('Original CSS changed');verify(text+addition);writeFileSync(path,text+addition);}
 else if(mode==='check')verify(text);else throw Error('Use apply or check');
 console.log(mode+': duplicate phone menu fix verified; original CSS otherwise exact');
}
