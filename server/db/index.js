import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import crypto from "node:crypto";

const dbPath = process.env.DB_PATH || "./server/db/skywatch.json";
const adapter = new JSONFile(dbPath);
const db = new Low(adapter, { settings: {}, admins: [], sessions: [], test_events: [] });
let tursoClient = null;
let tursoSettingsReady = false;

async function init() {
  await db.read();
  db.data ||= { settings: {}, admins: [], sessions: [], test_events: [] };
  if (!Array.isArray(db.data.test_events)) {
    db.data.test_events = [];
  }
  await db.write();
}

async function initTursoSettings() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) return;

  try {
    const { createClient } = await import("@libsql/client");
    tursoClient = createClient({ url, authToken });
    await tursoClient.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    const countResult = await tursoClient.execute("SELECT COUNT(*) AS count FROM settings");
    const settingsCount = Number(countResult.rows?.[0]?.count || 0);
    if (settingsCount === 0) {
      await db.read();
      const localSettings = db.data?.settings || {};
      for (const [key, value] of Object.entries(localSettings)) {
        await tursoClient.execute({
          sql: "INSERT INTO settings(key, value) VALUES(?, ?)",
          args: [String(key), String(value ?? "")]
        });
      }
    }

    tursoSettingsReady = true;
    console.log("Turso settings storage enabled.");
  } catch (error) {
    tursoClient = null;
    tursoSettingsReady = false;
    console.warn("Turso settings disabled, fallback to local lowdb:", error?.message || error);
  }
}

function hashPassword(password, salt) {
  return crypto
    .pbkdf2Sync(password, salt, 120000, 64, "sha512")
    .toString("hex");
}

async function ensureAdmin() {
  const username = process.env.ADMIN_USER || "admin26";
  const password = process.env.ADMIN_PASS || "admin26pass";

  await db.read();
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  const nextAdmin = { username, password_hash: `${salt}:${hash}` };
  db.data.admins = [nextAdmin];
  await db.write();
}

async function verifyAdmin(username, password) {
  await db.read();
  const row = db.data.admins.find((admin) => admin.username === username);
  if (!row) return false;

  const [salt, hash] = row.password_hash.split(":");
  const candidate = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(candidate));
}

async function createSession(username, days = 7) {
  await db.read();
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
  db.data.sessions.push({ token, username, expires_at: expiresAt });
  await db.write();
  return { token, expiresAt };
}

async function getSession(token) {
  if (!token) return null;
  await db.read();
  const now = Date.now();
  db.data.sessions = db.data.sessions.filter((session) => session.expires_at >= now);
  const row = db.data.sessions.find((session) => session.token === token);
  if (!row) {
    await db.write();
    return null;
  }
  await db.write();
  return row;
}

async function clearSession(token) {
  if (!token) return;
  await db.read();
  db.data.sessions = db.data.sessions.filter((session) => session.token !== token);
  await db.write();
}

async function getSetting(key, fallback = null) {
  if (tursoSettingsReady && tursoClient) {
    try {
      const result = await tursoClient.execute({
        sql: "SELECT value FROM settings WHERE key = ?",
        args: [String(key)]
      });
      if (result.rows?.length) {
        return result.rows[0].value;
      }
      return fallback;
    } catch (error) {
      console.warn("Turso read failed, fallback to lowdb:", error?.message || error);
    }
  }

  await db.read();
  return db.data.settings[key] ?? fallback;
}

async function setSetting(key, value) {
  if (tursoSettingsReady && tursoClient) {
    try {
      await tursoClient.execute({
        sql: `
          INSERT INTO settings(key, value) VALUES(?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `,
        args: [String(key), String(value ?? "")]
      });
    } catch (error) {
      console.warn("Turso write failed, fallback to lowdb:", error?.message || error);
    }
  }

  await db.read();
  db.data.settings[key] = value;
  await db.write();
}

async function listTestEvents() {
  await db.read();
  const items = Array.isArray(db.data.test_events) ? db.data.test_events : [];
  return [...items];
}

async function addTestEvent(event) {
  await db.read();
  if (!Array.isArray(db.data.test_events)) {
    db.data.test_events = [];
  }
  db.data.test_events.push(event);
  await db.write();
}

async function clearTestEvents() {
  await db.read();
  db.data.test_events = [];
  await db.write();
}

await init();
await initTursoSettings();
await ensureAdmin();

export {
  db,
  verifyAdmin,
  createSession,
  getSession,
  clearSession,
  getSetting,
  setSetting,
  listTestEvents,
  addTestEvent,
  clearTestEvents
};
