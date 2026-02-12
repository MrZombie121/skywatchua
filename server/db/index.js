import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import crypto from "node:crypto";

const dbPath = process.env.DB_PATH || "./server/db/skywatch.json";
const adapter = new JSONFile(dbPath);
const db = new Low(adapter, { settings: {}, admins: [], sessions: [], test_events: [] });

async function init() {
  await db.read();
  db.data ||= { settings: {}, admins: [], sessions: [], test_events: [] };
  if (!Array.isArray(db.data.test_events)) {
    db.data.test_events = [];
  }
  await db.write();
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
  const exists = db.data.admins.find((admin) => admin.username === username);
  if (exists) return;

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  db.data.admins.push({ username, password_hash: `${salt}:${hash}` });
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
  await db.read();
  return db.data.settings[key] ?? fallback;
}

async function setSetting(key, value) {
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
