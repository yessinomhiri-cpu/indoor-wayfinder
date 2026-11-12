/**
 * ==========================================================================
 * Module       : build-campus.mjs
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-12
 * Modified     : 2026-11-12
 * Version      : 3.0.0 (SUP'COM campus import)
 * Description  : Builds assets/campus/supcom.json from public sources:
 *                - SUP'COM floor plans (RDC, étages 1–3) and labels published
 *                  by SUP'COM on ArcGIS Online (owner SUPCOM_TUN, the data
 *                  behind supnav.supcom.tn);
 *                - surrounding campus buildings, parkings and paths from
 *                  OpenStreetMap (ODbL).
 *                It computes, per floor, a walkable occupancy grid (doorways
 *                opened from the door symbols), rooms (closed regions), named
 *                places, and stair / lift connectors between floors.
 *
 * Usage        : node scripts/build-campus.mjs
 * ==========================================================================
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(ROOT, 'assets', 'campus', 'supcom.json');
/** Surveyed fixes: passages missing from the CAD plans and room names. */
const CORRECTIONS = join(ROOT, 'assets', 'campus', 'corrections.json');

const ARCGIS_SERVICE =
  'https://services-eu1.arcgis.com/Vx1BvPxWQ9O0WzWh/arcgis/rest/services/supcom_basemaps_gdb/FeatureServer';
/** ArcGIS layer id → building level (layer 2 is "plan_etage3", layer 3 "plan_etage2"). */
const FLOOR_LAYERS = [
  { layer: 0, level: 0, name: 'Rez-de-chaussée', short: 'RDC' },
  { layer: 1, level: 1, name: 'Étage 1', short: 'E1' },
  { layer: 3, level: 2, name: 'Étage 2', short: 'E2' },
  { layer: 2, level: 3, name: 'Étage 3', short: 'E3' }
];
const LABEL_LAYER = 4;

const OSM_BBOX = '10.1820,36.8885,10.1925,36.8950'; // lon/lat min, lon/lat max

/** Local frame origin: SUP'COM main entrance (label "Entrée principale"). */
const ORIGIN = { lat: 36.892036, lon: 10.187508 };
const KX = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const KY = 110540;

/** CAD line types of the SUP'COM plans. */
const TYPE = { WALL: 1, DOOR: 2, STAIRS: 3, LIFT: 4, FACADE: 5, COLUMN: 6 };

const GRID_RES = 0.25;       // metres per routing cell
const GRID_MARGIN = 8;       // metres of outdoor space around the building
const FLOOR_HEIGHT = 3.6;    // metres between levels
const MAX_DOOR_SPAN = Number(process.env.MAX_DOOR_SPAN || 3.5); // m; a larger door symbol is not one door
const MIN_ROOM_AREA = 4;     // m²
const MAX_ROOM_AREA = 900;   // m²
const MAX_ROOM_DOORS = 4;    // more doors than this = corridor / hall

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** WGS84 → local metres (x east, y north). */
function toLocal(lon, lat) {
  return [(lon - ORIGIN.lon) * KX, (lat - ORIGIN.lat) * KY];
}

/** Rounds to centimetres to keep the JSON small. */
const cm = (value) => Math.round(value * 100) / 100;

/** Douglas–Peucker polyline simplification. */
function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy || 1e-12;
    let maxDistance = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
      const distance = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (distance > maxDistance) { maxDistance = distance; index = i; }
    }
    if (maxDistance > tolerance && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

class Grid {
  constructor(minX, minY, width, height, res) {
    Object.assign(this, { minX, minY, width, height, res });
  }
  cx(x) { return Math.floor((x - this.minX) / this.res); }
  cy(y) { return Math.floor((y - this.minY) / this.res); }
  index(cx, cy) { return cy * this.width + cx; }
  inside(cx, cy) { return cx >= 0 && cy >= 0 && cx < this.width && cy < this.height; }
  centre(index) {
    return [
      this.minX + ((index % this.width) + 0.5) * this.res,
      this.minY + (Math.floor(index / this.width) + 0.5) * this.res
    ];
  }
}

/** Bresenham rasterisation of a polyline into a mask. */
function rasterPolyline(grid, mask, points) {
  for (let i = 0; i < points.length - 1; i++) {
    let x0 = grid.cx(points[i][0]);
    let y0 = grid.cy(points[i][1]);
    const x1 = grid.cx(points[i + 1][0]);
    const y1 = grid.cy(points[i + 1][1]);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      if (grid.inside(x0, y0)) mask[grid.index(x0, y0)] = 1;
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * error;
      if (e2 >= dy) { error += dy; x0 += sx; }
      if (e2 <= dx) { error += dx; y0 += sy; }
    }
  }
}

/** Square (Chebyshev) dilation by `radius` cells. */
function dilate(grid, mask, radius) {
  const { width, height } = grid;
  const horizontal = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    let last = -Infinity;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (mask[row + x]) last = x;
      if (x - last <= radius) horizontal[row + x] = 1;
    }
    last = Infinity;
    for (let x = width - 1; x >= 0; x--) {
      if (mask[row + x]) last = x;
      if (last - x <= radius) horizontal[row + x] = 1;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < width; x++) {
    let last = -Infinity;
    for (let y = 0; y < height; y++) {
      if (horizontal[y * width + x]) last = y;
      if (y - last <= radius) out[y * width + x] = 1;
    }
    last = Infinity;
    for (let y = height - 1; y >= 0; y--) {
      if (horizontal[y * width + x]) last = y;
      if (last - y <= radius) out[y * width + x] = 1;
    }
  }
  return out;
}

const invert = (mask) => mask.map((v) => (v ? 0 : 1));

/** 4-connected component labelling of cells where open[i] is set. */
function label(grid, open) {
  const { width, height } = grid;
  const labels = new Int32Array(open.length);
  const sizes = [0];
  const touchesBorder = [false];
  const queue = new Int32Array(open.length);
  let count = 0;
  for (let start = 0; start < open.length; start++) {
    if (!open[start] || labels[start]) continue;
    count++;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = count;
    let size = 0;
    let border = false;
    while (head < tail) {
      const i = queue[head++];
      size++;
      const x = i % width;
      const y = (i - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) border = true;
      const neighbours = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1];
      for (const n of neighbours) {
        if (n >= 0 && open[n] && !labels[n]) { labels[n] = count; queue[tail++] = n; }
      }
    }
    sizes.push(size);
    touchesBorder.push(border);
  }
  return { labels, sizes, touchesBorder, count };
}

/** Chamfer (3-4) distance to the nearest blocked cell, in cells. */
function distanceToWalls(grid, blocked) {
  const { width, height } = grid;
  const big = 1e9;
  const d = new Float32Array(blocked.length);
  for (let i = 0; i < d.length; i++) d[i] = blocked[i] ? 0 : big;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 3);
      if (y > 0) v = Math.min(v, d[i - width] + 3);
      if (x > 0 && y > 0) v = Math.min(v, d[i - width - 1] + 4);
      if (x < width - 1 && y > 0) v = Math.min(v, d[i - width + 1] + 4);
      d[i] = v;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x < width - 1) v = Math.min(v, d[i + 1] + 3);
      if (y < height - 1) v = Math.min(v, d[i + width] + 3);
      if (x < width - 1 && y < height - 1) v = Math.min(v, d[i + width + 1] + 4);
      if (x > 0 && y < height - 1) v = Math.min(v, d[i + width - 1] + 4);
      d[i] = v;
    }
  }
  return d.map((v) => v / 3);
}

/** Run-length encoding of a byte array: [value, count, value, count, …]. */
function runLength(bytes) {
  const out = [];
  let value = bytes[0];
  let count = 0;
  for (const b of bytes) {
    if (b === value && count < 65535) { count++; continue; }
    out.push(value, count);
    value = b;
    count = 1;
  }
  out.push(value, count);
  return out;
}

// ---------------------------------------------------------------------------
// Data download
// ---------------------------------------------------------------------------

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'indoor-wayfinder-student-project/3.0' } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'indoor-wayfinder-student-project/3.0' } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

async function fetchLayer(layer) {
  return fetchJson(`${ARCGIS_SERVICE}/${layer}/query?where=1%3D1&outFields=*&outSR=4326&f=geojson`);
}

/** Minimal parser for the OSM API XML (nodes, ways and their tags). */
function parseOsm(xml) {
  const nodes = new Map();
  for (const match of xml.matchAll(/<node id="(\d+)"[^>]*?lat="([-\d.]+)" lon="([-\d.]+)"/g)) {
    nodes.set(match[1], [Number(match[3]), Number(match[2])]);
  }
  const ways = [];
  for (const match of xml.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
    const refs = [...match[2].matchAll(/<nd ref="(\d+)"/g)].map((m) => m[1]);
    const tags = {};
    for (const tag of match[2].matchAll(/<tag k="([^"]+)" v="([^"]*)"/g)) {
      tags[tag[1]] = tag[2].replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    }
    const points = refs.map((ref) => nodes.get(ref)).filter(Boolean);
    ways.push({ id: match[1], tags, points });
  }
  return ways;
}

// ---------------------------------------------------------------------------
// Floor processing
// ---------------------------------------------------------------------------

function collectParts(geojson) {
  const parts = {};
  for (const feature of geojson.features) {
    const type = feature.properties.type;
    const geometry = feature.geometry;
    if (!geometry) continue;
    const lines = geometry.type === 'MultiLineString' ? geometry.coordinates : [geometry.coordinates];
    for (const line of lines) {
      (parts[type] ||= []).push(line.map(([lon, lat]) => toLocal(lon, lat)));
    }
  }
  return parts;
}

const bboxOf = (points) => {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
};

function processFloor(grid, parts, passages = []) {
  const size = grid.width * grid.height;
  const rasterTypes = (types) => {
    const mask = new Uint8Array(size);
    for (const type of types) for (const part of parts[type] || []) rasterPolyline(grid, mask, part);
    return mask;
  };

  const walls = rasterTypes([TYPE.WALL, TYPE.FACADE, TYPE.COLUMN]);
  const doors = rasterTypes([TYPE.DOOR]);
  // Upper floors have no façade layer: their outline is the outer walls.
  const outline = rasterTypes([TYPE.WALL, TYPE.FACADE]);

  // Building footprint: close the outline, flood the outside from the border.
  const closeRadius = Math.round(1.5 / grid.res);
  const closed = dilate(grid, outline, closeRadius);
  const outside = label(grid, invert(closed));
  const footprintWide = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    footprintWide[i] = closed[i] || !outside.touchesBorder[outside.labels[i]] ? 1 : 0;
  }
  // Shrink back to the façade line (erosion = dilation of the complement).
  const footprint = invert(dilate(grid, invert(footprintWide), closeRadius));

  // A door symbol is several parts (leaf, swing arc, frame): group touching
  // parts into one door, then open the wall cells under each door.
  const doorClusters = label(grid, dilate(grid, doors, 1));
  const boxes = new Map();
  for (let i = 0; i < size; i++) {
    const cluster = doorClusters.labels[i];
    if (!cluster) continue;
    const x = i % grid.width;
    const y = (i - x) / grid.width;
    const box = boxes.get(cluster);
    if (!box) boxes.set(cluster, [x, y, x, y]);
    else {
      if (x < box[0]) box[0] = x; if (y < box[1]) box[1] = y;
      if (x > box[2]) box[2] = x; if (y > box[3]) box[3] = y;
    }
  }
  const maxSpan = Math.round(MAX_DOOR_SPAN / grid.res);
  const doorBoxes = [...boxes.values()].filter(([x0, y0, x1, y1]) => x1 - x0 <= maxSpan && y1 - y0 <= maxSpan);
  const opened = walls.slice();
  for (const [x0, y0, x1, y1] of doorBoxes) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) opened[grid.index(x, y)] = 0;
  }

  // Surveyed passages (corrections.json): carve a corridor of the given width.
  for (const passage of passages) {
    const line = new Uint8Array(size);
    rasterPolyline(grid, line, [passage.from, passage.to]);
    const wide = dilate(grid, line, Math.max(1, Math.round((passage.width || 1) / 2 / grid.res)));
    for (let i = 0; i < size; i++) if (wide[i]) opened[i] = 0;
  }

  return { walls, doors, footprint, opened, doorBoxes };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const corrections = await readFile(CORRECTIONS, 'utf8').then(JSON.parse).catch(() => ({ passages: [], names: {} }));
  console.log('Downloading SUP\'COM floor plans (ArcGIS Online, SUPCOM_TUN)…');
  const floorSources = [];
  for (const floor of FLOOR_LAYERS) {
    floorSources.push({ ...floor, parts: collectParts(await fetchLayer(floor.layer)) });
  }
  const labels = (await fetchLayer(LABEL_LAYER)).features.map((feature) => {
    const [x, y] = toLocal(...feature.geometry.coordinates);
    return {
      label: feature.properties.Label.trim(),
      minLevel: feature.properties.level_min ?? 0,
      maxLevel: feature.properties.level_max ?? 0,
      x,
      y
    };
  });

  console.log('Downloading campus surroundings (OpenStreetMap)…');
  const osmWays = parseOsm(await fetchText(`https://api.openstreetmap.org/api/0.6/map?bbox=${OSM_BBOX}`));

  // Shared grid for all floors
  const allPoints = floorSources.flatMap((floor) => Object.values(floor.parts).flat(2));
  const box = bboxOf(allPoints);
  const grid = new Grid(
    Math.floor(box.minX - GRID_MARGIN),
    Math.floor(box.minY - GRID_MARGIN),
    Math.ceil((box.maxX - box.minX + 2 * GRID_MARGIN) / GRID_RES),
    Math.ceil((box.maxY - box.minY + 2 * GRID_MARGIN) / GRID_RES),
    GRID_RES
  );
  console.log(`Grid ${grid.width} × ${grid.height} cells (${GRID_RES} m)`);

  const blocks = labels.filter((l) => /^BLOC\s+/i.test(l.label)).map((l) => ({
    id: l.label.replace(/^BLOC\s+/i, '').trim().toUpperCase(),
    name: l.label.replace(/^BLOC/i, 'Bloc'),
    x: l.x,
    y: l.y
  }));
  const nearestBlock = (x, y) => {
    let best = null;
    for (const block of blocks) {
      const distance = Math.hypot(block.x - x, block.y - y);
      if (!best || distance < best.distance) best = { block, distance };
    }
    return best && best.distance < 45 ? best.block.id : 'H';
  };

  const floors = [];
  const places = [];
  const connectors = [];
  const gridFloors = [];

  for (const source of floorSources) {
    const { level } = source;
    const passages = (corrections.passages || []).filter((p) => p.level === level);
    const { walls, doors, footprint, opened, doorBoxes } = processFloor(grid, source.parts, passages);
    const size = grid.width * grid.height;

    // Walkable cells: free after opening doorways; upper floors stay inside.
    const free = new Uint8Array(size);
    for (let i = 0; i < size; i++) free[i] = !opened[i] && (level === 0 || footprint[i]) ? 1 : 0;
    const components = label(grid, free);
    // Isolated pockets (lift shafts, ducts, wall cavities) are not walkable;
    // a lift then snaps to the landing in front of it.
    const minCells = Math.round(12 / (grid.res * grid.res));
    for (let i = 0; i < size; i++) if (free[i] && components.sizes[components.labels[i]] < minCells) free[i] = 0;

    // Walkability classes by clearance (keeps routes off the walls).
    const blocked = invert(free);
    const clearance = distanceToWalls(grid, blocked);
    const cells = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      if (!free[i]) continue;
      const metres = clearance[i] * grid.res;
      cells[i] = metres >= 0.75 ? 4 : metres >= 0.5 ? 3 : metres >= 0.25 ? 2 : 1;
      if (level === 0 && !footprint[i]) cells[i] = Math.min(cells[i], 3) + 4; // outdoor flag (+4)
    }
    gridFloors.push(runLength(cells));

    // Rooms: regions closed by walls AND door symbols, inside the building.
    const closedRooms = new Uint8Array(size);
    for (let i = 0; i < size; i++) closedRooms[i] = !walls[i] && !doors[i] && footprint[i] ? 1 : 0;
    const regions = label(grid, closedRooms);
    const regionDoors = new Map();
    doorBoxes.forEach(([x0, y0, x1, y1], doorIndex) => {
      const seen = new Set();
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const region = regions.labels[grid.index(x, y)];
        if (region) seen.add(region);
      }
      for (const region of seen) {
        if (!regionDoors.has(region)) regionDoors.set(region, new Set());
        regionDoors.get(region).add(doorIndex);
      }
    });

    // Interior point of each region: its cell farthest from the walls.
    const regionInfo = new Map();
    for (let i = 0; i < size; i++) {
      const region = regions.labels[i];
      if (!region) continue;
      let info = regionInfo.get(region);
      if (!info) { info = { sx: 0, sy: 0, n: 0, best: -1, bestClearance: -1, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }; regionInfo.set(region, info); }
      const [x, y] = grid.centre(i);
      info.sx += x; info.sy += y; info.n++;
      info.minX = Math.min(info.minX, x); info.maxX = Math.max(info.maxX, x);
      info.minY = Math.min(info.minY, y); info.maxY = Math.max(info.maxY, y);
      if (free[i] && clearance[i] > info.bestClearance) { info.bestClearance = clearance[i]; info.best = i; }
    }

    const floorRooms = [];
    for (const [region, info] of regionInfo) {
      const area = info.n * grid.res * grid.res;
      const doorCount = regionDoors.get(region)?.size || 0;
      if (area < MIN_ROOM_AREA || area > MAX_ROOM_AREA || doorCount === 0 || doorCount > MAX_ROOM_DOORS) continue;
      if (info.best < 0) continue; // not reachable
      const [tx, ty] = grid.centre(info.best);
      floorRooms.push({
        region,
        level,
        area: Math.round(area),
        cx: info.sx / info.n,
        cy: info.sy / info.n,
        x: tx,
        y: ty,
        bbox: [info.minX, info.minY, info.maxX, info.maxY].map(cm),
        block: nearestBlock(info.sx / info.n, info.sy / info.n)
      });
    }

    // Stable numbering: per block, clockwise from north around the block centre.
    const byBlock = new Map();
    for (const room of floorRooms) {
      if (!byBlock.has(room.block)) byBlock.set(room.block, []);
      byBlock.get(room.block).push(room);
    }
    for (const [blockId, rooms] of byBlock) {
      const centre = blocks.find((b) => b.id === blockId) || { x: 0, y: 0 };
      rooms.sort((a, b) => {
        const angle = (r) => (Math.atan2(r.cx - centre.x, r.cy - centre.y) + 2 * Math.PI) % (2 * Math.PI);
        return angle(a) - angle(b);
      });
      rooms.forEach((room, index) => {
        room.id = `${blockId}${level}-${String(index + 1).padStart(2, '0')}`;
      });
    }

    // Named places from the SUP'COM labels
    const regionAt = (x, y) => {
      const cx = grid.cx(x); const cy = grid.cy(y);
      return grid.inside(cx, cy) ? regions.labels[grid.index(cx, cy)] : 0;
    };
    const nearestFree = (x, y, maxMetres = 6) => {
      const cx0 = grid.cx(x); const cy0 = grid.cy(y);
      const r = Math.round(maxMetres / grid.res);
      let best = -1; let bestScore = Infinity;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const cx = cx0 + dx; const cy = cy0 + dy;
        if (!grid.inside(cx, cy)) continue;
        const i = grid.index(cx, cy);
        if (!free[i]) continue;
        const score = dx * dx + dy * dy - clearance[i] * 2;
        if (score < bestScore) { bestScore = score; best = i; }
      }
      return best < 0 ? null : grid.centre(best);
    };

    for (const l of labels) {
      if (level < l.minLevel || level > l.maxLevel) continue;
      if (/^BLOC\s+/i.test(l.label)) continue;
      const kind = /^escalier/i.test(l.label) ? 'stairs' : /^ascenseur/i.test(l.label) ? 'lift' : 'place';
      if (kind !== 'place') continue;
      const region = regionAt(l.x, l.y);
      const room = floorRooms.find((r) => r.region === region);
      const name = l.label.replace(/^Acceuil$/i, 'Accueil');
      if (room) {
        room.name = name;
        room.official = true;
        continue;
      }
      const target = nearestFree(l.x, l.y);
      if (!target) continue;
      places.push({
        id: slug(name),
        name,
        kind: 'place',
        level,
        x: cm(target[0]),
        y: cm(target[1]),
        block: nearestBlock(l.x, l.y),
        official: true
      });
    }

    for (const room of floorRooms) {
      places.push({
        id: room.official ? slug(room.name) : room.id,
        code: room.id,
        name: room.name || `Local ${room.id}`,
        kind: /amphi/i.test(room.name || '') ? 'amphi' : 'room',
        level,
        x: cm(room.x),
        y: cm(room.y),
        area: room.area,
        bbox: room.bbox,
        block: room.block,
        official: Boolean(room.official)
      });
    }

    // Geometry for the 3D view (simplified, centimetre precision)
    const geometry = {};
    const tolerances = { [TYPE.WALL]: 0.02, [TYPE.DOOR]: 0.05, [TYPE.STAIRS]: 0.03, [TYPE.LIFT]: 0.02, [TYPE.FACADE]: 0.03, [TYPE.COLUMN]: 0.03 };
    const keys = { [TYPE.WALL]: 'walls', [TYPE.DOOR]: 'doors', [TYPE.STAIRS]: 'stairs', [TYPE.LIFT]: 'lifts', [TYPE.FACADE]: 'facade', [TYPE.COLUMN]: 'columns' };
    for (const [type, list] of Object.entries(source.parts)) {
      const key = keys[type];
      if (!key) continue;
      geometry[key] = list
        .map((part) => simplify(part, tolerances[type]))
        .filter((part) => part.length > 1)
        .map((part) => part.flatMap(([x, y]) => [cm(x), cm(y)]));
    }

    floors.push({ level, name: source.name, short: source.short, elevation: level * FLOOR_HEIGHT, ...geometry });
    console.log(`  ${source.short}: ${floorRooms.length} rooms, ${places.filter((p) => p.level === level).length} places`);
  }

  // Stairs and lifts: one connector per label, snapped on every level it serves.
  const usedIds = new Map();
  for (const l of labels) {
    const kind = /^escalier/i.test(l.label) ? 'stairs' : /^ascenseur/i.test(l.label) ? 'lift' : null;
    if (!kind) continue;
    const block = nearestBlock(l.x, l.y);
    const base = `${kind === 'stairs' ? 'ESCALIER' : 'ASCENSEUR'}_${block}`;
    const n = (usedIds.get(base) || 0) + 1;
    usedIds.set(base, n);
    const blockName = block === 'H' ? 'Hall' : `Bloc ${block}`;
    connectors.push({
      id: `${base}${n > 1 ? n : ''}`,
      kind,
      name: `${kind === 'stairs' ? 'Escalier' : 'Ascenseur'} ${blockName}${n > 1 ? ` (${n})` : ''}`,
      block,
      x: cm(l.x),
      y: cm(l.y),
      levels: Array.from({ length: l.maxLevel - l.minLevel + 1 }, (_, i) => l.minLevel + i)
    });
  }
  // Surveyed room names (survey mode export, reviewed by the team)
  for (const [id, name] of Object.entries(corrections.names || {})) {
    const place = places.find((p) => p.id === id || p.code === id);
    if (place && name) { place.name = name; place.surveyed = true; }
  }

  for (const c of connectors) {
    if (c.levels.length < 2) continue;
    places.push({ id: c.id, name: c.name, kind: c.kind, level: 0, x: c.x, y: c.y, block: c.block, official: true, connector: c.id });
  }

  // Surroundings from OpenStreetMap
  const context = { buildings: [], areas: [], paths: [] };
  for (const way of osmWays) {
    if (way.points.length < 2) continue;
    const local = way.points.map(([lon, lat]) => toLocal(lon, lat)).map(([x, y]) => [cm(x), cm(y)]);
    if (Math.min(...local.map(([x, y]) => Math.hypot(x, y))) > 550) continue;
    const t = way.tags;
    if (t.building) {
      if (t.building === 'university' && /sup.?com/i.test(t.name || '')) continue; // drawn from the plans
      const levels = parseLevels(t['building:levels']);
      context.buildings.push({ name: t.name || null, levels, height: t.height ? Number(t.height) : levels * 3.2, polygon: local.flat(), osm: Number(way.id) });
    } else if (t.amenity === 'parking' || t.landuse || t.leisure) {
      context.areas.push({ kind: t.amenity || t.landuse || t.leisure, polygon: local.flat() });
    } else if (t.highway) {
      context.paths.push({ kind: t.highway, name: t.name || null, line: local.flat() });
    }
  }

  const campus = {
    version: 3,
    generated: new Date().toISOString().slice(0, 10),
    name: "SUP'COM — École Supérieure des Communications de Tunis",
    address: 'Cité Technologique des Communications, Route de Raoued Km 3.5, 2083 El Ghazala, Ariana',
    origin: ORIGIN,
    metresPerDegree: { lon: cm(KX), lat: KY },
    floorHeight: FLOOR_HEIGHT,
    sources: [
      { name: "SUP'COM — plans des étages et étiquettes (ArcGIS Online, SUPCOM_TUN, données de supnav.supcom.tn)", url: `${ARCGIS_SERVICE}` },
      { name: 'OpenStreetMap contributors — bâtiments et voies du campus (ODbL 1.0)', url: 'https://www.openstreetmap.org/copyright' }
    ],
    blocks: blocks.map((b) => ({ ...b, x: cm(b.x), y: cm(b.y) })),
    floors,
    grid: { res: GRID_RES, minX: grid.minX, minY: grid.minY, width: grid.width, height: grid.height, floors: gridFloors },
    connectors,
    places,
    context
  };

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(campus));
  console.log(`Wrote ${OUTPUT}: ${places.length} places, ${connectors.length} connectors, ${context.buildings.length} campus buildings`);
}

function parseLevels(value) {
  if (!value) return 2;
  const match = String(value).match(/(\d+)/);
  if (!match) return 2;
  return /^R\+/i.test(value) ? Number(match[1]) + 1 : Number(match[1]);
}

function slug(name) {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/Amphith[ée]?[aâ]?tre/i, 'AMPHI')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
