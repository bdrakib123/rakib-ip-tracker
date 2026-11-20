# RAKIB IP Intelligence System

Version **3.0.0** is the unified, privacy-conscious IP intelligence dashboard. The repository root contains the single application, started by `src/server.js` and deployed as a Render Web Service through the Render Dashboard.

## Runtime and storage

- Node.js `>=20.18.1`; Express 5 and UAParser.js.
- Render is the only supported deployment target. Configure a Web Service manually in the Render Dashboard.
- Storage can be versioned JSON or Neon PostgreSQL. JSON storage requires a persistent Render disk, an exclusive single-process lock, atomic writes, and a 64 MiB file limit. Neon requires explicit `STORAGE_BACKEND=neon-postgres` and `DATABASE_URL`; there is no fallback between backends.
- Stored IP values are encrypted with AES-256-GCM, with keyed hashes for repeat-visitor checks and admin search.
- Public history exposes masked IPs and coarse location; detailed records require server-side admin authentication.
- Database migrations are manual and never run at startup.

Changing the existing JSON-backed service to Neon is not a data migration. The legacy JSON dataset has not been imported or reconciled; preserve the existing storage and encryption key until an approved migration and recovery procedure is completed. Production remains **NO-GO** until owner-side data, proxy, backup, and Render configuration checks pass.

## Local setup

1. Copy `.env.example` to a private `.env` and set unique local values. `ADMIN_PASSWORD` must be at least 16 characters; `IP_ENCRYPTION_KEY` must be exactly 64 hexadecimal characters.
2. Install and run:

   ```sh
   npm ci
   npm start
   ```

3. Open `http://localhost:3000`; `/healthz` is the health endpoint and `/admin` is the protected admin console.

Run checks from the repository root:

```sh
npm run check
npm test
npm ls --omit=dev --depth=0
npm audit --omit=dev
```

`npm run test:browser` runs the Playwright suite when Firefox is installed in a supported Linux environment. Unit tests use synthetic data and do not require production services.

## Render Dashboard deployment

See [Render Web Service deployment](docs/DEPLOYMENT_GUIDE.md) for the manual setup, storage-specific environment variables, health check, and rollback guidance. Render supplies `PORT`; the server binds to `0.0.0.0`. A JSON-backed production service needs a persistent disk and one process. Neon-backed operation requires an initialized compatible schema and a separately verified data migration before any cutover. No Render service, Neon connection, or production data migration has been verified here.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API contracts](docs/API_DOCUMENTATION.md)
- [Security and privacy](docs/SECURITY_AND_PRIVACY.md)
- [Render deployment](docs/DEPLOYMENT_GUIDE.md)
- [Deployment readiness checklist](docs/DEPLOYMENT_READINESS_CHECKLIST.md)
- [Test report](docs/TEST_REPORT.md)
- [Changelog](CHANGELOG.md)
