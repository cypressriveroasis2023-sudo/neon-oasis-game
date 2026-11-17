import {useState} from 'react';
import type {FamilyHealthCard, TodayAudience, TodayIssue, TodayIssuesModel} from './todayIssues';
import {checklistRows} from './todayIssues';

type Counts = { up: number | string; down: number | string; unknown: number | string };

function actionLabel(issue: TodayIssue): string {
  if (issue.kind === 'address') return 'Fix address in mHelpDesk';
  if (issue.kind === 'device_link') return 'Link camera';
  if (issue.kind === 'no_reading') return 'Refresh reading';
  return 'Open unit';
}

/** First screen: small counts, then one line per job with one real action. */
export default function TodayIssues({model, counts, blocker, families = [], role = 'owner', onOpen, onRefresh, onLink, onOpenMhelp}:{
  model: TodayIssuesModel;
  counts?: Counts;
  blocker?: string | null;
  families?: FamilyHealthCard[];
  role?: TodayAudience;
  onOpen?: (issue: TodayIssue) => void;
  onRefresh?: () => void;
  onLink?: (issue: TodayIssue) => void;
  onOpenMhelp?: (issue: TodayIssue) => void;
}) {
  const [done, setDone] = useState<string[]>([]);
  const [openGroup, setOpenGroup] = useState(false);
  const rows = checklistRows(model.issues.filter(issue => !done.includes(issue.id)));
  const act = (issue: TodayIssue) => {
    if (issue.kind === 'address' && issue.productId) onOpenMhelp?.(issue);
    else if (issue.kind === 'device_link') onLink?.(issue);
    else if (issue.kind === 'no_reading') onRefresh?.();
    else onOpen?.(issue);
  };
  const line = (issue: TodayIssue) => <li key={issue.id} className='cos-check-line'>
    <span>{issue.line}</span>
    {(issue.kind !== 'address' || issue.productId) && <button type='button' onClick={() => act(issue)}>{actionLabel(issue)}</button>}
    <button type='button' onClick={() => setDone(current => [...current, issue.id])}>Check off</button>
  </li>;
  return <section className='cos-today-issues' aria-label="Today's issues">
    {counts && <p className='cos-check-counts' role='group' aria-label='Field units up, down and unknown'>
      <span>Up <b>{counts.up}</b></span>
      <span>Down <b>{counts.down}</b></span>
      <span>Unknown <b>{counts.unknown}</b></span>
    </p>}
    <h2>To do</h2>
    {blocker && <p className='cos-check-blocker'>{blocker}</p>}
    {rows.length === 0 && !blocker ? <p>{model.empty || 'No issues right now'}</p> : <ul>
      {rows.map(row => row.kind === 'item' ? line(row.issue) : <li key={row.id} className='cos-check-group'>
        <button type='button' aria-expanded={openGroup} onClick={() => setOpenGroup(open => !open)}>{row.line}</button>
        {openGroup && <ul>{row.items.map(line)}</ul>}
      </li>)}
    </ul>}
  </section>;
}

export function FamilyCards({families}:{families: FamilyHealthCard[]}) {
  return <>{families.map(card => <section key={card.id} className='cos-family-card' aria-label={card.label+' field cameras'}>
    <h3>{card.label}</h3>
    <p><b>{card.online}</b> online · <b>{card.offline}</b> offline · <b>{card.unknown}</b> unknown</p>
    {card.notes?.map(note => <p key={note}>{note}</p>)}
    {card.batteries?.map(battery => <p key={battery.name}>{battery.name} — battery {battery.percent}%</p>)}
    {card.deviceLinks?.map(unit => <p key={unit}>{unit} — device link needed</p>)}
    {card.issues.length ? <ul>{card.issues.map(issue => <li key={issue.id}>{issue.line}</li>)}</ul> : <p>No {card.label} issues on this board.</p>}
  </section>)}</>;
}
