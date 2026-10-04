import test from 'node:test';
import assert from 'node:assert/strict';
const endpoint='https://tughscoxralhofrckvxy.supabase.co/functions/v1/cos-operations-pages';
const origin='https://cypressriveroasis2023-sudo.github.io';
test('deployed bridge boots and rejects anonymous owner access',async()=>{
  const response=await fetch(endpoint,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({path:'/api/session',method:'GET'})});
  assert.equal(response.status,401);
  assert.equal(response.headers.get('access-control-allow-origin'),origin);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.match((await response.json()).error,/sign in/i);
});
test('deployed bridge rejects a foreign browser origin',async()=>{
  const response=await fetch(endpoint,{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({path:'/api/session',method:'GET'})});
  assert.equal(response.status,403);
  assert.match((await response.json()).error,/origin/i);
});
test('deployed bridge permits only the intended CORS transport',async()=>{
  const response=await fetch(endpoint,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}});
  assert.equal(response.status,204);
  assert.equal(response.headers.get('access-control-allow-origin'),origin);
  assert.equal(response.headers.get('access-control-allow-methods'),'GET, POST, OPTIONS');
});
