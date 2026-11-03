import type {ReactNode} from 'react';
import {approvedBoardUnitTarget,type BoardUnitSelection} from './approvedBoardUnitLink';
import {boardRecordTime} from './boardRecordDetails';

type Props={card:BoardUnitSelection;sourceUnavailable:boolean;close:()=>void;children:ReactNode};

/** Conditional presentation only; original unlinked explanation is retained as children. */
export default function ApprovedBoardUnitLink({card,sourceUnavailable,close,children}:Props){
  const target=approvedBoardUnitTarget(card,sourceUnavailable);
  if(!target)return <>{children}</>;
  return <section className='cos-board-record-unit' aria-label='Unit link availability'>
    <h4>{target.completedVisit?'Current job unit':'Linked unit'}</h4>
    <p>Product ID: {target.productId}</p>
    <small>Product identity evidence: {boardRecordTime(target.observedAt)}. This is not a camera check time.</small>
    <p>{target.completedVisit?'Opens the current job equipment, not verified equipment from this completed visit.':'Opens the saved unit in Fleet. Location, history and camera information stay in the existing unit view.'}</p>
    <a className='cos-board-record-link' href={target.href} onClick={close}>{target.completedVisit?'Open current job unit':'Open unit'} <span aria-hidden='true'>→</span></a>
  </section>;
}
