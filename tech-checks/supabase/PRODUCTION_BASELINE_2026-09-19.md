# Tech Check Production Backend Baseline — 2026-09-19

This file records the **live Supabase production structure** that existed when the OnSite Vision knowledge/workflow refactor began.

It is documentation, not a migration. Existing production RPCs, RLS policies, triggers, and database gates remain authoritative.

## Project

- Supabase project: `goqrnolcvqnirjmzaeyk`
- Public tables: 23
- Public functions/RPCs/triggers functions: see generated types
- Public trigger events: see live database
- RLS policies: see live database
- Recorded migrations in production: 74
- Edge Functions: 5

## Important architectural rule

OnSite Vision must **not** replace server-side validation with browser logic. The existing database gates remain the final authority for actions such as IT release, Service handoff, Helios readiness, solar checkout, truck-spare checkout, returns, and Owner final verification.

## Public tables

- `public.profiles` — RLS enabled — 11 current row(s)
- `public.prep_tickets` — RLS enabled — 1 current row(s)
- `public.prep_items` — RLS enabled — 1 current row(s)
- `public.reports` — RLS enabled — 9 current row(s)
- `public.morning_checks` — RLS enabled — 0 current row(s)
- `public.handoff_evidence` — RLS enabled — 2 current row(s)
- `public.unit_returns` — RLS enabled — 0 current row(s)
- `public.password_reset_requests` — RLS enabled — 0 current row(s)
- `public.unit_registry` — RLS enabled — 1 current row(s)
- `public.job_assignments` — RLS enabled — 15 current row(s)
- `public.notification_preferences` — RLS enabled — 4 current row(s)
- `public.app_notifications` — RLS enabled — 39 current row(s)
- `public.push_subscriptions` — RLS enabled — 2 current row(s)
- `public.push_config` — RLS enabled — 3 current row(s)
- `public.technician_training_state` — RLS enabled — 4 current row(s)
- `public.team_access_history` — RLS enabled — 7 current row(s)
- `public.asset_inventory` — RLS enabled — 0 current row(s)
- `public.asset_inventory_history` — RLS enabled — 0 current row(s)
- `public.service_solar_checks` — RLS enabled — 0 current row(s)
- `public.service_solar_evidence` — RLS enabled — 0 current row(s)
- `public.workflow_checkpoints` — RLS enabled — 48 current row(s)
- `public.owner_ai_alert_acknowledgements` — RLS enabled — 0 current row(s)
- `public.truck_spare_batteries` — RLS enabled — 0 current row(s)

## Edge Functions

- `bootstrap-owner` — v4 — JWT not required
- `admin-user-management` — v5 — JWT required
- `cameras-on-site-app` — v1 — JWT not required
- `password-reset-request` — v1 — JWT not required
- `send-techcheck-push` — v3 — JWT required

## Recorded production migrations

- `20260917031141` — cameras_on_site_secure_workflow
- `20260917031211` — lock_down_function_privileges
- `20260917031805` — add_profile_email
- `20260917032541` — harden_cameras_on_site_permissions_and_realtime
- `20260917032651` — enable_profiles_realtime
- `20260917033313` — reduce_exposed_workflow_functions
- `20260917034701` — add_username_auth_profiles
- `20260917034830` — derive_username_from_internal_auth_id
- `20260917041204` — rename_service_close_to_equipment_verification
- `20260917042021` — add_delivery_equipment_fields
- `20260917042053` — delivery_workflow_rules
- `20260917042349` — add_delivery_sd_recording_checks
- `20260917042858` — add_owner_start_fresh_reset
- `20260917084444` — it_prep_editing_controls
- `20260917084940` — lock_down_tech_check_rpcs
- `20260917085000` — remove_anon_rpc_grants
- `20260917085343` — add_stand_equipment_options
- `20260917091838` — service_handoff_deployed_to_field_wording
- `20260917093512` — add_handoff_name_stamps_and_pass_fail_morning_checks
- `20260917095002` — audit_test_mode_and_owner_workspace_controls
- `20260917100513` — detailed_morning_inspection_reports
- `20260917100725` — handoff_photos_and_signatures
- `20260917124313` — preserve_per_unit_handoff_signatures
- `20260917124406` — configure_individual_it_prep_unit
- `20260917130201` — unit_by_unit_it_wizard
- `20260917131500` — equipment_specific_checks_and_matching_photos
- `20260917140502` — require_it_photo_unit_tag_match
- `20260917191330` — add_unit_return_intake_tracking
- `20260917191948` — allow_service_return_photo_update
- `20260917233226` — add_customer_email_app_deployment_check
- `20260917234126` — add_owner_remove_unit_return
- `20260918003123` — secure_technician_password_lifecycle
- `20260918004827` — add_unit_lifecycle_registry_and_conflict_protection
- `20260918034651` — add_job_assignments_and_notification_preferences
- `20260918034738` — grant_assignment_notification_access
- `20260918035434` — improve_manual_job_dispatch_details
- `20260918114518` — add_ticket_parts_quantities
- `20260918121614` — add_techcheck_web_push_subscriptions
- `20260918122127` — document_push_config_no_client_access
- `20260918141729` — department_dispatch_training_and_named_handoff
- `20260918142305` — service_task_mode_and_dual_dispatch
- `20260918143056` — team_archive_and_equipment_inventory
- `20260918143725` — restrict_new_workflow_rpc_execution
- `20260918143806` — enable_team_equipment_realtime
- `20260918143839` — allow_assigned_inventory_in_it_prep
- `20260918145038` — assignment_equipment_manifest
- `20260918145705` — align_prep_item_stand_types
- `20260918150631` — owner_assignment_requested_unit_count
- `20260918151830` — owner_daily_schedule_assignments
- `20260918153048` — it_prep_unit_and_stand_manifest
- `20260918153533` — enforce_unit_stand_manifest_on_release
- `20260918161557` — add_team_notification_emails
- `20260918164239` — service_solar_helios_verification_flow
- `20260918164848` — enable_service_solar_realtime
- `20260918171426` — auto_solar_spotter_ranger_service_checkout
- `20260918171708` — fix_helios_and_ranger_it_readiness
- `20260918172048` — support_multiple_solar_spotter_stands
- `20260918172244` — require_it_support_physical_readiness
- `20260918210416` — add_workflow_checkpoints_and_owner_restore
- `20260918211800` — allow_owner_department_role_walkthrough
- `20260918212613` — owner_reassign_existing_job
- `20260918231042` — owner_ai_alert_acknowledgements
- `20260918231532` — owner_ai_alert_resolution_tracking
- `20260919004539` — helios_device_router_port_checks
- `20260919040713` — harden_helios_it_release_gate
- `20260919042119` — truck_spares_checkout_flow
- `20260919042254` — mark_truck_spare_checkout
- `20260919042544` — separate_backup_from_customer_delivery_checks
- `20260919043238` — require_it_truck_spare_checkout
- `20260919043359` — lock_it_checked_out_truck_spares
- `20260919043643` — lock_truck_spare_trigger_execution
- `20260919143028` — helios_delivery_swap_spare_v108
- `20260919151954` — job_assignment_scheduled_time_v111

## Schema drift note

At the start of this refactor, production had 73 recorded migrations at the start of the refactor while the repository contained only a small subset of migration SQL files. The generated `database.types.ts` and this baseline are now checked into the repository so future work has a source-controlled reference.

This baseline does **not** pretend to reconstruct the missing historical SQL. Future schema changes should be added to `tech-checks/supabase/migrations/` and applied through named migrations.

## Critical production rules observed

- Work types currently include Delivery, Swap, Pickup, and Service.
- Pickup starts with Service; IT Intake follows the Service return.
- IT → Service handoffs use the same MHelpDesk reference.
- Helios release is protected by server-side checks for required build/programming, device/router ports, Cerbo/VRM, storage, battery, monitoring/customer-account requirements where applicable, and truck-spare checkout.
- Solar Spotter and Ranger Service checkout rules are enforced server-side.
- Helios field installation requires Service proof/signature and Owner final verification.
- Helios Swap tracks NEW UNIT OUT separately from OLD UNIT RETURNING.
- Unit lifecycle is synchronized through `unit_registry`.
- Workflow mutations for major tables are captured in `workflow_checkpoints`.
- Photo/tag scan results distinguish match, mismatch, and unreadable states.
- The private `handoff-evidence` storage bucket contains workflow evidence.

## Next architecture step

The new Company Knowledge Layer and Workflow Engine should consume these production facts while gradually replacing duplicated front-end business-rule implementations. No database gate should be removed until parity testing proves the shared engine is equivalent or stricter.

## Phase 2 live job context

Migration `onsite_vision_job_context_v1` added the read-only RPC `get_tech_check_job_context_v1(text)`.

Safety characteristics:

- `SECURITY INVOKER` — caller RLS remains in effect.
- Stable/read-only function; it does not mutate Tech Check records.
- EXECUTE granted to `authenticated` only.
- EXECUTE revoked from `anon` and `public`.
- Returns one structured context object containing assignments, the preferred prep ticket, prep items, Service solar state, handoff evidence, solar evidence, returns, unit lifecycle, inventory context, truck spares, and workflow checkpoints visible to the caller.
- Derives `summary.effective_work_type` from actual prep-item purpose first, preventing older `job_assignments.work_type` values from overriding a DELIVERY or SWAP prep workflow.

Production migration count after Phase 2: **74**.


## Phase 3 server AI agent

Supabase Edge Function `onsite-vision-agent` was added as the protected natural-language reasoning layer.

Security and behavior:

- Edge Function JWT verification is enabled.
- The function re-validates the caller as an active Owner/Admin.
- The agent uses a user-scoped Supabase client so existing RLS remains active for read tools.
- The model has no SQL tool and no production write tool.
- Approved tools are limited to live job context, workflow analysis, unit lookup, active/date job lists, technician lookup, and Cameras On Site company knowledge.
- Write requests are returned as structured `proposed_action` objects and must pass through the existing Tech Check confirmation/write paths.
- The default model is `gpt-5.6-sol` when the `OPENAI_API_KEY` Edge Function secret is configured.
- `ONSITE_VISION_MODEL` can override the default model.
- If the model credential is absent or the agent is unavailable, the browser falls back to the deterministic Vision implementation.
- The client shows **AI LIVE** only when the authenticated agent status endpoint confirms model configuration; otherwise it shows **DATA LIVE**.

This phase does not add autonomous writes.


## Phase 4 confirmed action + audit layer

Production now has **76 recorded migrations**.

New table:

- `vision_action_audit`

New owner-gated RPCs:

- `vision_prepare_action_v1`
- `vision_execute_action_v1`
- `vision_cancel_action_v1`

Action safety contract:

- The AI model still has **no write tool**.
- AI/user intent is first canonicalized into a proposed action.
- Preparing an action records the request, canonical payload, validation result, and a before-state snapshot.
- Supported one-click execution currently covers assignment/reassignment, schedule changes, cancellation of one unambiguous active assignment, and Owner final Helios verification.
- Execution occurs only after explicit Owner confirmation.
- Successful execution records the after-state.
- Failed execution records the authoritative database error and leaves the job gated by the existing workflow rules.
- Handoff, return, check-in, checkout, generic completion, and verification requests remain guided workflows when required evidence/checklist detail is not already sufficient.
- `vision_action_audit` has RLS enabled.
- Authenticated users have direct **SELECT only** on the audit table; all mutations are restricted to the owner-gated RPCs.
- Anonymous users cannot execute the action RPCs.

Production QA verified that attempting Owner final approval on MHelpDesk #22712 was rejected by the existing Helios rule with:

`Service has not submitted the Helios field installation`

The action was recorded as `failed`, the before-state was preserved, and the operational job remained unchanged.

A second QA proposal for assigning #22712 to the Service department was successfully canonicalized and then cancelled before execution, proving prepare/cancel behavior without changing the operational assignment.


## Phase 5 persistent conversations + managed knowledge

Production now has **77 recorded migrations**.

New Owner-private conversation tables:

- `vision_conversations`
- `vision_messages`

New managed knowledge tables:

- `vision_knowledge_entries`
- `vision_knowledge_versions`

New RPCs:

- `vision_save_conversation_v1`
- `vision_load_conversations_v1`
- `vision_archive_conversation_v1`
- `vision_save_knowledge_entry_v1`
- `vision_list_knowledge_v1`
- `vision_search_knowledge_v1`

Conversation behavior:

- Existing localStorage conversations remain a local fallback.
- On authenticated Owner startup, local and cloud conversations are merged by conversation id and newest update time.
- Existing device conversations are migrated into the Owner's private cloud history.
- Draft work-order state and active MHelpDesk ticket context persist with the conversation.
- Conversation writes occur through owner-gated RPCs.
- Cloud-restored assistant HTML is sanitized before rendering.
- Old action confirmation buttons expire after a new browser session rather than remaining clickable without their in-memory pending action.

Knowledge behavior:

- `draft` — saved for Owner editing but never used as company truth by Vision.
- `approved` — eligible for OnSite Vision company-rule grounding.
- `retired` — preserved/history-visible but excluded from AI grounding.
- Every edit increments the entry version.
- The prior version is stored in `vision_knowledge_versions`.
- Reviewer name and review timestamp are recorded when an entry is approved.
- The server AI agent combines approved managed knowledge with the code-based Company Knowledge Layer.
- Live database enforcement remains the highest authority.
- If approved managed knowledge conflicts with a live database rule, the database rule wins.
- If approved managed knowledge conflicts with the code baseline, Vision is instructed to report the conflict instead of silently choosing one.

Security:

- RLS is enabled on all four Phase 5 tables.
- Authenticated users have direct SELECT only.
- All conversation and knowledge writes go through authenticated owner-gated RPCs.
- Anonymous users cannot execute the Phase 5 RPCs.

Production QA verified:

- A conversation containing a draft, active ticket, user message, and assistant response persisted and loaded correctly in a later committed read.
- A test knowledge entry saved as Draft, then was approved.
- Approval advanced its version from 1 to 2 and recorded the Owner reviewer/timestamp.
- The approved entry became searchable as `COMPANY RULE`.
- A version-history row existed for the prior Draft version.
- QA conversation and knowledge records were deleted after verification so they do not appear in the Owner workspace.


## Phase 6 shared rule parity

Phase 6 required **no new Supabase schema migration**. Production remains at **77 recorded migrations**.

New browser/runtime source of truth:

- `tech-checks/tech-check-rules.js` — `rules-v2`

The shared runtime is now consumed by both the technician application and OnSite Vision for:

- canonical device/stand types and equipment aliases
- equipment-manifest normalization
- battery-count rules
- IT equipment checklist generation
- IT readiness calculation
- Helios device/router port requirements
- Ranger MPPT/PV requirements
- Solar Spotter/Ranger automatic Service checkout derivation
- Service solar/Helios evidence minimums
- Service solar battery-plan calculation
- 13-step Helios field-install checklist and exact RPC parameter mapping
- 15-step IT Intake checklist

Parity safeguards:

- Existing technician functions retain legacy fallback implementations if the shared runtime fails to load during this transition.
- Existing Supabase triggers/RPCs remain the final authority.
- `save_it_helios_deploy_checks_v1` continues mapping the specific Helios 120V battery-box charging check into the legacy `delivery_batteries_charged_ok` compatibility field.
- The 13 shared Helios field-install RPC parameter names were verified against the live PostgreSQL `pg_proc.proargnames` contract.
- Vision Company Knowledge v3 exposes the same shared IT, Helios field, and IT Intake checklists.
- Workflow Engine v3 uses shared equipment normalization.
- Deployed `onsite-vision-agent` v5 contains byte-identical copies of the browser shared rules, Company Knowledge, and Workflow Engine.
- No photo/signature/handoff/return/Owner-final-verification database gate was weakened or removed.

Release identifiers after Phase 6:

- Tech Check technician workflow: `release-qa-v120`
- Main loader: `startup-fast-v34`
- OnSite Vision: `vision-workspace-v16`
- Shared rules: `rules-v2`
- Company Knowledge: `company-knowledge-v3`
- Workflow Engine: `workflow-engine-v3`
- Edge agent: v5
- Service-worker cache: v76

## Phase 7 company brain / product knowledge pass

Phase 7 required **no new Supabase schema migration**. Production remains at **77 recorded migrations**.

Verified product knowledge promoted into the shared source:

- Sniper requires **2 × 12V 35Ah batteries**. The quantity remains enforced by the live prep RPCs; the battery specification was already present in the active `app.js` metadata and is now centralized in `TechCheckRules`.
- Truck-spare battery mappings are now centralized in `TechCheckRules` and the technician Truck Spares editor consumes that shared list while retaining its legacy local fallback.
- Live `save_it_truck_spare_battery` currently accepts only:
  - Solar Spotter — `AGM 12V 110Ah`
  - Solar Spotter — `12V 350Ah`
  - Ranger — `LiTime 12V 110Ah`
  - Helios — `Helios Battery Box`
  - Recon 2 — `Recon II Battery`
- `Recon II Battery` is a valid database label, but its exact physical battery model/specification is still **missing information**.
- The current server does not accept standalone Sniper or Spotter spare-battery batches.

Truck-spare lifecycle preserved:

- Spare units are `BACKUP` items and remain separate from the customer/job equipment manifest.
- IT completes the applicable unit check, matching-tag photo/signature flow, and explicit IT checkout before the IT → Service handoff.
- Spare battery batches must be physically present, charged/READY, saved, and explicitly checked out by IT before handoff.
- Service resolves spare units as `used` or `returned_unused`; unused units return directly to Shop Inventory without IT Intake.
- Service records spare-battery quantity used; the remainder is returned unused.
- Existing database checkout/locking gates remain authoritative.

Knowledge-gap behavior:

- Company Knowledge v4 keeps Sniper, Spotter, Recon 2, Solar Pole, 110V Stand, and Pole explicitly **partial** where Cameras On Site procedures are not yet documented.
- Each partial product now exposes exact `teaching_needed` items so Vision can say what is missing instead of filling gaps with generic technical assumptions.
- No approved managed knowledge entries currently supply additional rules for those Phase 7 product families or truck-spare topics.
- Workflow Engine v4 carries `teaching_needed` through product requirements.
- Agent v7 prioritizes truck-spare questions against the server-backed spare mapping before generic product battery metadata and can return the Phase 7 gap inventory.

Unresolved server/shared-rule parity noted but **not changed by assumption**:

- Shared rules currently document Solar Pole and Pole for Delivery/Swap.
- Current `add_it_prep_item` / `configure_it_prep_item` server logic does not explicitly reject `BACKUP` for Solar Pole or Pole.
- `service_solar_context_v2` can surface a standalone Solar Pole in Service solar context, while `enforce_service_solar_check_before_close` hard-gates Solar Spotter, Ranger, and Helios—not a standalone Solar Pole by itself.
- These are now explicit Owner teaching/decision gaps. No RPC, trigger, or workflow gate was changed until the intended company rule is confirmed.

Regression/parity verification after the Phase 7 source changes:

- Helios Delivery remains **31 shared IT checks**.
- Helios ports remain Camera 1 `81/554/1400`, Camera 2 `81/554/1500`, PTZ `81/554/1600`, IP Speaker `81/554/1700`.
- Ranger retains MPPT updated / MPPT tested / PV charging checks.
- Solar Spotter retains **0 IT battery checkout**.
- Browser and Edge Function copies of shared rules, Company Knowledge, and Workflow Engine were byte-identical at verification.
- Deployed `onsite-vision-agent` is **v7 ACTIVE** with JWT verification enabled.
- Live database verification confirmed **77 migrations**, the Sniper quantity rule, and the exact truck-spare battery mapping above.
- No photo, signature, handoff, return, IT Intake, truck-spare checkout, Helios field-install, or Owner-final-verification gate was removed or weakened.

Release identifiers after this Phase 7 pass:

- Tech Check technician workflow: `release-qa-v121`
- Main loader: `startup-fast-v35`
- OnSite Vision workspace: `vision-workspace-v17` (workspace UI unchanged)
- Shared rules: `rules-v3`
- Company Knowledge: `company-knowledge-v4`
- Workflow Engine: `workflow-engine-v4`
- Edge agent: v7
- Service-worker cache: v77



## Phase 7 Sniper Owner teaching pass

Owner instruction captured on 2026-09-19 completes the core Sniper operating flow without inventing the still-undocumented port/programming details.

### Verified Sniper product knowledge

- Hardware: Avigilon ES appliance, 2 × Avigilon bullet cameras, InHand router, and 2 × 12V 35Ah batteries.
- Platform: Avigilon Unity.
- Network: deployable Snipers use an active SIM in the InHand router.
- IT DELIVERY preparation: pull the assigned Sniper from the shelf, plug it into 120V, verify the ES appliance is reachable through the public IP recorded for that exact unit in the 2026 Unit Tracker, confirm Unity/video/recording/storage readiness, send required information to the Monitoring Center, verify monitoring-side setup, and confirm customer Unity app access.
- IT SWAP preparation: the replacement Sniper follows the same customer-deployment readiness flow as DELIVERY before the IT → Service handoff.
- Service field flow: physically verify the two batteries, install the unit on the pole or stand specified by the Service order, call IT to focus/adjust both cameras and verify signal, upload field photos showing the installed unit and unit number/tag, then submit for finalization/completion so the Owner can review it.
- SWAP return: the replaced field Sniper follows Service Return → IT Intake.
- BACKUP/truck spare: remains hardware-ready rather than customer-specific. IT checkout is required. Unused spare returns directly to Shop Inventory and is removed from the Service truck; if used for a swap, the replaced field unit follows Service Return → IT Intake.
- No standalone Sniper spare-battery batch was added; the existing server mapping remains authoritative.

The connected Google Drive search did not surface an accessible file titled 2026 Unit Tracker, so the Unit Tracker/public-IP step is stored as an Owner-approved Cameras On Site procedure rather than as independently connector-verified sheet content.

### Sniper SWAP parity fix

Migration 78 (`sniper_delivery_swap_parity`) records the production function changes. No table or column changes were made.

- `save_it_prep_item_draft` persists and evaluates the customer-deployment readiness fields for Sniper SWAP.
- The 9-argument `verify_delivery_item_checks` accepts Sniper SWAP and requires the full customer-deployment checks.
- `release_prep` blocks the Service handoff if a Sniper SWAP is missing any of those checks.
- `enforce_tech_check_transition_v108` independently blocks a draft → released transition for an incomplete Sniper SWAP.
- Existing Helios, Ranger, Solar Spotter, support-equipment, photo/signature, truck-spare, return/intake, and Owner-verification gates were preserved.

### Remaining Sniper knowledge gaps

Sniper remains intentionally marked `COMPANY RULE — PARTIAL` only for:
- exact camera/router port map and port-forwarding values;
- any deeper Avigilon Unity enrollment/programming sequence beyond the verified operational checks;
- the exact Monitoring Center field/package contents if individual-field validation is desired;
- exact ES appliance / bullet-camera model numbers only if model-specific procedures differ;
- approved Sniper troubleshooting procedures.

### QA / release state

- Shared rules: `rules-v4`
- Company Knowledge: `company-knowledge-v5`
- Workflow Engine: `workflow-engine-v4`
- Tech Check technician workflow: `release-qa-v122`
- Main loader: `startup-fast-v36`
- OnSite Vision workspace: `vision-workspace-v16`
- Edge agent: `onsite-vision-agent-v8` — ACTIVE, JWT verification enabled
- Service worker: `tech-check-field-shell-v78`
- Database migrations: 78
- QA tests: 95

Final source/deployment checks for this pass:
- browser and Edge copies of shared rules, Company Knowledge, and Workflow Engine are byte-identical;
- deployed Edge index/rules/knowledge/workflow files match the GitHub function bundle;
- JavaScript syntax checks passed for shared rules, knowledge, workflow engine, technician wizard, app loader, and service worker;
- `tests.json` parses successfully;
- Sniper SWAP release and persistence gates are present in the live database;
- Tesseract/OCR is not present in the service-worker startup cache.


## Phase 7 Spotter / Recon II / Ranger Owner teaching pass

Owner instruction captured on 2026-09-19 adds the core Spotter, Recon II, and Ranger operating rules.

### Spotter
- 4 cameras, internal router, no batteries.
- Older/prebuilt unit: verify the actual unit is programmed and visible in Alibi before deployment.
- Router ports 81 and 554 must be available/configured for Central Station access.
- Verify all 4 cameras, verify recording, then leave the NVR or SD-card storage formatted/ready.
- Customer deployment sends required monitoring information to Central Station and adds customer-provided email access.
- DELIVERY identifies whether Service needs a pole or stand.
- SWAP does not add another pole/stand; the replaced field Spotter must enter Service Return → IT Intake before close.
- Spotter has an antenna on top.

### Recon II
- Camera count is now tracked separately from battery quantity.
- Verify actual unit programming/visibility in Reconeyez.
- Ports 81 and 554 must be available/configured for Central Station access.
- After programming/readiness, IT prepares the actual battery quantity. The live database minimum remains 1 until exact battery model/rule is taught.
- DELIVERY identifies whether Service needs a pole or stand.
- SWAP replacement uses customer-deployment readiness and the replaced field unit must enter Service Return → IT Intake before close.

### Ranger
- 1 × LiTime 12V 110Ah.
- IT shop test verifies battery/solar charging through MPPT.
- Ports 81 and 554 must be available/configured for Central Station.
- Verify recording before formatting the internal SD card; then leave storage formatted/ready.
- Customer deployments include Central Station information and shared-email/camera access.
- Service must verify the Ranger is up to date in the Victron Bluetooth app in the field before Tech Check can close.

### Database / release
Migration 79 (`camera_family_workflows_v1`) adds camera-family port/programming/camera-count fields, Ranger field verification, release gates, and standard SWAP-return close gates.

Current release:
- shared rules: `rules-v6`
- Company Knowledge: `company-knowledge-v7`
- Workflow Engine: `workflow-engine-v4`
- technician: `release-qa-v124`
- loader: `startup-fast-v38`
- OnSite Vision workspace: `vision-workspace-v16`
- Edge agent: `onsite-vision-agent-v10` ACTIVE with JWT verification
- service worker: `tech-check-field-shell-v81`
- database migrations: 79
- QA tests: 100

Regression checks passed for JavaScript syntax, browser/server bundle parity, deployed Edge parity, live database columns/triggers, cache versions, and absence of Tesseract/OCR from the startup cache. Supabase advisors reported existing project-wide warnings plus the new Ranger verifier foreign-key index as a performance advisory; no new anonymous-execution warning was introduced for the two new RPCs.

- Spotter antenna correction: the Owner clarified the component is the antenna on top, not an unidentified top-mounted component.


## Mobile UI correction (2026-09-19)

- OnSite Vision now constrains the main conversation grid to the actual iPhone visual viewport height. The conversation thread owns vertical scrolling and remains scrollable above the fixed composer.
- Owner Live Job Progress now receives a real summary/body immediately, before live data finishes loading. If an empty legacy Live Job Progress element is found, it is rehydrated rather than skipped, preventing Safari from displaying its browser-generated `Details` row.
- Release identifiers: technician `release-qa-v124`, loader `startup-fast-v38`, Vision `vision-workspace-v17`, service worker `tech-check-field-shell-v81`.
- Regression QA count: 100.


## Vision iPhone keyboard + conversation reset correction (2026-09-19)

- On iPhone, focusing the Vision prompt no longer resizes the entire app to the visual viewport height. The main Vision shell stays fixed to the full layout viewport; only the composer tracks the keyboard obstruction.
- The conversation thread remains its own vertical scroll region while the keyboard is open.
- Starting a New Chat explicitly saves the conversation being left through the Vision persistence layer when available, then starts a blank conversation.
- Previous conversations remain visible under Recent conversations in the side menu and can be reopened.
- New Chat clears and blurs the prompt so it does not force the keyboard open.
- Release identifiers: Vision `vision-workspace-v18`, service worker `tech-check-field-shell-v82`.
- Regression QA count: 102.


## Vision mobile Service Order correction (2026-09-19)

- On iPhone, Service Order now opens as a centered modal sheet with margins and a dimmed backdrop instead of a desktop-style right drawer.
- Closing the Service Order returns to the same Vision conversation.
- Focusing the Vision prompt automatically closes the Service Order so the user can immediately ask another question.
- Release identifiers: Vision `vision-workspace-v19`, service worker `tech-check-field-shell-v83`.
- Regression QA count: 103.


## Vision company people lookup correction (2026-09-19)

- Natural questions such as "Who is Mike?", "Who is Mike Monsive?", and "Tell me about Teddy Hopper" now resolve against live Tech Check profile records instead of falling into the generic Vision help response.
- People lookup is separate from the assignable-technician list and includes Owner, IT, and Service profile records, including inactive or archived records.
- If multiple profile records match the same name, Vision reports each record and its active/inactive/archived state rather than guessing identity.
- Browser deterministic fallback performs the live profile lookup even if the AI model path is unavailable.
- Server agent adds the `find_people` read-only tool and explicit grounding rules for named-person questions.
- Current Mike Monsive data includes one active Owner/Admin profile and one inactive Service profile; no active Tech Check assignments are currently recorded under that name.
- Release identifiers: Vision `vision-workspace-v20`, Edge agent `onsite-vision-agent-v11`, service worker `tech-check-field-shell-v84`.
- Regression QA count: 104.
