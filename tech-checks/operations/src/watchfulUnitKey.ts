/**
 * Name-only pairing key for a Watchful unit and the mHelp unit it is.
 * Watchful has no serials. An IP, a SIM id, or a device id is never part of the key.
 *
 * SS / SS_NVR / Solar Spotter / Solarspotter at 100 and above pair with
 * mHelp "Spotter nnn ... SOLAR COMPATIBLE". Below 100 those SS names are Solar Spotters.
 * "RANGER 029 .2" and "Ranger 029.2" are Ranger 029. A camera suffix such as
 * " CAM 1" is not a different unit. An IP speaker is not a unit.
 */

const CAMERA_SUFFIX = /\s+(?:CAM(?:ERA)?|CH(?:ANNEL)?)\s*\d+\s*$/i;

export function watchfulCanonicalUnitKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let name = raw.trim().replace(/_+/g, ' ').replace(/\s+/g, ' ');
  if (!name || name.length > 160) return null;
  if (/\bip\s*speakers?\b/i.test(name)) return null;
  name = name.replace(CAMERA_SUFFIX, '').trim();
  if (!name || /\bip\s*speakers?\b/i.test(name)) return null;

  const solarCompatible = /^spotter\s+(\d{1,6})\b.*\bsolar\s+compatible$/i.exec(name);
  if (solarCompatible) {
    const n = Number(solarCompatible[1]);
    return n >= 100 ? `SPOTTER|${n}` : null;
  }

  const solar = /^(?:ss(?:\s*nvr)?|solar\s*spotters?|solarspotters?)\s+(\d{1,6})(?:\s*\.\s*\d{1,2})?$/i.exec(name);
  if (solar) {
    const n = Number(solar[1]);
    if (!n) return null;
    return n >= 100 ? `SPOTTER|${n}` : `SOLARSPOTTER|${n}`;
  }

  const ranger = /^rangers?\s+(\d{1,6})(?:\s*\.\s*\d{1,2})?$/i.exec(name);
  if (ranger) {
    const n = Number(ranger[1]);
    return n ? `RANGER|${n}` : null;
  }

  const helios = /^helios\s+(\d{1,6})(?:\s*\.\s*\d{1,2})?$/i.exec(name);
  if (helios) {
    const n = Number(helios[1]);
    return n ? `HELIOS|${n}` : null;
  }

  const named = /^(sniper\s*[24]|sniper|cam\s*v|recon\s*(?:2|ii)|recon|spotter)\s+(\d{1,6})$/i.exec(name);
  if (!named) return null;
  const n = Number(named[2]);
  if (!n) return null;
  const family = named[1].toUpperCase().replace(/\s+/g, '');
  const canon = family === 'CAMV' ? 'CAMV'
    : family === 'RECON2' || family === 'RECONII' ? 'RECON2'
    : family === 'SPOTTER' ? 'UNIVIEW'
    : family;
  return `${canon}|${n}`;
}

/** Solar Spotters, Helios and Rangers are one Watchful row per camera. */
export function watchfulPerCameraUnit(key: string): boolean {
  return /^(?:SOLARSPOTTER|SPOTTER|RANGER|HELIOS)\|/.test(key);
}

export function watchfulCameraIdentity(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const name = raw.trim().replace(/_+/g, ' ').replace(/\s+/g, ' ');
  const suffix = /\s+((?:CAM(?:ERA)?|CH(?:ANNEL)?)\s*\d+)\s*$/i.exec(name);
  if (suffix) return suffix[1].toUpperCase().replace(/\s+/g, '');
  const dotted = /\s(\d{1,6})\s*\.\s*(\d{1,2})\s*$/i.exec(name);
  return dotted ? `.${Number(dotted[2])}` : '';
}
