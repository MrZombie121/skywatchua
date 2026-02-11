const typeRules = [
  {
    type: "shahed",
    patterns: [
      "shahed",
      "шахед",
      "гер",
      "дрон",
      "бпла",
      "бплa",
      "бпл",
      "uav",
      "u.a.v",
      "беспил",
      "молния"
    ]
  },
  {
    type: "recon",
    patterns: ["розвіддрон", "разведдрон", "розвідка бпла", "разведка бпла"]
  },
  { type: "missile", patterns: ["missile", "ракета", "крилат", "баліст", "ballistic"] },
  { type: "kab", patterns: ["kab", "каб"] },
  {
    type: "airplane",
    patterns: [
      "тактичної авіації",
      "тактической авиации",
      "ворожої авіації",
      "вражеской авиации",
      "активність авіації",
      "активность авиации",
      "бойової авіації",
      "боевой авиации"
    ]
  }
];

const locationHints = [
  { name: "Київ", keys: ["kyiv", "київ", "kiev"], lat: 50.45, lng: 30.52 },
  { name: "Харків", keys: ["kharkiv", "харків"], lat: 49.98, lng: 36.25 },
  { name: "Одеса", keys: ["odesa", "odessa", "одеса", "одессе"], lat: 46.48, lng: 30.72 },
  { name: "Львів", keys: ["lviv", "львів"], lat: 49.84, lng: 24.03 },
  { name: "Вінниця", keys: ["vinnytsia", "vinnytsya", "вінниця", "винница"], lat: 49.23, lng: 28.47 },
  { name: "Житомир", keys: ["zhytomyr", "житомир"], lat: 50.25, lng: 28.66 },
  { name: "Черкаси", keys: ["cherkasy", "черкаси"], lat: 49.44, lng: 32.06 },
  { name: "Дніпро", keys: ["dnipro", "дніпро"], lat: 48.46, lng: 35.05 },
  { name: "Кривий Ріг", keys: ["kryvyi rih", "кривий ріг", "кривой рог"], lat: 47.91, lng: 33.39 },
  { name: "Кропивницький", keys: ["kropyvnytskyi", "кропивницький", "кировоград"], lat: 48.51, lng: 32.26 },
  { name: "Запоріжжя", keys: ["zaporizh", "запор"], lat: 47.84, lng: 35.14 },
  { name: "Миколаїв", keys: ["mykolaiv", "николаев", "миколаїв"], lat: 46.97, lng: 31.99 },
  { name: "Херсон", keys: ["kherson", "херсон"], lat: 46.63, lng: 32.62 },
  { name: "Маріуполь", keys: ["mariupol", "маріуполь", "мариуполь"], lat: 47.1, lng: 37.55 },
  { name: "Краматорськ", keys: ["kramatorsk", "краматорськ", "краматорск"], lat: 48.72, lng: 37.56 },
  { name: "Слов'янськ", keys: ["sloviansk", "slovyansk", "слов'янськ", "славянск"], lat: 48.85, lng: 37.6 },
  { name: "Донецьк", keys: ["donetsk", "донецьк", "донецк"], lat: 48.02, lng: 37.8 },
  { name: "Луганськ", keys: ["luhansk", "луганськ", "луганск"], lat: 48.57, lng: 39.31 },
  { name: "Чернігів", keys: ["chernih", "черніг"], lat: 51.5, lng: 31.3 },
  { name: "Суми", keys: ["sumy", "суми"], lat: 50.91, lng: 34.8 },
  { name: "Полтава", keys: ["poltava", "полтава"], lat: 49.59, lng: 34.55 },
  { name: "Оржицький район", keys: ["оржицький район", "оржицкий район", "orzhytskyi"], lat: 49.74, lng: 32.92 },
  {
    name: "Веселе (Харківська)",
    keys: ["веселе", "веселое", "vesele"],
    context: ["харків", "харківська", "kharkiv"],
    lat: 49.62,
    lng: 36.03
  },
  {
    name: "Веселе (Запорізька)",
    keys: ["веселе", "веселое", "vesele"],
    context: ["запор", "запорізька", "zaporizh"],
    lat: 47.27,
    lng: 35.55
  },
  { name: "Рівне", keys: ["rivne", "рівне", "ровно"], lat: 50.62, lng: 26.25 },
  { name: "Луцьк", keys: ["lutsk", "луцьк", "луцк"], lat: 50.75, lng: 25.34 },
  { name: "Тернопіль", keys: ["ternopil", "тернопіль", "тернополь"], lat: 49.55, lng: 25.59 },
  { name: "Івано-Франківськ", keys: ["ivano-frankivsk", "івано-франківськ", "ивано-франковск"], lat: 48.92, lng: 24.71 },
  { name: "Чернівці", keys: ["chernivtsi", "чернівці", "черновцы"], lat: 48.29, lng: 25.94 },
  { name: "Ужгород", keys: ["uzhhorod", "uzhgorod", "ужгород"], lat: 48.62, lng: 22.3 },
  { name: "Хмельницький", keys: ["khmelnytskyi", "хмельницький", "хмельницкий"], lat: 49.42, lng: 26.99 },
  { name: "Кременчук", keys: ["kremenchuk", "кременчук"], lat: 49.07, lng: 33.41 }
];

const alarmRegions = [
  { id: "kyivska", keys: ["київська", "киевская", "київщина", "киевщина"] },
  { id: "kyiv", keys: ["київ", "kiev", "kyiv"] },
  { id: "kharkivska", keys: ["харківська", "харьковская", "харківщина", "харьковщина"] },
  { id: "odeska", keys: ["одеська", "одесская", "одещина", "одеса", "одесса"] },
  { id: "lvivska", keys: ["львівська", "львовская", "львівщина", "львовщина"] },
  { id: "dniprovska", keys: ["дніпропетровська", "днепропетровская", "дніпропетровщина"] },
  { id: "zaporizka", keys: ["запорізька", "запорожская", "запоріжжя", "запорожье"] },
  { id: "mykolaivska", keys: ["миколаївська", "николаевская", "миколаївщина", "николаевщина"] },
  { id: "khersonska", keys: ["херсонська", "херсонская", "херсонщина"] },
  { id: "chernihivska", keys: ["чернігівська", "черниговская", "чернігівщина", "черниговщина"] },
  { id: "sumyska", keys: ["сумська", "сумская", "сумщина"] },
  { id: "poltavska", keys: ["полтавська", "полтавская", "полтавщина"] },
  { id: "rivnenska", keys: ["рівненська", "ровенская", "рівненщина", "ровенщина"] },
  { id: "volynska", keys: ["волинська", "волынская", "волинь"] },
  { id: "ternopilska", keys: ["тернопільська", "тернопольская", "тернопільщина", "тернопольщина"] },
  { id: "ivano-frankivska", keys: ["івано-франківська", "ивано-франковская", "прикарпаття"] },
  { id: "chernivetska", keys: ["чернівецька", "черновицкая", "буковина"] },
  { id: "zakarpatska", keys: ["закарпатська", "закарпатская", "закарпаття"] },
  { id: "khmelnytska", keys: ["хмельницька", "хмельницкая", "хмельниччина"] },
  { id: "vinnytska", keys: ["вінницька", "винницкая", "вінниччина", "винниччина"] },
  { id: "zhytomyrska", keys: ["житомирська", "житомирская", "житомирщина"] },
  { id: "cherkaska", keys: ["черкаська", "черкасская", "черкащина"] },
  { id: "kirovohradska", keys: ["кіровоградська", "кировоградская", "кіровоградщина", "кировоградщина"] },
  { id: "donetska", keys: ["донецька", "донецкая", "донеччина"] },
  { id: "luhanska", keys: ["луганська", "луганская", "луганщина"] },
  { id: "crimea", keys: ["крим", "арк", "ар крым", "автономна республіка крим", "автономная республика крым"] },
  { id: "sevastopol", keys: ["севастополь", "м. севастополь", "місто севастополь"] }
];

const regionCenters = {
  kyivska: { lat: 50.45, lng: 30.52, name: "Київська" },
  kharkivska: { lat: 49.98, lng: 36.25, name: "Харківська" },
  odeska: { lat: 46.48, lng: 30.72, name: "Одеська" },
  lvivska: { lat: 49.84, lng: 24.03, name: "Львівська" },
  dniprovska: { lat: 48.46, lng: 35.05, name: "Дніпропетровська" },
  zaporizka: { lat: 47.84, lng: 35.14, name: "Запорізька" },
  mykolaivska: { lat: 46.97, lng: 31.99, name: "Миколаївська" },
  khersonska: { lat: 46.63, lng: 32.62, name: "Херсонська" },
  chernihivska: { lat: 51.5, lng: 31.3, name: "Чернігівська" },
  sumyska: { lat: 50.91, lng: 34.8, name: "Сумська" },
  poltavska: { lat: 49.59, lng: 34.55, name: "Полтавська" },
  crimea: { lat: 45.3, lng: 34.2, name: "АР Крим" },
  sevastopol: { lat: 44.6, lng: 33.5, name: "Севастополь" }
};

const alarmDistrictHints = [
  { id: "chernihivska:novhorod-siverskyi", region_id: "chernihivska", name: "Новгород-Сіверський район", keys: ["новгород-сіверський район", "новгород северский район"], lat: 52.0, lng: 33.3 },
  { id: "sumyska:konotopskyi", region_id: "sumyska", name: "Конотопський район", keys: ["конотопський район", "конотопский район"], lat: 51.24, lng: 33.2 },
  { id: "sumyska:shostkynskyi", region_id: "sumyska", name: "Шосткинський район", keys: ["шосткинський район", "шосткинский район"], lat: 51.87, lng: 33.48 },
  { id: "kharkivska:bohodukhivskyi", region_id: "kharkivska", name: "Богодухівський район", keys: ["богодухівський район", "богодуховский район"], lat: 50.16, lng: 35.53 },
  { id: "kharkivska:kharkivskyi", region_id: "kharkivska", name: "Харківський район", keys: ["харківський район", "харьковский район"], lat: 49.95, lng: 36.3 },
  { id: "kharkivska:chuhuivskyi", region_id: "kharkivska", name: "Чугуївський район", keys: ["чугуївський район", "чугуевский район"], lat: 49.83, lng: 36.68 },
  { id: "kharkivska:kupianskyi", region_id: "kharkivska", name: "Куп'янський район", keys: ["куп'янський район", "купянский район"], lat: 49.72, lng: 37.62 },
  { id: "kharkivska:izyumskyi", region_id: "kharkivska", name: "Ізюмський район", keys: ["ізюмський район", "изюмский район"], lat: 49.21, lng: 37.28 },
  { id: "kharkivska:lozivskyi", region_id: "kharkivska", name: "Лозівський район", keys: ["лозівський район", "лозовский район"], lat: 48.89, lng: 36.32 },
  { id: "dniprovska:synelnykivskyi", region_id: "dniprovska", name: "Синельниківський район", keys: ["синельниківський район", "синельниковский район"], lat: 48.32, lng: 35.52 },
  { id: "zaporizka:vasylivskyi", region_id: "zaporizka", name: "Василівський район", keys: ["василівський район", "васильевский район"], lat: 47.45, lng: 35.28 },
  { id: "zaporizka:melitopolskyi", region_id: "zaporizka", name: "Мелітопольський район", keys: ["мелітопольський район", "мелитопольский район"], lat: 46.85, lng: 35.37 },
  { id: "zaporizka:berdianskyi", region_id: "zaporizka", name: "Бердянський район", keys: ["бердянський район", "бердянский район"], lat: 46.77, lng: 36.79 },
  { id: "zaporizka:polohivskyi", region_id: "zaporizka", name: "Пологівський район", keys: ["пологівський район", "пологовский район"], lat: 47.49, lng: 36.25 },
  { id: "donetska:kramatorskyi", region_id: "donetska", name: "Краматорський район", keys: ["краматорський район", "краматорский район"], lat: 48.72, lng: 37.56 },
  { id: "donetska:volnovaskyi", region_id: "donetska", name: "Волноваський район", keys: ["волноваський район", "волновахский район"], lat: 47.6, lng: 37.5 },
  { id: "donetska:pokrovskyi", region_id: "donetska", name: "Покровський район", keys: ["покровський район", "покровский район"], lat: 48.28, lng: 37.18 },
  { id: "luhanska:alchevskyi", region_id: "luhanska", name: "Алчевський район", keys: ["алчевський район", "алчевский район"], lat: 48.47, lng: 38.8 },
  { id: "luhanska:starobilskyi", region_id: "luhanska", name: "Старобільський район", keys: ["старобільський район", "старобельский район"], lat: 49.28, lng: 38.9 },
  { id: "luhanska:sievierodonetskyi", region_id: "luhanska", name: "Сєвєродонецький район", keys: ["сєвєродонецький район", "северодонецкий район"], lat: 48.95, lng: 38.49 },
  { id: "khersonska:skadovskyi", region_id: "khersonska", name: "Скадовський район", keys: ["скадовський район", "скадовский район"], lat: 46.12, lng: 32.92 },
  { id: "khersonska:kakhovskyi", region_id: "khersonska", name: "Каховський район", keys: ["каховський район", "каховский район"], lat: 46.77, lng: 33.45 }
];

const seaHints = [
  {
    name: "Чорне море",
    keys: ["black sea", "чорне море", "черное море", "blacksea"],
    anchor: { lat: 44.6, lng: 33.3 }
  },
  {
    name: "Азовське море",
    keys: ["azov sea", "азовське море", "азовское море", "azovsea"],
    anchor: { lat: 46.3, lng: 36.9 }
  }
];

function pickType(text) {
  const lower = normalizeText(text);
  if (lower.includes("йде на") && (lower.includes("район") || lower.includes("р-н"))) {
    return "shahed";
  }
  for (const rule of typeRules) {
    if (rule.patterns.some((pattern) => lower.includes(pattern))) {
      return rule.type;
    }
  }
  return null;
}

function extractAlarmRegions(text) {
  const lower = normalizeText(text);
  const matches = [];
  alarmRegions.forEach((region) => {
    if (region.keys.some((key) => lower.includes(key))) {
      matches.push(region.id);
      return;
    }
    const hasStem = region.keys.some((key) => {
      if (key.endsWith("ська")) {
        const stem = key.slice(0, -1);
        return stem.length >= 4 && lower.includes(stem);
      }
      if (key.endsWith("ская")) {
        const stem = key.slice(0, -2);
        return stem.length >= 4 && lower.includes(stem);
      }
      return false;
    });
    if (hasStem) {
      matches.push(region.id);
    }
  });
  return matches;
}

function extractAlarmSignals(text) {
  const lower = normalizeText(text);
  const hasAlarm =
    lower.includes("тривога") ||
    lower.includes("повітряна") ||
    lower.includes("воздушная") ||
    lower.includes("сирена") ||
    lower.includes("оголошено") ||
    lower.includes("оголошена") ||
    lower.includes("увімкнено") ||
    lower.includes("включена") ||
    lower.includes("загроза") ||
    lower.includes("небезпека") ||
    lower.includes("🚨");
  const hasClear =
    lower.includes("відбій") ||
    lower.includes("отбой") ||
    lower.includes("скасовано") ||
    lower.includes("відміна") ||
    lower.includes("отмена") ||
    lower.includes("сирени відбій") ||
    lower.includes("сирена відбій");
  if (!hasAlarm && !hasClear) return null;

  const regions = new Set(extractAlarmRegions(text));
  const districts = extractAlarmDistricts(text);
  districts.forEach((district) => regions.add(district.region_id));
  if (regions.size === 0 && districts.length === 0) return null;

  return {
    regions: Array.from(regions),
    districts,
    status: hasClear ? "off" : "on"
  };
}

function isDowned(text) {
  const lower = normalizeText(text);
  return ["збит", "сбит", "знищ", "уничтож", "downed"].some((keyword) =>
    lower.includes(keyword)
  );
}

function pickLocation(text) {
  const lower = normalizeText(text);
  const contextual = allLocationHints.filter((hint) => Array.isArray(hint.context) && hint.context.length > 0);
  for (const hint of contextual) {
    if (hint.keys.some((key) => lower.includes(key)) && hint.context.some((ctx) => lower.includes(ctx))) {
      return { lat: hint.lat, lng: hint.lng, label: hint.name };
    }
  }
  for (const hint of allLocationHints) {
    if (Array.isArray(hint.context) && hint.context.length > 0) continue;
    if (hint.keys.some((key) => lower.includes(key))) {
      return { lat: hint.lat, lng: hint.lng, label: hint.name };
    }
  }
  return null;
}

function pickSea(text) {
  const lower = normalizeText(text);
  for (const sea of seaHints) {
    if (sea.keys.some((key) => lower.includes(key))) {
      return sea;
    }
  }
  if (lower.includes("море") || lower.includes("sea")) {
    return seaHints[0];
  }
  return null;
}

function forceSeaForAviation(text) {
  const lower = normalizeText(text);
  return (
    lower.includes("тактичної авіації") ||
    lower.includes("тактической авиации") ||
    lower.includes("ворожої авіації") ||
    lower.includes("вражеской авиации") ||
    lower.includes("активність авіації") ||
    lower.includes("активность авиации")
  );
}

function hashSeed(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function addJitter(value, seed) {
  const normalized = (seed % 1000) / 1000;
  const offset = (normalized - 0.5) * 0.4;
  return Number((value + offset).toFixed(4));
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[.,;:()\\[\\]{}<>]/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
}

function loadOverrideLocations() {
  const raw = process.env.TG_LOCATION_OVERRIDES || "";
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && item.lat && item.lng && Array.isArray(item.keys))
      .map((item) => ({
        name: item.name || item.keys[0],
        keys: item.keys.map((key) => String(key).toLowerCase()),
        lat: Number(item.lat),
        lng: Number(item.lng),
        context: Array.isArray(item.context) ? item.context.map((c) => String(c).toLowerCase()) : null
      }));
  } catch {
    return [];
  }
}

const overrideLocations = loadOverrideLocations();
const allLocationHints = [...locationHints, ...overrideLocations];

function loadOverrideAlarmDistricts() {
  const raw = process.env.ALARM_DISTRICT_OVERRIDES || "";
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && item.id && item.region_id && item.lat && item.lng && Array.isArray(item.keys))
      .map((item) => ({
        id: String(item.id),
        region_id: String(item.region_id),
        name: String(item.name || item.id),
        keys: item.keys.map((key) => normalizeText(key)),
        lat: Number(item.lat),
        lng: Number(item.lng)
      }));
  } catch {
    return [];
  }
}

const overrideAlarmDistrictHints = loadOverrideAlarmDistricts();
const allAlarmDistrictHints = [...alarmDistrictHints, ...overrideAlarmDistrictHints];

function extractAlarmDistricts(text) {
  const lower = normalizeText(text);
  const out = [];
  allAlarmDistrictHints.forEach((district) => {
    if (district.keys.some((key) => lower.includes(key))) {
      out.push({
        id: district.id,
        region_id: district.region_id,
        name: district.name,
        lat: district.lat,
        lng: district.lng
      });
    }
  });
  const seen = new Set();
  return out.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function parseDirection(text) {
  const lower = normalizeText(text);
  const degreeMatch = lower.match(/(\d{1,3})\s*(?:°|град|deg)/);
  if (degreeMatch) {
    const numeric = Number(degreeMatch[1]);
    if (Number.isFinite(numeric)) {
      return ((numeric % 360) + 360) % 360;
    }
  }
  if (/(північн[оы]й?\s*схід|северо[- ]восток|north[- ]?east)/.test(lower)) return 45;
  if (/(південн[оы]й?\s*схід|юго[- ]восток|south[- ]?east)/.test(lower)) return 135;
  if (/(південн[оы]й?\s*захід|юго[- ]запад|south[- ]?west)/.test(lower)) return 225;
  if (/(північн[оы]й?\s*захід|северо[- ]запад|north[- ]?west)/.test(lower)) return 315;
  if (/(північ|север|north)/.test(lower)) return 0;
  if (/(схід|восток|east)/.test(lower)) return 90;
  if (/(південь|юг|south)/.test(lower)) return 180;
  if (/(захід|запад|west)/.test(lower)) return 270;
  return null;
}

function resolveRegionId(text, label) {
  const lower = normalizeText(text);
  for (const region of alarmRegions) {
    if (region.keys.some((key) => lower.includes(key))) {
      return region.id;
    }
  }
  const labelLower = normalizeText(label);
  for (const region of alarmRegions) {
    if (region.keys.some((key) => labelLower.includes(key))) {
      return region.id;
    }
  }
  return null;
}

export function parseMessageToEvent(text, meta = {}) {
  return parseMessageToEvents(text, meta)[0] || null;
}

function extractCoords(text) {
  const match = String(text || "")
    .replace(/,/g, ".")
    .match(/(-?\\d{1,2}\\.\\d+)\\s*[, ]\\s*(-?\\d{1,3}\\.\\d+)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < 43 || lat > 53 || lng < 21 || lng > 41) return null;
  return { lat, lng, label: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, exact: true };
}

function extractLocationHits(text) {
  const lower = normalizeText(text);
  const hits = [];
  allLocationHints.forEach((hint) => {
    hint.keys.forEach((key) => {
      const idx = lower.indexOf(key);
      if (idx === -1) return;
      const before = lower.slice(Math.max(0, idx - 30), idx);
      const countMatch = before.match(
        /(\\+?\\d{1,2})\\s*(?:x|шт\\.?|од\\.?|штук)?\\s*(?:повз|біля|поблизу|над|у напрямку|в направлении|в районі|в р-ні|в р-не|курс на|в сторону|по|через)?\\s*$/
      );
      const count = countMatch ? Number(String(countMatch[1]).replace("+", "")) : null;
      hits.push({
        label: hint.name,
        lat: hint.lat,
        lng: hint.lng,
        exact: true,
        count: Number.isFinite(count) ? count : null,
        index: idx
      });
    });
  });
  hits.sort((a, b) => a.index - b.index);
  const unique = new Map();
  hits.forEach((hit) => {
    if (!unique.has(hit.label)) {
      unique.set(hit.label, hit);
    } else if (unique.get(hit.label).count == null && hit.count != null) {
      unique.set(hit.label, hit);
    }
  });
  return Array.from(unique.values());
}

function hasTrackContext(text) {
  const lower = normalizeText(text);
  return [
    "бпла",
    "бпл",
    "дрон",
    "шахед",
    "uav",
    "курс",
    "йде на",
    "летить",
    "літає",
    "над",
    "повз",
    "поблизу",
    "біля",
    "в районі",
    "в р-ні",
    "в р-не",
    "у напрямку",
    "в направлении",
    "загроза",
    "небезпека"
  ].some((key) => lower.includes(key));
}

function bearingDeg(fromLat, fromLng, toLat, toLng) {
  const toRad = (value) => (value * Math.PI) / 180;
  const toDeg = (value) => (value * 180) / Math.PI;
  const lat1 = toRad(fromLat);
  const lat2 = toRad(toLat);
  const dLng = toRad(toLng - fromLng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const brng = toDeg(Math.atan2(y, x));
  return ((brng % 360) + 360) % 360;
}

export function parseMessageToEvents(text, meta = {}) {
  const contextTexts = Array.isArray(meta.context_texts)
    ? meta.context_texts.filter(Boolean)
    : [];
  const mergedText = [text, ...contextTexts].filter(Boolean).join(" ");

  if (isDowned(mergedText)) return [];
  const coords = extractCoords(mergedText);
  const locationHits = coords ? [coords] : extractLocationHits(mergedText);
  const sea = pickSea(mergedText);

  let type = meta.type || pickType(mergedText);
  const hasCount = locationHits.some((hit) => Number.isFinite(hit.count) && hit.count > 0);
  if (!type && locationHits.length > 0 && (hasTrackContext(mergedText) || hasCount)) {
    type = "shahed";
  }
  if (!type) return [];

  let direction = Number.isFinite(meta.direction) ? meta.direction : parseDirection(mergedText);
  if (
    !Number.isFinite(direction) &&
    Number.isFinite(meta.base_lat) &&
    Number.isFinite(meta.base_lng) &&
    locationHits.length > 0
  ) {
    direction = bearingDeg(
      Number(meta.base_lat),
      Number(meta.base_lng),
      Number(locationHits[0].lat),
      Number(locationHits[0].lng)
    );
  }
  const isTest = typeof meta.is_test === "boolean"
    ? meta.is_test
    : normalizeText(mergedText).includes("тест") || normalizeText(mergedText).includes("test");

  const forceSea = type === "airplane" || forceSeaForAviation(mergedText);
  const sourceLower = String(meta.source || "").toLowerCase();
  const isTlk = sourceLower.includes("tlknewsua");
  let regionId = resolveRegionId(text, "");
  if (!regionId && (sourceLower.includes("xydessa_live") || sourceLower.includes("pivdenmedia"))) {
    regionId = "odeska";
  }
  const regionCenter = regionId ? regionCenters[regionId] : null;

  if (locationHits.length === 0 && !sea && !forceSea && !regionCenter && !(isTlk && type === "shahed")) {
    return [];
  }

  const seaAnchor = sea ? sea.anchor : seaHints[0].anchor;

  const targets = locationHits.length > 0
    ? locationHits
    : regionCenter
      ? [{ lat: regionCenter.lat, lng: regionCenter.lng, label: regionCenter.name, exact: false }]
      : [{ lat: seaAnchor.lat, lng: seaAnchor.lng, label: sea ? sea.name : "Чорне море", exact: false }];

  return targets.map((target, index) => {
    let lat = target.lat;
    let lng = target.lng;
    let label = target.label;

    if ((sea || forceSea) && locationHits.length > 0) {
      const vectorLat = target.lat - seaAnchor.lat;
      const vectorLng = target.lng - seaAnchor.lng;
      const scale = 0.35;
      lat = seaAnchor.lat + vectorLat * scale;
      lng = seaAnchor.lng + vectorLng * scale;
      label = `${sea ? sea.name : "Чорне море"} → ${target.label}`;
    } else if (sea || forceSea) {
      lat = seaAnchor.lat;
      lng = seaAnchor.lng;
    }

    if (isTlk && type === "shahed" && locationHits.length === 0 && !regionCenter) {
      const center = regionCenters.kharkivska;
      lat = center.lat;
      lng = center.lng;
      label = `${center.name} (загально)`;
    }

    const trackKey = meta.track_key ? String(meta.track_key) : null;
    const idSeed = trackKey
      ? `${trackKey}-${type}-${index}`
      : `${meta.source || "tg"}-${meta.timestamp || ""}-${type}-${label}-${index}`;
    const seed = hashSeed(idSeed);
    const resolvedRegionId =
      resolveRegionId(label, label) ||
      resolveRegionId(text, label) ||
      resolveRegionId(mergedText, label) ||
      regionId;
    const countText = target.count && target.count > 1 ? ` К-сть: ${target.count}.` : "";
    const jitteredLat = target.exact ? lat : addJitter(lat, seed);
    const jitteredLng = target.exact ? lng : addJitter(lng, seed + 7);

    return {
      id: idSeed,
      type,
      lat: jitteredLat,
      lng: jitteredLng,
      direction: Number.isFinite(direction) ? direction : null,
      source: meta.source || "tg",
      timestamp: meta.timestamp ? new Date(meta.timestamp).toISOString() : new Date().toISOString(),
      comment: `Джерело: ${meta.source || "tg"}. Локація: ${label}.${countText}`,
      is_test: isTest,
      region_id: resolvedRegionId,
      raw_text: meta.raw_text || text
    };
  });
}

export { extractAlarmRegions, extractAlarmSignals };
