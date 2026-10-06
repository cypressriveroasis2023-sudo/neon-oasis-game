# Approved VISION workspace

Presentation changes against AppDeploy snapshot `1791245292620`.

`source-diffs.json` preserves exact changes to the existing App and Today dashboard. The new WorkspaceOverview and stylesheet mirror the GitHub visual system. The technician source fragment is the exact updated existing component, exercised with synthetic callbacks by Playwright. Hosted QA retains the signed-out guardrails; it does not write to real jobs or authenticate a technician.

The Service ticket input passes its value into the existing readiness-gated ticket handler. The handler's backend requests, assigned-visit selection, and workflow implementation are preserved. AppDeploy opens the selected Helios installation in Victron; GitHub opens its existing embedded monitoring workspace.

No backend source, API contracts, accounts, permissions or customer data are changed. Rollback is the prior AppDeploy snapshot above and the prior verified GitHub source release.
