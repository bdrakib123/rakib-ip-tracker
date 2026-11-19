"use strict";

const crypto = require("node:crypto");
const { StorageError } = require("./jsonFileRepository");

const ANALYTICS_VERSION = 1;
const MAX_SESSION_EVENTS = 200;
const LIMITS = Object.freeze({ requests: 5000, pages: 2000, security: 1000, sessions: 1000 });
const SCHEMA_VERSION = 1;
const SECURITY_TYPES = new Set(["unauthorized", "forbidden", "not_found", "rate_limited", "suspicious_path", "unusual_method"]);

function safeDate(value, code = "STORAGE_INPUT_INVALID") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new StorageError(code, "A valid timestamp is required.");
  return date;
}

function jsonValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  if (Object.hasOwn(value, "ip")) throw new StorageError("STORAGE_INPUT_INVALID", "Visitor record contains prohibited plaintext IP data.");
  return JSON.parse(JSON.stringify(value));
}

function rowRecord(row) {
  return { ...row.payload, _id: row.id, createdAt: new Date(row.created_at).toISOString() };
}

function escapeLike(value) { return value.replace(/[\\%_]/g, "\\$&"); }

function createNeonRepository({ sql, now = () => new Date() }) {
  if (typeof sql !== "function" || typeof sql.query !== "function" || typeof sql.transaction !== "function") {
    throw new TypeError("A Neon serverless SQL client is required.");
  }
  let closed = false;
  let metadataInitialization = null;
  const assertOpen = () => { if (closed) throw new StorageError("DATABASE_CLOSED", "Database repository is closed."); };
  const query = async (text, values = []) => {
    assertOpen();
    try { return await sql.query(text, values); }
    catch (error) {
      const wrapped = new StorageError("DATABASE_OPERATION_FAILED", "The database operation could not be completed.");
      wrapped.cause = error;
      throw wrapped;
    }
  };

  async function getAnalytics() {
    if (!metadataInitialization) {
      metadataInitialization = query(
        "INSERT INTO analytics_metadata (singleton, collected_from) VALUES (true, $1) ON CONFLICT (singleton) DO NOTHING",
        [now()]
      ).catch(error => {
        metadataInitialization = null;
        throw error;
      });
    }
    await metadataInitialization;
    const cutoff = new Date(now().getTime() - 30 * 86400_000);
    const [meta, requests, pages, security, sessions] = await Promise.all([
      query("SELECT collected_from FROM analytics_metadata WHERE singleton = true"),
      query("SELECT created_at, method, path, status, duration_ms, session_identifier FROM request_analytics WHERE created_at >= $1 ORDER BY created_at DESC, id DESC LIMIT $2", [cutoff, LIMITS.requests]),
      query("SELECT created_at, method, path, duration_ms, session_identifier FROM page_analytics WHERE created_at >= $1 ORDER BY created_at DESC, id DESC LIMIT $2", [cutoff, LIMITS.pages]),
      query("SELECT created_at, event_type, method, path FROM security_analytics WHERE created_at >= $1 ORDER BY created_at DESC, id DESC LIMIT $2", [cutoff, LIMITS.security]),
      query("SELECT session_identifier, created_at, last_seen, updated_at, request_count, first_path FROM visitor_sessions WHERE last_seen >= $1 ORDER BY last_seen DESC LIMIT $2", [cutoff, LIMITS.sessions])
    ]);
    const toIso = value => new Date(value).toISOString();
    return {
      version: ANALYTICS_VERSION,
      collectedFrom: meta[0] ? toIso(meta[0].collected_from) : toIso(now()),
      requests: requests.map(row => ({ method: row.method, path: row.path, status: Number(row.status), duration: Number(row.duration_ms), createdAt: toIso(row.created_at), sessionId: row.session_identifier?.trim() || null, referrer: null })),
      pages: pages.map(row => ({ method: row.method, path: row.path, duration: row.duration_ms == null ? null : Number(row.duration_ms), createdAt: toIso(row.created_at), sessionId: row.session_identifier?.trim() || null, title: null, referrer: null })),
      security: security.map(row => ({ type: row.event_type, method: row.method, path: row.path, createdAt: toIso(row.created_at), sessionId: null })),
      sessions: sessions.map(row => ({ sessionId: row.session_identifier.trim(), createdAt: toIso(row.created_at), lastSeen: toIso(row.last_seen), updatedAt: toIso(row.updated_at), requestCount: Number(row.request_count), firstPath: row.first_path }))
    };
  }

  return {
    persistent: true,
    async assertSchema() {
      const rows = await query("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1");
      if (!rows.length || Number(rows[0].version) < SCHEMA_VERSION) throw new StorageError("DATABASE_SCHEMA_NOT_READY", "Database migrations have not been applied.");
      if (Number(rows[0].version) > SCHEMA_VERSION) throw new StorageError("DATABASE_SCHEMA_UNSUPPORTED", "The database schema is newer than this application supports.");
      return true;
    },
    async ping() { const rows = await query("SELECT 1 AS ok"); return rows[0]?.ok === 1; },
    async close() { closed = true; },
    async insert(input) {
      const record = jsonValue(input);
      const createdAt = safeDate(record.createdAt);
      const id = typeof record._id === "string" && record._id.length <= 128 ? record._id : crypto.randomUUID();
      record._id = id;
      record.createdAt = createdAt.toISOString();
      const country = record.geo?.country ?? record.country ?? null;
      const deviceCategory = record.device?.category ?? record.device?.type ?? null;
      const sessionIdentifier = record.analytics?.sessionId || null;
      const rows = await query(
        "INSERT INTO visitors (id, created_at, ip_hash, country, device_category, session_identifier, payload) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id, created_at, payload",
        [id, createdAt, record.ipHash || null, country, deviceCategory, sessionIdentifier, JSON.stringify(record)]
      );
      return rowRecord(rows[0]);
    },
    async countByIpHash(hashes) {
      const values = [...new Set((Array.isArray(hashes) ? hashes : [hashes]).filter(value => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value)))];
      if (!values.length) return 0;
      const rows = await query("SELECT count(*)::int AS count FROM visitors WHERE ip_hash::text = ANY($1::text[])", [values]);
      return Number(rows[0].count);
    },
    async distinctIpCount() {
      const rows = await query("SELECT count(DISTINCT ip_hash)::int AS count FROM visitors WHERE ip_hash IS NOT NULL");
      return Number(rows[0].count);
    },
    async distinctIpCountSince(since) {
      const rows = await query("SELECT count(DISTINCT ip_hash)::int AS count FROM visitors WHERE created_at >= $1 AND ip_hash IS NOT NULL", [safeDate(since)]);
      return Number(rows[0].count);
    },
    async returningVisitorCountSince(since) {
      const rows = await query("SELECT count(*)::int AS count FROM visitors WHERE created_at >= $1 AND payload #>> '{analytics,returningVisitor}' = 'true'", [safeDate(since)]);
      return Number(rows[0].count);
    },
    async history({ page = 1, limit = 50, maxLimit = 100, search = "", country = "", device = "", ipSearchHashes = [] } = {}) {
      const safePage = Math.max(1, Math.min(10_000, Number.parseInt(page, 10) || 1));
      const safeLimit = Math.max(1, Math.min(Math.max(1, Math.min(1000, Number.parseInt(maxLimit, 10) || 100)), Number.parseInt(limit, 10) || 50));
      const conditions = [];
      const values = [];
      const bind = value => { values.push(value); return `$${values.length}`; };
      if (typeof country === "string" && country.trim()) conditions.push(`country = ${bind(country.trim().slice(0, 80))}`);
      if (typeof device === "string" && device.trim()) conditions.push(`device_category = ${bind(device.trim().slice(0, 30))}`);
      const term = typeof search === "string" ? search.trim().slice(0, 80) : "";
      const hashes = [...new Set((Array.isArray(ipSearchHashes) ? ipSearchHashes : []).filter(hash => typeof hash === "string" && /^[a-f0-9]{64}$/i.test(hash)))];
      if (term) {
        const pattern = `%${escapeLike(term)}%`;
        const p = bind(pattern);
        const textSearch = `(payload->>'ipMasked' ILIKE ${p} ESCAPE '\\' OR payload #>> '{geo,city}' ILIKE ${p} ESCAPE '\\' OR payload #>> '{geo,region}' ILIKE ${p} ESCAPE '\\' OR payload #>> '{geo,country}' ILIKE ${p} ESCAPE '\\' OR payload #>> '{device,model}' ILIKE ${p} ESCAPE '\\' OR payload #>> '{device,vendor}' ILIKE ${p} ESCAPE '\\' OR payload #>> '{browser,name}' ILIKE ${p} ESCAPE '\\' OR payload #>> '{os,name}' ILIKE ${p} ESCAPE '\\')`;
        const clauses = [textSearch];
        if (hashes.length) clauses.push(`ip_hash::text = ANY(${bind(hashes)}::text[])`);
        conditions.push(`(${clauses.join(" OR ")})`);
      }
      const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
      const countRows = await query(`SELECT count(*)::int AS total FROM visitors${where}`, values);
      const total = Number(countRows[0].total);
      const dataValues = values.slice();
      dataValues.push(safeLimit, (safePage - 1) * safeLimit);
      const rows = await query(`SELECT id, created_at, payload FROM visitors${where} ORDER BY created_at DESC, id DESC LIMIT $${dataValues.length - 1} OFFSET $${dataValues.length}`, dataValues);
      return { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit), data: rows.map(rowRecord) };
    },
    async findById(id) {
      if (typeof id !== "string" || id.length > 128) return null;
      const rows = await query("SELECT id, created_at, payload FROM visitors WHERE id = $1", [id]);
      return rows[0] ? rowRecord(rows[0]) : null;
    },
    async clearCreatedSince(cutoff) {
      const date = safeDate(cutoff);
      const [result] = await sql.transaction([
        sql`DELETE FROM visitors WHERE created_at >= ${date} RETURNING id`,
        sql`DELETE FROM request_analytics WHERE created_at >= ${date}`,
        sql`DELETE FROM page_analytics WHERE created_at >= ${date}`,
        sql`DELETE FROM security_analytics WHERE created_at >= ${date}`,
        sql`DELETE FROM visitor_sessions WHERE last_seen >= ${date}`
      ]);
      return result.length;
    },
    async clearAll() {
      const [result] = await sql.transaction([
        sql`DELETE FROM visitors RETURNING id`,
        sql`DELETE FROM request_analytics`, sql`DELETE FROM page_analytics`,
        sql`DELETE FROM security_analytics`, sql`DELETE FROM visitor_sessions`,
        sql`INSERT INTO analytics_metadata (singleton, collected_from) VALUES (true, ${now()}) ON CONFLICT (singleton) DO UPDATE SET collected_from = EXCLUDED.collected_from`
      ]);
      return result.length;
    },
    async overview(at = new Date()) {
      const current = safeDate(at);
      const [total, countries, devices, browsers, systems, daily] = await Promise.all([
        query("SELECT count(*)::int AS count FROM visitors"),
        query("SELECT country AS name, count(*)::int AS count FROM visitors WHERE created_at >= $1 AND country IS NOT NULL GROUP BY country ORDER BY count DESC, country LIMIT 8", [new Date(current.getTime() - 86400_000)]),
        query("SELECT device_category AS name, count(*)::int AS count FROM visitors WHERE created_at >= $1 AND device_category IS NOT NULL GROUP BY device_category ORDER BY count DESC, device_category LIMIT 8", [new Date(current.getTime() - 86400_000)]),
        query("SELECT payload #>> '{browser,name}' AS name, count(*)::int AS count FROM visitors WHERE created_at >= $1 AND payload #>> '{browser,name}' IS NOT NULL GROUP BY name ORDER BY count DESC, name LIMIT 8", [new Date(current.getTime() - 86400_000)]),
        query("SELECT payload #>> '{os,name}' AS name, count(*)::int AS count FROM visitors WHERE created_at >= $1 AND payload #>> '{os,name}' IS NOT NULL GROUP BY name ORDER BY count DESC, name LIMIT 8", [new Date(current.getTime() - 86400_000)]),
        query("SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date, count(*)::int AS count FROM visitors WHERE created_at >= $1 GROUP BY 1 ORDER BY 1", [new Date(current.getTime() - 7 * 86400_000)])
      ]);
      const recent = await query("SELECT count(*)::int AS count FROM visitors WHERE created_at >= $1", [new Date(current.getTime() - 86400_000)]);
      return { totalVisitors: Number(total[0].count), last24h: Number(recent[0].count), countries, devices, browsers, operatingSystems: systems, daily };
    },
    async getAnalytics() { return getAnalytics(); },
    async saveAnalyticsBatch(events) {
      if (!Array.isArray(events) || !events.length || events.length > 250) throw new StorageError("STORAGE_ANALYTICS_INPUT_INVALID", "Analytics batch is invalid.");
      const statements = [];
      for (const event of events) {
        if (!event || !["request", "page"].includes(event.type)) throw new StorageError("STORAGE_ANALYTICS_INPUT_INVALID", "Analytics event is invalid.");
        const createdAt = safeDate(event.createdAt, "STORAGE_ANALYTICS_INPUT_INVALID");
        const method = String(event.method || "").toUpperCase();
        const eventPath = String(event.path || "");
        const duration = event.duration == null && event.type === "page" ? null : Number(event.duration);
        const sessionId = event.sessionId == null ? null : String(event.sessionId);
        if (!/^[A-Z]{1,16}$/.test(method) || !eventPath.startsWith("/") || eventPath.startsWith("//") || /[?#\r\n\\]/.test(eventPath) || eventPath.length > 180 ||
            (sessionId && !/^[a-f0-9]{64}$/.test(sessionId)) || !Number.isFinite(duration) && duration !== null ||
            (duration !== null && (duration < 0 || duration > (event.type === "page" ? 3_600_000 : 600_000))) ||
            (event.type === "request" && (!Number.isInteger(event.status) || event.status < 100 || event.status > 599))) {
          throw new StorageError("STORAGE_ANALYTICS_INPUT_INVALID", "Analytics event fields are invalid.");
        }
        const inferred = event.securityType || (event.type === "request" ? ({ 401: "unauthorized", 403: "forbidden", 404: "not_found", 429: "rate_limited" })[event.status] : null);
        if (inferred && !SECURITY_TYPES.has(inferred)) throw new StorageError("STORAGE_ANALYTICS_INPUT_INVALID", "Security event type is invalid.");
        if (event.type === "request") statements.push(sql`INSERT INTO request_analytics (created_at, method, path, status, duration_ms, session_identifier) VALUES (${createdAt}, ${method}, ${inferred === "not_found" || inferred === "suspicious_path" ? "/[redacted]" : eventPath}, ${event.status}, ${Math.round(duration)}, ${sessionId})`);
        else statements.push(sql`INSERT INTO page_analytics (created_at, method, path, duration_ms, session_identifier) VALUES (${createdAt}, ${method}, ${eventPath}, ${duration === null ? null : Math.round(duration)}, ${sessionId})`);
        if (sessionId) statements.push(sql`INSERT INTO visitor_sessions (session_identifier, created_at, last_seen, updated_at, request_count, first_path) VALUES (${sessionId}, ${createdAt}, ${createdAt}, ${createdAt}, ${event.type === "request" ? 1 : 0}, ${eventPath}) ON CONFLICT (session_identifier) DO UPDATE SET last_seen = GREATEST(visitor_sessions.last_seen, EXCLUDED.last_seen), updated_at = GREATEST(visitor_sessions.updated_at, EXCLUDED.updated_at), request_count = visitor_sessions.request_count + EXCLUDED.request_count`);
        if (inferred) statements.push(sql`INSERT INTO security_analytics (created_at, event_type, method, path) VALUES (${createdAt}, ${inferred}, ${method}, ${inferred === "not_found" || inferred === "suspicious_path" ? "/[redacted]" : eventPath})`);
      }
      const cutoff = new Date(now().getTime() - 30 * 86400_000);
      statements.push(sql`DELETE FROM request_analytics WHERE id IN (SELECT id FROM request_analytics ORDER BY created_at DESC, id DESC OFFSET ${LIMITS.requests})`);
      statements.push(sql`DELETE FROM page_analytics WHERE id IN (SELECT id FROM page_analytics ORDER BY created_at DESC, id DESC OFFSET ${LIMITS.pages})`);
      statements.push(sql`DELETE FROM security_analytics WHERE id IN (SELECT id FROM security_analytics ORDER BY created_at DESC, id DESC OFFSET ${LIMITS.security})`);
      statements.push(sql`DELETE FROM visitor_sessions WHERE last_seen < ${cutoff}`);
      statements.push(sql`DELETE FROM visitor_sessions WHERE session_identifier IN (SELECT session_identifier FROM visitor_sessions ORDER BY last_seen DESC, session_identifier DESC OFFSET ${LIMITS.sessions})`);
      await sql.transaction(statements);
    },
    async analyticsSnapshot() {
      const analytics = await getAnalytics();
      const nowMs = now().getTime();
      const recent = (list, period) => list.filter(item => nowMs - Date.parse(item.createdAt) <= period);
      const lastHour = recent(analytics.requests, 3600_000);
      const lastDayRequests = recent(analytics.requests, 86400_000);
      const lastDayPages = recent(analytics.pages, 86400_000);
      const lastDaySecurity = recent(analytics.security, 86400_000);
      const statusCodes = new Map(); const endpoints = new Map();
      for (const event of analytics.requests) {
        statusCodes.set(event.status, (statusCodes.get(event.status) || 0) + 1);
        endpoints.set(event.path, (endpoints.get(event.path) || 0) + 1);
      }
      const pageGroups = new Map();
      for (const event of analytics.pages) {
        const group = pageGroups.get(event.path) || [];
        group.push(event); pageGroups.set(event.path, group);
      }
      const requestEvents = analytics.requests.slice(0, 500);
      return {
        collectedFrom: analytics.collectedFrom,
        totalPageViews: analytics.pages.length,
        activeSessions: analytics.sessions.filter(session => nowMs - Date.parse(session.lastSeen) <= 30 * 60_000).length,
        lastHour: { requests: lastHour.length },
        last24h: { requests: lastDayRequests.length, pageViews: lastDayPages.length, sessions: analytics.sessions.filter(session => nowMs - Date.parse(session.createdAt) <= 86400_000).length, securityEvents: lastDaySecurity.length },
        runtime: { totalRequests: analytics.requests.length, errors: analytics.requests.filter(event => event.status >= 500).length, averageResponseMs: analytics.requests.length ? Math.round(analytics.requests.reduce((sum, event) => sum + event.duration, 0) / analytics.requests.length) : 0 },
        statusCodes: [...statusCodes].map(([status, count]) => ({ status, count })).sort((a,b) => b.count - a.count),
        endpoints: [...endpoints].map(([path, count]) => ({ path, count })).sort((a,b) => b.count - a.count).slice(0,20),
        requestEvents,
        pageRows: [...pageGroups].map(([path, rows]) => { const measured = rows.filter(row => Number.isFinite(row.duration)); return { path, views: rows.length, averageDuration: measured.length ? Math.round(measured.reduce((sum,row)=>sum+row.duration,0)/measured.length) : null }; }).sort((a,b) => b.views - a.views).slice(0,50),
        sessions: analytics.sessions,
        securityEvents: analytics.security.slice(0, 200),
        availability: { historical: false, collectedFrom: analytics.collectedFrom, retentionDays: 30, requestEventsCapped: analytics.requests.length >= LIMITS.requests, pageEventsCapped: analytics.pages.length >= LIMITS.pages, securityEventsCapped: analytics.security.length >= LIMITS.security }
      };
    },
    async sessionAnalyticsDetail(sessionId) {
      if (typeof sessionId !== "string" || !/^[a-f0-9]{64}$/.test(sessionId)) return null;
      const [sessions, pages, requests] = await Promise.all([
        query("SELECT session_identifier, created_at, last_seen, updated_at, request_count, first_path FROM visitor_sessions WHERE session_identifier = $1", [sessionId]),
        query("SELECT created_at, method, path, duration_ms FROM page_analytics WHERE session_identifier = $1 ORDER BY created_at DESC, id DESC LIMIT $2", [sessionId, MAX_SESSION_EVENTS]),
        query("SELECT created_at, method, path, status, duration_ms FROM request_analytics WHERE session_identifier = $1 ORDER BY created_at DESC, id DESC LIMIT $2", [sessionId, MAX_SESSION_EVENTS])
      ]);
      if (!sessions[0]) return null;
      const row = sessions[0];
      const session = { sessionId: row.session_identifier.trim(), createdAt: new Date(row.created_at).toISOString(), lastSeen: new Date(row.last_seen).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), requestCount: Number(row.request_count), firstPath: row.first_path, ipHash: null, userAgent: null, referrer: null };
      return { session, pages: pages.map(item => ({ createdAt: new Date(item.created_at).toISOString(), method: item.method, path: item.path, duration: item.duration_ms == null ? null : Number(item.duration_ms), sessionId, ipHash: null })), requests: requests.map(item => ({ createdAt: new Date(item.created_at).toISOString(), method: item.method, path: item.path, status: Number(item.status), duration: Number(item.duration_ms), sessionId, referrer: null })), visitors: [] };
    },
    async findVisitorsForSession(sessionId) {
      if (typeof sessionId !== "string" || !/^[a-f0-9]{64}$/.test(sessionId)) return [];
      const rows = await query("SELECT id, created_at, payload FROM visitors WHERE session_identifier = $1 ORDER BY created_at ASC LIMIT 100", [sessionId]);
      return rows.map(rowRecord);
    },
    async createAdminSession(tokenHash, expiresAt) {
      if (!/^[a-f0-9]{64}$/.test(tokenHash)) throw new StorageError("SESSION_INPUT_INVALID", "Administrator session is invalid.");
      await query("DELETE FROM admin_sessions WHERE expires_at <= now()");
      await query("INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES ($1, $2, $3)", [tokenHash, now(), safeDate(expiresAt)]);
    },
    async hasAdminSession(tokenHash) {
      const rows = await query("SELECT 1 AS ok FROM admin_sessions WHERE token_hash = $1 AND expires_at > now()", [tokenHash]);
      return rows.length > 0;
    },
    async revokeAdminSession(tokenHash) { await query("DELETE FROM admin_sessions WHERE token_hash = $1", [tokenHash]); },
    async consumeRateLimit(bucketHash, windowMs, max) {
      if (!/^[a-f0-9]{64}$/.test(bucketHash) || !Number.isInteger(windowMs) || windowMs < 1 || !Number.isInteger(max) || max < 1) throw new StorageError("RATE_LIMIT_CONFIG_INVALID", "Rate limit configuration is invalid.");
      const rows = await query(`WITH expired AS (
        DELETE FROM rate_limit_buckets WHERE window_started_at <= now() - interval '1 day'
      )
        INSERT INTO rate_limit_buckets (bucket_hash, window_started_at, request_count)
        VALUES ($1, now(), 1)
        ON CONFLICT (bucket_hash) DO UPDATE SET
          request_count = CASE WHEN rate_limit_buckets.window_started_at <= now() - ($2 * interval '1 millisecond') THEN 1 ELSE rate_limit_buckets.request_count + 1 END,
          window_started_at = CASE WHEN rate_limit_buckets.window_started_at <= now() - ($2 * interval '1 millisecond') THEN now() ELSE rate_limit_buckets.window_started_at END
        RETURNING request_count, window_started_at`, [bucketHash, windowMs]);
      const row = rows[0];
      return { allowed: Number(row.request_count) <= max, remaining: Math.max(0, max - Number(row.request_count)), resetAt: new Date(new Date(row.window_started_at).getTime() + windowMs) };
    }
  };
}

module.exports = { createNeonRepository, LIMITS };
