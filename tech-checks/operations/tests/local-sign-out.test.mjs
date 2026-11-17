// Signing out on one device must not revoke other sessions. Supabase treats
// signOut() with no scope as global, which would sign the TV out too.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const roots = ['tech-checks', 'cameras-on-site'].map(name => join(repo, name));
// tests hold the negative fixtures below and are not served. node_modules is
// not served. dist is skipped by the walk and then the operations bundle,
// which GitHub Pages serves, is added back on purpose.
const skipDirs = new Set(['node_modules', 'dist', 'tests', '.git']);
const servedDist = join(repo, 'tech-checks/operations/dist');
const localScope = /^\{\s*scope\s*:\s*'local'\s*\}$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(js|html|mjs|ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

function argumentOf(text, open) {
  let depth = 1;
  let i = open;
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
  if (depth) return null;
  return {args: text.slice(open, i - 1).trim(), end: i};
}

/** Every way a served file can call Supabase signOut, including the forms a
 * member-call scan misses: optional call, bracket access, and a destructured
 * binding. A call is local only when its argument is exactly { scope: 'local' }. */
export function signOutCalls(text) {
  const found = [];
  const direct = /\.signOut\s*(?:\?\.)?\s*\(|\[\s*(['"])signOut\1\s*\]\s*(?:\?\.)?\s*\(/g;
  let match;
  while ((match = direct.exec(text))) {
    const call = argumentOf(text, match.index + match[0].length);
    found.push(call ? {args: call.args, index: match.index} : {args: null, index: match.index});
    if (call) direct.lastIndex = call.end;
  }
  const bindings = new Map();
  const destructure = /\b(?:const|let|var)\s*\{([^}]+)\}\s*=/g;
  while ((match = destructure.exec(text))) {
    for (const part of match[1].split(',')) {
      const piece = part.trim();
      if (!piece) continue;
      const [raw, alias] = piece.split(':').map(item => item.trim());
      const name = raw.replace(/^\.\.\./, '');
      if (name !== 'signOut') continue;
      bindings.set((alias || 'signOut').replace(/\s*=.*$/, ''), match.index);
    }
  }
  for (const [name, at] of bindings) {
    const calls = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(', 'g');
    let call;
    while ((call = calls.exec(text))) {
      if (call.index < at) continue;
      if (call.index > 0 && text[call.index - 1] === '.') continue;
      const parsed = argumentOf(text, call.index + call[0].length);
      found.push(parsed ? {args: parsed.args, index: call.index} : {args: null, index: call.index});
      if (parsed) calls.lastIndex = parsed.end;
    }
  }
  return found;
}

export function nonlocalSignOuts(text) {
  return signOutCalls(text).filter(call => !localScope.test(call.args || ''));
}

function servedFiles() {
  const files = roots.flatMap(root => walk(root));
  if (statSync(servedDist, {throwIfNoEntry: false})?.isDirectory()) {
    const names = readdirSync(servedDist, {recursive: true});
    for (const name of names) {
      const path = join(servedDist, String(name));
      if (statSync(path).isFile() && /\.(js|html|mjs)$/.test(String(name))) files.push(path);
    }
  }
  return files;
}

test('every served signOut call is local to this device', () => {
  const files = servedFiles();
  const bad = [];
  const counts = {};
  assert.ok(files.some(file => file.includes(join('operations', 'dist'))), 'the served operations bundle is scanned');
  for (const file of files) {
    const rel = relative(repo, file).split(sep).join('/');
    const calls = signOutCalls(readFileSync(file, 'utf8'));
    if (!calls.length) continue;
    counts[rel] = (counts[rel] || 0) + calls.length;
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

test('a global sign-out is caught in every call form', () => {
  const samples = [
    ['member call', 'await auth.signOut()'],
    ['optional call', 'await auth.signOut?.()'],
    ['bracket call', "await auth['signOut']()"],
    ['double-quoted bracket call', 'await auth["signOut"]()'],
    ['destructured call', 'const {signOut} = auth;\nawait signOut()'],
    ['destructured alias', 'const {signOut: endSession} = auth;\nawait endSession()'],
  ];
  for (const [name, source] of samples) {
    const missed = nonlocalSignOuts(source);
    assert.equal(missed.length, 1, name);
    assert.equal(missed[0].args, '');
  }
  assert.deepEqual(nonlocalSignOuts("await auth.signOut({ scope: 'local' })"), []);
  assert.deepEqual(nonlocalSignOuts("await auth.signOut?.({ scope: 'local' })"), []);
  assert.deepEqual(nonlocalSignOuts("await auth['signOut']({ scope: 'local' })"), []);
  assert.deepEqual(nonlocalSignOuts("const {signOut} = auth;\nawait signOut({ scope: 'local' })"), []);
  assert.deepEqual(nonlocalSignOuts('const {signOut: endSession} = auth;\nawait endSession({ scope: \'local\' })'), []);
});
