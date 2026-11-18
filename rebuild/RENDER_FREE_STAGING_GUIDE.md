# Render Free Temporary Staging Guide

**Purpose:** short-lived, synthetic-data-only validation of the V2 application on Render Free. This is not a production deployment, persistent staging environment, backup plan, or approval for real visitor traffic. The Free filesystem is ephemeral; restarts, redeploys, instance replacement, and spin-down may erase all visitor records.

## Verified V2 service settings

| Render setting | Value |
|---|---|
| Service name | `rakib-ip-tracker-free-staging` |
| Repository root directory | `rebuild` |
| Build command | `npm ci --omit=dev` |
| Start command | `npm start` |
| Health check path | `/healthz` |
| Instance plan | `Free` |
| Instance count | One |
| Node version | `20.18.1` minimum per `package.json`; configure `NODE_VERSION=20.18.1` if supported in the dashboard |
| Persistent disk | **Do not attach one** |

These settings are prepared from the V2 package and routes; no Render dashboard was accessed and the service does not exist yet. Render Free provides 512 MB RAM, no persistent disk, and may spin down after 15 minutes without incoming traffic. Check Render’s current plan documentation and dashboard before creating the service.

## Explicit temporary-storage mode

The application accepts temporary file storage only when both flags are exactly `true`:

- `STAGING_MODE=true`
- `STAGING_EPHEMERAL_STORAGE=true`

Required variables for this mode:

| Variable | Staging value/format | Secret? | Validation |
|---|---|---:|---|
| `NODE_ENV` | `production` | No | Enables production cookie/HSTS behavior. Temporary storage is permitted only with both explicit staging flags; production without them still requires a mounted persistent disk. |
| `PORT` | Omit; let Render supply it | No | Application validates integer 1–65535 and binds `0.0.0.0`. |
| `ADMIN_PASSWORD` | Unique staging admin password | **Yes** | Required; at least 16 characters. Never reuse production value. |
| `IP_ENCRYPTION_KEY` | Separately generated staging key, 64 hexadecimal characters | **Yes** | Required; exactly 32 bytes encoded as 64 hex chars. Never reuse production key. |
| `STORAGE_BACKEND` | `json-file` | No | Only supported backend. MongoDB is not loaded or contacted. |
| `STAGING_MODE` | `true` | No | Must be explicitly enabled together with the ephemeral flag. |
| `STAGING_EPHEMERAL_STORAGE` | `true` | No | Must be explicitly enabled together with staging mode. |
| `STAGING_ACCESS_PASSWORD` | Unique random staging gate password, 32–256 printable ASCII characters | **Yes** | Required. Basic Auth username is fixed to `rakib-staging`. Do not reuse the admin password. |
| `STAGING_STORAGE_DIR` | `/tmp/rakib-ip-tracker-free-staging` | No | Must be an absolute dedicated child directory of the OS temporary directory. Directory must be owned by the service process and private. Storage file is derived as `<dir>/visitors.json`. |
| `TRUST_PROXY_HOPS` | `0` | No | Staging forces zero trusted hops and rejects another configured value. This avoids trusting unverified forwarded headers; client-IP attribution through Render is not validated. |

Do **not** configure `STORAGE_MOUNT_PATH`, `STORAGE_FILE` (unless it exactly matches the derived staging path, which is unnecessary), or `BACKUP_DIR`. Do not set MongoDB variables; the staging config rejects `MONGODB_URI` and `STAGING_MONGODB_URI`, and normal startup does not import the dormant Mongo adapter. A provided storage mount is rejected in staging mode. In ordinary production mode, staging flags must not be enabled and a real mounted `STORAGE_MOUNT_PATH` remains mandatory.

`STAGING_ACCESS_PASSWORD` is an application-level HTTP Basic Auth gate. It runs before JSON parsing, static assets, visitor collection, admin routes, exports, and other application routes. Only exact `GET /healthz` bypasses it for Render health checks. Unauthorized requests receive 401 and a Basic challenge; after 10 failed attempts from the same trusted source within 15 minutes, the gate returns 429. Submitted credentials are not logged. Staging admin write-origin checks require an HTTPS `Origin` matching the request Host; they do not trust forwarded-protocol headers. Render’s public service URL must be accessed over HTTPS; this Basic Auth gate is an extra staging barrier, not production-grade identity or network isolation. Do not distribute the staging URL/password publicly.

## Owner dashboard procedure

1. Create a **new Web Service** from the reviewed GitHub repository and selected branch. Confirm repository ownership and branch manually. Do not use or sync the existing production `render.yaml`; it describes the persistent-disk production-intended service.
2. Set the service name and settings from the table above. Set root directory to `rebuild`. Configure one instance and select Free. Do not attach a disk, autoscaler, worker, or production domain.
3. Add non-secret variables using the exact staging values/formats above. Let Render provide `PORT`.
4. Generate three distinct staging-only secrets using an owner-approved secret manager or local secure generator: `ADMIN_PASSWORD` (minimum 16 characters), `IP_ENCRYPTION_KEY` (32 random bytes encoded as 64 hex characters), and `STAGING_ACCESS_PASSWORD` (32–256 printable ASCII characters). Enter them directly into Render’s protected environment-variable interface. Never put values in Git, command history, logs, screenshots, reports, or chat. Never copy production secrets.
5. Review all environment-variable names without revealing values. Confirm both staging flags are `true`, `TRUST_PROXY_HOPS` is `0`, and no persistent storage path, MongoDB URI, production credentials, or production domain is configured.
6. Restrict who receives the staging URL. Free service inbound IP restrictions are not assumed available. Basic Auth is mandatory and the app refuses staging startup without its password. Do not treat this as suitable for public or real-visitor traffic.
7. Before allowing the first start, review root, branch, commands, instance count, plan, and variable names a second time. Start only after owner approval. No deployment is performed by this guide.
8. Verify unauthenticated `GET /healthz` returns healthy. Verify the staging URL prompts for Basic Auth; use username `rakib-staging` and the private staging access password. Run only synthetic tests. Confirm visitor creation, admin login, history/export access, and rate limits while authenticated.
9. Verify unauthorized requests to `/`, static assets, visitor creation, admin APIs, and exports return 401. Do not put credentials in curl command arguments or shell history. Use a secure HTTP client credential prompt or browser prompt.
10. Review sanitized logs for startup status and error codes only. Never copy environment output, Authorization headers, IPs, request bodies, or visitor data into evidence.
11. Stop the service when validation is complete. Assume all temporary data can be erased by spin-down, restart, deploy, or instance replacement. Do not use backup/restore commands in this mode.

## Proxy and rate-limit limits

`TRUST_PROXY_HOPS=0` means Express ignores forwarded client-address headers. Local tests can prove that forged `X-Forwarded-For` does not change `req.ip`/rate-limit identity under zero trust. Free staging can test access protection and observe that requests share the service’s conservative rate-limit identity. It cannot prove the production proxy topology or actual visitor IP attribution. Do not increase the hop count based on a single observed header. A controlled source, sanitized owner evidence, and platform-confirmed proxy/header behavior are required before approving any nonzero trust setting. Production `TRUST_PROXY_HOPS` remains unchanged and unapproved.

## Temporary data, backups, and resource limits

- The JSON repository creates `<STAGING_STORAGE_DIR>/visitors.json` and a private lock file. The configured directory must be under the operating-system temporary directory. Staging mode rejects `/var/data`/mount configuration; production still requires and checks its persistent mount.
- Data may disappear when Render restarts, redeploys, replaces, or spins down the instance. Do not import real data and do not infer persistence from a successful same-process test.
- The backup/restore CLI refuses to operate whenever either staging flag is enabled. There is no staging backup endpoint. This mode provides no disaster recovery.
- The JSON store reads and parses the full file and rewrites the full file for each insert, with a 64 MiB cap and one-process lock. At 512 MB, object expansion, buffers, Express, and Node runtime all consume memory; CPU is limited. Do not translate local benchmarks into a Free-plan capacity claim and do not run uncontrolled load against the service.
- Free staging is useful only for low-volume smoke tests with synthetic records. For persistence, restart survival, realistic capacity, backups, recovery, or production-readiness validation, use a separately approved paid persistent-disk staging service and complete the dedicated disk/proxy/backup checks.

## Evidence and shutdown

Record service name, plan, root, branch, Node version, build/start/health result, access-gate cases, and sanitized test statuses. Do not include secrets, visitor IPs, forwarding headers, or data screenshots. A passing Free smoke test is only **temporary runtime validation**; it does not equal paid persistent-disk staging validation and does not change production NO-GO status.
