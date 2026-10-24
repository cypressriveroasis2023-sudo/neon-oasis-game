import test from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {readFile} from 'node:fs/promises';
import {desiredCustomer,snapshotCell} from '../../supabase/functions/cos-sheets-placement-publish/model.ts';
const cells=['Synthetic Unit','FIELD','Builder: Division','Division'].map(s=>snapshotCell({userEnteredValue:{stringValue:s}}));
const o={placement:'FIELD',customerLabel:'Builder: Division',siteLabel:'Division'};
test('explicit plain style never infers combined formatting from punctuation in a real customer name',async()=>{
 assert.equal(desiredCustomer({customerStyle:'plain',baseline:cells},o),'Builder: Division');
 const sql=await readFile(new URL('../db/mhelp-publisher-reviewed-bindings.sql',import.meta.url),'utf8');
 const fn=sql.slice(sql.indexOf('create function cos_sheets_placement_private.customer_value'),sql.indexOf('do $patch$'));
 const db=new PGlite();try{await db.exec('create schema cos_sheets_placement_private;'+fn);assert.equal((await db.query('select cos_sheets_placement_private.customer_value($1,$2,$3) v',[cells,o,'plain'])).rows[0].v,'Builder: Division');}finally{await db.close();}
});
