import {trackerAccess} from './unitTracker';
import './unitTracker.css';
export default function HomeUnitTracker({session,open}:{session:unknown;open:()=>void}){return trackerAccess(session)?<section className='home-unit-tracker' aria-label='Home Unit Tracker'><div><h2>Unit Tracker</h2><p>Find units and review their 2027 tracker information.</p></div><button type='button' onClick={open}>Open Unit Tracker</button></section>:null;}
