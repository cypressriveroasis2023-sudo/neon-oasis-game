import test from 'node:test';
import assert from 'node:assert/strict';
import {readTicketDirectory} from '../src/ticketDirectoryData.ts';
const customer={id:'11111111-1111-4111-8111-111111111111',name:'Fixture customer',status:'active'};
const site={id:'22222222-2222-4222-8222-222222222222',customerId:customer.id,name:'Fixture site',status:'active'};
test('ticket directory retains every active customer beyond 1000 rows, including customers without sites',()=>{
 const customers=Array.from({length:1506},(_,i)=>({...customer,id:'a0000000-0000-4000-8000-'+String(i).padStart(12,'0')}));
 const result=readTicketDirectory({items:customers},{items:[]});assert.equal(result.customers.length,1506);assert.equal(result.sites.length,0);
});
test('inactive customers and sites are excluded from ticket choices',()=>{
 assert.deepEqual(readTicketDirectory({items:[{...customer,status:'inactive'}]},{items:[{...site,status:'inactive'}]}),{customers:[],sites:[]});
});
for(const [name,customers,sites] of [
 ['missing customer status',[{...customer,status:undefined}],[site]],
 ['missing site status',[customer],[{...site,status:undefined}]],
 ['missing site customer',[customer],[{...site,customerId:undefined}]],
 ['unknown site customer',[customer],[{...site,customerId:site.id}]],
 ['duplicate customer',[customer,customer],[site]],
 ['duplicate site',[customer],[site,site]],
])test(name+' is an unavailable-data error instead of an empty directory',()=>assert.throws(()=>readTicketDirectory({items:customers},{items:sites})));

// The saved directory includes archived historical rows alongside active imports.
test('unrelated archived customer and site rows do not block the active directory',()=>{
 const archivedCustomer={...customer,id:'33333333-3333-4333-8333-333333333333',status:'archived'};
 const archivedSite={...site,id:'44444444-4444-4444-8444-444444444444',customerId:archivedCustomer.id,status:'archived'};
 assert.deepEqual(readTicketDirectory({items:[customer,archivedCustomer]},{items:[site,archivedSite]}),{customers:[customer],sites:[site]});
});
