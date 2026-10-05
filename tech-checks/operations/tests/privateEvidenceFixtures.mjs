import {createPrivateEvidenceReader} from '../../supabase/functions/cos-operations-pages/privateEvidence.ts';
export const org='ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5',actor='3f073784-96e7-43d8-b9e0-33ab31c3c8b1',role='11111111-1111-4111-8111-111111111111',doc='22222222-2222-4222-8222-222222222222',job='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444';
export const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
export function fixture(change={}) {
 const state={
  user_profiles:[{user_id:actor,organization_id:org,active:true,department:'owner'}],
  roles:[{id:role,organization_id:org,code:'owner'}],
  user_roles:[{user_id:actor,role_id:role}],role_permissions:[{role_id:role,permission_code:'job.view_all'}],
  documents:[{id:doc,organization_id:org,job_id:job,document_type:'workflow_photo',storage_bucket:'job-photos',storage_path:org+'/'+job+'/fixture.png',content_type:'image/png'}],
  jobs:[{id:job,organization_id:org}],object:()=>new Response(png,{headers:{'content-type':'image/png'}}),...change
 };
 const calls=[],objects=[];
 const read=async path=>{calls.push(path);if(state.readError)throw new Error('private error details');return state[path.split('?')[0]]};
 const readObject=async(bucket,path,signal)=>{objects.push({bucket,path,signal});return state.object()};
 return {state,calls,objects,read,readObject,reader:createPrivateEvidenceReader({organizationId:org,read,readObject})};
}
