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
  const escalationCache=new Map();
  const damageCache=new Map();
  const departureCache=new Map();
  const workloadCache=new Map();
  const ACTIVE_ESCALATION_STATUSES=['waiting_it','joint_troubleshooting','backup_swap_authorized','unresolved_owner'];
  const TTL_MS=15000;

  function configure(supabaseClient){
    client=supabaseClient;
    return api;
  }

  function key(ticket){ return String(ticket??'').trim(); }
  function unitNumber(value){
    const digits=String(value??'').match(/\d+/g)?.join('')||'';
    return digits?String(Number(digits)):'';
  }
  function matchesUnit(row,reference){
    const ref=String(reference||'').trim();
    if(!ref)return true;
    const refLower=ref.toLowerCase();
    const tag=String(row?.unit_tag||'').trim();
    const equipment=String(row?.equipment_type||'').trim();
    const combined=(equipment+' '+tag).toLowerCase();
    const want=unitNumber(ref);
    const got=unitNumber(tag);
    if(want&&got&&want===got){
      const namedType=refLower.replace(/[\d#._-]+/g,' ').replace(/\b(unit|number|no)\b/g,' ').replace(/\s+/g,' ').trim();
      return !namedType || equipment.toLowerCase().includes(namedType) || namedType.includes(equipment.toLowerCase());
    }
    return combined.includes(refLower)||tag.toLowerCase()===refLower;
  }

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


  async function getOfflineEscalations(filters={},options={}){
    if(!client) throw new Error('OnSite Vision live data is not configured.');
    const scope=String(filters.scope||'active').trim().toLowerCase();
    const unitReference=String(filters.unit_reference||'').trim();
    const ticketNo=String(filters.ticket_no||'').trim();
    const limit=Math.max(1,Math.min(Number(options.limit||100),250));
    const force=Boolean(options.force);
    const cacheKey=JSON.stringify({scope,unitReference:unitReference.toLowerCase(),ticketNo,limit});
    const cached=escalationCache.get(cacheKey);
    if(!force&&cached&&(Date.now()-cached.at)<TTL_MS)return cached.value;

    if(!['active','waiting_it','owner_decision','resolved','all'].includes(scope)){
      throw new Error('Offline escalation scope must be active, waiting_it, owner_decision, resolved, or all.');
    }

    let query=client.from('field_escalations').select([
      'id','ticket_no','site','unit_tag','equipment_type','service_tech_name','original_problem',
      'service_power_verified','service_troubleshooting_notes','service_started_at','it_tech_name',
      'it_troubleshooting_notes','status','backup_unit_tag','backup_equipment_type','backup_authorized_at',
      'failed_return_id','owner_summary','owner_notified_at','owner_resolution','owner_resolved_by_name',
      'owner_resolved_at','resolved_at','created_at','updated_at'
    ].join(',')).order('updated_at',{ascending:false}).limit(limit);
    if(scope==='active')query=query.in('status',ACTIVE_ESCALATION_STATUSES).is('resolved_at',null);
    else if(scope==='waiting_it')query=query.eq('status','waiting_it').is('resolved_at',null);
    else if(scope==='owner_decision')query=query.eq('status','unresolved_owner').is('resolved_at',null);
    else if(scope==='resolved')query=query.not('resolved_at','is',null);
    if(ticketNo)query=query.eq('ticket_no',ticketNo);
    const response=await query;
    if(response.error)throw response.error;
    const rows=(Array.isArray(response.data)?response.data:[]).filter(row=>matchesUnit(row,unitReference));
    const value={scope,unit_reference:unitReference,ticket_no:ticketNo,count:rows.length,rows};
    escalationCache.set(cacheKey,{at:Date.now(),value});
    return value;
  }


  async function getDamageHolds(filters={},options={}){
    if(!client) throw new Error('OnSite Vision live data is not configured.');
    const scope=String(filters.scope||'active').trim().toLowerCase();
    const unitReference=String(filters.unit_reference||'').trim();
    const ticketNo=String(filters.ticket_no||'').trim();
    const limit=Math.max(1,Math.min(Number(options.limit||100),250));
    const force=Boolean(options.force);
    if(!['active','all'].includes(scope))throw new Error('Damage hold scope must be active or all.');
    const cacheKey=JSON.stringify({scope,unitReference:unitReference.toLowerCase(),ticketNo,limit});
    const cached=damageCache.get(cacheKey);
    if(!force&&cached&&(Date.now()-cached.at)<TTL_MS)return cached.value;

    let query=client.from('unit_returns').select([
      'id','ticket_no','unit_tag','equipment_type','service_tech_name','returned_at','return_notes',
      'status','it_tech_name','it_received_at','physical_condition_ok','accessories_ok','batteries_ok',
      'sd_cards_ok','electronics_ok','power_functions_ok','damage_notes','intake_photo_paths',
      'mhelp_inventory_confirmed','mhelp_confirmed_at','completed_at','created_at','updated_at'
    ].join(',')).order('updated_at',{ascending:false}).limit(limit);
    if(scope==='active')query=query.eq('status','needs_replacement');
    else query=query.not('damage_notes','is',null);
    if(ticketNo)query=query.eq('ticket_no',ticketNo);
    const returnResult=await query;
    if(returnResult.error)throw returnResult.error;
    const rows=(Array.isArray(returnResult.data)?returnResult.data:[]).filter(row=>matchesUnit(row,unitReference));

    const tickets=[...new Set(rows.map(row=>String(row.ticket_no||'').trim()).filter(Boolean))];
    const tags=[...new Set(rows.map(row=>String(row.unit_tag||'').trim()).filter(Boolean))];
    let assets=[],notifications=[],reports=[];
    if(tags.length){
      const assetResult=await client.from('asset_inventory')
        .select('unit_key,unit_tag,asset_type,availability_status,last_event,notes,updated_at')
        .in('unit_tag',tags).limit(Math.max(20,tags.length*3));
      if(assetResult.error)throw assetResult.error;
      assets=Array.isArray(assetResult.data)?assetResult.data:[];
    }
    if(tickets.length){
      const notificationResult=await client.from('app_notifications')
        .select('id,recipient_user_id,kind,title,ticket_no,unit_tag,read_at,created_at')
        .eq('title','Damaged equipment needs replacement')
        .in('ticket_no',tickets).order('created_at',{ascending:false}).limit(250);
      if(notificationResult.error)throw notificationResult.error;
      notifications=Array.isArray(notificationResult.data)?notificationResult.data:[];

      const reportResult=await client.from('reports')
        .select('id,kind,ticket_no,actor_name,text,created_at')
        .eq('kind','DAMAGED EQUIPMENT NEEDS REPLACEMENT')
        .in('ticket_no',tickets).order('created_at',{ascending:false}).limit(250);
      if(reportResult.error)throw reportResult.error;
      reports=Array.isArray(reportResult.data)?reportResult.data:[];
    }

    const enriched=rows.map(row=>{
      const tag=String(row.unit_tag||'').trim();
      const ticket=String(row.ticket_no||'').trim();
      const asset=assets.find(a=>String(a.unit_tag||'').trim()===tag)||null;
      const rowNotifications=notifications.filter(n=>
        String(n.ticket_no||'').trim()===ticket &&
        (!tag || !n.unit_tag || String(n.unit_tag||'').trim()===tag)
      );
      const rowReports=reports.filter(r=>String(r.ticket_no||'').trim()===ticket);
      return {
        ...row,
        asset_inventory_status:asset?.availability_status||null,
        asset_last_event:asset?.last_event||null,
        owner_notified:rowNotifications.length>0,
        owner_notification_count:rowNotifications.length,
        owner_notification_latest_at:rowNotifications[0]?.created_at||null,
        permanent_damage_report_present:rowReports.length>0,
        permanent_damage_report_at:rowReports[0]?.created_at||null,
        shop_inventory_blocked:row.status==='needs_replacement'
      };
    });
    const value={scope,unit_reference:unitReference,ticket_no:ticketNo,count:enriched.length,rows:enriched};
    damageCache.set(cacheKey,{at:Date.now(),value});
    return value;
  }



  async function getWorkload(filters={},options={}){
    if(!client) throw new Error('OnSite Vision live data is not configured.');
    const date=String(filters.date||'').trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('A YYYY-MM-DD workload date is required.');
    const role=String(filters.role||'').trim().toLowerCase();
    const techId=String(filters.tech_id||'').trim();
    const techName=String(filters.tech_name||'').trim().toLowerCase();
    const cacheKey=JSON.stringify({date,role,techId,techName});
    const cached=workloadCache.get(cacheKey),force=Boolean(options.force);
    if(!force&&cached&&(Date.now()-cached.at)<TTL_MS)return cached.value;
    let query=client.from('job_assignments').select([
      'id','ticket_no','site','assigned_role','assignee_user_id','assignee_name','status','scheduled_for','scheduled_time',
      'work_type','unit_summary','job_description','requires_it_handoff','equipment_manifest','requested_unit_count','updated_at'
    ].join(',')).eq('scheduled_for',date).not('status','in','("completed","cancelled")').order('scheduled_time',{ascending:true,nullsFirst:false}).limit(250);
    if(role)query=query.eq('assigned_role',role);
    if(techId)query=query.eq('assignee_user_id',techId);
    const response=await query;
    if(response.error)throw response.error;
    let rows=Array.isArray(response.data)?response.data:[];
    if(techName&&!techId)rows=rows.filter(row=>String(row.assignee_name||'').toLowerCase().includes(techName));
    const tickets=[...new Set(rows.map(row=>String(row.ticket_no||'').trim()).filter(Boolean))];
    const value={date,role,tech_id:techId,tech_name:techName,count:tickets.length,tickets,assignments:rows};
    workloadCache.set(cacheKey,{at:Date.now(),value});
    return value;
  }

  async function getDepartureReadiness(filters={},options={}){
    if(!client) throw new Error('OnSite Vision live data is not configured.');
    const ticketNo=String(filters.ticket_no||'').trim();
    const serviceTech=String(filters.service_tech||'').trim().toLowerCase();
    const force=Boolean(options.force);
    const cacheKey=JSON.stringify({ticketNo,serviceTech});
    const cached=departureCache.get(cacheKey);
    if(!force&&cached&&(Date.now()-cached.at)<TTL_MS)return cached.value;

    let batteryQuery=client.from('truck_spare_batteries').select([
      'id','prep_ticket_id','ticket_no','equipment_type','battery_type','qty_prepared','ready_ok',
      'prepared_by_name','service_tech_name','status','qty_used','qty_returned','accepted_at',
      'resolved_at','it_checked_out_at','it_checked_out_by_name','created_at','updated_at'
    ].join(',')).neq('status','resolved').is('resolved_at',null).order('updated_at',{ascending:false}).limit(250);
    if(ticketNo)batteryQuery=batteryQuery.eq('ticket_no',ticketNo);
    const batteryResult=await batteryQuery;
    if(batteryResult.error)throw batteryResult.error;
    let batteries=Array.isArray(batteryResult.data)?batteryResult.data:[];
    if(serviceTech)batteries=batteries.filter(row=>String(row.service_tech_name||'').toLowerCase().includes(serviceTech));

    let spareQuery=client.from('prep_items').select([
      'id','prep_ticket_id','equipment_type','purpose','unit_tag','power_ok','functions_ok','safe_ok','verified_at',
      'spare_outcome','spare_checked_out_at','spare_checked_out_to_name','spare_it_checked_out_at','spare_it_checked_out_by_name',
      'prep_tickets!inner(ticket_no,work_type,status)'
    ].join(',')).eq('purpose','spare').order('verified_at',{ascending:false}).limit(250);
    if(ticketNo)spareQuery=spareQuery.eq('prep_tickets.ticket_no',ticketNo);
    const spareResult=await spareQuery;
    if(spareResult.error)throw spareResult.error;
    let spares=(Array.isArray(spareResult.data)?spareResult.data:[]).filter(row=>!['returned','used'].includes(String(row.spare_outcome||'').toLowerCase()));
    if(serviceTech)spares=spares.filter(row=>String(row.spare_checked_out_to_name||'').toLowerCase().includes(serviceTech));

    const readyBatteries=batteries.filter(row=>row.ready_ok===true&&Boolean(row.it_checked_out_at));
    const standardQty=readyBatteries.filter(row=>/110\s*ah/i.test(String(row.battery_type||''))).reduce((sum,row)=>sum+Number(row.qty_prepared||0),0);
    const litimeQty=readyBatteries.filter(row=>/litime/i.test(String(row.battery_type||''))&&/100\s*ah/i.test(String(row.battery_type||''))).reduce((sum,row)=>sum+Number(row.qty_prepared||0),0);
    const eligibleBackup=spares.filter(row=>
      ['spotter','sniper','solar spotter'].includes(String(row.equipment_type||'').trim().toLowerCase()) &&
      row.power_ok===true&&row.functions_ok===true&&row.safe_ok===true&&
      Boolean(row.verified_at)&&Boolean(row.spare_it_checked_out_at)&&Boolean(row.spare_checked_out_at)
    );
    const value={
      ticket_no:ticketNo,service_tech:serviceTech,batteries,spares,
      counts:{standard_12v_110ah:standardQty,litime_12v_100ah:litimeQty,eligible_backup_units:eligibleBackup.length},
      minimums:{standard_12v_110ah:4,litime_12v_100ah:2,eligible_backup_units:1},
      ready:standardQty>=4&&litimeQty>=2&&eligibleBackup.length>=1,
      blockers:[
        ...(standardQty>=4?[]:['Need '+Math.max(0,4-standardQty)+' more IT-checked-out, charged 12V 110Ah batter'+(4-standardQty===1?'y':'ies')+'.']),
        ...(litimeQty>=2?[]:['Need '+Math.max(0,2-litimeQty)+' more IT-checked-out, charged LiTime 12V 100Ah batter'+(2-litimeQty===1?'y':'ies')+'.']),
        ...(eligibleBackup.length?[]:['Need one IT-checked-out Spotter, Sniper, or Solar Spotter backup assigned for the day.'])
      ]
    };
    departureCache.set(cacheKey,{at:Date.now(),value});
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

  function invalidateAll(){
    cache.clear();
    historyCache.clear();
    reviewCache.at=0;
    reviewCache.value=null;
    escalationCache.clear();
    damageCache.clear();
    departureCache.clear();
    workloadCache.clear();
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
    version:'live-data-v6',
    configure,
    getJobContext,
    getCompanyHistory,
    getOwnerReviewQueue,
    getOfflineEscalations,
    getDamageHolds,
    getDepartureReadiness,
    getWorkload,
    prime,
    invalidate,
    invalidateAll,
    forWorkflowEngine,
    visibleEvidence
  });

  root.OnSiteVisionLiveData=api;
})(typeof window!=='undefined'?window:globalThis);
