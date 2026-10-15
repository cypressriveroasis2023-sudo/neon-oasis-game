import assert from 'node:assert/strict';
const qid=x=>'\"'+x.replaceAll('\"','\"\"')+'\"';
// Only fixture restoration temporarily suppresses triggers. Every tested mutation uses
// session_replication_role=origin, including all concurrent writer transactions.
export async function captureFixture(admin){
 const tables=(await admin.query(`select c.oid::regclass::text name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private','cos_mhelp_placement_private') and c.relkind='r' order by 1`)).rows;
 for(const table of tables){table.columns=(await admin.query('select attname from pg_attribute where attrelid=$1::regclass and attnum>0 and not attisdropped and attgenerated=\'\' order by attnum',[table.name])).rows.map(r=>r.attname);table.rows=(await admin.query('select coalesce(jsonb_agg(to_jsonb(x)),\'[]\') value from '+table.name+' x')).rows[0].value;}
 const sequences=(await admin.query(`select c.oid::regclass::text name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private','cos_mhelp_placement_private') and c.relkind='S' order by 1`)).rows;
 for(const sequence of sequences)Object.assign(sequence,(await admin.query('select last_value::text value,is_called from '+sequence.name)).rows[0]);
 return {tables,sequences};
}
export async function restoreFixture(admin,cp){await admin.query('begin');try{
 await admin.query("set local session_replication_role='replica'");
 await admin.query('truncate '+cp.tables.map(t=>t.name).join(',')+' restart identity cascade');
 for(const table of cp.tables){if(table.rows.length){const columns=table.columns.map(qid).join(',');await admin.query(`insert into ${table.name}(${columns}) overriding system value select ${columns} from jsonb_populate_recordset(null::${table.name},$1::jsonb)`,[JSON.stringify(table.rows)]);}}
 for(const s of cp.sequences)await admin.query('select setval($1::regclass,$2::bigint,$3)',[s.name,s.value,s.is_called]);
 await admin.query('commit');
 }catch(e){await admin.query('rollback');throw e;}
 assert.equal((await admin.query('show session_replication_role')).rows[0].session_replication_role,'origin');
}
