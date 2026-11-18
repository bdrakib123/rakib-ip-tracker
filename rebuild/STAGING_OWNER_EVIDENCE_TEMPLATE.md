# Staging Owner Evidence Record

Complete this record only after manually configuring an isolated staging service. Record sanitized outcomes; do not attach screenshots containing environment values, credentials, request headers, visitor IPs, or visitor data. Do not enter secret values or full environment dumps here.

## Verification session

- Date/time (include timezone or UTC): ______________________________
- Owner/operator: ______________________________
- Reviewer / second-person isolation check: ______________________________
- Evidence references (redacted deployment ID, sanitized log event, test report): ______________________________

## Service identity and runtime

- Staging service name: ______________________________
- Staging URL/hostname: ______________________________
- Repository and selected branch: ______________________________
- Root directory: ______________________________
- Service type: ______________________________
- Access restriction applied before start (type and status; no sensitive CIDR needed): ______________________________
- Service instance count: ______________________________
- Node version observed: ______________________________
- Build result / sanitized deployment reference: ______________________________
- Start result / sanitized deployment reference: ______________________________
- Health check path: ______________________________
- Health endpoint result (HTTP status and timestamp only): ______________________________

## Storage isolation and disk

- Staging disk name (must be distinct from production): ______________________________
- Disk attachment confirmed: [ ] Yes [ ] No
- Disk size shown in dashboard: ______________________________
- Mount path confirmed as `/var/data`: [ ] Yes [ ] No
- Storage file confirmed as `/var/data/staging/visitors.json`: [ ] Yes [ ] No
- Backup directory confirmed as `/var/data/staging/backups`: [ ] Yes [ ] No
- Storage/lock file permissions verified (report modes only): ______________________________
- Backup directory/manifest permissions verified (report modes only): ______________________________
- Synthetic staging record survived controlled restart: [ ] Pass [ ] Fail [ ] Not run
- Missing mount failed startup safely: [ ] Pass [ ] Fail [ ] Not run
- Corrupt synthetic fixture failed closed: [ ] Pass [ ] Fail [ ] Not run
- Active storage lock refused second process: [ ] Pass [ ] Fail [ ] Not run
- Unexpected termination/stale-lock recovery drill: [ ] Pass [ ] Fail [ ] Not run
- Lock metadata preserved and process/disk access confirmed before any manual recovery: [ ] Yes [ ] No [ ] Not applicable

## Proxy-chain and rate-limit evidence

- Platform source used to establish expected proxy topology: ______________________________
- Expected proxy chain/hop evidence reference (do not paste raw headers): ______________________________
- `TRUST_PROXY_HOPS` candidate tested (integer only): ______________________________
- Direct/no-forwarded-header result: ______________________________
- Single forged XFF result (sanitized pass/fail only): ______________________________
- Multiple/comma-separated XFF result: ______________________________
- Malformed XFF result: ______________________________
- IPv4 path result: ______________________________
- IPv6 path result: ______________________________
- Attribution matched controlled test source without exposing it in evidence: [ ] Yes [ ] No [ ] Not run
- Spoofed header changed attribution: [ ] Yes [ ] No [ ] Not run
- Spoofed header created a new rate-limit bucket: [ ] Yes [ ] No [ ] Not run
- Overall proxy result: [ ] Pass [ ] Fail [ ] Blocked [ ] Not run
- Sanitized test reference: ______________________________

**Do not approve or copy a proxy-hop value to production from this form alone.** Attach platform evidence and review results separately; keep `BLOCKED — RENDER PROXY TOPOLOGY UNVERIFIED` until the real chain and spoof resistance are established.

## Secret configuration and resource separation

- Staging `ADMIN_PASSWORD` configured in protected service settings: [ ] Yes [ ] No
- Admin password minimum-length validation confirmed without recording value: [ ] Yes [ ] No
- Staging `IP_ENCRYPTION_KEY` configured in protected service settings: [ ] Yes [ ] No
- Encryption key 64-hex format confirmed without recording value: [ ] Yes [ ] No
- Confirmed neither secret was copied from production: [ ] Yes [ ] No
- Staging environment contains no production secrets or production database settings: [ ] Yes [ ] No
- Separate staging service identity and environment confirmed: [ ] Yes [ ] No
- Separate staging disk confirmed; no production disk/snapshot attached: [ ] Yes [ ] No
- Separate staging URL confirmed; no production hostname/domain attached: [ ] Yes [ ] No
- Storage and backup paths confirmed staging-only: [ ] Yes [ ] No
- MongoDB integration scripts were not run: [ ] Confirmed
- No production service/data was accessed during validation: [ ] Confirmed

## Backup and restore evidence

- Same-disk staging backup created and checksum verified: [ ] Pass [ ] Fail [ ] Not run
- Independent encrypted destination authorized/configured: [ ] Yes [ ] No
- External backup upload/verification result: ______________________________
- Independent synthetic restore drill result: ______________________________
- Approved RPO: ______________________________
- Approved RTO: ______________________________
- Last verified backup timestamp (no data values): ______________________________

No production backup should be included in this record or used in a drill.
