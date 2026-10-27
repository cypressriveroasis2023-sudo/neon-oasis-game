import test from 'node:test';
import assert from 'node:assert/strict';
import {productConnectionFleetRows,productConnectionUnitDetail} from '../src/productConnectionFleetRows.ts';
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
 
test('verified Unknown TCP result supersedes a native provider Online label',()=>{
 const unknown={...product,state:'unverified',reason:'No current completed TCP check',
  evidence:{association:'exact_product_id_tracker_endpoint',basis:'connection',gap:'no_current_reading',
   observedAt:null,observations:[]}};
 const oldOnline={...row,cameraState:'online',camera:{...row.camera,state:'online',reason:'Old provider online'}};
 const result=productConnectionFleetRows([oldOnline],{items:[unknown]})[0];
 assert.equal(result.cameraState,'unknown');
 assert.equal(result.camera.state,'unknown');
 assert.equal(result.camera.basis,'connection');
 assert.equal(result.camera.checkedAt,null);
 assert.equal(result.camera.reason,'No current completed TCP check');
 assert.equal(oldOnline.cameraState,'online');
});

test('selected Camera Health unit detail uses Product-ID TCP status instead of provider Online',()=>{
 const base={state:'online',reason:'Provider online',basis:'provider',checkedAt:'2026-10-26T20:55:00Z',identity:'missing',rows:[],classification:null,unitKey:null};
 const unknown={...product,state:'unverified',reason:'No current saved TCP check',
  evidence:{association:'exact_product_id_tracker_endpoint',basis:'connection',gap:'no_current_reading',observedAt:null,observations:[]}};
 const result=productConnectionUnitDetail(base,'unit-1',[unknown]);
 assert.equal(result.state,'unknown');assert.equal(result.basis,'connection');assert.equal(result.checkedAt,null);
 assert.equal(result.reason,'No current saved TCP check');assert.equal(result.identity,'missing');
 assert.equal(productConnectionUnitDetail(base,'unit-1',[unknown,unknown]),base);
 assert.equal(productConnectionUnitDetail(base,'unit-1',[{...unknown,unitId:null}]),base);
 assert.equal(base.state,'online');
});
