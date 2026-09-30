let map = null;
let marker = null;
let liveSource = null;

/* =========================================================
   HELPERS
========================================================= */

function $(id) {
  return document.getElementById(id);
}

function safe(value, fallback = "Unknown") {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return fallback;
  }

  return String(value);
}

function formatDate(value) {
  if (!value) return "Unknown";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleString();
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =========================================================
   BROWSER / DEVICE SIGNALS
========================================================= */

function signalHash(value) {
  let hash = 2166136261;

  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }

  return (hash >>> 0).toString(16);
}

function getWebGLInfo() {
  try {
    const canvas = document.createElement("canvas");

    const gl =
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");

    if (!gl) return {};

    const debug =
      gl.getExtension("WEBGL_debug_renderer_info");

    return {
      vendor: debug
        ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)
        : gl.getParameter(gl.VENDOR),

      renderer: debug
        ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),

      version: gl.getParameter(gl.VERSION)
    };
  } catch {
    return {};
  }
}

function getCanvasHash() {
  try {
    const canvas =
      document.createElement("canvas");

    canvas.width = 280;
    canvas.height = 60;

    const ctx =
      canvas.getContext("2d");

    ctx.font = "16px Arial";
    ctx.fillStyle = "#36e6ff";
    ctx.fillRect(10, 5, 100, 20);

    ctx.fillStyle = "#ffffff";
    ctx.fillText(
      "Rakib Intelligence",
      12,
      35
    );

    return signalHash(
      canvas.toDataURL()
    );
  } catch {
    return "";
  }
}

function collectClientSignals() {
  const nav = navigator;
  const scr = window.screen || {};

  const connection =
    nav.connection ||
    nav.mozConnection ||
    nav.webkitConnection ||
    {};

  return {
    screen: {
      width: scr.width || null,
      height: scr.height || null,
      availWidth: scr.availWidth || null,
      availHeight: scr.availHeight || null
    },

    viewport: {
      width: window.innerWidth || null,
      height: window.innerHeight || null
    },

    pixelRatio:
      window.devicePixelRatio || null,

    colorDepth:
      scr.colorDepth || null,

    touchPoints:
      nav.maxTouchPoints ?? null,

    touchSupport:
      "ontouchstart" in window ||
      (nav.maxTouchPoints || 0) > 0,

    hardwareConcurrency:
      nav.hardwareConcurrency ?? null,

    deviceMemory:
      nav.deviceMemory ?? null,

    language:
      nav.language || "",

    languages:
      Array.isArray(nav.languages)
        ? nav.languages
        : [],

    timezone:
      Intl.DateTimeFormat()
        .resolvedOptions()
        .timeZone || "",

    timezoneOffset:
      new Date().getTimezoneOffset(),

    cookiesEnabled:
      !!nav.cookieEnabled,

    doNotTrack:
      nav.doNotTrack || "",

    online:
      nav.onLine !== false,

    platform:
      nav.platform || "",

    connection: {
      effectiveType:
        connection.effectiveType || "",
      type:
        connection.type || "",
      downlink:
        connection.downlink ?? null,
      rtt:
        connection.rtt ?? null,
      saveData:
        !!connection.saveData
    },

    webgl:
      getWebGLInfo(),

    canvasHash:
      getCanvasHash()
  };
}

/* =========================================================
   CURRENT VISITOR
========================================================= */


async function loadCurrentVisitor() {
  try {
    const response = await fetch(
      "/api/track",
      {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          client: collectClientSignals()
        })
      }
    );

    const result = await response.json();

    if (!result.success) {
      throw new Error("Tracking failed");
    }

    renderCurrent(result.visitor);
  } catch (error) {
    console.error(error);

    $("currentIP").textContent = "Unavailable";
  }
}

function renderCurrent(visitor) {

  const geo = visitor.geo || {};
  const device = visitor.device || {};
  const os = visitor.os || {};
  const browser = visitor.browser || {};
  const engine = visitor.engine || {};
  const security = visitor.security || {};
  const client = visitor.client || {};

  $("currentIP").textContent =
    safe(visitor.ip, "Unavailable");

  $("location").textContent =
    `${safe(geo.city)}, ${safe(geo.country)}`;

  $("region").textContent =
    safe(geo.region);

  $("isp").textContent =
    safe(geo.isp);

  $("asn").textContent =
    safe(geo.asn);

  let deviceText = safe(device.type);

  if (
    device.vendor &&
    device.vendor !== "Unknown"
  ) {
    deviceText += ` • ${device.vendor}`;
  }

  if (
    device.model &&
    device.model !== "Unknown"
  ) {
    deviceText += ` ${device.model}`;
  }

  $("device").textContent = deviceText;

  $("os").textContent =
    `${safe(os.name)} ${safe(os.version, "")}`.trim();

  $("browser").textContent =
    `${safe(browser.name)} ${safe(browser.version, "")}`.trim();

  $("engine").textContent =
    `${safe(engine.name)} ${safe(engine.version, "")}`.trim();

  renderSecurity(security);
  renderClientSignals(client);

  $("country").textContent =
    safe(geo.country);

  $("countryCode").textContent =
    safe(geo.countryCode);

  $("postal").textContent =
    safe(geo.postal);

  $("timezone").textContent =
    safe(geo.timezone);

  $("organization").textContent =
    safe(geo.organization);

  $("browserVersion").textContent =
    safe(browser.version);

  $("userAgent").textContent =
    safe(visitor.userAgent);

  if (
    typeof geo.latitude === "number" &&
    typeof geo.longitude === "number"
  ) {
    $("coordinates").textContent =
      `${geo.latitude.toFixed(5)}, ${geo.longitude.toFixed(5)}`;

    loadMap(
      geo.latitude,
      geo.longitude,
      `${safe(geo.city)}, ${safe(geo.country)}`
    );
  } else {
    $("coordinates").textContent =
      "Location unavailable";
  }
}

/* =========================================================
   SECURITY / DEVICE SIGNAL UI
========================================================= */

function renderSecurity(security) {
  const values = {
    vpnStatus: security.vpn,
    proxyStatus: security.proxy,
    torStatus: security.tor,
    hostingStatus: security.hosting
  };

  Object.entries(values).forEach(
    ([id, detected]) => {
      const el = $(id);

      if (!el) return;

      el.textContent =
        detected
          ? "DETECTED"
          : "NOT DETECTED";

      el.classList.toggle(
        "risk-detected",
        !!detected
      );
    }
  );
}

function renderClientSignals(client) {
  const set = (id, value) => {
    const el = $(id);

    if (el) {
      el.textContent =
        safe(value, "Unavailable");
    }
  };

  set(
    "screenInfo",
    client.screen?.width
      ? `${client.screen.width} × ${client.screen.height}`
      : null
  );

  set(
    "viewportInfo",
    client.viewport?.width
      ? `${client.viewport.width} × ${client.viewport.height}`
      : null
  );

  set(
    "pixelInfo",
    client.pixelRatio
      ? `${client.pixelRatio}x`
      : null
  );

  set(
    "touchInfo",
    client.touchSupport
      ? `YES • ${safe(client.touchPoints, 0)}`
      : "NO"
  );

  set(
    "cpuInfo",
    client.hardwareConcurrency
      ? `${client.hardwareConcurrency} threads`
      : null
  );

  set(
    "memoryInfo",
    client.deviceMemory
      ? `${client.deviceMemory} GB`
      : null
  );

  set(
    "networkInfo",
    client.connection?.effectiveType ||
      client.connection?.type
  );

  set(
    "webglInfo",
    client.webgl?.renderer
  );
}

/* =========================================================
   MAP
========================================================= */


function loadMap(lat, lon, label) {

  if (!map) {

    map = L.map("map", {
      zoomControl: true
    }).setView(
      [lat, lon],
      10
    );

    L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
      }
    ).addTo(map);

  } else {

    map.setView(
      [lat, lon],
      10
    );

    if (marker) {
      marker.remove();
    }
  }

  marker = L.marker(
    [lat, lon]
  )
    .addTo(map)
    .bindPopup(
      `<b>${escapeHTML(label)}</b><br>Approximate IP location`
    )
    .openPopup();
}

/* =========================================================
   PREVIEW HISTORY
========================================================= */

async function loadPreview() {

  const container = $("previewHistory");

  try {

    const response = await fetch(
      "/api/history-preview",
      {
        cache: "no-store"
      }
    );

    const result = await response.json();

    if (!result.success) {
      throw new Error("Preview failed");
    }

    if (!result.data.length) {

      container.innerHTML = `
        <div class="preview-item">
          <div class="preview-main">
            No visitor history yet
          </div>
        </div>
      `;

      return;
    }

    container.innerHTML =
      result.data
        .map(item => {

          const device =
            item.device?.type || "Unknown";

          const browser =
            item.browser?.name || "Unknown";

          return `
            <div class="preview-item">

              <div>
                <div class="preview-ip">
                  ${escapeHTML(item.ip)}
                </div>

                <div class="preview-sub">
                  MASKED IP
                </div>
              </div>

              <div>
                <div class="preview-main">
                  ${escapeHTML(item.city)}
                </div>

                <div class="preview-sub">
                  ${escapeHTML(item.country)}
                </div>
              </div>

              <div>
                <div class="preview-main">
                  ${escapeHTML(device)}
                </div>

                <div class="preview-sub">
                  ${escapeHTML(browser)}
                </div>
              </div>

              <div>
                <div class="preview-main">
                  ${escapeHTML(
                    formatDate(item.timestamp)
                  )}
                </div>

                <div class="preview-sub">
                  RECORDED
                </div>
              </div>

            </div>
          `;
        })
        .join("");

  } catch (error) {

    console.error(error);

    container.innerHTML = `
      <div class="preview-item">
        Unable to load visitor preview.
      </div>
    `;
  }
}

/* =========================================================
   LOGIN MODAL
========================================================= */

function openModal() {
  $("loginModal").classList.remove("hidden");

  $("passwordInput").value = "";

  $("loginError").textContent = "";

  setTimeout(() => {
    $("passwordInput").focus();
  }, 100);
}

function closeModal() {
  $("loginModal").classList.add("hidden");
}

async function login() {

  const password =
    $("passwordInput").value;

  if (!password) {
    $("loginError").textContent =
      "Enter the password.";
    return;
  }

  $("loginSubmit").disabled = true;

  try {

    const response = await fetch(
      "/api/live/login",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          password
        })
      }
    );

    const result =
      await response.json();

    if (!response.ok || !result.success) {

      $("loginError").textContent =
        "Incorrect password.";

      return;
    }

    closeModal();

    await unlockAdmin();

  } catch (error) {

    $("loginError").textContent =
      "Login failed. Try again.";

  } finally {

    $("loginSubmit").disabled = false;
  }
}

/* =========================================================
   ADMIN
========================================================= */

async function checkAuth() {

  try {

    const response =
      await fetch("/api/live/status");

    const result =
      await response.json();

    if (result.authenticated) {
      await unlockAdmin();
    }

  } catch {}
}

async function unlockAdmin() {

  $("adminPanel").classList.remove("hidden");

  await Promise.all([
    loadAdminHistory(),
    loadStats()
  ]);

  startLiveStream();

  $("adminPanel").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

async function loadStats() {

  try {

    const response =
      await fetch(
        "/api/stats",
        {
          cache: "no-store"
        }
      );

    if (response.status === 401) {
      return;
    }

    const result =
      await response.json();

    if (!result.success) {
      return;
    }

    $("statTotal").textContent =
      result.total;

    $("statUnique").textContent =
      result.uniqueIPs;

    $("stat24").textContent =
      result.last24h;

  } catch (error) {

    console.error(error);

  }
}

/* =========================================================
   ADMIN HISTORY
========================================================= */

async function loadAdminHistory() {

  const container =
    $("adminHistory");

  try {

    const response =
      await fetch(
        "/api/history",
        {
          cache: "no-store"
        }
      );

    if (response.status === 401) {
      $("adminPanel").classList.add("hidden");
      return;
    }

    const result =
      await response.json();

    if (!result.success) {
      throw new Error("History failed");
    }

    if (!result.data.length) {

      container.innerHTML = `
        <div class="admin-row">
          No records found.
        </div>
      `;

      return;
    }

    adminRecords = result.data || [];

    updateHistoryFilterOptions(adminRecords);

    container.innerHTML =
      adminRecords
        .map(renderAdminRecord)
        .join("");

    initializeHistoryMaps(container);

  } catch (error) {

    console.error(error);

    container.innerHTML = `
      <div class="admin-row">
        Unable to load full history.
      </div>
    `;
  }
}

function renderAdminRecord(item) {
  const geo = item.geo || {};
  const device = item.device || {};
  const os = item.os || {};
  const browser = item.browser || {};
  const engine = item.engine || {};
  const security = item.security || {};
  const client = item.client || {};

  const hasCoords =
    typeof geo.latitude === "number" &&
    typeof geo.longitude === "number";

  const safeId = String(
    item.id ||
    Math.random().toString(36).slice(2)
  ).replace(/[^a-zA-Z0-9_-]/g, "");

  const mapId = `history-map-${safeId}`;

  return `
    <div class="admin-row">

      <div class="admin-row-top">

        <div>
          <div class="admin-ip">
            ${escapeHTML(item.ip)}
          </div>

          <div class="preview-sub">
            ${escapeHTML(safe(geo.city))},
            ${escapeHTML(safe(geo.country))}
          </div>
        </div>

        <div class="admin-time">
          ${escapeHTML(formatDate(item.timestamp))}
        </div>

      </div>

      <div class="security-grid">

        <div class="security-card">
          <span>VPN</span>
          <strong class="${security.vpn ? "risk-detected" : ""}">
            ${security.vpn ? "DETECTED" : "NOT DETECTED"}
          </strong>
        </div>

        <div class="security-card">
          <span>PROXY</span>
          <strong class="${security.proxy ? "risk-detected" : ""}">
            ${security.proxy ? "DETECTED" : "NOT DETECTED"}
          </strong>
        </div>

        <div class="security-card">
          <span>TOR</span>
          <strong class="${security.tor ? "risk-detected" : ""}">
            ${security.tor ? "DETECTED" : "NOT DETECTED"}
          </strong>
        </div>

        <div class="security-card">
          <span>HOSTING</span>
          <strong class="${security.hosting ? "risk-detected" : ""}">
            ${security.hosting ? "DETECTED" : "NOT DETECTED"}
          </strong>
        </div>

      </div>

      <div class="history-location">

        <div class="history-location-info">

          <div class="mini-label">
            APPROXIMATE GEOLOCATION
          </div>

          <div class="history-location-title">
            ${escapeHTML(safe(geo.city))},
            ${escapeHTML(safe(geo.region))}
          </div>

          <div class="history-location-country">
            ${escapeHTML(safe(geo.country))}
            ${
              geo.countryCode
                ? ` • ${escapeHTML(geo.countryCode)}`
                : ""
            }
          </div>

          <div class="history-coordinates">
            ${
              hasCoords
                ? `${geo.latitude.toFixed(5)}, ${geo.longitude.toFixed(5)}`
                : "Coordinates unavailable"
            }
          </div>

          ${
            hasCoords
              ? `
                <div class="location-actions">

                  <button
                    class="small-action"
                    onclick="openVisitorMap(${geo.latitude}, ${geo.longitude})"
                  >
                    🗺️ Open Map
                  </button>

                  <button
                    class="small-action"
                    onclick="shareVisitorLocation(${geo.latitude}, ${geo.longitude}, '${safe(geo.city)}, ${safe(geo.country)}')"
                  >
                    📤 Share
                  </button>

                  <button
                    class="small-action"
                    onclick="copyVisitorLocation(${geo.latitude}, ${geo.longitude})"
                  >
                    📋 Copy
                  </button>

                </div>
              `
              : ""
          }

        </div>

        <div
          id="${escapeHTML(mapId)}"
          class="history-map"
          data-lat="${hasCoords ? geo.latitude : ""}"
          data-lon="${hasCoords ? geo.longitude : ""}"
          data-label="${escapeHTML(
            `${safe(geo.city)}, ${safe(geo.country)}`
          )}"
        >
          ${
            hasCoords
              ? ""
              : `<div class="map-unavailable">
                   📍 Location unavailable
                 </div>`
          }
        </div>

      </div>

      <div class="admin-grid">

        <div>
          <span>ISP</span>
          <strong>
            ${escapeHTML(safe(geo.isp))}
          </strong>
        </div>

        <div>
          <span>ASN</span>
          <strong>
            ${escapeHTML(safe(geo.asn))}
          </strong>
        </div>

        <div>
          <span>Device</span>
          <strong>
            ${escapeHTML(
              `${safe(device.type)}
               ${device.vendor || ""}
               ${device.model || ""}`
            )}
          </strong>
        </div>

        <div>
          <span>OS</span>
          <strong>
            ${escapeHTML(
              `${safe(os.name)}
               ${os.version || ""}`
            )}
          </strong>
        </div>

        <div>
          <span>Browser</span>
          <strong>
            ${escapeHTML(
              `${safe(browser.name)}
               ${browser.version || ""}`
            )}
          </strong>
        </div>

        <div>
          <span>Region</span>
          <strong>
            ${escapeHTML(safe(geo.region))}
          </strong>
        </div>

        <div>
          <span>Postal</span>
          <strong>
            ${escapeHTML(safe(geo.postal))}
          </strong>
        </div>

        <div>
          <span>Timezone</span>
          <strong>
            ${escapeHTML(safe(geo.timezone))}
          </strong>
        </div>

        <div>
          <span>Organization</span>
          <strong>
            ${escapeHTML(safe(geo.organization))}
          </strong>
        </div>

        <div>
          <span>Coordinates</span>
          <strong>
            ${
              hasCoords
                ? `${geo.latitude}, ${geo.longitude}`
                : "Unavailable"
            }
          </strong>
        </div>

        <div>
          <span>Engine</span>
          <strong>
            ${escapeHTML(
              `${safe(engine.name)}
               ${engine.version || ""}`
            )}
          </strong>
        </div>

        <div>
          <span>Country Code</span>
          <strong>
            ${escapeHTML(safe(geo.countryCode))}
          </strong>
        </div>

      </div>

      <div
        class="user-agent"
        style="margin-top:12px"
      >
        ${escapeHTML(safe(item.userAgent))}
      </div>

    </div>
  `;
}

/* =========================================================
   HISTORY MAPS
========================================================= */

function initializeHistoryMaps(root = document) {
  const maps = root.querySelectorAll(
    ".history-map[data-lat][data-lon]"
  );

  maps.forEach(element => {

    if (element.dataset.initialized === "true") {
      return;
    }

    const lat = Number(element.dataset.lat);
    const lon = Number(element.dataset.lon);
    const label =
      element.dataset.label ||
      "Approximate location";

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    ) {
      return;
    }

    try {

      const historyMap = L.map(element, {
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: false
      }).setView(
        [lat, lon],
        10
      );

      L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap"
        }
      ).addTo(historyMap);

      L.marker([lat, lon])
        .addTo(historyMap)
        .bindPopup(
          `<b>${escapeHTML(label)}</b><br>` +
          `Approximate IP location`
        );

      element.dataset.initialized = "true";

    } catch (error) {
      console.error(
        "History map error:",
        error
      );
    }
  });
}


function updateHistoryFilterOptions(records) {
  const country = $("historyCountry");
  const device = $("historyDevice");

  if (!country || !device) return;

  const countries = [
    ...new Set(
      records
        .map(x => x.geo?.country)
        .filter(Boolean)
    )
  ].sort();

  const devices = [
    ...new Set(
      records
        .map(x => x.device?.type)
        .filter(Boolean)
    )
  ].sort();

  country.innerHTML =
    `<option value="">All countries</option>` +
    countries
      .map(x =>
        `<option value="${escapeHTML(
          x.toLowerCase()
        )}">
          ${escapeHTML(x)}
        </option>`
      )
      .join("");

  device.innerHTML =
    `<option value="">All devices</option>` +
    devices
      .map(x =>
        `<option value="${escapeHTML(
          x.toLowerCase()
        )}">
          ${escapeHTML(x)}
        </option>`
      )
      .join("");
}

/* =========================================================
   LOCATION ACTIONS
========================================================= */


function openVisitorMap(lat, lon) {
  const url =
    `https://www.google.com/maps?q=${encodeURIComponent(
      `${lat},${lon}`
    )}`;

  window.open(
    url,
    "_blank",
    "noopener,noreferrer"
  );
}

async function copyVisitorLocation(lat, lon) {
  const value = `${lat}, ${lon}`;

  try {
    await navigator.clipboard.writeText(value);
    showToast("Coordinates copied");
  } catch {
    window.prompt(
      "Copy coordinates:",
      value
    );
  }
}

async function shareVisitorLocation(lat, lon, label) {
  const text =
    `📍 Visitor Location\n` +
    `${label}\n` +
    `Coordinates: ${lat}, ${lon}\n` +
    `https://www.google.com/maps?q=${lat},${lon}`;

  try {
    if (navigator.share) {
      await navigator.share({
        title: "Visitor Location",
        text
      });
    } else {
      await navigator.clipboard.writeText(text);
      showToast("Location details copied");
    }
  } catch {}
}

function showToast(message) {
  let toast = $("appToast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "appToast";
    toast.className = "app-toast";
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(window.__toastTimer);

  window.__toastTimer = setTimeout(
    () => toast.classList.remove("show"),
    1800
  );
}

/* =========================================================
   HISTORY FILTER
========================================================= */

let adminRecords = [];

function applyHistoryFilters() {
  const search =
    ($("historySearch")?.value || "")
      .toLowerCase()
      .trim();

  const country =
    ($("historyCountry")?.value || "")
      .toLowerCase();

  const device =
    ($("historyDevice")?.value || "")
      .toLowerCase();

  const vpn =
    $("historyVPN")?.value || "";

  const filtered =
    adminRecords.filter(item => {

      const geo = item.geo || {};
      const dev = item.device || {};
      const sec = item.security || {};

      const text = [
        item.ip,
        geo.city,
        geo.country,
        geo.region,
        geo.isp,
        geo.asn,
        geo.organization,
        dev.type,
        dev.vendor,
        dev.model,
        item.userAgent
      ]
        .join(" ")
        .toLowerCase();

      if (
        search &&
        !text.includes(search)
      ) {
        return false;
      }

      if (
        country &&
        String(geo.country || "")
          .toLowerCase() !== country
      ) {
        return false;
      }

      if (
        device &&
        String(dev.type || "")
          .toLowerCase() !== device
      ) {
        return false;
      }

      if (
        vpn === "yes" &&
        !sec.vpn
      ) {
        return false;
      }

      if (
        vpn === "no" &&
        sec.vpn
      ) {
        return false;
      }

      return true;
    });

  $("adminHistory").innerHTML =
    filtered.length
      ? filtered.map(renderAdminRecord).join("")
      : `<div class="admin-row">
           No matching records.
         </div>`;

  initializeHistoryMaps(
    $("adminHistory")
  );
}

/* =========================================================
   LIVE STREAM
========================================================= */


function startLiveStream() {

  if (liveSource) {
    try {
      liveSource.close();
    } catch {}
  }

  $("liveStatus").textContent =
    "CONNECTING";

  liveSource =
    new EventSource("/api/live");

  liveSource.onopen = () => {

    $("liveStatus").textContent =
      "LIVE";

  };

  liveSource.onerror = () => {

    $("liveStatus").textContent =
      "RECONNECTING";

  };

  liveSource.onmessage = event => {

    try {

      const data =
        JSON.parse(event.data);

      if (
        data.type === "visitor"
      ) {

        const item =
          data.visitor;

        adminRecords.unshift(item);

        const html =
          renderAdminRecord(item);

        $("adminHistory")
          .insertAdjacentHTML(
            "afterbegin",
            html
          );

        const newestRow =
          $("adminHistory").firstElementChild;

        if (newestRow) {
          initializeHistoryMaps(newestRow);
        }

        const rows =
          $("adminHistory")
            .querySelectorAll(
              ".admin-row"
            );

        if (rows.length > 1000) {
          rows[rows.length - 1].remove();
        }

        loadStats();
      }

    } catch (error) {
      console.error(error);
    }
  };
}

/* =========================================================
   LOGOUT
========================================================= */

async function logout() {

  try {

    await fetch(
      "/api/live/logout",
      {
        method: "POST"
      }
    );

  } catch {}

  if (liveSource) {
    try {
      liveSource.close();
    } catch {}

    liveSource = null;
  }

  $("adminPanel")
    .classList.add("hidden");

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

/* =========================================================
   EVENTS
========================================================= */

$("unlockButton")
  .addEventListener(
    "click",
    openModal
  );

$("closeModal")
  .addEventListener(
    "click",
    closeModal
  );

$("loginSubmit")
  .addEventListener(
    "click",
    login
  );

$("logoutButton")
  .addEventListener(
    "click",
    logout
  );

$("passwordInput")
  .addEventListener(
    "keydown",
    event => {
      if (event.key === "Enter") {
        login();
      }
    }
  );

$("loginModal")
  .addEventListener(
    "click",
    event => {
      if (
        event.target.classList.contains(
          "modal-backdrop"
        )
      ) {
        closeModal();
      }
    }
  );

/* =========================================================
   START
========================================================= */

loadCurrentVisitor();
loadPreview();
checkAuth();


/* =========================================================
 * LOCATION SHARE
 * ========================================================= */

async function generateLocationShareLink(visitorId) {
  try {

    const response = await fetch(
      `/api/location-share/${encodeURIComponent(visitorId)}`,
      {
        method: "POST",
        credentials: "include"
      }
    );

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(
        data.error || "Unable to create share link"
      );
    }

    return data.url;

  } catch (error) {

    console.error(
      "LOCATION SHARE ERROR:",
      error
    );

    showToast(
      error.message ||
      "Unable to create share link"
    );

    return null;
  }
}

async function shareVisitorLocationLink(visitorId) {

  const url =
    await generateLocationShareLink(visitorId);

  if (!url) return;

  try {

    if (navigator.share) {

      await navigator.share({
        title: "📍 Shared Location",
        text: "Here is the shared location.",
        url
      });

    } else {

      await navigator.clipboard.writeText(url);

      showToast(
        "📋 Location share link copied!"
      );

    }

  } catch (error) {

    if (error.name !== "AbortError") {
      console.error(error);

      try {
        await navigator.clipboard.writeText(url);

        showToast(
          "📋 Location share link copied!"
        );

      } catch (e) {
        prompt(
          "Copy this location link:",
          url
        );
      }
    }

  }
}

async function copyVisitorLocationLink(visitorId) {

  const url =
    await generateLocationShareLink(visitorId);

  if (!url) return;

  try {

    await navigator.clipboard.writeText(url);

    showToast(
      "🔗 Location link copied!"
    );

  } catch (error) {

    prompt(
      "Copy this location link:",
      url
    );

  }
}


/* =========================================================
 * PREMIUM DASHBOARD
 * ========================================================= */

function renderRiskPanel(risk) {
  if (!risk) return "";

  const score =
    Number(risk.score || 0);

  const level =
    risk.level || "LOW";

  const reasons =
    Array.isArray(risk.reasons)
      ? risk.reasons.join(", ")
      : "None";

  return `
    <div class="premium-risk-card">
      <div class="premium-risk-title">
        🛡️ Security Risk
      </div>

      <div class="premium-risk-score">
        ${score}/100
      </div>

      <div class="premium-risk-level risk-${level.toLowerCase()}">
        ${level}
      </div>

      <div class="premium-risk-reasons">
        ${reasons}
      </div>
    </div>
  `;
}


/* =========================================================
 * VISITOR PROFILE MODAL
 * ========================================================= */

function showVisitorProfile(item) {

  const geo = item.geo || {};
  const security =
    geo.security || {};

  const client =
    item.client || {};

  const risk =
    item.risk || {};

  const modal =
    document.getElementById(
      "visitorProfileModal"
    );

  if (!modal) return;

  const body =
    document.getElementById(
      "visitorProfileBody"
    );

  body.innerHTML = `

    <div class="profile-header">
      <div>
        <span class="profile-label">
          VISITOR
        </span>

        <h2>
          ${geo.city || "Unknown"},
          ${geo.country || "Unknown"}
        </h2>
      </div>

      ${renderRiskPanel(risk)}
    </div>

    <div class="profile-grid">

      <div class="profile-section">
        <h3>🌐 Network</h3>

        <p><b>IP:</b> ${item.ip || "Hidden"}</p>
        <p><b>ISP:</b> ${geo.isp || "Unknown"}</p>
        <p><b>Organization:</b> ${geo.organization || "Unknown"}</p>
        <p><b>ASN:</b> ${geo.asn || "Unknown"}</p>
      </div>

      <div class="profile-section">
        <h3>🛡️ Security</h3>

        <p>VPN: ${security.vpn ? "YES" : "NO"}</p>
        <p>Proxy: ${security.proxy ? "YES" : "NO"}</p>
        <p>Tor: ${security.tor ? "YES" : "NO"}</p>
        <p>Hosting: ${security.hosting ? "YES" : "NO"}</p>
      </div>

      <div class="profile-section">
        <h3>📍 Location</h3>

        <p>${geo.country || "Unknown"}</p>
        <p>${geo.region || "Unknown"}</p>
        <p>${geo.city || "Unknown"}</p>
        <p>
          ${geo.lat ?? "-"},
          ${geo.lon ?? "-"}
        </p>
      </div>

      <div class="profile-section">
        <h3>💻 Device</h3>

        <p>Type: ${item.device?.type || "Unknown"}</p>
        <p>OS: ${item.os?.name || "Unknown"} ${item.os?.version || ""}</p>
        <p>Browser: ${item.browser?.name || "Unknown"}</p>
        <p>Engine: ${item.engine?.name || "Unknown"}</p>
      </div>

      <div class="profile-section">
        <h3>📐 Client Signals</h3>

        <p>
          Screen:
          ${client.screen?.width || "-"} ×
          ${client.screen?.height || "-"}
        </p>

        <p>
          Viewport:
          ${client.viewport?.width || "-"} ×
          ${client.viewport?.height || "-"}
        </p>

        <p>
          DPR:
          ${client.pixelRatio || "-"}
        </p>

        <p>
          Touch:
          ${client.touchSupport ? "YES" : "NO"}
        </p>

        <p>
          CPU:
          ${client.hardwareConcurrency || "-"}
        </p>
      </div>

      <div class="profile-section">
        <h3>🕐 Activity</h3>

        <p>
          Created:
          ${item.createdAt
            ? new Date(item.createdAt).toLocaleString()
            : "-"}
        </p>

        <p>
          Timezone:
          ${client.timezone || geo.timezone || "-"}
        </p>

        <p>
          Language:
          ${client.language || "-"}
        </p>
      </div>

    </div>
  `;

  modal.classList.add("show");
}

function closeVisitorProfile() {

  const modal =
    document.getElementById(
      "visitorProfileModal"
    );

  if (modal) {
    modal.classList.remove("show");
  }
}


/* =========================================================
 * ANALYTICS
 * ========================================================= */

async function loadPremiumAnalytics() {

  try {

    const response =
      await fetch(
        "/api/analytics",
        {
          credentials: "include"
        }
      );

    if (!response.ok) {
      return;
    }

    const data =
      await response.json();

    if (!data.ok) return;

    const setText = (id, value) => {

      const el =
        document.getElementById(id);

      if (el) {
        el.textContent =
          value ?? 0;
      }

    };

    setText(
      "analyticsVisitors",
      data.totals?.visitors
    );

    setText(
      "analyticsUnique",
      data.totals?.uniqueIPs
    );

    setText(
      "analyticsToday",
      data.totals?.today
    );

    setText(
      "analyticsWeek",
      data.totals?.week
    );

    setText(
      "analyticsVPN",
      data.security?.vpn
    );

    setText(
      "analyticsProxy",
      data.security?.proxy
    );

    setText(
      "analyticsTor",
      data.security?.tor
    );

    setText(
      "analyticsHosting",
      data.security?.hosting
    );

    renderAnalyticsList(
      "analyticsCountries",
      data.countries
    );

    renderAnalyticsList(
      "analyticsBrowsers",
      data.browsers
    );

    renderAnalyticsList(
      "analyticsDevices",
      data.devices
    );

    renderAnalyticsList(
      "analyticsOS",
      data.operatingSystems
    );

  } catch (error) {

    console.error(
      "Analytics error:",
      error
    );
  }
}

function renderAnalyticsList(
  id,
  items
) {

  const el =
    document.getElementById(id);

  if (!el) return;

  el.innerHTML = "";

  if (!Array.isArray(items) || !items.length) {
    el.innerHTML =
      `<div class="empty-state">No data</div>`;
    return;
  }

  items.slice(0, 8).forEach(item => {

    const row =
      document.createElement("div");

    row.className =
      "analytics-row";

    row.innerHTML = `
      <span>
        ${escapeHtml(
          String(item.name)
        )}
      </span>

      <strong>
        ${item.count}
      </strong>
    `;

    el.appendChild(row);
  });
}


/* =========================================================
 * SHARE MANAGER
 * ========================================================= */

async function loadShareManager() {

  const container =
    document.getElementById(
      "shareManagerList"
    );

  if (!container) return;

  try {

    const response =
      await fetch(
        "/api/location-shares",
        {
          credentials: "include"
        }
      );

    const data =
      await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(
        data.error ||
        "Unable to load shares"
      );
    }

    container.innerHTML = "";

    if (!data.shares.length) {

      container.innerHTML =
        `<div class="empty-state">
          No shared locations
        </div>`;

      return;
    }

    data.shares.forEach(share => {

      const row =
        document.createElement("div");

      row.className =
        "share-manager-row";

      const status =
        share.expired
          ? "EXPIRED"
          : "ACTIVE";

      row.innerHTML = `

        <div class="share-manager-main">

          <strong>
            📍
            ${escapeHtml(
              share.city ||
              share.country ||
              "Unknown"
            )}
          </strong>

          <small>
            ${escapeHtml(
              share.country || ""
            )}
          </small>

          <small>
            ${new Date(
              share.createdAt
            ).toLocaleString()}
          </small>

        </div>

        <div class="share-manager-status ${
          share.expired
            ? "share-expired"
            : "share-active"
        }">
          ${status}
        </div>

        <div class="share-manager-actions">

          <button
            type="button"
            onclick="copyTextToClipboard('${share.url.replace(/'/g, "\\'")}')"
          >
            📋 Copy
          </button>

          <button
            type="button"
            onclick="window.open('${share.url.replace(/'/g, "\\'")}', '_blank')"
          >
            🔗 Open
          </button>

          <button
            type="button"
            onclick="revokeLocationShare('${share.token}')"
          >
            🗑️ Revoke
          </button>

        </div>
      `;

      container.appendChild(row);
    });

  } catch (error) {

    console.error(
      "Share manager error:",
      error
    );

    container.innerHTML =
      `<div class="empty-state">
        Unable to load shares
      </div>`;
  }
}

async function revokeLocationShare(token) {

  if (
    !confirm(
      "Revoke this shared location link?"
    )
  ) {
    return;
  }

  try {

    const response =
      await fetch(
        `/api/location-share/${encodeURIComponent(token)}`,
        {
          method: "DELETE",
          credentials: "include"
        }
      );

    const data =
      await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(
        data.error ||
        "Unable to revoke"
      );
    }

    showToast(
      "🗑️ Share link revoked"
    );

    loadShareManager();

  } catch (error) {

    showToast(
      error.message ||
      "Unable to revoke"
    );
  }
}

async function copyTextToClipboard(text) {

  try {

    await navigator.clipboard.writeText(text);

    showToast(
      "📋 Copied!"
    );

  } catch {

    prompt(
      "Copy this:",
      text
    );
  }
}


/* =========================================================
 * LOAD ALL PREMIUM DATA
 * ========================================================= */

async function loadPremiumDashboard() {

  await Promise.allSettled([
    loadPremiumAnalytics(),
    loadShareManager()
  ]);

}


/* Automatically refresh premium dashboard
 * whenever the admin page is visible.
 */
document.addEventListener(
  "DOMContentLoaded",
  () => {

    setTimeout(
      () => {
        loadPremiumDashboard();
      },
      1200
    );

  }
);
