// Frozen pre-repair placement validator from 9c97c925; synthetic differential oracle.
const object = (v) => Boolean(v && typeof v === 'object' && !Array.isArray(v));
const uuid = (v) => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const fullKey = (v) => typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').toUpperCase() : '';
const auditKey = (v) => typeof v === 'string' ? v.trim().toUpperCase() : '';
const idString = (v) => typeof v === 'string' && /^[1-9]\d*$/.test(v) ? v : typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? String(v) : null;
const stamp = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : NaN;
const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
function fail(message) { throw Object.assign(new Error(message), { status: 503 }); }
/** Typed families retain embedded digits and decimal/HDC suffixes. Unknown labels need a complete exact match. */
export function placementMatchKey(value) {
    if (typeof value !== 'string')
        return '';
    const m = /^(SNIPER\s*[24]|RECON\s*(?:2|II)|SOLAR\s*(?:STAND\s*72|POLE\s*72|SKID\s*144))(?=\s|[-#])\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)(HD4|HDC[24]S?)?$/i.exec(value.trim())
        || /^(HELIOS|RANGER|AXIS\s*SOLAR\s*SPOTTER|AXIS\s*SPOTTER|SOLAR\s*SPOTTER|SPOTTER|SS\s*HYBRID|SNIPER|CAM\s*V|RECON|RII|RI|RSU|ALPHA)\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)(HD4|HDC[24]S?)?$/i.exec(value.trim());
    if (!m)
        return 'full:' + fullKey(value);
    const f = m[1].toUpperCase().replace(/\s/g, ''), family = { RI: 'RECON', RII: 'RECON2', RECONII: 'RECON2' }[f] || f;
    const [whole, fraction] = m[2].split('.');
    if (Number(whole) === 0)
        return 'full:' + fullKey(value);
    return 'typed:' + family + '|' + Number(whole) + (fraction === undefined ? '' : '.' + fraction) + (m[3] ? '|' + m[3].toUpperCase() : '');
}
/** DENIAL ONLY: related model/variant labels may need Owner review; never a join. */
export function placementIdentityConcernKey(value) {
    const key = placementMatchKey(value);
    if (!key.startsWith('typed:'))
        return key;
    const [family, number] = key.slice(6).split('|');
    const related = ['SPOTTER', 'SOLARSPOTTER', 'AXISSPOTTER', 'AXISSOLARSPOTTER'].includes(family) ? 'SPOTTER' : /^SNIPER[24]?$/.test(family) ? 'SNIPER' : /^RECON2?$/.test(family) ? 'RECON' : family;
    return 'concern:' + related + '|' + number;
}
/** Audit query projects only these columns; arbitrary audit JSON, reasons and before_state stay private. */
export function currentOwnerPlacements(audits, devices) {
    if (!Array.isArray(audits) || !Array.isArray(devices) || audits.length > 100000 || devices.length > 100000)
        fail('Current placement could not be verified. Reload the unit.');
    const latest = new Map(), marked = new Map();
    for (const a of audits) {
        if (!object(a) || !idString(a.id) || typeof a.unit_key !== 'string')
            fail('Placement history returned an invalid identity.');
        const key = auditKey(a.unit_key), previous = latest.get(key);
        if (!previous || BigInt(idString(a.id)) > BigInt(idString(previous.id)))
            latest.set(key, a);
        const previousMarked = marked.get(key);
        if (a.contract === 'COS_CAMERA_PLACEMENT_V2' && (!previousMarked || BigInt(idString(a.id)) > BigInt(idString(previousMarked.id))))
            marked.set(key, a);
    }
    const overrides = [];
    for (const latestAudit of latest.values()) {
        const a = latestAudit.contract === 'COS_CAMERA_PLACEMENT_V2' ? latestAudit : marked.get(auditKey(latestAudit.unit_key));
        if (!a)
            continue;
        let conflictReason = latestAudit !== a ? 'Camera inventory changed after the last Owner move. Review this unit’s identity.' : null;
        const ids = Array.isArray(a.device_ids) ? a.device_ids.map(idString) : [];
        const current = devices.filter(d => object(d) && auditKey(d.unit_key) === auditKey(a.unit_key)).map(d => idString(d.id));
        if (!ids.length || ids.some(id => !id) || current.some(id => !id) || new Set(ids).size !== ids.length || new Set(current).size !== current.length || ids.length !== current.length || ids.some(id => !current.includes(id)))
            conflictReason = 'Camera identity changed after its placement move. Review this unit before using its field location.';
        if (!['SHOP', 'FIELD'].includes(a.placement) || a.action !== (a.placement === 'SHOP' ? 'MOVE_TO_ROOT' : 'MOVE_TO_FIELD') || !Number.isFinite(stamp(a.created_at)) || !uuid(a.request_id) || !uuid(a.control_id)
            || a.placement === 'FIELD' && (!text(a.site_label, 250) || !text(a.street_address, 600)))
            fail('The saved Owner placement is incomplete.');
        const matchKey = placementMatchKey(a.unit_key);
        if (devices.some(d => placementMatchKey(d.unit_key) === matchKey && auditKey(d.unit_key) !== auditKey(a.unit_key)))
            conflictReason = 'Camera aliases need review before this unit’s placement can be shown.';
        overrides.push({ ...a, matchKey, conflictReason });
    }
    return overrides;
}
