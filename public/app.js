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
   CURRENT VISITOR
========================================================= */

async function loadCurrentVisitor() {
  try {
    const response = await fetch(
      "/api/track",
      {
        cache: "no-store"
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

    container.innerHTML =
      result.data
        .map(renderAdminRecord)
        .join("");

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

  return `
    <div class="admin-row">

      <div class="admin-row-top">

        <div>
          <div class="admin-ip">
            ${escapeHTML(item.ip)}
          </div>

          <div class="preview-sub">
            ${escapeHTML(
              safe(geo.city)
            )},
            ${escapeHTML(
              safe(geo.country)
            )}
          </div>
        </div>

        <div class="admin-time">
          ${escapeHTML(
            formatDate(item.timestamp)
          )}
        </div>

      </div>

      <div class="admin-grid">

        <div>
          <span>ISP</span>
          <strong>
            ${escapeHTML(
              safe(geo.isp)
            )}
          </strong>
        </div>

        <div>
          <span>ASN</span>
          <strong>
            ${escapeHTML(
              safe(geo.asn)
            )}
          </strong>
        </div>

        <div>
          <span>Device</span>
          <strong>
            ${escapeHTML(
              `${safe(device.type)} ${
                device.vendor || ""
              } ${
                device.model || ""
              }`
            )}
          </strong>
        </div>

        <div>
          <span>OS</span>
          <strong>
            ${escapeHTML(
              `${safe(os.name)} ${
                os.version || ""
              }`
            )}
          </strong>
        </div>

        <div>
          <span>Browser</span>
          <strong>
            ${escapeHTML(
              `${safe(browser.name)} ${
                browser.version || ""
              }`
            )}
          </strong>
        </div>

        <div>
          <span>Region</span>
          <strong>
            ${escapeHTML(
              safe(geo.region)
            )}
          </strong>
        </div>

        <div>
          <span>Postal</span>
          <strong>
            ${escapeHTML(
              safe(geo.postal)
            )}
          </strong>
        </div>

        <div>
          <span>Timezone</span>
          <strong>
            ${escapeHTML(
              safe(geo.timezone)
            )}
          </strong>
        </div>

        <div>
          <span>Organization</span>
          <strong>
            ${escapeHTML(
              safe(geo.organization)
            )}
          </strong>
        </div>

        <div>
          <span>Coordinates</span>
          <strong>
            ${escapeHTML(
              typeof geo.latitude === "number"
                ? `${geo.latitude}, ${geo.longitude}`
                : "Unavailable"
            )}
          </strong>
        </div>

        <div>
          <span>Engine</span>
          <strong>
            ${escapeHTML(
              `${safe(item.engine?.name)} ${
                item.engine?.version || ""
              }`
            )}
          </strong>
        </div>

        <div>
          <span>Country Code</span>
          <strong>
            ${escapeHTML(
              safe(geo.countryCode)
            )}
          </strong>
        </div>

      </div>

      <div
        class="user-agent"
        style="margin-top:12px"
      >
        ${escapeHTML(
          safe(item.userAgent)
        )}
      </div>

    </div>
  `;
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

        const html =
          renderAdminRecord(item);

        $("adminHistory")
          .insertAdjacentHTML(
            "afterbegin",
            html
          );

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
