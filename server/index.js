import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTelegramEvents } from "./telegram.js";
import { loadRssEvents } from "./rss.js";
import { parseMessageToEvent } from "./transform.js";
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
const port = process.env.PORT || 8787;
const sessionDays = Number(process.env.ADMIN_SESSION_DAYS || 7);
const EVENT_TTL_MIN = Number(process.env.EVENT_TTL_MIN || 8);

const state = {
  lastFetch: 0,
  cache: []
};

const REFRESH_MS = Number(process.env.REFRESH_MS || 12000);
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

app.get("/api/status", async (_req, res) => {
  const state = await getMaintenanceState();
  res.json({
    maintenance: state.enabled,
    maintenance_until: state.until,
    event_ttl_min: EVENT_TTL_MIN
  });
});

app.get("/api/events", async (_req, res) => {
  try {
    const tgPayload = await loadTelegramEvents();
    const maintenance = await getMaintenanceState();
    let alarmState = tgPayload.alarms || [];
    if (tgPayload.alarms_updated) {
      await setSetting("alarms_state", JSON.stringify(alarmState));
      await setSetting("alarms_updated_at", String(Date.now()));
    } else {
      const stored = await getSetting("alarms_state", "[]");
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length >= 0) {
          alarmState = parsed;
        }
      } catch {
        alarmState = alarmState || [];
      }
    }
    if (maintenance.enabled) {
      return res.json({
        events: [],
        alarms: alarmState,
        maintenance: true,
        maintenance_until: maintenance.until,
        cached: true
      });
    }

    const now = Date.now();
    if (now - state.lastFetch < REFRESH_MS && state.cache.length) {
      return res.json({
        events: state.cache,
        alarms: alarmState,
        cached: true,
        maintenance: false
      });
    }

    const rssEvents = await loadRssEvents();

    const storedTests = await listTestEvents();
    const testEvents = storedTests
      .map((item) =>
        parseMessageToEvent(item.message, {
          source: item.source || "admin",
          timestamp: item.createdAt,
          type: item.type,
          direction: item.direction,
          is_test: true
        })
      )
      .filter(Boolean);

    const nowTs = Date.now();
    const ttlMs = Math.max(1, EVENT_TTL_MIN) * 60 * 1000;
    const alarms = new Set(tgPayload.alarms || []);
    const combined = [...tgPayload.events, ...rssEvents, ...testEvents].filter((event) => {
      const time = Date.parse(event.timestamp);
      if (!Number.isFinite(time)) return false;
      return nowTs - time <= ttlMs;
    });
    state.cache = combined;
    state.lastFetch = now;

    res.json({
      events: combined,
      alarms: alarmState,
      cached: false,
      maintenance: false,
      maintenance_until: null
    });
  } catch (error) {
    console.error("Failed to load events", error);
    res.status(500).json({ error: "failed_to_load" });
  }
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
