import FleetCountReadout from './FleetCountReadout';
import type {CameraStatusBoard} from '../shared/shopCameraStatus';

/** Header the page and the rule-off test both render. Detail adds the groups and attention list. */
export default function CameraStatusBoardView({board, detail = false}: {board: CameraStatusBoard<{unit: string}>; detail?: boolean}) {
  return <div className='cos-camera-status-board'>
    <FleetCountReadout units={board.headline.units} cameras={board.headline.cameras}/>
    {board.shop && <p className='cos-camera-monitor-figures' aria-label='Camera monitoring figures'>
      <span>Field <b>{board.shop.field}</b></span>
      {board.shop.armed !== null && <span>Armed <b>{board.shop.armed}</b></span>}
      {board.shop.immix !== null && <span>Immix <b>{board.shop.immix}</b></span>}
      <span>In shop <b>{board.shop.inShop}</b></span>
      {board.lines.some(line => line.label === 'Shop, DO NOT USE' && line.text.endsWith('· —')) && <span>Shop, DO NOT USE <b>—</b></span>}
      {board.shop.doNotUse !== null && <span>Shop, DO NOT USE <b>{board.shop.doNotUse}</b></span>}
      {board.lines.some(line => line.label === 'Exceptions' && line.text.endsWith('· —')) && <span>Exceptions <b>—</b></span>}
      {board.shop.exceptions !== null && <span>Exceptions <b>{board.shop.exceptions}</b></span>}
    </p>}
    {board.lines.map(line => <p key={line.label} className='cos-camera-category-line' aria-label={line.label}>{line.text}</p>)}
    {detail && <nav aria-label='Camera status groups'>{board.groups.map(group => <button key={group.id} type='button'>{group.label}<b>{group.count}</b></button>)}</nav>}
    {detail && <ul aria-label='Needs attention units'>{board.attention.map(unit => <li key={unit}>{unit}</li>)}</ul>}
  </div>;
}
