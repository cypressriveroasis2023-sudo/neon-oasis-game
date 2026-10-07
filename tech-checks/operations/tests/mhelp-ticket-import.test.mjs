import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { chooseMhelpParser, findDuplicateImport, hashTicketFile, importTicketFingerprint, validateReviewedImport, verifiedMhelpParsers } from '../src/mhelpImportModel.ts';
import { createMhelpImportSaver } from '../src/mhelpImportPersistence.ts';

const source = { system:'mhelpdesk', sourceTicketId:'000123', sha256:'a'.repeat(64), filename:'synthetic.pdf', byteLength:20, mimeType:'application/pdf', parserId:'synthetic-only', parserVersion:'1' };
const ticket = () => ({ source: { ...source }, customerId:'customer-1', siteId:'site-1', jobType:'SERVICE', priority:'normal', title:'Synthetic service', description:'Test-only instructions', contactInstructions:'Synthetic contact', unitIds:['unit-1'], requestedSchedule:'Request only; no assignment', additionalInformation:'Retain unmapped fields', shopPrep:false, parserData:{sourceTicketId:{value:source.sourceTicketId,sourceLabel:'Work Order No.'},units:[],additionalFields:[],warnings:[]} });
const directory = () => ({ complete:true, customers:[{ id:'customer-1', active:true }], sites:[{ id:'site-1', customerId:'customer-1', active:true }], units:[{ id:'unit-1', siteId:'site-1', customerId:'customer-1', active:true }] });
const attachment = () => ({ id:'attachment-1', organizationId:'org-1', sha256:source.sha256, byteLength:20, state:'staged', recoverable:true });
const request = () => ({ organizationId:'org-1', attachment:attachment(), ticket:ticket(), directory:directory() });
const saved = () => ({ jobId:'job-1', organizationId:'org-1', attachmentId:'attachment-1', status:'saved', ticket:ticket() });
function fixture(overrides = {}) {
  const calls = [];
  const adapter = {
    commit: async () => { calls.push('commit'); return { jobId:'job-1', disposition:'created' }; },
    readJob: async () => { calls.push('read-job'); return saved(); },
    moveToRecoverableTrash: async () => { calls.push('trash'); },
    readAttachment: async () => { calls.push('read-trash'); return { ...attachment(), state:'trash' }; },
    ...overrides,
  };
  return { calls, adapter, saver:createMhelpImportSaver(adapter) };
}

test('generic drop zones require an explicit parser registration', () => {
  assert.deepEqual(verifiedMhelpParsers, []);
  for (const [name,type] of [['ticket.pdf','application/pdf'],['ticket.eml','message/rfc822'],['ticket.png','image/png'],['ticket.csv','text/csv']]) {
    assert.throws(() => chooseMhelpParser({ name, type, size:100 }, verifiedMhelpParsers), /not been verified/);
  }
});

test('file validation checks size, extension, MIME and ambiguous parser registrations', () => {
  const parser = { id:'synthetic', version:'1', extensions:['.fixture'], mimeTypes:['application/x-cos-test'] };
  const file = { name:'TEST.FIXTURE', size:1, type:'application/x-cos-test' };
  assert.equal(chooseMhelpParser(file, [parser]), parser);
  assert.equal(chooseMhelpParser({ ...file, type:'' }, [parser]), parser);
  for (const value of [{ size:0 }, { size:-1 }, { size:10*1024*1024+1 }, { name:'fixture.exe' }, { type:'application/pdf' }]) assert.throws(() => chooseMhelpParser({ ...file, ...value }, [parser]));
  assert.throws(() => chooseMhelpParser(file, [parser, parser]), /conflicting/);
});

test('hash records original bytes, independent of filename', async () => {
  const file = new File(['abc'], 'source.fixture');
  const renamed = new File(['abc'], 'renamed.fixture');
  assert.equal(await hashTicketFile(file), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await hashTicketFile(file), await hashTicketFile(renamed));
});

test('directory validation never matches a name or ignores wrong associations', () => {
  assert.doesNotThrow(() => validateReviewedImport(ticket(), directory()));
  const variants = [
    { complete:false },
    { customers:[{ id:'customer-1', active:false }] },
    { customers:[{ id:'customer-1', active:true },{ id:'customer-1', active:true }] },
    { sites:[{ id:'site-1', customerId:'other-customer', active:true }] },
    { units:[{ id:'unit-1', customerId:'customer-1', siteId:'other-site', active:true }] },
    { units:[{ id:'unit-1', customerId:'other-customer', siteId:'site-1', active:true }] },
    { units:[] },
  ];
  for (const change of variants) assert.throws(() => validateReviewedImport(ticket(), { ...directory(), ...change }));
  assert.throws(() => validateReviewedImport({ ...ticket(), unitIds:['unit-1','unit-1'] }, directory()), /more than once/);
  assert.throws(() => validateReviewedImport({ ...ticket(), siteId:'Site One' }, directory()), /site belonging/);
});

test('source identity and valid ticket details are required and leading zeroes are preserved', () => {
  for (const change of [{ sourceTicketId:'' },{ sha256:'' },{ byteLength:0 },{ parserVersion:'' }]) assert.throws(() => validateReviewedImport({ ...ticket(), source:{ ...source, ...change } }, directory()));
  assert.throws(() => validateReviewedImport({ ...ticket(), jobType:'INSTALL' }, directory()));
  assert.throws(() => validateReviewedImport({ ...ticket(), title:' ' }, directory()));
  assert.throws(() => validateReviewedImport({ ...ticket(), jobType:'PICKUP', shopPrep:true }, directory()));
  assert.match(importTicketFingerprint(ticket()), /000123/);
});

test('deduplication checks ID and hash across complete organization history', () => {
  const first = { organizationId:'org-1', jobId:'old-closed-job', sourceTicketId:source.sourceTicketId, sha256:'b'.repeat(64) };
  const second = { organizationId:'org-1', jobId:'same-file-job', sourceTicketId:'other-reference', sha256:source.sha256 };
  assert.deepEqual(findDuplicateImport(source, 'org-1', { complete:true, records:[first,second] }), [first,second]);
  assert.throws(() => findDuplicateImport(source,'org-1',{ complete:false, records:[] }), /complete import history/);
  assert.throws(() => findDuplicateImport(source,'org-1',{ complete:true, records:[{ ...first, organizationId:'another-org' }] }));
  assert.deepEqual(findDuplicateImport(source,'org-1',{ complete:true, records:[] }), []);
});

test('one save, complete independent readback, recoverable trash and independent trash readback', async () => {
  const { saver, calls } = fixture();
  assert.equal((await saver.save(request())).status, 'saved_and_trashed');
  assert.deepEqual(calls, ['commit','read-job','trash','read-trash']);
  assert.equal((await saver.save(request())).status, 'review_required');
  assert.equal(calls.filter(value => value === 'commit').length, 1);
});

test('every field, original reference and provenance must read back before trash', async () => {
  const changes = {
    customerId:'customer-2', siteId:'site-2', jobType:'PICKUP', priority:'urgent', title:'different', description:'',
    contactInstructions:'', unitIds:[], requestedSchedule:'', additionalInformation:'', shopPrep:true,
  };
  for (const [field,value] of Object.entries(changes)) {
    let trashed = false;
    const { saver } = fixture({ readJob:async () => ({ ...saved(), ticket:{ ...ticket(), [field]:value } }), moveToRecoverableTrash:async () => { trashed = true; } });
    assert.equal((await saver.save(request())).status,'unconfirmed',field);
    assert.equal(trashed,false,field);
  }
  for (const field of Object.keys(source)) {
    let trashed = false;
    const { saver } = fixture({ readJob:async () => ({ ...saved(), ticket:{ ...ticket(), source:{ ...source, [field]:null } } }), moveToRecoverableTrash:async () => { trashed = true; } });
    assert.equal((await saver.save(request())).status,'unconfirmed',field);
    assert.equal(trashed,false,field);
  }
});

test('wrong job/org/attachment, missing row and failed read retain original', async () => {
  for (const result of [null, { ...saved(), jobId:'other' },{ ...saved(), organizationId:'other' },{ ...saved(), attachmentId:'other' },{ ...saved(), status:'draft' }]) {
    const f = fixture({ readJob:async () => result });
    assert.equal((await f.saver.save(request())).status,'unconfirmed');
    assert.ok(!f.calls.includes('trash'));
  }
  const f = fixture({ readJob:async () => { throw new Error('Disconnected'); } });
  assert.equal((await f.saver.save(request())).status,'unconfirmed');
  assert.ok(!f.calls.includes('trash'));
});

test('uncertain save and duplicate response never trash or automatically retry', async () => {
  for (const response of ['throw', { jobId:'job-1', disposition:'duplicate' },{ jobId:'job-1', disposition:'unknown' }]) {
    let writes = 0;
    const f = fixture({ commit:async () => { writes++; if (response === 'throw') throw new Error('Timeout'); return response; } });
    const first = await f.saver.save(request());
    assert.equal(first.status, response?.disposition === 'duplicate' ? 'duplicate' : 'unconfirmed');
    assert.ok(!f.calls.includes('trash'));
    assert.equal((await f.saver.save(request())).status,'review_required');
    assert.equal(writes,1);
  }
});

test('repeated click is locked and editing draft during save cannot change its target', async () => {
  let release;
  const f = fixture({ commit:() => new Promise(resolve => { release = resolve; }) });
  const draft = request();
  const first = f.saver.save(draft);
  draft.ticket.title = 'Edited while saving';
  draft.ticket.source.sha256 = 'b'.repeat(64);
  draft.attachment.id = 'wrong-file';
  assert.equal((await f.saver.save(request())).status,'busy');
  release({ jobId:'job-1', disposition:'created' });
  assert.equal((await first).status,'saved_and_trashed');
});

test('staging mismatch prevents commit without locking the corrected draft', async () => {
  const f = fixture();
  await assert.rejects(() => f.saver.save({ ...request(), attachment:{ ...attachment(), sha256:'b'.repeat(64) } }), /staged original/);
  assert.deepEqual(f.calls, []);
  assert.equal(f.saver.needsReview,false);
});

test('trash failure or unverifiable trash never claims successful cleanup and never replays', async () => {
  for (const overrides of [
    { moveToRecoverableTrash:async () => { throw new Error('Timeout'); } },
    { readAttachment:async () => null },
    { readAttachment:async () => ({ ...attachment(), recoverable:false, state:'trash' }) },
    { readAttachment:async () => ({ ...attachment(), state:'staged' }) },
  ]) {
    const f = fixture(overrides);
    assert.equal((await f.saver.save(request())).status,'saved_file_retained');
    assert.equal((await f.saver.save(request())).status,'review_required');
    assert.equal(f.calls.filter(value => value === 'commit').length,1);
  }
});
