import {useEffect,useState} from 'react';
import {unitDiagnosticsPath} from './fieldCameraHealth';
import {unitDiagnosticReport,unitDiagnosticFilename,unitDiagnosticNextStep,type UnitDiagnosticInput} from './unitDiagnosticReport';

export default function UnitDiagnosticReport(props:UnitDiagnosticInput){
  const text=unitDiagnosticReport(props),[notice,setNotice]=useState(''),[copying,setCopying]=useState(false);
  const path=unitDiagnosticsPath(props.unit);
  useEffect(()=>{setNotice('');},[props.unit.id,text]);
  const copy=async()=>{
    if(copying)return;setCopying(true);
    try{await navigator.clipboard.writeText(text);setNotice('Report copied. Review it before sharing.');}
    catch{setNotice('Clipboard unavailable. Select the report text below or download the text file.');}
    finally{setCopying(false);}
  };
  const download=()=>{
    const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=unitDiagnosticFilename(props.unit);link.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('Text report downloaded. Review it before sharing.');
  };
  return <section className='unit-diagnostic-report' aria-label='Unit diagnostic report'>
    <h4>Diagnostic report for team follow-up</h4>
    <p>{unitDiagnosticNextStep(props)}</p>
    <p>Copy or download a plain-text report for COS or mHelpDesk. It includes saved source results and history. It does not run checks or send a ticket.</p>
    <div className='unit-diagnostic-actions'><button type='button' disabled={copying} onClick={()=>void copy()}>Copy report</button><button type='button' className='secondary' onClick={download}>Download report</button>{path&&<a href={path} target='_blank' rel='noopener noreferrer'>Verify unit in diagnostics ↗</a>}</div>
    {notice&&<p role='status'>{notice}</p>}
    <details><summary>Review report text</summary><textarea aria-label='Unit diagnostic report text' readOnly value={text} rows={14}/></details>
  </section>;
}
