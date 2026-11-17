import {useEffect, useState} from 'react';
import {cosPowerLabel, cosPowerVerdict, powerSamples, preferSharedSettings, readParentAccessToken, readPowerAlarmSettings, readSharedPowerAlarmSettings, writePowerAlarmSettings, writeSharedPowerAlarmSettings, type CosPowerSettings, type PowerMeasurement} from './cosPowerAlarms';

function blank(value: number | null): string {
  return value === null ? '' : String(value);
}

/** Shared thresholds, with this browser kept only as a cache when the read fails. */
export function CosPowerAlarmSettings({storage = typeof localStorage === 'undefined' ? null : localStorage}:{storage?: Storage | null}) {
  const [settings, setSettings] = useState<CosPowerSettings>(() => readPowerAlarmSettings(storage));
  const [draft, setDraft] = useState({voltage: blank(settings.lowVoltageV), soc: blank(settings.lowSocPercent), silent: blank(settings.silentHours)});
  const [note, setNote] = useState('Reading the shared thresholds.');
  const apply = (next: CosPowerSettings) => {
    setSettings(next);
    setDraft({voltage: blank(next.lowVoltageV), soc: blank(next.lowSocPercent), silent: blank(next.silentHours)});
  };
  useEffect(() => {
    let cancelled = false;
    readParentAccessToken().then(token => readSharedPowerAlarmSettings(token)).then(shared => {
      if (cancelled) return;
      const cache = readPowerAlarmSettings(storage);
      const next = preferSharedSettings(shared, cache);
      if (shared) writePowerAlarmSettings(storage, shared);
      apply(next);
      setNote(shared ? 'Shared thresholds. An empty box stays unset.' : 'Shared thresholds could not be read. Showing the last copy saved in this browser.');
    });
    return () => { cancelled = true; };
  }, [storage]);
  const save = async () => {
    const next: CosPowerSettings = {
      lowVoltageV: draft.voltage.trim() === '' ? null : Number(draft.voltage),
      lowSocPercent: draft.soc.trim() === '' ? null : Number(draft.soc),
      silentHours: draft.silent.trim() === '' ? null : Number(draft.silent),
    };
    const token = await readParentAccessToken();
    const saved = await writeSharedPowerAlarmSettings(token, next);
    if (!saved) {
      setNote('The shared thresholds were not saved. This browser was not updated.');
      return;
    }
    writePowerAlarmSettings(storage, saved);
    apply(saved);
    setNote('Saved for every signed-in COS account. An empty box stays unset.');
  };
  return <form className='cos-power-alarms' aria-label='COS power alarm settings' onSubmit={event => {event.preventDefault(); void save();}}>
    <strong>COS power thresholds</strong>
    <p>Leave a box empty to keep that check unset. COS does not guess a voltage, a charge, or a silence window.</p>
    <label>Low voltage, volts<input inputMode='decimal' aria-label='Low voltage threshold volts' value={draft.voltage} onChange={event => setDraft({...draft, voltage: event.target.value})} placeholder='threshold not set'/></label>
    <label>Low charge, percent<input inputMode='decimal' aria-label='Low charge threshold percent' value={draft.soc} onChange={event => setDraft({...draft, soc: event.target.value})} placeholder='threshold not set'/></label>
    <label>Power silent after, hours<input inputMode='decimal' aria-label='Power silent hours' value={draft.silent} onChange={event => setDraft({...draft, silent: event.target.value})} placeholder='threshold not set'/></label>
    <button type='submit'>Save shared thresholds</button>
    <small role='status'>{note}</small>
  </form>;
}

/** COS checks sit beside Victron's own alarm. They are not combined into one verdict. */
export function CosPowerChecks({measurements, now, settings}:{measurements: PowerMeasurement[] | null | undefined; now: number; settings: CosPowerSettings}) {
  const samples = powerSamples(measurements);
  const verdict = cosPowerVerdict({now, settings, voltage: samples.voltage, soc: samples.soc, newestObservedAt: samples.newestObservedAt, victronLowVoltage: samples.victronLowVoltage});
  return <div className='cos-power-alarms' aria-label='COS power checks'>
    <p className={verdict.voltage === 'alarm' ? 'cos-power-alarm' : undefined}>{cosPowerLabel(verdict.voltage, 'COS voltage')}</p>
    <p className={verdict.soc === 'alarm' ? 'cos-power-alarm' : undefined}>{cosPowerLabel(verdict.soc, 'COS charge')}</p>
    <p className={verdict.silent === 'alarm' ? 'cos-power-alarm' : undefined}>{cosPowerLabel(verdict.silent, 'COS power feed')}</p>
    <p>Victron low-voltage {verdict.victronLowVoltage === 'alarm' ? 'alarm' : verdict.victronLowVoltage === 'clear' ? 'clear' : 'unknown'}. Victron's alarm is separate from the COS threshold.</p>
  </div>;
}
