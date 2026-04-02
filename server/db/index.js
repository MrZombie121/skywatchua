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
  admin_location_points: []
};
const db = new Low(adapter, defaultData);
let tursoClient = null;
let tursoSettingsReady = false;
let initError = null;

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
  if (!Array.isArray(db.data.test_events)) {
    db.data.test_events = [];
  }
  if (!Array.isArray(db.data.admin_locations)) {
    db.data.admin_locations = [];
  }
  if (!Array.isArray(db.data.admin_location_points)) {
    db.data.admin_location_points = [];
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

    const locationCountResult = await tursoClient.execute("SELECT COUNT(*) AS count FROM admin_locations");
    const locationCount = Number(locationCountResult.rows?.[0]?.count || 0);
    if (locationCount === 0) {
      await syncAdminLocationsToTurso();
    } else {
      await loadAdminLocationsFromTurso();
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
  await ensureReady();
  await db.read();
  const row = db.data.admins.find((admin) => admin.username === username);
  if (!row) return false;

  const [salt, hash] = row.password_hash.split(":");
  const candidate = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(candidate));
}

async function createSession(username, days = 7) {
  await ensureReady();
  await db.read();
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
  db.data.sessions.push({ token, username, expires_at: expiresAt });
  await db.write();
  return { token, expiresAt };
}

async function getSession(token) {
  await ensureReady();
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
  await ensureReady();
  if (!token) return;
  await db.read();
  db.data.sessions = db.data.sessions.filter((session) => session.token !== token);
  await db.write();
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
  await db.read();
  const items = Array.isArray(db.data.test_events) ? db.data.test_events : [];
  return [...items];
}

async function addTestEvent(event) {
  await ensureReady();
  await db.read();
  if (!Array.isArray(db.data.test_events)) {
    db.data.test_events = [];
  }
  db.data.test_events.push(event);
  await db.write();
}

async function clearTestEvents() {
  await ensureReady();
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
  getAdminLocationPointsSync
};
