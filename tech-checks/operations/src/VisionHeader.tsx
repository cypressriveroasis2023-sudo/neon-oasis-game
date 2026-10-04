import { useState } from 'react';

export const visionGroups = [
  { name: 'Today', home: 'Today', pages: ['Today', 'Daily Board', 'Owner Tasks'] },
  { name: 'Jobs', home: 'Jobs', pages: ['Jobs', 'Unscheduled', 'Dispatch', 'Owner Review', 'Calendar', 'Handoffs', 'Customers', 'Sites'] },
  { name: 'Team', home: 'Team', pages: ['Team', 'Tech Check'] },
  { name: 'Units', home: 'Equipment', pages: ['Equipment', 'Field Map', 'Camera Health'] },
  { name: 'Money', home: 'Billing', pages: ['Billing', 'Quotes', 'Invoices', 'Purchasing'] },
];
export default function VisionHeader({ active, navigate, now, connected, checking, classic, allTools }: {
  active: string; navigate: (name: string) => void; now: Date; connected: boolean;
  checking: boolean; classic: () => void; allTools: () => void;
}) {
  const [options, setOptions] = useState(false);
  const group = visionGroups.find(item => item.pages.includes(active));
  const date = (options: Intl.DateTimeFormatOptions) => now.toLocaleString('en-US', { timeZone: 'America/Chicago', ...options });
  return <header className='vision-header'>
    <div className='vision-wordmark' aria-label='Vision by Cameras Onsite'>
      <div aria-hidden='true'><span>VISI</span><span className='vision-letter-eye'><img src={import.meta.env.BASE_URL + 'resources/vision-approved-eye.jpeg'} alt=''/></span><span>N</span></div>
      <p>CAMERAS ONSITE</p>
    </div>
    <div className='vision-clock' aria-label='Current date and time in Central Time'>
      <div><small>CENTRAL TIME</small><time dateTime={now.toISOString()}>{date({ hour: 'numeric', minute: '2-digit' })}</time></div>
      <div><small>{date({ weekday: 'long' })} · {date({ year: 'numeric' })}</small><strong>{date({ month: 'short', day: '2-digit' })}</strong></div>
    </div>
    <nav className='vision-primary-nav' aria-label='Vision main sections'>{visionGroups.map(item => <button key={item.name} type='button' aria-current={group?.name === item.name ? 'page' : undefined} onClick={() => navigate(item.home)}>{item.name}</button>)}</nav>
    <nav className='vision-workspace-nav' aria-label='Workspaces in this section'>{group?.pages.map(name => <button type='button' key={name} aria-current={active === name ? 'page' : undefined} onClick={() => navigate(name)}>{name === 'Equipment' ? 'Unit directory' : name === 'Unscheduled' ? 'Schedule visits' : name}</button>)}</nav>
    <p className='vision-preview-note'>Vision interface preview · existing Operations records</p>
    <div className='vision-access'><span role='status'>{connected ? 'Connected to COS Operations' : checking ? 'Verifying account…' : 'Account verification required'}</span><button type='button' aria-expanded={options} onClick={() => setOptions(value => !value)}>Options</button></div>
    {options && <div className='vision-options'><p>Vision interface preview · uses your existing account and live Operations records.</p><button type='button' onClick={classic}>Use classic layout</button><button type='button' onClick={allTools}>All existing tools</button></div>}
  </header>;
}
