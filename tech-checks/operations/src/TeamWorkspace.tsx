import {useCallback,useEffect,useRef,useState} from 'react';
import {api,openLegacy} from './api';
import './directoryWorkspace.css';
import {records,teamJobCount,teamRecords} from './directoryData.js';
import type {Row} from './directoryData.js';
const errorText=(cause:unknown,fallback:string)=>cause instanceof Error?cause.message:fallback;
function readiness(data:any):Row[] {
  if(!data||!Array.isArray(data.readiness)||data.readiness.some((row:any)=>!row||typeof row!=='object'||typeof row.userId!=='string'||typeof row.status!=='string')) throw new Error('Team readiness returned an incomplete snapshot.');
  return data.readiness;
}
export default function TeamWorkspace({show,openWorkspace}:{show:(message:string)=>void;openWorkspace?:(name:string)=>void}) {
  const[members,setMembers]=useState<Row[]|null>(null),[jobs,setJobs]=useState<Row[]|null>(null),[checks,setChecks]=useState<Row[]|null>(null);
  const[loading,setLoading]=useState(true),[errors,setErrors]=useState<{team?:string;jobs?:string;checks?:string}>({});
  const[query,setQuery]=useState(''),[department,setDepartment]=useState('');
  const revision=useRef(0);
  const load=useCallback(async()=>{
    const request=++revision.current;setLoading(true);
    const result=await Promise.allSettled([
      api.get('/api/team-production').then(response=>teamRecords(response.data)),
      api.get('/api/jobs').then(response=>records(response.data,'Jobs','jobNumber')),
      api.get('/api/daily-board').then(response=>readiness(response.data)),
    ]);
    if(request!==revision.current)return;
    const[team,work,ready]=result,failed:{team?:string;jobs?:string;checks?:string}={};
    if(team.status==='fulfilled')setMembers(team.value);else failed.team=errorText(team.reason,'Production team could not be loaded.');
    if(work.status==='fulfilled')setJobs(work.value);else failed.jobs=errorText(work.reason,'Assigned jobs could not be loaded.');
    if(ready.status==='fulfilled')setChecks(ready.value);else failed.checks=errorText(ready.reason,'Readiness could not be loaded.');
    setErrors(failed);setLoading(false);
  },[]);
  useEffect(()=>{void load();return()=>{revision.current+=1;};},[load]);
  const key=query.trim().toLowerCase();
  const rows=(members||[]).filter(member=>(!department||String(member.department).toLowerCase()===department)&&(!key||[member.displayName,member.department].some(value=>String(value).toLowerCase().includes(key))));
  return <section className='panel module operations-team' aria-label='Team Workspace'>
    <div className='panelhead'><h2>Team Workspace</h2><span>Production profiles and assigned work</span></div>
    <div className='purchase-actions'>
      <button className='secondary' disabled={loading} onClick={()=>void load()}>{loading?'REFRESHING…':'REFRESH TEAM'}</button>
      <input aria-label='Search production team' value={query} onChange={event=>setQuery(event.target.value)} placeholder='Search team member or department…'/>
      <label>Department<select value={department} onChange={event=>setDepartment(event.target.value)}><option value=''>All departments</option><option value='it'>IT</option><option value='service'>Service</option></select></label>
      {members&&<span>{members.length} active production profiles</span>}
    </div>
    {Object.values(errors).length>0&&<div className='operations-error' role='alert'>{Object.entries(errors).map(([source,error])=><p key={source}>{error}{(source==='team'?members:source==='jobs'?jobs:checks)&&' Showing the last successful '+(source==='checks'?'readiness':source)+' records.'}</p>)}</div>}
    {!members&&!errors.team&&<div className='loading' role='status'>Loading live team…</div>}
    {members&&<div className='records'>{rows.length?rows.map(member=>{
      const check=checks?.find(row=>row.userId===member.userId);
      return <div className='record op-record' key={member.userId}>
        <div><strong>{member.displayName}</strong><small>{String(member.department).toUpperCase()} Technician · {jobs?teamJobCount(member,jobs)+' active assigned jobs':'Assigned jobs unavailable'}</small>
          <div className='audit-mini'><span>Readiness: {check?check.status:checks?'No readiness record':'Unavailable'}</span></div>
        </div>
        <em>{member.active?'ACTIVE PROFILE':'INACTIVE PROFILE'}</em>
      </div>;
    }):<div className='loading'>{query||department?'No team members match this view.':'No active production technicians found.'}</div>}</div>}
    <div className='purchase-actions'>
      {openWorkspace&&<button onClick={()=>openWorkspace('Daily Board')}>OPEN DAILY BOARD</button>}
      <button className='secondary' onClick={()=>openLegacy('team')}>EXISTING TECH CHECK TEAM</button>
      <button className='secondary' onClick={()=>openLegacy('accounts')}>ACCOUNTS & PERMISSIONS</button>
    </div>
  </section>;
}
