/**
 * Live InHand router status for the Fleet board and the Routers page.
 *
 * The data job writes this into camera_unit_routers. This module only reads
 * those fields. It never probes a router and never writes a row.
 *
 * Columns, as stored today:
 * - reported_status: the InHand status (online / offline)
 * - status_observed_at: the InHand reported or last-contact time
 * - status_source: "InHand live pull" for the live feed
 * - router_model: already returned to the browser; MOFI / Cradlepoint show up here
 * - router_type: exact brand when the row includes it (mofi, cradlepoint)
 * - unit_key: the only join to a unit, and only when it matches exactly
 *
 * #441's shared count selector can call inhandRouterOutage later.
 */
import {exactUnitName} from '../../supabase/functions/cos-operations-pages/routers';

/** The feed lands about every 30 minutes. Older than this is Unknown. */
export const INHAND_ROUTER_FRESHNESS_MS = 45 * 60 * 1000;

/** Exact status_source written by the live InHand pull. */
export const INHAND_LIVE_STATUS_SOURCE = 'InHand live pull';

export const IN_SHOP_LABEL = 'In Shop';
export const IN_SHOP_COLOR = '#64748b';

export type InhandDisplayState = 'online' | 'offline' | 'unknown' | 'in_shop';

export type InhandRouterReading = {
  state: InhandDisplayState;
  label: 'Online' | 'Offline' | 'Unknown' | 'In Shop';
  color: string | null;
  /** Shop, Unknown, and every non-FIELD reading add 0. */
  outageCount: 0 | 1;
  alert: boolean;
  /** A router-offline to-do exists only for a fresh InHand offline on FIELD. */
  routerOfflineTodo: boolean;
};

export type InhandRouterInput = {
  placement?: string | null;
  /** camera_unit_routers.router_type, when the row carries it. */
  routerType?: string | null;
  /** camera_unit_routers.router_model. */
  model?: string | null;
  /** camera_unit_routers.reported_status. */
  reportedStatus?: string | null;
  /** camera_unit_routers.status_observed_at. */
  reportedAt?: string | null;
  /** camera_unit_routers.status_source. */
  statusSource?: string | null;
  /**
   * False when this unit has no single exact unit_key match.
   * Omit it when the row is the router itself, not a unit join.
   */
  matched?: boolean;
};

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

const unknownReading = (): InhandRouterReading => ({
  state: 'unknown',
  label: 'Unknown',
  color: null,
  outageCount: 0,
  alert: false,
  routerOfflineTodo: false,
});

/** Shop / root is a placement, not a health failure. FIELD is the only outage placement. */
export function inhandPlacement(value: unknown): 'field' | 'shop' | 'other' {
  const raw = text(value).toLowerCase();
  if (raw === 'shop' || raw === 'root') return 'shop';
  if (raw === 'field') return 'field';
  return 'other';
}

/** Brand from the stored type, or from the model text when that is the column we have. */
export function inhandRouterBrand(routerType: unknown, model: unknown): 'mofi' | 'cradlepoint' | 'other' {
  const type = text(routerType).toLowerCase();
  if (type === 'mofi') return 'mofi';
  if (type === 'cradlepoint') return 'cradlepoint';
  const name = text(model).toLowerCase();
  if (/(^|[^a-z0-9])mofi([^a-z0-9]|$)/.test(name)) return 'mofi';
  if (/(^|[^a-z0-9])cradlepoint([^a-z0-9]|$)/.test(name)) return 'cradlepoint';
  return 'other';
}

function freshReportedAt(value: unknown, now: number): boolean {
  if (typeof value !== 'string') return false;
  const at = Date.parse(value);
  if (!Number.isFinite(at) || at > now) return false;
  return now - at <= INHAND_ROUTER_FRESHNESS_MS;
}

/**
 * One router's live label. Missing, stale, MOFI, Cradlepoint, and an unmatched
 * unit are Unknown. They are never Offline and this function does not throw.
 * A shop placement is In Shop even when the reading would otherwise be offline.
 */
export function inhandRouterReading(input: InhandRouterInput, now = Date.now()): InhandRouterReading {
  if (inhandPlacement(input?.placement) === 'shop') {
    return {
      state: 'in_shop',
      label: IN_SHOP_LABEL,
      color: IN_SHOP_COLOR,
      outageCount: 0,
      alert: false,
      routerOfflineTodo: false,
    };
  }
  if (input?.matched === false) return unknownReading();
  const brand = inhandRouterBrand(input?.routerType, input?.model);
  if (brand === 'mofi' || brand === 'cradlepoint') return unknownReading();
  if (text(input?.statusSource) !== INHAND_LIVE_STATUS_SOURCE) return unknownReading();
  if (!freshReportedAt(input?.reportedAt, now)) return unknownReading();
  const status = text(input?.reportedStatus).toLowerCase();
  if (status === 'online') {
    return {state: 'online', label: 'Online', color: null, outageCount: 0, alert: false, routerOfflineTodo: false};
  }
  if (status === 'offline') {
    const field = inhandPlacement(input?.placement) === 'field';
    return {
      state: 'offline',
      label: 'Offline',
      color: null,
      outageCount: field ? 1 : 0,
      alert: field,
      routerOfflineTodo: field,
    };
  }
  return unknownReading();
}

/**
 * The count #441 can call. A shop unit and any placement other than FIELD
 * contribute 0 and do not raise a router-offline to-do.
 */
export function inhandRouterOutage(input: InhandRouterInput, now = Date.now()): {offline: boolean; count: 0 | 1; label: InhandRouterReading['label']; state: InhandDisplayState} {
  const reading = inhandRouterReading(input, now);
  return {offline: reading.routerOfflineTodo, count: reading.outageCount, label: reading.label, state: reading.state};
}

/**
 * Join a router to a unit by the stored unit key only.
 * Case and repeated spaces are the same key. Partial names, aliases, and
 * a second row with the same key are not a match.
 */
export function matchRouterByExactUnitKey<T extends {unitKey?: string | null}>(unitKey: unknown, routers: readonly T[] | null | undefined): T | null {
  const key = exactUnitName(unitKey);
  if (!key || !Array.isArray(routers)) return null;
  const hits = routers.filter(row => exactUnitName(row?.unitKey) === key);
  return hits.length === 1 ? hits[0] : null;
}
