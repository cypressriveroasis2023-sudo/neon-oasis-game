import { AreaIcon } from './VisionAreas';
import './homeFieldView.css';

export default function HomeFieldView({ open }: { open: () => void }) {
  return <section className='home-field-view' aria-label='Field View shortcut'>
    <button type='button' onClick={open} aria-label='Field View'>
      <AreaIcon name='map'/>
      <span><strong>Field View</strong><small>Open the field map and unit health</small></span>
      <span className='home-field-view-arrow' aria-hidden='true'>→</span>
    </button>
  </section>;
}
