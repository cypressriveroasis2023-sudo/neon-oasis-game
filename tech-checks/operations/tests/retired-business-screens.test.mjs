import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readWorkspaceRoute, workspaceHash, retiredBusinessWorkspaces} from '../src/workspaceNavigation.ts';
import {approvedToolGroups} from '../src/approvedCosNavigation.ts';

const src=fileURLToPath(new URL('../src/', import.meta.url));
function walk(dir, out=[]) {
  for (const name of readdirSync(dir)) {
    const path=join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(path);
  }
  return out;
}
function gone(path) {
  const value=String(path).split('?')[0];
  if (value==='/api/team'||value==='/api/owner-review'||value==='/api/owner-review/signatures'||value==='/api/mhelpdesk/intake/status'||value==='/api/financial-summary'||value==='/api/owner/control-data'||value==='/api/owner/jobs/manual') return true;
  if (/^\/api\/owner\/jobs\/[^/]+\/advance-it$/.test(value)) return true;
  if (/^\/api\/owner\/truck-checks\/[^/]+\/approve$/.test(value)) return true;
  for (const prefix of ['/api/jobs','/api/quotes','/api/ar','/api/purchasing','/api/customers','/api/sites','/api/work-requests','/api/owner-tasks','/api/mhelpdesk/imports']) {
    if (value===prefix||value.startsWith(prefix+'/')) return true;
  }
  return false;
}
test('kept frontend code does not call a retired business route', () => {
  const hits=[];
  const literal=/['"`](\/api\/[^'"`\s]+)['"`]/g;
  for (const file of walk(src)) {
    const text=readFileSync(file,'utf8');
    for (const match of text.matchAll(literal)) if (gone(match[1])) hits.push(file.replace(src,'')+' '+match[1]);
  }
  assert.deepEqual(hits, []);
});
test('retired hashes and More-menu tools are not reachable', () => {
  const tools=approvedToolGroups.flatMap(group=>group.items);
  for (const workspace of retiredBusinessWorkspaces) {
    assert.equal(tools.includes(workspace), false, workspace);
    assert.equal(readWorkspaceRoute(workspaceHash({workspace, jobId:'42', detail:true})).workspace, 'Today');
  }
  for (const hash of ['#jobs','#unscheduled','#dispatch','#calendar','#quotes','#invoices','#billing','#purchasing','#crm','#customers','#sites','#work-requests','#owner-tasks']) {
    assert.equal(readWorkspaceRoute(hash).workspace, 'Today', hash);
  }
});
test('kept pages remain routable for owner, IT and Service shells', () => {
  for (const workspace of ['Today','Daily Board','Fleet Dashboard','Camera Health','Team','Tech Check','Handoffs','Owner Review','Units On Hand','Equipment','InHand Routers']) {
    assert.equal(readWorkspaceRoute(workspaceHash({workspace, jobId:'', detail:false})).workspace, workspace);
  }
  for (const workspace of ['IT Dashboard','Fleet Dashboard','Camera Health','MHelp']) {
    assert.equal(readWorkspaceRoute(workspaceHash({workspace, jobId:'', detail:false})).workspace, workspace);
  }
});
