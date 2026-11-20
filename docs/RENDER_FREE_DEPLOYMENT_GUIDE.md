# Render Free Web Service with Neon PostgreSQL

This guide prepares a separate **manual** Render Web Service using the existing Express application and Neon repository. It does not replace the existing persistent-disk JSON Blueprint (`render.yaml`) or the ephemeral Free staging Blueprint (`render-free-staging.yaml`). No Render service or Neon database was accessed while preparing this guide.

**Deployment state: NOT DEPLOYED. Production readiness: NO-GO pending owner verification.** Render Free services are intended for testing/hobby use, not production workloads. They sleep after 15 minutes without inbound traffic, can take about a minute to wake, have ephemeral local filesystems, and do not support persistent disks or scaling beyond one instance. The PostgreSQL database is the durable store; local files and in-memory state must not be treated as durable. See [Render Free limitations](https://render.com/docs/free), checked 2026-11-20.

## 1. Manual Web Service settings

In Render Dashboard choose **New → Web Service → Connect GitHub Repository**. This does not require Blueprint deployment.

A Web Service is internet-facing. Public visitor/tracking routes are intentionally callable without admin login; admin routes remain protected by the existing server-side authentication. Use a dedicated Neon database/branch and synthetic traffic for isolated validation. The existing staging-wide Basic Auth mode is coupled to temporary JSON storage and is not enabled for this Neon configuration; do not treat this setup as a private preview service.

Use a distinct service name such as `rakib-ip-tracker-free-test` so it is not confused with the production service. Render Free has no inbound service allowlist, and Neon-backed mode does not enable the temporary JSON staging Basic Auth gate. Do not share the test URL or send real visitors to it. Treat this as a short-lived synthetic-data integration test, not a private preview.

| Setting | Value |
| --- | --- |
| Repository | `bdrakib123/rakib-ip-tracker` |
| Branch | `main` (confirm this is the intended branch in GitHub before creating the service) |
| Runtime | Node |
| Root Directory | Leave blank (repository root) |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm start` |
| Instance Type | Free (temporary validation only; not recommended for production traffic) |
| Instance count | One; do not run multiple processes against the same application deployment |
| Health Check Path | `/healthz` |
| Persistent Disk | None |

The package engine is `>=20.18.1`; local verification used Node `24.22.3`. Render's current documented default for new services is Node `24.22.1`. For a reproducible manual service, set `NODE_VERSION=24.22.1` in the Render Dashboard, then confirm the actual build log reports that version. The existing Blueprints pin Node `20.18.1` and are intentionally unchanged. Render documents `NODE_VERSION` as the highest-precedence version selection setting; `PORT` is supplied by Render and the service must bind `0.0.0.0`. [Render Node version selection](https://render.com/docs/node-version), [Render Web Services](https://render.com/docs/web-services).

The existing `src/server.js` is the sole long-running server. `npm start` runs it in the foreground. It reads `PORT`, defaults to `3000` only for local use, and binds to `0.0.0.0`. It handles SIGTERM/SIGINT and closes HTTP, analytics, and repository resources. Do not add a second listener or background the process.

## 2. Environment variables

Add variables in the Render service's protected Environment page. Enter secret values directly there; do not put them in Git, build/start commands, logs, or support messages. Do not copy values between Neon branches/environments.

| Variable | Required | Value/rule |
| --- | --- | --- |
| `NODE_VERSION` | Recommended | Pin `24.22.1` as described above; confirm it in build logs. |
| `NODE_ENV` | Yes | `production`. |
| `STORAGE_BACKEND` | Yes | `neon-postgres`. This is explicit; the application will not fall back to JSON. |
| `DATABASE_URL` | Yes, secret | PostgreSQL URL for the intended Neon project/branch and database. The app reads this exact variable. Never expose its value. |
| `ADMIN_PASSWORD` | Yes, secret | At least 16 characters. Use a unique strong password from a password manager. |
| `IP_ENCRYPTION_KEY` | Yes, secret | Exactly 64 hexadecimal characters (32 random bytes). For a new isolated database environment, generate a unique key and store it in a password manager before entering it in Render. If the selected database already contains encrypted visitor records, preserve that environment's existing matching key; changing it without a reviewed key-rotation procedure can make stored IP data unreadable. For a new key, `openssl rand -hex 32` generates the required format; treat terminal output as a secret and never record it in shell transcripts or logs. |
| `TRUST_PROXY_HOPS` | Yes | Set `0` for this isolated synthetic test. This makes Express ignore forwarded client-IP headers; requests may appear to come from Render's immediate proxy. Do not carry this setting into production without separately verifying the actual proxy chain. |
| `GEO_PROVIDER` | Optional | Defaults to `ipwho.is`; only this provider is currently accepted. |
| `GEO_TIMEOUT_MS` | Optional | Defaults to 5000 ms; validated/bounded by source. |
| `GEO_RETRY_COUNT` | Optional | Defaults to 1; validated/bounded by source. |
| `PUBLIC_RATE_LIMIT` | Optional | Defaults to 30 per configured window. |
| `LOGIN_RATE_LIMIT` | Optional | Defaults to 5 per configured window. |
| `PORT` | Do not set manually | Render supplies it. |
| `VERCEL` | Do not set manually | Vercel-only platform flag; do not set it in Render. |

Do **not** set `STORAGE_MOUNT_PATH`, `STORAGE_FILE`, or `BACKUP_DIR` in Neon mode. Startup rejects these JSON-specific paths to avoid implying that local JSON backup/restore covers the database. Do not set `STAGING_MODE` or `STAGING_EPHEMERAL_STORAGE`; that explicit mode is for isolated temporary JSON storage and conflicts with Neon.

The runtime also requires `ADMIN_PASSWORD` and `IP_ENCRYPTION_KEY` in production even though this guide uses database storage. `DATABASE_URL` is validated as a PostgreSQL URL. Missing required values fail startup without printing their values.

## 3. Neon configuration and schema

Create a **separate Neon test project** for this validation, then use its newly initialized empty database. This is the recommended path. Alternatively, use a database the owner has independently verified is empty and dedicated to this test. Do not use the production project/branch, a branch created from production, or an existing branch merely because its name sounds like a test branch: Neon branches can inherit the source branch's data. Confirm the project, branch, database, and role in Neon Dashboard before copying the test connection string into Render. Never reuse production `DATABASE_URL`, `ADMIN_PASSWORD`, or `IP_ENCRYPTION_KEY`.

The application uses `@neondatabase/serverless`'s `neon(DATABASE_URL)` HTTP driver. It does not open a long-lived TCP pool and does not read prefixed alternatives such as `DATABASE_URL_UNPOOLED`. Configure only the exact `DATABASE_URL` variable for this service. Do not set `STORAGE_BACKEND` to `json-file` in this deployment.

At startup the repository checks `schema_migrations`, validates the supported schema version, and runs a lightweight `SELECT 1`. It **does not run migrations automatically**. The repository contains migration `001_initial.sql`; a target database must have the supported version applied before the app can start. The schema stores encrypted visitor payloads and IP hashes, not plaintext IP fields.

Before any migration:

1. Create the separate test project/database described above. Confirm it is the test target and contains no data that must be preserved. A branch from production is not an empty database.
2. Review `src/db/migrations/001_initial.sql` and `scripts/migrateNeon.js`. Migration 001 creates the application tables and indexes; the runner uses a transaction-scoped advisory lock and records the version atomically with the schema statements. It does not seed visitor data or drop existing tables.
3. Obtain explicit owner approval for applying this migration to the verified test database. Do not run it against a production project or an unverified existing database.
4. From a trusted workstation with the repository's reviewed source, make the test `DATABASE_URL` available through a secret manager's process-environment injection. Do not put it inline in a command, shell history, file, log, or chat. Then run exactly: `npm run migrate:neon`.
5. If the command fails, stop and inspect the sanitized migration error and test database state before retrying. Do not delete tables or rerun against another target to work around an error.
6. Verify the test database in Neon Dashboard using the read-only query `SELECT version, applied_at FROM schema_migrations ORDER BY version;`. Expect version `1` for this code. Only then configure Render's `DATABASE_URL` with the same test database connection through the protected Environment page.

No migration, database connection, or schema check against a real Neon service was performed while preparing this guide. The test schema is not yet initialized. Do not place `npm run migrate:neon` in Render build, start, or deploy hooks; Render build remains `npm ci --omit=dev` and start remains `npm start`.

The JSON `npm run backup` CLI is not a Neon backup tool. Use a separately reviewed Neon backup/PITR and restore-drill process; do not treat Render Free's filesystem as a backup destination.

## 4. Health check

Set the Render health path to `/healthz`. For a Neon repository, this endpoint performs `repository.ping()` and returns `200` only when the database ping succeeds; on failure it returns `503` with a generic status and no URL, SQL, credential, or stack details. This is an operation-critical readiness check and creates a small `SELECT 1` query per health probe. Render recommends database checks for critical dependencies in its [health-check guidance](https://render.com/docs/health-checks).

The public response is deliberately minimal. Startup also checks schema readiness before opening the HTTP listener. A missing schema or database failure causes startup failure with a sanitized stable error code.

## 5. Proxy and IP configuration

`src/app.js` uses Express's configured numeric `TRUST_PROXY_HOPS`; request IP and rate-limit identity derive from Express's client IP. Set `TRUST_PROXY_HOPS=0` only for this isolated test because it avoids trusting client-supplied forwarding headers before the proxy chain is understood. It can make requests share the proxy address as their apparent client identity, so this test does not validate client-IP detection or production rate limiting. Production configuration refuses to start without an explicit value; this guide approves no production hop count.

Render documents traffic through Cloudflare and its load balancer and recommends forwarded client-IP information, but this documentation alone does not establish the exact trusted hop count/header chain for this service. The existing `render.yaml` value `1` is a prior configuration value, **not verified evidence**. [Render proxy/IP notes](https://render.com/articles/how-render-handles-ddos-attacks).

Before accepting visitor traffic, use a controlled owner-run test through the actual Render hostname and a known source address. Compare the server-derived address and rate-limit behavior for: no forwarding header, forged `X-Forwarded-For`, multiple values, malformed values, and IPv4/IPv6 where available. Do not log or share raw addresses or full headers. Confirm an untrusted client cannot change the rate-limit identity by supplying a forwarding header. Choose a hop count only after the observed chain is understood. Until then, proxy configuration is a deployment blocker; accurate geolocation and per-client rate limits are not verified.

## 6. First deployment procedure

1. Confirm the GitHub repository and branch in the Render create-service form.
2. Choose Node Web Service, blank Root Directory, the commands above, Free plan, one instance, no disk, and `/healthz`.
3. Configure the required values through the protected Render UI. Verify names without copying secret values. Do not reuse Vercel values without independently confirming the target database and security scope.
4. Before deploying, verify Neon branch/database/role and schema version. If migration is required, stop and obtain owner approval; do not let application startup perform it.
5. Deploy manually from Render Dashboard. Inspect build/start logs for runtime version, startup status, and only sanitized error codes. Never paste secret-bearing logs into reports.
6. Confirm `/healthz` succeeds and the Render dashboard reports the service healthy. This verifies the configured runtime check, not the full visitor/admin application.
7. Verify the proxy chain and spoofed-header resistance with controlled requests before approving the configured hop count.
8. Exercise authentication, visitor insertion/history, admin authorization, exports, analytics and error handling only with synthetic requests/data until separately approved.
9. Review Free plan usage/sleep behavior and Neon limits. Do not direct production traffic based solely on a successful deploy or health check.

## 7. Troubleshooting

| Symptom | Safe interpretation/action |
| --- | --- |
| Startup says `DATABASE_URL_REQUIRED` | Add the exact `DATABASE_URL` name in Render's protected environment settings; do not add prefixed aliases as a substitute. |
| `STORAGE_BACKEND_UNSUPPORTED` or configuration error | Confirm `STORAGE_BACKEND=neon-postgres`; unset JSON file/mount/backup paths and temporary staging flags. Do not weaken the validation. |
| `DATABASE_SCHEMA_NOT_READY` | The target database lacks the supported migration version. Inspect target and schema first; use the separately approved manual migration procedure only. |
| `DATABASE_OPERATION_FAILED` | The underlying database error is intentionally redacted. Check Render runtime logs for the stable code, then have the owner verify URL scope/target, Neon availability, role permissions, and schema. Do not expose a connection string. |
| `/healthz` returns `503` | The service cannot reach or query its Neon database. Check Render/Neon status and deployment environment binding without printing secrets. |
| Build selects an unexpected Node version | Check the first build log lines and the `NODE_VERSION` dashboard setting. |
| Wrong IP or rate limits shared across visitors | Stop real traffic; proxy trust has not been validated. Test forwarding behavior and adjust only from evidence. |
| Slow first page after inactivity | Expected Free spin-down/cold start. Do not add self-pinging/keep-alive traffic as a workaround. |

## 8. Rollback and recovery

For an application-only failure, use Render Dashboard's manual rollback to a previously healthy deploy after confirming that its code is compatible with the current database schema. Do not roll back or reapply database migrations automatically. Keep the database and branches intact while diagnosing.

Render Free local files are ephemeral and are not a recovery source. Neon data recovery must use the owner's verified Neon backup/PITR process and an isolated restore drill. Do not restore over the active database as part of routine application rollback. If the schema is not backward-compatible with the previous application version, stop and prepare a reviewed forward-fix or data-recovery plan before changing traffic.

## 9. Limits and verification status

- Free services sleep after 15 minutes without inbound traffic, cold-start on a later request, may be restarted, have ephemeral local filesystems, and cannot attach a persistent disk. Visitor/history/analytics records remain only if Neon is correctly configured and available.
- Free compute, request rate, and monthly usage limits apply. Do not infer workload capacity from local tests.
- No Render service, Neon connection, schema migration, deployed health check, actual proxy chain, restore, or browser session was verified during this preparation.
- A successful `/healthz` proves only that the application process and its database ping are responding at that moment.
- Production readiness remains **NO-GO** until database/schema, proxy, security, backup/PITR, resource, and actual deployment checks are independently completed.
