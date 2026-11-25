# 2026-11-25 — SolarSpotter 029, Helios 009, Solar Spotter 002: camera names matched to VCC

Project: Tech Check `goqrnolcvqnirjmzaeyk`, table `public.camera_devices`.
James reported SolarSpotter 029 showing two CAM 1s and an offline "029_4 in the
shop" (screenshot, 15:21 CT). He had asked earlier to proceed with fixes when
certain; each change below is proven by the camera's serial in VCC.

| id | serial | Before | After |
| --- | --- | --- | --- |
| 155 | ...B000546 | `SolarSpotter 029_1` | `SolarSpotter 029_4` (VCC's name for this serial, .17) |
| 3338 | ...7000729 | `SS029_1` | `SolarSpotter 029_1` (.14) |
| 3339 | ...7000731 | `SS029_3` | `SolarSpotter 029_3` (.16) |
| 158 | ...B000099 | old 029_4, active | `deactivated` (not listed by VCC since 2026-11-24 13:33 UTC) |
| 3301 / 3302 | | Helios 009 Cam 001 / Cam 002 swapped | VCC's names |
| 437 | | `Solar Spotter 002_3` | `Solar Spotter 002 CAM 2` (VCC's name) |

A fleet check comparing the camera number at the end of each name found only
these. No audit row; no unit_key changed.

Backups: `app_private.camera_devices_ss029_fix_backup_20261125`,
`app_private.camera_devices_cam_number_fix_backup_20261125`.

Moved in VCC now also lists a camera whose camera number in VCC differs from
COS within the same unit ("Use VCC's name"; keeps the unit's A#). Applied live
to `app_private.cos_vcc_moves_compute` and `public.cos_vcc_move_apply_v1`
(source updated in `tech-checks/database-maintenance/cos-vcc-moves-v1.sql`).
Tested in a rolled-back run on the 029 case.

Rollback:

```sql
update public.camera_devices d set device_name = b.device_name, activation_state = b.activation_state
from app_private.camera_devices_ss029_fix_backup_20261125 b where d.id = b.id;
update public.camera_devices d set device_name = b.device_name
from app_private.camera_devices_cam_number_fix_backup_20261125 b where d.id = b.id;
```
