import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runtime } from "./config/runtime.js";
import { loadTelegramEvents } from "./telegram.js";
import { loadRssEvents } from "./rss.js";
import { loadOpenEvents } from "./open.js";
import { generateRecentMapReport } from "./map-report.js";
import { parseMessageToEvents } from "./transform.js";
import {
  verifyAdmin,
  createSession,
  getSession,
  clearSession,
  getSetting,
  setSetting,
  listTestEvents,
  addTestEvent,
  clearTestEvents,
  listAdminLocations,
  upsertAdminLocationWithPoint,
  createUserAccount,
  verifyUser,
  createUserSession,
  getUserSession,
  clearUserSession,
  listUserApiKeys,
  createApiKeyForUser,
  revokeApiKeyForUser,
  authenticateApiKey
} from "./db/index.js";

const app = express();
const {
  appVersion,
  apiDefaultVersion,
  port,
  sessionDays,
  refreshMs,
  apiResponseTimeoutMs,
  eventTtlMin,
  eventStaleKeepMin,
  dedupRadiusKm,
  dedupWindowMin,
  sourceWeightDefault,
  forcedAlarmIds,
  featureFlags
} = runtime;

function parseSourceWeights(raw) {
  if (!raw) return new Map();
  const map = new Map();
  raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const [source, weight] = entry.split(":");
      if (!source || !weight) return;
      const numeric = Number(weight);
      if (!Number.isFinite(numeric) || numeric <= 0) return;
      map.set(source.trim().toLowerCase(), numeric);
    });
  return map;
}

const sourceWeights = parseSourceWeights(process.env.TG_SOURCE_WEIGHTS || "");
const EVENTS_CACHE_KEY = "events_cache_v1";
const EVENTS_CACHE_UPDATED_AT_KEY = "events_cache_updated_at_v1";
const ANNOUNCED_EVENT_IDS_KEY = "announced_event_ids_v1";
const USER_SESSION_DAYS = Number(process.env.USER_SESSION_DAYS || 30);
const backgroundRefreshMs = Math.max(5000, Number(process.env.BACKGROUND_REFRESH_MS || 15000));
const announceBotToken = String(process.env.TG_ANNOUNCE_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();
const announceChatId = String(process.env.TG_ANNOUNCE_CHAT_ID || "@airwatcher").trim();
const announceEnabled = /^(1|true|yes|on)$/i.test(String(process.env.TG_ANNOUNCE_ENABLED || "true"));
const announceMaxAgeMs = Math.max(60 * 1000, Number(process.env.TG_ANNOUNCE_MAX_AGE_MS || 10 * 60 * 1000));
const announceRecentLimit = Math.max(100, Number(process.env.TG_ANNOUNCE_RECENT_LIMIT || 1000));
const announcePointRadiusKm = Math.max(1, Number(process.env.TG_ANNOUNCE_POINT_RADIUS_KM || 18));
const announceLocationRadiusKm = Math.max(1, Number(process.env.TG_ANNOUNCE_LOCATION_RADIUS_KM || 35));
const announcePhotoEnabled = /^(1|true|yes|on)$/i.test(String(process.env.TG_ANNOUNCE_PHOTO_ENABLED || "true"));

if (announceEnabled && (!announceBotToken || !announceChatId)) {
  console.warn("Telegram announce is enabled, but TG_ANNOUNCE_BOT_TOKEN or TG_ANNOUNCE_CHAT_ID is missing.");
}

const state = {
  lastFetch: 0,
  cache: [],
  inFlight: null,
  backgroundWarmRunning: false
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicPath = path.resolve(__dirname, "..", "public");
const distPath = path.resolve(__dirname, "..", "dist");
const rootIndexPath = path.resolve(__dirname, "..", "index.html");
const srcPath = path.resolve(__dirname, "..", "src");
const distIndexPath = path.join(distPath, "index.html");
const hasDistBuild = fs.existsSync(distIndexPath);
console.log(`Frontend mode: ${hasDistBuild ? "dist" : "source"}.`);

app.use(express.json({ limit: "200kb" }));
app.use(express.static(publicPath));
if (hasDistBuild) {
  app.use(express.static(distPath));
} else {
  app.use("/src", express.static(srcPath));
}

function readCookie(req, cookieName) {
  const cookie = req.headers.cookie || "";
  const pattern = new RegExp(`${cookieName}=([^;]+)`);
  const match = cookie.match(pattern);
  return match ? match[1] : null;
}

function readSessionToken(req) {
  return readCookie(req, "sw_admin");
}

function readUserSessionToken(req) {
  return readCookie(req, "sw_user");
}

function readApiKey(req) {
  const auth = req.headers.authorization || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return String(req.query.api_key || req.headers["x-api-key"] || "").trim();
}

function applyForcedAlarms(alarms) {
  const merged = new Set(Array.isArray(alarms) ? alarms : []);
  forcedAlarmIds.forEach((id) => merged.add(id));
  return Array.from(merged);
}

function normalizeHeading(event) {
  const raw = Number(event.direction ?? event.heading);
  return Number.isFinite(raw) ? ((raw % 360) + 360) % 360 : null;
}

function toIso(value) {
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString();
}

function getSourceWeight(source) {
  const key = String(source || "").toLowerCase();
  return sourceWeights.get(key) || sourceWeightDefault;
}

function haversineKm(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function normalizeAnnouncedIds(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(-announceRecentLimit);
}

async function readAnnouncedEventIds() {
  try {
    const raw = await getSetting(ANNOUNCED_EVENT_IDS_KEY, "[]");
    return normalizeAnnouncedIds(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function writeAnnouncedEventIds(ids) {
  await setSetting(ANNOUNCED_EVENT_IDS_KEY, JSON.stringify(normalizeAnnouncedIds(ids)));
}

function announcementTypeLabel(event) {
  const type = String(event?.type || "").toLowerCase();
  if (type === "missile") return "Ракета";
  if (type === "shahed") return "БпЛА";
  if (type === "kab") return "КАБ";
  if (type === "airplane") return "Літак";
  if (type === "recon") return "Розвідка";
  return null;
}

function formatAnnouncementLocation(location, byId) {
  if (!location) return null;
  if (location.location_type === "district") {
    const parent = location.parent_location_id ? byId.get(location.parent_location_id) : null;
    return parent ? `${location.name} м. ${parent.name}` : location.name;
  }
  return location.name || null;
}

function normalizeAnnouncementLookup(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[.,;:!?()[\]{}"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAnnouncementCommentLabel(event) {
  const comment = String(event?.comment || "");
  const match = comment.match(/Локація:\s*([^.;]+?)(?:[.;]|$)/u);
  return match?.[1]?.trim() || null;
}

function extractEventMarkerLabel(event) {
  return String(event?.marker_label || "").trim() || extractAnnouncementCommentLabel(event) || String(event?.target_label || "").trim() || null;
}

function buildAnnouncementText(event, resolvedLocationLabel) {
  const typeLabel = announcementTypeLabel(event);
  if (!typeLabel || !resolvedLocationLabel) return null;

  const markerLabel = extractEventMarkerLabel(event);
  const targetLabel = String(event?.target_label || "").trim() || null;

  if (markerLabel && targetLabel && markerLabel !== targetLabel) {
    return `${typeLabel} з ${markerLabel} в напрямку ${targetLabel}`;
  }
  if (targetLabel) {
    return `${typeLabel} на ${targetLabel}`;
  }
  return `${typeLabel} на ${resolvedLocationLabel}`;
}

function matchAnnouncementLocationByLabel(label, locations, byId) {
  const normalizedLabel = normalizeAnnouncementLookup(label);
  if (!normalizedLabel) return null;

  const normalizedWithoutCityPrefix = normalizedLabel.replace(/^м\s+/, "").trim();

  for (const location of locations) {
    const variants = new Set([
      normalizeAnnouncementLookup(location.name),
      ...((Array.isArray(location.keys) ? location.keys : []).map((item) => normalizeAnnouncementLookup(item)))
    ]);
    if (variants.has(normalizedLabel) || variants.has(normalizedWithoutCityPrefix)) {
      return formatAnnouncementLocation(location, byId);
    }
  }

  return label;
}

async function resolveAnnouncementLocation(event) {
  const lat = Number(event?.lat);
  const lng = Number(event?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const locations = await listAdminLocations();
  if (!Array.isArray(locations) || locations.length === 0) return null;
  const byId = new Map(locations.map((item) => [item.id, item]));
  const type = String(event?.type || "").toLowerCase();
  const explicitLabel = extractEventMarkerLabel(event);

  if (explicitLabel) {
    return matchAnnouncementLocationByLabel(explicitLabel, locations, byId);
  }

  let nearestPoint = null;
  for (const location of locations) {
    const points = Array.isArray(location.points) ? location.points : [];
    for (const point of points) {
      const pointTypes = Array.isArray(point.types) ? point.types.map((item) => String(item).toLowerCase()) : [];
      if (pointTypes.length > 0 && !pointTypes.includes(type)) continue;
      const distanceKm = haversineKm({ lat, lng }, { lat: Number(point.lat), lng: Number(point.lng) });
      if (!Number.isFinite(distanceKm)) continue;
      if (!nearestPoint || distanceKm < nearestPoint.distanceKm) {
        nearestPoint = { location, distanceKm };
      }
    }
  }

  if (nearestPoint && nearestPoint.distanceKm <= announcePointRadiusKm) {
    return formatAnnouncementLocation(nearestPoint.location, byId);
  }
  return null;
}

async function sendTelegramAnnouncement(text) {
  if (!announceEnabled || !announceBotToken || !announceChatId || !text) return false;
  const response = await fetch(`https://api.telegram.org/bot${announceBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: announceChatId,
      text,
      disable_web_page_preview: true
    })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`telegram_send_failed:${response.status}:${body}`);
  }
  return true;
}

async function sendTelegramPhoto(photoPath, caption = "") {
  if (!announceEnabled || !announceBotToken || !announceChatId || !photoPath || !announcePhotoEnabled) return false;
  const fileBuffer = await fs.promises.readFile(photoPath);
  const form = new FormData();
  form.set("chat_id", announceChatId);
  form.set("caption", caption);
  form.set("photo", new Blob([fileBuffer], { type: "image/png" }), path.basename(photoPath));
  const response = await fetch(`https://api.telegram.org/bot${announceBotToken}/sendPhoto`, {
    method: "POST",
    body: form
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`telegram_send_photo_failed:${response.status}:${body}`);
  }
  return true;
}

function shouldAnnounceEvent(event, previousIds = new Set(), announcedSet = new Set(), now = Date.now()) {
  const id = String(event?.id || "").trim();
  if (!id || previousIds.has(id) || announcedSet.has(id)) return false;
  if (event?.is_test) return false;
  const ts = Date.parse(event?.timestamp);
  return Number.isFinite(ts) && now - ts <= announceMaxAgeMs;
}

async function announceSingleEvent(event, options = {}) {
  if (!announceEnabled) return false;
  const previousIds = options.previousIds instanceof Set ? options.previousIds : new Set();
  const announcedIds = Array.isArray(options.announcedIds) ? options.announcedIds : await readAnnouncedEventIds();
  const announcedSet = new Set(announcedIds);
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  if (!shouldAnnounceEvent(event, previousIds, announcedSet, now)) return false;

  const typeLabel = announcementTypeLabel(event);
  if (!typeLabel) return false;
  const locationLabel = await resolveAnnouncementLocation(event);
  if (!locationLabel) return false;

  const announcementText = buildAnnouncementText(event, locationLabel);
  if (!announcementText) return false;
  await sendTelegramAnnouncement(announcementText);
  await writeAnnouncedEventIds([...announcedIds, String(event.id)]);
  return true;
}

async function announceNewEvents(events, previousEvents = []) {
  if (!announceEnabled) return;

  const previousIds = new Set((Array.isArray(previousEvents) ? previousEvents : []).map((item) => String(item?.id || "")));
  const announcedIds = await readAnnouncedEventIds();
  const announcedSet = new Set(announcedIds);
  const now = Date.now();
  const candidates = (Array.isArray(events) ? events : []).filter((event) =>
    shouldAnnounceEvent(event, previousIds, announcedSet, now)
  );

  if (candidates.length === 0) return;

  const announcedNow = [];
  for (const event of candidates) {
    const typeLabel = announcementTypeLabel(event);
    if (!typeLabel) continue;
    const locationLabel = await resolveAnnouncementLocation(event);
    if (!locationLabel) continue;
    try {
      const announcementText = buildAnnouncementText(event, locationLabel);
      if (!announcementText) continue;
      await sendTelegramAnnouncement(announcementText);
      announcedNow.push(String(event.id));
    } catch (error) {
      console.warn("Failed to announce event", event?.id, error?.message || error);
    }
  }

  if (announcedNow.length > 0) {
    await writeAnnouncedEventIds([...announcedIds, ...announcedNow]);
    try {
      const report = await generateRecentMapReport(events);
      if (report?.path) {
        await sendTelegramPhoto(report.path, report.caption || "");
        await fs.promises.unlink(report.path).catch(() => {});
      }
    } catch (error) {
      console.warn("Failed to send map report", error?.message || error);
    }
  }
}

function withConfidence(event) {
  const base = Number(event.confidence);
  const baseConfidence = Number.isFinite(base) ? base : 0.45;
  const weighted = Math.min(0.99, Number((baseConfidence * getSourceWeight(event.source)).toFixed(2)));
  return {
    ...event,
    timestamp: toIso(event.timestamp),
    direction: normalizeHeading(event),
    confidence: weighted
  };
}

async function hydrateEventCacheFromStore() {
  if (state.cache.length > 0) return;
  try {
    const rawCache = await getSetting(EVENTS_CACHE_KEY, "[]");
    const rawUpdatedAt = await getSetting(EVENTS_CACHE_UPDATED_AT_KEY, "0");
    const parsed = JSON.parse(rawCache);
    if (!Array.isArray(parsed) || parsed.length === 0) return;
    state.cache = parsed.filter((event) =>
      Number.isFinite(Number(event?.lat)) &&
      Number.isFinite(Number(event?.lng)) &&
      Number.isFinite(Date.parse(event?.timestamp))
    );
    const updatedAt = Number(rawUpdatedAt);
    state.lastFetch = Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now();
  } catch (error) {
    console.warn("Failed to hydrate event cache", error?.message || error);
  }
}

async function persistEventCacheToStore(events, updatedAt = Date.now()) {
  try {
    await setSetting(EVENTS_CACHE_KEY, JSON.stringify(Array.isArray(events) ? events : []));
    await setSetting(EVENTS_CACHE_UPDATED_AT_KEY, String(updatedAt));
  } catch (error) {
    console.warn("Failed to persist event cache", error?.message || error);
  }
}

function isServerEventAlive(event, now = Date.now()) {
  const ts = Date.parse(event?.timestamp);
  if (!Number.isFinite(ts)) return false;
  const ttlMs = Math.max(1, eventTtlMin) * 60 * 1000;
  return now - ts <= ttlMs;
}

async function pruneServerEventCache(now = Date.now()) {
  const current = Array.isArray(state.cache) ? state.cache : [];
  const next = current.filter((event) => isServerEventAlive(event, now));
  if (next.length !== current.length) {
    state.cache = next;
    await persistEventCacheToStore(next, state.lastFetch || now);
  }
  return state.cache;
}

function deduplicateEvents(events) {
  const clusters = [];
  const windowMs = Math.max(1, dedupWindowMin) * 60 * 1000;
  const sorted = [...events].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  for (const event of sorted) {
    const ts = Date.parse(event.timestamp);
    if (!Number.isFinite(ts)) continue;
    let matched = null;
    for (const cluster of clusters) {
      if (cluster.type !== event.type) continue;
      if (cluster.is_test !== Boolean(event.is_test)) continue;
      if (cluster.items.some((item) => String(item.source || "") === String(event.source || ""))) continue;
      if (Math.abs(cluster.centerTs - ts) > windowMs) continue;
      const distance = haversineKm(
        { lat: cluster.centerLat, lng: cluster.centerLng },
        { lat: Number(event.lat), lng: Number(event.lng) }
      );
      if (distance > dedupRadiusKm) continue;
      matched = cluster;
      break;
    }

    if (!matched) {
      clusters.push({
        type: event.type,
        is_test: Boolean(event.is_test),
        centerLat: Number(event.lat),
        centerLng: Number(event.lng),
        centerTs: ts,
        items: [event]
      });
      continue;
    }

    matched.items.push(event);
    const totalWeight = matched.items.reduce((sum, item) => sum + Number(item.confidence || 0.1), 0);
    matched.centerLat = matched.items.reduce((sum, item) => sum + Number(item.lat) * Number(item.confidence || 0.1), 0) / totalWeight;
    matched.centerLng = matched.items.reduce((sum, item) => sum + Number(item.lng) * Number(item.confidence || 0.1), 0) / totalWeight;
    matched.centerTs = Math.max(matched.centerTs, ts);
  }

  return clusters.map((cluster) => {
    const best = [...cluster.items].sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))[0];
    const ids = cluster.items.map((item) => String(item.id || "")).sort();
    const uniqueSources = Array.from(new Set(cluster.items.map((item) => String(item.source || "")).filter(Boolean)));
    const avgConfidence =
      cluster.items.reduce((sum, item) => sum + Number(item.confidence || 0), 0) / Math.max(1, cluster.items.length);
    return {
      ...best,
      id: ids[0] || best.id,
      lat: Number(cluster.centerLat.toFixed(4)),
      lng: Number(cluster.centerLng.toFixed(4)),
      timestamp: new Date(cluster.centerTs).toISOString(),
      confidence: Number(Math.min(0.99, avgConfidence).toFixed(2)),
      evidence_count: cluster.items.length,
      evidence_sources: uniqueSources
    };
  });
}

async function requireAdmin(req, res, next) {
  const token = readSessionToken(req);
  const session = await getSession(token);
  if (!session) {
    return res.status(401).json({ error: "unauthorized" });
  }
  req.admin = session.username;
  return next();
}

async function requireUser(req, res, next) {
  const token = readUserSessionToken(req);
  const session = await getUserSession(token);
  if (!session) {
    return res.status(401).json({ error: "unauthorized" });
  }
  req.user = {
    id: session.user_id,
    email: session.email
  };
  return next();
}

async function requireApiKey(req, res, next) {
  const apiKey = readApiKey(req);
  if (!apiKey) {
    return res.status(401).json({ error: "api_key_required" });
  }
  const key = await authenticateApiKey(apiKey);
  if (!key) {
    return res.status(401).json({ error: "invalid_api_key" });
  }
  req.apiKey = key;
  return next();
}

async function getMaintenanceState() {
  const enabled = (await getSetting("maintenance", "false")) === "true";
  const untilRaw = await getSetting("maintenance_until", "");
  const until = untilRaw ? Number(untilRaw) : null;
  const now = Date.now();

  if (until && now >= until) {
    await setSetting("maintenance_until", "");
    if (!enabled) {
      return { enabled: false, until: null };
    }
  }

  if (enabled) {
    return { enabled: true, until: until && now < until ? until : null };
  }

  if (until && now < until) {
    return { enabled: true, until };
  }

  return { enabled: false, until: null };
}

const apiMetaPayload = {
  app_version: appVersion,
  api: {
    default_version: apiDefaultVersion,
    supported_versions: ["v1"],
    next_version: featureFlags.enableV2Api ? "v2_preview" : "v2_planned"
  },
  refresh_ms: refreshMs,
  feature_flags: featureFlags
};

function sendMeta(_req, res) {
  res.json(apiMetaPayload);
}

function sendHealth(_req, res) {
  res.json({
    ok: true,
    service: "skywatch-ua",
    uptime_sec: Math.round(process.uptime())
  });
}

async function sendStatus(_req, res) {
  const state = await getMaintenanceState();
  res.json({
    maintenance: state.enabled,
    maintenance_until: state.until,
    event_ttl_min: eventTtlMin
  });
}

async function readStoredAlarmState() {
  const stored = await getSetting("alarms_state", "[]");
  const storedDistricts = await getSetting("district_alarms_state", "[]");
  let alarmState = applyForcedAlarms([]);
  let districtAlarmState = [];
  try {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      alarmState = applyForcedAlarms(parsed);
    }
  } catch {
    alarmState = applyForcedAlarms([]);
  }
  try {
    const parsedDistricts = JSON.parse(storedDistricts);
    if (Array.isArray(parsedDistricts)) {
      districtAlarmState = parsedDistricts;
    }
  } catch {
    districtAlarmState = [];
  }
  return { alarmState, districtAlarmState };
}

async function refreshEventCacheFromSources() {
  const previousCache = [...state.cache];
  const tgPromise = loadTelegramEvents();
  const rssPromise = loadRssEvents();
  const openPromise = loadOpenEvents();
  const storedTestsPromise = listTestEvents();
  const tgPayload = await tgPromise;
  let alarmState = tgPayload.alarms || [];
  let districtAlarmState = Array.isArray(tgPayload.district_alarms) ? tgPayload.district_alarms : [];
  alarmState = applyForcedAlarms(alarmState);
  if (tgPayload.alarms_updated) {
    await setSetting("alarms_state", JSON.stringify(alarmState));
    await setSetting("district_alarms_state", JSON.stringify(districtAlarmState));
    await setSetting("alarms_updated_at", String(Date.now()));
  } else {
    const storedStates = await readStoredAlarmState();
    if (storedStates.alarmState.length > 0) {
      alarmState = storedStates.alarmState;
    }
    if (storedStates.districtAlarmState.length > 0) {
      districtAlarmState = storedStates.districtAlarmState;
    }
  }

  const [rssEvents, openEvents, storedTests] = await Promise.all([
    rssPromise,
    openPromise,
    storedTestsPromise
  ]);
  const testEvents = storedTests
    .flatMap((item) =>
      parseMessageToEvents(item.message, {
        source: item.source || "admin",
        timestamp: item.createdAt,
        type: item.type,
        direction: item.direction,
        is_test: typeof item.is_test === "boolean" ? item.is_test : true,
        group_count: item.group_count
      })
    )
    .filter(Boolean);

  const nowTs = Date.now();
  const ttlMs = Math.max(1, eventTtlMin) * 60 * 1000;
  const staleKeepMs = Math.max(1, eventStaleKeepMin) * 60 * 1000;
  const combinedRaw = [...tgPayload.events, ...rssEvents, ...openEvents, ...testEvents]
    .map(withConfidence)
    .filter((event) => {
      if (!Number.isFinite(Number(event.lat)) || !Number.isFinite(Number(event.lng))) return false;
      const time = Date.parse(event.timestamp);
      if (!Number.isFinite(time)) return false;
      return nowTs - time <= ttlMs;
    });
  const combined = deduplicateEvents(combinedRaw);

  if (combined.length === 0 && state.cache.length && nowTs - state.lastFetch <= staleKeepMs) {
    return {
      events: state.cache,
      alarms: alarmState,
      district_alarms: districtAlarmState,
      cached: true,
      stale: true,
      maintenance: false,
      maintenance_until: null
    };
  }

  state.cache = combined;
  state.lastFetch = nowTs;
  await persistEventCacheToStore(combined, nowTs);
  await announceNewEvents(combined, previousCache);

  return {
    events: combined,
    alarms: alarmState,
    district_alarms: districtAlarmState,
    cached: false,
    maintenance: false,
    maintenance_until: null
  };
}

async function buildFastFallbackPayload(maintenance = { enabled: false, until: null }) {
  const { alarmState, districtAlarmState } = await readStoredAlarmState();
  const liveCache = await pruneServerEventCache();
  return {
    events: maintenance.enabled ? [] : liveCache,
    alarms: alarmState,
    district_alarms: districtAlarmState,
    cached: true,
    stale: true,
    maintenance: maintenance.enabled,
    maintenance_until: maintenance.enabled ? maintenance.until : null
  };
}

async function buildEventsPayload() {

  try {
    await hydrateEventCacheFromStore();
    const maintenance = await getMaintenanceState();
    const now = Date.now();
    const liveCache = await pruneServerEventCache(now);

    // Serve from backend cache without touching Telegram API.
    if (now - state.lastFetch < refreshMs && liveCache.length) {
      const { alarmState, districtAlarmState } = await readStoredAlarmState();
      return {
        events: maintenance.enabled ? [] : liveCache,
        alarms: alarmState,
        district_alarms: districtAlarmState,
        cached: true,
        maintenance: maintenance.enabled,
        maintenance_until: maintenance.enabled ? maintenance.until : null
      };
    }

    if (maintenance.enabled) {
      const { alarmState, districtAlarmState } = await readStoredAlarmState();
      return {
        events: [],
        alarms: alarmState,
        district_alarms: districtAlarmState,
        maintenance: true,
        maintenance_until: maintenance.until,
        cached: true
      };
    }

    if (liveCache.length) {
      if (!state.inFlight) {
        state.inFlight = refreshEventCacheFromSources().finally(() => {
          state.inFlight = null;
        });
      }
      const { alarmState, districtAlarmState } = await readStoredAlarmState();
      return {
        events: liveCache,
        alarms: alarmState,
        district_alarms: districtAlarmState,
        cached: true,
        stale: now - state.lastFetch >= refreshMs,
        maintenance: false,
        maintenance_until: null
      };
    }

    if (!state.inFlight) {
      state.inFlight = refreshEventCacheFromSources().finally(() => {
        state.inFlight = null;
      });
    }

    const fallback = await buildFastFallbackPayload(maintenance);
    return {
      ...fallback,
      warming: true
    };
  } catch (error) {
    console.error("Failed to load events", error);
    throw error;
  }
}

async function sendEvents(_req, res) {
  try {
    const payload = await buildEventsPayload();
    return res.json(payload);
  } catch {
    return res.status(500).json({ error: "failed_to_load" });
  }
}

async function sendEmbedEvents(_req, res) {
  try {
    const payload = await buildEventsPayload();
    return res.json({
      events: Array.isArray(payload.events) ? payload.events : [],
      alarms: Array.isArray(payload.alarms) ? payload.alarms : [],
      district_alarms: Array.isArray(payload.district_alarms) ? payload.district_alarms : [],
      maintenance: Boolean(payload.maintenance),
      maintenance_until: payload.maintenance_until || null,
      cached: Boolean(payload.cached),
      stale: Boolean(payload.stale),
      warming: Boolean(payload.warming)
    });
  } catch {
    return res.status(500).json({ error: "failed_to_load" });
  }
}

async function warmEventCacheInBackground() {
  if (state.backgroundWarmRunning) return;
  state.backgroundWarmRunning = true;
  try {
    if (state.inFlight) {
      await state.inFlight;
    } else {
      state.inFlight = refreshEventCacheFromSources().finally(() => {
        state.inFlight = null;
      });
      await state.inFlight;
    }
  } catch (error) {
    console.warn("Background event warm failed", error?.message || error);
  } finally {
    state.backgroundWarmRunning = false;
  }
}

app.get("/api/meta", sendMeta);
app.get("/api/v1/meta", sendMeta);
app.get("/healthz", sendHealth);
app.get("/api/status", sendStatus);
app.get("/api/v1/status", sendStatus);
app.get("/api/events", sendEvents);
app.get("/api/v1/events", sendEvents);
app.get("/api/embed/events", requireApiKey, sendEmbedEvents);

app.post("/api/announce-event", async (req, res) => {
  try {
    const event = req.body?.event || req.body || {};
    const announced = await announceSingleEvent(event);
    return res.json({ ok: true, announced });
  } catch (error) {
    console.warn("Failed to announce event from client", error?.message || error);
    return res.status(500).json({ ok: false, error: "announce_failed" });
  }
});

app.post("/api/auth/register", async (req, res) => {
  const { email, password } = req.body || {};
  try {
    const user = await createUserAccount(email, password);
    const session = await createUserSession(user);
    res.setHeader(
      "Set-Cookie",
      `sw_user=${session.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${USER_SESSION_DAYS * 86400}`
    );
    return res.status(201).json({
      ok: true,
      user: { id: user.id, email: user.email },
      expiresAt: session.expiresAt
    });
  } catch (error) {
    const code = String(error?.message || "");
    const status = code === "user_exists" || code === "password_too_short" || code === "invalid_email" ? 400 : 500;
    return res.status(status).json({ error: code || "failed_to_register" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = await verifyUser(email, password);
  if (!user) {
    return res.status(401).json({ error: "invalid_credentials" });
  }
  const session = await createUserSession(user);
  res.setHeader(
    "Set-Cookie",
    `sw_user=${session.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${USER_SESSION_DAYS * 86400}`
  );
  return res.json({
    ok: true,
    user: { id: user.id, email: user.email },
    expiresAt: session.expiresAt
  });
});

app.post("/api/auth/logout", async (req, res) => {
  const token = readUserSessionToken(req);
  await clearUserSession(token);
  res.setHeader("Set-Cookie", "sw_user=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
  return res.json({ ok: true });
});

app.get("/api/auth/me", requireUser, async (req, res) => {
  const keys = await listUserApiKeys(req.user.id);
  return res.json({
    ok: true,
    user: req.user,
    api_keys: keys
  });
});

app.get("/api/auth/api-keys", requireUser, async (req, res) => {
  const keys = await listUserApiKeys(req.user.id);
  return res.json({ ok: true, items: keys });
});

app.post("/api/auth/api-keys", requireUser, async (req, res) => {
  const { name } = req.body || {};
  const created = await createApiKeyForUser(req.user.id, name);
  return res.status(201).json({
    ok: true,
    item: created.item,
    api_key: created.apiKey
  });
});

app.delete("/api/auth/api-keys/:keyId", requireUser, async (req, res) => {
  await revokeApiKeyForUser(req.user.id, req.params.keyId);
  return res.json({ ok: true });
});

app.post("/api/admin/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || !(await verifyAdmin(username, password))) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  const session = await createSession(username, sessionDays);
  res.setHeader(
    "Set-Cookie",
    `sw_admin=${session.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionDays * 86400}`
  );
  return res.json({ ok: true, username, expiresAt: session.expiresAt });
});

app.post("/api/admin/logout", async (req, res) => {
  const token = readSessionToken(req);
  await clearSession(token);
  res.setHeader("Set-Cookie", "sw_admin=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
  res.json({ ok: true });
});

app.get("/api/admin/status", requireAdmin, async (req, res) => {
  const maintenance = await getMaintenanceState();
  res.json({
    ok: true,
    admin: req.admin,
    maintenance: maintenance.enabled,
    maintenance_until: maintenance.until
  });
});

app.post("/api/admin/maintenance", requireAdmin, async (req, res) => {
  const { enabled } = req.body || {};
  await setSetting("maintenance", enabled ? "true" : "false");
  if (!enabled) {
    await setSetting("maintenance_until", "");
  }
  const maintenance = await getMaintenanceState();
  res.json({
    ok: true,
    maintenance: maintenance.enabled,
    maintenance_until: maintenance.until
  });
});

app.post("/api/admin/maintenance/schedule", requireAdmin, async (req, res) => {
  const { minutes, until, clear } = req.body || {};
  if (clear) {
    await setSetting("maintenance", "false");
    await setSetting("maintenance_until", "");
    return res.json({ ok: true, maintenance: false, maintenance_until: null });
  }

  let target = null;
  if (typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0) {
    target = Date.now() + Math.floor(minutes) * 60 * 1000;
  } else if (typeof until === "string" && until) {
    const parsed = Date.parse(until);
    if (!Number.isNaN(parsed)) {
      target = parsed;
    }
  }

  if (!target) {
    return res.status(400).json({ error: "invalid_schedule" });
  }

  await setSetting("maintenance", "true");
  await setSetting("maintenance_until", String(target));
  const maintenance = await getMaintenanceState();
  return res.json({
    ok: true,
    maintenance: maintenance.enabled,
    maintenance_until: maintenance.until
  });
});

app.post("/api/admin/test-events", requireAdmin, async (req, res) => {
  const { type, city, sea, direction, note, is_test, group_count } = req.body || {};
  if (!city || typeof city !== "string") {
    return res.status(400).json({ error: "city_required" });
  }

  const normalizedType = String(type || "other").trim().toLowerCase();
  const normalizedGroupCount = Number.isFinite(Number(group_count))
    ? Math.max(1, Math.min(99, Math.round(Number(group_count))))
    : 1;
  const isTest = typeof is_test === "boolean" ? is_test : true;
  const directionText = Number.isFinite(direction)
    ? ` напрям ${Math.round(direction)}`
    : "";
  const seaText = sea ? "море в напрямку" : "над";
  const countPrefix = normalizedGroupCount >= 2
    ? normalizedType === "shahed"
      ? `група із ${normalizedGroupCount} шахедів `
      : normalizedType === "missile"
        ? `група із ${normalizedGroupCount} ракет `
        : `${normalizedGroupCount} `
    : "";
  const testText = isTest ? " тест" : "";
  const message = `${countPrefix}${normalizedType} ${seaText} ${city}${directionText}.${testText} ${note || ""}`.trim();

  await addTestEvent({
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    message,
    type: normalizedType,
    direction: Number.isFinite(direction) ? direction : null,
    is_test: isTest,
    group_count: normalizedGroupCount,
    source: "admin",
    createdAt: Date.now()
  });

  res.json({ ok: true });
});

app.post("/api/admin/test-events/clear", requireAdmin, async (_req, res) => {
  await clearTestEvents();
  res.json({ ok: true });
});

app.get("/api/admin/locations", requireAdmin, async (_req, res) => {
  const items = await listAdminLocations();
  res.json({ ok: true, items });
});

app.post("/api/admin/locations", requireAdmin, async (req, res) => {
  const { location_id, name, keys, lat, lng, point_lat, point_lng, point_types, region_id, location_type, parent_location_id } = req.body || {};
  if (!location_id && (!name || typeof name !== "string")) {
    return res.status(400).json({ error: "location_name_required" });
  }

  const normalizedKeys = Array.isArray(keys)
    ? keys
    : String(keys || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  const normalizedPointTypes = Array.isArray(point_types)
    ? point_types
    : String(point_types || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

  const hasLocationCoords = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
  if (!location_id && !hasLocationCoords) {
    return res.status(400).json({ error: "location_coords_required" });
  }

  const item = await upsertAdminLocationWithPoint({
    location_id,
    name,
    keys: normalizedKeys,
    lat,
    lng,
    point_lat,
    point_lng,
    point_types: normalizedPointTypes,
    region_id,
    location_type,
    parent_location_id
  });
  res.json({ ok: true, item });
});

app.get("/account/api", (_req, res) => {
  res.sendFile(path.join(publicPath, "api.html"));
});

app.get("/api-menu", (_req, res) => {
  res.sendFile(path.join(publicPath, "api.html"));
});

app.get("/developers/api", (_req, res) => {
  res.sendFile(path.join(publicPath, "api-docs.html"));
});

app.get("/api-docs", (_req, res) => {
  res.sendFile(path.join(publicPath, "api-docs.html"));
});

app.get("/embed/map", (_req, res) => {
  res.sendFile(path.join(publicPath, "embed.html"));
});

app.get("*", (_req, res) => {
  res.sendFile(hasDistBuild ? distIndexPath : rootIndexPath);
});

app.listen(port, () => {
  console.log(`Skywatch UA backend running on http://localhost:${port}`);
  
  // Start warming cache in background after server starts
  setTimeout(async () => {
    try {
      console.log("Starting background event cache warm...");
      await warmEventCacheInBackground();
      console.log("Background event cache warm completed");
    } catch (error) {
      console.warn("Background event cache warm failed", error?.message || error);
    }
  }, 1000);
});

hydrateEventCacheFromStore().catch((error) => {
  console.warn("Initial event cache hydrate failed", error?.message || error);
});

warmEventCacheInBackground().catch(() => {});
setInterval(() => {
  warmEventCacheInBackground().catch(() => {});
}, backgroundRefreshMs);
