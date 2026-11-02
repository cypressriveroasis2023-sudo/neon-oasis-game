
// COS_ARCHIVED_WALL_E_READER_20261102 BEGIN
var CosArchivedWallEConnectionReader20261102 = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // ../supabase/functions/cos-operations-pages/mhelp2027ProductIpReader.ts
  var mhelp2027ProductIpReader_exports = {};
  __export(mhelp2027ProductIpReader_exports, {
    read2027ProductIpsFromGoogle: () => read2027ProductIpsFromGoogle
  });

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
  var object = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
  var SheetsConnectionError = class extends Error {
    constructor(message, status = 503) {
      super(message);
      this.status = status;
      this.name = "SheetsConnectionError";
    }
  };
  var fail = (message, status = 503) => {
    throw new SheetsConnectionError(message, status);
  };
  function account(raw) {
    if (raw === void 0 || raw === null || raw === "") return null;
    if (typeof raw !== "string" || raw.length > 32768) return fail("The Google service-account secret needs correction in Supabase.");
    let v;
    try {
      v = JSON.parse(raw);
    } catch {
      return fail("The Google service-account secret must be the complete JSON key file.");
    }
    if (!object(v) || v.type !== "service_account" || typeof v.client_email !== "string" || v.client_email.length > 254 || !/^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9.-]*\.iam\.gserviceaccount\.com$/.test(v.client_email) || v.token_uri !== TOKEN_URL || typeof v.private_key_id !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(v.private_key_id) || typeof v.private_key !== "string" || v.private_key.length > 16384 || !/^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----\n?$/.test(v.private_key))
      fail("Use a Google service-account JSON key, not a password, API key, or mHelpDesk token.");
    return { client_email: v.client_email, private_key: v.private_key, private_key_id: v.private_key_id };
  }
  async function boundedJson(response, limit, signal) {
    if (signal.aborted) fail("The Sheets connection check timed out. Retry the check.");
    const declared = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(declared) && declared > limit) {
      await response.body?.cancel();
      fail("Google returned an oversized connection response.");
    }
    const reader = response.body?.getReader();
    if (!reader) return fail("Google returned an incomplete connection response.");
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
        if (signal.aborted) fail("The Sheets connection check timed out. Retry the check.");
        if (done) break;
        size += value2.byteLength;
        if (size > limit) fail("Google returned an oversized connection response.");
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
        return fail("Google returned an unreadable connection response.");
      }
      if (!object(v)) fail("Google returned an incomplete connection response.");
      return v;
    } finally {
      signal.removeEventListener("abort", abort);
      await reader.cancel().catch(() => {
      });
    }
  }

  // ../supabase/functions/cos-operations-pages/mhelpEquipmentCsvPreview.ts
  var EQUIPMENT_CSV_MAX_BYTES = 2 * 1024 * 1024;
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

  // src/cameraEvidence.ts
  var CAMERA_FRESH_MS = 20 * 60 * 1e3;

  // ../supabase/functions/cos-operations-pages/cameraEvidence.ts
  var CAMERA_FRESH_MS2 = 20 * 60 * 1e3;

  // src/exactProductConnection.ts
  var TRACKER_CONNECTION_CENSUS_V2 = "COS_VERIFIED_2027_PRODUCT_IPS_V2";
  var TRACKER_IP_WORKBOOK = "1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA";
  var SOURCE_FRESH_MS = 30 * 60 * 1e3;

  // ../supabase/functions/cos-operations-pages/mhelp2027ConnectionCensus.ts
  var ID = /^[1-9][0-9]{0,14}$/;
  var HASH = /^[a-f0-9]{64}$/;
  var object2 = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
  var normalized = (v) => v.trim().replace(/\s+/g, " ").toLowerCase();
  var fail2 = () => {
    throw Error("Protected 2027 Product-ID/IP evidence is unavailable or changed.");
  };
  var rangeSpec = (v) => {
    if (typeof v !== "string") return null;
    const m = /^(?:'([^']+)'|([^!]+))!([A-Z]+)([1-9][0-9]*):([A-Z]+)([1-9][0-9]*)$/.exec(v);
    return m ? { sheet: m[1] || m[2], fromCol: m[3], fromRow: Number(m[4]), toCol: m[5], toRow: Number(m[6]) } : null;
  };
  var col = (v) => [...v].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  function rows(value2, expectedRange) {
    const expected = rangeSpec(expectedRange), actual = object2(value2) ? rangeSpec(value2.range) : null;
    if (!expected || !actual || !object2(value2) || actual.sheet !== expected.sheet || actual.fromCol !== expected.fromCol || actual.toCol !== expected.toCol || actual.fromRow !== expected.fromRow || actual.toRow > expected.toRow || actual.toRow < actual.fromRow || value2.majorDimension !== "ROWS" || !Array.isArray(value2.values) || value2.values.length > actual.toRow - actual.fromRow + 1) return fail2();
    const width = col(expected.toCol) - col(expected.fromCol) + 1;
    return value2.values.map((row) => {
      if (!Array.isArray(row) || row.length > width || row.some((v) => v !== null && (typeof v !== "string" || v.length > 600))) return fail2();
      return row.map((v) => v === null ? "" : v);
    });
  }
  async function verify2027ConnectionCensus(valueRanges, rangeNames, candidate, expectedMhelpSourceSha256, verifiedAt, archive) {
    if (!Array.isArray(valueRanges) || valueRanges.length !== 7 || rangeNames.length !== 7 || !HASH.test(expectedMhelpSourceSha256) || !Number.isFinite(Date.parse(verifiedAt)) || !Array.isArray(candidate) || !candidate.length || candidate.length > 1e4) return fail2();
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
      if (!s || s.sheet !== b[0] || s.fromCol !== b[1] || s.toCol !== b[2] || s.fromRow !== 1 || s.toRow > 12e3) return fail2();
    });
    const [info, ids, placement, indexIds, indexDetails, exports, ips] = valueRanges.map((v, i) => rows(v, rangeNames[i]));
    if (info[0]?.[0] !== "EQUIPMENT TYPE" || info[0]?.[1] !== "UNIT #" || info[0]?.[2] !== "PLACEMENT" || info[0]?.[4] !== "CUSTOMER" || ids[0]?.[0] !== "MHELP EQUIPMENT ID" || placement[0]?.[0] !== "TRACKER PLACEMENT" || placement[0]?.[1] !== "MHELP PLACEMENT" || indexIds[0]?.[0] !== "TRACKER MATCH KEY" || indexIds[0]?.[1] !== "MHELP EQUIPMENT ID" || indexDetails[0]?.[0] !== "MHELP EQUIPMENT NAME" || indexDetails[0]?.[1] !== "MHELP CUSTOMER / SITE" || exports[0]?.[0] !== "MHELP SOURCE EXPORT" || ips[0]?.[0] !== "IP" || ips.length > ids.length) return fail2();
    const expected = /* @__PURE__ */ new Map();
    for (const r of candidate) {
      if (!object2(r) || !ID.test(r.productId) || expected.has(r.productId) || !["FIELD", "SHOP"].includes(r.placement) || typeof r.customer !== "string" || !r.customer.trim() || typeof r.unitNumber !== "string" || !r.unitNumber.trim()) return fail2();
      expected.set(r.productId, r);
    }
    const indexed = /* @__PURE__ */ new Map();
    let sourceExport = null;
    for (let i = 1; i < Math.max(indexIds.length, indexDetails.length, exports.length); i++) {
      const a = indexIds[i] || [], d = indexDetails[i] || [], e = exports[i] || [];
      if (![...a, ...d, ...e].some((v) => v.trim())) continue;
      if (!a[0] || !ID.test(a[1]) || indexed.has(a[1]) || !d[0] || !d[1] || !/^ServiceItem_List_[0-9]{14}\.csv$/.test(e[0])) return fail2();
      if (sourceExport !== null && sourceExport !== e[0]) return fail2();
      sourceExport = e[0];
      indexed.set(a[1], { key: a[0], model: d[0], customer: d[1] });
    }
    const extraIds = new Set([...indexed.keys()].filter((id) => !expected.has(id)));
    const archived = [];
    if (extraIds.size || archive) {
      if (!archive || !Array.isArray(archive.valueRanges) || archive.valueRanges.length !== 3 || !Array.isArray(archive.rangeNames) || archive.rangeNames.length !== 3) return fail2();
      const bounds = [["A", "B"], ["G", "G"], ["BE", "BH"]];
      archive.rangeNames.forEach((name, i) => {
        const s = rangeSpec(name), b = bounds[i];
        if (!s || s.sheet !== "WALL-E" || s.fromCol !== b[0] || s.toCol !== b[1] || s.fromRow !== 1 || s.toRow > 12e3) return fail2();
      });
      const [labels, archiveIps, membership] = archive.valueRanges.map((v, i) => rows(v, archive.rangeNames[i]));
      if (labels[0]?.[0] !== "UNIT #" || labels[0]?.[1] !== "PLACEMENT" || archiveIps[0]?.[0] !== "IP" || membership[0]?.[0] !== "MHELP EQUIPMENT ID" || membership[0]?.[1] !== "MASTER MEMBERSHIP" || membership[0]?.[2] !== "MHELP PLACEMENT" || membership[0]?.[3] !== "LIFECYCLE RESTRICTION") return fail2();
      const seenArchive = /* @__PURE__ */ new Set();
      for (let i = 1; i < Math.max(labels.length, archiveIps.length, membership.length); i++) {
        const a = labels[i] || [], m = membership[i] || [], ip = archiveIps[i]?.[0] || "";
        if (![...a, ...m, ip].some((v) => v.trim())) continue;
        const id = m[0], index = indexed.get(id);
        if (!ID.test(id) || seenArchive.has(id) || !a[0] || index && (index.key !== "WALL-E|" + a[0] || index.model !== a[0]) || !["FIELD", "SHOP"].includes(a[1]) || !["FIELD", "SHOP"].includes(m[2]) || ip.length > 80) return fail2();
        seenArchive.add(id);
        if (m[1] === "ARCHIVED") {
          if (expected.has(id) || a[1] !== "SHOP" || m[2] !== "SHOP" || m[3] !== "DECOMMISSIONED") return fail2();
          archived.push({ productId: id, publicIp: ip.trim() || null, sourceRow: i + 1 });
        } else if (m[1] !== "CURRENT MASTER" || !expected.has(id) || !index) return fail2();
      }
      if ([...extraIds].some((id) => !archived.some((r) => r.productId === id))) return fail2();
    }
    const records = [], seen = /* @__PURE__ */ new Set();
    for (let i = 1; i < Math.max(info.length, ids.length, placement.length, ips.length); i++) {
      const a = info[i] || [], id = ids[i]?.[0] || "", p = placement[i] || [], ip = ips[i]?.[0] || "";
      if (![...a, id, ...p, ip].some((v) => v.trim())) continue;
      const [family, label, currentPlacement, , customer] = a;
      if (!family || !label || !customer || !ID.test(id) || seen.has(id) || !expected.has(id) || !indexed.has(id) || !["FIELD", "SHOP"].includes(currentPlacement) || !p[0] || ip.length > 80) return fail2();
      seen.add(id);
      const source = expected.get(id), index = indexed.get(id);
      if (index.key !== family + "|" + label) return fail2();
      const reviewReasons = [];
      if (currentPlacement !== source.placement) reviewReasons.push("placement_mismatch");
      if (normalized(customer) !== normalized(source.customer) || normalized(index.customer) !== normalized(source.customer) || equipmentCustomerPlacement(customer) !== currentPlacement) reviewReasons.push("customer_mismatch");
      if (normalized(index.model) !== normalized(source.unitNumber)) reviewReasons.push("identity_mismatch");
      if (p[0] !== currentPlacement || Boolean(p[1]) && p[1] !== currentPlacement) reviewReasons.push("tracker_restriction");
      if (ip.trim() && archived.some((r) => r.publicIp === ip.trim()) && !reviewReasons.includes("tracker_restriction")) reviewReasons.push("tracker_restriction");
      records.push({
        productId: id,
        recordId: "mhelp_product:" + id,
        placement: currentPlacement,
        publicIp: ip.trim() || null,
        reviewReasons,
        sourceRow: i + 1
      });
    }
    if (!sourceExport || records.length !== expected.size || indexed.size !== expected.size + extraIds.size || [...expected.keys()].some((id) => !seen.has(id) || !indexed.has(id))) return fail2();
    const bytes = new TextEncoder().encode(JSON.stringify({ rangeNames, sourceExport, records, ...archived.length ? { archiveRangeNames: archive.rangeNames, archived } : {} }));
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
  var WALL_E = { id: 1900162011, title: "WALL-E" };
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
      const expectedIds = new Set(options.candidate.map((r) => r.productId));
      const indexRows = result.valueRanges[3]?.values;
      const hasHistoricalIds = Array.isArray(indexRows) && indexRows.slice(1).some((r) => Array.isArray(r) && typeof r[1] === "string" && !expectedIds.has(r[1]));
      let archive;
      if (hasHistoricalIds || metadata.sheets.some((s) => s?.properties?.sheetId === WALL_E.id)) {
        const matches = metadata.sheets.filter((s) => s?.properties?.sheetId === WALL_E.id), p = matches[0]?.properties;
        if (matches.length !== 1 || p.title !== WALL_E.title || p.hidden === true || p.sheetType !== "GRID" || !Number.isSafeInteger(p.gridProperties?.rowCount) || p.gridProperties.rowCount < 2 || p.gridProperties.rowCount > 12e3 || p.gridProperties.columnCount < 60) return failure();
        const w = p.gridProperties.rowCount;
        const archiveNames = [`'WALL-E'!A1:B${w}`, `'WALL-E'!G1:G${w}`, `'WALL-E'!BE1:BH${w}`];
        const archiveQuery = new URLSearchParams();
        for (const name of archiveNames) archiveQuery.append("ranges", name);
        archiveQuery.set("valueRenderOption", "FORMATTED_VALUE");
        const archived = await read(base + "/values:batchGet?" + archiveQuery, 22e5, signed.access_token);
        archive = { valueRanges: archived.valueRanges, rangeNames: archiveNames };
      }
      return verify2027ConnectionCensus(result.valueRanges, names, options.candidate, options.expectedMhelpSourceSha256, new Date(at()).toISOString(), archive);
    } catch {
      return failure();
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  return __toCommonJS(mhelp2027ProductIpReader_exports);
})();

read2027ProductIpsFromGoogle=CosArchivedWallEConnectionReader20261102.read2027ProductIpsFromGoogle;
// COS_ARCHIVED_WALL_E_READER_20261102 END
