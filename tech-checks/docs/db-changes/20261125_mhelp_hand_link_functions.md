# 2026-11-25 — A# links by hand from the COS unit card (Tech Check functions)

Project: Tech Check `goqrnolcvqnirjmzaeyk`
Source: `tech-checks/database-maintenance/cos-mhelp-hand-link-v1.sql` (applied by hand 2026-11-25)

James asked for it ("build a# button"): the card said a unit had no A# and
there was no way to add one.

Two `public` security-definer functions over `app_private.cos_mhelp_unit_link`:

- `public.cos_mhelp_hand_link_state_v1()` — every unit's A# link
  (`COS_MHELP_HAND_LINKS_V1`). The Operations camera-status read gives a unit
  with no `productId` its linked A#.
- `public.cos_mhelp_hand_link_v1(p_unit_key, p_product_id, p_actor_name)` —
  links one unit to one A#, as the signed-in person. Refuses unless
  `app_private.cos_verified_fleet_actor` (Owner or approved IT); the A# is
  digits and on `cos_mhelp_field_list`; the unit has active cameras; the unit
  has no other link and the A# is on no other unit or camera. Writes
  `decided_by = 'hand'` with who and when in `agreement`. Stamps
  `camera_devices.mhelp_product_id` only when the unit has exactly one camera
  (that column is unique, so a multi-camera unit is linked at unit level only).

Execute is granted to `authenticated` and `service_role`, revoked from `public`
and `anon`.

No `camera_inventory_audit` row is written, so no new action value and the
camera sweep is unaffected. `camera_devices` keeps one row per camera.

The Operations side ships as recorded patch `cos-unit-camera-status/a-links-v19`
(from live v19 `c434eaf6`), rollback `rollback-to-v19-entry`.

Rollback:

```sql
drop function if exists public.cos_mhelp_hand_link_v1(text, text, text);
drop function if exists public.cos_mhelp_hand_link_state_v1();
```

Links already written stay in `app_private.cos_mhelp_unit_link`; remove one with
`delete from app_private.cos_mhelp_unit_link where unit_key = '<unit>' and decided_by = 'hand';`.
