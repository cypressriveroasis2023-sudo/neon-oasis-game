/**
 * Reading a COS unit name the same way whoever typed it meant it.
 *
 * COS keeps the same unit under four spellings, because four systems have been
 * typed into by hand over several years. All of these are one unit each:
 *
 *   Spotter 236HDC2      Spotter 236          model after the number
 *   Solar Stand 72 001   Solar Stand 001      model before the number
 *   Solar Pole 001 72    Solar Pole 72 003    model on either side
 *   Recon II 001         RECON II 005         case and spacing
 *   Sniper 2-344         SNIPER 2 344         family with a number in it
 *   SNIPER 317 ES        Sniper 317           a trailing word
 *
 * The rule, found by reading every live name on 2026-11-24 rather than guessed:
 * a unit's name is a family, a unit number, and noise. The noise is a model
 * size (72, 144), a sensor suffix (HD, HDC2, HDC4S and friends), a parenthetical,
 * a trailing word, or a DO NOT USE marker. Strip the noise and one number is
 * left, and that number with its family is the unit.
 *
 * Where more than one number survives, the name does not say which is the unit.
 * `Solar Pole 013 72 (Hybrid solar stand) 074` is a real live example: 013 and
 * 074 are both candidates and nothing in the name settles it. Those return null
 * and are held for a person. A held unit costs a line on a list. A wrongly
 * matched one quietly moves equipment between customers.
 *
 * This module reads and writes nothing.
 */

/** Families, longest first, so SOLAR SPOTTER wins over SPOTTER and RECON II over RECON. */
const FAMILIES: {pattern: RegExp; family: string}[] = [
  [/^SOLAR\s*SPOTTER/, 'SOLARSPOTTER'],
  [/^SOLAR\s*STAND/, 'SOLARSTAND'],
  [/^SOLAR\s*POLE/, 'SOLARPOLE'],
  [/^SOLAR\s*SKID/, 'SOLARSKID'],
  [/^SS\s*HYBRID/, 'SSHYBRID'],
  [/^THERMAL\s*SNIPER/, 'THERMALSNIPER'],
  [/^RADAR\s*SNIPER/, 'RADARSNIPER'],
  [/^RECON\s*(?:II|2)\b/, 'RECON2'],
  [/^RECON/, 'RECON'],
  [/^RII(?![A-Z])/, 'RECON2'],
  [/^RI(?![A-Z])/, 'RECON'],
  [/^SNIPER\s*[-\s]?2\b(?!\d)/, 'SNIPER2'],
  [/^SNIPER\s*[-\s]?4\b(?!\d)/, 'SNIPER4'],
  [/^SNIPER/, 'SNIPER'],
  [/^SPOTTER/, 'SPOTTER'],
  [/^RANGER/, 'RANGER'],
  [/^HELIOS/, 'HELIOS'],
  [/^CAM\s*V/, 'CAMV'],
  [/^RSU/, 'RSU'],
  [/^WA\b/, 'WA'],
  [/^ST\b/, 'ST'],
].map(([pattern, family]) => ({pattern: pattern as RegExp, family: family as string}));

/**
 * Number groups that are a model size, not a unit number.
 *
 * 72 is the Solar Stand and Solar Pole mast height; 144 is the Solar Skid's.
 * They are only ignored for the families that use them, so a genuine Spotter 72
 * keeps its number.
 */
const MODEL_SIZES: Record<string, number[]> = {
  SOLARSTAND: [72], SOLARPOLE: [72], SOLARSKID: [144], SSHYBRID: [72],
};

/** Sensor models written onto the end of a number: Spotter 236HDC2. */
const SENSOR_SUFFIX = /(HD4|HDC[24]S|HDC[24]|HD)$/;

/** A sensor model written as its own word rather than stuck to the number. */
const LOOSE_SENSOR = /\s[-\s]*\b(HD4|HDC[24]S|HDC[24]|HD)\b/g;

/** Words that are a note, not part of the name. */
const NOISE_WORDS = /\b(DO\s+NOT\s+USE|DNU|MISSING|RETIRED|DECOMMISSIONED|STOLEN|NOT\s+IN\s+USE|SOLAR\s+COMPATIBLE|ES|SPARE|TEST)\b/g;

export type UnitName = {
  /** FAMILY|number, for comparing one system's name with another's. */
  key: string;
  family: string;
  /** The unit number as written, leading zeros removed: "001" reads as "1". */
  number: string;
  /** The model size or sensor suffix found, if any. Kept for showing a match. */
  model: string | null;
};

/** Why a name could not be read as one unit. */
export type UnitNameProblem =
  | 'not_a_string'
  | 'no_family'
  | 'no_number'
  /** More than one number could be the unit number, and the name does not say which. */
  | 'ambiguous_number';

export function readUnitName(value: unknown): UnitName | null {
  return readUnitNameOrProblem(value).name;
}

export function readUnitNameOrProblem(value: unknown): {name: UnitName | null; problem: UnitNameProblem | null} {
  const fail = (problem: UnitNameProblem) => ({name: null, problem});
  if (typeof value !== 'string' || !value.trim() || value.length > 200) return fail('not_a_string');

  let text = value.toUpperCase()
    .replace(/\([^)]*\)/g, ' ')        // (Hybrid solar stand)
    .replace(/[–—]/g, '-')              // en and em dashes
    .replace(/\s*-\s*DO\s+NOT\s+USE\s*$/i, ' ')
    .replace(NOISE_WORDS, ' ')
    .replace(LOOSE_SENSOR, ' ')
    .replace(/(\d)\s+\.(\d)/g, '$1.$2')   // "RANGER 029 .2" is one number
    .replace(/[^A-Z0-9.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const matched = FAMILIES.find(entry => entry.pattern.test(text));
  if (!matched) return fail('no_family');
  const family = matched.family;
  text = text.replace(matched.pattern, ' ').trim();

  // Number groups, each possibly carrying a sensor suffix: 236HDC2, 023.1, 72.
  const groups = text.match(/\d+(?:\.\d+)?(?:HD4|HDC[24]S|HDC[24]|HD)?/g) || [];
  if (!groups.length) return fail('no_number');

  const sizes = MODEL_SIZES[family] || [];
  let model: string | null = null;
  const candidates: string[] = [];
  for (const group of groups) {
    const suffix = SENSOR_SUFFIX.exec(group);
    const digits = suffix ? group.slice(0, -suffix[0].length) : group;
    if (suffix) model = suffix[0];
    if (sizes.includes(Number(digits))) { model = model || digits; continue; }
    candidates.push(digits);
  }
  // "SOLAR STAND 072": when the only number is one the family also uses as a
  // size, it is the unit number, not a size.
  if (!candidates.length && model && /^\d+$/.test(model)) { candidates.push(model); model = null; }
  if (!candidates.length) return fail('no_number');
  // Several numbers could be the unit. The name does not say which, so neither do we.
  if (new Set(candidates.map(tidyNumber)).size > 1) return fail('ambiguous_number');

  const number = tidyNumber(candidates[0]);
  return {name: {key: family + '|' + number, family, number, model}, problem: null};
}

/** "001" and "1" are one unit; "023.1" keeps its decimal, which is a different unit from 023. */
function tidyNumber(digits: string): string {
  const [whole, ...rest] = digits.split('.');
  const head = String(Number(whole));
  return rest.length ? head + '.' + rest.join('.') : head;
}

/** True when two names from different systems are the same unit. */
export const sameUnit = (a: unknown, b: unknown): boolean => {
  const left = readUnitName(a), right = readUnitName(b);
  return !!left && !!right && left.key === right.key;
};
