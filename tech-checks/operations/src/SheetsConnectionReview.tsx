import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import {trackerWorkbookId} from './unitTracker';
import {checkedSheetsConnection,type SheetsConnection} from './sheetsConnectionModel';

export default function SheetsConnectionReview({canCheck,queueEnabled}:{canCheck:boolean;queueEnabled:boolean}){
 const [connection,setStatus]=useState<SheetsConnection|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const active=useRef(true),running=useRef(false),epoch=useRef(0);
 const status=canCheck?connection:null;
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useEffect(()=>{epoch.current++;setStatus(null);setError('');},[canCheck]);
 const check=async()=>{
  if(running.current||!canCheck)return;running.current=true;setBusy(true);setError('');setStatus(null);
  const generation=epoch.current,valid=()=>active.current&&epoch.current===generation;
  try{
   const configured=checkedSheetsConnection((await api.get('/api/unit-tracker/sheets/status')).data);
   if(valid())setStatus(configured);
   if(valid()&&configured.credentialConfigured){const verified=checkedSheetsConnection((await api.post('/api/unit-tracker/sheets/check',{})).data);if(valid())setStatus(verified);}
  }catch(cause){if(valid())setError(cause instanceof Error?cause.message:'The Sheets connection could not be checked.');}
  finally{running.current=false;if(active.current)setBusy(false);}
 };
 const verified=status?.readAccessVerified===true;
 return <section className='unit-tracker-connection' aria-label='Sheets connection status'>
  <strong>{verified?'Google Sheets read access verified':'Sheets connection required'}</strong>
  <p>{verified?`The 2027 tracker is accessible: ${status.equipmentRows} equipment rows across ${status.tabs.length} equipment tabs. Publishing changes and automatic fleet updates are still pending.`:queueEnabled?'New units and tracker changes can be saved as pending requests in COS. They have not been sent to Google Sheets or applied to Camera Health or Field View.':'Saving pending additions and tracker changes is not enabled on this backend yet. Existing COS records remain available below.'}</p>
  <div className='unit-tracker-actions'>{canCheck&&<button className='secondary' disabled={busy} onClick={()=>void check()}>{busy?'Checking Sheets…':'Check Sheets connection'}</button>}<a href={'https://docs.google.com/spreadsheets/d/'+trackerWorkbookId+'/edit'} target='_blank' rel='noopener noreferrer'>Open 2027 tracker ↗</a></div>
  {status?.state==='setup_required'&&<p role='status'>Google authorization is needed for COS. Add the service-account JSON in the protected server settings, then share this tracker with that account as Viewer. <a href='https://github.com/cypressriveroasis2023-sudo/neon-oasis-game/blob/main/docs/google-sheets-connection.md' target='_blank' rel='noopener noreferrer'>Connection setup ↗</a></p>}
  {status?.serviceAccountEmail&&<p>Tracker sharing account: <strong>{status.serviceAccountEmail}</strong></p>}
  {verified&&<><p>Checked {new Date(status.checkedAt!).toLocaleString()}. {status.duplicateLabelRows+status.formulaRows+status.placementReviewRows>0?'Some labels, formulas, or placements need review before synchronization.':'The identity and placement headers match the expected tracker layout.'}</p><details><summary>Equipment tabs checked</summary><ul>{status.tabs.map(t=><li key={t.tabId}>{t.title}: {t.equipmentRows} equipment rows</li>)}</ul></details></>}
  {canCheck&&error&&<p role='alert'>{error}</p>}
 </section>;
}
