import './approvedFleetUnit.css';
import {approvedArea,approvedPrimaryAreas,type ApprovedIcon} from './approvedCosNavigation';

export function ApprovedCosIcon({name}:{name:ApprovedIcon}) {
  const paths:Record<ApprovedIcon,string>={
    fleet:'M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2V5z M9 3v16 M15 5v16',
    checks:'M9 4H5v17h14V4h-4 M9 2h6v5H9z M8 13l3 3 5-6',
    team:'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2 M9 3a4 4 0 110 8 4 4 0 010-8 M20 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75',
    more:'M4 6h16 M4 12h16 M4 18h16',
  };
  return <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'><path d={paths[name]}/></svg>;
}

/** Owner presentation only; App keeps the existing IT/Service eligibility gates. */
export default function ApprovedCosNavigation({active,navigate,mobile=false}:{active:string;navigate:(workspace:string)=>void;mobile?:boolean}) {
  return <>{approvedPrimaryAreas.filter(area=>!mobile||area.workspace!=='Operations').map(area=><button
    type='button' key={area.workspace}
    className={approvedArea(active)===area.workspace?'cos-approved-selected':''}
    aria-current={approvedArea(active)===area.workspace?'page':undefined}
    onClick={()=>navigate(area.workspace)}
  ><ApprovedCosIcon name={area.icon}/><span>{area.label}</span></button>)}</>;
}
