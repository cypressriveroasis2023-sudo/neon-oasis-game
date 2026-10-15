import assert from 'node:assert/strict';
// Force a fresh parse of the unchanged continuity helper after adding a graph
// helper overload. An old cached SQL plan can otherwise hide ambiguity.
// Only the disposable fixture administrator uses these transactional helpers.
export async function applyOverloadFixture(client,{createSql,continuityDefinition=null}){
 const original=(await client.query('show check_function_bodies')).rows[0].check_function_bodies;
 await client.query('begin');
 try{
  await client.query(createSql);
  if(continuityDefinition){
   await client.query('set local check_function_bodies=off');
   await client.query(continuityDefinition);
   await client.query('set local check_function_bodies=on');
  }
  await client.query('commit');
 }catch(error){await client.query('rollback');throw error;}
 assert.equal((await client.query('show check_function_bodies')).rows[0].check_function_bodies,original,'Fixture must restore the original session setting');
}
export async function removeOverloadFixture(client,{dropSql,continuityDefinition=null}){
 const original=(await client.query('show check_function_bodies')).rows[0].check_function_bodies;
 await client.query('begin');
 try{
  await client.query(dropSql);
  // Recreate only after removing ambiguity, with normal body validation enabled.
  if(continuityDefinition){await client.query('set local check_function_bodies=on');await client.query(continuityDefinition);}
  await client.query('commit');
 }catch(error){await client.query('rollback');throw error;}
 assert.equal((await client.query('show check_function_bodies')).rows[0].check_function_bodies,original,'Cleanup must restore the original session setting');
}
