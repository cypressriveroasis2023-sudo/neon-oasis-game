import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {checkedMhelpTicketPreview,ticketDetailEvidenceCapability,ticketDetailEvidenceFields,ticketDetailItemEvidenceFields,ticketDetailCustomEvidenceFields} from '../src/mhelpTicketPreviewModel.ts';
import MhelpTicketPreview,{MhelpTicketDetailEvidence} from '../src/MhelpTicketPreview.tsx';
import {ticketPreviewFixture,ticketPreviewEvidenceFixture,ticketPreviewDetailFixture} from './fixtures/mhelpTicketPreview.mjs';

const reject=value=>assert.throws(()=>checkedMhelpTicketPreview(value),error=>error.message==='The ticket preview response could not be verified. Try again.');
test('new explicit detail capability preserves both legacy aggregate and v1 structural DTOs',()=>{
  assert.equal(ticketDetailEvidenceCapability,'ticket_detail_structure_v1');
  for(const value of [ticketPreviewFixture(),ticketPreviewEvidenceFixture(),ticketPreviewDetailFixture()])assert.deepEqual(checkedMhelpTicketPreview(value),value);
  const source=readFileSync(new URL('../src/MhelpTicketPreview.tsx',import.meta.url),'utf8');
  assert.match(source,/evidence:ticketAppointmentEvidenceCapability/);
  assert.doesNotMatch(source,/ticketId:|ticket_id:|\.get\(/);
  const html=renderToStaticMarkup(React.createElement(MhelpTicketPreview));
  for(const text of ['at most one additional ticket detail read','only when exactly one ticket is found','same window','cannot enter or select a ticket ID','No detail is read automatically','does not import historical tickets'])assert(html.includes(text));
  assert.equal((html.match(/<button\b/g)||[]).length,2);
  assert(!html.includes('<input'));assert(!html.includes('<select'));assert(!html.includes('Single-ticket detail evidence'));
});
test('detail field names and all nesting are a fixed count-only contract',()=>{
  const detail=checkedMhelpTicketPreview(ticketPreviewDetailFixture()).detailEvidence;
  assert.deepEqual(Object.keys(detail.fields),[...ticketDetailEvidenceFields]);
  assert.deepEqual(Object.keys(detail.collections.items.fields),[...ticketDetailItemEvidenceFields]);
  assert.deepEqual(Object.keys(detail.collections.customFields.fields),[...ticketDetailCustomEvidenceFields]);
  assert.deepEqual(detail.collections.equipment.fields,{});
  assert.equal(detail.sampledTickets,1);assert.equal(detail.nestedSampleLimit,50);
  assert(new TextEncoder().encode(JSON.stringify(detail)).length<=16000);
});
test('detail selection availability is bound to the validated window count',()=>{
  for(const ticketCount of [0,1,2,50,500])assert.deepEqual(checkedMhelpTicketPreview(ticketPreviewDetailFixture({ticketCount})),ticketPreviewDetailFixture({ticketCount}));
  for(const [ticketCount,detailCount] of [[0,1],[1,0],[1,2],[2,1],[0,2],[2,0]]){
    const value=ticketPreviewDetailFixture({ticketCount});value.detailEvidence=ticketPreviewDetailFixture({ticketCount:detailCount}).detailEvidence;reject(value);
  }
  const value=ticketPreviewDetailFixture();delete value.operationalEvidence;reject(value);
  for(const detailEvidence of [undefined,null,false,[],{},'synthetic private'])reject({...ticketPreviewEvidenceFixture(),detailEvidence});
});
test('no sample is attached to an unavailable detail or invented without a singleton',()=>{
  for(const ticketCount of [0,2])for(const mutate of [
    d=>{d.reason='synthetic private';},d=>{d.sampledTickets=1;},d=>{d.reason=ticketCount?'empty_window':'ambiguous_window';},
    d=>{d.fields={subject:'synthetic private'};},d=>{d.collections={};},d=>{d.nestedSampleLimit=50;},d=>{d.availability={};},d=>{delete d.reason;},
  ]){const value=ticketPreviewDetailFixture({ticketCount});mutate(value.detailEvidence);reject(value);}
});
test('all detail record levels reject unknown source keys and removed required keys',()=>{
  const paths=[];
  const walk=(value,path=[])=>{if(value&&typeof value==='object'&&!Array.isArray(value)){paths.push(path);for(const [key,child] of Object.entries(value))walk(child,[...path,key]);}};
  walk(ticketPreviewDetailFixture().detailEvidence);
  for(const path of paths){
    const value=ticketPreviewDetailFixture(),target=path.reduce((row,key)=>row[key],value.detailEvidence);
    target['synthetic private@example.test']='synthetic private token / ticket-123';reject(value);
  }
  for(const path of [[],['fields'],['collections'],['availability'],['collections','items'],['collections','items','fields'],['collections','items','fields','name'],['collections','equipment']]){
    const base=ticketPreviewDetailFixture(),target=path.reduce((row,key)=>row[key],base.detailEvidence);
    for(const key of Object.keys(target)){const value=structuredClone(base),row=path.reduce((row,key)=>row[key],value.detailEvidence);delete row[key];reject(value);}
  }
});
test('single-ticket kinds, formats, availability and numeric bounds fail closed',()=>{
  for(const mutate of [
    d=>{d.contract='other';},d=>{d.scope='first_ticket_page';},d=>{d.state='other';},d=>{d.sampledTickets=2;},d=>{d.nestedSampleLimit=51;},
    d=>{d.fields.subject.kinds={string:2};},d=>{d.fields.subject.kinds={string:1,null:0};},d=>{d.fields.subject.formats={other:2};},
    d=>{d.fields.subject.nonemptyStrings=0;},d=>{d.fields.subject.nonemptyStrings='1';},d=>{d.fields.subject.emptyStrings=-1;},
    d=>{d.fields.subject.kinds={integer:0.5,string:0.5};},d=>{d.fields.subject.formats={other:1,credential:1};},
    d=>{d.availability.description='nonempty_text_absent';},d=>{d.availability.description='ready';},d=>{d.availability.site='verified';},
    d=>{d.availability.equipment='linked';},d=>{d.availability.schedule='scheduled';},d=>{d.availability.items='mapped';},d=>{d.availability.customFields='mapped';},
    d=>{d.collections.equipment.fields.serialNumber={kinds:{string:1}};},d=>{d.collections.equipment.totalEntries=1000001;},
    d=>{d.collections.items.kinds={array:2};},d=>{d.collections.items.emptyArrays=1;},d=>{d.collections.items.nonemptyArrays=0;},
    d=>{d.collections.items.totalEntries=0;},d=>{d.collections.items.totalEntries=1.5;},d=>{d.collections.items.sampledEntries=1;},
    d=>{d.collections.items.entryKinds={object:1};},d=>{d.collections.items.entryKinds={null:2};},d=>{d.collections.items.fields.notes.formats={other:1};},
    d=>{d.collections.customFields.fields.fieldValue.nonemptyStrings=0;},d=>{d.collections.customFields.fields.fieldLabel.kinds={object:1};},
  ]){const value=ticketPreviewDetailFixture();mutate(value.detailEvidence);reject(value);}
});
test('nonempty description availability reflects only the three allowlisted string counters',()=>{
  const value=ticketPreviewDetailFixture({hasDescription:false});assert.equal(checkedMhelpTicketPreview(value).detailEvidence.availability.description,'nonempty_text_absent');
  for(const key of ['subject','summary','comment']){
    const next=structuredClone(value);next.detailEvidence.fields[key]={kinds:{string:1},formats:{other:1},emptyStrings:0,nonemptyStrings:1};next.detailEvidence.availability.description='nonempty_text_present';
    assert.deepEqual(checkedMhelpTicketPreview(next),next);
  }
  const empty=structuredClone(value);empty.detailEvidence.fields.summary={kinds:{string:1},formats:{other:1},emptyStrings:1,nonemptyStrings:0};assert.deepEqual(checkedMhelpTicketPreview(empty),empty);
});
test('each detail collection independently caps nested samples without losing array totals',()=>{
  for(const entries of [0,1,49,50,51,1000000]){
    const value=ticketPreviewDetailFixture({itemEntries:entries,customEntries:entries,equipmentEntries:entries}),detail=checkedMhelpTicketPreview(value).detailEvidence;
    for(const collection of Object.values(detail.collections)){
      assert.equal(collection.totalEntries,entries);assert.equal(collection.sampledEntries,Math.min(entries,50));
    }
  }
});

test('primitive nested entries require absent field evidence instead of fabricated content',()=>{
  const value=ticketPreviewDetailFixture();
  for(const collection of [value.detailEvidence.collections.items,value.detailEvidence.collections.customFields]){
    collection.entryKinds={null:collection.sampledEntries};
    for(const key of Object.keys(collection.fields))collection.fields[key]={kinds:{absent:collection.sampledEntries},formats:{},emptyStrings:0,nonemptyStrings:0};
  }
  assert.deepEqual(checkedMhelpTicketPreview(value),value);
});

test('detail rendering distinguishes unavailable, absent text, capped arrays and unverified linkage',()=>{
  const legacy=renderToStaticMarkup(React.createElement(MhelpTicketDetailEvidence));
  assert.match(legacy,/Single-ticket detail evidence is unavailable in this response/);assert(!legacy.includes('<table'));
  for(const ticketCount of [0,2]){
    const evidence=checkedMhelpTicketPreview(ticketPreviewDetailFixture({ticketCount})).detailEvidence;
    const html=renderToStaticMarkup(React.createElement(MhelpTicketDetailEvidence,{evidence}));
    assert.match(html,/No ticket detail was read/);assert(html.includes(ticketCount?'More than one ticket':'No tickets'));assert(!html.includes('<table'));
  }
  const evidence=checkedMhelpTicketPreview(ticketPreviewDetailFixture({itemEntries:124,customEntries:0,equipmentEntries:51,hasDescription:false})).detailEvidence;
  const html=renderToStaticMarkup(React.createElement(MhelpTicketDetailEvidence,{evidence}));
  for(const text of ['No nonempty text was found','One server-selected ticket detail','same creation window','Site remains unresolved','Schedule remains unverified','POST/PUT write-model candidate','a GET equipment contract has not been verified','Items and custom fields remain unmapped structures','124 array entries within sampled tickets · 50 nested entries sampled','51 array entries within sampled tickets · 50 nested entries sampled','No nested entries were available'])assert(html.includes(text));
  assert.equal((html.match(/<table\b/g)||[]).length,3);
  assert(!html.includes('<input'));assert(!html.includes('<button'));assert(!html.includes('fields{}'));
});
