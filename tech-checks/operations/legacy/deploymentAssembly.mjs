/** Build SQL only. No database, network or activation capability. */
import {readFile} from 'node:fs/promises';
const definitions=[new URL('./mhelp-intake-proposal.sql',import.meta.url),new URL('../intake/mhelp-intake-scheduler-proposal.sql',import.meta.url),new URL('./mhelp-local-lead-upgrade-proposal.sql',import.meta.url)];
/** Existing disabled installations use only this forward upgrade, never base CREATEs. */
export const mhelpLocalLeadUpgradeSql=()=>readFile(definitions[2],'utf8');
export async function mhelpIntakeDeploymentSql(){
  const bodies=[];
  for(const path of definitions){
    const text=await readFile(path,'utf8');
    const lines=text.split('\n');
    if(lines.filter(line=>line.trim()==='begin;').length!==1||lines.filter(line=>line.trim()==='commit;').length!==1)throw Error('Unexpected intake transaction boundaries');
    bodies.push(lines.filter(line=>!['begin;','commit;'].includes(line.trim())).join('\n'));
  }
  return 'begin;\n'+bodies.join('\n')+'\ncommit;\n';
}
