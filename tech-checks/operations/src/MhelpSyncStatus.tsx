import {useEffect,useState} from 'react';
import {mhelpSyncStatus} from './mhelpSyncStatus';
export default function MhelpSyncStatus({snapshot,readFailed}:{snapshot:unknown;readFailed:boolean}){
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer);},[]);
 const status=mhelpSyncStatus(snapshot,now);
 return <section className='unit-tracker-connection' aria-label='Automatic inventory status'>
  <h3>Automatic inventory updates</h3>
  <p role='status'><strong>{readFailed?'Not yet verified':status.label}</strong>{status.retryAt&&<> — retrying automatically at {new Date(status.retryAt).toLocaleString()}</>}</p>
  <dl className='unit-tracker-values'>
   <div><dt>Connection</dt><dd>{status.connection}</dd></div>
   <div><dt>Last successful inventory update</dt><dd>{status.lastSuccess?new Date(status.lastSuccess).toLocaleString():'Not yet verified'}</dd></div>
   <div><dt>Field equipment</dt><dd>{status.field??'Not yet verified'}</dd></div>
   <div><dt>Shop equipment</dt><dd>{status.shop??'Not yet verified'}</dd></div>
  </dl>
  {readFailed&&<p>The latest COS read failed. Last saved information remains below. Use Refresh tracker to check again.</p>}
  {!readFailed&&status.label==='Not yet verified'&&<p>A current automatic update has not been verified. Saved equipment remains available.</p>}
 </section>;
}
