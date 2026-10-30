// ../supabase/functions/_shared/scheduledDirectService.ts
function directPublicHost(value2) {
  if (typeof value2 !== "string") return null;
  const host = value2.replace(/\/32$/, ""), parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^(?:0|[1-9][0-9]{0,2})$/.test(p) || Number(p) > 255)) return null;
  const [a, b, c] = parts.map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2)) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113) return null;
  return host;
}
var IO_TIMEOUT_MS = 4e3;
async function boundedRequest(make, deadline, now = () => Date.now(), timeout = IO_TIMEOUT_MS) {
  const remaining = Math.min(timeout, deadline - now());
  if (remaining <= 0) throw Error("Sweep deadline reached");
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([Promise.resolve(make(controller.signal)), new Promise((_, reject2) => {
      timer = setTimeout(() => {
        controller.abort();
        reject2(Error("Sweep request timed out"));
      }, remaining);
    })]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

// ../supabase/functions/_shared/exact-product-producer/cancellableIo.ts
function cancellableIo(deadline, now, parent) {
  const started = now();
  const check = () => {
    if (parent?.aborted) throw Error("Request cancelled");
    if (now() < started || now() >= deadline) throw Error("Request deadline");
  };
  const request = async (fn, timeout = 4e3) => {
    check();
    return boundedRequest(async (timeoutSignal) => {
      const controller = new AbortController();
      let cancel;
      const aborted = new Promise((_, reject2) => {
        cancel = () => {
          controller.abort();
          reject2(Error("Request cancelled"));
        };
      });
      parent?.addEventListener("abort", cancel, { once: true });
      timeoutSignal.addEventListener("abort", cancel, { once: true });
      try {
        check();
        if (timeoutSignal.aborted) throw Error("Request deadline");
        const value2 = await Promise.race([Promise.resolve(fn(controller.signal)), aborted]);
        check();
        return value2;
      } finally {
        parent?.removeEventListener("abort", cancel);
        timeoutSignal.removeEventListener("abort", cancel);
        controller.abort();
      }
    }, deadline, now, timeout);
  };
  return { check, request };
}

// ../supabase/functions/cos-operations-pages/placementProjection.ts
var object = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var uuid = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
var fullKey = (v) => typeof v === "string" ? v.trim().replace(/\s+/g, " ").toUpperCase() : "";
var auditKey = (v) => typeof v === "string" ? v.trim().toUpperCase() : "";
var idString = (v) => typeof v === "string" && /^[1-9]\d*$/.test(v) ? v : typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : null;
var stamp = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? Date.parse(v) : NaN;
var text = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
function fail(message) {
  throw Object.assign(new Error(message), { status: 503 });
}
function placementMatchKey(value2) {
  if (typeof value2 !== "string") return "";
  const m = /^(SNIPER\s*[24]|RECON\s*(?:2|II)|SOLAR\s*(?:STAND\s*72|POLE\s*72|SKID\s*144))(?=\s|[-#])\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)(HD4|HDC[24]S?)?$/i.exec(value2.trim()) || /^(HELIOS|RANGER|AXIS\s*SOLAR\s*SPOTTER|AXIS\s*SPOTTER|SOLAR\s*SPOTTER|SPOTTER|SS\s*HYBRID|SNIPER|CAM\s*V|RECON|RII|RI|RSU|ALPHA)\s*[-#]?\s*(\d{1,6}(?:\.\d+)?)(HD4|HDC[24]S?)?$/i.exec(value2.trim());
  if (!m) return "full:" + fullKey(value2);
  const f = m[1].toUpperCase().replace(/\s/g, ""), family = { RI: "RECON", RII: "RECON2", RECONII: "RECON2" }[f] || f;
  const [whole, fraction] = m[2].split(".");
  if (Number(whole) === 0) return "full:" + fullKey(value2);
  return "typed:" + family + "|" + Number(whole) + (fraction === void 0 ? "" : "." + fraction) + (m[3] ? "|" + m[3].toUpperCase() : "");
}
function placementIdentityConcernKey(value2) {
  const key = placementMatchKey(value2);
  if (!key.startsWith("typed:")) return key;
  const [family, number] = key.slice(6).split("|");
  const related = ["SPOTTER", "SOLARSPOTTER", "AXISSPOTTER", "AXISSOLARSPOTTER"].includes(family) ? "SPOTTER" : /^SNIPER[24]?$/.test(family) ? "SNIPER" : /^RECON2?$/.test(family) ? "RECON" : family;
  return "concern:" + related + "|" + number;
}
function currentOwnerPlacements(audits, devices) {
  if (!Array.isArray(audits) || !Array.isArray(devices) || audits.length > 1e5 || devices.length > 1e5) fail("Current placement could not be verified. Reload the unit.");
  const latest = /* @__PURE__ */ new Map(), marked = /* @__PURE__ */ new Map();
  for (const a of audits) {
    if (!object(a) || !idString(a.id) || typeof a.unit_key !== "string") fail("Placement history returned an invalid identity.");
    const key = auditKey(a.unit_key), previous = latest.get(key);
    if (!previous || BigInt(idString(a.id)) > BigInt(idString(previous.id))) latest.set(key, a);
    const previousMarked = marked.get(key);
    if (a.contract === "COS_CAMERA_PLACEMENT_V2" && (!previousMarked || BigInt(idString(a.id)) > BigInt(idString(previousMarked.id)))) marked.set(key, a);
  }
  let currentByKey;
  let aliasesByMatch;
  const overrides = [];
  for (const latestAudit of latest.values()) {
    const a = latestAudit.contract === "COS_CAMERA_PLACEMENT_V2" ? latestAudit : marked.get(auditKey(latestAudit.unit_key));
    if (!a) continue;
    let conflictReason = latestAudit !== a ? "Camera inventory changed after the last Owner move. Review this unit\u2019s identity." : null;
    const ids = Array.isArray(a.device_ids) ? a.device_ids.map(idString) : [];
    if (!currentByKey) {
      currentByKey = /* @__PURE__ */ new Map();
      devices.forEach((d) => {
        if (object(d)) {
          const key = auditKey(d.unit_key), ids2 = currentByKey.get(key) || [];
          ids2.push(idString(d.id));
          currentByKey.set(key, ids2);
        }
      });
    }
    const current = currentByKey.get(auditKey(a.unit_key)) || [];
    if (!ids.length || ids.some((id3) => !id3) || current.some((id3) => !id3) || new Set(ids).size !== ids.length || new Set(current).size !== current.length || ids.length !== current.length || ids.some((id3) => !current.includes(id3))) conflictReason = "Camera identity changed after its placement move. Review this unit before using its field location.";
    if (!["SHOP", "FIELD"].includes(a.placement) || a.action !== (a.placement === "SHOP" ? "MOVE_TO_ROOT" : "MOVE_TO_FIELD") || !Number.isFinite(stamp(a.created_at)) || !uuid(a.request_id) || !uuid(a.control_id) || a.placement === "FIELD" && (!text(a.site_label, 250) || !text(a.street_address, 600))) fail("The saved Owner placement is incomplete.");
    const matchKey = placementMatchKey(a.unit_key);
    if (!aliasesByMatch && !devices.some((d) => d == null)) {
      aliasesByMatch = /* @__PURE__ */ new Map();
      devices.forEach((d) => {
        const key = placementMatchKey(d.unit_key), aliases2 = aliasesByMatch.get(key) || /* @__PURE__ */ new Set();
        aliases2.add(auditKey(d.unit_key));
        aliasesByMatch.set(key, aliases2);
      });
    }
    const aliases = aliasesByMatch?.get(matchKey);
    if (aliasesByMatch ? aliases && (aliases.size > 1 || !aliases.has(auditKey(a.unit_key))) : devices.some((d) => placementMatchKey(d.unit_key) === matchKey && auditKey(d.unit_key) !== auditKey(a.unit_key))) conflictReason = "Camera aliases need review before this unit\u2019s placement can be shown.";
    overrides.push({ ...a, matchKey, conflictReason });
  }
  return overrides;
}

// ../supabase/functions/cos-operations-pages/ownerIdentityCrosswalk.ts
var OWNER_IDENTITY_ORG = "ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5";
var OWNER_IDENTITY_CONTRACT = "COS_OWNER_CONFIRMED_IDENTITY_V1";
var record = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var uuid2 = (v) => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
var text2 = (v, max = 250) => typeof v === "string" && v.length > 0 && v.length <= max && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
var id = (v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : typeof v === "string" && /^[1-9]\d{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n ? v : null;
var revision = (v) => typeof v === "string" && /^(0|[1-9]\d{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n;
var digest = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var exact = (a, b) => a.length === b.length && new Set(a).size === a.length && new Set(b).size === b.length && a.every((x) => b.includes(x));
var normalized = (v) => typeof v === "string" ? v.trim().toUpperCase() : "";
var sorted = (v) => [...v].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
var OwnerIdentityError = class extends Error {
  status;
  constructor(message, status = 409) {
    super(message);
    this.status = status;
    this.name = "OwnerIdentityError";
  }
};
function fail2(message) {
  throw new OwnerIdentityError(message);
}
async function ownerIdentityDigest(value2) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value2)))), (b) => b.toString(16).padStart(2, "0")).join("");
}
function ownerConfirmedPhysicalTuple(key, devices) {
  return [OWNER_IDENTITY_CONTRACT, OWNER_IDENTITY_ORG, key, devices.map((d) => [id(d.id), d.source, d.device_type, d.external_device_id ?? null, d.device_serial ?? null, d.unit_key]).sort((a, b) => BigInt(a[0]) < BigInt(b[0]) ? -1 : 1)];
}
function validateOwnerIdentitySnapshot(value2) {
  if (!record(value2) || !digest(value2.revision) || !Array.isArray(value2.claims) || value2.claims.length > 1e3) fail2("Owner identity commitments are unavailable.");
  for (const c of value2.claims) if (!record(c) || !uuid2(c.id) || c.organization_id !== OWNER_IDENTITY_ORG || !uuid2(c.native_unit_id) || !text2(c.native_unit_label) || !text2(c.legacy_unit_key) || !Array.isArray(c.device_ids) || !c.device_ids.length || c.device_ids.length > 1e3 || c.device_ids.some((v) => id(v) !== v) || new Set(c.device_ids).size !== c.device_ids.length || !digest(c.resource_epoch) || !digest(c.physical_digest) || c.provenance !== "owner_confirmation" || !["active", "revoked"].includes(c.status) || !revision(c.revision)) fail2("Owner identity commitments are malformed.");
  if (new Set(value2.claims.map((c) => c.id)).size !== value2.claims.length) fail2("Owner identity history contains duplicate records.");
}
async function currentOwnerIdentityEvidence(s, unitId, unitKey, matchKey = placementMatchKey) {
  if (![s.units, s.devices, s.matches, s.providers, s.epochs].every((rows2) => Array.isArray(rows2) && rows2.length <= 1e5 && rows2.every(record))) fail2("Identity source records are unavailable.");
  if (!uuid2(unitId) || !text2(unitKey)) fail2("Choose the exact equipment and camera group.");
  const units = s.units.filter((u) => u.id === unitId), unit = units[0];
  if (units.length !== 1 || unit.organization_id !== OWNER_IDENTITY_ORG || !text2(unit.unit_number) || typeof unit.status !== "string" || ["retired", "deleted"].includes(unit.status)) fail2("The exact native equipment identity is missing or duplicated.");
  const nativeEpochs = s.crosswalk.nativeEpochs?.filter((e) => e.unitId === unitId);
  if (!Array.isArray(nativeEpochs) || nativeEpochs.length !== 1 || !digest(nativeEpochs[0].epoch)) fail2("The native identity incarnation is unavailable.");
  const group = s.devices.filter((d) => normalized(d.unit_key) === normalized(unitKey));
  if (!group.length || group.length > 1e3 || group.some((d) => d.unit_key !== unitKey || !id(d.id) || !text2(d.source, 100) || !text2(d.device_type, 100) || [d.external_device_id, d.device_serial].some((v) => v !== null && v !== void 0 && !text2(v, 500)))) fail2("The complete exact camera resource group is unavailable or ambiguous.");
  const ids = sorted(group.map((d) => id(d.id)));
  if (new Set(ids).size !== ids.length || group.some((d) => s.devices.filter((other) => id(other.id) === id(d.id)).length !== 1)) fail2("Camera resource identities are duplicated.");
  if (group.some((d) => s.devices.some((other) => other !== d && other.source === d.source && (text2(d.external_device_id, 500) && other.external_device_id === d.external_device_id || text2(d.device_serial, 500) && other.device_serial === d.device_serial)))) fail2("A physical camera identifier is claimed by multiple resources.");
  const matchedProviderIds = s.matches.every((m) => typeof m.vigilant_device_id === "string") && s.providers.every((p) => typeof p.id === "string") ? new Set(s.matches.map((m) => m.vigilant_device_id)) : null;
  const providerClaimsGroup = matchedProviderIds ? s.providers.some((p) => matchedProviderIds.has(p.id) && group.some((d) => p.external_device_id === d.external_device_id && p.source === d.source)) : s.matches.some((m) => s.providers.some((p) => p.id === m.vigilant_device_id && group.some((d) => p.external_device_id === d.external_device_id && p.source === d.source)));
  if (providerClaimsGroup) fail2("A native provider association already claims a resource in this camera group.");
  const concern = [matchKey(unit.unit_number), matchKey(unitKey)];
  if (s.units.some((u) => u.id !== unitId && concern.includes(matchKey(u.unit_number))) || s.devices.some((d) => d.unit_key !== unitKey && concern.includes(matchKey(d.unit_key)))) fail2("A competing full family, number or suffix identity requires review.");
  const epochs = s.epochs.filter((e) => e.unitKey === unitKey), epoch = epochs[0];
  if (epochs.length !== 1 || !digest(epoch.epoch) || !Array.isArray(epoch.deviceIds) || !exact(epoch.deviceIds, ids)) fail2("The current camera identity incarnation is unavailable or changed.");
  return { nativeEpoch: nativeEpochs[0].epoch, unitId, unitNumber: unit.unit_number, unitKey, deviceIds: ids, resourceEpoch: epoch.epoch, physicalDigest: await ownerIdentityDigest(ownerConfirmedPhysicalTuple(unitKey, group)), physicalResources: group.map((d) => ({ id: id(d.id), source: d.source, type: d.device_type, externalId: d.external_device_id ?? null, serial: d.device_serial ?? null })).sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1) };
}
function ownerClaimRelated(c, unitId, key, ids) {
  return c.native_unit_id === unitId || normalized(c.legacy_unit_key) === normalized(key) || c.device_ids.some((d) => ids.includes(d));
}
async function projectOwnerConfirmedIdentities(s) {
  validateOwnerIdentitySnapshot(s.crosswalk);
  const unitIdentities = [], identityWarnings = [];
  const labelKeys = /* @__PURE__ */ new Map();
  const matchKey = (value2) => {
    if (typeof value2 !== "string") return placementMatchKey(value2);
    if (!labelKeys.has(value2)) labelKeys.set(value2, placementMatchKey(value2));
    return labelKeys.get(value2);
  };
  for (const claim of s.crosswalk.claims) {
    const binding = { unitId: claim.native_unit_id, deviceIds: [...claim.device_ids], unitKeys: [claim.legacy_unit_key] };
    let reason = "";
    try {
      if (claim.status !== "active") fail2("The Owner-confirmed identity was revoked. Its resource commitments remain reserved.");
      const evidence = await currentOwnerIdentityEvidence(s, claim.native_unit_id, claim.legacy_unit_key, matchKey);
      if (claim.native_unit_label !== evidence.unitNumber || !exact(claim.device_ids, evidence.deviceIds) || claim.resource_epoch !== evidence.resourceEpoch || claim.physical_digest !== evidence.physicalDigest) fail2("The Owner-confirmed source identity changed. A restored label cannot reactivate it.");
      if (s.crosswalk.claims.some((c) => c !== claim && ownerClaimRelated(c, claim.native_unit_id, claim.legacy_unit_key, claim.device_ids))) fail2("More than one identity commitment claims these resources.");
      if (s.matches.some((m) => m.equipment_unit_id === claim.native_unit_id)) fail2("A provider association now competes with the Owner confirmation. Review its provenance.");
      const proof = await ownerIdentityDigest([OWNER_IDENTITY_CONTRACT, claim.id, claim.revision, claim.native_unit_id, claim.native_unit_label, claim.legacy_unit_key, sorted(claim.device_ids), claim.resource_epoch, claim.physical_digest, claim.provenance]);
      unitIdentities.push({ ...binding, unitNumber: claim.native_unit_label, kind: "owner_confirmed_native", proof });
    } catch (error) {
      reason = error instanceof Error ? error.message : "Owner identity evidence could not be verified.";
    }
    if (reason) identityWarnings.push({ ...binding, reason });
  }
  return { unitIdentities, identityWarnings };
}

// ../supabase/functions/cos-operations-pages/verifiedHealthIdentityScope.ts
var REVIEWED_NATIVE_IDENTITIES = Object.freeze({
  "431457757d33b15d0599c7c93ded5cdbb6a74c85caf225c1fcc7079f7b5ef5f8": "dc532cb72f2c0091810d513666813074b10a8afdfb526f00c0a9873554b1dc8e",
  "06e00932206ffd531b99186f8f1f7ab9456f3eb679219f2bbecd55e4993781bc": "846332d10df653b11ed142dadce45363663d3a41088b8ffdc2b0f3127a6ab693",
  "097e55ccf6a3439033205818afbc2e6e8ffcc1ad6760f9a5f3e3f04d0d978fee": "dc1e2366233e86c34217538b771d522b6176ade5ea762d133734c14d80ae168f",
  "0a98d875d6c81c5244ef2fbac83c2d87a160bce08e6508064739214ec8a5d890": "c69a648f97b8e7b9035e812a3d6ab4dad64917a2f36575e71c8aeed4b382dbb3",
  "0b0e30c2dd684fb321698e6b5a715d84dab6ee0d57795f103a065db34baec093": "182399e8d0f7f3ac2a05fc57d442afe934331631c8f25111b3722c6209cdbfd0",
  "0ffc8b3951f6ee93381df83ec7d99e6a2a290e98bd8a380977a850444d7b119a": "3af1a6e9acea89f412c81dd8236b5fd20f2dae3e9d4c97617031fb1c701c2614",
  "10c51c04d2d7b898604d8a4670c2fed98bd6cb701f72c143e216edfd1dd48d25": "64ff9ea9e05331f8abcd72013ff1b11004c6c307555371db7814c46b178693b6",
  "111e631ba7c023bd94ef0dfc7172994b2c775792e7e670b2bbdf0580d1d4a979": "f557e13e370f5f557565e99f3d19efeea9475fe5048fd351851f03cdc89c9553",
  "155e436fc22e3281b4c9d9251c629c3660c59db390525aaf27f9ff687e6cbc28": "34ffc498d15d98306dbbe22a71e50719ebbe8765fd8a0a39bbc1cd951f69cd12",
  "1753759c7e87e9662c02d9390c566fe85fab094178c3987dd1861cf79ff01ca2": "f2aa273b73c89fd5c1ade8abe39fc2948d7d8054ab62c493d8c7246ff352daee",
  "1e2724768b4f62fbf50428a546827cc81287e3a2e065e3e4be458797972bef94": "80b7465c6d14b4bf2c1cb84b73681ed36f75a2bf6386e1297a1a437eb029c629",
  "2a87ce5cbb2fa109da6b234a0b820e8f8ed16716f596aeee761e9ba5017ed3db": "08b42f07fa5be04ca84b00b10e611534f676510706db270f0d9fdd8a202b5226",
  "2aa4b04316a58d064b56ce8baaeba2714b71616d47b3094458afec947ed7caf3": "3e2dc6a323a6b8e3d9353d2cd1967d57675f605ab10d788885850e5f2959553a",
  "2c7ac9e104d322f1a65223dc5832ca5a92842db7d5f42faeb8a4cd462022e059": "8271ee9b3309314f50cf77b5d1b3cc777c487f1b67742aca6c05edbfc962f9b5",
  "3c2712b597374dc3fb5974b6257552c2ec417ab88bbada5a196040fcb2a1a474": "cf1ea7307b5e42e63a5d2d5788cabcbdc1ab73100bee0639b2928324d01825e6",
  "4637d6b6042da2ca9d99ee575dec2e24d689835640ccf2685a7768be0bf58fb7": "28c4f4520e0717f407ad62ae8227ffbd9176473a3e9c775d45a4f9ca74fd0cfb",
  "4c545f7cedb9e97b613e962f8075d5b840ddbcc2afd06ab80134fb36483b6a61": "5447825c15fafdb87da05d16d1e5f30ab40b0780d0fb95669d47bf7d1b806663",
  "4cd013985dc9a8461045e7a619373d7ad17b2e5ae2b5705e711d6a38a84dbd3f": "8594d7894b960e4bd9c1786598ad8a5d9ebcab4a4f3fa0a44c7f05aae640b12a",
  "501d68ff7362ddc948b6dbb839033d533f85b88f36c85dafb2525b590e60e2ec": "835ae1a7bf5b17e27ab93944dac352d9a4acc5b67148e699f2beae8ee684f273",
  "505a9eb57b1c7c4fc7fb0063b5e17ae96d1089fb429ec7d50e28e9927b2cb0cc": "01eb424f57264fb1dffa14d673e18e018167ce8c268426a24c4e8683d8968fbc",
  "53a92dfe2c0bd94ae3078c370ee24b6dba7526393c5122c15089b94bb8f9363b": "6400e2d9d1a9f4c00ec7a6da54c6381d91d8cbb11b341c17a060ef70f72c8c8a",
  "557918f836024d5f9aff4e789b212bc39438c15789d25b81390af322bcda9267": "55736078a81914bdd4ed030260f8c2b2d2fff3270cf85510176d4a98445c0082",
  "562e618dd9a219b56b7d50c527c9ed39370039749472e26c8c70f0f329eec704": "4050219a4964f37f79511367ff07d19e38f5696edec2418b08ce052cec39ed56",
  "569be5ab016909f63ace430c8ccee5095b60fc0bc7697c865c2a93744751a81e": "6b6e16a6b7b2bfb854b77903d04ba76b30fcc796fe5bdec537d3e24dd467a8f1",
  "5f323ff227b370aec5d38575ed0a0b7a8f12507c2a3a992e0881c04f225d7c66": "1557c13a24c2e6d20fa98dec65e2a8ccba602c7186bb3b12693af783e8a96816",
  "66b92d24a8b2f86655a820b9588356326175b986dd27e4c48a5f70f34c809911": "f456119070ba4bc22ea9f8dee89f5fce5ed96985b877d57b6d89cae2d6fbd664",
  "72861c1c7e6a579c9f70cbbffa0a7741f6cd0824ea2662e96e145b7d64af4674": "356a98b0fdfe2669c3e9acb58ea66d442d3ff43abebd619672ff6e84b18c0271",
  "77e914eccadc0081b8f150afaaa9f1a9e0c280ac865883b09406f9df011cf7a7": "e2af180710b75083fd45f33a38e15ac05f5a150096a4a2e641fe27a5ac1847fb",
  "797d3aef1754d6919523ae1120912da5b9af5aaf66fe2c74029a977d42767a60": "47d53becaa3a98cd3c516439b9a8a0adce6ec0417c9ffff74d8cf8bf88d681a1",
  "7de5e1e3a69961108c716ddddb61725d39beee6684e1a4c43937edad45200c4d": "c795740ea73b57450a35bb13b3ab764eb834f6bfd10019bbeccc8bd2fd0b92c9",
  "879fc4249b0a24da217a67c24a04466ff8f12438f13b52eeecfec7574a7c3765": "921575d2866d5933293f19e60a668517d5f85481cb24240badc0a03df1cf6080",
  "89a7291b8b85ed1111d3500c0af6699fbb522896f95b6adfafee8b00357f5985": "84a903b69564f86d3de42e64c58fc136b36da9c90a88e13b291924ec131c33ea",
  "8be905b6fd538b46e8c60029ee2189f3b015a4dfbfbbcff2f6444ac5012ddeee": "fead08519abd9694d9c9d61deb4effe9f81bbb2e3b23227efdbdad8557262ef0",
  "8d299df7ab5a62f2483d04395ea2e76fe916d51248d4bde3808d1d4aa8889458": "0c828defbb69a0303b04ea14805d9440f3b5cc97614ca8c74a5023d135a42572",
  "90b82e042b087f14f19dbd2230ad139b773792a5f43f77c1b0b765c1c74abc6a": "d1e16091d53cba63858a6367490781f9ea24ac14996a078deb793914c0f60f4d",
  "91c16d70f9644f8d52b727f20cdc1ab2eca2714c0406150759afc485d31a8d2e": "ecc3f586260106cfe927ee6bec00b9742c1cf278d2b082d8db104442f218a09f",
  "932eef381da7bed77e933edd4acb2a7841afdd4e22cb2a169c37b86f1767733e": "ce08cf570c9289b116e519755ff678ef12f7efa7c8052005f595967bd4d6c80c",
  "97fa644c4b901e6a69662071d1e303ee64c8327ea5521887ff67e4a1233db2a6": "b96ddef9f10bb1b4b5759128bed9a2650e215f5f40077341f15c270f374492b0",
  "98734b3407627b7c378f19852b86f9c4dad761999cbf6c6eb650286ab91f4f8f": "1122fb128668a31e2a66030fd6a516715f87ab7ba5138e4a191a8b52fe6ac730",
  "98fff8ea25a7e8a7e2fa5818f0a3d7b6a5da52370dd319d752f7b4e3905c3103": "8b70641b61303ca36e59129273eb5145e843e1c9a840898ad634023d596d59d6",
  "a32d1d68b90a459b2fd6db61f376a0dcc88823b4a611b6b51cad109dae2518cc": "b61987eee1b80ad1c9857fc00b5c6790b4fd1ba6b55cd352bb7df73639a6c888",
  "a480dde19109553322d32da81dfd07872b5cc21f246956bba3710daf02c6a3ce": "25a162368050d144b5d92ddb368412570ce24919a3ee527865a247752d0bcfa3",
  "a60745cb151b7e73c8a4d454bc11492eba822239d68b22b8ea911aeecbe0e020": "f66c1ebbfe141ddaac5e9a6e9c690ac8fb546448c74d8021dcc8cadec91b338e",
  "a76fc96e1c8690e829e3335c9c01a5b0880ffbf930546ac43004773ea94a24ed": "1e7dcc1f846965bafcc4501ffb96194b17ee6afffbb70c87ae15e048a64f05d8",
  "a860fed05841f5da6ca53e0219a00a3566c2fe910a51292bb6a81a0b87bf47aa": "2a92368a1a687c5e7b2d719d89184c808ba8e53918f8bfd400b817917c388cc0",
  "a9225d65dbfe8cec27caf57458cc1ce1eeeadfb89958e65bdfd6afce68c4da87": "cee6e035aaf931230a3cc87ca3890b69037653c411b8d1fd4bfa727c4f7b7de9",
  "abd4dd63c189464e97ac53bda72a0372dfe03331657fec7831d4635c0b9b9a72": "c96ffceddc8c164d5a54f1e06e8d7a3465314e67a19aa40718874581fa6de4a0",
  "ac1b054060764a013dab27b16235a6d6cbf8d57c2a9f6f674bcf5a70a085e1d4": "2267afd0f19117321d7213e9ed7e28ad14209c44030276ff4cbcab79e1d74ef0",
  "b08d058ee88b8c7756f8d4105f251e96a6b3b7e3bebab9af461ae83a1c5883fa": "acaadda2e3ee68b484dfbe6a6c5230a2fb13c72bc992f58e2085bec2ca3ebcf2",
  "b4a4ed4280781b7b762392a904e1bd37be8f82163b89aa395776952e9c2a6345": "b1f1ec74016c6e7f42b5933b6aded62e572b4b5e610f04e68e7c451b744b39da",
  "b9f80e6aea2f5f680a5a34e2046587e074e9e5116d9ab563045e51bdad968e5c": "f39f68e1a178bca02f47f310473e7a362b135b3e51fd892f416b829c85d1d076",
  "c52cdb5642b1e56aa3c21a860c3b40f9edcfdc14890f046fd4d476691f66b5f2": "001fbd0e38b5affc759ed9d80f1e11d69db05a4581f34f521c7bd009f9689c3a",
  "c60ee19ffc8fa309a4666f1c1cf9fc909ddfb3a405185cb01c7d5948c2ca2d31": "713deadb62d2cf7279637f3e984e394a3251a49af7d566de1093d7526796dfab",
  "c646e1f4322ec8342f5215393175db344119a5d3371f288ecb0a4445f7314d01": "56b6848bdf1f9e7fd5754c8b8b741aecc4993330e1baa706bd7b5806dd53d36e",
  "c73b416f05882d67ed956189cde61d913110b75707a8f5b5bdfa762824477c0d": "35513bfc1c59f48a75d1871ec8643510805831f1a4a1306ea9826187837cf155",
  "c84f0c96fabb623c466f9a18ece41ef5e469e00132b110d4b250e443c75cde80": "78c178dc5c8a6dd6984a462413ae81485f6d8ad79906d3a4a3938850b035e7af",
  "ca599e1bf7ecb7be518210c5b028ddbc231b2cb20649a35d2b9b88e96c208534": "584aec9773f6d0c7593779735cdf157be2f54cff185f62cb88bc4758efae1227",
  "cbc864c6aa3f7799275305cc072ce99833fed5ece43a085a9a4a588650279136": "15221ef117692879f16269d86ef3e32e5444a2b3b11545a8cc4a98441c6893f2",
  "cbe84d8abb0736f99c7f991bb8413a5d84129730f96ec39a0046230485c756ce": "410d47dc5ced6118b4cd226178d2ecf05b6ecf8c19e1997aef3e4ae63dfd0ee1",
  "d3b8116171c2f63a3edb2712274e7225b61c7ca31ce592e4c61e3e7d993516f6": "273394daf97b444ec1b45e965b5902bc0492d3e17cb9fe39fb152d27ad6d6e53",
  "d642a49fd407fe58e07f9b4e172b0e98bba9c30b59b18c53aa264b9a29426107": "48a474cd1831bfb8c005e05bce15c06f5ff553ae9c46812e7a386314bf261485",
  "d824ab7f3907f92d7b9b8bfb963ba169c70334cadd2e8a0f378855aab237059c": "2f173a5ef3240516bf2050e4bbaa6a298729fd47483347d57c99f5521ea2e06e",
  "d9185323316b6cdda42570e5c433e3aec08f0c63d2592892e48a4b9d6aa32e4c": "625bfac59603230adaa4ee2b4ce51bdc84c49bbac75abaa0296bf51a0419fab2",
  "d987b7dca20f7fc6783e7ab70655debac4284a29b213a7df4e25537b8184821b": "db5f2cf50dcd7080bb10026ebf969b5bc3aba086d843ff60c9c61229d47498b6",
  "da3eca41913efd25a95be9a58014018de63eae51c561a85f570bd00ad1dbd14c": "ec04fa9cac495270bc30b5dca36f10e7de3dfc2079108e26b3bad368afbc4914",
  "e1718c35ad035bd9c6ae0d677106af4391a35f01cca361d303a3a50a6e8aa83f": "22f0c7a9651d4c22d04fc7425587cfae197fa23500f785175a16196ce48c2960",
  "e370c271181d543e65bce50d2fdc56d3f333cf252e7ecd5b779c8cc46572e468": "1260073ea6bfac20d6d20d4e5da42e98f5304c61231ce059036c59782dea6f27",
  "e3ac9a5792dd44acfabd5250f2edf551ae846e466dba943a4d92da8daaaa1f13": "c19c04d90adc7af303a04f5eec18fd2faa2c0a2186cc2a2a8b78ee03a0c0c049",
  "e3e8193944536287c790fc3342efa075548b4deca963e3f2682112a285e6deaf": "b53e0b01674c32239843d47065e9aab253cd0be05f02ee914f07c81328b3e96a",
  "e512159d3f758390fdec8610eb01f772c0123b2b6132d7dd30a4c52e72a3233f": "37fa91756b5063a015abe6e89cb7d13377756d043bd84abab7b0b2f2b346cc88",
  "f57fb9c6007a55df6a2e0dd642adb5b7f817d0c84d13b1dcbcad72a1a299eb8f": "f4c80e614b8760e1fc75255611bd808549181ce4da349c7cef885a456797579a",
  "f6bb939c105fea43dd024f9b041e76912dab8b940208c9e603b1f4725f971fef": "bd2b41c64fa88e7a4f442bb2831f60661d86adf9d1d0ed03fc4147fd1249cace",
  "f7e4ca148f9ff4370945c2c6c20b5758a360c79bab7babbbdcd855b38270d6f9": "fc7660cc98bbe9e43b185c35abd4b978e736719e2fd19a5f8bd3b8b83edd4c76",
  "f8487166beabac831d8b1f1a8aaf6fef2277473565896920c95e87b2720afd63": "6323583a84d139bfb76dc777c5d21408692a2b6f460da5059419bc78d124906b",
  "f96498defa2c01d7fba8fe50e1cca57459c903ce8a51575a29ff1a99be447ce2": "3ed985d8a8f0937e6a7adf8d6ae92cb1715681aa109b095f02b3949873f01d12",
  "fd07cee925e166624410cb3cb25c9ce32e765e36d8b82f846816ed9ed2875ebd": "c89bdd2d7eb3cae4e86181573b6d201bdcf3715e2c23186fe1aa6d0031c32c2c"
});
var REVIEWED_OWNER_IDENTITIES = /* @__PURE__ */ new Set(["0493a660e8ba95ce11f383649bae5708e6db0ab8c601aa2311f8bbf01b9e0f0e"]);
var REVIEWED_NATIVE_RESOURCES = Object.freeze({
  "431457757d33b15d0599c7c93ded5cdbb6a74c85caf225c1fcc7079f7b5ef5f8": {
    "deviceIds": [
      "feed6068a78c6977c764c0365dfcfac2d94f6ddf1535273fc8b6c48e04eb7105",
      "46904bb929ed3ffdbedfdfb4d2c517282d10d2644ca3205a03d9fc2bd06cd987",
      "fdd3c0ca5a1c00eaaddc2c0140aef37c154e4ab6338de9c8bd43575858e2cd13",
      "664c50e58955e2ac4fa545241ed292331f9b9749510742992e0f444e2018a01e"
    ],
    "unitKeys": [
      "0de5ec7e47d0dd1758d9098f9e7accac4adadf71339f289a79541711ef8afa94"
    ]
  },
  "06e00932206ffd531b99186f8f1f7ab9456f3eb679219f2bbecd55e4993781bc": {
    "deviceIds": [
      "919ebe27f91e752138b6d6860ba66887320054c0401c2c0fa04edc05839eed9c",
      "c5cdd4e83a0d351b70c57129fe2d61f715eede74803d15ef5bc00855b43d7a8d",
      "c169a89d9d9d9889cf1e66e1a77975ed54653278492fbabf7e114717d2182b4f",
      "261f529ffcc8649a076e80900e60863b141ec11ba28224eaa49850e4af4e2932"
    ],
    "unitKeys": [
      "fd08cac3ffb8b8a1cc214b02437646792de0c80a8ebda897933ae1bd1b027862"
    ]
  },
  "097e55ccf6a3439033205818afbc2e6e8ffcc1ad6760f9a5f3e3f04d0d978fee": {
    "deviceIds": [
      "7a47b4b401db7190cac9be7cbef7766866c84f3991ce50d6647510eba98159a2"
    ],
    "unitKeys": [
      "bc834b04b6ec86a0b9359357ee2d7a7b540134f0395b7ad201f702dde0189a07"
    ]
  },
  "0a98d875d6c81c5244ef2fbac83c2d87a160bce08e6508064739214ec8a5d890": {
    "deviceIds": [
      "8d430f32fd142626a4a2cb5b09394a4af33420cb3bf314a39cc7ebf1ae775f55"
    ],
    "unitKeys": [
      "0aa709b48aabb02c1e88f0fa5e654e451a162447a9094994b21b12b067b91134"
    ]
  },
  "0b0e30c2dd684fb321698e6b5a715d84dab6ee0d57795f103a065db34baec093": {
    "deviceIds": [
      "a2b9f5c6f8c81903bb35f0c56cea4315a49b9f4b72054c56a651de3670e5cbaa",
      "c2648de9d0dfd0821f1dc06c4873cc7425848081b93ef49289d1c827de71c241",
      "86c7185dba0443000839ba2667b1dc6bc74e480e963f5a39cb84a8493c9f656c",
      "7ddce19715dcd61628ccbfaefed15566a21231aa81569a59faedb9bd967e76d7"
    ],
    "unitKeys": [
      "2ca59f6603691b189aa53a2200720883e946f7a69345ff227f2e518c26f15ce9"
    ]
  },
  "0ffc8b3951f6ee93381df83ec7d99e6a2a290e98bd8a380977a850444d7b119a": {
    "deviceIds": [
      "561618b11144e70ce14c23226b02c15794feba35bb19d887b1dc4ddb94293b51"
    ],
    "unitKeys": [
      "29ea45b1107c4c2010857890bad43671591f2e84c8d0e1e23d65b587b96b26a2"
    ]
  },
  "10c51c04d2d7b898604d8a4670c2fed98bd6cb701f72c143e216edfd1dd48d25": {
    "deviceIds": [
      "44e629d9d31d9079a1a3a979c4fe47d034956788332f70b564ccb2f11e8450f3"
    ],
    "unitKeys": [
      "00e737c29227071b5363c2b7579db53f053246d460155ca6969773673e46a4a8"
    ]
  },
  "111e631ba7c023bd94ef0dfc7172994b2c775792e7e670b2bbdf0580d1d4a979": {
    "deviceIds": [
      "46febca97d70d9cbc2c1aa3c97ce40d0b08162616217a090ac79ff502c09db47"
    ],
    "unitKeys": [
      "4fa5d146c11b6807cff48403cc164d81eb0df3a56f07f35de31d2f4ade1f4180"
    ]
  },
  "155e436fc22e3281b4c9d9251c629c3660c59db390525aaf27f9ff687e6cbc28": {
    "deviceIds": [
      "e36943ee7acb30e94df2ffd9ae80e30af4ac6cf94fb5ada1295d2c1d96bc06a3"
    ],
    "unitKeys": [
      "029812c1ca14a24be5ea431d2e95b3d42cd1a384d40dcfb8f7afbf31263f4b64"
    ]
  },
  "1753759c7e87e9662c02d9390c566fe85fab094178c3987dd1861cf79ff01ca2": {
    "deviceIds": [
      "ecdbb50d7c3d46eeb67fed4097cfeb431516d2682d9ce7927580d3193bf826dd",
      "cddc244f1a2e99704d0fd4147b4b47cbac61ffaa244cc36e108ddc2438af1471",
      "7a3551e1050dd8098348cfc7950b8a6e8fafa0e0d92d7cfa14c56a23c82bf123",
      "4f6b55ef015bbd63c179ebcf16ae1b1184526bff7b299d97f68ec13d23b5ca51"
    ],
    "unitKeys": [
      "ccddd63080d320772c8caeb9d37412d8c592f830f1640cf4a00965bcb38ab5fd"
    ]
  },
  "1e2724768b4f62fbf50428a546827cc81287e3a2e065e3e4be458797972bef94": {
    "deviceIds": [
      "d8e62367588995cbef0fd240b3994dc8833d7282ac524b0b1a1cb141ff50be10"
    ],
    "unitKeys": [
      "695ff1aa52b305643a6cdeab94f6580fb8e1d495d0f0f89f58840ac3fa62cd55"
    ]
  },
  "2a87ce5cbb2fa109da6b234a0b820e8f8ed16716f596aeee761e9ba5017ed3db": {
    "deviceIds": [
      "411a21923d2c39c5d06d53083521c7073e5fefbb5c529b540a4ef52f366a372c"
    ],
    "unitKeys": [
      "2799bf469349747571ae49dadf35ccdafcb69d9b34c22d4dfc156448d63f2db0"
    ]
  },
  "2aa4b04316a58d064b56ce8baaeba2714b71616d47b3094458afec947ed7caf3": {
    "deviceIds": [
      "fa4b6ed6f766dfe2e359de37306e108750e5f1b7f09b5ae7d6d2939df501b09d"
    ],
    "unitKeys": [
      "87613f2f295da96dd7efd218ca81f63c439132c8828d56cec472b6c19b0c2ea8"
    ]
  },
  "2c7ac9e104d322f1a65223dc5832ca5a92842db7d5f42faeb8a4cd462022e059": {
    "deviceIds": [
      "854ab1e44bad32c2e48f76b577fc37a030087ce85046aba6dcc7b3962e67f5fb"
    ],
    "unitKeys": [
      "978e5302d2a43275b0be449b0dbda1b16b42e9c6fedf9a19d6ff43f3e1859639"
    ]
  },
  "3c2712b597374dc3fb5974b6257552c2ec417ab88bbada5a196040fcb2a1a474": {
    "deviceIds": [
      "60a044ee3f2a1d90efea2decb98efffddc6a86d910b9f73aee901ec935a20cdf"
    ],
    "unitKeys": [
      "800bfd24e83a4d9caa9a4c2f40b6eaa7582be866cabee683e8458f4cf21167a6"
    ]
  },
  "4637d6b6042da2ca9d99ee575dec2e24d689835640ccf2685a7768be0bf58fb7": {
    "deviceIds": [
      "3745c23569c1d09ecaffccdc5671c01d8d8c9a4666cd56865e833fb4bf697514"
    ],
    "unitKeys": [
      "c3dd3e3558d267c0f334deeb8e2ec05fc646888a8836cf9e7ba84889b8cf0db7"
    ]
  },
  "4c545f7cedb9e97b613e962f8075d5b840ddbcc2afd06ab80134fb36483b6a61": {
    "deviceIds": [
      "dfb67ed44f19d97d649c4c02a3f8df7b198470fe1d2ca9328e7ca6c02a4250d2"
    ],
    "unitKeys": [
      "270fe3940ef2f83e34418bcbffe2c36733a176d9183a135bc4dc8909f5394eb1"
    ]
  },
  "4cd013985dc9a8461045e7a619373d7ad17b2e5ae2b5705e711d6a38a84dbd3f": {
    "deviceIds": [
      "e269db8b514596c8032bda0af97006a43e1219282e98fab2a58060452184d39d"
    ],
    "unitKeys": [
      "b1c21bd4c20ecef17cf1687dd160ea6cabaaa142f6013317b4068c4c63f9421f"
    ]
  },
  "501d68ff7362ddc948b6dbb839033d533f85b88f36c85dafb2525b590e60e2ec": {
    "deviceIds": [
      "d06c901c85d259dff0aa7873b4acdff1d04b501f2a7c3218adee8965f824a48f"
    ],
    "unitKeys": [
      "78b67ee77b122c1695335be231e39e4e493bb66d7764936223848a36b59dbcdf"
    ]
  },
  "505a9eb57b1c7c4fc7fb0063b5e17ae96d1089fb429ec7d50e28e9927b2cb0cc": {
    "deviceIds": [
      "52125961fa907295f5890fc7bf402a8a772a81f107eecabb61edc9c03a6736e8"
    ],
    "unitKeys": [
      "1c69405eb00ac0ad15247aee2572b65a69660c96034b135f2c10e8b3c831abc2"
    ]
  },
  "53a92dfe2c0bd94ae3078c370ee24b6dba7526393c5122c15089b94bb8f9363b": {
    "deviceIds": [
      "967e3070bb04d83c24e2823109e18910d5527875971ae9e70877dbc830b87ca2"
    ],
    "unitKeys": [
      "02e28ed5ae9955793b713f822b7f819bee270a81e67e73d7218ba3ca5b3aefdb"
    ]
  },
  "557918f836024d5f9aff4e789b212bc39438c15789d25b81390af322bcda9267": {
    "deviceIds": [
      "9948cea84de2b1c5574959f968716fd5226732e2ba989dd47527b14f66d9c4ad"
    ],
    "unitKeys": [
      "7b36a85e35f47b0c2d58557a253550ff7d805d1d35bfb54d8e02a9e1a706a6d7"
    ]
  },
  "562e618dd9a219b56b7d50c527c9ed39370039749472e26c8c70f0f329eec704": {
    "deviceIds": [
      "949c1d429e4fcaab4035d83c54c90ceb142c4201f90af88a24844741b058a939"
    ],
    "unitKeys": [
      "b0b71ab820475112a0bd0928982b69706800c08bbb78332dc84a84ffad52a47a"
    ]
  },
  "569be5ab016909f63ace430c8ccee5095b60fc0bc7697c865c2a93744751a81e": {
    "deviceIds": [
      "851139cf8ce200cc166245a50e6502acac69a7c73c77c3e8ab229185e2af74af",
      "f17802b963e9a08b8c892b5d45a5bb5274cf9eed27e2512b15282bf8e011e7ee",
      "38302e2b1a869c4030abfffd8bc94054af6835c2bfc6033f94b573696d1c38ea",
      "d1b5229bcfe904b29428a317622d233e413e2d46e6e6732009abb52291db551b"
    ],
    "unitKeys": [
      "057eb3019af64388a6ac5376cbf19c3f67a09ee4188f5024ec8db11d7684b217"
    ]
  },
  "5f323ff227b370aec5d38575ed0a0b7a8f12507c2a3a992e0881c04f225d7c66": {
    "deviceIds": [
      "b87b21fc80368e2509d591db8cdabbd70d7854d425645327712ce462ec06f5c0"
    ],
    "unitKeys": [
      "e56ffe9b8f612287f76bed52bbb716acefe7e8445d2017bc1f44a805dc9b8a85"
    ]
  },
  "66b92d24a8b2f86655a820b9588356326175b986dd27e4c48a5f70f34c809911": {
    "deviceIds": [
      "9100508c0bbd0c5fd1a8046810a7026cc4693d195535d92795bc838197cf21ac"
    ],
    "unitKeys": [
      "3a35129e37138048d906656c996e08b07ab78905eb2b99b1b83652db1afe2f67"
    ]
  },
  "72861c1c7e6a579c9f70cbbffa0a7741f6cd0824ea2662e96e145b7d64af4674": {
    "deviceIds": [
      "02a09b70dcf54e860edea43adfd34cdf95d0cafc363823bcba1979e1b4320274"
    ],
    "unitKeys": [
      "8b9d04d1f19509088e4e4f3042f6a2214842efe7441019e07447bf76bb0f9f97"
    ]
  },
  "77e914eccadc0081b8f150afaaa9f1a9e0c280ac865883b09406f9df011cf7a7": {
    "deviceIds": [
      "545607b6686a5c22a0e0c12c51718d2cd39944895bea3a6539fccd43d14a3122"
    ],
    "unitKeys": [
      "da684290b672f4af3e936ba6e46596345c50bd7481e0da006e0a97b9d4b47dc6"
    ]
  },
  "797d3aef1754d6919523ae1120912da5b9af5aaf66fe2c74029a977d42767a60": {
    "deviceIds": [
      "e117af901b93954327fa69a696e5c340c471c6911e2d18d5ea4991ffac30db0e",
      "26d3b4a57e3ef94933921608597da302c065f68e4bfdc84ada75c8aa143d8e8d",
      "144c263b131f0965030ca081b6030f944709dd19101a9dec7f2104ff3ceff9b7",
      "ad9d1fde5a8a561064da67ffee31cfdc7d48fdd55a2194aad8da7407d44b8f71"
    ],
    "unitKeys": [
      "ba3a7ded55899f92de00fbc3d2e203b06dada282d2a2aed35142e9f5a8d5a8b2"
    ]
  },
  "7de5e1e3a69961108c716ddddb61725d39beee6684e1a4c43937edad45200c4d": {
    "deviceIds": [
      "5711a37a04be887e522f5986caf0e61ac661a33c992452f6556d1195c0c26c92"
    ],
    "unitKeys": [
      "b40017d4ee8094bfa7667dfcada0139a9d1eb31aafde8f8798563a1c45cdb83a"
    ]
  },
  "879fc4249b0a24da217a67c24a04466ff8f12438f13b52eeecfec7574a7c3765": {
    "deviceIds": [
      "68b231a9a3837f7d0693015a8bd9e7bd0e84a156d2ab571b91cac80fcb9d5ea8"
    ],
    "unitKeys": [
      "d0b8bfa1fccd090f14067c197e833d3de181d0f7d4092b2946fa8b7940e0acb1"
    ]
  },
  "89a7291b8b85ed1111d3500c0af6699fbb522896f95b6adfafee8b00357f5985": {
    "deviceIds": [
      "b92183599540ca8daa8ebe7abbb23eea5d15eca75a5d313068867c2679b347c2"
    ],
    "unitKeys": [
      "d508b208d9be428c2d244532e6760c01c66f005710523dbdf55e19383bb77933"
    ]
  },
  "8be905b6fd538b46e8c60029ee2189f3b015a4dfbfbbcff2f6444ac5012ddeee": {
    "deviceIds": [
      "769c098db74b2c6f23887d7b6f9e4f091f917982e4f8eef64dfa852b7bebd20d",
      "2677ffcd354f842655b14646b30a8034aae7e166d72613b31d50781aed393913",
      "8ff41918074be8bdfa061ad3e6dc741c8e27a80183745ceb7b71604d8c76bc61",
      "2524e6fe4400ea5053f3ab528dee567e78009d4ba94b5ffdd03b1eb384e282e6"
    ],
    "unitKeys": [
      "41e2d017c3127a587a14635eee26c84242759282976a6e732f60d9dbe1bb1541"
    ]
  },
  "8d299df7ab5a62f2483d04395ea2e76fe916d51248d4bde3808d1d4aa8889458": {
    "deviceIds": [
      "e2466f41d4534dcd5ad92f7de44d3bd30746c39c68e723978000c68108f3a87e"
    ],
    "unitKeys": [
      "45cd584e3767c49abfa2b0a23f521e5dff4f191d7930745f6618dd1b5177b436"
    ]
  },
  "90b82e042b087f14f19dbd2230ad139b773792a5f43f77c1b0b765c1c74abc6a": {
    "deviceIds": [
      "663d8fede5c0a4bc93780a049b95153f1c44de095c325b4d1396b10467f94b8f",
      "e7a00d951123f7c8799395900063633973714fefe93ff54e3072f2cc785b9bcc",
      "9e331e820953729f8f4dccc48bd98aee74d7a9d91154070fce3dae27a56afa4c",
      "f6bfa0c8575fc85ff86914168dceaa634b22cc4bea4fd4b6e3d811fbf93fec67"
    ],
    "unitKeys": [
      "80b2b93b9f1fd57001521133c9400047fe97b6dd143d49d215ab55621fbe5737"
    ]
  },
  "91c16d70f9644f8d52b727f20cdc1ab2eca2714c0406150759afc485d31a8d2e": {
    "deviceIds": [
      "9e5b1fcaa10ef210f5db5a1ddac61310218febddeb5b70348446a75d8af41a62"
    ],
    "unitKeys": [
      "68db47dcb1de0de46585bb7a0f0c0ac014bfe8f9f6b4fb1cf6313dc7c0e782ad"
    ]
  },
  "932eef381da7bed77e933edd4acb2a7841afdd4e22cb2a169c37b86f1767733e": {
    "deviceIds": [
      "7db3c5dabc7ee60eddfbb2a66c8750c6df42d744daf74995339c807b652751e2"
    ],
    "unitKeys": [
      "057e2279e0bf4c308b653a06a73755bf02b9c3493c9119c9cc042daac9f83d9e"
    ]
  },
  "97fa644c4b901e6a69662071d1e303ee64c8327ea5521887ff67e4a1233db2a6": {
    "deviceIds": [
      "71ec96e3162d6992969ee812f0534391abbe85e9ba3faa6e69eca4fd9f03a76b"
    ],
    "unitKeys": [
      "d43a33243c4fab95c6c7ce1c4a18994ce501be228ec17923b93567191eeae0d5"
    ]
  },
  "98734b3407627b7c378f19852b86f9c4dad761999cbf6c6eb650286ab91f4f8f": {
    "deviceIds": [
      "0b0b2bb610c3eb0d2cea0ebc2310c601f847e9251416d465bfa42c1e6711ab12"
    ],
    "unitKeys": [
      "5f1b24cff106c64e260961f10ed3908e750bf3a5578e61a87f4eb2fd69c0bb79"
    ]
  },
  "98fff8ea25a7e8a7e2fa5818f0a3d7b6a5da52370dd319d752f7b4e3905c3103": {
    "deviceIds": [
      "1f13893210ea5e152e1453be8ea452d18e6d027187914600dd7be7ceb096d010"
    ],
    "unitKeys": [
      "519aa275c9e5f5c4f1bc6965e7947a9e2b54f19179c90bae2f43fdf8ceceffac"
    ]
  },
  "a32d1d68b90a459b2fd6db61f376a0dcc88823b4a611b6b51cad109dae2518cc": {
    "deviceIds": [
      "133257791b627eada6ef982a859665ee7ed4df0960bf067cdd29687168e9df9f"
    ],
    "unitKeys": [
      "730a5118e105dd69f8eb2688bc78ea025d6ba61b6737b7cebe14042be69351f3"
    ]
  },
  "a480dde19109553322d32da81dfd07872b5cc21f246956bba3710daf02c6a3ce": {
    "deviceIds": [
      "f334a075658da1c5d7b9d22e3b9cd796a2cde0ab5fb03100cc289220fc771834"
    ],
    "unitKeys": [
      "b72a826a38092fbe9800667d4fcedc960c9cd5eb84d37fb138b4249326aa7f51"
    ]
  },
  "a60745cb151b7e73c8a4d454bc11492eba822239d68b22b8ea911aeecbe0e020": {
    "deviceIds": [
      "97f8c5a6c048d812e42a3c5fc2df03b6d60d6b16c19415874253f2136b54a4ae"
    ],
    "unitKeys": [
      "3b746988139e6f7d5fcc3a351d5e5ea6755001b93957ced8de8cf28d6d1c5bfe"
    ]
  },
  "a76fc96e1c8690e829e3335c9c01a5b0880ffbf930546ac43004773ea94a24ed": {
    "deviceIds": [
      "27aacf6ad4bd87e5ef4a594af328421f8a6305aeaddcb180c91fbaa0d907773a"
    ],
    "unitKeys": [
      "51162a830e0ff17e5045c58ef748412ae80f23fd81131eaee250e7463f3e67e3"
    ]
  },
  "a860fed05841f5da6ca53e0219a00a3566c2fe910a51292bb6a81a0b87bf47aa": {
    "deviceIds": [
      "9571bc29fa8f4cc1b15d461877415f193729b147728a4d59be32e5dd127fec06"
    ],
    "unitKeys": [
      "8c7bb3623f7974ae5b5f2ba2ae7f645fe84ac7481a9865eb6675f1a2c1ab27a2"
    ]
  },
  "a9225d65dbfe8cec27caf57458cc1ce1eeeadfb89958e65bdfd6afce68c4da87": {
    "deviceIds": [
      "18f472d1919d696637c1ddd6460aa5e8925d7c81cfdfca0a400882b967557c56"
    ],
    "unitKeys": [
      "9b9b25a106e3a8d8f380471e12089bc52a2adee9da05fe051899199095071a98"
    ]
  },
  "abd4dd63c189464e97ac53bda72a0372dfe03331657fec7831d4635c0b9b9a72": {
    "deviceIds": [
      "db1564899c4eb33490d9d555f02c5c34d20a96f10c25b147d6a5eefff9ef30af"
    ],
    "unitKeys": [
      "f86a604e7c1f14a93eea27da9e0e237a6ba1d6e31512397c5071c27bc324b261"
    ]
  },
  "ac1b054060764a013dab27b16235a6d6cbf8d57c2a9f6f674bcf5a70a085e1d4": {
    "deviceIds": [
      "30ccdc5b03a26c40f1343a58ca79205df6b2d6ee0d406a5416f4a9bd302562a4"
    ],
    "unitKeys": [
      "d2cb0388265300a85f9665aaeddc2bc3f536e94d2430bc183e055c1e78ef38bd"
    ]
  },
  "b08d058ee88b8c7756f8d4105f251e96a6b3b7e3bebab9af461ae83a1c5883fa": {
    "deviceIds": [
      "c181e4acd31100669ef82b86079a0c43a6e73216ac555f11d5da0cc8bc8b18fe"
    ],
    "unitKeys": [
      "3c8c91046d79090a6bc28595b6e5429e8fbddf29c768bca0d2f8707bc1598507"
    ]
  },
  "b4a4ed4280781b7b762392a904e1bd37be8f82163b89aa395776952e9c2a6345": {
    "deviceIds": [
      "25e4b184c4d44854db6c5cf39ed27884bd2c821b1a7273b1a5b946fb26090804",
      "0843a9a2a1217bc89ba440f797e544ebc11018d874ec0894e3b8cf10b80d9f54",
      "86b2cd68f9f9827194b73a08a5c57c9e7e13a918c4ae5ecf9d0a59c7e41233f2",
      "ee851aae99a7ce00e3e26f5ff55b398e2e9ba7484d93c7841007351d06b4623e"
    ],
    "unitKeys": [
      "d31754a91de0a2395386e568110a82541b5e62d0bf78c2b9594f748d8175b995"
    ]
  },
  "b9f80e6aea2f5f680a5a34e2046587e074e9e5116d9ab563045e51bdad968e5c": {
    "deviceIds": [
      "2ec4b5b5dfecc5737b5ae96eaeb3e2e58f8199ebea3df753974d3e7aaca61ad3",
      "8e5a4ef5bb984d36cceddb73dfca0fd190609ff62cb9ee3709805bc0b1e86545",
      "4ef7d97d2babe9b66583f2eae307821d2115f43c8647bcec22a510a012415a8d",
      "3870233c4638ec4aa5a1e6538fc42dced7747c9adf80de5307551c4df6822395"
    ],
    "unitKeys": [
      "c7b77f64429a74df32be495749da8c6a3cda9aea17d105785af3e2f5af3b0ed3"
    ]
  },
  "c52cdb5642b1e56aa3c21a860c3b40f9edcfdc14890f046fd4d476691f66b5f2": {
    "deviceIds": [
      "b7384a1097c8f9e6d5a0a934dcaedcd36801942a7d3e004c1fd325da2485703d"
    ],
    "unitKeys": [
      "a908d452f8862119b912ad3acea739f19f28a7be3dc156ee34e2b9ea022b5b52"
    ]
  },
  "c60ee19ffc8fa309a4666f1c1cf9fc909ddfb3a405185cb01c7d5948c2ca2d31": {
    "deviceIds": [
      "243975837bab773aae6c0f9e97a1761aa58df4a2297c15b8038f20786d3aa1f0"
    ],
    "unitKeys": [
      "eead47260a17c1a74d31300db869d34b68c745b2aee180a4a95854e6547e8969"
    ]
  },
  "c646e1f4322ec8342f5215393175db344119a5d3371f288ecb0a4445f7314d01": {
    "deviceIds": [
      "f89947f4b8c55055e5a0dbafdf91bf47271eee1fcd0c6d9b330ad66bd09f7348"
    ],
    "unitKeys": [
      "324af4cac4e8cc5134d8054cf8844df222bc70031674c59a5c06896c7323549e"
    ]
  },
  "c73b416f05882d67ed956189cde61d913110b75707a8f5b5bdfa762824477c0d": {
    "deviceIds": [
      "cc80cf5c50e4f58afa3a34426e6ab2892688ee67404bf5c4648f4401f653f488"
    ],
    "unitKeys": [
      "bb48ad2e49241a2dfed735d7885dd76b09a829ae6ab4d0cc1f276a89326e2868"
    ]
  },
  "c84f0c96fabb623c466f9a18ece41ef5e469e00132b110d4b250e443c75cde80": {
    "deviceIds": [
      "fa2b9d2805a9ca2b2c712ac9120619aa102bce215455dfc64ae8696be749bfdf",
      "e1c803241fff73243cf6fde3ede3f8987ac92f1311c79dc27c935ffdd7ab4f46",
      "11559481f0a6625f23350ec07651bc78652bfbd6112978a6e326b36722158614",
      "fb78f7adfc8bc42259697edcda70b71d19f349027ab4d1f1292e7a6f60891979"
    ],
    "unitKeys": [
      "f96744e42044ad54ba9833acfe7b6822a983de5bbb264ced202e46000bf96a7b"
    ]
  },
  "ca599e1bf7ecb7be518210c5b028ddbc231b2cb20649a35d2b9b88e96c208534": {
    "deviceIds": [
      "f5866e10e59982d31e61d0dbd46e455d32264cf75d2f71005308391afe73f99b"
    ],
    "unitKeys": [
      "34c3925f1c1f796c1212946151d01c69d8212c3cae675b55edc13343d121f4f7"
    ]
  },
  "cbc864c6aa3f7799275305cc072ce99833fed5ece43a085a9a4a588650279136": {
    "deviceIds": [
      "8f416cabecb90f5e2d8de9e502dd3cfcdb634fa7ce1dbfeaebcebd54428c7459",
      "5e78181a273b1c5f1c617a4a9df5cf9023d57a0f13de1617956a29343d492472",
      "e307ac23bd53b981621a11fb2ee9ced89ad551bfbabb798003b8bc55759d89c6",
      "e39547ab2765acd6cd5d20d0f2376ac8dc0ca5e5fb9d04ceec20077866beb488"
    ],
    "unitKeys": [
      "8564fa21999e93b6f675a8ff182d4f70ada990eebdb688f8064aa38b741e6d89"
    ]
  },
  "cbe84d8abb0736f99c7f991bb8413a5d84129730f96ec39a0046230485c756ce": {
    "deviceIds": [
      "f508623abf2451d8ac32b0cb53513a6a0fe9a6b886603cd06d8e29b216a2dd94"
    ],
    "unitKeys": [
      "f3a9658f6c9ecc5cb161015c0a61fd0488869437c1035743a4b21cda05db68f0"
    ]
  },
  "d3b8116171c2f63a3edb2712274e7225b61c7ca31ce592e4c61e3e7d993516f6": {
    "deviceIds": [
      "7f061dfb3a5fc99313a690e7af37f2e4e3a0d666c82404fa2b9aef82d5cb6a05"
    ],
    "unitKeys": [
      "b850d6bf0f6f77ba0e4a083f599f880b8aac6299b2f50b5fc0365d98c07bd347"
    ]
  },
  "d642a49fd407fe58e07f9b4e172b0e98bba9c30b59b18c53aa264b9a29426107": {
    "deviceIds": [
      "4d878129c95827be209ee7a834656ada5aa09294b4edfce5af56e80a175e3b31"
    ],
    "unitKeys": [
      "f60294f9c22f3a85444df8d247bed2ea11d55afe54b54e663d3f8762685c0780"
    ]
  },
  "d824ab7f3907f92d7b9b8bfb963ba169c70334cadd2e8a0f378855aab237059c": {
    "deviceIds": [
      "73ccc4db07140df2b560a5275433e73835906d2efa7a81159bd5a8a7e7ad8557",
      "3edc0f54c06f1f645b467586d62d3fe7a697c348068c72027c2b71b52fca3858",
      "8c7f5bc4248083fcf9a5f30388b5687f67b5b47b7875fa2a7d589c5f1c56976c",
      "99189cb4deac74063fdce09e0a7564e222239d1ad9b7748dbe4c84ecc5a25ce9"
    ],
    "unitKeys": [
      "f2a8a5797aef7c756007f920be1a981751d12d494a8c5fea841edfac4436df7d"
    ]
  },
  "d9185323316b6cdda42570e5c433e3aec08f0c63d2592892e48a4b9d6aa32e4c": {
    "deviceIds": [
      "239c17672f308fe61391965a86268bd436cb525caec68f316d4c9c09e291c970"
    ],
    "unitKeys": [
      "b0b6bafb6ffef36f95fdcf40cae3916d548d1af8e663a12009fa8f04190f002d"
    ]
  },
  "d987b7dca20f7fc6783e7ab70655debac4284a29b213a7df4e25537b8184821b": {
    "deviceIds": [
      "90a9543b234fdd747253602baebe7f939ecd5ddf75801afc0c13c954d8c2ff78",
      "f0b71e6c142353fffa5bfbeb7e43f2c992eab3a6269682f0b697ede2de729bb2",
      "f3637d99bc0af03946eb504f919a16d1921b90aa756d61bdbd3d776e87a88848",
      "6857b2b09b03bbf2836fd0a2237cc6377c1392e1e9651b8ed149569b1ade7fb1"
    ],
    "unitKeys": [
      "bb4655f03cb8ab05c0a02493e10148dd3b6f1215b264160491078465e5786463"
    ]
  },
  "da3eca41913efd25a95be9a58014018de63eae51c561a85f570bd00ad1dbd14c": {
    "deviceIds": [
      "7442f5cb4c2ed1c50ea353fcb471c79e17acc9c016ffa9b3a63ebabe7f6e6d67",
      "a038958d0c7a2fbcaa8d46bc319c939b834306dc5dd7b0f85f4e2dea7dcc06dd",
      "b402f36f5502110a00a71bfbaa49f462a9e4ec8a374b703dc7676e33599981bc",
      "2c0c439f85bd6c43aced68463661ccfe6a5b93493bf6b2003e594144f2fd9e33"
    ],
    "unitKeys": [
      "e04cd4d8920c17a87184d2b212b5875112affda1c3ee0675edb35b3204dea1f7"
    ]
  },
  "e1718c35ad035bd9c6ae0d677106af4391a35f01cca361d303a3a50a6e8aa83f": {
    "deviceIds": [
      "61abebaa85ac33ea77121f6807dff35f95ef1890498d201ca5c74e2e4e832df9"
    ],
    "unitKeys": [
      "7f13c7accc26a8869e56131e2b3a1fc336f75dc8327c13e58ec600bbc1f96716"
    ]
  },
  "e370c271181d543e65bce50d2fdc56d3f333cf252e7ecd5b779c8cc46572e468": {
    "deviceIds": [
      "4514f445364b1e3a64584c9ad990b21d3c1ee65a0ee66e4ec8f32418499fa851"
    ],
    "unitKeys": [
      "2d752b04aa5b70183cdd5f0eaa08192e45d49b11842cb05327d9c5d1a50e9846"
    ]
  },
  "e3ac9a5792dd44acfabd5250f2edf551ae846e466dba943a4d92da8daaaa1f13": {
    "deviceIds": [
      "2cbfbc8380f2af02c8f31ee709aad52775d2d44e6a4826adeddb8ac713a7b87c"
    ],
    "unitKeys": [
      "77336e11b6b72c7fa8f1589b957282386fc9c46f46a60acc366ea45b2e0bbd6d"
    ]
  },
  "e3e8193944536287c790fc3342efa075548b4deca963e3f2682112a285e6deaf": {
    "deviceIds": [
      "cbccf698b0038b4d8634a9de743752fe17540eada1c3c75c3f4eaee8a78762d4"
    ],
    "unitKeys": [
      "81c1e6bacf91ff968f70c2ea6241ec0304e80da04ac2a07a84b8cbb2478906bc"
    ]
  },
  "e512159d3f758390fdec8610eb01f772c0123b2b6132d7dd30a4c52e72a3233f": {
    "deviceIds": [
      "acc1937c37227f704736e96adb2070804943e5a245390997e26ab9dbede13502"
    ],
    "unitKeys": [
      "e0b4c948c0396000fce4701b88a26ed13185d3b8af2e3a64cf73b8db7695a9e0"
    ]
  },
  "f57fb9c6007a55df6a2e0dd642adb5b7f817d0c84d13b1dcbcad72a1a299eb8f": {
    "deviceIds": [
      "e20401c280d1d4c8dd23d70bbaf0c91d7f520ca3aa4c572efae94a4b7e73cb97"
    ],
    "unitKeys": [
      "ea0d97a3576af4ea79b5ed47283df93208a96b64e210a22d0abf5c9f19b1628b"
    ]
  },
  "f6bb939c105fea43dd024f9b041e76912dab8b940208c9e603b1f4725f971fef": {
    "deviceIds": [
      "7617cbe324442e5688429597dda8cd4c9ef8dbfdfa39f5983966dc2af0bb4810"
    ],
    "unitKeys": [
      "8482bf5e7ca5fcba169cdeb9af0848d3123c3a80d11d4a51b4dd9b89f2d96233"
    ]
  },
  "f7e4ca148f9ff4370945c2c6c20b5758a360c79bab7babbbdcd855b38270d6f9": {
    "deviceIds": [
      "d794cbdeea8b519a4efaf43d4b4454f559aaf20f8b78c4fbd4577ca868001fed"
    ],
    "unitKeys": [
      "d01bddadc28478f5c2016f1a7e64884d36254bb99a22c16342ba7655a7fd92bf"
    ]
  },
  "f8487166beabac831d8b1f1a8aaf6fef2277473565896920c95e87b2720afd63": {
    "deviceIds": [
      "3c27d672ea9e209b56ed6f39527e078878a6314907b45cf336d90006583f755c",
      "507f470bbfb8c4534cd1b4c9b377f256c6e8408b2768f601e50b5f37a1e8b1d2",
      "d405842295dcaa2702b85760e07a50dac4f7c02d0fee310fbebc596adcf06e15",
      "993cc3d0c035e3cdcef57e647919b57fd0ce2afbc3d9fdafc2bfca16bdf344d8"
    ],
    "unitKeys": [
      "992fd1fb72ea4524da9ccb1e9beac4509921f94420d7e6f439c1bbf79b5a43b9"
    ]
  },
  "f96498defa2c01d7fba8fe50e1cca57459c903ce8a51575a29ff1a99be447ce2": {
    "deviceIds": [
      "05f2a4da11beb62fcf1a6e2515a397d91e9bb656613ca9194fb78ea9ecf98483"
    ],
    "unitKeys": [
      "dcb0e803e5b1057825f586ecd99b15c7a48b6363039a8c1527632171b532e213"
    ]
  },
  "fd07cee925e166624410cb3cb25c9ce32e765e36d8b82f846816ed9ed2875ebd": {
    "deviceIds": [
      "6e43364728b6082f87140cbc12efd5339a5b172eafcd5e714369fd2bb55527c9"
    ],
    "unitKeys": [
      "73ef3d9bccc40f69a3ac2f6f9f3679642d2da9280e905f6d16c44df4fe833cfb"
    ]
  }
});
var REVIEWED_OWNER_RESOURCES = Object.freeze({
  "6bf42a0811b255dd245bc88b8d4eaed990e397d4f63c9783e49398966b29fcc7": {
    "deviceIds": [
      "209cd92d69e5e61b5e25a037465715c7e424057286b073d3b1fcbcfbaf365305",
      "93d84717867c2e34178c78cb6632230d5ee8998afc774b4348a3dce662be2bdd",
      "5aefc4c442c59773331ad1042f63e0a9955afe71ae160daad16492783e92176b",
      "6a3bec5da662da31d7978826155e060ce59d62ba12fa75847da7661289b23e39"
    ],
    "unitKeys": [
      "3519b266ac74a658643efaaef31acb6e038c9bb1c29c1a2e0331b3b65bd49289"
    ]
  }
});
var REVIEWED_OWNER_PHYSICAL_IDENTITIES = Object.freeze({
  "6bf42a0811b255dd245bc88b8d4eaed990e397d4f63c9783e49398966b29fcc7": "1d04c1b83dbec9d47b2a4b9718036d48c2a2627a4869fab5f98a71a49e23fb14"
});

// ../supabase/functions/cos-operations-pages/verifiedHealthIdentity.ts
var organizationId = "ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5";
var record2 = (value2) => Boolean(value2 && typeof value2 === "object" && !Array.isArray(value2));
var text3 = (value2) => typeof value2 === "string" && value2.length > 0 && value2 === value2.trim();
var uuid3 = (value2) => typeof value2 === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value2);
var decimal = (value2) => typeof value2 === "number" && Number.isSafeInteger(value2) && value2 > 0 ? String(value2) : typeof value2 === "string" && /^[1-9][0-9]*$/.test(value2) ? value2 : null;
var sortIds = (values) => [...values].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
var exactSet = (left, right) => left.length === right.length && new Set(left).size === left.length && new Set(right).size === right.length && left.every((value2) => right.includes(value2));
var index = (rows2, key) => {
  const out = /* @__PURE__ */ new Map();
  for (const row of rows2) out.set(row[key], [...out.get(row[key]) || [], row]);
  return out;
};
async function identityDigest(value2) {
  const digest3 = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value2)));
  return Array.from(new Uint8Array(digest3), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
var nativeIdentityKey = (unitId) => identityDigest(["COS_HEALTH_NATIVE_UNIT_V1", unitId]);
var ownerIdentityKey = (controlId) => identityDigest(["COS_HEALTH_OWNER_CONTROL_V1", controlId]);
var healthResourceKey = (deviceId2) => identityDigest(["COS_HEALTH_RESOURCE_V1", deviceId2]);
var healthSourceUnitKey = (unitKey) => identityDigest(["COS_HEALTH_SOURCE_UNIT_V1", unitKey]);
function nativeIdentityTuple(unit, associations) {
  const mappings = associations.map(({ match, provider, device }) => [
    match.id,
    match.equipment_unit_id,
    match.vigilant_device_id,
    match.camera_key,
    match.match_method,
    match.confidence,
    provider.id,
    provider.source,
    provider.external_device_id,
    provider.device_name,
    provider.device_type,
    decimal(device.id),
    device.source,
    device.external_device_id,
    device.device_serial,
    device.unit_key,
    device.device_type
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return ["COS_HEALTH_NATIVE_ASSOCIATION_V1", organizationId, unit.id, unit.unit_number, mappings];
}
function ownerIdentityTuple(audit) {
  return ["COS_HEALTH_OWNER_ASSOCIATION_V1", organizationId, audit.control_id, audit.unit_key, decimal(audit.id), sortIds(audit.device_ids.map(decimal))];
}
function ownerPhysicalIdentityTuple(audit, devices) {
  const resources = devices.map((device) => [decimal(device.id), device.source, device.device_type, device.device_serial, device.external_device_id, device.unit_key]).sort((a, b) => BigInt(a[0]) < BigInt(b[0]) ? -1 : BigInt(a[0]) > BigInt(b[0]) ? 1 : 0);
  return ["COS_HEALTH_OWNER_RESOURCES_V1", organizationId, audit.control_id, resources];
}
var reviewed = { native: REVIEWED_NATIVE_IDENTITIES, owner: REVIEWED_OWNER_IDENTITIES, nativeResources: REVIEWED_NATIVE_RESOURCES, ownerResources: REVIEWED_OWNER_RESOURCES, ownerPhysical: REVIEWED_OWNER_PHYSICAL_IDENTITIES };
async function verifiedHealthIdentities(sources, review = reviewed) {
  const { units, matches, providers, devices, audits } = sources;
  if (![units, matches, providers, devices, audits].every((rows2) => Array.isArray(rows2) && rows2.length <= 1e5 && rows2.every(record2))) throw new Error("Health identity source records are unavailable.");
  const unitIds = index(units, "id"), matchIds = index(matches, "id"), providerIds = index(providers, "id"), externalProviders = index(providers, "external_device_id");
  const byNative = index(matches, "equipment_unit_id"), resourceOwners = index(matches, "vigilant_device_id");
  const deviceIds = index(devices.map((row) => ({ ...row, id: decimal(row.id) })), "id"), externalDevices = index(devices, "external_device_id"), serialDevices = index(devices, "device_serial");
  const presentIds = /* @__PURE__ */ new Map(), presentKeys = /* @__PURE__ */ new Map();
  for (const id3 of deviceIds.keys()) if (typeof id3 === "string") presentIds.set(await healthResourceKey(id3), id3);
  for (const key of new Set(devices.map((device) => device.unit_key))) if (text3(key)) presentKeys.set(await healthSourceUnitKey(key), key);
  const warningBindings = /* @__PURE__ */ new Map();
  const bindWarning = (unitId, resources) => {
    warningBindings.set(unitId, {
      deviceIds: sortIds([...new Set((resources?.deviceIds || []).flatMap((hash2) => presentIds.has(hash2) ? [presentIds.get(hash2)] : []))]),
      unitKeys: [...new Set((resources?.unitKeys || []).flatMap((hash2) => presentKeys.has(hash2) ? [presentKeys.get(hash2)] : []))].sort()
    });
  };
  const identities = [], warnings = /* @__PURE__ */ new Map();
  const reject2 = (unitId, reason) => {
    if (!warnings.has(unitId)) warnings.set(unitId, { unitId, reason, ...warningBindings.get(unitId) || { deviceIds: [], unitKeys: [] } });
  };
  const rejectUnavailable = (reviewKey, resources, reason) => {
    const unitId = "unavailable:" + reviewKey;
    bindWarning(unitId, resources);
    const binding = warningBindings.get(unitId);
    if (binding.deviceIds.length || binding.unitKeys.length) reject2(unitId, reason);
  };
  const presentNativeKeys = /* @__PURE__ */ new Set();
  for (const unit of units) {
    if (!uuid3(unit.id)) continue;
    const reviewKey = await nativeIdentityKey(unit.id), expected = review.native[reviewKey], resources = review.nativeResources[reviewKey];
    if (!expected && !resources) continue;
    presentNativeKeys.add(reviewKey);
    bindWarning(unit.id, resources);
    if (!expected) {
      reject2(unit.id, "The reviewed native association has been revoked and requires identity review.");
      continue;
    }
    if (unit.organization_id !== organizationId || unitIds.get(unit.id)?.length !== 1 || !text3(unit.unit_number)) {
      reject2(unit.id, "Native equipment identity changed or is duplicated.");
      continue;
    }
    const links = byNative.get(unit.id) || [];
    if (!links.length) {
      reject2(unit.id, "Reviewed provider-resource mappings are missing.");
      continue;
    }
    const associations = [];
    let reason = null;
    for (const match of links) {
      if (match.organization_id !== organizationId || !uuid3(match.id) || matchIds.get(match.id)?.length !== 1 || !uuid3(match.vigilant_device_id) || resourceOwners.get(match.vigilant_device_id)?.length !== 1 || !text3(match.camera_key) || !text3(match.match_method) || !text3(match.confidence)) {
        reason = "Provider-resource mapping ownership is missing, changed or duplicated.";
        break;
      }
      const candidates = providerIds.get(match.vigilant_device_id) || [], provider = candidates[0];
      if (candidates.length !== 1 || provider.organization_id !== organizationId || provider.source !== "vigilant_control_center" || !text3(provider.external_device_id) || externalProviders.get(provider.external_device_id)?.length !== 1 || !text3(provider.device_name) || !["IPC", "NVR"].includes(provider.device_type)) {
        reason = "Provider identity is missing, duplicated or has an unverified family.";
        break;
      }
      const legacy = externalDevices.get(provider.external_device_id) || [], device = legacy[0];
      if (legacy.length !== 1 || !decimal(device.id) || deviceIds.get(decimal(device.id))?.length !== 1 || device.source !== "vigilant_control_center" || !text3(device.device_serial) || serialDevices.get(device.device_serial)?.length !== 1 || !text3(device.unit_key) || device.device_type !== provider.device_type) {
        reason = "Legacy resource identity is missing, duplicated or inconsistent.";
        break;
      }
      associations.push({ match, provider, device });
    }
    if (reason) {
      reject2(unit.id, reason);
      continue;
    }
    const boundIds = associations.map((row) => decimal(row.device.id)), unitKeys = [...new Set(associations.map((row) => row.device.unit_key))].sort();
    const wholeGroupIds = devices.filter((device) => unitKeys.includes(device.unit_key)).map((device) => decimal(device.id));
    if (wholeGroupIds.some((id3) => !id3) || !exactSet(boundIds, wholeGroupIds)) {
      reject2(unit.id, "Reviewed mapping is partial or the current source unit has extra/duplicate resources.");
      continue;
    }
    const proof = await identityDigest(nativeIdentityTuple(unit, associations));
    if (proof !== expected) {
      reject2(unit.id, "The complete reviewed native/provider association has changed.");
      continue;
    }
    identities.push({ unitId: unit.id, unitNumber: unit.unit_number, kind: "native_provider", deviceIds: sortIds(boundIds), unitKeys, proof });
  }
  for (const [key, resources] of Object.entries(review.nativeResources)) if (!presentNativeKeys.has(key)) rejectUnavailable(key, resources, "Reviewed native equipment identity is missing from the current inventory.");
  const knownOwners = /* @__PURE__ */ new Set(), presentOwnerKeys = /* @__PURE__ */ new Set();
  for (const audit of audits) {
    if (!uuid3(audit.control_id)) continue;
    const key = await ownerIdentityKey(audit.control_id), resources = review.ownerResources[key];
    if (resources) {
      knownOwners.add(audit.control_id);
      presentOwnerKeys.add(key);
      bindWarning(audit.control_id, resources);
    }
  }
  for (const [key, resources] of Object.entries(review.ownerResources)) if (!presentOwnerKeys.has(key)) rejectUnavailable(key, resources, "Reviewed Owner placement history is missing from the current inventory.");
  const currentOwners = /* @__PURE__ */ new Set();
  for (const audit of currentOwnerPlacements(audits, devices)) {
    if (!uuid3(audit.control_id)) continue;
    currentOwners.add(audit.control_id);
    if (audit.conflictReason) {
      reject2(audit.control_id, "Owner placement identity needs review: " + audit.conflictReason);
      continue;
    }
    const proof = await identityDigest(ownerIdentityTuple(audit));
    if (!review.owner.has(proof)) {
      if (knownOwners.has(audit.control_id)) reject2(audit.control_id, "The current Owner placement audit has not been reviewed for health identity.");
      continue;
    }
    const ownerDevices = devices.filter((device) => audit.device_ids.map(decimal).includes(decimal(device.id))), boundIds = ownerDevices.map((device) => decimal(device.id));
    if (!exactSet(boundIds, audit.device_ids.map(decimal)) || ownerDevices.some((device) => device.unit_key !== audit.unit_key || deviceIds.get(decimal(device.id))?.length !== 1) || unitIds.has(audit.control_id)) {
      reject2(audit.control_id, "Owner control identity or exact resource membership is inconsistent.");
      continue;
    }
    if (ownerDevices.some((device) => device.source !== "vigilant_control_center" || device.device_type !== "IPC" || !text3(device.device_serial) || serialDevices.get(device.device_serial)?.length !== 1 || !text3(device.external_device_id) || externalDevices.get(device.external_device_id)?.length !== 1)) {
      reject2(audit.control_id, "Owner physical camera identity is missing, duplicated or has an unverified provider or resource kind.");
      continue;
    }
    if (await identityDigest(ownerPhysicalIdentityTuple(audit, ownerDevices)) !== review.ownerPhysical[await ownerIdentityKey(audit.control_id)]) {
      reject2(audit.control_id, "The reviewed Owner physical camera identities have changed.");
      continue;
    }
    identities.push({ unitId: audit.control_id, unitNumber: audit.unit_key, kind: "owner_placement", deviceIds: sortIds(boundIds), unitKeys: [audit.unit_key], proof, placementAuditId: decimal(audit.id) });
  }
  for (const unitId of knownOwners) if (!currentOwners.has(unitId)) reject2(unitId, "The reviewed Owner placement control is no longer current.");
  if (sources.ownerCrosswalk) {
    const confirmed = await projectOwnerConfirmedIdentities({ units, devices, matches, providers, epochs: sources.ownerEpochs || [], crosswalk: sources.ownerCrosswalk });
    for (const identity of confirmed.unitIdentities) identities.push(identity);
    for (const warning of confirmed.identityWarnings) warnings.set(warning.unitId, warning);
  }
  const claims = /* @__PURE__ */ new Map();
  for (const identity of identities) for (const id3 of identity.deviceIds) claims.set(id3, /* @__PURE__ */ new Set([...claims.get(id3) || [], identity.unitId]));
  const conflicts = new Set(identities.filter((identity) => identities.filter((other) => other.unitId === identity.unitId).length !== 1 || identity.deviceIds.some((id3) => claims.get(id3).size !== 1) || [...warnings.values()].some((w) => w.unitId !== identity.unitId && (w.deviceIds.some((id3) => identity.deviceIds.includes(id3)) || w.unitKeys.some((key) => identity.unitKeys.includes(key))))).map((identity) => identity.unitId));
  for (const unitId of conflicts) reject2(unitId, "Health resources have more than one equipment identity.");
  const admitted = identities.filter((identity) => !warnings.has(identity.unitId)).sort((a, b) => a.unitId.localeCompare(b.unitId));
  return { identityVersion: 1, unitIdentities: admitted.filter((identity) => identity.kind !== "owner_confirmed_native"), ...sources.ownerCrosswalk ? { ownerConfirmedIdentityVersion: 1, ownerConfirmedUnitIdentities: admitted.filter((identity) => identity.kind === "owner_confirmed_native") } : {}, identityWarnings: [...warnings.values()].sort((a, b) => a.unitId.localeCompare(b.unitId)) };
}

// ../supabase/functions/cos-operations-pages/mhelpUploadPlacement.ts
var object2 = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
var uuid4 = (v) => typeof v === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
var id2 = (v) => typeof v === "string" && /^[1-9][0-9]{0,14}$/.test(v);
var safe = (v, max = 600) => typeof v === "string" && v.length <= max && !/[\x00-\x1f\x7f<>]/.test(v);
var stamp2 = (v) => typeof v === "string" && /(?:Z|[+-]\d\d(?::?\d\d)?)$/.test(v) ? Date.parse(v.replace(/([+-]\d\d)$/, "$1:00")) : NaN;
function checked(receipt, now) {
  if (receipt == null) return null;
  if (!object2(receipt) || !["COS_MHELP_UPLOAD_V1", "COS_MHELP_API_V1"].includes(receipt.contract) || receipt.reviewed !== true || !hash(receipt.sourceSha256) || !hash(receipt.payloadSha256) || !Number.isFinite(stamp2(receipt.receivedAt)) || stamp2(receipt.receivedAt) > now || !["minute", "second"].includes(receipt.receivedAtPrecision) || receipt.exportAsOf !== null || !Array.isArray(receipt.records) || !receipt.records.length || receipt.records.length > 1e4) throw Error("Invalid reviewed mHelp upload receipt");
  if (receipt.contract === "COS_MHELP_API_V1" && (receipt.origin !== "mhelpdesk_api" || receipt.portalId !== "224643" || receipt.complete !== true || receipt.recordCount !== receipt.records.length || !Array.isArray(receipt.apiMissingRecords))) throw Error("Invalid complete live mHelp source");
  const seen = /* @__PURE__ */ new Set(), targets = /* @__PURE__ */ new Set();
  for (const r of receipt.records) {
    if (!object2(r) || !id2(r.productId) || seen.has(r.productId) || !safe(r.unitNumber, 250) || !r.unitNumber || !safe(r.category, 250) || !id2(r.customerId) || !safe(r.customer, 250) || !r.customer || !["FIELD", "SHOP"].includes(r.placement) || !["UNFLAGGED", "DO_NOT_USE", "MISSING"].includes(r.lifecycle) || !object2(r.sourceAddress) || Object.values(r.sourceAddress).some((v) => typeof v !== "string" || v.length > 600 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f<>]/.test(v)) || !Number.isInteger(r.sourceRow) || r.sourceRow < 2) throw Error("Invalid mHelp upload source record");
    if (r.scopedAuthority != null) {
      const a = r.scopedAuthority;
      if (!object2(a) || a.contract !== "COS_SCOPED_INVENTORY_AUTHORITY_V1" || !uuid4(a.revisionId) || a.evidenceKind !== "derived_mapping" || !hash(a.evidenceSha256) || !Number.isSafeInteger(receipt.scopedRevision) || receipt.scopedRevision < 1 || !Number.isFinite(stamp2(a.receivedAt)) || stamp2(a.receivedAt) < stamp2(receipt.receivedAt) || stamp2(a.receivedAt) > now) throw Error("Invalid scoped inventory authority");
    }
    seen.add(r.productId);
    if (r.inventoryOnlyReason !== void 0 && (r.inventoryOnlyReason !== "no_sim" || r.placement !== "SHOP" || r.binding !== null || r.placementHeld !== true)) throw Error("Invalid inventory-only connection restriction");
    if (r.displayUnitNumber != null && (!safe(r.displayUnitNumber, 250) || !r.displayUnitNumber || !hash(r.displayAuthorizationSha256))) throw Error("Invalid approved display alias");
    if (r.binding != null) {
      const b = r.binding;
      if (!object2(b) || b.productId !== r.productId || !["reviewed_product_id", "exact_family_unit", "archived_alias", "owner_confirmed_alias"].includes(b.matchMethod) || !hash(b.evidenceSha256) || !hash(b.expectedGuard) || !(b.trackerId === null || uuid4(b.trackerId)) || !(b.trackerLabel === null || safe(b.trackerLabel, 250)) || !(b.nativeUnitId === null || uuid4(b.nativeUnitId)) || !b.trackerId && !b.nativeUnitId || !(b.nativeLabel === null || safe(b.nativeLabel, 250)) || typeof b.guardCurrent !== "boolean" || b.fullLabel !== r.unitNumber) throw Error("Invalid mHelp upload identity binding");
      for (const target of [b.trackerId, b.nativeUnitId].filter(Boolean)) {
        if (targets.has(target)) throw Error("Conflicting mHelp upload identities");
        targets.add(target);
      }
    }
  }
  return receipt;
}
var historicalOnly = (row) => ({
  historicalLatitude: row.latitude ?? row.historicalLatitude ?? null,
  historicalLongitude: row.longitude ?? row.historicalLongitude ?? null,
  historicalCoordinateSource: row.coordinateSource ?? row.historicalCoordinateSource ?? null,
  historicalHasUnitGps: row.hasUnitGps ?? row.historicalHasUnitGps ?? false,
  hasUnitGps: false,
  latitude: null,
  longitude: null,
  coordinateSource: null,
  locationVerification: "coordinates_unverified",
  locationVerifiedAt: null,
  locationHistoryId: null,
  importedInstallation: null,
  locationImportedGeocode: null,
  locationSourceRecorded: null,
  addressEstimateTrackerId: null,
  addressEstimateUnitNumber: null
});
function blockingReason(row, b, audits, identity, cutoff, groupRows, concernKey = placementIdentityConcernKey) {
  if (row.placementReviewReason || row.placementStatus === "needs_identity_review" || row.representationStatus === "conflict" || (identity?.identityWarnings || []).some((w) => w.unitId === row.id)) return "identity_conflict";
  const proofs = [...identity?.unitIdentities || [], ...identity?.ownerConfirmedUnitIdentities || []].filter((p) => p.unitId === row.id);
  const concerns = [row.unitNumber, b.trackerLabel, b.nativeLabel, ...proofs.flatMap((p) => p.unitKeys || [])].filter(Boolean).map(concernKey);
  const devices = proofs.flatMap((p) => p.deviceIds || []);
  const related = audits.filter((a) => [row.id, b.trackerId, b.nativeUnitId].filter(Boolean).includes(a.control_id) || concerns.includes(concernKey(a.unit_key)) || Array.isArray(a.device_ids) && a.device_ids.some((v) => devices.includes(String(v))));
  const confirmed = row.mhelpConfirmedAssignment, sourceTime = stamp2(confirmed?.observedAt);
  const protectedTimes = [...related.map((a) => stamp2(a.created_at)), ...groupRows.flatMap((member) => [...member.placementSource === "owner" ? [stamp2(member.placementUpdatedAt)] : [], ...member.hasUnitGps === true ? [stamp2(member.gpsRecordedAt)] : [], ...member.installedSiteId ? [stamp2(member.placementUpdatedAt)] : []])];
  const protectedAfterSource = protectedTimes.some((t) => !Number.isFinite(t) || t >= cutoff && (!Number.isFinite(sourceTime) || t >= sourceTime));
  if (confirmed?.contract === "COS_MHELP_CONFIRMED_ASSIGNMENT_V1" && confirmed.unitId === row.id && confirmed.unitNumber === row.unitNumber && (!Number.isFinite(sourceTime) || sourceTime >= cutoff) && !protectedAfterSource) {
    const corroborated = groupRows.every((member) => {
      const current = member.mhelpConfirmedAssignment;
      return current?.contract === "COS_MHELP_CONFIRMED_ASSIGNMENT_V1" && current.unitId === member.id && current.unitNumber === member.unitNumber && Number.isFinite(stamp2(current.observedAt)) && stamp2(current.observedAt) >= cutoff && current.assignmentChanged === false && ["FIELD", "SHOP"].includes(current.placement) && current.placement === member.placement;
    }) && new Set(groupRows.map((member) => member.placement)).size === 1;
    return corroborated ? "newer_source_assignment" : "newer_or_undated_source_assignment";
  }
  if (related.some((a) => !Number.isFinite(stamp2(a.created_at)) || stamp2(a.created_at) >= cutoff)) return "newer_or_undated_owner_history";
  if (row.placementSource === "owner" && (!Number.isFinite(stamp2(row.placementUpdatedAt)) || stamp2(row.placementUpdatedAt) >= cutoff)) return "newer_or_undated_owner_placement";
  const evidence = row.placementEvidence;
  if (["mhelpdesk", "mhelpdesk_upload"].includes(row.placementSource) && ["FIELD", "SHOP"].includes(row.placement) && evidence?.state !== "review" && Math.max(stamp2(row.mhelpObservedAt) || 0, stamp2(evidence?.observedAt) || 0) >= cutoff) return "newer_source_assignment";
  if (row.hasUnitGps === true && (!Number.isFinite(stamp2(row.gpsRecordedAt)) || stamp2(row.gpsRecordedAt) >= cutoff) || row.installedSiteId && (!Number.isFinite(stamp2(row.placementUpdatedAt)) || stamp2(row.placementUpdatedAt) >= cutoff)) return "newer_or_undated_verified_native_location";
  return null;
}
function retainedLocation(row, r, b, proof, customerIds) {
  if (!proof || proof.contract !== "COS_VALIDATED_LOCATION_PROOF_V1" || proof.unitId !== row.id || proof.unitNumber !== row.unitNumber || !["owner_verified", "address_estimate"].includes(proof.kind) || !object2(proof.locationFields) || typeof proof.address !== "string" || !proof.address.trim() || r.placement !== "FIELD") return null;
  if (proof.productId !== null && proof.productId !== r.productId) return null;
  const change = row.mhelpAssignmentChange;
  if (change?.contract === "COS_MHELP_ASSIGNMENT_CHANGE_V1" && change.unitId === row.id && change.unitNumber === row.unitNumber && ["customer_or_service_location_changed", "assignment_change_status_unavailable"].includes(change.reason)) {
    const observed = stamp2(change.observedAt), installed = proof.kind === "owner_verified" ? Math.max(stamp2(proof.locationFields.locationVerifiedAt) || 0, stamp2(proof.locationFields.gpsRecordedAt) || 0) : stamp2(proof.ownerPlacementFields?.placementUpdatedAt);
    if (!Number.isFinite(observed) || !Number.isFinite(installed) || installed <= observed) return null;
  }
  const prior = b.previousAssignment;
  if (prior && (prior.productId !== r.productId || prior.placement !== "FIELD" || prior.customerId !== r.customerId)) return null;
  const priorSame = prior?.productId === r.productId && prior?.placement === "FIELD" && prior?.customerId === r.customerId;
  const normalized3 = (v) => typeof v === "string" ? v.trim().replace(/\s+/g, " ").toLowerCase() : "";
  const original = proof.originalAssignment;
  const assignment = original?.unitId === row.id && original?.unitNumber === row.unitNumber ? original : proof;
  const proofCustomer = normalized3(assignment.customer), currentCustomer = normalized3(r.customer), proofSite = normalized3(assignment.site);
  const composite = proofCustomer && proofSite ? proofCustomer + ": " + proofSite : "";
  const customerCandidates = [proofCustomer, composite].filter(Boolean);
  const sameCustomerIdentity = customerCandidates.some((label) => {
    const ids = customerIds.get(label);
    return label === currentCustomer && ids?.size === 1 && ids.has(r.customerId);
  });
  const delimiterNormalized = (label) => label.replace(/\s*:\s*/g, ": ");
  if (composite && delimiterNormalized(currentCustomer).startsWith(delimiterNormalized(proofCustomer) + ": ") && delimiterNormalized(currentCustomer) !== delimiterNormalized(composite)) return null;
  if (!priorSame && proofCustomer && !customerCandidates.includes(currentCustomer)) return null;
  const exactOwnerIdentity = proof.ownerPlacementFields?.placementSource === "owner" && proof.ownerPlacementFields?.placementAuditId != null;
  if (proof.kind === "address_estimate" && !priorSame && !((proof.productId === r.productId || exactOwnerIdentity) && sameCustomerIdentity)) return null;
  if (row.locationVerification === "address_changed" && (proof.locationFields.locationVerification !== "address_changed" || typeof row.address !== "string" || normalized3(row.address) !== normalized3(proof.address)) || typeof row.address === "string" && row.address.trim() && normalized3(row.address) !== normalized3(proof.address)) return null;
  const service = row.mhelpLocation;
  if (service?.contract === "COS_MHELP_FLEET_LOCATIONS_V1" && service.unitId === row.id && service.unitNumber === row.unitNumber && typeof service.address === "string" && service.address.trim() && normalized3(service.address) !== normalized3(proof.address)) return null;
  return proof;
}
function projectMhelpUploadPlacement(snapshot, value2, audits, identity, now = Date.now(), options = {}) {
  const receipt = checked(value2, now);
  if (!receipt) return { snapshot, authorities: [] };
  const live = receipt.contract === "COS_MHELP_API_V1", source = live ? "mhelpdesk_api" : "owner_supplied_mhelp_export";
  if (!Array.isArray(snapshot.items) || !Array.isArray(snapshot.inventoryItems) || !Array.isArray(audits)) throw Error("Invalid upload placement inputs");
  const byId = /* @__PURE__ */ new Map();
  for (const row of snapshot.inventoryItems) {
    if (!object2(row) || !uuid4(row.id) || byId.has(row.id)) throw Error("Invalid upload target inventory");
    byId.set(row.id, row);
  }
  const concernKeys = /* @__PURE__ */ new Map();
  const concernKey = (value3) => {
    let key = concernKeys.get(value3);
    if (key === void 0) {
      key = placementIdentityConcernKey(value3);
      concernKeys.set(value3, key);
    }
    return key;
  };
  const changes = /* @__PURE__ */ new Map(), authorities = [], customerIds = /* @__PURE__ */ new Map();
  for (const r of receipt.records) {
    const key = r.customer.trim().replace(/\s+/g, " ").toLowerCase();
    customerIds.set(key, /* @__PURE__ */ new Set([...customerIds.get(key) || [], r.customerId]));
  }
  const records = receipt.records.map((r) => {
    const observedAt = r.scopedAuthority?.receivedAt || receipt.receivedAt, cutoff = stamp2(observedAt), evidenceSha256 = r.scopedAuthority?.evidenceSha256 || receipt.sourceSha256;
    const b = r.binding;
    let state = !b && r.possibleAliasUnitIds?.length ? "held" : "unlinked", reason = r.holdReason || "no_reviewed_inventory_binding", applied = false;
    const unitIds = [];
    if (b) {
      const expected = [{ id: b.trackerId, label: b.trackerLabel }, { id: b.nativeUnitId, label: b.nativeLabel }].filter((t) => t.id);
      const targets = expected.filter((t) => byId.has(t.id));
      const represented = Array.isArray(b.representedUnitIds) ? b.representedUnitIds : expected.map((t) => t.id);
      const membershipMatches = represented.length > 0 && new Set(represented).size === represented.length && represented.every((id3) => expected.some((t) => t.id === id3)) && represented.length === targets.length && targets.every((t) => represented.includes(t.id));
      if (!b.guardCurrent) {
        state = "held";
        reason = "identity_guard_changed";
      } else if (!targets.length || !membershipMatches || targets.some((t) => byId.get(t.id).unitNumber !== t.label)) {
        state = "held";
        reason = "bound_inventory_unavailable_or_renamed";
      } else {
        state = "linked";
        reason = null;
        unitIds.push(...targets.map((t) => t.id));
        const groupRows = targets.map((t) => byId.get(t.id));
        const groupBlock = groupRows.map((row) => blockingReason(row, b, audits, identity, cutoff, groupRows, concernKey)).find(Boolean);
        if (groupBlock) {
          reason = groupBlock;
          if (groupBlock === "identity_conflict") state = "held";
        }
        for (const target of groupBlock ? [] : targets) {
          const row = byId.get(target.id), preserved = retainedLocation(row, r, b, options.validatedLocationProofs?.get(row.id), customerIds);
          const evidence = { source, ...r.scopedAuthority ? { evidenceKind: "derived_mapping", scopedRevisionId: r.scopedAuthority.revisionId } : {}, productId: r.productId, sourceSha256: evidenceSha256, observedAt, timestampKind: live ? "api_snapshot_received" : r.scopedAuthority ? "scoped_source_received" : "upload_received", timestampPrecision: r.scopedAuthority ? "second" : receipt.receivedAtPrecision, state: "recorded", fresh: false, reason: live ? "saved_complete_api_snapshot" : "owner_supplied_export_not_live_api" };
          changes.set(row.id, {
            ...row,
            ...preserved ? preserved.locationFields : historicalOnly(row),
            placement: r.placement,
            currentLocationType: r.placement.toLowerCase(),
            placementSource: "mhelpdesk_upload",
            customer: r.customer,
            site: r.placement === "SHOP" ? "SHOP" : preserved?.site || null,
            address: preserved?.address || null,
            addressSource: preserved ? preserved.locationFields.addressSource || row.addressSource : "Uploaded customer address is source-only; verify installation",
            uploadLifecycle: r.lifecycle,
            uploadActiveInventoryEligible: r.lifecycle === "UNFLAGGED",
            uploadProductId: r.productId,
            uploadSourceAddress: r.sourceAddress,
            ...r.displayUnitNumber ? { uploadDisplayUnitNumber: r.displayUnitNumber } : {},
            placementEvidence: preserved?.ownerPlacementFields ? preserved.ownerPlacementFields.placementEvidence || { source: "owner", state: "recorded", observedAt: preserved.ownerPlacementFields.placementUpdatedAt || row.placementUpdatedAt || null, fresh: false } : evidence,
            uploadPlacementEvidence: evidence,
            mhelpPlacementReview: null,
            mhelpLocationReview: !preserved,
            ...preserved?.ownerPlacementFields || {}
          });
          if (!preserved?.ownerPlacementFields) authorities.push({ unitId: row.id, unitNumber: row.unitNumber, productId: r.productId, placement: r.placement, sourceSha256: evidenceSha256, observedAt, source });
          applied = true;
        }
      }
    }
    return {
      recordId: "mhelp_product:" + r.productId,
      productId: r.productId,
      unitNumber: r.displayUnitNumber || r.unitNumber,
      sourceUnitNumber: r.unitNumber,
      observedAt,
      category: r.category,
      placement: r.placement,
      uploadLifecycle: r.lifecycle,
      ...r.inventoryOnlyReason ? { inventoryOnlyReason: r.inventoryOnlyReason } : {},
      customer: r.customer,
      sourceAddress: r.sourceAddress,
      binding: { state, unitIds, candidateUnitIds: [.../* @__PURE__ */ new Set([...r.possibleAliasUnitIds || [], ...state === "held" && b ? [b.trackerId, b.nativeUnitId].filter(Boolean) : []])], placementHeld: r.placementHeld === true || reason === "newer_or_undated_source_assignment", matchMethod: b?.matchMethod || null, reason },
      overlayApplied: applied
    };
  });
  if (live) for (const removed of receipt.apiMissingRecords) {
    if (!object2(removed) || !id2(removed.productId) || receipt.records.some((r) => r.productId === removed.productId)) throw Error("Invalid absent Product-ID receipt");
    const b = removed.binding;
    if (!b || b.guardCurrent !== true) continue;
    const targets = [{ id: b.nativeUnitId, label: b.nativeLabel }, { id: b.trackerId, label: b.trackerLabel }].filter((t) => t.id);
    const rows2 = targets.map((t) => byId.get(t.id));
    if (rows2.some((r, i) => !r || r.unitNumber !== targets[i].label) || rows2.some((r) => blockingReason(r, b, audits, identity, stamp2(receipt.receivedAt), rows2, concernKey))) continue;
    for (const row of rows2) if (!changes.has(row.id)) changes.set(row.id, { ...row, uploadLifecycle: "MISSING", uploadActiveInventoryEligible: false, mhelpInventoryReview: "Not returned by the complete mHelpDesk inventory. Saved equipment and history are retained." });
  }
  const inventoryItems = snapshot.inventoryItems.map((r) => changes.get(r.id) || r), priorField = new Set(snapshot.items.map((r) => r.id));
  const items = inventoryItems.filter((r) => changes.has(r.id) ? r.placement === "FIELD" && r.uploadActiveInventoryEligible !== false : priorField.has(r.id));
  const count = (fn) => records.filter(fn).length;
  const uploadInventory = {
    contract: "COS_MHELP_UPLOAD_INVENTORY_V1",
    source,
    sourceSha256: receipt.sourceSha256,
    receivedAt: receipt.receivedAt,
    receivedAtPrecision: receipt.receivedAtPrecision,
    ...live ? { lastApiReadAt: receipt.apiSync?.lastSuccessAt || receipt.receivedAt, missingProductIds: receipt.apiMissingRecords.map((r) => r.productId) } : {},
    exportAsOf: null,
    trackerRecords: receipt.trackerRecords || [],
    trackerSource: receipt.trackerSource || null,
    countBasis: "mhelp_product_records_not_unique_physical_units",
    physicalDeduplication: "incomplete",
    summary: { totalRecords: records.length, fieldRecords: count((r) => r.placement === "FIELD"), shopRecords: count((r) => r.placement === "SHOP"), unflaggedFieldRecords: count((r) => r.placement === "FIELD" && r.uploadLifecycle === "UNFLAGGED"), unflaggedShopRecords: count((r) => r.placement === "SHOP" && r.uploadLifecycle === "UNFLAGGED"), doNotUseRecords: count((r) => r.uploadLifecycle === "DO_NOT_USE"), missingRecords: count((r) => r.uploadLifecycle === "MISSING"), linkedRecords: count((r) => r.binding.state === "linked"), unlinkedRecords: count((r) => r.binding.state === "unlinked"), heldRecords: count((r) => r.binding.state === "held"), appliedRecords: count((r) => r.overlayApplied) },
    records
  };
  const apiSync = receipt.apiSync;
  return { snapshot: { ...snapshot, inventoryItems, items, uploadInventory, ...apiSync?.enabled === true ? { mhelpPlacementSync: { ...snapshot.mhelpPlacementSync || {}, contract: "COS_MHELP_PLACEMENT_V1", inventoryEnabled: true, lastInventorySuccessAt: apiSync.lastSuccessAt || null, errorCode: apiSync.errorCode || snapshot.mhelpPlacementSync?.errorCode || null } } : {} }, authorities };
}

// ../supabase/functions/cos-operations-pages/mhelpEquipmentCsvPreview.ts
var EQUIPMENT_CSV_MAX_BYTES = 2 * 1024 * 1024;
var ID = /^[1-9][0-9]{0,14}$/;
var SHA256 = /^[0-9a-f]{64}$/;
function reject(message) {
  throw new Error(`Invalid mHelpDesk equipment CSV: ${message}`);
}
function value(v, max = 600) {
  if (typeof v !== "string" || v.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f<>]/.test(v)) reject("a cell has unsupported content");
  return v.trim();
}
function normalize(v) {
  return v.trim().replace(/\s+/g, " ").toLowerCase();
}
function equipmentCustomerPlacement(name) {
  const n = normalize(value(name, 250)).replace(/[.]/g, "");
  return /^(?:cameras\s+on\s*site)(?:\s+llc|\s*-\s*test\s+units)?$/.test(n) ? "SHOP" : "FIELD";
}
function validPrior(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) reject("reviewed previous upload missing");
  const prior = v;
  if (prior.contract !== "COS_MHELP_UPLOAD_V1" && prior.contract !== "COS_MHELP_API_V1" || prior.reviewed !== true || typeof prior.sourceSha256 !== "string" || !SHA256.test(prior.sourceSha256) || !Array.isArray(prior.records) || prior.records.length < 1 || prior.records.length > 1e4) reject("reviewed previous upload unavailable");
  if (prior.contract === "COS_MHELP_API_V1" && (prior.origin !== "mhelpdesk_api" || prior.portalId !== "224643" || prior.complete !== true || prior.recordCount !== prior.records.length || !Array.isArray(prior.apiMissingRecords) || typeof prior.payloadSha256 !== "string" || !SHA256.test(prior.payloadSha256))) reject("complete reviewed previous API source unavailable");
  const seen = /* @__PURE__ */ new Set();
  for (const row of prior.records) {
    if (!row || typeof row !== "object" || !ID.test(row.productId) || seen.has(row.productId) || !["FIELD", "SHOP"].includes(row.placement) || !row.sourceAddress || typeof row.sourceAddress !== "object") reject("previous source identities invalid");
    seen.add(row.productId);
  }
  return prior;
}

// src/mhelpInventoryAuthority.ts
var record3 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var nonnegative = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
var product = /^[1-9][0-9]{0,14}$/;
function readMhelpInventoryAuthority(value2, now = Date.now()) {
  if (!record3(value2) || value2.contract !== "COS_MHELP_UPLOAD_INVENTORY_V1" || value2.countBasis !== "mhelp_product_records_not_unique_physical_units" || typeof value2.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value2.sourceSha256) || typeof value2.receivedAt !== "string" || !Number.isFinite(Date.parse(value2.receivedAt)) || !Number.isFinite(now) || Date.parse(value2.receivedAt) > now + 6e4 || !record3(value2.summary) || !Array.isArray(value2.records)) return null;
  const s = value2.summary, records = value2.records;
  if (!nonnegative(s.totalRecords) || !nonnegative(s.fieldRecords) || !nonnegative(s.shopRecords) || !nonnegative(s.unflaggedFieldRecords) || !nonnegative(s.doNotUseRecords) || !nonnegative(s.missingRecords) || s.totalRecords !== records.length || s.totalRecords !== s.fieldRecords + s.shopRecords || s.unflaggedFieldRecords > s.fieldRecords || s.doNotUseRecords + s.missingRecords > s.totalRecords) return null;
  const seen = /* @__PURE__ */ new Set();
  let field = 0, shop = 0, fieldActive = 0, inactive = 0;
  for (const item of records) {
    if (!record3(item) || typeof item.productId !== "string" || !product.test(item.productId) || seen.has(item.productId) || item.recordId !== "mhelp_product:" + item.productId || !["FIELD", "SHOP"].includes(item.placement) || !["UNFLAGGED", "DO_NOT_USE", "MISSING"].includes(item.uploadLifecycle)) return null;
    seen.add(item.productId);
    if (item.placement === "FIELD") {
      field++;
      if (item.uploadLifecycle === "UNFLAGGED") fieldActive++;
    } else shop++;
    if (item.uploadLifecycle !== "UNFLAGGED") inactive++;
  }
  if (field !== s.fieldRecords || shop !== s.shopRecords || fieldActive !== s.unflaggedFieldRecords || inactive !== s.doNotUseRecords + s.missingRecords) return null;
  const live = value2.source === "mhelpdesk_api";
  const observedAt = live ? value2.lastApiReadAt : value2.receivedAt;
  if (typeof observedAt !== "string" || !Number.isFinite(Date.parse(observedAt)) || Date.parse(observedAt) > now + 6e4) return null;
  return {
    total: records.length,
    field,
    shop,
    inactive,
    fieldActive,
    ...live ? { live: true } : {},
    sourceSha256: value2.sourceSha256,
    receivedAt: observedAt,
    // The saved upload is historical evidence, not proof of a live vendor read.
    stale: now - Date.parse(observedAt) > (live ? 45 * 60 * 1e3 : 24 * 60 * 60 * 1e3)
  };
}

// ../supabase/functions/cos-operations-pages/mhelpProductConnectionSource.ts
function currentMhelpProductConnectionCensus(value2, now = Date.now()) {
  const prior = validPrior(value2);
  const original = value2;
  const rows2 = prior.records.map((row) => {
    const r = row, b = r.binding;
    return {
      productId: r.productId,
      recordId: "mhelp_product:" + r.productId,
      placement: r.placement,
      uploadLifecycle: r.lifecycle,
      binding: {
        state: r.placementHeld === true || r.possibleAliasUnitIds?.length || b?.guardCurrent === false ? "held" : b ? "linked" : "unlinked",
        placementHeld: r.placementHeld === true || b?.guardCurrent === false,
        candidateUnitIds: r.possibleAliasUnitIds || []
      }
    };
  });
  const summary = {
    totalRecords: rows2.length,
    fieldRecords: rows2.filter((r) => r.placement === "FIELD").length,
    shopRecords: rows2.filter((r) => r.placement === "SHOP").length,
    unflaggedFieldRecords: rows2.filter((r) => r.placement === "FIELD" && r.uploadLifecycle === "UNFLAGGED").length,
    doNotUseRecords: rows2.filter((r) => r.uploadLifecycle === "DO_NOT_USE").length,
    missingRecords: rows2.filter((r) => r.uploadLifecycle === "MISSING").length
  };
  const census = {
    contract: "COS_MHELP_UPLOAD_INVENTORY_V1",
    countBasis: "mhelp_product_records_not_unique_physical_units",
    sourceSha256: prior.sourceSha256,
    source: original.origin === "mhelpdesk_api" ? "mhelpdesk_api" : "owner_supplied_mhelp_export",
    receivedAt: original.receivedAt,
    lastApiReadAt: original.apiSync?.lastSuccessAt || original.receivedAt,
    summary,
    records: rows2
  };
  if (!readMhelpInventoryAuthority(census, now)) throw Error("Current mHelp product receipt is unavailable.");
  return { census, candidate: prior.records, sourceSha256: prior.sourceSha256 };
}

// src/cameraEvidence.ts
var CAMERA_FRESH_MS = 20 * 60 * 1e3;
function cameraTimestamp(value2, now = Date.now()) {
  if (typeof value2 !== "string") return { at: null, fresh: false };
  const p = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value2);
  const d = p ? new Date(Date.UTC(+p[1], +p[2] - 1, +p[3])) : null;
  const valid = p && d?.getUTCFullYear() === +p[1] && d.getUTCMonth() === +p[2] - 1 && d.getUTCDate() === +p[3] && +p[4] < 24 && +p[5] < 60 && +p[6] < 60;
  const parsed = valid ? Date.parse(value2.replace(/([+-]\d{2})$/, "$1:00")) : NaN;
  return Number.isFinite(parsed) && parsed > 0 && parsed <= now ? { at: new Date(parsed).toISOString(), fresh: now - parsed <= CAMERA_FRESH_MS } : { at: null, fresh: false };
}

// ../supabase/functions/cos-operations-pages/cameraEvidence.ts
var CAMERA_FRESH_MS2 = 20 * 60 * 1e3;
function savedCameraConnection(ip, ports) {
  if (typeof ip !== "string") return void 0;
  const address = ip.replace(/\/32$/, "");
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^(?:0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) return void 0;
  const a = Number(parts[0]), b = Number(parts[1]), c = Number(parts[2]);
  if (a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2)) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113) return void 0;
  return { publicIp: address, ports: Array.isArray(ports) ? [...new Set(ports.filter((p) => typeof p === "number" && Number.isInteger(p) && p >= 1 && p <= 65535))].sort((a2, b2) => a2 - b2) : [] };
}

// src/exactProductConnection.ts
var EXACT_PRODUCT_CONNECTION_CONTRACT = "COS_EXACT_PRODUCT_CONNECTIONS_V2";
var VERIFIED_TRACKER_IP_CONTRACT = "COS_VERIFIED_2027_PRODUCT_IPS_V1";
var TRACKER_CONNECTION_CENSUS_V2 = "COS_VERIFIED_2027_PRODUCT_IPS_V2";
var TRACKER_CONNECTION_HOLDS = ["placement_mismatch", "customer_mismatch", "identity_mismatch", "tracker_restriction"];
var TRACKER_IP_WORKBOOK = "1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA";
var ID2 = /^[1-9][0-9]{0,14}$/;
var HASH = /^[a-f0-9]{64}$/;
var SOURCE_FRESH_MS = 30 * 60 * 1e3;
var object3 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var safeTime = (v, now, windowMs) => {
  if (typeof v !== "string") return null;
  const parsed = Date.parse(v);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= now && now - parsed <= windowMs ? new Date(parsed).toISOString() : null;
};
var unknown = (productId, reason) => ({
  productId,
  status: "unknown",
  basis: "tcp_service_port",
  checkedAt: null,
  resourceId: null,
  reason
});
var publicIp = (value2) => {
  if (typeof value2 !== "string" || !value2 || value2 !== value2.trim()) return null;
  const saved = savedCameraConnection(value2, []);
  return saved?.publicIp === value2 ? value2 : null;
};
var revision2 = (value2) => typeof value2 === "number" && Number.isSafeInteger(value2) && value2 >= 0 ? String(value2) : typeof value2 === "string" && /^(0|[1-9][0-9]*)$/.test(value2) ? value2 : null;
var validPortNonresponseError = (v) => v === void 0 || v === null || v === "timeout" || v === "Connection refused (os error 111)" || v === "Connection timed out (os error 110)";
var completedPortOutcome = (v) => {
  if (!object3(v) || typeof v.online !== "boolean" || v.attempted === false || v.attempted !== void 0 && v.attempted !== true || v.errorCode || v.error_code || v.technicalError) return false;
  const hasLatency = typeof v.latency_ms === "number" && Number.isFinite(v.latency_ms) && v.latency_ms >= 0;
  const measured = Object.hasOwn(v, "latency_ms") && (v.latency_ms === null || hasLatency);
  if (v.online) return (v.error === void 0 || v.error === null) && (v.attempted === true || hasLatency);
  return validPortNonresponseError(v.error) && (v.attempted === true || typeof v.error === "string" && measured);
};
var deviceId = (v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : typeof v === "string" && ID2.test(v) ? v : null;
function completedSavedTcpCheck(device, now = Date.now()) {
  if (device.monitoringEnabled !== true || !deviceId(device.deviceId)) return null;
  const ip = publicIp(device.publicIp), rev = revision2(device.connectionRevision);
  if (!ip || rev === null || !Array.isArray(device.expectedPorts) || !device.expectedPorts.length || device.expectedPorts.length > 128 || !object3(device.portStatus)) return null;
  const ports = device.expectedPorts;
  if (new Set(ports).size !== ports.length || ports.some((v) => !Number.isInteger(v) || v < 1 || v > 65535)) return null;
  const proof = device.portStatus._connection;
  if (!object3(proof) || proof.ip !== ip || revision2(proof.revision) !== rev || !["online", "offline", "verifying"].includes(proof.status) || typeof proof.reachable !== "boolean" || proof.error || proof.errorCode || proof.error_code) return null;
  const observed = cameraTimestamp(proof.checkedAt, now);
  if (!observed.fresh || !observed.at) return null;
  const checkedAt = observed.at;
  const observedPorts = Object.keys(device.portStatus).filter((k) => /^[1-9][0-9]{0,4}$/.test(k) && Number(k) <= 65535);
  if (observedPorts.length !== ports.length || ports.some((p) => !observedPorts.includes(String(p)))) return null;
  const states = ports.map((port) => device.portStatus[String(port)]);
  if (states.some((v) => !completedPortOutcome(v))) return null;
  const responded = states.some((v) => v.online === true);
  if (responded && proof.status === "online" && proof.reachable === true) return {
    status: "online",
    basis: "tcp_service_port",
    checkedAt,
    resourceId: deviceId(device.deviceId),
    reason: "Completed saved TCP/service-port check responded. Camera video is not verified."
  };
  if (!responded && ["offline", "verifying"].includes(proof.status) && proof.reachable === false) return {
    status: "offline",
    basis: "tcp_service_port",
    checkedAt,
    resourceId: deviceId(device.deviceId),
    reason: "Completed saved TCP/service-port check had no response on all configured ports. Camera video is not verified."
  };
  return null;
}
function buildExactProductConnections(acceptedMhelp, tracker, devices, now = Date.now(), resourceMembership) {
  const authority = readMhelpInventoryAuthority(acceptedMhelp, now);
  if (!authority || authority.stale || !object3(tracker) || ![VERIFIED_TRACKER_IP_CONTRACT, TRACKER_CONNECTION_CENSUS_V2].includes(tracker.contract) || tracker.workbookId !== TRACKER_IP_WORKBOOK || tracker.expectedMhelpSourceSha256 !== authority.sourceSha256 || !HASH.test(tracker.expectedMhelpSourceSha256) || !safeTime(tracker.verifiedAt, now, SOURCE_FRESH_MS) || !Array.isArray(tracker.records) || tracker.records.length !== authority.total || !Array.isArray(devices) || devices.length > 1e4) return null;
  const isolated = tracker.contract === TRACKER_CONNECTION_CENSUS_V2;
  if (isolated && (!HASH.test(tracker.trackerSourceSha256) || !/^ServiceItem_List_[0-9]{14}\.csv$/.test(tracker.sourceExport))) return null;
  const products = acceptedMhelp.records;
  const expected = new Map(products.map((p) => [p.productId, p]));
  const byProduct = /* @__PURE__ */ new Map();
  const ipClaims = /* @__PURE__ */ new Map(), sourceRows = /* @__PURE__ */ new Set();
  for (const raw of tracker.records) {
    if (!object3(raw) || typeof raw.productId !== "string" || !ID2.test(raw.productId) || byProduct.has(raw.productId) || raw.recordId !== "mhelp_product:" + raw.productId || !["FIELD", "SHOP"].includes(raw.placement) || !expected.has(raw.productId) || !(raw.publicIp === null || typeof raw.publicIp === "string" && raw.publicIp.length <= 80)) return null;
    const mismatch = expected.get(raw.productId)?.placement !== raw.placement;
    if (isolated) {
      if (!Number.isSafeInteger(raw.sourceRow) || raw.sourceRow < 2 || raw.sourceRow > 12e3 || sourceRows.has(raw.sourceRow) || !Array.isArray(raw.reviewReasons) || new Set(raw.reviewReasons).size !== raw.reviewReasons.length || raw.reviewReasons.some((reason) => !TRACKER_CONNECTION_HOLDS.includes(reason)) || mismatch !== raw.reviewReasons.includes("placement_mismatch")) return null;
      sourceRows.add(raw.sourceRow);
    } else if (mismatch || raw.reviewReasons !== void 0) return null;
    const row = raw;
    byProduct.set(raw.productId, row);
    if (publicIp(row.publicIp)) ipClaims.set(row.publicIp, (ipClaims.get(row.publicIp) || 0) + 1);
  }
  if (byProduct.size !== expected.size || [...expected.keys()].some((id3) => !byProduct.has(id3))) return null;
  const endpoints = /* @__PURE__ */ new Map();
  for (const device of devices) {
    if (!object3(device) || !deviceId(device.deviceId) || !Array.isArray(device.expectedPorts)) return null;
    const ip = publicIp(device.publicIp);
    if (!ip) continue;
    const list = endpoints.get(ip) || [];
    list.push(device);
    endpoints.set(ip, list);
  }
  const items = products.filter((p) => p.placement === "FIELD").map((product2) => {
    const pid = product2.productId, row = byProduct.get(pid);
    if (row.reviewReasons?.length) return unknown(pid, "Current tracker and mHelp source disagree for this Product ID. Placement or identity review is required; no connection status is assigned.");
    if (product2.uploadLifecycle !== "UNFLAGGED") return unknown(pid, "Inactive, Missing or Do Not Use source; no operational connection is claimed.");
    const binding = object3(product2.binding) ? product2.binding : null;
    if (binding?.state === "held" || binding?.placementHeld === true || Array.isArray(binding?.candidateUnitIds) && binding.candidateUnitIds.length > 0)
      return unknown(pid, "Equipment identity or placement is held for review.");
    const ip = publicIp(row.publicIp);
    if (!ip) return unknown(pid, "No verified public tracker IP is available for this Product ID.");
    if (ipClaims.get(ip) !== 1) return unknown(pid, "Another Product ID claims this tracker IP; verify endpoint ownership.");
    const devicesForIp = endpoints.get(ip) || [];
    if (devicesForIp.length !== 1) return unknown(pid, devicesForIp.length ? "More than one saved endpoint claims this tracker IP; verify exact device ownership." : "No saved camera endpoint matches the current tracker IP.");
    const result = completedSavedTcpCheck(devicesForIp[0], now);
    if (!result) return unknown(pid, "No fresh, completed, exact-target TCP/service-port check is available.");
    if (!resourceMembership?.get(pid)?.includes(String(devicesForIp[0].deviceId))) return unknown(pid, "No current verified Product-to-resource membership is available for this saved endpoint.");
    return { productId: pid, ...result };
  });
  if (items.length !== authority.field) return null;
  return { contract: EXACT_PRODUCT_CONNECTION_CONTRACT, sourceSha256: authority.sourceSha256, trackerVerifiedAt: safeTime(tracker.verifiedAt, now, SOURCE_FRESH_MS), items };
}

// ../supabase/functions/_shared/exact-product-producer/model.ts
var ID3 = /^[1-9][0-9]{0,14}$/;
var object4 = (v) => !!v && typeof v === "object" && !Array.isArray(v);
function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (object4(v)) return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
async function digest2(v) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(v)));
  return [...new Uint8Array(bytes)].map((n) => n.toString(16).padStart(2, "0")).join("");
}
function targetsValid(ids) {
  return Array.isArray(ids) && ids.length > 0 && ids.length <= 64 && new Set(ids).size === ids.length && ids.every((id3) => typeof id3 === "string" && ID3.test(id3));
}

// ../supabase/functions/_shared/exact-product-producer/fullSource.ts
var RECEIPT_CONTRACT = "COS_PRODUCT_TCP_RECEIPT_V2";
var PROFILES = Object.freeze({ "Spotter": "spotter", "Solar Spotter": "solar_spotter", "Ranger": "ranger" });
var terminal = (v) => typeof v === "string" && /(?:^|\W)(RETIRED|DECOMMISSIONED|STOLEN|DNU|DO\s+NOT\s+USE|NOT\s+IN\s+USE)(?:$|\W)/i.test(v);
var decimal2 = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? String(v) : typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v) ? v : null;
var same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function localDevice(d) {
  const id3 = decimal2(d.id), revision3 = decimal2(d.connection_revision), ip = directPublicHost(d.public_ip);
  const ports = d.expected_ports;
  if (!id3 || id3 === "0" || revision3 === null || !ip || ip !== d.public_ip || !Array.isArray(ports) || !ports.length || ports.length > 32 || ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535) || new Set(ports).size !== ports.length) return null;
  if (!["source", "monitoring_profile", "activation_state", "unit_key", "device_name", "organization"].every((k) => typeof d[k] === "string") || typeof d.monitoring_enabled !== "boolean") return null;
  return {
    id: id3,
    revision: revision3,
    ip,
    ports: [...ports],
    profile: d.monitoring_profile,
    source: d.source,
    enabled: d.monitoring_enabled,
    activation: d.activation_state,
    unitKey: d.unit_key,
    name: d.device_name,
    organization: d.organization,
    externalId: d.external_device_id ?? null,
    serial: d.device_serial ?? null,
    type: d.device_type ?? null
  };
}
async function buildProductGroups(source, ids, now = Date.now(), review) {
  if (!targetsValid(ids) || source.complete !== true || !Number.isFinite(Date.parse(source.verifiedAt)) || Date.parse(source.verifiedAt) > now || now - Date.parse(source.verifiedAt) > 3e4) throw Error("Complete current source required");
  if (source.upload.contract !== "COS_MHELP_API_V1" || source.tracker.contract !== TRACKER_CONNECTION_CENSUS_V2) throw Error("Complete API and 2027 source required");
  validateOwnerIdentitySnapshot(source.identitySources.ownerCrosswalk);
  const identity = await verifiedHealthIdentities(source.identitySources, review);
  const projected = projectMhelpUploadPlacement(source.map, source.upload, source.identitySources.audits, identity, now).snapshot.uploadInventory;
  const minimal = currentMhelpProductConnectionCensus(source.upload, now);
  if (!projected || projected.sourceSha256 !== minimal.sourceSha256) throw Error("Source projection changed");
  const admission = buildExactProductConnections(projected, source.tracker, [], now);
  if (!admission) throw Error("Current complete tracker authority unavailable");
  const rows2 = source.identitySources.devices, allIdentities = [...identity.unitIdentities, ...identity.ownerConfirmedUnitIdentities || []];
  if (new Set(rows2.map((d) => String(d.id))).size !== rows2.length) throw Error("Duplicate device IDs");
  const sourceGuard = await digest2({
    sourceSha256: source.upload.sourceSha256,
    payloadSha256: source.upload.payloadSha256,
    records: source.upload.records,
    apiMissingRecords: source.upload.apiMissingRecords,
    scopedRevision: source.upload.scopedRevision ?? null,
    trackerSha256: source.tracker.trackerSourceSha256,
    trackerRecords: source.tracker.records,
    crosswalk: source.identitySources.ownerCrosswalk ?? null,
    epochs: source.identitySources.ownerEpochs ?? [],
    identities: identity,
    inventory: source.map.inventoryItems
  });
  const groups = [], held = [];
  for (const productId of ids) {
    const hold = (reason) => held.push({ productId, reason });
    const gate = admission.items.find((p) => p.productId === productId);
    if (gate?.reason !== "No saved camera endpoint matches the current tracker IP.") {
      hold("source_or_ip_claim_hold");
      continue;
    }
    const record4 = projected.records.find((r) => r.productId === productId), raw = source.upload.records.find((r) => r.productId === productId), b = raw?.binding;
    const binding = record4?.binding;
    if (!b || b.guardCurrent !== true || binding?.state !== "linked" || binding.placementHeld || binding.reason || binding.candidateUnitIds?.length || !Array.isArray(binding.unitIds) || binding.unitIds.length !== 1 || binding.unitIds[0] !== b.nativeUnitId) {
      const code = !b ? "binding_absent" : b.guardCurrent !== true ? "guard_not_current" : binding?.state !== "linked" ? "projection_not_linked" : binding.placementHeld ? "placement_held" : binding.reason ? "projection_reason_present" : binding.candidateUnitIds?.length ? "alias_candidates_present" : "represented_membership_mismatch";
      held.push({ productId, reason: "product_native_binding_hold", diagnostic: { stage: "product_native_binding", code } });
      continue;
    }
    const native = source.identitySources.units.filter((u) => u.id === b.nativeUnitId);
    if (native.length !== 1 || typeof native[0].status !== "string" || ["retired", "deleted"].includes(native[0].status) || terminal(native[0].status)) {
      hold("native_lifecycle_hold");
      continue;
    }
    const proof = allIdentities.filter((i) => i.unitId === b.nativeUnitId);
    if (proof.length !== 1 || identity.identityWarnings.some((w) => w.unitId === b.nativeUnitId) || proof[0].deviceIds.length < 1 || proof[0].deviceIds.length > 16) {
      hold("reviewed_complete_identity_required");
      continue;
    }
    const family = raw.category, profile = PROFILES[family];
    if (!profile) {
      hold("family_protocol_unreviewed");
      continue;
    }
    const members = rows2.filter((d) => proof[0].deviceIds.includes(String(d.id))), devices = members.map(localDevice);
    const ip = source.tracker.records.find((r) => r.productId === productId)?.publicIp;
    const allAtIp = rows2.filter((d) => directPublicHost(d.public_ip) === ip);
    if (members.length !== proof[0].deviceIds.length || allAtIp.length !== members.length || allAtIp.some((d) => !proof[0].deviceIds.includes(String(d.id)))) {
      hold("endpoint_group_conflict");
      continue;
    }
    if (devices.some((d) => !d || d.ip !== ip || !d.enabled || d.profile !== profile || d.source !== "vigilant_control_center" || !["active", "deactivated"].includes(d.activation) || [d.activation, d.unitKey, d.name, d.organization].some(terminal))) {
      hold("endpoint_configuration_or_lifecycle_hold");
      continue;
    }
    const valid = devices;
    if (valid.some((d) => !same([...d.ports].sort((a, b2) => a - b2), [...valid[0].ports].sort((a, b2) => a - b2)))) {
      hold("group_port_set_mismatch");
      continue;
    }
    valid.sort((a, b2) => BigInt(a.id) < BigInt(b2.id) ? -1 : 1);
    const resourceEpochs = (source.identitySources.ownerEpochs ?? []).filter((e) => proof[0].unitKeys.includes(e.unitKey));
    if (resourceEpochs.length !== proof[0].unitKeys.length || new Set(resourceEpochs.map((e) => e.unitKey)).size !== resourceEpochs.length || resourceEpochs.some((e) => !/^[a-f0-9]{64}$/.test(e.epoch) || !Array.isArray(e.deviceIds) || new Set(e.deviceIds).size !== e.deviceIds.length || !same([...e.deviceIds].sort(), valid.filter((d) => d.unitKey === e.unitKey).map((d) => d.id).sort()))) {
      hold("current_resource_epoch_required");
      continue;
    }
    const nativeEpoch = source.identitySources.ownerCrosswalk.nativeEpochs?.find((e) => e.unitId === b.nativeUnitId)?.epoch ?? null;
    const identityGuard = await digest2(proof[0]), epochGuard = await digest2(resourceEpochs);
    const authorityGuard = await digest2({ sourceGuard, identityGuard, binding: b, devices: valid });
    groups.push({
      contract: RECEIPT_CONTRACT,
      productId,
      nativeUnitId: b.nativeUnitId,
      family,
      authorityGuard,
      identityGuard,
      bindingGuard: b.expectedGuard,
      sourceSha256: source.upload.sourceSha256,
      trackerSha256: source.tracker.trackerSourceSha256,
      crosswalkRevision: source.identitySources.ownerCrosswalk.revision,
      epochGuard,
      resourceEpochs,
      nativeEpoch,
      verifiedAt: source.verifiedAt,
      devices: valid
    });
  }
  return { groups, held };
}

// ../supabase/functions/_shared/exact-product-producer/fleetReadPlan.ts
var FLEET_RECEIPT_LIMIT = 100;
function fleetReadTargets(ids) {
  return Array.isArray(ids) && ids.length > 0 && ids.length <= FLEET_RECEIPT_LIMIT && new Set(ids).size === ids.length && ids.every((_, i) => i % 64 !== 0 || targetsValid(ids.slice(i, i + 64)));
}
function freezeSnapshot(value2) {
  if (value2 && typeof value2 === "object" && !Object.isFrozen(value2)) {
    Object.freeze(value2);
    for (const child of Object.values(value2)) freezeSnapshot(child);
  }
  return value2;
}
async function buildFleetReadPlan(source, ids, now, review) {
  if (!fleetReadTargets(ids)) throw Error("Bounded fleet IDs required");
  const snapshot = freezeSnapshot(structuredClone(source)), groups = [], held = [];
  for (let i = 0; i < ids.length; i += 64) {
    const plan = await buildProductGroups(snapshot, ids.slice(i, i + 64), now, review);
    groups.push(...plan.groups);
    held.push(...plan.held);
  }
  return { groups, held };
}

// ../supabase/functions/_shared/exact-product-producer/sourceReader.ts
var ORG = "ece6d2a2-fd19-4cc7-b56a-2fa004a6d8f5";
var DEVICE_FIELDS = "id,external_device_id,device_serial,device_name,device_type,organization,unit_key,public_ip,expected_ports,connection_revision,source,activation_state,monitoring_enabled,monitoring_profile";
function createProtectedSourceReader(io, now = Date.now) {
  return async (signal) => {
    const deadline = now() + 2e4;
    const call = (fn) => boundedRequest(async (s) => {
      if (signal.aborted) throw Error("Cancelled");
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal.addEventListener("abort", cancel, { once: true });
      s.addEventListener("abort", cancel, { once: true });
      try {
        return await fn(controller.signal);
      } finally {
        signal.removeEventListener("abort", cancel);
        s.removeEventListener("abort", cancel);
        controller.abort();
      }
    }, deadline, now, 2e4);
    const all = async (read, path) => {
      const rows2 = [];
      for (let offset = 0; offset < 1e4; offset += 1e3) {
        const page = await call((s) => read(path + "&limit=1000&offset=" + offset, s));
        if (!Array.isArray(page) || page.length > 1e3 || page.some((r) => !r || typeof r !== "object" || Array.isArray(r))) throw Error("Incomplete source");
        rows2.push(...page);
        if (page.length < 1e3) return rows2;
      }
      throw Error("Truncated source");
    };
    const [beforeReceipt, crosswalk] = await Promise.all([call((s) => io.platformRpc("cos_mhelp_placement_snapshot", s)), call((s) => io.platformRpc("cos_owner_identity_snapshot", s))]);
    validateOwnerIdentitySnapshot(crosswalk);
    const before = beforeReceipt.upload;
    const census = currentMhelpProductConnectionCensus(before, now());
    const seed = await all(io.legacyRead, "camera_devices?select=" + DEVICE_FIELDS + "&order=id.asc");
    const sourceKeys = (rows2) => [.../* @__PURE__ */ new Set([...crosswalk.claims.map((c) => c.legacy_unit_key), ...rows2.map((d) => d.unit_key).filter((k) => typeof k === "string" && k.length > 0)])].sort();
    const keys = sourceKeys(seed);
    if (keys.length > 1e3 || keys.some((k) => k !== k.trim() || k.length > 250)) throw Error("Unbounded identity epoch source");
    const epochsBefore = keys.length ? await call((s) => io.legacyEpochs(keys, s)) : [];
    const [devices, units, matches, providers, audits, map, tracker] = await Promise.all([
      all(io.legacyRead, "camera_devices?select=" + DEVICE_FIELDS + "&order=id.asc"),
      all(io.platformRead, "equipment_units?select=id,organization_id,unit_number,status&organization_id=eq." + ORG + "&order=id.asc"),
      all(io.platformRead, "vision_vigilant_unit_matches?select=id,organization_id,equipment_unit_id,vigilant_device_id,camera_key,match_method,confidence&organization_id=eq." + ORG + "&order=id.asc"),
      all(io.platformRead, "vision_vigilant_devices?select=id,organization_id,external_device_id,device_name,device_type,source&organization_id=eq." + ORG + "&order=id.asc"),
      call((s) => io.placementAudits(s)),
      call((s) => io.platformRpc("appdeploy_field_map_snapshot", s)),
      call((s) => io.tracker(census.candidate, census.sourceSha256, s))
    ]);
    const [afterReceipt, afterCrosswalk, epochsAfter] = await Promise.all([call((s) => io.platformRpc("cos_mhelp_placement_snapshot", s)), call((s) => io.platformRpc("cos_owner_identity_snapshot", s)), keys.length ? call((s) => io.legacyEpochs(keys, s)) : Promise.resolve([])]);
    validateOwnerIdentitySnapshot(afterCrosswalk);
    if (JSON.stringify(keys) !== JSON.stringify(sourceKeys(devices))) throw Error("Identity membership changed during source read");
    if (await digest2(before) !== await digest2(afterReceipt.upload) || await digest2(crosswalk) !== await digest2(afterCrosswalk) || await digest2(epochsBefore) !== await digest2(epochsAfter)) throw Error("Source changed during complete read");
    if (signal.aborted || now() >= deadline) throw Error("Source deadline");
    return { complete: true, upload: before, map, tracker, verifiedAt: new Date(now()).toISOString(), identitySources: { devices, units, matches, providers, audits, ownerCrosswalk: crosswalk, ownerEpochs: epochsAfter } };
  };
}

// ../supabase/functions/_shared/exact-product-producer/attestationTransport.ts
function createProductProofHandler(options = {}) {
  return async (request) => {
    const reply = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    if (options.enabled !== true || !options.bindExistingContext) return reply({ error: "Product proof extension disabled." }, 503);
    if (request.method !== "POST" || new URL(request.url).search || !request.headers.get("Content-Type")?.startsWith("application/json")) return reply({ error: "Bounded POST required." }, 405);
    let authorized = false, stage = "preview_request", code = "invalid_request";
    try {
      const io = await cancellableIo(Date.now() + 4e3, Date.now, request.signal).request(() => options.bindExistingContext(request));
      if (!io) return reply({ error: "Unauthorized." }, 403);
      authorized = true;
      const reader = request.body?.getReader();
      if (!reader) throw Error();
      let text4 = "", size = 0;
      const decoder = new TextDecoder(), deadline = Date.now() + 4e3;
      try {
        for (; ; ) {
          const part = await cancellableIo(deadline, Date.now, request.signal).request(() => reader.read());
          if (part.done) break;
          size += part.value.length;
          if (size > 4096) throw Error();
          text4 += decoder.decode(part.value, { stream: true });
        }
        text4 += decoder.decode();
      } finally {
        void reader.cancel().catch(() => {
        });
      }
      const body = JSON.parse(text4);
      if (!body || Object.keys(body).length !== 1 || !fleetReadTargets(body.productIds) || options.preview === true && body.productIds.length > 8) throw Error();
      stage = "preview_source";
      code = "source_unavailable";
      const now = options.now ?? Date.now, source = await cancellableIo(now() + 2e4, now, request.signal).request((signal) => createProtectedSourceReader(io, now)(signal), 2e4);
      stage = "preview_evaluation";
      code = "source_validation_failed";
      const plan = await buildFleetReadPlan(source, body.productIds, now());
      if (request.signal.aborted) throw Error("Cancelled");
      if (options.preview === true) return reply({
        contract: "COS_PRODUCT_TCP_PREVIEW_V1",
        productIds: body.productIds,
        held: plan.held,
        groups: plan.groups.map((g) => ({
          productId: g.productId,
          nativeUnitId: g.nativeUnitId,
          family: g.family,
          authorityGuard: g.authorityGuard,
          sourceSha256: g.sourceSha256,
          trackerSha256: g.trackerSha256,
          identityGuard: g.identityGuard,
          bindingGuard: g.bindingGuard,
          epochGuard: g.epochGuard,
          crosswalkRevision: g.crosswalkRevision,
          verifiedAt: g.verifiedAt,
          devices: g.devices.map((d) => ({ id: d.id, ip: d.ip, ports: d.ports, revision: d.revision, profile: d.profile }))
        }))
      });
      return reply({ contract: "COS_PRODUCT_TCP_SOURCE_V2", productIds: body.productIds, ...plan });
    } catch {
      return reply({ error: "Current complete source unavailable.", ...authorized && options.preview === true ? { diagnostic: { stage, code } } : {} }, 409);
    }
  };
}
function createProductPreviewHandler(options = {}) {
  return createProductProofHandler({ ...options, preview: true });
}

// ../supabase/functions/cos-operations-pages/unitTracker.ts
var UNIT_TRACKER_WORKBOOK = "1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA";
var UNIT_TRACKER_CONNECTOR = Object.freeze({ enabled: false, state: "awaiting_sheets_connection" });

// ../supabase/functions/cos-operations-pages/googleSheets.ts
var TOKEN_URL = "https://oauth2.googleapis.com/token";
var TRACKER_TABS = Object.freeze([
  { id: 568394918, title: "SOLAR SPOTTERS", columns: 2, headers: ["UNIT #", "PLACEMENT"] },
  { id: 2017346590, title: "SPOTTERS", columns: 2, headers: ["UNIT #", "PLACEMENT"] },
  { id: 426115083, title: "HELIOS", columns: 2, headers: ["UNIT #", "PLACEMENT"] },
  { id: 386511683, title: "RANGERS", columns: 2, headers: ["UNIT #", "PLACEMENT"] },
  { id: 826256700, title: "SNIPERS", columns: 2, headers: ["UNIT #", "PLACEMENT"] },
  { id: 651684134, title: "CAM V & RSU", columns: 2, headers: ["UNIT #", "PLACEMENT"] },
  { id: 451969219, title: "RECONS", columns: 2, headers: ["UNIT #", "PLACEMENT"] },
  { id: 135363149, title: "RECON II", columns: 2, headers: ["UNIT #", "PLACEMENT"] },
  { id: 1975227208, title: "SOLAR STANDS 72", columns: 2, headers: ["UNIT #", "PLACEMENT"] },
  // Its second column is an installation date, not placement. Never infer it.
  { id: 828079282, title: "SOLAR POLES & SKIDS", columns: 1, headers: ["Unit"] }
]);
var object5 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var SheetsConnectionError = class extends Error {
  constructor(message, status = 503) {
    super(message);
    this.status = status;
    this.name = "SheetsConnectionError";
  }
};
var fail3 = (message, status = 503) => {
  throw new SheetsConnectionError(message, status);
};
function account(raw) {
  if (raw === void 0 || raw === null || raw === "") return null;
  if (typeof raw !== "string" || raw.length > 32768) return fail3("The Google service-account secret needs correction in Supabase.");
  let v;
  try {
    v = JSON.parse(raw);
  } catch {
    return fail3("The Google service-account secret must be the complete JSON key file.");
  }
  if (!object5(v) || v.type !== "service_account" || typeof v.client_email !== "string" || v.client_email.length > 254 || !/^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9.-]*\.iam\.gserviceaccount\.com$/.test(v.client_email) || v.token_uri !== TOKEN_URL || typeof v.private_key_id !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(v.private_key_id) || typeof v.private_key !== "string" || v.private_key.length > 16384 || !/^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----\n?$/.test(v.private_key))
    fail3("Use a Google service-account JSON key, not a password, API key, or mHelpDesk token.");
  return { client_email: v.client_email, private_key: v.private_key, private_key_id: v.private_key_id };
}
async function boundedJson(response, limit, signal) {
  if (signal.aborted) fail3("The Sheets connection check timed out. Retry the check.");
  const declared = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel();
    fail3("Google returned an oversized connection response.");
  }
  const reader = response.body?.getReader();
  if (!reader) return fail3("Google returned an incomplete connection response.");
  const chunks = [];
  let size = 0;
  const abort = () => {
    void reader.cancel().catch(() => {
    });
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      const { value: value2, done } = await reader.read();
      if (signal.aborted) fail3("The Sheets connection check timed out. Retry the check.");
      if (done) break;
      size += value2.byteLength;
      if (size > limit) fail3("Google returned an oversized connection response.");
      chunks.push(value2);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.byteLength;
    }
    let v;
    try {
      v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return fail3("Google returned an unreadable connection response.");
    }
    if (!object5(v)) fail3("Google returned an incomplete connection response.");
    return v;
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {
    });
  }
}

// ../supabase/functions/cos-operations-pages/mhelp2027ConnectionCensus.ts
var ID4 = /^[1-9][0-9]{0,14}$/;
var HASH2 = /^[a-f0-9]{64}$/;
var object6 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
var normalized2 = (v) => v.trim().replace(/\s+/g, " ").toLowerCase();
var fail4 = () => {
  throw Error("Protected 2027 Product-ID/IP evidence is unavailable or changed.");
};
var rangeSpec = (v) => {
  if (typeof v !== "string") return null;
  const m = /^(?:'([^']+)'|([^!]+))!([A-Z]+)([1-9][0-9]*):([A-Z]+)([1-9][0-9]*)$/.exec(v);
  return m ? { sheet: m[1] || m[2], fromCol: m[3], fromRow: Number(m[4]), toCol: m[5], toRow: Number(m[6]) } : null;
};
var col = (v) => [...v].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
function rows(value2, expectedRange) {
  const expected = rangeSpec(expectedRange), actual = object6(value2) ? rangeSpec(value2.range) : null;
  if (!expected || !actual || !object6(value2) || actual.sheet !== expected.sheet || actual.fromCol !== expected.fromCol || actual.toCol !== expected.toCol || actual.fromRow !== expected.fromRow || actual.toRow > expected.toRow || actual.toRow < actual.fromRow || value2.majorDimension !== "ROWS" || !Array.isArray(value2.values) || value2.values.length > actual.toRow - actual.fromRow + 1) return fail4();
  const width = col(expected.toCol) - col(expected.fromCol) + 1;
  return value2.values.map((row) => {
    if (!Array.isArray(row) || row.length > width || row.some((v) => v !== null && (typeof v !== "string" || v.length > 600))) return fail4();
    return row.map((v) => v === null ? "" : v);
  });
}
async function verify2027ConnectionCensus(valueRanges, rangeNames, candidate, expectedMhelpSourceSha256, verifiedAt) {
  if (!Array.isArray(valueRanges) || valueRanges.length !== 7 || rangeNames.length !== 7 || !HASH2.test(expectedMhelpSourceSha256) || !Number.isFinite(Date.parse(verifiedAt)) || !Array.isArray(candidate) || !candidate.length || candidate.length > 1e4) return fail4();
  const boundaries = [
    ["UNIT OVERVIEW", "A", "E"],
    ["UNIT OVERVIEW", "O", "O"],
    ["UNIT OVERVIEW", "Q", "R"],
    ["MHELP MATCH INDEX", "A", "B"],
    ["MHELP MATCH INDEX", "D", "E"],
    ["MHELP MATCH INDEX", "H", "H"],
    ["UNIT OVERVIEW", "H", "H"]
  ];
  rangeNames.forEach((name, i) => {
    const s = rangeSpec(name), b = boundaries[i];
    if (!s || s.sheet !== b[0] || s.fromCol !== b[1] || s.toCol !== b[2] || s.fromRow !== 1 || s.toRow > 12e3) return fail4();
  });
  const [info, ids, placement, indexIds, indexDetails, exports, ips] = valueRanges.map((v, i) => rows(v, rangeNames[i]));
  if (info[0]?.[0] !== "EQUIPMENT TYPE" || info[0]?.[1] !== "UNIT #" || info[0]?.[2] !== "PLACEMENT" || info[0]?.[4] !== "CUSTOMER" || ids[0]?.[0] !== "MHELP EQUIPMENT ID" || placement[0]?.[0] !== "TRACKER PLACEMENT" || placement[0]?.[1] !== "MHELP PLACEMENT" || indexIds[0]?.[0] !== "TRACKER MATCH KEY" || indexIds[0]?.[1] !== "MHELP EQUIPMENT ID" || indexDetails[0]?.[0] !== "MHELP EQUIPMENT NAME" || indexDetails[0]?.[1] !== "MHELP CUSTOMER / SITE" || exports[0]?.[0] !== "MHELP SOURCE EXPORT" || ips[0]?.[0] !== "IP" || ips.length > ids.length) return fail4();
  const expected = /* @__PURE__ */ new Map();
  for (const r of candidate) {
    const sourceRow = r;
    if (!object6(r) || !ID4.test(r.productId) || expected.has(r.productId) || !["FIELD", "SHOP"].includes(r.placement) || typeof r.customer !== "string" || !r.customer.trim() || typeof r.unitNumber !== "string" || !r.unitNumber.trim()) return fail4();
    expected.set(r.productId, sourceRow);
  }
  const indexed = /* @__PURE__ */ new Map();
  let sourceExport = null;
  for (let i = 1; i < Math.max(indexIds.length, indexDetails.length, exports.length); i++) {
    const a = indexIds[i] || [], d = indexDetails[i] || [], e = exports[i] || [];
    if (![...a, ...d, ...e].some((v) => v.trim())) continue;
    if (!a[0] || !ID4.test(a[1]) || indexed.has(a[1]) || !d[0] || !d[1] || !/^ServiceItem_List_[0-9]{14}\.csv$/.test(e[0])) return fail4();
    if (sourceExport !== null && sourceExport !== e[0]) return fail4();
    sourceExport = e[0];
    indexed.set(a[1], { key: a[0], model: d[0], customer: d[1] });
  }
  const records = [], seen = /* @__PURE__ */ new Set();
  for (let i = 1; i < Math.max(info.length, ids.length, placement.length, ips.length); i++) {
    const a = info[i] || [], id3 = ids[i]?.[0] || "", p = placement[i] || [], ip = ips[i]?.[0] || "";
    if (![...a, id3, ...p, ip].some((v) => v.trim())) continue;
    const [family, label, currentPlacement, , customer] = a;
    if (!family || !label || !customer || !ID4.test(id3) || seen.has(id3) || !expected.has(id3) || !indexed.has(id3) || !["FIELD", "SHOP"].includes(currentPlacement) || !p[0] || ip.length > 80) return fail4();
    seen.add(id3);
    const source = expected.get(id3), index2 = indexed.get(id3);
    if (index2.key !== family + "|" + label) return fail4();
    const reviewReasons = [];
    if (currentPlacement !== source.placement) reviewReasons.push("placement_mismatch");
    if (normalized2(customer) !== normalized2(source.customer) || normalized2(index2.customer) !== normalized2(source.customer) || equipmentCustomerPlacement(customer) !== currentPlacement) reviewReasons.push("customer_mismatch");
    if (normalized2(index2.model) !== normalized2(source.unitNumber)) reviewReasons.push("identity_mismatch");
    if (p[0] !== currentPlacement || Boolean(p[1]) && p[1] !== currentPlacement) reviewReasons.push("tracker_restriction");
    records.push({
      productId: id3,
      recordId: "mhelp_product:" + id3,
      placement: currentPlacement,
      publicIp: ip.trim() || null,
      reviewReasons,
      sourceRow: i + 1
    });
  }
  if (!sourceExport || records.length !== expected.size || indexed.size !== expected.size || [...expected.keys()].some((id3) => !seen.has(id3) || !indexed.has(id3))) return fail4();
  const bytes = new TextEncoder().encode(JSON.stringify({ rangeNames, sourceExport, records }));
  const trackerSourceSha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
  return {
    contract: TRACKER_CONNECTION_CENSUS_V2,
    workbookId: TRACKER_IP_WORKBOOK,
    expectedMhelpSourceSha256,
    verifiedAt,
    trackerSourceSha256,
    sourceExport,
    records
  };
}

// ../supabase/functions/cos-operations-pages/mhelp2027ProductIpReader.ts
var TOKEN_URL2 = "https://oauth2.googleapis.com/token";
var SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
var OVERVIEW = { id: 1132540236, title: "UNIT OVERVIEW" };
var INDEX = { id: 1900169011, title: "MHELP MATCH INDEX" };
var failure = () => {
  throw Error("Protected 2027 Product-ID/IP evidence is unavailable or changed.");
};
async function read2027ProductIpsFromGoogle(options) {
  if (!/^[a-f0-9]{64}$/.test(options.expectedMhelpSourceSha256) || !Array.isArray(options.candidate) || !options.candidate.length || options.candidate.length > 1e4) return failure();
  const at = options.now ?? Date.now, requestFetch = options.fetch ?? fetch;
  let account2;
  try {
    account2 = account(options.getServiceAccountJson());
  } catch {
    return failure();
  }
  if (!account2 || !options.signAssertion) return failure();
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 2e4);
  try {
    const issuedAt = Math.floor(at() / 1e3);
    let assertion;
    try {
      assertion = await options.signAssertion(
        account2.private_key,
        { alg: "RS256", typ: "JWT", kid: account2.private_key_id },
        { iss: account2.client_email, aud: TOKEN_URL2, iat: issuedAt, exp: issuedAt + 3600, scope: SCOPE }
      );
    } catch {
      return failure();
    }
    if (typeof assertion !== "string" || assertion.length > 16384 || !/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(assertion)) return failure();
    const read = async (uri, limit, token) => {
      const response = await requestFetch(uri, { method: "GET", headers: { Authorization: "Bearer " + token, Accept: "application/json" }, signal: controller.signal, redirect: "error", cache: "no-store" });
      if (!response.ok) return failure();
      return boundedJson(response, limit, controller.signal);
    };
    const authorization = await requestFetch(TOKEN_URL2, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
      signal: controller.signal,
      redirect: "error",
      cache: "no-store"
    });
    if (!authorization.ok) return failure();
    const signed = await boundedJson(authorization, 32768, controller.signal);
    if (typeof signed.access_token !== "string" || !signed.access_token || signed.access_token.length > 16384 || /\s/.test(signed.access_token) || signed.token_type !== "Bearer") return failure();
    const base = "https://sheets.googleapis.com/v4/spreadsheets/" + UNIT_TRACKER_WORKBOOK;
    const metadata = await read(base + "?fields=" + encodeURIComponent("spreadsheetId,properties(title),sheets(properties(sheetId,title,sheetType,hidden,gridProperties(rowCount,columnCount)))"), 25e4, signed.access_token);
    if (metadata.spreadsheetId !== UNIT_TRACKER_WORKBOOK || metadata.properties?.title !== "2027 UNIT TRACKER" || !Array.isArray(metadata.sheets)) return failure();
    const count = /* @__PURE__ */ new Map();
    for (const expected of [OVERVIEW, INDEX]) {
      const matches = metadata.sheets.filter((s) => s?.properties?.sheetId === expected.id), p = matches[0]?.properties;
      if (matches.length !== 1 || p.title !== expected.title || p.hidden === true || p.sheetType !== "GRID" || !Number.isSafeInteger(p.gridProperties?.rowCount) || p.gridProperties.rowCount < options.candidate.length + 1 || p.gridProperties.rowCount > 12e3 || p.gridProperties.columnCount < (expected.id === INDEX.id ? 9 : 19)) return failure();
      count.set(expected.title, p.gridProperties.rowCount);
    }
    const n = count.get(OVERVIEW.title), m = count.get(INDEX.title);
    const names = [
      `'UNIT OVERVIEW'!A1:E${n}`,
      `'UNIT OVERVIEW'!O1:O${n}`,
      `'UNIT OVERVIEW'!Q1:R${n}`,
      `'MHELP MATCH INDEX'!A1:B${m}`,
      `'MHELP MATCH INDEX'!D1:E${m}`,
      `'MHELP MATCH INDEX'!H1:H${m}`,
      `'UNIT OVERVIEW'!H1:H${n}`
    ];
    const query = new URLSearchParams();
    for (const name of names) query.append("ranges", name);
    query.set("valueRenderOption", "FORMATTED_VALUE");
    const result = await read(base + "/values:batchGet?" + query, 22e5, signed.access_token);
    if (!Array.isArray(result.valueRanges) || result.valueRanges.length !== 7) return failure();
    return verify2027ConnectionCensus(result.valueRanges, names, options.candidate, options.expectedMhelpSourceSha256, new Date(at()).toISOString());
  } catch {
    return failure();
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

// ../supabase/functions/_shared/exact-product-producer/nativeContextAdapter.ts
function existingNativeProductSourceContext(options) {
  const source = { ...options.source, tracker: async (candidate, sourceSha256, signal) => {
    const requestFetch = async (input, init = {}) => {
      if (signal.aborted) throw Error("Source cancelled");
      const controller = new AbortController(), abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      init.signal?.addEventListener("abort", abort, { once: true });
      if (init.signal?.aborted) controller.abort();
      try {
        return await options.googleSheets.fetch(input, { ...init, signal: controller.signal });
      } finally {
        signal.removeEventListener("abort", abort);
        init.signal?.removeEventListener("abort", abort);
      }
    };
    return await read2027ProductIpsFromGoogle({ ...options.googleSheets, fetch: requestFetch, candidate, expectedMhelpSourceSha256: sourceSha256, now: options.now });
  } };
  return source;
}

// ../supabase/functions/_shared/exact-product-producer/statusIntegration.ts
var eligible = /* @__PURE__ */ new Set(["No fresh, completed, exact-target TCP/service-port check is available.", "More than one saved endpoint claims this tracker IP; verify exact device ownership."]);
var SCOPED_READ_WINDOW_MS = 6500;
var PRODUCT_RESPONSE_CUTOFF_MS = 3e4 - SCOPED_READ_WINDOW_MS;
async function integrateScopedConnections(base, options, review) {
  const now = options.now ?? Date.now, ids = base.items.filter((i) => i.status === "unknown" && eligible.has(i.reason)).map((i) => i.productId);
  if (!ids.length) return base;
  const started = now(), deadline = Math.min(started + SCOPED_READ_WINDOW_MS, (options.requestStartedAt ?? started) + PRODUCT_RESPONSE_CUTOFF_MS);
  if (options.signal?.aborted || started >= deadline) return base;
  const controller = new AbortController();
  let timer;
  let stop;
  const canceled = new Promise((resolve) => {
    stop = () => {
      controller.abort();
      resolve(base);
    };
    timer = setTimeout(stop, deadline - started);
  });
  options.signal?.addEventListener("abort", stop, { once: true });
  const check = () => {
    if (controller.signal.aborted || now() < started || now() >= deadline) throw Error("Optional receipt budget expired");
  };
  const read = async (fn) => {
    check();
    const result = await fn(controller.signal);
    check();
    return result;
  };
  const work = async () => {
    try {
      const before = await read(options.readSource);
      if (before.upload.sourceSha256 !== base.sourceSha256) return base;
      const plans = async (source) => {
        const groups = [];
        for (let i = 0; i < ids.length; i += 64) {
          check();
          groups.push(...(await buildProductGroups(source, ids.slice(i, i + 64), now(), review)).groups);
          check();
        }
        return new Map(groups.map((g) => [g.productId, g]));
      };
      const first = await plans(before), statuses = /* @__PURE__ */ new Map();
      for (let i = 0, selected = [...first.keys()]; i < selected.length; i += FLEET_RECEIPT_LIMIT) {
        const batch = selected.slice(i, i + FLEET_RECEIPT_LIMIT), rows2 = await read((signal) => options.readStatuses(batch, signal));
        if (!Array.isArray(rows2) || rows2.length !== batch.length || new Set(rows2.map((r) => r.productId)).size !== batch.length || rows2.some((r) => !batch.includes(r.productId))) return base;
        for (const row of rows2) statuses.set(row.productId, row);
      }
      const after = await read(options.readSource);
      if (after.upload.sourceSha256 !== base.sourceSha256) return base;
      const current = await plans(after);
      check();
      return { ...base, items: base.items.map((item) => {
        const a = first.get(item.productId), b = current.get(item.productId), r = statuses.get(item.productId);
        if (!a || !b || !r || a.authorityGuard !== b.authorityGuard || r.authorityGuard !== b.authorityGuard || r.sourceSha256 !== base.sourceSha256 || r.trackerSha256 !== b.trackerSha256 || r.resourceId !== b.devices[0].id || r.basis !== "tcp_service_port" || !["online", "offline"].includes(r.status) || !cameraTimestamp(r.checkedAt, now()).fresh) return item;
        return {
          productId: item.productId,
          status: r.status,
          basis: "tcp_service_port",
          checkedAt: r.checkedAt,
          resourceId: r.resourceId,
          reason: "Completed saved TCP/service-port check for the current reviewed equipment group. Camera video is not verified."
        };
      }) };
    } catch {
      return base;
    }
  };
  try {
    return await Promise.race([work(), canceled]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", stop);
    controller.abort();
  }
}

// ../it-feature-availability.js
var IT_DAILY_WORKSPACES = Object.freeze(["Fleet Dashboard", "Camera Health"]);

// src/fieldCameraHealth.ts
function isSupportEquipment(unit) {
  const name = unit.unitNumber.trim().toUpperCase();
  const model = (unit.modelName || "").trim().toUpperCase().replace(/[_-]/g, " ").replace(/\s+/g, " ");
  return /^(?:ST|STAND)\s*[-#]?\s*\d{1,6}$/i.test(name) || ["STAND", "STANDS"].includes(model) || /^(?:SOLAR\s*STANDS?(?:\s*72)?|SOLAR\s*POLES?|SKIDS?)(?:\s|[-#])\s*\d+$/i.test(name) || ["SOLAR STAND", "SOLAR STANDS", "SOLAR STANDS 72", "SOLAR STAND 72", "SOLAR POLES & SKIDS", "SOLAR POLE", "SOLAR POLES", "SKID", "SKIDS"].includes(model);
}

// ../supabase/functions/cos-operations-pages/productResourceMembership.ts
var terminal2 = (v) => typeof v === "string" && /(?:^|\W)(RETIRED|DELETED|DECOMMISSIONED|STOLEN|DNU|DO\s+NOT\s+USE|NOT\s+IN\s+USE)(?:$|\W)/i.test(v);
function resourceEpochsCoverIdentity(proof, resources, epochs) {
  const ids = proof.deviceIds, keys = proof.unitKeys;
  if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.some((id3) => typeof id3 !== "string" || !/^[1-9][0-9]*$/.test(id3)) || !Array.isArray(keys) || !keys.length || new Set(keys).size !== keys.length || keys.some((k) => typeof k !== "string" || !k || k !== k.trim())) return false;
  const equal = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  if (!equal(ids, resources.map((r) => String(r.id))) || !equal(keys, [...new Set(resources.map((r) => r.unit_key))])) return false;
  return keys.every((key) => {
    const current = epochs.filter((e) => e.unitKey === key), members = resources.filter((r) => r.unit_key === key).map((r) => String(r.id));
    return current.length === 1 && /^[a-f0-9]{64}$/.test(current[0].epoch) && Array.isArray(current[0].deviceIds) && equal(current[0].deviceIds, members);
  });
}
async function productResourceMembership(source, now = Date.now(), review) {
  const readAt = Date.parse(source.verifiedAt);
  if (source.complete !== true || !Number.isFinite(readAt) || readAt > now || now - readAt > 26e3) throw Error("Current complete membership source required");
  validateOwnerIdentitySnapshot(source.identitySources.ownerCrosswalk);
  const census = currentMhelpProductConnectionCensus(source.upload, now);
  if (source.tracker.expectedMhelpSourceSha256 !== census.sourceSha256) throw Error("Membership source changed");
  const identity = await verifiedHealthIdentities(source.identitySources, review);
  const projected = projectMhelpUploadPlacement(source.map, source.upload, source.identitySources.audits, identity, now).snapshot.uploadInventory;
  if (!projected || projected.sourceSha256 !== census.sourceSha256) throw Error("Membership projection changed");
  const proofs = [...identity.unitIdentities, ...identity.ownerConfirmedUnitIdentities || []], members = /* @__PURE__ */ new Map();
  const rows2 = source.identitySources.devices, byDevice = /* @__PURE__ */ new Map(), byUnit = /* @__PURE__ */ new Map(), byInventory = /* @__PURE__ */ new Map(), byProduct = new Map(projected.records.map((r) => [r.productId, r]));
  for (const [list, key, map] of [[rows2, "id", byDevice], [source.identitySources.units, "id", byUnit], [source.map.inventoryItems, "id", byInventory]]) for (const row of list) {
    const id3 = String(row[key]);
    map.set(id3, [...map.get(id3) || [], row]);
  }
  for (const raw of source.upload.records) {
    if (raw.placement !== "FIELD" || raw.lifecycle !== "UNFLAGGED" || isSupportEquipment({ id: "mhelp_product:" + raw.productId, unitNumber: raw.unitNumber, modelName: raw.category })) continue;
    const b = raw.binding, p = byProduct.get(raw.productId), linked = p?.binding, ids = linked?.unitIds;
    if (!b || b.guardCurrent !== true || !b.nativeUnitId || linked?.state !== "linked" || linked.placementHeld || linked.reason || linked.candidateUnitIds?.length || !Array.isArray(ids) || !ids.includes(b.nativeUnitId) || ids.length > 2 || new Set(ids).size !== ids.length) continue;
    if (ids.some((id3) => id3 !== b.nativeUnitId && (id3 !== b.trackerId || byUnit.has(id3) || byInventory.get(id3)?.length !== 1 || byInventory.get(id3)[0].readOnly !== true))) continue;
    if (byInventory.get(b.nativeUnitId)?.length !== 1 || byInventory.get(b.nativeUnitId)[0].readOnly === true) continue;
    const native = byUnit.get(b.nativeUnitId) || [];
    if (native.length !== 1 || typeof native[0].status !== "string" || terminal2(native[0].status) || terminal2(native[0].unit_number)) continue;
    const proof = proofs.filter((p2) => p2.unitId === b.nativeUnitId);
    if (proof.length !== 1 || identity.identityWarnings.some((w) => w.unitId === b.nativeUnitId) || !proof[0].deviceIds.length) continue;
    const resources = proof[0].deviceIds.map((id3) => byDevice.get(String(id3)));
    if (resources.some((r) => r?.length !== 1)) continue;
    const exact2 = resources.map((r) => r[0]);
    if (exact2.some((r) => r.monitoring_enabled !== true || r.activation_state !== "active" || [r.device_name, r.unit_key].some(terminal2))) continue;
    if (!resourceEpochsCoverIdentity(proof[0], exact2, source.identitySources.ownerEpochs || [])) continue;
    members.set(raw.productId, proof[0].deviceIds.map(String));
  }
  return { census: projected, members };
}
export {
  buildExactProductConnections,
  cancellableIo,
  createProductPreviewHandler,
  createProductProofHandler,
  createProtectedSourceReader,
  existingNativeProductSourceContext,
  integrateScopedConnections,
  productResourceMembership
};
