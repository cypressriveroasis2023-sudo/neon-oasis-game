import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
// The owner's original JPEG is preserved byte-for-byte. SVG only frames and clips it.
const source = 'data:image/jpeg;base64,' + readFileSync(root+'public/resources/vision-approved-eye.jpeg').toString('base64');
const image = `<image href="${source}" x="0" y="0" width="1320" height="914"/>`;
const open = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="205 0 914 914">';
// The 138px socket lies inside the original stationary silver rim. A 7.3px glance
// moves the original optical assembly without exposing a second, stationary iris.
const housing = open + image + '<circle cx="659" cy="428" r="138" fill="#030203"/></svg>';
const lens = open + '<defs><clipPath id="lens"><circle cx="659" cy="428" r="138"/></clipPath></defs><g clip-path="url(#lens)">'+image+'</g></svg>';
const encode = svg => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
const h = encode(housing), l = encode(lens);
writeFileSync(root+'src/eyeArtwork.ts', '// Generated from the original owner-supplied JPEG. Do not substitute a redraw.\nexport const housingArtwork = '+JSON.stringify(h)+';\nexport const lensArtwork = '+JSON.stringify(l)+';\n');
const legacy = root+'../cos-eye-branding.js';
writeFileSync(legacy, readFileSync(legacy,'utf8').replace(/^  const housing = .*$/m, '  const housing = '+JSON.stringify(h)+';').replace(/^  const lens = .*$/m, '  const lens = '+JSON.stringify(l)+';'));
writeFileSync(root+'public/resources/vision-eye-round.svg', open + image + '</svg>');
