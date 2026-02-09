import { createClient } from "@libsql/client";
import crypto from "node:crypto";

const dbUrl = process.env.TURSO_DATABASE_URL || "";
const authToken = process.env.TURSO_AUTH_TOKEN || "";

if (!dbUrl) {
  throw new Error("TURSO_DATABASE_URL is not set.");
}

const db = createClient({
  url: dbUrl,
  authToken
});

async function init() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS admins (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS test_events (
      id TEXT PRIMARY KEY,
      message TEXT NOT NULL,
      type TEXT,
      direction INTEGER,
      source TEXT,
      created_at INTEGER NOT NULL
    );
  `);
}

function hashPassword(password, salt) {
  return crypto
    .pbkdf2Sync(password, salt, 120000, 64, "sha512")
    .toString("hex");
}

async function ensureAdmin() {
  const username = process.env.ADMIN_USER || "admin26";
  const password = process.env.ADMIN_PASS || "admin26-ChangeMe!";

  const existing = await db.execute({
    sql: "SELECT username FROM admins WHERE username = ?",
    args: [username]
  });
  if (existing.rows.length > 0) return;

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  const stored = `${salt}:${hash}`;
  await db.execute({
    sql: "INSERT INTO admins (username, password_hash) VALUES (?, ?)",
    args: [username, stored]
  });
}

async function verifyAdmin(username, password) {
  const row = await db.execute({
    sql: "SELECT password_hash FROM admins WHERE username = ?",
    args: [username]
  });
  if (row.rows.length === 0) return false;
  const stored = String(row.rows[0].password_hash || "");
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(candidate));
}

async function createSession(username, days = 7) {
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
  await db.execute({
    sql: "INSERT INTO sessions (token, username, expires_at) VALUES (?, ?, ?)",
    args: [token, username, expiresAt]
  });
  return { token, expiresAt };
}

async function getSession(token) {
  if (!token) return null;
  await db.execute({
    sql: "DELETE FROM sessions WHERE expires_at < ?",
    args: [Date.now()]
  });
  const row = await db.execute({
    sql: "SELECT token, username, expires_at FROM sessions WHERE token = ?",
    args: [token]
  });
  if (row.rows.length === 0) return null;
  return row.rows[0];
}

async function clearSession(token) {
  if (!token) return;
  await db.execute({
    sql: "DELETE FROM sessions WHERE token = ?",
    args: [token]
  });
}

async function getSetting(key, fallback = null) {
  const row = await db.execute({
    sql: "SELECT value FROM settings WHERE key = ?",
    args: [key]
  });
  if (row.rows.length === 0) return fallback;
  return row.rows[0].value;
}

async function setSetting(key, value) {
  await db.execute({
    sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [key, value]
  });
}

async function listTestEvents() {
  const rows = await db.execute({
    sql: "SELECT id, message, type, direction, source, created_at FROM test_events ORDER BY created_at DESC"
  });
  return rows.rows.map((row) => ({
    id: row.id,
    message: row.message,
    type: row.type,
    direction: row.direction,
    source: row.source,
    createdAt: row.created_at
  }));
}

async function addTestEvent(event) {
  await db.execute({
    sql: "INSERT INTO test_events (id, message, type, direction, source, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: [
      event.id,
      event.message,
      event.type,
      event.direction,
      event.source,
      event.createdAt
    ]
  });
}

async function clearTestEvents() {
  await db.execute("DELETE FROM test_events");
}

await init();
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
