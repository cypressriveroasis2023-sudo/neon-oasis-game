/** The one delayed line on the existing Fleet screen. */
export default function UpdatesDelayedLine({line}:{line:string|null}) {
  if (!line) return null;
  return <p className='cos-updates-delayed' role='status' style={{margin:'0 0 12px',color:'#8b97a8',fontSize:13,fontWeight:700}}>{line}</p>;
}
