// Signing out on one device must not revoke other sessions. Supabase treats
// signOut() with no scope as global, which would sign the TV out too.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const roots = ['tech-checks', 'cameras-on-site'].map(name => join(repo, name));
const skipDirs = new Set(['node_modules', 'dist', 'tests', '.git']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(js|html|mjs|ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

function callsIn(text) {
  const found = [];
  const pattern = /\.signOut\s*\(/g;
  let match;
  while ((match = pattern.exec(text))) {
    let depth = 1;
    let i = match.index + match[0].length;
    let quote = '';
    for (; i < text.length && depth; i++) {
      const ch = text[i];
      if (quote) {
        if (ch === '\\') { i++; continue; }
        if (ch === quote) quote = '';
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    if (depth) found.push({args: null, index: match.index});
    else found.push({args: text.slice(match.index + match[0].length, i - 1).trim(), index: match.index});
  }
  return found;
}

const localScope = /^\{\s*scope\s*:\s*'local'\s*\}$/;

test('every served signOut call is local to this device', () => {
  const files = roots.flatMap(root => walk(root));
  const bad = [];
  const counts = {};
  for (const file of files) {
    const rel = relative(repo, file).split(sep).join('/');
    const calls = callsIn(readFileSync(file, 'utf8'));
    if (!calls.length) continue;
    counts[rel] = calls.length;
    for (const call of calls) {
      if (!localScope.test(call.args || '')) bad.push(`${rel}: signOut(${call.args ?? 'unterminated'})`);
    }
  }
  assert.deepEqual(bad, []);
  assert.equal(counts['tech-checks/app.js'], 4);
  assert.equal(counts['tech-checks/camera-health.html'], 2);
  assert.equal(counts['tech-checks/it-send-repair.html'], 1);
  assert.equal(counts['cameras-on-site/tech-check-netlify/src/app.js'], 4);
  assert.equal(counts['cameras-on-site/shared/core.js'], 3);
  assert.equal(counts['cameras-on-site/tech-check-netlify/public/it-send-repair.html'], 1);
  assert.equal(Object.values(counts).reduce((sum, n) => sum + n, 0), 15);
});
