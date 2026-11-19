# Render Free Temporary Staging Guide — V3

**Purpose:** short-lived, synthetic-data-only validation of the unified V3 application on Render Free. This is not a production deployment, persistent staging environment, backup plan, or approval for real visitor traffic. The Free filesystem is ephemeral; restarts, redeploys, instance replacement, and spin-down may erase all visitor records.

## V3 service settings to verify

The isolated Blueprint is `render-free-staging.yaml`. When creating a new Blueprint in Render, set **Blueprint Path** to `render-free-staging.yaml`; do not select or sync the production `render.yaml`. Render supports custom Blueprint paths. Review the proposed resource name before approving so it creates only `rakib-ip-tracker-free-staging` as a new service.

| Render setting | Value |
|---|---|
| Service name | `rakib-ip-tracker-free-staging` |
| Repository root directory | Blank (repository root) |
| Build command | `npm ci --omit=dev` |
| Start command | `npm start` |
| Health check path | `/healthz` |
| Instance plan | `Free` |
| Instance count | One |
| Node version | `20.18.1` minimum per `package.json`; configure `NODE_VERSION=20.18.1` if supported in the dashboard |
| Persistent disk | **Do not attach one** |

These settings match the V3 root package and routes. The Blueprint explicitly sets `plan: free`, one instance, and does not declare a disk. No Render dashboard was accessed and the service does not exist yet. Render documents Free web services as using ephemeral filesystems and not supporting persistent disks; changes to the local filesystem can be lost during restart, redeploy, or spin-down. Confirm current plan availability and the proposed Blueprint diff in the owner dashboard before creation.

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

Do **not** configure `STORAGE_MOUNT_PATH`, `STORAGE_FILE` (unless it exactly matches the derived staging path, which is unnecessary), or `BACKUP_DIR`. MongoDB is not part of the V3 application. A provided storage mount is rejected in staging mode. In ordinary production mode, staging flags must not be enabled and a real mounted `STORAGE_MOUNT_PATH` remains mandatory.

`STAGING_ACCESS_PASSWORD` is an application-level HTTP Basic Auth gate. It runs before JSON parsing, static assets, visitor collection, admin routes, exports, and other application routes. Only exact `GET /healthz` bypasses it for Render health checks. Unauthorized requests receive 401 and a Basic challenge; after 10 failed attempts from the same trusted source within 15 minutes, the gate returns 429. Submitted credentials are not logged. Staging admin write-origin checks require an HTTPS `Origin` matching the request Host; they do not trust forwarded-protocol headers. Render’s public service URL must be accessed over HTTPS; this Basic Auth gate is an extra staging barrier, not production-grade identity or network isolation. Do not distribute the staging URL/password publicly.

## Owner dashboard procedure

1. In Render, choose **New > Blueprint**, connect the reviewed repository and branch, and set Blueprint Path to `render-free-staging.yaml`. Do not select `render.yaml`, which remains the persistent-disk configuration.
2. Before creating anything, review the Blueprint diff. It must propose only a new web service named `rakib-ip-tracker-free-staging`; cancel if it proposes changes to an existing service or any database/disk resource.
3. Confirm root directory is the repository root (the Blueprint omits `rootDir`), build/start/health commands match the table, plan is Free, and instance count is one. The Blueprint has no disk declaration; do not attach a disk, autoscaler, worker, or production domain.
4. Provide `ADMIN_PASSWORD`, `IP_ENCRYPTION_KEY`, and `STAGING_ACCESS_PASSWORD` only through Render’s protected secret prompt or environment-variable interface. Generate unique staging-only values: admin password at least 16 characters, encryption key 32 random bytes encoded as 64 hex characters, and access password 32–256 printable ASCII characters. Keep them distinct and never reuse production secrets. Never put values in Git, command history, logs, screenshots, reports, or chat.
5. Confirm the non-secret variables from the Blueprint: both staging flags true, exact `/tmp/rakib-ip-tracker-staging` path, `STORAGE_BACKEND=json-file`, `TRUST_PROXY_HOPS=0`, and no `STORAGE_MOUNT_PATH`, `STORAGE_FILE`, `BACKUP_DIR`, MongoDB URI, production credentials, or production domain. Let Render supply `PORT`.
6. Restrict who receives the staging URL. Free service inbound IP restrictions are not assumed available. Basic Auth is mandatory and the app refuses staging startup without its password. Do not treat this as suitable for public or real-visitor traffic.
7. Start the new staging service only after owner review and approval. This guide does not create or deploy it.
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

Render references checked 2026-11-19: [Blueprint specification](https://render.com/docs/blueprint-spec) (Free plan, instance count, commands, environment variables, and omitted root directory), [Blueprint setup](https://render.com/docs/infrastructure-as-code) (custom Blueprint Path), and [Free service limitations](https://render.com/docs/free) (ephemeral filesystem, restarts/spin-down, and no persistent disks).
