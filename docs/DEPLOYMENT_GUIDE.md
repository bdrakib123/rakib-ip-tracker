# Render Web Service Deployment Guide

This project is deployed only as a Render Web Service created manually in the Render Dashboard. The repository does not provide a Render Blueprint. No service, environment setting, disk, database, or deployment has been verified by this guide.

## Render Dashboard settings

Choose **New → Web Service → Connect GitHub Repository**, then review the repository and branch before creating the service.

| Setting | Value |
| --- | --- |
| Repository | `bdrakib123/rakib-ip-tracker` |
| Branch | `main` (owner must confirm the intended release branch) |
| Runtime | Node |
| Root Directory | Blank (repository root) |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |
| Node version | Must satisfy `>=20.18.1`; select and verify the supported version in Render settings/build logs |
| Instance count | One process for JSON storage; keep one instance for the current deployment unless shared-storage coordination is independently reviewed |

The server runs in the foreground and listens on `0.0.0.0` using Render's `PORT`. Do not add a second start command or background process.

## Choose the storage mode deliberately

Do not change an existing service's storage backend until its data has a verified backup and a reviewed migration plan. The old JSON records have not been imported into Neon. No local copy of the Render disk is assumed available.

### Existing JSON-file storage

JSON production storage requires an attached persistent disk. In the Render Dashboard, attach/retain the correct disk and verify its mount path before start. Configure:

- `NODE_ENV=production`
- `STORAGE_BACKEND=json-file`
- `STORAGE_MOUNT_PATH` to the actual persistent mount
- `STORAGE_FILE` strictly inside that mount
- `BACKUP_DIR` inside the mount, understanding same-disk backups do not protect against disk loss
- `BACKUP_RETENTION_COUNT` as an integer from 1 through 1000

The application refuses production JSON startup without a configured mount and verifies that the mount is present. It uses a single-process lock and rejects concurrent processes against the same file. Do not choose a Render plan or filesystem without confirming persistent-disk availability for that service.

### Neon PostgreSQL storage

Neon mode is available only when explicitly selected. Configure:

- `STORAGE_BACKEND=neon-postgres`
- `DATABASE_URL` as a secret for the intended Neon project, branch, database, and role
- `NEON_FORCE_IPV4=1` only when required by the verified network environment; TLS certificate validation remains enabled
- Do not set JSON-only `STORAGE_MOUNT_PATH`, `STORAGE_FILE`, or `BACKUP_DIR`

The application checks the schema and performs a lightweight database ping at startup; it does not run migrations automatically. The manual command is `npm run migrate:neon`, and must be run only against a separately verified target after explicit approval. Do not run it against a production database as part of deployment. The current JSON backup/restore CLI does not back up Neon.

**Data cutover is blocked:** before switching an existing JSON-backed service, obtain a verified export/backup from the actual source disk, build and review an idempotent importer, preserve encryption-key continuity, compare record/event/session counts, and verify Neon recovery. Do not overwrite existing Neon records or assume a branch is empty.

## Environment variables and secrets

Configure values through the Render service's protected Environment page. Never place secret values in Git, commands, screenshots, logs, or support reports.

| Variable | Requirement |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | Supplied by Render; do not hardcode it |
| `ADMIN_PASSWORD` | Secret; at least 16 characters |
| `IP_ENCRYPTION_KEY` | Secret; exactly 64 hexadecimal characters. Keep the matching key for existing encrypted data; do not rotate casually. |
| `TRUST_PROXY_HOPS` | Required in production, integer 0–10. Do not assume `1`; verify the actual Render proxy chain and forged-header resistance before approving a value. |
| `GEO_PROVIDER` | Optional; defaults to `ipwho.is` |
| `GEO_TIMEOUT_MS`, `GEO_RETRY_COUNT`, `PUBLIC_RATE_LIMIT`, `LOGIN_RATE_LIMIT` | Optional, bounded by `src/config.js` |
| `DATABASE_URL` | Secret and required only for `neon-postgres` |
| `NEON_FORCE_IPV4` | Optional transport setting; does not bypass TLS validation |

Generate secrets privately with an approved password manager/secret generator. Do not use placeholders in production. Never change `IP_ENCRYPTION_KEY` for a database containing encrypted visitor IPs without a reviewed re-encryption plan and verified backup.

## Health, backups, and rollback

Set health check path to `/healthz`. For Neon, the endpoint performs `SELECT 1` through the repository and returns unavailable on failure without disclosing connection details. For JSON, it reports application health; it does not validate recovery copies.

For JSON storage, the local CLI supports:

```sh
npm run backup -- create
npm run backup -- list
npm run backup -- verify BACKUP_ID
npm run backup -- restore BACKUP_ID
```

Restore requires interactive confirmation, refuses an active storage lock, verifies the backup, preserves a recovery copy, and atomically replaces the file. Test restore only in an isolated synthetic directory. Same-disk backups are not independent disaster recovery. For Neon, configure the provider's backup/PITR plan and complete an isolated restore drill; the application CLI does not implement that workflow.

For an application rollback, use Render Dashboard's rollback after checking the older code against the current database schema. Do not roll back or re-run schema migrations automatically. Preserve the existing service, disk, database, and secrets while diagnosing.

## Before sending traffic

1. Confirm the service root, branch, Node version, build/start commands, health path, and instance count in the Render Dashboard.
2. Confirm which storage backend the service currently uses and verify that its target contains the expected data.
3. Verify secret names and key continuity without recording values.
4. Verify the proxy chain and spoofed `X-Forwarded-For` behavior with controlled requests before selecting `TRUST_PROXY_HOPS`.
5. Verify data migration and recovery before any JSON-to-Neon cutover.
6. Run synthetic smoke tests for login, public privacy, admin authorization, history, analytics, and export.
7. Review owner-side disk/Neon recovery, capacity, and actual health evidence. Local tests do not establish production readiness; production remains **NO-GO** until these are complete.
