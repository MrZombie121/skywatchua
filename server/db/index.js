import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import crypto from "node:crypto";

const dbPath = process.env.DB_PATH || "./server/db/skywatch.json";
const adapter = new JSONFile(dbPath);
const defaultData = {
  settings: {},
  admins: [],
  sessions: [],
  test_events: [],
  admin_locations: [],
  admin_location_points: [],
  users: [],
  api_keys: []
};
const db = new Low(adapter, defaultData);
let tursoClient = null;
let tursoSettingsReady = false;
let initError = null;
const USER_SESSION_DAYS = Number(process.env.USER_SESSION_DAYS || 30);

async function tursoTableExists(tableName) {
  if (!tursoClient) return false;
  const result = await tursoClient.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [String(tableName)]
  });
  return Boolean(result.rows?.[0]?.name);
}

async function tursoTableColumns(tableName) {
  if (!tursoClient) return [];
  const result = await tursoClient.execute(`PRAGMA table_info(${tableName})`);
  return (result.rows || []).map((row) => String(row.name || ""));
}

async function ensureTursoSessionsSchema() {
  if (!tursoClient) return;

  const exists = await tursoTableExists("sessions");
  if (!exists) {
    await tursoClient.execute(`
      CREATE TABLE sessions (
        token TEXT PRIMARY KEY,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    return;
  }

  const columns = await tursoTableColumns("sessions");
  const requiredColumns = ["token", "subject_type", "subject_id", "display_name", "expires_at", "created_at"];
  const isReady = requiredColumns.every((column) => columns.includes(column));
  if (isReady) return;

  await tursoClient.execute("DROP TABLE IF EXISTS sessions_migrated");
  await tursoClient.execute(`
    CREATE TABLE sessions_migrated (
      token TEXT PRIMARY KEY,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  const hasCreatedAt = columns.includes("created_at");
  const coalesceExpr = (...candidates) => {
    const available = candidates.filter((candidate) => columns.includes(candidate));
    return available.length ? `COALESCE(${available.join(", ")}, '')` : "''";
  };
  const subjectIdExpr = coalesceExpr("subject_id", "username", "display_name");
  const displayNameExpr = coalesceExpr("display_name", "username", "subject_id");
  const createdAtExpr = hasCreatedAt ? "COALESCE(created_at, expires_at)" : "expires_at";

  await tursoClient.execute(`
    INSERT INTO sessions_migrated(token, subject_type, subject_id, display_name, expires_at, created_at)
    SELECT
      token,
      'admin',
      ${subjectIdExpr},
      ${displayNameExpr},
      expires_at,
      ${createdAtExpr}
    FROM sessions
  `);
  await tursoClient.execute("DROP TABLE sessions");
  await tursoClient.execute("ALTER TABLE sessions_migrated RENAME TO sessions");
}

const defaultAdminLocations = [
  { id: "uzyn", name: "Узин", keys: ["узин", "uzyn"], lat: 49.82, lng: 30.41, region_id: "kyivska" },
  { id: "kyiv-city", name: "Київ", keys: ["київ", "киев", "kyiv", "kiev"], lat: 50.4501, lng: 30.5234, region_id: "kyiv", location_type: "city", parent_location_id: null },
  { id: "odesa-city", name: "Одеса", keys: ["одеса", "одесса", "odesa", "odessa"], lat: 46.4825, lng: 30.7233, region_id: "odeska", location_type: "city", parent_location_id: null },
  { id: "kharkiv-city", name: "Харків", keys: ["харків", "харьков", "kharkiv", "kharkov"], lat: 49.9935, lng: 36.2304, region_id: "kharkivska", location_type: "city", parent_location_id: null },
  { id: "dnipro-city", name: "Дніпро", keys: ["дніпро", "днепр", "dnipro", "dnepr"], lat: 48.4647, lng: 35.0462, region_id: "dniprovska", location_type: "city", parent_location_id: null },
  { id: "lviv-city", name: "Львів", keys: ["львів", "львов", "lviv"], lat: 49.8397, lng: 24.0297, region_id: "lvivska", location_type: "city", parent_location_id: null },
  { id: "balta", name: "Балта", keys: ["балта", "balta"], lat: 47.94, lng: 29.62, region_id: "odeska" },
  { id: "podilsk-db", name: "Подільськ", keys: ["подільськ", "подольск", "podilsk"], lat: 47.75, lng: 29.53, region_id: "odeska" },
  { id: "pomichna", name: "Помічна", keys: ["помічна", "помошная", "pomichna"], lat: 48.24, lng: 31.42, region_id: "kirovohradska" },
  { id: "apostolove", name: "Апостолове", keys: ["апостолове", "апостолово", "apostolove"], lat: 47.66, lng: 33.71, region_id: "dniprovska" },
  { id: "snihurivka", name: "Снігурівка", keys: ["снігурівка", "снигиревка", "snihurivka"], lat: 47.08, lng: 32.81, region_id: "mykolaivska" },
  { id: "liubotyn", name: "Люботин", keys: ["люботин", "liubotyn"], lat: 49.95, lng: 35.93, region_id: "kharkivska" },
  { id: "merefa", name: "Мерефа", keys: ["мерефа", "merefa"], lat: 49.82, lng: 36.05, region_id: "kharkivska" },
  { id: "vilniansk", name: "Вільнянськ", keys: ["вільнянськ", "вольнянск", "vilniansk"], lat: 47.95, lng: 35.42, region_id: "zaporizka" },
  { id: "bashtanka-db", name: "Баштанка", keys: ["баштанка", "bashtanka"], lat: 47.41, lng: 32.44, region_id: "mykolaivska" }
];

const defaultAdminLocationPoints = [
  { id: "uzyn-p1", location_id: "uzyn", lat: 49.821, lng: 30.409, types: ["shahed", "missile"] },
  { id: "balta-p1", location_id: "balta", lat: 47.938, lng: 29.619, types: ["shahed", "missile"] },
  { id: "podilsk-db-p1", location_id: "podilsk-db", lat: 47.753, lng: 29.531, types: ["shahed", "missile"] },
  { id: "pomichna-p1", location_id: "pomichna", lat: 48.243, lng: 31.418, types: ["shahed", "missile"] },
  { id: "apostolove-p1", location_id: "apostolove", lat: 47.661, lng: 33.713, types: ["shahed", "missile"] },
  { id: "snihurivka-p1", location_id: "snihurivka", lat: 47.074, lng: 32.807, types: ["shahed", "missile"] },
  { id: "liubotyn-p1", location_id: "liubotyn", lat: 49.949, lng: 35.927, types: ["shahed", "missile"] },
  { id: "merefa-p1", location_id: "merefa", lat: 49.821, lng: 36.047, types: ["shahed", "missile"] },
  { id: "vilniansk-p1", location_id: "vilniansk", lat: 47.949, lng: 35.421, types: ["shahed", "missile"] },
  { id: "bashtanka-db-p1", location_id: "bashtanka-db", lat: 47.407, lng: 32.442, types: ["shahed", "missile"] }
];

async function init() {
  await db.read();
  db.data ||= { ...defaultData };
  if (!Array.isArray(db.data.admins)) {
    db.data.admins = [];
  }
  if (!Array.isArray(db.data.sessions)) {
    db.data.sessions = [];
  }
  if (!Array.isArray(db.data.test_events)) {
    db.data.test_events = [];
  }
  if (!Array.isArray(db.data.admin_locations)) {
    db.data.admin_locations = [];
  }
  if (!Array.isArray(db.data.admin_location_points)) {
    db.data.admin_location_points = [];
  }
  if (!Array.isArray(db.data.users)) {
    db.data.users = [];
  }
  if (!Array.isArray(db.data.api_keys)) {
    db.data.api_keys = [];
  }
  seedAdminLocations();
  await db.write();
}

const initPromise = (async () => {
  try {
    await init();
    await initTursoSettings();
    await ensureAdmin();
  } catch (error) {
    initError = error;
    console.error("DB init failed:", error?.message || error);
  }
})();

async function ensureReady() {
  await initPromise;
  if (initError) {
    throw initError;
  }
}

function normalizeKeyList(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean)
  ));
}

function normalizeLocationType(value) {
  return String(value || "").trim().toLowerCase() === "district" ? "district" : "city";
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `loc-${Date.now()}`;
}

function seedAdminLocations() {
  const existingLocationIds = new Set(db.data.admin_locations.map((item) => String(item.id)));
  defaultAdminLocations.forEach((location) => {
    if (!existingLocationIds.has(location.id)) {
      db.data.admin_locations.push({
        ...location,
        location_type: normalizeLocationType(location.location_type),
        parent_location_id: location.parent_location_id ? String(location.parent_location_id) : null,
        created_at: Date.now()
      });
      existingLocationIds.add(location.id);
    }
  });

  const existingPointIds = new Set(db.data.admin_location_points.map((item) => String(item.id)));
  defaultAdminLocationPoints.forEach((point) => {
    if (!existingPointIds.has(point.id)) {
      db.data.admin_location_points.push({
        ...point,
        created_at: Date.now()
      });
      existingPointIds.add(point.id);
    }
  });
}

async function writeAdminLocationCache(locations, points) {
  await db.read();
  db.data.admin_locations = Array.isArray(locations) ? locations.map((item) => ({ ...item })) : [];
  db.data.admin_location_points = Array.isArray(points) ? points.map((item) => ({ ...item })) : [];
  await db.write();
}

async function loadAdminLocationsFromTurso() {
  if (!tursoClient) return;
  const locationResult = await tursoClient.execute(`
    SELECT id, name, keys_json, lat, lng, region_id, location_type, parent_location_id, created_at
    FROM admin_locations
    ORDER BY created_at ASC
  `);
  const pointResult = await tursoClient.execute(`
    SELECT id, location_id, lat, lng, types_json, created_at
    FROM admin_location_points
    ORDER BY created_at ASC
  `);

  const locations = (locationResult.rows || []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    keys: normalizeKeyList(JSON.parse(String(row.keys_json || "[]"))),
    lat: Number(row.lat),
    lng: Number(row.lng),
    region_id: row.region_id ? String(row.region_id) : null,
    location_type: normalizeLocationType(row.location_type),
    parent_location_id: row.parent_location_id ? String(row.parent_location_id) : null,
    created_at: Number(row.created_at || 0)
  }));
  const points = (pointResult.rows || []).map((row) => ({
    id: String(row.id),
    location_id: String(row.location_id),
    lat: Number(row.lat),
    lng: Number(row.lng),
    types: normalizeKeyList(JSON.parse(String(row.types_json || "[]"))),
    created_at: Number(row.created_at || 0)
  }));

  await writeAdminLocationCache(locations, points);
}

async function syncAdminLocationsToTurso() {
  if (!tursoClient) return;
  await db.read();
  for (const location of db.data.admin_locations || []) {
    await tursoClient.execute({
      sql: `
        INSERT INTO admin_locations(id, name, keys_json, lat, lng, region_id, location_type, parent_location_id, created_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          keys_json = excluded.keys_json,
          lat = excluded.lat,
          lng = excluded.lng,
          region_id = excluded.region_id,
          location_type = excluded.location_type,
          parent_location_id = excluded.parent_location_id
      `,
      args: [
        String(location.id),
        String(location.name || ""),
        JSON.stringify(normalizeKeyList(location.keys || [])),
        Number(location.lat),
        Number(location.lng),
        location.region_id ? String(location.region_id) : null,
        normalizeLocationType(location.location_type),
        location.parent_location_id ? String(location.parent_location_id) : null,
        Number(location.created_at || Date.now())
      ]
    });
  }

  for (const point of db.data.admin_location_points || []) {
    await tursoClient.execute({
      sql: `
        INSERT INTO admin_location_points(id, location_id, lat, lng, types_json, created_at)
        VALUES(?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `,
      args: [
        String(point.id),
        String(point.location_id),
        Number(point.lat),
        Number(point.lng),
        JSON.stringify(normalizeKeyList(point.types || [])),
        Number(point.created_at || Date.now())
      ]
    });
  }
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
    await tursoClient.execute(`
      CREATE TABLE IF NOT EXISTS admins (
        username TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    await tursoClient.execute("ALTER TABLE admins ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0").catch(() => {});
    await ensureTursoSessionsSchema();
    await tursoClient.execute("CREATE INDEX IF NOT EXISTS idx_sessions_subject ON sessions(subject_type, subject_id)");
    await tursoClient.execute("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)");
    await tursoClient.execute(`
      CREATE TABLE IF NOT EXISTS test_events (
        id TEXT PRIMARY KEY,
        message TEXT NOT NULL,
        type TEXT,
        direction REAL,
        source TEXT,
        created_at INTEGER NOT NULL,
        is_test INTEGER NOT NULL DEFAULT 1,
        group_count INTEGER
      )
    `);
    await tursoClient.execute("ALTER TABLE test_events ADD COLUMN is_test INTEGER NOT NULL DEFAULT 1").catch(() => {});
    await tursoClient.execute("ALTER TABLE test_events ADD COLUMN group_count INTEGER").catch(() => {});
    await tursoClient.execute(`
      CREATE TABLE IF NOT EXISTS admin_locations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        keys_json TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        region_id TEXT,
        location_type TEXT NOT NULL DEFAULT 'city',
        parent_location_id TEXT,
        created_at INTEGER NOT NULL
      )
    `);
    await tursoClient.execute("ALTER TABLE admin_locations ADD COLUMN location_type TEXT NOT NULL DEFAULT 'city'").catch(() => {});
    await tursoClient.execute("ALTER TABLE admin_locations ADD COLUMN parent_location_id TEXT").catch(() => {});
    await tursoClient.execute(`
      CREATE TABLE IF NOT EXISTS admin_location_points (
        id TEXT PRIMARY KEY,
        location_id TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        types_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    await tursoClient.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    await tursoClient.execute("ALTER TABLE users ADD COLUMN created_at INTEGER").catch(() => {});
    await tursoClient.execute(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        revoked_at INTEGER
      )
    `);
    await tursoClient.execute("ALTER TABLE api_keys ADD COLUMN name TEXT NOT NULL DEFAULT 'Default key'").catch(() => {});
    await tursoClient.execute("ALTER TABLE api_keys ADD COLUMN key_prefix TEXT NOT NULL DEFAULT ''").catch(() => {});
    await tursoClient.execute("ALTER TABLE api_keys ADD COLUMN last_used_at INTEGER").catch(() => {});
    await tursoClient.execute("ALTER TABLE api_keys ADD COLUMN revoked_at INTEGER").catch(() => {});
    await tursoClient.execute("CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id, revoked_at)");
    await tursoClient.execute("CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)");

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

    const adminsCountResult = await tursoClient.execute("SELECT COUNT(*) AS count FROM admins");
    const adminsCount = Number(adminsCountResult.rows?.[0]?.count || 0);
    if (adminsCount === 0) {
      await db.read();
      for (const admin of db.data?.admins || []) {
        await tursoClient.execute({
          sql: "INSERT INTO admins(username, password_hash, updated_at) VALUES(?, ?, ?)",
          args: [String(admin.username), String(admin.password_hash), Date.now()]
        });
      }
    }

    const sessionCountResult = await tursoClient.execute("SELECT COUNT(*) AS count FROM sessions");
    const sessionCount = Number(sessionCountResult.rows?.[0]?.count || 0);
    if (sessionCount === 0) {
      await db.read();
      for (const session of db.data?.sessions || []) {
        await tursoClient.execute({
          sql: "INSERT INTO sessions(token, subject_type, subject_id, display_name, expires_at, created_at) VALUES(?, ?, ?, ?, ?, ?)",
          args: [
            String(session.token),
            String(session.subject_type || "admin"),
            String(session.subject_id || session.username || ""),
            String(session.display_name || session.username || ""),
            Number(session.expires_at || 0),
            Number(session.created_at || Date.now())
          ]
        });
      }
    }

    const testEventCountResult = await tursoClient.execute("SELECT COUNT(*) AS count FROM test_events");
    const testEventCount = Number(testEventCountResult.rows?.[0]?.count || 0);
    if (testEventCount === 0) {
      await db.read();
      for (const item of db.data?.test_events || []) {
        await tursoClient.execute({
          sql: `
            INSERT INTO test_events(id, message, type, direction, source, created_at, is_test, group_count)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?)
          `,
          args: [
            String(item.id),
            String(item.message || ""),
            item.type ? String(item.type) : null,
            Number.isFinite(Number(item.direction)) ? Number(item.direction) : null,
            item.source ? String(item.source) : null,
            Number(item.createdAt || item.created_at || Date.now()),
            item.is_test === false ? 0 : 1,
            Number.isFinite(Number(item.group_count)) ? Number(item.group_count) : null
          ]
        });
      }
    }

    const locationCountResult = await tursoClient.execute("SELECT COUNT(*) AS count FROM admin_locations");
    const locationCount = Number(locationCountResult.rows?.[0]?.count || 0);
    if (locationCount === 0) {
      await syncAdminLocationsToTurso();
    } else {
      await loadAdminLocationsFromTurso();
    }

    const usersCountResult = await tursoClient.execute("SELECT COUNT(*) AS count FROM users");
    const usersCount = Number(usersCountResult.rows?.[0]?.count || 0);
    if (usersCount === 0) {
      await db.read();
      for (const user of db.data?.users || []) {
        await tursoClient.execute({
          sql: "INSERT INTO users(id, email, password_hash, created_at) VALUES(?, ?, ?, ?)",
          args: [
            String(user.id),
            normalizeEmail(user.email),
            String(user.password_hash),
            Number(user.created_at || Date.now())
          ]
        });
      }
    }

    const apiKeyCountResult = await tursoClient.execute("SELECT COUNT(*) AS count FROM api_keys");
    const apiKeyCount = Number(apiKeyCountResult.rows?.[0]?.count || 0);
    if (apiKeyCount === 0) {
      await db.read();
      for (const item of db.data?.api_keys || []) {
        await tursoClient.execute({
          sql: `
            INSERT INTO api_keys(id, user_id, name, key_hash, key_prefix, created_at, last_used_at, revoked_at)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?)
          `,
          args: [
            String(item.id),
            String(item.user_id),
            String(item.name || "Default key"),
            String(item.key_hash),
            String(item.key_prefix),
            Number(item.created_at || Date.now()),
            item.last_used_at ? Number(item.last_used_at) : null,
            item.revoked_at ? Number(item.revoked_at) : null
          ]
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

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  return `${salt}:${hash}`;
}

function verifyPasswordHash(password, storedHash) {
  const [salt, hash] = String(storedHash || "").split(":");
  if (!salt || !hash) return false;
  const candidate = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(candidate));
}

function hashApiKey(apiKey) {
  return crypto.createHash("sha256").update(String(apiKey || "")).digest("hex");
}

function createApiKeyValue() {
  return `swu_${crypto.randomBytes(24).toString("hex")}`;
}

function maskApiKeyPrefix(prefix) {
  return `${String(prefix || "").slice(0, 12)}...`;
}

async function ensureAdmin() {
  const username = process.env.ADMIN_USER || "admin26";
  const password = process.env.ADMIN_PASS || "admin26pass";

  await db.read();
  const nextAdmin = { username, password_hash: createPasswordHash(password) };
  db.data.admins = [nextAdmin];
  await db.write();

  if (tursoSettingsReady && tursoClient) {
    await tursoClient.execute({
      sql: `
        INSERT INTO admins(username, password_hash, updated_at)
        VALUES(?, ?, ?)
        ON CONFLICT(username) DO UPDATE SET
          password_hash = excluded.password_hash,
          updated_at = excluded.updated_at
      `,
      args: [username, nextAdmin.password_hash, Date.now()]
    });
  }
}

async function verifyAdmin(username, password) {
  await ensureReady();
  if (tursoSettingsReady && tursoClient) {
    const result = await tursoClient.execute({
      sql: "SELECT password_hash FROM admins WHERE username = ?",
      args: [String(username)]
    });
    const row = result.rows?.[0];
    return row ? verifyPasswordHash(password, row.password_hash) : false;
  }

  await db.read();
  const row = db.data.admins.find((admin) => admin.username === username);
  return row ? verifyPasswordHash(password, row.password_hash) : false;
}

async function createScopedSession(subjectType, subjectId, displayName, days) {
  await ensureReady();
  const token = crypto.randomBytes(24).toString("hex");
  const createdAt = Date.now();
  const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
  const session = {
    token,
    subject_type: subjectType,
    subject_id: subjectId,
    display_name: displayName,
    expires_at: expiresAt,
    created_at: createdAt
  };

  if (tursoSettingsReady && tursoClient) {
    await tursoClient.execute({
      sql: "INSERT INTO sessions(token, subject_type, subject_id, display_name, expires_at, created_at) VALUES(?, ?, ?, ?, ?, ?)",
      args: [token, subjectType, subjectId, displayName, expiresAt, createdAt]
    });
  }

  await db.read();
  db.data.sessions = db.data.sessions.filter((item) => Number(item.expires_at || 0) >= createdAt);
  db.data.sessions.push(session);
  await db.write();
  return { token, expiresAt };
}

async function findScopedSession(token, subjectType) {
  await ensureReady();
  if (!token) return null;
  const now = Date.now();

  if (tursoSettingsReady && tursoClient) {
    await tursoClient.execute({
      sql: "DELETE FROM sessions WHERE expires_at < ?",
      args: [now]
    });
    const result = await tursoClient.execute({
      sql: `
        SELECT token, subject_type, subject_id, display_name, expires_at, created_at
        FROM sessions
        WHERE token = ? AND subject_type = ?
      `,
      args: [String(token), String(subjectType)]
    });
    const row = result.rows?.[0];
    if (!row) return null;
    return {
      token: String(row.token),
      subject_type: String(row.subject_type),
      subject_id: String(row.subject_id),
      display_name: String(row.display_name),
      expires_at: Number(row.expires_at),
      created_at: Number(row.created_at || 0),
      username: subjectType === "admin" ? String(row.display_name) : undefined,
      user_id: subjectType === "user" ? String(row.subject_id) : undefined,
      email: subjectType === "user" ? String(row.display_name) : undefined
    };
  }

  await db.read();
  db.data.sessions = db.data.sessions.filter((session) => session.expires_at >= now);
  const row = db.data.sessions.find(
    (session) => session.token === token && String(session.subject_type || "admin") === String(subjectType)
  );
  await db.write();
  return row
    ? {
      ...row,
      username: subjectType === "admin" ? String(row.display_name || row.subject_id || "") : undefined,
      user_id: subjectType === "user" ? String(row.subject_id) : undefined,
      email: subjectType === "user" ? String(row.display_name || "") : undefined
    }
    : null;
}

async function clearScopedSession(token) {
  await ensureReady();
  if (!token) return;
  if (tursoSettingsReady && tursoClient) {
    await tursoClient.execute({
      sql: "DELETE FROM sessions WHERE token = ?",
      args: [String(token)]
    });
  }
  await db.read();
  db.data.sessions = db.data.sessions.filter((session) => session.token !== token);
  await db.write();
}

async function createSession(username, days = 7) {
  return createScopedSession("admin", String(username), String(username), days);
}

async function getSession(token) {
  return findScopedSession(token, "admin");
}

async function clearSession(token) {
  return clearScopedSession(token);
}

async function getSetting(key, fallback = null) {
  await ensureReady();
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
  await ensureReady();
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
  await ensureReady();
  if (tursoSettingsReady && tursoClient) {
    const result = await tursoClient.execute(`
      SELECT id, message, type, direction, source, created_at, is_test, group_count
      FROM test_events
      ORDER BY created_at ASC
    `);
    return (result.rows || []).map((row) => ({
      id: String(row.id),
      message: String(row.message || ""),
      type: row.type ? String(row.type) : null,
      direction: Number.isFinite(Number(row.direction)) ? Number(row.direction) : null,
      source: row.source ? String(row.source) : null,
      createdAt: Number(row.created_at || 0),
      is_test: Number(row.is_test || 0) === 1,
      group_count: Number.isFinite(Number(row.group_count)) ? Number(row.group_count) : null
    }));
  }
  await db.read();
  const items = Array.isArray(db.data.test_events) ? db.data.test_events : [];
  return [...items];
}

async function addTestEvent(event) {
  await ensureReady();
  if (tursoSettingsReady && tursoClient) {
    await tursoClient.execute({
      sql: `
        INSERT INTO test_events(id, message, type, direction, source, created_at, is_test, group_count)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        String(event.id),
        String(event.message || ""),
        event.type ? String(event.type) : null,
        Number.isFinite(Number(event.direction)) ? Number(event.direction) : null,
        event.source ? String(event.source) : null,
        Number(event.createdAt || Date.now()),
        event.is_test === false ? 0 : 1,
        Number.isFinite(Number(event.group_count)) ? Number(event.group_count) : null
      ]
    });
  }
  await db.read();
  if (!Array.isArray(db.data.test_events)) {
    db.data.test_events = [];
  }
  db.data.test_events.push(event);
  await db.write();
}

async function clearTestEvents() {
  await ensureReady();
  if (tursoSettingsReady && tursoClient) {
    await tursoClient.execute("DELETE FROM test_events");
  }
  await db.read();
  db.data.test_events = [];
  await db.write();
}

function getAdminLocationsSync() {
  const locations = Array.isArray(db.data?.admin_locations) ? db.data.admin_locations : defaultData.admin_locations;
  return Array.isArray(locations)
    ? locations.map((item) => ({
      ...item,
      location_type: normalizeLocationType(item.location_type),
      parent_location_id: item.parent_location_id ? String(item.parent_location_id) : null
    }))
    : [];
}

function getAdminLocationPointsSync() {
  const points = Array.isArray(db.data?.admin_location_points) ? db.data.admin_location_points : defaultData.admin_location_points;
  return Array.isArray(points)
    ? points.map((item) => ({ ...item }))
    : [];
}

async function listAdminLocations() {
  await ensureReady();
  if (tursoSettingsReady && tursoClient) {
    try {
      await loadAdminLocationsFromTurso();
    } catch (error) {
      console.warn("Turso admin locations read failed, fallback to lowdb:", error?.message || error);
    }
  }
  await db.read();
  const locations = getAdminLocationsSync();
  const points = getAdminLocationPointsSync();
  return locations.map((location) => ({
    ...location,
    points: points.filter((point) => point.location_id === location.id)
  }));
}

async function upsertAdminLocationWithPoint(payload = {}) {
  await ensureReady();
  await db.read();
  if (!Array.isArray(db.data.admin_locations)) {
    db.data.admin_locations = [];
  }
  if (!Array.isArray(db.data.admin_location_points)) {
    db.data.admin_location_points = [];
  }

  const now = Date.now();
  const explicitId = String(payload.location_id || "").trim();
  const name = String(payload.name || "").trim();
  const lat = Number(payload.lat);
  const lng = Number(payload.lng);
  const pointLat = Number(payload.point_lat);
  const pointLng = Number(payload.point_lng);
  const regionId = String(payload.region_id || "").trim() || null;
  const locationType = normalizeLocationType(payload.location_type);
  const parentLocationId = String(payload.parent_location_id || "").trim() || null;
  const submittedKeys = normalizeKeyList(payload.keys || []);

  let location = null;
  if (explicitId) {
    location = db.data.admin_locations.find((item) => item.id === explicitId) || null;
  }
  if (!location && name) {
    location = db.data.admin_locations.find((item) => String(item.name).toLowerCase() === name.toLowerCase()) || null;
  }

  if (!location) {
    location = {
      id: explicitId || slugify(name),
      name,
      keys: normalizeKeyList([name, ...submittedKeys]),
      lat,
      lng,
      region_id: regionId,
      location_type: locationType,
      parent_location_id: locationType === "district" ? parentLocationId : null,
      created_at: now
    };
    db.data.admin_locations.push(location);
  } else {
    location.name = name || location.name;
    location.lat = Number.isFinite(lat) ? lat : location.lat;
    location.lng = Number.isFinite(lng) ? lng : location.lng;
    location.region_id = regionId || location.region_id || null;
    location.location_type = locationType || location.location_type || "city";
    location.parent_location_id = location.location_type === "district" ? parentLocationId : null;
    location.keys = normalizeKeyList([...(location.keys || []), location.name, ...submittedKeys]);
  }

  if (Number.isFinite(pointLat) && Number.isFinite(pointLng)) {
    db.data.admin_location_points.push({
      id: `pt-${location.id}-${now}-${Math.random().toString(36).slice(2, 6)}`,
      location_id: location.id,
      lat: pointLat,
      lng: pointLng,
      types: normalizeKeyList(payload.point_types || []),
      created_at: now
    });
  }

  const resultItem = {
    ...location,
    points: db.data.admin_location_points
      .filter((point) => point.location_id === location.id)
      .map((point) => ({ ...point }))
  };

  await db.write();
  if (tursoSettingsReady && tursoClient) {
    try {
      await syncAdminLocationsToTurso();
      await loadAdminLocationsFromTurso();
    } catch (error) {
      console.warn("Turso admin locations write failed, fallback to lowdb:", error?.message || error);
    }
  }
  return resultItem;
}

async function findUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  if (tursoSettingsReady && tursoClient) {
    const result = await tursoClient.execute({
      sql: "SELECT id, email, password_hash, created_at FROM users WHERE email = ?",
      args: [normalizedEmail]
    });
    const row = result.rows?.[0];
    return row
      ? {
        id: String(row.id),
        email: String(row.email),
        password_hash: String(row.password_hash),
        created_at: Number(row.created_at || 0)
      }
      : null;
  }

  await db.read();
  const row = (db.data.users || []).find((item) => normalizeEmail(item.email) === normalizedEmail);
  return row ? { ...row } : null;
}

async function createUserAccount(email, password) {
  await ensureReady();
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("invalid_email");
  }
  if (String(password || "").length < 8) {
    throw new Error("password_too_short");
  }
  if (await findUserByEmail(normalizedEmail)) {
    throw new Error("user_exists");
  }

  const user = {
    id: `usr_${crypto.randomBytes(10).toString("hex")}`,
    email: normalizedEmail,
    password_hash: createPasswordHash(password),
    created_at: Date.now()
  };

  if (tursoSettingsReady && tursoClient) {
    await tursoClient.execute({
      sql: "INSERT INTO users(id, email, password_hash, created_at) VALUES(?, ?, ?, ?)",
      args: [user.id, user.email, user.password_hash, user.created_at]
    });
  }

  await db.read();
  db.data.users.push(user);
  await db.write();

  return { id: user.id, email: user.email, created_at: user.created_at };
}

async function verifyUser(email, password) {
  await ensureReady();
  const user = await findUserByEmail(email);
  if (!user) return null;
  return verifyPasswordHash(password, user.password_hash)
    ? { id: user.id, email: user.email, created_at: user.created_at }
    : null;
}

async function createUserSession(user, days = USER_SESSION_DAYS) {
  return createScopedSession("user", String(user.id), String(user.email), days);
}

async function getUserSession(token) {
  return findScopedSession(token, "user");
}

async function clearUserSession(token) {
  return clearScopedSession(token);
}

async function listUserApiKeys(userId) {
  await ensureReady();

  if (tursoSettingsReady && tursoClient) {
    const result = await tursoClient.execute({
      sql: `
        SELECT id, user_id, name, key_prefix, created_at, last_used_at, revoked_at
        FROM api_keys
        WHERE user_id = ?
        ORDER BY created_at DESC
      `,
      args: [String(userId)]
    });
    return (result.rows || []).map((row) => ({
      id: String(row.id),
      user_id: String(row.user_id),
      name: String(row.name),
      key_prefix: String(row.key_prefix),
      masked_key: maskApiKeyPrefix(row.key_prefix),
      created_at: Number(row.created_at || 0),
      last_used_at: row.last_used_at ? Number(row.last_used_at) : null,
      revoked_at: row.revoked_at ? Number(row.revoked_at) : null
    }));
  }

  await db.read();
  return (db.data.api_keys || [])
    .filter((item) => String(item.user_id) === String(userId))
    .sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0))
    .map((item) => ({
      ...item,
      masked_key: maskApiKeyPrefix(item.key_prefix)
    }));
}

async function createApiKeyForUser(userId, name = "Default key") {
  await ensureReady();
  const apiKey = createApiKeyValue();
  const now = Date.now();
  const item = {
    id: `key_${crypto.randomBytes(8).toString("hex")}`,
    user_id: String(userId),
    name: String(name || "Default key").trim() || "Default key",
    key_hash: hashApiKey(apiKey),
    key_prefix: apiKey.slice(0, 16),
    created_at: now,
    last_used_at: null,
    revoked_at: null
  };

  if (tursoSettingsReady && tursoClient) {
    await tursoClient.execute({
      sql: `
        INSERT INTO api_keys(id, user_id, name, key_hash, key_prefix, created_at, last_used_at, revoked_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [item.id, item.user_id, item.name, item.key_hash, item.key_prefix, item.created_at, null, null]
    });
  }

  await db.read();
  db.data.api_keys.push(item);
  await db.write();

  return {
    apiKey,
    item: {
      ...item,
      masked_key: maskApiKeyPrefix(item.key_prefix)
    }
  };
}

async function revokeApiKeyForUser(userId, keyId) {
  await ensureReady();
  const revokedAt = Date.now();

  if (tursoSettingsReady && tursoClient) {
    await tursoClient.execute({
      sql: `
        UPDATE api_keys
        SET revoked_at = ?
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL
      `,
      args: [revokedAt, String(keyId), String(userId)]
    });
  }

  await db.read();
  db.data.api_keys = (db.data.api_keys || []).map((item) => {
    if (String(item.id) === String(keyId) && String(item.user_id) === String(userId) && !item.revoked_at) {
      return { ...item, revoked_at: revokedAt };
    }
    return item;
  });
  await db.write();
}

async function authenticateApiKey(rawApiKey) {
  await ensureReady();
  const keyHash = hashApiKey(rawApiKey);
  const now = Date.now();

  if (tursoSettingsReady && tursoClient) {
    const result = await tursoClient.execute({
      sql: `
        SELECT id, user_id, name, key_prefix, created_at
        FROM api_keys
        WHERE key_hash = ? AND revoked_at IS NULL
        LIMIT 1
      `,
      args: [keyHash]
    });
    const row = result.rows?.[0];
    if (!row) return null;
    await tursoClient.execute({
      sql: "UPDATE api_keys SET last_used_at = ? WHERE id = ?",
      args: [now, String(row.id)]
    });
    return {
      id: String(row.id),
      user_id: String(row.user_id),
      name: String(row.name),
      key_prefix: String(row.key_prefix),
      created_at: Number(row.created_at || 0)
    };
  }

  await db.read();
  const row = (db.data.api_keys || []).find((item) => item.key_hash === keyHash && !item.revoked_at);
  if (!row) return null;
  row.last_used_at = now;
  await db.write();
  return { ...row };
}

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
  clearTestEvents,
  listAdminLocations,
  upsertAdminLocationWithPoint,
  getAdminLocationsSync,
  getAdminLocationPointsSync,
  createUserAccount,
  verifyUser,
  createUserSession,
  getUserSession,
  clearUserSession,
  listUserApiKeys,
  createApiKeyForUser,
  revokeApiKeyForUser,
  authenticateApiKey
};
