# Sniper 318: COS check back on (2026-11-28, James's go)

Tech Check `public.camera_devices` row 609 (`SNIPER 318`, 2026 tracker).

- James, 28 Nov: "318 is where mHelp says it is" (field, AT&T: Key St), and he removed
  "- DO NOT USE" from its mHelp name (A# 1832148) at ~09:04 CT.
- Applied ~09:06 CT: `do_not_use` true → null, `mhelp_product_id` null → `1832148`.
  One row for the unit; no audit row written, so no new audit action; watchdog checked after.
- Backup: `app_private.camera_devices_sniper318_backup_20261128` (the row as it was).

Until mHelp's next read drops the DO NOT USE mark, the endpoint source still holds the unit
(lifecycle `DO_NOT_USE` → `existing_source_hold`), so nothing changes for the sweep before then.

Rollback:

```sql
update public.camera_devices d set do_not_use = b.do_not_use, mhelp_product_id = b.mhelp_product_id
from app_private.camera_devices_sniper318_backup_20261128 b where d.id = b.id and d.id = 609;
```

## After mHelp's 09:05 CT read

mHelp now reads `Sniper 318`, lifecycle `UNFLAGGED`, and the 09:15 CT sweep counts it (eligible
44 → 45). It is still held, now for `identity_mismatch`: the 2027 tracker still names it
`Sniper 318 - DO NOT USE` (UNIT OVERVIEW row 449, and the MHELP MATCH INDEX copy of 4 Nov,
row 449). It clears when those names read `Sniper 318`.
