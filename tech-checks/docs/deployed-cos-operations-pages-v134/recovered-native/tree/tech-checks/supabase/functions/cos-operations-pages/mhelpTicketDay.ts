/** Fixed local calendar-day windows in COS's existing operating timezone. */
function localMidnight(now:Date,dayOffset=0) {
  if (!Number.isFinite(now.getTime())) throw new Error('A valid current time is required.');
  const format = new Intl.DateTimeFormat('en-US', {timeZone:'America/Chicago',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const parts = (at:Date) => Object.fromEntries(format.formatToParts(at).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  const today=parts(now), target=new Date(Date.UTC(today.year,today.month-1,today.day+dayOffset));
  const local=target.getTime();let candidate=local;
  // Solve the named-zone midnight; the previous day can be 23 or 25 hours long.
  for(let i=0;i<3;i++) {
    const p=parts(new Date(candidate));
    const delta=local-Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
    candidate+=delta;if(delta===0)break;
  }
  const check=parts(new Date(candidate));
  if(check.year!==target.getUTCFullYear() || check.month!==target.getUTCMonth()+1 || check.day!==target.getUTCDate() || check.hour!==0 || check.minute!==0 || check.second!==0) throw new Error('The local ticket window is not available.');
  return candidate;
}
export function mhelpTodayPreviewWindow(now = new Date()) {
  const start=localMidnight(now);
  if(start>=now.getTime())throw new Error('Today’s ticket window is not available yet.');
  return {createdAfter:new Date(start).toISOString(),createdBefore:now.toISOString()};
}
export function mhelpPreviousDayPreviewWindow(now = new Date()) {
  return {createdAfter:new Date(localMidnight(now,-1)).toISOString(),createdBefore:new Date(localMidnight(now)).toISOString()};
}

/** Scheduling evidence is a separate seven-calendar-day interval from creation day.
 * It includes future jobs and never establishes the absence of appointments outside it. */
export function mhelpAppointmentPreviewWindow(createdAfter:string) {
  const start=new Date(createdAfter);
  if (!Number.isFinite(start.getTime()) || localMidnight(start)!==start.getTime()) throw new Error('The appointment schedule window is not available.');
  return {startDateUtc:start.toISOString(),endDateUtc:new Date(localMidnight(start,7)).toISOString(),timeZone:'America/Chicago' as const,calendarDays:7 as const};
}

/** A caller chooses only a calendar day near server-now. Bounds are solved in
 * Chicago independently, so DST days retain their actual 23/25-hour length. */
export function mhelpPrivateAppointmentDay(appointmentDay:unknown,now=new Date()) {
  if(typeof appointmentDay!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(appointmentDay)||!Number.isFinite(now.getTime()))throw new Error('Provide a valid appointment day within 31 Chicago calendar days.');
  const [year,month,day]=appointmentDay.split('-').map(Number),target=Date.UTC(year,month-1,day);
  if(year<1900||month<1||month>12||day<1||new Date(target).toISOString().slice(0,10)!==appointmentDay)throw new Error('Provide a valid appointment day within 31 Chicago calendar days.');
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  const offset=(target-Date.UTC(parts.year,parts.month-1,parts.day))/86400000;
  if(!Number.isInteger(offset)||Math.abs(offset)>31)throw new Error('Provide a valid appointment day within 31 Chicago calendar days.');
  return {startDateUtc:new Date(localMidnight(now,offset)).toISOString(),endDateUtc:new Date(localMidnight(now,offset+1)).toISOString(),timeZone:'America/Chicago' as const,calendarDays:1 as const};
}
