# Rebuild V2 Test Report

## Staging validation preparation (2026-11-19)

- Re-inspected the V2 readiness checklist, report, README, Render blueprint, package files, storage/backup code, tests, browser configuration and current parent Git status. The three protected files remain untracked; no edits were made to them.
- Added `STAGING_SETUP_GUIDE.md` with a separate manually configured Render service/disk, staging-only paths and environment inventory, restricted proxy spoof procedure, disk/lock checks, isolated restore drill, independent backup design requirements, CI browser procedure, safe log inspection and shutdown steps.
- Added `STAGING_VALIDATION_CHECKLIST.md`. Actual Render service/disk, proxy chain, staging secrets, independent destination, and owner approvals are blocked/pending, not represented as passed.
- Added `STAGING_SERVICE_CONFIGURATION.md` and `STAGING_OWNER_EVIDENCE_TEMPLATE.md`. The service specification was checked against V2 config/routes and the existing blueprint. The production-oriented `render.yaml` was not changed; the deployment guide now warns against applying it as staging. Current Render inbound restrictions are plan-dependent and IPv4-only; owner eligibility is unverified.
- Added a local route regression test that varies forged single and comma-separated XFF values and confirms they cannot split the rate limiter with proxy trust disabled. This is not evidence about Render's proxy behavior.
- Extended `scripts/storageLoadTest.js` to seed valid synthetic base files at requested sizes, measure real repository inserts, history/overview reads, serialized size and process RSS observations, and test a sparse file one byte above the 64 MiB limit. Only a unique temporary directory under `rebuild/` was used and removed.

Synthetic benchmark (`npm run test:storage-load -- 100 1000 5000 10000`):

| Seeded records | Measured inserts | Total insert ms | Average insert ms | History + overview ms | Storage bytes | RSS before → after (bytes) |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 1 | 24.12 | 24.121 | 19.64 | 27,145 | 35,835,904 → 35,835,904 |
| 1,000 | 1 | 53.82 | 53.816 | 43.46 | 268,795 | 51,253,248 → 53,030,912 |
| 5,000 | 5 | 467.98 | 93.595 | 110.30 | 1,343,869 | 58,855,424 → 74,465,280 |
| 10,000 | 10 | 1,808.35 | 180.835 | 267.83 | 2,687,711 | 92,983,296 → 121,151,488 |

All fixture counts round-tripped. The file 67,108,865 bytes (64 MiB + 1) was rejected with `STORAGE_FILE_INVALID`. RSS is process-wide, allocator/fixture dependent, and not a per-operation memory measurement. Fixture datasets were seeded directly; measured inserts used the real repository. These numbers are one local run, not a production capacity benchmark or workload guarantee.

- `npm run check`: **PASS**.
- `npm test`: **PASS — 66 passed, 0 failed**.
- `npm ls --omit=dev --depth=0`: **PASS**; `dotenv@16.6.1`, `express@5.2.1`, `ua-parser-js@2.0.10`.
- `npm audit --omit=dev`: **PASS — 0 vulnerabilities** (registry query completed).
- Isolated clean install: exact `npm ci --omit=dev` and `npm ls --omit=dev --depth=0` passed in a unique temporary project under `rebuild/` with copied `package.json` and `package-lock.json` only; 73 packages added, 74 audited, 0 vulnerabilities. The temporary directory was removed. This verifies lockfile installation, not a clean full application checkout.
- `npm run test:browser`: **BLOCKED**; configured Firefox executable is missing at `/root/.cache/ms-playwright/firefox-1572/firefox/firefox`. No browser binary was installed and no browser page was opened in this phase. Run the documented CI/Linux procedure.
- No Render staging or production service was accessed; no disk mount was provisioned/verified; no MongoDB connection, external backup upload, live restore, deployment, commit or push occurred.
- Verdict remains **PARTIAL — OWNER ACTION REQUIRED** for staging validation; production remains **NO-GO FOR PRODUCTION TRAFFIC**.

## Final deployment preparation audit (2026-11-19)

- Added `DEPLOYMENT_READINESS_CHECKLIST.md` with evidence-based PASS/FAIL/BLOCKED/PENDING state, Render owner checklist, environment inventory, proxy verification procedure, persistent disk/backup requirements, clean-install/browser procedure, and production Go/No-Go criteria.
- Added two synthetic proxy-trust regression tests. They establish that an untrusted `X-Forwarded-For` is ignored with zero hops, while one-hop trust accepts the supplied value on a direct local request. This does not establish Render's actual proxy sanitization or topology; `TRUST_PROXY_HOPS=1` remains blocked pending staging verification.
- Added `scripts/storageLoadTest.js` and `npm run test:storage-load`. It creates 100 synthetic records under a unique temporary directory inside `rebuild/`, validates history and overview totals, closes the repository, and removes only its own test directory. Result: **PASS**, 100 records, 26,276-byte file, 1,904.48 ms total inserts (19.045 ms/insert), 48.24 ms combined history/overview read. This is a small local demonstration, not a production capacity benchmark.
- `npm run check`: **PASS**.
- `npm test`: **PASS**, 65 passed, 0 failed.
- `npm ls --omit=dev --depth=0`: **PASS**; dotenv 16.6.1, express 5.2.1, ua-parser-js 2.0.10.
- `npm audit --omit=dev`: **PASS**, 0 vulnerabilities (registry query completed).
- `npm ci --omit=dev`: **NOT RUN**; clean installation remains unverified.
- `npm run test:browser`: **BLOCKED**, Firefox executable missing at `/root/.cache/ms-playwright/firefox-1572/firefox/firefox`; no browser was installed and no browser page was opened.
- No Render service/disk was inspected, no MongoDB connection was made, no external backup upload occurred, and no deployment, commit or push occurred.
- Final verdict remains **NO-GO for production traffic** pending the owner-side items in the readiness checklist.

## Automated checks

- `npm test`: **passed**, 25 tests, 0 failures.
- `npm run test:browser`: **passed**, 1 Playwright Firefox suite covering all five requested viewport sizes.
- `npm run check`: **passed** for `src/server.js` and `src/app.js`.
- `node --check`: **passed** for server modules, public scripts, Playwright config, browser harness, and all tests.
- `git diff --check`: **passed**.
- `npm audit`: **passed**, 0 vulnerabilities across production and development dependencies.

The unit suite uses synthetic visitor records, mocked geolocation responses, and an in-memory repository. It covers provider success, HTTP and provider errors, malformed JSON, missing fields, retry and `Retry-After` behavior, timeout, cache expiry, same-IP request coalescing, public-history privacy, admin authorization and logout, SSE cleanup, legacy record compatibility, conservative device parsing, exact-IP admin search hashing, and static responsive layout safeguards.

The browser suite launched the real rebuild Express routes and browser assets with a dedicated in-memory repository. It exercised the public profile endpoint, admin unauthorized/login/logout flows, overview/charts, history empty and populated states, exact IP search, detail dialog, API error states, mobile navigation, and SSE lifecycle. It measured document/body width against viewport width and checked representative touch targets. No unexpected browser console errors or failed network requests occurred; expected SSE cancellation during logout and deliberately induced API failures were normal test actions.

## Not exercised

- No production or development MongoDB server was contacted, and no database records were read or written. Database integration against an isolated test MongoDB remains to be performed.
- A live ipwho.is request through the rebuild adapter for safe public test IP `8.8.8.8` returned United States (US), San Jose, California, `America/Los_Angeles`, coordinates, ISP, and ASN. It verifies this request and response mapping only; future provider availability is not guaranteed.
- Chromium downloaded and matches this host (ARM64); `ldd` found no missing shared libraries. The host is `PRoot-Distro` running as UID 0. The downloaded build has no `chrome-sandbox` helper. With Playwright sandboxing enabled, Chromium exits with “Running as root without --no-sandbox is not supported”; Playwright's default no-sandbox launch and direct no-sandbox smoke test instead hit a Chromium `SIGTRAP` after GPU-process exit 5. `/dev/dri` is inaccessible. Root user namespaces work only mapped as UID 0; non-root mapping fails because `newuidmap` is absent. Firefox installed and ran successfully.
- `playwright.config.js` now allows `PLAYWRIGHT_BROWSER=chromium` with `chromiumSandbox: true`; it never disables Chromium's sandbox. Use a non-root Linux VM/CI runner with working user namespace/subuid support and browser system dependencies to run that path. Chromium could not run this suite in the current container.
- No screenshot reference asset was available in the workspace for direct visual comparison.
- The normal `src/server.js` MongoDB bootstrap was not run. Browser testing started `createApp()` through a dedicated harness with synthetic config and in-memory storage. Render deployment was not attempted.

## Phase D2 and E browser/live results

- Captured full-page screenshots at 360×800, 390×844, 412×915, 1366×768, and 1440×900 for the public dashboard, admin login, and authenticated admin dashboard, plus the empty admin state at 360×800 (16 screenshots total). Artifacts are under `artifacts/phase-d2/`.
- All five viewport runs passed without horizontal document/body overflow. Mobile menu open/close and representative touch targets passed. Screenshot review found the privacy banner text too narrow on mobile; its responsive grid was corrected and the suite passed again.
- The browser posted to `/api/public/intelligence` and received HTTP 201. Browser-derived details identified Firefox/Linux and reported each configured browser viewport. The harness injected `X-Forwarded-For: 8.8.8.8` into loopback requests for controlled provider lookup. This is a synthetic test IP, not the browser host's public IP or a real visitor IP.
- For that browser request, the live provider supplied location fields and the dashboard showed the resolved country/city/coordinates and provider online. This verifies the endpoint-to-UI path for a safe controlled request.
- Admin APIs returned 401 before login and succeeded after local synthetic login. Overview, charts, history, exact full-IP search, details modal, empty/error states, logout, and SSE cleanup were exercised. The storage card correctly showed `Degraded` because the in-memory harness does not provide persistent storage.
- The browser harness used no `.env`, MongoDB URI, production credential, or production record. Staging MongoDB integration remains untested because no dedicated staging URI/credentials were provided.
- No screenshot reference asset was available in the workspace for direct comparison.

## Assessment

The rebuild previously passed local unit and real-browser checks in Firefox and the live provider path worked for the safe test IP. Chromium is installed but unusable in this container. Render was not contacted or deployed.

## Phase E — isolated MongoDB staging integration

### PASS

- Inspected `MongoVisitorRepository`, config defaults, current/legacy serializers, encrypted-IP schema, indexes, API authorization/privacy boundaries, and deployment docs before changes.
- Added an explicit staging config validator. It reads only `STAGING_*`; it does not fall back to or inspect normal `MONGODB_URI`/`MONGODB_DB` values. URI, credentials presence, admin password length, 64-hex encryption key, disposable confirmation phrase, and database prefix are validated without printing secret values.
- Added an integration runner that generates a timestamped/randomized `rakib_ip_v2_staging_*` database and unique collection, records only synthetic fixtures, and never drops a database or collection. It reports the generated namespace without credentials.
- Added offline tests for required configuration/no production-variable fallback, index creation calls, empty repository results, bounded connection timeout, close-on-failure, recovery with a fresh client, transient ping recovery, public privacy/legacy compatibility (existing tests), encryption/masking, and admin authorization (existing tests).
- `npm test`: **30 passed, 0 failed**. Syntax checks and `git diff --check`: **passed**.
- Staging environment presence check inspected names only. `STAGING_MONGODB_URI`, `STAGING_ADMIN_PASSWORD`, `STAGING_IP_ENCRYPTION_KEY`, and `STAGING_CONFIRM_DISPOSABLE` are all missing.
- `npm run staging:check`: **BLOCKED**, exit code 2, reported those four missing names and returned before any Mongo client import/connection.
- `npm run staging:integration`: **BLOCKED**, exit code 2, same preflight result; no MongoDB connection was attempted.

### NOT RUN / BLOCKED

- No MongoDB URI or staging credential was available. Actual staging connection, collection creation, indexes, empty-database behavior, insert/retrieval, pagination, exact-IP admin search, legacy fixture retrieval, public privacy checks against Mongo, auth over Mongo-backed history, graceful close, and fresh-client reconnect were **not run** against a database.
- The offline tests simulate connection timeout/failure/recovery; they do not establish MongoDB server behavior during a real outage.
- No production MongoDB URI was read, no database was contacted, and no records were written, migrated, inspected, or deleted.

### Required configuration to unblock

Configure these in the local process environment or a secure secret manager; do not paste them into chat or commit them:

- `STAGING_MONGODB_URI`: authenticated URI for a dedicated non-production staging cluster and user.
- `STAGING_ADMIN_PASSWORD`: unique staging-only password, at least 16 characters.
- `STAGING_IP_ENCRYPTION_KEY`: staging-only random 32-byte key as 64 hex characters.
- `STAGING_CONFIRM_DISPOSABLE=I_CONFIRM_DISPOSABLE_STAGING`.
- Optional `STAGING_DB_PREFIX` (defaults to `rakib_ip_v2_staging`).

## Follow-up: reported MongoDB staging failure (2026-11-18)

- **Reported result:** `npm run staging:integration` failed with MongoDB code `8000` in database `rakib_ip_v2_staging_mwlbneyn_7c03220cd22e1974`, collection `visitors_mwlbneyn_7c03220cd22e1974`.
- **Exact failure stage:** not recoverable from the reported code and namespace. The runner's catch handler emits only the error code/name and namespace, not an operation stage or sanitized server metadata. The possible DB stages include initial connect/index initialization, ping, reads, inserts, or later reconnect; code `8000` by itself does not identify authentication, authorization, connectivity, index creation, or another command failure.
- **Sanitized error metadata available:** code `8000` only. No message, labels, command name, topology/server-selection context, or stack was provided. No secret-bearing values were inspected or printed.
- **Namespace existence and artifacts:** not verified. The current environment has all four required staging variables missing, so no read-only connection was attempted. The namespace is preserved and must be treated as potentially containing data. `connectMongo()` attempts index creation before returning; therefore one or both indexes may exist if execution reached that point. No conclusion about synthetic record presence is possible because the failure stage is unknown.
- **Safe action:** keep this namespace untouched. Have the staging owner inspect it read-only in the provider console or restore staging-only credentials into a secure environment; verify the cluster identity independently. Obtain the original sanitized Mongo driver message/labels and operation context from the failed run. Do not retry the integration until the failure stage is understood and the owner approves.
- **Current verification:** environment presence check reports `STAGING_MONGODB_URI`, `STAGING_ADMIN_PASSWORD`, `STAGING_IP_ENCRYPTION_KEY`, and `STAGING_CONFIRM_DISPOSABLE` missing. No integration rerun, database connection, query, write, deploy, or production access was performed for this investigation.

## File-backed storage migration

### Implementation

- Normal startup now selects `json-file` storage and has no MongoDB import, URI requirement, automatic Mongo connection, authentication, or database command. The Mongo driver is a development dependency for the dormant adapter and its tests; the Render build omits development dependencies. `src/server.js` does not import it. `scripts/stagingMongoIntegration.js` remains separate and was not run.
- Added `src/db/jsonFileRepository.js` and `src/db/storage.js`. The adapter implements visitor insertion, IP-hash counts, filtered/paginated history, record details, analytics overview, health checks, and graceful close. Storage format is `{ "version": 1, "records": [...] }`.
- Writes are serialized within one Node process and committed through a mode-0600 same-directory temporary file and atomic rename. Missing directories are created. Invalid JSON, unknown format versions, invalid/duplicate IDs, invalid timestamps, symlink storage files, oversized files, and plaintext `ip` fields fail closed without resetting the existing file. The default data directory is gitignored.
- Existing visitor service encryption/masking, public history allowlisting, admin authorization, APIs, analytics, rate limits, and in-memory admin sessions remain in place. The protected server health response now reports `storage` availability and preserves `database: "not_configured"`; the admin metric is labeled Storage.
- Render config now uses the file adapter and no longer declares Mongo environment variables. It has no persistent disk declaration; treat its local file and history as ephemeral until a persistent mount is configured and verified.

### Migration verification

- `node --test test/fileStorage.test.js test/config.test.js`: **9 passed, 0 failed**. Coverage includes startup without Mongo variables, file initialization and permissions, concurrent inserts, count/search/filter/pagination/analytics, corruption and format rejection without rewrite, privacy rejection, public masking, admin denial/login/history, storage health, and close/reopen behavior.
- `npm run check`: **passed** for config, server, app, and the storage adapter modules.
- `npm ls --omit=dev --depth=0`: **passed** and lists only `dotenv`, `express`, and `ua-parser-js`; the MongoDB driver and its exclusive dependency closure are marked development-only in the manifest and lockfile.
- A clean `npm ci --omit=dev` was not run. The offline lockfile refresh could not resolve uncached npm registry metadata; no install was performed. Manifest/lock dependency scopes were checked locally and the installed production view excludes MongoDB.
- `npm test`: **37 passed, 0 failed**.
- `npm run test:browser`: **blocked**; Playwright could not launch because the Firefox executable is absent at the configured cache path. No browser was installed and no browser test completed in this run.
- MongoDB staging integration, TLS diagnostics, production data access, deployment, and cutover were **not run**.

The old staging commands are paused with the unresolved TLS/server-selection failure. Do not run them as part of this file-storage migration.

## Render persistent-storage readiness audit

### Implemented

- Updated the V2-only `render.yaml` to use `STORAGE_MOUNT_PATH=/var/data` and `STORAGE_FILE=/var/data/visitors.json`, declare a persistent disk at `/var/data`, and set `numInstances: 1`. No root/legacy deployment configuration was changed.
- Production config now requires an absolute mount path and confines the data file strictly inside it. Storage initialization checks the exact mount point in `/proc/self/mountinfo` before creating directories or opening the JSON file. A missing mount fails with a sanitized `STORAGE_MOUNT_UNAVAILABLE`; there is no production ephemeral fallback.
- Added an exclusive `${STORAGE_FILE}.lock` with restrictive permissions. A second process fails with `STORAGE_ALREADY_IN_USE`. A lock left after a crash is preserved and requires an operator to verify the app is stopped before recovery.
- Updated deployment, architecture, security and README documentation with dashboard setup, required values, single-instance behavior, Render disk limitations, consequences of service/disk changes, and cautious backup/recovery guidance.

### Checks executed for this audit

- `npm test`: **41 passed, 0 failed**. New cases cover production mount config and path confinement, an exclusive process lock, lock cleanup after graceful close, preservation of a stale lock, production refusal before creating a file on an unmounted path, and exact mountpoint parsing.
- `npm run check`: **passed** for all configured V2 JavaScript modules.
- `npm ls --omit=dev --depth=0`: **passed**; installed runtime dependencies are `dotenv`, `express`, and `ua-parser-js`. The MongoDB driver and Playwright remain development-only according to the package manifest/lockfile review.
- `git diff --check`: **passed** for tracked changes visible to Git. The whole `rebuild/` tree is untracked in the parent repository, so this command does not validate its untracked contents; automated tests and syntax checks did execute against the rebuild files.
- `npm ci --omit=dev`: **not run** as part of this audit. When registry access is available, run from `rebuild/`: `npm ci --omit=dev`, `npm ls --omit=dev --depth=0`, `npm run check`, then `npm test`.

### Pending / not verified

- Render dashboard service plan eligibility, disk provisioning, blueprint sync validity in the account, actual mount presence, deployed startup/health, billing, and persistence across real restarts/redeploys are **not verified**. Render documents persistent disks as requiring a paid compatible service, being limited to one instance, unavailable to build/pre-deploy jobs, and causing downtime during deploy swaps; confirm current plan and service settings in the dashboard before applying changes.
- The blueprint omits `sizeGB`; Render's documented default is 10 GB. Owner must review/confirm capacity before syncing, since Render does not allow reducing a disk size later.
- No independent off-disk backup or restore drill exists. Backup/recovery readiness is **incomplete**. Render-documented daily snapshots retained seven days are not a verified backup for this service; restoring one replaces the full disk and loses post-snapshot changes.
- No deploy, Render API/dashboard operation, MongoDB connection, staging integration, production database access, or data/file deletion was performed.

## Backup and disaster recovery implementation

### Implementation

- Added `src/db/storageBackup.js` and `scripts/storageBackup.js`, with `npm run backup -- create|list|verify ID|restore ID` commands. The CLI requires `STORAGE_FILE`; `BACKUP_DIR` defaults to a sibling `backups/` directory and `BACKUP_RETENTION_COUNT` defaults to 14 (range 1–1000). Render values are `/var/data/visitors.json`, `/var/data/backups`, and `14`.
- Creation validates the current versioned JSON format, writes timestamped data and a manifest with format version, timestamp, byte size, and SHA-256, uses 0600 files and a private directory, installs unique final names without replacement, writes the manifest last, then rereads/verifies the final pair. The source storage file is never replaced by backup creation.
- An exclusive backup-operation lock serializes create, retention, and restore. Incomplete/temp artifacts and invalid backups are omitted and left untouched. Retention removes only older verified normal backups, retains at least one, and never removes the newest verified backup. Recovery copies are separate and excluded from automatic retention.
- Restore is CLI-only, interactive, and requires typing `RESTORE <backup-id>`. It verifies checksum, manifest, and storage format; rejects a live format newer than the candidate; refuses any existing storage lock; takes an exclusive maintenance lock; preserves current bytes as a recovery artifact; verifies staged data; and atomically renames the staged file. No HTTP restore route was added.
- Same-disk `/var/data/backups` is the default Render location, not protection against losing the disk. The tool does not encrypt whole backups or upload them externally. Independent encrypted off-site backup remains an operational requirement before relying on visitor history.

### Tests executed

- `npm test`: **54 passed, 0 failed**. New synthetic-temp tests cover successful timestamped backup/manifest/checksum, private permissions, tamper rejection, interrupted artifacts, pre-existing and overlapping operation-lock conflicts, insecure directory rejection, retention preserving newest and ignoring invalid artifacts, restore confirmation, active-lock refusal, recovery-copy creation and restoration, corruption preservation, newer-live-version refusal, and isolated atomic replacement.
- `npm run check`: **passed**, including the new backup service and CLI syntax checks.
- `npm ls --omit=dev --depth=0`: **passed**; runtime dependencies remain `dotenv`, `express`, and `ua-parser-js`. No dependency was added.
- No test read or wrote `/var/data`, restored over a production file, connected to MongoDB, or contacted Render.
- Browser tests were not rerun because no UI or HTTP route changed. A clean `npm ci --omit=dev` was not run in this phase.

### Remaining operational blockers

- Backup creation is manual; no scheduled backup worker/job or alerting is configured. Render disks are not shared with separate workers/one-off jobs, so a future scheduler must be designed for the actual hosting arrangement.
- No independent external backup destination/account has been approved or connected, and no off-site encryption/upload or restore drill exists. Same-disk backups and provider snapshots can be lost with the service disk.
- Render disk provisioning and production commands were not executed. The owner must verify service identity, mounted disk, environment values, and maintenance window before using CLI commands against the live path.
- Crash-left `.lock` and `.backup-operation.lock` files remain manual recovery cases; code never removes them automatically.

## Final pre-deployment security and stability audit (2026-11-19)

### Findings fixed

- **MEDIUM — unbounded rate-limit bucket map:** distinct client addresses could grow the in-memory map beyond its intended 5,000-entry threshold when no buckets had expired. Added a hard 5,000-entry LRU bound and periodic expired-bucket cleanup. Regression coverage is in `test/rateLimit.test.js`; the tradeoff under high-cardinality source traffic is documented in `SECURITY_AND_PRIVACY.md`.
- **MEDIUM — repository remained usable after close:** an old repository reference could write after its lock had been released and another repository had acquired the same path. Public storage operations now fail with `STORAGE_CLOSED`. Added a two-repository synthetic regression test.
- **MEDIUM — shutdown with active SSE:** long-lived admin streams could prevent the server close callback from releasing the storage lock before forced shutdown. Shutdown now closes the tracked authenticated SSE responses first. Added an HTTP-level cleanup test.
- **MEDIUM — implicit production proxy trust:** production config could infer one trusted proxy hop from the presence of `RENDER`. Production now requires explicit `TRUST_PROXY_HOPS`; the Render blueprint's current value of `1` remains pending verification against the actual deployed proxy chain.
- **LOW — crash durability metadata:** JSON writes already synced the temp file and renamed atomically; they now also sync the containing directory. If directory sync fails after rename, the result is reported as durability-unconfirmed rather than as an ordinary pre-rename write failure.
- Added API regression checks for protected CSV/JSON exports and spreadsheet formula neutralization, malformed JSON, oversized JSON, and the backup CLI's noninteractive restore refusal.

### Final checks

- `npm test`: **63 passed, 0 failed**. Includes the V2 unit, route, synthetic file storage, mocked adapter, backup/restore, CLI, session expiry/cookie, and regression tests. No production database is contacted by the Mongo adapter tests.
- `npm run check`: **passed**.
- `node --check public/admin.js`, `node --check public/app.js`, and direct syntax checks of the backup/rate-limit tests: **passed**.
- `npm ls --omit=dev --depth=0`: **passed**; production tree is `dotenv`, `express`, and `ua-parser-js`.
- `npm audit --omit=dev`: **passed**, 0 production vulnerabilities (registry advisory query completed).
- Package manifest/lockfile dependency sets and dev-only classifications were verified in the prior migration audit; no dependencies were changed here.
- `git diff --check` emitted no issues for tracked content. Since the parent Git repository reports the whole `rebuild/` directory as untracked, a separate whitespace check was used for V2 edited files; it passed before the last audit documentation edits. No `npm ci --omit=dev` clean install was run.

### Browser and hosting status

- `npm run test:browser`: **not completed**. Playwright is installed, but the configured Firefox executable is absent at `/root/.cache/ms-playwright/firefox-1572/firefox/firefox`. No browser was installed. The browser test generated only ignored local test artifacts; the route harness was unable to launch its browser.
- Render service identity, actual proxy chain, persistent disk provisioning/mount, secrets, service health, and storage persistence have not been verified. `render.yaml` sets `TRUST_PROXY_HOPS=1`; confirm the real proxy topology before deployment because incorrect proxy trust can affect client IP attribution and per-IP limits.
- File storage reparses the JSON document for reads and rewrites it for each insert, with a 64 MiB file cap. This is a small single-process store, not a high-throughput database; capacity/latency should be load-tested with synthetic data before production traffic grows.
- Same-disk backups are not independent disaster recovery. There is no scheduled backup, off-site copy, or restore drill.
- No MongoDB connection, staging integration, production visitor data access, live restore, Render operation, deployment, commit, or push was performed. The three protected backup files were not modified.

## Render Free temporary staging preparation

### Implementation

- Added opt-in temporary storage requiring both `STAGING_MODE=true` and `STAGING_EPHEMERAL_STORAGE=true`. Staging also requires a unique `STAGING_ACCESS_PASSWORD` (32–256 printable ASCII characters), a dedicated absolute `STAGING_STORAGE_DIR` under the OS temporary root, and `TRUST_PROXY_HOPS=0`. The derived storage file is `<STAGING_STORAGE_DIR>/visitors.json`; mount, backup-directory, and MongoDB URI configuration are rejected in staging mode.
- Normal production without both explicit staging flags still requires `STORAGE_MOUNT_PATH` and verifies that it is actually mounted before opening storage. No automatic persistent-to-ephemeral fallback exists. Staging temp directories must be owned by the process, be real directories, and have no group/other permissions.
- Added a global HTTP Basic Auth gate before request-body parsing, static files, visitor collection, admin APIs, exports, and all routes. Fixed username is `rakib-staging`; only exact `GET /healthz` bypasses authentication. The gate compares a SHA-256 digest with `timingSafeEqual`, returns a challenge on rejection, limits repeated failures to 10 per source per 15 minutes, and does not log credentials. Staging uses secure cookies/HSTS behavior; same-origin admin writes require an HTTPS Origin matching Host without trusting forwarded-protocol headers. Actual HTTPS/proxy behavior remains a Render owner check.
- The backup/restore CLI refuses to run when either staging flag is enabled. The staging app never imports the dormant MongoDB adapter and requires no Mongo variables.
- Added [RENDER_FREE_STAGING_GUIDE.md](RENDER_FREE_STAGING_GUIDE.md), separated the existing paid persistent-disk staging guide, and updated README/checklist. Free temporary runtime checks, persistent-disk staging checks, and production readiness are explicitly distinct.

### Verification executed

- `npm test`: **74 passed, 0 failed**. New tests cover dual-flag validation, missing/weak staging password, temp-path confinement, proxy setting, production mount failure, isolated temporary storage/reopen, staging startup with no Mongo variables, HTTP access control across public/admin/export routes, health bypass, malformed credentials, failed-credential throttling, and backup CLI refusal.
- `npm run check`: **passed**.
- `npm ls --omit=dev --depth=0`: **passed**; `dotenv`, `express`, and `ua-parser-js` are the production dependency tree.
- `npm audit --omit=dev`: **passed**, 0 vulnerabilities in the registry result.
- Browser tests were **not run**; there was no browser-related UI change, and Firefox remains unavailable in the current environment. Render service creation, HTTPS behavior, Free filesystem behavior, proxy chain, memory/CPU, cold starts, and restart data loss were **not tested**.
- No `npm ci` clean install was run. No production/legacy application, MongoDB, Render service, production data, or external backup destination was accessed. No deployment, commit, or push occurred.

### Remaining limitations

- Free storage is disposable and may survive or disappear unpredictably across process/container lifecycle events. These local reopen tests are not a Render durability test. A stale storage lock remains fail-closed; it is never automatically removed.
- `TRUST_PROXY_HOPS=0` deliberately ignores forwarded headers and does not establish visitor IP attribution through Render. Production proxy trust remains unverified and unchanged.
- Basic Auth protects the public staging service as an additional barrier only. It is not production identity/network isolation and must be used over the Render HTTPS URL. The owner must verify browser prompts, route protection, sanitized logs, service configuration, and private distribution before starting staging.
- Free RAM/CPU and spin-down make this suitable only for low-volume synthetic smoke tests. No capacity guarantee, persistence, backup, or disaster recovery is provided.
- Production remains **NO-GO FOR PRODUCTION TRAFFIC**.
