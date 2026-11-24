-- DRAFT. Do not apply, schedule, or run this statement.
-- It refuses unless #434 and #435 are the live bytes named below.
-- The existing 15-minute job is not rescheduled. Star4Live port checks
-- and router checks stay on that job. The new job asks for camera checks only.

do $draft$
declare
  existing cron.job%rowtype;
  camera_command text;
  pages_serve text := current_setting('cos.pages_serve_sha256', true);
  camera_status text := current_setting('cos.camera_status_sha256', true);
  producer text := current_setting('cos.producer_sha256', true);
  sweep text := current_setting('cos.sweep_sha256', true);
begin
  if pages_serve is distinct from 'c8dbcfd1c5b6bdd6ffceee0d318a6bf4d1325f90041de6844a27ed5fa716f0b0'
     or camera_status is distinct from 'afeb07d4d7e55b327dcef8b4236a06d3a8b1b233b1da1c3aee31bb76a3ead467'
     or producer is distinct from '5f7be12834d5aad7a35c721d013e5f41a94233022c375436b5a2200e9edc1f23'
     or sweep is distinct from '9f48200ca7e6e791722074d65e144504362efd23870ace1626d13df22f823734'
  then
    raise exception 'refusing: #434 and #435 deployed hashes are not live';
  end if;

  select * into existing
    from cron.job
   where jobname = 'camera-health-auto-sweep'
     and schedule = '0,15,30,45 * * * *'
     and active
     and command like '%/functions/v1/camera-health-sweep%'
     and command like '%timeout_milliseconds:=145000%'
     and command not like '%camera_only%';
  if not found then
    raise exception 'refusing: the 15-minute sweep is not the reviewed job';
  end if;
  if position('{}' in existing.command) = 0 then
    raise exception 'refusing: the 5-minute job cannot be marked camera-only';
  end if;

  camera_command := replace(existing.command, '{}', '{"camera_only":true}');
  if camera_command = existing.command or position('camera_only' in camera_command) = 0 then
    raise exception 'refusing: camera-only body was not applied';
  end if;

  if exists (select 1 from cron.job where jobname = 'camera-health-auto-sweep-cameras') then
    raise exception 'refusing: the camera-only schedule already exists';
  end if;

  insert into cron.job (schedule, command, nodename, nodeport, database, username, active, jobname)
  values (
    '0,5,10,15,20,25,30,35,40,45,50,55 * * * *',
    camera_command,
    existing.nodename,
    existing.nodeport,
    existing.database,
    existing.username,
    existing.active,
    'camera-health-auto-sweep-cameras'
  );
end
$draft$;
