# Routers matched to their COS units (Tech Check, applied 2026-11-28 ~05:25 UTC)

James, 27 Nov: "Get the routers fixed up on the website", then "Do what you recommend" (link the 22). 30 of 287
router rows were saved under a unit name COS could not place (no mHelp A# for that name), so the router page counted
them Offline instead of In Shop and the router alerts could not tell field from shop.

## 1. 17 A# links (`app_private.cos_mhelp_unit_link`, `decided_by='hand'`)
Router row name = COS unit name exactly, and mHelp has exactly one unit with that family and number; the A# was linked
nowhere. RANGER 029 (FIELD); SOLARSPOTTER 016, SPOTTER 196, 202, 203, 213, 222, 225, 234, 283, 284, 288, 289, 301,
303, 311, SS HYBRID 252 (SHOP). Unit-level only: `camera_devices.mhelp_product_id` untouched. No audit row.

## 2. 5 router rows renamed to the COS unit's own name (`public.camera_unit_routers.unit_key`)
The unit already had its A# under its own spelling, so the router row was renamed to match (unique key checked free):
| id | was | now |
|---|---|---|
| 91 | SOLAR SPOTTER 274 | SPOTTER 274 |
| 116 | SOLAR SPOTTER 254 | SOLARSPOTTER 254 |
| 124 | SOLAR SPOTTER 204 | SPOTTER 204 |
| 126 | SPOTTER 310 | SOLARSPOTTER 310 |
| 190 | RANGER 014 NEW | RANGER 014 |
Plus one A# link: SOLARSPOTTER 310 → 2242595 (FIELD). The sweep updates router rows by id (+ the key it just read),
so a rename costs at most one skipped write. No audit row; endpoint claims do not read this table.

## After
Unplaced router rows 30 → 8 (left for James: SNIPER 305, SNIPER 313, SNIPER 318, SNIPER 4 243,
SNIPPER 500 (ASAP/COS), SOLAR SPOTTER 023.1, SOLAR SPOTTER 182, SPOTTER 227). Router checks 05:45 UTC: 192 of 192, 0 unverified; all five renamed rows checked under their new names.
The camera check went from 34 to 38 of 44 at the same time, but that came from another session's
`cos-sheets-placement-publish` v25 deploy (~05:44 UTC), not from these changes.

## Rollback
```sql
delete from app_private.cos_mhelp_unit_link where decided_by='hand' and agreement->>'approved_in' like 'chat 2026-11-27 23:24 CT%';
update public.camera_unit_routers r set unit_key=v.old from (values (91,'SOLAR SPOTTER 274'),(116,'SOLAR SPOTTER 254'),
 (124,'SOLAR SPOTTER 204'),(126,'SPOTTER 310'),(190,'RANGER 014 NEW')) v(id, old) where r.id=v.id;
```
