# Render Free + Neon Migration Audit

**Project:** Rakib IP Intelligence System 3.0.0
**Audit phase:** before implementation
**Scope:** local source and deployment configuration only. No Render service or Neon database was accessed.

## Findings

1. The single Render process starts through `npm start` → `src/server.js` → `start()`. It binds `process.env.PORT` (with a local default) on `0.0.0.0`, remains in the foreground, and registers SIGTERM/SIGINT handlers. On shutdown it closes admin streams, waits for HTTP server closure, flushes analytics, closes the repository, and exits. No second server is required.
2. `package.json` declares Node `>=20.18.1`; the existing Render blueprints select Node `20.18.1`. The production blueprint selects one instance and the `/healthz` check, but uses JSON storage on a persistent disk. The Free staging blueprint uses explicitly temporary JSON storage and therefore cannot preserve records across Render Free restarts.
3. Neon support exists in `src/db/neonRepository.js` and `src/db/storage.js`, but storage selection is currently Vercel-only: `src/config.js` rejects `neon-postgres` outside Vercel, and the repository factory only constructs Neon when `vercelMode` is true. A Render production process configured for Neon therefore cannot start.
4. `DATABASE_URL` is required and consumed only in Vercel mode today. Startup checks the schema and runs `SELECT 1`; it does not apply migrations. The migration is a separate manual script and must only be run after an owner verifies the target database/branch and approves migration.
5. Production JSON mode requires `STORAGE_MOUNT_PATH`; this guard protects existing Render disk deployments. It must remain enforced for JSON storage. A Neon backend must not silently fall back to JSON or accept JSON backup paths as if they apply to PostgreSQL.
6. `/healthz` checks the database only in Vercel mode. If Render is configured to use Neon, it must also return an unhealthy status when the database ping fails, while exposing no connection information.
7. The Express app applies the configured `TRUST_PROXY_HOPS` and rate limiting uses Express's derived client IP. The existing production Blueprint sets the value to `1`, but repository evidence does not establish that this is the correct count for every Render ingress path. Render documents proxying through Cloudflare and Render's load balancer and use of forwarded client-IP information; that alone does not justify changing the app's hop count. Keep the setting explicit and validate the actual chain with controlled staging requests before production traffic.
8. Routes are registered in `src/app.js`; there are no `src/routes/` or `src/middleware/` directories in the current tree. Vercel uses the same app factory through `src/vercelApplication.js` and `src/index.js`, with `index.js` as the root Function entry point. Render changes should reuse `start()` and must not alter Vercel entry points or `vercel.json`.

## Required implementation

- Permit explicitly selected `STORAGE_BACKEND=neon-postgres` for the long-running Render server while retaining Vercel's explicit backend requirement.
- Require and validate `DATABASE_URL` whenever Neon is selected.
- Keep temporary staging restricted to JSON and keep production JSON mount checks unchanged.
- Reject conflicting file/disk/backup settings in Neon mode rather than implying PostgreSQL is covered by the JSON backup CLI.
- Make `/healthz` perform a lightweight database readiness check for Neon on either hosting target.
- Keep startup and runtime logs sanitized while surfacing stable database error codes.
- Add synthetic tests for Render Neon configuration, repository construction, health readiness, start binding/port, and unchanged Vercel/JSON safeguards.

## Implementation and local verification

The targeted changes are now present in `src/config.js`, `src/db/storage.js`, `src/app.js`, and `src/server.js`:

- An explicitly selected `STORAGE_BACKEND=neon-postgres` is accepted for the normal Render server and still requires `DATABASE_URL`. No Neon-to-JSON fallback exists.
- Neon mode rejects JSON file, mount, backup, and temporary-staging configuration. Production JSON mode still requires its persistent mount; the existing JSON and staging paths remain unchanged.
- The existing Neon repository is used for either host. Neon-backed admin sessions and shared rate limits use its persistent store. Production forwarded HTTPS origins are checked against the HTTPS host while retaining the configured Express proxy-trust behavior.
- `/healthz` pings any persistent repository, including Render Neon, and returns 503 on failure. Admin server health identifies a persistent Neon repository as database-backed.
- Startup/runtime logs may report stable `DATABASE_*`/`STORAGE_*` error codes but not the underlying connection text or secret values.
- Render manual settings and owner steps are documented in `RENDER_FREE_DEPLOYMENT_GUIDE.md`.

Focused tests passed **68/68**. The full `npm test` suite passed **130/130**; `npm run check`, production dependency listing, `npm audit --omit=dev`, and `git diff --check` also passed. These are local checks with synthetic configuration and mocked Neon queries only.

## Deployment boundary

This audit establishes source-level changes only. It does not verify Render Free provisioning, actual Render proxy behavior, Neon credentials/branch/schema, migrations, service health, or production readiness. Before traffic: owner must confirm the actual Neon branch/role/schema, manually approve and apply migration 001 if required, verify the Render proxy chain and choose `TRUST_PROXY_HOPS` from evidence, configure independent database recovery, and deploy/check the actual service. Render Free's sleep/ephemeral-filesystem and capacity limitations remain; it is not the recommended production compute plan.
