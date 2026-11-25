import {useEffect, useMemo, useRef, useState} from 'react';
import {api, openLegacy} from './api';
import {cameraFeedCensus, cameraFeedClock, recorderLinksFromHealth} from './sharedFleetCounts';
import {STAR_UNIT_STATUS_CONTRACT, type UnitCameraStatus} from '../shared/starUnitStatus';
import type {CameraRow} from './cameraEvidence';
import type {RouterRow} from '../../supabase/functions/cos-operations-pages/routers';
import type {MhelpAddressMapResult} from './mhelpAddressMapPins';
import {workspaceHash} from './workspaceNavigation';
import {setBoardSessionHold} from './tvSessionHold';
import {boardData} from './cosBoard/boardData';
import {boardPowerByUnit, type BoardPower} from './cosBoard/boardPower';
import {heliosSpots, readSunForecast, sunOutlook, type OutlookDay, type SunDay} from './vrmWeather';
import {getVrmFleet} from './vrmFleetApi';
import {readVrmHistory, type HistoryPoint} from './vrmHistory';
import {boardEditState, handFixRequest, type BoardEditFlags, type BoardEditState, type BoardFixStep} from './cosBoard/boardEdit';
import {mountCosBoard} from './cosBoard/boardApp';
import {loadBoardFonts} from './cosBoard/boardFonts';
import {managerHost, managerKnown, managerPhoto, readManager, rememberManager, saveTruck, takeBoardView, type TruckKit} from './managerBridge';

/**
 * Tells the page around the frame that the board is, or is no longer, the TV display, so it gives the frame the
 * whole window and takes it back afterwards. It is the message the older TV display sends.
 */
function showTv(on: boolean) {
  if (window.parent === window || window.location.origin === 'null') return;
  window.parent.postMessage({type: 'COS_TV_BOARD_DISPLAY_MODE', active: on}, window.location.origin);
}

export type CosBoardLandingProps = {
  /** The camera feed the shared count reads. Until it arrives the board shows its own "loading" line. */
  feed: UnitCameraStatus[] | null;
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
  /** Called when the board was opened ahead of the camera feed and the feed then could not be read. */
  onNone?: () => void;
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
export default function CosBoardLanding({feed, recorderRows, now, fieldMap, routers, upload, addresses, onFeed, onReady, onNone}: CosBoardLandingProps) {
  const host = useRef<HTMLDivElement>(null), board = useRef<Board | null>(null), tvOn = useRef(false), tvKeep = useRef(0);
  const deliver = useRef(onFeed);
  deliver.current = onFeed;
  const held = useRef(feed);
  held.current = feed;
  const ready = useRef(onReady);
  ready.current = onReady;
  const none = useRef(onNone);
  none.current = onNone;
  const [flags, setFlags] = useState<BoardEditFlags | null>(null), [locked, setLocked] = useState(false);
  const writing = useRef(false);
  // Victron power for the Helios cards: the saved fleet reading the Victron Power page shows. Never triggers a
  // Victron sync; a failed read keeps the last reading, and readings older than 30 minutes draw grey.
  const [vrm, setVrm] = useState<{data: unknown; at: number} | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => { getVrmFleet(api).then(response => { if (live) setVrm({data: response.data, at: Date.now()}); }).catch(() => {}); };
    read();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') read(); }, REREAD_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, []);
  // Saved Victron history (best-effort, every 15 minutes): last night's low and history flags on Helios cards.
  const [history, setHistory] = useState<Map<number, HistoryPoint[]> | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => { void readVrmHistory().then(units => { if (live && units) setHistory(new Map(units.map(u => [u.installationId, u.points]))); }); };
    read();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') read(); }, 15 * 60 * 1000);
    const drop = () => setHistory(null);
    window.addEventListener('cos-private-data-invalidated', drop);
    return () => { live = false; window.clearInterval(timer); window.removeEventListener('cos-private-data-invalidated', drop); };
  }, []);
  // Sun forecast for Field Helios sites (best-effort, every 3 hours): "cloudy days ahead" on Helios cards. Nothing is stored.
  const [sky, setSky] = useState<Map<string, SunDay[]> | null>(null);
  const spots = useMemo(() => {
    const m = fieldMap as {inventoryItems?: unknown; items?: unknown} | null | undefined;
    return heliosSpots(Array.isArray(m?.inventoryItems) ? m.inventoryItems : Array.isArray(m?.items) ? m.items : null);
  }, [fieldMap]);
  const spotsKey = [...spots].map(([k, v]) => k + '@' + v.lat + ',' + v.lon).join(';');
  useEffect(() => {
    if (!spotsKey) return;
    let live = true;
    const read = () => { void readSunForecast(spots).then(map => { if (live && map) setSky(map); }); };
    read();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') read(); }, 3 * 3600 * 1000);
    return () => { live = false; window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotsKey]);
  const weather = useMemo(() => {
    const out = new Map<string, OutlookDay[]>();
    if (sky) for (const [key, days] of sky) { const o = sunOutlook(days, now); if (o.length) out.set(key, o); }
    return out;
  }, [sky, now]);
  const power = useMemo<Map<string, BoardPower> | null>(() => vrm ? boardPowerByUnit(vrm.data, Math.max(vrm.at, now), history, weather) : null, [vrm, now, history, weather]);
  const data = useMemo(() => {
    if (!feed) return null;
    const clock = cameraFeedClock(feed, now);
    const census = cameraFeedCensus(feed, recorderLinksFromHealth(recorderRows), clock, fieldMap) || [];
    return boardData({feed, census, now: clock, routers, upload, addresses, power});
  }, [feed, recorderRows, now, fieldMap, routers, upload, addresses, power]);
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
    } catch {
      // With a reading on screen, keep it. With none, there is no board to show: say so, and Fleet shows as before.
      if (!held.current) none.current?.();
    } finally { reading.current = false; }
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
        const unit = held.current?.find(row => row.unit === unitKey);
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
      // An IT sign-in keeps its tech checks in the Tech Check app around this frame, so the tab opens them there.
      // James: "i clicked tech check on the IT board and it is showing return to my IT tech checks."
      onTechCheck: (manager?: boolean) => {
        // An IT sign-in keeps its checks in the Tech Check app around this frame. The board knows an IT sign-in by
        // its refused manager read, and hands it straight there instead of the app screen that only pointed back.
        if (manager === false) { openLegacy('it'); return; }
        window.location.hash = workspaceHash({workspace: 'Tech Check', jobId: '', detail: false});
      },
      // The board is the screen James works from, so the other COS screens open from it, not only from More.
      onScreen: (workspace: string) => { window.location.hash = workspaceHash({workspace, jobId: '', detail: false}); },
      // The owner's manager view. The signed-in Tech Check app around this frame reads the trucks, inspections and
      // handoffs; the board only draws them. A sign-in with no manager view never gets an answer, and never a tab.
      manager: managerHost() ? {
        read: (fresh: boolean) => readManager(fresh, true),
        save: (techId: string, kit: TruckKit) => saveTruck(techId, kit),
        photo: (path: string) => managerPhoto(path),
        open: (route: string) => openLegacy(route),
        known: (shown: boolean) => rememberManager(shown),
        wasKnown: () => managerKnown(),
      } : undefined,
      // Tech Check sends the owner here to the manager view, and Boards sends anyone here to the TV board.
      startView: takeBoardView(),
      // The TV board is the board itself, drawn large. The app around the frame is told so it clears its own chrome,
      // and the session is held through a silent re-login the way the older TV display held it.
      onTv: (on: boolean) => {
        tvOn.current = on; showTv(on);
        // The older map on this page hands the window back when it loads, whenever that is. While the TV is up it is asked for again.
        window.clearInterval(tvKeep.current);
        if (on) tvKeep.current = window.setInterval(() => { if (tvOn.current) showTv(true); }, 3000);
      },
    });
    board.current = mounted;
    // The board's own browser test reads the screen through this handle.
    Object.defineProperty(element, 'cosBoardRoot', {value: mounted.root, configurable: true});
    // Fleet keeps only the units from its own read. Read once more to learn whether this person may make hand fixes.
    void reread.current();
    ready.current?.();
    return () => { board.current = null; mounted.destroy(); window.clearInterval(tvKeep.current); if (tvOn.current) { tvOn.current = false; showTv(false); } };
  }, []);
  // While the board is up, a sign-in hiccup refreshes quietly instead of dropping it.
  useEffect(() => { setBoardSessionHold(true); return () => setBoardSessionHold(false); }, []);
  useEffect(() => { if (data) board.current?.update(data); }, [data]);
  // COS has a bar across the bottom of a phone. Tell the board how much room it takes, so its messages sit above it.
  useEffect(() => {
    const element = host.current, bar = document.querySelector('.operations-bottom-nav');
    if (!element) return;
    const measure = () => {
      const box = bar instanceof HTMLElement ? bar.getBoundingClientRect() : null;
      const shown = box && box.height > 0 && box.bottom >= window.innerHeight - 1;
      element.style.setProperty('--cos-board-clear', (shown ? Math.max(0, Math.round(window.innerHeight - box.top)) : 0) + 'px');
    };
    measure();
    window.addEventListener('resize', measure);
    const watch = bar && typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (bar) watch?.observe(bar);
    return () => { window.removeEventListener('resize', measure); watch?.disconnect(); };
  }, []);
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
