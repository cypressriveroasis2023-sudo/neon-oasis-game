// Camera-only presentation for shop, warehouse, and Watchful test sites.
//
// James 11:01 AM CT Nov 19: a unit in a Watchful test project, and a unit mHelp
// places in Shop or Warehouse, shows ONLINE with the label "In shop", in its
// own count. Customer field monitoring still mirrors Watchful. mHelp Field or
// Shop wins; a Field mark on a test project is flagged and is not moved.
//
// Test projects come only from the names and pattern on the rule. A name that
// is not listed and does not match the pattern is a customer project.
// Archived Watchful projects are not in Watchful.
//
// Non-field units then split three ways, from lists on the rule and fields on
// the unit. Shorten a list and the line shrinks; the decision function stays.
//   In shop — ONLINE, label "In shop", plus that unit's tags.
//   Shop, DO NOT USE — its own line, not online, not in the In shop count.
//   Exceptions — a DO NOT USE unit mHelp places Field, or a unit on the
//   exception list. Out of every total, named on the exceptions line.
//
// Rollback: call rollbackShopCameraRule() and pass that rule to
// decideShopCameras. enabled:false leaves every unit on the Watchful mirror.

import {canonicalCameraUnit} from '../src/fieldCameraHealth.ts';

export const SHOP_CAMERA_PLACE_LABEL = 'In shop';
export const SHOP_CAMERA_ONLINE_LABEL = 'ONLINE';
export const SHOP_DO_NOT_USE_LABEL = 'Shop, DO NOT USE';
export const SHOP_EXCEPTION_LABEL = 'Exceptions';
export const MHELP_TEST_SITE_FLAG = 'mHelp Field disagrees with Watchful test site';
export const SHOP_CAMERA_RULE_PROVENANCE =
  'James 11:01 AM CT Nov 19: test-site and shop units show ONLINE In shop, separate count';

export type CameraPlacement = 'FIELD' | 'SHOP';
export type CameraState = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
export type MhelpCameraPlacement = 'FIELD' | 'SHOP' | 'WAREHOUSE';

export type ShopCameraRule = {
  enabled: boolean;
  /** Whole project names. Matching ignores case and surrounding space. */
  testProjectNames: readonly string[];
  /** Matched against the whole project name, case-insensitive. Null matches nothing. */
  testProjectPattern: string | null;
  /** These project names are archived, so they are not in Watchful. */
  archivedProjectNames: readonly string[];
  /** Unit names on the Shop, DO NOT USE line. Case-insensitive. */
  doNotUseUnits: readonly string[];
  /** Unit names kept out of every total and listed as exceptions. */
  exceptionUnits: readonly string[];
  /** Per-unit tags, for example "RSU" and "no telemetry". Keys are unit names. */
  unitTags: Readonly<Record<string, readonly string[]>>;
};

/** Explicit list plus the "Test 1" / "Test 2" project pattern James described.
 * The DO NOT USE, exception, and tag lists start empty so nothing is assumed. */
export const SHOP_CAMERA_RULE: ShopCameraRule = {
  enabled: true,
  testProjectNames: ['Test 1'],
  testProjectPattern: '^test\\s+\\d+$',
  archivedProjectNames: [],
  doNotUseUnits: [],
  exceptionUnits: [],
  unitTags: {},
};

export type WatchfulMembership = {
  projectName: string | null;
  archived: boolean;
  armed?: boolean;
  immix?: boolean;
};

export type ShopCameraInput = {
  unit: string;
  placement: CameraPlacement;
  state: CameraState;
  site?: string | null;
  mhelpPlacement?: MhelpCameraPlacement | null;
  watchful?: WatchfulMembership | null;
  /** Set from the unit record. The rule's doNotUseUnits list is added in the decision. */
  doNotUse?: boolean;
  /** Set from the unit record. The rule's unitTags list is added in the decision. */
  tags?: readonly string[];
  /** Set from the unit record. The rule's exceptionUnits list is added in the decision. */
  exception?: boolean;
};

export type ShopCameraCategory = 'field' | 'inShop' | 'doNotUse' | 'exception';

export type ShopCameraDecision = {
  unit: string;
  category: ShopCameraCategory;
  inShop: boolean;
  inWatchful: boolean;
  placement: CameraPlacement;
  state: CameraState;
  telemetryState: CameraState;
  statusLabel: typeof SHOP_CAMERA_ONLINE_LABEL | null;
  placeLabel: typeof SHOP_CAMERA_PLACE_LABEL | null;
  tags: readonly string[];
  flag: typeof MHELP_TEST_SITE_FLAG | null;
  counted: {field: boolean; armed: boolean; immix: boolean; inShop: boolean; doNotUse: boolean; exception: boolean};
};

export type ShopCameraFigures = {
  field: number;
  fieldGreen: number;
  fieldYellow: number;
  fieldRed: number;
  fieldUnknown: number;
  armed: number;
  immix: number;
  inShop: number;
  doNotUse: number;
  exceptions: number;
};

export type ShopCameraReport = {
  enabled: boolean;
  byUnit: Map<string, ShopCameraDecision>;
  decisions: ShopCameraDecision[];
  figures: ShopCameraFigures;
};

const fold = (value: string) => value.trim().toLocaleLowerCase();

export function cameraMhelpPlacement(value: unknown): MhelpCameraPlacement | null {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return text === 'FIELD' || text === 'SHOP' || text === 'WAREHOUSE' ? text : null;
}

function unitKeys(name: string): string[] {
  const raw = name.trim().toUpperCase();
  if (!raw) return [];
  const canonical = canonicalCameraUnit(name);
  return canonical && canonical !== raw ? [raw, canonical] : [raw];
}

/** Index mHelp Field / Shop / Warehouse by unit name. A conflicting pair is dropped. */
export function cameraMhelpPlacements(rows: readonly {unitNumber?: string | null; placement?: unknown}[] | null | undefined): Map<string, MhelpCameraPlacement> {
  const found = new Map<string, MhelpCameraPlacement | 'conflict'>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const placement = cameraMhelpPlacement(row?.placement);
    const keys = unitKeys(String(row?.unitNumber ?? ''));
    if (!placement || !keys.length) continue;
    for (const key of keys) {
      const held = found.get(key);
      if (held && held !== placement) found.set(key, 'conflict');
      else if (!held) found.set(key, placement);
    }
  }
  const clean = new Map<string, MhelpCameraPlacement>();
  for (const [key, placement] of found) if (placement !== 'conflict') clean.set(key, placement);
  return clean;
}

export function fieldMapPlacementRows(fieldMap: unknown): {unitNumber?: string | null; placement?: unknown}[] {
  const record = fieldMap as {units?: unknown; items?: unknown; inventoryItems?: unknown} | null;
  const list = Array.isArray(record?.units) ? record.units : Array.isArray(record?.items) ? record.items : Array.isArray(record?.inventoryItems) ? record.inventoryItems : [];
  return list.filter((row): row is {unitNumber?: string | null; placement?: unknown} => Boolean(row) && typeof row === 'object');
}

function listed(names: readonly string[], project: string): boolean {
  const folded = fold(project);
  return Boolean(folded) && names.some(name => fold(name) === folded);
}

/** True only when the whole project name is listed or matches the configured pattern. */
export function isWatchfulTestProject(projectName: string | null | undefined, rule: ShopCameraRule): boolean {
  const name = typeof projectName === 'string' ? projectName.trim() : '';
  if (!name || listed(rule.archivedProjectNames, name)) return false;
  if (listed(rule.testProjectNames, name)) return true;
  const source = rule.testProjectPattern?.trim();
  if (!source) return false;
  const body = source.replace(/^\^/, '').replace(/\$$/, '');
  try {
    const matched = new RegExp('^(?:' + body + ')$', 'i').exec(name);
    return Boolean(matched && matched[0] === name);
  } catch {
    return false;
  }
}

function projectOf(input: ShopCameraInput, rule: ShopCameraRule): {name: string | null; archived: boolean; armed: boolean; immix: boolean} {
  const watchful = input.watchful;
  const name = (watchful ? watchful.projectName : input.site) || null;
  const trimmed = typeof name === 'string' && name.trim() ? name.trim() : null;
  const archived = watchful?.archived === true || (trimmed ? listed(rule.archivedProjectNames, trimmed) : false);
  return {
    name: trimmed,
    archived,
    armed: watchful?.armed === true,
    immix: watchful?.immix === true,
  };
}

function passthrough(input: ShopCameraInput, project: {name: string | null; archived: boolean; armed: boolean; immix: boolean}, tags: readonly string[] = []): ShopCameraDecision {
  const inWatchful = Boolean(project.name) && !project.archived;
  const field = input.placement === 'FIELD';
  return {
    unit: input.unit,
    category: 'field',
    inShop: false,
    inWatchful,
    placement: input.placement,
    state: input.state,
    telemetryState: input.state,
    statusLabel: null,
    placeLabel: null,
    tags,
    flag: null,
    counted: {
      field,
      armed: field && inWatchful && project.armed,
      immix: field && inWatchful && project.immix,
      inShop: false,
      doNotUse: false,
      exception: false,
    },
  };
}

function inShopDecision(input: ShopCameraInput, inWatchful: boolean, tags: readonly string[]): ShopCameraDecision {
  return {
    unit: input.unit,
    category: 'inShop',
    inShop: true,
    inWatchful,
    placement: 'SHOP',
    state: 'GREEN',
    telemetryState: input.state,
    statusLabel: SHOP_CAMERA_ONLINE_LABEL,
    placeLabel: SHOP_CAMERA_PLACE_LABEL,
    tags,
    flag: null,
    counted: {field: false, armed: false, immix: false, inShop: true, doNotUse: false, exception: false},
  };
}

function heldOut(input: ShopCameraInput, category: 'doNotUse' | 'exception', inWatchful: boolean, tags: readonly string[]): ShopCameraDecision {
  return {
    unit: input.unit,
    category,
    inShop: false,
    inWatchful,
    placement: input.placement,
    state: input.state === 'GREEN' ? 'UNKNOWN' : input.state,
    telemetryState: input.state,
    statusLabel: null,
    placeLabel: null,
    tags,
    flag: null,
    counted: {
      field: false, armed: false, immix: false, inShop: false,
      doNotUse: category === 'doNotUse',
      exception: category === 'exception',
    },
  };
}

function ruleTags(rule: ShopCameraRule, unit: string): readonly string[] {
  const folded = fold(unit);
  for (const [name, tags] of Object.entries(rule.unitTags)) if (fold(name) === folded) return tags;
  return [];
}

function mergeTags(listedTags: readonly string[], own: readonly string[] | undefined): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const tag of [...listedTags, ...(own ?? [])]) {
    if (typeof tag !== 'string') continue;
    const text = tag.trim();
    const key = fold(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    tags.push(text);
  }
  return tags;
}

export function decideShopCamera(input: ShopCameraInput, rule: ShopCameraRule = SHOP_CAMERA_RULE): ShopCameraDecision {
  const project = projectOf(input, rule);
  const tags = mergeTags(ruleTags(rule, input.unit), input.tags);
  if (!rule.enabled) return passthrough(input, project, tags);
  const inWatchful = Boolean(project.name) && !project.archived;
  const testSite = inWatchful && isWatchfulTestProject(project.name, rule);
  const mhelp = input.mhelpPlacement ?? null;
  const doNotUse = input.doNotUse === true || listed(rule.doNotUseUnits, input.unit);
  const listedException = input.exception === true || listed(rule.exceptionUnits, input.unit);
  if (listedException || (doNotUse && mhelp === 'FIELD')) return heldOut(input, 'exception', inWatchful, tags);
  if (doNotUse) return heldOut(input, 'doNotUse', inWatchful, tags);
  if (mhelp === 'SHOP' || mhelp === 'WAREHOUSE') return inShopDecision(input, inWatchful, tags);
  if (testSite && mhelp === 'FIELD') {
    const kept = passthrough(input, project, tags);
    return {...kept, flag: MHELP_TEST_SITE_FLAG};
  }
  if (testSite) return inShopDecision(input, inWatchful, tags);
  return passthrough(input, project, tags);
}

function emptyFigures(): ShopCameraFigures {
  return {field: 0, fieldGreen: 0, fieldYellow: 0, fieldRed: 0, fieldUnknown: 0, armed: 0, immix: 0, inShop: 0, doNotUse: 0, exceptions: 0};
}

export function decideShopCameras(inputs: readonly ShopCameraInput[], rule: ShopCameraRule = SHOP_CAMERA_RULE): ShopCameraReport {
  const byUnit = new Map<string, ShopCameraDecision>();
  const decisions: ShopCameraDecision[] = [];
  const figures = emptyFigures();
  const seen = new Set<string>();
  for (const input of inputs) {
    const key = input.unit.trim().toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const decision = decideShopCamera(input, rule);
    byUnit.set(key, decision);
    decisions.push(decision);
    if (decision.counted.inShop) figures.inShop += 1;
    if (decision.counted.field) {
      figures.field += 1;
      if (decision.state === 'GREEN') figures.fieldGreen += 1;
      else if (decision.state === 'YELLOW') figures.fieldYellow += 1;
      else if (decision.state === 'RED') figures.fieldRed += 1;
      else figures.fieldUnknown += 1;
    }
    if (decision.counted.armed) figures.armed += 1;
    if (decision.counted.immix) figures.immix += 1;
    if (decision.counted.doNotUse) figures.doNotUse += 1;
    if (decision.counted.exception) figures.exceptions += 1;
  }
  return {enabled: rule.enabled, byUnit, decisions, figures};
}

/** The tested rollback. Counts and statuses stay on the Watchful mirror. */
export function rollbackShopCameraRule(rule: ShopCameraRule = SHOP_CAMERA_RULE): ShopCameraRule {
  return {...rule, enabled: false};
}

export type ShopCameraSource = {
  unit: string;
  placement: CameraPlacement;
  state: CameraState;
  site?: string | null;
  mhelpPlacement?: unknown;
  watchfulProject?: unknown;
  watchfulArchived?: unknown;
  watchfulArmed?: unknown;
  watchfulImmix?: unknown;
  doNotUse?: unknown;
  tags?: unknown;
  lifecycle?: unknown;
  exception?: unknown;
};

export function shopCameraInput(source: ShopCameraSource, mhelpByUnit?: ReadonlyMap<string, MhelpCameraPlacement>): ShopCameraInput {
  const explicit = cameraMhelpPlacement(source.mhelpPlacement);
  let mhelpPlacement = explicit;
  if (!mhelpPlacement && mhelpByUnit) {
    for (const key of unitKeys(source.unit)) {
      const found = mhelpByUnit.get(key);
      if (found) { mhelpPlacement = found; break; }
    }
  }
  const named = typeof source.watchfulProject === 'string' ? source.watchfulProject : null;
  const watchful = named !== null || source.watchfulArchived === true || source.watchfulArmed === true || source.watchfulImmix === true
    ? {
      projectName: named ?? (source.site?.trim() ? source.site : null),
      archived: source.watchfulArchived === true,
      armed: source.watchfulArmed === true,
      immix: source.watchfulImmix === true,
    }
    : source.site?.trim()
      ? {projectName: source.site, archived: false, armed: false, immix: false}
      : null;
  const lifecycle = typeof source.lifecycle === 'string' ? source.lifecycle.trim() : '';
  const doNotUse = source.doNotUse === true || /^(?:DO NOT USE|DO_NOT_USE)$/i.test(lifecycle);
  const tags = Array.isArray(source.tags) ? source.tags.filter((tag): tag is string => typeof tag === 'string') : [];
  return {
    unit: source.unit,
    placement: source.placement,
    state: source.state,
    site: source.site ?? null,
    mhelpPlacement,
    watchful,
    doNotUse,
    tags,
    exception: source.exception === true,
  };
}

export function applyShopCameraView<T extends {unit: string; placement: CameraPlacement; state: CameraState; onlineInShop?: boolean}>(
  units: readonly T[],
  report: ShopCameraReport,
): T[] {
  return units.flatMap(unit => {
    const decision = report.byUnit.get(unit.unit.trim().toUpperCase());
    if (decision?.category === 'doNotUse' || decision?.category === 'exception') return [];
    if (!decision?.inShop) return [unit];
    return [{...unit, placement: 'SHOP' as const, state: 'GREEN' as const, onlineInShop: true}];
  });
}

/** "no telemetry" sits beside the In shop label. Other tags follow, in list order. */
export function inShopLabel(tags: readonly string[]): string {
  const rest: string[] = [];
  const seen = new Set<string>();
  let noTelemetry = false;
  for (const tag of tags) {
    const text = tag.trim();
    const key = fold(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (key === 'no telemetry') noTelemetry = true;
    else rest.push(text);
  }
  return [SHOP_CAMERA_PLACE_LABEL, ...(noTelemetry ? ['no telemetry'] : []), ...rest].join(' · ');
}

export function shopDoNotUseLine(units: readonly string[]): string {
  const names = units.filter(Boolean);
  return (names.length ? SHOP_DO_NOT_USE_LABEL + ' · ' + names.length + ' · ' + names.join(', ') : SHOP_DO_NOT_USE_LABEL + ' · 0') + '. Not online.';
}

export function exceptionLine(units: readonly string[]): string {
  const names = units.filter(Boolean);
  return (names.length ? SHOP_EXCEPTION_LABEL + ' · ' + names.length + ' · ' + names.join(', ') : SHOP_EXCEPTION_LABEL + ' · 0') + '. Not in any total.';
}
