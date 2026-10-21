import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
/** Disposable local CI database only; never accepts a production connection. */
export function assignmentPostgres(){
 if(process.env.COS_ASSIGNMENT_POSTGRES_CI!=='1')throw Error('Synthetic PostgreSQL opt-in required');
 const database='cos_assignment_'+randomUUID().replaceAll('-','');
 const run=(sql,db=database)=>execFileSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-U','postgres','-d',db,'-f','-'],{input:sql,encoding:'utf8',env:{...process.env,PGPASSWORD:'synthetic-ci-only'},timeout:45000,stdio:['pipe','pipe','pipe']}).trim();
 run(`create database ${database}`,'postgres');
 const quote=v=>v===null?'null':"'"+String(v).replaceAll("'","''")+"'";
 return {async exec(sql){sql=sql.replace(/create role (anon|authenticated|service_role);/g,(_,role)=>`do $$begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role};end if;end $$;`);run(sql);},
  async query(sql,params=[]){sql=sql.replace(/\$(\d+)\b/g,(_,n)=>quote(params[Number(n)-1]));if(/^\s*select\b/i.test(sql)){const text=run(`with q as (${sql}) select coalesce(jsonb_agg(to_jsonb(q)),'[]') from q`);return {rows:JSON.parse(text)};}run(sql);return {rows:[]};},
  async close(){run(`drop database ${database}`,'postgres');}};
}
