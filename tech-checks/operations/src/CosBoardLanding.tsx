import {useEffect, useMemo, useRef, useState} from 'react';
import {api} from './api';
import {cameraFeedCensus, cameraFeedClock, recorderLinksFromHealth} from './sharedFleetCounts';
import {STAR_UNIT_STATUS_CONTRACT, type UnitCameraStatus} from '../shared/starUnitStatus';
import type {CameraRow} from './cameraEvidence';
import type {RouterRow} from '../../supabase/functions/cos-operations-pages/routers';
import type {MhelpAddressMapResult} from './mhelpAddressMapPins';
import {workspaceHash} from './workspaceNavigation';
import {boardData} from './cosBoard/boardData';
import {boardEditState, handFixRequest, type BoardEditFlags, type BoardEditState, type BoardFixStep} from './cosBoard/boardEdit';
import {mountCosBoard} from './cosBoard/boardApp';
import {loadBoardFonts} from './cosBoard/boardFonts';

export type CosBoardLandingProps = {
  /** The camera feed the shared count reads. */
  feed: UnitCameraStatus[];
  recorderRows: readonly CameraRow[] | null | undefined;
  /** The same clock and field map the Fleet headline is counted with. */
  now: number;
  fieldMap: unknown;
  routers: readonly RouterRow[] | null | undefined;
  upload: unknown;
  addresses: MhelpAddressMapResult | null | undefined;
  /** Hands a newer camera feed back to Fleet, so the headline and the board move together. */
  onFeed: (units: UnitCameraStatus[]) => void;
  /** Called once the board is on screen. */
  onReady?: () => void;
};

type Board = {update(data: unknown): void; setEdit(state: BoardEditState): void; destroy(): void; root: ShadowRoot};
type Report = {
  contract?: string; units?: UnitCameraStatus[]; canEdit?: boolean; handEditsRead?: boolean;
  recorded?: {pinned?: boolean; pinNote?: string | null};
};
type Reading = Report & {units: UnitCameraStatus[]};

const REREAD_MS = 5 * 60 * 1000;
/** Fleet settles on its reading over a few quick steps as it opens. Wait for the last one. */
const SETTLE_MS = 1500;

function checked(value: unknown): Reading {
  const report = value as Report;
  if (report?.contract !== STAR_UNIT_STATUS_CONTRACT || !Array.isArray(report.units)) throw new Error('The camera reading did not load.');
  return report as Reading;
}

/**
 * The COS Board screen inside Fleet. It draws the camera feed Fleet already
 * holds and is counted by the shared count's own unit list, so its tiles are a
 * split of the Fleet headline and never a second count.
 */
export default function CosBoardLanding({feed, recorderRows, now, fieldMap, routers, upload, addresses, onFeed, onReady}: CosBoardLandingProps) {
  const host = useRef<HTMLDivElement>(null), board = useRef<Board | null>(null);
  const deliver = useRef(onFeed);
  deliver.current = onFeed;
  const held = useRef(feed);
  held.current = feed;
  const ready = useRef(onReady);
  ready.current = onReady;
  const [flags, setFlags] = useState<BoardEditFlags | null>(null), [locked, setLocked] = useState(false);
  const writing = useRef(false);
  const data = useMemo(() => {
    const clock = cameraFeedClock(feed, now);
    const census = cameraFeedCensus(feed, recorderLinksFromHealth(recorderRows), clock, fieldMap) || [];
    return boardData({feed, census, now: clock, routers, upload, addresses});
  }, [feed, recorderRows, now, fieldMap, routers, upload, addresses]);
  // A full reading: the units go to Fleet, and it says whether this person may make hand fixes.
  const take = useRef((_reading: Reading) => {});
  take.current = reading => {
    held.current = reading.units;
    deliver.current(reading.units);
    setFlags({canEdit: reading.canEdit === true, handEditsRead: reading.handEditsRead === true});
  };
  // A save moves this on. A read that started before a save is older than what the save returned, so it is dropped.
  const generation = useRef(0);
  // One read at a time. A read that fails leaves the reading on screen as it is.
  const reading = useRef(false);
  const reread = useRef(async () => {});
  reread.current = async () => {
    if (reading.current || writing.current) return;
    reading.current = true;
    const started = generation.current;
    try {
      const result = checked((await api.get('/api/unit-camera-status')).data);
      if (started === generation.current) take.current(result);
    } catch { /* keep what is on screen */ } finally { reading.current = false; }
  };
  // One save at a time, each through the route Camera status uses. The board asks; this is the only place that sends.
  const fix = useRef(async (_unit: string, _steps: BoardFixStep[]): Promise<string> => 'Saved.');
  fix.current = async (unitKey, steps) => {
    if (writing.current) throw new Error('Another save is still in progress.');
    writing.current = true;
    let saved = 0;
    const notes: string[] = [];
    try {
      for (const step of steps) {
        const unit = held.current.find(row => row.unit === unitKey);
        if (!unit) throw new Error('COS is no longer reporting ' + unitKey + '.');
        generation.current += 1;
        const result = checked((await api.post('/api/unit-camera-status/edit', handFixRequest(unit, step, crypto.randomUUID()))).data);
        generation.current += 1;
        saved += 1;
        take.current(result);
        if (step.field === 'address' && step.value !== null && result.recorded?.pinned === false) {
          notes.push('The address is saved without a pin: ' + (result.recorded.pinNote || 'no location was found').replace(/[.\s]+$/, '') + '.');
        }
      }
      return ['Saved.', ...notes].join(' ');
    } catch (failure: any) {
      // What was saved cannot be assumed. Nothing more is saved until the person refreshes and looks.
      setLocked(true);
      const said = failure?.response?.data?.error || failure?.message || 'COS could not confirm the save.';
      throw new Error((saved ? saved + ' of ' + steps.length + ' changes were saved before this one failed. ' : '') + said + ' Tap Refresh before making another fix.');
    } finally { writing.current = false; }
  };
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    loadBoardFonts();
    const mounted: Board = mountCosBoard(element, {
      // The person asked for a new reading. A good one also lifts the hold a failed save left.
      onRefresh: async () => {
        if (writing.current) throw new Error('A save is still in progress.');
        const started = generation.current;
        const result = checked((await api.get('/api/unit-camera-status')).data);
        if (started !== generation.current) return;
        take.current(result);
        setLocked(false);
      },
      onEdit: (unitKey: string, steps: BoardFixStep[]) => fix.current(unitKey, steps),
      // Tech checks are their own screen in COS.
      onTechCheck: () => { window.location.hash = workspaceHash({workspace: 'Tech Check', jobId: '', detail: false}); },
    });
    board.current = mounted;
    // The board's own browser test reads the screen through this handle.
    Object.defineProperty(element, 'cosBoardRoot', {value: mounted.root, configurable: true});
    // Fleet keeps only the units from its own read. Read once more to learn whether this person may make hand fixes.
    void reread.current();
    ready.current?.();
    return () => { board.current = null; mounted.destroy(); };
  }, []);
  useEffect(() => { board.current?.update(data); }, [data]);
  useEffect(() => { board.current?.setEdit(boardEditState(flags, locked)); }, [flags, locked]);
  // Fleet reads the camera feed once when it opens. When Fleet moves on to a
  // newer reading, read the feed again, or every unit would age into Unknown.
  const readAt = useRef(now);
  useEffect(() => {
    if (readAt.current === now) return;
    readAt.current = now;
    const timer = window.setTimeout(() => { void reread.current(); }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [now]);
  // Star4Live is read every fifteen minutes. While this screen is in view, pick the new reading up without a tap.
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void reread.current(); }, REREAD_MS);
    return () => window.clearInterval(timer);
  }, []);
  return <div ref={host} className='cos-board-host'/>;
}
