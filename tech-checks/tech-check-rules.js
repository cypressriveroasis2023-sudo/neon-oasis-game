/* Cameras On Site — Shared Tech Check Rules
 * Version: rules-v3
 * Pure rule definitions shared by Owner/IT/Service UI and OnSite Vision.
 * Supabase RPCs/triggers remain the final authority for production transitions.
 */
(function(root){
  'use strict';

  const EQUIPMENT=Object.freeze({
    'Sniper':Object.freeze({category:'device',required_batteries:2,battery_label:'12V 35Ah batteries',purposes:['DELIVERY','SWAP','BACKUP']}),
    'Ranger':Object.freeze({category:'device',required_batteries:1,battery_label:'LiTime 12V 110Ah',purposes:['DELIVERY','SWAP','BACKUP']}),
    'Helios':Object.freeze({category:'device',required_batteries:1,battery_label:'single internal Helios battery box',purposes:['DELIVERY','SWAP','BACKUP']}),
    'Solar Spotter':Object.freeze({category:'device',required_batteries:0,purposes:['DELIVERY','SWAP','BACKUP']}),
    'Spotter':Object.freeze({category:'device',required_batteries:0,purposes:['DELIVERY','SWAP','BACKUP']}),
    'Recon 2':Object.freeze({category:'device',required_batteries:'dynamic_min_1',display_name:'Recon II',purposes:['DELIVERY','SWAP','BACKUP']}),
    '110V Stand':Object.freeze({category:'stand',required_batteries:0,purposes:['SWAP']}),
    'Solar Stand':Object.freeze({category:'stand',required_batteries:0,purposes:['DELIVERY','SWAP']}),
    'Solar Pole':Object.freeze({category:'stand',required_batteries:0,purposes:['DELIVERY','SWAP']}),
    'Pole':Object.freeze({category:'stand',required_batteries:0,purposes:['DELIVERY','SWAP']})
  });

  const ALIASES=Object.freeze({
    'recon ii':'Recon 2','recon 2':'Recon 2','recon2':'Recon 2',
    'helio':'Helios','helios':'Helios',
    'solar spotter':'Solar Spotter','solarspotter':'Solar Spotter',
    'solar stand':'Solar Stand','solar pole':'Solar Pole',
    '110v stand':'110V Stand','110 stand':'110V Stand',
    'sniper':'Sniper','ranger':'Ranger','spotter':'Spotter','pole':'Pole'
  });

  const DEVICE_TYPES=Object.freeze(Object.keys(EQUIPMENT).filter(k=>EQUIPMENT[k].category==='device'));
  const STAND_TYPES=Object.freeze(Object.keys(EQUIPMENT).filter(k=>EQUIPMENT[k].category==='stand'));

  const HELIOS_FIELD_CHECKLIST=Object.freeze([
    {key:'helios_field_box_mounted_ok',rpc_param:'p_box_mounted_ok',label:'Helios box installed and secured on the tower.'},
    {key:'helios_field_pv_connected_ok',rpc_param:'p_pv_connected_ok',label:'PV cables connected.'},
    {key:'helios_field_ptz_secured_ok',rpc_param:'p_ptz_secured_ok',label:'PTZ reinstalled and secured on the removable front plate.'},
    {key:'helios_field_switch_pv_ok',rpc_param:'p_switch_pv_ok',label:'Internal switch flipped to PV.'},
    {key:'helios_field_unit_battery_on_ok',rpc_param:'p_unit_battery_on_ok',label:'Helios unit and battery turned on.'},
    {key:'helios_field_it_online_verified_ok',rpc_param:'p_it_online_verified_ok',label:'Called IT and IT verified the Helios is online.'},
    {key:'helios_field_cameras_aimed_ok',rpc_param:'p_cameras_aimed_ok',label:'Camera aim / focus completed with IT.'},
    {key:'helios_field_recording_ok',rpc_param:'p_recording_ok',label:'Recording verified after final aim.'},
    {key:'helios_field_tower_20ft_ok',rpc_param:'p_tower_20ft_ok',label:'Tower cranked to approximately 20 feet.'},
    {key:'helios_field_mast_lock_bolt_ok',rpc_param:'p_mast_lock_bolt_ok',label:'Separate tower mast locking bolt inserted and secured.'},
    {key:'helios_field_panel_45deg_ok',rpc_param:'p_panel_45deg_ok',label:'Solar panel set to approximately 45°.'},
    {key:'helios_field_panel_bolt_ok',rpc_param:'p_panel_bolt_ok',label:'Separate panel angle/locking bolt installed and secured.'},
    {key:'helios_field_4_sandbags_ok',rpc_param:'p_4_sandbags_ok',label:'4 bags of sand placed on the tower base.'}
  ]);
  const IT_INTAKE_CHECKLIST=Object.freeze([
    'Is the returned unit tag / number correct?','Did you review the Service Tech site / damage photos and verify any damage found?','Are the returned accessories / equipment accounted for?','Are the batteries / battery box accounted for?','Are the SD cards / storage accounted for where applicable?','Did you power the unit and verify it comes online / functions correctly?','Were the SD cards formatted and made ready for the next deployment?','Was the SIM card turned off / canceled for this returned unit?','Was monitoring canceled for this returned unit?','Was this unit removed from Alibi?','Was the unit cleaned and made physically ready for reuse?','Was the unit added back to the 2026 Unit Tracker as Shop Inventory?','Was the SIM cancellation documented with the date, MHelpDesk job, unit number, and IT technician initials?','Is the unit back on the shelf and ready for a future deployment?','Was this returned unit removed from the customer email account in the camera app?'
  ]);
  const HELIOS_PORTS=Object.freeze({
    camera1:Object.freeze([81,554,1400]),
    camera2:Object.freeze([81,554,1500]),
    ptz:Object.freeze([81,554,1600]),
    speaker:Object.freeze([81,554,1700])
  });

  const TRUCK_SPARE_BATTERY_OPTIONS=Object.freeze([
    Object.freeze({key:'spotter-agm',equipment_type:'Solar Spotter',battery_type:'AGM 12V 110Ah',label:'Solar Spotter · AGM 12V 110Ah'}),
    Object.freeze({key:'spotter-350',equipment_type:'Solar Spotter',battery_type:'12V 350Ah',label:'Solar Spotter · 12V 350Ah'}),
    Object.freeze({key:'ranger-litime',equipment_type:'Ranger',battery_type:'LiTime 12V 110Ah',label:'Ranger · LiTime 12V 110Ah'}),
    Object.freeze({key:'helios-box',equipment_type:'Helios',battery_type:'Helios Battery Box',label:'Helios · Battery Box'}),
    Object.freeze({key:'recon-battery',equipment_type:'Recon 2',battery_type:'Recon II Battery',label:'Recon II · Spare Battery'})
  ]);
  const TRUCK_SPARE_RULES=Object.freeze({
    unit_types:DEVICE_TYPES,
    unit_purpose:'BACKUP',
    battery_options:TRUCK_SPARE_BATTERY_OPTIONS,
    battery_batch_statuses:Object.freeze(['prepared','in_truck','resolved']),
    unit_outcomes:Object.freeze(['used','returned_unused']),
    it_unit_checkout_required:true,
    battery_ready_required:true,
    it_battery_checkout_required:true,
    manifest_rule:'Truck spares stay separate from the customer/job equipment manifest.',
    unused_unit_rule:'Unused truck spare units return directly to Shop Inventory and do not create an IT Intake return.',
    used_unit_rule:'If a spare unit is used for a swap, return the failed/replaced field unit through the normal Service Return → IT Intake flow.',
    battery_resolution_rule:'Service records the quantity used; any remainder is returned unused.'
  });

  function text(v){return String(v??'').trim();}
  function lower(v){return text(v).toLowerCase();}

  function normalizeEquipmentType(value){
    const raw=text(value);
    if(!raw)return'';
    if(EQUIPMENT[raw])return raw;
    const alias=ALIASES[lower(raw)];
    if(alias)return alias;
    const direct=Object.keys(EQUIPMENT).find(k=>lower(k)===lower(raw));
    return direct||raw;
  }

  function displayEquipmentType(value){
    const type=normalizeEquipmentType(value);
    return EQUIPMENT[type]?.display_name||type;
  }

  function equipmentDefinition(value){
    const type=normalizeEquipmentType(value);
    return EQUIPMENT[type]||null;
  }

  function normalizeManifest(raw){
    return (Array.isArray(raw)?raw:[]).map(row=>{
      const label=normalizeEquipmentType(row?.label);
      const def=equipmentDefinition(label);
      const category=['device','stand','other'].includes(row?.category)
        ? row.category
        : (def?.category||'other');
      return{category,label,qty:Math.max(1,Math.floor(Number(row?.qty||1)))};
    }).filter(row=>row.label);
  }

  function manifestQty(raw,label){
    const target=normalizeEquipmentType(label);
    return normalizeManifest(raw).filter(row=>row.label===target).reduce((sum,row)=>sum+row.qty,0);
  }

  function isSolarSupport(type){return['Solar Stand','Solar Pole'].includes(normalizeEquipmentType(type));}
  function isSimpleSupport(type){return['110V Stand','Pole'].includes(normalizeEquipmentType(type));}
  function isSupport(type){return isSolarSupport(type)||isSimpleSupport(type);}
  function isHeliosDeploy(item){
    return normalizeEquipmentType(item?.equipment_type)==='Helios'&&['DELIVERY','SWAP','BACKUP'].includes(String(item?.purpose||'').toUpperCase());
  }

  function requiredBatteryCount(itemOrType){
    const item=typeof itemOrType==='object'&&itemOrType?itemOrType:null;
    const type=normalizeEquipmentType(item?item.equipment_type:itemOrType);
    const explicit=item?Number(item.required_battery_count):NaN;
    if(Number.isFinite(explicit)&&explicit>=0)return explicit;
    const configured=EQUIPMENT[type]?.required_batteries;
    if(configured==='dynamic_min_1')return 1;
    return Math.max(0,Number(configured||0));
  }

  function automaticServiceSolarPlan(raw,workType='service'){
    if(lower(workType)!=='delivery')return{spotters:0,rangers:0,stands:0,panels:0};
    const spotters=manifestQty(raw,'Solar Spotter');
    const rangers=manifestQty(raw,'Ranger');
    return{spotters,rangers,stands:spotters,panels:rangers};
  }

  function identity(item,unitNo){
    const tag=text(item?.unit_tag);
    const type=normalizeEquipmentType(item?.equipment_type)||'Unit';
    return tag?type+' '+tag:'Unit '+String(unitNo||1);
  }

  function itChecklist(item,unitNo){
    const type=normalizeEquipmentType(item?.equipment_type);
    const purpose=String(item?.purpose||'').toUpperCase();
    const unit=identity(item,unitNo);
    const steps=[{
      kind:'tag',field:'unit_tag',
      label:isSupport(type)?'Enter the exact tag / ID for '+type:'Enter the exact unit tag for '+type
    }];

    if(isSolarSupport(type)){
      steps.push({kind:'bool',field:'ticket_item_match_ok',label:'Is '+unit+' listed on the MHelpDesk ticket?'});
      steps.push({kind:'bool',field:'safe_ok',label:'Is '+unit+' physically ready for Service to perform the Solar Stand checkout?'});
      return steps;
    }
    if(isSimpleSupport(type)){
      steps.push({kind:'bool',field:'ticket_item_match_ok',label:'Is '+unit+' what the customer requested and what is listed on the MHelpDesk ticket?'});
      return steps;
    }

    const batteryCount=requiredBatteryCount(item);
    if(type!=='Solar Spotter'&&batteryCount>0){
      steps.push({
        kind:'number',field:'battery_count',
        label:type==='Helios'
          ?'Confirm '+unit+' has exactly its internal Helios battery box prepared. This is ONE Helios battery box — not four Solar Stand batteries.'
          :'How many batteries / battery boxes are prepared for '+unit+'?'
      });
    }

    steps.push({kind:'bool',field:'power_ok',label:'Does '+unit+' power on correctly?'});

    if(isHeliosDeploy(item)){
      steps.push(
        {kind:'bool',field:'helios_camera1_hardware_ok',label:'Is Camera 1 (bullet camera) installed correctly on '+unit+'?'},
        {kind:'bool',field:'helios_camera2_hardware_ok',label:'Is Camera 2 (bullet camera) installed correctly on '+unit+'?'},
        {kind:'bool',field:'helios_ptz_assembly_ok',label:'Is the Cameras 3/4 PTZ assembly correct on '+unit+': 180° lens on top and PTZ on bottom?'},
        {kind:'bool',field:'helios_cameras_12v_ok',label:'Are the Helios cameras powered from the required 12V supply?'},
        {kind:'bool',field:'helios_ptz_plate_4bolts_ok',label:'Is the PTZ mounted to the removable front plate and secured with all 4 bolts?'},
        {kind:'bool',field:'helios_router_sim_ok',label:'Is the router installed correctly with the SIM installed in '+unit+'?'},
        {kind:'bool',field:'helios_proxicast_4x4_ok',label:'Is the Proxicast 4x4 antenna installed, connected to the router, and secure?'},
        {kind:'bool',field:'helios_speaker_24v_ok',label:'Is the IP Speaker installed and powered from the required 24V supply?'},
        {kind:'bool',field:'helios_camera_router_programming_ok',label:'Are the cameras and router programmed together for this Helios before port verification?'},
        {kind:'bool',field:'delivery_sim_ok',label:'Is the SIM active and is the Helios router online?'},
        {kind:'bool',field:'delivery_camera_app_ok',label:'Is '+unit+' visible and working in the camera app?'},
        {kind:'bool',field:'helios_camera1_ports_ok',label:'Camera 1: are ports 81 / 554 / 1400 configured and open in both Camera 1 and the router?'},
        {kind:'bool',field:'helios_camera2_ports_ok',label:'Camera 2: are ports 81 / 554 / 1500 configured and open in both Camera 2 and the router?'},
        {kind:'bool',field:'helios_ptz_ports_ok',label:'PTZ: are ports 81 / 554 / 1600 configured and open in both the PTZ and the router?'},
        {kind:'bool',field:'helios_speaker_ports_ok',label:'IP Speaker: are ports 81 / 554 / 1700 configured and open in both the speaker and the router?'},
        {kind:'bool',field:'helios_alibi_vigilant_ok',label:'Is '+unit+' correctly configured and visible in Alibi / Vigilant Control Center?'},
        {kind:'bool',field:'helios_cerbo_network_ok',label:'Is the Victron Cerbo connected to the Helios router/network?'},
        {kind:'bool',field:'helios_cerbo_vrm_ok',label:'Is the Cerbo added to Victron VRM and visible online?'},
        {kind:'bool',field:'helios_rear_unit_tag_ok',label:'Is the permanent Helios unit tag installed on the rear and clearly readable?'},
        {kind:'bool',field:'helios_battery_box_installed_ok',label:'Is the single Helios battery box installed inside '+unit+'?'},
        {kind:'bool',field:'helios_battery_120v_charged_ok',label:'Did you charge the Helios battery box while '+unit+' was plugged into 120V?'},
        {kind:'bool',field:'helios_3x1tb_sd_ok',label:'Are all 3 required 1TB SD cards installed in '+unit+'?'},
        {kind:'bool',field:'delivery_recording_ok',label:'Before formatting storage, did you verify '+unit+' is recording correctly?'},
        {kind:'bool',field:'delivery_sd_formatted_ok',label:'After recording verification, are all 3 × 1TB SD cards formatted and ready?'}
      );
      if(purpose!=='BACKUP'){
        steps.push({kind:'bool',field:'delivery_monitoring_ok',label:'Was Central Station monitoring for '+unit+' created and sent in?'});
        steps.push({kind:'bool',field:'delivery_customer_email_app_ok',label:'Was '+unit+' added under the customer email account in the camera app?'});
      }
      steps.push({kind:'bool',field:'functions_ok',label:'Were all functions on '+unit+' tested and working?'});
      steps.push({kind:'bool',field:'safe_ok',label:'Is '+unit+' ready for the IT → Service handoff?'});
      return steps;
    }

    if(type==='Ranger'){
      steps.push({kind:'bool',field:'solar_mppt_updated_ok',label:'Is the MPPT firmware / configuration on '+unit+' updated?'});
      steps.push({kind:'bool',field:'solar_mppt_tested_ok',label:'Was the MPPT on '+unit+' tested and working correctly?'});
      steps.push({kind:'bool',field:'solar_pv_charging_ok',label:'With a solar panel connected to '+unit+', did you verify the Ranger battery is charging through the MPPT?'});
    }

    if(['DELIVERY','BACKUP'].includes(purpose)){
      steps.push({kind:'bool',field:'delivery_sim_ok',label:'Is the SIM card for '+unit+' active and installed in the router?'});
      steps.push({kind:'bool',field:'delivery_camera_app_ok',label:'Is '+unit+' visible in the camera app?'});
      steps.push({kind:'bool',field:'delivery_recording_ok',label:'Was recording footage confirmed for '+unit+'?'});
      if(type!=='Solar Spotter')steps.push({kind:'bool',field:'delivery_batteries_charged_ok',label:'Are the batteries / battery box for '+unit+' charged and ready?'});
      if(purpose==='DELIVERY'){
        steps.push({kind:'bool',field:'delivery_monitoring_ok',label:'Was Central Station monitoring for '+unit+' created and sent in?'});
        steps.push({kind:'bool',field:'delivery_ticket_count_ok',label:'Is '+unit+' included in the equipment type and quantity on the MHelpDesk ticket?'});
      }
      steps.push({kind:'bool',field:'delivery_sd_formatted_ok',label:'Is the SD card / NVR storage for '+unit+' formatted and ready?'});
      if(purpose==='DELIVERY')steps.push({kind:'bool',field:'delivery_customer_email_app_ok',label:'Was '+unit+' added under the customer email account in the camera app?'});
      steps.push({kind:'bool',field:'functions_ok',label:'Were all functions on '+unit+' tested and working?'});
      steps.push({kind:'bool',field:'safe_ok',label:'Is '+unit+' ready for field use?'});
      return steps;
    }

    steps.push({kind:'bool',field:'functions_ok',label:'Were all functions on '+unit+' tested and working?'});
    steps.push({kind:'bool',field:'safe_ok',label:'Is '+unit+' ready for field use?'});
    return steps;
  }

  function itReady(item){
    if(!text(item?.unit_tag))return false;
    const type=normalizeEquipmentType(item?.equipment_type);
    const purpose=String(item?.purpose||'').toUpperCase();

    if(isSolarSupport(type)||isSimpleSupport(type)){
      return Boolean(item.ticket_item_match_ok&&(isSimpleSupport(type)||item.safe_ok));
    }
    if(!item.power_ok||!item.functions_ok||!item.safe_ok)return false;
    if(type!=='Solar Spotter'&&Number(item.battery_count||0)<requiredBatteryCount(item))return false;

    if(isHeliosDeploy(item)){
      const core=Boolean(
        item.helios_camera1_hardware_ok&&item.helios_camera2_hardware_ok&&item.helios_ptz_assembly_ok&&
        item.helios_proxicast_4x4_ok&&item.helios_router_sim_ok&&item.helios_speaker_24v_ok&&
        item.helios_cameras_12v_ok&&item.helios_ptz_plate_4bolts_ok&&item.helios_cerbo_network_ok&&
        item.helios_cerbo_vrm_ok&&item.helios_rear_unit_tag_ok&&item.helios_battery_box_installed_ok&&
        item.helios_battery_120v_charged_ok&&item.helios_camera_router_programming_ok&&item.helios_alibi_vigilant_ok&&
        item.helios_3x1tb_sd_ok&&item.helios_camera1_ports_ok&&item.helios_camera2_ports_ok&&
        item.helios_ptz_ports_ok&&item.helios_speaker_ports_ok&&item.delivery_sim_ok&&
        item.delivery_camera_app_ok&&item.delivery_batteries_charged_ok&&item.delivery_sd_formatted_ok&&
        item.delivery_recording_ok
      );
      if(!core)return false;
      return purpose==='BACKUP'?true:Boolean(item.delivery_customer_email_app_ok&&item.delivery_monitoring_ok);
    }

    if(type==='Ranger'&&!(item.solar_mppt_updated_ok&&item.solar_mppt_tested_ok&&item.solar_pv_charging_ok))return false;
    if(!['DELIVERY','BACKUP'].includes(purpose))return true;
    const batteryReady=type==='Solar Spotter'||item.delivery_batteries_charged_ok;
    const hardwareReady=Boolean(item.delivery_sim_ok&&item.delivery_camera_app_ok&&item.delivery_sd_formatted_ok&&item.delivery_recording_ok&&batteryReady);
    if(purpose==='BACKUP')return hardwareReady;
    return Boolean(hardwareReady&&item.delivery_customer_email_app_ok&&item.delivery_monitoring_ok&&item.delivery_ticket_count_ok);
  }

  function serviceSolarRequiredStandCount(ctx){
    if(!ctx?.need_stand)return 0;
    return Math.max(1,Number(ctx.solar_spotter_count||0));
  }

  function serviceSolarEvidenceRequirements(ctx){
    if(!ctx?.need_solar)return[];
    const requirements=[];
    const standCount=serviceSolarRequiredStandCount(ctx);
    if(ctx.need_stand){
      requirements.push({category:'solar_stand',kind:'photo',minimum:standCount,label:standCount+' Solar Stand tag photo'+(standCount===1?'':'s')});
      requirements.push({category:'solar_stand',kind:'signature',minimum:1,label:'Solar Stand verification signature'});
    }
    requirements.push({category:'batteries',kind:'photo',minimum:1,label:'Battery proof photo'});
    requirements.push({category:'batteries',kind:'signature',minimum:1,label:'Battery verification signature'});
    requirements.push({category:'mppt',kind:'photo',minimum:1,label:'MPPT / charging readings photo'});
    if(ctx.has_helios){
      requirements.push({category:'helios_cerbo_mppt',kind:'photo',minimum:1,label:'Helios Cerbo / MPPT proof photo'});
      requirements.push({category:'helios_yard',kind:'photo',minimum:1,label:'Helios yard-test photo'});
      requirements.push({category:'helios_yard',kind:'signature',minimum:1,label:'Helios yard-test signature'});
    }
    return requirements;
  }

  function serviceSolarBatteryPlan(ctx,check=null,heliosCount=0){
    const spotters=Number(ctx?.solar_spotter_count||0);
    const rangers=Number(ctx?.ranger_count||0);
    const helios=Math.max(0,Number(heliosCount||0));
    const saved=String(check?.battery_configuration||'');
    if(spotters>0){
      const config=['agm_4x_12v_110ah','single_12v_350ah'].includes(saved)?saved:'';
      const count=config==='agm_4x_12v_110ah'?spotters*4:config==='single_12v_350ah'?spotters:0;
      const description=config==='agm_4x_12v_110ah'
        ?spotters+' Solar Stand'+(spotters===1?'':'s')+' · 4 × AGM 12V 110Ah per stand'
        :config==='single_12v_350ah'
          ?spotters+' Solar Stand'+(spotters===1?'':'s')+' · 1 × 12V 350Ah per stand'
          :'Choose the battery setup installed on the Solar Stand';
      return{config,count,description,selectable:true,spotters,rangers,helios};
    }
    if(rangers>0&&helios===0)return{config:'litime_1x_12v_110ah',count:rangers,description:rangers+' × LiTime 12V 110Ah',selectable:false,spotters,rangers,helios};
    if(helios>0&&rangers===0)return{config:'helios_battery_box',count:helios,description:helios+' Helios battery box'+(helios===1?'':'es'),selectable:false,spotters,rangers,helios};
    if(rangers>0||helios>0)return{config:'mixed',count:rangers+helios,description:'Mixed Ranger LiTime 12V 110Ah + Helios battery-box package',selectable:false,spotters,rangers,helios};
    return{config:'mixed',count:0,description:'Battery system used for charging verification',selectable:false,spotters,rangers,helios};
  }

  const api=Object.freeze({
    version:'rules-v3',
    equipment:EQUIPMENT,
    equipmentAliases:ALIASES,
    deviceTypes:DEVICE_TYPES,
    standTypes:STAND_TYPES,
    heliosPorts:HELIOS_PORTS,
    truckSpareBatteryOptions:TRUCK_SPARE_BATTERY_OPTIONS,
    truckSpareRules:TRUCK_SPARE_RULES,
    heliosFieldChecklist:HELIOS_FIELD_CHECKLIST,
    itIntakeChecklist:IT_INTAKE_CHECKLIST,
    normalizeEquipmentType,
    displayEquipmentType,
    equipmentDefinition,
    normalizeManifest,
    manifestQty,
    isSolarSupport,
    isSimpleSupport,
    isSupport,
    isHeliosDeploy,
    requiredBatteryCount,
    automaticServiceSolarPlan,
    itChecklist,
    itReady,
    serviceSolarRequiredStandCount,
    serviceSolarEvidenceRequirements,
    serviceSolarBatteryPlan
  });

  root.TechCheckRules=api;
})(typeof window!=='undefined'?window:globalThis);
