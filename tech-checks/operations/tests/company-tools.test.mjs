// Reviewed 2026-10-07: 15-minute visible-only routine reads and 20-minute evidence presentation allowance.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';

// Camera Health: reviewed offline/shop source-classification hotfix; exact area mapping and all writes preserved.
// Camera pages: reviewed 2026-10-06 check-history and unit-overview changes, covered by source-aware and navigation tests.
// Camera access: reviewed 2026-10-07 family service filters, saved endpoints, and front-card controls.
// Recon battery: reviewed scalar-only readings, zero/null handling, source-time labels, and inventory-only sync copy.
// Battery tests cover freshness without queries or resetting edits; no polling frequency changes.
// Access regression tests cover links independent of observations; probes, settings and auth unchanged.
// Vision includes the reviewed visible-composer repair (behavior covered by vision-composer.browser.spec.mjs).
// Other tools retain origin/main 276c6d5e2c98c41a8ba71e78c560b04d6f9b998b hashes.
// Includes inline bodies and external script URLs. Theme work cannot change auth,
// data, diagnostics, rules or action handlers in the four connected tools.
const scriptHashes = {
  "camera-health": "832d629b7dda23640541b50e756b672b17eb2646ceb6be3b575c8cc78e361374",
  "camera-detail": "a1e353b10363b415209ef584a217185b99cc03b0d5de19bd216a3c966d6058da",
  "onsite-vision": "a0c436bf9956cd07305c5583837c061c032ea12e3b8ffa44d5704a6a6ddc1dbd",
  "it-send-repair": "d63cb02a6d28f1ac6d6631e772da6d5f24efbe075d07e596e354a12f79d34cf9"
};
const markupHashes = {
  "camera-health": "7d9a32817780f140e9bd7d050422b39af8586a38e7d3021fe4ab5dfaca41e042",
  "camera-detail": "7cce2ba1f581dfc6d4e9b41c7b5d7809f2bb072f56015f154e775cc8ef66b223",
  "onsite-vision": "6b7a93fc2a2106fc98645f992f82c537e46bd96347b16ac57e2b17366bbd7432",
  "it-send-repair": "600644052c3187b8af00740732f0fb0b81266d3cf902068e3de6eeda7e123b45"
};
const theme = readFileSync(new URL('../../company-tools-theme.css',import.meta.url),'utf8');
for (const [name,hash] of Object.entries(scriptHashes)) {
  test(`company tools ${name} preserves reviewed script bytes and loads final theme`,()=>{
    const html=readFileSync(new URL(`../../${name}.html`,import.meta.url),'utf8');
    assert.equal(html.split('cos-eye-branding.js?v=20261006b').length-1,1);
    const preserved=html.replace('<link rel="stylesheet" href="./cos-eye-branding.css?v=20261006b">\n<script defer src="./cos-eye-branding.js?v=20261006b"></script>\n','').replace('camera-health-overview.js?v=20261006b"','camera-health-overview.js?v=20261006"');
    const scripts=[...preserved.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)].map(match=>match[0]).join('\n');
    assert.equal(createHash('sha256').update(scripts).digest('hex'),hash);
    const originalMarkup=preserved.replace(/<meta name="(?:theme-color|color-scheme)"[^>]+>/g,'')
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
