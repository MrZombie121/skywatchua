import "leaflet/dist/leaflet.css";
import L from "leaflet";
import './styles.css';
import { sources } from "./data/sources.js";
import { oblasts } from "./data/oblasts.js";

const map = L.map("map", {
  zoomControl: true,
  attributionControl: true
}).setView([49.0, 31.0], 6);

const alarmsEnabled = true;
const APP_VERSION = document.querySelector("meta[name=\"sw-version\"]")?.content || "1.5.3";
const mapStyleCatalog = {
  osm: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }
  },
  "carto-dark": {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    options: {
      maxZoom: 20,
      subdomains: "abcd",
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
    }
  },
  "carto-light": {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    options: {
      maxZoom: 20,
      subdomains: "abcd",
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
    }
  },
  topo: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    options: {
      maxZoom: 17,
      attribution: "Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap"
    }
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    options: {
      maxZoom: 18,
      attribution: "Tiles &copy; Esri"
    }
  }
};
let baseTileLayer = null;

const markerLayer = L.layerGroup().addTo(map);
const trajectoryLayer = L.layerGroup().addTo(map);
const alarmLayer = L.layerGroup().addTo(map);
const districtAlarmLayer = L.layerGroup().addTo(map);
const trackLayer = L.layerGroup().addTo(map);
const shahedTrailLayer = L.layerGroup().addTo(map);
const historyLayer = L.layerGroup().addTo(map);
const userLayer = L.layerGroup().addTo(map);
let oblastGeoLayer = null;
let oblastGeoReady = false;
const markerById = new Map();
const trajectoryById = new Map();
const markerIconSignatureById = new Map();
const eventById = new Map();
const driftById = new Map();
const markerSpawnAt = new Map();
const historyByKey = new Map();
let driftTimer = null;
let maintenanceTimer = null;
let refreshTimer = null;
let markerAgingTimer = null;
let timelineSyncTimer = null;
let fastRetryTimer = null;
let refreshInFlight = null;
let geoWatchId = null;
let activeTrackId = null;
let activeTrackLine = null;
let lastSoundAt = 0;
let userMarker = null;
let userAccuracyCircle = null;
let radarMap = null;
let radarTileLayer = null;
let radarUserLayer = null;
let radarTargetLayer = null;
let oblastGeoPromise = null;
let radarStyleKey = null;
let filterRenderSignature = "";

const DEFAULT_MARKER_TTL_MS = 10 * 60 * 1000;
const STALE_WARN_MS = 5 * 60 * 1000;
const STALE_CRITICAL_MS = 9 * 60 * 1000;
const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const SPAWN_ANIMATION_MS = 3000;
const DEFAULT_REFRESH_INTERVAL_MS = 5000;
const FAST_RETRY_REFRESH_MS = 1000;
const HISTORY_STORAGE_KEY = "sw_history_24h_v2";
const SNAPSHOT_STORAGE_KEY = "sw_snapshot_v1";
const PINNED_STORAGE_KEY = "sw_pinned_v2";
const SAVED_VIEWS_KEY = "sw_saved_views_v2";
const OPS_NOTES_KEY = "sw_ops_notes_v2";
const MARKER_TTL_KEY = "sw_marker_ttl_ms";
const TRAJECTORY_VISIBILITY_KEY = "sw_show_trajectories_v1";
const SOUND_COOLDOWN_MS = 4000;
const MAP_HEIGHT_STORAGE_KEY = "sw_map_height_v1";
const MAP_MIN_HEIGHT = 360;
const DOCK_MIN_HEIGHT = 160;
const SOURCE_FETCH_TIMEOUT_MS = 12000;
const MARKER_AGING_TICK_MS = 30000;
const TIMELINE_SYNC_TICK_MS = 1000;

const state = {
  events: [],
  invalidEvents: [],
  types: new Set(),
  sources: new Set(),
  selectedTypes: new Set(),
  selectedSources: new Set(),
  showTests: true,
  maintenance: false,
  maintenanceUntil: null,
  alarms: [],
  districtAlarms: [],
  adminBypassMaintenance: false,
  refreshPaused: false,
  autoFollow: false,
  showHistory: true,
  showTrajectories: true,
  refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
  adminLocations: [],
  adminMapPickMode: null,
  pinnedIds: new Set(),
  savedViews: [],
  soundEnabled: false,
  markerTtlMs: DEFAULT_MARKER_TTL_MS,
  userLocation: null,
  radarRadiusKm: 100,
  dangerRadiusKm: 25,
  timelineActive: false,
  timelineMinTs: null,
  timelineMaxTs: null,
  timelineCurrentTs: null
};

const typeContainer = document.getElementById("type-filters");
const sourceContainer = document.getElementById("source-filters");
const toggleTests = document.getElementById("toggle-tests");
const lastUpdated = document.getElementById("last-updated");
const visibleCount = document.getElementById("visible-count");
const sourceCount = document.getElementById("source-count");
const maintenanceBanner = document.getElementById("maintenance-banner");
const mapNotice = document.getElementById("map-notice");
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
const testGroupCount = document.getElementById("test-group-count");
const testIsTest = document.getElementById("test-is-test");
const testSea = document.getElementById("test-sea");
const testDirection = document.getElementById("test-direction");
const testNote = document.getElementById("test-note");
const testAdd = document.getElementById("test-add");
const testClear = document.getElementById("test-clear");
const adminLocationSelect = document.getElementById("admin-location-select");
const adminLocationName = document.getElementById("admin-location-name");
const adminLocationType = document.getElementById("admin-location-type");
const adminLocationParent = document.getElementById("admin-location-parent");
const adminLocationKeys = document.getElementById("admin-location-keys");
const adminLocationLat = document.getElementById("admin-location-lat");
const adminLocationLng = document.getElementById("admin-location-lng");
const adminLocationRegion = document.getElementById("admin-location-region");
const adminPointLat = document.getElementById("admin-point-lat");
const adminPointLng = document.getElementById("admin-point-lng");
const adminPointTypes = document.getElementById("admin-point-types");
const adminPickCityCenter = document.getElementById("admin-pick-city-center");
const adminPickSpawnPoint = document.getElementById("admin-pick-spawn-point");
const adminPointAddAnother = document.getElementById("admin-point-add-another");
const adminPickStatus = document.getElementById("admin-pick-status");
const adminPointList = document.getElementById("admin-point-list");
const adminLocationSave = document.getElementById("admin-location-save");
const adminLocationList = document.getElementById("admin-location-list");
const adminLogout = document.getElementById("admin-logout");
const radarList = document.getElementById("radar-list");
const alarmList = document.getElementById("alarm-list");
const watchlistList = document.getElementById("watchlist-list");
const settingsModal = document.getElementById("settings-modal");
const settingsClose = document.getElementById("settings-close");
const mapStyleSelect = document.getElementById("map-style-select");
const siteVersion = document.getElementById("site-version");
const themeOptions = document.querySelectorAll("input[name=\"theme\"]");
const themeCustom = document.getElementById("theme-custom");
const themeAccent = document.getElementById("theme-accent");
const themeBg = document.getElementById("theme-bg");
const themePanel = document.getElementById("theme-panel");
const themeApply = document.getElementById("theme-apply");
const panelToggle = document.getElementById("panel-toggle");
const intelToggle = document.getElementById("intel-toggle");
const panelBackdrop = document.getElementById("panel-backdrop");
const manualRefresh = document.getElementById("manual-refresh");
const toggleRefresh = document.getElementById("toggle-refresh");
const toggleHistory = document.getElementById("toggle-history");
const toggleTrajectories = document.getElementById("toggle-trajectories");
const toggleFollow = document.getElementById("toggle-follow");
const toggleSound = document.getElementById("toggle-sound");
const fitVisible = document.getElementById("fit-visible");
const refreshModeSelect = document.getElementById("refresh-mode-select");
const ttlSelect = document.getElementById("ttl-select");
const toolSettings = document.getElementById("tool-settings");
let reportOpen = document.getElementById("report-open");
const saveViewButton = document.getElementById("save-view");
const savedViewsList = document.getElementById("saved-views");
const opsNotes = document.getElementById("ops-notes");
const intelFeed = document.getElementById("intel-feed");
const pinnedList = document.getElementById("pinned-list");
const exportBrief = document.getElementById("export-brief");
const metricActive = document.getElementById("metric-active");
const metricTests = document.getElementById("metric-tests");
const metricConfidence = document.getElementById("metric-confidence");
const metricSources = document.getElementById("metric-sources");
const localAlert = document.getElementById("local-alert");
const mapExpand = document.getElementById("map-expand");
const mapSizeButtons = document.querySelectorAll("[data-map-size]");
const oblastSelect = document.getElementById("oblast-select");
const geoToggle = document.getElementById("geo-toggle");
const radarOpen = document.getElementById("radar-open");
const radarModal = document.getElementById("radar-modal");
const radarClose = document.getElementById("radar-close");
const reportModal = document.getElementById("report-modal");
const reportClose = document.getElementById("report-close");
const reportForm = document.getElementById("report-form");
const reportType = document.getElementById("report-type");
const reportCount = document.getElementById("report-count");
const reportLocation = document.getElementById("report-location");
const reportTarget = document.getElementById("report-target");
const reportSeenAt = document.getElementById("report-seen-at");
const reportNote = document.getElementById("report-note");
const reportContactName = document.getElementById("report-contact-name");
const reportContactLink = document.getElementById("report-contact-link");
const reportStatus = document.getElementById("report-status");
const reportCancel = document.getElementById("report-cancel");
const radarMapNode = document.getElementById("radar-map");
const dangerRadiusSelect = document.getElementById("danger-radius-select");
const geoStatus = document.getElementById("geo-status");
const radarSummary = document.getElementById("radar-summary");
const timelineSlider = document.getElementById("timeline-slider");
const timelineDisplayTime = document.getElementById("timeline-display-time");
const timelineStartTime = document.getElementById("timeline-start-time");
const timelineEndTime = document.getElementById("timeline-end-time");
const timelineRebuild = document.getElementById("timeline-rebuild");
const timelineExit = document.getElementById("timeline-exit");
const leftSidebar = document.querySelector(".sidebar.left");
const rightSidebar = document.querySelector(".sidebar.right");
const dockTabs = document.querySelectorAll(".dock-tabs button");
const stage = document.querySelector(".stage.v3");
const stageHead = document.querySelector(".stage-head");
const mapShell = document.querySelector(".map-shell");
const mapResizer = document.getElementById("map-resizer");
const dock = document.querySelector(".dock");

if (!reportOpen) {
  const topbarActions = document.querySelector(".topbar-actions");
  if (topbarActions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-btn";
    button.id = "report-open";
    button.textContent = "Повідомити про ціль";
    topbarActions.insertBefore(button, toolSettings || topbarActions.firstChild);
    reportOpen = button;
  }
}

const typeLabels = {
  shahed: "Шахед",
  missile: "Ракета",
  kab: "KAB",
  airplane: "Літак",
  recon: "Розвідка"
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
  "UA-77": "chernivetska",
  "UA-40": "sevastopol",
  "UA-43": "crimea"
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
  luhanska: ["luhanska", "luhansk", "луганська", "луганская"],
  crimea: ["crimea", "крим", "крым", "автономна республіка крим", "автономная республика крым", "арк"],
  sevastopol: ["sevastopol", "севастополь", "м. севастополь", "місто севастополь"]
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

function deterministicDirection(seedInput) {
  const text = String(seedInput || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  const positive = Math.abs(hash);
  return positive % 360;
}

function buildStableEventId(raw, sourceId, lat, lng) {
  const parts = [
    sourceId,
    raw.timestamp || raw.time || "",
    raw.type || raw.target_type || raw.category || "",
    raw.marker_label || raw.location?.label || "",
    raw.target_label || raw.target?.label || "",
    Number.isFinite(lat) ? lat.toFixed(4) : "",
    Number.isFinite(lng) ? lng.toFixed(4) : "",
    raw.comment || raw.note || raw.message || raw.raw_text || ""
  ];
  return `evt-${parts.map((part) => String(part).trim()).join("|")}`;
}

function normalizeEvent(raw, sourceId) {
  const rawDirection = raw.direction ?? raw.heading;
  const parsedDirection = Number(rawDirection);
  const direction = Number.isFinite(parsedDirection) ? parsedDirection : null;
  const lat = Number(raw.lat ?? raw.latitude ?? raw.location?.lat ?? NaN);
  const lng = Number(raw.lng ?? raw.longitude ?? raw.location?.lng ?? NaN);
  const rawId = raw.id || buildStableEventId(raw, sourceId, lat, lng);
  const type = normalizeType(raw.type || raw.target_type || raw.category);
  return {
    id: rawId,
    type,
    marker_variant: raw.marker_variant || null,
    lat,
    lng,
    direction,
    fallbackDirection: deterministicDirection(rawId),
    source: raw.source || sourceId,
    timestamp: raw.timestamp || raw.time || new Date().toISOString(),
    comment: raw.comment || raw.note || "",
    is_test: Boolean(raw.is_test ?? raw.isTest ?? false),
    raw_text: raw.raw_text || raw.message || "",
    confidence: Number(raw.confidence ?? 0.5),
    group_count_min: Number(raw.group_count_min ?? 0),
    group_count_max: Number(raw.group_count_max ?? 0),
    marker_action: raw.marker_action ?? null,
    marker_label: raw.marker_label ?? "",
    marker_location_id: raw.marker_location_id ?? "",
    target_lat: Number(raw.target_lat ?? raw.target?.lat ?? NaN),
    target_lng: Number(raw.target_lng ?? raw.target?.lng ?? NaN),
    target_label: raw.target_label ?? raw.target?.label ?? "",
    target_location_id: raw.target_location_id ?? raw.target?.location_id ?? "",
    bot_meta: raw.bot_meta ?? null,
    evidence_count: Number(raw.evidence_count ?? 1),
    evidence_sources: Array.isArray(raw.evidence_sources) ? raw.evidence_sources : []
  };
}

function isMultiGroupEvent(event) {
  const min = Number(event.group_count_min ?? 0);
  const max = Number(event.group_count_max ?? 0);
  return Math.max(min, max) >= 2;
}

function resolveMarkerVariant(event) {
  if (event.marker_variant) return event.marker_variant;
  if ((event.type === "shahed" || event.type === "missile") && isMultiGroupEvent(event)) {
    return `${event.type}-multi`;
  }
  return null;
}

async function fetchSource(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(source.url, { cache: "no-store", signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Source ${source.id} timeout after ${SOURCE_FETCH_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
  if (Array.isArray(payload.district_alarms)) {
    state.districtAlarms = payload.district_alarms;
  } else {
    state.districtAlarms = [];
  }
  if (payload.maintenance_until) {
    state.maintenanceUntil = payload.maintenance_until;
  } else {
    state.maintenanceUntil = null;
  }
  const items = Array.isArray(payload)
    ? payload
    : payload.events || payload.items || payload.data || [];
  return {
    events: items.map((item) => normalizeEvent(item, source.id)),
    stale: Boolean(payload?.stale),
    warming: Boolean(payload?.warming),
    cached: Boolean(payload?.cached)
  };
}

async function loadEvents() {
  const results = await Promise.allSettled(sources.map(fetchSource));
  const merged = [];
  let needsFastRetry = false;
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      merged.push(...result.value.events);
      needsFastRetry ||= result.value.stale || result.value.warming;
    } else {
      console.warn("Source failed", sources[index].id, result.reason);
    }
  });
  const validEvents = [];
  const invalidEvents = [];
  merged.forEach((event) => {
    if (Number.isFinite(event.lat) && Number.isFinite(event.lng)) {
      validEvents.push(event);
    } else {
      invalidEvents.push(event);
    }
  });
  state.invalidEvents = invalidEvents;
  return {
    events: validEvents,
    needsFastRetry
  };
}

function updateFilterSets(events) {
  const previousTypes = new Set(state.types);
  const previousSources = new Set(state.sources);
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
  } else {
    state.sources.forEach((source) => {
      if (!state.selectedSources.has(source)) {
        state.selectedSources.add(source);
      }
    });
  }

  return !setsEqual(previousTypes, state.types) || !setsEqual(previousSources, state.sources);
}

function setsEqual(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function getFilterRenderSignature() {
  return JSON.stringify({
    types: Array.from(state.types).sort(),
    sources: Array.from(state.sources).sort(),
    selectedTypes: Array.from(state.selectedTypes).sort(),
    selectedSources: Array.from(state.selectedSources).sort()
  });
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
  if (!typeContainer || !sourceContainer) return;
  const nextSignature = getFilterRenderSignature();
  if (filterRenderSignature === nextSignature) return;
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
          renderRadarList();
          renderIntelFeed();
          renderPinnedList();
          renderDockWatchlist();
          renderMetrics();
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
          renderRadarList();
          renderIntelFeed();
          renderPinnedList();
          renderDockWatchlist();
          renderMetrics();
        }
      });
      sourceContainer.appendChild(chip);
    });
  filterRenderSignature = nextSignature;
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour12: false
  });
}

function eventTimestampMs(event) {
  const ts = new Date(event.timestamp).getTime();
  return Number.isFinite(ts) ? ts : Date.now();
}

function eventAgeMs(event, now = Date.now()) {
  return Math.max(0, now - eventTimestampMs(event));
}

function eventExpiresAtMs(event) {
  const expiresAt = Number(event?.expires_at);
  const localExpiresAt = eventTimestampMs(event) + state.markerTtlMs;
  if (Number.isFinite(expiresAt) && expiresAt > 0) {
    return Math.min(expiresAt, localExpiresAt);
  }
  return localExpiresAt;
}

function eventTtlLeftMs(event, now = Date.now()) {
  return Math.max(0, eventExpiresAtMs(event) - now);
}

function isEventAlive(event, now = Date.now()) {
  return eventTtlLeftMs(event, now) > 0;
}

function freshnessState(event, now = Date.now()) {
  const age = eventAgeMs(event, now);
  if (age >= STALE_CRITICAL_MS) {
    return { markerClass: "stale-9", popupClass: "critical", label: "Застаріла (скоро зникне)" };
  }
  if (age >= STALE_WARN_MS) {
    return { markerClass: "stale-5", popupClass: "warn", label: "Не свіжа (5+ хв)" };
  }
  return { markerClass: "fresh", popupClass: "fresh", label: "Свіжа" };
}

function formatAge(ms) {
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  if (mins <= 0) return `${secs}с`;
  return `${mins}хв ${secs.toString().padStart(2, "0")}с`;
}

function buildHistoryKey(event) {
  const text = `${event.raw_text || ""} ${event.comment || ""}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return text ? `${event.source}|${event.type}|${text}` : `${event.source}|${event.type}|${event.id}`;
}

function pruneHistory(now = Date.now()) {
  const cutoff = now - HISTORY_WINDOW_MS;
  historyByKey.forEach((points, key) => {
    const filtered = points.filter((point) => point.ts >= cutoff);
    if (filtered.length === 0) {
      historyByKey.delete(key);
      return;
    }
    historyByKey.set(key, filtered);
  });
}

function saveHistoryStore() {
  try {
    const payload = JSON.stringify(Array.from(historyByKey.entries()));
    localStorage.setItem(HISTORY_STORAGE_KEY, payload);
  } catch (error) {
    console.warn("History save failed", error);
  }
}

function loadHistoryStore() {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    parsed.forEach((entry) => {
      if (!Array.isArray(entry) || entry.length !== 2) return;
      const [key, points] = entry;
      if (typeof key !== "string" || !Array.isArray(points)) return;
      const safePoints = points
        .map((point) => ({
          lat: Number(point.lat),
          lng: Number(point.lng),
          ts: Number(point.ts)
        }))
        .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng) && Number.isFinite(point.ts));
      if (safePoints.length > 0) {
        historyByKey.set(key, safePoints);
      }
    });
    pruneHistory();
  } catch (error) {
    console.warn("History load failed", error);
  }
}

function ingestHistory(events) {
  const now = Date.now();
  const cutoff = now - HISTORY_WINDOW_MS;
  events.forEach((event) => {
    const ts = eventTimestampMs(event);
    if (ts < cutoff) return;
    const key = buildHistoryKey(event);
    const points = historyByKey.get(key) || [];
    const last = points[points.length - 1];
    const isDuplicate =
      last &&
      Math.abs(last.lat - event.lat) < 0.0001 &&
      Math.abs(last.lng - event.lng) < 0.0001 &&
      Math.abs(last.ts - ts) < 120000;
    if (!isDuplicate) {
      points.push({ lat: event.lat, lng: event.lng, ts });
      historyByKey.set(key, points);
    }
  });
  pruneHistory(now);
  saveHistoryStore();
}

function getHistoryTrack(event) {
  const points = historyByKey.get(buildHistoryKey(event)) || [];
  return points
    .slice()
    .sort((a, b) => a.ts - b.ts)
    .map((point) => [point.lat, point.lng]);
}

// Timeline Mode Functions
function rebuildTimelineData(stickToLatest = true) {
  // Find the earliest and latest timestamps across all history
  let minTs = Date.now();
  let maxTs = Date.now() - HISTORY_WINDOW_MS;
  
  historyByKey.forEach((points) => {
    if (points.length > 0) {
      const earliest = Math.min(...points.map(p => p.ts));
      const latest = Math.max(...points.map(p => p.ts));
      minTs = Math.min(minTs, earliest);
      maxTs = Math.max(maxTs, latest);
    }
  });
  
  if (minTs > maxTs) {
    minTs = Date.now() - HISTORY_WINDOW_MS;
    maxTs = Date.now();
  }

  state.timelineMinTs = minTs;
  state.timelineMaxTs = maxTs;
  state.timelineCurrentTs = stickToLatest
    ? maxTs
    : Math.min(Math.max(state.timelineCurrentTs ?? maxTs, minTs), maxTs);
  
  // Update the slider and display
  if (timelineSlider) {
    timelineSlider.max = 100;
    const timeRange = maxTs - minTs;
    const progress = timeRange > 0
      ? ((state.timelineCurrentTs - minTs) / timeRange) * 100
      : 100;
    timelineSlider.value = String(Math.min(100, Math.max(0, progress)));
  }
  
  updateTimelineDisplay();
  if (state.timelineActive) {
    renderTimelineMarkers();
  }
}

function updateTimelineDisplay() {
  if (!state.timelineMinTs || !state.timelineMaxTs) return;
  
  if (timelineStartTime) {
    timelineStartTime.textContent = formatTime(state.timelineMinTs);
  }
  if (timelineEndTime) {
    timelineEndTime.textContent = formatTime(state.timelineMaxTs);
  }
  if (timelineDisplayTime) {
    timelineDisplayTime.textContent = formatTime(state.timelineCurrentTs);
  }
}

function updateTimelinePosition(sliderValue) {
  if (!state.timelineMinTs || !state.timelineMaxTs) return;
  
  // Convert slider value (0-100) to timestamp
  const progress = sliderValue / 100;
  const timeRange = state.timelineMaxTs - state.timelineMinTs;
  state.timelineCurrentTs = state.timelineMinTs + (timeRange * progress);
  
  updateTimelineDisplay();
  renderTimelineMarkers();
}

function renderTimelineMarkers() {
  if (!state.timelineActive) return;
  
  markerLayer.clearLayers();
  trajectoryLayer.clearLayers();
  historyLayer.clearLayers();
  markerById.clear();
  trajectoryById.clear();
  
  const currentTs = state.timelineCurrentTs;
  
  // Get visible events
  const filtered = getVisibleEvents();
  
  filtered.forEach((event) => {
    const key = buildHistoryKey(event);
    const points = historyByKey.get(key) || [];
    
    if (points.length === 0) return;
    
    // Sort points by timestamp
    const sortedPoints = points.slice().sort((a, b) => a.ts - b.ts);
    
    // Find all points UP TO the current timeline position
    const pathUpToCurrent = sortedPoints.filter(p => p.ts <= currentTs);
    
    if (pathUpToCurrent.length === 0) return;
    
    // Draw the full trajectory path up to current time
    if (pathUpToCurrent.length > 1) {
      const path = pathUpToCurrent.map(p => [p.lat, p.lng]);
      const polyline = L.polyline(path, {
        color: "rgba(53, 214, 255, 0.4)",
        weight: 2,
        opacity: 0.7,
        dashArray: "none"
      });
      historyLayer.addLayer(polyline);
    }
    
    // Find the closest point to the current timeline position to show the marker there
    let closestPoint = pathUpToCurrent[pathUpToCurrent.length - 1];
    let closestDistance = Math.abs(closestPoint.ts - currentTs);
    
    for (const point of pathUpToCurrent) {
      const distance = Math.abs(point.ts - currentTs);
      if (distance < closestDistance) {
        closestPoint = point;
        closestDistance = distance;
      }
    }
    
    // Create marker icon for the current position
    const typeClass = state.types.has(event.type) ? event.type : "shahed";
    const iconMap = {
      shahed: "/ico/shahed.png",
      "shahed-multi": "/ico/shahed-multi.png",
      missile: "/ico/missle.png",
      "missile-multi": "/ico/missle-multi.png",
      kab: "/ico/kab.png",
      airplane: "/ico/airplane.png",
      recon: "/ico/bplaviewer.png",
      other: "/ico/shahed.png"
    };
    const markerVariant = resolveMarkerVariant(event);
    const iconKey = markerVariant && iconMap[markerVariant] ? markerVariant : typeClass;
    const iconUrl = iconMap[iconKey] || iconMap.other;
    
    const html = `
      <div class="marker-wrap">
        <img
          class="marker-icon-img ${typeClass} ${event.is_test ? "test" : "real"}"
          src="${iconUrl}"
          alt="${typeClass}"
          style="transform: rotate(${directionOrDefault(event.direction, event.fallbackDirection) + iconRotationOffset}deg);"
        />
      </div>
    `;
    
    const icon = L.divIcon({
      className: "",
      html,
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });
    
    // Show marker at the current position in timeline
    const marker = L.marker([closestPoint.lat, closestPoint.lng], { icon });
    
    const popup = buildPopupCard(event);
    marker.bindPopup(popup, { closeButton: true });
    marker.addTo(markerLayer);
    markerById.set(event.id, marker);
    
    // Draw future path (after current time) as a faded dashed line to show where it's going
    const futurePoints = sortedPoints.filter(p => p.ts > currentTs);
    if (futurePoints.length > 0 && pathUpToCurrent.length > 0) {
      const lastCurrent = pathUpToCurrent[pathUpToCurrent.length - 1];
      const futurePath = [[lastCurrent.lat, lastCurrent.lng], ...futurePoints.map(p => [p.lat, p.lng])];
      const futurePolyline = L.polyline(futurePath, {
        color: "rgba(53, 214, 255, 0.15)",
        weight: 1,
        opacity: 0.4,
        dashArray: "4 4"
      });
      historyLayer.addLayer(futurePolyline);
    }
  });
}

function enterTimelineMode() {
  if (!timelineSlider) return;
  
  state.timelineActive = true;
  
  // Hide regular markers and trails
  markerLayer.clearLayers();
  trajectoryLayer.clearLayers();
  shahedTrailLayer.clearLayers();
  trackLayer.clearLayers();
  
  rebuildTimelineData();
  startTimelineSyncTicker();
}

function exitTimelineMode() {
  if (!timelineSlider) return;
  
  state.timelineActive = false;
  stopTimelineSyncTicker();
  
  // Switch back to Radar tab
  const radarTab = Array.from(dockTabs).find(tab => tab.dataset.dock === "radar");
  if (radarTab) {
    radarTab.click();
  }
  
  // Clear timeline layers
  historyLayer.clearLayers();
  markerLayer.clearLayers();
  trajectoryLayer.clearLayers();
  markerById.clear();
  trajectoryById.clear();
  
  // Render current state with regular markers
  renderMarkers();
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

function parseNumericInput(value) {
  if (value == null) return null;
  const normalized = String(value).trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

async function ensureOblastLayer() {
  if (oblastGeoReady) return true;
  if (!oblastGeoPromise) {
    oblastGeoPromise = (async () => {
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
        return true;
      } catch (error) {
        console.warn("Failed to load oblast geojson", error);
        oblastGeoReady = false;
        return false;
      } finally {
        oblastGeoPromise = null;
      }
    })();
  }
  return oblastGeoPromise;
}

function renderAlarmMapSoon() {
  requestAnimationFrame(() => {
    renderAlarmMap().catch((error) => {
      console.warn("Failed to render alarm map", error);
    });
  });
}

function makeMarkerIcon(event) {
  const typeClass = state.types.has(event.type) ? event.type : "shahed";
  const iconMap = {
    shahed: "/ico/shahed.png",
    "shahed-multi": "/ico/shahed-multi.png",
    missile: "/ico/missle.png",
    "missile-multi": "/ico/missle-multi.png",
    kab: "/ico/kab.png",
    airplane: "/ico/airplane.png",
    recon: "/ico/bplaviewer.png",
    other: "/ico/shahed.png"
  };
  const markerVariant = resolveMarkerVariant(event);
  const iconKey = markerVariant && iconMap[markerVariant] ? markerVariant : typeClass;
  const iconUrl = iconMap[iconKey] || iconMap.other;
  const freshness = freshnessState(event);
  const spawnedAt = markerSpawnAt.get(event.id) || 0;
  const spawnClass = Date.now() - spawnedAt <= SPAWN_ANIMATION_MS ? "spawn" : "";
  const html = `
    <div class="marker-wrap ${freshness.markerClass} ${spawnClass}">
      <img
        class="marker-icon-img ${typeClass} ${event.is_test ? "test" : "real"}"
        src="${iconUrl}"
        alt="${typeClass}"
        style="transform: rotate(${directionOrDefault(event.direction, event.fallbackDirection) + iconRotationOffset}deg);"
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

function markerIconSignature(event) {
  const freshness = freshnessState(event);
  const spawnedAt = markerSpawnAt.get(event.id) || 0;
  const spawnClass = Date.now() - spawnedAt <= SPAWN_ANIMATION_MS ? "spawn" : "";
  return [
    resolveMarkerVariant(event) || event.type || "other",
    freshness.markerClass,
    spawnClass,
    event.is_test ? "test" : "real",
    directionOrDefault(event.direction, event.fallbackDirection)
  ].join("|");
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

function directionOrDefault(value, fallback = 0) {
  return Number.isFinite(value) ? normalizeAngle(value) : fallback;
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
  const arrivalThresholdKm = 0.2;
  let lastFrame = performance.now();
  const animate = (now) => {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const zoom = map.getZoom();
    const zoomFactor = zoom <= 7 ? 0.45 : zoom <= 9 ? 0.7 : 1;
    const nowMs = Date.now();
    driftById.forEach((item) => {
      if (item.spawnUntil && nowMs < item.spawnUntil) return;
      const stepKm = (speedMps * dt * zoomFactor) / 1000;
      let lat = item.baseLat;
      let lng = item.baseLng;
      if (Number.isFinite(item.targetLat) && Number.isFinite(item.targetLng) && item.reachedTarget !== true) {
        const remainingKm = haversineKm([item.baseLat, item.baseLng], [item.targetLat, item.targetLng]);
        if (remainingKm <= arrivalThresholdKm) {
          lat = item.targetLat;
          lng = item.targetLng;
          item.baseLat = lat;
          item.baseLng = lng;
          item.reachedTarget = true;
        } else {
          const nextStepKm = Math.min(stepKm, remainingKm);
          const ratio = nextStepKm / remainingKm;
          lat = item.baseLat + (item.targetLat - item.baseLat) * ratio;
          lng = item.baseLng + (item.targetLng - item.baseLng) * ratio;
          item.direction = bearingBetween([item.baseLat, item.baseLng], [item.targetLat, item.targetLng]);
          item.baseLat = lat;
          item.baseLng = lng;
          item.distanceKm += nextStepKm;
        }
      } else {
        if (item.distanceKm >= maxDistanceKm) return;
        item.distanceKm = Math.min(maxDistanceKm, item.distanceKm + stepKm);
        const distanceKm = item.distanceKm;
        const distanceDegLat = distanceKm / 111;
        const rad = (item.direction * Math.PI) / 180;
        lat = item.baseLat + distanceDegLat * Math.cos(rad);
        lng =
          item.baseLng + (distanceDegLat * Math.sin(rad)) / Math.cos((item.baseLat * Math.PI) / 180);
      }
      item.marker.setLatLng([lat, lng], { animate: true });
      const event = eventById.get(item.id);
      if (event) {
        upsertTrajectoryForEvent(event, lat, lng);
      }
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
            if (event) {
              const distanceKm = trackDistanceKm(item.track);
              item.marker.setPopupContent(buildPopupCard(event, distanceKm));
            }
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
    if (!isEventAlive(event)) return false;
    if (!state.showTests && event.is_test) return false;
    if (!state.selectedTypes.has(event.type)) return false;
    if (!state.selectedSources.has(event.source)) return false;
    return true;
  });
}

function renderHeaderStats() {
  if (visibleCount) {
    visibleCount.textContent = `Цілі: ${getVisibleEvents().length}`;
  }
  if (sourceCount) {
    sourceCount.textContent = `Джерела: ${state.sources.size}`;
  }
}

function renderHistory(events) {
  historyLayer.clearLayers();
  if (!state.showHistory) return;
  const rendered = new Set();
  events.forEach((event) => {
    const key = buildHistoryKey(event);
    if (rendered.has(key)) return;
    rendered.add(key);
    const track = getHistoryTrack(event);
    if (track.length < 2) return;
    L.polyline(track, {
      color: "#8b5cf6",
      weight: 2,
      opacity: 0.42,
      dashArray: "3 7"
    }).addTo(historyLayer);
  });
}

function renderMarkers() {
  // Skip if in timeline mode - timeline has its own rendering
  if (state.timelineActive) return;
  
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
    if (mapNotice) mapNotice.hidden = true;
    renderHeaderStats();
    return;
  }

  const filtered = getVisibleEvents();
  renderHeaderStats();

  if (mapNotice) {
    if (state.invalidEvents.length > 0) {
      const sampleSources = [...new Set(state.invalidEvents.map((event) => event.source).filter(Boolean))].slice(0, 2);
      const sourceHint = sampleSources.length > 0 ? ` Джерела: ${sampleSources.join(", ")}.` : "";
      mapNotice.textContent =
        `Частину цілей приховано: ${state.invalidEvents.length} без координат, тому вони не можуть бути показані на карті.${sourceHint}`;
      mapNotice.hidden = false;
    } else {
      mapNotice.hidden = true;
    }
  }

  const nextIds = new Set(filtered.map((event) => event.id));

  markerById.forEach((marker, id) => {
    if (!nextIds.has(id)) {
      markerLayer.removeLayer(marker);
      markerById.delete(id);
      const trajectory = trajectoryById.get(id);
      if (trajectory) {
        trajectoryLayer.removeLayer(trajectory.line);
        trajectoryLayer.removeLayer(trajectory.head);
        trajectoryById.delete(id);
      }
      markerIconSignatureById.delete(id);
      markerSpawnAt.delete(id);
      eventById.delete(id);
      const drift = driftById.get(id);
      if (drift?.trailLine) {
        shahedTrailLayer.removeLayer(drift.trailLine);
      }
      // Keep driftById data so marker state is preserved when filter is re-enabled
    }
  });

  filtered.forEach((event) => {
    const popup = buildPopupCard(event);

    if (markerById.has(event.id)) {
      const existing = markerById.get(event.id);
      const previous = eventById.get(event.id);
      const hasReportedMove =
        !previous ||
        Math.abs(Number(previous.lat) - Number(event.lat)) > 0.0001 ||
        Math.abs(Number(previous.lng) - Number(event.lng)) > 0.0001;
      const nextIconSignature = markerIconSignature(event);
      if (markerIconSignatureById.get(event.id) !== nextIconSignature) {
        existing.setIcon(makeMarkerIcon(event));
        markerIconSignatureById.set(event.id, nextIconSignature);
      }
      existing.setPopupContent(popup);
      eventById.set(event.id, event);
      if (!driftById.has(event.id)) {
        driftById.set(event.id, {
          id: event.id,
          marker: existing,
          baseLat: event.lat,
          baseLng: event.lng,
          direction: directionOrDefault(event.direction, event.fallbackDirection),
          distanceKm: 0,
          targetLat: Number.isFinite(event.target_lat) ? event.target_lat : null,
          targetLng: Number.isFinite(event.target_lng) ? event.target_lng : null,
          reachedTarget: false,
          track: [],
          trailLine: null,
          spawnUntil: Date.now()
        });
      }
      const drift = driftById.get(event.id);
      if (drift) {
        if (hasReportedMove) {
          existing.setLatLng([event.lat, event.lng]);
          const last = drift.track && drift.track.length > 0 ? drift.track[drift.track.length - 1] : null;
          const jumpKm = last ? haversineKm(last, [event.lat, event.lng]) : 0;
          if (!last || jumpKm > 40) {
            drift.track = [[event.lat, event.lng]];
          } else if (Math.abs(last[0] - event.lat) > 0.0001 || Math.abs(last[1] - event.lng) > 0.0001) {
            drift.track.push([event.lat, event.lng]);
            if (drift.track.length > 80) drift.track.shift();
          }
          drift.baseLat = event.lat;
          drift.baseLng = event.lng;
          drift.distanceKm = 0;
        }
        drift.targetLat = Number.isFinite(event.target_lat) ? event.target_lat : null;
        drift.targetLng = Number.isFinite(event.target_lng) ? event.target_lng : null;
        drift.reachedTarget = false;
      }
      if (drift && Number.isFinite(event.direction)) {
        drift.direction = directionOrDefault(event.direction, drift.direction);
      }
      if (drift && event.type === "shahed" && !drift.trailLine) {
        drift.trailLine = L.polyline(drift.track, {
          color: "#f59e0b",
          weight: 2,
          opacity: 0.7
        }).addTo(shahedTrailLayer);
      }
      upsertTrajectoryForEvent(event, drift?.baseLat || event.lat, drift?.baseLng || event.lng);
      return;
    }

    const marker = L.marker([event.lat, event.lng], { icon: makeMarkerIcon(event) });
    marker.bindPopup(popup, { closeButton: true });
    marker.addTo(markerLayer);
    marker.on("click", () => toggleTrackFor(event.id, marker));
    marker.on("popupopen", () => toggleTrackFor(event.id, marker));
    markerById.set(event.id, marker);
    markerIconSignatureById.set(event.id, markerIconSignature(event));
    markerSpawnAt.set(event.id, Date.now());
    eventById.set(event.id, event);
    
    // If drift data already exists (marker was hidden and re-shown), update marker reference
    // Otherwise, create new drift data
    if (driftById.has(event.id)) {
      const drift = driftById.get(event.id);
      drift.marker = marker;  // Update marker reference to the new marker object
      // Re-add trail line if it's a shahed and the trail was removed when marker was hidden
      if (event.type === "shahed" && drift.track && drift.track.length > 0) {
        if (!drift.trailLine || !shahedTrailLayer.hasLayer(drift.trailLine)) {
          drift.trailLine = L.polyline(drift.track, {
            color: "#f59e0b",
            weight: 2,
            opacity: 0.7
          }).addTo(shahedTrailLayer);
        }
      }
    } else {
      const drift = {
        id: event.id,
        marker,
        baseLat: event.lat,
        baseLng: event.lng,
        direction: directionOrDefault(event.direction, event.fallbackDirection),
        distanceKm: 0,
        targetLat: Number.isFinite(event.target_lat) ? event.target_lat : null,
        targetLng: Number.isFinite(event.target_lng) ? event.target_lng : null,
        reachedTarget: false,
        track: [[event.lat, event.lng]],
        trailLine: null,
        spawnUntil: Date.now() + SPAWN_ANIMATION_MS
      };
      if (event.type === "shahed") {
        drift.trailLine = L.polyline(drift.track, {
          color: "#f59e0b",
          weight: 2,
          opacity: 0.7
        }).addTo(shahedTrailLayer);
      }
      driftById.set(event.id, drift);
    }
    upsertTrajectoryForEvent(event, event.lat, event.lng);
  });
  
  renderHistory(filtered);
  startDrift();
}
function buildPopup(event, distanceKm) {
  const now = Date.now();
  const ageMs = eventAgeMs(event, now);
  const freshness = freshnessState(event, now);
  const ttlLeftMs = eventTtlLeftMs(event, now);
  const historyTrack = getHistoryTrack(event);
  const distanceLine = Number.isFinite(distanceKm)
    ? `<br /><span class="popup-meta">Пройдена відстань: ${distanceKm.toFixed(1)} км</span>`
    : "";
  const confidenceLine = Number.isFinite(event.confidence)
    ? `<br /><span class="popup-meta">Точність: ${Math.round(event.confidence * 100)}%</span>`
    : "";
  const userDistanceKm = distanceToUserKm(event);
  const eta = etaRangeForDistance(userDistanceKm);
  const approachLine = Number.isFinite(userDistanceKm)
    ? `<br /><span class="popup-meta">До вас: ${userDistanceKm.toFixed(1)} км</span><br /><span class="popup-meta">Швидкість: 150-185 км/год (середня)</span><br /><span class="popup-meta">Орієнтовний час підльоту: ${eta ? `${eta.fast} - ${eta.slow} (${eta.fastAt} - ${eta.slowAt} Kyiv)` : "—"}</span>`
    : "";
  const targetLine =
    event.target_label && Number.isFinite(event.target_lat) && Number.isFinite(event.target_lng)
      ? `<br /><span class="popup-meta">Центр цілі: ${event.target_label}</span>`
      : "";
  const evidenceCount = Number.isFinite(event.evidence_count) ? Math.max(1, event.evidence_count) : 1;
  const evidenceLine = `<br /><span class="popup-meta">Підтверджень: ${evidenceCount}</span>`;
  const groupCount = Math.max(Number(event.group_count_min ?? 0), Number(event.group_count_max ?? 0));
  const groupLine = groupCount >= 2
    ? `<br /><span class="popup-meta">Кількість у групі: ${Number(event.group_count_min) === Number(event.group_count_max) ? groupCount : `${event.group_count_min}-${event.group_count_max}`}</span>`
    : "";
  const evidenceSources = Array.isArray(event.evidence_sources) && event.evidence_sources.length > 0
    ? `<br /><span class="popup-meta">Джерела: ${event.evidence_sources.join(", ")}</span>`
    : "";
  const pinnedLabel = state.pinnedIds.has(event.id) ? "Відкріпити" : "Закріпити";
  const typeLabel = typeLabels[event.type] || event.type.toUpperCase();
  return `
      <div class="popup" data-event-id="${event.id}">
        <div class="popup-head">
          <strong class="popup-title">${typeLabel}</strong>
          <span class="popup-status ${freshness.popupClass}">${freshness.label}</span>
        </div>
        <div class="popup-grid">
          <span>Джерело: ${event.source}</span>
          <span>Час (Kyiv): ${formatTime(event.timestamp)}</span>
          <span>Вік мітки: ${formatAge(ageMs)}</span>
          <span>До авто-очищення: ${formatAge(ttlLeftMs)}</span>
          <span>Історія 24г: ${historyTrack.length} точок</span>
          <span>Тестовий: ${event.is_test ? "так" : "ні"}</span>
        </div>
        ${event.comment ? `<br />Коментар: ${event.comment}` : ""}
        ${targetLine}
        ${approachLine}
        ${confidenceLine}
        ${groupLine}
        ${evidenceLine}
        ${evidenceSources}
        ${distanceLine}
        <div class="popup-actions" style="margin-top:10px;display:flex;gap:8px;">
          <button class="ghost-btn" data-pin="${event.id}" type="button">${pinnedLabel}</button>
        </div>
      </div>
    `;
}

function buildPopupCard(event, distanceKm) {
  const now = Date.now();
  const ageMs = eventAgeMs(event, now);
  const freshness = freshnessState(event, now);
  const ttlLeftMs = eventTtlLeftMs(event, now);
  const historyTrack = getHistoryTrack(event);
  const trajectory = trajectorySummary(event);
  const userDistanceKm = distanceToUserKm(event);
  const eta = etaRangeForDistance(userDistanceKm);
  const evidenceCount = Number.isFinite(event.evidence_count) ? Math.max(1, event.evidence_count) : 1;
  const groupCount = Math.max(Number(event.group_count_min ?? 0), Number(event.group_count_max ?? 0));
  const pinnedLabel = state.pinnedIds.has(event.id) ? "Відкріпити" : "Закріпити";
  const typeLabel = typeLabels[event.type] || event.type.toUpperCase();
  const statItems = [
    { label: "Час", value: formatTime(event.timestamp) },
    { label: "Вік", value: formatAge(ageMs) },
    { label: "TTL", value: formatAge(ttlLeftMs) },
    { label: "Історія", value: `${historyTrack.length} т.` },
    { label: "Джерело", value: event.source },
    { label: "Підтв.", value: String(evidenceCount) }
  ];
  if (Number.isFinite(event.confidence)) statItems.push({ label: "Точність", value: `${Math.round(event.confidence * 100)}%` });
  if (groupCount >= 2) statItems.push({ label: "Група", value: String(groupCount) });
  if (Number.isFinite(distanceKm)) statItems.push({ label: "Трек", value: `${distanceKm.toFixed(1)} км` });
  if (Number.isFinite(userDistanceKm)) statItems.push({ label: "До вас", value: `${userDistanceKm.toFixed(1)} км` });

  const intelItems = [];
  if (event.target_label) {
    intelItems.push({
      label: Number.isFinite(event.target_lat) && Number.isFinite(event.target_lng) ? "Ціль" : "Напрямок",
      value: event.target_label
    });
  }
  if (trajectory) {
    intelItems.push({
      label: trajectory.hasExactTarget ? "Траєкторія" : "Прогноз",
      value: `${trajectory.direction} · ${trajectory.distanceKm.toFixed(0)} км`
    });
  }
  if (eta) {
    intelItems.push({ label: "Підліт", value: `${eta.fast} - ${eta.slow} (${eta.fastAt} - ${eta.slowAt})` });
  }
  if (Array.isArray(event.evidence_sources) && event.evidence_sources.length > 0) {
    intelItems.push({ label: "Сигнали", value: event.evidence_sources.join(", ") });
  }

  return `
    <div class="popup popup-modern" data-event-id="${event.id}">
      <div class="popup-shell">
        <div class="popup-head">
          <div>
            <strong class="popup-title">${typeLabel}</strong>
            <div class="popup-subtitle">${event.marker_label || event.comment || "Оперативна мітка"}</div>
          </div>
          <span class="popup-status ${freshness.popupClass}">${freshness.label}</span>
        </div>
        <div class="popup-grid popup-grid-modern">
          ${statItems.map((item) => `
            <div class="popup-stat">
              <span class="popup-stat-label">${item.label}</span>
              <strong class="popup-stat-value">${item.value}</strong>
            </div>
          `).join("")}
        </div>
        ${intelItems.length ? `
          <div class="popup-section">
            ${intelItems.map((item) => `
              <div class="popup-line">
                <span class="popup-line-label">${item.label}</span>
                <span class="popup-line-value">${item.value}</span>
              </div>
            `).join("")}
          </div>
        ` : ""}
        ${event.comment ? `<div class="popup-note">${event.comment}</div>` : ""}
        <div class="popup-actions">
          <button class="ghost-btn" data-pin="${event.id}" type="button">${pinnedLabel}</button>
        </div>
      </div>
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

function bearingBetween(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const dLng = toRad(b[1] - a[1]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((toDeg(Math.atan2(y, x)) % 360) + 360) % 360;
}

function trackDistanceKm(track) {
  if (!track || track.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < track.length; i += 1) {
    sum += haversineKm(track[i - 1], track[i]);
  }
  return sum;
}

function projectPoint([lat, lng], bearingDeg, distanceKm) {
  const R = 6371;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const angular = distanceKm / R;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
    Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
  );
  return [
    (lat2 * 180) / Math.PI,
    ((((lng2 * 180) / Math.PI) + 540) % 360) - 180
  ];
}

function estimatedTrajectoryEnd(event, baseLat = event.lat, baseLng = event.lng) {
  if (Number.isFinite(event?.target_lat) && Number.isFinite(event?.target_lng)) {
    return [event.target_lat, event.target_lng];
  }
  const direction = Number.isFinite(event?.direction) ? event.direction : event?.fallbackDirection;
  if (!Number.isFinite(direction) || !Number.isFinite(baseLat) || !Number.isFinite(baseLng)) return null;
  const distanceKm = event.type === "missile" ? 70 : event.type === "shahed" ? 42 : 28;
  return projectPoint([baseLat, baseLng], direction, distanceKm);
}

function trajectorySummary(event) {
  const end = estimatedTrajectoryEnd(event);
  if (!end) return null;
  const distanceKm = haversineKm([event.lat, event.lng], end);
  const direction = Number.isFinite(event.direction) ? `${Math.round(event.direction)}°` : "≈";
  return {
    direction,
    distanceKm,
    hasExactTarget: Number.isFinite(event?.target_lat) && Number.isFinite(event?.target_lng)
  };
}

function trajectoryCssAngle(bearingDeg) {
  return normalizeAngle(Number(bearingDeg || 0) + 90);
}

function makeTrajectoryArrowIcon(angle) {
  return L.divIcon({
    className: "trajectory-arrow-icon",
    html: `<div class="trajectory-arrow-head" style="transform: rotate(${trajectoryCssAngle(angle).toFixed(1)}deg);"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
}

function upsertTrajectoryForEvent(event, baseLat = event.lat, baseLng = event.lng) {
  const end = estimatedTrajectoryEnd(event, baseLat, baseLng);
  const existing = trajectoryById.get(event.id);
  if (!state.showTrajectories || !end) {
    if (existing) {
      trajectoryLayer.removeLayer(existing.line);
      trajectoryLayer.removeLayer(existing.head);
      trajectoryById.delete(event.id);
    }
    return;
  }
  const lineLatLngs = [[baseLat, baseLng], end];
  const angle = bearingBetween([baseLat, baseLng], end);
  if (existing) {
    existing.line.setLatLngs(lineLatLngs);
    existing.head.setLatLng(end);
    existing.head.setIcon(makeTrajectoryArrowIcon(angle));
    return;
  }
  const line = L.polyline(lineLatLngs, {
    color: "#58d5ff",
    weight: 2,
    opacity: 0.9,
    dashArray: "8 8"
  }).addTo(trajectoryLayer);
  const head = L.marker(end, {
    icon: makeTrajectoryArrowIcon(angle),
    interactive: false,
    keyboard: false
  }).addTo(trajectoryLayer);
  trajectoryById.set(event.id, { line, head });
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
    marker.setPopupContent(buildPopupCard(event, distanceKm));
  }
}

function riskScore(event) {
  const confidence = Number.isFinite(event.confidence) ? event.confidence : 0.5;
  const evidence = Number.isFinite(event.evidence_count) ? event.evidence_count : 1;
  return Math.min(1, confidence * 0.7 + Math.min(1, evidence / 5) * 0.3);
}

function getUserLatLng() {
  const lat = Number(state.userLocation?.lat);
  const lng = Number(state.userLocation?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

function distanceToUserKm(event) {
  const user = getUserLatLng();
  if (!user || !Number.isFinite(event?.lat) || !Number.isFinite(event?.lng)) return null;
  return haversineKm([event.lat, event.lng], user);
}

function formatClockTimeKyiv(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "вЂ”";
  return date.toLocaleTimeString("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function formatEtaFromHours(hours) {
  const totalMinutes = Math.max(1, Math.round(hours * 60));
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  if (hh <= 0) return `${mm} хв`;
  return `${hh} год ${mm.toString().padStart(2, "0")} хв`;
}

function etaRangeForDistance(distanceKm) {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return null;
  const fastHours = distanceKm / 185;
  const slowHours = distanceKm / 150;
  const now = Date.now();
  return {
    fast: formatEtaFromHours(fastHours),
    slow: formatEtaFromHours(slowHours),
    fastAt: formatClockTimeKyiv(now + fastHours * 60 * 60 * 1000),
    slowAt: formatClockTimeKyiv(now + slowHours * 60 * 60 * 1000)
  };
}

function nearbyVisibleEvents() {
  const radius = 100;
  return [...getVisibleEvents()]
    .map((event) => ({ event, distanceKm: distanceToUserKm(event) }))
    .filter((item) => Number.isFinite(item.distanceKm) && item.distanceKm <= radius)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

function updateGeoStatus() {
  const active = Boolean(getUserLatLng());
  if (geoToggle) {
    geoToggle.textContent = active ? "Вимкнути геолокацію" : "Увімкнути геолокацію";
  }
  if (geoStatus) {
    geoStatus.textContent = active
      ? `Позиція активна${Number.isFinite(state.userLocation?.accuracy) ? ` · ±${Math.round(state.userLocation.accuracy)} м` : ""}`
      : "Геолокація вимкнена";
  }
}

function renderUserLocation() {
  userLayer.clearLayers();
  userMarker = null;
  userAccuracyCircle = null;
  const user = getUserLatLng();
  if (!user) {
    updateGeoStatus();
    return;
  }
  const accuracy = Number(state.userLocation?.accuracy);
  userAccuracyCircle = L.circle(user, {
    radius: Number.isFinite(accuracy) ? accuracy : 120,
    color: "#35d6ff",
    weight: 1,
    fillColor: "#35d6ff",
    fillOpacity: 0.08
  }).addTo(userLayer);
  userMarker = L.circleMarker(user, {
    radius: 6,
    color: "#35d6ff",
    weight: 2,
    fillColor: "#35d6ff",
    fillOpacity: 0.9
  }).addTo(userLayer);
  userMarker.bindTooltip("Ви", { direction: "top", offset: [0, -4] });
  updateGeoStatus();
}

function renderLocalAlert() {
  if (!localAlert) return;
  localAlert.innerHTML = "";
  const user = getUserLatLng();
  if (!user) {
    localAlert.innerHTML = '<div class="feed-item">Увімкніть геолокацію, щоб бачити локальний ризик.</div>';
    return;
  }
  const radius = Number(state.dangerRadiusKm) || 25;
  const nearby = nearbyVisibleEvents();
  const critical = nearby.filter((item) => item.distanceKm <= radius);
  const nearest = nearby[0] || null;
  const rows = [];
  rows.push(`<div class="feed-item"><div class="meta">Критична зона</div><div>${critical.length} цілей у радіусі ${radius} км</div></div>`);
  if (nearest) {
    const eta = etaRangeForDistance(nearest.distanceKm);
    rows.push(`<div class="feed-item"><div class="meta">Найближча ціль</div><div>${nearest.event.raw_text || nearest.event.comment || nearest.event.type}</div><div class="meta">${nearest.distanceKm.toFixed(1)} км${eta ? ` · ${eta.fast} - ${eta.slow}` : ""}</div></div>`);
  }
  localAlert.innerHTML = rows.join("");
}

function isRadarModalOpen() {
  return Boolean(radarModal?.classList.contains("active"));
}

function ensureRadarMap() {
  if (!radarMapNode || radarMap || !isRadarModalOpen()) return;
  const styleKey = mapStyleSelect?.value || "carto-dark";
  const style = mapStyleCatalog[styleKey] || mapStyleCatalog["carto-dark"];
  radarMap = L.map(radarMapNode, {
    zoomControl: false,
    attributionControl: true,
    zoomSnap: 0.25,
    zoomDelta: 0.25,
    dragging: false,
    touchZoom: false,
    doubleClickZoom: false,
    scrollWheelZoom: false,
    boxZoom: false,
    keyboard: false,
    tap: false
  }).setView([49.0, 31.0], 9);
  radarTileLayer = L.tileLayer(style.url, style.options).addTo(radarMap);
  radarStyleKey = styleKey;
  radarUserLayer = L.layerGroup().addTo(radarMap);
  radarTargetLayer = L.layerGroup().addTo(radarMap);
}

function refreshRadarLayout() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ensureRadarMap();
      if (!radarMap) return;
      radarMap.invalidateSize();
      renderRadarCanvas();
    });
  });
}

function unlockRadarViewport() {
  if (!radarMap) return;
  radarMap.setMinZoom(3);
  radarMap.setMaxZoom(18);
  radarMap.setMaxBounds(null);
}

function getRadarLockedZoom(centerLat, radiusKm) {
  if (!radarMap) return 8;
  const size = radarMap.getSize();
  const usablePixels = Math.max(120, Math.min(size.x, size.y) - 32);
  const diameterMeters = radiusKm * 2000 * 1.08;
  const metersPerPixelAtZoom0 = 156543.03392 * Math.cos((centerLat * Math.PI) / 180);
  const rawZoom = Math.log2((metersPerPixelAtZoom0 * usablePixels) / diameterMeters);
  return Math.max(8, Math.min(11, Math.round(rawZoom * 4) / 4));
}

function buildRadarBounds(centerLat, centerLng, radiusKm) {
  const latDelta = radiusKm / 111.32;
  const lngDelta = radiusKm / (111.32 * Math.max(Math.cos((centerLat * Math.PI) / 180), 0.2));
  return L.latLngBounds(
    [centerLat - latDelta, centerLng - lngDelta],
    [centerLat + latDelta, centerLng + lngDelta]
  );
}

function lockRadarViewport(centerLat, centerLng, radiusKm = 100) {
  if (!radarMap) return;
  unlockRadarViewport();
  radarMap.invalidateSize();
  if (Number.isFinite(centerLat) && Number.isFinite(centerLng)) {
    const bounds = buildRadarBounds(centerLat, centerLng, radiusKm);
    const lockedZoom = getRadarLockedZoom(centerLat, radiusKm);
    radarMap.setView([centerLat, centerLng], lockedZoom, { animate: false });
    radarMap.setMinZoom(lockedZoom);
    radarMap.setMaxZoom(lockedZoom);
    radarMap.setMaxBounds(bounds.pad(0.06));
    radarMap.panInsideBounds(bounds.pad(0.06), { animate: false });
    return;
  }
  radarMap.setView([49.0, 31.0], 6, { animate: false });
  const lockedZoom = radarMap.getZoom();
  radarMap.setMinZoom(lockedZoom);
  radarMap.setMaxZoom(lockedZoom);
}

function syncRadarMapStyle() {
  if (!radarMap) return;
  const styleKey = mapStyleSelect?.value || "carto-dark";
  if (radarStyleKey === styleKey && radarTileLayer) return;
  if (radarTileLayer) {
    radarMap.removeLayer(radarTileLayer);
  }
  const style = mapStyleCatalog[styleKey] || mapStyleCatalog["carto-dark"];
  radarTileLayer = L.tileLayer(style.url, style.options).addTo(radarMap);
  radarStyleKey = styleKey;
}

function renderRadarCanvas() {
  const radarRadiusKm = 100;
  const user = getUserLatLng();
  const nearby = user ? nearbyVisibleEvents() : [];
  if (radarSummary) {
    radarSummary.innerHTML = user
      ? `<span>Цілей у радіусі: ${nearby.length}</span><span>Радіус: ${radarRadiusKm} км</span>`
      : `<span>Немає геолокації</span><span>Радіус: ${radarRadiusKm} км</span>`;
  }
  if (!isRadarModalOpen() && !radarMap) {
    return;
  }
  ensureRadarMap();
  if (!radarMap || !radarUserLayer || !radarTargetLayer) return;
  syncRadarMapStyle();
  radarUserLayer.clearLayers();
  radarTargetLayer.clearLayers();

  if (!user) {
    lockRadarViewport();
    return;
  }

  const userLatLng = [user[0], user[1]];
  L.circle(userLatLng, {
    radius: radarRadiusKm * 1000,
    color: "#35d6ff",
    weight: 2,
    fillColor: "#35d6ff",
    fillOpacity: 0.06,
    opacity: 0.9
  }).addTo(radarUserLayer);
  const ringMeters = (radarRadiusKm * 1000) / 4;
  for (let i = 1; i <= 4; i += 1) {
    L.circle(userLatLng, {
      radius: ringMeters * i,
      color: "#1e6f93",
      weight: i === 4 ? 1.4 : 1,
      fill: false,
      opacity: 0.8
    }).addTo(radarUserLayer);
  }
  L.circleMarker(userLatLng, {
    radius: 6,
    color: "#35d6ff",
    weight: 2,
    fillColor: "#35d6ff",
    fillOpacity: 0.95
  }).bindTooltip("Ви", { direction: "top", offset: [0, -4] }).addTo(radarUserLayer);

  nearby.forEach(({ event, distanceKm }) => {
    const eta = etaRangeForDistance(distanceKm);
    const hot = distanceKm <= (Number(state.dangerRadiusKm) || 25);
    L.circleMarker([event.lat, event.lng], {
      radius: hot ? 7 : 5,
      color: hot ? "#ff4d42" : "#ffb326",
      weight: 2,
      fillColor: hot ? "#ff4d42" : "#ffb326",
      fillOpacity: 0.9
    }).bindTooltip(
      `${event.type.toUpperCase()} · ${distanceKm.toFixed(1)} км${eta ? ` · ${eta.fast}-${eta.slow}` : ""}`,
      { direction: "top", offset: [0, -2] }
    ).addTo(radarTargetLayer);
  });

  lockRadarViewport(user[0], user[1], radarRadiusKm);
}

function handleGeoSuccess(position) {
  state.userLocation = {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy
  };
  renderUserLocation();
  renderRadarList();
  renderIntelFeed();
  renderLocalAlert();
  renderRadarCanvas();
}

function stopGeolocation() {
  if (geoWatchId != null && navigator.geolocation) {
    navigator.geolocation.clearWatch(geoWatchId);
  }
  geoWatchId = null;
  state.userLocation = null;
  renderUserLocation();
  renderRadarList();
  renderIntelFeed();
  renderLocalAlert();
  renderRadarCanvas();
}

function startGeolocation() {
  if (!navigator.geolocation) {
    alert("Геолокація не підтримується цим браузером.");
    return;
  }
  if (geoWatchId != null) return;
  geoWatchId = navigator.geolocation.watchPosition(
    handleGeoSuccess,
    () => {
      stopGeolocation();
      alert("Не вдалося отримати геолокацію.");
    },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 }
  );
}

function renderRadarList() {
  if (!radarList) return;
  radarList.innerHTML = "";
  const items = getUserLatLng()
    ? nearbyVisibleEvents().slice(0, 14)
    : [...getVisibleEvents()]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 14)
      .map((event) => ({ event, distanceKm: null }));
  if (items.length === 0) {
    radarList.innerHTML = getUserLatLng()
      ? "<div class=\"feed-item\">У вибраному радіусі цілей немає.</div>"
      : "<div class=\"feed-item\">Увімкніть геолокацію для локального радара.</div>";
    return;
  }
  items.forEach(({ event, distanceKm }) => {
    const text = event.raw_text || event.comment || `${event.type} ${event.source}`;
    const age = formatAge(eventAgeMs(event));
    const status = freshnessState(event).label;
    const isPinned = state.pinnedIds.has(event.id);
    const eta = etaRangeForDistance(distanceKm);
    const row = document.createElement("div");
    row.className = "feed-item";
    row.innerHTML = `
      <div class="meta">${formatTime(event.timestamp)} · ${event.source} · ${age}</div>
      <div>${text}</div>
      <div class="meta">${status}${Number.isFinite(distanceKm) ? ` · ${distanceKm.toFixed(1)} км${eta ? ` · ${eta.fast} - ${eta.slow}` : ""}` : ""}</div>
      <div class="actions">
        <button class="ghost-btn" data-focus="${event.id}">Фокус</button>
        <button class="ghost-btn" data-pin="${event.id}">${isPinned ? "Відкріпити" : "Закріпити"}</button>
      </div>
    `;
    radarList.appendChild(row);
  });
}

function renderDockWatchlist() {
  if (!watchlistList) return;
  watchlistList.innerHTML = "";
  const items = state.events.filter((event) => state.pinnedIds.has(event.id));
  if (items.length === 0) {
    watchlistList.innerHTML = "<div class=\"feed-item\">Немає закріплених цілей.</div>";
    return;
  }
  items.forEach((event) => {
    const row = document.createElement("div");
    row.className = "feed-item";
    row.innerHTML = `
      <div class="meta">${formatTime(event.timestamp)} · ${event.source}</div>
      <div>${event.raw_text || event.comment || event.type}</div>
      <div class="actions">
        <button class="ghost-btn" data-focus="${event.id}">Фокус</button>
        <button class="ghost-btn" data-pin="${event.id}">Відкріпити</button>
      </div>
    `;
    watchlistList.appendChild(row);
  });
}

function renderAlarmList() {
  if (!alarmList) return;
  alarmList.innerHTML = "";
  const active = new Set(state.alarms || []);
  const districtItems = Array.isArray(state.districtAlarms) ? state.districtAlarms : [];
  if (active.size === 0 && districtItems.length === 0) {
    alarmList.innerHTML = "<div class=\"feed-item\">Тривог немає.</div>";
    return;
  }
  oblasts
    .filter((region) => active.has(region.id))
    .forEach((region) => {
      const row = document.createElement("div");
      row.className = "feed-item";
      row.textContent = region.name;
      alarmList.appendChild(row);
    });
  districtItems.forEach((district) => {
    const row = document.createElement("div");
    row.className = "feed-item";
    row.textContent = `${district.name} (${district.region_id})`;
    alarmList.appendChild(row);
  });
}

function renderIntelFeed() {
  if (!intelFeed) return;
  intelFeed.innerHTML = "";
  const items = [...getVisibleEvents()]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 20);
  if (items.length === 0) {
    intelFeed.innerHTML = "<div class=\"feed-item\">Intel порожній.</div>";
    return;
  }
  items.forEach((event) => {
    const score = riskScore(event);
    const isHot = score >= 0.75;
    const row = document.createElement("div");
    row.className = "feed-item";
    row.innerHTML = `
      <div class="meta">${formatTime(event.timestamp)} · ${event.source}</div>
      <div>${event.raw_text || event.comment || event.type}</div>
      <div class="meta">
        Ризик: ${(score * 100).toFixed(0)}%
        ${isHot ? '<span class="badge alert">HOT</span>' : ""}
      </div>
      <div class="actions">
        <button class="ghost-btn" data-focus="${event.id}">Фокус</button>
        <button class="ghost-btn" data-pin="${event.id}">${state.pinnedIds.has(event.id) ? "Відкріпити" : "Закріпити"}</button>
      </div>
    `;
    intelFeed.appendChild(row);
  });
}

function renderPinnedList() {
  if (!pinnedList) return;
  pinnedList.innerHTML = "";
  const items = state.events.filter((event) => state.pinnedIds.has(event.id));
  if (items.length === 0) {
    pinnedList.innerHTML = "<div class=\"feed-item\">Закріплень немає.</div>";
    return;
  }
  items.slice(0, 8).forEach((event) => {
    const row = document.createElement("div");
    row.className = "feed-item";
    row.innerHTML = `
      <div class="meta">${formatTime(event.timestamp)} · ${event.source}</div>
      <div>${event.raw_text || event.comment || event.type}</div>
      <div class="actions">
        <button class="ghost-btn" data-focus="${event.id}">Фокус</button>
        <button class="ghost-btn" data-pin="${event.id}">Відкріпити</button>
      </div>
    `;
    pinnedList.appendChild(row);
  });
}

function renderMetrics() {
  const visible = getVisibleEvents();
  if (metricActive) metricActive.textContent = String(visible.length);
  if (metricTests) metricTests.textContent = String(visible.filter((event) => event.is_test).length);
  if (metricSources) metricSources.textContent = String(state.sources.size);
  if (metricConfidence) {
    const avg = visible.length
      ? visible.reduce((sum, event) => sum + (Number.isFinite(event.confidence) ? event.confidence : 0.5), 0) /
        visible.length
      : 0;
    metricConfidence.textContent = `${Math.round(avg * 100)}%`;
  }
}

async function renderAlarmMap() {
  if (!alarmsEnabled) {
    alarmLayer.clearLayers();
    districtAlarmLayer.clearLayers();
    return;
  }
  const active = new Set(state.alarms || []);
  console.log("[ALARM DEBUG] state.alarms:", state.alarms, "state.districtAlarms:", state.districtAlarms);
  if (active.size === 0 && (!Array.isArray(state.districtAlarms) || state.districtAlarms.length === 0)) {
    districtAlarmLayer.clearLayers();
    if (oblastGeoReady && oblastGeoLayer) {
      oblastGeoLayer.eachLayer((layer) => {
        layer.setStyle({
          color: "transparent",
          opacity: 0,
          weight: 0,
          fill: true,
          fillColor: "transparent",
          fillOpacity: 0
        });
      });
    }
    return;
  }
  districtAlarmLayer.clearLayers();
  (state.districtAlarms || []).forEach((district) => {
    if (!Number.isFinite(Number(district.lat)) || !Number.isFinite(Number(district.lng))) return;
    const marker = L.circleMarker([Number(district.lat), Number(district.lng)], {
      radius: 7,
      color: "#ff3b30",
      weight: 2,
      fillColor: "#ff3b30",
      fillOpacity: 0.4
    });
    marker.bindTooltip(district.name, { direction: "top", offset: [0, -2] });
    marker.addTo(districtAlarmLayer);
  });
  if (!oblastGeoReady) {
    const loaded = await ensureOblastLayer();
    if (!loaded) return;
  }

  if (oblastGeoReady && oblastGeoLayer) {
    const inactiveStyle = {
      color: "transparent",
      opacity: 0,
      weight: 0,
      fill: true,
      fillColor: "transparent",
      fillOpacity: 0
    };
    const activeStyle = {
      color: "#ff3b30",
      opacity: 0.9,
      weight: 1.5,
      fill: true,
      fillColor: "#ff3b30",
      fillOpacity: 0.12
    };
    oblastGeoLayer.eachLayer((layer) => {
      const feature = layer.feature || {};
      const id = feature.properties?._regionId;
      const isActive = id && active.has(id);
      layer.setStyle(isActive ? activeStyle : inactiveStyle);
      if (typeof layer.redraw === "function") {
        layer.redraw();
      }
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

function playPing() {
  if (!state.soundEnabled) return;
  const now = Date.now();
  if (now - lastSoundAt < SOUND_COOLDOWN_MS) return;
  lastSoundAt = now;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 740;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  } catch (error) {
    console.warn("Sound failed", error);
  }
}

function syncPinnedStore() {
  localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify([...state.pinnedIds]));
}

function togglePin(eventId) {
  if (state.pinnedIds.has(eventId)) {
    state.pinnedIds.delete(eventId);
  } else {
    state.pinnedIds.add(eventId);
  }
  syncPinnedStore();
  renderRadarList();
  renderIntelFeed();
  renderPinnedList();
  renderDockWatchlist();
}

function focusEvent(eventId) {
  const event = eventById.get(eventId) || state.events.find((item) => item.id === eventId);
  if (!event) return;
  map.panTo([event.lat, event.lng], { animate: true, duration: 1 });
  const marker = markerById.get(eventId);
  if (marker) marker.openPopup();
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportBriefNow() {
  const visible = getVisibleEvents();
  const payload = {
    exported_at: new Date().toISOString(),
    count: visible.length,
    filters: {
      types: [...state.selectedTypes],
      sources: [...state.selectedSources]
    },
    events: visible
  };
  downloadJson(`skywatch-brief-${Date.now()}.json`, payload);
}

function renderSavedViews() {
  if (!savedViewsList) return;
  savedViewsList.innerHTML = "";
  if (!state.savedViews.length) {
    savedViewsList.innerHTML = "<div class=\"saved-view\">Поки що немає збережених видів.</div>";
    return;
  }
  state.savedViews.forEach((view) => {
    const row = document.createElement("div");
    row.className = "saved-view";
    row.innerHTML = `
      <span>${view.name}</span>
      <span>
        <button data-view-apply="${view.id}">Застосувати</button>
        <button data-view-remove="${view.id}">✕</button>
      </span>
    `;
    savedViewsList.appendChild(row);
  });
}

function persistSavedViews() {
  localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(state.savedViews));
}

function saveCurrentView() {
  const name = window.prompt("Назва виду", "Оперативний");
  if (!name) return;
  const center = map.getCenter();
  const view = {
    id: `view-${Date.now()}`,
    name: name.trim() || "Оперативний",
    center: { lat: center.lat, lng: center.lng },
    zoom: map.getZoom(),
    types: [...state.selectedTypes],
    sources: [...state.selectedSources],
    ttl: state.markerTtlMs,
    refresh: state.refreshIntervalMs,
    mapStyle: localStorage.getItem("sw_map_style") || "osm"
  };
  state.savedViews = [view, ...state.savedViews].slice(0, 8);
  persistSavedViews();
  renderSavedViews();
}

function applySavedView(view) {
  state.selectedTypes = new Set(view.types || []);
  state.selectedSources = new Set(view.sources || []);
  state.markerTtlMs = view.ttl || DEFAULT_MARKER_TTL_MS;
  if (ttlSelect) ttlSelect.value = String(state.markerTtlMs);
  applyRefreshInterval(view.refresh || state.refreshIntervalMs);
  applyMapStyle(view.mapStyle || "osm");
  map.setView([view.center.lat, view.center.lng], view.zoom || 6, { animate: true, duration: 0.8 });
  renderFilterControls();
  renderMarkers();
  renderRadarList();
  renderIntelFeed();
  renderPinnedList();
  renderDockWatchlist();
  renderMetrics();
}

function deleteSavedView(id) {
  state.savedViews = state.savedViews.filter((view) => view.id !== id);
  persistSavedViews();
  renderSavedViews();
}

async function refresh(force = false) {
  if (refreshInFlight) return refreshInFlight;
  if (state.refreshPaused && !force) return;

  refreshInFlight = (async () => {
  try {
    const previousIds = new Set(state.events.map((event) => event.id));
    const { events, needsFastRetry } = await loadEvents();
    ingestHistory(events);
    
    // Merge new events with old alive events (incremental update, not full replacement)
    const newEventsMap = new Map(events.map((e) => [e.id, e]));
    const oldEventsMap = new Map(state.events.map((e) => [e.id, e]));
    
    // Start with new events from API (these are latest)
    state.events = events.slice();
    
    // Keep old events that are still alive but not in the new list
    oldEventsMap.forEach((oldEvent, eventId) => {
      if (!newEventsMap.has(eventId) && isEventAlive(oldEvent)) {
        state.events.push(oldEvent);
      }
    });
    const filtersChanged = updateFilterSets(events);
    if (filtersChanged) {
      renderFilterControls();
    }
    renderMarkers();
    renderRadarList();
    renderAlarmList();
    renderIntelFeed();
    renderLocalAlert();
    renderPinnedList();
    renderDockWatchlist();
    renderMetrics();
    renderRadarCanvas();
    renderAlarmMapSoon();
    saveSnapshotStore();
    if (!state.maintenance && state.autoFollow) {
      followLatestTarget();
    }
    if (state.maintenance && state.maintenanceUntil) {
      startMaintenanceCountdown();
      updateMaintenanceCountdown();
    } else {
      stopMaintenanceCountdown();
    }
    const hasNew = events.some((event) => !previousIds.has(event.id));
    if (hasNew) playPing();
    if (needsFastRetry) {
      scheduleFastRetry();
    } else {
      clearFastRetryTimer();
    }
    if (lastUpdated) {
      lastUpdated.textContent = `Оновлення: ${formatTime(new Date().toISOString())}`;
    }
  } catch (error) {
    console.error("Failed to refresh", error);
  } finally {
    refreshInFlight = null;
  }
  })();

  return refreshInFlight;
}

if (toggleTests) {
  toggleTests.addEventListener("change", (event) => {
    state.showTests = event.target.checked;
    renderMarkers();
    renderRadarList();
    renderIntelFeed();
    renderPinnedList();
    renderDockWatchlist();
    renderMetrics();
  });
}

function openAdminModal() {
  adminModal.classList.add("active");
}

function closeAdminModal() {
  adminModal.classList.remove("active");
}

function setAdminPickStatus(message) {
  if (adminPickStatus) {
    adminPickStatus.textContent = message;
  }
}

function getAdminCityLocations() {
  return (state.adminLocations || [])
    .filter((item) => (item.location_type || "city") === "city")
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "uk"));
}

function populateAdminParentSelect(selectedId = "") {
  if (!adminLocationParent) return;
  adminLocationParent.innerHTML = '<option value="">Без прив\'язки</option>';
  getAdminCityLocations().forEach((location) => {
    const option = document.createElement("option");
    option.value = location.id;
    option.textContent = location.name;
    adminLocationParent.appendChild(option);
  });
  adminLocationParent.value = selectedId || "";
}

function beginAdminMapPick(mode) {
  if (mode === "spawn-point" && !adminLocationSelect?.value && !adminLocationName?.value.trim()) {
    alert("Спочатку вибери або створи локацію / район.");
    return;
  }
  state.adminMapPickMode = mode;
  closeAdminModal();
  const label = mode === "city-center" ? "центр локації / району" : "спавн-точку";
  setAdminPickStatus(`Режим вибору: клікни по карті, щоб поставити ${label}.`);
}

function renderAdminLocations() {
  if (!adminLocationList) return;
  adminLocationList.innerHTML = "";
  const byId = new Map((state.adminLocations || []).map((item) => [item.id, item]));
  (state.adminLocations || []).forEach((location) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "admin-location-item";
    const pointCount = Array.isArray(location.points) ? location.points.length : 0;
    const typeLabel = (location.location_type || "city") === "district" ? "Район" : "Місто";
    const parent = location.parent_location_id ? byId.get(location.parent_location_id) : null;
    item.innerHTML = `
      <strong>${location.name}</strong>
      <span>${typeLabel}${parent ? ` · ${parent.name}` : ""}</span>
      <span>${Number(location.lat).toFixed(4)}, ${Number(location.lng).toFixed(4)}</span>
      <span>Точок: ${pointCount}</span>
    `;
    item.addEventListener("click", () => {
      if (adminLocationSelect) adminLocationSelect.value = location.id;
      if (adminLocationName) adminLocationName.value = location.name || "";
      if (adminLocationType) adminLocationType.value = location.location_type || "city";
      populateAdminParentSelect(location.parent_location_id || "");
      if (adminLocationKeys) adminLocationKeys.value = Array.isArray(location.keys) ? location.keys.join(", ") : "";
      if (adminLocationLat) adminLocationLat.value = location.lat ?? "";
      if (adminLocationLng) adminLocationLng.value = location.lng ?? "";
      if (adminLocationRegion) adminLocationRegion.value = location.region_id || "";
    });
    adminLocationList.appendChild(item);
  });
}

function renderAdminPoints(location) {
  if (!adminPointList) return;
  adminPointList.innerHTML = "";
  const points = Array.isArray(location?.points) ? location.points : [];
  if (points.length === 0) {
    const empty = document.createElement("div");
    empty.className = "admin-point-item";
    empty.textContent = "Для цієї локації ще немає спавн-точок.";
    adminPointList.appendChild(empty);
    return;
  }

  points.forEach((point, index) => {
    const item = document.createElement("div");
    item.className = "admin-point-item";
    const types = Array.isArray(point.types) && point.types.length > 0 ? point.types.join(", ") : "all";
    item.textContent = `${index + 1}. ${Number(point.lat).toFixed(4)}, ${Number(point.lng).toFixed(4)} | ${types}`;
    adminPointList.appendChild(item);
  });
}

function syncAdminLocationForm(selectedId = "") {
  const selected = (state.adminLocations || []).find((item) => item.id === selectedId);
  if (!selected) {
    if (adminLocationName) adminLocationName.value = "";
    if (adminLocationType) adminLocationType.value = "city";
    populateAdminParentSelect("");
    if (adminLocationParent) adminLocationParent.disabled = true;
    if (adminLocationKeys) adminLocationKeys.value = "";
    if (adminLocationLat) adminLocationLat.value = "";
    if (adminLocationLng) adminLocationLng.value = "";
    if (adminLocationRegion) adminLocationRegion.value = "";
    renderAdminPoints(null);
    return null;
  }
  if (adminLocationName) adminLocationName.value = selected.name || "";
  if (adminLocationType) adminLocationType.value = selected.location_type || "city";
  populateAdminParentSelect(selected.parent_location_id || "");
  if (adminLocationParent) adminLocationParent.disabled = (selected.location_type || "city") !== "district";
  if (adminLocationKeys) adminLocationKeys.value = Array.isArray(selected.keys) ? selected.keys.join(", ") : "";
  if (adminLocationLat) adminLocationLat.value = selected.lat ?? "";
  if (adminLocationLng) adminLocationLng.value = selected.lng ?? "";
  if (adminLocationRegion) adminLocationRegion.value = selected.region_id || "";
  renderAdminPoints(selected);
  return selected;
}

function populateAdminLocationSelect() {
  if (!adminLocationSelect) return;
  adminLocationSelect.innerHTML = '<option value="">Нова локація / район</option>';
  const ordered = [...(state.adminLocations || [])].sort((a, b) => {
    const typeA = a.location_type || "city";
    const typeB = b.location_type || "city";
    if (typeA !== typeB) return typeA === "city" ? -1 : 1;
    return String(a.name || "").localeCompare(String(b.name || ""), "uk");
  });
  ordered.forEach((location) => {
    const option = document.createElement("option");
    option.value = location.id;
    const label = (location.location_type || "city") === "district" ? "район" : "місто";
    option.textContent = `${location.name} · ${label} (${Array.isArray(location.points) ? location.points.length : 0} т.)`;
    adminLocationSelect.appendChild(option);
  });
}

async function loadAdminLocations(preferredId = "") {
  const response = await fetch("/api/admin/locations", { method: "GET", cache: "no-store" });
  if (!response.ok) return;
  const data = await response.json();
  state.adminLocations = Array.isArray(data.items) ? data.items : [];
  populateAdminLocationSelect();
  populateAdminParentSelect();
  renderAdminLocations();
  if (adminLocationSelect && preferredId) {
    adminLocationSelect.value = preferredId;
  }
  syncAdminLocationForm(adminLocationSelect?.value || preferredId || "");
}

function upsertAdminLocationState(item) {
  if (!item || !item.id) return;
  const items = Array.isArray(state.adminLocations) ? [...state.adminLocations] : [];
  const index = items.findIndex((location) => location.id === item.id);
  if (index === -1) {
    items.push(item);
  } else {
    items[index] = item;
  }
  state.adminLocations = items;
}

async function loadAdminStatus() {
  const response = await fetch("/api/admin/status", { method: "GET" });
  if (!response.ok) {
    adminPanel.classList.add("hidden");
    adminLoginForm.classList.remove("hidden");
    adminStatus.textContent = "Гість";
    maintenanceUntil.textContent = "—";
    state.adminBypassMaintenance = false;
    state.adminLocations = [];
    localStorage.removeItem("sw_admin_bypass");
    populateAdminLocationSelect();
    renderAdminLocations();
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
  await loadAdminLocations();
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
function resetReportForm() {
  if (!reportForm) return;
  reportForm.reset();
  if (reportType) reportType.value = "shahed";
  if (reportCount) reportCount.value = "1";
  if (reportSeenAt) {
    const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    reportSeenAt.value = now.toISOString().slice(0, 16);
  }
  if (reportStatus) {
    reportStatus.textContent = "Після підтвердження адміністратором мітка з'явиться на карті.";
    reportStatus.classList.remove("error", "success");
  }
}

function openReportModal() {
  if (!reportModal) return;
  resetReportForm();
  reportModal.classList.add("active");
}

function closeReportModal() {
  if (!reportModal) return;
  reportModal.classList.remove("active");
}

async function submitUserReport() {
  const payload = {
    type: reportType?.value || "shahed",
    count: Number(reportCount?.value || 1) || 1,
    location: reportLocation?.value?.trim() || "",
    target: reportTarget?.value?.trim() || "",
    seen_at: reportSeenAt?.value ? new Date(reportSeenAt.value).toISOString() : new Date().toISOString(),
    note: reportNote?.value?.trim() || "",
    contact_name: reportContactName?.value?.trim() || "",
    contact_link: reportContactLink?.value?.trim() || ""
  };

  if (!payload.location) {
    if (reportStatus) {
      reportStatus.textContent = "Вкажіть, де зараз помічена ціль.";
      reportStatus.classList.add("error");
    }
    return;
  }

  if (reportStatus) {
    reportStatus.textContent = "Відправляю заявку в Telegram-бот...";
    reportStatus.classList.remove("error", "success");
  }

  const response = await fetch("/api/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok) {
    if (reportStatus) {
      reportStatus.textContent = data?.error === "unable_to_parse_location"
        ? "Не вдалося розпізнати локацію. Уточніть населений пункт або район."
        : "Не вдалося відправити заявку. Спробуйте ще раз.";
      reportStatus.classList.add("error");
    }
    return;
  }

  if (reportStatus) {
    reportStatus.textContent = data.reviewer_registered
      ? "Заявку відправлено модератору в Telegram-бот. Після підтвердження мітка з'явиться на карті."
      : "Заявку збережено. Щоб отримувати її в Telegram, відкрийте другого бота і надішліть йому /start.";
    reportStatus.classList.add("success");
  }

  setTimeout(() => closeReportModal(), 1200);
}

if (adminOpen) {
  adminOpen.addEventListener("click", () => {
    openAdminModal();
    loadAdminStatus();
  });
}

if (adminClose) adminClose.addEventListener("click", closeAdminModal);
if (adminModal) {
  adminModal.addEventListener("click", (event) => {
    if (event.target === adminModal) closeAdminModal();
  });
}

if (adminLoginForm) {
  adminLoginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(adminLoginForm);
    const username = formData.get("username");
    const password = formData.get("password");
    await loginAdmin({ username, password });
  });
}

if (maintenanceToggle) {
  maintenanceToggle.addEventListener("change", (event) => {
    toggleMaintenance(event.target.checked);
  });
}

if (maintenanceApply) {
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
}

if (maintenanceClear) {
  maintenanceClear.addEventListener("click", () => {
    scheduleMaintenance({ clear: true });
  });
}

if (maintenanceShow) {
  maintenanceShow.addEventListener("click", () => {
    state.adminBypassMaintenance = false;
    localStorage.removeItem("sw_admin_bypass");
    renderMarkers();
  });
}

if (testAdd) {
  testAdd.addEventListener("click", async () => {
    const groupCount = testGroupCount?.value ? Number(testGroupCount.value) : 1;
    const payload = {
      type: testType.value,
      city: testCity.value.trim(),
      group_count: Number.isFinite(groupCount) && groupCount >= 1 ? Math.round(groupCount) : 1,
      is_test: testIsTest ? testIsTest.checked : true,
      sea: testSea.checked,
      direction: testDirection.value ? Number(testDirection.value) : null,
      note: testNote.value.trim()
    };
    if (!payload.city) {
      alert("Вкажіть місто або регіон для ручної мітки.");
      return;
    }
    const response = await fetch("/api/admin/test-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      alert("Не вдалося додати ручну мітку.");
      return;
    }
    testNote.value = "";
    if (testGroupCount) testGroupCount.value = "1";
    refresh();
  });
}

if (testClear) {
  testClear.addEventListener("click", async () => {
    const response = await fetch("/api/admin/test-events/clear", { method: "POST" });
    if (!response.ok) {
      alert("Не вдалося очистити ручні мітки.");
      return;
    }
    refresh();
  });
}

if (adminLocationSelect) {
  adminLocationSelect.addEventListener("change", () => {
    syncAdminLocationForm(adminLocationSelect.value);
  });
}

if (adminLocationType) {
  adminLocationType.addEventListener("change", () => {
    const isDistrict = adminLocationType.value === "district";
    if (adminLocationParent) {
      adminLocationParent.disabled = !isDistrict;
      if (!isDistrict) adminLocationParent.value = "";
    }
  });
}

if (adminLocationSave) {
  adminLocationSave.addEventListener("click", async () => {
    const payload = {
      location_id: adminLocationSelect?.value || "",
      name: adminLocationName?.value.trim() || "",
      location_type: adminLocationType?.value || "city",
      parent_location_id: adminLocationType?.value === "district" ? (adminLocationParent?.value || "") : "",
      keys: adminLocationKeys?.value.trim() || "",
      lat: parseNumericInput(adminLocationLat?.value),
      lng: parseNumericInput(adminLocationLng?.value),
      region_id: adminLocationRegion?.value.trim() || "",
      point_lat: parseNumericInput(adminPointLat?.value),
      point_lng: parseNumericInput(adminPointLng?.value),
      point_types: adminPointTypes?.value.trim() || ""
    };
    const response = await fetch("/api/admin/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      alert("Не вдалося зберегти локацію або точку.");
      return;
    }
    const saved = await response.json();
    if (adminPointLat) adminPointLat.value = "";
    if (adminPointLng) adminPointLng.value = "";
    if (adminPointTypes) adminPointTypes.value = "";
    const preferredId = saved?.item?.id || adminLocationSelect?.value || "";
    if (saved?.item) {
      upsertAdminLocationState(saved.item);
      populateAdminLocationSelect();
      if (adminLocationSelect && preferredId) {
        adminLocationSelect.value = preferredId;
      }
      renderAdminLocations();
      syncAdminLocationForm(preferredId);
    }
    setAdminPickStatus("Локацію/точку збережено. Можна додати ще одну спавн-точку.");
    window.setTimeout(() => {
      loadAdminLocations(preferredId).catch(() => {});
    }, 1800);
  });
}

if (adminPickCityCenter) {
  adminPickCityCenter.addEventListener("click", () => {
    beginAdminMapPick("city-center");
  });
}

if (adminPickSpawnPoint) {
  adminPickSpawnPoint.addEventListener("click", () => {
    beginAdminMapPick("spawn-point");
  });
}

if (adminPointAddAnother) {
  adminPointAddAnother.addEventListener("click", () => {
    if (!adminLocationSelect?.value) {
      alert("Вибери існуючу локацію / район, щоб додати ще одну точку.");
      return;
    }
    if (adminPointLat) adminPointLat.value = "";
    if (adminPointLng) adminPointLng.value = "";
    setAdminPickStatus("Додавання нової спавн-точки для вибраної локації / району.");
    beginAdminMapPick("spawn-point");
  });
}

if (adminLogout) {
  adminLogout.addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    adminPanel.classList.add("hidden");
    adminLoginForm.classList.remove("hidden");
    adminStatus.textContent = "Гість";
    maintenanceUntil.textContent = "—";
    state.adminBypassMaintenance = false;
    state.adminLocations = [];
    localStorage.removeItem("sw_admin_bypass");
    populateAdminLocationSelect();
    renderAdminLocations();
  });
}

if (maintenanceAdminOpen) {
  maintenanceAdminOpen.addEventListener("click", () => {
    openAdminModal();
    loadAdminStatus();
  });
}

if (dockTabs) {
  dockTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      dockTabs.forEach((btn) => btn.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.dock;
      if (target === "radar") {
        radarList?.classList.remove("hidden");
        alarmList?.classList.add("hidden");
        watchlistList?.classList.add("hidden");
        document.getElementById("timeline-content")?.classList.add("hidden");
      } else if (target === "alarms") {
        radarList?.classList.add("hidden");
        alarmList?.classList.remove("hidden");
        watchlistList?.classList.add("hidden");
        document.getElementById("timeline-content")?.classList.add("hidden");
      } else if (target === "watchlist") {
        radarList?.classList.add("hidden");
        alarmList?.classList.add("hidden");
        watchlistList?.classList.remove("hidden");
        document.getElementById("timeline-content")?.classList.add("hidden");
      } else if (target === "timeline") {
        radarList?.classList.add("hidden");
        alarmList?.classList.add("hidden");
        watchlistList?.classList.add("hidden");
        const timelineContent = document.getElementById("timeline-content");
        if (timelineContent) {
          timelineContent.classList.remove("hidden");
          // Initialize timeline when opening
          if (!state.timelineActive) {
            enterTimelineMode();
          }
        }
      }
    });
  });
}

if (mapExpand) {
  mapExpand.addEventListener("click", () => {
    const next = !document.body.classList.contains("map-expanded");
    setMapExpanded(next);
  });
}

if (mapSizeButtons) {
  mapSizeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      applyMapSizePreset(button.dataset.mapSize);
    });
  });
}

if (oblastSelect) {
  populateOblastSelect();
  oblastSelect.addEventListener("change", (event) => {
    focusOblastById(event.target.value);
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getStageGapPx() {
  if (!stage) return 0;
  const styles = window.getComputedStyle(stage);
  const rawGap = styles.rowGap || styles.gap || "0";
  const parsed = Number.parseFloat(rawGap);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getMapHeightBounds() {
  if (!stage || !stageHead || !dock || !mapResizer) {
    return { min: MAP_MIN_HEIGHT, max: MAP_MIN_HEIGHT };
  }
  const stageHeight = stage.clientHeight;
  const headHeight = stageHead.offsetHeight;
  const resizerHeight = mapResizer.offsetHeight || 0;
  const gap = getStageGapPx();
  const totalGap = gap * 3;
  const dockMin = document.body.classList.contains("map-expanded") ? 0 : DOCK_MIN_HEIGHT;
  const max = stageHeight - headHeight - dockMin - resizerHeight - totalGap;
  return {
    min: MAP_MIN_HEIGHT,
    max: Math.max(MAP_MIN_HEIGHT, max)
  };
}

function applyMapHeight(nextHeight, persist = true) {
  if (!stage || !mapShell) return;
  const bounds = getMapHeightBounds();
  const clamped = clamp(nextHeight, bounds.min, bounds.max);
  stage.style.setProperty("--map-height", `${clamped}px`);
  if (persist) {
    localStorage.setItem(MAP_HEIGHT_STORAGE_KEY, String(clamped));
  }
  requestAnimationFrame(() => {
    map.invalidateSize();
  });
}

function initMapHeight() {
  if (!stage || !mapShell) return;
  const stored = Number(localStorage.getItem(MAP_HEIGHT_STORAGE_KEY));
  const bounds = getMapHeightBounds();
  const target = Number.isFinite(stored)
    ? stored
    : clamp(bounds.max * 0.72, bounds.min, bounds.max);
  applyMapHeight(target);
}

function attachMapResizer() {
  if (!mapResizer || !mapShell) return;
  let startY = 0;
  let startHeight = 0;

  const onPointerMove = (event) => {
    const next = startHeight + (event.clientY - startY);
    applyMapHeight(next);
  };

  const onPointerUp = () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };

  mapResizer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    startY = event.clientY;
    startHeight = mapShell.getBoundingClientRect().height;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  });
}

let mapHeightBeforeExpand = null;

function setMapExpanded(enabled) {
  if (!mapExpand) return;
  document.body.classList.toggle("map-expanded", enabled);
  mapExpand.textContent = enabled ? "Згорнути карту" : "Розгорнути карту";
  if (enabled) {
    const stored = Number(localStorage.getItem(MAP_HEIGHT_STORAGE_KEY));
    mapHeightBeforeExpand = Number.isFinite(stored) ? stored : null;
    const bounds = getMapHeightBounds();
    applyMapHeight(bounds.max, false);
    return;
  }
  if (Number.isFinite(mapHeightBeforeExpand)) {
    applyMapHeight(mapHeightBeforeExpand);
  }
}

function applyMapSizePreset(preset) {
  const bounds = getMapHeightBounds();
  const ratios = {
    small: 0.5,
    medium: 0.65,
    large: 0.8
  };
  const ratio = ratios[preset] ?? 0.65;
  applyMapHeight(clamp(bounds.max * ratio, bounds.min, bounds.max));
}

function populateOblastSelect() {
  if (!oblastSelect) return;
  oblastSelect.innerHTML = "<option value=\"\">—</option>";
  const ukraineOption = document.createElement("option");
  ukraineOption.value = "ukraine";
  ukraineOption.textContent = "Україна (вся)";
  oblastSelect.appendChild(ukraineOption);
  oblasts.forEach((oblast) => {
    const option = document.createElement("option");
    option.value = oblast.id;
    option.textContent = oblast.name;
    oblastSelect.appendChild(option);
  });
}

function focusOblastById(id) {
  if (!id) return;
  if (id === "ukraine") {
    map.setView([49.0, 31.0], 6, { animate: true, duration: 0.8 });
    return;
  }
  const match = oblasts.find((oblast) => oblast.id === id);
  if (!match) return;
  const bounds = L.latLngBounds(match.bbox);
  if (!bounds.isValid()) return;
  map.fitBounds(bounds.pad(0.15), { animate: true, duration: 0.8 });
}

function applyMapStyle(styleId) {
  const nextStyleId = Object.prototype.hasOwnProperty.call(mapStyleCatalog, styleId) ? styleId : "osm";
  const style = mapStyleCatalog[nextStyleId];
  if (baseTileLayer) {
    map.removeLayer(baseTileLayer);
  }
  baseTileLayer = L.tileLayer(style.url, style.options).addTo(map);
  localStorage.setItem("sw_map_style", nextStyleId);
  if (mapStyleSelect) {
    mapStyleSelect.value = nextStyleId;
  }
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

function restartRefreshTimer() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  refreshTimer = setInterval(() => {
    refresh();
  }, state.refreshIntervalMs);
}

function clearFastRetryTimer() {
  if (!fastRetryTimer) return;
  clearTimeout(fastRetryTimer);
  fastRetryTimer = null;
}

function scheduleFastRetry() {
  if (state.refreshPaused || fastRetryTimer) return;
  fastRetryTimer = setTimeout(() => {
    fastRetryTimer = null;
    refresh();
  }, FAST_RETRY_REFRESH_MS);
}

function saveSnapshotStore() {
  try {
    localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify({
      events: state.events,
      alarms: state.alarms,
      districtAlarms: state.districtAlarms,
      maintenance: state.maintenance,
      maintenanceUntil: state.maintenanceUntil,
      savedAt: Date.now()
    }));
  } catch (error) {
    console.warn("Snapshot save failed", error);
  }
}

function loadSnapshotStore() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    const events = Array.isArray(parsed?.events)
      ? parsed.events.map((item) => normalizeEvent(item, item?.source || "cache")).filter(Boolean)
      : [];
    state.events = events.filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lng));
    state.alarms = Array.isArray(parsed?.alarms) ? parsed.alarms : [];
    state.districtAlarms = Array.isArray(parsed?.districtAlarms) ? parsed.districtAlarms : [];
    state.maintenance = Boolean(parsed?.maintenance);
    state.maintenanceUntil = parsed?.maintenanceUntil || null;
    return state.events.length > 0;
  } catch (error) {
    console.warn("Snapshot load failed", error);
    return false;
  }
}

function applyRefreshInterval(value, persist = true) {
  const parsed = Number(value);
  const next = Number.isFinite(parsed) && parsed >= 250 ? parsed : DEFAULT_REFRESH_INTERVAL_MS;
  state.refreshIntervalMs = next;
  if (refreshModeSelect) {
    refreshModeSelect.value = String(next);
  }
  if (persist) {
    localStorage.setItem("sw_refresh_interval", String(next));
  }
}

function startMarkerAgingTicker() {
  if (markerAgingTimer) return;
  markerAgingTimer = setInterval(() => {
    if (state.maintenance) return;
    renderMarkers();
  }, MARKER_AGING_TICK_MS);
}

function applyTrajectoryLayerVisibility() {
  if (!trajectoryLayer) return;
  if (state.showTrajectories) {
    if (!map.hasLayer(trajectoryLayer)) {
      trajectoryLayer.addTo(map);
    }
  } else if (map.hasLayer(trajectoryLayer)) {
    map.removeLayer(trajectoryLayer);
  }
}

function startTimelineSyncTicker() {
  if (timelineSyncTimer) return;
  timelineSyncTimer = setInterval(() => {
    if (!state.timelineActive) return;
    refresh(true).finally(() => {
      if (!state.timelineActive) return;
      rebuildTimelineData(true);
    });
  }, TIMELINE_SYNC_TICK_MS);
}

function stopTimelineSyncTicker() {
  if (!timelineSyncTimer) return;
  clearInterval(timelineSyncTimer);
  timelineSyncTimer = null;
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

if (geoToggle) {
  geoToggle.addEventListener("click", () => {
    if (getUserLatLng()) {
      stopGeolocation();
    } else {
      startGeolocation();
    }
  });
}

if (radarOpen && radarModal && radarClose) {
  radarOpen.addEventListener("click", () => {
    radarModal.classList.add("active");
    ensureRadarMap();
    refreshRadarLayout();
  });
  radarClose.addEventListener("click", () => {
    radarModal.classList.remove("active");
  });
  radarModal.addEventListener("click", (event) => {
    if (event.target === radarModal) radarModal.classList.remove("active");
  });
}

if (reportOpen && reportModal && reportClose) {
  reportOpen.addEventListener("click", () => {
    openReportModal();
  });
  reportClose.addEventListener("click", () => {
    closeReportModal();
  });
  reportModal.addEventListener("click", (event) => {
    if (event.target === reportModal) closeReportModal();
  });
}

if (reportCancel) {
  reportCancel.addEventListener("click", () => {
    closeReportModal();
  });
}

if (reportForm) {
  reportForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitUserReport();
  });
}

if (timelineExit) {
  timelineExit.addEventListener("click", () => {
    exitTimelineMode();
  });
}

if (timelineRebuild) {
  timelineRebuild.addEventListener("click", () => {
    rebuildTimelineData();
  });
}

if (timelineSlider) {
  timelineSlider.addEventListener("input", (event) => {
    const sliderValue = Number(event.target.value);
    updateTimelinePosition(sliderValue);
  });
}

if (dangerRadiusSelect) {
  dangerRadiusSelect.addEventListener("change", (event) => {
    state.dangerRadiusKm = Number(event.target.value) || 25;
    renderLocalAlert();
    renderRadarCanvas();
  });
}

if (themeOptions) {
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
}

if (themeApply) {
  themeApply.addEventListener("click", () => {
    applyTheme("custom");
    applyCustomTheme();
  });
}

if (mapStyleSelect) {
  mapStyleSelect.addEventListener("change", (event) => {
    applyMapStyle(event.target.value);
  });
}

if (refreshModeSelect) {
  refreshModeSelect.addEventListener("change", (event) => {
    applyRefreshInterval(event.target.value);
  });
}

if (manualRefresh) {
  manualRefresh.addEventListener("click", () => {
    refresh(true);
  });
}

function openSidebar(side) {
  if (side === "left" && leftSidebar) leftSidebar.classList.add("open");
  if (side === "right" && rightSidebar) rightSidebar.classList.add("open");
  panelBackdrop?.classList.add("active");
}

function closeSidebars() {
  leftSidebar?.classList.remove("open");
  rightSidebar?.classList.remove("open");
  panelBackdrop?.classList.remove("active");
}

if (panelToggle && panelBackdrop) {
  panelToggle.addEventListener("click", () => {
    if (leftSidebar?.classList.contains("open")) {
      closeSidebars();
    } else {
      openSidebar("left");
    }
  });
}

if (intelToggle && panelBackdrop) {
  intelToggle.addEventListener("click", () => {
    if (rightSidebar?.classList.contains("open")) {
      closeSidebars();
    } else {
      openSidebar("right");
    }
  });
}

panelBackdrop?.addEventListener("click", closeSidebars);

if (toggleRefresh) {
  toggleRefresh.addEventListener("change", (event) => {
    state.refreshPaused = event.target.checked;
    localStorage.setItem("sw_refresh_paused", state.refreshPaused ? "1" : "0");
  });
}

if (toggleHistory) {
  toggleHistory.addEventListener("change", (event) => {
    state.showHistory = event.target.checked;
    localStorage.setItem("sw_show_history", state.showHistory ? "1" : "0");
    renderMarkers();
  });
}

if (toggleTrajectories) {
  toggleTrajectories.addEventListener("change", (event) => {
    state.showTrajectories = event.target.checked;
    localStorage.setItem(TRAJECTORY_VISIBILITY_KEY, state.showTrajectories ? "1" : "0");
    applyTrajectoryLayerVisibility();
    renderMarkers();
  });
}

if (toggleSound) {
  toggleSound.addEventListener("change", (event) => {
    state.soundEnabled = event.target.checked;
    localStorage.setItem("sw_sound_enabled", state.soundEnabled ? "1" : "0");
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

function fitToVisibleTargets() {
  if (state.maintenance) return;
  const visible = getVisibleEvents();
  const points = visible.map((event) => [event.lat, event.lng]);
  (state.districtAlarms || []).forEach((district) => {
    const lat = Number(district.lat);
    const lng = Number(district.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      points.push([lat, lng]);
    }
  });
  if (points.length === 0) return;
  const bounds = L.latLngBounds(points);
  if (!bounds.isValid()) return;
  map.fitBounds(bounds.pad(0.25), {
    animate: true,
    duration: 0.9,
    maxZoom: 9
  });
}

map.on("click", (event) => {
  if (!state.adminMapPickMode) return;
  const lat = Number(event.latlng.lat.toFixed(4));
  const lng = Number(event.latlng.lng.toFixed(4));

  if (state.adminMapPickMode === "city-center") {
    if (adminLocationLat) adminLocationLat.value = String(lat);
    if (adminLocationLng) adminLocationLng.value = String(lng);
    setAdminPickStatus(`Центр міста вибрано: ${lat}, ${lng}`);
  } else if (state.adminMapPickMode === "spawn-point") {
    if (adminPointLat) adminPointLat.value = String(lat);
    if (adminPointLng) adminPointLng.value = String(lng);
    setAdminPickStatus(`Спавн-точку вибрано: ${lat}, ${lng}`);
  }

  state.adminMapPickMode = null;
  openAdminModal();
});

if (fitVisible) {
  fitVisible.addEventListener("click", fitToVisibleTargets);
}

document.addEventListener("keydown", (event) => {
  const tag = event.target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (event.key.toLowerCase() === "f") {
    fitToVisibleTargets();
  }
});

if (siteVersion) {
  siteVersion.textContent = APP_VERSION;
}

if (ttlSelect) {
  ttlSelect.addEventListener("change", (event) => {
    const next = Number(event.target.value);
    state.markerTtlMs = Number.isFinite(next) ? next : DEFAULT_MARKER_TTL_MS;
    localStorage.setItem(MARKER_TTL_KEY, String(state.markerTtlMs));
    renderMarkers();
    renderRadarList();
    renderIntelFeed();
    renderPinnedList();
    renderDockWatchlist();
  });
}

if (saveViewButton) {
  saveViewButton.addEventListener("click", saveCurrentView);
}

if (opsNotes) {
  opsNotes.addEventListener("input", (event) => {
    localStorage.setItem(OPS_NOTES_KEY, event.target.value);
  });
}

if (exportBrief) {
  exportBrief.addEventListener("click", exportBriefNow);
}


if (document) {
  document.addEventListener("click", (event) => {
    const pinBtn = event.target.closest("[data-pin]");
    if (pinBtn) {
      togglePin(pinBtn.dataset.pin);
      return;
    }
    const focusBtn = event.target.closest("[data-focus]");
    if (focusBtn) {
      focusEvent(focusBtn.dataset.focus);
      return;
    }
    const applyBtn = event.target.closest("[data-view-apply]");
    if (applyBtn) {
      const view = state.savedViews.find((item) => item.id === applyBtn.dataset.viewApply);
      if (view) applySavedView(view);
      return;
    }
    const removeBtn = event.target.closest("[data-view-remove]");
    if (removeBtn) {
      deleteSavedView(removeBtn.dataset.viewRemove);
    }
  });
}

const savedMapStyle = localStorage.getItem("sw_map_style") || "osm";
applyMapStyle(savedMapStyle);

map.on("zoomend", updateMarkerScale);
updateMarkerScale();
initMapHeight();
attachMapResizer();
window.addEventListener("resize", () => {
  if (document.body.classList.contains("map-expanded")) {
    const bounds = getMapHeightBounds();
    applyMapHeight(bounds.max, false);
    return;
  }
  const stored = Number(localStorage.getItem(MAP_HEIGHT_STORAGE_KEY));
  if (Number.isFinite(stored)) {
    applyMapHeight(stored);
  } else {
    initMapHeight();
  }
  renderRadarCanvas();
});
state.adminBypassMaintenance = localStorage.getItem("sw_admin_bypass") === "1";
loadHistoryStore();
// Clear stale snapshot cache to force fresh API fetch
localStorage.removeItem(SNAPSHOT_STORAGE_KEY);
const hasSnapshot = false;

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

const savedShowHistory = localStorage.getItem("sw_show_history");
if (savedShowHistory !== null) {
  state.showHistory = savedShowHistory === "1";
}
if (toggleHistory) {
  toggleHistory.checked = state.showHistory;
}

const savedRefreshInterval = localStorage.getItem("sw_refresh_interval") || String(DEFAULT_REFRESH_INTERVAL_MS);
applyRefreshInterval(savedRefreshInterval, false);
restartRefreshTimer();
state.showTrajectories = localStorage.getItem(TRAJECTORY_VISIBILITY_KEY) !== "0";
if (toggleTrajectories) {
  toggleTrajectories.checked = state.showTrajectories;
}
applyTrajectoryLayerVisibility();

state.dangerRadiusKm = Number(dangerRadiusSelect?.value || 25) || 25;
if (dangerRadiusSelect) dangerRadiusSelect.value = String(state.dangerRadiusKm);
updateGeoStatus();
renderLocalAlert();
renderRadarCanvas();

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

const savedSound = localStorage.getItem("sw_sound_enabled") === "1";
state.soundEnabled = savedSound;
if (toggleSound) toggleSound.checked = savedSound;

const savedTtl = Number(localStorage.getItem(MARKER_TTL_KEY));
if (Number.isFinite(savedTtl) && savedTtl > 0) {
  state.markerTtlMs = savedTtl;
}
if (ttlSelect) ttlSelect.value = String(state.markerTtlMs);

try {
  const rawPinned = JSON.parse(localStorage.getItem(PINNED_STORAGE_KEY) || "[]");
  if (Array.isArray(rawPinned)) {
    rawPinned.forEach((id) => state.pinnedIds.add(id));
  }
} catch {
  state.pinnedIds = new Set();
}

try {
  const rawViews = JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) || "[]");
  if (Array.isArray(rawViews)) {
    state.savedViews = rawViews;
  }
} catch {
  state.savedViews = [];
}
renderSavedViews();

if (opsNotes) {
  opsNotes.value = localStorage.getItem(OPS_NOTES_KEY) || "";
}
resetReportForm();

if (hasSnapshot) {
  updateFilterSets(state.events);
  renderFilterControls();
  renderMarkers();
  renderRadarList();
  renderAlarmList();
  renderIntelFeed();
  renderLocalAlert();
  renderPinnedList();
  renderDockWatchlist();
  renderMetrics();
  renderRadarCanvas();
  renderAlarmMapSoon();
}

if (mapNotice) {
  mapNotice.textContent = "Завантаження даних карти…";
  mapNotice.hidden = false;
}

setTimeout(() => {
  refresh(true);
}, 0);
startMarkerAgingTicker();
