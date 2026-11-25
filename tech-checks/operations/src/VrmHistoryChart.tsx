import type {HistoryPoint} from './vrmHistory';

/** Battery % (line) and solar W (shaded) over the last 24 hours. Gaps over an hour are left as gaps. */
export default function VrmHistoryChart({points, now}: {points: HistoryPoint[]; now: number}) {
  const W = 320, H = 120, padTop = 8, padBottom = 18;
  const end = now / 1000, start = end - 24 * 3600;
  const x = (t: number) => ((t - start) / (end - start)) * W;
  const ySoc = (v: number) => padTop + (1 - v / 100) * (H - padTop - padBottom);
  const solarMax = Math.max(100, ...points.map(p => p[2] ?? 0));
  const ySolar = (v: number) => padTop + (1 - v / solarMax) * (H - padTop - padBottom);
  const runs = (index: 1 | 2) => {
    const out: HistoryPoint[][] = [];
    let run: HistoryPoint[] = [];
    for (const p of points) {
      if (p[index] === null) continue;
      if (run.length && p[0] - run[run.length - 1][0] > 3600) { out.push(run); run = []; }
      run.push(p);
    }
    if (run.length) out.push(run);
    return out;
  };
  const socPaths = runs(1).map(run => run.map((p, i) => (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + ySoc(p[1] as number).toFixed(1)).join(' '));
  const solarPaths = runs(2).filter(run => run.length > 1).map(run => 'M' + x(run[0][0]).toFixed(1) + ' ' + (H - padBottom) + ' ' +
    run.map(p => 'L' + x(p[0]).toFixed(1) + ' ' + ySolar(p[2] as number).toFixed(1)).join(' ') + ' L' + x(run[run.length - 1][0]).toFixed(1) + ' ' + (H - padBottom) + ' Z');
  const last = [...points].reverse().find(p => p[1] !== null);
  return <figure className='vrm-history-chart'>
    <svg viewBox={'0 0 ' + W + ' ' + H} role='img' aria-label={'Battery and solar over the last 24 hours' + (last ? ', battery now ' + Math.round(last[1] as number) + '%' : '')}>
      {[0, 50, 100].map(v => <g key={v}><line x1={0} x2={W} y1={ySoc(v)} y2={ySoc(v)} className='vrm-hc-grid'/><text x={W - 2} y={ySoc(v) - 2} textAnchor='end' className='vrm-hc-label'>{v}%</text></g>)}
      <line x1={0} x2={W} y1={ySoc(30)} y2={ySoc(30)} className='vrm-hc-low'/>
      {solarPaths.map((d, i) => <path key={'s' + i} d={d} className='vrm-hc-solar'/>)}
      {socPaths.map((d, i) => <path key={'b' + i} d={d} className='vrm-hc-soc'/>)}
      <text x={0} y={H - 4} className='vrm-hc-label'>24 h ago</text>
      <text x={W / 2} y={H - 4} textAnchor='middle' className='vrm-hc-label'>12 h</text>
      <text x={W} y={H - 4} textAnchor='end' className='vrm-hc-label'>now</text>
    </svg>
    <figcaption><span className='vrm-hc-key vrm-hc-key-soc'>Battery %</span><span className='vrm-hc-key vrm-hc-key-solar'>Solar (peak {Math.round(solarMax)} W)</span><span className='vrm-hc-key vrm-hc-key-low'>30% line</span></figcaption>
  </figure>;
}
