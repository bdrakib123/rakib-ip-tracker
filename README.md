# RAKIB IP Intelligence System

Version **3.0.0** is the unified, privacy-conscious IP intelligence dashboard. The repository root is the only application. It combines the verified V2 security and JSON storage design with compatible legacy tracking/history/statistics routes, aggregate telemetry, admin retention controls, live updates, and Leaflet mapping.

## Runtime

- Node.js `>=20.18.1`
- Express 5, UAParser.js, dotenv; optional Vercel target uses Neon Serverless PostgreSQL
- Versioned JSON storage with validation, exclusive single-process locking, serialized writes, atomic replacement, and a 64 MiB file limit
- AES-256-GCM encrypted stored IP values and keyed IP hashes
- Public history exposes only masked IP and coarse location; detailed records require server-side admin authentication
- Production requires a persistent mount. Temporary staging requires both explicit staging flags and a separate Basic Auth password

The Render runtime uses JSON-file storage and does not require MongoDB. Vercel mode is separate: it requires `DATABASE_URL` from Neon and never falls back to local files. Vercel setup and verification requirements are documented below.

## Local setup

1. Copy `.env.example` to a private `.env` and set unique local values. `ADMIN_PASSWORD` must be at least 16 characters; `IP_ENCRYPTION_KEY` must be exactly 64 hexadecimal characters.
2. Install and run:

   ```sh
   npm ci
   npm start
   ```

3. Open `http://localhost:3000`; liveness is `/healthz` and the protected admin console is `/admin`.

Run checks from the repository root:

```sh
npm run check
npm test
npm ls --omit=dev --depth=0
npm audit --omit=dev
```

`npm run test:browser` runs the Playwright suite when Firefox is installed in a supported Linux environment. Unit tests use synthetic data and do not require production services.

## Render

The root `render.yaml` is a persistent-disk blueprint, not a Free plan configuration. It uses repository root, `npm ci --omit=dev`, `npm start`, `/healthz`, one instance, and `/var/data`. Actual service provisioning, disk persistence, and proxy topology have not been verified. Review [deployment guide](docs/DEPLOYMENT_GUIDE.md) before owner-side setup. Production remains **NO-GO** until the deployment checklist blockers are verified.

## Vercel + Neon (separate target)

Vercel uses the Express Function exported from `src/index.js`, static assets from `public/`, and Neon Serverless PostgreSQL. Apply migrations manually with `npm run migrate:neon` only after verifying the injected database branch. An isolated, access-protected Preview may use explicit `TRUST_PROXY_HOPS=0` for synthetic validation; this disables forwarded-header trust and may identify the Vercel edge as the client. Production traffic requires owner-verified proxy topology and an explicitly validated trust configuration. No Vercel or Neon service has been provisioned or tested; production remains **NO-GO**. See [Vercel deployment](docs/VERCEL_DEPLOYMENT_GUIDE.md), [database setup](docs/VERCEL_DATABASE_SETUP.md), and [security review](docs/VERCEL_SECURITY_REVIEW.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API contracts](docs/API_DOCUMENTATION.md)
- [Security and privacy](docs/SECURITY_AND_PRIVACY.md)
- [Deployment](docs/DEPLOYMENT_GUIDE.md)
- [Deployment readiness checklist](docs/DEPLOYMENT_READINESS_CHECKLIST.md)
- [Free temporary staging guide](docs/RENDER_FREE_STAGING_GUIDE.md)
- [Vercel migration audit](docs/VERCEL_MIGRATION_AUDIT.md)
- [Vercel + Neon deployment guide](docs/VERCEL_DEPLOYMENT_GUIDE.md)
- [Neon database setup](docs/VERCEL_DATABASE_SETUP.md)
- [Vercel security review](docs/VERCEL_SECURITY_REVIEW.md)
- [Test report](docs/TEST_REPORT.md)
- [Changelog](CHANGELOG.md)
