# V3 Test Report

All application tests below used synthetic fixtures or isolated temporary directories. No production database, production service, real visitor storage, live restore, or external backup was accessed.

## Final root verification

| Command | Result |
|---|---|
| `npm ci --omit=dev` | NOT RUN after the Render-only dependency cleanup; the updated lockfile has not had a clean install in this phase |
| `npm run check` | PASS |
| `npm test` | PASS — **130 passed, 0 failed** |
| `npm run check` / relevant entrypoint syntax checks | PASS |
| `npm ls --omit=dev --depth=0` | Exit 0; declared production dependencies resolve. Existing `node_modules` also reports extraneous packages left from the removed deployment adapter; it was preserved and not pruned. |
| `npm audit --omit=dev` | PASS — 0 vulnerabilities |
| `git diff --check` | PASS |
| CSS/HTML responsive source checks | PASS as part of the suite; not a real browser render |

The Playwright config and browser tests are preserved, but a real V3 browser suite was not run in this verification. Historical V2 screenshots in the working copy are not represented as V3 verification and should not be included in the V3 source release.

## Coverage

The suite exercises geo-provider success/failure/timeout/retry/cache/coalescing and independent device detection; public/admin serializers and privacy; authentication, logout, origin validation, rate limits, export formula protection and authenticated live polling; proxy-spoof handling; versioned JSON storage, lock ownership, atomic writes, corruption rejection and restart; backup checksum, retention and isolated restore; the guarded local temporary-storage mode; responsive source safeguards; legacy API aliases; persistent bounded telemetry restart/retention/corruption behavior; privacy-reduced session/security analytics contracts and admin authorization; authenticated retention actions; and Render Dashboard root structure invariants. Neon repository and manual migration tests use mocks; they do not verify a real Neon database, Render proxy topology, provider backup/PITR, or a deployed restore.

Latest local automated run: **130 passed, 0 failed** (`npm test`). These are local unit/API tests with synthetic data and isolated temporary storage. The suite uses mocked Neon calls and does not prove real Neon/Render integration. `npm run check`, `npm ls --omit=dev --depth=0` (exit 0, with stale extraneous packages in the preserved local `node_modules`), `npm audit --omit=dev` (0 vulnerabilities), and `git diff --check` also passed. A clean `npm ci --omit=dev` was not rerun after removing the deployment adapter and updating the lockfile. No browser suite was run in this verification, so no browser rendering or console inspection is claimed. In a supported Linux CI/development environment with outbound access to ipwho.is and OpenStreetMap tiles, install Firefox, then run `npx playwright install --with-deps firefox` and `npm run test:browser` from the repository root. The browser harness uses an in-memory repository and a safe public test IP; it does not use production data.

This audit found and repaired implementation gaps: expired analytics were only pruned on writes; admin UI code unwrapped top-level session/security responses as if nested under `data`; malformed JSON could fail before consuming route rate limits; and `/api/track` no longer matched its legacy 200 `{success,visitor}` contract. Retention now prunes atomically on startup and analytics reads; the dashboard consumes actual response shapes and displays retained-window, active-session, and 24-hour security counts; rate-limit checks run before JSON parsing; and GET/POST `/api/track` restore the old response contract. Regression tests cover these findings.

## Synthetic storage measurements

`npm run test:storage-load -- 100 1000 5000 10000` passed using temporary synthetic files only. The script seeds base records and measures a small bounded set of repository inserts, history/overview reads and file size:

| Base records | Measured inserts | Total insert ms | Avg ms/insert | Reads ms | File bytes | Process RSS after |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 1 | 17.28 | 17.279 | 9.07 | 27,145 | 26,406,912 |
| 1,000 | 1 | 39.23 | 39.233 | 33.56 | 268,795 | 39,895,040 |
| 5,000 | 5 | 494.91 | 98.981 | 109.95 | 1,343,869 | 65,363,968 |
| 10,000 | 10 | 2,071.27 | 207.127 | 248.79 | 2,687,711 | 104,988,672 |

The 64 MiB + 1 synthetic fixture failed closed with `STORAGE_FILE_INVALID`. RSS is process-wide, not per-request; these local synthetic measurements are not Render benchmarks, load tests, or a capacity promise. Full-file reads/rewrites and the 64 MiB cap remain material scaling limits.

## Not verified

No real Neon database, Render service/disk, production proxy topology, production environment, independent backup/PITR destination, or deployed health check was accessed. No live restore was performed. Mock tests do not verify Neon transactions or Render infrastructure behavior. Production remains NO-GO.
