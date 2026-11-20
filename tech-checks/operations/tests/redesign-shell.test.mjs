import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const shell = read('../public/redesign/app.js');
const css = read('../public/redesign/app.css');
const mockupCss = read('./fixtures/cos-redesign-mockup/app.css');
const api = read('../src/api.ts');

test('office shell keeps the approved mockup stylesheet and only adds fonts and link color', () => {
  assert.ok(css.startsWith(mockupCss));
  assert.match(css, /font-family:Inter/);
  assert.match(css, /font-family:"Inter Tight"/);
  assert.match(css, /\.side>nav\{display:flex;flex-direction:column;gap:4px/);
});

test('office shell uses the existing session endpoint and refuses every other role', () => {
  const endpoint = api.match(/const endpoint = '([^']+)'/);
  assert.ok(endpoint);
  assert.ok(shell.includes(endpoint[1]));
  assert.match(shell, /!\['owner','it'\]\.includes\(message\.role\)/);
  assert.match(shell, /data\.role!=='Owner'&&data\.role!=='IT'/);
  assert.match(shell, /dataset\.shell='denied'/);
  assert.doesNotMatch(shell, /role==='Service'|role==='service'|department==='service'/);
});

test('Boards and TV board leave for the existing board, and the tech app is not painted', () => {
  assert.match(shell, /screen==='boards'\)return '\/#daily-board'/);
  assert.match(shell, /screen==='tv'\)return '\/\?tvBoard=1#daily-board'/);
  assert.match(shell, /if\(S==='boards'\)\{location\.replace\('\/#daily-board'\)/);
  assert.match(shell, /if\(S==='tv'\)\{location\.replace\('\/\?tvBoard=1#daily-board'\)/);
  assert.match(shell, /\['fleet','problems','units','unit','team','details','more'\]/);
  assert.doesNotMatch(shell, /SC\.thome|SC\.tout|SC\.tcheck|SC\.tdone|techShell|Check out Spotter|Good morning/);
});

test('the shell does not read counts, freshness, credentials, or unit keys', () => {
  assert.doesNotMatch(shell, /sharedFleetCounts|fleetSourceFacts|count_method|intrusion|password|simIccid|apiKey/i);
  assert.doesNotMatch(shell, /\b\d{7}\b/);
  assert.doesNotMatch(shell, /\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  assert.doesNotMatch(css, /sharedFleetCounts|count_method/);
});
