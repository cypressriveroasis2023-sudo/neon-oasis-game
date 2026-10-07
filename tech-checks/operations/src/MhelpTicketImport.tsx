import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import MhelpTicketDropZone from './MhelpTicketDropZone';
import { sampleVerifiedMhelpParsers } from './mhelpPdfParser';
import { suggestWorkOrderDefaults, workInstructionsForReview } from './mhelpWorkOrderPdf';
import { readTicketDirectory } from './ticketDirectoryData';
import { isTicketType, ticketTypes, type TicketType } from './ticketTypes';
import { validateReviewedImport, type ImportDirectory, type ReviewedImportTicket, type MhelpExtraction } from './mhelpImportModel';
import { createMhelpImportSaver, type StagedTicketAttachment } from './mhelpImportPersistence';
import { mhelpImportClient, type ImportHistoryRow } from './mhelpImportClient';
import './ticketActions.css';

type Draft = {file:File;attemptId:string;ticket:ReviewedImportTicket;attachment?:StagedTicketAttachment};
const extraText=(extraction:MhelpExtraction)=>[
  ...extraction.additionalFields.map(field=>field.sourceLabel+': '+field.value),
  ...(extraction.lineItems||[]).map(item=>'Item · '+item.quantity+' · '+item.itemName+(item.notes?' · '+item.notes:'')),
].join('\n');
const err=(cause:unknown)=>cause instanceof Error?cause.message:'The import could not be verified. The original file is retained.';

export default function MhelpTicketImport({show,openJob}:{show:(message:string)=>void;openJob:(id:string)=>void}) {
  const client=useRef(mhelpImportClient(api)).current;
  const [draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [customers,setCustomers]=useState<any[]>([]),[sites,setSites]=useState<any[]>([]),[query,setQuery]=useState(''),[directoryReady,setDirectoryReady]=useState(false);
  const [reviewed,setReviewed]=useState(false),[history,setHistory]=useState<ImportHistoryRow[]|null>(null),[historyOpen,setHistoryOpen]=useState(false),[historyLocked,setHistoryLocked]=useState(false);
  const [attention,setAttention]=useState(false),[saved,setSaved]=useState<{jobId:string;cleanupConfirmed:boolean;duplicate?:boolean}|null>(null);
  const mounted=useRef(true),revision=useRef(0),running=useRef(false),draftRef=useRef<Draft|null>(null);
  draftRef.current=draft;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;revision.current++;};},[]);
  const directory=async()=>{
    const [people,locations]=await Promise.all([api.get('/api/customers'),api.get('/api/sites')]);
    const result=readTicketDirectory(people.data,locations.data);
    if(mounted.current){setCustomers(result.customers);setSites(result.sites);setDirectoryReady(true);}
    return result;
  };
  const historyRead=async()=>{const rows=await client.history();if(mounted.current)setHistory(rows);return rows;};
  const loadHistory=async()=>{
    if(running.current)return;running.current=true;setBusy('history');setError('');
    try{await historyRead();setHistoryOpen(true);setHistoryLocked(false);}catch(cause){if(mounted.current)setError(err(cause));}
    finally{running.current=false;if(mounted.current)setBusy('');}
  };
  const extracted=async(value:{file:File;sha256:string;parserId:string;parserVersion:string;extraction:MhelpExtraction})=>{
    if(running.current||draftRef.current)return;
    const current=++revision.current;const extraction=value.extraction;const defaults=suggestWorkOrderDefaults(extraction);
    if(!extraction.sourceTicketId?.value){setError('The printed Work Order number could not be verified. Keep the original PDF.');return;}
    const ticket:ReviewedImportTicket={
      source:{system:'mhelpdesk',sourceTicketId:extraction.sourceTicketId.value,sha256:value.sha256,filename:value.file.name,byteLength:value.file.size,mimeType:'application/pdf',parserId:value.parserId,parserVersion:value.parserVersion},
      customerId:'',siteId:'',jobType:defaults.jobType||'' as TicketType,priority:defaults.priority||'' as ReviewedImportTicket['priority'],title:extraction.title?.value||'',
      description:workInstructionsForReview(extraction),contactInstructions:extraction.contact?.value||'',unitIds:[],requestedSchedule:'',additionalInformation:extraText(extraction),shopPrep:false,parserData:extraction,
    };
    setDraft({file:value.file,attemptId:crypto.randomUUID(),ticket});setQuery(extraction.customer?.value||'');setReviewed(false);setAttention(false);setSaved(null);setError('');setNotice('');setDirectoryReady(false);
    if(!defaults.jobType||!defaults.priority)setNotice('A source workflow or priority needs review. Choose the correct values before saving.');
    try{await directory();}catch(cause){if(mounted.current&&current===revision.current)setError(err(cause));}
  };
  const update=(key:keyof ReviewedImportTicket,value:unknown)=>{setDraft(current=>current?{...current,ticket:{...current.ticket,[key]:value}}:null);setReviewed(false);};
  const clear=()=>{revision.current++;setDraft(null);setSaved(null);setError('');setNotice('');setAttention(false);setReviewed(false);};
  const makeDirectory=(result:{customers:any[];sites:any[]}):ImportDirectory=>({complete:true,customers:result.customers.map(row=>({id:row.id,active:true})),sites:result.sites.map(row=>({id:row.id,customerId:row.customerId,active:true})),units:[]});
  const save=async()=>{
    if(!draft||running.current||!reviewed||attention||saved)return;
    running.current=true;setBusy('save');setError('');setNotice('');
    const current=draft;let touched=false;
    try{
      const fresh=await directory();validateReviewedImport(current.ticket,makeDirectory(fresh));
      if(!mounted.current)return;
      touched=true;
      const attachment=current.attachment||await client.stage(current.attemptId,current.ticket.source,current.file);
      if(!mounted.current)return;
      if(mounted.current)setDraft(previous=>previous?{...previous,attachment}:previous);
      const result=await createMhelpImportSaver(client.adapter).save({organizationId:attachment.organizationId,attachment,ticket:current.ticket,directory:makeDirectory(fresh)});
      if(!mounted.current)return;
      if(result.status==='saved_and_trashed'||result.status==='saved_file_retained'){
        setSaved({jobId:result.jobId,cleanupConfirmed:result.status==='saved_and_trashed'});setNotice(result.message);show('mHelpDesk '+current.ticket.source.sourceTicketId+' saved and verified.');window.dispatchEvent(new Event('cos-board-updated'));
      }else if(result.status==='duplicate'){
        setSaved({jobId:result.jobId,cleanupConfirmed:false,duplicate:true});setNotice('This mHelpDesk reference or file is already linked to a COS job. Open that job to review it. This imported copy is retained.');
      }else{setAttention(true);setError('message' in result?result.message:'Review import history before another save.');}
    }catch(cause){if(mounted.current){setError(err(cause));if(touched)setAttention(true);}}
    finally{running.current=false;if(mounted.current)setBusy('');}
  };
  const checkResult=async()=>{
    if(!draft||running.current)return;running.current=true;setBusy('recover');setError('');
    try{
      const attachment=await client.readAttempt(draft.attemptId);
      if(!mounted.current)return;
      if(!attachment){setAttention(false);setNotice('No staged copy was found. You may explicitly retry Save using this same import attempt.');return;}
      setDraft(current=>current?{...current,attachment}:current);
      const result=await client.recoverSaved(attachment,draft.ticket);
      if(result?.status==='duplicate'){setSaved({jobId:result.jobId,cleanupConfirmed:false,duplicate:true});setAttention(false);setNotice('This import was confirmed as a duplicate. Open the existing COS job to review it, or start another import. This source copy is retained; no new job or trash move was made.');}
      else if(result?.status==='saved'){setSaved({jobId:result.saved.jobId,cleanupConfirmed:attachment.state==='trash'});setAttention(false);setNotice('The complete saved job is verified. '+(attachment.state==='trash'?'The imported copy is in recoverable app trash.':'The imported copy is retained. You can move it to recoverable trash.'));window.dispatchEvent(new Event('cos-board-updated'));}
      else{setAttention(false);setNotice('The original is safely staged; no linked saved job was found. You may explicitly retry Save with the same staged copy.');}
    }catch(cause){if(mounted.current)setError(err(cause));}
    finally{running.current=false;if(mounted.current)setBusy('');}
  };
  const cleanup=async()=>{
    if(!draft?.attachment||!saved||saved.duplicate||running.current||attention)return;running.current=true;setBusy('trash');setError('');
    try{
      await client.adapter.moveToRecoverableTrash(draft.attachment.id,saved.jobId,draft.ticket);
      const value=await client.adapter.readAttachment(draft.attachment.id);
      if(!value||value.state!=='trash'||value.sha256!==draft.ticket.source.sha256)throw new Error('The trash move could not be confirmed. Check imports before retrying.');
      if(mounted.current){setSaved({...saved,cleanupConfirmed:true});setNotice('The imported copy is in recoverable app trash.');}
    }catch(cause){if(mounted.current){setError(err(cause));setAttention(true);}}
    finally{running.current=false;if(mounted.current)setBusy('');}
  };
  const restore=async(row:ImportHistoryRow)=>{
    if(running.current||historyLocked)return;running.current=true;setBusy('restore');setError('');setHistoryLocked(true);
    try{await client.restore(row.id);await historyRead();if(mounted.current){setNotice('The imported copy was restored. The saved COS job is unchanged.');setHistoryLocked(false);}}
    catch(cause){if(mounted.current)setError(err(cause));}finally{running.current=false;if(mounted.current)setBusy('');}
  };
  const download=async(row:ImportHistoryRow)=>{
    if(running.current)return;running.current=true;setBusy('download');setError('');
    try{const blob=await client.download(row);if(!mounted.current)return;const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=row.filename;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),30_000);}
    catch(cause){if(mounted.current)setError(err(cause));}finally{running.current=false;if(mounted.current)setBusy('');}
  };
  const selectedSite=sites.find(row=>row.id===draft?.ticket.siteId);
  const matches=customers.filter(row=>[row.name,row.customerNumber,row.legalName].some(value=>String(value||'').toLowerCase().includes(query.toLowerCase()))).slice(0,30);
  const disabled=!!busy||attention||!!saved;
  return <section className='panel module mhelp-import-panel' aria-label='mHelpDesk ticket import'>
    <div className='panelhead'><div><h2>Import mHelpDesk ticket</h2><span>Drop → review → save and verify → recoverable app trash</span></div><button type='button' className='secondary' disabled={!!busy} onClick={()=>void loadHistory()}>Imported copies / Trash</button></div>
    {error&&<p className='operations-error' role='alert'>{error}</p>}{notice&&<p role='status'>{notice}</p>}
    <div hidden={!!draft}><MhelpTicketDropZone parsers={sampleVerifiedMhelpParsers} disabled={!!busy||!!draft} captureBoardDrops onExtracted={value=>void extracted(value)}/></div>
    {draft&&<section className='ticket-create-form quote-card'>
      <div className='quote-section-head'><div><h3>Review Work Order {draft.ticket.source.sourceTicketId}</h3><small>{draft.file.name} · the printed work-order reference is preserved</small></div><button type='button' className='secondary' disabled={!!busy} onClick={clear}>{saved?'Import another ticket':attention?'Close review':'Cancel draft'}</button></div>
      {!saved&&<>
        <div className='mhelp-source-summary'><p><b>Source customer:</b> {draft.ticket.parserData.customer?.value||'Not found'}</p><p><b>Source site:</b> {draft.ticket.parserData.site?.value||'Not found'}</p><p><b>Service address:</b> {draft.ticket.parserData.address?.value||'Not found'}</p></div>
        <label>Search existing COS customers<input type='search' disabled={disabled||!directoryReady} value={query} onChange={event=>{setQuery(event.target.value);setDraft(current=>current?{...current,ticket:{...current.ticket,customerId:'',siteId:''}}:null);setReviewed(false);}}/></label>
        {!directoryReady&&<p role='status'>Customer and site verification is unavailable. <button type='button' className='secondary' disabled={!!busy} onClick={()=>void directory().catch(cause=>setError(err(cause)))}>Retry directory</button></p>}
        {directoryReady&&<div className='mhelp-customer-matches' role='group' aria-label='Choose existing customer'>{matches.map(row=><button type='button' key={row.id} className='secondary' disabled={disabled} aria-pressed={draft.ticket.customerId===row.id} onClick={()=>{setDraft(current=>current?{...current,ticket:{...current.ticket,customerId:row.id,siteId:''}}:null);setReviewed(false);}}>{row.name}</button>)}{!matches.length&&<p>No active customers match. Create the correct customer separately before importing.</p>}</div>}
        <label>Existing service site<select disabled={disabled||!draft.ticket.customerId} value={draft.ticket.siteId} onChange={event=>update('siteId',event.target.value)}><option value=''>Choose this customer’s actual site</option>{sites.filter(row=>row.customerId===draft.ticket.customerId).map(row=><option key={row.id} value={row.id}>{row.name}{row.addressLine1?' · '+row.addressLine1:''}</option>)}</select></label>
        {selectedSite&&<p>Saved site address: {[selectedSite.addressLine1,selectedSite.addressLine2,selectedSite.city,selectedSite.stateRegion,selectedSite.postalCode].filter(Boolean).join(', ')||'Not recorded'}</p>}
        <div className='quote-detail-grid'>
          <label>Workflow<select aria-label='Workflow' disabled={disabled} value={draft.ticket.jobType} onChange={event=>{update('jobType',event.target.value);update('shopPrep',false);}}><option value=''>Choose a workflow</option>{ticketTypes.map(type=><option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
          <label>Priority<select aria-label='Priority' disabled={disabled} value={draft.ticket.priority} onChange={event=>update('priority',event.target.value)}><option value=''>Choose a priority</option><option value='normal'>Normal</option><option value='high'>High</option><option value='urgent'>Urgent</option></select></label>
          <label className='wide'>Title<input disabled={disabled} value={draft.ticket.title} onChange={event=>update('title',event.target.value)}/></label>
        </div>
        <label>Work instructions<textarea aria-label='Work instructions' disabled={disabled} rows={7} value={draft.ticket.description} onChange={event=>update('description',event.target.value)}/></label>
        <label>Source contact instructions and restrictions<textarea aria-label='Source contact instructions and restrictions' disabled={disabled} rows={3} value={draft.ticket.contactInstructions} onChange={event=>update('contactInstructions',event.target.value)}/></label>
        <label>Other imported information / line items<textarea aria-label='Other imported information / line items' disabled={disabled} rows={8} value={draft.ticket.additionalInformation} onChange={event=>update('additionalInformation',event.target.value)}/></label>
        <p>No physical unit or appointment is assigned by import. Monitoring hours and source staff names stay in the ticket information.</p>
        {draft.ticket.jobType==='SERVICE'&&<label className='ticket-shop-prep'><input type='checkbox' disabled={disabled} checked={draft.ticket.shopPrep} onChange={event=>update('shopPrep',event.target.checked)}/> Service requires IT shop prep</label>}
        <details><summary>Extraction warnings and full original text</summary><ul>{draft.ticket.parserData.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul><pre className='mhelp-original-text'>{draft.ticket.parserData.documentText}</pre></details>
        <label className='ticket-shop-prep'><input type='checkbox' disabled={disabled||!directoryReady} checked={reviewed} onChange={event=>setReviewed(event.target.checked)}/> I checked the source information and the selected COS customer/site. Save this ticket and move its imported app copy to recoverable trash after verification.</label>
        <button type='button' disabled={disabled||!reviewed||!directoryReady||!draft.ticket.siteId||!draft.ticket.title.trim()||!isTicketType(draft.ticket.jobType)||!['normal','high','urgent'].includes(draft.ticket.priority)} onClick={()=>void save()}>{busy==='save'?'Saving and verifying…':'Save imported ticket'}</button>
      </>}
      {attention&&<><p>Closing this review does not retry or delete anything. Your device’s original stays in place; any uploaded copy stays in Imported copies / Trash.</p><button type='button' className='secondary' disabled={!!busy} onClick={()=>void checkResult()}>Check this import’s saved result</button>{draft.attachment?.jobId&&<button type='button' className='secondary' disabled={!!busy} onClick={()=>openJob(draft.attachment!.jobId!)}>Open linked job for review</button>}</>}
      {saved&&<div className='purchase-actions'><button type='button' disabled={!!busy} onClick={()=>openJob(saved.jobId)}>{saved.duplicate?'Open existing job':'Schedule saved ticket'}</button>{!saved.cleanupConfirmed&&!saved.duplicate&&<button type='button' className='secondary' disabled={!!busy||attention} onClick={()=>void cleanup()}>Move verified copy to recoverable trash</button>}</div>}
    </section>}
    {historyOpen&&<section className='quote-card' aria-label='Imported copies and recoverable trash'><div className='quote-section-head'><h3>Imported copies / Trash</h3><button type='button' className='secondary' disabled={!!busy} onClick={()=>setHistoryOpen(false)}>Close imports</button></div>{historyLocked&&<p>Refresh Imported copies / Trash before another restore.</p>}{history?.length===0&&<p>No imported copies are recorded.</p>}{history?.map(row=><div className='mhelp-history-row' key={row.id}><div><strong>Work Order {row.sourceTicketId}</strong><p>{row.filename} · {row.state==='trash'?'Recoverable trash':'Retained import'}</p></div><div className='purchase-actions'><button type='button' className='secondary' disabled={!!busy} onClick={()=>void download(row)}>Download original copy</button>{row.state==='trash'&&<button type='button' className='secondary' disabled={!!busy||historyLocked} onClick={()=>void restore(row)}>Restore copy</button>}{row.jobId&&<button type='button' disabled={!!busy} onClick={()=>openJob(row.jobId!)}>Open saved job</button>}</div></div>)}</section>}
  </section>;
}
