# Architecture

## Canonical application

The repository root is the sole project root. `npm start` runs `src/server.js`, which loads and validates configuration, creates the selected repository, wires the geolocation/device services and Express app, then binds to `0.0.0.0` on `PORT`. `src/app.js` owns middleware and routes. Static assets live in `public/`; operational scripts are in `scripts/`; automated tests are in `test/`. Render Dashboard Web Service is the only deployment target.

## Request and data flow

Requests pass through security headers and, when the optional temporary local mode is explicitly configured, the global Basic Auth gate. Express trusts only the configured numeric proxy-hop count. Geolocation and User-Agent parsing run independently. The visitor's IP is encrypted with AES-256-GCM before storage; keyed HMAC hashes support repeat-visitor checks and exact admin search. Browser signals are allowlisted and validated.

Public serializers expose a masked IP and country/country-code/region/city/timezone only. Admin serializers decrypt the full IP and include detailed metadata after server-side session authorization. Public legacy aliases use the same safe serializers.

## Storage lifecycle

`src/db/storage.js` is the only active storage-selection layer. It creates either the versioned JSON repository or Neon PostgreSQL repository; there is no automatic fallback. JSON format validation rejects corrupt, unsupported, duplicate-ID, oversized, or plaintext-IP documents without resetting data. A process-exclusive `${STORAGE_FILE}.lock` prevents multiple processes using one file. Mutations are serialized; each replacement is validated, written and synced to an owner-only temporary file, atomically renamed, and followed by a directory sync. Maximum JSON storage size is 64 MiB. Neon persists visitors, analytics, admin sessions, and shared rate-limit buckets in versioned PostgreSQL tables and requires the schema migration to be applied manually before startup.

Production JSON storage requires an explicitly configured `STORAGE_MOUNT_PATH` and a `STORAGE_FILE` strictly inside it. Neon mode requires `STORAGE_BACKEND=neon-postgres` and `DATABASE_URL`, and rejects JSON mount/file/backup settings. The optional local temporary mode requires both staging flags, a dedicated path under OS temporary storage, and a distinct access password; it cannot be selected by a single staging flag. No mode silently falls back to another storage location.

The JSON backend is single-process and reads/rewrites the complete file. It is not suitable for horizontal scaling or unbounded history.

## Authentication, SSE and telemetry

Admin sessions use random tokens in HTTP-only, SameSite=Strict cookies; they expire and are invalidated on logout. Neon mode stores only token hashes in PostgreSQL, while JSON mode uses the process-local session store. Login and destructive writes validate request origin. Live refresh uses bounded authenticated polling; no SSE stream is implemented.

Request, page, session, and limited security-event analytics are stored in the same versioned JSON file as visitor records. Storage format V1 upgrades atomically to V2 with an empty analytics section and a collection-start timestamp; historic events are not fabricated. Events are retained for at most 30 days and capped at 5,000 request, 2,000 page, 1,000 security, and 1,000 session records. Expired events are pruned atomically during startup and analytics reads, as well as on writes. Aggregate counts and averages describe only that retained capped window. A pending write queue is bounded and flushed in batches; graceful shutdown flushes it, but SIGKILL, machine loss, or a shutdown that exceeds the 10-second exit deadline can lose unflushed events. Analytics writes share the repository's exclusive single-process lock and atomic replacement path, so the existing one-process constraint still applies.

The analytics cookie is random and HTTP-only; only a keyed HMAC identifier is stored. Request events retain normalized route templates, method, status, duration and time. Page events retain local paths and only measured durations. Security analytics record coarse categories for unauthorized, forbidden, not-found, rate-limited, suspicious-path, and unusual-method outcomes, with suspicious paths redacted. No raw IP, user-agent, referrer, password, credential, or bearer cookie is stored in analytics. Old security/session analytics from the retired MongoDB collections are not in the V3 JSON records and cannot be recovered by this application.

## Components

| Path | Responsibility |
|---|---|
| `src/config.js` | Environment validation and production/staging separation |
| `src/app.js` | Security middleware, API routes, aliases, authenticated polling, admin controls |
| `src/server.js` | Startup, repository lifecycle, graceful shutdown |
| `src/auth/adminAuth.js` | Admin sessions and staging-wide access gate |
| `src/db/jsonFileRepository.js` | Versioned JSON storage, locks, atomic writes, query/stat operations |
| `src/db/neonRepository.js` | Parameterized PostgreSQL queries and persistent repository operations |
| `src/db/storage.js` | Persistent mount checks and repository construction |
| `src/db/migrations/` and `scripts/migrateNeon.js` | Versioned, manually invoked Neon schema migration |
| `src/db/storageBackup.js` | Backup integrity, retention and safe restore |
| `src/services/visitorService.js` | IP privacy, record construction, serializers |
| `src/geolocation/` | Provider adapter, normalization, retries/cache/coalescing |
| `src/device/detectDevice.js` | Conservative User-Agent parsing |
| `public/` | Public dashboard, Leaflet map, admin console and styles |
| `scripts/` | Backup CLI and isolated synthetic load test |

## Deployment limitation

The owner creates and configures the Render Web Service manually in the Dashboard; no Blueprint is part of the repository. JSON mode requires a verified persistent disk and one instance. Neon mode requires the owner to verify its database schema and data migration. The production proxy chain and `TRUST_PROXY_HOPS` value remain unverified; do not infer a hop count from local tests.
