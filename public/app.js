"use strict";

const byId = id => document.getElementById(id);
const placeholder = "Unavailable";
let profileMap;
let profileMarker;

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function displayField(item, { failed = false } = {}) {
  if (!item || item.status === "unsupported") return "Unsupported";
  if (item.status === "failed" || failed) return "Lookup failed";
  if (item.value === null || item.value === undefined || item.value === "") return placeholder;
  return String(item.value);
}

function collectClientSignals() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  let timezone = null;
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch {}
  return {
    screen: { width: screen.width, height: screen.height },
    viewport: { width: innerWidth, height: innerHeight },
    language: navigator.language || null,
    languages: navigator.languages || [],
    timezone,
    platform: navigator.userAgentData?.platform || navigator.platform || null,
    colorScheme: typeof matchMedia === "function"
      ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : "no-preference",
    online: navigator.onLine,
    touchPoints: navigator.maxTouchPoints ?? 0,
    touchSupport: navigator.maxTouchPoints > 0 || "ontouchstart" in window,
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    connection: connection ? {
      type: connection.type || null,
      effectiveType: connection.effectiveType || null,
      downlink: connection.downlink ?? null,
      rtt: connection.rtt ?? null,
      saveData: connection.saveData ?? null
    } : null
  };
}

function setState(node, state, text) {
  if (!node) return;
  node.textContent = text;
  node.dataset.state = state;
}

function flagFromCode(code) {
  if (!/^[A-Z]{2}$/.test(code || "")) return "◌";
  return String.fromCodePoint(...[...code].map(char => 127397 + char.charCodeAt(0)));
}

function geoValue(geo, fieldName) {
  return geo?.fields?.[fieldName] || null;
}

function renderProfile(data) {
  const geo = data.geo || {};
  const device = data.device || {};
  const fields = geo.fields || {};
  byId("public-ip").textContent = data.ip || placeholder;

  for (const name of ["isp", "organization", "asn", "region", "city", "postal", "timezone"]) {
    const node = document.querySelector(`[data-geo="${name}"]`);
    node.textContent = displayField(geoValue(geo, name), { failed: geo.status === "failed" });
    node.dataset.state = geoValue(geo, name)?.status || geo.status || "unavailable";
  }

  const coordinates = [fields.latitude, fields.longitude];
  const lat = coordinates[0]?.value;
  const lon = coordinates[1]?.value;
  const coordinateNode = document.querySelector('[data-geo="coordinates"]');
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && coordinates.every(item => item.status === "available")) {
    coordinateNode.textContent = `${lat.toFixed(4)}, ${lon.toFixed(4)} · approximate`;
    const mapLink = byId("map-link");
    mapLink.href = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lon)}#map=11/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}`;
    mapLink.hidden = false;
    if (window.L) {
      const point = [lat, lon];
      const mapNode = byId("profile-map");
      mapNode.hidden = false;
      if (!profileMap) {
        profileMap = L.map(mapNode, { scrollWheelZoom: false, zoomControl: true }).setView(point, 9);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(profileMap);
        profileMarker = L.marker(point).addTo(profileMap);
      } else {
        profileMap.setView(point, 9);
        profileMarker.setLatLng(point);
        profileMap.invalidateSize();
      }
    }
  } else {
    coordinateNode.textContent = displayField(fields.latitude, { failed: geo.status === "failed" });
    byId("map-link").hidden = true;
    byId("profile-map").hidden = true;
  }

  const country = geoValue(geo, "country");
  const countryCode = geoValue(geo, "countryCode");
  const city = geoValue(geo, "city");
  const region = geoValue(geo, "region");
  const locationName = country?.value || placeholder;
  byId("location-name").textContent = locationName;
  byId("location-code").textContent = displayField(countryCode, { failed: geo.status === "failed" });
  byId("country-flag").textContent = flagFromCode(countryCode?.value);
  byId("country-flag").setAttribute("aria-label", countryCode?.value ? `${locationName} flag` : "Country flag unavailable");
  byId("location-context").textContent = [city?.value, region?.value].filter(Boolean).length
    ? [city?.value, region?.value].filter(Boolean).join(" · ") + " · Approximate IP location"
    : "Location is approximate and may be unavailable.";

  const geoDisplayStatus = geo.status === "available" ? "Available" : geo.status === "partial" ? "Partial" : geo.status === "failed" ? "Lookup failed" : "Unavailable";
  setState(byId("network-status"), geo.status || "unavailable", data.ip ? `IP · ${geoDisplayStatus}` : "Unavailable");
  setState(byId("device-status"), device.status || "partial", device.status === "available" ? "Available" : device.status === "partial" ? "Partial" : "Unavailable");
  byId("device-name").textContent = [device.brand, device.model].filter(Boolean).join(" ") || device.category || placeholder;
  byId("device-category").textContent = device.category || "Category unavailable";
  byId("os-value").textContent = detailValue(data.os);
  byId("browser-value").textContent = detailValue(data.browser);
  byId("engine-value").textContent = detailValue(data.engine);
  byId("ua-value").textContent = data.userAgent || "Not shared";

  renderClient(data.client || {});
  byId("profile-skeleton").hidden = true;
  byId("profile-content").hidden = false;
  setState(byId("profile-live"), "available", "Profile updated");
}

function detailValue(value) {
  if (!value) return placeholder;
  const parts = [value.name, value.version].filter(Boolean);
  return parts.length ? parts.join(" ") : value.status === "unavailable" ? "Unavailable" : "Unsupported";
}

function clientValue(value) {
  if (value === null || value === undefined || value === "") return "Unsupported";
  return String(value);
}

function renderClient(client) {
  const values = {
    screen: client.screen?.width && client.screen?.height ? `${client.screen.width} × ${client.screen.height}` : null,
    viewport: client.viewport?.width && client.viewport?.height ? `${client.viewport.width} × ${client.viewport.height}` : null,
    language: client.language,
    timezone: client.timezone,
    platform: client.platform,
    colorScheme: client.colorScheme,
    connection: client.connection && [client.connection.effectiveType, client.connection.type, client.connection.downlink, client.connection.rtt].some(value => value !== null && value !== undefined)
      ? [client.connection.effectiveType, client.connection.type].filter(Boolean).join(" · ") || `${client.connection.downlink} Mbps`
      : null,
    online: client.online === null ? null : client.online ? "Online" : "Offline",
    touch: client.touchSupport === null ? null : client.touchSupport ? `${client.touchPoints ?? 0} touch points` : "Not supported",
    hardwareConcurrency: client.hardwareConcurrency ? `${client.hardwareConcurrency} threads` : null
  };
  for (const [key, value] of Object.entries(values)) {
    const node = document.querySelector(`[data-client="${key}"]`);
    node.textContent = clientValue(value);
  }
}

function showMessage(message, state = "info") {
  const node = byId("profile-message");
  node.textContent = message;
  node.dataset.state = state;
  node.hidden = false;
}

async function loadProfile() {
  const refresh = byId("refresh-profile");
  refresh.disabled = true;
  byId("profile-message").hidden = true;
  setState(byId("profile-live"), "loading", "Refreshing profile");
  try {
    const response = await fetch("/api/public/intelligence", {
      method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client: collectClientSignals() })
    });
    const payload = await response.json();
    if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error?.message || "Profile service unavailable");
    renderProfile(payload.data);
  } catch {
    byId("profile-skeleton").hidden = true;
    byId("profile-content").hidden = false;
    byId("public-ip").textContent = placeholder;
    setState(byId("profile-live"), "failed", "Profile unavailable");
    showMessage("The profile service could not be reached. Browser-only details remain available below; try refreshing in a moment.", "error");
    renderClient(collectClientSignals());
  } finally {
    refresh.disabled = false;
  }
}

byId("refresh-profile").addEventListener("click", loadProfile);
byId("nav-toggle").addEventListener("click", () => {
  const expanded = byId("nav-toggle").getAttribute("aria-expanded") === "true";
  byId("nav-toggle").setAttribute("aria-expanded", String(!expanded));
  byId("nav-toggle").setAttribute("aria-label", expanded ? "Open navigation" : "Close navigation");
  document.body.classList.toggle("nav-open", !expanded);
});
document.querySelectorAll("#main-navigation a").forEach(link => link.addEventListener("click", () => {
  byId("nav-toggle").setAttribute("aria-expanded", "false");
  byId("nav-toggle").setAttribute("aria-label", "Open navigation");
  document.body.classList.remove("nav-open");
}));
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    byId("nav-toggle").setAttribute("aria-expanded", "false");
    byId("nav-toggle").setAttribute("aria-label", "Open navigation");
    document.body.classList.remove("nav-open");
  }
});
byId("copy-ip").addEventListener("click", async () => {
  const value = byId("public-ip").textContent;
  if (!value || value === placeholder) return;
  try {
    await navigator.clipboard.writeText(value);
    showMessage("Public IP copied to clipboard.", "success");
  } catch {
    showMessage("Clipboard access is unavailable in this browser.", "error");
  }
});
window.addEventListener("online", () => setState(byId("profile-live"), "available", "Connection restored"));
window.addEventListener("offline", () => showMessage("Your device is offline. Profile refresh may fail until the connection returns.", "error"));
byId("footer-year").textContent = new Date().getFullYear();
renderClient(collectClientSignals());
loadProfile();
