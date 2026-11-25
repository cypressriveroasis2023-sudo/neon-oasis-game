# 2026-11-25 — Service answers the equipment checklist before signing a receipt

Project: Tech Check `goqrnolcvqnirjmzaeyk`
SQL: `tech-checks/database-maintenance/techcheck-service-receipt-checks-v1.sql`
Screen: `tech-checks/transfers/desk.js` (Pass / Problem for every check on the receipt)

Order: publish the screen first, then apply the SQL, so Service is never asked
for checks the screen cannot give.

Edits `app_private.submit_techcheck_transfer_v2` in place, guarded by md5
`2fe8e0f559032d2337489d17bbbd848e` of `pg_get_functiondef` (prosrc md5
`226943124157448ca0632c94285b5570` before). Re-running is a no-op.

## Live dry run (rolled back), 2026-11-25 ~13:50 UTC

Fake handoff of Spotter 268 to Josh:
- blank checks → "Answer every check for Spotter 268 (Pass or Problem) before you sign."
- one Problem, no note → "You marked a check as Problem. Write in Notes what is wrong before you sign."
- one Problem with a note → passed the checks; asked for Service's own unit photo (a difference needs one)
- all Pass → passed the checks; stopped at the photo rule (the fake had no IT photo)
Function md5 confirmed unchanged afterwards.

## Note for the held placement-review package

`tech-checks/operations/transfer-placement-review/` replaces this same function
and checks prosrc md5 `226943124157448ca0632c94285b5570`. Once this change is
live, that install aborts on drift (fails closed). Before installing it, add the
Service checklist block from the SQL above to its copy of the function and
update its expected md5.

## Rollback

Re-create the function from `techcheck-transfer-purpose-v2.sql` plus
`techcheck-owner-handoff-resolution-v1.sql` (md5 `2fe8e0f5…`).
