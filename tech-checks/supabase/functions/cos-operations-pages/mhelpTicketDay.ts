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
