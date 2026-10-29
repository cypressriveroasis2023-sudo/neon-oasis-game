import {connectionDiagnosticText} from './connectionDiagnostics';
import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {createScopePreview,type PreviewState} from './productScopePreviewModel';
export default function ProductScopePreview({productId}:{productId:string}){
 const [state,setState]=useState<PreviewState>({status:'idle'});
 const actions=useRef<ReturnType<typeof createScopePreview>|null>(null);
 useEffect(()=>{
  const action=createScopePreview(api,productId,setState);actions.current=action;setState({status:'idle'});
  const hidden=()=>{if(document.visibilityState==='hidden')action.clear();};
  const parentHidden=(e:MessageEvent)=>{if(e.source===window.parent&&e.origin===location.origin&&e.data?.type==='COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE')action.clear();};
  window.addEventListener('cos-private-data-invalidated',action.clear);window.addEventListener('pagehide',action.clear);window.addEventListener('message',parentHidden);document.addEventListener('visibilitychange',hidden);
  return ()=>{action.dispose();window.removeEventListener('cos-private-data-invalidated',action.clear);window.removeEventListener('pagehide',action.clear);window.removeEventListener('message',parentHidden);document.removeEventListener('visibilitychange',hidden);};
 },[productId]);
 const result=state.result;
 return <section aria-label={'Saved connection scope for Product '+productId}>
  <button type='button' disabled={state.status==='loading'} onClick={()=>void actions.current?.load()}>{state.status==='loading'?'Reading saved scope…':'Preview saved connection scope'}</button>
  {state.status!=='idle'&&<button type='button' onClick={()=>actions.current?.clear()}>{state.status==='loading'?'Cancel preview':'Close preview'}</button>}
  <div aria-live='polite'>
   {state.status==='error'&&<p role='alert'>{state.message} {connectionDiagnosticText(state.diagnostic)}</p>}
   {state.status==='ready'&&result&&<>
    <p>Read-only source review for Product {productId}. No camera test was run. This preview does not change connection status or authorize a check.</p>
    {result.kind==='held'?<><strong>Held — scope not eligible</strong><p>{result.reason}</p><p>{connectionDiagnosticText(result.diagnostic)}</p></>:<>
     <strong>Eligible saved scope at source review</strong>
     <p>Reviewed {result.group.verifiedAt} · {result.group.family} · Native unit {result.group.nativeUnitId}. This is a snapshot; eligibility can change.</p>
     <ul>{result.group.devices.map(d=><li key={d.id}>Saved endpoint {d.id} · {d.ip} · TCP ports {d.ports.join(', ')} · configuration revision {d.revision} · {d.profile}</li>)}</ul>
     <details><summary>Current-source scope returned by the server</summary><dl>{(['sourceSha256','trackerSha256','authorityGuard','identityGuard','bindingGuard','epochGuard','crosswalkRevision'] as const).map(k=><div key={k}><dt>{k}</dt><dd style={{overflowWrap:'anywhere'}}>{result.group[k]}</dd></div>)}</dl></details>
    </>}
   </>}
  </div>
 </section>;
}
