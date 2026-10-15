import {fixture} from '../tech-checks/operations/tests/fixtures/recon-owned-metadata-v2.mjs';
export async function createHostedFixture(options={}){
 const f=await fixture({...options,projector:true,compactor:true});
 if(!f.db.connectionString){await f.close();throw Error('This wrapper requires the hosted PostgreSQL backend');}
 return {...f,connectionString:f.db.connectionString,connect:label=>f.db.connect(label)};
}
