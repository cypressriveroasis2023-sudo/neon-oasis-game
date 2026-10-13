import test from 'node:test';import assert from 'node:assert/strict';
import {prepare,parseCsv,sha,statements,build} from '../scripts/build-mhelp-upload.mjs';
const hash='a'.repeat(64),tracker='11111111-1111-4111-8111-111111111111';
function fixture(){const csvBytes=Buffer.from('ProductId,ProductModel,Category,CustomerId,CustomerName,Address,City,State,Zip,CreationDate\r\n101,Sniper 2 017,Sniper 2,11,Synthetic Company,"123 Test St\nSuite 2",Test,TX,00000,\r\n');
 const canonical={source:{sha256:sha(csvBytes),size_bytes:csvBytes.length,library_file_id:'libfile_synthetic',filename:'Export_20990101.csv',received_message_id:'SyntheticMessage',received_at_conversation_minute_utc:'2026-10-13T18:22Z'},authority:{company_customer_ids:{11:'Synthetic Company'}},summary:{records:1},records:[{csv_record:2,product_id:'101',unit:'Sniper 2 017',category:'Sniper 2',customer_id:'11',customer:'Synthetic Company',address:'123 Test St\nSuite 2',city:'Test',state:'TX',zip:'00000',placement:'SHOP',lifecycle:'UNFLAGGED'}]};
 const review={source:{sha256:sha(csvBytes)},records:[{product_id:'101',csv_record:2,source_unit:'Sniper 2 017',source_category:'Sniper 2',canonical_family_unit:'SNIPER2:17',status:'unambiguous_canonical_candidate',match_method:'exact_canonical_family_unit',tracker_id:tracker,native_unit_id:null,evidence:{exact:'synthetic'},registry_candidates:{tracker:[{id:tracker,label:'Sniper 2 017'}],native:[]},hold_reasons:[]}]};
 return {csvBytes,canonical,review,guards:[{productId:'101',expectedGuard:hash,competingProductId:false,representedUnitIds:[tracker],representationEvidenceSha256:hash}]};}
test('private preparer verifies source bytes and complete review; filename never becomes observation freshness',()=>{
 const p=prepare(fixture());assert.equal(p.receipt.receivedAt,'2026-10-13T18:22:00Z');assert.equal(p.receipt.exportAsOf,null);assert.equal(p.records[0].sourceAddress.street,'123 Test St\nSuite 2');assert.equal(p.records[0].binding.matchMethod,'exact_family_unit');assert.equal(p.summary.boundRecords,1);
 const sql=statements(p);assert.match(sql['dry-run.sql'],/,false\);\nrollback/);assert.match(sql['apply.sql'],/,true\);\ncommit/);assert.match(sql['rollback.sql'],/rollback_upload/);
});
test('raw file tampering, partial/duplicate review and stale row identity fail closed',()=>{
 const altered=fixture();altered.csvBytes=Buffer.from(altered.csvBytes+'\n');assert.throws(()=>prepare(altered),/hash\/size/);
 const incomplete=fixture();incomplete.review.records=[];assert.throws(()=>prepare(incomplete),/Incomplete/);
 const wrong=fixture();wrong.canonical.records[0].customer='Other';assert.throws(()=>prepare(wrong),/differs from CSV/);
 const label=fixture();label.review.records[0].source_unit='Sniper 4 017';assert.throws(()=>prepare(label),/identity\/row/);
});
test('competing ProductId stays held and never becomes an automatic identity merge',()=>{
 const x=fixture();x.guards[0].competingProductId=true;const p=prepare(x);assert.equal(p.records[0].binding,null);assert.equal(p.records[0].holdReason,'competing_active_product_id');assert.deepEqual(p.records[0].possibleAliasUnitIds,[tracker]);
});
test('CSV quoting and public-repository private input prohibition',async()=>{
 assert.deepEqual(parseCsv('\uFEFFa,b\r\n"x,y","quoted ""value"""\r\n'),[{a:'x,y',b:'quoted "value"'}]);assert.throws(()=>parseCsv('a\n"unclosed'),/Unclosed/);assert.throws(()=>parseCsv('a\n"closed"tail'),/Unexpected/);
 await assert.rejects(()=>build({csvPath:new URL('../package.json',import.meta.url).pathname,canonicalPath:'unused',reviewPath:'unused',guardsPath:'unused',outPath:'/tmp/unused'}),/outside the repository|ENOENT/);
});
