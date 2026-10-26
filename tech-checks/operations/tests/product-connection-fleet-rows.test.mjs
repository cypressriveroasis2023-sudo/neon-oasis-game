import test from 'node:test';
import assert from 'node:assert/strict';
import {productConnectionFleetRows} from '../src/productConnectionFleetRows.ts';
const evidence={association:'exact_product_id_tracker_endpoint',basis:'connection',observedAt:'2026-10-26T21:00:00Z',observations:[{resourceId:'99',source:'Saved TCP/service-port check',kind:'connection',reportedStatus:'offline',currentState:'offline',fresh:true,observedAt:'2026-10-26T21:00:00Z'}]};
const product={productId:'11',unitId:'unit-1',state:'offline',evidence,reason:'Completed exact TCP nonresponse'};
const row={id:'unit-1',placement:'field',retired:false,support:false,cameraState:'unknown',camera:{state:'unknown',basis:'camera',reason:'Provider unknown',checkedAt:null,identity:'missing',rows:[],classification:null},review:['Provider unknown','Location review']};
test('exact Product ID may change native Fleet display status but never raw provider proof',()=>{
 const value=productConnectionFleetRows([row],{items:[product]})[0];
 assert.equal(value.cameraState,'offline');assert.equal(value.camera.basis,'connection');
 assert.equal(value.camera.identity,'missing');assert.equal(value.camera.checkedAt,evidence.observedAt);
 assert.deepEqual(value.review,['Location review']);assert.equal(row.cameraState,'unknown');
});
test('duplicate ownership, Shop, support, inactive, malformed or stale observations cannot override the native signal',()=>{
 const invalid=[
  {products:[product,{...product,productId:'12'}]},
  {rows:[{...row,placement:'shop'}]},
  {rows:[{...row,support:true}]},
  {rows:[{...row,retired:true}]},
  {products:[{...product,evidence:null}]},
  {products:[{...product,evidence:{...evidence,observations:[{...evidence.observations[0],fresh:false}]}}]}
 ];
 for(const v of invalid){const result=productConnectionFleetRows(v.rows||[row],{items:v.products||[product]});assert.equal(result[0].cameraState,'unknown');}
});
