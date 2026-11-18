# Deployment Guide (Render)

See [DEPLOYMENT_READINESS_CHECKLIST.md](DEPLOYMENT_READINESS_CHECKLIST.md) for the current evidence-based go/no-go status and owner-side configuration checks. This audit does not verify a Render service or authorize deployment.

For a separate, manually configured staging service and its restricted validation procedures, see [STAGING_SERVICE_CONFIGURATION.md](STAGING_SERVICE_CONFIGURATION.md), [STAGING_SETUP_GUIDE.md](STAGING_SETUP_GUIDE.md), [STAGING_VALIDATION_CHECKLIST.md](STAGING_VALIDATION_CHECKLIST.md), and the blank [STAGING_OWNER_EVIDENCE_TEMPLATE.md](STAGING_OWNER_EVIDENCE_TEMPLATE.md). Do not sync the production-oriented blueprint as a staging service.

This guide describes a separate Render service. It does not replace the existing service or change the root `render.yaml`.

## Isolated service setup

1. Create a separate Render Web Service from the intended repository and branch. Confirm service/plan eligibility for persistent disks in the dashboard; this repository cannot inspect the account's current service plan.
2. Set **Root Directory** to `rebuild`, build command to `npm ci --omit=dev`, start command to `npm start`, Node version to `20.18.1` or newer, and health check path to `/healthz`.
3. Attach a persistent disk in the service's **Disk** settings. Use mount path `/var/data`; this is the exact mount expected by V2. Choose a size based on expected history and growth in the dashboard. The blueprint omits `sizeGB`, so Render's documented default applies if the blueprint creates a disk; confirm the size before applying it because the size cannot be reduced later.
4. Configure one manually scaled instance. The blueprint specifies `numInstances: 1`; do not enable autoscaling or multiple instances. A disk-backed Render service is single-instance.
5. Set these non-secret environment values: `NODE_ENV=production`, `STORAGE_BACKEND=json-file`, `STORAGE_MOUNT_PATH=/var/data`, `STORAGE_FILE=/var/data/visitors.json`, and `TRUST_PROXY_HOPS=1` only after confirming the proxy topology. Render supplies `PORT`.
6. Set `BACKUP_DIR=/var/data/backups` and `BACKUP_RETENTION_COUNT=14`. Add `ADMIN_PASSWORD` (at least 16 characters) and `IP_ENCRYPTION_KEY` (64 hex characters) through Render's secret environment settings. Never put their values in `render.yaml` or source control. Do not set MongoDB variables for normal V2 startup.
7. Before enabling service traffic, verify the dashboard shows the disk attached at `/var/data`, then deploy only through the separately approved deployment process. Startup checks `/proc/self/mountinfo` and refuses to initialize file storage unless `/var/data` is an actual mount point. It will not fall back to ephemeral storage.
8. After an approved deployment, verify `/healthz`, public profile lookup, provider health after an actual lookup, auth denial/auth success, admin history privacy boundaries, and static assets. Verify storage through the protected admin server-health API.

`render.yaml` is the production-oriented V2 blueprint reference; it declares service `rakib-ip-intelligence-v2` and disk `rakib-ip-v2-data`, so it is not a staging specification. Do not apply it to an existing production service by assumption and do not use it for staging. Configure the separate staging service manually from `STAGING_SERVICE_CONFIGURATION.md`.

## Storage and database adapter status

V2 currently uses a versioned JSON file through a repository adapter. It does not import old Mongo records, so the new history starts empty. A separate Mongo repository remains in source for later restoration and tests, but normal server startup does not import it or use Mongo environment variables. Do not run the old staging integration workflow during this file-storage phase; MongoDB TLS diagnosis and integration are paused.

The file repository serializes writes inside one process, uses atomic file replacement, and acquires an exclusive `${STORAGE_FILE}.lock` file. A second process using the same file fails with `STORAGE_ALREADY_IN_USE`. A lock left by a crash is deliberately not removed automatically; confirm no service process is using the disk before manually recovering it. Do not run multiple instances or workers against this file. Render disks are single-instance, runtime-only, and are not available during build/pre-deploy commands or one-off jobs.

## Persistent storage and data-loss behavior

- Exact values: disk mount `/var/data`; `STORAGE_MOUNT_PATH=/var/data`; `STORAGE_FILE=/var/data/visitors.json`.
- Only data under the mounted path persists. Without a disk, production startup fails before creating a storage file. If the mount is absent or unavailable, startup fails with a sanitized `STORAGE_MOUNT_UNAVAILABLE` error and does not fall back to the service's ephemeral filesystem.
- The checked-in blueprint declares the disk name `rakib-ip-v2-data`, mount `/var/data`, and one instance. It intentionally omits disk size; choose and confirm a size in Render before syncing. Account-specific plan eligibility, blueprint synchronization, actual mount availability, and billing have not been verified here.
- Render documents that persistent disks require a paid compatible web/private/background service; attached disks prevent scaling beyond one instance and zero-downtime deploys. A redeploy stops the old instance before the replacement starts, so brief downtime is expected. With the configured disk attached and healthy, the JSON file under `/var/data` is retained across process restart and redeploy; disk loss, deletion, service/disk changes, or a failed backup/recovery process can still cause data loss.
- Do not switch `STORAGE_FILE` to a path outside `/var/data`, replace/delete the disk, or apply a blueprint that changes disk identity/mount without a reviewed data-preservation plan.

## Backup and recovery

### Scope and limitations

The CLI is manual. It does not schedule backups or transmit them off the service. Default settings are `BACKUP_DIR=/var/data/backups` and `BACKUP_RETENTION_COUNT=14`. A backup in `/var/data/backups` is on the **same Render disk** as `/var/data/visitors.json`; it protects against some file-level corruption or operator mistakes but does not protect against loss, deletion, detachment, or corruption of the entire disk. A workstation copy is also not independent if it is stored on the same device or account as the source.

The JSON backups contain sensitive visitor metadata; only each IP payload is encrypted by the application. The backup CLI does not encrypt the whole file. Do not upload backups to chat, logs, personal drives, or an unapproved destination. A production-grade independent copy should use an approved external object-storage/account with a separate failure domain, restricted write/read identities, TLS, whole-object encryption, and retention protections. No external account was connected and no user data was uploaded in this work.

Render documents automatic daily full-disk snapshots retained for seven days. These are provider snapshots of the same disk service, not an independent backup. Restoring one replaces the full disk and loses changes made after the snapshot. Snapshot availability for this service has not been verified.

### Configure and run backups

Set in the service environment: `STORAGE_FILE=/var/data/visitors.json`, `BACKUP_DIR=/var/data/backups`, and `BACKUP_RETENTION_COUNT=14`. Retention accepts integers 1–1000; only verified `backup` artifacts count. Invalid/incomplete artifacts are ignored and not pruned. The newest verified backup is always preserved. Pre-restore recovery copies are kept separately from normal retention and are not automatically deleted.

Run these commands from `rebuild/` in an authorized environment that has the service’s mounted disk available. The Render disk is not available to build/pre-deploy commands or one-off jobs; do not assume those shells can access it. If using a service shell, confirm it is attached to the correct V2 instance and disk before running any command.

```sh
STORAGE_FILE=/var/data/visitors.json BACKUP_DIR=/var/data/backups BACKUP_RETENTION_COUNT=14 npm run backup -- create
STORAGE_FILE=/var/data/visitors.json BACKUP_DIR=/var/data/backups npm run backup -- list
STORAGE_FILE=/var/data/visitors.json BACKUP_DIR=/var/data/backups npm run backup -- verify BACKUP_ID
```

Creation reads but does not replace the live file. It writes timestamped data and a manifest with format version, timestamp, byte size, and SHA-256; both files use restrictive permissions. The manifest is installed last. The CLI re-reads and validates the copy before reporting success. An exclusive operation lock prevents concurrent backup/restore/prune. Interrupted data-only or temporary artifacts are omitted from listings and left untouched. No automatic startup cleanup is performed.

### Restore and rollback procedure

1. Schedule a maintenance window and stop the V2 service through its normal Render controls. Confirm no process is using `/var/data/visitors.json`; preserve the current disk and do not remove unknown files.
2. From a verified interactive environment with the correct disk mounted, list and verify candidate IDs:

   ```sh
   STORAGE_FILE=/var/data/visitors.json BACKUP_DIR=/var/data/backups npm run backup -- list
   STORAGE_FILE=/var/data/visitors.json BACKUP_DIR=/var/data/backups npm run backup -- verify BACKUP_ID
   ```

3. Restore only the explicitly selected ID. The CLI requires typing the exact prompt `RESTORE BACKUP_ID` and refuses if `${STORAGE_FILE}.lock` exists. It then acquires an exclusive maintenance lock, preserves current bytes as a timestamped `recovery-...` pair, checks that the candidate format is compatible, stages and hashes a temporary file, and atomically renames it over the storage path.

   ```sh
   STORAGE_FILE=/var/data/visitors.json BACKUP_DIR=/var/data/backups npm run backup -- restore BACKUP_ID
   ```

4. Restart the service, verify protected storage health, public/admin authorization boundaries, and history count with an authorized admin. Keep the recovery copy until the restored service is reviewed.
5. To roll back a bad restore, stop the service again and use `list` to identify a prior verified backup or format-valid recovery copy, verify the chosen ID, then restore it with the typed confirmation. Corrupt recovery copies remain preserved but are not offered as restore sources. Do not overwrite or delete the only valid backup.

Restore refuses a live storage format newer than the candidate. Automated tests exercise restore only with isolated temporary synthetic files; no live restore was run.

### Lock recovery after a crash

The application lock is `${STORAGE_FILE}.lock`; backup/restore operation lock is `${BACKUP_DIR}/.backup-operation.lock`. Both are exclusive files with owner-only permissions and are intentionally never auto-deleted at startup.

To assess a stale lock, first stop the Render service and confirm its instance has terminated in the dashboard. A PID from a lock is only a clue: PIDs can be reused and may refer to different process namespaces. In an authorized shell on the same instance, inspect the owning process and command if available, and verify no server/backup command is still operating on the file. Preserve a copy of the lock metadata. Only after the service is stopped and no process can access that mounted disk should an operator remove the specific stale lock file; never remove it merely because a command timed out or its PID looks old. If the active state is uncertain, leave it in place and escalate to the service owner. Then retry a read-only `list`/`verify`; use `create` only after the storage and mount are healthy.

### Risk coverage

- Persistent disk failure, deletion, or loss: same-disk backups and Render snapshots may be lost with it; only an independently stored copy provides a separate failure domain.
- Accidental file deletion/corruption: verified backups may help if their disk remains available. The live file is never changed by backup creation.
- Bad deployment or format change: candidate version checks prevent restoring an older version over a newer live format; keep backups before schema/storage changes and use a tested rollback plan.
- Application crash: atomic storage writes protect against partial JSON replacement; abrupt death can leave locks and require verified manual recovery.
- Compromised service credentials: an attacker with disk/runtime access may read or delete same-disk backups. Separate backup credentials, encryption, and retention controls are required for stronger protection.

## Runtime behavior

Render assigns `PORT`; the server binds `0.0.0.0`. Startup initializes and validates the selected file store. Shutdown closes HTTP and waits for queued storage writes. `/healthz` reports only process liveness. Protected `/api/admin/server/health` reports storage availability and keeps the legacy `database` field as `not_configured`.

## Local and browser testing

- `npm ci` installs runtime and development dependencies for local tests. Render uses `npm ci --omit=dev`; the MongoDB adapter driver and Playwright are development dependencies only.
- Install a browser with `npx playwright install firefox` (Firefox is the verified browser for this environment). Chromium can be installed with `npx playwright install chromium`; run the same suite on a sandbox-capable non-root host with `PLAYWRIGHT_BROWSER=chromium npm run test:browser`. That path enables Chromium sandboxing and does not pass `--no-sandbox`. This PRoot/root container cannot run it; use a standard Linux VM/CI runner with Chromium sandbox/user-namespace support and browser system dependencies.
- `npm run test:browser` starts the real Express app routes with a test-only in-memory repository, synthetic admin password/key, and no `.env` loading or MongoDB connection. It injects the safe public test IP `8.8.8.8` into the loopback request for the actual public intelligence endpoint; the configured geolocation provider is contacted live. Do not use this harness or its test credentials in a deployed service.
- For a normal local server, copy `.env.example` only after reviewing it and set a unique random admin password and a random 32-byte hex encryption key. MongoDB variables are ignored by the normal V2 config. Do not use production credentials for local testing.

Production-required variables: `ADMIN_PASSWORD` (at least 16 characters), `IP_ENCRYPTION_KEY` (64 hex characters), `STORAGE_MOUNT_PATH` (absolute mounted directory), and `TRUST_PROXY_HOPS` (integer 0–10, explicitly chosen after verifying the deployed proxy chain). Configure `STORAGE_FILE` as a file strictly inside that mount. For the documented Render setup these values are `/var/data` and `/var/data/visitors.json`; the blueprint currently sets one proxy hop as a pending owner verification. Backup CLI variables are `BACKUP_DIR` (defaults to a `backups/` directory beside the storage file) and `BACKUP_RETENTION_COUNT` (defaults to 14; integer 1–1000). Other variables: `NODE_ENV`, `PORT`, `STORAGE_BACKEND`, `GEO_PROVIDER`, `GEO_TIMEOUT_MS`, `GEO_RETRY_COUNT`, `PUBLIC_RATE_LIMIT`, and `LOGIN_RATE_LIMIT`. The example key/password are placeholders and must be replaced before any normal server start.

## Production dependency verification

When registry access is available, from `rebuild/` run `npm ci --omit=dev`, then `npm ls --omit=dev --depth=0`, `npm run check`, and `npm test`. `npm ci` uses the committed lockfile and fails if the manifest and lock disagree. These commands have not been run as a clean network install in this audit; do not interpret the current offline dependency listing as a fresh Render build.

## Paused MongoDB staging integration

MongoDB connectivity investigation and staging integration are paused. This section documents the isolated runner retained for a future restoration phase; it is not part of normal V2 startup. Do not run the staging integration as part of the current file-storage migration. The runner uses only `STAGING_*` variables and does not fall back to normal app configuration.

Required staging variables:

- `STAGING_MONGODB_URI`: authenticated URI for a dedicated non-production staging cluster/user. Do not point this at the production cluster.
- `STAGING_ADMIN_PASSWORD`: unique staging-only password (at least 16 characters).
- `STAGING_IP_ENCRYPTION_KEY`: staging-only random 32-byte key encoded as 64 hex characters. Never reuse the production key.
- `STAGING_CONFIRM_DISPOSABLE=I_CONFIRM_DISPOSABLE_STAGING`: explicit confirmation that the configured URI is a disposable staging cluster.

Optional: `STAGING_DB_PREFIX` defaults to `rakib_ip_v2_staging` and is restricted to that namespace. Each integration run creates a timestamped/randomized database and collection name so it cannot reuse an existing collection. The runner never drops a database/collection, including on failure. It prints the generated namespace (never the URI or secrets) so retained synthetic artifacts can be identified later.

The prior integration runner's configuration values belong in a secure secret manager if a later approved MongoDB restoration phase resumes. The example file contains placeholders only. This runner is paused due to the unresolved TLS/server-selection failure and must not be run for the current migration.

When explicitly resumed in a separate phase, the retained runner is intended to test staging connection, indexes, synthetic insert/retrieval, encryption/masking, pagination, search, authorization/privacy, close, and reconnect. No real database operation is part of this migration. The old TLS/server-selection issue remains unresolved; this guide does not authorize or recommend retrying it.

## Rollback and cutover

Keep the existing service and root application intact while testing the new service under a separate URL. Do not change root directory, DNS, production environment variables, or the existing deployment until the new app has passed staging, privacy, browser, and database review and explicit cutover approval is received.
