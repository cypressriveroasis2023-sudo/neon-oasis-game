import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

// Live cos-mhelp-inventory-sync v31, archive 7a213eff89804ee4…, read 2026-11-17.
// Every served file must match that archive. index.ts may differ only by the
// reviewed #408 partnerPreviewDiagnostic addition.
const root=new URL('../../supabase/functions/',import.meta.url);
const sha256=text=>createHash('sha256').update(text).digest('hex');
const read=name=>readFileSync(new URL(name,root),'utf8');
const LIVE={
 'cos-mhelp-inventory-sync/serve.ts':'ca9b89f2bc10ae2ffdd6db6b165c6cf375a9182388e53c26c3876a0c2da0feab',
 'cos-mhelp-inventory-sync/index.ts':'1e61774ef9637d0b0c462fd27996f7a47ced7ae8e3d85785ae27af83740706f2',
 'cos-mhelp-inventory-sync/manualRefresh.ts':'34e629791b887a1f949c60449fb7b7a9e1fef2e8b2e55a6771317c4ef838c94e',
 'cos-mhelp-inventory-sync/cache.ts':'a770edbdc01e12a1cfaf4e6fa599298fb74cc8e39af0f8fbca01f487398079dd',
 'cos-mhelp-inventory-sync/source.ts':'de69dcd13829e98e8b98122651e2fbdddc8d8f4a523605a5f036ec06cbe03864',
 'cos-mhelp-inventory-sync/handoff.ts':'186e7a5abc4a8654826e0600334a0de7496fef8617f37db6e913c589333c5f7b',
 'cos-operations-pages/mhelpPartner.ts':'5dda34e4fb654b6348a7afe846bcda48539b8872968ee642fd9014ed44c006aa',
 'cos-operations-pages/mhelpAccessRetry.ts':'d85ba7d817cd4c667ff16cfa2b2638b606d903ad647da8986ceee72c75e0f069',
 'cos-operations-pages/mhelpTokenRuntime.ts':'57b48e3ee6f041ffb523634658e0b394e09ac97dfe8922b1ef93f1382a993d07',
 'cos-operations-pages/mhelpTokenSession.ts':'4ebdaaaf50ef4ff215dd40f1c92c9652f2b7b654f9b5ab9bd79c96d25503811e',
 'cos-operations-pages/mhelpReconnect.ts':'43a71973894e16be5d4dc5b5d9956f20ad6d70dfbd600fe28b67b0131d038c63',
 'cos-operations-pages/mhelpReadBackoff.ts':'71d85b0526fc29f1c1fdc3d4f366a183465621108235a34d25b4e16842ec25c7',
 'cos-operations-pages/mhelpRequestBudget.ts':'90554b70f20db32bb083abe19e28e6eb547b9567a19d61659d14ed49ef6dc7bc',
};
const ADDITION=`/** Closed partner-preview facts only. Never the message, URL, body, or token. */
export function partnerPreviewDiagnostic(cause:unknown):{providerOperation:'account_read'|'equipment_read';httpStatus:number}|undefined{
 if(!(cause instanceof MhelpPartnerError)||cause instanceof MhelpPartnerReadDeadlineError)return;
 const operation=cause.provider?.operation,httpStatus=cause.provider?.httpStatus;
 if(operation!=='account_read'&&operation!=='equipment_read')return;
 if(!Number.isInteger(httpStatus)||httpStatus<100||httpStatus>599)return;
 return {providerOperation:operation,httpStatus};
}
`;
const SPREAD='...partnerPreviewDiagnostic(cause),';

test('inventory repo matches live v31 except the #408 diagnostic',()=>{
 const index=read('cos-mhelp-inventory-sync/index.ts');
 assert.equal(index.split(ADDITION).length-1,1);
 assert.equal(index.split(SPREAD).length-1,1);
 const restored=index.replace(ADDITION,'').replace(SPREAD,'');
 assert.equal(sha256(restored),LIVE['cos-mhelp-inventory-sync/index.ts']);
 assert.equal(restored.includes('partnerPreviewDiagnostic'),false);
 for(const [name,hash] of Object.entries(LIVE)){
  if(name.endsWith('/index.ts'))continue;
  assert.equal(sha256(read(name)),hash,name);
 }
});
