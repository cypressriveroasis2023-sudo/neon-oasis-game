import test from 'node:test';
import assert from 'node:assert/strict';
import {describeMhelpTicketSchema,projectMhelpTicketSchema} from '../../supabase/functions/cos-operations-pages/mhelpTicketSchema.ts';
import {createMhelpTicketReader,MhelpTicketError} from '../../supabase/functions/cos-operations-pages/mhelpTickets.ts';
import {mhelpTicketDiagnostic} from '../../supabase/functions/cos-operations-pages/mhelpTicketDiagnostics.ts';
const secret='synthetic-private-secret';
const ticket={ticketId:42,ticketNumber:'102',portalId:224643,typeId:12,statusId:1,customStatusId:null,deleted:false,
 creationDate:'2026-10-09T12:00:00',lastModDate:'/Date(1791547200000)/',assignedTo:secret,summary:secret,privateField:secret};
test('schema evidence describes fixed fields and counts, never values or untrusted keys',()=>{
 const raw={totalRows:51,data:[ticket],results:[{...ticket,ticketId:secret}],privateField:secret};
 const schema=describeMhelpTicketSchema(raw,'tickets');
 assert.equal(schema.kind,'object');assert.equal(schema.totalRows,51);assert.equal(schema.data.length,1);
 assert.deepEqual(schema.data.fields.ticketId.kinds,{integer:1});
 assert.deepEqual(schema.data.fields.creationDate.formats,{iso_without_zone:1});
 assert.deepEqual(schema.data.fields.lastModDate.formats,{dotnet:1});
 const text=JSON.stringify(schema);for(const value of [secret,'privateField','summary','224643','1791547200000','2026-10-09','102'])assert(!text.includes(value),value);
 assert.deepEqual(projectMhelpTicketSchema({tickets:schema}),{tickets:schema});
});
test('schema sampling is capped at 50 and distinguishes absent, null, arrays and invalid totals',()=>{
 const s=describeMhelpTicketSchema({totalRows:'100',results:Array.from({length:100},()=>({typeId:null,portalId:1,typeName:[],isActive:true}))},'ticketTypes');
 assert.equal(s.totalRows,null);assert.equal(s.totalRowsKind,'string');assert.equal(s.results.length,100);assert.equal(s.results.sampled,50);
 assert.deepEqual(s.results.fields.typeId.kinds,{null:50});assert.deepEqual(s.results.fields.typeName.kinds,{array:50});assert.deepEqual(s.data.fields,{});
 assert.equal(describeMhelpTicketSchema(null,'ticketStatuses').kind,'null');
 assert.equal(describeMhelpTicketSchema({totalRows:1000001},'tickets').totalRows,null);
});
test('forged attached evidence is reconstructed through exact section, field, kind and bounded numeric allowlists',()=>{
 const evidence={tickets:{kind:secret,totalRowsKind:'integer',totalRows:secret,privateField:secret,data:{kind:'array',length:secret,sampled:1,fields:{
 ticketId:{kinds:{integer:999,privateField:secret,string:1},formats:{numeric:1,privateField:secret}},privateField:secret}}},privateField:secret};
 const cause=new MhelpTicketError('mHelpDesk returned an incomplete ticket type dictionary.');cause.schema=evidence;
 const d=mhelpTicketDiagnostic(cause),text=JSON.stringify(d);assert(!text.includes(secret));assert(!text.includes('privateField'));assert(!text.includes('999'));
 assert.equal(d.log.schema.tickets.kind,'other');assert.deepEqual(d.log.schema.tickets.data.fields.ticketId.kinds,{string:1});
 assert.equal(projectMhelpTicketSchema({privateField:secret}),null);
});
test('a failed dictionary records all three bounded read shapes but never accepts or exports malformed source rows',async()=>{
 const calls=[];const json=x=>new Response(JSON.stringify(x));
 const reader=createMhelpTicketReader({getConfig:()=>({portalId:'224643',accessToken:secret}),fetch:async url=>{
 calls.push(url);if(url.endsWith('/users/me'))return json({portalId:224643});
 if(url.endsWith('/tickettypes'))return json({totalRows:1,results:[{typeId:11,portalId:224643,typeName:secret,isActive:true}]});
 if(url.endsWith('/ticketstatus'))return json([{statusId:1,statusText:secret,displayText:secret,parentId:null,canBeParent:true}]);
 return json({totalRows:1,results:[ticket]});}});
 await assert.rejects(reader.preview({createdAfter:'2026-10-09T05:00:00Z',createdBefore:'2026-10-10T04:00:00Z'}),error=>{
 const diagnostic=mhelpTicketDiagnostic(error);assert.equal(diagnostic.error,'MHELP_PREVIEW_TYPE_DICTIONARY_INCOMPLETE');
 assert.equal(diagnostic.log.schema.ticketTypes.results.length,1);assert.equal(diagnostic.log.schema.ticketTypes.data.kind,'absent');
 assert.equal(diagnostic.log.schema.ticketStatuses.topLevel.length,1);assert.equal(diagnostic.log.schema.tickets.results.length,1);
 assert(!JSON.stringify(diagnostic).includes(secret));assert(JSON.stringify(diagnostic).length<8000);return true;});
 assert.equal(calls.length,4);assert.equal(calls.filter(url=>url.includes('/Tickets')).length,1);
});

test('maximal forged structural evidence has a hard log-size cap without leaking arbitrary data',()=>{
 const kinds=Object.fromEntries(['absent','null','boolean','integer','number','string','array','object','other'].map(k=>[k,50]));
 const formats=Object.fromEntries(['numeric','iso_with_zone','iso_without_zone','dotnet','other'].map(k=>[k,50]));
 const fields=Object.fromEntries(['ticketId','ticketNumber','portalId','typeId','typeName','statusId','customStatusId','deleted','creationDate','lastModDate','customerId','serviceLocationId','assignedTo','isActive','statusText','displayText','parentId','canBeParent'].map(k=>[k,{kinds,formats,private:secret}]));
 const collection={kind:'array',length:1000000,sampled:50,fields};
 const section={kind:'object',totalRowsKind:'integer',totalRows:1000000,topLevel:collection,data:collection,results:collection};
 const value=projectMhelpTicketSchema({ticketTypes:section,ticketStatuses:section,tickets:section});
 assert.equal(value.truncated,true);assert(new TextEncoder().encode(JSON.stringify(value)).length<6000);
 assert(!JSON.stringify(value).includes(secret));assert.equal(value.tickets.data.length,1000000);assert.equal(value.tickets.data.fields,undefined);
});
