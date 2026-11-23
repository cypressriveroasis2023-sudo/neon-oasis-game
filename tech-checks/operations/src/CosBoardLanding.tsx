import {useEffect, useMemo, useRef} from 'react';
import {api} from './api';
import {cameraFeedCensus, cameraFeedClock, recorderLinksFromHealth} from './sharedFleetCounts';
import {STAR_UNIT_STATUS_CONTRACT, type UnitCameraStatus} from '../shared/starUnitStatus';
import type {CameraRow} from './cameraEvidence';
import type {RouterRow} from '../../supabase/functions/cos-operations-pages/routers';
import type {MhelpAddressMapResult} from './mhelpAddressMapPins';
import {boardData} from './cosBoard/boardData';
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
};

type Board = {update(data: unknown): void; destroy(): void; root: ShadowRoot};

const REREAD_MS = 5 * 60 * 1000;
/** Fleet settles on its reading over a few quick steps as it opens. Wait for the last one. */
const SETTLE_MS = 1500;

async function readFeed(): Promise<UnitCameraStatus[]> {
  const report = (await api.get('/api/unit-camera-status')).data as {contract?: string; units?: UnitCameraStatus[]};
  if (report?.contract !== STAR_UNIT_STATUS_CONTRACT || !Array.isArray(report.units)) throw new Error('The camera reading did not load.');
  return report.units;
}

/**
 * The COS Board screen inside Fleet. It draws the camera feed Fleet already
 * holds and is counted by the shared count's own unit list, so its tiles are a
 * split of the Fleet headline and never a second count.
 */
export default function CosBoardLanding({feed, recorderRows, now, fieldMap, routers, upload, addresses, onFeed}: CosBoardLandingProps) {
  const host = useRef<HTMLDivElement>(null), board = useRef<Board | null>(null);
  const deliver = useRef(onFeed);
  deliver.current = onFeed;
  const data = useMemo(() => {
    const clock = cameraFeedClock(feed, now);
    const census = cameraFeedCensus(feed, recorderLinksFromHealth(recorderRows), clock, fieldMap) || [];
    return boardData({feed, census, now: clock, routers, upload, addresses});
  }, [feed, recorderRows, now, fieldMap, routers, upload, addresses]);
  // One read at a time. A read that fails leaves the reading on screen as it is.
  const reading = useRef(false);
  const reread = useRef(async () => {});
  reread.current = async () => {
    if (reading.current) return;
    reading.current = true;
    try { deliver.current(await readFeed()); } catch { /* keep what is on screen */ } finally { reading.current = false; }
  };
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    loadBoardFonts();
    const mounted: Board = mountCosBoard(element, {onRefresh: async () => { deliver.current(await readFeed()); }});
    board.current = mounted;
    // The board's own browser test reads the screen through this handle.
    Object.defineProperty(element, 'cosBoardRoot', {value: mounted.root, configurable: true});
    return () => { board.current = null; mounted.destroy(); };
  }, []);
  useEffect(() => { board.current?.update(data); }, [data]);
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
