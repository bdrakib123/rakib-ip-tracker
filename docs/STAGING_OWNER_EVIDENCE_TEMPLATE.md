# Staging Owner Evidence Record

Record sanitized outcomes only. Do not attach screenshots containing environment values, Authorization headers, credentials, visitor IPs, or visitor records. No secrets or complete environment dumps belong here.

## Service and build

- Date/time and timezone: ______________________________
- Service name: ______________________________
- Staging URL (not production): ______________________________
- Repository/branch: ______________________________
- Root Directory blank confirmed: [ ]
- Instance count: __________
- Node version: __________
- Build result/reference: ______________________________
- Start result/reference: ______________________________
- `/healthz` status and timestamp: ______________________________

## Configuration isolation

- Separate staging service/environment confirmed: [ ]
- Separate admin password configured (value not recorded): [ ]
- Separate 64-hex encryption key configured (value not recorded): [ ]
- No production secrets/database variables copied: [ ]
- Staging URL/domain separated from production: [ ]

## Persistent disk (paid staging only)

- Separate disk name: ______________________________
- Attachment confirmed: [ ]
- Actual dashboard size: __________
- Mount `/var/data` confirmed: [ ]
- File `/var/data/staging/visitors.json` confirmed: [ ]
- Backup `/var/data/staging/backups` confirmed: [ ]
- File/directory permissions (modes only): ______________________________
- Synthetic record survived restart: [ ] Pass [ ] Fail [ ] Not run
- Missing mount failed startup safely: [ ] Pass [ ] Fail [ ] Not run
- Corrupt synthetic data failed closed: [ ] Pass [ ] Fail [ ] Not run
- Active lock rejected second process: [ ] Pass [ ] Fail [ ] Not run

## Proxy test

- Platform evidence reference (no raw headers): ______________________________
- Candidate `TRUST_PROXY_HOPS` integer: __________
- Direct/no forwarding result: ______________________________
- Forged XFF result: ______________________________
- Multiple/malformed XFF result: ______________________________
- IPv4/IPv6 result: ______________________________
- Controlled source attribution matched: [ ] Yes [ ] No [ ] Not run
- Forged input changed rate-limit bucket: [ ] Yes [ ] No [ ] Not run
- Overall proxy status: [ ] Pass [ ] Fail [ ] Blocked [ ] Not run

## Recovery and approvals

- Same-disk backup checksum result: ______________________________
- Independent encrypted destination authorized/configured: [ ] Yes [ ] No
- Synthetic isolated restore drill result: ______________________________
- Approved RPO: ______________________________
- Approved RTO: ______________________________
- Owner approval for staging validation: ______________________________
- Second-person isolation review: ______________________________

Keep `BLOCKED — RENDER PROXY TOPOLOGY UNVERIFIED` until platform and staging evidence agree. Production remains NO-GO until the separate production checklist is approved.
