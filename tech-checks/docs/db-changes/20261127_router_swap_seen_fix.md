# Router swap list: judge the new router by the fresh InHand pull, not last_seen (Tech Check, applied 2026-11-28 ~00:50 UTC)

James, 27 Nov: "Get the routers fixed up". Spotter 265's swap ("Spotter 265 (Solar)", online in InHand) had dropped off
the Router swapped list. `app_private.cos_router_swaps_compute()` required `last_seen` within 2 days, but InHand's
`last_seen` is when the router last connected: a router online since 24 Nov reads as 3 days old.

Change (anchored replace, nothing else): `u.online and u.last_seen > now() - interval '2 days'` →
`u.online and u.observed_at > now() - interval '2 hours'` (the router is online in a pull from the last 2 hours).
Source updated: `tech-checks/database-maintenance/cos-router-swaps-v1.sql`.

After: the list holds one item, SPOTTER 265 → "Spotter 265 (Solar)". Nothing was applied; James taps it on the card.

Rollback: the same anchored replace the other way.
