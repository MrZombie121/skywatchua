import sharp from "sharp";

let warnedAboutCalibration = false;

const MIN_MARKER_AREA = 30;

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

function isLikelyYellowPixel(r, g, b, alpha) {
  if (alpha < 32) return false;
  if (r < 140 || g < 140 || b > 150) return false;
  if (r - b < 40 || g - b < 40) return false;
  if (Math.abs(r - g) > 85) return false;
  return true;
}

function findMarkerComponents(buffer, width, height, channels) {
  const visited = new Uint8Array(width * height);
  const markers = [];
  const queue = new Int32Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (visited[idx]) continue;
      visited[idx] = 1;

      const offset = idx * channels;
      const r = buffer[offset];
      const g = buffer[offset + 1];
      const b = buffer[offset + 2];
      const alpha = channels >= 4 ? buffer[offset + 3] : 255;
      if (!isLikelyYellowPixel(r, g, b, alpha)) continue;

      let head = 0;
      let tail = 0;
      queue[tail++] = idx;

      let area = 0;
      let sumX = 0;
      let sumY = 0;

      while (head < tail) {
        const current = queue[head++];
        const cx = current % width;
        const cy = Math.floor(current / width);
        area += 1;
        sumX += cx;
        sumY += cy;

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const nIdx = ny * width + nx;
            if (visited[nIdx]) continue;
            visited[nIdx] = 1;

            const nOffset = nIdx * channels;
            const nr = buffer[nOffset];
            const ng = buffer[nOffset + 1];
            const nb = buffer[nOffset + 2];
            const na = channels >= 4 ? buffer[nOffset + 3] : 255;
            if (!isLikelyYellowPixel(nr, ng, nb, na)) continue;
            queue[tail++] = nIdx;
          }
        }
      }

      if (area < MIN_MARKER_AREA) continue;
      markers.push({
        x: sumX / area,
        y: sumY / area,
        area
      });
    }
  }

  return markers;
}

function getPixelMapperFromEnv() {
  const calibrationRaw = process.env.MAP_CALIBRATION_POINTS || "";
  const calibrationPoints = parseCalibrationPoints(calibrationRaw);
  return buildPixelMapper(calibrationPoints);
}

export function hasImageMarkerCalibration() {
  return Boolean(getPixelMapperFromEnv());
}

export async function canExtractImageMarkers() {
  return hasImageMarkerCalibration();
}

export async function extractImageMarkers(imagePath) {
  const mapPixel = getPixelMapperFromEnv();
  if (!mapPixel) {
    if (!warnedAboutCalibration) {
      console.warn("Image markers skipped: MAP_CALIBRATION_POINTS missing or invalid. Configure it in .env or use /calibration.html.");
      warnedAboutCalibration = true;
    }
    return [];
  }

  try {
    const { data, info } = await sharp(imagePath)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const markers = findMarkerComponents(data, info.width, info.height, info.channels);
    return markers.map((marker) => ({
      ...mapPixel(marker.x, marker.y),
      x: marker.x,
      y: marker.y,
      area: marker.area
    }));
  } catch (error) {
    console.warn("Failed to extract image markers via sharp:", error?.message || error);
    return [];
  }
}
