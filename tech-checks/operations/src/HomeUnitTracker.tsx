import {trackerAccess} from './unitTracker';
import './unitTracker.css';
export default function HomeUnitTracker({session,open}:{session:unknown;open:()=>void}){return trackerAccess(session)?<section className='home-unit-tracker' aria-label='Home Unit Tracker'><div><h2>Unit Tracker</h2><p>Review your units and save additions or updates for the 2027 tracker.</p></div><button type='button' onClick={open}>Open Unit Tracker</button></section>:null;}
