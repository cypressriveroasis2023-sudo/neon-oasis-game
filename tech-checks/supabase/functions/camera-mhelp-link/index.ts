/**
 * Attaching each COS unit's mHelp A#, inside the Tech Check project.
 *
 * The camera health sweep lives here and will not check a unit whose ownership
 * it cannot confirm, which it does by the unit's mHelp A#. On 2026-11-24, 374
 * of COS's 471 units carried no A#, so the 672 cameras on those units were
 * never checked at all. That is the gap behind the counts not matching mHelp.
 *
 * James chose, 2026-11-24, that the mHelp list should live in this project, so
 * a scheduled run here needs no credential belonging to the other project. This
 * job pulls the list from a read-only endpoint over there, keeps its own copy in
 * app_private.cos_mhelp_field_list, and decides the links.
 *
 * Two actions, and the difference matters:
 *
 *   plan  - refreshes this project's copy of the mHelp list and returns what it
 *           WOULD attach. Writes nothing to camera_devices and no links.
 *   apply - also records the links and writes each unit's A# onto every camera
 *           row of that unit.
 *
 * What it never does: overwrite a link that already exists, whoever made it;
 * reuse an A# already attached to another unit; guess where two names could mean
 * the same unit; or touch any column but mhelp_product_id. The other chat is
 * refiling which customer a camera belongs to at the same time, and nothing here
 * writes organization or unit_key.
 */

import {planUnitAttachments, summariseAttachPlan} from '../../../operations/shared/mhelpUnitAttach.ts';
import type {AttachCandidate, AttachPlan} from '../../../operations/shared/mhelpUnitAttach.ts';

export const LINK_CONTRACT = 'camera-mhelp-link-v1';
/** The most links one apply will write, so a single run can always be read and undone. */
export const APPLY_LIMIT = 500;

export const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'},
});

export type LinkAction = 'plan' | 'apply';

/** Reads the action. Anything but exactly {"action":"plan"} or {"action":"apply"} is refused. */
export async function readLinkAction(req: Request): Promise<LinkAction> {
  if (req.method !== 'POST' || new URL(req.url).search
      || !/^application\/json(?:;|$)/i.test(req.headers.get('Content-Type') || '')) throw Error('Invalid request');
  const raw = await req.text();
  if (raw.length > 256) throw Error('Invalid request');
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1) throw Error('Invalid request');
  if (value.action !== 'plan' && value.action !== 'apply') throw Error('Invalid request');
  return value.action;
}

export type FieldListRow = {
  productId: string; unitNumber: string; placement: string | null; lifecycle: string | null;
  category: string | null; customer: string | null; sourceAddress: string | null;
  holdReason: string | null; placementObservedAt: string | null;
};

/** The list as served by cos-mhelp-field-list, checked before anything is stored. */
export function readServedList(value: unknown): {sourceSha256: string | null; complete: boolean; records: FieldListRow[]} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Unsupported list');
  const list = value as Record<string, unknown>;
  if (list.contract !== 'cos-mhelp-field-list-v1' || !Array.isArray(list.records)) throw Error('Unsupported list');
  if (!Number.isSafeInteger(list.recordCount) || Number(list.recordCount) !== list.records.length) throw Error('Unsupported list');
  const records = list.records.map(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw Error('Unsupported list');
    const row = record as Record<string, unknown>;
    if (typeof row.productId !== 'string' || !/^[1-9][0-9]{0,14}$/.test(row.productId)) throw Error('Unsupported list');
    if (typeof row.unitNumber !== 'string' || !row.unitNumber || row.unitNumber.length > 180) throw Error('Unsupported list');
    const optional = (key: string, limit: number) => {
      const held = row[key];
      if (held == null) return null;
      if (typeof held !== 'string' || held.length > limit) throw Error('Unsupported list');
      return held;
    };
    return {
      productId: row.productId, unitNumber: row.unitNumber,
      placement: optional('placement', 32), lifecycle: optional('lifecycle', 64),
      category: optional('category', 120), customer: optional('customer', 240),
      sourceAddress: optional('sourceAddress', 240), holdReason: optional('holdReason', 64),
      placementObservedAt: optional('placementObservedAt', 40),
    };
  });
  if (new Set(records.map(row => row.productId)).size !== records.length) throw Error('Unsupported list');
  return {
    sourceSha256: typeof list.sourceSha256 === 'string' && /^[0-9a-f]{64}$/.test(list.sourceSha256) ? list.sourceSha256 : null,
    complete: list.complete === true,
    records,
  };
}

/** The plan, trimmed to what fits in one readable answer. */
export function projectPlan(plan: AttachPlan, limit = 400) {
  return {
    ...summariseAttachPlan(plan),
    wouldLink: plan.links.slice(0, limit).map(link => ({
      unitKey: link.unitKey, productId: link.productId, mhelpName: link.mhelpName,
      suffixDiffers: link.cosVariant !== link.mhelpVariant,
    })),
    wouldHold: plan.held.slice(0, limit).map(held => ({side: held.side, name: held.name, reason: held.reason})),
    truncated: plan.links.length > limit || plan.held.length > limit,
  };
}

export function createCameraMhelpLinkHandler(options: {
  verifyCron: (candidate: string | null) => Promise<boolean>;
  /** Fetches the list from the other project's read-only endpoint, passing the secret through. */
  readServed: (secret: string) => Promise<unknown>;
  /** Stores this project's copy of the list. Our own table; never camera_devices. */
  saveFieldList: (records: FieldListRow[], sourceSha256: string | null) => Promise<number>;
  /** Every COS unit_key with at least one camera row, and whether it is out of use. */
  readCosUnits: () => Promise<AttachCandidate[]>;
  /** unit_key values that already have a link, and the A#s already attached. */
  readExistingLinks: () => Promise<{unitKeys: string[]; productIds: string[]}>;
  /** Records the links and writes each unit's A# onto every camera row of that unit. */
  applyLinks: (links: AttachPlan['links']) => Promise<{unitsLinked: number; cameraRowsWritten: number}>;
}) {
  return async (req: Request) => {
    const secret = req.headers.get('x-camera-cron-secret');
    try {
      if (!secret || secret.length > 1024 || /\s/.test(secret) || !await options.verifyCron(secret)) {
        return reply({error: 'Forbidden'}, 403);
      }
    } catch { return reply({error: 'Forbidden'}, 403); }

    let action: LinkAction;
    try { action = await readLinkAction(req); } catch { return reply({error: 'Invalid link request'}, 400); }

    let served: ReturnType<typeof readServedList>;
    try { served = readServedList(await options.readServed(secret)); }
    catch { return reply({error: 'The mHelp list could not be read. Nothing was changed.'}, 503); }
    // An incomplete list would hold units that do have an mHelp row, and the
    // holds are a punch list for a person, so a short list is refused outright.
    if (!served.complete) return reply({error: 'The mHelp list is incomplete. Nothing was changed.'}, 503);

    let listed = 0;
    try { listed = await options.saveFieldList(served.records, served.sourceSha256); }
    catch { return reply({error: 'This project\'s copy of the mHelp list could not be saved.'}, 503); }

    let units: AttachCandidate[], existing: {unitKeys: string[]; productIds: string[]};
    try { [units, existing] = await Promise.all([options.readCosUnits(), options.readExistingLinks()]); }
    catch { return reply({error: 'COS units could not be read. Nothing was changed.'}, 503); }

    const plan = planUnitAttachments(
      units,
      served.records.map(row => ({id: row.productId, name: row.unitNumber, productId: row.productId, lifecycle: row.lifecycle})),
      existing.productIds,
      existing.unitKeys,
    );

    const receipt = {
      contract: LINK_CONTRACT, action, ranAt: new Date().toISOString(),
      listed, sourceSha256: served.sourceSha256,
      cosUnits: units.length, alreadyLinked: existing.unitKeys.length,
      ...projectPlan(plan),
    };

    if (action === 'plan') return reply({...receipt, applied: false});

    if (plan.links.length > APPLY_LIMIT) {
      return reply({...receipt, applied: false,
        error: 'That is more links than one run writes. A person should look at the plan first.'}, 409);
    }
    try {
      const written = await options.applyLinks(plan.links);
      return reply({...receipt, applied: true, ...written});
    } catch {
      return reply({...receipt, applied: false, error: 'The links could not be written. Run plan again to see the current state.'}, 503);
    }
  };
}
