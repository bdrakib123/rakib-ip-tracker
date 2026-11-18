# Security and Privacy

## Data minimization

The public intelligence endpoint describes the requesting browser and returns that requester's own public IP, parsed device/browser/OS, and approximate IP geolocation. It records the IP encrypted at rest and separately masked, plus an allowlist of common browser signals. The IP is sent to the selected lookup provider (`ipwho.is`) for approximate geolocation. It does not collect canvas/WebGL fingerprints, cookies for analytics, precise GPS, referrer headers, or arbitrary request headers. The raw User-Agent is bounded to 1000 characters and visible only to authenticated administrators.

## Access boundaries

- Public history uses an allowlist serializer with masked IP and coarse location only.
- Detailed visitor history, other visitors' device/browser/OS data, full IP, ISP, organization, ASN, coordinates, User-Agent, exports, analytics, provider health, database state, and SSE are server-side protected.
- Admin sessions use random 256-bit opaque tokens stored in server memory, expire after 12 hours, and are revoked on logout/restart. Cookies are `HttpOnly`, `SameSite=Strict`, and `Secure` in production.
- Admin login/logout require same-origin checks. Login and public collection endpoints are rate-limited.
- Per-IP rate-limit state is process-local and memory-bounded to 5,000 active client buckets with periodic expiration cleanup. Under a high-cardinality source flood, least-recently-active buckets may be evicted, so this is a local abuse control rather than a distributed/global rate limit.
- The admin HTML shell is not secret; authorization is enforced on every sensitive API request.

## Input/output safety

Request JSON is limited to 16 KB. Browser values are allowlisted, length/range checked, and sanitized. History search is length-limited and regex-escaped; filter values must be scalar strings. IDs must be valid Mongo ObjectIds. Output values are rendered with `textContent` or HTML-escaped. CSV spreadsheet formula prefixes are neutralized. Security headers include CSP, frame denial, no-sniff, referrer restriction, and a restrictive permissions policy.

## Network and logging

Express trusts only the configured proxy-hop count. Never set it to an arbitrary boolean `true`; match Render's actual proxy chain. Logs allow only event codes, route, status, count, and duration; visitor IPs, User-Agents, passwords, Mongo URI, and provider payloads are excluded. Provider API keys are not currently required or hardcoded.

## Persistence

New IP payloads preserve the existing AES-256-GCM object format (`algorithm`, `iv`, `tag`, `data`) using `IP_ENCRYPTION_KEY`. The same key is needed to decrypt prior visitor IPs for admin-only detail. Public history never decrypts them. The active JSON file stores a versioned record array, rejects plaintext `ip` fields, validates IDs/timestamps, and uses owner-only file permissions where supported. Writes are serialized within one process, written to a mode-0600 temporary file, atomically renamed, and followed by a containing-directory sync. Corrupt/unsupported files fail closed and are never silently reset. Closed repository handles reject further use after releasing their process lock. Filesystem access to the JSON file exposes all stored metadata except encrypted IP payloads, so protect the storage path and encryption key. The Mongo adapter is not used by normal startup.

## Operational limitations

Rate limits and admin sessions are process-local. The JSON backend takes an exclusive lock for one process per file and fails closed if another process owns the lock. A process restart invalidates admin sessions. Production requires an explicitly configured mounted storage directory; V2 does not fall back to ephemeral storage. The rebuild Render blueprint declares `/var/data` and one instance, but disk provisioning and account eligibility remain unverified. Provider `not_checked` is not represented as healthy. Do not change the live Render root directory or replace the existing service without explicit cutover approval.

During shutdown, the server closes authenticated SSE streams before waiting for HTTP shutdown and releasing the repository lock. Forced process termination (for example, after the shutdown grace period) can still leave a stale lock and requires manual verification/recovery.

## Backup security and recovery

The manual backup CLI stores full visitor records; IP payloads remain AES-GCM encrypted, but other visitor metadata is not encrypted by the backup tool. Backup directories must have no group/other permissions, and data/manifest files are created mode `0600`. Manifests contain only the storage format, timestamp, filename, byte count, integrity checksum, and validity flag; no credentials or encryption keys are included. Checksums detect corruption, not malicious replacement by an actor who can rewrite both files. Protect the disk and backup destination accordingly.

The default Render destination `/var/data/backups` shares the same persistent disk as the live file and is not disaster recovery for disk loss. No external destination is connected or uploaded to. An off-site copy should encrypt the entire backup before transfer and use a separate account/failure domain, restricted identities, and retention protections. Backup/restore operation locks are not automatically removed. Restore is only exposed through the operator CLI, requires typed confirmation, refuses an existing app lock, and preserves pre-restore bytes. Automated tests use temporary synthetic files only; they never touch the production storage path.
