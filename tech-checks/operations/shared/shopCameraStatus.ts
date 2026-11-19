// Camera-only presentation for shop, warehouse, and Watchful test sites.
//
// James 11:01 AM CT Nov 19: a unit in a Watchful test project, and a unit mHelp
// places in Shop or Warehouse, shows ONLINE with the label "In shop", in its
// own count. Customer field monitoring still mirrors Watchful. mHelp Field or
// Shop wins; a Field mark on a test project is flagged and is not moved.
//
// Test projects come only from watchful-test-projects.json, matched by project
// id or, while that id is missing, by its placeholder key. A project name is
// never a match. An unknown project whose name is one of those labels only
// produces a warning.
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
import watchfulTestProjectsFile from './watchful-test-projects.json' with {type: 'json'};

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

export type WatchfulTestProjectRecord = {
  label: string;
  id: string | null;
  idStatus: 'missing' | 'known';
  /** Present only while idStatus is missing. Omitted once the Watchful id is known. */
  placeholderKey?: string;
};

export const WATCHFUL_TEST_PROJECTS_PATH = 'tech-checks/operations/shared/watchful-test-projects.json';

export const WATCHFUL_TEST_PROJECTS = watchfulTestProjectsFile.projects as readonly WatchfulTestProjectRecord[];

/** The match key for one config row: the Watchful id, or the placeholder while that id is missing. */
export function watchfulTestProjectMatchKey(project: WatchfulTestProjectRecord): string | null {
  if (project.idStatus === 'known' && typeof project.id === 'string' && project.id.trim()) return project.id.trim();
  if (project.id === null && project.idStatus === 'missing' && typeof project.placeholderKey === 'string' && project.placeholderKey.startsWith('MISSING_WATCHFUL_ID:')) return project.placeholderKey;
  return null;
}

export function configuredWatchfulTestProjectKey(label: string): string | null {
  const folded = label.trim().toLocaleLowerCase();
  const project = WATCHFUL_TEST_PROJECTS.find(row => row.label.trim().toLocaleLowerCase() === folded);
  return project ? watchfulTestProjectMatchKey(project) : null;
}

export function missingWatchfulTestProjectIds(): string[] {
  return WATCHFUL_TEST_PROJECTS.filter(project => project.idStatus === 'missing' || project.id === null).map(project => project.label);
}

const configuredTestProjectKeys = WATCHFUL_TEST_PROJECTS.map(watchfulTestProjectMatchKey).filter((key): key is string => Boolean(key));

export type ShopCameraRule = {
  enabled: boolean;
  /** Watchful project ids, or placeholder keys while the id is missing. Names are not keys. */
  testProjectKeys: readonly string[];
  /** Project ids or placeholder keys that are archived, so they are not in Watchful. */
  archivedProjectKeys: readonly string[];
  /** Unit names on the Shop, DO NOT USE line. Case-insensitive. */
  doNotUseUnits: readonly string[];
  /** Unit names kept out of every total and listed as exceptions. */
  exceptionUnits: readonly string[];
  /** Per-unit tags, for example "RSU" and "no telemetry". Keys are unit names. */
  unitTags: Readonly<Record<string, readonly string[]>>;
};

/** Test-project keys are copied from watchful-test-projects.json. The other lists start empty. */
export const SHOP_CAMERA_RULE: ShopCameraRule = {
  enabled: true,
  testProjectKeys: configuredTestProjectKeys,
  archivedProjectKeys: [],
  doNotUseUnits: [],
  exceptionUnits: [],
  unitTags: {},
};

export type WatchfulMembership = {
  projectKey: string | null;
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
  /** Camera channels on the device. An unnamed device is unclassified only when this is 0. */
  cameras?: number;
  /** No unit name. Combined with cameras 0 on a test project, the device is not counted. */
  unnamed?: boolean;
  /** Lookup key when the device has no unit name. */
  deviceKey?: string;
};

export type ShopCameraCategory = 'field' | 'inShop' | 'doNotUse' | 'exception' | 'unclassified';

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
  warnings: readonly string[];
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
  warnings: readonly string[];
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

/** True only when the project id or placeholder key is on the explicit list. */
export function isWatchfulTestProjectKey(projectKey: string | null | undefined, rule: ShopCameraRule): boolean {
  const key = typeof projectKey === 'string' ? projectKey.trim() : '';
  if (!key || listedExact(rule.archivedProjectKeys, key)) return false;
  return listedExact(rule.testProjectKeys, key);
}

function listedExact(keys: readonly string[], key: string): boolean {
  return keys.some(item => item.trim() === key);
}

function projectOf(input: ShopCameraInput, rule: ShopCameraRule): {key: string | null; name: string | null; archived: boolean; armed: boolean; immix: boolean} {
  const watchful = input.watchful;
  const key = typeof watchful?.projectKey === 'string' && watchful.projectKey.trim() ? watchful.projectKey.trim() : null;
  const named = watchful ? watchful.projectName : input.site;
  const name = typeof named === 'string' && named.trim() ? named.trim() : null;
  const archived = watchful?.archived === true || (key ? listedExact(rule.archivedProjectKeys, key) : false);
  return {
    key,
    name,
    archived,
    armed: watchful?.armed === true,
    immix: watchful?.immix === true,
  };
}

/** A known test-project label with an unknown key. This never classifies the unit. */
export function watchfulTestSiteNameWarning(projectName: string): string {
  return 'Watchful project "' + projectName.trim() + '" is not on the test-project id list. It was not classified as a test site.';
}

function testSiteNameWarning(project: {key: string | null; name: string | null; archived: boolean}, rule: ShopCameraRule): string[] {
  if (project.archived || !project.name) return [];
  if (project.key && isWatchfulTestProjectKey(project.key, rule)) return [];
  const folded = fold(project.name);
  const knownLabel = WATCHFUL_TEST_PROJECTS.some(row => fold(row.label) === folded);
  return knownLabel ? [watchfulTestSiteNameWarning(project.name)] : [];
}

function passthrough(input: ShopCameraInput, project: {key: string | null; name: string | null; archived: boolean; armed: boolean; immix: boolean}, tags: readonly string[] = [], warnings: readonly string[] = []): ShopCameraDecision {
  const inWatchful = Boolean(project.key || project.name) && !project.archived;
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
    warnings,
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

function inShopDecision(input: ShopCameraInput, inWatchful: boolean, tags: readonly string[], warnings: readonly string[] = []): ShopCameraDecision {
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
    warnings,
    counted: {field: false, armed: false, immix: false, inShop: true, doNotUse: false, exception: false},
  };
}

function unclassifiedDecision(input: ShopCameraInput, inWatchful: boolean, tags: readonly string[], warnings: readonly string[]): ShopCameraDecision {
  return {
    unit: input.unit,
    category: 'unclassified',
    inShop: false,
    inWatchful,
    placement: input.placement,
    state: input.state,
    telemetryState: input.state,
    statusLabel: null,
    placeLabel: null,
    tags,
    flag: null,
    warnings,
    counted: {field: false, armed: false, immix: false, inShop: false, doNotUse: false, exception: false},
  };
}

function heldOut(input: ShopCameraInput, category: 'doNotUse' | 'exception', inWatchful: boolean, tags: readonly string[], warnings: readonly string[] = []): ShopCameraDecision {
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
    warnings,
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
  const warnings = testSiteNameWarning(project, rule);
  if (!rule.enabled) return passthrough(input, project, tags, warnings);
  const inWatchful = Boolean(project.key || project.name) && !project.archived;
  const testSite = !project.archived && isWatchfulTestProjectKey(project.key, rule);
  const unnamed = input.unnamed === true || !input.unit.trim();
  if (unnamed && input.cameras === 0 && testSite) return unclassifiedDecision(input, inWatchful, tags, warnings);
  const mhelp = input.mhelpPlacement ?? null;
  const doNotUse = input.doNotUse === true || listed(rule.doNotUseUnits, input.unit);
  const listedException = input.exception === true || listed(rule.exceptionUnits, input.unit);
  if (listedException || (doNotUse && mhelp === 'FIELD')) return heldOut(input, 'exception', inWatchful, tags, warnings);
  if (doNotUse) return heldOut(input, 'doNotUse', inWatchful, tags, warnings);
  if (mhelp === 'SHOP' || mhelp === 'WAREHOUSE') return inShopDecision(input, inWatchful, tags, warnings);
  if (testSite && mhelp === 'FIELD') {
    const kept = passthrough(input, project, tags, warnings);
    return {...kept, flag: MHELP_TEST_SITE_FLAG};
  }
  if (testSite) return inShopDecision(input, inWatchful, tags, warnings);
  return passthrough(input, project, tags, warnings);
}

function emptyFigures(): ShopCameraFigures {
  return {field: 0, fieldGreen: 0, fieldYellow: 0, fieldRed: 0, fieldUnknown: 0, armed: 0, immix: 0, inShop: 0, doNotUse: 0, exceptions: 0};
}

export function decideShopCameras(inputs: readonly ShopCameraInput[], rule: ShopCameraRule = SHOP_CAMERA_RULE): ShopCameraReport {
  const byUnit = new Map<string, ShopCameraDecision>();
  const decisions: ShopCameraDecision[] = [];
  const warnings: string[] = [];
  const figures = emptyFigures();
  const seen = new Set<string>();
  for (const input of inputs) {
    const key = input.unit.trim().toUpperCase() || String(input.deviceKey ?? '').trim().toUpperCase();
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
    for (const warning of decision.warnings) if (!warnings.includes(warning)) warnings.push(warning);
  }
  return {enabled: rule.enabled, byUnit, decisions, figures, warnings};
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
  watchfulProjectKey?: unknown;
  watchfulArchived?: unknown;
  watchfulArmed?: unknown;
  watchfulImmix?: unknown;
  cameras?: unknown;
  unnamed?: unknown;
  deviceKey?: unknown;
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
  const projectKey = typeof source.watchfulProjectKey === 'string' && source.watchfulProjectKey.trim() ? source.watchfulProjectKey.trim() : null;
  const watchful = projectKey !== null || named !== null || source.watchfulArchived === true || source.watchfulArmed === true || source.watchfulImmix === true
    ? {
      projectKey,
      projectName: named ?? (source.site?.trim() ? source.site : null),
      archived: source.watchfulArchived === true,
      armed: source.watchfulArmed === true,
      immix: source.watchfulImmix === true,
    }
    : source.site?.trim()
      ? {projectKey: null, projectName: source.site, archived: false, armed: false, immix: false}
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
    cameras: typeof source.cameras === 'number' ? source.cameras : undefined,
    unnamed: source.unnamed === true || !source.unit.trim(),
    deviceKey: typeof source.deviceKey === 'string' ? source.deviceKey : undefined,
  };
}

export function applyShopCameraView<T extends {unit: string; deviceKey?: string; placement: CameraPlacement; state: CameraState; onlineInShop?: boolean}>(
  units: readonly T[],
  report: ShopCameraReport,
): T[] {
  return units.flatMap(unit => {
    const key = unit.unit.trim().toUpperCase() || String(unit.deviceKey || '').trim().toUpperCase();
    const decision = report.byUnit.get(key);
    if (decision?.category === 'doNotUse' || decision?.category === 'exception' || decision?.category === 'unclassified') return [];
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
