import { useEffect, useId, useRef, useState } from 'react';
import { api } from './api';
import { type Row } from './directoryData.js';
import { readTicketDirectory } from './ticketDirectoryData';
import CustomerContactPicker from './CustomerContactPicker';
import DirectoryWorkspace from './DirectoryWorkspace';

type Props = { siteId:string; setSiteId:(id:string)=>void; disabled:boolean; onValidityChange:(valid:boolean)=>void; onSiteBusyChange:(busy:boolean)=>void;contactInstructions:string;onContactInstructionsChange:(value:string)=>void; show:(message:string)=>void };
const active = (row:Row) => row.status === 'active';
export default function TicketSitePicker({siteId,setSiteId,disabled,onValidityChange,onSiteBusyChange,contactInstructions,onContactInstructionsChange,show}:Props) {
  const [customers,setCustomers]=useState<Row[]|null>(null),[sites,setSites]=useState<Row[]|null>(null);
  const [customerId,setCustomerId]=useState(''),[query,setQuery]=useState(''),[siteQuery,setSiteQuery]=useState('');
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[expanded,setExpanded]=useState(false),[highlight,setHighlight]=useState(-1),[adding,setAdding]=useState(false);
  const restoreFocus=useRef(false);
  const revision=useRef(0),searchRef=useRef<HTMLInputElement>(null);
  const listId=useId();
  const load=async()=>{
    const request=++revision.current;setLoading(true);setError('');
    try {
      // These existing RPC endpoints return one JSON aggregate containing the full directory, not a table page.
      const [people,locations]=await Promise.all([api.get('/api/customers'),api.get('/api/sites')]);
      const {customers:nextCustomers,sites:nextSites}=readTicketDirectory(people.data,locations.data);
      if(request!==revision.current)return;
      setCustomers(nextCustomers);setSites(nextSites);
      if(siteId){const selected=nextSites.find(site=>site.id===siteId),customer=nextCustomers.find(item=>item.id===selected?.customerId);
        if(selected&&customer){setCustomerId(customer.id);setQuery(customer.name);}else setSiteId('');}
    }catch(cause){if(request===revision.current)setError(cause instanceof Error?cause.message:'Customers and sites could not be loaded.');}
    finally{if(request===revision.current)setLoading(false);}
  };
  useEffect(()=>{void load();return()=>{revision.current++;};},[]);
  const customer=customers?.find(item=>item.id===customerId);
  const matched=(customers||[]).filter(item=>[item.name,item.legalName,item.customerNumber].some(value=>String(value||'').toLowerCase().includes(query.trim().toLowerCase())));
  const options=matched.slice(0,30);
  const customerSites=(sites||[]).filter(site=>site.customerId===customerId&&active(site));
  const filteredSites=customerSites.filter(site=>[site.name,site.addressLine1,site.city,site.stateRegion,site.postalCode].some(value=>String(value||'').toLowerCase().includes(siteQuery.trim().toLowerCase())));
  const selectedSite=customerSites.find(site=>site.id===siteId);
  useEffect(()=>{onValidityChange(Boolean(customer&&selectedSite&&!loading&&!error&&!adding));},[customer,selectedSite,loading,error,adding,onValidityChange]);
  const choose=(item:Row)=>{onContactInstructionsChange('');setCustomerId(item.id);setQuery(item.name);setSiteId('');setSiteQuery('');setExpanded(false);setHighlight(-1);setAdding(false);};
  useEffect(()=>{if(expanded&&highlight>=0)document.getElementById(listId+'-'+highlight)?.scrollIntoView({block:'nearest'});},[highlight,expanded,listId]);
  useEffect(()=>{if(restoreFocus.current&&!adding&&!disabled){restoreFocus.current=false;searchRef.current?.focus();}},[adding,disabled]);
  const blocked=disabled||loading||Boolean(error);
  return <section className='ticket-site-picker' aria-label='Customer and site'>
    <div className='ticket-form-step'><span aria-hidden='true'>1</span><div><h4>Customer &amp; site</h4><p>Search your full customer directory, then choose where the work will happen.</p></div></div>
    {loading&&<p role='status'>Loading customers and sites…</p>}
    {error&&<div className='operations-error' role='alert'>{error}<button type='button' className='secondary' disabled={disabled||loading} onClick={()=>void load()}>Retry customers and sites</button></div>}
    {!loading&&!error&&<p className='ticket-directory-count'>{customers?.length.toLocaleString()} active customers · {sites?.length.toLocaleString()} active sites. Customers without sites are included.</p>}
    <div className='ticket-customer-search'>
      <label htmlFor={listId+'-input'}>Search customers</label>
      <input ref={searchRef} id={listId+'-input'} role='combobox' aria-autocomplete='list' aria-expanded={expanded} aria-controls={listId} aria-activedescendant={expanded&&highlight>=0&&options[highlight]?listId+'-'+highlight:undefined} disabled={blocked||adding} value={query} placeholder='Customer name or number…' autoComplete='off'
        onFocus={()=>{if(!customerId)setExpanded(true);}}
        onBlur={()=>{setExpanded(false);setHighlight(-1);}}
        onChange={event=>{onContactInstructionsChange('');setQuery(event.target.value);setCustomerId('');setSiteId('');setSiteQuery('');setExpanded(true);setHighlight(-1);}}
        onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();setExpanded(true);setHighlight(index=>Math.min(index+1,options.length-1));}else if(event.key==='ArrowUp'){event.preventDefault();setExpanded(true);setHighlight(index=>Math.max(index-1,0));}else if(event.key==='Enter'&&expanded&&highlight>=0&&options[highlight]){event.preventDefault();choose(options[highlight]);}else if(event.key==='Escape'){event.preventDefault();setExpanded(false);setHighlight(-1);}}}/>
      {expanded&&!blocked&&<><div className='ticket-customer-results' id={listId} role='listbox' aria-label='Matching customers'>{options.map((item,index)=><button type='button' tabIndex={-1} role='option' id={listId+'-'+index} key={item.id} aria-selected={highlight===index} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(item)}><strong>{item.name}</strong><small>{item.customerNumber||'Customer'} · {(sites||[]).filter(site=>site.customerId===item.id).length} active sites</small></button>)}</div><p role='status' className='ticket-search-help'>{matched.length===0?'No customers match this search.':matched.length>options.length?options.length+' of '+matched.length.toLocaleString()+' matches shown. Keep typing to narrow the list.':matched.length+' matching customer'+(matched.length===1?'':'s')+'.'}</p></>}
    </div>
    {customer&&!error&&<div className='ticket-customer-selected'><strong>{customer.name}</strong><span>{customer.customerNumber||'Selected customer'}</span></div>}
    {customer&&!loading&&!error&&<>
      <CustomerContactPicker key={customer.id} customerId={customer.id} disabled={disabled||adding} value={contactInstructions} onChange={onContactInstructionsChange}/>
      {customerSites.length>0?<div className='ticket-site-choice'>
        <label>Search this customer’s sites<input disabled={disabled||adding} type='search' placeholder='Site name or address…' value={siteQuery} onChange={event=>setSiteQuery(event.target.value)}/></label>
        <label>Customer / Site<select aria-label='Customer / Site' disabled={disabled||adding} value={siteId} onChange={event=>setSiteId(event.target.value)}><option value=''>Choose this customer’s site</option>{filteredSites.map(site=><option key={site.id} value={site.id}>{site.name}{site.addressLine1?' · '+site.addressLine1:''}</option>)}{selectedSite&&!filteredSites.includes(selectedSite)&&<option value={selectedSite.id}>{selectedSite.name} · selected</option>}</select></label>
        {siteQuery&&filteredSites.length===0&&<p role='status'>No sites match this search.</p>}
        {selectedSite&&<p className='ticket-site-address'>{[selectedSite.addressLine1,selectedSite.addressLine2,selectedSite.city,selectedSite.stateRegion,selectedSite.postalCode].filter(Boolean).join(', ')||'No address recorded for this site.'}</p>}
      </div>:<p className='ticket-no-site' role='status'>This customer has no active site yet. Add the real service location before creating a ticket.</p>}
      {!adding&&<button type='button' className='secondary' disabled={disabled} onClick={()=>{setSiteId('');setAdding(true);}}>+ Add site for this customer</button>}
      {adding&&<DirectoryWorkspace kind='Sites' show={show} onBusyChange={onSiteBusyChange} onSitesRefreshed={rows=>setSites(rows.filter(active))} createCustomerId={customer.id} cancelCreate={()=>{restoreFocus.current=true;setAdding(false);}} onSiteCreated={site=>{setSites(current=>(current||[]).filter(item=>item.id!==site.id).concat(active(site)?[site]:[]));setSiteId(active(site)&&site.customerId===customer.id?site.id:'');setSiteQuery('');restoreFocus.current=true;setAdding(false);window.dispatchEvent(new Event('cos-board-updated'));}}/>}
    </>}
  </section>;
}
