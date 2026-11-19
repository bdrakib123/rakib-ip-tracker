# Staging Validation Checklist

Production status: **NO-GO FOR PRODUCTION TRAFFIC**. No Render service was created or accessed.

| Requirement | Status | Evidence/action |
|---|---|---|
| Unified root V3 startup/health route | PASS | `npm start` maps to `src/server.js`; isolated startup tests pass |
| JSON storage, encryption, masking, auth and backup unit coverage | PASS | Root test suite: 71 passed, 0 failed |
| Clean production dependency install and audit | PASS | `npm ci --omit=dev`; 0 vulnerabilities |
| Separate staging service/branch/domain | BLOCKED | Owner creates and records an isolated service |
| Separate staging disk and `/var/data` paths | BLOCKED | Owner attaches a new disk and verifies identity/size |
| Staging-only credentials and encryption key | BLOCKED | Owner privately configures unique values |
| Render proxy chain and XFF spoof resistance | BLOCKED — RENDER PROXY TOPOLOGY UNVERIFIED | Must test actual isolated staging ingress |
| Restart persistence and lock recovery | BLOCKED | Owner runs synthetic staging checks |
| Independent encrypted backup destination | BLOCKED — EXTERNAL BACKUP DESTINATION NOT AUTHORIZED | Owner selects and approves a separate failure domain |
| Isolated restore drill | PENDING | Automated tests use temp data; owner staging evidence remains required |
| Browser suite | BLOCKED | Run Playwright Firefox in supported Linux CI |
| Render service/disk health | BLOCKED | No Render access or deployment performed |

See `STAGING_SETUP_GUIDE.md`, `STAGING_SERVICE_CONFIGURATION.md`, and `STAGING_OWNER_EVIDENCE_TEMPLATE.md`. Local checks do not establish Render staging or production evidence.
