/** Validate wall-clock values without converting the organization's local time to UTC. */
export type LocalScheduleResult =
  | { valid: true; start: string | null; end: string | null }
  | { valid: false; error: string };

function normalizeLocalTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > days[month - 1]) return null;
  return `${yearText}-${monthText}-${dayText} ${hourText}:${minuteText}`;
}

export function validateLocalSchedule(
  start: unknown,
  end: unknown,
  optional = false,
): LocalScheduleResult {
  const absent = (value: unknown) => value === undefined || value === null ||
    (typeof value === 'string' && value.trim() === '');
  if (optional && absent(start) && absent(end)) return { valid: true, start: null, end: null };
  const normalizedStart = normalizeLocalTime(start), normalizedEnd = normalizeLocalTime(end);
  if (!normalizedStart || !normalizedEnd) {
    return { valid: false, error: 'Enter valid start and end dates in YYYY-MM-DD HH:MM format.' };
  }
  if (normalizedEnd <= normalizedStart) {
    return { valid: false, error: 'End time must be after start time.' };
  }
  return { valid: true, start: normalizedStart, end: normalizedEnd };
}
