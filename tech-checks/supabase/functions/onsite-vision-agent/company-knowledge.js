/* Cameras On Site — OnSite Vision Company Knowledge
 * Version: company-knowledge-v6
 * Read-only browser knowledge foundation. Database triggers/RPCs remain authoritative.
 */
(function(root){
  'use strict';
  const data={
  "version": "company-knowledge-v6",
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
      "purposes": ["DELIVERY","SWAP","BACKUP"],
      "network_ports": {
        "required_router_ports": [81,554],
        "purpose": "Central Station camera access"
      },
      "it_checks": [
        "exact unit tag",
        "power on",
        "1 × LiTime 12V 110Ah battery attached/ready",
        "MPPT firmware/configuration updated",
        "MPPT tested",
        "solar charging verified through the MPPT with the battery attached",
        "camera/network online",
        "router ports 81 and 554 available/configured",
        "camera video works",
        "verify recording to the internal SD card before formatting it",
        "format the SD card after recording verification and leave it ready",
        "Central Station receives all required information for customer deployments",
        "customer shared-email/camera access completed for customer deployments",
        "functions tested",
        "safe/ready for the IT → Service handoff"
      ],
      "automatic_service_requirements": {
        "delivery": "1 removable solar panel per Ranger",
        "battery": "1 × LiTime 12V 110Ah per Ranger",
        "pre_trip_evidence": ["battery proof","MPPT/charging readings proof"],
        "field_requirement": "At the site, Service must verify the Ranger is up to date in the Victron Bluetooth app before Tech Check completion."
      },
      "swap_rule": "A Ranger SWAP replacement follows the same customer-deployment readiness checks as DELIVERY. Ranger field Victron verification is still required before close.",
      "sources": [
        "Owner instruction 2026-09-19",
        "TechCheckRules Ranger profile",
        "add_it_prep_item",
        "save_it_camera_family_checks_v1",
        "save_it_prep_item_draft",
        "verify_delivery_item_checks",
        "enforce_camera_family_before_release_v1",
        "enforce_it_solar_delivery_before_release",
        "service_solar_context_v2",
        "save_my_service_solar_check_v4",
        "save_my_ranger_field_check_v1",
        "enforce_standard_field_before_close_v1"
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
      "components": [
        "Avigilon ES appliance",
        "2 × Avigilon bullet cameras",
        "InHand router",
        "2 × 12V 35Ah batteries"
      ],
      "platform": "Avigilon Unity",
      "network_and_monitoring": {
        "router": "InHand router",
        "sim": "Active SIM card required for deployable Sniper work",
        "public_ip_source": "Use the public IP recorded for the exact unit in the 2026 Unit Tracker in Google Sheets",
        "monitoring": "For customer deployment, send all required unit/monitoring information to the Monitoring Center and confirm the unit is set up on the monitoring side"
      },
      "it_delivery_flow": [
        "Pull the assigned Sniper from the shelf.",
        "Plug the Sniper into 120V.",
        "Verify the Avigilon ES appliance is reachable using the public IP recorded for that unit in the 2026 Unit Tracker.",
        "Install an active SIM card in the InHand router and verify the router is online.",
        "Verify the Sniper is on the Avigilon Unity platform.",
        "Send the required information to the Monitoring Center and verify the monitoring-side setup.",
        "Confirm the customer has access to the Avigilon Unity app.",
        "Confirm 2 × 12V 35Ah batteries are inside the Sniper.",
        "Complete the existing recording/storage/functions/safe-ready checks, IT photo with visible matching unit tag, and IT signature before the IT → Service handoff."
      ],
      "it_swap_rule": "A Sniper SWAP prepares the replacement Sniper the same way as a Sniper DELIVERY before the IT → Service handoff.",
      "service_field_flow": [
        "Physically verify the Sniper has 2 batteries inside.",
        "At the site, set up the Sniper on the pole or stand specified by the Service order.",
        "Call the IT Tech and work together to focus and adjust both cameras and verify signal.",
        "Take field pictures of the installed Sniper and its unit number/tag and upload them to Tech Check.",
        "Submit the completed Sniper work for finalization/completion so the Owner can review it in the Owner app."
      ],
      "swap_return_rule": "After a Sniper SWAP, bring the old field Sniper back and record it through the normal Service Return → IT Intake flow.",
      "truck_spare_rule": "A Sniper BACKUP / truck spare follows the existing checked-out spare workflow. If unused, return it to Shop Inventory and remove it from the Service truck. If used for a swap, the replaced field Sniper returns through Service Return → IT Intake.",
      "evidence": [
        "IT: exactly one clear handoff photo per unit with visible matching unit tag plus IT signature",
        "Service: field pictures of the installed Sniper and unit number/tag",
        "SWAP: returning old field unit must have the normal Service Return evidence before IT Intake"
      ],
      "unknowns": [
        "Exact Sniper camera/router port map and port-forwarding values",
        "Exact Avigilon Unity enrollment/programming sequence beyond the verified operational checks",
        "Exact Monitoring Center data fields/package beyond sending all required monitoring information",
        "Exact Avigilon ES appliance and bullet-camera model numbers if model-specific procedures are required",
        "Approved Sniper troubleshooting tree"
      ],
      "teaching_needed": [
        "Document the exact Sniper port map and router port-forwarding values.",
        "Document any additional Avigilon Unity enrollment/programming steps that IT must perform beyond the verified operational checks.",
        "Document the exact Monitoring Center fields/information package if Vision should validate individual monitoring fields.",
        "Provide model numbers only if the ES appliance or bullet-camera model changes the required procedure.",
        "Document the approved Sniper troubleshooting sequence for power, batteries, SIM/InHand router, public-IP access, Unity, video/recording/storage, and monitoring."
      ],
      "sources": [
        "Owner instruction 2026-09-19",
        "TechCheckRules Sniper profile",
        "add_it_prep_item",
        "save_it_prep_item_draft",
        "verify_delivery_item_checks",
        "release_prep",
        "handoff evidence / Service Return → IT Intake workflow",
        "app.js BATTERY metadata"
      ]
    },
    "Spotter": {
      "category": "device",
      "documented": "partial",
      "required_it_batteries": 0,
      "purposes": ["DELIVERY","SWAP","BACKUP"],
      "components": [
        "4 cameras",
        "internal router",
        "NVR or SD-card recording/storage depending on the unit",
        "built-in top-mounted component — exact component name not yet confirmed"
      ],
      "platform": "Alibi app",
      "network_ports": {
        "required_router_ports": [81,554],
        "purpose": "Central Station camera access"
      },
      "build_state": "Spotter units are already built and are normally already programmed because they are older units; IT still verifies the actual unit is programmed/visible before deployment.",
      "it_delivery_flow": [
        "Pull the assigned Spotter and plug/power it up.",
        "Verify the unit is programmed and comes up in the Alibi app.",
        "Verify the internal router/network is online.",
        "Verify router ports 81 and 554 are available/configured so Central Station can reach the cameras.",
        "Verify all 4 cameras work.",
        "Verify recording works on the NVR or SD-card storage.",
        "Format the NVR or SD-card storage as applicable and leave it ready.",
        "Send the required paperwork/information to Central Station and verify Central Station can see the unit.",
        "Add the customer-provided email address(es) so the customer has access.",
        "Verify the Service order says whether the Delivery needs a pole or a stand; Service physically grabs/verifies that support equipment.",
        "Take the required IT unit-tag photo, sign, and create the IT → Service handoff."
      ],
      "swap_rule": "Prepare the replacement Spotter with the same customer-deployment checks as DELIVERY, but do not add another pole or stand for the swap.",
      "swap_return_rule": "The replaced field Spotter must be brought back by Service and recorded through Service Return → IT Intake before the Tech Check can close.",
      "battery_rule": "Spotter has no battery requirement.",
      "unknowns": [
        "Exact name/function of the top-mounted component described by the Owner",
        "Exact camera/router/NVR/SD hardware models if model-specific procedures differ",
        "Exact reprogramming sequence for a Spotter that is not already programmed",
        "Approved Spotter troubleshooting tree"
      ],
      "teaching_needed": [
        "Name the Spotter top-mounted component if Vision needs to identify/check it specifically.",
        "Provide exact camera/router/NVR/SD model details only if they change the procedure.",
        "Document the reprogramming sequence for a Spotter that fails the already-programmed check.",
        "Document the approved Spotter troubleshooting sequence."
      ],
      "sources": [
        "Owner instruction 2026-09-19",
        "TechCheckRules Spotter profile",
        "add_it_prep_item",
        "save_it_camera_family_checks_v1",
        "save_it_prep_item_draft",
        "verify_delivery_item_checks",
        "enforce_camera_family_before_release_v1",
        "enforce_standard_field_before_close_v1",
        "handoff evidence / Service Return → IT Intake workflow"
      ]
    },
    "Recon 2": {
      "category": "device",
      "display_name": "Recon II",
      "documented": "partial",
      "required_it_batteries": "dynamic minimum 1",
      "purposes": ["DELIVERY","SWAP","BACKUP"],
      "platform": "Reconeyez app",
      "network_ports": {
        "required_router_ports": [81,554],
        "purpose": "Central Station camera access"
      },
      "configuration_rules": [
        "Record how many cameras are going on this Recon II deployment.",
        "Camera count is separate from battery quantity.",
        "Verify whether the actual unit is programmed and visible in the Reconeyez app; older units are often already programmed.",
        "After the unit is programmed/ready, IT records and prepares the actual battery quantity.",
        "The current database minimum is 1 battery, but the exact physical Recon II battery specification is still undocumented."
      ],
      "it_delivery_flow": [
        "Enter the Recon II camera count for this deployment.",
        "Verify the unit is programmed and visible in the Reconeyez app.",
        "Verify the network/cellular connection is online.",
        "Verify router ports 81 and 554 are available/configured so Central Station can reach the cameras.",
        "Verify the configured camera set works and records.",
        "Prepare/record the actual battery quantity after the unit is programmed and ready.",
        "Verify storage/recording is ready.",
        "For customer deployment, complete Central Station information and required customer access.",
        "Verify whether the Service order requires a pole or stand; Service physically grabs/verifies that support equipment.",
        "Complete the required IT unit-tag photo, signature, and IT → Service handoff."
      ],
      "swap_rule": "A Recon II SWAP replacement follows the same customer-deployment readiness checks as DELIVERY.",
      "swap_return_rule": "The replaced field Recon II must be brought back by Service and recorded through Service Return → IT Intake before the Tech Check can close.",
      "unknowns": [
        "Exact Recon II battery model/specification behind the database label Recon II Battery",
        "Exact internal camera/router/storage hardware models if model-specific procedures differ",
        "Exact programming sequence for a Recon II that is not already programmed",
        "Approved Recon II troubleshooting tree"
      ],
      "teaching_needed": [
        "Document the exact physical Recon II battery model/specification.",
        "Provide internal hardware model details only if they change required checks.",
        "Document the programming sequence for a Recon II that is not already programmed.",
        "Document the approved Recon II troubleshooting sequence."
      ],
      "sources": [
        "Owner instruction 2026-09-19",
        "TechCheckRules Recon II profile",
        "add_it_prep_item",
        "configure_it_prep_item",
        "save_it_camera_family_checks_v1",
        "save_it_prep_item_draft",
        "verify_delivery_item_checks",
        "enforce_camera_family_before_release_v1",
        "enforce_standard_field_before_close_v1"
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
        "Detailed product-specific field installation SOP",
        "Purpose parity: shared rules document DELIVERY/SWAP, while current add/configure RPCs do not explicitly reject BACKUP",
        "Standalone Solar Pole Service-close enforcement: service_solar_context_v2 can surface solar checkout, but enforce_service_solar_check_before_close only hard-gates Solar Spotter, Ranger, and Helios"
      ],
      "teaching_needed": [
        "Confirm whether Solar Pole BACKUP should be allowed or explicitly prohibited so shared rules and server behavior can be brought into parity.",
        "Confirm the intended Service checkout/close requirements for a standalone Solar Pole delivery before adding product-specific mandatory evidence.",
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
        "Detailed product-specific field installation SOP",
        "Purpose parity: shared rules document DELIVERY/SWAP, while current add/configure RPCs do not explicitly reject BACKUP"
      ],
      "teaching_needed": [
        "Confirm whether Pole BACKUP should be allowed or explicitly prohibited so shared rules and server behavior can be brought into parity.",
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
      "Sniper": "Core hardware, Unity/InHand/public-IP workflow, Delivery/SWAP preparation, Service field sequence, evidence, return, and truck-spare handling are now Owner-documented. Remaining gaps are exact ports, any deeper Unity programming sequence, exact Monitoring Center field list, model-specific details if needed, and troubleshooting.",
      "Spotter": "Core 4-camera/internal-router/Alibi/no-battery workflow, ports 81/554, NVR-or-SD recording, Central Station/customer access, Delivery support selection, and SWAP return are Owner-documented. Remaining gaps are the exact top-mounted component name, model-specific details if needed, reprogramming steps, and troubleshooting.",
      "Recon 2": "Reconeyez/programmed-unit verification, separate camera count and battery quantity, ports 81/554, Delivery support selection, and SWAP return are Owner-documented. Remaining gaps are the exact physical battery specification, model-specific internals if needed, reprogramming steps, and troubleshooting.",
      "Solar Pole": "Components/accessories, detailed field install/removal, solar/power/safety rules, evidence, troubleshooting, BACKUP-purpose parity, and standalone Service-close behavior still need Owner-approved documentation.",
      "110V Stand": "Components/accessories, SWAP install/removal, electrical checks if applicable, evidence, and troubleshooting still need Owner-approved documentation.",
      "Pole": "Components/accessories, Delivery/Swap install/removal, mounting/anchoring/height/safety rules if applicable, evidence, troubleshooting, and BACKUP-purpose parity still need Owner-approved documentation."
    },
    "truck_spares": [
      "Confirm whether Sniper should support a standalone spare-battery batch and, if so, its exact battery label/specification.",
      "Spotter has no battery requirement; do not invent a standalone Spotter spare-battery batch.",
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
    if(data.equipment.Sniper&&shared.sniperProfile)data.equipment.Sniper.shared_sniper_profile=shared.sniperProfile;
    if(data.equipment.Spotter&&shared.spotterProfile)data.equipment.Spotter.shared_spotter_profile=shared.spotterProfile;
    if(data.equipment['Recon 2']&&shared.recon2Profile)data.equipment['Recon 2'].shared_recon2_profile=shared.recon2Profile;
    if(data.equipment.Ranger&&shared.rangerProfile)data.equipment.Ranger.shared_ranger_profile=shared.rangerProfile;
    if(data.workflows?.intake)data.workflows.intake.shared_checklist=data.shared_it_intake_checklist;
    if(data.truck_spares&&shared.truckSpareRules){
      data.truck_spares.shared_rules=shared.truckSpareRules;
    }
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
