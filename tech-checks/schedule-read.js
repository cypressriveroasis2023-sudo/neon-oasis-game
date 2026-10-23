// Existing Tech Check calendar source, read with the current Owner's RLS session.
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
export async function readOwnerSchedule(db,isCurrent,from,to){
 if(!date(from)||!date(to)||to<from||(Date.parse(to)-Date.parse(from))/86400000>62)throw new Error('Invalid calendar range');
 if(!isCurrent())throw new Error('Session changed');
 const result=await db.from('job_assignments').select('id,ticket_no,site,work_type,scheduled_for,scheduled_time,status,assigned_role',{count:'exact'}).gte('scheduled_for',from).lte('scheduled_for',to).neq('status','cancelled').order('scheduled_for',{ascending:true}).order('id',{ascending:true}).limit(1000);
 if(!isCurrent())throw new Error('Session changed');
 if(result.error||!Array.isArray(result.data)||!Number.isSafeInteger(result.count)||result.count<result.data.length)throw new Error('Saved Tech Check schedule unavailable');
 const ids=new Set();const items=result.data.map(row=>{
  if(!row||typeof row.id!=='string'||!row.id||ids.has(row.id)||!date(row.scheduled_for)||row.scheduled_for<from||row.scheduled_for>to||row.scheduled_time&&!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/.test(row.scheduled_time))throw new Error('Incomplete schedule');
  ids.add(row.id);const text=value=>typeof value==='string'?value:'';
  return {id:row.id,ticket:text(row.ticket_no),site:text(row.site),kind:text(row.work_type),day:row.scheduled_for,time:text(row.scheduled_time),state:text(row.status),department:text(row.assigned_role)};
 });
 return {from,to,readAt:new Date().toISOString(),items,total:result.count,truncated:result.count>items.length};
}
