# 2026-11-26 — Router swapped (Tech Check functions)

Project: Tech Check `goqrnolcvqnirjmzaeyk`
Source: `tech-checks/database-maintenance/cos-router-swaps-v1.sql` (applied by hand 2026-11-26 ~05:35 UTC)

James asked for it ("build router swap"). Of the 37 InHand routers linked to no
unit, 35 are spares, retired or marked BAD/Test; one is real: Spotter 265 was
still linked to its old router (offline since 2026-11-11) while "Spotter 265
(Solar)" was online in InHand. The Link router button refuses a unit that
already has a router, so a swap could not be recorded.

- `app_private.cos_router_swaps_compute()`; `public.cos_router_swaps_state_v1()`
  and `public.cos_router_swap_apply_v1(key, name)` (Owner or approved IT).
  Listed only when the unlinked router is online and seen within 2 days, its
  name is not BAD/BROKEN/TEST, exactly one COS unit fits its name, and that
  unit's linked router is not online. Apply re-checks, keeps the old serial in
  `prior_inhand_serial`, clears the old reading (status `unknown` until the next
  InHand pull) and writes one `camera_inventory_audit` row.
- **Shared ground:** the audit row uses the existing `ADD_ROUTER_LINK` action and
  the same after_state shape as Link router; before_state is
  `{"inhand_serial": <old>, "swap": true}` with no `id` or `public_ip`, so
  `cos_tracker_endpoint_claims_v1` reads nothing new. A rolled-back test swap of
  Spotter 265 left `complete = true` on the endpoint claims.

At apply time the list holds one item: SPOTTER 265, RF3022434424854 →
RF3152533023860. Nothing has been swapped yet; that is James's tap.

The Operations side ships as recorded patch `cos-unit-camera-status/router-swap-v23`
(rebuilt on live v23 `2efe829a` after `down-needs-two-misses-v22` deployed).
Rollback `rollback-to-v23-entry`.

Rollback:

```sql
drop function if exists public.cos_router_swap_apply_v1(text, text);
drop function if exists public.cos_router_swaps_state_v1();
drop function if exists app_private.cos_router_swaps_compute();
```

Undo one swap: `update public.camera_unit_routers set inhand_serial = prior_inhand_serial where id = <id>;`
