/* Read-only presentation of separate observation/attempt and success records.
 * A provider observation is not a direct ping, and a port response is not video proof.
 * Never infer a success from a failed attempt, a generic event, or a recovery timestamp.
 */
(function (root) {
  'use strict';
  const ttl = 15 * 60 * 1000;
  function timestamp(value, now = Date.now()) {
    if (value == null || value === '') return { at: null, state: 'missing' };
    // Stored timestamptz values must identify a real calendar date and timezone.
    // Date.parse alone silently normalizes impossible dates such as February 30.
    const parts = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value) : null;
    const calendar = parts ? new Date(Date.UTC(+parts[1], +parts[2] - 1, +parts[3])) : null;
    const valid = parts && calendar.getUTCFullYear() === +parts[1] && calendar.getUTCMonth() === +parts[2] - 1 && calendar.getUTCDate() === +parts[3] && +parts[4] < 24 && +parts[5] < 60 && +parts[6] < 60;
    const at = valid ? Date.parse(value) : NaN;
    if (!Number.isFinite(at) || at <= 0 || at > now) return { at: null, state: 'invalid' };
    return { at: new Date(at).toISOString(), state: now - at > ttl ? 'stale' : 'fresh' };
  }
  function format(value, now = Date.now()) {
    const time = timestamp(value, now);
    if (!time.at) return time.state === 'missing' ? 'Never recorded' : 'Unknown (invalid timestamp)';
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
    }).format(new Date(time.at));
  }
  function port(health = {}, key, now = Date.now()) {
    const results = health?.port_status;
    const result = results && typeof results === 'object' && !Array.isArray(results)
      && Object.prototype.hasOwnProperty.call(results, key) ? results[key] : null;
    // A configured/displayed port is not an attempted check. Do not turn absent,
    // malformed, or skipped evidence into a failed connection (or a success).
    if (!result || typeof result !== 'object' || Array.isArray(result)
      || !Object.prototype.hasOwnProperty.call(result, 'online')
      || typeof result.online !== 'boolean' || result.attempted === false) {
      return { state: 'unchecked', label: 'Not checked', at: null, latencyMs: null };
    }
    // Direct sweeps replace port_status and checked_at together. That timestamp
    // applies only to explicit results present in the snapshot. A per-port time,
    // when supplied, must be valid itself; an aggregate time cannot freshen it.
    const checked = timestamp(Object.prototype.hasOwnProperty.call(result, 'checked_at')
      ? result.checked_at : health.checked_at, now);
    const providerOnly = /Star4Live live API|Control Center live API|^Reconeyez cloud event:/i.test(String(health.detail || ''));
    if (checked.state !== 'fresh' || providerOnly) {
      return { state: 'unverified', label: 'No recent result', at: checked.at, latencyMs: null };
    }
    const latencyMs = result.online && typeof result.latency_ms === 'number'
      && Number.isFinite(result.latency_ms) && result.latency_ms >= 0 ? result.latency_ms : null;
    return { state: result.online ? 'responding' : 'failed',
      label: result.online ? 'Responding' : 'No response', at: checked.at, latencyMs };
  }
  // Saved destinations remain available regardless of diagnostic state. A port
  // number is not proof of HTTP: Unity client/service ports stay plain endpoints.
  function connections(device = {}, health = {}, address) {
    const ip = String(address || '').trim().replace(/\/32$/, '');
    if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) || ip.split('.').some(part => Number(part) > 255)) return [];
    const validPort = value => /^(?:[1-9]\d{0,4})$/.test(String(value)) && Number(value) <= 65535;
    const expected = Array.isArray(device.expected_ports) ? device.expected_ports : [];
    const observed = health.port_status && typeof health.port_status === 'object' && !Array.isArray(health.port_status) ? Object.keys(health.port_status) : [];
    const ports = [...new Set([...expected, ...observed].filter(validPort).map(Number))].sort((a, b) => a - b);
    const labels = device.port_labels && typeof device.port_labels === 'object' ? device.port_labels : {};
    const result = [{address: ip, url: 'http://' + ip, label: 'Open public IP', port: null}];
    for (const value of ports) {
      const endpoint = ip + ':' + value;
      const protocol = value === 80 ? 'http' : value === 443 || value === 8443 ? 'https' : null;
      const label = typeof labels[value] === 'string' && labels[value].trim() ? labels[value] : 'Port ' + value;
      result.push({address: endpoint, url: protocol ? protocol + '://' + ip + (value === 80 || value === 443 ? '' : ':' + value) : null, label, port: value});
    }
    return result;
  }
  function record(device = {}, health = {}, group, now = Date.now()) {
    const provider = group === 'Vigilant' || group === 'Reconeyez';
    const source = group === 'Vigilant' ? 'Star4Live provider' : group === 'Reconeyez' ? 'Reconeyez cloud' : 'Direct service-port check';
    const attempt = timestamp(provider ? device.source_last_seen_at : health.checked_at || device.last_health_checked_at, now);
    const success = timestamp(provider ? device.last_online_at : device.last_probe_online_at, now);
    const status = String(provider ? device.source_status || '' : health.overall_status || '').toLowerCase();
    let outcome = !attempt.at ? 'No verified result' : provider
      ? (['online', 'offline'].includes(status) ? 'Reported ' + status.toUpperCase() : 'Status unknown')
      : health.checked_at && health.ip_reachable === false ? 'No response'
      : health.checked_at && health.ip_reachable === true ? 'Service port responded'
      : 'Result unknown';
    if (attempt.state === 'stale') outcome += ' · Stale observation';
    return {
      device: String(device.device_name || device.unit_key || 'Resource'),
      attempt: { ...attempt, label: group === 'Reconeyez' ? 'Last cloud status update' : 'Last check attempted', source, outcome },
      success: { ...success, label: 'Last successful connection', source,
        note: provider ? source + ' reported online · Historical record' : 'Service-port response only · Historical record; video not verified' }
    };
  }
  function latest(records, kind) {
    const valid = records.filter(row => row[kind].at).sort((a, b) => Date.parse(b[kind].at) - Date.parse(a[kind].at));
    return valid[0] || records.find(row => row[kind].state === 'invalid') || records[0];
  }
  function escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])); }
  function strip(devices, health, getGroup, now = Date.now()) {
    const records = devices.map(device => record(device, health[device.id] || {}, getGroup(device), now));
    const attemptRow = latest(records, 'attempt'), successRow = latest(records, 'success');
    if (!attemptRow || !successRow) return '';
    const cell = (row, kind) => {
      const data = row[kind];
      const date = data.at ? format(data.at, now) : data.state === 'invalid' ? 'Unknown (invalid timestamp)' : 'Never recorded';
      const note = kind === 'attempt' ? data.source + ' · ' + data.outcome : data.at ? data.note : 'No verified successful connection time';
      const identity = devices.length > 1 ? row.device + ' · ' : '';
      return '<div class="time-' + (kind === 'attempt' ? 'attempt' : 'history') + '"><span>' + escape(data.label) + '</span><b>' + escape(date) + '</b><small>' + escape(identity + note) + '</small></div>';
    };
    return '<div class="unit-time-strip" aria-label="Connection check history">' + cell(attemptRow, 'attempt') + cell(successRow, 'success') + '</div>';
  }
  root.CameraHealthHistory = { timestamp, format, port, connections, record, strip };
})(globalThis);
