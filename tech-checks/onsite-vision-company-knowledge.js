/* Cameras On Site — OnSite Vision Company Knowledge
 * Version: company-knowledge-v4
 * Read-only browser knowledge foundation. Database triggers/RPCs remain authoritative.
 */
(function(root){
  'use strict';
  const data={
  "version": "company-knowledge-v4",
  "generated_from": {
    "date": "2026-09-19",
    "authority": [
      "Live Supabase schema, RPCs and triggers",
      "technician-wizard-owner-dashboard-v5.js",
      "app.js",
      "Existing Tech Check QA specifications"
    ],
    "rule": "Only documented/verified Cameras On Site rules belong here. Unknown technical details stay unknown until explicitly documented."
  },
  "terminology": {
    "handoff": "IT → Service handoff",
    "mhelpdesk": "MHelpDesk is external and remains the source of truth for the service ticket reference.",
    "certainty": {
      "database_fact": "VERIFIED DATABASE FACT",
      "company_rule": "COMPANY RULE",
      "inference": "AI INFERENCE",
      "missing": "MISSING INFORMATION"
    }
  },
  "equipment_aliases": {
    "recon ii": "Recon 2",
    "recon 2": "Recon 2",
    "recon2": "Recon 2",
    "helios": "Helios",
    "helio": "Helios",
    "solar spotter": "Solar Spotter",
    "solarspotter": "Solar Spotter",
    "solar stand": "Solar Stand",
    "solar pole": "Solar Pole",
    "110v stand": "110V Stand",
    "110 stand": "110V Stand",
    "sniper": "Sniper",
    "ranger": "Ranger",
    "spotter": "Spotter",
    "pole": "Pole"
  },
  "equipment": {
    "Helios": {
      "category": "device",
      "documented": true,
      "required_it_batteries": 1,
      "battery_label": "single internal Helios battery box",
      "purposes": [
        "DELIVERY",
        "SWAP",
        "BACKUP"
      ],
      "components": [
        "Helios enclosure/box",
        "Camera 1 bullet camera",
        "Camera 2 bullet camera",
        "Cameras 3/4 PTZ assembly (180° lens on top, PTZ on bottom)",
        "router with SIM",
        "Proxicast 4x4 antenna",
        "IP Speaker",
        "Victron Cerbo",
        "single internal Helios battery box",
        "3 × 1TB SD cards"
      ],
      "power_rules": [
        "Cameras use required 12V supply",
        "IP Speaker uses required 24V supply"
      ],
      "network_rules": [
        {
          "component": "Camera 1",
          "ports": [
            81,
            554,
            1400
          ],
          "where": "device and router"
        },
        {
          "component": "Camera 2",
          "ports": [
            81,
            554,
            1500
          ],
          "where": "device and router"
        },
        {
          "component": "PTZ",
          "ports": [
            81,
            554,
            1600
          ],
          "where": "device and router"
        },
        {
          "component": "IP Speaker",
          "ports": [
            81,
            554,
            1700
          ],
          "where": "device and router"
        }
      ],
      "it_checks": [
        "Camera 1 hardware installed correctly",
        "Camera 2 hardware installed correctly",
        "PTZ assembly correct",
        "cameras powered from 12V",
        "PTZ front plate secured with 4 bolts",
        "router and SIM installed",
        "Proxicast 4x4 connected and secure",
        "IP Speaker installed and powered from 24V",
        "cameras and router programmed together",
        "SIM active and router online",
        "visible/working in camera app",
        "all four device/router port groups verified",
        "configured/visible in Alibi / Vigilant Control Center",
        "Cerbo connected to router/network",
        "Cerbo added to Victron VRM and visible online",
        "permanent rear unit tag readable",
        "battery box installed",
        "battery box charged while plugged into 120V",
        "3 × 1TB SD cards installed",
        "recording verified before storage formatting",
        "all three SD cards formatted/ready",
        "all functions tested",
        "ready for IT → Service handoff"
      ],
      "delivery_only_checks": [
        "Central Station monitoring created/sent in",
        "added under customer email account in camera app"
      ],
      "service_yard_checks": [
        "Cerbo/MPPT verification",
        "Helios battery box charging verification",
        "PV connected",
        "PV switch verification",
        "Victron Bluetooth verification",
        "updates/status verification",
        "solar charging verification",
        "PTZ wrapped/prepared for transport",
        "yard-test proof photo and signature"
      ],
      "service_field_checks": [
        "Helios box mounted",
        "PV connected",
        "PTZ secured",
        "PV switch set",
        "unit battery on",
        "IT verifies unit online",
        "cameras aimed",
        "recording verified",
        "tower approximately 20 ft",
        "mast locking bolt installed",
        "solar panel approximately 45°",
        "separate panel bolt installed",
        "4 sandbags installed",
        "final installation photo proof",
        "dated Service installation signature"
      ],
      "owner_final_verification": true,
      "swap_rules": [
        "NEW UNIT OUT follows deployment workflow",
        "OLD UNIT RETURNING follows Service Return → IT Intake",
        "Owner final verification requires old-unit return documentation for each Helios swap"
      ],
      "sources": [
        "prep_items Helios columns",
        "enforce_tech_check_transition_v108",
        "enforce_helios_ports_before_release",
        "accept_helios_handoff_v1",
        "save_my_service_solar_check_v4",
        "save_my_helios_field_install_v1",
        "owner_verify_helios_install_v1"
      ]
    },
    "Solar Spotter": {
      "category": "device",
      "documented": true,
      "required_it_batteries": 0,
      "battery_label": "Service handles Solar Stand battery configuration",
      "purposes": [
        "DELIVERY",
        "SWAP",
        "BACKUP"
      ],
      "it_checks": [
        "exact unit tag",
        "power on",
        "SIM active/router online",
        "visible in camera app",
        "recording confirmed",
        "storage formatted/ready",
        "functions tested",
        "safe/ready for field use"
      ],
      "delivery_only_checks": [
        "Central Station monitoring",
        "MHelpDesk equipment quantity/type confirmation",
        "customer email camera-app assignment"
      ],
      "automatic_service_requirements": {
        "delivery": "1 Solar Stand per Solar Spotter",
        "battery_options": [
          "4 × AGM 12V 110Ah per Solar Stand",
          "1 × 12V 350Ah per Solar Stand"
        ],
        "evidence": [
          "one Solar Stand tag photo per Solar Spotter",
          "battery proof photo/signature",
          "MPPT/charging readings photo"
        ]
      },
      "sources": [
        "add_it_prep_item",
        "automaticServiceSolarPlan",
        "service_solar_context_v2",
        "save_my_service_solar_check_v4",
        "enforce_service_solar_check_before_close"
      ]
    },
    "Ranger": {
      "category": "device",
      "documented": true,
      "required_it_batteries": 1,
      "battery_label": "LiTime 12V 110Ah",
      "purposes": [
        "DELIVERY",
        "SWAP",
        "BACKUP"
      ],
      "it_checks": [
        "exact unit tag",
        "power on",
        "MPPT firmware/configuration updated",
        "MPPT tested",
        "battery charging verified through MPPT with solar panel connected",
        "SIM active/router online",
        "visible in camera app",
        "recording confirmed",
        "storage formatted/ready",
        "battery charged/ready",
        "functions tested",
        "safe/ready for field use"
      ],
      "delivery_only_checks": [
        "Central Station monitoring",
        "MHelpDesk equipment quantity/type confirmation",
        "customer email camera-app assignment"
      ],
      "automatic_service_requirements": {
        "delivery": "1 removable solar panel per Ranger",
        "battery": "1 × LiTime 12V 110Ah per Ranger",
        "evidence": [
          "battery proof",
          "MPPT/charging readings proof"
        ]
      },
      "sources": [
        "add_it_prep_item",
        "enforce_it_solar_delivery_before_release",
        "service_solar_context_v2",
        "save_my_service_solar_check_v4"
      ]
    },
    "Sniper": {
      "category": "device",
      "documented": "partial",
      "required_it_batteries": 2,
      "battery_label": "12V 35Ah batteries",
      "purposes": [
        "DELIVERY",
        "SWAP",
        "BACKUP"
      ],
      "it_checks": [
        "exact unit tag",
        "power on",
        "battery count",
        "SIM active/router online for deployable work",
        "camera app visibility",
        "recording",
        "storage formatted/ready",
        "functions tested",
        "safe/ready"
      ],
      "unknowns": [
        "Detailed internal components",
        "port map",
        "product-specific troubleshooting tree"
      ],
      "teaching_needed": [
        "List the Sniper internal components and what belongs with each unit.",
        "Document the Sniper device/router port map and any programming/configuration sequence.",
        "Document Sniper-specific IT checks beyond the shared deployable-device checks.",
        "Document any Sniper-specific Service checkout or field-install steps.",
        "Document any Sniper-specific mandatory photos/signatures beyond the generic handoff evidence.",
        "Document the approved Sniper troubleshooting sequence for power, batteries, SIM/router, camera app/video, recording, and storage."
      ],
      "sources": [
        "add_it_prep_item",
        "itUnitStepsData",
        "app.js BATTERY metadata"
      ]
    },
    "Spotter": {
      "category": "device",
      "documented": "partial",
      "required_it_batteries": 0,
      "purposes": [
        "DELIVERY",
        "SWAP",
        "BACKUP"
      ],
      "it_checks": [
        "exact unit tag",
        "power on",
        "SIM active/router online for deployable work",
        "camera app visibility",
        "recording",
        "storage formatted/ready",
        "functions tested",
        "safe/ready"
      ],
      "unknowns": [
        "Detailed internal components",
        "battery specification if applicable",
        "port map",
        "product-specific troubleshooting tree"
      ],
      "teaching_needed": [
        "List the Spotter internal components and what belongs with each unit.",
        "Confirm whether Spotter has a battery requirement beyond the current database requirement of 0; if yes, document exact battery model and quantity.",
        "Document the Spotter device/router port map and programming/configuration sequence.",
        "Document Spotter-specific IT checks beyond the shared deployable-device checks.",
        "Document any Spotter-specific Service checkout or field-install steps and mandatory evidence.",
        "Document the approved Spotter troubleshooting sequence."
      ],
      "sources": [
        "add_it_prep_item",
        "itUnitStepsData"
      ]
    },
    "Recon 2": {
      "category": "device",
      "display_name": "Recon II",
      "documented": "partial",
      "required_it_batteries": "dynamic minimum 1",
      "purposes": [
        "DELIVERY",
        "SWAP",
        "BACKUP"
      ],
      "it_checks": [
        "exact unit tag",
        "power on",
        "configured battery quantity",
        "SIM active/router online for deployable work",
        "camera app visibility",
        "recording",
        "storage formatted/ready",
        "functions tested",
        "safe/ready"
      ],
      "unknowns": [
        "Exact Recon battery model/specification",
        "detailed internal components",
        "port map",
        "product-specific troubleshooting tree"
      ],
      "teaching_needed": [
        "Document the exact Recon II battery model/specification; the database label Recon II Battery is not a physical specification.",
        "List the Recon II internal components and what belongs with each configured unit/camera set.",
        "Document the Recon II device/router port map and programming/configuration sequence.",
        "Document Recon II-specific IT checks beyond the shared deployable-device checks.",
        "Document any Recon II-specific Service checkout or field-install steps and mandatory evidence.",
        "Document the approved Recon II troubleshooting sequence."
      ],
      "sources": [
        "add_it_prep_item",
        "configure_it_prep_item",
        "app.js BATTERY metadata"
      ]
    },
    "Solar Stand": {
      "category": "stand",
      "documented": true,
      "required_it_batteries": 0,
      "purposes": [
        "DELIVERY",
        "SWAP"
      ],
      "it_checks": [
        "exact stand tag",
        "listed on MHelpDesk ticket",
        "physically ready for Service solar checkout"
      ],
      "service_rules": [
        "battery configuration chosen/verified by Service",
        "MPPT/charging verified",
        "stand tag photo proof"
      ],
      "sources": [
        "configure_it_prep_item",
        "enforce_support_safe_before_release",
        "save_my_service_solar_check_v4"
      ]
    },
    "Solar Pole": {
      "category": "stand",
      "documented": "partial",
      "required_it_batteries": 0,
      "purposes": [
        "DELIVERY",
        "SWAP"
      ],
      "it_checks": [
        "exact pole tag",
        "listed on MHelpDesk ticket",
        "physically ready for Service"
      ],
      "unknowns": [
        "Detailed product-specific field installation SOP"
      ],
      "teaching_needed": [
        "List every Solar Pole component/accessory that must travel with it.",
        "Document the Solar Pole Service field-install/removal SOP.",
        "Document any Solar Pole battery, MPPT, PV/charging, positioning, anchoring, or safety rules that apply.",
        "Document Solar Pole-specific mandatory photos/signatures.",
        "Document the approved Solar Pole troubleshooting sequence."
      ],
      "sources": [
        "configure_it_prep_item",
        "enforce_support_safe_before_release",
        "service_solar_context_v2"
      ]
    },
    "110V Stand": {
      "category": "stand",
      "documented": "partial",
      "required_it_batteries": 0,
      "purposes": [
        "SWAP"
      ],
      "it_checks": [
        "exact stand tag",
        "matches requested/MHelpDesk equipment"
      ],
      "unknowns": [
        "Detailed product-specific field installation SOP"
      ],
      "teaching_needed": [
        "List every 110V Stand component/accessory that must travel with it.",
        "Document the exact 110V Stand SWAP installation/removal SOP.",
        "Document the company-required power-source, cord, outlet, GFCI, or electrical checks, if any.",
        "Document 110V Stand-specific mandatory photos/signatures.",
        "Document the approved 110V Stand troubleshooting sequence."
      ],
      "sources": [
        "add_it_prep_item",
        "configure_it_prep_item",
        "itUnitStepsData"
      ]
    },
    "Pole": {
      "category": "stand",
      "documented": "partial",
      "required_it_batteries": 0,
      "purposes": [
        "DELIVERY",
        "SWAP"
      ],
      "it_checks": [
        "exact pole tag",
        "matches requested/MHelpDesk equipment"
      ],
      "unknowns": [
        "Detailed product-specific field installation SOP"
      ],
      "teaching_needed": [
        "List every Pole component/accessory that must travel with it.",
        "Document the Pole Delivery/Swap installation and removal SOP.",
        "Document any company mounting, anchoring, height, positioning, or safety rules that apply.",
        "Document Pole-specific mandatory photos/signatures.",
        "Document the approved Pole troubleshooting sequence."
      ],
      "sources": [
        "configure_it_prep_item",
        "itUnitStepsData"
      ]
    }
  },
  "truck_spares": {
    "documented": true,
    "authority": [
      "add_it_truck_spare_unit",
      "save_it_truck_spare_battery",
      "enforce_truck_spares_before_release",
      "resolve_my_truck_spare_unit",
      "resolve_my_truck_spare_battery"
    ],
    "unit_types": [
      "Sniper",
      "Ranger",
      "Helios",
      "Solar Spotter",
      "Spotter",
      "Recon 2"
    ],
    "unit_purpose": "BACKUP",
    "unit_flow": [
      "IT runs the full applicable unit check.",
      "Matching-tag photo and IT signature are required by the existing prep workflow.",
      "IT explicitly checks out the spare before the IT → Service handoff.",
      "Service resolves the spare after the field call as used or returned_unused.",
      "Unused spare units return directly to Shop Inventory and do not create an IT Intake return.",
      "If a spare unit is used for a swap, the failed/replaced field unit follows the normal Service Return → IT Intake flow."
    ],
    "battery_batches": [
      {"equipment_type":"Solar Spotter","battery_type":"AGM 12V 110Ah"},
      {"equipment_type":"Solar Spotter","battery_type":"12V 350Ah"},
      {"equipment_type":"Ranger","battery_type":"LiTime 12V 110Ah"},
      {"equipment_type":"Helios","battery_type":"Helios Battery Box"},
      {"equipment_type":"Recon 2","battery_type":"Recon II Battery"}
    ],
    "battery_flow": [
      "IT records the spare quantity.",
      "IT must mark the batch physically present, charged and READY.",
      "IT explicitly checks out the batch before the IT → Service handoff.",
      "Service records the quantity used; any remainder is returned unused.",
      "Checked-out batches are locked from editing by the existing database workflow."
    ],
    "manifest_rule": "Truck spares remain separate from the customer/job equipment manifest.",
    "known_limits": [
      "The current database does not accept a standalone Sniper spare-battery batch.",
      "The current database does not accept a standalone Spotter spare-battery batch.",
      "Recon II Battery is an accepted database label, but its exact physical model/specification is still undocumented."
    ]
  },
  "phase_7_gap_inventory": {
    "rule": "These are missing Cameras On Site facts. Vision must return MISSING INFORMATION rather than fill them with generic internet assumptions.",
    "products": {
      "Sniper": "Internal components, port/programming map, product-specific IT/Service evidence, and troubleshooting still need Owner-approved documentation.",
      "Spotter": "Internal components, battery applicability/specification, port/programming map, product-specific IT/Service evidence, and troubleshooting still need Owner-approved documentation.",
      "Recon 2": "Exact battery model/specification, internal components, port/programming map, product-specific IT/Service evidence, and troubleshooting still need Owner-approved documentation.",
      "Solar Pole": "Components/accessories, detailed field install/removal, solar/power/safety rules, evidence, and troubleshooting still need Owner-approved documentation.",
      "110V Stand": "Components/accessories, SWAP install/removal, electrical checks if applicable, evidence, and troubleshooting still need Owner-approved documentation.",
      "Pole": "Components/accessories, Delivery/Swap install/removal, mounting/anchoring/height/safety rules if applicable, evidence, and troubleshooting still need Owner-approved documentation."
    },
    "truck_spares": [
      "Confirm whether Sniper should support a standalone spare-battery batch and, if so, its exact battery label/specification.",
      "Confirm whether Spotter should support a standalone spare-battery batch and, if so, its exact battery label/specification.",
      "Document the exact physical Recon II battery specification behind the current Recon II Battery database label.",
      "Document any product-specific spare-kit contents beyond the checked unit and supported battery batches."
    ]
  },
  "workflows": {
    "delivery": {
      "label": "Delivery",
      "default_flow": [
        "owner_assignment",
        "it_prep",
        "it_service_handoff",
        "service_verification",
        "service_checkout",
        "field_work",
        "completion"
      ],
      "required_create_fields": [
        "ticket_no",
        "site",
        "scheduled_for",
        "scheduled_time",
        "equipment_manifest",
        "equipment_numbers",
        "job_description",
        "parts",
        "assignment",
        "notes"
      ],
      "rules": [
        "Delivery normally begins with IT for prepared equipment and can continue to Service through the same MHelpDesk reference."
      ]
    },
    "pickup": {
      "label": "Pickup",
      "default_flow": [
        "owner_assignment",
        "service_pickup",
        "service_return",
        "it_intake",
        "manager_inventory",
        "completion"
      ],
      "required_create_fields": [
        "ticket_no",
        "site",
        "scheduled_for",
        "scheduled_time",
        "equipment_manifest",
        "equipment_numbers",
        "job_description",
        "assignment",
        "notes"
      ],
      "rules": [
        "Pickup starts with Service.",
        "IT work cannot begin until Service returns the equipment into IT Intake."
      ]
    },
    "swap": {
      "label": "Swap",
      "default_flow": [
        "owner_assignment",
        "it_prep_new_unit",
        "it_service_handoff",
        "service_swap",
        "old_unit_return",
        "it_intake_old_unit",
        "field_completion"
      ],
      "required_create_fields": [
        "ticket_no",
        "site",
        "scheduled_for",
        "scheduled_time",
        "equipment_manifest",
        "equipment_numbers",
        "job_description",
        "parts",
        "assignment",
        "notes"
      ],
      "rules": [
        "Always track NEW UNIT OUT and OLD UNIT RETURNING as separate obligations under the same work context."
      ]
    },
    "service": {
      "label": "Service",
      "default_flow": [
        "owner_assignment",
        "service_field_work",
        "completion"
      ],
      "required_create_fields": [
        "ticket_no",
        "site",
        "scheduled_for",
        "scheduled_time",
        "equipment_manifest",
        "equipment_numbers",
        "job_description",
        "parts",
        "assignment",
        "notes"
      ],
      "rules": [
        "Service-only work does not require a fake IT handoff unless the job actually requires prepared equipment from IT."
      ]
    },
    "return": {
      "label": "Return",
      "default_flow": [
        "service_return",
        "it_intake",
        "manager_inventory",
        "completion"
      ]
    },
    "intake": {
      "label": "IT Intake",
      "default_flow": [
        "it_receive",
        "condition_checks",
        "inventory_confirmation",
        "completion"
      ]
    },
    "handoff": {
      "label": "IT → Service Handoff",
      "default_flow": [
        "it_ready",
        "it_release",
        "service_receipt_verification"
      ]
    }
  },
  "lifecycle_states": {
    "prep": [
      "draft",
      "released",
      "closed"
    ],
    "unit": [
      "it_prep",
      "ready_for_service",
      "deployed",
      "returned_waiting_it",
      "waiting_manager",
      "shop_inventory",
      "assigned_to_tech"
    ],
    "spare_outcomes": [
      "used",
      "returned_unused"
    ],
    "photo_scan": [
      "match",
      "mismatch",
      "unreadable"
    ]
  },
  "write_policy": {
    "principle": "Language understanding may propose an action, but production mutation must use an approved, role-checked database operation and confirm the result before Vision reports success.",
    "actions": [
      "CREATE",
      "UPDATE",
      "ASSIGN",
      "HANDOFF",
      "VERIFY",
      "COMPLETE",
      "CANCEL",
      "RETURN",
      "CHECK_OUT",
      "CHECK_IN",
      "OWNER_APPROVE"
    ]
  }
};
  const shared=root.TechCheckRules;
  if(shared){
    data.shared_rules_version=shared.version;
    data.equipment_aliases={...data.equipment_aliases,...(shared.equipmentAliases||{})};
    for(const [name,rule] of Object.entries(shared.equipment||{})){
      if(!data.equipment[name])data.equipment[name]={documented:'partial'};
      const target=data.equipment[name];
      target.category=rule.category||target.category;
      if(typeof rule.required_batteries==='number')target.required_it_batteries=rule.required_batteries;
      target.shared_required_batteries=rule.required_batteries;
      if(Array.isArray(rule.purposes))target.purposes=[...rule.purposes];
      if(rule.battery_label)target.battery_label=rule.battery_label;
      if(shared.itChecklist){
        const required=typeof rule.required_batteries==='number'?rule.required_batteries:1;
        const sample={equipment_type:name,purpose:'DELIVERY',required_battery_count:required};
        target.shared_it_checklist=shared.itChecklist(sample,1).map(step=>({
          kind:step.kind,field:step.field,label:step.label
        }));
        target.shared_it_check_fields=target.shared_it_checklist.map(step=>step.field);
      }
    }
    if(data.equipment.Helios&&shared.heliosPorts){
      data.equipment.Helios.network_rules=[
        {component:'Camera 1',ports:[...shared.heliosPorts.camera1],where:'device and router'},
        {component:'Camera 2',ports:[...shared.heliosPorts.camera2],where:'device and router'},
        {component:'PTZ',ports:[...shared.heliosPorts.ptz],where:'device and router'},
        {component:'IP Speaker',ports:[...shared.heliosPorts.speaker],where:'device and router'}
      ];
    }
    data.shared_helios_field_install=shared.heliosFieldChecklist?[...shared.heliosFieldChecklist]:[];
    data.shared_it_intake_checklist=shared.itIntakeChecklist?[...shared.itIntakeChecklist]:[];
    if(data.equipment.Helios)data.equipment.Helios.shared_field_install_checklist=data.shared_helios_field_install;
    if(data.workflows?.intake)data.workflows.intake.shared_checklist=data.shared_it_intake_checklist;
    data.shared_service_rules={
      solar_spotter_delivery:shared.automaticServiceSolarPlan
        ? shared.automaticServiceSolarPlan([{category:'device',label:'Solar Spotter',qty:1}],'delivery')
        : null,
      ranger_delivery:shared.automaticServiceSolarPlan
        ? shared.automaticServiceSolarPlan([{category:'device',label:'Ranger',qty:1}],'delivery')
        : null,
      helios_service_evidence:shared.serviceSolarEvidenceRequirements
        ? shared.serviceSolarEvidenceRequirements({need_solar:true,need_stand:false,has_helios:true,solar_spotter_count:0})
        : []
    };
  }
  const deepFreeze=(value)=>{
    if(!value||typeof value!=='object'||Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach(k=>deepFreeze(value[k]));
    return value;
  };
  root.OnSiteVisionKnowledge=deepFreeze(data);
})(typeof window!=='undefined'?window:globalThis);
