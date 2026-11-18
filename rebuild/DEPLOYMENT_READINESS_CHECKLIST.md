# Rakib IP Tracker V2 — Deployment Readiness Checklist

This checklist records repository evidence only. Render dashboard state, disk provisioning, real proxy topology, and live restore/off-site procedures have not been verified. **Production traffic is NO-GO until every BLOCKED/PENDING critical item below is resolved by the owner.**

## Go / No-Go criteria

- **GO for a controlled staging deployment** only after the owner verifies service identity, Node version, disk attachment and size, secrets, proxy behavior, and successful install/tests in that staging service; keep visitor traffic disabled or restricted while validating.
- **GO for production traffic** only after all critical items below are PASS, a supported browser suite passes, an independent encrypted backup destination is configured and verified, a restore drill succeeds against an isolated copy, and storage/load capacity is supported by measured workload data.
- Otherwise **NO-GO**. A passing local test suite is not evidence of Render provisioning, production security, or capacity.

## Render blueprint and dashboard checklist

| Item | Status | Evidence / owner action |
|---|---|---|
| Service root directory | PASS (blueprint) | `render.yaml` declares `rootDir: rebuild`. Owner must confirm the intended Render service is connected to this repository/blueprint. |
| Build command | PASS (blueprint) | `npm ci --omit=dev` |
| Start command | PASS (blueprint) | `npm start` → `node src/server.js` |
| Node version | PASS (declared) | Engine is `>=20.18.1`; blueprint sets `NODE_VERSION=20.18.1`. Actual deployed runtime remains unverified. |
| Health check | PASS (declared) | `/healthz` is process liveness only; it does not prove disk or provider health. Protected admin health reports storage status. |
| Instance count | PASS (declared) | `numInstances: 1`; retain one instance/process for this file store. Confirm no separate worker/start command launches a second writer. |
| Persistent mount path | PASS (code/blueprint agree) | `/var/data`; `STORAGE_MOUNT_PATH=/var/data`, file `/var/data/visitors.json`, backups `/var/data/backups`. Render dashboard attachment is **BLOCKED** pending owner check. |
| Disk size | PENDING | `sizeGB` is omitted in blueprint. Render Blueprint documentation specifies a 10 GB default when omitted; owner must confirm the actual disk size and workload capacity in the dashboard before applying/using it. Do not infer provisioning from YAML. |
| Port | PASS (code) | Render supplies `PORT`; config validates 1–65535; server binds `0.0.0.0`. Do not hardcode a production port. |
| Secrets | PENDING | Configure unique `ADMIN_PASSWORD` and random 32-byte `IP_ENCRYPTION_KEY` in Render secret environment. Confirm privately, never paste into logs/chat/source. |
| Proxy hops | BLOCKED | Blueprint currently sets `TRUST_PROXY_HOPS=1`; do not approve until the actual Render proxy chain and spoofed-header behavior are verified in a deployment test environment. |
| Backup destination | PASS (same disk only) | `/var/data/backups`; this does not protect from loss/deletion of the entire disk. Independent off-site backup remains BLOCKED. |
| Actual Render service/config | BLOCKED | No Render dashboard/API access or deployment was performed. Owner must verify repository, branch, service identity, plan eligibility, environment, disk attachment and health. |

Render documentation notes that persistent disks are available only to supported paid services, are attached to one service instance, are not available during build/pre-deploy or one-off jobs, and have deployment/scaling constraints. Verify current account/service eligibility and dashboard configuration directly. The blueprint’s omitted `sizeGB` has a documented default, not proof that a disk was provisioned. Sources: [Render Blueprint Specification](https://render.com/docs/blueprint-spec), [Render Disks](https://render.com/docs/disks).

### Owner-side Render dashboard sequence

1. Verify the intended V2 service is connected to this repository and intended production branch; confirm root directory `rebuild`.
2. Verify build/start commands and deployed Node runtime match the blueprint above.
3. Confirm one instance only and no additional worker/process uses the same file.
4. Confirm an attached persistent disk with mount `/var/data`; record its configured size and verify it is mounted at runtime before enabling traffic.
5. Configure required secrets in Render’s protected environment UI; verify only variable names/presence, never values in command output.
6. Keep the proxy hop value under review until following the test procedure below.
7. After an approved staging deploy only, verify `/healthz`, authenticated storage health, and a restart persistence check using synthetic staging data. Do not run a test that reads or exports real visitor records.

## Proxy-chain verification

**Status: BLOCKED pending a deployment test environment.** Local code proves the configured hop count affects `req.ip`; it cannot prove what Render’s edge proxy sends or sanitizes. The two new tests use only loopback and TEST-NET synthetic addresses: zero hops ignores a forged header; one hop accepts the header when directly connected. The latter is a warning that a trusted proxy must reliably replace or append a trusted chain.

Safe owner procedure (staging/test service only):

1. Use a separate Render test service, synthetic admin credentials, a disposable empty persistent disk, and a low public rate limit. Do not attach production storage or secrets. Do not test against a service receiving real visitors.
2. Obtain the actual proxy-chain behavior from current Render documentation/support for the exact service type and ingress path. Record the number/order of proxies and whether client-supplied `X-Forwarded-For` is overwritten, sanitized, or appended. Do not infer hop count from the presence of a `RENDER` environment variable.
3. In a controlled staging-only verification, send requests through the public staging hostname from one controlled test client: first without forwarding headers, then with synthetic spoof values from TEST-NET ranges, then repeat without spoofing. Never log or display raw IPs or forwarding headers. Compare only opaque rate-limit bucket behavior or a temporary owner-only boolean “spoof affected attribution” result; do not add a public diagnostic endpoint or retain raw headers.
4. Verify spoofed values cannot change attribution/rate-limit identity, including comma-separated/malformed header cases. If behavior is ambiguous, stop and obtain platform confirmation; do not tune `TRUST_PROXY_HOPS` by trial on production.
5. Only after evidence agrees with Express’s right-to-left trust model, set the exact hop count on the test service, rerun the spoof tests, then separately approve the production setting. The repository’s local test command is `npm test`; no live proxy-chain test was run here.

Do not increase/decrease the blueprint value based on local-only evidence.

## Environment and secret inventory

Validation references `src/config.js`, `scripts/storageBackup.js`, and `render.yaml`. Configure application variables in the Render service environment; local values belong in an ignored `.env` file. Examples use placeholders only. Never print secret values while checking them.

| Variable | Required? | Secret? | Default / validation | Configure at |
|---|---|---|---|---|
| `ADMIN_PASSWORD` | Yes | Yes | Required; at least 16 characters. | Render protected environment / local ignored `.env` |
| `IP_ENCRYPTION_KEY` | Yes | Yes | Required; exactly 64 hexadecimal characters (32 bytes). Preserve the key for historical decryptability; never reuse staging key. | Render protected environment / local ignored `.env` |
| `NODE_ENV` | Production | No | Defaults to `development`; set exactly `production` for secure cookies and production mount checks. | Render service environment |
| `PORT` | Render supplies | No | Defaults to 3000 locally; integer 1–65535. App binds `0.0.0.0`. | Automatically by Render; do not set unless platform directs |
| `STORAGE_BACKEND` | No | No | Defaults to and only accepts `json-file`. | Render service environment |
| `STORAGE_MOUNT_PATH` | Production | No | Must be absolute; required in production; `/var/data` in blueprint. | Render service environment, matching attached disk |
| `STORAGE_FILE` | No | No | Defaults to `<cwd>/data/visitors.json`; if mount configured, must be strictly inside it. Render `/var/data/visitors.json`. | Render service environment |
| `BACKUP_DIR` | No | No | Backup CLI defaults to sibling `backups/`; Render `/var/data/backups`. Must be private directory. | Render service environment / backup CLI environment |
| `BACKUP_RETENTION_COUNT` | No | No | Default 14; integer 1–1000. | Render service environment / backup CLI environment |
| `TRUST_PROXY_HOPS` | Production | No | Explicit integer 0–10 required; no auto-assumed production default. Exact production value is blocked pending chain evidence. | Render service environment after verified staging test |
| `GEO_PROVIDER` | No | No | Default and only supported provider `ipwho.is`. | Render service environment |
| `GEO_TIMEOUT_MS` | No | No | Default 5000; bounded 500–15000 ms. | Render service environment |
| `GEO_RETRY_COUNT` | No | No | Default 1; bounded 0–2. | Render service environment |
| `PUBLIC_RATE_LIMIT` | No | No | Default 30; bounded 5–300 requests/window. | Render service environment |
| `LOGIN_RATE_LIMIT` | No | No | Default 5; bounded 2–20 attempts/window. | Render service environment |
| `STAGING_MONGODB_URI` | No for V2 | Secret | Used only by the paused Mongo staging runner; never read by normal startup. Do not configure for this file-backed deployment. | No normal V2 service setting |
| `STAGING_ADMIN_PASSWORD` | No for V2 | Secret | Paused Mongo staging runner only. | No normal V2 service setting |
| `STAGING_IP_ENCRYPTION_KEY` | No for V2 | Secret | Paused Mongo staging runner only. | No normal V2 service setting |
| `STAGING_CONFIRM_DISPOSABLE` | No for V2 | Non-secret confirmation | Paused Mongo staging runner only. | No normal V2 service setting |

No secret is hardcoded in `render.yaml`; secret entries use `sync: false`. Normal startup does not require MongoDB or read staging Mongo variables. A placeholder `.env.example` is not a deployable credential set.

## Persistent storage and recovery

| Item | Status | Evidence |
|---|---|---|
| Storage file is inside persistent path | PASS (configuration) | `/var/data/visitors.json` under `/var/data`; production config enforces containment. |
| Missing mount fails safely | PASS (code/tests) | Mount check reads `/proc/self/mountinfo`; no production ephemeral fallback. Existing test covers missing mount. Real mounted disk is not checked. |
| Single-process protection | PASS (code) | Exclusive `${STORAGE_FILE}.lock`; second opener fails. Blueprint count one. Stale lock is not auto-deleted. |
| Lock recovery procedure | PASS (documented) | Stop service; confirm instance terminated and no process accesses same mounted disk; preserve lock metadata; remove only the exact stale lock after certainty. PID alone is not proof. If uncertain, leave it and escalate. |
| Restore safety | PASS (code/tests) | CLI only, exact interactive `RESTORE BACKUP_ID` confirmation, rejects active storage lock/incompatible format, recovery copy before atomic replacement. Do not run against live data during this preparation phase. |
| Backup integrity/retention | PASS (code/tests) | Timestamped data+manifest, SHA-256 re-read verification; 14 default; only older verified backups pruned; newest and recovery copies retained. |
| Independent backup | BLOCKED | No independent encrypted off-site destination, account, upload, or restore drill verified. |
| Staging restore drill | PASS (automated isolated tests) | Restore tests use generated temporary storage directories; this audit also runs those tests. No live restore. |

Operational commands (operator must set intended paths securely; avoid shell history containing secrets—these commands contain no secrets):

```sh
STORAGE_FILE=/var/data/visitors.json BACKUP_DIR=/var/data/backups BACKUP_RETENTION_COUNT=14 npm run backup -- create
STORAGE_FILE=/var/data/visitors.json BACKUP_DIR=/var/data/backups npm run backup -- list
STORAGE_FILE=/var/data/visitors.json BACKUP_DIR=/var/data/backups npm run backup -- verify BACKUP_ID
STORAGE_FILE=/var/data/visitors.json BACKUP_DIR=/var/data/backups npm run backup -- restore BACKUP_ID
```

Restore is interactive and requires typing exactly `RESTORE BACKUP_ID`. The recovery copy is stored beside the live storage file as a timestamped recovery data/manifest pair and is excluded from retention. Same-disk backups do not survive loss of `/var/data`. Before production, create encrypted off-site backups in an independently controlled account/failure domain and test restore against an isolated copy. No provider is configured here.

## Installation, browser, and capacity

| Item | Status | Evidence / next action |
|---|---|---|
| Node engine | PASS (declared) | `package.json` requires `>=20.18.1`; Render declares `20.18.1`. Runtime verification is pending deployment. |
| Lockfile | PENDING | `package-lock.json` exists; clean `npm ci --omit=dev` has not completed in this audit. Run in an internet-connected clean staging checkout. |
| Production dependency set | PENDING until final commands | Run `npm ls --omit=dev --depth=0` and `npm audit --omit=dev` from this project directory. |
| Browser automation | BLOCKED here | Playwright config uses Firefox by default; Firefox executable is absent in current environment. Do not install a browser for this audit. Run `npm ci` then `npx playwright install firefox` and `npm run test:browser` in supported Linux/CI with browser dependencies. Chromium in this root/PRoot Android environment is unsupported from prior investigation; use sandbox-capable standard Linux if separately testing Chromium. |
| API contract | PASS (code/tests) | Frontend requests and API routes share current public/admin response wrappers; automated tests exercise key success and error/auth contracts. A real-browser review remains blocked. |
| Storage load evidence | PENDING | Run `npm run test:storage-load -- 100` for a synthetic, temporary-directory measurement. It reports counts, serialized bytes and elapsed insert/read times only; it is not a production benchmark. |
| Production capacity | BLOCKED | JSON backend reads/parses the complete file for queries and performs full-file rewrite for each insert. Each insert is O(n) file I/O; cumulative N inserts are approximately O(N²) bytes written, plus parse/validation CPU and memory proportional to the full file. File limit 64 MiB, record limit 1,000,000. No measured production-like load/capacity evidence exists. |

Use exact verification sequence in an internet-connected clean checkout:

```sh
npm ci --omit=dev
npm ls --omit=dev --depth=0
npm run check
npm test
npm audit --omit=dev
```

For browser tests, install dev dependencies with `npm ci` in a supported CI/Linux environment, install the configured Firefox browser (`npx playwright install firefox`), then run `npm run test:browser`. Keep test credentials and synthetic storage isolated; do not point test commands at production storage.

The storage backend is a small single-process store, not a high-volume database. Consider migration to a transactional database adapter before the history approaches the file cap, full-file operations cause latency/memory pressure, or multiple app instances/workers are needed. Establish thresholds using representative synthetic load tests and measured memory/latency; this checklist does not claim capacity.

## Final decision

**NO-GO for production traffic at this audit.** Critical unresolved items: Render dashboard/disk provisioning and disk size, exact proxy chain and spoof resistance, production secret provisioning/rotation confirmation, clean install in a networked environment, supported browser suite, independent encrypted off-site backup plus isolated restore drill, and measured workload capacity. Do not route real visitors until the owner records evidence and reclassifies each item.
