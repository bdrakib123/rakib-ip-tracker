# Render Staging Service Specification — Rakib IP Tracker V2

**Preparation only. No Render resource has been created or accessed.** Production remains **NO-GO FOR PRODUCTION TRAFFIC**. Do not apply the existing `render.yaml` as this staging service: it names a different service and disk. No production service, storage, database, custom domain, credentials, or secrets may be referenced.

## Service identity and isolation

| Setting | Staging specification | Evidence / owner verification |
|---|---|---|
| Suggested service name | `rakib-ip-tracker-staging` | Create a new service; never select an existing production or legacy service. |
| Service type | Render Web Service only if access can be restricted before start | Default public web access is unsafe for an unvalidated staging collector. If plan/settings cannot restrict inbound traffic, do not start it; obtain an owner-approved private access design. |
| Repository | Repository containing this V2 tree | Owner verifies the intended GitHub repository and branch. No remote changed here. |
| Branch | **OWNER VERIFICATION REQUIRED** | Select the reviewed branch containing V2. Do not infer or silently choose a branch. |
| Root directory | `rebuild` | Present in the V2 `render.yaml`; package manifest and `src/` live there. |
| Build command | `npm ci --omit=dev` | Matches V2 blueprint. |
| Start command | `npm start` | `package.json` maps this to `node src/server.js`. |
| Node.js version | `20.18.1` | V2 `package.json` requires `>=20.18.1`; V2 blueprint declares `NODE_VERSION=20.18.1`. Verify actual runtime in Render. |
| Health check | `/healthz` | `src/app.js` implements this. It proves process liveness only, not disk readiness. |
| Instances/processes | Exactly one instance and one server process | Blueprint declares `numInstances: 1`; repository takes an exclusive `${STORAGE_FILE}.lock` and rejects a second process. Disable autoscaling/workers. |
| Staging disk name | `rakib-ip-tracker-staging-data` (suggested) | Must be newly provisioned, distinct from all production disks/snapshots. |
| Mount path | `/var/data` | Must match production-mode `STORAGE_MOUNT_PATH`; owner confirms actual mount in dashboard/runtime. |
| Disk size | **OWNER VERIFICATION REQUIRED** | Choose from staging need and confirm actual provisioned value; no size is inferred here. |
| Staging storage file | `/var/data/staging/visitors.json` | Absolute path strictly inside the staging mount; never use a production path or disk. |
| Staging backup directory | `/var/data/staging/backups` | Same staging disk only; this is not independent disaster recovery. |
| Staging hostname | **OWNER VERIFICATION REQUIRED** | Record the new Render URL in the evidence form. Do not attach production custom domains or route production frontend/API calls. |
| Dashboard/service permissions | **OWNER VERIFICATION REQUIRED** | Limit service and secret-management access to designated operators. Render documents Admin/Developer role and Scale/Enterprise requirements for web-service inbound IP rules; confirm eligibility and roles in the actual workspace. |

Render service-level inbound IP restrictions for web services require an eligible Scale/Enterprise plan and accept IPv4 CIDRs only. If unavailable, do not run a public staging web service without a separately approved access control. Render private services have no public URL; use one only if an approved private test path exists. Verify current requirements in the [Render inbound IP rules](https://render.com/docs/inbound-ip-rules), [private services](https://render.com/docs/private-services), and [disk](https://render.com/docs/disks) documentation. Plan eligibility, URL, resource provisioning, and actual disk size are **OWNER VERIFICATION REQUIRED**.

## Environment settings

Configure these only in the new staging service. Do not copy the production environment or its secret group. Render injects `PORT`; do not set a fixed port. V2 binds `0.0.0.0`. Setting `NODE_ENV=production` exercises secure-cookie and persistent-mount safeguards.

| Variable | Staging setting / purpose | Secret? | Validation in V2 / common error |
|---|---|---:|---|
| `NODE_ENV` | `production` for production-like isolated staging | No | Defaults to `development`; production enables mount verification and secure cookies. Do not use development mode to bypass storage safeguards. |
| `PORT` | Let Render inject | No | Defaults to 3000 locally; integer 1–65535. Do not hardcode a port in Render. |
| `ADMIN_PASSWORD` | Fresh staging-only admin credential | Yes | Required, minimum 16 characters. Do not reuse production or browser-test credentials. |
| `IP_ENCRYPTION_KEY` | Fresh staging-only key: 32 random bytes encoded as 64 hex characters | Yes | Required, exactly 64 hexadecimal characters. Do not reuse production key. |
| `STORAGE_BACKEND` | `json-file` | No | Defaults to and only accepts `json-file`; MongoDB is not required by normal startup. |
| `STORAGE_MOUNT_PATH` | `/var/data` | No | Required in production; must be absolute and present as a real mount. |
| `STORAGE_FILE` | `/var/data/staging/visitors.json` | No | Must be strictly inside `STORAGE_MOUNT_PATH`. |
| `BACKUP_DIR` | `/var/data/staging/backups` | No | Backup CLI destination; set explicitly for staging operations. |
| `BACKUP_RETENTION_COUNT` | `14` | No | Defaults to 14; integer 1–1000, only verified older local backups are eligible for retention. |
| `TRUST_PROXY_HOPS` | An explicit test candidate integer, selected only after reviewing ingress information | No | Required in production; integer 0–10. No value is approved for Render. |
| `GEO_PROVIDER` | `ipwho.is` or unset | No | Defaults to and only accepts `ipwho.is`. |
| `GEO_TIMEOUT_MS` | Optional | No | Default 5000; bounded 500–15000 ms. |
| `GEO_RETRY_COUNT` | Optional | No | Default 1; bounded 0–2. |
| `PUBLIC_RATE_LIMIT` | Optional; a lower value may be used only in isolated staging tests | No | Default 30; bounded 5–300 per window. Do not carry test-only tuning into production without review. |
| `LOGIN_RATE_LIMIT` | Optional | No | Default 5; bounded 2–20 attempts per window. |

### Staging secret procedure

1. Generate a unique `ADMIN_PASSWORD` and 32-byte `IP_ENCRYPTION_KEY` using an approved password/secret manager. Do not generate values in an echoing terminal, commit them, place them in `.env.example`, or send them in chat.
2. Privately check only the formats: password length at least 16; key exactly 64 hexadecimal characters. Do not record values in the evidence template.
3. Add the two names as protected/secret environment variables on the new staging service through Render Dashboard. Confirm names and secret flags, not values.
4. Never reuse production credentials or keys. Do not configure `MONGODB_URI` for normal file-backed staging.

## Proxy configuration and verification

Status: **BLOCKED — RENDER PROXY TOPOLOGY UNVERIFIED**.

`src/app.js` calls `app.set("trust proxy", config.trustProxyHops)`. `src/lib/ip.js` uses Express `req.ip`, falling back to the socket peer, and `src/lib/rateLimit.js` hashes `req.ip` for rate-limit buckets. The value is an integer hop count, not `true`/`false`. Zero hops ignores client-supplied XFF. The local regression tests show that one-hop trust accepts a forged XFF on a direct local connection. A trusted ingress must reliably sanitize/append headers in a way consistent with Express's right-to-left hop trust.

The current `render.yaml` contains `TRUST_PROXY_HOPS=1`; this setting is not evidence and must not be approved or copied. Production mode refuses to start without an explicit integer. A restricted staging service needs an explicit candidate to boot; mark the candidate unverified until the steps below pass:

1. Obtain current Render ingress documentation/support evidence for this service type and route, including proxy ordering and XFF overwrite/append behavior.
2. Restrict staging access to the controlled test source **before starting**. Do not use `0.0.0.0/0`. If the plan does not provide a supported restriction, stop.
3. Through the actual staging hostname, test direct/no-forwarding-header request, forged single XFF, multiple comma-separated values, and malformed values. Compare the privately observed attribution with the independently known test-client source; retain only sanitized pass/fail and HTTP status, never raw addresses/headers.
4. Exercise IPv4 and IPv6 separately where the controlled path supports them. If IPv6 is unavailable under the access controls, mark it NOT TESTED; do not infer it from IPv4.
5. With a fresh staging rate-limit window and a low staging-only limit, vary only forged XFF values from one test source. Confirm spoofing does not create new client buckets or reset the 429 threshold. These requests create only staging test rows.
6. If attribution changes, rate limiting splits, malformed input causes unexpected behavior, or evidence is ambiguous, stop and retain restrictions. Do not alter the production setting.
7. Record sanitized outcomes in `STAGING_OWNER_EVIDENCE_TEMPLATE.md`. Keep the status blocked until platform chain evidence and staging results agree. Production approval requires a separate review.

Do not add a public diagnostic endpoint. Tests in `test/app.test.js` cover local zero-hop spoof resistance, one-hop trust behavior, and (after this phase) changing XFF values against the local rate limiter. They cannot verify Render ingress.

## Staging isolation proof

Before starting, have a second operator compare these resources in the dashboard without viewing/copying secret values:

| Resource | Must be staging-only | Never reference |
|---|---|---|
| Service/environment | New service `rakib-ip-tracker-staging` | Production V2 or legacy application service/environment |
| Disk | New `rakib-ip-tracker-staging-data` at `/var/data` | Production disk, snapshot, or mount |
| Storage file | `/var/data/staging/visitors.json` | Production storage path or file |
| Backup path | `/var/data/staging/backups` | Production backup directory/archive |
| Encryption key/password | New staging-only secret values | Production keys/passwords or browser test credentials |
| URL/hostname | Newly assigned staging URL | Production hostname/custom domain |
| Network clients | Restricted owner-controlled test source(s) | Public traffic or production frontend/API calls |

A separate service alone does not prove isolation. Confirm the disk identity, all paths, service environment, URL and secret configuration independently. No production resources or values may be connected for comparison.

## Owner dashboard procedure

1. Confirm the intended repository and reviewed branch; record them. Do not change Git remotes or authentication.
2. Create a new Render Web Service named `rakib-ip-tracker-staging`; do not select an existing service.
3. Configure root `rebuild`, build `npm ci --omit=dev`, start `npm start`, Node `20.18.1`, `/healthz`, and one instance. Verify each setting against this specification.
4. Attach a newly created `rakib-ip-tracker-staging-data` disk at `/var/data`; confirm the actual size. Never attach/clone production disk data.
5. Configure the non-secret settings and staging-only storage/backup paths. Add fresh secrets only through protected service environment settings.
6. Confirm an inbound IPv4 allowlist is available and apply only controlled test source CIDRs before start. Never permit all IPv4 addresses. If unavailable, stop and obtain an owner-approved alternate access design.
7. Select an explicit staging-only proxy candidate based on platform evidence, label it unverified, then run the spoof and rate-limit tests. Do not modify the production blueprint/environment.
8. Complete the second-person isolation review and evidence template without secret values or screenshots containing secrets.
9. Only then start staging. Verify sanitized startup status, then `GET /healthz`; record status/time. This endpoint is liveness only.
10. Using staging-only admin credentials, verify protected `/api/admin/server/health` reports storage available. Avoid copying visitor history/export data into evidence.
11. Stop/restrict staging after validation; retain the staging disk until the owner approves its disposition. Do not delete files, backups, or locks as routine shutdown.

No Render action has been performed. Instance count, plan, actual runtime, disk, hostname, access restrictions, secrets, health, and proxy behavior remain owner verification.
