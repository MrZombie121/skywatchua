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
  { name: "Одеса", keys: ["odesa", "odessa", "одеса"], lat: 46.48, lng: 30.72 },
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
  { name: "Веселе", keys: ["веселе", "веселое", "vesele"], lat: 47.27, lng: 35.55 },
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
  { id: "kyivska", keys: ["київська", "киевская"] },
  { id: "kyiv", keys: ["київ", "kiev", "kyiv"] },
  { id: "kharkivska", keys: ["харківська", "харьковская"] },
  { id: "odeska", keys: ["одеська", "одесская"] },
  { id: "lvivska", keys: ["львівська", "львовская"] },
  { id: "dniprovska", keys: ["дніпропетровська", "днепропетровская"] },
  { id: "zaporizka", keys: ["запорізька", "запорожская"] },
  { id: "mykolaivska", keys: ["миколаївська", "николаевская"] },
  { id: "khersonska", keys: ["херсонська", "херсонская"] },
  { id: "chernihivska", keys: ["чернігівська", "черниговская"] },
  { id: "sumyska", keys: ["сумська", "сумская"] },
  { id: "poltavska", keys: ["полтавська", "полтавская"] },
  { id: "rivnenska", keys: ["рівненська", "ровенская"] },
  { id: "volynska", keys: ["волинська", "волынская"] },
  { id: "ternopilska", keys: ["тернопільська", "тернопольская"] },
  { id: "ivano-frankivska", keys: ["івано-франківська", "ивано-франковская"] },
  { id: "chernivetska", keys: ["чернівецька", "черновицкая"] },
  { id: "zakarpatska", keys: ["закарпатська", "закарпатская"] },
  { id: "khmelnytska", keys: ["хмельницька", "хмельницкая"] },
  { id: "vinnytska", keys: ["вінницька", "винницкая"] },
  { id: "zhytomyrska", keys: ["житомирська", "житомирская"] },
  { id: "cherkaska", keys: ["черкаська", "черкасская"] },
  { id: "kirovohradska", keys: ["кіровоградська", "кировоградская"] },
  { id: "donetska", keys: ["донецька", "донецкая"] },
  { id: "luhanska", keys: ["луганська", "луганская"] }
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
  const lower = text.toLowerCase();
  if (lower.includes("йде на") && (lower.includes("район") || lower.includes("р-н"))) {
    return "shahed";
  }
  for (const rule of typeRules) {
    if (rule.patterns.some((pattern) => lower.includes(pattern))) {
      return rule.type;
    }
  }
  return "shahed";
}

function extractAlarmRegions(text) {
  const lower = text.toLowerCase();
  const matches = [];
  alarmRegions.forEach((region) => {
    if (region.keys.some((key) => lower.includes(key))) {
      matches.push(region.id);
    }
  });
  return matches;
}

function extractAlarmSignals(text) {
  const lower = text.toLowerCase();
  const hasAlarm = lower.includes("тривога");
  const hasClear = lower.includes("відбій") || lower.includes("отбой");
  if (!hasAlarm && !hasClear) return null;

  const regions = extractAlarmRegions(text);
  if (regions.length === 0) return null;

  return {
    regions,
    status: hasClear ? "off" : "on"
  };
}

function isDowned(text) {
  const lower = text.toLowerCase();
  return ["збит", "сбит", "знищ", "уничтож", "downed"].some((keyword) =>
    lower.includes(keyword)
  );
}

function pickLocation(text) {
  const lower = text.toLowerCase();
  for (const hint of locationHints) {
    if (hint.keys.some((key) => lower.includes(key))) {
      return { lat: hint.lat, lng: hint.lng, label: hint.name };
    }
  }
  return null;
}

function pickSea(text) {
  const lower = text.toLowerCase();
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
  const lower = text.toLowerCase();
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

function parseDirection(text) {
  const lower = text.toLowerCase();
  if (lower.includes("північ")) return 0;
  if (lower.includes("схід")) return 90;
  if (lower.includes("південь")) return 180;
  if (lower.includes("захід")) return 270;
  return Math.floor(Math.random() * 360);
}

export function parseMessageToEvent(text, meta = {}) {
  if (isDowned(text)) return null;
  const location = pickLocation(text);
  const sea = pickSea(text);

  const type = meta.type || pickType(text);
  const direction = Number.isFinite(meta.direction) ? meta.direction : parseDirection(text);
  const isTest = typeof meta.is_test === "boolean"
    ? meta.is_test
    : text.toLowerCase().includes("тест") || text.toLowerCase().includes("test");

  const forceSea = type === "airplane" || forceSeaForAviation(text);
  if (!location && !sea && !forceSea) return null;

  const seaAnchor = sea ? sea.anchor : seaHints[0].anchor;
  let lat = location ? location.lat : seaAnchor.lat;
  let lng = location ? location.lng : seaAnchor.lng;
  let label = location ? location.label : sea ? sea.name : "Чорне море";

  if ((sea || forceSea) && location) {
    const vectorLat = location.lat - seaAnchor.lat;
    const vectorLng = location.lng - seaAnchor.lng;
    const scale = 0.35;
    lat = seaAnchor.lat + vectorLat * scale;
    lng = seaAnchor.lng + vectorLng * scale;
    label = `${sea ? sea.name : "Чорне море"} → ${location.label}`;
  } else if (sea || forceSea) {
    lat = seaAnchor.lat;
    lng = seaAnchor.lng;
  }

  const idSeed = `${meta.source || "tg"}-${meta.timestamp || ""}-${type}-${label}`;
  const seed = hashSeed(idSeed);

  return {
    id: idSeed,
    type,
    lat: addJitter(lat, seed),
    lng: addJitter(lng, seed + 7),
    direction,
    source: meta.source || "tg",
    timestamp: meta.timestamp ? new Date(meta.timestamp).toISOString() : new Date().toISOString(),
    comment: `Джерело: ${meta.source || "tg"}. Локація узагальнена: ${label}.`,
    is_test: isTest,
    raw_text: meta.raw_text || text
  };
}

export { extractAlarmRegions, extractAlarmSignals };
