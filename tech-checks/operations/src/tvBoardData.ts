import type { BoardCard, BoardScope, ReadinessRow } from './dailyBoardData';

export const TV_ROTATION_MS = 15000;
export const TV_REFRESH_MS = 60000;
export function tvBoardOptions(search: string) {
  const params = new URLSearchParams(search);
  return { enabled: params.get('tvBoard') === '1',
    scope: (params.get('tvScope') === 'week' ? 'week' : 'day') as BoardScope,
    department: ['it', 'service'].includes(params.get('tvDepartment') || '') ? params.get('tvDepartment')! : '' };
}

/** Share the authenticated host page, never the embedded app or a session URL. */
export function tvBoardLink(current: string, scope: BoardScope, department: string) {
  const url = new URL(current);
  url.pathname = url.pathname.replace(/operations\/dist\/index\.html$/, '');
  url.search = ''; url.hash = '';
  url.searchParams.set('tvBoard', '1');
  if (scope === 'week') url.searchParams.set('tvScope', 'week');
  if (['it', 'service'].includes(department)) url.searchParams.set('tvDepartment', department);
  return url.href;
}

export type TvLane = { name: string; cards: BoardCard[] };
export type TvPage = { kind: 'work'; lanes: TvLane[] } | { kind: 'readiness'; rows: ReadinessRow[] };
export function tvBoardPages(cards: BoardCard[], names: string[], readiness: ReadinessRow[], width: number, height: number): TvPage[] {
  const laneCount = width >= 1500 ? 3 : width >= 900 ? 2 : 1;
  const cardCount = height >= 900 ? 2 : 1;
  const lanes = [...new Set([...names, ...cards.map(card => card.assignee)])]
    .map(name => ({ name, cards: cards.filter(card => card.assignee === name) }))
    .filter(lane => lane.cards.length);
  const pages: TvPage[] = [];
  for (let index = 0; index < lanes.length; index += laneCount) {
    const group = lanes.slice(index, index + laneCount);
    const count = Math.max(...group.map(lane => Math.ceil(lane.cards.length / cardCount)));
    for (let part = 0; part < count; part++) {
      pages.push({ kind: 'work', lanes: group.map(lane => ({ name: lane.name, cards: lane.cards.slice(part * cardCount, (part + 1) * cardCount) })).filter(lane => lane.cards.length) });
    }
  }
  const readinessCount = height >= 900 ? laneCount * 2 : laneCount;
  for (let index = 0; index < readiness.length; index += readinessCount) pages.push({ kind: 'readiness', rows: readiness.slice(index, index + readinessCount) });
  return pages.length ? pages : [{ kind: 'work', lanes: [] }];
}
