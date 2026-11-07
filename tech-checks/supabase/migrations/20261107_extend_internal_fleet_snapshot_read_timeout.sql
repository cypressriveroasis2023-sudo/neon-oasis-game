-- Durable Fleet reads can legitimately serialize the complete reviewed mHelp
-- placement projection and the last completed multi-megabyte Fleet board.
-- Keep the existing logic and permissions; only give these two internal reads
-- enough statement time to complete during concurrent inventory/address work.
alter function public.cos_mhelp_placement_snapshot(uuid,uuid)
  set statement_timeout = '30s';

alter function public.cos_fleet_board_read()
  set statement_timeout = '30s';
