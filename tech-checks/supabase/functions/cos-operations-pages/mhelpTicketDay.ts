/** The Owner preview is limited to today's existing COS operating timezone. */
export function mhelpTodayPreviewWindow(now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error('A valid current time is required.');
  const format = new Intl.DateTimeFormat('en-US', {timeZone:'America/Chicago',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const parts = (at:Date) => Object.fromEntries(format.formatToParts(at).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  const today=parts(now), localMidnight=Date.UTC(today.year,today.month-1,today.day);
  let candidate=localMidnight;
  // Solve midnight in the named zone, rather than assuming CST/CDT or browser timezone.
  for(let i=0;i<3;i++) {
    const p=parts(new Date(candidate));
    const delta=localMidnight-Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
    candidate+=delta;
    if(delta===0)break;
  }
  const check=parts(new Date(candidate));
  if(check.year!==today.year || check.month!==today.month || check.day!==today.day || check.hour!==0 || check.minute!==0 || check.second!==0 || candidate>=now.getTime()) throw new Error('Today’s ticket window is not available yet.');
  return {createdAfter:new Date(candidate).toISOString(),createdBefore:now.toISOString()};
}
