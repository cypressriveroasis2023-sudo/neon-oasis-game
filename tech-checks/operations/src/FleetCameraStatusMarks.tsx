/**
 * Status words and camera squares for the fleet board.
 * This component is the reuse seam next to fleetCameraStatusRead: it has no
 * route, session, or role check. The owner/IT shell only mounts it.
 */
import type {CameraMark} from './fleetCameraStatusRead';

export function CameraMarks({cameras, stale}: {cameras: readonly {state: CameraMark}[]; stale: boolean}) {
  return <span className='cos-board-cams' aria-hidden='true'>{cameras.map((camera, index) => (
    <i key={index} data-camera-state={stale ? 'unknown' : camera.state} className={'cos-board-cam is-' + (stale ? 'unknown' : camera.state)}/>
  ))}</span>;
}

export function StatusWord({state, stale, cameraDown = false}: {state: CameraMark | 'shop'; stale: boolean; cameraDown?: boolean}) {
  if (state === 'shop') return <span className='cos-board-status is-shop' data-status='shop'>In shop</span>;
  if (stale || state === 'unknown') return <span className='cos-board-status is-unknown' data-status='unknown'>Unknown</span>;
  if (cameraDown && state === 'up') return <span className='cos-board-status is-down' data-status='camera-down'>Camera down</span>;
  if (state === 'down') return <span className='cos-board-status is-down' data-status='offline'>Offline</span>;
  return <span className='cos-board-status is-up' data-status='online'>Online</span>;
}
