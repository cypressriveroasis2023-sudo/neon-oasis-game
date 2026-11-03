import ApprovedBoardUnitLink from './ApprovedBoardUnitLink';
import type {BoardCard} from './dailyBoardData';
import {boardDateLabel} from './dailyBoardData';
import {boardRecordDetail,boardRecordTime} from './boardRecordDetails';
import {workspaceHash} from './workspaceNavigation';
import './boardRecordDetails.css';

type Props = {
  card: BoardCard & {detailAsOf: string | null};
  sourceUnavailable: boolean;
  close: () => void;
};

/** Read-only detail presentation inside the existing authenticated Board dialog. */
export default function BoardRecordDetails({card,sourceUnavailable,close}: Props) {
  const detail = boardRecordDetail(card);
  const jobHref = detail.jobId ? workspaceHash({workspace:'Jobs',jobId:detail.jobId,detail:false}) : null;
  return <div className='cos-board-record' aria-label='Saved work record'>
    <div className='cos-board-record-snapshot' role='status'>
      <strong>{sourceUnavailable?'Board refresh is unavailable or delayed.':'Opened record snapshot'}</strong>
      <span>{boardRecordTime(card.detailAsOf)}</span>
      <small>This panel keeps the record you opened. Close and reopen for newer details. This is not a camera check time.</small>
    </div>
    <dl className='cos-board-record-facts'>
      <div><dt>{detail.responsibleLabel}</dt><dd>{detail.responsible}</dd></div>
      <div><dt>Workflow status</dt><dd>{card.status || 'Not supplied'}</dd></div>
      <div><dt>{card.kind==='task'?'Recorded due date':'Recorded schedule'}</dt><dd>{boardDateLabel(card.date)}</dd></div>
      {card.kind==='job'&&<><div><dt>Job type</dt><dd>{detail.jobType || 'Not supplied'}</dd></div><div><dt>Equipment model</dt><dd>{detail.equipment || 'Not supplied'}</dd></div></>}
      <div><dt>{detail.equipmentLabel}</dt><dd>{detail.equipmentTag || 'Not supplied'}</dd></div>
    </dl>
    <ApprovedBoardUnitLink card={card} sourceUnavailable={sourceUnavailable} close={close}>
    <section className='cos-board-record-unit' aria-label='Unit link availability'>
      <h4>Unit not linked</h4>
      <p>This board response does not supply a verified unit ID. The equipment tag alone cannot open an exact unit.</p>
      <small>No camera status, last camera check or map location is inferred from this work record.</small>
    </section>
    </ApprovedBoardUnitLink>
    <section className='cos-board-record-next' aria-label='Recorded next step'>
      <h4>Next step</h4>
      {detail.instructions?<><small>Recorded task instructions — not a new progress update</small><p>{detail.instructions}</p></>:<p>No next step is recorded in this board response. Review the existing job and saved notes.</p>}
      <small>Service jobs are created in mHelp. This view does not create a ticket.</small>
    </section>
    {card.kind==='job'?<details className='cos-board-record-history'>
      <summary>{detail.historyLabel}{!detail.notesUnavailable?' ('+detail.notes.length+')':''}</summary>
      {detail.notesUnavailable?<p>Saved notes are unavailable in this response.</p>:!detail.notes.length?<p>No readable saved notes in this response.</p>:<ol>{detail.notes.map(note=><li key={note.key}><p>{note.text}</p><small>{note.author} · {boardRecordTime(note.at)}</small></li>)}</ol>}
      {detail.omittedNotes>0&&<p>Some note entries could not be displayed because their text is missing or invalid.</p>}
    </details>:<section className='cos-board-record-history' aria-label='Recorded task information'>
      <h4>Task record</h4>
      {detail.ownerNotes?<><small>Owner notes · note time not supplied</small><p>{detail.ownerNotes}</p></>:<p>No Owner notes supplied.</p>}
      <dl><div><dt>Recorded start</dt><dd>{boardRecordTime(detail.startedAt)}</dd></div><div><dt>Recorded completion</dt><dd>{boardRecordTime(detail.completedAt)}</dd></div></dl>
    </section>}
    {detail.completedVisit&&<p className='cos-board-record-visit'>Visit completed: {boardRecordTime(detail.completedAt)}. Equipment and job notes above belong to the current job snapshot, not verified historical visit evidence.</p>}
    {jobHref?<a className='cos-board-record-link' href={jobHref} onClick={close}>{detail.jobLinkLabel} <span aria-hidden='true'>→</span></a>:<p className='cos-board-record-link-missing'>An exact job link is not available. The original workspace remains accessible below.</p>}
  </div>;
}
