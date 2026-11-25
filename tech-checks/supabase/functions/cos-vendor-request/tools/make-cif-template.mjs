// Makes cif_template.ts from Eyeforce's CIF V5 workbook (not kept in the repo).
// Blanks the sample answers, unticks every box, and takes out the VMS password line Eyeforce gives dealers,
// because this repo is public. Run from tech-checks/operations:
//   node --import tsx ../supabase/functions/cos-vendor-request/tools/make-cif-template.mjs <CIF V5.xlsx>
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Workbook} from '../xlsx.ts';
import {cifCells, TICKS} from '../cif.ts';

const src = process.argv[2];
if (!src) throw new Error('Give the path of the CIF V5 workbook.');
const wb = await Workbook.open(new Uint8Array(readFileSync(src)));
for (const kind of ['monitor_add', 'monitor_swap']) for (const [sheet, cells] of Object.entries(cifCells(kind, {}))) wb.set(Number(sheet), Object.fromEntries(Object.keys(cells).map(k => [k, ''])));
const rows = {};
for (let r = 15; r <= 43; r++) for (const c of 'ABCDEFGHI') rows[c + r] = '';
wb.set(5, rows);
for (const box of Object.values(TICKS)) wb.tick(box, false);
const strings = wb.text('xl/sharedStrings.xml');
const cleaned = strings.replace(/Password:\s*[^<]*/g, 'Password: as given by Eyeforce');
if (cleaned === strings) throw new Error('The password line was not found; check the template before publishing it.');
wb.put('xl/sharedStrings.xml', cleaned);
// The summary tab only copies the other tabs: drop its saved results so they are worked out when the file opens.
wb.put('xl/worksheets/sheet4.xml', wb.text('xl/worksheets/sheet4.xml').replace(/(<f>[^<]*<\/f>)<v>[^<]*<\/v>/g, '$1'));
const out = await wb.save();
const b64 = Buffer.from(out).toString('base64');
if (/1q2w3e4r5t/.test(Buffer.from(out).toString('latin1'))) throw new Error('A password is still in the template.');
writeFileSync(new URL('../cif_template.ts', import.meta.url),
  '// Eyeforce CIF V5, blank. Made by tools/make-cif-template.mjs; do not edit by hand.\n'
  + '// sha256 ' + createHash('sha256').update(out).digest('hex') + '\n'
  + 'export const CIF_TEMPLATE_B64 =\n' + b64.match(/.{1,120}/g).map(x => "  '" + x + "'").join(' +\n') + ';\n');
console.log('template bytes', out.length);
