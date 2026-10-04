# COS current-main implementation audit — October 4, 2026

Audited main: 08fcefce3b3345bb91500bf00e7c915037e3510a (11:03:28 AM CDT).
This is a repo-side assessment, not certification of a signed-in production session.

## Current evidence

- Clean fresh checkout; no unfinished local changes were present. Main still pointed to the audited SHA when checked.
- Newest commit changes only built CSS/JS asset files and dist/index.html references. A clean npm ci, strict typecheck and Vite build reproduce the tracked bundle without changes.
- The earlier empty combined-status result is not app failure evidence. The exact full SHA now has five successful check runs and three successful Actions runs:
  - [Verify COS Operations](https://github.com/cypressriveroasis2023-sudo/neon-oasis-game/actions/runs/37215399318)
  - [Verify published COS Pages](https://github.com/cypressriveroasis2023-sudo/neon-oasis-game/actions/runs/37215399228)
  - [Pages build and deployment](https://github.com/cypressriveroasis2023-sudo/neon-oasis-game/actions/runs/37215398388)
- Query workflow runs with the full SHA: the abbreviated SHA query returned no runs.
- Existing main tests: 190 passed. Added 20 isolated owner-action contract tests; final suite: 210 passed, zero failures or skips. Backend contract cases now total 105.
- Local browser rerun did not produce a completed result in this environment; the successful exact-SHA GitHub browser workflow is separate evidence. Browser fixtures do not establish a real authenticated production save/reload.
- Preservation comparison against f9725fc776f91b7920a7cfc59d3d07c5dd6b53d3 found no changes to the legacy app, owner technician dashboard, IT prep/intake/rules modules, shared truck-spares module or migrations covered by the existing CI gate.
- One existing draft PR, #1, concerns OnSite Vision on develop. It was left untouched. No open COS migration PR was returned.

## Implemented versus limited

| Area | What source actually implements | Verification boundary |
| --- | --- | --- |
| Owner Operations shell | Today, Daily Board, Field Map, tasks, Jobs, Unscheduled, Dispatch, Owner Review, Calendar, Handoffs, Camera Health, Customers, Sites, Equipment, Team, finance review views | Source, unit/contract tests, exact-SHA successful CI; not blanket AppDeploy parity |
| Daily Board | Drag assignment, schedule dialog, green scheduled/assigned cards, department validation and independent readback | Existing isolated tests; no signed-in production browser proof |
| GPS and tasks | Native RPC writes with fresh snapshot confirmation | Repo tests; earlier production SQL evidence is recorded in docs, not rerun here |
| Add/close/delete job, approve truck stock, owner IT → Service | Actual UI controls and backend native RPC routes; exact delete confirmation and native guard delegation | Not documentation-only. New contract tests cover add/close/truck/advance; deletion has existing contract tests. No destructive live test performed |
| IT and Service Tech Check | Existing legacy modules, database paths, identities and owner return navigation retained | Unchanged protected source and host tests; no new live end-to-end execution |
| Technician Operations queue | Four fixed same-person mappings, own active assignments across dates, tasks, sanitized visit detail, read-only access | Auth/contract tests; prior receipt records native reads and cross-user denial |
| Camera Health | Native summary/list with explicit online/offline/review and diagnostics link | Summary integration, not a replacement health engine |
| Finance | Native quote/invoice/PO/AP review routes and list/detail readback | Prior receipt verifies PO positives and invalid-state denials; quote/invoice/AP positives await eligible records |
| Test workflows | Legacy Test Center creates explicitly marked TEST prep, IT/Service role views, return/delete/cleanup controls | Source exists. This does not prove arbitrary Operations jobs can be converted to TEST |
| External workspaces | CRM, Work Requests, Accounting, Collections, Payments, Needs Attention, History, Reports, Activity and finance builders/email/document functions use AppDeploy | Links/fallbacks; not native implementations |
| Owner identity | Existing James mapping; Mike/Jacob remain unlinked to native Operations | Existing legacy access remains; no account or role provisioning in this task |

## One prioritized repo-side gap list

1. **P1 — Complete real authenticated end-to-end acceptance.** Use the actual authorized owner's normal session for an intended low-impact save, independent GET, full page reload and matching ID/value confirmation. Include actual IT and Service navigation/session isolation. Record deployed edge revision alongside Pages SHA. Repo fixtures and earlier rollback receipts cannot replace this proof. No production credential or browser session was available to this audit.
2. **P1 — Bring Owner Controls to the same save-verification standard as scheduling/GPS/finance.** OwnerBoardControls.tsx reloads lists after add/close/delete/truck/advance, but does not compare the exact persisted result. Some event handlers lack a synchronous duplicate-action gate and uncertain outcomes do not require a fresh load before another mutation. Add independent action-specific confirmation, duplicate protection and refresh-required state with failure/retry browser tests before expanding owner overrides. The 20 added backend tests close the missing delegation/auth coverage only.
3. **P1 — Link Mike's own native owner identity.** The repo explicitly limits native owner access to the existing verified mapping. Confirm/create the correct platform identity through the authorized account lifecycle, then add and test its same-person linkage; never reuse James's actor. Repo-side code alone cannot establish identity or grant the requested real access.
4. **P2 — Finish native technician workflow execution if required.** ProductionAssignments.tsx explicitly displays assignments/tasks and links workflow completion to AppDeploy; backend technician POST is denied. Add reviewed native evidence/completion/truck contracts and own-assignment authorization tests before exposing writes. Preserve existing IT/Service workflows and do not copy assignments to fabricate integration.
5. **P2 — Verify owner overrides with genuine native rules.** Add safe transaction-isolated positive/denial receipts for manual job creation, close, truck approval and IT → Service, plus protected dependency deletion denial. New tests prove bridge delegation and no replay, not underlying deployed RPC semantics. Do not run live destructive deletion as an acceptance shortcut.
6. **P2 — Resolve finance eligibility using real records.** Prior receipt says both review quotes lack current-version Pending Owner approval, Draft quote lacks a site, no suitable draft/review invoice exists, and no matched Ready for AP Approval packet exists. These are documented eligibility limits, not proven UI bugs. Test positive transitions only when genuinely eligible work exists.
7. **P2 — Finish native scope and visual parity incrementally.** External workspaces and finance builders/payment/document/email remain AppDeploy links. Choose each needed workflow and implement/test it in place. Source porting plus responsive tests do not prove exact appearance across every reference screen.
8. **P3 — Close verification-trigger gaps.** Operations verification paths omit tech-checks/index.html, despite it wiring both host bridges. Include it in push/PR triggers so entry-point-only changes run host/preservation/browser tests. Keep the separate published-byte check. Use completed check-runs and full-SHA Actions evidence when reporting CI.

## Commit-chain interpretation

1f6339d introduces core reference views and authenticated bridge; 1dafa07/304c36d/be04bba/8ec0d31 tighten host role/session and legacy return behavior. 45c35be/a65f818 are fixture/selector fixes, followed by f0bd0a3 built bundle and 99e5c79 published asset/access documentation. a253d0d adds technician queue and Camera Health; 9bff017 expands native owner workspaces; 0bd85c3 adds native owner routes and verified technician reads; 366c224 fixes types and records earlier verification; 46b68b0 fixes directory accessibility and quote-return revision confirmation; 4a75293 fixes finance mobile layout; 08fcefc refreshes the resulting static bundle.

## Changes carried through in this audit

Twenty new tests cover four owner actions with successful exact payload delegation, organization exclusion, technician denial, actor override rejection and native business-rule denial, requiring one RPC call and no automatic replay. All transports are synthetic and isolated. No production data, identities, policies, assignments or working technician modules were changed. These additions and this audit are proposed on a separate branch for review.
