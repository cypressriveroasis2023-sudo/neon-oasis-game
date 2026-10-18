type Props={value:unknown;canReconnect:boolean;onReconnect:()=>void};

/** A failed source read, including failed token renewal, is independent of camera health. */
export default function MhelpConnectionAlert({value,canReconnect,onReconnect}:Props){
 const sync=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
 if(sync?.contract!=='COS_MHELP_PLACEMENT_V1'||typeof sync.errorCode!=='string'||!sync.errorCode)return null;
 if(sync.errorCode==='source_rate_limited')return <section className='cos-fleet-message' role='status' aria-label='mHelpDesk update delayed'><strong>mHelpDesk update delayed</strong><p>mHelpDesk is limiting requests. COS will retry automatically.</p></section>;
 return <section className='cos-fleet-message cos-mhelp-connection-alert' role='alert' aria-label='mHelpDesk connection needs attention'>
  <strong>mHelpDesk connection needs attention</strong>
  <p>Automatic inventory updates failed. Showing saved inventory; camera health is separate.</p>
  {canReconnect?<button type='button' className='secondary' onClick={onReconnect}>Check or reconnect mHelpDesk</button>:<p>Ask a COS Owner to check or reconnect mHelpDesk.</p>}
 </section>;
}
