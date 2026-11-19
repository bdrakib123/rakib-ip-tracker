"use strict";

const $ = id => document.getElementById(id);
const state = { page: 1, pages: 1, total: 0, search: "", country: "", device: "", liveTimer: null, timer: null, overviewFlight: false, historyFlight: false, activityFlight: false, refreshTimer: null };

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function setMessage(node, message, type = "info") {
  node.textContent = message;
  node.dataset.state = type;
  node.hidden = !message;
}

async function apiPayload(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...options });
  let payload;
  try { payload = await response.json(); } catch { throw new Error("The service returned an invalid response."); }
  if (response.status === 401) {
    lockConsole("Your admin session expired. Sign in again.");
    throw new Error("Administrator authentication required.");
  }
  if (!response.ok || !payload.success) throw new Error(payload.error?.message || "Request failed.");
  return payload;
}

async function api(url, options = {}) {
  return (await apiPayload(url, options)).data;
}

function lockConsole(message = "") {
  stopLive();
  $("admin-view").hidden = true;
  $("login-view").hidden = false;
  $("logout-button").hidden = true;
  $("admin-password").value = "";
  setMessage($("login-message"), message, message ? "error" : "info");
}

function enableConsole() {
  $("login-view").hidden = true;
  $("admin-view").hidden = false;
  $("logout-button").hidden = false;
  setMessage($("login-message"), "");
  refreshAll();
  startLive();
}

async function checkSession() {
  try {
    const result = await api("/api/admin/auth/status");
    if (result.authenticated) enableConsole();
  } catch {
    lockConsole("Admin session status is unavailable.");
  }
}

$("login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector("button[type=submit]");
  submit.disabled = true;
  setMessage($("login-message"), "Checking credentials…");
  try {
    const response = await fetch("/api/admin/auth/login", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: $("admin-password").value })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error("Sign-in failed. Check the password and try again.");
    $("admin-password").value = "";
    enableConsole();
  } catch (error) {
    setMessage($("login-message"), error.message || "Sign-in failed.", "error");
  } finally {
    submit.disabled = false;
  }
});

$("logout-button").addEventListener("click", async () => {
  stopLive();
  try {
    await fetch("/api/admin/auth/logout", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
  } finally {
    lockConsole("You have signed out.");
  }
});

async function refreshOverview() {
  if (state.overviewFlight || document.hidden || $("admin-view").hidden) return;
  state.overviewFlight = true;
  try {
    const [overview, server, provider] = await Promise.all([
      api("/api/admin/analytics/overview"),
      api("/api/admin/server/health"),
      api("/api/admin/provider/health")
    ]);
    renderOverview(overview);
    $("metric-database").textContent = server.storage === "available" ? "Available" : "Degraded";
    $("metric-requests").textContent = Number(server.telemetry?.requests || 0).toLocaleString();
    $("metric-pageviews").textContent = Number(server.telemetry?.pageViews || 0).toLocaleString();
    const providerText = provider.state === "online" ? "Online" : provider.state === "error" ? "Lookup failed" : "Not checked";
    $("metric-provider").textContent = providerText;
    $("provider-state").textContent = `Provider ${providerText.toLowerCase()}`;
    $("provider-state").dataset.state = provider.state === "online" ? "available" : provider.state === "error" ? "failed" : "unavailable";
    await refreshActivity();
    setMessage($("admin-message"), "");
  } catch (error) {
    setMessage($("admin-message"), `Dashboard refresh failed: ${error.message}`, "error");
  } finally {
    state.overviewFlight = false;
  }
}

async function refreshActivity() {
  if (state.activityFlight || document.hidden || $("admin-view").hidden) return;
  state.activityFlight = true;
  try {
    const [sessions, security, overview] = await Promise.all([
      apiPayload("/api/analytics/sessions?limit=8"),
      apiPayload("/api/analytics/security"),
      apiPayload("/api/analytics/overview")
    ]);
    renderSessions(sessions.data || []);
    renderSecurity(security.data || []);
    $("analytics-summary").textContent = `${Number(overview.activeSessions || 0).toLocaleString()} active sessions · ${Number(overview.last24h?.securityEvents || 0).toLocaleString()} security events in the last 24 hours`;
    const collectedFrom = sessions.collectedFrom ? new Date(sessions.collectedFrom).toLocaleString() : "the V3 storage upgrade";
    $("analytics-window").textContent = "Collected since " + collectedFrom + " · 30-day event retention; earlier events unavailable.";
  } catch (error) {
    $("analytics-window").textContent = "Analytics unavailable: " + error.message;
    $("analytics-summary").textContent = "Session and security counts are unavailable.";
    $("session-list").textContent = "Session analytics could not be loaded.";
    $("security-list").textContent = "Security signals could not be loaded.";
  } finally { state.activityFlight = false; }
}

function renderSessions(sessions) {
  const node = $("session-list");
  if (!sessions.length) { node.innerHTML = '<p class="activity-empty">No sessions collected yet.</p>'; return; }
  node.innerHTML = sessions.map(session => {
    const id = String(session.sessionId || "");
    const lastSeen = session.lastSeen ? new Date(session.lastSeen).toLocaleString() : "Time unavailable";
    return '<article class="activity-row"><div><strong>' + escapeHTML(id.slice(0, 12) || "Session") + '</strong><small>' +
      escapeHTML(session.firstPath || "/") + " · " + Number(session.requestCount || 0).toLocaleString() +
      ' requests</small></div><button class="button button-quiet" type="button" data-session-detail="' + escapeHTML(id) +
      '">Details</button><time>' + escapeHTML(lastSeen) + '</time></article>';
  }).join("");
  node.querySelectorAll("[data-session-detail]").forEach(button => button.addEventListener("click", () => showSessionDetail(button.dataset.sessionDetail)));
}

function renderSecurity(events) {
  const node = $("security-list");
  if (!events.length) { node.innerHTML = '<p class="activity-empty">No security signals collected yet.</p>'; return; }
  node.innerHTML = events.slice(0, 8).map(event => {
    const when = event.createdAt ? new Date(event.createdAt).toLocaleString() : "Time unavailable";
    return '<article class="activity-row"><div><strong>' + escapeHTML(String(event.type || "event").replaceAll("_", " ")) +
      '</strong><small>' + escapeHTML(event.method || "") + " " + escapeHTML(event.path || "/[redacted]") +
      '</small></div><time>' + escapeHTML(when) + '</time></article>';
  }).join("");
}

async function showSessionDetail(id) {
  if (!/^[a-f0-9]{64}$/.test(String(id || ""))) return;
  try {
    const result = await apiPayload("/api/analytics/session/" + encodeURIComponent(id));
    const session = result.session || {};
    const pages = Array.isArray(result.pages) ? result.pages : [];
    const requests = Array.isArray(result.requests) ? result.requests : [];
    const entries = [["Session", String(session.sessionId || "").slice(0, 16)], ["First path", session.firstPath],
      ["Requests", session.requestCount], ["Started", session.createdAt ? new Date(session.createdAt).toLocaleString() : null],
      ["Last activity", session.lastSeen ? new Date(session.lastSeen).toLocaleString() : null], ["Page views", pages.length],
      ["Recorded requests", requests.length], ["Visitor records", Array.isArray(result.visitors) ? result.visitors.length : 0]];
    $("dialog-title").textContent = "Session " + String(session.sessionId || "").slice(0, 8);
    $("dialog-content").innerHTML = '<div class="dialog-grid">' + entries.map(([label, value]) =>
      '<div class="dialog-field"><span>' + escapeHTML(label) + '</span><strong>' + escapeHTML(value ?? "Unavailable") + '</strong></div>'
    ).join("") + pages.map((page, index) => '<div class="dialog-field"><span>Page ' + (index + 1) + '</span><strong>' +
      escapeHTML(page.path) + " · " + escapeHTML(page.duration ?? "Duration unavailable") + ' ms</strong></div>').join("") + '</div>';
    $("visitor-dialog").showModal();
  } catch (error) { setMessage($("admin-message"), "Could not load session: " + error.message, "error"); }
}

function renderOverview(data) {
  $("metric-total").textContent = Number(data.totalVisitors || 0).toLocaleString();
  $("metric-24h").textContent = Number(data.last24h || 0).toLocaleString();
  drawBars("chart-devices", data.devices, "No device data recorded.");
  drawBars("chart-countries", data.countries, "No location data recorded.");
  drawBars("chart-browsers", data.browsers, "No browser data recorded.");
  drawBars("chart-os", data.operatingSystems, "No operating-system data recorded.");
}

function drawBars(id, rows, emptyText) {
  const node = $(id);
  if (!Array.isArray(rows) || !rows.length) {
    node.innerHTML = `<p class="chart-loading">${escapeHTML(emptyText)}</p>`;
    return;
  }
  const max = Math.max(...rows.map(row => Number(row.count) || 0), 1);
  node.innerHTML = rows.slice(0, 8).map(row => {
    const amount = Math.max(0, Number(row.count) || 0);
    return `<div class="bar-row"><span class="bar-label" title="${escapeHTML(row.name)}">${escapeHTML(row.name)}</span><span class="bar-track"><i class="bar-fill" style="width:${Math.round(amount / max * 100)}%"></i></span><strong class="bar-value">${amount.toLocaleString()}</strong></div>`;
  }).join("");
}

function historyQuery() {
  const params = new URLSearchParams({ page: String(state.page), limit: "50", contract: "v3" });
  if (state.search) params.set("search", state.search);
  if (state.country) params.set("country", state.country);
  if (state.device) params.set("device", state.device);
  return params.toString();
}

async function loadHistory() {
  if (state.historyFlight || $("admin-view").hidden) return;
  state.historyFlight = true;
  $("history-state").textContent = "Loading restricted records…";
  try {
    const result = await api(`/api/admin/history?${historyQuery()}`);
    state.pages = Math.max(result.pages || 1, 1);
    state.total = result.total || 0;
    renderHistory(result.data || []);
    renderFilters(result.data || []);
    $("history-state").textContent = result.total ? `${result.total.toLocaleString()} records · full IP details restricted to this session` : "No visitor records found.";
    $("history-page").textContent = `Page ${state.page} of ${state.pages}`;
    $("history-prev").disabled = state.page <= 1;
    $("history-next").disabled = state.page >= state.pages;
  } catch (error) {
    $("history-state").textContent = `History unavailable: ${error.message}`;
  } finally {
    state.historyFlight = false;
  }
}

function fieldValue(geo, name) { return geo?.fields?.[name]?.value || "Unavailable"; }

function renderHistory(records) {
  const list = $("history-list");
  if (!records.length) { list.replaceChildren(); return; }
  list.innerHTML = records.map(record => {
    const place = [fieldValue(record.geo, "city"), fieldValue(record.geo, "country")].filter(value => value !== "Unavailable").join(", ") || "Location unavailable";
    const device = [record.device?.brand, record.device?.model, record.device?.category].filter(Boolean).join(" ") || "Device unavailable";
    const when = record.timestamp ? new Date(record.timestamp).toLocaleString() : "Time unavailable";
    return `<article class="history-item"><strong class="history-ip">${escapeHTML(record.ip)}</strong><div class="history-description"><strong>${escapeHTML(place)} · ${escapeHTML(device)}</strong><span>${escapeHTML([record.browser?.name, record.os?.name].filter(Boolean).join(" · ") || "Software details unavailable")}</span></div><time class="history-date">${escapeHTML(when)}</time><button class="button button-quiet" type="button" data-detail="${escapeHTML(record.id)}">Details</button></article>`;
  }).join("");
  list.querySelectorAll("[data-detail]").forEach(button => button.addEventListener("click", () => showDetail(button.dataset.detail)));
}

function renderFilters(records) {
  const update = (id, values, label, selected) => {
    const select = $(id);
    const options = [...new Set(values.filter(value => value && value !== "Unavailable"))].sort();
    select.replaceChildren(new Option(label, ""));
    for (const value of options) select.add(new Option(value, value));
    if (options.includes(selected)) select.value = selected;
  };
  update("history-country", records.map(record => fieldValue(record.geo, "country")), "All locations", state.country);
  update("history-device", records.map(record => record.device?.category), "All devices", state.device);
}

async function showDetail(id) {
  try {
    const record = await api(`/api/admin/history/${encodeURIComponent(id)}`);
    const entries = [
      ["Full IP", record.ip], ["Masked IP", record.maskedIP],
      ["ISP", fieldValue(record.geo, "isp")], ["Organization", fieldValue(record.geo, "organization")],
      ["ASN", fieldValue(record.geo, "asn")], ["Country", fieldValue(record.geo, "country")],
      ["Region", fieldValue(record.geo, "region")], ["City", fieldValue(record.geo, "city")],
      ["Postal", fieldValue(record.geo, "postal")], ["Timezone", fieldValue(record.geo, "timezone")],
      ["Coordinates", `${fieldValue(record.geo, "latitude")}, ${fieldValue(record.geo, "longitude")}`],
      ["Device", [record.device?.brand, record.device?.model, record.device?.category].filter(Boolean).join(" ")],
      ["Operating system", [record.os?.name, record.os?.version].filter(Boolean).join(" ")],
      ["Browser", [record.browser?.name, record.browser?.version].filter(Boolean).join(" ")],
      ["User-Agent", record.userAgent], ["Language", record.language], ["Referrer", record.referrer], ["Timestamp", record.timestamp]
    ];
    $("dialog-title").textContent = `Visitor ${record.id.slice(-8)}`;
    $("dialog-content").innerHTML = `<div class="dialog-grid">${entries.map(([label, value]) => `<div class="dialog-field"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value || "Unavailable")}</strong></div>`).join("")}</div>`;
    $("visitor-dialog").showModal();
  } catch (error) {
    setMessage($("admin-message"), `Could not load record: ${error.message}`, "error");
  }
}

function scheduleRefresh() {
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(() => { refreshOverview(); loadHistory(); }, 700);
}

function startLive() {
  stopLive();
  pollLive();
}

function stopLive() {
  clearTimeout(state.liveTimer);
  state.liveTimer = null;
  clearTimeout(state.refreshTimer);
}

async function pollLive() {
  try {
    await apiPayload("/api/admin/live");
    $("live-state").innerHTML = "<i></i><b>Live updates · polling</b>";
    $("live-state").dataset.state = "available";
    await Promise.all([refreshOverview(), loadHistory()]);
  } catch (error) {
    $("live-state").innerHTML = "<i></i><b>Live refresh unavailable</b>";
    $("live-state").dataset.state = "unavailable";
    if (error.message.includes("authentication")) return;
  } finally {
    if (!document.hidden && !$("admin-view").hidden) state.liveTimer = setTimeout(pollLive, 20_000);
  }
}

async function refreshAll() {
  await Promise.all([refreshOverview(), loadHistory()]);
}

async function exportRecords(format) {
  try {
    const response = await fetch(`/api/admin/export?format=${format}`, { cache: "no-store", credentials: "same-origin" });
    if (response.status === 401) { lockConsole("Your admin session expired. Sign in again."); return; }
    if (!response.ok) throw new Error("Export unavailable.");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `rakib-ip-history.${format}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { setMessage($("admin-message"), error.message, "error"); }
}

$("history-search").addEventListener("input", () => {
  state.search = $("history-search").value.trim().slice(0, 80);
  state.page = 1;
  clearTimeout(state.timer);
  state.timer = setTimeout(loadHistory, 280);
});
$("history-country").addEventListener("change", () => { state.country = $("history-country").value; state.page = 1; loadHistory(); });
$("history-device").addEventListener("change", () => { state.device = $("history-device").value; state.page = 1; loadHistory(); });
$("history-prev").addEventListener("click", () => { state.page = Math.max(1, state.page - 1); loadHistory(); });
$("history-next").addEventListener("click", () => { state.page = Math.min(state.pages, state.page + 1); loadHistory(); });

document.querySelectorAll("[data-clear]").forEach(button => button.addEventListener("click", async () => {
  const type = button.dataset.clear;
  const phrase = type === "history" ? "CLEAR ALL HISTORY" : `CLEAR ${type.toUpperCase()}`;
  if (window.prompt(`This permanently removes matching visitor records. Type ${phrase} to continue.`) !== phrase) return;
  button.disabled = true;
  setMessage($("control-message"), "Applying retention action…");
  try {
    const result = await api("/api/admin/clear-data", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type })
    });
    setMessage($("control-message"), `${Number(result.deleted).toLocaleString()} records removed.`, "success");
    state.page = 1;
    await Promise.all([loadHistory(), refreshOverview()]);
  } catch (error) {
    setMessage($("control-message"), `History update failed: ${error.message}`, "error");
  } finally {
    button.disabled = false;
  }
}));
$("export-csv").addEventListener("click", () => exportRecords("csv"));
$("export-json").addEventListener("click", () => exportRecords("json"));
$("refresh-admin").addEventListener("click", refreshAll);
$("dialog-close").addEventListener("click", () => $("visitor-dialog").close());
$("visitor-dialog").addEventListener("click", event => { if (event.target === $("visitor-dialog")) $("visitor-dialog").close(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("admin-view").hidden) refreshAll(); });
window.addEventListener("pagehide", stopLive);
setInterval(() => { if (!document.hidden && !$("admin-view").hidden) refreshOverview(); }, 60_000);
checkSession();
