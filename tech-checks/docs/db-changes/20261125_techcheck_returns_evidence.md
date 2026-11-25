# 2026-11-25 — Tech Check returns: photo required, stuck returns on the Manager tab

Project: Tech Check `goqrnolcvqnirjmzaeyk`
File: `tech-checks/database-maintenance/techcheck-returns-evidence-v1.sql`

## What changed

- `app_private.techcheck_ticketfree_photos_v1` (md5 before `956d009f01b6b7359ca4dbf1fe32be22`) now refuses an
  empty photo list: "Take at least one photo of the equipment." It is the one photo check for every return step
  (Service swap / pickup / unused return, linked or unlinked; IT check-in). Before, 2 of the 3 real returns had no photo.
- `public.techcheck_handoff_gaps_v1` (owner-only, md5 before `c496cca0a3d8026b7fe4a5ef957ef173`) also returns
  `returns_not_checked_in`: returns in `waiting_it` / `identity_review` older than `awaiting_service_hours` (4).
  Shown on the Manager tab "Handoff check" as "Returns not checked in by IT after 4 hours".
- Both edits are guarded (anchor must match exactly once) and re-running is a no-op.

## Order

The screen (photos shown above Save, and required) is published first; the SQL is applied after, so no tech
meets the database refusal on an old screen that hides the photo button.

## Rollback

```sql
do $$ declare d text; begin
  for d in select definition from app_private.techcheck_returns_evidence_backup_v1 loop execute d; end loop;
end $$;
```
