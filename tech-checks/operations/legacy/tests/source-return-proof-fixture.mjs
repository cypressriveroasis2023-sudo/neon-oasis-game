import{readFile}from'node:fs/promises';
export const id=n=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export async function setupReturnProof(db){
 await db.exec(`reset role;drop schema if exists cos_mhelp_intake cascade;drop schema if exists public cascade;drop schema if exists storage cascade;create schema public;create schema storage;create schema cos_mhelp_intake;
 do $$begin if not exists(select 1 from pg_roles where rolname='anon')then create role anon;create role authenticated;create role service_role;end if;end$$;
 revoke all on schema cos_mhelp_intake from public,anon,authenticated,service_role;
 create table cos_mhelp_intake.work_orders(id uuid primary key,source_revision text,source_scope_revision bigint,source_scope_snapshot jsonb,installation_scope_revision bigint,installation_scope_snapshot jsonb);
 create table cos_mhelp_intake.participants(id uuid primary key,state text);
 create table public.unit_returns(id uuid primary key,ticket_no text,unit_tag text,equipment_type text,prep_ticket_id uuid,prep_item_id uuid,service_tech_id uuid,service_tech_name text,
 returned_at timestamptz default now(),created_at timestamptz default now(),return_notes text,return_photo_paths text[],tag_scan_status text,tag_scan_detected text,tag_scan_expected text,tag_scan_confidence numeric,tag_scan_engine text,tag_scan_at timestamptz,
 status text default 'waiting_it',it_tech_id uuid,it_tech_name text,it_received_at timestamptz,intake_photo_paths text[] default '{}',damage_notes text,mhelp_inventory_confirmed boolean default false,completed_at timestamptz);
 create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid,owner_id text,created_at timestamptz default now(),updated_at timestamptz default now(),last_accessed_at timestamptz,version text,metadata jsonb,archived_at timestamptz,is_delete_marker boolean default false);
 create unique index idx_objects_current_version on storage.objects(bucket_id,name collate "C") where archived_at is null;
 create function cos_mhelp_intake.fence_assignments_v1() returns void language plpgsql as $$begin lock table public.unit_returns in share row exclusive mode nowait;end$$;
 insert into cos_mhelp_intake.work_orders values('${id(100)}','scope-1',1,'{"work_type":"swap","site":"Synthetic site"}',1,'{"work_type":"swap"}');insert into cos_mhelp_intake.participants values('${id(101)}','active');`);
 await db.exec(await readFile(new URL('../source-return-proof-proposal.sql',import.meta.url),'utf8'));
 const path=id(3)+'/'+id(200)+'/returns/service/1-synthetic.jpg';
 await db.query(`insert into storage.objects(id,bucket_id,name,owner_id,version,metadata) values($1,'handoff-evidence',$2,$3,'current-1','{"size":12,"mimetype":"image/jpeg"}')`,[id(300),path,id(3)]);
 await db.query(`insert into public.unit_returns(id,ticket_no,equipment_type,unit_tag,service_tech_id,service_tech_name,return_photo_paths) values($1,'SYN-42','Sniper','OLD-SYN',$2,'Synthetic Service',$3)`,[id(200),id(3),[path]]);
 // Explicit creation fixture only. This checkpoint does not yet implement
 // public creation admission; the next writer tests must bind through its RPC.
 await db.query(`insert into cos_mhelp_intake.source_returns_v1(return_id,work_order_id,membership_id,assignment_id,actor_id,request_id,request,identity,photo_paths,objects,source_scope,creation_authority)
 select r.id,$1,$2,$3,$4,$5,'{"action":"record_return"}',cos_mhelp_intake.return_identity_v1(r),r.return_photo_paths,cos_mhelp_intake.return_objects_v1(r.return_photo_paths,$4,false),cos_mhelp_intake.return_scope_v1($1),'{"actor_name":"Synthetic Service","assignment_status":"started","initial_status":"waiting_it"}' from public.unit_returns r where r.id=$6`,[id(100),id(101),id(13),id(3),id(400),id(200)]);
 return{path};
}
export async function proof(db,lock=false){return(await db.query('select cos_mhelp_intake.source_return_set_v1($1,$2) value',[id(100),lock])).rows[0].value;}
