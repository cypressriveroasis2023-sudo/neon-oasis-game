export type BoardRecord = Record<string, any>;
export type ReadinessRow = {userId:string;name:string;department:string;checkId?:string;status:string;startedAt?:string;completedAt?:string;result:BoardRecord};
export type ReadinessStatus = {label:string;state:'good'|'pending'|'attention'|'neutral'};
export function readinessSummary(row:ReadinessRow): {truck:ReadinessStatus;trailer:ReadinessStatus;inventory:ReadinessStatus} {
  const pending:ReadinessStatus={label:'Not started',state:'pending'};
  const result=row.result||{};
  const section=(name:string,total:number):ReadinessStatus=>{
    if(!row.checkId)return pending;
    const values=Array.from({length:total},(_,i)=>result[name]?.[`${name}_${i+1}`]);
    if(values.some(v=>v===false))return {label:'Needs attention',state:'attention'};
    if(values.every(v=>v===true))return {label:'Verified',state:'good'};
    return {label:row.status==='completed'?'Record incomplete':'In progress',state:row.status==='completed'?'attention':'pending'};
  };
  const pairs: [string,number][] = row.department==='it' ? [['it_sniper_qty',1],['it_ranger_qty',1],['it_spotter_qty',1],['it_solar_spotter_qty',1],['it_recon_battery_qty',25],['it_agm_110ah_qty',4],['it_litime_100ah_qty',2],['it_att_sim_qty',1],['it_verizon_sim_qty',1],['it_vendera_sim_qty',1]] : [['truck_12v_110ah_qty',4],['truck_litime_12v_100ah_qty',2]];
  const hasValue=(key:string)=>result[key]!==undefined&&result[key]!==null&&result[key]!==''&&Number.isFinite(Number(result[key]));
  const shortage=pairs.some(([key,min])=>hasValue(key)&&Number(result[key])<min);
  const serviceVerified=row.department!=='service'||(result.truck_12v_110ah_charged===true&&result.truck_litime_12v_100ah_charged===true&&['Spotter','Sniper','Solar Spotter'].includes(result.backup_unit_type));
  let inventory=pending;
  if(row.checkId){
    if(shortage||result.truck_12v_110ah_charged===false||result.truck_litime_12v_100ah_charged===false)inventory={label:'Shortage / issue',state:'attention'};
    else if(pairs.every(([key])=>hasValue(key))&&serviceVerified)inventory={label:'Recorded',state:'good'};
    else inventory={label:row.status==='completed'?'Record incomplete':'Pending record',state:row.status==='completed'?'attention':'pending'};
  }
  const trailer:ReadinessStatus=row.department==='it'?{label:'Not in IT checklist',state:'neutral'}:result.taking_trailer===false?{label:'Not taking trailer',state:'neutral'}:result.taking_trailer===true?section('trailer',7):pending;
  return {truck:section('truck',8),trailer,inventory};
}
export function isTestRecord(record:BoardRecord):boolean {
  return record.isTest===true||[record.customer,record.site,record.siteName,record.jobNumber].some(v=>/^TEST(?:\b|[-_])/i.test(String(v||'')))||/^(?:\[TEST\]|TEST[-_:]|TEST E2E\b)/i.test(String(record.title||''));
}
export type BoardLane = 'todo' | 'progress' | 'attention' | 'complete';
export type BoardScope = 'day' | 'week';
export type BoardCard = {
  id: string; kind: 'job' | 'task'; lane: BoardLane; title: string;
  reference: string; site: string; assignee: string; department: string;
  status: string; date: string; priority: string; overdue: boolean; record: BoardRecord;
};
const zone = 'America/Chicago';
export function chicagoDay(value: string | Date): string {
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.test(value)) return value.slice(0, 10);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {timeZone: zone, year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const get = (key: string) => parts.find(p => p.type === key)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function boardDateLabel(value: string): string {
  if (!value || !chicagoDay(value)) return 'No date assigned';
  if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?$/.test(value)) return `${value.replace('T',' ')} CT`;
  return new Date(value).toLocaleString('en-US',{timeZone:zone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' CT';
}
const statusKey = (value: unknown) => String(value || '').trim().toLowerCase().replaceAll('_',' ');
const addIsoDays=(day:string,days:number)=>{
  const [year,month,date]=day.split('-').map(Number);
  const value=new Date(Date.UTC(year,month-1,date+days));
  return value.toISOString().slice(0,10);
};
export function dailyBoardCards(jobs: BoardRecord[], tasks: BoardRecord[], now = new Date(), scope:BoardScope='day'): BoardCard[] {
  const today = chicagoDay(now);
  const horizon=addIsoDays(today,6);
  const cards: BoardCard[] = [];
  for (const [kind, records] of [['job', jobs], ['task', tasks]] as const) {
    for (const record of records) {
      if (!record.id) continue;
      const status = statusKey(record.status);
      if (['cancelled','canceled'].includes(status)) continue;
      const done = ['complete','completed','closed','billing ready','paid'].includes(status);
      const completedDay = chicagoDay(record.completedAt || record.closedAt || '');
      const date = String(kind === 'job' ? record.scheduled || '' : record.dueAt || '');
      const day = chicagoDay(date);
      if (done ? completedDay !== today : scope==='day' ? Boolean(day && day > today) : Boolean(day && day > horizon)) continue;
      const overdue = !done && Boolean(day && day < today);
      const needsAttention = overdue || Boolean(record.needsAttention) || ['blocked','needs correction','correction required','owner review','on hold'].includes(status);
      const lane: BoardLane = done ? 'complete' : needsAttention ? 'attention' : ['in progress','dispatched','en route','on site','working','accepted'].includes(status) ? 'progress' : 'todo';
      const rawAssignee = String(kind === 'job' ? record.technician || 'Unassigned' : record.assignedTo || (record.assignedDepartment ? String(record.assignedDepartment).toUpperCase()+' team' : 'Unassigned'));
      const assignee=status==='owner review'?'Owner Review':rawAssignee;
      cards.push({id:`${kind}:${record.id}`,kind,lane,title:String(kind==='job'?record.customer||record.jobNumber||'COS Job':record.title||'Task'),reference:String(record.jobNumber||''),site:String(record.site||record.siteName||''),assignee,department:String(record.department||record.assignedDepartment||'').toLowerCase(),status:String(record.status||'Not started').replaceAll('_',' '),date,priority:String(record.priority||'medium').toLowerCase(),overdue,record});
    }
  }
  return cards.sort((a,b) => Number(b.priority==='high')-Number(a.priority==='high') || Number(b.overdue)-Number(a.overdue) || a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}
