# ARCHIVED — pre-consolidation V2 feasibility review

# Vercel Hobby Compatibility Report

**Audit scope:** `pre-consolidation source tree` only. This is an architecture and feasibility audit; no application or deployment configuration was changed. No Vercel project, external service, production database, or visitor record was accessed.

**Verdict:** **NOT COMPATIBLE AS-IS** for the complete application on Vercel Hobby. The static frontend is **PARTIALLY COMPATIBLE** after routing and API-origin work. The current JSON-backed backend cannot safely run on Vercel Functions without replacing its durable storage and process-local coordination assumptions. This is not an approval to migrate or deploy.

## 1. Executive verdict

Vercel officially supports Express by packaging the application as a Function, and it can serve static files. That does not make this application’s current runtime model compatible. V2 expects a long-running Express process, a mounted persistent filesystem, one process per JSON data file, process-local sessions and rate limits, an in-process SSE client registry, and command-line backup/restore access. Vercel Functions have a read-only filesystem except for temporary `/tmp` scratch space, can scale across instances, and have finite request durations. `/tmp` is not a durable shared volume.

The most conservative options are to keep the full application on a host with a persistent disk and one process, or to host only a carefully separated frontend on Vercel while leaving the backend and its data services on a suitable persistent host. A Vercel-only backend would require architectural migration and an external shared database, session/revocation and rate-limit strategy, event distribution for live updates, and a new backup/restore design. A full serverless rewrite is **not** necessary if the backend remains on a persistent host.

**Production remains NO-GO.** No hosting behavior has been tested in a Vercel deployment, and existing Render owner-side readiness items remain separate and unresolved.

## 2. Current architecture inventory

| Component | Current role | Vercel Functions fit | Process / durable storage / network needs | Migration path |
|---|---|---|---|---|
| `public/` dashboard and admin UI | Static HTML, CSS, and browser JavaScript; calls API routes | **Partial** — static assets can be served, but routes and API origin need deliberate mapping | No persistent process or server-side disk; browser calls backend over HTTP | Small-to-medium frontend-only split; maintain same-origin routing or carefully configure API origins, CORS, cookies, and CSRF expectations |
| `src/server.js` | Loads configuration, constructs repositories/services/app, listens on `0.0.0.0`; graceful signal shutdown | **Partial** — the current entry exports `start`, not an instantiated Express app; Vercel’s Express integration expects a recognized entry exporting an app/default or a listener | Starts a persistent listener and owns shutdown lifecycle | Adapt entry if deploying Express as a Function; do not change without a migration decision |
| `src/app.js` and Express routes | Public/admin APIs, middleware, health endpoints, static handling | **Partial** — Express is supported, but `express.static()` is ignored by Vercel’s Express integration and must be served as platform static files or otherwise explicitly routed | Request-scoped execution can host ordinary request/response routes | Route/build adaptation plus API regression tests |
| Configuration (`src/config.js`) | Validates environment, production storage mount, secrets, limits, proxy hops | **Partial** — env vars are supported, but the required `/var/data` mount is not provided by Functions | Secrets and runtime config; requires a persistent mount in production mode | Replace storage assumptions only as part of approved migration; configure secrets per environment |
| Authentication (`src/auth/adminAuth.js`) | Constant-time password comparison; random opaque cookie tokens held in a `Map`; 12-hour expiry; logout invalidation; HttpOnly/SameSite and production Secure cookie | **Incompatible as a reliable multi-instance session store** | Sessions live only in the current process; restart/cold start loses them and another instance may not recognize a token | Shared session/revocation store or a carefully designed signed-session scheme with explicit revocation trade-offs; preserve CSRF and cookie protections |
| Rate limiting (`src/lib/rateLimit.js`) | Bounded in-memory counters keyed from Express request IP | **Incompatible for consistent distributed limits** | Per-process memory; parallel instances have independent counters; relies on correctly trusted proxy IP | Shared atomic counter store or suitable upstream protection; verify proxy chain before setting trust |
| JSON repository (`src/db/jsonFileRepository.js`, `src/db/storage.js`) | Versioned JSON records, schema checks, encryption-compatible records, full-file read/modify/write, serialized local writes, exclusive lock, atomic temp-file rename, production mount check; 64 MiB limit | **Incompatible for durable/shared writes** | Requires writable persistent mounted path and single-process coordination | Use a shared database or storage service with transactions/concurrency control; no Vercel adapter is proposed here |
| Backup and restore (`src/db/storageBackup.js`, `scripts/storageBackup.js`) | Manual CLI backups, manifest/checksum verification, retention, confirmed restore with recovery copy and lock checks | **Incompatible as currently operated inside Functions** | Requires filesystem access, durable backup directory, exclusive operation, and an operator CLI | External encrypted backup/restore workflow designed for the selected durable store; no public destructive endpoint exists |
| Admin live SSE (`src/app.js`) | Authenticated stream, process-local response set, heartbeat and close cleanup | **Partial / unsuitable for indefinite service** | Holds an open request and process-local subscriber registry; duration is finite; instances do not share clients/events | Validate actual stream duration; for reliable multi-instance delivery use an external event/pub-sub service and reconnect semantics |
| Geolocation (`src/geolocation/*`) | Outbound provider lookup with timeout/retry and per-process cache/coalescing | **Partial** | Outbound network request; cache/coalescing local to each instance; function duration and provider limits apply | Keep bounded calls; consider shared cache only if needed; exercise provider from a staging environment |
| Analytics/history services (`src/services/*`) | Repository-backed history and overview/admin queries | **Partial** | JSON reads parse the full file; writes rewrite it; exports can grow with records | Move queries to indexed shared storage if serverless/multi-instance scale is required; test response size limits |
| Dormant Mongo adapter (`src/db/mongoRepository.js`) | Optional/unused alternative repository | **Unknown as a selected deployment path** | No connection occurs in normal JSON startup; a future database would require credentials/network configuration | Evaluate independently; the previous Atlas TLS issue is not resolved by this audit |
| Logging, validation, security middleware | Redacted structured logs, input bounds, security headers, request validation | **Generally compatible with adaptation** | Per-request; relies on correct proxy and deployment settings | Preserve controls and retest on target platform |
| Tests and browser suite | Node tests and Playwright browser tests | **Locally/CI compatible in principle** | Browser binary required for browser suite; no production URL needed | Run in supported CI/Linux or isolated staging after migration |
| Render configuration (`render.yaml`) | Existing single-instance Express + persistent disk target | **Not a Vercel configuration** | Specifies `/var/data` disk and one instance for Render | Leave unchanged; do not use Render-specific disk settings as evidence of Vercel resources |

### API and response considerations

The current Express application has public visitor intelligence/history, protected admin history/analytics/export, server health, and authenticated live SSE routes. Preserve server-side authorization and public masking if the hosting model changes. Vercel Functions document a 4.5 MB request/response payload limit; large JSON/CSV exports need explicit testing or streaming/storage redesign. The history UI’s smaller paginated responses do not establish that every admin export will fit.

## 3. Vercel Hobby compatibility matrix

Statuses describe documented platform characteristics and current code fit, not a deployment test.

| Area | Status | Evidence and implication |
|---|---|---|
| Node.js runtime | **PARTIALLY COMPATIBLE** | Vercel documents Node 24 as default and Node 22/20 runtimes; Node 20 is deprecated for new builds after October 1, 2026. Project engine is `>=20.18.1`, which does not pin a Vercel major. The package must be tested on the selected supported runtime. |
| Express | **PARTIALLY COMPATIBLE** | Official Express integration deploys an Express app as one Function. Current `src/server.js` exports a `start` function and current layout is not an instantiated app export at the expected project entry. Entry adaptation is required. |
| Function entry / route mapping | **PARTIALLY COMPATIBLE** | Existing routes are registered in Express factory. Vercel documents recognized entry points and static asset behavior; actual project-root/build mapping is untested. |
| Serverless execution | **INCOMPATIBLE AS-IS** | Requests may execute on separate/cold instances; this conflicts with in-memory sessions, counters, and SSE client tracking. |
| Function duration | **PARTIALLY COMPATIBLE** | Hobby Functions have finite duration; with Fluid compute max is documented up to 300 seconds. Non-Fluid defaults/limits differ. Hobby’s proxied request timeout is also documented as 120 seconds. Streaming behavior must be tested; indefinite SSE cannot be assumed. |
| Memory and payload | **PARTIALLY COMPATIBLE** | Node Hobby memory is documented as 2 GB/1 vCPU; request/response payload limit is 4.5 MB. Full-file JSON parse/serialize and admin exports need workload testing. |
| Filesystem | **INCOMPATIBLE for current persistence** | Function filesystem is read-only except temporary writable `/tmp` scratch (documented up to 500 MB). Scratch is not persistent storage. No Vercel persistent disk is documented for Functions. |
| Concurrent invocations / instances | **INCOMPATIBLE for single-file locking model** | Autoscaling and multiple instances do not share local process state or `/tmp`; a per-process exclusive lock cannot coordinate them. |
| SSE streaming | **PARTIALLY COMPATIBLE** | Vercel supports streaming responses, but finite function/proxy duration, reconnects to different instances, and process-local client sets prevent assuming a durable live system. |
| Background work / backups | **PARTIALLY COMPATIBLE** | Vercel Cron exists, but current backup is a local CLI requiring durable storage and exclusive access. Hobby cron schedules have daily granularity (±59 minutes); it does not solve storage durability. |
| Environment variables | **COMPATIBLE WITH CONFIGURATION** | Vercel supports encrypted environment variables scoped to environments; changes require a new deployment to apply. Use unique staging/production scopes and never expose secrets in client bundles. |
| Static frontend | **PARTIALLY COMPATIBLE** | `public/**` can be deployed as static files, but Express `express.static()` is ignored by the Express integration. Frontend route fallback and API routing need explicit configuration. |
| Hobby account eligibility | **UNKNOWN** | Hobby is limited to personal, non-commercial use. Whether this IP intelligence service’s use qualifies and whether the Git repository/account ownership fits current Hobby restrictions require owner confirmation. |
| Render persistent disk settings | **NOT APPLICABLE** | `/var/data` and `numInstances: 1` in `render.yaml` describe the current Render target; they do not provision storage or constrain Vercel. |

Official platform values are time-sensitive. This report checked Vercel documentation on **2026-11-19**; verify the linked limits again before a future migration because plans and runtime policy can change.

## 4. Filesystem and JSON storage analysis

The repository’s storage design is deliberately safe for a single long-running process on a mounted persistent disk: it validates a versioned JSON file, enforces a size limit, queues writes in-process, takes an exclusive lock file, writes a restrictive temporary file, fsyncs and atomically renames it, and rejects production startup if the configured mount is unavailable.

Those guarantees do not translate to Vercel Functions:

1. `/var/data` is not a Vercel Function persistent mount. Production startup’s mount validation should fail rather than silently use an ephemeral path.
2. Changing the path to `/tmp` would provide only scratch space. It can disappear on termination and is not shared across invocations/instances.
3. The lock file coordinates processes only when they share the same filesystem. Isolated function filesystems cannot protect a shared logical dataset; removing the lock would worsen safety.
4. Concurrent invocations can read different snapshots and independently rewrite whole JSON files. There is no shared transaction/compare-and-swap or cross-instance serialization.
5. Cold starts and instance replacement can lose scratch state. A successful local rename is not a durable commit to shared storage.
6. Every read parses the entire file; inserts perform read/modify/write over the complete file. At 64 MiB, working memory can exceed file size due to parsing, object graphs, serialization, and buffers. No production capacity conclusion follows from the local synthetic measurements.
7. Same-disk backups share the same failure domain and cannot repair loss of the Function’s ephemeral filesystem or a disk that Vercel does not provide.

**Conclusion:** JSON storage is not safe for the existing production semantics on Vercel Functions. Keep it on the current persistent-disk architecture or migrate to a shared durable database with atomic concurrency controls before using Vercel for backend requests.

## 5. SSE and Express runtime analysis

`GET /api/admin/live` is authenticated and retains response objects in a process-local set. It sends heartbeats and removes clients when the response closes; shutdown logic closes the local set. That lifecycle is appropriate to a long-running single process, but not a durable event service across function instances.

Vercel supports response streaming, but each request still has finite execution/proxy limits. A client reconnect may reach a different instance whose in-memory subscriber set and event history differ. Function termination can close the stream, and serverless shutdown hooks are not a reliable substitute for a persistent daemon’s lifecycle. The existing SSE endpoint therefore cannot be promised to remain continuously connected or to deliver every event on Vercel Hobby without a deployment test and a shared event source.

Possible future designs (not implemented):

- Keep SSE on a persistent backend and let Vercel serve only the static frontend.
- Use a managed pub/sub or event service with authenticated subscriptions, reconnect/backoff, and event cursors; retain finite stream expectations.
- Replace live push with bounded polling if product requirements accept its latency and cost trade-offs.

Do not assume HTTP streaming alone provides cross-instance event delivery.

## 6. Security and privacy analysis

### Controls present in the inspected V2 code

- Admin APIs and live SSE are protected by server-side middleware.
- Admin session tokens are random opaque values in an in-memory map, with bounded session count and expiration; cookies are HttpOnly, SameSite Strict, and Secure in production.
- Password comparison uses `crypto.timingSafeEqual` over HMAC digests.
- Public history is masked and excludes sensitive ISP/organization/exact-coordinate fields; detailed history/export/analytics are admin-only.
- CSV export uses formula-injection protection; request body size and inputs are bounded/validated.
- Logs use an allowlist of safe fields rather than dumping request headers/payloads.
- Production requires explicit storage mount and proxy-hop configuration; IP encryption key/admin password are validated.

### Migration risks to preserve and retest

- In-memory sessions and rate limits become inconsistent across Function instances. A rejected/expired session in one instance may not have matching revocation state in another unless a shared design is added.
- Proxy trust must be measured for the actual Vercel ingress. Incorrect trust can permit spoofed client IPs or break rate limits; do not reuse Render’s `TRUST_PROXY_HOPS=1` by assumption.
- Hosting frontend and backend on different origins changes cookie, SameSite, CORS, `Origin`/`Sec-Fetch-Site`, CSRF, and credentialed-fetch behavior. Broad CORS or relaxed cookies would weaken protection.
- Preview deployments and environment scoping can expose an unintended backend or secrets if project environments are mapped carelessly.
- Function log/trace output must retain current redaction; never log raw forwarding headers, full visitor IPs, secrets, or encrypted payloads.
- Public privacy serializers and admin authorization must remain server-side; frontend-only admin hiding is insufficient.
- Admin exports may exceed the documented response size cap; add bounded pagination or protected downloadable-object flow if needed.
- The current backup manifest/checksum protects integrity but does not encrypt backups by itself. Independent encrypted off-site backup remains a separate unresolved readiness requirement.

No confirmed vulnerability requiring a source change was found within this feasibility scope. This does not constitute a penetration test or deployed security verification.

## 7. Architecture alternatives

### Option A — Vercel frontend, persistent external backend

Vercel hosts static UI assets; the existing Express API remains on a host with persistent disk and one process. Backend remains the authority for visitor IP collection, encryption, admin authentication, masking, history, exports, rate limiting, and SSE. This avoids moving the JSON repository and session store.

The UI needs explicit API routing. Prefer a same-origin reverse proxy/custom-domain arrangement if it can preserve current origin and cookie semantics. Otherwise, use an exact-origin CORS allowlist, credentialed requests where necessary, secure cookie policy, and explicit CSRF/origin validation. Never put backend credentials in browser code. Test client IP headers and rate-limit behavior at the backend ingress.

**Trade-off:** two hosting surfaces and cross-service operations; lowest-risk way to use Vercel without replacing the backend.

### Option B — Vercel plus a managed persistent database

A managed database can provide shared durability and concurrency, but requires repository/service changes and data-model/security validation.

- **PostgreSQL:** good fit for append-only visitor events, indexed time/IP lookups, pagination, and analytics aggregates; use parameterized queries, transactions, retention strategy, encryption at rest/in transit, and an appropriate pool/proxy for serverless concurrency.
- **Managed document database:** closer to current record shape and potentially less mapping work, but requires reliable connectivity from Vercel and careful indexes, access controls, connection pooling, and safe migration. The prior Atlas TLS failure from Termux does not establish whether Vercel connectivity works.
- **Object storage:** appropriate for encrypted backup artifacts or generated exports, not as a direct shared mutable JSON file replacement without a safe transaction/conditional-write design.

No provider was accessed, selected, or created in this audit.

### Option C — Full serverless backend migration

Possible, but substantial. Routes may remain grouped in Express or be split into Functions. Either approach needs: a durable shared database; external session/revocation storage or a reviewed stateless session design; shared rate limiting; proxy/IP extraction validation; SSE event distribution/reconnect semantics; export size strategy; new encrypted backup and restore workflow; scheduled/background work design; and cold-start, concurrency, failure, privacy, and authorization regression tests.

Vercel Hobby alone is not sufficient to preserve the current backend’s persistence and coordination semantics. Hobby can host Functions only after these external/shared dependencies and plan eligibility are resolved.

### Option D — Keep the persistent backend architecture

Continue with a suitable long-running Node host that explicitly provides the `/var/data` persistent disk and enforce one application process per storage file. This is closest to the current implementation and avoids a serverless storage rewrite. It remains a single-instance JSON architecture with full-file I/O and 64 MiB maximum; independent encrypted backups, disk provisioning, restore drills, proxy-chain evidence, and capacity tests still matter.

**Trade-off:** operational dependence on one service/disk and limited scale; less code and data-migration risk. No exact hosting price is asserted.

## 8. Migration requirements and risk assessment

| Workstream | Relative effort | Risk | Main work |
|---|---|---|---|
| Static frontend only on Vercel | **Small–Medium** | Medium | Publish `public/**`, route `/` and `/admin`, configure API origin/proxy, review CSP/CORS/cookies, test all UI flows |
| Keep backend on persistent host, move frontend | **Medium** | Medium | Same as above plus custom-domain and edge-to-backend routing; verify visitor IP and admin cookie/origin handling |
| Change backend host without changing backend architecture | **Small–Medium** | Medium | Reproduce persistent disk/single process/env/secrets, health, proxy chain, backup and operational controls |
| Migrate JSON repository to managed database | **Large** | High | Schema/repository implementation, indexes, encryption and historical record compatibility, concurrency, privacy/API regression, backup and recovery |
| Full serverless rewrite | **Large** | High | Shared DB, auth/session, rate limiter, proxy extraction, SSE/pub-sub, backups, routes/build, exports, quotas and broad failure/concurrency testing |

These are relative engineering estimates, not calendar-time commitments.

## 9. Recommended architecture

For the existing code, the safest path is **Option D** until the current single-process persistent-disk deployment is verified, or **Option A** if the owner specifically wants Vercel for static delivery. Keep backend ownership of all sensitive data and security decisions. Do not send full visitor details to a browser-hosted component or move JSON storage to `/tmp`.

If the long-term requirement is a Vercel-hosted backend, treat it as a separately approved migration project. Choose the shared storage/session/rate-limit/event architecture first, then prove it with isolated staging and synthetic data before considering production. Keep production NO-GO until that validation and the existing Render/backup owner actions are complete.

## 10. Unresolved questions

1. Is the intended Vercel project frontend-only, or is the owner requiring the APIs to run on Vercel?
2. Is the service use personal/non-commercial and eligible for Hobby under current plan terms?
3. Is the Git repository owner compatible with current Hobby Git integration restrictions?
4. What custom-domain topology should preserve same-origin admin cookies and protect backend APIs?
5. What persistent database, session/revocation store, shared rate limiter, and event service (if any) would be approved for a future migration?
6. What measured visitor volume, retention, export size, availability, recovery-point, and recovery-time requirements should drive capacity design?
7. Which Node runtime major will the future project pin and test?

## 11. Official documentation references

Checked **2026-11-19**. Vercel platform documentation and plan rules can change; recheck before implementation.

- [Express on Vercel](https://vercel.com/docs/frameworks/backend/express) — Express integration, entry detection, single Function behavior, and static asset note.
- [Vercel Function limits](https://vercel.com/docs/functions/limitations) — runtime, duration, memory, payload, and bundle limits.
- [Vercel Function runtimes](https://vercel.com/docs/functions/runtimes) — read-only filesystem and writable temporary `/tmp` scratch space.
- [Node.js versions on Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) — supported runtime versions.
- [Node.js 20 deprecation notice](https://vercel.com/changelog/node-js-20-is-being-deprecated) — lifecycle notice relevant to a future runtime choice.
- [Streaming Functions](https://vercel.com/docs/functions/streaming-functions) — response streaming and function duration context.
- [WebSockets vs. Server-Sent Events](https://vercel.com/i/websocket-vs-server-sent-events) — Vercel discussion of SSE lifecycle and serverless considerations.
- [Vercel limits](https://vercel.com/docs/limits) — platform request limits and Hobby-related restrictions.
- [Hobby plan](https://vercel.com/docs/plans/hobby) — personal-use/non-commercial plan terms.
- [Environment variables](https://vercel.com/docs/environment-variables) — environment scoping and deployment behavior.
- [Builds](https://vercel.com/docs/builds) — build/deployment behavior and project configuration.

## 12. Final Go / No-Go

| Decision | Status | Reason |
|---|---|---|
| Deploy the complete current V2 application on Vercel Hobby unchanged | **NO-GO — INCOMPATIBLE AS-IS** | No persistent `/var/data`; serverless instances conflict with local file lock, JSON writes, sessions, rate limits, and in-memory SSE registry; entry/static routing also require adaptation. |
| Host only the static frontend on Vercel | **CONDITIONAL — PARTIALLY COMPATIBLE** | Feasible after static route/API-origin integration and security/browser verification; not tested here. |
| Use Vercel Hobby without backend migration | **No, not for the complete application** | Keep the backend on a persistent host; Vercel may serve only the frontend. |
| Is a full serverless rewrite mandatory? | **No** | It is only needed if the backend itself must move to serverless; an external persistent backend avoids that rewrite. |
| Approve production traffic | **NO-GO** | This audit is not a deployment or operational validation, and existing production-readiness blockers remain. |
