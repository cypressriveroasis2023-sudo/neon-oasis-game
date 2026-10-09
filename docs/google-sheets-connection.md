# COS 2027 Google Sheets connection

The COS Owner can verify backend access to the existing [2027 UNIT TRACKER](https://docs.google.com/spreadsheets/d/1eV9dx7z1deyA5w9iaVNpP0D5_otkfF-dLiC5wuAlbtA/edit) from Unit Tracker → **Check Sheets connection**. Connected ChatGPT Drive access does not authorize the COS backend.

## One-time Google setup

Use the company's existing Google Cloud project if available. No Google Cloud IAM role, domain-wide delegation, public spreadsheet sharing, or paid product is needed by this reader.

1. In [Google Cloud](https://console.cloud.google.com/apis/library/sheets.googleapis.com), select the appropriate project and enable **Google Sheets API**.
2. Open [Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts). Create a dedicated account named `cos-unit-tracker`, without assigning a project role. If a suitable dedicated account already exists, use it.
3. On that account's **Keys** tab, use **Add key → Create new key → JSON**. Google downloads its JSON key file. Never send the file or its contents through chat or put it in the tracker or GitHub.
4. In **Tech Check Platform**, open [Supabase Edge Function Secrets](https://supabase.com/dashboard/project/tughscoxralhofrckvxy/functions/secrets). Save one secret:

   | Name | Value |
   | --- | --- |
   | `COS_GOOGLE_SERVICE_ACCOUNT_JSON` | The entire contents of the downloaded JSON file |

5. Open the existing 2027 tracker → **Share**. Add the account's `client_email` from the JSON file as **Viewer**. Keep the workbook's general access unchanged. Do not share other files. The Owner connection check also shows this sharing email once its configuration is valid.
6. In COS Unit Tracker, click **Check Sheets connection**. Success says **Google Sheets read access verified**, with a fresh checked time and all ten equipment-tab counts. No redeployment is required after saving the secret.

If key creation is prohibited by the organization's Google policy, do not relax that policy or use someone else's credential. An organization-approved OAuth or workload-identity setup is required instead. A missing key or share is reported honestly; the app never fabricates a connected state.

## What is connected

The server obtains a short-lived Google access token using the protected service account and `spreadsheets.readonly`. Tokens renew on demand and remain in server memory. The credential's token URL is validated, and requests use only fixed Google endpoints with redirects disabled. JWT signing uses pinned `jose` 6.2.12; the assertion has a fixed audience/scope, RSA SHA-256, and a one-hour maximum lifetime. No user impersonation is supported.

The connector first verifies the workbook ID/title and exact tab IDs, names, visibility and dimensions. It then reads only bounded identity/placement ranges, checks their headers and returns aggregate counts. Leading zeros, decimals and hardware suffixes are retained in displayed identities; no model, equipment, IP, source or customer association is inferred. Duplicate displayed labels, formula-bearing rows and unrecognized placements are flagged for later review.

| Tab | Tab ID | Columns read |
| --- | --- | --- |
| SOLAR SPOTTERS | 568394918 | A:B |
| SPOTTERS | 2017346590 | A:B |
| HELIOS | 426115083 | A:B |
| RANGERS | 386511683 | A:B |
| SNIPERS | 826256700 | A:B |
| CAM V & RSU | 651684134 | A:B |
| RECONS | 451969219 | A:B |
| RECON II | 135363149 | A:B |
| SOLAR STANDS 72 | 1975227208 | A:B |
| SOLAR POLES & SKIDS | 828079282 | A only; column B is an installation date |

Password, gate-code, address, IP, contact, duplicate-archive, mHelp unmatched and overview cell data are excluded from the connection check. Google authorization applies at workbook level; the column restrictions are enforced by this connector, not by the Viewer grant.

## Publication remains separate

This release establishes **read access**. It does not publish queued requests, append units, modify cells, run a scheduled import or apply spreadsheet values to Camera Health / Field View. The existing pending queue contract remains `awaiting_sheets_connection` and its default-off SQL artifact is not activated here. A successful Google read must not be treated as an enabled publisher.

Publishing needs separately tested exact-row identity, fresh cell/formula/validation/protection checks, manual-change conflict review, idempotent receipts and verified readback. Native placement, GPS, address corrections and health continue to use their existing controls. mHelpDesk's validated access and token renewal are independent of this Google setup.

## Backend verification

Owner-only endpoints are `/api/unit-tracker/sheets/status` (GET, no Google requests) and `/api/unit-tracker/sheets/check` (POST with an empty object). Both run after existing same-person legacy/native authentication. IT and Service have no new credential or connection-check access. Caller-supplied tokens, URLs, workbook IDs, ranges or actors are rejected.

`cos-sheets-readiness` is a protected maintenance endpoint for `{"action":"status"}` or `{"action":"check"}`. It delegates the existing camera cron authorization to its original project. It creates no secret, credential copy, timer, database grants or source data. Anonymous checks receive 403. Its responses contain only connection status, the non-secret sharing account email, and aggregate equipment-tab counts.

Official references: [Google service-account OAuth](https://developers.google.com/identity/protocols/oauth2/service-account), [bounded Sheets reads](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get), [Sheets scopes](https://developers.google.com/workspace/sheets/api/scopes), [Supabase secrets](https://supabase.com/docs/guides/functions/secrets).
