# API Documentation

All API responses use `Cache-Control: no-store`. JSON bodies are limited to 16 KiB. V3 history, analytics, export, and live-refresh endpoints require an authenticated admin session. The optional local temporary-storage mode adds Basic Auth to every route except `GET /healthz`; it is not a hosted Render service configuration.

## Public endpoints

| Method/path | Query/body | Success | Errors |
|---|---|---|---|
| `GET /healthz` | None | `200 {success:true,status:"ok"}` when available | `503 {success:false,status:"unavailable"}` when the persistent repository is unavailable |
| `POST /api/public/intelligence` | Optional validated `client` signal object | `201 {success:true,data:profile}` | `400` invalid body; `429` limit; `500` generic request error |
| `GET /api/public/history` | `page`, `limit`, `search`, `country`, `device` | `200 {success:true,data:{page,limit,total,pages,data:[maskedRecord]}}` | `429`, generic `500` |
| `GET, POST /api/track` | POST accepts the same optional `client` object | Legacy-compatible `200 {success:true,visitor:profile}` | `400`, `429`, generic `500` |
| `GET /api/history-preview` | None | `200 {success:true,locked:true,count,data:[maskedRecord]}` | `429`, generic `500` |
| `GET /api/history` | `page`, `limit`, `search`, `country`, `device` | `200 {success:true,locked:false,count,data:[maskedRecord]}` | `429`, generic `500` |
| `GET /api/stats` | None | `200 {success:true,total,uniqueIPs,last24h,countries,devices,security:{available:false,reason}}` | `429`, generic `500` |
| `POST /api/analytics/pageview` | `{path:string,duration?:number}`; path must be local; max duration 1 hour | `200 {success:true}` | `400` invalid path/duration; `429`; generic `500` |

Public history serializers expose masked IP and coarse location only. The current intelligence/track response reports the requesting client's own detected IP for that client profile; it does not expose other visitors' full IPs or private history. Page analytics remove query and fragment components; titles, referrers, raw IPs, and user agents are not stored in analytics events.

## Authentication

| Method/path | Auth | Success/error |
|---|---|---|
| `GET /api/admin/auth/status`, `GET /api/live/status` | None | `200` authenticated boolean |
| `POST /api/admin/auth/login`, `POST /api/live/login` | Origin checked; password body | `200` and shared secure session cookie; `401` invalid credentials; `403` bad origin; `429` rate limited |
| `POST /api/admin/auth/logout`, `POST /api/live/logout` | Origin checked | `200`; clears and revokes the session |

## Admin history compatibility

Both contracts require admin authentication. The default preserves the legacy array shape:

`GET /api/admin/history?page=1&limit=50&search=...&country=...&device=...`

Returns `200 {success:true,count:number,data:[detailedRecord],page:number,limit:number,total:number,pages:number}`. `count` is the current page length. Errors include `401` unauthorized, `400` for an unsupported contract selector, and generic `500`.

The V3 console requests `GET /api/admin/history?contract=v3...`, which returns `200 {success:true,data:{page,limit,total,pages,data:[detailedRecord]}}`. `contract=legacy` is equivalent to the default. Unknown contract values return `400`. This query selector lets old clients and V3 use the same route without weakening access control.

`GET /api/admin/history/:id` returns `200 {success:true,data:detailedRecord}`, `401`, `404 {success:false,error:{code:"NOT_FOUND",message}}`, or generic `500`.

## Legacy analytics contracts, privacy-reduced

These paths remain admin-only. Historical analytics from before storage format V2 cannot be reconstructed. Responses include `historicalDataAvailable:false` and `collectedFrom`; no historic rows are fabricated. Collection is limited to the new migration date onward, the newest 30 days, and the documented caps. Before V1-to-V2 migration, analytics are empty and the `collectedFrom` marker is initialized atomically. Totals and averages reflect retained, capped events, not lifetime totals; the overview `availability` object indicates when an event cap is reached.

| Method/path | Query | Success contract | Error statuses |
|---|---|---|---|
| `GET /api/analytics/overview` | None | Legacy top-level `activeSessions`, `lastHour:{requests}`, `last24h:{requests,pageViews,sessions,securityEvents,uniqueVisitors,returningVisitors}`, `runtime:{totalRequests,errors,averageResponseMs}`, `statusCodes[]`, `endpoints[]`; also `visitors` and `availability` metadata | `401`, generic `500` |
| `GET /api/analytics/requests` | `limit` integer 1–500, default 100 | `{success,count,data:[{sessionId,path,method,status,duration,createdAt,referrer:null}],historicalDataAvailable:false,collectedFrom,availability}` | `400`, `401`, generic `500` |
| `GET /api/analytics/pages` | None | `{success,pages:[{path,views,averageDuration:number|null}],data:pages,historicalDataAvailable:false,collectedFrom,availability}` | `401`, generic `500` |
| `GET /api/analytics/sessions` | `limit` integer 1–500, default 100 | `{success,active,count,data:[{sessionId,ipHash:null,userAgent:null,referrer:null,firstPath,createdAt,lastSeen,updatedAt,requestCount}],historicalDataAvailable,collectedFrom}` | `400`, `401`, generic `500` |
| `GET /api/analytics/session/:sessionId` | Opaque 64-hex keyed session ID | `200 {success,session,pages,requests,visitors,historicalDataAvailable:false,collectedFrom}`; detail arrays are bounded | `400` malformed ID, `401`, `404` absent/expired session, generic `500` |
| `GET /api/analytics/security` | None | `{success,count,data:[{type,method,path,createdAt,sessionId:null}],historicalDataAvailable,collectedFrom}` | `401`, generic `500` |

Admin session cookies are random, HTTP-only, SameSite=Strict, and expire after 30 minutes. They include the Secure attribute in production. Only a keyed digest is stored as the session identifier; the bearer cookie value is never persisted. Session records contain no IP hash, user agent, or referrer. Request analytics contain a normalized route, method, status and duration. Page analytics retain local paths and only report average duration where a duration was actually provided. Security events are limited to unauthorized, forbidden, not-found, rate-limited, suspicious-path, and unusual-method categories; suspicious and unmatched paths are redacted. No passwords, credentials, tokens, raw IPs, or user agents are collected in telemetry.

## Other protected operations

| Method/path | Success | Errors |
|---|---|---|
| `GET /api/admin/analytics/overview` | V3 visitor aggregates `{success:true,data:{totalVisitors,last24h,countries,devices,browsers,operatingSystems,daily}}` | `401`, generic `500` |
| `GET /api/admin/provider/health` | Last actual provider state | `401` |
| `GET /api/admin/server/health`, `GET /api/server-health` | Process, telemetry and storage health | `401`, generic `500` |
| `GET /api/admin/export?format=json|csv` | Detailed export; CSV neutralizes spreadsheet formulas | `401`, `400` invalid format, generic `500` |
| `GET /api/admin/live`, `GET /api/live` | Admin-authenticated bounded polling metadata: `{success:true,data:{mode:"polling",intervalMs:20000,observedAt}}` | `401`, generic `500` if shared session storage is unavailable |
| `POST /api/admin/clear-data` | `{type:"24h"|"7d"|"history"}`; origin checked | `400` invalid type, `401`, `403` bad origin, generic `500` |

Generic server errors use `{success:false,error:{code,message}}` and do not disclose paths or storage contents. Legacy-compatible analytics intentionally omit legacy IP hashes, user agents, referrers, raw session IDs, security details, and historical data unavailable in V3. Live refresh uses bounded authenticated polling on the Render-hosted application; no SSE endpoint is implemented. `/healthz` checks persistent repository readiness (including a database ping in Neon mode) and exposes only healthy/unavailable status.
