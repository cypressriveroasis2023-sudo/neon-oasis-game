/** Build SQL only. No database, network or activation capability. */
import {readFile} from 'node:fs/promises';
const definitions=[new URL('./mhelp-intake-proposal.sql',import.meta.url),new URL('../intake/mhelp-intake-scheduler-proposal.sql',import.meta.url)];
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
