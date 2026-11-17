# IP Data and Device Regression Validation

## Scope and safety

This phase validates the uncommitted regression repair with synthetic provider responses and User-Agent strings. The production MongoDB URI was not used; no server process, Render deployment, production API, or production record was accessed. No database writes or migrations were run. The three pre-existing backup files remain untracked and untouched.

## Root causes

- `getGeoData` previously treated any fetch, HTTP, JSON, or provider failure as a complete set of `Unknown` values. It did not check HTTP status, time out, retry, or report a sanitized failure reason. A provider outage, network problem, malformed response, or rate limit could therefore erase every geo field for a new record.
- The Android fallback regex had double-escaped whitespace/digit tokens and expected an extra semicolon. It failed for ordinary Android model strings such as `Android 13; 220333QAG Build/...`.
- Chrome's reduced Android User-Agent may expose only `K`. Treating that as a model would falsely claim an exact device model.
- Current records store geo information under `geo`; older flat records can use names such as `country`, `region`, `city`, `postalCode`, `lat`, or `lon`. Serializers previously read only the nested form.
- Geolocation and User-Agent parsing now run as independent settled operations. One result cannot prevent persistence of the other.

## Implementation

- Added [lib/ipData.js](lib/ipData.js), which contains the independently testable `createGeoLookup`, `parseUserAgent`, `collectVisitorData`, `visitorGeo`, and public history serializer.
- Geolocation validates IP syntax before lookup. Private/local IPv4 and IPv6 addresses return `Local`; invalid and reserved addresses return unavailable values without a provider request.
- The existing `ipwho.is` provider is retained. The lookup checks HTTP status and requires `success: true`; each request has a five second timeout. Network/timeout, 429, 5xx, and malformed JSON failures can retry once. 4xx and provider-declared invalid lookups do not retry.
- `Retry-After` is observed for rate limits. Short delays are honored for the single retry; longer delays suppress the retry and extend a bounded failure cache. Successful results cache for 15 minutes, failed results for 30 seconds by default, with a 500-entry bound. Concurrent requests for the same IP share one pending lookup.
- Missing provider fields remain individually unavailable; they do not erase valid fields. No location is synthesized. Provider errors log only a safe reason, never the visitor IP or response body.
- User-Agent parsing continues to use the installed `ua-parser-js` dependency. Android fallback accepts only a model token actually present in the User-Agent and rejects generic/reduced-UA placeholders such as `K` and `A`.
- Public `/api/history` serialization retains a masked IP and only city, region, country, country code, and timezone. ISP, organization, ASN, coordinates, full IP, raw headers, and credentials are not included. Admin history remains routed through `requireAdmin` and the existing admin serializer.
- Current and legacy geo field names are normalized at response time only. MongoDB documents are not migrated or rewritten.

## Automated validation

Added [test/ipData.test.js](test/ipData.test.js). `node --test test/ipData.test.js` passed **15/15** tests covering:

- Provider success mapping, individual missing fields, strict success flag, invalid IP, private/local/reserved IP handling, HTTP status behavior, malformed JSON, timeout, retry, and rate-limit `Retry-After` behavior.
- Successful and failed cache expiry, bounded failure behavior, and concurrent lookup coalescing.
- Geolocation failure with working browser/OS/device parsing, and User-Agent parser failure with valid geo data preserved.
- Redmi 10C, a Redmi model code, Samsung Galaxy, Google Pixel, iPhone, iPad, Windows, Linux, macOS, and Android tablet User-Agents. The reduced-UA `K` token is not reported as a model.
- Current and legacy public history field mapping, masked-IP retention, omission of ISP/organization/coordinates/full IP, and the admin history route's `requireAdmin` guard.

The checks use mocks and synthetic data. They do not prove that `ipwho.is` is reachable from Render or that live MongoDB records contain particular fields.

## Files changed

- `server.js` — uses independent IP data collection and the shared compatibility serializer.
- `lib/ipData.js` — isolated provider, IP-range, User-Agent, and response serialization logic.
- `test/ipData.test.js` — focused automated regression and privacy tests.
- `IP_DATA_AND_DEVICE_REGRESSION_REPORT.md` — this validation report.

## Remaining live verification

- Verify `ipwho.is` response/reachability and rate-limit behavior from the deployed Render runtime without logging visitor addresses.
- Verify the Render deployment includes these uncommitted changes before evaluating browser behavior.
- Inspect representative database records only with explicit safe access; no production record was read in this phase.
- The repair is committed locally as `a17cec5`. It has not been pushed or deployed; the remote branch remains at its previous commit.
