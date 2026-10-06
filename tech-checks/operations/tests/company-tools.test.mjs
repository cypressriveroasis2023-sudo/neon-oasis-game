import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';

// Camera pages: reviewed 2026-10-06 check-history and unit-overview changes, covered by source-aware and navigation tests.
// Other tools retain origin/main 276c6d5e2c98c41a8ba71e78c560b04d6f9b998b hashes.
// Includes inline bodies and external script URLs. Theme work cannot change auth,
// data, diagnostics, rules or action handlers in the four connected tools.
const scriptHashes = {
  "camera-health": "9cce540f2aa8f3166b74202173b561d29c96849e845db54a33e94ae14bda7c93",
  "camera-detail": "faf3e804d74932e3adb1e096e4b6f6cca3dc703000eedca673cf76665a3ec219",
  "onsite-vision": "1024b0cfd45738b1a39661b7ec9946c459034899b2db6a32aaedfd0044b487a4",
  "it-send-repair": "d63cb02a6d28f1ac6d6631e772da6d5f24efbe075d07e596e354a12f79d34cf9"
};
const markupHashes = {
  "camera-health": "fb3706bc20862df7bc89e17205b9f8d7eae24bd7842edb6298a0c620a64a6aa6",
  "camera-detail": "9368d545ec84c6cd46bc51257381b116c3b3d8478e6474c91f36e8e1b6187de4",
  "onsite-vision": "1ca7830dc31d34bb56184dcbe4cc4aacc71ff403dc6c7cadb3f2c061aea2b08f",
  "it-send-repair": "600644052c3187b8af00740732f0fb0b81266d3cf902068e3de6eeda7e123b45"
};
const theme = readFileSync(new URL('../../company-tools-theme.css',import.meta.url),'utf8');
for (const [name,hash] of Object.entries(scriptHashes)) {
  test(`company tools ${name} preserves reviewed script bytes and loads final theme`,()=>{
    const html=readFileSync(new URL(`../../${name}.html`,import.meta.url),'utf8');
    const scripts=[...html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)].map(match=>match[0]).join('\n');
    assert.equal(createHash('sha256').update(scripts).digest('hex'),hash);
    const originalMarkup=html.replace(/<meta name="(?:theme-color|color-scheme)"[^>]+>/g,'')
      .replace(/<link rel="stylesheet" href="\.\/company-tools-theme\.css\?v=company-dark-20261006c">\n?/g,'').trim();
    assert.equal(createHash('sha256').update(originalMarkup).digest('hex'),markupHashes[name]);
    assert.equal((html.match(/href="\.\/company-tools-theme\.css\?v=company-dark-20261006c"/g)||[]).length,1);
    assert.ok(html.lastIndexOf('company-tools-theme.css')>html.lastIndexOf('</style>'));
    assert.match(html,/<meta name="theme-color" content="#0B111C">/);
  });
}
test('company tools palette uses local Open Sans and leaves display state to legacy code',()=>{
  for (const color of ['#0B111C','#111B2A','#172337','#E6EDF7','#A3B3CA','#2C3B51','#315FDF','#91B0FF','#203456','#15352D','#83D6AD','#3B2D18','#EDC27B','#3E202B','#F4A2AC']) assert.ok(theme.includes(color));
  for(const weight of ['regular','semibold','bold']) {
    assert.ok(readFileSync(new URL(`../../resources/fonts/open-sans-${weight}.woff`,import.meta.url)).length>10000);
    assert.ok(theme.includes(`./resources/fonts/open-sans-${weight}.woff`));
  }
  assert.doesNotMatch(theme,/(?:^|[;{])\s*(?:display|visibility|pointer-events)\s*:/m);
  assert.doesNotMatch(theme,/@import|https?:/);
});
