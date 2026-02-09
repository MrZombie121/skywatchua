import { sources } from "./data/sources.js";
import { oblasts } from "./data/oblasts.js";
import "./styles.css";

const L = window.L;

const map = L.map("map", {
  zoomControl: true,
  attributionControl: true
}).setView([49.0, 31.0], 6);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const markerLayer = L.layerGroup().addTo(map);
const alarmLayer = L.layerGroup().addTo(map);
const markerById = new Map();
const driftById = new Map();
let driftTimer = null;
let maintenanceTimer = null;

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
  refreshPaused: false
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
const toolTabs = toolPanel ? toolPanel.querySelectorAll("button[data-tab]") : [];

const typeLabels = {
  shahed: "Shahed",
  missile: "Missile",
  kab: "KAB",
  airplane: "Air"
};
const iconRotationOffset = 0;

function normalizeType(type) {
  if (!type) return "other";
  const key = String(type).toLowerCase();
  if (key.includes("shahed")) return "shahed";
  if (key.includes("missile")) return "missile";
  if (key.includes("kab")) return "kab";
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

function makeMarkerIcon(event) {
  const typeClass = state.types.has(event.type) ? event.type : "shahed";
  const iconMap = {
    shahed: "/ico/shahed.png",
    missile: "/ico/missle.png",
    kab: "/ico/kab.png",
    airplane: "/ico/airplane.png",
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
  let lastFrame = performance.now();
  const animate = (now) => {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const zoom = map.getZoom();
    const zoomFactor = zoom <= 7 ? 0.25 : zoom <= 9 ? 0.5 : 1;
    driftById.forEach((item) => {
      if (item.distanceKm >= maxDistanceKm) return;
      const stepKm = (speedMps * dt * zoomFactor) / 1000;
      item.distanceKm = Math.min(maxDistanceKm, item.distanceKm + stepKm);
      const distanceKm = item.distanceKm * zoomFactor;
      const distanceDegLat = distanceKm / 111;
      const rad = (item.direction * Math.PI) / 180;
      const lat = item.baseLat + distanceDegLat * Math.cos(rad);
      const lng =
        item.baseLng + (distanceDegLat * Math.sin(rad)) / Math.cos((item.baseLat * Math.PI) / 180);
      item.marker.setLatLng([lat, lng], { animate: true });
    });
    driftTimer = requestAnimationFrame(animate);
  };
  driftTimer = requestAnimationFrame(animate);
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

  const filtered = state.events.filter((event) => {
    if (!state.showTests && event.is_test) return false;
    if (!state.selectedTypes.has(event.type)) return false;
    if (!state.selectedSources.has(event.source)) return false;
    return true;
  });

  const nextIds = new Set(filtered.map((event) => event.id));

  markerById.forEach((marker, id) => {
    if (!nextIds.has(id)) {
      markerLayer.removeLayer(marker);
      markerById.delete(id);
      driftById.delete(id);
    }
  });

  filtered.forEach((event) => {
    const popup = `
      <div class="popup">
        <strong>${event.type.toUpperCase()}</strong><br />
        Джерело: ${event.source}<br />
        Час (Kyiv): ${formatTime(event.timestamp)}<br />
        Тестовий: ${event.is_test ? "так" : "ні"}<br />
        ${event.comment ? `Коментар: ${event.comment}` : ""}
      </div>
    `;

    if (markerById.has(event.id)) {
      const existing = markerById.get(event.id);
      existing.setIcon(makeMarkerIcon(event));
      existing.setPopupContent(popup);
      if (!driftById.has(event.id)) {
        driftById.set(event.id, {
          marker: existing,
          baseLat: event.lat,
          baseLng: event.lng,
          direction: event.direction || 0,
          distanceKm: 0
        });
      }
      return;
    }

    const marker = L.marker([event.lat, event.lng], { icon: makeMarkerIcon(event) });
    marker.bindPopup(popup, { closeButton: true });
    marker.addTo(markerLayer);
    markerById.set(event.id, marker);
    driftById.set(event.id, {
      marker,
      baseLat: event.lat,
      baseLng: event.lng,
      direction: event.direction || 0,
      distanceKm: 0
    });
  });
  startDrift();
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

function renderAlarmMap() {
  alarmLayer.clearLayers();
  const active = new Set(state.alarms || []);
  oblasts.forEach((region) => {
    if (!active.has(region.id)) return;
    const rect = L.rectangle(region.bbox, {
      color: "#ff3b30",
      weight: 2,
      fillColor: "#ff3b30",
      fillOpacity: 0
    });
    rect.addTo(alarmLayer);
  });
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
    renderAlarmMap();
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

refresh();
setInterval(refresh, 12000);
