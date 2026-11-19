# Deployment Guide

## Render blueprint

`render.yaml` is at the repository root and omits `rootDir`, so the source root is used. It declares `npm ci --omit=dev`, `npm start`, Node `20.18.1`, one instance, `/healthz`, and a disk mounted at `/var/data`. Storage is `/var/data/visitors.json`; same-disk backups go to `/var/data/backups`. The blueprint does not specify a compute plan or disk size. Confirm the actual plan, disk size, disk attachment, and capacity in the Render dashboard before use; no service or disk provisioning is verified by this repository configuration.

The server binds to `0.0.0.0` using Render's `PORT`. Do not run multiple instances or processes against the JSON file. Disk access is runtime-only. Render documents attached disks as single-instance and unavailable during builds; disk-backed redeployments can briefly interrupt service.

Official references: [Render Blueprint specification](https://render.com/docs/blueprint-spec), [Persistent disks](https://render.com/docs/disks), [Health checks](https://render.com/docs/health-checks). Checked 2026-11-19.

## Production configuration

- `NODE_ENV=production`
- `STORAGE_BACKEND=json-file`
- `STORAGE_MOUNT_PATH=/var/data`
- `STORAGE_FILE=/var/data/visitors.json`
- `BACKUP_DIR=/var/data/backups`
- `BACKUP_RETENTION_COUNT=14` (integer 1–1000)
- `ADMIN_PASSWORD` (secret; at least 16 characters)
- `IP_ENCRYPTION_KEY` (secret; exactly 64 hex characters)
- `TRUST_PROXY_HOPS` (integer 0–10; blueprint uses `1`, pending actual ingress verification)
- `PORT` is supplied by Render (local default 3000)
- `GEO_PROVIDER=ipwho.is`; optional `GEO_TIMEOUT_MS`, `GEO_RETRY_COUNT`, `PUBLIC_RATE_LIMIT`, `LOGIN_RATE_LIMIT` have bounded validation in `src/config.js`

Set secrets only through the protected dashboard interface. Do not add MongoDB variables: they are unused. Missing production mounts and invalid configuration fail startup; there is no ephemeral fallback.

## Temporary staging

Free temporary staging is separate from the persistent-disk blueprint. It requires `STAGING_MODE=true`, `STAGING_EPHEMERAL_STORAGE=true`, an absolute `STAGING_STORAGE_DIR` beneath OS temp storage, and a separate `STAGING_ACCESS_PASSWORD` of 32–256 printable ASCII characters. The password must differ from admin password and encryption key. Staging requires proxy trust zero, disallows persistent/backup paths, and places Basic Auth in front of all routes except `GET /healthz`. It is disposable and must not hold real visitor data. See `RENDER_FREE_STAGING_GUIDE.md`.

## Backup commands

Run at repository root against the intended mounted storage:

```sh
npm run backup -- create
npm run backup -- list
npm run backup -- verify BACKUP_ID
npm run backup -- restore BACKUP_ID
```

Restore is an interactive, destructive operation. It requires typing `RESTORE BACKUP_ID`, refuses an active `${STORAGE_FILE}.lock`, verifies checksum/manifest/schema, creates a recovery copy and atomically replaces the file. Do not test it against live storage. Same-disk backups do not protect against loss of the full disk; no off-site destination is configured.

A restore drill must use an isolated temporary directory and synthetic records. Set `STORAGE_FILE` and `BACKUP_DIR` within that test directory, close the repository, and remove only the test-owned temporary directory after verifying isolation.

## Owner checks before traffic

1. Confirm root directory, commands, health path, disk mount/size and one instance in the Render dashboard.
2. Confirm secret variable names without recording values.
3. Test the actual proxy chain and forged forwarding headers in isolated staging before approving the current one-hop value.
4. Verify restart persistence and perform a synthetic isolated restore drill; arrange independent encrypted backups.
5. Run browser tests in supported Linux CI and review authentication/privacy behavior.
6. Resolve every blocker in `DEPLOYMENT_READINESS_CHECKLIST.md`. Production remains NO-GO pending owner verification.
