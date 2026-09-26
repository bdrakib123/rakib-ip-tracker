const $ = id =>
  document.getElementById(id);

let map;
let marker;

const markers = [];

function value(
  v,
  fallback = "Unavailable"
) {
  return (
    v === null ||
    v === undefined ||
    v === ""
  )
    ? fallback
    : v;
}

/* =========================================================
   MAP
========================================================= */

function initMap() {

  map = L.map("map", {
    zoomControl: true,
    attributionControl: true
  }).setView(
    [23.685, 90.3563],
    6
  );

  L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 18,
      attribution:
        "&copy; OpenStreetMap contributors"
    }
  ).addTo(map);
}

function updateMap(
  latitude,
  longitude,
  visitor
) {

  if (
    latitude === null ||
    longitude === null ||
    latitude === undefined ||
    longitude === undefined
  ) {
    return;
  }

  const coords =
    [latitude, longitude];

  if (marker) {
    marker.setLatLng(coords);
  } else {

    marker =
      L.marker(coords)
        .addTo(map);
  }

  marker.bindPopup(`
    <b>${value(visitor.flag, "🌐")}
    ${value(visitor.city, "Unknown")}</b>
    <br>
    ${value(visitor.country, "Unknown")}
    <br>
    <small>
      Approximate IP location
    </small>
  `);

  map.setView(
    coords,
    9,
    {
      animate: true
    }
  );
}

/* =========================================================
   CURRENT VISITOR
========================================================= */

async function loadVisitor() {

  try {

    const response =
      await fetch(
        "/api/track",
        {
          cache: "no-store",
          headers: {
            Accept:
              "application/json"
          }
        }
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      !data.success
    ) {
      throw new Error(
        data.error ||
        "Request failed"
      );
    }

    const v =
      data.visitor;

    const d =
      data.device;

    $("ip").textContent =
      value(v.ip);

    $("location").textContent =
      [
        v.city,
        v.region
      ]
        .filter(Boolean)
        .join(", ") ||
      "Unavailable";

    $("country").textContent =
      [
        v.countryCode
          ? `${v.countryCode} ${countryFlag(v.countryCode)}`
          : null,
        v.country
      ]
        .filter(Boolean)
        .join(" • ") ||
      "Unavailable";

    $("isp").textContent =
      value(v.isp);

    $("asn").textContent =
      value(v.asn);

    $("timezone").textContent =
      value(v.timezone);

    $("postal").textContent =
      value(v.postal);

    $("device").textContent =
      [
        d.vendor,
        d.model
      ]
        .filter(Boolean)
        .join(" ") ||
      value(d.type);

    $("os").textContent =
      value(d.os);

    $("browser").textContent =
      value(d.browser);

    $("techDevice").textContent =
      [
        d.vendor,
        d.model
      ]
        .filter(Boolean)
        .join(" ") ||
      value(d.type);

    $("techOS").textContent =
      value(d.os);

    $("techBrowser").textContent =
      value(d.browser);

    $("engine").textContent =
      value(d.engine);

    $("region").textContent =
      value(v.region);

    $("coordinates").textContent =
      v.latitude !== null &&
      v.longitude !== null
        ? `${v.latitude}, ${v.longitude}`
        : "Unavailable";

    updateMap(
      v.latitude,
      v.longitude,
      {
        ...v,
        flag:
          countryFlag(
            v.countryCode
          )
      }
    );

    $("status").textContent =
      "✓ Visitor information loaded";

    $("status").style.color =
      "#91f0c4";

  } catch (error) {

    console.error(error);

    $("status").textContent =
      "Unable to load visitor information";

    $("status").style.color =
      "#ff9b9b";
  }
}

/* =========================================================
   FLAG
========================================================= */

function countryFlag(code) {

  if (
    !code ||
    code.length !== 2
  ) {
    return "🌐";
  }

  return code
    .toUpperCase()
    .split("")
    .map(c =>
      String.fromCodePoint(
        127397 +
        c.charCodeAt(0)
      )
    )
    .join("");
}

/* =========================================================
   STATS
========================================================= */

async function loadStats() {

  try {

    const response =
      await fetch(
        "/api/stats",
        {
          cache: "no-store"
        }
      );

    const data =
      await response.json();

    if (!data.success) {
      return;
    }

    $("total").textContent =
      data.total;

    $("countries").textContent =
      data.countries;

    $("mobile").textContent =
      data.mobile;

    $("desktop").textContent =
      data.desktop;

    $("liveCount").textContent =
      `${data.live} LIVE`;

  } catch (error) {
    console.error(
      "Stats error:",
      error
    );
  }
}

/* =========================================================
   VISITOR LIST
========================================================= */

function addVisitor(visitor) {

  const list =
    $("visitorList");

  const empty =
    list.querySelector(".empty");

  if (empty) {
    empty.remove();
  }

  const item =
    document.createElement("div");

  item.className =
    "visitor";

  const device =
    visitor.device || {};

  const deviceName =
    [
      device.vendor,
      device.model
    ]
      .filter(Boolean)
      .join(" ") ||
    value(
      device.type,
      "Unknown device"
    );

  const location =
    [
      visitor.city,
      visitor.country
    ]
      .filter(Boolean)
      .join(", ") ||
    "Unknown location";

  item.innerHTML = `
    <div class="visitor-flag">
      ${value(visitor.flag, "🌐")}
    </div>

    <div class="visitor-main">

      <strong>
        ${escapeHTML(location)}
      </strong>

      <span>
        ${escapeHTML(deviceName)}
        •
        ${escapeHTML(
          value(
            device.browser,
            "Unknown browser"
          )
        )}
        •
        ${escapeHTML(
          value(
            visitor.isp,
            "Unknown ISP"
          )
        )}
      </span>

    </div>

    <div class="visitor-time">
      JUST NOW
    </div>
  `;

  list.prepend(item);

  while (
    list.children.length > 20
  ) {
    list.lastElementChild.remove();
  }
}

/* =========================================================
   HISTORY
========================================================= */

async function loadHistory() {

  try {

    const response =
      await fetch(
        "/api/history",
        {
          cache: "no-store"
        }
      );

    const data =
      await response.json();

    if (!data.success) {
      return;
    }

    $("total").textContent =
      data.total;

    $("countries").textContent =
      Object.keys(
        data.countries || {}
      ).length;

    $("mobile").textContent =
      data.devices?.mobile || 0;

    $("desktop").textContent =
      data.devices?.desktop || 0;

    const list =
      $("visitorList");

    list.innerHTML = "";

    if (
      !data.visitors ||
      !data.visitors.length
    ) {

      list.innerHTML = `
        <div class="empty">
          Waiting for visitors...
        </div>
      `;

      return;
    }

    data.visitors
      .slice(0, 20)
      .forEach(addVisitor);

  } catch (error) {

    console.error(
      "History error:",
      error
    );
  }
}

/* =========================================================
   LIVE CONNECTION
========================================================= */

function connectLive() {

  if (!window.EventSource) {
    return;
  }

  const source =
    new EventSource(
      "/api/live"
    );

  source.addEventListener(
    "visitor",
    event => {

      try {

        const visitor =
          JSON.parse(
            event.data
          );

        addVisitor(visitor);

        loadStats();

      } catch (error) {

        console.error(
          "Live visitor error:",
          error
        );
      }

    }
  );

  source.onerror = () => {

    /*
     * Browser EventSource automatically
     * reconnects.
     */

    $("liveCount").textContent =
      "RECONNECTING";
  };

}

/* =========================================================
   ESCAPE
========================================================= */

function escapeHTML(value) {

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =========================================================
   START
========================================================= */

initMap();

loadVisitor();

loadHistory();

loadStats();

connectLive();

setInterval(
  loadStats,
  10000
);
