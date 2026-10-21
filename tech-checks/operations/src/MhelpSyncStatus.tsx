import {useEffect,useState} from 'react';
import {mhelpSyncStatus} from './mhelpSyncStatus';
export default function MhelpSyncStatus({snapshot,readFailed,canReconnect=false,onReconnect}:{snapshot:unknown;readFailed:boolean;canReconnect?:boolean;onReconnect?:()=>void}){
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer);},[]);
 const status=mhelpSyncStatus(snapshot,now);
 return <section className='unit-tracker-connection' aria-label='Automatic inventory status'>
  <h3>Automatic inventory updates</h3>
  <p role='status'><strong>{readFailed?'Not yet verified':status.label}</strong></p>
  {status.retryAt&&!readFailed&&<p>Automatic retry is eligible at <time dateTime={status.retryAt}>{new Date(status.retryAt).toLocaleString()}</time>. A successful update has not yet been confirmed.</p>}
  <dl className='unit-tracker-values'>
   <div><dt>Connection</dt><dd>{status.connection}</dd></div>
   <div><dt>Last successful inventory update</dt><dd>{status.lastSuccess?<time dateTime={status.lastSuccess}>{new Date(status.lastSuccess).toLocaleString()}</time>:'Not yet verified'}</dd></div>
   <div><dt>Field equipment</dt><dd>{status.field??'Not yet verified'}</dd></div>
   <div><dt>Shop equipment</dt><dd>{status.shop??'Not yet verified'}</dd></div>
   <div><dt>Inventory records needing review</dt><dd>{status.exceptions??'Not yet verified'}</dd></div>
  </dl>
  {status.renewalCheckFailed&&!status.reconnectRequired&&<p role='alert'>The automatic renewal check could not finish. COS will retry; this does not require replacement credentials unless mHelpDesk rejects the authorization.</p>}
  {status.paused&&<p>Automatic mHelpDesk inventory reads are paused. Saved COS data and camera health remain available.</p>}
  {status.reconnectRequired&&(canReconnect&&onReconnect?<button type='button' className='secondary' onClick={onReconnect}>Open secure reconnect</button>:<p>Ask a COS Owner to reconnect mHelpDesk.</p>)}
  {readFailed&&<p>The latest COS read failed. Last saved information remains below. Use Refresh tracker to check again.</p>}
  {!readFailed&&status.label==='Not yet verified'&&<p>A current automatic update has not been verified. Saved equipment remains available.</p>}
 </section>;
}
