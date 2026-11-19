# RAKIB IP Intelligence System

Version **3.0.0** is the unified, privacy-conscious IP intelligence dashboard. The repository root is the only application. It combines the verified V2 security and JSON storage design with compatible legacy tracking/history/statistics routes, aggregate telemetry, admin retention controls, live updates, and Leaflet mapping.

## Runtime

- Node.js `>=20.18.1`
- Express 5, UAParser.js, dotenv
- Versioned JSON storage with validation, exclusive single-process locking, serialized writes, atomic replacement, and a 64 MiB file limit
- AES-256-GCM encrypted stored IP values and keyed IP hashes
- Public history exposes only masked IP and coarse location; detailed records require server-side admin authentication
- Production requires a persistent mount. Temporary staging requires both explicit staging flags and a separate Basic Auth password

MongoDB is not used or required. Normal startup has no database connection path.

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

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API contracts](docs/API_DOCUMENTATION.md)
- [Security and privacy](docs/SECURITY_AND_PRIVACY.md)
- [Deployment](docs/DEPLOYMENT_GUIDE.md)
- [Deployment readiness checklist](docs/DEPLOYMENT_READINESS_CHECKLIST.md)
- [Free temporary staging guide](docs/RENDER_FREE_STAGING_GUIDE.md)
- [Test report](docs/TEST_REPORT.md)
- [Changelog](CHANGELOG.md)
