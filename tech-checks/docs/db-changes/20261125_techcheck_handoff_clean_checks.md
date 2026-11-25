# 2026-11-25 — Notes that contradict the checks; SIM lists compared cleaned

Project: Tech Check `goqrnolcvqnirjmzaeyk`
SQL: `tech-checks/database-maintenance/techcheck-handoff-clean-checks-v1.sql`
Screen: `tech-checks/transfers/desk.js` (confirm box under Notes; unit type picked from a list on a receipt)

**Applied 2026-11-25 ~18:05 UTC**, after PR #515 was published (Pages check matched). New submit md5 `34eda296fd728d455244c7337f01c6b3`; grants unchanged. Live check as Josh (rolled back): "Need semitry sim." refused; "Good" with N/A vs NA and "spotter" vs "Spotter" recorded no difference.

Order: publish the screen first, then apply the SQL.

- New helpers: `app_private.techcheck_note_says_needed_v1(text)`, `app_private.techcheck_sims_clean_v1(jsonb)`.
- `submit_techcheck_transfer_v2`: checkout, and a receipt with no differences, refuse a note that says
  something is still needed unless `p_checks._note_ready` is true. Guarded by md5 `48e6000e…`.
- `techcheck_transfer_differences_v2`: SIM lists compared after cleaning (case, spaces/dashes, NA/N/A, order).
- Old definitions saved in `app_private.techcheck_clean_checks_backup_v1`.

Live dry run (rolled back): notes "Need semitry sim." / "Unit is not working" caught, "NA" / "Good" not;
N/A vs NA and reordered SIMs no difference, a real SIM change still is; receipt with all Pass and
"Missing the SD card" refused, accepted past that rule once confirmed.

## Note for the held placement-review package

It replaces `submit_techcheck_transfer_v2` and must carry this block and the receipt checklist block.

## Rollback

```sql
-- restore from the saved definitions
do $$ declare d text; begin
  for d in select definition from app_private.techcheck_clean_checks_backup_v1 loop execute d; end loop;
end $$;
```
