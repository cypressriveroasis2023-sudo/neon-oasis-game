# 2026-11-25 — Linked 31 InHand routers to COS units by exact name (Tech Check)

James asked (chat, 25 Nov 14:32 CT) for the unlinked InHand routers to be linked, and approved this list of 31 (14:34 CT).

Rule used: the InHand router name matches exactly one COS unit that had no router linked. On all 31, both the router and the unit's cameras read offline at the time, so no working unit was made to look down.

Done with `public.cos_router_link_v1(...)` (the Link router button's function): 31 `ADD_ROUTER_LINK` audit rows (already on the allow-list; after_state has no `id` / `public_ip`), actor James Martin, actor_name "Claude for James Martin (approved in chat 25 Nov)". Watchdog `ok` after the first link and after all 31.

Linked: SNIPER 305, 313, 322, 4 102, 4 103; SOLARSPOTTER 016; SPOTTER 187, 193, 196, 197, 200, 202, 203, 206, 213, 216, 222, 227, 229, 234, 237, 241, 242, 268, 270, 278, 288, 290, 291, 299, 303.

Left unlinked (37): 24 routers named only by serial; test/broken/replaced routers (BAD, BAD MODEM, Test, Axis Spotter Test, Solar Spotter 028 - Broken, Solar Spotter 204 - BAD, Ranger 004.1, Sniper 2 347.1, Spotter 028.1 HDC, spotter 214.1); Axis SolarSpotter 145 and 171; SS Hybrid 253 (online; COS calls the unit SOLARSPOTTER 253, needs a tech to confirm); Spotter 016, 149, 215.

Rollback (per unit): clear `inhand_serial` on the router row the link touched (`after_state->>'camera_unit_routers_id'` in the audit row); rows created by the link have `router_name = 'InHand Router'` and can be deleted. Do not delete the audit rows.
