import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
let warnedAboutCalibration = false;

function parseCalibrationPoints(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) =>
        item &&
        Number.isFinite(Number(item.lat)) &&
        Number.isFinite(Number(item.lng)) &&
        Number.isFinite(Number(item.x)) &&
        Number.isFinite(Number(item.y))
      )
      .map((item) => ({
        lat: Number(item.lat),
        lng: Number(item.lng),
        x: Number(item.x),
        y: Number(item.y)
      }));
  } catch {
    return [];
  }
}

function solveLinear3x3(matrix, vector) {
  const m = matrix.map((row) => [...row]);
  const v = [...vector];
  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 3; row += 1) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) {
        pivot = row;
      }
    }
    if (Math.abs(m[pivot][col]) < 1e-9) return null;
    if (pivot !== col) {
      [m[col], m[pivot]] = [m[pivot], m[col]];
      [v[col], v[pivot]] = [v[pivot], v[col]];
    }
    const pivotValue = m[col][col];
    for (let j = col; j < 3; j += 1) {
      m[col][j] /= pivotValue;
    }
    v[col] /= pivotValue;
    for (let row = 0; row < 3; row += 1) {
      if (row === col) continue;
      const factor = m[row][col];
      for (let j = col; j < 3; j += 1) {
        m[row][j] -= factor * m[col][j];
      }
      v[row] -= factor * v[col];
    }
  }
  return { a: v[0], b: v[1], c: v[2] };
}

function solveAffine(points, valueKey) {
  if (points.length < 3) return null;
  let sumX2 = 0;
  let sumXY = 0;
  let sumX = 0;
  let sumY2 = 0;
  let sumY = 0;
  let sumXV = 0;
  let sumYV = 0;
  let sumV = 0;
  const n = points.length;

  points.forEach((point) => {
    const x = Number(point.x);
    const y = Number(point.y);
    const v = Number(point[valueKey]);
    sumX2 += x * x;
    sumXY += x * y;
    sumX += x;
    sumY2 += y * y;
    sumY += y;
    sumXV += x * v;
    sumYV += y * v;
    sumV += v;
  });

  return solveLinear3x3(
    [
      [sumX2, sumXY, sumX],
      [sumXY, sumY2, sumY],
      [sumX, sumY, n]
    ],
    [sumXV, sumYV, sumV]
  );
}

function buildPixelMapper(points) {
  if (points.length < 3) return null;
  const latAffine = solveAffine(points, "lat");
  const lngAffine = solveAffine(points, "lng");
  if (!latAffine || !lngAffine) return null;
  return (x, y) => ({
    lat: latAffine.a * x + latAffine.b * y + latAffine.c,
    lng: lngAffine.a * x + lngAffine.b * y + lngAffine.c
  });
}

export function hasImageMarkerCalibration() {
  const calibrationRaw = process.env.MAP_CALIBRATION_POINTS || "";
  const calibrationPoints = parseCalibrationPoints(calibrationRaw);
  return Boolean(buildPixelMapper(calibrationPoints));
}

function parseConnectedComponents(output) {
  const lines = String(output || "").split(/\r?\n/);
  const points = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !/^\d+:\s+/.test(trimmed)) continue;
    const match = trimmed.match(/^\d+:\s+\S+\s+(\d+)\s+([0-9.]+),([0-9.]+)/);
    if (!match) continue;
    const area = Number(match[1]);
    const x = Number(match[2]);
    const y = Number(match[3]);
    if (!Number.isFinite(area) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push({ x, y, area });
  }
  return points;
}

export async function extractImageMarkers(imagePath) {
  const calibrationRaw = process.env.MAP_CALIBRATION_POINTS || "";
  const calibrationPoints = parseCalibrationPoints(calibrationRaw);
  const mapPixel = buildPixelMapper(calibrationPoints);
  if (!mapPixel) {
    if (!warnedAboutCalibration) {
      console.warn("Image markers skipped: MAP_CALIBRATION_POINTS missing or invalid. Configure it in .env or use /calibration.html.");
      warnedAboutCalibration = true;
    }
    return [];
  }

  const commandArgs = [
    imagePath,
    "-alpha",
    "off",
    "-colorspace",
    "RGB",
    "-fx",
    "r>0.6 && g>0.6 && b<0.5 ? 1 : 0",
    "-threshold",
    "50%",
    "-define",
    "connected-components:verbose=true",
    "-define",
    "connected-components:area-threshold=30",
    "-connected-components",
    "8",
    "null:"
  ];

  try {
    const { stdout, stderr } = await execFileAsync("magick", commandArgs, { timeout: 15000 });
    const markers = parseConnectedComponents(`${stdout}\n${stderr}`);
    return markers.map((marker) => ({
      ...mapPixel(marker.x, marker.y),
      x: marker.x,
      y: marker.y,
      area: marker.area
    }));
  } catch (error) {
    console.warn("Failed to extract image markers via ImageMagick:", error?.message || error);
    return [];
  }
}
