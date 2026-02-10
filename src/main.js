import { sources } from "./data/sources.js";
import { oblasts } from "./data/oblasts.js";
import "./styles.css";

const L = window.L;

const map = L.map("map", {
  zoomControl: true,
  attributionControl: true
}).setView([49.0, 31.0], 6);

const alarmsEnabled = true;

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const markerLayer = L.layerGroup().addTo(map);
const alarmLayer = L.layerGroup().addTo(map);
const trackLayer = L.layerGroup().addTo(map);
const shahedTrailLayer = L.layerGroup().addTo(map);
let oblastGeoLayer = null;
let oblastGeoReady = false;
const markerById = new Map();
const eventById = new Map();
const driftById = new Map();
let driftTimer = null;
let maintenanceTimer = null;
let activeTrackId = null;
let activeTrackLine = null;

const state = {
  events: [],
  types: new Set(),
  sources: new Set(),
  selectedTypes: new Set(),
  selectedSources: new Set(),
  showTests: true,
  maintenance: false,
  maintenanceUntil: null,
  alarms: [],
  adminBypassMaintenance: false,
  refreshPaused: false,
  autoFollow: false
};

const typeContainer = document.getElementById("type-filters");
const sourceContainer = document.getElementById("source-filters");
const toggleTests = document.getElementById("toggle-tests");
const lastUpdated = document.getElementById("last-updated");
const maintenanceBanner = document.getElementById("maintenance-banner");
const maintenanceScreen = document.getElementById("maintenance-screen");
const maintenanceScreenText = document.getElementById("maintenance-screen-text");
const maintenanceAdminOpen = document.getElementById("maintenance-admin-open");
const adminOpen = document.getElementById("admin-open");
const adminModal = document.getElementById("admin-modal");
const adminClose = document.getElementById("admin-close");
const adminLoginForm = document.getElementById("admin-login-form");
const adminPanel = document.getElementById("admin-panel");
const adminStatus = document.getElementById("admin-status");
const maintenanceToggle = document.getElementById("maintenance-toggle");
const maintenanceUntil = document.getElementById("maintenance-until");
const maintenanceMinutes = document.getElementById("maintenance-minutes");
const maintenanceUntilInput = document.getElementById("maintenance-until-input");
const maintenanceApply = document.getElementById("maintenance-apply");
const maintenanceClear = document.getElementById("maintenance-clear");
const maintenanceShow = document.getElementById("maintenance-show");
const testType = document.getElementById("test-type");
const testCity = document.getElementById("test-city");
const testSea = document.getElementById("test-sea");
const testDirection = document.getElementById("test-direction");
const testNote = document.getElementById("test-note");
const testAdd = document.getElementById("test-add");
const testClear = document.getElementById("test-clear");
const adminLogout = document.getElementById("admin-logout");
const radarList = document.getElementById("radar-list");
const alarmList = document.getElementById("alarm-list");
const toolPanel = document.getElementById("tool-panel");
const toolOpen = document.getElementById("tool-open");
const toolClose = document.getElementById("tool-close");
const toolSettings = document.getElementById("tool-settings");
const settingsModal = document.getElementById("settings-modal");
const settingsClose = document.getElementById("settings-close");
const themeOptions = document.querySelectorAll("input[name=\"theme\"]");
const themeCustom = document.getElementById("theme-custom");
const themeAccent = document.getElementById("theme-accent");
const themeBg = document.getElementById("theme-bg");
const themePanel = document.getElementById("theme-panel");
const themeApply = document.getElementById("theme-apply");
const panelToggle = document.getElementById("panel-toggle");
const panelBackdrop = document.getElementById("panel-backdrop");
const toggleRefresh = document.getElementById("toggle-refresh");
const toggleFollow = document.getElementById("toggle-follow");
const toolTabs = toolPanel ? toolPanel.querySelectorAll("button[data-tab]") : [];

const typeLabels = {
  shahed: "Shahed",
  missile: "Missile",
  kab: "KAB",
  airplane: "Air",
  recon: "Recon"
};
const iconRotationOffset = 0;
const ADM1_GEOJSON_URL = "/data/ukr-adm1.geojson";
const isoToRegionId = {
  "UA-05": "vinnytska",
  "UA-07": "volynska",
  "UA-09": "luhanska",
  "UA-12": "dniprovska",
  "UA-14": "donetska",
  "UA-18": "zhytomyrska",
  "UA-21": "zakarpatska",
  "UA-23": "zaporizka",
  "UA-26": "ivano-frankivska",
  "UA-30": "kyiv",
  "UA-32": "kyivska",
  "UA-35": "kirovohradska",
  "UA-46": "lvivska",
  "UA-48": "mykolaivska",
  "UA-51": "odeska",
  "UA-53": "poltavska",
  "UA-56": "rivnenska",
  "UA-59": "sumyska",
  "UA-61": "ternopilska",
  "UA-63": "kharkivska",
  "UA-65": "khersonska",
  "UA-68": "khmelnytska",
  "UA-71": "cherkaska",
  "UA-74": "chernihivska",
  "UA-77": "chernivetska"
};
const oblastAliases = {
  kyivska: ["kyivska", "kievska", "київська", "киевская"],
  kyiv: ["kyiv city", "kyiv", "kiev", "київ", "киев"],
  kharkivska: ["kharkivska", "kharkovska", "харківська", "харьковская"],
  odeska: ["odeska", "odessa", "одеська", "одесская"],
  lvivska: ["lvivska", "lvovska", "львівська", "львовская"],
  dniprovska: ["dnipropetrovska", "dnepropetrovska", "дніпропетровська", "днепропетровская"],
  zaporizka: ["zaporizka", "zaporozka", "запорізька", "запорожская"],
  mykolaivska: ["mykolaivska", "nikolaevska", "миколаївська", "николаевская"],
  khersonska: ["khersonska", "херсонська", "херсонская"],
  chernihivska: ["chernihivska", "chernigovska", "чернігівська", "черниговская"],
  sumyska: ["sumyska", "sumy", "сумська", "сумская"],
  poltavska: ["poltavska", "полтавська", "полтавская"],
  rivnenska: ["rivnenska", "rivne", "рівненська", "ровенская"],
  volynska: ["volynska", "volyn", "волинська", "волынская"],
  ternopilska: ["ternopilska", "ternopil", "тернопільська", "тернопольская"],
  "ivano-frankivska": ["ivano-frankivska", "ivano-frankivsk", "івано-франківська", "ивано-франковская"],
  chernivetska: ["chernivetska", "chernivtsi", "чернівецька", "черновицкая"],
  zakarpatska: ["zakarpatska", "zakarpattia", "закарпатська", "закарпатская"],
  khmelnytska: ["khmelnytska", "khmelnytskyi", "хмельницька", "хмельницкая"],
  vinnytska: ["vinnytska", "vinnytsia", "вінницька", "винницкая"],
  zhytomyrska: ["zhytomyrska", "zhytomyr", "житомирська", "житомирская"],
  cherkaska: ["cherkaska", "cherkasy", "черкаська", "черкасская"],
  kirovohradska: ["kirovohradska", "kirovohrad", "kirovograd", "кіровоградська", "кировоградская"],
  donetska: ["donetska", "donetsk", "донецька", "донецкая"],
  luhanska: ["luhanska", "luhansk", "луганська", "луганская"]
};

function normalizeType(type) {
  if (!type) return "other";
  const key = String(type).toLowerCase();
  if (key.includes("shahed")) return "shahed";
  if (key.includes("missile")) return "missile";
  if (key.includes("kab")) return "kab";
  if (key.includes("recon")) return "recon";
  if (key.includes("air")) return "airplane";
  return "shahed";
}

function normalizeEvent(raw, sourceId) {
  const type = normalizeType(raw.type || raw.target_type || raw.category);
  return {
    id: raw.id || `${sourceId}-${raw.timestamp || raw.time || Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    lat: Number(raw.lat ?? raw.latitude ?? raw.location?.lat ?? 0),
    lng: Number(raw.lng ?? raw.longitude ?? raw.location?.lng ?? 0),
    direction: Number(raw.direction ?? raw.heading ?? 0),
    source: raw.source || sourceId,
    timestamp: raw.timestamp || raw.time || new Date().toISOString(),
    comment: raw.comment || raw.note || "",
    is_test: Boolean(raw.is_test ?? raw.isTest ?? false),
    raw_text: raw.raw_text || raw.message || ""
  };
}

async function fetchSource(source) {
  const response = await fetch(source.url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Source ${source.id} responded with ${response.status}`);
  }
  const payload = await response.json();
  if (typeof payload.maintenance === "boolean") {
    state.maintenance = payload.maintenance;
  }
  if (Array.isArray(payload.alarms)) {
    state.alarms = payload.alarms;
  } else {
    state.alarms = [];
  }
  if (payload.maintenance_until) {
    state.maintenanceUntil = payload.maintenance_until;
  } else {
    state.maintenanceUntil = null;
  }
  const items = Array.isArray(payload)
    ? payload
    : payload.events || payload.items || payload.data || [];
  return items.map((item) => normalizeEvent(item, source.id));
}

async function loadEvents() {
  const results = await Promise.allSettled(sources.map(fetchSource));
  const merged = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      merged.push(...result.value);
    } else {
      console.warn("Source failed", sources[index].id, result.reason);
    }
  });
  return merged.filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lng));
}

function updateFilterSets(events) {
  state.types = new Set(events.map((event) => event.type || "other"));
  state.sources = new Set(events.map((event) => event.source).filter(Boolean));

  if (state.selectedTypes.size === 0) {
    state.selectedTypes = new Set(state.types);
  } else {
    state.types.forEach((type) => {
      if (!state.selectedTypes.has(type)) {
        state.selectedTypes.add(type);
      }
    });
  }

  if (state.selectedSources.size === 0) {
    state.selectedSources = new Set(state.sources);
  }
}

function createFilterChip({ id, label, checked, onChange }) {
  const wrapper = document.createElement("label");
  wrapper.className = "filter-chip";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));

  const text = document.createElement("span");
  text.textContent = label;

  wrapper.appendChild(input);
  wrapper.appendChild(text);
  return wrapper;
}

function renderFilterControls() {
  typeContainer.innerHTML = "";
  sourceContainer.innerHTML = "";

  Array.from(state.types)
    .sort()
    .forEach((type) => {
      const label = typeLabels[type] || type.toUpperCase();
      const chip = createFilterChip({
        id: type,
        label,
        checked: state.selectedTypes.has(type),
        onChange: (checked) => {
          if (checked) {
            state.selectedTypes.add(type);
          } else {
            state.selectedTypes.delete(type);
          }
          renderMarkers();
        }
      });
      typeContainer.appendChild(chip);
    });

  Array.from(state.sources)
    .sort()
    .forEach((sourceId) => {
      const labelSource = sources.find((source) => source.id === sourceId);
      const label = labelSource ? labelSource.label : sourceId;
      const chip = createFilterChip({
        id: sourceId,
        label,
        checked: state.selectedSources.has(sourceId),
        onChange: (checked) => {
          if (checked) {
            state.selectedSources.add(sourceId);
          } else {
            state.selectedSources.delete(sourceId);
          }
          renderMarkers();
        }
      });
      sourceContainer.appendChild(chip);
    });
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour12: false
  });
}

function normalizeRegionName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/(oblast|region|область|обл\.?)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchRegionId(name) {
  const normalized = normalizeRegionName(name);
  for (const [id, aliases] of Object.entries(oblastAliases)) {
    if (aliases.some((alias) => normalized.includes(normalizeRegionName(alias)))) {
      return id;
    }
  }
  return null;
}

async function ensureOblastLayer() {
  if (oblastGeoReady) return;
  try {
    const response = await fetch(ADM1_GEOJSON_URL, { cache: "force-cache" });
    if (!response.ok) throw new Error("geojson fetch failed");
    const geojson = await response.json();
    oblastGeoLayer = L.geoJSON(geojson, {
      style: { color: "transparent", weight: 0, fillOpacity: 0 },
      onEachFeature: (feature, layer) => {
        const props = feature.properties || {};
        const name =
          props.shapeName || props.NAME_1 || props.name || props.shapeName || props.shapeNameEnglish;
        const iso = props.shapeISO || props.ISO_3166_2 || props.iso;
        const id = isoToRegionId[iso] || matchRegionId(name);
        if (id) {
          feature.properties._regionId = id;
        }
        layer.addTo(alarmLayer);
      }
    });
    oblastGeoReady = true;
  } catch (error) {
    console.warn("Failed to load oblast geojson", error);
    oblastGeoReady = false;
  }
}

function makeMarkerIcon(event) {
  const typeClass = state.types.has(event.type) ? event.type : "shahed";
  const iconMap = {
    shahed: "/ico/shahed.png",
    missile: "/ico/missle.png",
    kab: "/ico/kab.png",
    airplane: "/ico/airplane.png",
    recon: "/ico/bplaviewer.png",
    other: "/ico/shahed.png"
  };
  const iconUrl = iconMap[typeClass] || iconMap.other;
  const html = `
    <div class="marker-wrap">
      <img
        class="marker-icon-img ${typeClass} ${event.is_test ? "test" : "real"}"
        src="${iconUrl}"
        alt="${typeClass}"
        style="transform: rotate(${(event.direction || 0) + iconRotationOffset}deg);"
      />
    </div>
  `;

  return L.divIcon({
    className: "",
    html,
    iconSize: [44, 44],
    iconAnchor: [22, 22]
  });
}

function updateMarkerScale() {
  const zoom = map.getZoom();
  const scale = Math.min(1.8, Math.max(0.7, 1.5 - (zoom - 5) * 0.1));
  document.documentElement.style.setProperty("--marker-scale", scale.toFixed(2));
}

function normalizeAngle(angle) {
  const mod = angle % 360;
  return mod < 0 ? mod + 360 : mod;
}

function pickNextDirection(current) {
  const delta = (Math.random() * 90) - 45;
  return normalizeAngle(current + delta);
}

function resetDrift() {
  if (driftTimer) {
    cancelAnimationFrame(driftTimer);
    driftTimer = null;
  }
}

function startDrift() {
  if (driftTimer || driftById.size === 0) return;
  const speedMps = 1.4;
  const maxDistanceKm = 5;
  const turnIntervalMs = 12000;
  const turnRate = 35;
  const turnHoldMs = 900;
  let lastFrame = performance.now();
  const animate = (now) => {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const zoom = map.getZoom();
    const zoomFactor = zoom <= 7 ? 0.25 : zoom <= 9 ? 0.5 : 1;
    driftById.forEach((item) => {
      if (item.distanceKm >= maxDistanceKm) return;
      if (!item.lastTurnAt) item.lastTurnAt = now;
      if (!Number.isFinite(item.targetDirection)) {
        item.targetDirection = normalizeAngle(item.direction);
      }
      if (now - item.lastTurnAt > turnIntervalMs) {
        item.targetDirection = pickNextDirection(item.direction);
        item.lastTurnAt = now;
        item.turnUntil = now + turnHoldMs;
      }
      const delta = ((item.targetDirection - item.direction + 540) % 360) - 180;
      const maxStep = turnRate * dt;
      if (Math.abs(delta) <= maxStep) {
        item.direction = item.targetDirection;
      } else {
        item.direction = normalizeAngle(item.direction + Math.sign(delta) * maxStep);
      }
      if (!item.turnUntil || now >= item.turnUntil) {
        const stepKm = (speedMps * dt * zoomFactor) / 1000;
        item.distanceKm = Math.min(maxDistanceKm, item.distanceKm + stepKm);
      }
      const distanceKm = item.distanceKm * zoomFactor;
      const distanceDegLat = distanceKm / 111;
      const rad = (item.direction * Math.PI) / 180;
      const lat = item.baseLat + distanceDegLat * Math.cos(rad);
      const lng =
        item.baseLng + (distanceDegLat * Math.sin(rad)) / Math.cos((item.baseLat * Math.PI) / 180);
      item.marker.setLatLng([lat, lng], { animate: true });
      const el = item.marker.getElement();
      if (el) {
        const img = el.querySelector(".marker-icon-img");
        if (img) {
          img.style.transform = `rotate(${item.direction + iconRotationOffset}deg)`;
        }
      }
      if (item.track) {
        const last = item.track[item.track.length - 1];
        if (!last || Math.abs(last[0] - lat) > 0.0008 || Math.abs(last[1] - lng) > 0.0008) {
          item.track.push([lat, lng]);
          if (item.track.length > 80) item.track.shift();
          if (activeTrackId === item.id && activeTrackLine) {
            activeTrackLine.setLatLngs(item.track);
          }
          if (item.trailLine) {
            item.trailLine.setLatLngs(item.track);
          }
        }
      }
    });
    driftTimer = requestAnimationFrame(animate);
  };
  driftTimer = requestAnimationFrame(animate);
}

function getVisibleEvents() {
  return state.events.filter((event) => {
    if (!state.showTests && event.is_test) return false;
    if (!state.selectedTypes.has(event.type)) return false;
    if (!state.selectedSources.has(event.source)) return false;
    return true;
  });
}

function renderMarkers() {
  resetDrift();

  if (state.maintenance) {
    const untilText = state.maintenanceUntil
      ? ` (до ${formatTime(state.maintenanceUntil)})`
      : "";
    maintenanceBanner.textContent = `Технічні роботи${untilText}. Частина функцій тимчасово недоступна.`;
    maintenanceBanner.style.display = "block";
    maintenanceScreenText.textContent = state.maintenanceUntil
      ? `Сервіс тимчасово недоступний до ${formatTime(state.maintenanceUntil)}.`
      : "Сервіс тимчасово недоступний. Спробуйте пізніше.";
    if (!state.adminBypassMaintenance) {
      maintenanceScreen.classList.add("active");
    } else {
      maintenanceScreen.classList.remove("active");
    }
  } else {
    maintenanceBanner.style.display = "none";
    maintenanceScreen.classList.remove("active");
  }
  if (state.maintenance) {
    return;
  }

  const filtered = getVisibleEvents();

  const nextIds = new Set(filtered.map((event) => event.id));

  markerById.forEach((marker, id) => {
    if (!nextIds.has(id)) {
      markerLayer.removeLayer(marker);
      markerById.delete(id);
      const drift = driftById.get(id);
      if (drift?.trailLine) {
        shahedTrailLayer.removeLayer(drift.trailLine);
      }
      driftById.delete(id);
    }
  });

  filtered.forEach((event) => {
    const popup = buildPopup(event);

    if (markerById.has(event.id)) {
      const existing = markerById.get(event.id);
      existing.setIcon(makeMarkerIcon(event));
      existing.setPopupContent(popup);
      eventById.set(event.id, event);
      if (!driftById.has(event.id)) {
        driftById.set(event.id, {
          id: event.id,
          marker: existing,
          baseLat: event.lat,
          baseLng: event.lng,
          direction: event.direction || 0,
          targetDirection: event.direction || 0,
          distanceKm: 0,
          track: [],
          trailLine: null
        });
      }
      const drift = driftById.get(event.id);
      if (drift && event.type === "shahed" && !drift.trailLine) {
        drift.trailLine = L.polyline(drift.track, {
          color: "#f59e0b",
          weight: 2,
          opacity: 0.7
        }).addTo(shahedTrailLayer);
      }
      return;
    }

    const marker = L.marker([event.lat, event.lng], { icon: makeMarkerIcon(event) });
    marker.bindPopup(popup, { closeButton: true });
    marker.addTo(markerLayer);
    marker.on("click", () => toggleTrackFor(event.id, marker));
    marker.on("popupopen", () => toggleTrackFor(event.id, marker));
    markerById.set(event.id, marker);
    eventById.set(event.id, event);
    const drift = {
      id: event.id,
      marker,
      baseLat: event.lat,
      baseLng: event.lng,
      direction: event.direction || 0,
      targetDirection: event.direction || 0,
      distanceKm: 0,
      track: [[event.lat, event.lng]],
      trailLine: null
    };
    if (event.type === "shahed") {
      drift.trailLine = L.polyline(drift.track, {
        color: "#f59e0b",
        weight: 2,
        opacity: 0.7
      }).addTo(shahedTrailLayer);
    }
    driftById.set(event.id, drift);
  });
  startDrift();
}

function buildPopup(event, distanceKm) {
  const distanceLine = Number.isFinite(distanceKm)
    ? `<br /><span class="popup-meta">Пройдена відстань: ${distanceKm.toFixed(1)} км</span>`
    : "";
  return `
      <div class="popup">
        <strong>${event.type.toUpperCase()}</strong><br />
        Джерело: ${event.source}<br />
        Час (Kyiv): ${formatTime(event.timestamp)}<br />
        Тестовий: ${event.is_test ? "так" : "ні"}<br />
        ${event.comment ? `Коментар: ${event.comment}` : ""}
        ${distanceLine}
      </div>
    `;
}

function haversineKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function trackDistanceKm(track) {
  if (!track || track.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < track.length; i += 1) {
    sum += haversineKm(track[i - 1], track[i]);
  }
  return sum;
}

function toggleTrackFor(eventId, marker) {
  if (activeTrackId === eventId) {
    trackLayer.clearLayers();
    activeTrackId = null;
    activeTrackLine = null;
    return;
  }
  trackLayer.clearLayers();
  activeTrackId = eventId;
  const drift = driftById.get(eventId);
  if (!drift) return;
  const path = drift.track && drift.track.length ? drift.track : [[drift.baseLat, drift.baseLng]];
  activeTrackLine = L.polyline(path, {
    color: "#3bb9ff",
    weight: 2,
    opacity: 0.7,
    dashArray: "6 8"
  }).addTo(trackLayer);
  activeTrackLine.bringToFront();

  const event = eventById.get(eventId);
  if (event && marker) {
    const distanceKm = trackDistanceKm(drift.track);
    marker.setPopupContent(buildPopup(event, distanceKm));
  }
}

function renderRadarList() {
  radarList.innerHTML = "";
  const items = [...state.events]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 12);
  if (items.length === 0) {
    radarList.innerHTML = "<div class=\"tool-item\">Немає активних повідомлень.</div>";
    return;
  }
  items.forEach((event) => {
    const text = event.raw_text || event.comment || `${event.type} ${event.source}`;
    const row = document.createElement("div");
    row.className = "tool-item";
    row.innerHTML = `<small>${formatTime(event.timestamp)} · ${event.source}</small><br />${text}`;
    radarList.appendChild(row);
  });
}

function renderAlarmList() {
  alarmList.innerHTML = "";
  const active = new Set(state.alarms || []);
  if (active.size === 0) {
    alarmList.innerHTML = "<div class=\"tool-item\">Тривог немає.</div>";
    return;
  }
  oblasts
    .filter((region) => active.has(region.id))
    .forEach((region) => {
      const row = document.createElement("div");
      row.className = "tool-item";
      row.textContent = region.name;
      alarmList.appendChild(row);
    });
}

async function renderAlarmMap() {
  if (!alarmsEnabled) {
    alarmLayer.clearLayers();
    return;
  }
  const active = new Set(state.alarms || []);
  if (!oblastGeoReady) {
    await ensureOblastLayer();
  }

  if (oblastGeoReady && oblastGeoLayer) {
    oblastGeoLayer.eachLayer((layer) => {
      const feature = layer.feature || {};
      const id = feature.properties?._regionId;
      const isActive = id && active.has(id);
      layer.setStyle(
        isActive
          ? {
              color: "#ff3b30",
              weight: 1.5,
              fillColor: "#ff3b30",
              fillOpacity: 0.12
            }
          : {
              color: "transparent",
              weight: 0,
              fillOpacity: 0
            }
      );
      if (isActive) {
        layer.bringToFront();
      }
    });
    return;
  }
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const parts = [
    hours > 0 ? String(hours).padStart(2, "0") : null,
    String(minutes).padStart(2, "0"),
    String(seconds).padStart(2, "0")
  ].filter(Boolean);
  return parts.join(":");
}

function updateMaintenanceCountdown() {
  if (!state.maintenance || !state.maintenanceUntil) return;
  const remaining = state.maintenanceUntil - Date.now();
  if (remaining <= 0) return;
  const countdown = formatCountdown(remaining);
  maintenanceBanner.textContent = `Технічні роботи (залишилось ${countdown}).`;
  maintenanceScreenText.textContent = `Сервіс тимчасово недоступний. Залишилось ${countdown}.`;
}

function startMaintenanceCountdown() {
  if (maintenanceTimer) return;
  maintenanceTimer = setInterval(updateMaintenanceCountdown, 1000);
}

function stopMaintenanceCountdown() {
  if (!maintenanceTimer) return;
  clearInterval(maintenanceTimer);
  maintenanceTimer = null;
}

async function refresh() {
  try {
    if (state.refreshPaused) return;
    const events = await loadEvents();
    state.events = events;
    updateFilterSets(events);
    renderFilterControls();
    renderMarkers();
    renderRadarList();
    renderAlarmList();
    await renderAlarmMap();
    if (!state.maintenance && state.autoFollow) {
      followLatestTarget();
    }
    if (state.maintenance && state.maintenanceUntil) {
      startMaintenanceCountdown();
      updateMaintenanceCountdown();
    } else {
      stopMaintenanceCountdown();
    }
    lastUpdated.textContent = `Оновлення: ${formatTime(new Date().toISOString())}`;
  } catch (error) {
    console.error("Failed to refresh", error);
  }
}

toggleTests.addEventListener("change", (event) => {
  state.showTests = event.target.checked;
  renderMarkers();
});

function openAdminModal() {
  adminModal.classList.add("active");
}

function closeAdminModal() {
  adminModal.classList.remove("active");
}

async function loadAdminStatus() {
  const response = await fetch("/api/admin/status", { method: "GET" });
  if (!response.ok) {
    adminPanel.classList.add("hidden");
    adminLoginForm.classList.remove("hidden");
    adminStatus.textContent = "Гість";
    maintenanceUntil.textContent = "—";
    state.adminBypassMaintenance = false;
    localStorage.removeItem("sw_admin_bypass");
    return;
  }
  const data = await response.json();
  adminPanel.classList.remove("hidden");
  adminLoginForm.classList.add("hidden");
  adminStatus.textContent = data.admin || "admin";
  maintenanceToggle.checked = Boolean(data.maintenance);
  maintenanceUntil.textContent = data.maintenance_until
    ? formatTime(data.maintenance_until)
    : "—";
  state.adminBypassMaintenance = true;
  localStorage.setItem("sw_admin_bypass", "1");
}

async function loginAdmin(payload) {
  const response = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    alert("Невірний логін або пароль.");
    return false;
  }
  await loadAdminStatus();
  return true;
}

async function toggleMaintenance(enabled) {
  const response = await fetch("/api/admin/maintenance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled })
  });
  if (!response.ok) {
    alert("Не вдалося змінити режим технічних робіт.");
    return;
  }
  const data = await response.json();
  state.maintenance = Boolean(data.maintenance);
  state.maintenanceUntil = data.maintenance_until || null;
  maintenanceUntil.textContent = data.maintenance_until
    ? formatTime(data.maintenance_until)
    : "—";
  renderMarkers();
}

async function scheduleMaintenance(payload) {
  const response = await fetch("/api/admin/maintenance/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    alert("Не вдалося поставити таймер технічних робіт.");
    return;
  }
  const data = await response.json();
  state.maintenance = Boolean(data.maintenance);
  state.maintenanceUntil = data.maintenance_until || null;
  maintenanceToggle.checked = state.maintenance;
  maintenanceUntil.textContent = data.maintenance_until
    ? formatTime(data.maintenance_until)
    : "—";
  renderMarkers();
}

adminOpen.addEventListener("click", () => {
  openAdminModal();
  loadAdminStatus();
});

adminClose.addEventListener("click", closeAdminModal);
adminModal.addEventListener("click", (event) => {
  if (event.target === adminModal) closeAdminModal();
});

adminLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(adminLoginForm);
  const username = formData.get("username");
  const password = formData.get("password");
  await loginAdmin({ username, password });
});

maintenanceToggle.addEventListener("change", (event) => {
  toggleMaintenance(event.target.checked);
});

maintenanceApply.addEventListener("click", () => {
  const minutesValue = Number(maintenanceMinutes.value);
  const untilValue = maintenanceUntilInput.value;
  if (Number.isFinite(minutesValue) && minutesValue > 0) {
    scheduleMaintenance({ minutes: minutesValue });
    return;
  }
  if (untilValue) {
    scheduleMaintenance({ until: new Date(untilValue).toISOString() });
    return;
  }
  alert("Вкажіть таймер у хвилинах або дату/час.");
});

maintenanceClear.addEventListener("click", () => {
  scheduleMaintenance({ clear: true });
});

maintenanceShow.addEventListener("click", () => {
  state.adminBypassMaintenance = false;
  localStorage.removeItem("sw_admin_bypass");
  renderMarkers();
});

testAdd.addEventListener("click", async () => {
  const payload = {
    type: testType.value,
    city: testCity.value.trim(),
    sea: testSea.checked,
    direction: testDirection.value ? Number(testDirection.value) : null,
    note: testNote.value.trim()
  };
  if (!payload.city) {
    alert("Вкажіть місто/регіон для тестової мітки.");
    return;
  }
  const response = await fetch("/api/admin/test-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    alert("Не вдалося додати тестову мітку.");
    return;
  }
  testNote.value = "";
  refresh();
});

testClear.addEventListener("click", async () => {
  const response = await fetch("/api/admin/test-events/clear", { method: "POST" });
  if (!response.ok) {
    alert("Не вдалося очистити тестові мітки.");
    return;
  }
  refresh();
});

adminLogout.addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  adminPanel.classList.add("hidden");
  adminLoginForm.classList.remove("hidden");
  adminStatus.textContent = "Гість";
  maintenanceUntil.textContent = "—";
  state.adminBypassMaintenance = false;
  localStorage.removeItem("sw_admin_bypass");
});

maintenanceAdminOpen.addEventListener("click", () => {
  openAdminModal();
  loadAdminStatus();
});

toolTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    toolTabs.forEach((btn) => btn.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.tab;
    if (target === "radar") {
      radarList.classList.remove("hidden");
      alarmList.classList.add("hidden");
    } else {
      alarmList.classList.remove("hidden");
      radarList.classList.add("hidden");
    }
  });
});

if (toolOpen && toolPanel && toolClose) {
  toolOpen.addEventListener("click", () => {
    toolPanel.classList.remove("hidden");
    toolOpen.classList.add("hidden");
  });
  toolClose.addEventListener("click", () => {
    toolPanel.classList.add("hidden");
    toolOpen.classList.remove("hidden");
  });
}

function applyTheme(name) {
  document.body.classList.remove("theme-light", "theme-skymap");
  if (name === "light") {
    document.body.classList.add("theme-light");
  } else if (name === "skymap") {
    document.body.classList.add("theme-skymap");
  }
  localStorage.setItem("sw_theme", name);
}

function applyCustomTheme() {
  const accent = themeAccent.value;
  const bg = themeBg.value;
  const panel = themePanel.value;
  document.documentElement.style.setProperty("--accent", accent);
  document.documentElement.style.setProperty("--bg", bg);
  document.documentElement.style.setProperty("--panel", panel);
  document.documentElement.style.setProperty("--panel-light", panel);
  localStorage.setItem("sw_theme_custom", JSON.stringify({ accent, bg, panel }));
}

if (toolSettings && settingsModal && settingsClose) {
  toolSettings.addEventListener("click", () => {
    settingsModal.classList.add("active");
  });
  settingsClose.addEventListener("click", () => {
    settingsModal.classList.remove("active");
  });
  settingsModal.addEventListener("click", (event) => {
    if (event.target === settingsModal) settingsModal.classList.remove("active");
  });
}

themeOptions.forEach((option) => {
  option.addEventListener("change", () => {
    const value = option.value;
    if (value === "custom") {
      themeCustom.classList.remove("hidden");
    } else {
      themeCustom.classList.add("hidden");
      applyTheme(value);
    }
  });
});

if (themeApply) {
  themeApply.addEventListener("click", () => {
    applyTheme("custom");
    applyCustomTheme();
  });
}

function openPanel() {
  const panel = document.querySelector(".panel");
  if (!panel) return;
  panel.classList.add("open");
  panelBackdrop.classList.add("active");
}

function closePanel() {
  const panel = document.querySelector(".panel");
  if (!panel) return;
  panel.classList.remove("open");
  panelBackdrop.classList.remove("active");
}

if (panelToggle && panelBackdrop) {
  panelToggle.addEventListener("click", () => {
    const panel = document.querySelector(".panel");
    if (!panel) return;
    if (panel.classList.contains("open")) {
      closePanel();
    } else {
      openPanel();
    }
  });
  panelBackdrop.addEventListener("click", closePanel);
}

if (toggleRefresh) {
  toggleRefresh.addEventListener("change", (event) => {
    state.refreshPaused = event.target.checked;
    localStorage.setItem("sw_refresh_paused", state.refreshPaused ? "1" : "0");
  });
}

let lastFollowedId = null;
function followLatestTarget() {
  const visible = getVisibleEvents();
  if (visible.length === 0) return;
  const latest = visible.reduce((acc, current) => {
    if (!acc) return current;
    return new Date(current.timestamp) > new Date(acc.timestamp) ? current : acc;
  }, null);
  if (!latest || latest.id === lastFollowedId) return;
  lastFollowedId = latest.id;
  map.panTo([latest.lat, latest.lng], { animate: true, duration: 1 });
}

map.on("zoomend", updateMarkerScale);
updateMarkerScale();
state.adminBypassMaintenance = localStorage.getItem("sw_admin_bypass") === "1";

const savedTheme = localStorage.getItem("sw_theme") || "dark";
const savedCustom = localStorage.getItem("sw_theme_custom");
applyTheme(savedTheme);
const savedOption = document.querySelector(`input[name="theme"][value="${savedTheme}"]`);
if (savedOption) savedOption.checked = true;
if (savedTheme === "custom") {
  themeCustom.classList.remove("hidden");
  if (savedCustom) {
    try {
      const data = JSON.parse(savedCustom);
      themeAccent.value = data.accent || themeAccent.value;
      themeBg.value = data.bg || themeBg.value;
      themePanel.value = data.panel || themePanel.value;
      applyCustomTheme();
    } catch {
      themeCustom.classList.remove("hidden");
    }
  }
}

const paused = localStorage.getItem("sw_refresh_paused") === "1";
state.refreshPaused = paused;
if (toggleRefresh) {
  toggleRefresh.checked = paused;
}

const savedFollow = localStorage.getItem("sw_auto_follow") === "1";
state.autoFollow = savedFollow;
if (toggleFollow) {
  toggleFollow.checked = savedFollow;
  toggleFollow.addEventListener("change", (event) => {
    state.autoFollow = event.target.checked;
    localStorage.setItem("sw_auto_follow", state.autoFollow ? "1" : "0");
    if (state.autoFollow) {
      followLatestTarget();
    }
  });
}

refresh();
setInterval(refresh, 12000);
