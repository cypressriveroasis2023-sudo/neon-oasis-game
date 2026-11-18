/** Loud source facts. A stale, missing, or unshown check is never an outage. */

export type AttentionState = 'reconnect_required' | 'failed' | 'stale' | 'unknown' | 'current' | 'absent';

export type SourceAttention = {
  id: 'mhelp_auth' | 'mhelp_inventory' | 'connections' | 'star4live' | 'victron' | 'tracker';
  source: string;
  state: AttentionState;
  since: string | null;
  action: string;
};

export type MhelpFacts = {
  authState?: string | null;
  lastSuccess?: string | null;
  failed?: boolean;
  errorCode?: string | null;
  live?: boolean;
  /** Caller already applied that source's own window (45 minutes live, 24 hours file). */
  reportedStale?: boolean;
};

export type SourceFacts = {
  now: number;
  /** Omitted: this view does not read the source. Null: it looked and has nothing. */
  mhelp?: MhelpFacts | null;
  connections?: { state?: string | null; boardCheckedAt?: number | null } | null;
  star?: { fresh?: boolean | null; syncedAt?: string | null; status?: string | null } | null;
  victron?: { errorCode?: string | null; lastAttemptAt?: string | null } | null;
  tracker?: { verifiedAt?: string | null; failed?: boolean } | null;
};

const MHELP_FRESH_MS = 45 * 60 * 1000;
const BOARD_CURRENT_MS = 20 * 60 * 1000;
const STAR_FRESH_MS = 45 * 60 * 1000;
const VICTRON_FRESH_MS = 20 * 60 * 1000;
const TRACKER_FRESH_MS = 30 * 60 * 1000;

function elapsed(value: string | number | null | undefined, now: number): number | null {
  const at = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(at) || at > now + 60_000) return null;
  return now - at;
}

function item(id: SourceAttention['id'], source: string, state: AttentionState, since: string | null, action: string): SourceAttention {
  return { id, source, state, since, action };
}

function absent(id: SourceAttention['id'], source: string): SourceAttention {
  return item(id, source, 'absent', null, 'This view does not read '+source+'. That is not an outage.');
}

/** Every watched source, including the ones that are current or not on this view. */
export function sourceHealth(facts: SourceFacts): SourceAttention[] {
  const now = facts.now;
  const rows: SourceAttention[] = [];
  if (!('mhelp' in facts) || facts.mhelp === undefined) {
    rows.push(absent('mhelp_auth', 'mHelpDesk authorization'));
    rows.push(absent('mhelp_inventory', 'mHelp inventory'));
  } else if (facts.mhelp === null) {
    rows.push(item('mhelp_auth', 'mHelpDesk authorization', 'unknown', null, 'Open Fleet so the saved authorization can be read. This is not an outage.'));
    rows.push(item('mhelp_inventory', 'mHelp inventory', 'unknown', null, 'Inventory freshness is not on file. This is not an outage.'));
  } else if (facts.mhelp.authState === 'reconnect_required') {
    rows.push(item('mhelp_auth', 'mHelpDesk authorization', 'reconnect_required', facts.mhelp.lastSuccess ?? null, 'Reconnect mHelpDesk.'));
    rows.push(item('mhelp_inventory', 'mHelp inventory', 'failed', facts.mhelp.lastSuccess ?? null, 'Reconnect mHelpDesk before the next inventory read. Saved inventory is not an outage.'));
  } else {
    const verified = facts.mhelp.authState === 'verified';
    rows.push(item('mhelp_auth', 'mHelpDesk authorization', verified ? 'current' : 'unknown', facts.mhelp.lastSuccess ?? null,
      verified ? 'No action. Authorization is verified.' : 'Authorization is not verified yet. This is not an outage.'));
    const age = elapsed(facts.mhelp.lastSuccess, now);
    const failed = facts.mhelp.failed === true || Boolean(facts.mhelp.errorCode);
    const stale = facts.mhelp.reportedStale === true || (facts.mhelp.live !== false && (age === null || age > MHELP_FRESH_MS));
    rows.push(item('mhelp_inventory', 'mHelp inventory',
      failed ? 'failed' : stale ? (age === null && facts.mhelp.reportedStale !== true ? 'unknown' : 'stale') : 'current',
      facts.mhelp.lastSuccess ?? null,
      failed ? 'The last inventory read failed. Showing the saved list. This is not an outage.'
        : stale ? 'The last inventory read is old. This is not an outage.'
          : 'No action. Inventory is inside its window.'));
  }

  if (!('connections' in facts) || facts.connections === undefined) rows.push(absent('connections', 'Connection census'));
  else if (facts.connections === null) rows.push(item('connections', 'Connection census', 'unknown', null, 'Connection freshness is not on file. This is not an outage.'));
  else {
    const bad = facts.connections.state === 'error' || facts.connections.state === 'timeout' || facts.connections.state === 'rejected';
    const age = elapsed(facts.connections.boardCheckedAt, now);
    const stale = age === null || age > BOARD_CURRENT_MS;
    rows.push(item('connections', 'Connection census',
      bad ? 'failed' : stale ? (age === null ? 'unknown' : 'stale') : 'current',
      typeof facts.connections.boardCheckedAt === 'number' ? new Date(facts.connections.boardCheckedAt).toISOString() : null,
      bad || stale ? 'Live online and offline stay unknown until a census inside the current window. A router not answering is not a camera outage.'
        : 'No action. The connection census is inside its window.'));
  }

  if (!('star' in facts) || facts.star === undefined) rows.push(absent('star4live', 'Star4Live'));
  else if (facts.star === null) rows.push(item('star4live', 'Star4Live', 'unknown', null, 'Star4Live freshness is not on file. Units stay Unknown, not offline.'));
  else {
    const age = elapsed(facts.star.syncedAt, now);
    const failedStatus = facts.star.status != null && facts.star.status !== 'ok';
    const stale = facts.star.fresh === false || failedStatus || (age !== null && age > STAR_FRESH_MS);
    const unknown = facts.star.fresh !== true && age === null && !failedStatus;
    rows.push(item('star4live', 'Star4Live',
      facts.star.fresh === true && !stale ? 'current' : unknown ? 'unknown' : 'stale',
      facts.star.syncedAt ?? null,
      stale || unknown ? 'Star4Live is not a current sync. Units stay Unknown, not offline.' : 'No action. Star4Live sync is current.'));
  }

  if (!('victron' in facts) || facts.victron === undefined) rows.push(absent('victron', 'Victron VRM'));
  else if (facts.victron === null) rows.push(item('victron', 'Victron VRM', 'unknown', null, 'Victron freshness is not on file. That is Unknown, not a battery alarm.'));
  else {
    const age = elapsed(facts.victron.lastAttemptAt, now);
    const failed = Boolean(facts.victron.errorCode);
    const stale = age !== null && age > VICTRON_FRESH_MS;
    const unknown = !failed && age === null;
    rows.push(item('victron', 'Victron VRM',
      failed ? 'failed' : unknown ? 'unknown' : stale ? 'stale' : 'current',
      facts.victron.lastAttemptAt ?? null,
      failed || stale || unknown ? 'Victron power is not current. That is Unknown, not a battery alarm.' : 'No action. Victron was read inside its window.'));
  }

  if (!('tracker' in facts) || facts.tracker === undefined) rows.push(absent('tracker', 'Tracker sheet'));
  else if (facts.tracker === null) rows.push(item('tracker', 'Tracker sheet', 'unknown', null, 'Tracker freshness is not on file. This is not an outage.'));
  else {
    const age = elapsed(facts.tracker.verifiedAt, now);
    const failed = facts.tracker.failed === true;
    const stale = !failed && age !== null && age > TRACKER_FRESH_MS;
    const unknown = !failed && age === null;
    rows.push(item('tracker', 'Tracker sheet',
      failed ? 'failed' : unknown ? 'unknown' : stale ? 'stale' : 'current',
      facts.tracker.verifiedAt ?? null,
      failed || stale || unknown ? 'The tracker read is not current. Connection totals stay unknown. This is not an outage.' : 'No action. The tracker read is inside 30 minutes.'));
  }
  return rows;
}

/** Banners for a rejected token or a source this view actually reads and finds bad.
 * A source the view does not carry stays off the banner. */
export function loudSourceAlerts(facts: SourceFacts): SourceAttention[] {
  return sourceHealth(facts).filter(row => row.state !== 'current' && row.state !== 'absent');
}

const NOTICE_NAME: Partial<Record<SourceAttention['id'], string>> = {
  tracker: 'Tracker',
  star4live: 'Star4Live',
  connections: 'Connection',
  victron: 'Victron',
  mhelp_inventory: 'mHelp inventory',
  mhelp_auth: 'mHelpDesk',
};

/** One short line when a source this view reads has actually failed or gone stale.
 * A current tracker, or a source with no time yet, stays quiet. */
export function cameraSourceNotice(facts: SourceFacts): string | null {
  const failing = sourceHealth(facts).find(row => row.state === 'failed' || row.state === 'stale');
  if (!failing) return null;
  return (NOTICE_NAME[failing.id] || failing.source)+' readings delayed — status may be out of date';
}
