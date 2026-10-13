import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/OwnerWatchfulShortcut.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
const exported = {};
vm.runInNewContext(compiled, {exports: exported, require: name => {
  if (name === './ownerWatchfulShortcut.css') return {};
  assert.equal(name, 'react/jsx-runtime', 'the portal shortcut has no API or session dependency');
  return require(name);
}});
const render = () => renderToStaticMarkup(React.createElement(exported.default));

test('Watchful shortcut renders one exact external portal link with accessible new-tab disclosure', () => {
  const html = render();
  assert.match(html, /<section[^>]+aria-labelledby="owner-watchful-heading"/);
  assert.match(html, /<h2 id="owner-watchful-heading">Watchful<\/h2>/);
  assert.match(html, /href="https:\/\/v2\.watchful\.co\.nz\/sites" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /aria-describedby="owner-watchful-help"/);
  assert.match(html, /id="owner-watchful-help">Opens in a new tab\. Watchful may ask you to sign in\./);
  assert.match(html, /EXTERNAL PORTAL/);
  assert.equal((html.match(/<a\b/g) || []).length, 1);
  assert.doesNotMatch(html, /<iframe|<script|<form|<button|accessToken|Bearer|CONNECTED|online|offline/);
  assert.equal(render(), html, 'rendering again does not read or mutate external state');
});

test('the shortcut mounts only behind the normal Owner dashboard scope', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /!fleetOnly&&!dailyOnly&&session\?\.role==='Owner'&&<OwnerWatchfulShortcut\/>/);
  assert.equal((app.match(/<OwnerWatchfulShortcut\/>/g) || []).length, 1);
  for (const file of ['ITDailyDashboard.tsx', 'ITDashboard.tsx', 'TechChecksWorkspace.tsx']) {
    assert.doesNotMatch(readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'), /OwnerWatchfulShortcut|v2\.watchful\.co\.nz/);
  }
});
