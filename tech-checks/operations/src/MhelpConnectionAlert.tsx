type Props={value:unknown;canReconnect:boolean;onReconnect:()=>void};
const row=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;

/** Only the current persisted rejected-grant evidence warrants reconnect. */
export default function MhelpConnectionAlert({value,canReconnect,onReconnect}:Props){
 const sync=row(value);
 if(sync?.contract!=='COS_MHELP_PLACEMENT_V1')return null;
 const status=row(sync.reliability);
 const valid=status?.contract==='COS_MHELP_RELIABILITY_STATUS_V1';
 const auth=valid?row(status.auth):null,inventory=valid?row(status.inventory):null;
 if(auth?.state==='reconnect_required')return <section className='cos-fleet-message cos-mhelp-connection-alert' role='alert' aria-label='mHelpDesk connection needs attention'>
  <strong>Reconnect mHelpDesk</strong><p>mHelpDesk rejected the saved authorization. Showing saved inventory; camera health is separate.</p>
  {canReconnect?<button type='button' className='secondary' onClick={onReconnect}>Reconnect mHelpDesk</button>:<p>Ask a COS Owner to reconnect mHelpDesk.</p>}
 </section>;
 if(inventory?.paused===true)return <section className='cos-fleet-message' role='status' aria-label='mHelpDesk updates paused'><strong>mHelpDesk updates paused</strong><p>Showing saved inventory; camera health is separate.</p></section>;
 const failed=typeof sync.errorCode==='string'&&!!sync.errorCode;
 const retry=typeof inventory?.nextEligibleAt==='string'&&Number.isFinite(Date.parse(inventory.nextEligibleAt))?inventory.nextEligibleAt:null;
 if(!failed&&!retry)return null;
 return <section className='cos-fleet-message' role='status' aria-label='mHelpDesk update delayed'><strong>mHelpDesk update delayed</strong>
  <p>{retry?<>Waiting for mHelpDesk. Automatic retry is eligible at <time dateTime={retry}>{new Date(retry).toLocaleString()}</time>.</>:sync.errorCode==='source_rate_limited'?'mHelpDesk is limiting requests. COS will retry automatically.':'Automatic inventory updates could not finish. Showing saved inventory; camera health is separate.'}</p>
 </section>;
}
