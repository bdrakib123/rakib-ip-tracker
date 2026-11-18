# V2 Isolated Persistent-Disk Staging Setup and Validation

This guide covers **paid persistent-disk staging**, not Render Free. It must not reuse the production service, disk, storage file, credentials, encryption key, domains that receive real traffic, or backup destination. For disposable synthetic-data-only Free smoke tests, use [RENDER_FREE_STAGING_GUIDE.md](RENDER_FREE_STAGING_GUIDE.md); its explicit ephemeral mode is never a persistence substitute. No Render staging service was created or contacted during this preparation.

The paid staging procedure below keeps production-style mount enforcement and does not enable `STAGING_MODE` or `STAGING_EPHEMERAL_STORAGE`. A Free service must use the dedicated Free guide and must not use this guide's `/var/data` disk steps.

## Existing staging configuration inventory

- `package.json` retains `staging:check` and `staging:integration` for the previously paused MongoDB staging path. Those scripts use `STAGING_*` configuration and are not part of normal V2 file-backed startup. **Do not run them for this phase.**
- `.env.staging.example`, `src/lib/stagingMongoConfig.js`, `scripts/stagingMongoIntegration.js`, and `test/stagingConfig.test.js` are MongoDB-specific staging preparation. They are not required to create this JSON-backed Render staging service.
- `render.yaml` describes the V2 service/disk names intended for the production blueprint. Do not sync it as the staging service because its service and disk names are not staging-specific.
- No staging-specific Render service/disk, staging secrets, independent backup provider, or browser runtime is configured in this repository/environment. This guide and checklist prepare the owner procedure; they are not proof of deployed staging.

## Create the isolated service manually

1. In Render, create a separate Web Service from the reviewed repository and branch. Name it `rakib-ip-tracker-staging`. Set root directory `rebuild`, build command `npm ci --omit=dev`, start command `npm start`, and health check `/healthz`.
2. Do not sync the current production blueprint as the staging service: it names the production-intended service and disk. Create staging in the dashboard and verify each value before saving.
3. Attach a **new, staging-only persistent disk** named `rakib-ip-tracker-staging-data`, mounted at `/var/data`. Confirm actual disk size and service-plan eligibility in the dashboard. Do not attach or clone the production disk.
4. Restrict staging ingress to the owner/test network and keep it unavailable to public visitors. Render web-service inbound IP rules require an eligible Scale/Enterprise plan and support IPv4 CIDR only; verify eligibility. If unavailable, do not start the public Web Service until the owner approves an alternative access design. Use one instance only. Do not enable autoscaling or extra workers.
5. Set the staging file path to `/var/data/staging/visitors.json`, mount path `/var/data`, and backup path `/var/data/staging/backups`. These paths are distinct from production's `/var/data/visitors.json` and `/var/data/backups`, and remain on this separate staging disk.
6. Configure the required secrets using Render's protected environment UI or an approved secret manager. Generate new staging-only values there; never copy production secrets or put generated values in a terminal command, repository, ticket, or chat.
7. Configure `TRUST_PROXY_HOPS` only after completing the staging proxy procedure below. Do not assume `1` is correct because the current production-oriented blueprint declares it.
8. Verify the service name, branch, root, disk identity, mount, paths, instance count, and secret names independently before the first staging start. Do not attach production storage to “check” a service.

### Staging environment-variable inventory

Example non-secret values below are illustrative staging paths. Secret values are format placeholders only and must be generated privately. Render supplies `PORT`; do not set a fixed port.

| Variable | Purpose / required | Safe staging format or example | Secret? | Validation and common mistakes |
|---|---|---|---|---|
| `NODE_ENV` | Required for production-like staging | `production` | No | Enables secure-cookie and persistent-mount checks. Do not use development mode to bypass mount checks. |
| `PORT` | Optional; platform supplied | Render-injected integer | No | Integer 1–65535; app binds `0.0.0.0`. Do not copy a local fixed port into the service. |
| `ADMIN_PASSWORD` | Required | Generate unique staging password in secret manager; minimum 16 characters | **Yes** | Do not reuse production or browser-test password; do not put value in YAML or shell history. |
| `IP_ENCRYPTION_KEY` | Required | Generate a new staging-only random 32-byte key, represented by 64 hex characters | **Yes** | Exact 64 hex characters. Losing it makes staging encrypted IPs unreadable; never use production key. |
| `STORAGE_BACKEND` | Optional; set explicitly | `json-file` | No | Only `json-file` is accepted. MongoDB variables do not select a backend and are not needed. |
| `STORAGE_MOUNT_PATH` | Required | `/var/data` | No | Absolute path and actual mounted path. A directory existing without a mounted disk is not sufficient. |
| `STORAGE_FILE` | Optional; set explicitly | `/var/data/staging/visitors.json` | No | Must be strictly inside mount. Common mistake: using production's exact file path/disk. |
| `BACKUP_DIR` | Optional; set explicitly | `/var/data/staging/backups` | No | Private directory; same staging disk only. Do not mistake same-disk copies for disaster recovery. |
| `BACKUP_RETENTION_COUNT` | Optional | `14` | No | Integer 1–1000; default 14. Retention only prunes verified older local backups. |
| `TRUST_PROXY_HOPS` | Required in production mode; set only after staging evidence | Integer 0–10 selected from verified chain; deliberately no assumed example | No | Current blueprint value `1` is not validated. Wrong value can misattribute visitors and allow rate-limit bypass. |

The configuration also accepts `GEO_PROVIDER=ipwho.is`, `GEO_TIMEOUT_MS` (default 5000, bounded 500–15000), `GEO_RETRY_COUNT` (default 1, bounded 0–2), `PUBLIC_RATE_LIMIT` (default 30, bounded 5–300), and `LOGIN_RATE_LIMIT` (default 5, bounded 2–20). For isolated rate-limit validation only, consider a staging-only lower public limit; do not carry test tuning into production without review.

## Local checks before staging

From `rebuild/`, using a clean, internet-connected CI checkout:

```sh
npm ci --omit=dev
npm ls --omit=dev --depth=0
npm run check
npm test
npm audit --omit=dev
```

For browser coverage, use CI/Linux with development dependencies and supported browser libraries:

```sh
npm ci
npx playwright install --with-deps firefox
npm run test:browser
```

The Playwright suite starts the local test server at `127.0.0.1:4173` with synthetic credentials and an in-memory repository. It must not be changed to target production. No browser binaries should be installed on the owner's phone for this procedure. If CI already provides Firefox and dependencies, use those rather than reinstalling.

## Staging proxy-chain test (owner-run only)

**Not verified here.** A local test proves Express behavior for a configured hop count, not Render's current ingress chain or header filtering. Keep staging ingress restricted and use only controlled test requests. No request/response logs should contain raw IP addresses or forwarding headers.

1. Record the controlled test client's expected network source using an owner-controlled network inventory. Obtain Render's current documented ingress topology/header behavior for this exact service type; do not infer a hop count from headers seen once.
2. Start from the staging hostname through Render's actual public ingress, not the service's private/direct origin. Confirm a no-forwarding-header request is attributed to the controlled client source. The public intelligence response is visible only to that caller but creates a staging test record; use only the isolated staging disk.
3. Repeat with forged single values from documentation-only ranges such as `198.51.100.17` and `203.0.113.19`, then a comma-separated list containing multiple such values. Verify the observed attribution remains the controlled client source and never equals a supplied spoof value.
4. Test malformed values (empty element, invalid token, invalid IPv4, bracketed/unbracketed IPv6, and mixed IPv4/IPv6) through the same staging ingress. Record only pass/fail and sanitized HTTP status, not request headers or source addresses. Reject unexpected 5xx or changed attribution.
5. Where the controlled client and route support IPv6, repeat over IPv6 ingress and compare with the independently known test-client source. If IPv6 cannot be exercised, mark that subtest NOT APPLICABLE with the reason; do not assume IPv4 proves IPv6 behavior.
6. For spoofed-header rate-limit testing, set a low limit only on the isolated staging service and use a fresh service/test window. Send requests from one controlled source, then vary only spoofed XFF values. The same real source must not gain new rate-limit buckets; only sanitized counts/statuses should be retained. Keep the finite accepted requests as staging-only test rows.
7. Test each candidate hop count only on staging, comparing observed attribution against platform-confirmed topology. If any spoof changes attribution or bucket, stop and keep the service restricted. Set production configuration only after separate approval and evidence.

No temporary public diagnostic endpoint is needed or authorized. Existing local spoof and rate-limit regression tests are in `test/app.test.js` and run with `npm test`. See the blank [STAGING_OWNER_EVIDENCE_TEMPLATE.md](STAGING_OWNER_EVIDENCE_TEMPLATE.md) for recording sanitized owner-side results.

## Staging disk, storage, and lock checklist

Keep the staging disk mounted at `/var/data`; store only staging records under `/var/data/staging/`. Confirm actual disk size in Render. During an approved restricted staging deployment, verify:

- Disk identity, attachment, mount path and mount status; compare runtime mount with `/proc/self/mountinfo` using an owner shell without dumping unrelated process/environment data.
- Storage file is `/var/data/staging/visitors.json`; backup directory is `/var/data/staging/backups`.
- Directory permissions are owner-only where supported; storage, lock, backup, and manifest files are mode `0600`.
- Create one clearly synthetic staging row, restart the staging application normally, and confirm only that synthetic row remains. Do not perform this against production.
- With a copied synthetic file in a separate local temp directory, verify corrupt JSON fails closed and remains unchanged; existing automated tests already exercise this behavior.
- Verify a second repository opener is refused while the staging process owns `${STORAGE_FILE}.lock`; do not manipulate the live lock to run this test.
- For an unexpected termination test, use a disposable staging service/disk and an explicitly approved maintenance window. A forced termination can leave a lock; preserve the lock metadata and do not restart against it until the process and disk access state are proven stopped.

### Lock recovery after unexpected termination

1. Stop the staging service and wait for Render to show the instance fully terminated. Confirm there is no second process, shell, worker, backup command, or other service mounting/accessing the same disk.
2. Preserve a copy of lock metadata for the incident record. A PID alone is not proof of staleness because PIDs can be reused and namespaces differ.
3. If ownership or mount access is uncertain, leave the lock intact and escalate to the service owner. Never remove it based on age, timeout, or PID alone.
4. Only after service termination and exclusive disk access are confirmed by the owner, manually recover the exact staging lock following the documented maintenance procedure. Then run read-only backup list/verify and inspect storage health before application restart.

The app does not remove stale locks automatically. Missing mount, invalid/corrupt storage, and already-held lock fail closed; no ephemeral fallback is intended.

## Backup and isolated restore preparation

Local backup commands, for the staging path only:

```sh
STORAGE_FILE=/var/data/staging/visitors.json BACKUP_DIR=/var/data/staging/backups BACKUP_RETENTION_COUNT=14 npm run backup -- create
STORAGE_FILE=/var/data/staging/visitors.json BACKUP_DIR=/var/data/staging/backups npm run backup -- list
STORAGE_FILE=/var/data/staging/visitors.json BACKUP_DIR=/var/data/staging/backups npm run backup -- verify BACKUP_ID
```

Do not use the restore command against Render's live staging store during routine validation. For a manual restore drill, run only from a clean CI checkout, first change into the `rebuild/` directory, and keep the scratch path under that directory:

```sh
DRILL_ROOT="$(mktemp -d "${PWD}/.staging-restore-drill.XXXXXX")"
umask 077
chmod 700 "$DRILL_ROOT"
export STORAGE_FILE="$DRILL_ROOT/visitors.json"
export BACKUP_DIR="$DRILL_ROOT/backups"
```

Initialize the isolated repository and add one synthetic row, then close it:

```sh
node -e 'const {JsonFileVisitorRepository}=require("./src/db/jsonFileRepository"); (async()=>{const r=await JsonFileVisitorRepository.open(process.env.STORAGE_FILE); await r.insert({_id:"synthetic-drill-before",createdAt:new Date().toISOString(),geo:{country:"Synthetic"},device:{category:"desktop"}}); await r.close()})().catch(()=>process.exit(1))'
npm run backup -- create
npm run backup -- list
```

Record the emitted backup ID from `list` as `BACKUP_ID` in the current shell (it is an identifier, not a secret), then verify it and add a second synthetic row through the repository:

```sh
BACKUP_ID='backup-ID-copied-from-the-list-output'
npm run backup -- verify "$BACKUP_ID"
node -e 'const {JsonFileVisitorRepository}=require("./src/db/jsonFileRepository"); (async()=>{const r=await JsonFileVisitorRepository.open(process.env.STORAGE_FILE); await r.insert({_id:"synthetic-drill-after",createdAt:new Date().toISOString(),geo:{country:"Synthetic"},device:{category:"mobile"}}); await r.close()})().catch(()=>process.exit(1))'
```

Then run:

```sh
npm run backup -- restore "$BACKUP_ID"
npm run backup -- list
node -e 'const fs=require("node:fs"); const s=JSON.parse(fs.readFileSync(process.env.STORAGE_FILE,"utf8")); const ids=new Set(s.records.map(r=>r._id)); if(!ids.has("synthetic-drill-before")||ids.has("synthetic-drill-after")) process.exit(1); process.stdout.write("Synthetic restore verification PASS\n")'
```

At the prompt, type exactly `RESTORE BACKUP_ID`. Verify the selected backup and generated recovery artifact; confirm the restored repository contains the first synthetic row and not the second. Do not run these commands with a production path. Keep the scratch directory until verification completes; afterward remove only that exact drill directory after confirming no process has it open. Existing `test/storageBackup.test.js` already runs isolated restore scenarios without live storage.

### Independent destination design (not configured)

Status: **BLOCKED — EXTERNAL BACKUP DESTINATION NOT AUTHORIZED**.

- Encrypt the complete backup artifact before network transfer using authenticated encryption; storage-side encryption alone is not a substitute for end-to-end encryption. Use a separately controlled KMS/key vault or envelope-encryption scheme, with versioned key IDs and tested key recovery. Never store encryption keys in the archive or manifest.
- Use a separate account/failure domain, dedicated least-privilege identity, short-lived credentials, TLS, and write-only upload permissions where possible. Separate restore permissions from upload permissions; protect against accidental and malicious deletion with object lock/version retention where supported.
- Verify uploaded object size and SHA-256 against the local verified manifest after upload. Record only backup ID, checksum, result, timestamp, duration and sanitized error code; never log payloads, credentials, key material, or visitor values.
- Keep local verified backups when remote upload fails. Retry with bounded backoff and alert an owner on final failure, stale last-success age, checksum mismatch, or retention/key problems. Never mark the backup successful until the remote integrity check completes.
- Owner must approve retention and alert channels. Same-disk retention remains 14 locally; it is not the independent retention policy.
- Owner must set explicit recovery-point objective (RPO) and recovery-time objective (RTO), including acceptable data loss and restore duration. No targets are assumed here.
- Restore independently: retrieve one encrypted synthetic archive to an isolated environment, authenticate/decrypt using the documented key recovery process, verify outer and storage checksums/format, restore only into a fresh temporary storage path with explicit confirmation, then verify record counts. No external account or upload is configured by this task.

## Inspecting staging logs safely and shutting staging down

- Review only sanitized startup status, error codes, deployment ID, and timing. Do not paste logs containing environment dumps, request headers, IPs, credentials, ciphertext, or visitor payloads into tickets/chat.
- `GET /healthz` is process liveness only. Protected `/api/admin/server/health` is the application/storage check; access it only using staging credentials and do not copy visitor data from other admin APIs.
- To stop staging, restrict inbound traffic first, stop/scale down the staging service, wait for termination, and retain the separate disk until the owner approves its disposition. Do not delete the disk, backups, or lock files as part of shutdown.
- No production service, production database/storage, external backup destination, or Render staging service was accessed in preparing this guide.
