/* Cameras On Site — OnSite Vision Workflow Engine
 * Version: workflow-engine-v5
 * Pure/read-only decision layer. It does not mutate Supabase.
 */
(function(root){
  'use strict';

  const K=()=>root.OnSiteVisionKnowledge||{equipment:{},workflows:{},equipment_aliases:{}};
  const norm=v=>String(v??'').trim();
  const lower=v=>norm(v).toLowerCase();
  const bool=v=>v===true;

  function normalizeWorkType(value){
    const v=lower(value).replace(/\s+/g,' ');
    if(/pick[ -]?up|retrieve|retrieval/.test(v)) return 'pickup';
    if(/swap|replace.*unit|unit.*replace/.test(v)) return 'swap';
    if(/deliver|delivery|deploy|deployment/.test(v)) return 'delivery';
    if(/service|repair|troubleshoot|trouble shoot|maintenance/.test(v)) return 'service';
    return ['delivery','pickup','swap','service'].includes(v)?v:'';
  }

  function normalizeEquipmentType(value){
    const shared=root.TechCheckRules;
    if(shared?.normalizeEquipmentType){
      const normalized=shared.normalizeEquipmentType(value);
      if(normalized)return normalized;
    }
    const raw=norm(value);
    if(!raw) return '';
    if(K().equipment?.[raw]) return raw;
    const alias=K().equipment_aliases?.[lower(raw)];
    if(alias) return alias;
    const hit=Object.keys(K().equipment||{}).find(k=>lower(k)===lower(raw));
    return hit||'';
  }

  function getEquipmentDefinition(value){
    const type=normalizeEquipmentType(value);
    return type?K().equipment?.[type]||null:null;
  }

  function getWorkflowDefinition(value){
    const type=normalizeWorkType(value);
    return type?K().workflows?.[type]||null:null;
  }

  function manifestRows(draft){
    const shared=root.TechCheckRules;
    if(shared?.normalizeManifest)return shared.normalizeManifest(draft?.equipment_manifest||[]);
    return (Array.isArray(draft?.equipment_manifest)?draft.equipment_manifest:[])
      .map(row=>({
        label:normalizeEquipmentType(row?.label)||norm(row?.label),
        category:norm(row?.category)||getEquipmentDefinition(row?.label)?.category||'other',
        qty:Math.max(1,Math.floor(Number(row?.qty||1)))
      }))
      .filter(row=>row.label);
  }

  function manifestQty(draft,label){
    const target=normalizeEquipmentType(label)||label;
    return manifestRows(draft).filter(r=>r.label===target).reduce((n,r)=>n+r.qty,0);
  }

  function productRequirements(draft){
    const rows=manifestRows(draft);
    const out=[];
    for(const row of rows){
      const def=getEquipmentDefinition(row.label);
      if(!def) {
        out.push({equipment:row.label,qty:row.qty,certainty:'MISSING INFORMATION',unknowns:['No verified Cameras On Site product definition exists yet.']});
        continue;
      }
      out.push({
        equipment:row.label,
        qty:row.qty,
        certainty:def.documented===true?'COMPANY RULE':'COMPANY RULE — PARTIAL',
        required_it_batteries:def.required_it_batteries,
        components:def.components||[],
        it_checks:def.it_checks||[],
        delivery_only_checks:def.delivery_only_checks||[],
        service_yard_checks:def.service_yard_checks||[],
        service_field_checks:def.service_field_checks||[],
        required_condition_checks:def.required_condition_checks||[],
        transport_and_field_install:def.transport_and_field_install||[],
        field_evidence:def.field_evidence||[],
        pickup_and_return:def.pickup_and_return||[],
        automatic_service_requirements:def.automatic_service_requirements||null,
        owner_final_verification:Boolean(def.owner_final_verification),
        swap_rules:def.swap_rules||[],
        unknowns:def.unknowns||[],
        teaching_needed:def.teaching_needed||[],
        shared_it_checklist:def.shared_it_checklist||[],
        shared_it_check_fields:def.shared_it_check_fields||[]
      });
    }
    return out;
  }

  function getRequiredFields(workflow,equipmentManifest){
    const type=normalizeWorkType(workflow);
    const wf=getWorkflowDefinition(type);
    const base=(wf?.required_create_fields||[
      'ticket_no','site','scheduled_for','scheduled_time','equipment_manifest',
      'equipment_numbers','job_description','parts','assignment','notes'
    ]).slice();

    // Work type is always required in conversational drafts until known.
    const fields=['work_type',...base];

    // Service-only work can explicitly answer "no shop equipment".
    // Other job types require an equipment definition/manifest.
    if(type==='service' && Array.isArray(equipmentManifest) && equipmentManifest.length===0){
      // Keep the equipment question until the user explicitly answers it.
    }
    return [...new Set(fields)];
  }

  function isAnswered(field,d){
    if(field==='work_type') return Boolean(normalizeWorkType(d?.work_type));
    if(field==='ticket_no') return Boolean(norm(d?.ticket_no));
    if(field==='site') return Boolean(norm(d?.site));
    if(field==='scheduled_for') return Boolean(norm(d?.scheduled_for));
    if(field==='scheduled_time') return d?.time_answered===true;
    if(field==='equipment_manifest'){
      if(normalizeWorkType(d?.work_type)==='service') return d?.equipment_answered===true || manifestRows(d).length>0;
      return manifestRows(d).length>0;
    }
    if(field==='equipment_numbers') return d?.equipment_numbers_answered===true;
    if(field==='job_description') return Boolean(norm(d?.job_description));
    if(field==='parts') return d?.parts_answered===true;
    if(field==='assignment') return d?.assignment_answered===true;
    if(field==='notes') return d?.notes_answered===true;
    return Boolean(d?.[field]);
  }

  function getMissingFields(draft){
    const fields=getRequiredFields(draft?.work_type,draft?.equipment_manifest);
    return fields.filter(field=>!isAnswered(field,draft||{}));
  }

  function getNextBestQuestion(draft){
    const d=draft||{};
    const key=getMissingFields(d)[0]||'';
    const type=normalizeWorkType(d.work_type);
    const reqs=productRequirements(d);
    const primary=reqs.find(r=>r.qty>0);

    const questions={
      work_type:{key,prompt:'What kind of work order are we creating?',choices:['Delivery','Pickup','Swap','Service']},
      ticket_no:{key,prompt:'What is the MHelpDesk ticket number?'},
      site:{key,prompt:'What customer or site is listed on the MHelpDesk ticket?'},
      scheduled_for:{key,prompt:'What date should this work be scheduled for?'},
      scheduled_time:{key,prompt:'What time should it be scheduled for? If there is no exact time, choose “No specific time.”',choices:['No specific time']},
      equipment_manifest:{key,prompt:type==='service'?'Does this Service job need any equipment from the shop?':'What equipment is required, and how many?'},
      equipment_numbers:{key,prompt:'Do you have the specific unit / stand numbers from MHelpDesk? Type them, or choose “No numbers yet.”',choices:['No numbers yet']},
      job_description:{key,prompt:'What should the technician actually do on this work order?'},
      parts:{key,prompt:'Are any extra parts or supplies required — solar panels, replacement batteries, cameras, SIM cards, or micro SD cards?',choices:['No additional parts']},
      assignment:{key,prompt:'Who should this work be assigned to? Choose a technician or leave each step in its department queue.',choices:['Use department queues']},
      notes:{key,prompt:'Any additional owner notes for the technicians?',choices:['No additional notes']}
    };
    const q=questions[key]||{key:'',prompt:''};

    // Product-aware context helps Vision ask intelligently without inventing extra required fields.
    if(key==='equipment_numbers' && primary?.equipment==='Helios'){
      q.context='For Helios, keep the exact NEW UNIT OUT tag separate from any OLD UNIT RETURNING tag on a Swap.';
    } else if(key==='equipment_manifest' && type==='delivery'){
      q.context='Vision will derive product-specific IT and Service requirements after you name the equipment.';
    } else if(key==='assignment' && type==='pickup'){
      q.context='Pickup starts with Service. A 110V Stand returns directly to Shop Inventory from Service; other returned equipment follows IT Intake.';
    }
    return q;
  }

  function validateDraft(draft){
    const d=draft||{};
    const missing=getMissingFields(d);
    const errors=[],warnings=[],derived=[];
    const type=normalizeWorkType(d.work_type);
    const rows=manifestRows(d);

    if(norm(d.ticket_no) && !/^\d{3,}$/.test(norm(d.ticket_no))) warnings.push('MHelpDesk reference does not look like the usual numeric ticket format.');
    if(type!=='service' && !rows.length) errors.push('Equipment is required for this workflow.');
    const direct110Pickup=type==='pickup' && rows.length>0 && rows.every(row=>row.label==='110V Stand');
    if(type==='pickup' && d.role==='it') errors.push(direct110Pickup
      ? '110V Stand pickup is Service-only; Service returns the stand directly to Shop Inventory and IT Intake is not required.'
      : 'Pickup must start with Service; IT Intake follows the Service return.');
    if(direct110Pickup) derived.push({
      rule:'110V Stand pickup',
      flow:'Service → trailer → Shop Inventory',
      it_intake_required:false,
      tag_optional:true
    });

    for(const row of rows){
      const def=getEquipmentDefinition(row.label);
      if(!def){
        warnings.push(`No verified product definition exists for ${row.label}; Vision must not invent technical requirements.`);
        continue;
      }
      if(Array.isArray(def.purposes) && type){
        const purpose=type==='delivery'?'DELIVERY':type==='swap'?'SWAP':'';
        if(purpose && !def.purposes.includes(purpose)){
          errors.push(`${row.label} is not currently documented as allowed for ${type.toUpperCase()}.`);
        }
      }
      if(def.automatic_service_requirements) derived.push({equipment:row.label,qty:row.qty,service:def.automatic_service_requirements});
      if(def.owner_final_verification) derived.push({equipment:row.label,qty:row.qty,owner_final_verification:true});
      if(def.unknowns?.length) warnings.push(`${row.label} has undocumented technical details: ${def.unknowns.join('; ')}.`);
    }

    if(type==='delivery'){
      const spotters=manifestQty(d,'Solar Spotter');
      const rangers=manifestQty(d,'Ranger');
      if(spotters) derived.push({rule:'Solar Spotter delivery',solar_stands:spotters,battery_choice:'Service selects 4 × AGM 12V 110Ah OR 1 × 12V 350Ah per stand'});
      if(rangers) derived.push({rule:'Ranger delivery',removable_solar_panels:rangers,batteries:`${rangers} × LiTime 12V 110Ah`});
    }

    if(type==='swap' && manifestQty(d,'Helios')) {
      derived.push({rule:'Helios Swap',obligations:['NEW UNIT OUT deployment','OLD UNIT RETURNING Service Return → IT Intake']});
    }

    return {valid:missing.length===0 && errors.length===0,missing,errors,warnings,derived};
  }

  function jobEquipmentTypes(job){
    const j=job||{};
    const types=new Set();
    const prep=j.prep||{};
    const assignments=Array.isArray(j.assignments)?j.assignments:[];
    const items=Array.isArray(j.items)?j.items:(Array.isArray(prep.prep_items)?prep.prep_items:[]);
    for(const a of assignments){
      for(const row of manifestRows({equipment_manifest:a?.equipment_manifest||[]})) if(row.label) types.add(row.label);
    }
    for(const row of manifestRows({equipment_manifest:prep?.equipment_manifest||[]})) if(row.label) types.add(row.label);
    for(const item of items){
      const name=normalizeEquipmentType(item?.equipment_type);
      if(name) types.add(name);
    }
    return [...types];
  }

  function isDirect110VPickup(job){
    const types=jobEquipmentTypes(job);
    return types.length>0 && types.every(type=>type==='110V Stand');
  }

  function getWorkflowBlockers(job){
    const j=job||{},blockers=[];
    const type=normalizeWorkType(j.work_type||j.prep?.work_type);
    const prep=j.prep||{};
    const assignments=Array.isArray(j.assignments)?j.assignments:[];
    const items=Array.isArray(j.items)?j.items:(Array.isArray(prep.prep_items)?prep.prep_items:[]);
    const serviceCheck=j.service_solar_check||j.serviceSolarCheck||null;
    const returns=Array.isArray(j.returns)?j.returns:[];
    const it=assignments.find(a=>a.assigned_role==='it' && !['completed','cancelled'].includes(a.status));
    const svc=assignments.find(a=>a.assigned_role==='service' && !['completed','cancelled'].includes(a.status));

    if(!norm(j.ticket_no||assignments[0]?.ticket_no||prep.ticket_no)) blockers.push({code:'MISSING_TICKET',message:'MHelpDesk reference is missing.',certainty:'VERIFIED DATABASE FACT'});
    if(type==='pickup'){
      const direct110=isDirect110VPickup(j);
      if(!svc && !returns.length) blockers.push({code:'PICKUP_NEEDS_SERVICE',message:'Pickup must start with Service.',certainty:'COMPANY RULE'});
      if(direct110){
        if(it) blockers.push({code:'IT_NOT_REQUIRED_110V_STAND',message:'110V Stand pickup does not use IT Intake. Service returns the stand directly to Shop Inventory.',certainty:'COMPANY RULE'});
        return blockers;
      }
      if(it && !returns.some(r=>r.status==='waiting_it')) blockers.push({code:'IT_WAITING_RETURN',message:'IT Intake must wait until Service returns the equipment to the shop.',certainty:'COMPANY RULE'});
      return blockers;
    }

    if(it && !['released','closed'].includes(prep.status)){
      blockers.push({code:'IT_PREP_OPEN',message:'IT has not completed the Tech Check / Service handoff yet.',certainty:'VERIFIED DATABASE FACT'});
    }
    if(prep.status==='released' && !svc){
      blockers.push({code:'SERVICE_UNASSIGNED',message:'IT handoff is ready, but there is no active Service assignment.',certainty:'VERIFIED DATABASE FACT'});
    }

    const cameraFamily=items.filter(i=>['Spotter','Recon 2','Ranger'].includes(i.equipment_type) && ['DELIVERY','SWAP','BACKUP'].includes(i.purpose));
    for(const item of cameraFamily){
      const missing=[];
      if(!bool(item.camera_port_81_ok)) missing.push('camera_port_81_ok');
      if(!bool(item.camera_port_554_ok)) missing.push('camera_port_554_ok');
      if(item.equipment_type!=='Ranger' && !bool(item.unit_programmed_ok)) missing.push('unit_programmed_ok');
      if(item.equipment_type==='Recon 2' && Number(item.recon_camera_count||0)<1) missing.push('recon_camera_count');
      if(item.purpose==='SWAP'){
        const deploy=['delivery_sim_ok','delivery_camera_app_ok','delivery_customer_email_app_ok','delivery_monitoring_ok','delivery_ticket_count_ok','delivery_sd_formatted_ok','delivery_recording_ok'];
        if(item.equipment_type!=='Spotter') deploy.push('delivery_batteries_charged_ok');
        for(const key of deploy) if(!bool(item[key])) missing.push(key);
      }
      if(missing.length){
        blockers.push({
          code:'CAMERA_FAMILY_IT_INCOMPLETE',
          message:`${item.equipment_type} ${item.unit_tag||''} still has ${missing.length} required deployment check(s) incomplete.`,
          fields:missing,
          certainty:'VERIFIED DATABASE FACT'
        });
      }
    }

    if(prep.status==='released' && svc){
      const rangerField=items.filter(i=>i.equipment_type==='Ranger' && ['DELIVERY','SWAP'].includes(i.purpose));
      for(const item of rangerField){
        if(!bool(item.ranger_field_victron_updated_ok)){
          blockers.push({
            code:'RANGER_FIELD_VICTRON_REQUIRED',
            message:`Ranger ${item.unit_tag||''} still requires the Service field Victron Bluetooth update/verification before close.`,
            certainty:'VERIFIED DATABASE FACT'
          });
        }
      }

      for(const equipmentType of ['Sniper','Spotter','Recon 2']){
        const required=items.filter(i=>i.equipment_type===equipmentType && i.purpose==='SWAP').length;
        if(!required) continue;
        const returned=returns.filter(r=>r.equipment_type===equipmentType).length;
        if(returned<required){
          blockers.push({
            code:'STANDARD_SWAP_RETURN_REQUIRED',
            message:`${equipmentType} SWAP requires ${required} replaced field unit return(s) through Service Return → IT Intake before close; ${returned} recorded.`,
            equipment_type:equipmentType,
            required_returns:required,
            recorded_returns:returned,
            certainty:'VERIFIED DATABASE FACT'
          });
        }
      }
    }

    const helios=items.filter(i=>i.equipment_type==='Helios' && ['DELIVERY','SWAP','BACKUP'].includes(i.purpose));
    if(helios.length){
      for(const item of helios){
        const required=[
          'helios_camera1_hardware_ok','helios_camera2_hardware_ok','helios_ptz_assembly_ok',
          'helios_proxicast_4x4_ok','helios_router_sim_ok','helios_speaker_24v_ok',
          'helios_cameras_12v_ok','helios_ptz_plate_4bolts_ok','helios_cerbo_network_ok',
          'helios_cerbo_vrm_ok','helios_rear_unit_tag_ok','helios_battery_box_installed_ok',
          'helios_battery_120v_charged_ok','helios_camera_router_programming_ok','helios_alibi_vigilant_ok',
          'helios_3x1tb_sd_ok','helios_camera1_ports_ok','helios_camera2_ports_ok',
          'helios_ptz_ports_ok','helios_speaker_ports_ok','delivery_sim_ok','delivery_camera_app_ok',
          'delivery_batteries_charged_ok','delivery_sd_formatted_ok','delivery_recording_ok'
        ];
        const missing=required.filter(k=>!bool(item[k]));
        if(item.purpose!=='BACKUP'){
          if(!bool(item.delivery_customer_email_app_ok)) missing.push('delivery_customer_email_app_ok');
          if(!bool(item.delivery_monitoring_ok)) missing.push('delivery_monitoring_ok');
        }
        if(missing.length) blockers.push({code:'HELIOS_IT_INCOMPLETE',message:`Helios ${item.unit_tag||''} still has ${missing.length} required IT check(s) incomplete.`,fields:missing,certainty:'VERIFIED DATABASE FACT'});
        if(item.purpose==='BACKUP' && !item.spare_it_checked_out_at) blockers.push({code:'SPARE_NOT_CHECKED_OUT',message:`Helios ${item.unit_tag||''} is READY but has not been explicitly checked out by IT.`,certainty:'VERIFIED DATABASE FACT'});
      }
      if(prep.status==='released' && serviceCheck && !serviceCheck.handoff_accepted_at){
        blockers.push({code:'HELIOS_SERVICE_HANDOFF_NOT_ACCEPTED',message:'Service has not accepted the Helios IT handoff after the yard test.',certainty:'VERIFIED DATABASE FACT'});
      }
      if(serviceCheck?.helios_field_completed_at && !serviceCheck?.helios_owner_verified_at){
        blockers.push({code:'OWNER_FINAL_VERIFY',message:'Helios field installation is submitted and waiting for Owner final verification.',certainty:'VERIFIED DATABASE FACT'});
      }
    }
    return blockers;
  }

  function getWorkflowNextStep(job){
    const j=job||{},type=normalizeWorkType(j.work_type||j.prep?.work_type);
    const prep=j.prep||{},assignments=Array.isArray(j.assignments)?j.assignments:[];
    const returns=Array.isArray(j.returns)?j.returns:[];
    const serviceCheck=j.service_solar_check||j.serviceSolarCheck||null;
    const blockers=getWorkflowBlockers(j);

    if(type==='pickup'){
      const direct110=isDirect110VPickup(j);
      if(direct110){
        const returned110=returns.filter(r=>r.equipment_type==='110V Stand');
        if(!returned110.some(r=>r.status==='completed')) return {stage:'service_pickup',next:'Service puts the 110V Stand on the trailer, brings it back to the shop, and adds it directly back to Shop Inventory. A physical tag is optional. IT Intake is not required.'};
        return {stage:'complete',next:'The 110V Stand is back in Shop Inventory. IT Intake is not required.'};
      }
      if(!returns.length) return {stage:'service_pickup',next:'Service completes the field pickup and documents the returned equipment.'};
      if(returns.some(r=>r.status==='waiting_it')) return {stage:'it_intake',next:'IT receives the returned equipment and completes IT Intake.'};
      if(returns.some(r=>r.status==='pending_mhelp_inventory')) return {stage:'manager_inventory',next:'Owner/Manager confirms the MHelpDesk inventory step.'};
      return {stage:'complete',next:'Pickup/return chain is complete.'};
    }
    if(prep.status==='draft') return {stage:'it_prep',next:'IT completes the product-specific Tech Check and creates the IT → Service handoff.',blockers};
    if(prep.status==='released'){
      const svc=assignments.find(a=>a.assigned_role==='service' && !['completed','cancelled'].includes(a.status));
      if(!svc) return {stage:'service_assignment',next:'Assign a Service Tech or the Service department queue so Service can receive the released IT handoff.',blockers};
      const helios=(j.items||prep.prep_items||[]).some(i=>i.equipment_type==='Helios'&&['DELIVERY','SWAP'].includes(i.purpose));
      if(helios){
        if(!serviceCheck?.completed_at) return {stage:'service_yard',next:'Service completes the Helios yard solar/Victron verification and required proof.',blockers};
        if(!serviceCheck?.handoff_accepted_at) return {stage:'service_accept_handoff',next:'Service verifies the exact equipment/evidence and accepts the IT handoff.',blockers};
        if(!serviceCheck?.helios_field_completed_at) return {stage:'field_install',next:'Service completes the Helios field installation, photos, and dated signature.',blockers};
        if(!serviceCheck?.helios_owner_verified_at) return {stage:'owner_final_verify',next:'Owner reviews the final Helios installation and verifies completion.',blockers};
      }

      const rangerField=(j.items||prep.prep_items||[]).filter(i=>i.equipment_type==='Ranger'&&['DELIVERY','SWAP'].includes(i.purpose));
      if(rangerField.some(i=>!bool(i.ranger_field_victron_updated_ok))){
        return {stage:'ranger_field_victron',next:'Service completes the Ranger field work and verifies the Ranger is up to date in the Victron Bluetooth app before close.',blockers};
      }

      for(const equipmentType of ['Sniper','Spotter','Recon 2']){
        const required=(j.items||prep.prep_items||[]).filter(i=>i.equipment_type===equipmentType&&i.purpose==='SWAP').length;
        if(!required) continue;
        const returned=returns.filter(r=>r.equipment_type===equipmentType).length;
        if(returned<required){
          return {stage:'swap_return',next:`Service completes the ${equipmentType} SWAP and returns the replaced field unit through Service Return → IT Intake before close.`,blockers};
        }
      }

      return {stage:'service_work',next:'Service opens the same MHelpDesk ticket, verifies the IT handoff, and completes the required Service work.',blockers};
    }
    if(prep.status==='closed' || assignments.every(a=>['completed','cancelled'].includes(a.status))) return {stage:'complete',next:'The Tech Check workflow is complete.',blockers:[]};
    return {stage:'current_work',next:'Continue the active Tech Check assignment.',blockers};
  }

  root.OnSiteVisionWorkflowEngine=Object.freeze({
    version:'workflow-engine-v6',
    normalizeWorkType,
    normalizeEquipmentType,
    getEquipmentDefinition,
    getWorkflowDefinition,
    manifestRows,
    productRequirements,
    getRequiredFields,
    getMissingFields,
    getNextBestQuestion,
    validateDraft,
    getWorkflowBlockers,
    getWorkflowNextStep
  });
})(typeof window!=='undefined'?window:globalThis);
