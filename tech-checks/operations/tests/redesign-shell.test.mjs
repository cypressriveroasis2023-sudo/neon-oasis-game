import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const shell = read('../redesign/app.js');
const css = read('../redesign/app.css');
const mockupCss = read('./fixtures/cos-redesign-mockup/app.css');
const api = read('../src/api.ts');
const pages = 'https://cypressriveroasis2023-sudo.github.io/neon-oasis-game/';
const shellPage = pages + 'tech-checks/operations/redesign/index.html';

test('office shell keeps the mockup type stack and does not add a font face', () => {
  assert.ok(css.startsWith(mockupCss));
  assert.doesNotMatch(css, /@font-face/);
  assert.match(css, /font-family:Inter,system-ui,sans-serif/);
  assert.match(css, /font-family:"Inter Tight",Inter,sans-serif/);
  assert.match(css, /\.side>nav\{display:flex;flex-direction:column;gap:4px/);
  assert.equal(existsSync(new URL('../redesign/fonts', import.meta.url)), false);
  assert.equal(existsSync(new URL('../dist/redesign', import.meta.url)), false);
  assert.equal(existsSync(new URL('../public/redesign', import.meta.url)), false);
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

test('Boards and TV board resolve to the working host and operations board', () => {
  assert.match(shell, /screen==='boards'\)return '\.\.\/dist\/index\.html#daily-board'/);
  assert.match(shell, /screen==='tv'\)return '\.\.\/\.\.\/index\.html\?tvBoard=1'/);
  assert.match(shell, /location\.replace\('\.\.\/dist\/index\.html#daily-board'\)/);
  assert.match(shell, /location\.replace\('\.\.\/\.\.\/index\.html\?tvBoard=1'\)/);
  const boards = new URL('../dist/index.html#daily-board', shellPage);
  const tv = new URL('../../index.html?tvBoard=1', shellPage);
  assert.equal(boards.href, pages + 'tech-checks/operations/dist/index.html#daily-board');
  assert.equal(tv.href, pages + 'tech-checks/index.html?tvBoard=1');
  assert.equal(existsSync(new URL('../../index.html', import.meta.url)), true);
  assert.equal(existsSync(new URL('../dist/index.html', import.meta.url)), true);
  assert.match(shell, /\['fleet','problems','units','unit','team','details','more'\]/);
  assert.doesNotMatch(shell, /SC\.thome|SC\.tout|SC\.tcheck|SC\.tdone|techShell|Check out Spotter|Good morning/);
});

test('the shell does not read counts, freshness, credentials, or unit keys', () => {
  assert.doesNotMatch(shell, /sharedFleetCounts|fleetSourceFacts|count_method|intrusion|password|simIccid|apiKey/i);
  assert.doesNotMatch(shell, /\b\d{7}\b/);
  assert.doesNotMatch(shell, /\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  assert.doesNotMatch(css, /sharedFleetCounts|count_method|@font-face/);
});
