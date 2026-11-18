# V2 Staging Validation Checklist

**Current production status: NO-GO FOR PRODUCTION TRAFFIC.** This records repository checks and owner-side work separately. No staging service, production service, database, production storage, or external backup destination was contacted in this phase.

Status meanings: **PASS** = evidenced in the stated environment; **FAIL** = a check ran and failed; **BLOCKED** = requires owner/platform/environment action; **PENDING** = not yet run or evidence not yet recorded; **NOT APPLICABLE** = not supported/needed, with reason.

Owner setup instructions are in [STAGING_SERVICE_CONFIGURATION.md](STAGING_SERVICE_CONFIGURATION.md) and [STAGING_SETUP_GUIDE.md](STAGING_SETUP_GUIDE.md). Record sanitized owner evidence in [STAGING_OWNER_EVIDENCE_TEMPLATE.md](STAGING_OWNER_EVIDENCE_TEMPLATE.md).

| Requirement | Status | Evidence / remaining action | Evidence class |
|---|---|---|---|
| Normal V2 startup does not require MongoDB | PASS | Startup selects JSON file adapter; Mongo is dev-only and normal bootstrap does not read staging Mongo variables. Unit tests cover startup without Mongo variables. | Local tests/code |
| Staging-specific service and disk are separate | BLOCKED | No staging Render service/disk was created. Owner must create distinct service `rakib-ip-tracker-staging` and disk `rakib-ip-tracker-staging-data`; do not sync production blueprint as-is. | Owner action |
| Staging inbound access can be restricted before start | BLOCKED | Render service IP restrictions are plan-dependent and IPv4 CIDR only; owner must verify eligibility and configure a controlled-source allowlist. If unavailable, do not start the public staging web service without an approved alternate access design. | Owner action |
| Staging environment values are validated | PASS | `src/config.js` enforces production secrets, mount containment and explicit proxy count; `test/config.test.js` exercises invalid/missing config. | Local tests/code |
| Staging secrets generated and configured separately | BLOCKED | No secrets requested, generated, printed or configured. Owner must generate unique staging admin password and encryption key in protected secret manager. | Owner action |
| Production secrets are not included in staging instructions | PASS | Guide uses format-only secret placeholders and explicitly prohibits reuse. | Documentation review |
| Current Render `TRUST_PROXY_HOPS=1` validated against real chain | BLOCKED | Local tests show 0 hops ignores forged XFF and 1 hop accepts XFF on direct connection. Actual Render proxy order/sanitization cannot be established locally. Follow restricted staging procedure before changing or approving any value. | Owner/platform test |
| Direct/forged XFF and spoofed rate-limit behavior covered locally | PASS | Synthetic route tests show zero-hop ignores forged values, one-hop local direct input is accepted, and changing forged XFF cannot split rate-limit buckets with trust disabled; `npm test` includes them. They do not simulate Render ingress. | Local tests |
| Actual staging proxy, multiple/malformed XFF, IPv4/IPv6 and source attribution | BLOCKED | No staging service/client route tested. Owner must execute all cases in `STAGING_SETUP_GUIDE.md`, record only sanitized outcomes, and verify rate-limit buckets cannot be spoofed. | Owner action |
| Staging disk attached at `/var/data`, size verified | BLOCKED | Blueprint/code paths are consistent, but there is no evidence of actual Render attachment or size. Owner dashboard verification required. | Owner action |
| Staging file and backup paths are separate | PENDING | Guide prescribes `/var/data/staging/visitors.json` and `/var/data/staging/backups` on the separate staging disk. Owner must configure and verify the actual isolated service. | Owner action |
| Production mount absence fails closed | PASS | Mount check and config reject missing/unmounted path without ephemeral fallback; unit test covers unmounted path. | Local tests/code |
| Staging persistence across restart verified | BLOCKED | Requires a real isolated staging disk and synthetic record; not performed. | Owner action |
| Corrupt storage fails closed | PASS | Synthetic test confirms corruption/unsupported format is rejected and original fixture bytes are preserved. | Local tests |
| Active lock blocks second process | PASS | Synthetic repository test verifies exclusive process lock and second opener rejection. | Local tests |
| Unexpected termination and stale lock recovery tested on Render | BLOCKED | No forced termination performed. Owner must use disposable staging service and follow preservation/confirmation procedure; never infer stale from age/PID. | Owner action |
| Local backup/manifest/checksum/retention behavior | PASS | Automated isolated tests verify timestamped backup, SHA-256, invalid artifact handling, newest preservation and retention. | Local tests |
| Independent encrypted backup destination configured | BLOCKED | External destination is not authorized; no provider/account/authentication or upload was configured. Owner must authorize a separate failure domain and key-management design. | Owner action |
| Independent backup upload/verification/alerting | BLOCKED | Requires approved external destination and credentials; not attempted. | Owner action |
| Isolated restore drill | PASS | Automated restore tests use synthetic temporary files, validate recovery copy and atomic replacement, and refuse active locks. No independent backup archive was restored. | Local tests |
| Owner-run isolated external restore drill | BLOCKED | Requires authorized destination/key recovery and isolated target; no live restore occurred. | Owner action |
| Clean `npm ci --omit=dev` | PASS | Ran exact `npm ci --omit=dev` and `npm ls --omit=dev --depth=0` in a unique temporary project under `rebuild/` containing copies of only `package.json` and `package-lock.json`; install added 73 packages and audited 74, 0 vulnerabilities. Temporary directory was removed. This does not test a full clean app checkout. | Isolated local install |
| Production dependency listing | PASS | `npm ls --omit=dev --depth=0` completed; dotenv, express, ua-parser-js. | Local runtime |
| Production dependency audit | PASS | `npm audit --omit=dev` returned zero vulnerabilities for the queried registry state. | Registry query |
| `npm run check` | PASS | Command completed successfully in this checkout. | Local execution |
| `npm test` | PASS | Final run after the staging preparation changes: 66 passed, 0 failed. | Local execution |
| Firefox browser suite | BLOCKED | Current configured Firefox executable is absent at the Playwright cache path. No browser installed and no browser suite run in this phase. CI procedure is documented. | Environment limitation |
| Synthetic storage capacity checks | PASS | `npm run test:storage-load -- 100 1000 5000 10000` passed at all four seeded sizes; real repository inserts/reads were measured. A 64 MiB+1 sparse fixture failed closed with `STORAGE_FILE_INVALID`. This is not workload/capacity approval. | Local execution; synthetic only |
| Data protection and API auth | PASS | Tests cover public masking, sensitive field exclusion, admin auth, session/logout, rate limits, export and SSE protections. Real staging configuration not exercised. | Local tests |
| Render service, branch, build/start, health, plan and instance settings verified | BLOCKED | Local blueprint declares root `rebuild`, build/start, `/healthz`, one instance, Node `20.18.1`; actual dashboard/service remain unverified. | Owner action |
| Owner approval for staging creation/traffic | PENDING | No staging resource was created. Owner must approve and restrict access before first request. | Owner action |

## Evidence required to advance

1. Owner records separate staging service/disk identity and actual Render configuration without exposing secret values.
2. Owner records controlled staging proxy spoof/multi-value/malformed/IPv4/IPv6/rate-limit results and resolves `TRUST_PROXY_HOPS` from platform evidence.
3. Owner verifies mount, actual size, private permissions, synthetic restart persistence, and lock recovery in the isolated service.
4. Owner approves a separate encrypted off-site backup destination, key custody, retention, alerts, RPO/RTO, and isolated restore drill.
5. CI records successful clean install, unit checks, production dependency audit, and Firefox browser suite.
6. Review measured synthetic storage results against explicit workload targets; do not treat them as a production capacity guarantee.

No item becomes a production GO solely because staging passes. Production deployment remains NO-GO until the separate production readiness checklist is cleared with owner evidence and deployment approval.
# Temporary Render Free validation — code prepared, service not created

| Requirement | Status | Evidence / owner action |
|---|---|---|
| Dual explicit staging flags and temp-directory confinement | PASS — local tests | `src/config.js` requires both flags, access password, temp path, and zero proxy trust; `src/db/storage.js` rejects mount/production paths and validates directory ownership/privacy. `npm test` passed 74/74. |
| Production persistent mount enforcement unchanged | PASS — local tests | Normal production configuration without both staging flags still requires a verified mounted `STORAGE_MOUNT_PATH`; missing mount test confirms no file is created. |
| Staging-wide Basic Auth before app routes/body parsing | PASS — local tests; Render owner verification pending | Tests cover missing/wrong/malformed credentials, visitor collection, admin APIs, export, health bypass, failed-attempt throttling, and no credential text in logged errors. Only exact `GET /healthz` bypasses the gate. |
| Render Free service exists and is isolated | BLOCKED — OWNER ACTION REQUIRED | Create separate service manually per `RENDER_FREE_STAGING_GUIDE.md`; no Render access was used here. |
| Temporary data durability | NOT APPLICABLE | Free staging data is disposable and may be erased on restart/spin-down. Never use for real visitors. |
| Proxy topology / real visitor attribution | BLOCKED — RENDER PROXY TOPOLOGY UNVERIFIED | Free code uses zero trusted hops; production hop count remains unapproved. |
| Backup and recovery | NOT APPLICABLE for Free | Backup/restore CLI is disabled when either staging flag is true. No external upload or restore is configured. |
| Production traffic approval | BLOCKED | Production remains NO-GO; Free smoke testing cannot satisfy persistent storage, independent backup, or production proxy requirements. |

See the separate [Render Free temporary guide](RENDER_FREE_STAGING_GUIDE.md). The paid persistent-disk checklist below remains a separate validation level.
