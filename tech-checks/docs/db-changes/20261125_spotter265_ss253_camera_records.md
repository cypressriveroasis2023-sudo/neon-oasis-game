# 2026-11-25 — Spotter 265 and SolarSpotter 253 camera records matched to VCC

Project: Tech Check `goqrnolcvqnirjmzaeyk`, table `public.camera_devices`.
Approved by James in chat, 2026-11-25 12:33 CT ("proceed with fixes as long as
you know what to do and are sure").

Checked in VCC (Device Management, read only) before the change: Spotter 265
has four cameras, "Spotter 265 (Solar Compatible) CAM 1-4", all online at Texan
Dirt; there is no Spotter 265HD any more. SolarSpotter 253 has only CAM 2-4,
under root, offline since 2026-11-11.

Why COS was wrong: the VCC sync matches a camera by serial but keeps the name
and `unit_key` COS first gave it, and never adds a serial it has not seen.

| id | serial | Before | After |
| --- | --- | --- | --- |
| 275 | ...B001398 | `SolarSpotter 253 CAM 1`, unit `SOLARSPOTTER 253` | `Spotter 265 (Solar Compatible) CAM 4`, unit `SPOTTER 265` (VCC has this serial as 265 CAM 4) |
| 3340 | ...B000758 | `Spotter 265_2 (Solar)` | `Spotter 265 (Solar Compatible) CAM 2` |
| 3341 | ...B000770 | `Spotter 265_3 (Solar)` | `Spotter 265 (Solar Compatible) CAM 3` |
| 384 | ...X27VF21B000282 | `Spotter 265HD` NVR, active | `activation_state='deactivated'` (gone from VCC; last online 2026-11-11) |
| 3342 (new) | ...B000779 | not in COS | `Spotter 265 (Solar Compatible) CAM 1`, unit `SPOTTER 265`, copied from row 3340 |

No `camera_inventory_audit` row was written (no new action value; sweep
unaffected). No placement override existed for either unit. One row per camera
is kept: 265 now has four active rows, 253 three.

Backup: `app_private.camera_devices_265_253_fix_backup_20261125` (rows 275,
384, 3340, 3341 as they were).

Rollback:

```sql
begin;
delete from public.camera_devices where id = 3342 and device_serial = '210235TPEG321B000779';
update public.camera_devices d set unit_key = b.unit_key, device_name = b.device_name,
  tech_check_unit_type = b.tech_check_unit_type, activation_state = b.activation_state
from app_private.camera_devices_265_253_fix_backup_20261125 b where d.id = b.id;
commit;
```

Still open: the sync itself should follow VCC's name and unit and add new
serials, or this repeats whenever a camera moves between units.
