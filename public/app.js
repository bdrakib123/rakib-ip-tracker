let map = null;
let marker = null;
let liveSource = null;
let liveWorldMap = null;
let liveWorldMarkers = new Map();
let liveTraffic = [];
let liveVisitorCount = 0;
let liveNotificationPermission = false;


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

function renderPublicIntelligence(visitor) {

  const geo = visitor?.geo || {};
  const device = visitor?.device || {};
  const os = visitor?.os || {};
  const browser = visitor?.browser || {};
  const engine = visitor?.engine || {};
  const security = visitor?.security || geo?.security || {};
  const client = visitor?.client || {};

  const set = (id, value, fallback = "Unavailable") => {
    const el = document.getElementById(id);
    if (!el) return;

    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      el.textContent = fallback;
      return;
    }

    el.textContent = String(value);
  };

  const yesNo = value => {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return "UNKNOWN";
    }

    return (
      value === true ||
      value === 1 ||
      value === "1" ||
      value === "true"
    )
      ? "YES"
      : "NO";
  };

  const deviceName = [
    device.vendor &&
    device.vendor !== "Unknown"
      ? device.vendor
      : "",
    device.model &&
    device.model !== "Unknown"
      ? device.model
      : ""
  ]
    .filter(Boolean)
    .join(" ");

  const osName = [
    os.name,
    os.version
  ]
    .filter(Boolean)
    .join(" ");

  const browserName = [
    browser.name,
    browser.version
  ]
    .filter(Boolean)
    .join(" ");

  const engineName = [
    engine.name,
    engine.version
  ]
    .filter(Boolean)
    .join(" ");

  const screen = client.screen || {};
  const viewport = client.viewport || {};
  const connection = client.connection || {};
  const webgl = client.webgl || {};

  /* =========================
     NETWORK
  ========================= */

  set("uiIP", visitor.ip);

  set(
    "uiISP",
    geo.isp || geo.provider || geo.org
  );

  set(
    "uiOrganization",
    geo.organization || geo.org
  );

  set(
    "uiASN",
    geo.asn || geo.as
  );

  /* =========================
     LOCATION
  ========================= */

  const locationParts = [
    geo.city,
    geo.region,
    geo.country
  ].filter(Boolean);

  set(
    "uiLocation",
    locationParts.length
      ? locationParts.join(", ")
      : null
  );

  set("uiRegion", geo.region);
  set("uiCountry", geo.country);
  set("uiCountryCode", geo.countryCode);
  set("uiPostal", geo.postal);
  set(
    "uiTimezone",
    geo.timezone ||
      client.timezone
  );

  const latitude =
    Number(
      geo.latitude ??
      geo.lat
    );

  const longitude =
    Number(
      geo.longitude ??
      geo.lon
    );

  if (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude !== 0 &&
    longitude !== 0
  ) {
    set(
      "uiCoordinates",
      `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
    );
  } else {
    set("uiCoordinates", null);
  }

  /* =========================
     DEVICE
  ========================= */

  const deviceType =
    device.type &&
    device.type !== "Unknown"
      ? device.type
      : "";

  const deviceDisplay = [
    deviceName,
    deviceType
  ]
    .filter(Boolean)
    .join(" • ");

  set(
    "uiDevice",
    deviceDisplay || "Unknown"
  );

  set(
    "uiOS",
    osName
  );

  set(
    "uiScreen",
    screen.width &&
    screen.height
      ? `${screen.width} × ${screen.height}`
      : null
  );

  set(
    "uiViewport",
    viewport.width &&
    viewport.height
      ? `${viewport.width} × ${viewport.height}`
      : null
  );

  set(
    "uiDPR",
    client.pixelRatio != null
      ? `${client.pixelRatio}x`
      : null
  );

  set(
    "uiCPU",
    client.hardwareConcurrency != null
      ? `${client.hardwareConcurrency} cores`
      : null
  );

  set(
    "uiMemory",
    client.deviceMemory != null
      ? `${client.deviceMemory} GB`
      : null
  );

  if (client.touchSupport) {
    set(
      "uiTouch",
      `${client.touchPoints || 0} touch points`
    );
  } else {
    set("uiTouch", "NO");
  }

  /* =========================
     BROWSER
  ========================= */

  set(
    "uiBrowser",
    browserName
  );

  set(
    "uiEngine",
    engineName
  );

  set(
    "uiPlatform",
    client.platform ||
      navigator.platform
  );

  set(
    "uiLanguage",
    client.language ||
      visitor.language ||
      navigator.language
  );

  const languages =
    Array.isArray(client.languages) &&
    client.languages.length
      ? client.languages
      : (
          Array.isArray(navigator.languages)
            ? navigator.languages
            : []
        );

  set(
    "uiLanguages",
    languages.length
      ? languages.join(" • ")
      : null
  );

  set(
    "uiCookies",
    client.cookiesEnabled != null
      ? yesNo(client.cookiesEnabled)
      : null
  );

  set(
    "uiDNT",
    client.doNotTrack != null
      ? (
          client.doNotTrack === "1" ||
          client.doNotTrack === 1 ||
          client.doNotTrack === true
            ? "ON"
            : "OFF"
        )
      : null
  );

  set(
    "uiOnline",
    client.online != null
      ? yesNo(client.online)
      : null
  );

  /* =========================
     BROWSER LAB
  ========================= */

  set(
    "uiCanvas",
    client.canvasHash ||
      client.canvas
  );

  /* FIX: WebGL is nested inside client.webgl */
  set(
    "uiWebGLVendor",
    webgl.vendor ||
      client.webglVendor
  );

  set(
    "uiWebGLRenderer",
    webgl.renderer ||
      client.webglRenderer
  );

  set(
    "uiWebGLVersion",
    webgl.version ||
      client.webglVersion
  );

  set(
    "uiColorDepth",
    client.colorDepth != null
      ? `${client.colorDepth}-bit`
      : null
  );

  set(
    "uiTimezoneOffset",
    client.timezoneOffset != null
      ? `${client.timezoneOffset} min`
      : null
  );

  /* =========================
     NETWORK CONNECTION
  ========================= */

  const networkParts = [];

  if (connection.effectiveType) {
    networkParts.push(
      connection.effectiveType
    );
  }

  if (connection.type) {
    networkParts.push(
      connection.type
    );
  }

  if (
    connection.downlink !== null &&
    connection.downlink !== undefined
  ) {
    networkParts.push(
      `${connection.downlink} Mbps`
    );
  }

  if (
    connection.rtt !== null &&
    connection.rtt !== undefined
  ) {
    networkParts.push(
      `${connection.rtt} ms RTT`
    );
  }

  /* Existing live tracking signal */
  set(
    "networkInfo",
    networkParts.length
      ? networkParts.join(" • ")
      : null
  );

  /* =========================
     SECURITY
  ========================= */

  set(
    "uiVPN",
    yesNo(security.vpn)
  );

  set(
    "uiProxy",
    yesNo(security.proxy)
  );

  set(
    "uiTor",
    yesNo(security.tor)
  );

  set(
    "uiHosting",
    yesNo(security.hosting)
  );
}

function renderCurrent(visitor) {

  renderPublicIntelligence(visitor);

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
   PUBLIC FULL HISTORY
   History contains visitor essentials only.
========================================================= */

let historyRecords = [];

function historyMapId(id) {
  return `history-map-${String(id).replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function renderHistoryRecord(item, index) {

  const geo =
    item.geo || {};

  const device =
    item.device || {};

  const os =
    item.os || {};

  const browser =
    item.browser || {};

  const engine =
    item.engine || {};

  const city =
    geo.city ||
    item.city ||
    "Unknown";

  const country =
    geo.country ||
    item.country ||
    "Unknown";

  const region =
    geo.region ||
    item.region ||
    "Unknown";

  const maskedIP =
    item.maskedIP ||
    item.ip ||
    "Unavailable";

  const historyDeviceName = [
    device.vendor && device.vendor !== "Unknown"
      ? device.vendor
      : "",
    device.model && device.model !== "Unknown"
      ? device.model
      : ""
  ]
    .filter(Boolean)
    .join(" ");

  const deviceType =
    device.type && device.type !== "Unknown"
      ? device.type
      : "";

  const deviceName = [
    historyDeviceName,
    deviceType
  ]
    .filter(Boolean)
    .join(" • ") || "Unknown";

  const osText =
    [
      os.name,
      os.version
    ]
      .filter(Boolean)
      .join(" ") ||
      "Unknown";

  const browserText =
    [
      browser.name,
      browser.version
    ]
      .filter(Boolean)
      .join(" ") ||
      "Unknown";

  const engineText =
    [
      engine.name,
      engine.version
    ]
      .filter(Boolean)
      .join(" ") ||
      "Unknown";

  const recordTime =
    item.timestamp ||
    item.createdAt ||
    item.updatedAt ||
    "";

  return `
    <article
      class="history-digital-card"
      data-history-index="${index}"
    >

      <div class="history-digital-top">

        <div class="history-visitor-title">

          <div class="history-visitor-badge">
            VISITOR
          </div>

          <h3>
            ***
          </h3>

          <div class="history-visitor-location">
            ***
          </div>

        </div>

        <div class="history-visitor-time">
          ***
        </div>

      </div>

      <div class="history-digital-grid">

        <div class="history-digital-field">
          <span>IP ADDRESS</span>
          <strong>
            ***
          </strong>
        </div>

        <div class="history-digital-field">
          <span>LOCATION</span>
          <strong>
            ***
          </strong>
          <small>
            ***
          </small>
        </div>

        <div class="history-digital-field">
          <span>COUNTRY</span>
          <strong>
            ***
          </strong>
        </div>

        <div class="history-digital-field">
          <span>DEVICE</span>
          <strong>
            ***
          </strong>
        </div>

        <div class="history-digital-field">
          <span>OPERATING SYSTEM</span>
          <strong>
            ***
          </strong>
        </div>

        <div class="history-digital-field">
          <span>BROWSER</span>
          <strong>
            ***
          </strong>
        </div>

        <div class="history-digital-field">
          <span>ENGINE</span>
          <strong>
            ***
          </strong>
        </div>

      </div>

    </article>
  `;
}

async function copyHistoryLocation(lat, lon) {

  const link =
    `https://www.google.com/maps?q=${lat},${lon}`;

  try {

    await navigator.clipboard.writeText(link);

    showHistoryToast(
      "📋 Map link copied"
    );

  } catch {

    window.prompt(
      "Copy map link:",
      link
    );
  }
}


async function shareHistoryLocation(
  lat,
  lon,
  label
) {

  const link =
    `https://www.google.com/maps?q=${lat},${lon}`;

  try {

    if (
      navigator.share
    ) {

      await navigator.share({
        title:
          "Visitor Location",
        text:
          `Approximate location: ${label}`,
        url: link
      });

      return;
    }

    await navigator.clipboard.writeText(
      link
    );

    showHistoryToast(
      "🔗 Share link copied"
    );

  } catch (error) {

    if (
      error &&
      error.name === "AbortError"
    ) {
      return;
    }

    try {

      await navigator.clipboard.writeText(
        link
      );

      showHistoryToast(
        "🔗 Share link copied"
      );

    } catch {}
  }
}


function showHistoryToast(message) {

  let toast =
    document.getElementById(
      "historyToast"
    );

  if (!toast) {

    toast =
      document.createElement(
        "div"
      );

    toast.id =
      "historyToast";

    toast.className =
      "history-toast";

    document.body.appendChild(
      toast
    );
  }

  toast.textContent =
    message;

  toast.classList.add(
    "show"
  );

  clearTimeout(
    window.__historyToastTimer
  );

  window.__historyToastTimer =
    setTimeout(() => {

      toast.classList.remove(
        "show"
      );

    }, 1800);
}


function initializeHistoryMaps() {
  // Public history intentionally has no embedded maps.
}

async function loadAdminHistory() {

  const container =
    $("adminHistory");

  if (!container) {
    return;
  }

  container.innerHTML = `
    <div class="history-loading">
      Loading visitor history...
    </div>
  `;

  try {

    const response =
      await fetch(
        "/api/history",
        {
          cache: "no-store"
        }
      );

    const result =
      await response.json();

    if (
      !response.ok ||
      !result.success
    ) {
      throw new Error(
        result.error ||
        "History failed"
      );
    }

    historyRecords =
      Array.isArray(result.data)
        ? result.data
        : [];

    if (!historyRecords.length) {

      container.innerHTML = `
        <div class="history-empty">
          No visitor history yet.
        </div>
      `;

      return;
    }

    container.innerHTML =
      historyRecords
        .map(
          renderHistoryRecord
        )
        .join("");

    if (
      typeof updateHistoryFilterOptions ===
      "function"
    ) {
      try {
        updateHistoryFilterOptions(
          historyRecords
        );
      } catch {}
    }

  } catch (error) {

    console.error(
      "PUBLIC HISTORY:",
      error
    );

    container.innerHTML = `
      <div class="history-empty">
        Unable to load visitor history.
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


/* =========================================================
   PUBLIC / ADMIN UI ISOLATION
========================================================= */

function setupAdminOnlyUI() {
  // PUBLIC MODE: everything is visible.
}


/* =========================================================
   PUBLIC PAGE STARTUP
========================================================= */

function initializePublicPage() {

  if (
    typeof loadCurrentVisitor ===
    "function"
  ) {
    loadCurrentVisitor();
  }

  if (
    typeof loadAdminHistory ===
    "function"
  ) {
    loadAdminHistory();
  }
}

if (document.readyState === "loading") {

  document.addEventListener(
    "DOMContentLoaded",
    initializePublicPage,
    { once: true }
  );

} else {

  initializePublicPage();

}
