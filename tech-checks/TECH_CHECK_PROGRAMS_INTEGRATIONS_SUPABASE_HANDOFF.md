# TECH CHECK — PROGRAMS, INTEGRATIONS & SUPABASE HANDOFF

**Current as of September 24, 2026**

## 1. Production source of truth

**GitHub repository:** `cypressriveroasis2023-sudo/neon-oasis-game`  
**Branch:** `main`  
**App folder:** `tech-checks/`  
**Production:** GitHub Pages  
**Current main HEAD:** `2801a389018614efa62b14e19321194004f2dd3e`  
**Latest commit checked:** `Fix Camera Health global inventory search`

The Tech Check frontend is a PWA/static web application served from GitHub Pages. GitHub is the source of truth for frontend code.

Current important production files include:

- `tech-checks/index.html`
- `tech-checks/app.js`
- `tech-checks/styles.css`
- `tech-checks/tech-check-rules.js`
- `tech-checks/technician-wizard-owner-dashboard-v5.js`
- `tech-checks/camera-health.html`
- `tech-checks/camera-detail.html`
- `tech-checks/onsite-vision.html`
- `tech-checks/onsite-vision.js`
- `tech-checks/sw.js`
- `tech-checks/manifest.webmanifest`
- `tech-checks/supabase/`

Current production cache/app identifier is:

`tech-check-helios-field-clarity-20260924q`

Current Vision-related frontend versions include:

`vision-workspace-v58`  
`company-knowledge-v18`  
`workflow-engine-v6b`  
`live-data-v7`

---

## 2. Overall architecture

The basic architecture is:

**iPhone/Desktop Tech Check PWA**  
→ **GitHub Pages frontend**  
→ **Supabase Auth + Database + RPCs + Realtime**  
→ **Supabase Edge Functions**  
→ external camera/network/AI systems where applicable.

OnSite Vision has an additional path:

**OnSite Vision UI**  
→ `onsite-vision-agent` Edge Function  
→ live Tech Check/Supabase data  
→ OpenAI API  
→ response returned to OnSite Vision.

Camera Health works differently:

**Supabase pg_cron**  
→ every minute  
→ `camera-health-sweep` Edge Function  
→ TCP checks against camera/router public IP addresses  
→ results saved into Camera Health tables.

---

## 3. Programs and systems connected to Tech Check

| System | Status | How it connects |
|---|---|---|
| **GitHub / GitHub Pages** | LIVE / PRIMARY | Holds the Tech Check code and hosts production. `main` is authoritative. |
| **Supabase** | LIVE / PRIMARY BACKEND | Authentication, database, workflow rules, RPCs, realtime, storage, Edge Functions, audit logs, Camera Health, notifications and OnSite Vision persistence. |
| **OpenAI API** | LIVE | Used server-side by OnSite Vision for AI responses, voice transcription and language evaluation. API key stays server-side. |
| **Reconeyez** | LIVE DIRECT INTEGRATION | Supabase connects directly to Reconeyez and also receives Reconeyez webhook events. |
| **Alibi / Vigilant Control Center** | LIVE HYBRID | Vigilant inventory can be imported; Camera Health probes public ports; Alibi cameras can also be queried through ONVIF for snapshots. There is not a general Alibi cloud API controlling the application. |
| **Avigilon Unity** | WORKFLOW + HEALTH | Sniper equipment uses Avigilon Unity. Tech Check validates workflow and public-IP health. There is currently no direct Avigilon Unity cloud API integration. |
| **InHand routers** | LIVE DATA / HEALTH | Router inventory and status data are stored in Supabase and Camera Health probes the routers. Much of the current router data originated from InHand gateway exports and the 2026 Unit Tracker. |
| **EMQX** | CREATED, NOT YET CONNECTED | The `Cameras-Onsite-InHand` EMQX Serverless broker exists, but Tech Check is not yet communicating with it and the InHand routers are not yet publishing MQTT data into Tech Check. |
| **Victron VRM / Victron Bluetooth** | WORKFLOW REFERENCE | Tech Check requires technicians to perform Victron checks, but there is not currently a direct Victron API connection feeding Tech Check automatically. |
| **MHelpDesk** | EXTERNAL SOURCE OF TRUTH | MHelpDesk stays separate. Tech Check stores/uses the MHelpDesk ticket number as the service-order reference but does not replace MHelpDesk or directly modify it. |
| **2026 Unit Tracker** | DATA SOURCE | Used for unit/public-IP/router information, particularly Sniper and InHand information. Current data has been imported into Supabase. |
| **Acadian / Central Station** | EXTERNAL MONITORING | Operational monitoring destination. It is not the Tech Check database/API. Monitoring requirements are represented in the Tech Check workflow. |
| **Simetry** | NETWORK/SIM OPERATIONS | Used operationally for SIM/public-static-IP connectivity. There is currently no direct Simetry API integration in Tech Check. |
| **Web Push / PWA notifications** | LIVE | Supabase stores subscriptions and sends Tech Check push notifications through `send-techcheck-push`. |
| **Netlify** | LEGACY / NOT PRODUCTION | An older Tech Check deployment exists, but it is not the current production source of truth. |
| **AppDeploy** | LEGACY / NOT PRODUCTION | An earlier copy/deployment existed. Do not update this instead of the GitHub Pages application. |

---

## 4. EMQX / InHand current status

The new EMQX serverless broker is:

**Name:** `Cameras-Onsite-InHand`  
**Status:** Running  
**Hosting:** AWS Europe  
**Capacity:** 1,000 sessions / 1,000 TPS  
**MQTT TLS:** port `8883`  
**WebSocket TLS:** port `8084`

The important distinction is:

**EMQX has been provisioned, but it is NOT yet attached to Tech Check.**

I checked the deployed Supabase Edge Functions. There are currently **no EMQX or MQTT connections in the production functions**.

The current InHand system instead works through stored router mappings/status information plus direct health probes.

Supabase currently contains **187 router mappings**, primarily:

| Router | Current stored source |
|---|---|
| InHand IR300 | 137 from InHand gateway online export |
| InHand IR302 | 14 gateway export + 12 Unit Tracker |
| InHand IR315 | 11 gateway export + 5 Unit Tracker |
| InHand IR305 | 2 |
| InHand IR304 | 1 |
| Additional IR315 | Owner manual IP updates |

So the future EMQX connection would be a new live telemetry path rather than replacing something already connected.

---

## 5. Supabase production configuration

**Project:** `Cameras On Site`  
**Project ref:** `goqrnolcvqnirjmzaeyk`  
**Region:** `us-east-2`  
**Status:** `ACTIVE_HEALTHY`  
**PostgreSQL:** 17.6.1  
**API project host:** `goqrnolcvqnirjmzaeyk.supabase.co`

Supabase is the operational heart of Tech Check.

### Authentication

Supabase Auth handles application sessions.

The `profiles` table supplies Tech Check profile/role information.

Primary operational roles remain:

**Owner / Operations Manager**  
**IT Technician**  
**Service Technician**

Owner Test Mode uses the Owner's authenticated session while presenting IT or Service personas for workflow testing.

### Security

All current public Tech Check tables returned by Supabase have **Row Level Security enabled**.

The browser receives only the frontend/public Supabase credential needed for normal application access.

**Service-role credentials are server-side only.**

Reconeyez credentials, cron secrets and other sensitive integration data are not supposed to be exposed to the browser.

Supabase Vault is installed and is being used for protected values such as the Camera Health cron secret.

---

## 6. Major Supabase database areas

### Core workflow

Current tables include:

`profiles`  
`job_assignments`  
`prep_tickets`  
`prep_items`  
`reports`  
`morning_checks`  
`handoff_evidence`  
`unit_registry`  
`unit_returns`  
`workflow_checkpoints`  
`owner_job_reviews`  
`field_escalations`  
`workflow_repair_audit`

These hold the IT → Service → Owner workflow and its history.

### Service truck / inventory

`service_truck_units`  
`service_truck_stock`  
`service_truck_sims`  
`service_truck_inventory_checks`  
`service_truck_restock_requests`  
`service_truck_inventory_audit`  
`truck_spare_batteries`

### Camera Health

Current production data includes approximately:

**733 camera/device records**  
**619 current Camera Health records**  
**2,032 Camera Health history records**  
**187 router mappings**

Important tables:

`camera_devices`  
`camera_health_current`  
`camera_health_history`  
`camera_monitoring_profiles`  
`camera_unit_routers`  
`camera_integrations`  
`camera_integration_events`  
`camera_inventory_audit`

### OnSite Vision

`vision_conversations` — currently 48  
`vision_messages` — currently 264  
`vision_action_audit`  
`vision_knowledge_entries`  
`vision_knowledge_versions`

OnSite Vision conversations are persisted separately from actual operational workflow records.

Vision does not become the authority over database workflow rules.

**Supabase RPCs/triggers/database enforcement remain authoritative.**

### Notifications

`app_notifications` — currently over 5,000 records  
`notification_preferences`  
`push_subscriptions`  
`push_config`

`push_config` is server-only.

---

## 7. Supabase Realtime

Realtime is currently enabled for important operational tables including:

`job_assignments`  
`prep_tickets`  
`prep_items`  
`profiles`  
`reports`  
`morning_checks`  
`app_notifications`  
`unit_returns`  
`asset_inventory`  
Service Truck inventory/stock/SIM tables  
Service solar/check evidence tables

That is what allows Owner/IT/Service screens to update without requiring a complete manual refresh after every change.

---

## 8. Supabase Storage

There is currently one Tech Check Storage bucket:

`handoff-evidence`

**Public:** No

It holds protected workflow evidence such as photos/signature-related handoff evidence.

---

## 9. Current Supabase Edge Functions

| Function | Version | Purpose |
|---|---:|---|
| `bootstrap-owner` | 5 | Initial Owner/profile bootstrap |
| `admin-user-management` | 7 | Owner/admin technician account management |
| `cameras-on-site-app` | 2 | Cameras On Site application/support endpoint |
| `password-reset-request` | 2 | Password-reset workflow |
| `send-techcheck-push` | 4 | PWA/Web Push notifications |
| `onsite-vision-agent` | **36** | Main OnSite Vision AI server |
| `onsite-vision-transcribe` | 3 | Speech-to-text for Vision |
| `onsite-vision-language-eval` | 4 | Tests/evaluates Vision language behavior |
| `tech-check-history-reset-cleanup` | 3 | Controlled Tech Check history cleanup |
| `camera-health-check` | 8 | On-demand Camera Health test |
| `camera-health-sweep` | **15** | Automatic background camera/router health checks |
| `camera-inventory-seed` | 4 | Camera inventory seeding/import support |
| `reconeyez-connect` | 3 | Direct Reconeyez connection/synchronization |
| `reconeyez-webhook` | **6** | Receives Reconeyez events |
| `camera-snapshot` | **10** | Gets supported camera snapshots through ONVIF |

---

## 10. OpenAI / OnSite Vision

OnSite Vision is now a real server-side AI integration.

The `onsite-vision-agent` function currently has access to:

`OPENAI_API_KEY`  
`ONSITE_VISION_MODEL`

It calls the OpenAI Responses API.

The transcription function separately uses:

`OPENAI_API_KEY`  
`ONSITE_VISION_TRANSCRIBE_MODEL`

OnSite Vision combines the AI model with:

live jobs  
unit records  
handoffs  
field escalations  
Owner system health  
company history  
Owner review queue  
approved company knowledge  
Tech Check workflow rules.

The AI may propose operational actions, but production writes still go through controlled Tech Check actions/RPCs and confirmation rules.

---

## 11. Reconeyez configuration

Reconeyez is currently the strongest true external-camera API integration.

Current Supabase integration:

**Provider:** `reconeyez`  
**Server:** `na.reconeyez.com`  
**Port:** `9028`  
**Enabled:** Yes  
**Last sync:** successful  
**Last integration inventory:** 140 devices  
**Detector records synchronized:** 85

Functions:

`reconeyez-connect`  
→ authenticates Owner  
→ retrieves protected Reconeyez credentials  
→ communicates with Reconeyez  
→ synchronizes cameras/devices into Supabase.

`reconeyez-webhook`  
→ accepts incoming Reconeyez events  
→ records integration events  
→ updates `camera_devices`  
→ updates current/history Camera Health information.

As of the latest setup, the webhook was updated to understand the real Reconeyez event payload format.

---

## 12. Alibi / Vigilant Camera Health

Alibi/Vigilant is a hybrid integration.

The Camera Health screen can import a **Vigilant Control Center CSV export**.

Those records are stored in `camera_devices`.

Current major Vigilant-derived inventory includes roughly:

**249 Solar Spotter devices**  
**133 NVR devices**  
**28 Ranger devices**  
**21 Helios devices**

The automatic health engine does not log into the Vigilant web interface for every check.

Instead, it probes the public IP/service ports associated with each unit.

For Helios/NVR/Ranger/Solar Spotter, the Camera Health profile currently checks the approved mapped service-port family beginning with:

`80, 81, 443, 1400, 1443, 1454, 1500, 1543, 1554, 1600...`

through the configured 1900-series mappings.

This is separate from the technician workflow's equipment-specific **81/554** checks.

### Alibi snapshots

`camera-snapshot` performs direct ONVIF communication with supported Alibi cameras.

It uses server-side:

`ALIBI_CAMERA_USERNAME`  
`ALIBI_CAMERA_PASSWORD`

and ONVIF operations such as:

`GetProfiles`  
`GetSnapshotUri`

No Alibi password should ever be stored in frontend JavaScript.

---

## 13. Avigilon / Sniper

Sniper uses:

**Avigilon ES appliance**  
**Avigilon bullet cameras**  
**Avigilon Unity**  
**InHand router**

The Tech Check workflow explicitly asks technicians to verify Avigilon Unity/video/storage/customer access.

Camera Health recognizes Sniper/Avigilon and probes:

`80`  
`443`  
`8443`  
`38880`  
`38881`

Most Sniper inventory currently originates from the **2026 Unit Tracker**, not a live Avigilon API.

Therefore:

**Avigilon is operationally integrated into Tech Check, but Avigilon Unity itself is not yet directly API-connected.**

---

## 14. Victron

Victron is currently a technician verification integration rather than a software API integration.

Tech Check asks for checks such as:

Victron Bluetooth connection  
MPPT health/configuration  
Cerbo status  
Victron VRM visibility  
Helios solar/yard verification.

No production Edge Function currently logs into Victron VRM automatically.

---

## 15. MHelpDesk

MHelpDesk must remain separate.

Tech Check's own company knowledge states:

**MHelpDesk is external and remains the source of truth for the service ticket reference.**

Tech Check uses the MHelpDesk number to connect its internal workflow to the correct customer work order.

Tech Check should never pretend to close or alter the original MHelpDesk ticket unless a future official MHelpDesk integration is intentionally created.

---

## 16. Camera Health automatic scheduler

Supabase has an active scheduled job:

`camera-health-auto-sweep`

Schedule:

**Every minute**

Each execution requests:

`batch_size: 25`

Flow:

`pg_cron`
→ `pg_net`
→ protected Supabase Edge Function
→ `camera-health-sweep`
→ probe cameras and routers
→ update current state/history.

The cron secret is read from **Supabase Vault**, not frontend code.

Camera Health also requires multiple consecutive failures before treating a unit as a confirmed outage.

---

## 17. Current Supabase Disk IO concern

On September 24 Supabase sent a warning that this project is depleting its **Disk IO Budget**.

That can eventually cause:

slower requests  
higher CPU from IO wait  
possible temporary unresponsiveness.

One area worth watching is the automatic Camera Health system because it runs **every minute** and performs repeated database reads/updates/history writes.

That does **not** prove Camera Health is the sole cause of the Disk IO issue, but it is one of the first high-frequency workloads that should be measured before simply purchasing more compute.

---

## 18. Important development rules for the next person/chat

**DO NOT create a replacement Tech Check application.**

Continue the existing GitHub project.

**DO NOT reset Supabase.**

**DO NOT roll the production database backward.**

**DO NOT use TinyFish for this project.**

Before any GitHub file update:

1. Read current `main`.
2. Fetch the current file and its SHA.
3. Modify that exact current version.
4. Commit to `main`.
5. Cache-bust the relevant frontend assets.
6. Verify GitHub Pages actually serves the change.

For database work:

Use the existing Supabase project:

`goqrnolcvqnirjmzaeyk`

Do not create a replacement project.

Do not expose:

service-role keys  
OpenAI API keys  
Reconeyez credentials  
Alibi credentials  
Vault secrets  
EMQX credentials

in frontend code.

---

## 19. Current integration status in one sentence

Tech Check is currently a **GitHub Pages PWA with Supabase as its operational backend, OpenAI powering OnSite Vision, direct Reconeyez integration, Alibi/Vigilant/Avigilon/InHand Camera Health support, protected ONVIF snapshots, realtime workflow synchronization, PWA push notifications, and external-reference workflows for MHelpDesk/Victron/Acadian/Simetry—while the newly created EMQX/InHand MQTT connection is the major integration that has been provisioned but is not yet wired into production.**
