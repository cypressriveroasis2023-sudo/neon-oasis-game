import { workspaceGroups, workspaceLabel } from './workspaceNavigation';
export default function OperationsAreas({ navigate }: { navigate(workspace: string): void }) {
  return <section className='operations-directory' aria-label='Operations workspaces'>
    {workspaceGroups.filter(group => group.label !== 'Equipment' && group.label !== 'Team').map(group => <section className='panel' key={group.label}><h2>{group.label}</h2><div className='operations-directory-links'>{group.items.filter(name => !['Today','Operations'].includes(name)).map(name => <button className='secondary' key={name} onClick={() => navigate(name)}>{workspaceLabel(name)}</button>)}</div></section>)}
    <section className='panel'><h2>Manage equipment &amp; people</h2><div className='operations-directory-links'>{['Equipment', 'Owner Tasks'].map(name => <button className='secondary' key={name} onClick={() => navigate(name)}>{workspaceLabel(name)}</button>)}</div></section>
  </section>;
}
