import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {schema} from './mhelp-placement-schema.mjs';
const tracker='22222222-2222-4222-8222-222222222222',revision='33333333-3333-4333-8333-333333333333',ORG='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5';
const cell=s=>({entered:{stringValue:s},validation:null,rich:false});
const baseline=['Spotter 023.1','FIELD','Synthetic Builder','Synthetic Job'].map(cell);
const observation={equipmentId:'123',state:'confirmed',customerId:'4',serviceLocationId:null,placement:'SHOP',customerLabel:'Cameras Onsite LLC',siteLabel:'SHOP'};
const intended=['Spotter 023.1','SHOP','Cameras Onsite LLC','SHOP'].map(cell);
export async function fixture(database){
 const db=database??new PGlite();if(!database)await db.exec('create role anon;create role authenticated;create role service_role;');await db.exec(schema);
 for(const file of ['20261012173408_cos_mhelp_placement_sync.sql','20261012184453_cos_sheets_placement_publisher.sql'])await db.exec(await readFile(new URL('../../db/'+file,import.meta.url),'utf8'));
 await db.query(`insert into app_private.vision_tracker_locations values($1,$2,'Spotter 023.1','spotter0231','SPOTTERS','FIELD','Synthetic Builder','Synthetic Job','Historical address',30,-95)`,[tracker,ORG]);
 await db.query(`insert into app_private.cos_geocode_sources values($1,'tracker',$1,'123','mhelpdesk_product_import',$2,'Spotter 023.1','Spotter 023.1',true)`,[tracker,revision]);
 const guard=(await db.query('select cos_mhelp_placement_private.guard($1,null) value',[tracker])).rows[0].value;
 const link={equipmentId:'123',trackerId:tracker,nativeUnitId:null,trackerLabel:'Spotter 023.1',nativeLabel:null,fullLabel:'Spotter 023.1',model:null,sourceRevision:revision,expectedGuard:guard,customerId:'2',serviceLocationId:'3',placement:'FIELD',customerLabel:'Synthetic Builder',siteLabel:'Synthetic Job'};
 await db.query('select cos_mhelp_placement_private.admit($1,$2)',[[link],'a'.repeat(64)]);
 await db.query('update cos_mhelp_placement_private.links set observation=$1,observed_at=clock_timestamp()',[observation]);await db.exec('update cos_mhelp_placement_private.control set enabled=true,last_success_at=clock_timestamp()');
 const binding={equipmentId:'123',sheetId:2017346590,row:2,label:'Spotter 023.1',cells:baseline};
 await db.query('select cos_sheets_placement_private.admit($1,$2)',[[binding],'b'.repeat(64)]);
 return db;
}
