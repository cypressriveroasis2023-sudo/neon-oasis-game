// A small .xlsx filler: opens a workbook zip, writes text into named cells, ticks form check boxes,
// and zips it again. It keeps every other part of the file as it was (styles, drop-downs, drawings),
// so Eyeforce gets their own form back, filled in. No dependencies: runs in Deno and in Node tests.

const enc = new TextEncoder();
const dec = new TextDecoder();

let CRC: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Reads every entry of a zip file. Only stored and deflated entries (what Excel writes). */
export async function unzip(zip: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('The form template is not a valid workbook.');
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('The form template is damaged.');
    const method = view.getUint16(p + 10, true), size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true), extraLen = view.getUint16(p + 30, true), commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(zip.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = zip.subarray(start, start + size);
    files.set(name, method === 0 ? data.slice() : method === 8 ? await pipe(data, new DecompressionStream('deflate-raw')) : (() => { throw new Error('Unsupported zip entry.'); })());
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** Writes a zip with deflated entries, in the order given ([Content_Types].xml first, as Excel expects). */
export async function zip(files: Map<string, Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, raw] of files) {
    const n = enc.encode(name), data = await pipe(raw, new CompressionStream('deflate-raw')), crc = crc32(raw);
    const head = new Uint8Array(30), h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 8, true);
    h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, raw.length, true);
    h.setUint16(26, n.length, true); h.setUint16(28, 0, true);
    const dir = new Uint8Array(46), d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x0800, true); d.setUint16(10, 8, true);
    d.setUint16(12, 0, true); d.setUint16(14, 0x21, true); d.setUint32(16, crc, true); d.setUint32(20, data.length, true); d.setUint32(24, raw.length, true);
    d.setUint16(28, n.length, true); d.setUint32(42, offset, true);
    parts.push(head, n, data); central.push(dir, n);
    offset += 30 + n.length + data.length;
  }
  const dirSize = central.reduce((s, x) => s + x.length, 0);
  const tail = new Uint8Array(22), t = new DataView(tail.buffer);
  t.setUint32(0, 0x06054b50, true); t.setUint16(8, files.size, true); t.setUint16(10, files.size, true); t.setUint32(12, dirSize, true); t.setUint32(16, offset, true);
  const all = [...parts, ...central, tail], out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
  let at = 0; for (const x of all) { out.set(x, at); at += x.length; }
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // XML 1.0 does not allow most control characters.
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const colNum = (ref: string) => [...ref.replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

/** Puts text into one cell of a worksheet's XML, keeping the cell's style. Empty text clears it. */
export function setCell(sheet: string, ref: string, value: string): string {
  if (!/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(ref)) throw new Error('Bad cell ' + ref);
  const row = ref.replace(/^[A-Z]+/, '');
  const cell = (style: string) => value
    ? '<c r="' + ref + '"' + style + ' t="inlineStr"><is><t xml:space="preserve">' + esc(value) + '</t></is></c>'
    : '<c r="' + ref + '"' + style + '/>';
  const existing = new RegExp('<c r="' + ref + '"([^>]*?)(?:/>|>[\\s\\S]*?</c>)');
  const m = existing.exec(sheet);
  if (m) { const style = (/\ss="\d+"/.exec(m[1]) || [''])[0]; return sheet.slice(0, m.index) + cell(style) + sheet.slice(m.index + m[0].length); }
  if (!value) return sheet;
  const rowRe = new RegExp('(<row r="' + row + '"[^>]*?)(/>|>([\\s\\S]*?)</row>)');
  const r = rowRe.exec(sheet);
  if (r) {
    if (r[2] === '/>') return sheet.slice(0, r.index) + r[1] + '>' + cell('') + '</row>' + sheet.slice(r.index + r[0].length);
    // Insert in column order.
    const inner = r[3], cells = [...inner.matchAll(/<c r="([A-Z]+)\d+"/g)];
    const after = cells.find(c => colNum(c[1]) > colNum(ref));
    const pos = after ? after.index! : inner.length;
    const newInner = inner.slice(0, pos) + cell('') + inner.slice(pos);
    return sheet.slice(0, r.index) + r[1] + '>' + newInner + '</row>' + sheet.slice(r.index + r[0].length);
  }
  // No such row yet: add it in row order.
  const rows = [...sheet.matchAll(/<row r="(\d+)"/g)];
  const next = rows.find(x => Number(x[1]) > Number(row));
  const add = '<row r="' + row + '">' + cell('') + '</row>';
  if (next) return sheet.slice(0, next.index!) + add + sheet.slice(next.index!);
  return sheet.replace('</sheetData>', add + '</sheetData>').replace('<sheetData/>', '<sheetData>' + add + '</sheetData>');
}

export type CheckBox = {ctrlProp: string; vml: string; shapeId: string};

/** A workbook opened for filling. */
export class Workbook {
  private files: Map<string, Uint8Array>;
  private constructor(files: Map<string, Uint8Array>) { this.files = files; }
  static async open(bytes: Uint8Array) { return new Workbook(await unzip(bytes)); }
  private sheetPath(index: number) { return 'xl/worksheets/sheet' + index + '.xml'; }
  text(path: string) { const f = this.files.get(path); if (!f) throw new Error('Missing ' + path); return dec.decode(f); }
  put(path: string, text: string) { this.files.set(path, enc.encode(text)); }
  /** VML is stored as Windows-1252 bytes; keep every byte exactly. */
  latin(path: string) { const f = this.files.get(path); if (!f) throw new Error('Missing ' + path); let s = ''; for (const b of f) s += String.fromCharCode(b); return s; }
  putLatin(path: string, text: string) { const b = new Uint8Array(text.length); for (let i = 0; i < text.length; i++) b[i] = text.charCodeAt(i) & 0xff; this.files.set(path, b); }
  set(sheet: number, cells: Record<string, string>) {
    let xml = this.text(this.sheetPath(sheet));
    for (const [ref, v] of Object.entries(cells)) xml = setCell(xml, ref, v ?? '');
    this.put(this.sheetPath(sheet), xml);
  }
  tick(box: CheckBox, on: boolean) {
    let prop = this.text(box.ctrlProp).replace(/\schecked="[^"]*"/, '');
    if (on) prop = prop.replace('<formControlPr ', '<formControlPr checked="Checked" ');
    this.put(box.ctrlProp, prop);
    let vml = this.latin(box.vml);
    const shape = new RegExp('(<v:shape [^>]*id="_x0000_s' + box.shapeId + '"[\\s\\S]*?<x:ClientData[^>]*>)([\\s\\S]*?)(</x:ClientData>)').exec(vml);
    if (!shape) throw new Error('Missing check box ' + box.shapeId);
    const inner = shape[2].replace(/\s*<x:Checked>\d<\/x:Checked>/g, '') + (on ? '<x:Checked>1</x:Checked>' : '');
    vml = vml.slice(0, shape.index) + shape[1] + inner + shape[3] + vml.slice(shape.index + shape[0].length);
    this.putLatin(box.vml, vml);
  }
  /** Asks Excel to work out every formula again when the file opens (the summary tab copies the other tabs). */
  recalc() {
    const path = 'xl/workbook.xml';
    this.put(path, this.text(path).replace(/<calcPr([^>]*?)\s*\/>/, (_m, a) => '<calcPr' + a.replace(/\sfullCalcOnLoad="[^"]*"/, '') + ' fullCalcOnLoad="1"/>'));
  }
  save() { return zip(this.files); }
}
