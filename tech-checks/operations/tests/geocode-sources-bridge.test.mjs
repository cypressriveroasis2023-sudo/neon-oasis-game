import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createGeocodeSourcesHandler,validSourceKey,sourceDto,COS_ORGANIZATION_ID as ORG,SOURCE_BODY_LIMIT} from '../../supabase/functions/cos-geocode-sources/index.ts';
const KEY='a'.repeat(64),hash=s=>createHash('sha256').update(s).digest('hex');
const identity={entityKind:'equipment_unit',nativeUnitId:randomUUID(),productId:'1234',sourceRevision:randomUUID()};
const source={schemaVersion:1,organizationId:ORG,sourceSystem:'mhelpdesk_product_import',...identity,eventId:'1',unitNumber:'HELIOS 099HDC4',family:'HELIOS',variant:'HDC4',sourceFileSha256:hash('file'),sourceRowSha256:hash('row'),addressSha256:hash('123 main st, houston, tx 77002'),nativeGuardSha256:hash('guard'),installation:{street:'123 Main St',city:'Houston',state:'TX',zip:'77002'},suppliedComponents:{street:true,city:true,state:true,zip:true},eligibility:'FIELD'};
const req=(value,{key=KEY,method='POST',headers={},url='https://native.supabase.co/functions/v1/cos-geocode-sources'}={})=>new Request(url,{method,headers:{'content-type':'application/json',...(key===null?{}:{'x-cos-geocode-source-key':key}),...headers},...(method==='GET'?{}:{body:typeof value==='string'?value:JSON.stringify(value)})});
const read={action:'read_current',...identity};
test('missing/malformed/wrong auth fails closed before reading or backend; fixed loop key validation',async()=>{
 assert.equal(validSourceKey(KEY,KEY),true);assert.equal(validSourceKey(KEY,KEY.toUpperCase()),true);
 for(const key of [undefined,'','a'.repeat(63),'a'.repeat(65),'z'.repeat(64),'b'.repeat(64),KEY+'x'])assert.equal(validSourceKey(KEY,key),false);
 let calls=0;for(const readKey of [undefined,'',KEY]){const handler=createGeocodeSourcesHandler({readKey,rpc:async()=>{calls++;return {};}});for(const key of [null,'bad','b'.repeat(64)])assert.equal((await handler(req(read,{key}))).status,401);}assert.equal(calls,0);
});
test('only bounded POST read actions admitted; arbitrary scopes and write attempts rejected',async()=>{
 let calls=0;const handler=createGeocodeSourcesHandler({readKey:KEY,rpc:async()=>{calls++;return {source};}});
 for(const input of [{action:'write'}, {...read,table:'profiles'}, {...read,organizationId:ORG}, {...read,rpc:'execute_sql'}, {...read,entityKind:'site'}, {...read,productId:1234},{...read,productId:'01'}, {...read,sources:[]}])assert.equal((await handler(req(input))).status,400);
 assert.equal((await handler(req(read,{method:'GET'}))).status,405);assert.equal((await handler(req(read,{url:'https://native.supabase.co/?table=profiles'}))).status,400);assert.equal(calls,0);
});
test('body byte limit, chunked bodies, malformed JSON and content type checked',async()=>{
 let calls=0;const handler=createGeocodeSourcesHandler({readKey:KEY,rpc:async()=>{calls++;return {source};}});
 assert.equal((await handler(req(' '.repeat(SOURCE_BODY_LIMIT+1)))).status,413);
 assert.equal((await handler(req(read,{headers:{'content-length':String(SOURCE_BODY_LIMIT+1)}}))).status,413);
 assert.equal((await handler(req('{'))).status,400);assert.equal((await handler(req([]))).status,400);
 assert.equal((await handler(req(read,{headers:{'content-type':'text/plain'}}))).status,415);
 const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(SOURCE_BODY_LIMIT));controller.enqueue(new Uint8Array(1));controller.close();}});
 assert.equal((await handler(new Request('https://native.supabase.co/',{method:'POST',headers:{'x-cos-geocode-source-key':KEY,'content-type':'application/json'},body:stream,duplex:'half'}))).status,413);assert.equal(calls,0);
});
test('allowlisted response never exports backend secrets, notes, contacts or extra installation data',async()=>{
 let called;const handler=createGeocodeSourcesHandler({readKey:KEY,rpc:async(name,args)=>{called={name,args};return {source:{...source,notes:'PRIVATE',contacts:['PRIVATE'],serviceKey:'PRIVATE',installation:{...source.installation,gate:'PRIVATE'}},private:'PRIVATE'};}});
 const response=await handler(req(read));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.has('access-control-allow-origin'),false);
 const data=await response.json();assert.deepEqual(data,{source});assert.ok(!JSON.stringify(data).includes('PRIVATE'));assert.equal(called.name,'cos_geocode_sources_read_current');assert.equal(called.args.p_organization_id,ORG);
});
test('misbound or malformed backend responses fail closed without reflecting errors',async()=>{
 for(const raw of [{source:{...source,productId:'999'}},{source:{...source,organizationId:randomUUID()}},{source:{...source,eventId:1}},{source:{...source,eligibility:'SHOP'}},{error:'secret'},null]){
 const handler=createGeocodeSourcesHandler({readKey:KEY,rpc:async()=>raw});const response=await handler(req(read));assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'Source request unavailable.'});}
 const handler=createGeocodeSourcesHandler({readKey:KEY,rpc:async()=>{throw Error('SECRET');}});assert.ok(!(await (await handler(req(read))).text()).includes('SECRET'));
});
test('events strictly ordered with integer strings; cursor cannot skip or duplicate',async()=>{
 const event={...identity,eventId:'9007199254740993',kind:'upsert',private:'SECRET'};
 const handler=createGeocodeSourcesHandler({readKey:KEY,rpc:async()=>({events:[event],nextEventId:event.eventId})});
 const response=await handler(req({action:'list_changes',afterEventId:'9007199254740992',limit:100}));assert.equal(response.status,200);assert.ok(!(await response.text()).includes('SECRET'));
 for(const input of [{afterEventId:0,limit:1},{afterEventId:'-1',limit:1},{afterEventId:'9223372036854775808',limit:1},{afterEventId:'0',limit:101},{afterEventId:'0',limit:1.5}])assert.equal((await handler(req({action:'list_changes',...input}))).status,400);
 for(const raw of [{events:[event,event],nextEventId:event.eventId},{events:[event],nextEventId:'9999999999999999'},{events:[event],nextEventId:'0'}])assert.equal((await createGeocodeSourcesHandler({readKey:KEY,rpc:async()=>raw})(req({action:'list_changes',afterEventId:'0',limit:100}))).status,503);
});
test('bounded batch keeps positions and nulls; mixed single/batch arguments rejected',async()=>{
 const handler=createGeocodeSourcesHandler({readKey:KEY,rpc:async()=>({sources:[source,null]})});
 assert.deepEqual(await (await handler(req({action:'read_current',sources:[identity,identity]}))).json(),{sources:[source,null]});
 assert.equal((await handler(req({action:'read_current',sources:Array(101).fill(identity)}))).status,400);
 assert.equal((await handler(req({...read,sources:[identity]}))).status,400);
});
test('tombstone redaction never returns old address or guard',()=>{
 const tombstone=sourceDto({...source,eligibility:'tombstone'});assert.deepEqual(Object.keys(tombstone).sort(),['schemaVersion','organizationId','sourceSystem','entityKind','nativeUnitId','productId','sourceRevision','eventId','eligibility'].sort());
});
test('configured newline is trimmed but inner whitespace remains invalid; all auth values stay private',()=>{
 assert.equal(validSourceKey(KEY+'\n',KEY),true);assert.equal(validSourceKey(' '+KEY+'\r\n',KEY),true);assert.equal(validSourceKey('a'.repeat(32)+' '+'a'.repeat(32),KEY),false);
});
test('contact, phone, instructions, email and markup cannot cross the source bridge as addresses',async()=>{
 for(const installation of [{...source.installation,street:'123 Main St contact Jim'},{...source.installation,street:'123 Main St 555-555-1212'},{...source.installation,street:'123 Main St john@example.com'},{...source.installation,street:'123 Main St <private>'},{...source.installation,city:'Houston; note private'},{...source.installation,zip:'77002 gate 1234'}]){
  const handler=createGeocodeSourcesHandler({readKey:KEY,rpc:async()=>({source:{...source,installation}})});assert.equal((await handler(req(read))).status,503);
 }
});
test('partial locality needs at least city OR ZIP and exports the exact supplied-component mask',()=>{
 for(const missing of ['city','zip']){
  const value={...source,installation:{...source.installation,[missing]:null},suppliedComponents:{...source.suppliedComponents,[missing]:false}};
  assert.deepEqual(sourceDto(value).installation,value.installation);assert.deepEqual(sourceDto(value).suppliedComponents,value.suppliedComponents);
  assert.throws(()=>sourceDto({...value,suppliedComponents:source.suppliedComponents}));
 }
 assert.throws(()=>sourceDto({...source,installation:{...source.installation,city:null,zip:null},suppliedComponents:{street:true,city:false,state:true,zip:false}}));
});
test('bridge blocks secondary-unit strings and credentials before cross-project transmission',()=>{
 for(const suffix of ['token abc','secret xyz','credential abc','pwd private','username private','customer private','code 1234','unit 12','suite 12','apt 12','floor 3'])assert.throws(()=>sourceDto({...source,installation:{...source.installation,street:'123 Main St '+suffix}}));
 assert.throws(()=>sourceDto({...source,installation:{...source.installation,state:'ZZ'}}));
});
test('identity display metadata cannot contain markup or control characters',()=>{
 for(const field of ['unitNumber','family','variant'])for(const value of ['<secret>','bad\nvalue',' bad '])assert.throws(()=>sourceDto({...source,[field]:value}));
});
test('credential stems with suffixes are not transmitted in bridge responses',async()=>{
 for(const word of ['Mypassword123','Mytoken','password123','tokenABC','secret123','credentialABC','usernameABC','gatecode123']){
  const handler=createGeocodeSourcesHandler({readKey:KEY,rpc:async()=>({source:{...source,installation:{...source.installation,street:'123 Main St '+word}}})});
  const result=await handler(req(read));assert.equal(result.status,503);assert.equal((await result.text()).includes(word),false);
 }
});
