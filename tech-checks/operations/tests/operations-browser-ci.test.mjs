import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow=readFileSync(new URL('../../../.github/workflows/cos-operations.yml',import.meta.url),'utf8');
test('the full browser suite still runs after targeted failures when its build and browser are ready',()=>{
 const step=workflow.match(/      - name: Verify the complete browser suite\n([\s\S]*?)(?=      - name: Browser test artifacts)/)?.[1];
 assert.ok(step,'full browser suite remains present');
 assert.match(step,/if: \$\{\{ !cancelled\(\) && steps\.build\.outcome == 'success' && steps\.browser_install\.outcome == 'success' \}\}/);
 assert.match(step,/^        run: npm run test:browser$/m);
 assert.doesNotMatch(step,/continue-on-error|\|\|\s*true|--grep|--shard|--last-failed/);
});
