import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runtime } from "./config/runtime.js";
import { loadTelegramEvents } from "./telegram.js";
import { loadRssEvents } from "./rss.js";
import { loadOpenEvents } from "./open.js";
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
  clearTestEvents
} from "./db/index.js";

const app = express();
const {
  appVersion,
  apiDefaultVersion,
  port,
  sessionDays,
  refreshMs,
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

const state = {
  lastFetch: 0,
  cache: []
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, "..", "dist");

app.use(express.json({ limit: "200kb" }));
app.use(express.static(distPath));

function readSessionToken(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/sw_admin=([^;]+)/);
  return match ? match[1] : null;
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

async function sendStatus(_req, res) {
  const state = await getMaintenanceState();
  res.json({
    maintenance: state.enabled,
    maintenance_until: state.until,
    event_ttl_min: eventTtlMin
  });
}

async function sendEvents(_req, res) {
  try {
    const tgPayload = await loadTelegramEvents();
    const maintenance = await getMaintenanceState();
    let alarmState = tgPayload.alarms || [];
    let districtAlarmState = Array.isArray(tgPayload.district_alarms) ? tgPayload.district_alarms : [];
    alarmState = applyForcedAlarms(alarmState);
    if (tgPayload.alarms_updated) {
      await setSetting("alarms_state", JSON.stringify(alarmState));
      await setSetting("district_alarms_state", JSON.stringify(districtAlarmState));
      await setSetting("alarms_updated_at", String(Date.now()));
    } else {
      const stored = await getSetting("alarms_state", "[]");
      const storedDistricts = await getSetting("district_alarms_state", "[]");
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length >= 0) {
          alarmState = applyForcedAlarms(parsed);
        }
      } catch {
        alarmState = applyForcedAlarms(alarmState || []);
      }
      try {
        const parsedDistricts = JSON.parse(storedDistricts);
        if (Array.isArray(parsedDistricts)) {
          districtAlarmState = parsedDistricts;
        }
      } catch {
        districtAlarmState = districtAlarmState || [];
      }
    }
    if (maintenance.enabled) {
      return res.json({
        events: [],
        alarms: alarmState,
        district_alarms: districtAlarmState,
        maintenance: true,
        maintenance_until: maintenance.until,
        cached: true
      });
    }

    const now = Date.now();
    if (now - state.lastFetch < refreshMs && state.cache.length) {
      return res.json({
        events: state.cache,
        alarms: alarmState,
        district_alarms: districtAlarmState,
        cached: true,
        maintenance: false
      });
    }

    const [rssEvents, openEvents] = await Promise.all([loadRssEvents(), loadOpenEvents()]);

    const storedTests = await listTestEvents();
    const testEvents = storedTests
      .flatMap((item) =>
        parseMessageToEvents(item.message, {
          source: item.source || "admin",
          timestamp: item.createdAt,
          type: item.type,
          direction: item.direction,
          is_test: true
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

    if (combined.length === 0 && state.cache.length && now - state.lastFetch <= staleKeepMs) {
      return res.json({
        events: state.cache,
        alarms: alarmState,
        district_alarms: districtAlarmState,
        cached: true,
        stale: true,
        maintenance: false,
        maintenance_until: null
      });
    }

    state.cache = combined;
    state.lastFetch = now;

    res.json({
      events: combined,
      alarms: alarmState,
      district_alarms: districtAlarmState,
      cached: false,
      maintenance: false,
      maintenance_until: null
    });
  } catch (error) {
    console.error("Failed to load events", error);
    res.status(500).json({ error: "failed_to_load" });
  }
}

app.get("/api/meta", sendMeta);
app.get("/api/v1/meta", sendMeta);
app.get("/api/status", sendStatus);
app.get("/api/v1/status", sendStatus);
app.get("/api/events", sendEvents);
app.get("/api/v1/events", sendEvents);

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
  const { type, city, sea, direction, note } = req.body || {};
  if (!city || typeof city !== "string") {
    return res.status(400).json({ error: "city_required" });
  }

  const directionText = Number.isFinite(direction)
    ? ` напрям ${Math.round(direction)}`
    : "";
  const seaText = sea ? "море в напрямку" : "над";
  const message = `${type || "other"} ${seaText} ${city}${directionText}. тест ${note || ""}`.trim();

  await addTestEvent({
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    message,
    type: type || "other",
    direction: Number.isFinite(direction) ? direction : null,
    source: "admin",
    createdAt: Date.now()
  });

  res.json({ ok: true });
});

app.post("/api/admin/test-events/clear", requireAdmin, async (_req, res) => {
  await clearTestEvents();
  res.json({ ok: true });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(port, () => {
  console.log(`Skywatch UA backend running on http://localhost:${port}`);
});
