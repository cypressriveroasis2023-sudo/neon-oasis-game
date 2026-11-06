# Matched native package for PR #326

Prepared against a fresh read of ACTIVE `cos-operations-pages` v137 on November 2.
Its archive hash is pinned in `native-manifest.json`; a second independent read
after package verification confirmed all five files and the archive unchanged.

`reader-overlay.js` is the reproducible ES2022 bundle of the reviewed protected
reader, isolated in its own namespace. Insert it immediately before the existing
module exports and reassign only the native `read2027ProductIpsFromGoogle`
binding. Every original module byte remains; deleting the exact overlay restores
the original module hash. All original exported function text and names remain.
The main serve.ts, both endpoint modules and deno.json remain byte-identical.
This preserves the temporary exact-preview-origin correction and all existing
authentication, roles, producer flags, attribution and saved TCP classifications.

## Prepare, without deploying

From `tech-checks/operations`, using a freshly captured function JSON:

```sh
node scripts/prepareArchivedWallEReaderRuntime.mjs captured-native.json prepared-native.json
node --test tests/tracker-archive-native-runtime.test.mjs
```

The script refuses a changed version, archive, configuration, file count/name,
duplicate file or before/after hash. It contains no deployment/network operation.
Do not commit the captured or prepared full-function payloads. The repository
stores only the overlay, exact manifests, pure assembler and verification tests.

## Verification completed

- The original native module is exactly the existing recorded v134 module,
  SHA256 `613fc3dc4ea79f8072b5f4aa295af870ebfc743920bb0f6f9700f3e08384b2db`.
  It remained byte-identical through v137. The candidate module hash is
  `cb89bbd87f18b6e9286425800a5cab969d4152eef0ed67b55426044522fba854`.
- Five new native-package checks pass locally (Node 24.22.1), in addition to the
  49 focused source checks already recorded in the parent source commit.
- Actual native adapter execution: original module rejects the historical
  index; assembled candidate accepts two current synthetic identities, retains
  archived shared-IP Unknown and existing completed Online/Offline behavior,
  and rejects unconfirmed archive evidence. No live probes are issued.
- The assembled native adapter also passes a replay of the independently read
  real protected inventory and saved tracker/archive ranges: 925 current
  identities, 76 historical extras and nine retained customer/placement holds.
  Transport in this replay is synthetic; this is not a deployed/live read claim.
- Prepared full payload changes only the reader module. All five output hashes
  match the manifest. No operational records or tracker cells were written.

## Release and rollback

Not deployed. James retains release review. A release must re-read the current
native function immediately before deployment and satisfy every pinned check;
preserve `verify_jwt: false` with the existing in-function authentication and use
serve.ts/deno.json as the entrypoint/import map. Deploy the full five-file matched
payload, never repository index.ts. Read back every deployed file and verify the
candidate manifest. Then verify authenticated product-connections and Fleet
behavior. Passing the source census alone does not establish fresh TCP results.

For rollback, first freshly capture the deployed candidate. Prepare the original
five-file contents, with exact candidate hashes required before removal:

```sh
node scripts/prepareArchivedWallEReaderRuntime.mjs deployed-candidate.json rollback-native.json --rollback
```

The rollback preparer requires a deployed revision newer than v137 and refuses
any unrelated file/configuration drift. Deploying rollback is a separate action;
the preparer performs no network calls. Restored file hashes exactly equal the
v137 manifest, preserving preview access. No database or tracker rollback exists
because this repair writes neither.
