// 2026-10-08 reviewed native-alias placement capability cache tag only; alias/source/readback regressions cover behavior.
// 2026-10-08 reviewed SHOP/new-installation and incomplete-field repair cache tag; isolated regressions cover the flows.
// 2026-10-08 reviewed address-editor cache version; authenticated prefill/no-op/race coverage is in camera-placement-prefill tests.
// 2026-10-08 scoped IP/revision-bound diagnostics and sanitized reports; source/port/export/browser regressions added.
// Reviewed placement dialogs, global inventory search and Field Map links; covered by scoped browser tests.
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
  "camera-health": "96b61d94b60d49acf56ca75ce3b2c13d038c4a5c18b4d022f93eccd8ebf83ab1",
  "camera-detail": "5c49099332090f58188d691bb6f58ed763e2e7a7897fb50da88ce96110cc20f5",
  "onsite-vision": "a0c436bf9956cd07305c5583837c061c032ea12e3b8ffa44d5704a6a6ddc1dbd",
  "it-send-repair": "d63cb02a6d28f1ac6d6631e772da6d5f24efbe075d07e596e354a12f79d34cf9"
};
const markupHashes = {
  "camera-health": "f9aedd6c5a7be1cfc4610bc7da3620c9ca6f114679fcc4cba35ff54f09b897a1",
  "camera-detail": "52205c98418a2e7dda25719542a160479e20215d0d678309fe107c8c624010c7",
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
