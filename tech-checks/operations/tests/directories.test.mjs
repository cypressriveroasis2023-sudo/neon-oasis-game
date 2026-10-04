import assert from 'node:assert/strict';
import test from 'node:test';
import {DirectorySaveError,equipmentSnapshot,payloadFor,records,saveDirectory,teamJobCount,teamRecords} from '../src/directoryData.js';

const id='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const model='33333333-3333-4333-8333-333333333333';
const customer={id,name:'North Customer',legalName:null,notes:null,status:'active'};
const site={id,customerId:other,name:'Gate',addressLine1:'100 Main',addressLine2:null,city:'Katy',stateRegion:'TX',postalCode:'77494',country:'US',accessInstructions:'Call on arrival',parkingInstructions:null,safetyNotes:'Hard hat',operationalNotes:null,status:'active'};
const unit={id,modelId:model,unitNumber:'UNIT-5',serialNumber:null,status:'available',currentLocationType:'shop'};
const modelRows=[{id:model,name:'Sniper',code:'SNP'}];

test('directory schema failures never become an empty successful list',()=>{
  for(const input of [{},null,{items:null},{items:[{}]},{items:[{id:'fake',name:'Demo'}]}]) assert.throws(()=>records(input));
  assert.deepEqual(records({items:[]}),[]);
  assert.throws(()=>equipmentSnapshot({items:[unit]}),/model list/);
  assert.throws(()=>teamRecords({items:[{userId:id,displayName:'Real member',department:'owner',active:true}]}));
});

test('payload uses only allowed editable fields and validates identifiers and required input',()=>{
  const payload=payloadFor('Customers',{...customer,p_actor_user_id:other,roles:['owner'],name:' North Customer '});
  assert.deepEqual(payload,{name:'North Customer',legalName:'',notes:'',status:'active'});
  assert.throws(()=>payloadFor('Sites',{...site,customerId:'made-up'}),/production records/);
  assert.throws(()=>payloadFor('Equipment',{...unit,status:'demo'}),/equipment status/);
  assert.throws(()=>payloadFor('Customers',{...customer,name:'  '}),/Name is required/);
});

test('customer, site, and equipment saves write once and verify a fresh authoritative snapshot',async()=>{
  for(const[kind,row]of [['Customers',customer],['Sites',site],['Equipment',unit]]) {
    const calls=[];
    const data={items:[row],...(kind==='Equipment'?{models:modelRows}:{})};
    const client={
      async post(path,payload){calls.push({method:'POST',path,payload});return{data:{id}};},
      async get(path){calls.push({method:'GET',path});return{data};},
    };
    const result=await saveDirectory(client,kind,row);
    assert.equal(result.record,row);
    assert.equal(calls.length,2);
    assert.equal(calls[0].method,'POST');
    assert.ok(calls[0].path.endsWith('/'+id));
    assert.equal(calls[1].method,'GET');
    assert.equal('id'in calls[0].payload,false);
    assert.equal('p_actor_user_id'in calls[0].payload,false);
  }
});

test('creation uses returned identity, not a matching name from an older record',async()=>{
  let writes=0;
  const client={
    async post(path){writes++;assert.equal(path,'/api/customers');return{data:{id:other}};},
    async get(){return{data:{items:[customer,{...customer,id:other}]}};},
  };
  const result=await saveDirectory(client,'Customers',{...customer,id:null});
  assert.equal(result.record.id,other);
  assert.equal(writes,1);
});

test('successful write with stale readback cannot show success or replay a write',async()=>{
  let writes=0;
  const client={async post(){writes++;return{data:{id}};},async get(){return{data:{items:[{...customer,name:'Old Name'}]}};}};
  await assert.rejects(()=>saveDirectory(client,'Customers',customer),error=>error instanceof DirectorySaveError&&error.phase==='uncertain'&&error.recordId===id);
  assert.equal(writes,1);
});

test('lost write response and failed readback require refresh without automatic retries',async()=>{
  let writes=0;
  const unknown={async post(){writes++;throw new Error('Connection closed');},async get(){assert.fail('No readback after unknown write result');}};
  await assert.rejects(()=>saveDirectory(unknown,'Customers',customer),error=>error.phase==='uncertain');
  assert.equal(writes,1);
  const accepted={async post(){writes++;return{data:{id}};},async get(){throw new Error('Offline');}};
  await assert.rejects(()=>saveDirectory(accepted,'Customers',customer),error=>error.phase==='uncertain'&&/fresh records/.test(error.message));
  assert.equal(writes,2);
});

test('validation rejections remain editable, and an unexpected saved identity is never trusted',async()=>{
  const rejected={async post(){throw Object.assign(new Error('Duplicate unit'),{response:{status:409}});},async get(){assert.fail('Rejected write must not read back');}};
  await assert.rejects(()=>saveDirectory(rejected,'Equipment',unit),error=>error.phase==='rejected'&&error.message==='Duplicate unit');
  const wrong={async post(){return{data:{id:other}};},async get(){assert.fail('Do not trust another record identity');}};
  await assert.rejects(()=>saveDirectory(wrong,'Customers',customer),error=>error.phase==='uncertain');
});

test('team workload follows exact platform technician UUID and excludes closed work',()=>{
  const member={userId:id,displayName:'Same Name',department:'it',active:true};
  const jobs=[
    {technicianUserId:id,technician:'Other Name',status:'Assigned'},
    {technicianUserId:other,technician:'Same Name',status:'Assigned'},
    {technicianUserId:id,technician:'Same Name',status:'Closed'},
    {technicianUserId:id,technician:'Same Name',status:'cancelled'},
    {technician:'Same Name',status:'Assigned'},
  ];
  assert.equal(teamJobCount(member,jobs),1);
  assert.deepEqual(teamRecords({items:[member]}),[member]);
});
