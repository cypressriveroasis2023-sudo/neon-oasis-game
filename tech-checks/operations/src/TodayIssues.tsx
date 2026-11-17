import {useState} from 'react';
import IssueGuide from './IssueGuide';
import type {FamilyHealthCard, TodayAudience, TodayIssue, TodayIssuesModel} from './todayIssues';

/** First card on the board. One count, one line per issue, then the fix guide. */
export default function TodayIssues({model, families = [], role = 'owner', onOpen, onRefresh, onLink, onConfirmShop, onOpenMhelp, onEscalate, addressFor}:{
  model: TodayIssuesModel;
  families?: FamilyHealthCard[];
  role?: TodayAudience;
  onOpen?: (issue: TodayIssue) => void;
  onRefresh?: () => void;
  onLink?: (issue: TodayIssue) => void;
  onConfirmShop?: (issue: TodayIssue) => void;
  onOpenMhelp?: (issue: TodayIssue) => void;
  onEscalate?: (issue: TodayIssue) => void;
  addressFor?: (issue: TodayIssue) => string | undefined;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const selected = model.issues.find(issue => issue.id === openId) || null;
  return <section className='cos-today-issues' aria-label="Today's issues">
    <h2>Today's issues</h2>
    <p className='cos-today-issues-count'><b>{model.empty ? '' : model.count}</b>{model.empty || model.headline}</p>
    {model.issues.length > 0 && <ul>
      {model.issues.map(issue => <li key={issue.id}>
        <button type='button' aria-pressed={issue.id === openId} onClick={() => { setOpenId(issue.id); onOpen?.(issue); }}>{issue.line}</button>
      </li>)}
    </ul>}
    {selected && <IssueGuide issue={selected} role={role} address={addressFor?.(selected)} onRefresh={onRefresh} onLink={() => onLink?.(selected)} onConfirmShop={() => onConfirmShop?.(selected)} onOpenMhelp={() => onOpenMhelp?.(selected)} onEscalate={() => onEscalate?.(selected)} />}
    {families.map(card => <section key={card.id} className='cos-family-card' aria-label={card.label+' field cameras'}>
      <h3>{card.label}</h3>
      <p><b>{card.online}</b> online · <b>{card.offline}</b> offline · <b>{card.unknown}</b> unknown</p>
      {card.notes?.map(note => <p key={note}>{note}</p>)}
      {card.batteries?.map(battery => <p key={battery.name}>{battery.name} — battery {battery.percent}%</p>)}
      {card.deviceLinks?.map(unit => <p key={unit}>{unit} — device link needed</p>)}
      {card.issues.length ? <ul>{card.issues.map(issue => <li key={issue.id}>{issue.line}</li>)}</ul> : <p>No {card.label} issues on this board.</p>}
    </section>)}
  </section>;
}
