# 2026-11-25 — Ranger 007 recorded as given from Abel to Josh (by hand, approved by James)

Project: Tech Check `goqrnolcvqnirjmzaeyk`

Abel gave Ranger 007 to Josh on 11/25 for a site swap where Josh installed both 008 and 007.
Because 007 was already installed, the in-app give (which needs a photo of the unit) could not be used.
Approved by James Martin in chat ("ranger 007 and ranger 008").

- `app_private.truck_moves`: one `accepted` row Abel → Josh, Ranger 007, signature method `owner` (James Martin).
- `public.service_truck_units`: Abel's Ranger slot cleared (007 → empty). Audit row written by the usual trigger.
- `app_private.truck_extra_units`: Ranger 007 on Josh's truck as an extra (`came_from='owner'`).
- `public.service_truck_unit_history`: GIVEN TO / TAKEN FROM rows, actor James Martin.

After: Abel Ranger 0 of 1, Josh Ranger 2 of 1 (slot 008, extra 007); the handoff rule covers 007 for Josh.
Next: Josh records his two swaps in Tech Check (installed 008 and 007); IT hands each tech a Ranger.

Rollback (only before Josh records the swaps):
```sql
update app_private.truck_extra_units set removed_at=now(), removed_why='owner_removed', removed_by_name='rollback' where unit_tag='007' and equipment_type='Ranger' and removed_at is null;
update public.service_truck_units set unit_tag='007', status='assigned' where equipment_type='Ranger' and service_tech_id='78e54fbd-c2db-4d18-8e3d-a9740adcf285';
```
