import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from './api';
import {readCustomerContacts,customerContactInstructions,type CustomerContact} from './customerContacts';
import './customerContacts.css';
type Props={customerId:string;disabled?:boolean;value?:string;onChange?:(instructions:string)=>void};
export default function CustomerContactPicker({customerId,disabled=false,value='',onChange}:Props) {
  const [contacts,setContacts]=useState<CustomerContact[]|null>(null),[selectedId,setSelectedId]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const revision=useRef(0);
  const load=useCallback(async()=>{
    const request=++revision.current;setLoading(true);setError('');setContacts(null);setSelectedId('');onChange?.('');
    try{const next=readCustomerContacts((await api.get('/api/customers/'+customerId+'/contacts')).data,customerId);if(request===revision.current)setContacts(next);}
    catch(cause){if(request===revision.current)setError(cause instanceof Error?cause.message:'Customer contacts could not be loaded.');}
    finally{if(request===revision.current)setLoading(false);}
  },[customerId,onChange]);
  useEffect(()=>{void load();return()=>{revision.current++;onChange?.('');};},[load,onChange]);
  const selected=contacts?.find(contact=>contact.id===selectedId);
  const details=(contact:CustomerContact)=><article className='customer-contact-details' key={contact.id}><strong>{contact.name||'Name not recorded'}</strong><span>{[contact.title,contact.isPrimary?'Primary customer contact':'',contact.billingContact?'Billing contact':''].filter(Boolean).join(' · ')||'Saved customer contact'}</span><dl><div><dt>Phone</dt><dd>{contact.phone||'Not recorded'}</dd></div><div><dt>Email</dt><dd>{contact.email||'Not recorded'}</dd></div></dl></article>;
  return <section className='customer-contact-picker' aria-label='Customer contacts'>
    <h4>Customer contacts</h4>
    {loading&&<p role='status'>Loading this customer’s saved contacts…</p>}
    {error&&<div role='alert' className='operations-error'>{error}<button type='button' className='secondary' disabled={disabled||loading} onClick={()=>void load()}>Retry contacts</button></div>}
    {contacts?.length===0&&!loading&&<p role='status'>No saved customer contacts were returned for this customer.</p>}
    {contacts&&contacts.length>0&&!loading&&<>{onChange?<>
      <label>Customer contact for this ticket (optional)<select aria-label='Customer contact for this ticket (optional)' disabled={disabled} value={selectedId} onChange={event=>{const id=event.target.value,contact=contacts.find(row=>row.id===id);setSelectedId(id);onChange(contact?customerContactInstructions(contact):'');}}><option value=''>No contact selected</option>{contacts.map(contact=><option key={contact.id} value={contact.id}>{contact.name||'Name not recorded'}{contact.title?' · '+contact.title:''}{contact.billingContact?' · Billing':''}</option>)}</select></label>
      {selected&&<>{details(selected)}<label>Contact instructions<textarea aria-label='Contact instructions' disabled={disabled} rows={4} value={value} onChange={event=>onChange(event.target.value)}/></label><p className='customer-contact-note'>These editable contact details are included in the ticket instructions. This does not link a contact record or send a message. A saved customer contact is not assumed to be the on-site contact.</p></>}
    </>:contacts.map(details)}</>}
  </section>;
}
