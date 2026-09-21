/* Cameras On Site — OnSite Vision Live Data Layer
 * Version: live-data-v1
 * Read-only context access. Mutations remain in approved action/RPC paths.
 */
(function(root){
  'use strict';
  let client=null;
  const cache=new Map();
  const historyCache=new Map();
  const reviewCache={at:0,value:null};
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

  async function getCompanyHistory(kind,value,options={}){
    if(!client) throw new Error('OnSite Vision live data is not configured.');
    const k=String(kind||'').trim().toLowerCase();
    const v=String(value||'').trim();
    if(!['technician','unit','site'].includes(k)) throw new Error('History kind must be technician, unit, or site.');
    if(!v) throw new Error('History lookup value is required.');
    const cacheKey=k+'|'+v.toLowerCase();
    const force=Boolean(options.force);
    const cached=historyCache.get(cacheKey);
    if(!force && cached && (Date.now()-cached.at)<TTL_MS) return cached.value;
    const response=await client.rpc('get_company_history_v1',{
      p_kind:k,
      p_value:v,
      p_limit:Math.max(1,Math.min(Number(options.limit||100),250))
    });
    if(response.error) throw response.error;
    const result=response.data||{kind:k,query:v,found:false,events:[]};
    historyCache.set(cacheKey,{at:Date.now(),value:result});
    return result;
  }

  async function getOwnerReviewQueue(options={}){
    if(!client) throw new Error('OnSite Vision live data is not configured.');
    const force=Boolean(options.force);
    if(!force && reviewCache.value && (Date.now()-reviewCache.at)<TTL_MS) return reviewCache.value;
    const response=await client.rpc('owner_review_queue_v1',{
      p_limit:Math.max(1,Math.min(Number(options.limit||40),100))
    });
    if(response.error) throw response.error;
    reviewCache.at=Date.now();
    reviewCache.value=Array.isArray(response.data)?response.data:[];
    return reviewCache.value;
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

  function invalidateAll(){
    cache.clear();
    historyCache.clear();
    reviewCache.at=0;
    reviewCache.value=null;
  }

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
    version:'live-data-v2',
    configure,
    getJobContext,
    getCompanyHistory,
    getOwnerReviewQueue,
    prime,
    invalidate,
    invalidateAll,
    forWorkflowEngine,
    visibleEvidence
  });

  root.OnSiteVisionLiveData=api;
})(typeof window!=='undefined'?window:globalThis);
