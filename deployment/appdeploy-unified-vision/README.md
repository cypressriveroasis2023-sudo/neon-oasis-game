# AppDeploy matching VISION presentation

Target: `cos-operations-platform-preview-wpbf1y`.
Base snapshot: `1791234207722`.

Apply the exact frontend-only anchors in `source-diffs.json`. Add
`WorkspaceMenu.tsx` as `src/WorkspaceMenu.tsx` and `vision-platform.css` as
`src/vision-platform.css`. Preserve all existing backend files and endpoints.
The existing role-specific technician components and readiness gates remain
unchanged. The optional reconciliation workspace stays outside this shell.

The Owner sidebar keeps primary tools visible. The full desktop Menu and the
mobile Owner Menu use the existing navigation callbacks to open workspaces.
The menu owns no operational data or authorization decisions.

`tests.json` preserves the snapshot's existing signed-out API and evidence
protection checks and records the local synthetic presentation coverage.
`tech-checks/operations/tests/unified-platform.browser.spec.mjs` compiles the
actual menu source and verifies selection, keyboard handling and responsive
layout without SDK calls, credentials or production records. Authenticated
production technician workflows are not claimed as hosted QA evidence.

Rollback: apply the original AppDeploy snapshot `1791234207722`.
