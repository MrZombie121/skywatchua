const statusNode = document.getElementById("status");
const params = new URLSearchParams(window.location.search);
const apiKey = params.get("api_key") || "";
const map = L.map("map", {
  zoomControl: false,
  attributionControl: true
}).setView([49, 31], 6);

L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 20,
  subdomains: "abcd",
  attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
}).addTo(map);

const layer = L.layerGroup().addTo(map);

function setStatus(message) {
  statusNode.textContent = message;
}

function colorByType(type) {
  if (String(type).includes("missile")) return "#ff8a5b";
  if (String(type).includes("kab")) return "#ffc857";
  if (String(type).includes("air")) return "#7dd3fc";
  return "#48c2ff";
}

function renderEvents(events) {
  layer.clearLayers();
  const points = [];
  events.forEach((event) => {
    if (!Number.isFinite(Number(event.lat)) || !Number.isFinite(Number(event.lng))) return;
    const marker = L.circleMarker([Number(event.lat), Number(event.lng)], {
      radius: 7,
      weight: 2,
      color: colorByType(event.type),
      fillColor: colorByType(event.type),
      fillOpacity: 0.45
    });
    marker.bindTooltip(`${event.type || "target"}<br>${new Date(event.timestamp || Date.now()).toLocaleString("uk-UA")}`);
    marker.addTo(layer);
    points.push([Number(event.lat), Number(event.lng)]);
  });

  if (points.length) {
    map.fitBounds(points, { padding: [24, 24], maxZoom: 9 });
    setStatus(`Цілей: ${points.length}`);
  } else {
    setStatus("Активних цілей зараз немає.");
  }
}

async function refresh() {
  if (!apiKey) {
    setStatus("API key не передано.");
    return;
  }

  try {
    const response = await fetch(`/api/embed/events?api_key=${encodeURIComponent(apiKey)}`, {
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "request_failed");
    }
    if (data.maintenance) {
      layer.clearLayers();
      setStatus("Сервіс тимчасово у режимі технічних робіт.");
      return;
    }
    renderEvents(Array.isArray(data.events) ? data.events : []);
  } catch (error) {
    layer.clearLayers();
    setStatus(error.message === "invalid_api_key" ? "Невірний API key." : "Не вдалося завантажити карту.");
  }
}

refresh();
setInterval(refresh, 12000);
