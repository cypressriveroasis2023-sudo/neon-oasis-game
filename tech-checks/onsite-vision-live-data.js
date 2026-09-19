/* Cameras On Site — OnSite Vision Live Data Layer
 * Version: live-data-v1
 * Read-only context access. Mutations remain in approved action/RPC paths.
 */
(function(root){
  'use strict';
  let client=null;
  const cache=new Map();
  const TTL_MS=15000;

  function configure(supabaseClient){
    client=supabaseClient;
    return api;
  }

  function key(ticket){ return String(ticket??'').trim(); }

  async function getJobContext(ticket,options={}){
    const k=key(ticket);
    if(!k) throw new Error('MHelpDesk ticket number is required.');
    if(!client) throw new Error('OnSite Vision live data is not configured.');
    const force=Boolean(options.force);
    const cached=cache.get(k);
    if(!force && cached && (Date.now()-cached.at)<TTL_MS) return cached.value;

    const response=await client.rpc('get_tech_check_job_context_v1',{p_ticket_no:k});
    if(response.error) throw response.error;
    const value=response.data||{context_version:'job-context-v1',ticket_no:k,found:false};
    cache.set(k,{at:Date.now(),value});
    return value;
  }

  function prime(context){
    const k=key(context?.ticket_no);
    if(k) cache.set(k,{at:Date.now(),value:context});
    return context;
  }

  function invalidate(ticket){
    const k=key(ticket);
    if(k) cache.delete(k);
  }

  function invalidateAll(){ cache.clear(); }

  function forWorkflowEngine(context){
    const c=context||{};
    return {
      ticket_no:c.ticket_no||'',
      work_type:c.summary?.effective_work_type||c.prep?.work_type||c.assignments?.[0]?.work_type||'',
      prep:c.prep||null,
      assignments:Array.isArray(c.assignments)?c.assignments:[],
      items:Array.isArray(c.items)?c.items:[],
      service_solar_check:c.service_solar_check||null,
      service_solar_checks:Array.isArray(c.service_solar_checks)?c.service_solar_checks:[],
      returns:Array.isArray(c.returns)?c.returns:[],
      unit_registry:Array.isArray(c.unit_registry)?c.unit_registry:[],
      handoff_evidence:Array.isArray(c.handoff_evidence)?c.handoff_evidence:[],
      service_solar_evidence:Array.isArray(c.service_solar_evidence)?c.service_solar_evidence:[],
      truck_spare_batteries:Array.isArray(c.truck_spare_batteries)?c.truck_spare_batteries:[],
      workflow_checkpoints:Array.isArray(c.workflow_checkpoints)?c.workflow_checkpoints:[]
    };
  }

  function visibleEvidence(context){
    const c=context||{};
    const handoff=Array.isArray(c.handoff_evidence)?c.handoff_evidence:[];
    const solar=Array.isArray(c.service_solar_evidence)?c.service_solar_evidence:[];
    const returns=Array.isArray(c.returns)?c.returns:[];
    return {
      handoff,
      service_solar:solar,
      return_photos:returns.flatMap(r=>(r.return_photo_paths||[]).map(path=>({kind:'return_photo',storage_path:path,unit_tag:r.unit_tag,created_at:r.returned_at}))),
      intake_photos:returns.flatMap(r=>(r.intake_photo_paths||[]).map(path=>({kind:'intake_photo',storage_path:path,unit_tag:r.unit_tag,created_at:r.it_received_at})))
    };
  }

  const api=Object.freeze({
    version:'live-data-v1',
    configure,
    getJobContext,
    prime,
    invalidate,
    invalidateAll,
    forWorkflowEngine,
    visibleEvidence
  });

  root.OnSiteVisionLiveData=api;
})(typeof window!=='undefined'?window:globalThis);
