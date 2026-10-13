// Deliberate, reversible product availability switch. Never tied to mHelp health.
// Existing authorization, records and Owner controls remain unchanged.
export const IT_DAILY_ONLY = true;
export const IT_DAILY_WORKSPACES = Object.freeze(['Camera Health', 'Fleet Dashboard', 'Victron VRM', 'Unit Tracker']);
export const itDailyLabel = name => ({'Field Map':'Field View','Fleet Dashboard':'Field View','Victron VRM':'Victron View','Unit Tracker':'2027 Unit Tracker'}[name] || name);

// Keep the explicit daily context across the existing camera tools, including new tabs.
export function itDailyCameraUrl(href, search = globalThis.location?.search || '') {
  const params = new URLSearchParams(search);
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href) || !IT_DAILY_ONLY || !(params.get('itDaily') === '1' || ['fleet','it-daily'].includes(params.get('mode'))) || !/(?:^|\/)camera-(?:health|detail)\.html(?:[?#]|$)/.test(href)) return href;
  const [path, ...fragment] = href.split('#'), at = path.indexOf('?');
  const query = new URLSearchParams(at < 0 ? '' : path.slice(at + 1));
  if (query.getAll('itDaily').length === 1 && query.get('itDaily') === '1') return href;
  query.set('itDaily','1');
  return (at < 0 ? path : path.slice(0,at)) + '?' + query.toString() + (fragment.length ? '#' + fragment.join('#') : '');
}
