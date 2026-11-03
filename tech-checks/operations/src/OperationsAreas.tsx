import {useRef,useState} from 'react';
import {workspaceLabel} from './workspaceNavigation';
import {matchingApprovedTools} from './approvedToolSearch';
import './approvedCosToolSearch.css';

const toolLabel=(name:string)=>name==='Units On Hand'?'Shop inventory':workspaceLabel(name);

export default function OperationsAreas({navigate,trackerVisible=false}:{navigate:(workspace:string)=>void;trackerVisible?:boolean}) {
  const [query,setQuery]=useState('');
  const search=useRef<HTMLInputElement>(null);
  const searching=query.trim().length>0;
  const groups=matchingApprovedTools(query,trackerVisible,toolLabel);
  const count=groups.reduce((total,group)=>total+group.items.length,0);
  const clear=()=>{setQuery('');search.current?.focus();};
  return <section className='operations-directory cos-approved-tools' aria-label='Operations workspaces'>
    <p className='cos-approved-tools-note'>Open an existing COS tool. Service jobs are created in mHelp.</p>
    <div className='cos-approved-tool-search'>
      <label><span>Find a tool</span><input ref={search} type='search' value={query} maxLength={120} onChange={event=>setQuery(event.target.value)} placeholder='Camera, tracker, power…' autoComplete='off' spellCheck={false}/></label>
      <button type='button' className='secondary' disabled={!query} onClick={clear}>Clear search</button>
    </div>
    <p className='cos-approved-tool-search-status' role='status' aria-live='polite' aria-atomic='true'>{searching?(count?`${count} ${count===1?'tool matches':'tools match'} your search.`:'No tools match your search. Clear it to browse all available tools.'):'Choose a group below, or search by tool name.'}</p>
    {groups.map(group=><details className='cos-approved-tool-group' key={(searching?query+':':'browse:')+group.label} open={searching?true:undefined}>
      <summary>{group.label}</summary>
      <div className='operations-directory-links'>{group.items.map(name=><button type='button' className='secondary' key={name} onClick={()=>navigate(name)}>{toolLabel(name)}</button>)}</div>
    </details>)}
  </section>;
}
