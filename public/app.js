let map;
let markers = [];
let liveToken = null;
let eventSource = null;

const $ = id =>
  document.getElementById(id);

/* =========================================================
   MAP
========================================================= */

function initMap() {
  map = L.map("map", {
    zoomControl: true,
    worldCopyJump: true
  }).setView([23.8103, 90.4125], 3);

  L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 18,
      attribution: "© OpenStreetMap"
    }
  ).addTo(map);
}

function clearMarkers() {
  for (const marker of markers) {
    map.removeLayer(marker);
  }

  markers = [];
}

function addMarker(visitor) {
  const lat =
    visitor.location?.latitude;

  const lng =
    visitor.location?.longitude;

  if (
    typeof lat !== "number" ||
    typeof lng !== "number"
  ) {
    return;
  }

  const marker = L.circleMarker(
    [lat, lng],
    {
      radius: 7,
      color: "#54ffe1",
      fillColor: "#54ffe1",
      fillOpacity: .55,
      weight: 1
    }
  ).addTo(map);

  marker.bindPopup(`
    <b>${escapeHTML(
      visitor.flag || "🌐"
    )} ${escapeHTML(
      visitor.country || "Unknown"
    )}</b><br>
    ${escapeHTML(
      visitor.city || "Unknown"
    )}<br>
    ${escapeHTML(
      visitor.ip || "Hidden"
    )}
  `);

  markers.push(marker);
}

/* =========================================================
   VISITOR CARD
========================================================= */

function visitorCard(visitor) {
  const date =
    new Date(visitor.createdAt);

  return `
    <div class="visitor-card">

      <div class="visitor-top">

        <div class="visitor-country">
          ${escapeHTML(visitor.flag || "🌐")}
          ${escapeHTML(visitor.country || "Unknown")}
        </div>

        <div class="visitor-time">
          ${formatTime(date)}
        </div>

      </div>

      <div class="visitor-ip">
        ${escapeHTML(visitor.ip || "Hidden")}
      </div>

      <div class="visitor-meta">

        <span>
          📍
          <b>
            ${escapeHTML(visitor.city || "Unknown")}
          </b>
        </span>

        <span>
          📱
          <b>
            ${escapeHTML(visitor.device?.type || "Unknown")}
          </b>
        </span>

        <span>
          💻
          <b>
            ${escapeHTML(visitor.device?.os || "Unknown")}
          </b>
        </span>

        <span>
          🌐
          <b>
            ${escapeHTML(visitor.device?.browser || "Unknown")}
          </b>
        </span>

        <span>
          🏢
          <b>
            ${escapeHTML(visitor.isp || "Unknown")}
          </b>
        </span>

        <span>
          🔢
          <b>
            ${escapeHTML(visitor.asn || "Unknown")}
          </b>
        </span>

      </div>

    </div>
  `;
}

/* =========================================================
   CURRENT
========================================================= */

function showCurrent(visitor) {
  $("currentVisitor").innerHTML =
    visitorCard(visitor);
}

/* =========================================================
   TRACK
========================================================= */

async function trackVisitor() {
  try {
    const response =
      await fetch("/api/track");

    const data =
      await response.json();

    if (!data.success) {
      throw new Error(
        data.message || "Tracking failed"
      );
    }

    showCurrent(data.visitor);

    addVisitorToList(
      data.visitor,
      true
    );

    addMarker(data.visitor);

  } catch (error) {
    console.error(error);

    $("currentVisitor").innerHTML = `
      <div class="empty">
        Unable to receive visitor signal.
      </div>
    `;
  }
}

/* =========================================================
   HISTORY
========================================================= */

async function loadHistory() {
  try {
    const response =
      await fetch(
        "/api/history?limit=30"
      );

    const data =
      await response.json();

    if (!data.success) {
      return;
    }

    $("visitorList").innerHTML = "";

    clearMarkers();

    for (const visitor of data.data) {
      addVisitorToList(
        visitor,
        false
      );

      addMarker(visitor);
    }

    if (!data.data.length) {
      $("visitorList").innerHTML = `
        <div class="empty">
          No visitor records yet.
        </div>
      `;
    }

  } catch (error) {
    console.error(error);
  }
}

function addVisitorToList(
  visitor,
  prepend = true
) {
  const list =
    $("visitorList");

  const empty =
    list.querySelector(".empty");

  if (empty) {
    empty.remove();
  }

  const wrapper =
    document.createElement("div");

  wrapper.innerHTML =
    visitorCard(visitor);

  const element =
    wrapper.firstElementChild;

  if (prepend) {
    list.prepend(element);
  } else {
    list.appendChild(element);
  }

  while (
    list.children.length > 30
  ) {
    list.lastElementChild.remove();
  }
}

/* =========================================================
   STATS
========================================================= */

async function loadStats() {
  try {
    const response =
      await fetch("/api/stats");

    const data =
      await response.json();

    if (!data.success) {
      return;
    }

    $("totalVisitors").textContent =
      data.totalVisitors;

    $("todayVisitors").textContent =
      data.todayVisitors;

    $("countryCount").textContent =
      data.countries.length;

    renderRank(
      "countriesList",
      data.countries
    );

    renderRank(
      "devicesList",
      data.devices
    );

    renderRank(
      "ispList",
      data.isps
    );

  } catch (error) {
    console.error(error);
  }
}

function renderRank(
  id,
  items
) {
  const element =
    $(id);

  if (!items?.length) {
    element.innerHTML =
      `<div class="empty">No data</div>`;

    return;
  }

  element.innerHTML =
    items
      .slice(0, 8)
      .map(item => `
        <div class="rank-row">
          <span>
            ${escapeHTML(item.name)}
          </span>

          <b>
            ${item.count}
          </b>
        </div>
      `)
      .join("");
}

/* =========================================================
   SSE LIVE
========================================================= */

function connectLive() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource =
    new EventSource("/api/live");

  eventSource.addEventListener(
    "connected",
    () => {
      $("streamText").textContent =
        "CONNECTED";

      $("liveCount").textContent =
        "LIVE";
    }
  );

  eventSource.addEventListener(
    "visitor",
    event => {
      try {
        const visitor =
          JSON.parse(event.data);

        addVisitorToList(
          visitor,
          true
        );

        addMarker(visitor);

        if (liveToken) {
          addLiveVisitor(
            visitor
          );
        }

        showCurrent(visitor);

        loadStats();

      } catch (error) {
        console.error(error);
      }
    }
  );

  eventSource.onerror = () => {
    $("streamText").textContent =
      "RECONNECTING";

    $("liveCount").textContent =
      "—";
  };
}

/* =========================================================
   PASSWORD MODAL
========================================================= */

function openPasswordModal() {
  $("passwordModal")
    .classList.remove("hidden");

  $("livePassword").value = "";

  $("passwordError").textContent = "";

  setTimeout(() => {
    $("livePassword").focus();
  }, 100);
}

function closePasswordModal() {
  $("passwordModal")
    .classList.add("hidden");
}

async function unlockLive() {
  const password =
    $("livePassword").value;

  if (!password) {
    $("passwordError").textContent =
      "Enter access password.";

    return;
  }

  $("unlockButton").disabled =
    true;

  $("unlockButton").textContent =
    "AUTHENTICATING...";

  try {
    const response =
      await fetch(
        "/api/live/auth",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            password
          })
        }
      );

    const data =
      await response.json();

    if (!response.ok || !data.success) {
      throw new Error(
        data.message ||
        "Access denied"
      );
    }

    liveToken =
      data.token;

    closePasswordModal();

    openLivePanel();

    await loadProtectedLive();

  } catch (error) {

    $("passwordError").textContent =
      "ACCESS DENIED";

  } finally {

    $("unlockButton").disabled =
      false;

    $("unlockButton").textContent =
      "UNLOCK LIVE";
  }
}

/* =========================================================
   LIVE PANEL
========================================================= */

function openLivePanel() {
  $("livePanel")
    .classList.remove("hidden");
}

function closeLivePanel() {
  $("livePanel")
    .classList.add("hidden");
}

async function loadProtectedLive() {
  if (!liveToken) {
    return;
  }

  try {
    const response =
      await fetch(
        "/api/live/history",
        {
          headers: {
            Authorization:
              `Bearer ${liveToken}`
          }
        }
      );

    if (response.status === 401) {
      liveToken = null;

      closeLivePanel();

      showToast(
        "Live session expired."
      );

      return;
    }

    const data =
      await response.json();

    if (!data.success) {
      return;
    }

    $("liveVisitors").innerHTML =
      "";

    for (const visitor of data.data) {
      addLiveVisitor(
        visitor
      );
    }

  } catch (error) {
    console.error(error);
  }
}

function addLiveVisitor(
  visitor
) {
  const container =
    $("liveVisitors");

  if (!container) {
    return;
  }

  const existing =
    container.querySelector(
      `[data-visitor-id="${visitor.visitorId}"]`
    );

  if (existing) {
    return;
  }

  const item =
    document.createElement("div");

  item.className =
    "live-item";

  item.dataset.visitorId =
    visitor.visitorId;

  item.innerHTML = `

    <div class="live-item-head">

      <div>

        <h3>
          ${escapeHTML(
            visitor.country ||
            "Unknown"
          )}
        </h3>

        <small>
          ${escapeHTML(
            visitor.city ||
            "Unknown"
          )}
        </small>

      </div>

      <div class="flag">
        ${escapeHTML(
          visitor.flag || "🌐"
        )}
      </div>

    </div>

    <div class="ip">
      ${escapeHTML(
        visitor.ip || "Hidden"
      )}
    </div>

    <div class="details">

      📱 ${escapeHTML(
        visitor.device?.type ||
        "Unknown"
      )}

      ·

      💻 ${escapeHTML(
        visitor.device?.os ||
        "Unknown"
      )}

      <br>

      🌐 ${escapeHTML(
        visitor.device?.browser ||
        "Unknown"
      )}

      <br>

      🏢 ${escapeHTML(
        visitor.isp ||
        "Unknown"
      )}

      <br>

      🔢 ${escapeHTML(
        visitor.asn ||
        "Unknown"
      )}

      <br>

      🕐 ${formatTime(
        new Date(visitor.createdAt)
      )}

    </div>
  `;

  container.prepend(item);

  while (
    container.children.length > 100
  ) {
    container.lastElementChild.remove();
  }
}

/* =========================================================
   UTILS
========================================================= */

function formatTime(date) {
  if (
    !date ||
    Number.isNaN(date.getTime())
  ) {
    return "Unknown";
  }

  return date.toLocaleString(
    undefined,
    {
      dateStyle: "short",
      timeStyle: "medium"
    }
  );
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  const toast =
    $("toast");

  toast.textContent =
    message;

  toast.classList.add("show");

  setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

/* =========================================================
   EVENTS
========================================================= */

$("liveButton")
  .addEventListener(
    "click",
    openPasswordModal
  );

$("closeModal")
  .addEventListener(
    "click",
    closePasswordModal
  );

$("unlockButton")
  .addEventListener(
    "click",
    unlockLive
  );

$("closeLive")
  .addEventListener(
    "click",
    closeLivePanel
  );

$("livePassword")
  .addEventListener(
    "keydown",
    event => {
      if (event.key === "Enter") {
        unlockLive();
      }
    }
  );

/* =========================================================
   START
========================================================= */

initMap();

loadHistory();

loadStats();

connectLive();

/*
  Browser itself is the visitor.
  This is the ONLY place where /api/track
  is called from the dashboard.
*/
trackVisitor();

setInterval(
  loadStats,
  30000
);

setInterval(
  () => {
    if (liveToken) {
      loadProtectedLive();
    }
  },
  30000
);
