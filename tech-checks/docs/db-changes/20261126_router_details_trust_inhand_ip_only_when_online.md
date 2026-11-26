# 2026-11-26 (UTC) — `cos_router_details_v1`: trust InHand's IP only while the router is online (Tech Check)

Found while checking the 6 "IP differs" warnings James asked about: an offline router keeps its last public IP in
InHand, and the carrier hands that address to another router. Up to 5 routers reported one address
(e.g. 38.246.193.162, 166.193.42.210, 50.148.14.82). So the :8080 button on an offline router could point at
another unit's router, and 4 of the 6 warnings were false.

Change (applied live, read-only function, same grants: service_role only):
- `ip` is InHand's address only when the router is online in a pull under 75 minutes old and no other online router
  reports the same address; otherwise the COS record (`router_public_ip`), else none.
- `cosDiffers` only in that trusted case.

Result right after: 173 routers use InHand's address, 62 the COS record, 47 have none. "IP differs" fell from 6 to 2
(RANGER 008, SOLAR SPOTTER 013). Both are online with cameras answering on the COS address, so no COS IP was changed.

Rollback: re-run the `cos_router_details_v1` definition in `20261125_inhand_router_details_and_link.sql`.
