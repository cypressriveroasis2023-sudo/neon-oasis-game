import { AreaIcon } from './VisionAreas';
import './homeFieldView.css';

export default function HomeFieldView({ open }: { open: () => void }) {
  return <section className='home-field-view' aria-label='Fleet Dashboard shortcut'>
    <button type='button' onClick={open} aria-label='Fleet Dashboard'>
      <AreaIcon name='map'/>
      <span><strong>Fleet Dashboard</strong><small>Open the map, fleet health and location verification</small></span>
      <span className='home-field-view-arrow' aria-hidden='true'>→</span>
    </button>
  </section>;
}
