let map;
let currentVisitor = null;
let liveStream = null;


/* =========================================================
   HELPERS
========================================================= */

const $ = id =>
  document.getElementById(id);


function text(
  id,
  value
) {

  const el = $(id);

  if (el) {
    el.textContent =
      value ??
      "Unavailable";
  }
}


function escapeHTML(value) {

  return String(
    value ?? ""
  )
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


function formatTime(date) {

  if (
    !date ||
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "Unknown";
  }

  return date.toLocaleString();
}


/* =========================================================
   MAP
========================================================= */

function initMap() {

  map =
    L.map(
      "map",
      {
        zoomControl: true,
        worldCopyJump: true
      }
    )
    .setView(
      [
        23.8103,
        90.4125
      ],
      3
    );

  L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 18,
      attribution:
        "© OpenStreetMap"
    }
  ).addTo(map);
}


function showMap(visitor) {

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

  const marker =
    L.circleMarker(
      [lat, lng],
      {
        radius: 9,
        color: "#52ffe0",
        fillColor: "#52ffe0",
        fillOpacity: .55,
        weight: 2
      }
    ).addTo(map);

  marker.bindPopup(`
    <b>
      ${escapeHTML(
        visitor.flag ||
        "🌐"
      )}
      ${escapeHTML(
        visitor.country ||
        "Unknown"
      )}
    </b>
    <br>
    ${escapeHTML(
      visitor.city ||
      "Unknown"
    )}
  `).openPopup();

  map.setView(
    [lat, lng],
    6
  );
}


/* =========================================================
   OWN VISITOR
========================================================= */

async function loadOwnVisitor() {

  try {

    const response =
      await fetch(
        "/api/track",
        {
          cache: "no-store"
        }
      );

    const data =
      await response.json();

    if (
      !data.success
    ) {
      throw new Error(
        data.message
      );
    }

    currentVisitor =
      data.visitor;

    renderOwnVisitor(
      data.visitor
    );

  } catch (error) {

    console.error(
      error
    );

    text(
      "heroIP",
      "Detection failed"
    );

    text(
      "ip",
      "Unavailable"
    );
  }
}


function renderOwnVisitor(
  visitor
) {

  const device =
    visitor.device ||
    {};

  text(
    "heroIP",
    visitor.ip
  );

  text(
    "heroFlag",
    visitor.flag ||
      "🌐"
  );

  text(
    "heroLocation",
    [
      visitor.city,
      visitor.region,
      visitor.country
    ]
      .filter(Boolean)
      .join(", ")
  );


  text(
    "ip",
    visitor.ip
  );

  text(
    "country",
    visitor.country
  );

  text(
    "countryCode",
    visitor.countryCode
  );

  text(
    "region",
    visitor.region
  );

  text(
    "city",
    visitor.city
  );

  text(
    "postal",
    visitor.postal
  );

  text(
    "timezone",
    visitor.timezone
  );


  text(
    "isp",
    visitor.isp
  );

  text(
    "organization",
    visitor.organization
  );

  text(
    "asn",
    visitor.asn
  );


  text(
    "deviceType",
    device.type
  );

  text(
    "vendor",
    device.vendor
  );

  text(
    "model",
    device.model
  );

  text(
    "os",
    device.os
  );

  text(
    "browser",
    device.browser
  );

  text(
    "engine",
    device.engine
  );

  text(
    "userAgent",
    device.userAgent ||
      visitor.userAgent
  );


  const icon =
    device.type ===
    "mobile"
      ? "📱"
      : device.type ===
        "tablet"
        ? "📲"
        : "💻";

  text(
    "deviceIcon",
    icon
  );


  text(
    "timestamp",
    formatTime(
      new Date(
        visitor.createdAt
      )
    )
  );


  showMap(
    visitor
  );
}


/* =========================================================
   PASSWORD
========================================================= */

function openPassword() {

  $("passwordModal")
    .classList.remove(
      "hidden"
    );

  $("password").value = "";

  $("passwordError")
    .textContent = "";

  setTimeout(
    () =>
      $("password").focus(),
    100
  );
}


function closePassword() {

  $("passwordModal")
    .classList.add(
      "hidden"
    );
}


async function unlockLive() {

  const password =
    $("password").value;

  if (!password) {

    $("passwordError")
      .textContent =
      "ENTER PASSWORD";

    return;
  }

  $("unlock").disabled =
    true;

  $("unlock").textContent =
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

          body:
            JSON.stringify({
              password
            })
        }
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      !data.success
    ) {
      throw new Error(
        "Invalid password"
      );
    }

    closePassword();

    $("liveModal")
      .classList.remove(
        "hidden"
      );

    await loadHistory();

    await loadStats();

    connectProtectedLive();

  } catch {

    $("passwordError")
      .textContent =
      "ACCESS DENIED";

  } finally {

    $("unlock").disabled =
      false;

    $("unlock").textContent =
      "UNLOCK";
  }
}


/* =========================================================
   HISTORY
========================================================= */

async function loadHistory() {

  const history =
    $("history");

  history.innerHTML =
    `<div class="loading">
      Loading visitor database...
    </div>`;

  try {

    const response =
      await fetch(
        "/api/history?limit=50",
        {
          credentials:
            "same-origin"
        }
      );

    if (
      response.status === 401
    ) {

      history.innerHTML =
        `<div class="loading">
          🔒 Access expired.
        </div>`;

      return;
    }

    const data =
      await response.json();

    if (
      !data.success
    ) {
      throw new Error();
    }

    if (
      !data.data.length
    ) {

      history.innerHTML =
        `<div class="loading">
          No visitor records yet.
        </div>`;

      return;
    }

    history.innerHTML =
      data.data
        .map(
          visitor =>
            historyCard(
              visitor
            )
        )
        .join("");

  } catch {

    history.innerHTML =
      `<div class="loading">
        Unable to load history.
      </div>`;
  }
}


function historyCard(
  visitor
) {

  const device =
    visitor.device ||
    {};

  return `

    <div class="history-card">

      <div class="flag">
        ${escapeHTML(
          visitor.flag ||
          "🌐"
        )}
      </div>


      <div>

        <strong>
          ${escapeHTML(
            visitor.country ||
            "Unknown"
          )}
        </strong>

        <small>
          ${escapeHTML(
            visitor.city ||
            "Unknown"
          )}
        </small>

      </div>


      <div>

        <small>
          IP
        </small>

        <div class="ip">
          ${escapeHTML(
            visitor.ip ||
            "Hidden"
          )}
        </div>

      </div>


      <div>

        <small>
          DEVICE
        </small>

        <strong>
          ${escapeHTML(
            device.type ||
            "Unknown"
          )}
        </strong>

        <small>
          ${escapeHTML(
            device.os ||
            "Unknown"
          )}
        </small>

      </div>


      <div>

        <small>
          ISP
        </small>

        <strong>
          ${escapeHTML(
            visitor.isp ||
            "Unknown"
          )}
        </strong>

        <small>
          ${formatTime(
            new Date(
              visitor.createdAt
            )
          )}
        </small>

      </div>

    </div>
  `;
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
          credentials:
            "same-origin"
        }
      );

    if (
      response.status === 401
    ) {
      return;
    }

    const data =
      await response.json();

    if (
      !data.success
    ) {
      return;
    }

    text(
      "adminTotal",
      data.totalVisitors
    );

    text(
      "adminToday",
      data.todayVisitors
    );

    text(
      "adminCountries",
      data.countries.length
    );

    text(
      "adminDevices",
      data.devices.length
    );


    renderAnalytics(
      "countries",
      data.countries
    );

    renderAnalytics(
      "devices",
      data.devices
    );

    renderAnalytics(
      "isps",
      data.isps
    );

  } catch (error) {

    console.error(
      error
    );
  }
}


function renderAnalytics(
  id,
  items
) {

  const el =
    $(id);

  if (
    !items ||
    !items.length
  ) {

    el.innerHTML =
      "No data";

    return;
  }

  el.innerHTML =
    `<div class="analytics-list">
      ${
        items
          .slice(0, 6)
          .map(
            item => `
              <div
                class="analytics-row"
              >
                <span>
                  ${escapeHTML(
                    item.name
                  )}
                </span>

                <b>
                  ${item.count}
                </b>
              </div>
            `
          )
          .join("")
      }
    </div>`;
}


/* =========================================================
   PROTECTED LIVE
========================================================= */

function connectProtectedLive() {

  if (liveStream) {
    liveStream.close();
  }

  /*
    Cookie is HttpOnly, so browser automatically
    sends it with EventSource.
  */

  liveStream =
    new EventSource(
      "/api/live"
    );

  liveStream.addEventListener(
    "visitor",
    event => {

      try {

        const visitor =
          JSON.parse(
            event.data
          );

        /*
          Reload the protected history
          so the admin sees the new
          visitor in correct order.
        */

        loadHistory();

        loadStats();

      } catch {}
    }
  );

  liveStream.onerror =
    () => {

      if (liveStream) {
        liveStream.close();
      }
    };
}


/* =========================================================
   CLOSE LIVE
========================================================= */

function closeLive() {

  if (liveStream) {

    liveStream.close();

    liveStream =
      null;
  }

  $("liveModal")
    .classList.add(
      "hidden"
    );
}


/* =========================================================
   EVENTS
========================================================= */

$("openLive")
  .addEventListener(
    "click",
    openPassword
  );


$("closePassword")
  .addEventListener(
    "click",
    closePassword
  );


$("unlock")
  .addEventListener(
    "click",
    unlockLive
  );


$("closeLive")
  .addEventListener(
    "click",
    closeLive
  );


$("password")
  .addEventListener(
    "keydown",
    event => {

      if (
        event.key ===
        "Enter"
      ) {

        unlockLive();
      }
    }
  );


/* =========================================================
   START
========================================================= */

initMap();

/*
  ONLY THIS VISITOR'S DATA.
*/
loadOwnVisitor();
