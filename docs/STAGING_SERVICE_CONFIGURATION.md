# Isolated Render Staging Specification

Preparation only; no Render service exists or was accessed. Production remains NO-GO.

| Setting | Required staging configuration | Status |
|---|---|---|
| Service name | `rakib-ip-tracker-staging` | Owner creates separately |
| Repository/branch | Reviewed V3 repository and branch | Owner verifies |
| Root Directory | Blank (repository root) | Matches root `package.json` and `src/server.js` |
| Build | `npm ci --omit=dev` | Root package script/dependency contract |
| Start | `npm start` (`node src/server.js`) | Verified from manifest |
| Node | `20.18.1` | Manifest requires `>=20.18.1` |
| Health | `/healthz` | Implemented liveness endpoint |
| Instances/processes | One | JSON lock prevents shared-file multi-process use |
| Disk | New staging-only persistent disk at `/var/data` | Owner attaches and confirms actual size |
| Storage file | `/var/data/staging/visitors.json` | Must be strictly inside staging mount |
| Backup directory | `/var/data/staging/backups` | Same disk only, not independent DR |
| Domain/access | Staging-only hostname and restricted ingress | Owner action; never use production host |

## Environment variables

| Variable | Staging value/validation | Secret? |
|---|---|---|
| `NODE_ENV` | `production` for secure cookies/HSTS | No |
| `PORT` | Leave unset; Render supplies it | No |
| `ADMIN_PASSWORD` | At least 16 characters | Yes |
| `IP_ENCRYPTION_KEY` | Exactly 64 hex characters | Yes |
| `STORAGE_BACKEND` | `json-file` | No |
| `STORAGE_MOUNT_PATH` | `/var/data` | No |
| `STORAGE_FILE` | `/var/data/staging/visitors.json` | No |
| `BACKUP_DIR` | `/var/data/staging/backups` | No |
| `BACKUP_RETENTION_COUNT` | Integer 1–1000; conservative default 14 | No |
| `TRUST_PROXY_HOPS` | Explicit integer 0–10; pending real proxy evidence | No |
| `GEO_PROVIDER` | `ipwho.is` only | No |
| `GEO_TIMEOUT_MS`, `GEO_RETRY_COUNT` | Optional bounded numeric settings | No |

Generate new staging secrets privately in the approved secret manager. Never reuse production values or expose values in logs/evidence. Do not set `STAGING_MODE`/`STAGING_EPHEMERAL_STORAGE` for this persistent-disk staging flow.

## Proxy verification gate

Express trust is the configured integer hop count; rate limiting keys off Express's client IP. Local tests prove zero-hop mode ignores forged XFF and one-hop direct requests accept forwarded input. They cannot prove Render's proxy chain. Keep `BLOCKED — RENDER PROXY TOPOLOGY UNVERIFIED` until the owner uses controlled source traffic through the actual staging hostname, compares platform-confirmed forwarding behavior, tests direct/forged/multiple/malformed XFF and verifies rate-limit buckets cannot be spoofed. Do not add a diagnostic endpoint or change production configuration based on guesswork.

## Disk and recovery gate

Owner verifies new disk identity, `/var/data` mount and size, storage/backup paths, private permissions, restart persistence, missing-mount failure, corrupt synthetic file failure, active-lock refusal and unexpected-exit recovery. Never automatically remove a lock. Stop the service and verify no process can access the disk before any manual stale-lock recovery. Same-disk backups do not protect against disk loss; independent encrypted backup remains blocked pending owner authorization.
