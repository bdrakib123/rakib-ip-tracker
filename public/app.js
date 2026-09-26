const $ = (id) => document.getElementById(id);

function value(v, fallback = "Unavailable") {
  return v === null || v === undefined || v === "" ? fallback : v;
}

async function loadVisitorInfo() {
  const status = $("status");

  try {
    const response = await fetch("/api/track", {
      cache: "no-store",
      headers: { "Accept": "application/json" }
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Request failed");
    }

    const v = data.visitor;
    const d = data.device;

    $("ip").textContent = value(v.ip);
    $("device").textContent =
      [d.vendor, d.model].filter(Boolean).join(" ") ||
      value(d.type);

    $("os").textContent = value(d.os);
    $("location").textContent =
      [v.city, v.region, v.country].filter(Boolean).join(", ") ||
      "Unavailable";

    $("isp").textContent =
      [v.isp, v.organization].filter(Boolean).join(" • ") ||
      "Unavailable";

    $("asn").textContent = value(v.asn);
    $("timezone").textContent = value(v.timezone);
    $("browser").textContent = value(d.browser);

    $("country").textContent =
      [v.country, v.countryCode].filter(Boolean).join(" • ");

    $("region").textContent = value(v.region);
    $("city").textContent = value(v.city);
    $("postal").textContent = value(v.postal);

    $("coordinates").textContent =
      v.latitude !== null && v.longitude !== null
        ? `${v.latitude}, ${v.longitude} (IP estimate)`
        : "Approximate / unavailable";

    $("engine").textContent = value(d.engine);

    status.textContent = "✓ Information loaded";
    status.style.color = "#9ef0d1";
  } catch (error) {
    console.error(error);
    status.textContent =
      "Could not load visitor information. Please try again.";
    status.style.color = "#ff9b9b";
  }
}

loadVisitorInfo();