# API Documentation

All API responses are JSON except CSV export. Success uses `{ "success": true, "data": ... }`; errors use `{ "success": false, "error": { "code", "message" } }`. API responses send `Cache-Control: no-store`. Public history never returns an unmasked IP.

## Public APIs

### `POST /api/public/intelligence`

Records the requesting visitor and returns that visitor's own current profile. The request body is optional and accepts a bounded browser signal allowlist:

```json
{
  "client": {
    "screen": { "width": 390, "height": 844 },
    "viewport": { "width": 390, "height": 780 },
    "language": "en-US",
    "languages": ["en-US", "en"],
    "timezone": "Asia/Dhaka",
    "platform": "Android",
    "colorScheme": "dark",
    "online": true,
    "touchPoints": 5,
    "touchSupport": true,
    "hardwareConcurrency": 8,
    "connection": { "effectiveType": "4g", "downlink": 8, "rtt": 50 }
  }
}
```

Values not provided by the browser are `null`/`unsupported`. The response contains `data.ip`, `data.geo`, `data.device`, `data.os`, `data.browser`, `data.engine`, `data.client`, the requesting browser's `data.userAgent`, and a timestamp. This describes the requesting visitor's own data, not history. Geo fields have independent `{ value, status }` values; geo status is `available`, `partial`, `unavailable`, or `failed`. Device models are null if not reliably detectable.

### `GET /api/public/history?page=1&limit=20&search=&country=&device=`

Returns a paginated public history view. `limit` is capped at 100. Each item contains an IP masked to a network prefix, coarse location fields, and timestamp. Device, browser, OS, ISP, organization, ASN, coordinates, full IP, and User-Agent are excluded.

### `GET /healthz`

Minimal liveness response only. It does not expose database, provider, or runtime details.

## Admin APIs

Every `/api/admin/*` route below, except the login and auth status/logout routes, requires the server-side `rakib_admin` session cookie.

- `POST /api/admin/auth/login` — JSON `{ "password": "..." }`, rate-limited and same-origin checked. Sets an HTTP-only session cookie.
- `GET /api/admin/auth/status` — session status; contains no token.
- `POST /api/admin/auth/logout` — same-origin checked; revokes the current in-memory session.
- `GET /api/admin/history?page=1&limit=50&search=&country=&device=` — paginated detailed visitor history; limit capped at 100. Exact IPv4/IPv6 searches use keyed and legacy hashes, so full IP search works without storing new plaintext IP values.
- `GET /api/admin/history/:id` — protected visitor detail.
- `GET /api/admin/analytics/overview` — total and 24-hour counts, location/device/browser/OS summaries, and seven-day trend.
- `GET /api/admin/export?format=json|csv` — exports up to 1000 filtered rows. CSV values are escaped and formula-prefixed values neutralized.
- `GET /api/admin/provider/health` — provider identity and last observed lookup state, timestamp, and safe error code. `not_checked` means no live provider request has completed.
- `GET /api/admin/server/health` — protected runtime and memory status plus `storage` (`available`/`unavailable`). The legacy `database` field is retained as `not_configured`; V2 does not open a database connection. Overall status is `healthy` when file storage is readable and otherwise `degraded`.
- `GET /api/admin/live` — authenticated Server-Sent Events. Emits only a record ID and timestamp, never visitor details. Heartbeats and disconnect cleanup are enabled.

## Status values

Geo field status is `available`, `unavailable`, or `failed`. Unsupported browser APIs are represented as `null` client signals and rendered as “Unsupported”. An invalid or private IP is never sent to the geo provider. A real provider failure is classified and reported separately from a missing optional field.
