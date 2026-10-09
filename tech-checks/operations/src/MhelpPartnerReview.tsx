import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {checkedPartnerPreview,checkedPartnerStatus,type PartnerPreview,type PartnerStatus} from './mhelpPartnerModel';

export default function MhelpPartnerReview({openMap,openHealth}:{openMap:(id:string)=>void;openHealth:(id:string)=>void}) {
  const [status,setStatus] = useState<PartnerStatus|null>(null), [preview,setPreview] = useState<PartnerPreview|null>(null);
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [name,setName] = useState('');
  const active = useRef(true), pending = useRef(false);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const run = async (readEquipment:boolean) => {
    if (pending.current) return;
    pending.current=true; setBusy(true); setError(''); setPreview(null);
    try {
      if (readEquipment) {
        const data = checkedPartnerPreview((await api.post('/api/mhelpdesk/partner/preview',name.trim()?{name:name.trim()}:{})).data);
        if (active.current) {setStatus(data);setPreview(data);}
      } else {
        const data = checkedPartnerStatus((await api.get('/api/mhelpdesk/partner/status')).data);
        if(active.current)setStatus(data);
      }
    } catch(cause) {if(active.current){setStatus(null);setError(cause instanceof Error?cause.message:'The mHelpDesk connection could not be verified.');}}
    finally {pending.current=false;if(active.current)setBusy(false);}
  };
  return <section className='unit-tracker-connection mhelp-partner-review' aria-label='mHelpDesk Partner API review'>
    <h3>mHelpDesk connection</h3>
    <p>Review equipment from mHelpDesk alongside COS. Previewing reads equipment only; applying changes to the tracker, Camera Health, and Field View still requires verified equipment links and source review.</p>
    <div className='unit-tracker-actions'><button className='secondary' disabled={busy} onClick={()=>void run(false)}>{busy?'Checking mHelpDesk…':'Check mHelpDesk connection'}</button><a href='https://www.mhelpdesk.com/partner-api/index.html' target='_blank' rel='noopener noreferrer'>Partner API documentation ↗</a></div>
    {error&&<p className='operations-error' role='alert'>{error}</p>}
    {status?.state==='setup_required'&&!status.tokenConfigured&&<p role='status'>Connection setup required. In Supabase, open Tech Check Platform → Edge Functions → Secrets and save your access token as COS_MHELP_ACCESS_TOKEN. The equipment preview can then look up your company portal ID. Automatic sync is paused.</p>}
    {status?.tokenConfigured&&<><p role='status'>{status.liveAccessVerified?'API equipment read verified.':status.portalConfigured?'Server configuration is present. Test an equipment read to verify API access.':'Server token is present. Preview equipment to look up and verify your company portal ID automatically.'} Automatic sync is paused.</p>{status.verifiedPortalId&&<p>Verified mHelpDesk portal ID: <strong>{status.verifiedPortalId}</strong>. {status.portalConfigured?'The saved portal ID matches this account.':'The server resolves this ID securely from your token; you do not need to add another secret.'}</p>}<label>Full mHelpDesk equipment label (optional)<input value={name} maxLength={180} disabled={busy} onChange={event=>setName(event.target.value)} placeholder='Example: Sniper 2 023.1'/></label><button className='secondary' disabled={busy} onClick={()=>void run(true)}>Preview mHelpDesk equipment</button></>}
    {preview&&<><p>Read {new Date(preview.readAt).toLocaleString()}. Showing {preview.items.length} of {preview.totalRows} equipment records{preview.partial?' · This is the first page; additional records have not been read.':''}.</p><p>Equipment “Active” is an administrative flag. Camera, router, and battery connectivity continue to come from their own providers. Addresses and GPS have not changed.</p><div className='unit-tracker-table-wrap'><table className='unit-tracker-table'><thead><tr><th>Equipment / full label</th><th>mHelpDesk identity</th><th>COS link review</th></tr></thead><tbody>{preview.items.map(row=><tr key={row.equipmentId}><td>{row.name}<small>{row.model||'Model not recorded'} · {row.active===null?'Activity not recorded':row.active?'Active':'Inactive'}</small></td><td>ID {row.equipmentId}<small>Customer {row.customerId||'not recorded'} · Service location {row.serviceLocationId||'not recorded'}</small></td><td>{row.identity.state==='verified_link'?'Exact link verified':row.identity.state==='ambiguous'?'Multiple possible links':row.identity.state==='identity_changed'?'Linked identity changed':'Equipment link needs review'}{row.identity.candidateUnitIds.length>0&&row.identity.state!=='verified_link'&&<small>Full-label candidates: {row.identity.candidateUnitIds.length}. These are not confirmed links.</small>}{row.identity.nativeUnitId&&<div className='unit-tracker-actions'><button className='secondary' onClick={()=>openMap(row.identity.nativeUnitId!)}>View Field View</button><button className='secondary' onClick={()=>openHealth(row.identity.nativeUnitId!)}>View Camera Health</button></div>}</td></tr>)}</tbody></table></div>{preview.items.length===0&&<p>No equipment was returned for this preview.</p>}</>}
  </section>;
}
