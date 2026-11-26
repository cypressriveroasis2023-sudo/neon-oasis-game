/**
 * The manager view's line to the signed-in Tech Check app around this frame.
 *
 * Truck inspections, truck stock and the IT / Service handoffs live in the Tech
 * Check database, which this frame never opens. The owner's host reads them with
 * the owner's own sign-in and hands back only what the manager view draws. A host
 * that does not know these messages (an IT host, a test page, an older copy) never
 * answers, and then there is simply no manager view.
 */

export type ManagerHeld = 'assigned' | 'used' | 'missing';
export type ManagerUnit = {type: string; tag: string; status: ManagerHeld; ticket: string};
export type ManagerSim = {slot: number; number: string; status: ManagerHeld; ticket: string};
export type ManagerStock = {key: string; label: string; have: number; need: number};
export type ManagerTech = {
  id: string; name: string; test: boolean; ready: boolean;
  inspection: {done: boolean; at: string | null; truck: boolean; trailer: 'done' | 'not_taking' | 'not_done'};
  stockCheck: {state: 'done' | 'verify' | 'missing'; at: string | null};
  units: ManagerUnit[]; sims: ManagerSim[]; stock: ManagerStock[];
  restock: {item: string; status: string}[];
};
export type ManagerPhoto = {path: string; kind: 'signature' | 'photo'};
export type ManagerEvent = {kind: 'checkout' | 'receipt' | 'owner' | 'other'; who: string; at: string | null; photos: ManagerPhoto[]; differences: number; report: string | null};
export type ManagerExchange = {id: string; items: string[]; purpose: string; from: string; to: string; state: string; at: string | null; events: ManagerEvent[]};
export type ManagerSnapshot = {
  day: string; at: string; techs: ManagerTech[]; it: {name: string; test: boolean}[];
  /** Null when the handoff log could not be read. The rest of the view still stands. */
  exchanges: ManagerExchange[] | null;
  /** Null when the handoff check could not be read. */
  gaps: ManagerGaps | null;
  /** Null when the SIM drawer could not be read. */
  sims: ManagerSims | null;
  /** Null when the truck standard could not be read. */
  standard: ManagerTruckStd | null;
};
export type ManagerSimStatus = 'in_drawer' | 'in_unit' | 'on_truck' | 'bad' | 'deactivated' | 'removed';
export type ManagerSimCard = {sim: string; carrier: string; status: ManagerSimStatus; location: string; note: string; by: string; at: string | null};
export type ManagerSims = {requireListed: boolean; cards: ManagerSimCard[]; notListed: {sim: string; detail: string; by: string; at: string | null}[]};
export type SimAddResult = {added: string[]; already: string[]; bad: string[]};
export type ManagerGapKind = 'owner_override' | 'owner_edit_no_reason' | 'system' | 'log_mode' | 'other';
export type ManagerGaps = {
  enforced: boolean;
  noHandoff: {tech: string; unit: string; by: string; at: string | null; listed: boolean}[];
  loaded: {tech: string; unit: string; by: string; reason: string; at: string | null; kind: ManagerGapKind}[];
  late: {units: string[]; from: string; to: string; state: string; hours: number | null}[];
  /** Units Service sent back that IT has not checked in after 4 hours. */
  returns: {unit: string; from: string; state: string; hours: number | null}[];
};
/** One truck as it should be after the save. A blank unit comes off the truck; a blank SIM is left as it is. */
export type TruckKit = {units: Record<string, string>; sims: Record<string, string>; stock: Record<string, number>};

export class ManagerError extends Error {
  /** True when nothing around this frame offers the manager view at all, as opposed to a read that failed. */
  gone: boolean;
  constructor(message: string, gone = false) { super(message); this.name = 'ManagerError'; this.gone = gone; }
}

/**
 * How long to wait for the first hello. The Tech Check app answers at once when it is free, but it can be busy for
 * a few seconds while it opens. A device that has shown the manager view before waits that out; any other gives up
 * quickly, so a page with no manager view behind it is not kept waiting.
 */
const HELLO_MS = 700, HELLO_PATIENT_MS = 15000, READ_MS = 20000, SAVE_MS = 30000, FRESH_MS = 20000;
const KNOWN = 'cos-board-manager';
/** Whether this device has shown the manager view before. A convenience only: nothing depends on it being kept. */
export const managerKnown = (): boolean => { try { return window.localStorage.getItem(KNOWN) === '1'; } catch { return false; } };
export const rememberManager = (shown: boolean): void => {
  try { if (shown) window.localStorage.setItem(KNOWN, '1'); else window.localStorage.removeItem(KNOWN); } catch { /* nothing depends on it */ }
};
const said: Record<string, string> = {
  unavailable: 'Trucks and inspections could not be read just now.',
  forbidden: 'The manager view is for the owner sign-in.',
  invalid: 'The Tech Check app did not accept that request.',
  timeout: 'The Tech Check app did not answer. Reload COS and try again.',
};

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 120): string => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, max) : '';
const time = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(9999, Math.floor(value))) : 0;
const held = (value: unknown): ManagerHeld => value === 'assigned' || value === 'used' ? value : 'missing';
const list = (value: unknown, max: number): unknown[] => Array.isArray(value) ? value.slice(0, max) : [];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether this frame sits inside a page that could be the signed-in Tech Check app. */
export const managerHost = (): boolean => { try { return window.parent !== window && window.location.origin !== 'null'; } catch { return false; } };

function parseTech(value: unknown): ManagerTech | null {
  if (!record(value) || typeof value.id !== 'string' || !uuid.test(value.id)) return null;
  const inspection = record(value.inspection) ? value.inspection : {}, check = record(value.stockCheck) ? value.stockCheck : {};
  return {
    id: value.id, name: text(value.name, 80) || 'Service tech', test: value.test === true, ready: value.ready === true,
    inspection: {
      done: inspection.done === true, at: time(inspection.at), truck: inspection.truck === true,
      trailer: inspection.trailer === 'done' || inspection.trailer === 'not_taking' ? inspection.trailer : 'not_done',
    },
    stockCheck: {state: check.state === 'done' || check.state === 'verify' ? check.state : 'missing', at: time(check.at)},
    units: list(value.units, 8).filter(record).map(unit => ({type: text(unit.type, 40), tag: text(unit.tag, 40), status: held(unit.status), ticket: text(unit.ticket, 40)})).filter(unit => unit.type),
    sims: list(value.sims, 6).filter(record).map(sim => ({slot: count(sim.slot), number: text(sim.number, 40), status: held(sim.status), ticket: text(sim.ticket, 40)})).filter(sim => sim.slot > 0),
    stock: list(value.stock, 8).filter(record).map(item => ({key: text(item.key, 40), label: text(item.label, 40), have: count(item.have), need: count(item.need)})).filter(item => item.key && item.label),
    restock: list(value.restock, 20).filter(record).map(item => ({item: text(item.item, 60), status: text(item.status, 40)})).filter(item => item.item),
  };
}

function parseExchange(value: unknown): ManagerExchange | null {
  if (!record(value) || typeof value.id !== 'string' || !uuid.test(value.id)) return null;
  return {
    id: value.id, items: list(value.items, 20).map(item => text(item, 90)).filter(Boolean), purpose: text(value.purpose, 60) || 'Purpose not set',
    from: text(value.from, 80) || 'IT', to: text(value.to, 80) || 'Service', state: text(value.state, 40) || 'unknown', at: time(value.at),
    events: list(value.events, 40).filter(record).map((event): ManagerEvent => ({
      kind: event.kind === 'checkout' || event.kind === 'receipt' || event.kind === 'owner' ? event.kind : 'other',
      who: text(event.who, 80) || 'Unknown', at: time(event.at),
      photos: list(event.photos, 30).filter(record).filter(photo => typeof photo.path === 'string' && /^[A-Za-z0-9._/-]{10,300}$/.test(photo.path) && !photo.path.includes('..'))
        .map(photo => ({path: photo.path as string, kind: photo.kind === 'signature' ? 'signature' : 'photo'})),
      differences: count(event.differences),
      report: typeof event.report === 'string' && /^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]{10,200}\/view$/.test(event.report) ? event.report : null,
    })),
  };
}

const gapKinds: ManagerGapKind[] = ['owner_override', 'owner_edit_no_reason', 'system', 'log_mode'];
function parseGaps(value: unknown): ManagerGaps | null {
  if (!record(value)) return null;
  return {
    enforced: value.enforced !== false,
    noHandoff: list(value.noHandoff, 100).filter(record).map(row => ({tech: text(row.tech, 80) || 'Service tech', unit: text(row.unit, 90), by: text(row.by, 80), at: time(row.at), listed: row.listed !== false})).filter(row => row.unit),
    loaded: list(value.loaded, 100).filter(record).map(row => ({tech: text(row.tech, 80) || 'Service tech', unit: text(row.unit, 90), by: text(row.by, 80) || 'Unknown', reason: text(row.reason, 200), at: time(row.at),
      kind: gapKinds.includes(row.kind as ManagerGapKind) ? row.kind as ManagerGapKind : 'other'})).filter(row => row.unit),
    returns: list(value.returns, 100).filter(record).map(row => ({unit: text(row.unit, 90), from: text(row.from, 80) || 'Service', state: text(row.state, 40) || 'waiting_it',
      hours: typeof row.hours === 'number' && Number.isFinite(row.hours) ? Math.max(0, Math.min(99999, row.hours)) : null})).filter(row => row.unit),
    late: list(value.late, 100).filter(record).map(row => ({units: list(row.units, 20).map(item => text(item, 90)).filter(Boolean), from: text(row.from, 80) || 'IT', to: text(row.to, 80) || 'Service',
      state: text(row.state, 40) || 'unknown', hours: typeof row.hours === 'number' && Number.isFinite(row.hours) ? Math.max(0, Math.min(99999, row.hours)) : null})),
  };
}

/** Every Service truck against the owner's standard. */
export type TruckType = 'Sniper' | 'Ranger' | 'Spotter' | 'Solar Spotter';
const truckTypes: TruckType[] = ['Sniper', 'Ranger', 'Spotter', 'Solar Spotter'];
export type ManagerMove = {type: string; tag: string; from: string; to: string; state: 'waiting' | 'accepted' | 'refused' | 'cancelled'; at: string; note: string};
export type ManagerTruckStd = {
  standard: {type: TruckType; required: number}[];
  trucks: {id: string; name: string; kinds: {type: TruckType; required: number; have: number; slot: string; extras: {id: string; tag: string}[]}[]; waiting: ManagerMove[]}[];
  moves: ManagerMove[];
};
const moveStates = ['waiting', 'accepted', 'refused', 'cancelled'] as const;
const small = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 99 ? v : 0;
const uuidish = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v.toLowerCase() : '';
function parseMove(row: Record<string, unknown>): ManagerMove {
  return {type: text(row.type, 30), tag: text(row.tag, 40), from: text(row.from, 80), to: text(row.to, 80),
    state: moveStates.includes(row.state as ManagerMove['state']) ? row.state as ManagerMove['state'] : 'waiting', at: time(row.at) || '', note: text(row.note, 200)};
}
function parseTruckStd(value: unknown): ManagerTruckStd | null {
  if (!record(value)) return null;
  const isType = (v: unknown): v is TruckType => truckTypes.includes(v as TruckType);
  return {
    standard: list(value.standard, 10).filter(record).filter(r => isType(r.type)).map(r => ({type: r.type as TruckType, required: small(r.required)})),
    trucks: list(value.trucks, 50).filter(record).map(t => ({id: uuidish(t.id), name: text(t.name, 80),
      kinds: list(t.kinds, 10).filter(record).filter(k => isType(k.type)).map(k => ({type: k.type as TruckType, required: small(k.required), have: small(k.have), slot: text(k.slot, 40),
        extras: list(k.extras, 20).filter(record).map(x => ({id: uuidish(x.id), tag: text(x.tag, 40)})).filter(x => x.id && x.tag)})),
      waiting: list(t.waiting, 20).filter(record).map(parseMove).filter(m => m.tag)})).filter(t => t.id && t.name),
    moves: list(value.moves, 10).filter(record).map(parseMove).filter(m => m.tag),
  };
}

const simStatuses: ManagerSimStatus[] = ['in_drawer', 'in_unit', 'on_truck', 'bad', 'deactivated', 'removed'];
function parseSims(value: unknown): ManagerSims | null {
  if (!record(value)) return null;
  return {
    requireListed: value.requireListed === true,
    cards: list(value.cards, 2000).filter(record).map(row => ({sim: text(row.sim, 24), carrier: text(row.carrier, 40),
      status: simStatuses.includes(row.status as ManagerSimStatus) ? row.status as ManagerSimStatus : 'removed' as ManagerSimStatus,
      location: text(row.location, 120), note: text(row.note, 300), by: text(row.by, 80), at: time(row.at)})).filter(row => /^[0-9A-Z]{8,24}$/.test(row.sim)),
    notListed: list(value.notListed, 100).filter(record).map(row => ({sim: text(row.sim, 24), detail: text(row.detail, 160), by: text(row.by, 80), at: time(row.at)})).filter(row => row.sim),
  };
}

export function parseManagerSnapshot(value: unknown): ManagerSnapshot {
  if (!record(value) || typeof value.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.day) || !Array.isArray(value.techs)) throw new ManagerError(said.unavailable);
  return {
    day: value.day, at: time(value.at) || new Date().toISOString(),
    techs: list(value.techs, 100).map(parseTech).filter((tech): tech is ManagerTech => tech !== null),
    it: list(value.it, 100).filter(record).map(tech => ({name: text(tech.name, 80), test: tech.test === true})).filter(tech => tech.name),
    exchanges: Array.isArray(value.exchanges) ? list(value.exchanges, 100).map(parseExchange).filter((row): row is ManagerExchange => row !== null) : null,
    gaps: parseGaps(value.gaps),
    sims: parseSims(value.sims),
    standard: parseTruckStd(value.standard),
  };
}

function ask(kind: string, body: Record<string, unknown>, wait: number): Promise<Record<string, unknown>> {
  if (!managerHost()) return Promise.reject(new ManagerError(said.forbidden, true));
  return new Promise((resolve, reject) => {
    const parent = window.parent, origin = window.location.origin, requestId = crypto.randomUUID();
    let timer = 0, settled = false;
    const done = () => { settled = true; window.removeEventListener('message', receive); window.clearTimeout(timer); };
    const receive = (event: MessageEvent) => {
      if (settled || event.origin !== origin || event.source !== parent || !record(event.data)) return;
      const message = event.data;
      if (message.type !== 'COS_MANAGER_RESPONSE' || message.requestId !== requestId) return;
      done();
      if (typeof message.error === 'string') {
        const reason = message.error === 'rejected' ? text(message.message, 200) || 'The Tech Check app did not save that.' : said[message.error] || said.unavailable;
        reject(new ManagerError(reason, message.error === 'forbidden'));
      } else resolve(message);
    };
    window.addEventListener('message', receive);
    // No answer to the first hello means there is no manager view here. No answer after that is a failed read.
    timer = window.setTimeout(() => { if (settled) return; done(); reject(new ManagerError(said.timeout, kind === 'hello')); }, wait);
    try { parent.postMessage({...body, type: 'COS_MANAGER_REQUEST', requestId, kind}, origin); }
    catch { done(); reject(new ManagerError(said.unavailable, true)); }
  });
}

let greeted: Promise<void> | null = null;
let held0: {snapshot: ManagerSnapshot; at: number} | null = null;
let reading: Promise<ManagerSnapshot> | null = null;
let wanted: string | null = null;

const forget = () => { greeted = null; held0 = null; reading = null; };
if (typeof window !== 'undefined') {
  // A changed sign-in, or the frame being put away, ends anything read for the person before.
  window.addEventListener('cos-private-data-invalidated', forget);
  window.addEventListener('message', event => {
    if (event.origin === window.location.origin && event.source === window.parent && record(event.data) && event.data.type === 'COS_OPERATIONS_HIDE_PRIVATE_EVIDENCE') held0 = null;
  });
}

/** Resolves when the page around this frame offers the manager view to this sign-in. */
export function managerHello(patient = managerKnown()): Promise<void> {
  if (!greeted) {
    const attempt = ask('hello', {}, patient ? HELLO_PATIENT_MS : HELLO_MS).then(() => undefined);
    greeted = attempt;
    attempt.catch(() => { if (greeted === attempt) greeted = null; });
  }
  return greeted;
}

/** Today's trucks, inspections and handoffs. A reading under twenty seconds old is reused unless a new one is asked for. */
export function readManager(fresh = false, patient = managerKnown()): Promise<ManagerSnapshot> {
  if (!fresh && held0 && Date.now() - held0.at < FRESH_MS) return Promise.resolve(held0.snapshot);
  if (reading) return reading;
  const attempt = managerHello(patient).then(() => ask('read', {}, READ_MS)).then(message => {
    const snapshot = parseManagerSnapshot(message.snapshot);
    held0 = {snapshot, at: Date.now()};
    return snapshot;
  });
  reading = attempt;
  const clear = () => { if (reading === attempt) reading = null; };
  attempt.then(clear, clear);
  return attempt;
}

/** Saves one truck, then reads everything again so the screen shows what was actually kept. */
export async function saveTruck(techId: string, kit: TruckKit): Promise<ManagerSnapshot> {
  await managerHello();
  await ask('truck', {techId, kit}, SAVE_MS);
  held0 = null;
  return readManager(true);
}

/** Adds SIM cards to the drawer, then reads everything again. */
export async function addSims(numbers: string[], carrier: string, note: string): Promise<{result: SimAddResult; snapshot: ManagerSnapshot}> {
  await managerHello();
  const message = await ask('simAdd', {numbers: numbers.slice(0, 500), carrier: carrier.slice(0, 40), note: note.slice(0, 300)}, SAVE_MS);
  const strings = (v: unknown) => list(v, 500).map(item => text(item, 24)).filter(Boolean);
  const result = {added: strings(message.added), already: strings(message.already), bad: strings(message.bad)};
  held0 = null;
  return {result, snapshot: await readManager(true)};
}

/** Puts a SIM back in the drawer, or marks it bad, deactivated or removed, then reads everything again. */
export async function markSim(sim: string, status: 'in_drawer' | 'bad' | 'deactivated' | 'removed', note: string): Promise<ManagerSnapshot> {
  await managerHello();
  await ask('simMark', {sim, status, note: note.slice(0, 300)}, SAVE_MS);
  held0 = null;
  return readManager(true);
}

/** Turns "SIMs must come from the drawer" on or off, then reads everything again. */
export async function requireSims(on: boolean): Promise<ManagerSnapshot> {
  await managerHello();
  await ask('simRequire', {on}, SAVE_MS);
  held0 = null;
  return readManager(true);
}

/** Sets how many of one unit type every Service truck must carry, then reads everything again. */
export async function setTruckStandard(type: TruckType, required: number): Promise<ManagerSnapshot> {
  await managerHello();
  await ask('truckStandard', {unitType: type, required}, SAVE_MS);
  held0 = null;
  return readManager(true);
}

/** Takes an extra unit off a truck in the app, with the owner's reason, then reads everything again. */
export async function removeTruckExtra(extraId: string, reason: string): Promise<ManagerSnapshot> {
  await managerHello();
  await ask('truckExtraRemove', {extraId, reason: reason.slice(0, 300)}, SAVE_MS);
  held0 = null;
  return readManager(true);
}

/** A short-lived link to one saved handoff photo or signature. */
export async function managerPhoto(path: string): Promise<string> {
  const message = await ask('photo', {path}, READ_MS);
  if (typeof message.url !== 'string' || !/^https:\/\//.test(message.url)) throw new ManagerError('That photo could not be opened.');
  return message.url;
}

/** The board is asked to open on a view the next time it is put on screen. */
export function requestBoardView(view: string): void { wanted = view; }
export function takeBoardView(): string | null { const view = wanted; wanted = null; return view; }
