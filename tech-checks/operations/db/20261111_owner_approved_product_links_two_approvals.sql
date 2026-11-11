-- The two approvals James Martin gave on 2026-11-11, recorded separately, each through the
-- same guard function as an Owner session. Run only after the install above, and only after
-- James has seen this file. Either statement fails closed if any guard no longer holds.
-- Neither approval is evidence of camera health.
begin;
select app_private.cos_owner_product_link_record(
 'a2232677-2026-4111-8000-000000000001'::uuid,'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid,'approve',
 '2232677','0d3a6038-b645-4c62-913d-479783c34f6f'::uuid,'Solar Spotter 012','Solar Spotter 012HDC2',
 'James Martin','Owner message, COS Fleet working session, Wed 2026-11-11 3:54 PM CT: "James approved the fresh inventory link mHelp A#2232677 Solar Spotter 012 → COS Solar Spotter 012HDC2, in addition to confirming A#2221820 → Spotter 028.1. Record each approval separately with its source and time. Neither approval confirms camera health." Session https://claude.ai/code/session_01WoXEahBFJgyCw9ohuMD7zX',
 '2026-11-11T15:54:00-06:00'::timestamptz,'Fresh inventory link by exact A#. Earlier link dropped on 2026-10-17 when the mHelp label lost a trailing space.',null,'reviewed_install',null);
select app_private.cos_owner_product_link_record(
 'a2221820-2026-4111-8000-000000000002'::uuid,'ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5'::uuid,'approve',
 '2221820','e2fb7468-b4bf-4b4a-97a1-6248f7c144e4'::uuid,'Spotter 028.1 HDC4S - SOLAR COMPATIBLE','Spotter 028.1HDC4S',
 'James Martin','Owner message, COS Fleet working session, Wed 2026-11-11 3:38 PM CT: "James confirms A#2221820 matches Spotter 028.1. Include that exact owner confirmation in the guarded mHelp-to-COS restoration. Keep tracker data out of this inventory step, and don''t treat the confirmation as camera-health evidence." Session https://claude.ai/code/session_01WoXEahBFJgyCw9ohuMD7zX',
 '2026-11-11T15:38:00-06:00'::timestamptz,'Fresh inventory link by exact A#. mHelp label changed from Spotter 028 to Spotter 028.1 after the earlier owner-confirmed link.',null,'reviewed_install',null);
commit;
