# Vercel Security Review — V3.0.0

**Code-level review only.** No Vercel, Neon, production endpoint, production record, or secret was accessed. Status is not production approval.

## Preserved controls

- **IP privacy:** visitor collection continues to normalize the request IP, encrypt it using the existing AES-256-GCM payload, and store the existing keyed HMAC hash. The SQL schema has no plaintext IP column and the JSON payload constraint rejects top-level `ip`. Public history continues to use masked IPs and coarse geolocation; detailed history/export requires admin authorization.
- **Admin sessions:** cryptographically random 256-bit cookie tokens remain HttpOnly, SameSite=Strict and Secure in production. PostgreSQL stores only SHA-256 token hashes and expiration. Protected requests check the shared store; logout revokes that hash. Session-store failures do not authenticate a request.
- **CSRF/origin:** existing same-origin checks remain. Vercel mode validates HTTPS origin against the request Host without relying on forwarded-protocol headers. Actual hostname/preview behavior still requires testing.
- **Rate limiting:** public, history, and login limits use atomic PostgreSQL upsert counters. Bucket identity is HMAC-derived from the configured request IP and limiter category. Database failure returns 503 instead of silently disabling limits. Forwarded-IP trust remains dependent on explicit `TRUST_PROXY_HOPS` and owner validation.
- **SQL injection:** application-supplied values use parameter arrays or Neon tagged queries; dynamic SQL fragments are limited to fixed, code-owned expressions. Migrations are static checked-in SQL. Inputs for history filters, event paths, IDs, session tokens and limit windows are validated/bounded.
- **Other controls:** HTML escaping, request validation, security headers, same-origin writes, no-store API responses, safe generic initialization errors, protected admin routes, and CSV formula neutralization remain in the Express application. Vercel `public/**` responses receive equivalent baseline headers through `vercel.json`.
- **Telemetry:** no passwords, cookies, auth tokens, request bodies, IP addresses, user agents, referrers, or sensitive headers are placed in the new analytics tables. Route paths are route templates/redacted. Durable writes use the database transaction API; request-finish writes are attached to Vercel `waitUntil` and page-view writes are awaited.

## Vercel-specific risks and requirements

1. **Proxy trust is unresolved.** The code requires `TRUST_PROXY_HOPS` in Vercel. For an access-protected, synthetic-only Preview bootstrap, `0` disables forwarding-header trust; do not treat its observed IP or rate-limit behavior as representative. Before any visitor traffic, test direct/forwarded/forged headers in Preview, compare `req.socket.remoteAddress`, `req.ip`, platform-provided request metadata, and an independently known test source IP without recording raw values. Prove forged `X-Forwarded-For` cannot alter the rate-limit bucket. Only then choose a production hop count.
2. **Separate secrets by environment.** Use independent Production and Preview `ADMIN_PASSWORD` and `IP_ENCRYPTION_KEY`; never reuse Render or legacy secrets. Do not rotate the key for data already encrypted with a different key unless a controlled re-encryption/migration plan exists.
3. **Database availability affects security.** Authentication and shared rate limits depend on Neon. Errors fail closed; test outage/cold-start and recovery in Preview. Ensure the Neon integration assigns the right database branch to each environment.
4. **Migrations are privileged.** The manual migration runner executes repository-owned DDL only, using the installed driver's non-interactive HTTP transaction batch and a transaction-scoped PostgreSQL advisory lock. Schema DDL and version recording are atomic in each batch. On a transport failure, the commit outcome may be unknown; inspect `schema_migrations` before retry. It does not run at app startup. Verify branch identity and review migration SQL before manually executing it.
5. **No DB backup/restore parity.** Existing integrity-manifest backup and interactive restore are specific to JSON files. Use Neon-supported backups/PITR plus an owner-run recovery drill; do not expose a restore API.
6. **Function and streaming lifecycle.** Long-lived SSE is replaced by 20-second authenticated polling. Request-completion analytics uses Vercel `waitUntil`, but this is not a durable queue; confirm writes and failure behavior in Preview.
7. **Public static shell.** Admin HTML is static/public; sensitive data remains behind server-side session checks. Do not embed secrets or admin data in the HTML or public assets.
8. **Runtime configuration:** Vercel mode requires explicit `STORAGE_BACKEND=neon-postgres` and `DATABASE_URL`; missing or unsupported backend values fail configuration. It rejects JSON, temporary storage, mount/backup paths, and MongoDB variables and has no fallback. Vercel `VERCEL=1` is platform-provided. No `.env` secret values or database credentials are committed.

## Not verified

- Neon Marketplace environment wiring, actual database migrations, TLS/connectivity, transaction semantics under concurrent real requests, Vercel proxy headers/hop chain, production/preview secrets, Function cold starts, `waitUntil` completion under platform timeout, static CDN headers, and Vercel request/response behavior.
- No dependency audit was considered proof of application security. Actual Vercel/Neon review and isolated integration tests are still required.

## References

Platform notes checked 2026-11-19: [Express on Vercel](https://vercel.com/docs/frameworks/backend/express), [Vercel function limits](https://vercel.com/docs/functions/limitations), [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver), and [Neon/Vercel integration](https://neon.com/docs/guides/vercel-overview).
