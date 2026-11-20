# Deployment Readiness Checklist — Render Web Service

Production status: **NO-GO FOR PRODUCTION TRAFFIC** until owner-side requirements are independently verified.

| Requirement | Status | Evidence / remaining action |
| --- | --- | --- |
| Root startup contract and version 3.0.0 | PASS | `npm start` runs `node src/server.js`; local startup and route tests use synthetic settings. |
| Render Dashboard commands and health route | PASS | Manual setup is documented as `npm ci --omit=dev`, `npm start`, and `/healthz`; no service has been provisioned here. |
| JSON encryption, public masking, admin authorization | PASS | Synthetic tests cover serializers, authentication, and protected routes. |
| JSON atomic writes, lock, corruption rejection, and backup controls | PASS | Isolated filesystem tests use temporary directories; no live restore was run. |
| Neon repository and manual schema migration | PASS | Mock-based repository/migration tests and source review only; no database connection or migration was performed in this cleanup. |
| Legacy JSON-to-Neon data import | BLOCKED | No verified export from the Render disk or idempotent importer/count reconciliation is available. Keep the existing backend and encryption key unchanged. |
| Current Render service, environment, and storage target | BLOCKED | Owner must verify the dashboard service, selected backend, disk or Neon target, and secret names without sharing values. |
| Persistent JSON disk and one-process operation | BLOCKED | Verify actual disk attachment/mount and restart persistence if retaining JSON. |
| Neon schema, database permissions, and readiness | BLOCKED | Verify the intended Neon database and schema through the owner; application startup does not migrate it. |
| `TRUST_PROXY_HOPS` and forged-header resistance | BLOCKED | Verify Render's actual proxy chain and test forged/multiple/malformed forwarding headers before approving the hop count. |
| Independent backup and restore | BLOCKED | Verify JSON off-site recovery or Neon backup/PITR and perform an isolated restore drill. The JSON CLI does not back up Neon. |
| Browser rendering and console checks | BLOCKED | Run the existing Playwright suite in a supported Linux environment with Firefox installed. |
| Workload capacity | PENDING | Establish traffic/retention targets and measure the selected Render plan and backend under representative synthetic load. |

Passing local tests does not establish Render, Neon, proxy, data-import, backup/PITR, or production readiness. No deployment should proceed until every BLOCKED item has owner evidence and the data cutover plan is approved.
