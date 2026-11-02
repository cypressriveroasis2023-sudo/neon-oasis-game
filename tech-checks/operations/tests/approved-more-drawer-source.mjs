import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const originalBlob='eab5e2dbf42f1085128cec573a2bee4b0a0beca4';
export const correctedSHA256='7757d25852fece2b1f4d16649695c69f7acd74f938cb264b1a07fb532c7abb18';
export const addition=`
/* The phone More drawer contains secondary tools, not a duplicate primary menu. */
@media (max-width:700px) {
  #root#root .operations-shell.cos-approved-shell > .operations-sidebar-open > .operations-area-nav {
    display:none !important;
  }
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
