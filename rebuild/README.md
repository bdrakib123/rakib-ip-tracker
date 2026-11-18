# RAKIB IP Intelligence System V2

A new, independent, mobile-first IP intelligence application. It lives entirely in `rebuild/`; the existing root application, deployment configuration, and database were not replaced or started.

## Highlights

- Public digital profile with IP, best-effort approximate geolocation, conservative device parsing, and browser-exposed signals.
- Separate password-protected admin console with visitor history, filters, charts, export, provider/storage health, and an authenticated SSE feed.
- Allowlisted public serializers, masked public history, encrypted visitor IPs at rest, input bounds, rate limits, and safe structured logs.
- Modular provider interface. `ipwho.is` is the current adapter; provider reachability is reflected only after an actual provider request.
- Versioned JSON-file visitor storage behind a repository adapter. Normal startup does not require or connect to MongoDB.

## Requirements and local start

- Node.js 20.18.1 or newer.
- Node.js 20.18.1 or newer. No database service is required for normal startup.
- The MongoDB driver is a development dependency used only by the dormant adapter tests; production install omits development dependencies.

```sh
cd rebuild
npm ci
cp .env.example .env
```

Set `ADMIN_PASSWORD` and `IP_ENCRYPTION_KEY` in `.env`, then run:

```sh
npm start
```

Open `http://localhost:3000`. The public dashboard is `/`; the admin sign-in is `/admin`. `GET /healthz` is a minimal public process-health endpoint. Full tests do not require MongoDB and use mocked services:

```sh
npm test
npm run check
```

## Environment variables

| Name | Required | Purpose |
|---|---:|---|
| `NODE_ENV` | No | Set `production` for secure cookies and HSTS. |
| `PORT` | No | HTTP port; Render supplies this automatically. |
| `STORAGE_BACKEND` | No | `json-file` (default and only active V2 backend). |
| `STORAGE_MOUNT_PATH` | Production | Absolute persistent mount path. Required in production; V2 refuses startup unless it is mounted. |
| `STORAGE_FILE` | No | JSON storage path. On Render use `/var/data/visitors.json`, strictly inside `STORAGE_MOUNT_PATH=/var/data`. |
| `BACKUP_DIR` | No | Backup directory; defaults to `<STORAGE_FILE directory>/backups`. Render uses `/var/data/backups`. |
| `BACKUP_RETENTION_COUNT` | No | Successful storage backups to retain (1–1000); default 14. |
| `ADMIN_PASSWORD` | Yes | Admin password, at least 16 characters. Use a unique random value. |
| `IP_ENCRYPTION_KEY` | Yes | 32-byte AES key encoded as exactly 64 hex characters. To read old encrypted IPs, configure the same key that encrypted them. |
| `TRUST_PROXY_HOPS` | Production | Integer 0–10. Must be explicit in production. The current Render blueprint sets `1`, which must be checked against the deployed proxy chain; local development defaults to zero. |
| `GEO_PROVIDER` | No | Provider adapter identifier; currently `ipwho.is`. |
| `GEO_TIMEOUT_MS` | No | Provider request timeout, bounded to 500–15000 ms. |
| `GEO_RETRY_COUNT` | No | Retries for transient failures, bounded to 0–2. |
| `PUBLIC_RATE_LIMIT` | No | Public intelligence requests per IP per minute (default 30). |
| `LOGIN_RATE_LIMIT` | No | Admin login attempts per IP per 15 minutes (default 5). |
| `STAGING_MODE` | Temporary staging only | Explicitly enables the isolated temporary staging profile only when `STAGING_EPHEMERAL_STORAGE=true`. |
| `STAGING_EPHEMERAL_STORAGE` | Temporary staging only | Must be exactly `true` together with `STAGING_MODE=true`; otherwise no ephemeral staging is allowed. |
| `STAGING_ACCESS_PASSWORD` | Temporary staging only | Basic Auth password for the staging-wide access gate; 32–256 printable ASCII characters, secret, separate from `ADMIN_PASSWORD`. |
| `STAGING_STORAGE_DIR` | Temporary staging only | Required absolute dedicated child directory under the OS temp directory; staging file is derived as `visitors.json`. |

Generate a local key without writing it to this repository with `node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'`. Store secrets only in the local ignored `.env` or Render's secret environment settings.

The JSON file is initialized with a versioned empty store when absent. Writes are serialized within the Node process and saved through a same-directory temporary file plus atomic rename. The file is created with owner-only permissions where supported. A corrupt or incompatible store fails closed and is never reset automatically. An exclusive `${STORAGE_FILE}.lock` prevents a second process from opening the same file; crash-left locks require manual recovery after confirming the process is stopped. In production, startup verifies that `STORAGE_MOUNT_PATH` is mounted and that `STORAGE_FILE` is inside it; it will not silently use ephemeral storage. The V2 Render blueprint declares `/var/data` and one instance. Render account eligibility, disk provisioning, and a real deployment are not verified.

## Backup CLI

The backup tool is manual and does not run a scheduler or upload data externally. It creates a timestamped JSON copy and checksum manifest, verifies both, and prunes only older verified backups after successful creation. Default retention is 14. Commands require `STORAGE_FILE`; `BACKUP_DIR` defaults beside the file under `backups/`.

```sh
STORAGE_FILE=/var/data/visitors.json BACKUP_DIR=/var/data/backups BACKUP_RETENTION_COUNT=14 npm run backup -- create
STORAGE_FILE=/var/data/visitors.json BACKUP_DIR=/var/data/backups npm run backup -- list
STORAGE_FILE=/var/data/visitors.json BACKUP_DIR=/var/data/backups npm run backup -- verify BACKUP_ID
STORAGE_FILE=/var/data/visitors.json BACKUP_DIR=/var/data/backups npm run backup -- restore BACKUP_ID
```

Restore requires an interactive terminal and typing `RESTORE BACKUP_ID`. It refuses when the application storage lock exists, writes a pre-restore recovery copy, verifies staged bytes, then atomically replaces the file. `list` shows normal backups and format-valid recovery copies separately; valid recovery-copy IDs can be verified/restored too, but recovery copies are excluded from automatic retention. Tests run only against isolated synthetic files.

## Privacy notes

The public intelligence endpoint describes the requesting browser and returns that requester's own IP and approximate network details. Public history contains only masked IPs and coarse location. Another visitor's full IP, ISP, organization, ASN, coordinates, device/browser details, raw User-Agent, detailed records, analytics, export, and provider diagnostics are restricted to the admin API. The browser does not send canvas, WebGL, or fingerprint hashes. See [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md).

## Project guides

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [API_DOCUMENTATION.md](API_DOCUMENTATION.md)
- [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)
- [TEST_REPORT.md](TEST_REPORT.md)
- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)
- [DEPLOYMENT_READINESS_CHECKLIST.md](DEPLOYMENT_READINESS_CHECKLIST.md)
- [STAGING_SETUP_GUIDE.md](STAGING_SETUP_GUIDE.md)
- [RENDER_FREE_STAGING_GUIDE.md](RENDER_FREE_STAGING_GUIDE.md) — temporary synthetic-data-only Free validation; no persistence or backup guarantee.
- [STAGING_SERVICE_CONFIGURATION.md](STAGING_SERVICE_CONFIGURATION.md)
- [STAGING_VALIDATION_CHECKLIST.md](STAGING_VALIDATION_CHECKLIST.md)
- [STAGING_OWNER_EVIDENCE_TEMPLATE.md](STAGING_OWNER_EVIDENCE_TEMPLATE.md)

### Validation levels

1. **Render Free temporary runtime validation:** disposable synthetic data behind the mandatory staging Basic Auth gate; no persistent disk, backups, or production traffic.
2. **Paid persistent-disk staging validation:** separate disk/service, verified proxy topology, restart persistence, backup/restore, and capacity evidence. See `STAGING_SETUP_GUIDE.md`.
3. **Production readiness:** separate owner approvals and verified production secrets, persistent storage, proxy chain, independent backups, restore drill, and deployment checks. Current verdict remains **NO-GO FOR PRODUCTION TRAFFIC**.
