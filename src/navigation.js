/**
 * ==========================================================================
 * Module       : navigation.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-04
 * Modified     : 2026-11-12
 * Version      : 3.0.0 (SUP'COM campus – multi-floor routing)
 * Description  : Campus model and route finding for the real SUP'COM
 *                building (assets/campus/supcom.json).
 *                - CampusMap: places, floors, stair/lift connectors and the
 *                  walkable occupancy grid of every floor, plus conversions
 *                  between local metres and GPS coordinates.
 *                - CampusRouter: Dijkstra on the graph whose nodes are the
 *                  walkable cells of all floors (8-neighbour edges) and whose
 *                  vertical edges are stairs and lifts. Route strategies
 *                  (Strategy pattern) choose which connectors may be used.
 *                - Turn-by-turn steps with compass directions.
 * ==========================================================================
 */

/** Cost multiplier per walkable class (1 = touching a wall … 4 = ≥ 0.75 m). */
const CLEARANCE_COST = [Infinity, 2.6, 1.6, 1.15, 1];
const SQRT2 = Math.SQRT2;

/** Cardinal names for bearings (0° = north, clockwise). */
const CARDINALS = ['Nord', 'Nord-Est', 'Est', 'Sud-Est', 'Sud', 'Sud-Ouest', 'Ouest', 'Nord-Ouest'];

/**
 * bearingToCardinal
 * -----------------
 * @param {number} bearing – Degrees, 0 = north, clockwise.
 * @returns {string} French cardinal / intercardinal name.
 */
export function bearingToCardinal(bearing) {
  const normalised = ((bearing % 360) + 360) % 360;
  return CARDINALS[Math.round(normalised / 45) % 8];
}

/**
 * bearingOf
 * ---------
 * @returns {number} Bearing in degrees from (x0, y0) to (x1, y1); local
 *                   frame: x = east, y = north.
 */
export function bearingOf(x0, y0, x1, y1) {
  return ((Math.atan2(x1 - x0, y1 - y0) * 180) / Math.PI + 360) % 360;
}

// ===========================================================================
// Strategy Pattern – which vertical connectors a route may use
// ===========================================================================

/**
 * RouteStrategy (base class)
 * --------------------------
 * A strategy prices the vertical edges (stairs, lifts) of the graph.
 * Returning Infinity removes the edge.
 */
class RouteStrategy {
  /** @returns {string} Human-readable name. */
  get label() { return 'Itinéraire'; }

  /**
   * connectorCost
   * -------------
   * @param {{kind:string}} connector – Stair or lift.
   * @param {number} levels – Number of floors climbed or descended.
   * @returns {number} Cost in metres-equivalent.
   */
  connectorCost(connector, levels) {
    throw new Error('RouteStrategy.connectorCost() must be overridden');
  }
}

/**
 * ShortestPathStrategy
 * --------------------
 * Shortest walk: stairs ≈ 7 m per floor, lifts ≈ 15 m wait + 3 m per floor.
 */
class ShortestPathStrategy extends RouteStrategy {
  get label() { return 'Plus court chemin'; }
  connectorCost(connector, levels) {
    return connector.kind === 'stairs' ? 7 * levels : 15 + 3 * levels;
  }
}

/**
 * AvoidStairsStrategy
 * -------------------
 * Accessible route: lifts only (wheelchair, luggage, injury).
 */
class AvoidStairsStrategy extends RouteStrategy {
  get label() { return 'Sans escaliers (ascenseurs)'; }
  connectorCost(connector, levels) {
    return connector.kind === 'stairs' ? Infinity : 15 + 3 * levels;
  }
}

// ===========================================================================
// Binary min-heap on typed arrays (Dijkstra priority queue)
// ===========================================================================

class MinHeap {
  constructor(capacity) {
    this.keys = new Float64Array(capacity);
    this.values = new Int32Array(capacity);
    this.size = 0;
  }
  push(key, value) {
    if (this.size === this.keys.length) this.#grow();
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.keys[i] = this.keys[parent];
      this.values[i] = this.values[parent];
      i = parent;
    }
    this.keys[i] = key;
    this.values[i] = value;
  }
  pop() {
    const top = this.values[0];
    const last = --this.size;
    const key = this.keys[last];
    const value = this.values[last];
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= last) break;
      if (child + 1 < last && this.keys[child + 1] < this.keys[child]) child++;
      if (this.keys[child] >= key) break;
      this.keys[i] = this.keys[child];
      this.values[i] = this.values[child];
      i = child;
    }
    this.keys[i] = key;
    this.values[i] = value;
    return top;
  }
  #grow() {
    const keys = new Float64Array(this.keys.length * 2);
    const values = new Int32Array(this.values.length * 2);
    keys.set(this.keys);
    values.set(this.values);
    this.keys = keys;
    this.values = values;
  }
}

// ===========================================================================
// CampusMap – data model
// ===========================================================================

export class CampusMap {
  /**
   * @param {Object} data – Parsed assets/campus/supcom.json.
   */
  constructor(data) {
    this.data = data;
    this.origin = data.origin;
    this.kx = data.metresPerDegree.lon;
    this.ky = data.metresPerDegree.lat;
    this.floors = data.floors;
    this.levels = data.floors.map((floor) => floor.level);
    this.floorHeight = data.floorHeight;
    this.blocks = data.blocks;
    this.connectors = data.connectors;

    const grid = data.grid;
    this.res = grid.res;
    this.minX = grid.minX;
    this.minY = grid.minY;
    this.width = grid.width;
    this.height = grid.height;
    this.cellsPerFloor = grid.width * grid.height;
    this.cells = grid.floors.map((runs) => decodeRuns(runs, this.cellsPerFloor));

    /** @type {Map<string, Object>} */
    this.places = new Map();
    for (const place of data.places) this.places.set(place.id, { ...place });
    for (const place of data.places) {
      if (place.code && place.code !== place.id) this.aliases.set(place.code, place.id);
    }
    // Short QR aliases
    this.aliases.set('ENTREE', 'ENTREE_PRINCIPALE');
    this.aliases.set('HALL', 'ACCUEIL');
  }

  /** @type {Map<string, string>} alternative QR payloads → place ids */
  aliases = new Map();

  /**
   * loadCampus
   * ----------
   * @param {string} url – JSON URL.
   * @returns {Promise<CampusMap>}
   */
  static async load(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Plan du campus introuvable (${response.status})`);
    return new CampusMap(await response.json());
  }

  /** @returns {Object|null} Place by id, room code or alias. */
  getPlace(id) {
    if (!id) return null;
    const key = String(id).trim().toUpperCase();
    return this.places.get(key) || this.places.get(this.aliases.get(key)) || null;
  }

  /** @returns {Object[]} All places. */
  getPlaces() {
    return [...this.places.values()];
  }

  /** @returns {Object|null} Floor by level. */
  getFloor(level) {
    return this.floors.find((floor) => floor.level === level) || null;
  }

  /**
   * renamePlace
   * -----------
   * Applies a surveyed room name (survey mode / committed names file).
   */
  renamePlace(id, name) {
    const place = this.getPlace(id);
    if (!place || !name) return false;
    if (place.originalName === undefined) {
      place.originalName = place.name;
      place.originalSurveyed = Boolean(place.surveyed);
    }
    place.name = name;
    place.surveyed = true;
    return true;
  }

  /** Restores the names from the data file (before re-applying a survey). */
  resetSurveyNames() {
    for (const place of this.places.values()) {
      if (place.originalName === undefined) continue;
      place.name = place.originalName;
      place.surveyed = place.originalSurveyed;
    }
  }

  // ----- Coordinates ------------------------------------------------------

  /** @returns {[number, number]} Local metres (x east, y north). */
  toLocal(lat, lon) {
    return [(lon - this.origin.lon) * this.kx, (lat - this.origin.lat) * this.ky];
  }

  /** @returns {{lat:number, lon:number}} GPS coordinates of a local point. */
  toLatLon(x, y) {
    return { lat: this.origin.lat + y / this.ky, lon: this.origin.lon + x / this.kx };
  }

  /** @returns {boolean} True when the point lies on the routing grid. */
  isOnGrid(x, y) {
    const cx = Math.floor((x - this.minX) / this.res);
    const cy = Math.floor((y - this.minY) / this.res);
    return cx >= 0 && cy >= 0 && cx < this.width && cy < this.height;
  }

  // ----- Grid -------------------------------------------------------------

  cellIndex(x, y) {
    const cx = Math.floor((x - this.minX) / this.res);
    const cy = Math.floor((y - this.minY) / this.res);
    if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) return -1;
    return cy * this.width + cx;
  }

  cellCentre(index) {
    const cx = index % this.width;
    const cy = (index - cx) / this.width;
    return [this.minX + (cx + 0.5) * this.res, this.minY + (cy + 0.5) * this.res];
  }

  /** @returns {number} Walkable class 0–4 (0 = blocked). */
  walkClass(level, index) {
    const floorIndex = this.levels.indexOf(level);
    if (floorIndex < 0 || index < 0) return 0;
    const value = this.cells[floorIndex][index];
    return value > 4 ? value - 4 : value;
  }

  /** @returns {boolean} True for outdoor cells (ground floor around the building). */
  isOutdoor(level, index) {
    const floorIndex = this.levels.indexOf(level);
    return floorIndex >= 0 && this.cells[floorIndex][index] > 4;
  }

  /**
   * snap
   * ----
   * Nearest walkable cell to a point, preferring cells away from walls.
   *
   * @returns {number} Cell index or -1.
   */
  snap(level, x, y, maxMetres = 12) {
    const floorIndex = this.levels.indexOf(level);
    if (floorIndex < 0) return -1;
    const cells = this.cells[floorIndex];
    const cx0 = Math.floor((x - this.minX) / this.res);
    const cy0 = Math.floor((y - this.minY) / this.res);
    const radius = Math.round(maxMetres / this.res);
    let best = -1;
    let bestScore = Infinity;
    for (let r = 0; r <= radius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cx = cx0 + dx;
          const cy = cy0 + dy;
          if (cx < 0 || cy < 0 || cx >= this.width || cy >= this.height) continue;
          const index = cy * this.width + cx;
          const value = cells[index];
          if (!value) continue;
          const klass = value > 4 ? value - 4 : value;
          const score = Math.hypot(dx, dy) + (4 - klass) * 1.5;
          if (score < bestScore) { bestScore = score; best = index; }
        }
      }
      if (best >= 0 && r * 1 > bestScore) break;
    }
    return best;
  }
}

/** Decodes [value, count, value, count, …] runs into a Uint8Array. */
function decodeRuns(runs, length) {
  const cells = new Uint8Array(length);
  let offset = 0;
  for (let i = 0; i < runs.length; i += 2) {
    const value = runs[i];
    const count = runs[i + 1];
    if (value) cells.fill(value, offset, offset + count);
    offset += count;
  }
  return cells;
}

// ===========================================================================
// CampusRouter – Dijkstra over all floors
// ===========================================================================

export class CampusRouter {
  /**
   * @param {CampusMap} campus
   * @param {RouteStrategy} [strategy]
   */
  constructor(campus, strategy = new ShortestPathStrategy()) {
    this.campus = campus;
    this.strategy = strategy;
    this.useHeuristic = true;
    this.#prepareConnectors();
  }

  /** @param {RouteStrategy} strategy */
  setStrategy(strategy) {
    this.strategy = strategy;
  }

  /**
   * findRoute
   * ---------
   * @param {{level:number,x:number,y:number}|string} from – Place id or point.
   * @param {{level:number,x:number,y:number}|string} to – Place id or point.
   * @returns {Object} { found, distance, legs, steps, strategy }
   */
  findRoute(from, to) {
    const start = this.#resolve(from);
    const goal = this.#resolve(to);
    if (!start || !goal) return { found: false, reason: 'Point inconnu' };

    const campus = this.campus;
    const n = campus.cellsPerFloor;
    const floorCount = campus.levels.length;

    // A start inside a pocket with no doorway on the plan leaves from the
    // nearest connected point (same warning as for an unreachable goal).
    let startGap = 0;
    const startFloor = campus.levels.indexOf(start.level);
    if (!this.#mainNetwork()[startFloor * n + start.cell]) {
      const exit = this.#nearestMainCell(start.level, start.cell, 30);
      if (exit) { start.cell = exit.cell; startGap = exit.distance; }
    }
    const startNode = startFloor * n + start.cell;
    const goalNode = campus.levels.indexOf(goal.level) * n + goal.cell;
    if (startNode === goalNode) {
      return { found: true, distance: 0, legs: [], steps: [{ kind: 'arrive', text: 'Vous êtes déjà sur place.' }], strategy: this.strategy.label };
    }

    const total = n * floorCount;
    const cost = new Float32Array(total).fill(Infinity);
    const parent = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const heap = new MinHeap(1 << 16);
    const width = campus.width;
    const res = campus.res;
    const [gx, gy] = campus.cellCentre(goal.cell);
    const goalFloor = campus.levels.indexOf(goal.level);

    const heuristic = (node) => {
      if (!this.useHeuristic) return 0;
      const cell = node % n;
      const [x, y] = campus.cellCentre(cell);
      return Math.hypot(x - gx, y - gy);
    };

    cost[startNode] = 0;
    heap.push(heuristic(startNode), startNode);
    const offsets = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]
    ];

    let found = false;
    while (heap.size) {
      const node = heap.pop();
      if (closed[node]) continue;
      closed[node] = 1;
      if (node === goalNode) { found = true; break; }

      const floorIndex = Math.floor(node / n);
      const cell = node - floorIndex * n;
      const cells = campus.cells[floorIndex];
      const cx = cell % width;
      const cy = (cell - cx) / width;
      const base = cost[node];

      for (const [dx, dy, step] of offsets) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= campus.height) continue;
        const neighbour = ny * width + nx;
        const value = cells[neighbour];
        if (!value) continue;
        // A diagonal step needs one free side cell (narrow doorways are often
        // only diagonally open on a 25 cm grid)
        if (dx && dy && !cells[cy * width + nx] && !cells[ny * width + cx]) continue;
        const klass = value > 4 ? value - 4 : value;
        const next = floorIndex * n + neighbour;
        const candidate = base + step * res * CLEARANCE_COST[klass];
        if (candidate < cost[next]) {
          cost[next] = candidate;
          parent[next] = node;
          heap.push(candidate + heuristic(next), next);
        }
      }

      // Vertical edges (stairs / lifts)
      const links = this.verticalLinks.get(node);
      if (links) {
        for (const link of links) {
          const price = this.strategy.connectorCost(link.connector, link.levels);
          if (!Number.isFinite(price)) continue;
          const candidate = base + price;
          if (candidate < cost[link.to]) {
            cost[link.to] = candidate;
            parent[link.to] = node;
            heap.push(candidate + heuristic(link.to), link.to);
          }
        }
      }
    }

    // The plan may lack a doorway to the goal: stop at the closest point we
    // can reach on the goal's floor and say so, instead of failing silently.
    let endNode = goalNode;
    let gap = 0;
    if (!found) {
      let best = -1;
      let bestDistance = Infinity;
      const offset = goalFloor * n;
      for (let cell = 0; cell < n; cell++) {
        if (!closed[offset + cell]) continue;
        const [x, y] = campus.cellCentre(cell);
        const distance = Math.hypot(x - gx, y - gy);
        if (distance < bestDistance) { bestDistance = distance; best = offset + cell; }
      }
      if (best < 0 || bestDistance > 30) {
        return { found: false, reason: 'Aucun itinéraire trouvé avec cette stratégie', strategy: this.strategy.label };
      }
      endNode = best;
      gap = bestDistance;
    }

    // Walk back the path and split it into per-floor legs
    const nodes = [];
    for (let node = endNode; node >= 0; node = parent[node]) nodes.push(node);
    nodes.reverse();

    let legs = [];
    let current = null;
    for (const node of nodes) {
      const floorIndex = Math.floor(node / n);
      const level = campus.levels[floorIndex];
      if (!current || current.level !== level) {
        if (current) {
          const connector = this.#connectorAt(nodes, node, n);
          current.exit = connector;
        }
        current = { level, cells: [] };
        legs.push(current);
      }
      current.cells.push(node % n);
    }

    // Climbing several floors with the same stairs is one step, not one per floor
    const merged = [];
    for (const leg of legs) {
      const previous = merged[merged.length - 1];
      if (previous && previous.exit && leg.exit && leg.cells.length <= 2 && previous.exit.id === leg.exit.id) {
        previous.exit = { ...leg.exit };
        continue;
      }
      merged.push(leg);
    }
    legs = merged;

    for (const leg of legs) {
      leg.points = this.#smooth(leg.level, leg.cells);
      leg.length = polylineLength(leg.points);
      delete leg.cells;
    }

    const walking = legs.reduce((sum, leg) => sum + leg.length, 0);
    const steps = buildSteps(legs, start, goal, campus);
    if (gap > 0) {
      steps.splice(steps.length - 1, 0, {
        kind: 'warning',
        text: `Accès à confirmer : aucune porte vers ce local sur le plan (il reste ≈ ${Math.round(gap)} m).`,
        level: goal.level
      });
    }
    if (startGap > 0) {
      steps.splice(1, 0, {
        kind: 'warning',
        text: `Accès à confirmer : aucune porte de sortie sur le plan, départ du point relié le plus proche (≈ ${Math.round(startGap)} m).`,
        level: start.level
      });
    }
    return {
      found: true,
      approximate: gap > 0 || startGap > 0,
      gap: Math.max(gap, startGap),
      distance: walking,
      cost: cost[endNode],
      legs,
      steps,
      from: start,
      to: goal,
      strategy: this.strategy.label
    };
  }

  /**
   * distancesFrom
   * -------------
   * Single-source Dijkstra (no heuristic) from one endpoint to every place,
   * so the destination list can show walking distances in one pass.
   *
   * @param {Object|string} from – Place id or {level, x, y}.
   * @returns {Map<string, number>} Place id → walking cost in metres.
   */
  distancesFrom(from) {
    const start = this.#resolve(from);
    const result = new Map();
    if (!start) return result;
    const campus = this.campus;
    const n = campus.cellsPerFloor;
    const total = n * campus.levels.length;
    const cost = new Float32Array(total).fill(Infinity);
    const closed = new Uint8Array(total);
    const heap = new MinHeap(1 << 16);
    const width = campus.width;
    const res = campus.res;
    const startNode = campus.levels.indexOf(start.level) * n + start.cell;
    cost[startNode] = 0;
    heap.push(0, startNode);
    const offsets = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2]];

    while (heap.size) {
      const node = heap.pop();
      if (closed[node]) continue;
      closed[node] = 1;
      const key = cost[node];
      const floorIndex = Math.floor(node / n);
      const cell = node - floorIndex * n;
      const cells = campus.cells[floorIndex];
      const cx = cell % width;
      const cy = (cell - cx) / width;
      for (const [dx, dy, step] of offsets) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= campus.height) continue;
        const neighbour = ny * width + nx;
        const value = cells[neighbour];
        if (!value) continue;
        if (dx && dy && !cells[cy * width + nx] && !cells[ny * width + cx]) continue;
        const klass = value > 4 ? value - 4 : value;
        const next = floorIndex * n + neighbour;
        const candidate = key + step * res * CLEARANCE_COST[klass];
        if (candidate < cost[next]) { cost[next] = candidate; heap.push(candidate, next); }
      }
      const links = this.verticalLinks.get(node);
      if (!links) continue;
      for (const link of links) {
        const price = this.strategy.connectorCost(link.connector, link.levels);
        if (!Number.isFinite(price)) continue;
        const candidate = key + price;
        if (candidate < cost[link.to]) { cost[link.to] = candidate; heap.push(candidate, link.to); }
      }
    }

    for (const place of campus.getPlaces()) {
      const cell = campus.snap(place.level, place.x, place.y);
      if (cell < 0) continue;
      const value = cost[campus.levels.indexOf(place.level) * n + cell];
      if (Number.isFinite(value)) result.set(place.id, value);
    }
    return result;
  }

  // ----- private ------------------------------------------------------------

  /**
   * Cells connected to the main entrance through doors, stairs and lifts
   * (all strategies' connectors). Computed once, on first use.
   *
   * @returns {Uint8Array}
   */
  #mainNetwork() {
    if (this.mainMask) return this.mainMask;
    const campus = this.campus;
    const n = campus.cellsPerFloor;
    const total = n * campus.levels.length;
    const mask = new Uint8Array(total);
    const entrance = campus.getPlace('ENTREE_PRINCIPALE') || campus.getPlaces()[0];
    const cell = campus.snap(entrance.level, entrance.x, entrance.y);
    if (cell < 0) { this.mainMask = mask.fill(1); return this.mainMask; }
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;
    const startNode = campus.levels.indexOf(entrance.level) * n + cell;
    queue[tail++] = startNode;
    mask[startNode] = 1;
    const width = campus.width;
    while (head < tail) {
      const node = queue[head++];
      const floorIndex = Math.floor(node / n);
      const c = node - floorIndex * n;
      const cells = campus.cells[floorIndex];
      const cx = c % width;
      const cy = (c - cx) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= campus.height) continue;
          const neighbour = ny * width + nx;
          if (!cells[neighbour]) continue;
          if (dx && dy && !cells[cy * width + nx] && !cells[ny * width + cx]) continue;
          const next = floorIndex * n + neighbour;
          if (!mask[next]) { mask[next] = 1; queue[tail++] = next; }
        }
      }
      for (const link of this.verticalLinks.get(node) || []) {
        if (!mask[link.to]) { mask[link.to] = 1; queue[tail++] = link.to; }
      }
    }
    this.mainMask = mask;
    return mask;
  }

  #nearestMainCell(level, cell, maxMetres) {
    const campus = this.campus;
    const n = campus.cellsPerFloor;
    const floorIndex = campus.levels.indexOf(level);
    const mask = this.#mainNetwork();
    const [x0, y0] = campus.cellCentre(cell);
    const radius = Math.round(maxMetres / campus.res);
    const cx0 = cell % campus.width;
    const cy0 = (cell - cx0) / campus.width;
    let best = null;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const cx = cx0 + dx;
        const cy = cy0 + dy;
        if (cx < 0 || cy < 0 || cx >= campus.width || cy >= campus.height) continue;
        const index = cy * campus.width + cx;
        if (!mask[floorIndex * n + index]) continue;
        const [x, y] = campus.cellCentre(index);
        const distance = Math.hypot(x - x0, y - y0);
        if (distance <= maxMetres && (!best || distance < best.distance)) best = { cell: index, distance };
      }
    }
    return best;
  }

  #resolve(endpoint) {
    const campus = this.campus;
    if (typeof endpoint === 'string') {
      const place = campus.getPlace(endpoint);
      if (!place) return null;
      const cell = campus.snap(place.level, place.x, place.y);
      return cell < 0 ? null : { level: place.level, cell, x: place.x, y: place.y, place };
    }
    if (endpoint && Number.isFinite(endpoint.x)) {
      const level = endpoint.level ?? 0;
      const cell = campus.snap(level, endpoint.x, endpoint.y, endpoint.maxSnap ?? 25);
      return cell < 0 ? null : { level, cell, x: endpoint.x, y: endpoint.y, place: null };
    }
    return null;
  }

  #prepareConnectors() {
    const campus = this.campus;
    const n = campus.cellsPerFloor;
    /** @type {Map<number, Array<{to:number, connector:Object, levels:number}>>} */
    this.verticalLinks = new Map();
    this.connectorNodes = new Map();
    for (const connector of campus.connectors) {
      const nodes = [];
      for (const level of connector.levels) {
        const floorIndex = campus.levels.indexOf(level);
        if (floorIndex < 0) continue;
        const cell = campus.snap(level, connector.x, connector.y, 5);
        if (cell < 0) continue;
        nodes.push({ level, node: floorIndex * n + cell });
      }
      this.connectorNodes.set(connector.id, nodes);
      for (const a of nodes) {
        for (const b of nodes) {
          if (a === b) continue;
          const levels = Math.abs(a.level - b.level);
          // Stairs go floor by floor; a lift serves every floor directly.
          if (connector.kind === 'stairs' && levels !== 1) continue;
          if (!this.verticalLinks.has(a.node)) this.verticalLinks.set(a.node, []);
          this.verticalLinks.get(a.node).push({ to: b.node, connector, levels });
        }
      }
    }
  }

  #connectorAt(nodes, arrivalNode, n) {
    const index = nodes.indexOf(arrivalNode);
    const departure = nodes[index - 1];
    for (const link of this.verticalLinks.get(departure) || []) {
      if (link.to === arrivalNode) {
        return {
          id: link.connector.id,
          kind: link.connector.kind,
          name: link.connector.name,
          toLevel: this.campus.levels[Math.floor(arrivalNode / n)]
        };
      }
    }
    return null;
  }

  /** String-pulling: keep a cell only when the straight line would leave clear space. */
  #smooth(level, cells) {
    const campus = this.campus;
    const points = cells.map((cell) => campus.cellCentre(cell));
    if (points.length <= 2) return points;
    const out = [points[0]];
    let anchor = 0;
    for (let i = 2; i < points.length; i++) {
      if (!this.#lineClear(level, points[anchor], points[i])) {
        out.push(points[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(points[points.length - 1]);
    return out;
  }

  #lineClear(level, [x0, y0], [x1, y1]) {
    const campus = this.campus;
    const distance = Math.hypot(x1 - x0, y1 - y0);
    const samples = Math.ceil(distance / (campus.res * 0.5));
    for (let s = 1; s < samples; s++) {
      const t = s / samples;
      const index = campus.cellIndex(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      if (campus.walkClass(level, index) < 2) return false;
    }
    return true;
  }
}

// ===========================================================================
// Turn-by-turn instructions
// ===========================================================================

function polylineLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return length;
}

const levelName = (level) => (level === 0 ? 'rez-de-chaussée' : `étage ${level}`);
const toLevel = (level) => (level === 0 ? 'au rez-de-chaussée' : `à l’étage ${level}`);

/**
 * buildSteps
 * ----------
 * Turns per-floor polylines into readable steps with compass bearings:
 * straight segments are merged when they change direction by < 30°.
 */
function buildSteps(legs, start, goal, campus) {
  const steps = [];
  const startName = start.place ? start.place.name : 'votre position';
  steps.push({ kind: 'start', text: `Départ : ${startName} (${levelName(start.level)})`, level: start.level });

  for (const leg of legs) {
    const segments = [];
    for (let i = 1; i < leg.points.length; i++) {
      const [x0, y0] = leg.points[i - 1];
      const [x1, y1] = leg.points[i];
      const length = Math.hypot(x1 - x0, y1 - y0);
      if (length < 0.5) continue;
      const bearing = bearingOf(x0, y0, x1, y1);
      const previous = segments[segments.length - 1];
      if (previous && angleBetween(previous.bearing, bearing) < 30) {
        previous.length += length;
        previous.end = [x1, y1];
        continue;
      }
      segments.push({ bearing, length, start: [x0, y0], end: [x1, y1] });
    }

    let previousBearing = null;
    for (const segment of segments) {
      const turn = previousBearing === null ? '' : `${describeTurn(previousBearing, segment.bearing)}, puis `;
      const text = `${turn ? turn[0].toUpperCase() + turn.slice(1) : 'M'}${turn ? 'm' : ''}archez ${Math.round(segment.length)} m vers le ${bearingToCardinal(segment.bearing)}`;
      steps.push({
        kind: 'walk',
        text,
        distance: segment.length,
        bearing: segment.bearing,
        level: leg.level,
        start: segment.start,
        end: segment.end
      });
      previousBearing = segment.bearing;
    }

    if (leg.exit) {
      const verb = leg.exit.kind === 'lift' ? 'Prenez l’ascenseur' : 'Prenez l’escalier';
      steps.push({
        kind: leg.exit.kind,
        text: `${verb} (${leg.exit.name}) jusqu’${toLevel(leg.exit.toLevel)}`,
        level: leg.level,
        toLevel: leg.exit.toLevel,
        connector: leg.exit.id
      });
    }
  }

  const goalName = goal.place ? goal.place.name : 'destination';
  steps.push({ kind: 'arrive', text: `Arrivée : ${goalName}`, level: goal.level });
  return steps;
}

function angleBetween(a, b) {
  const d = Math.abs(((b - a) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

function describeTurn(from, to) {
  const delta = (((to - from) % 360) + 540) % 360 - 180; // −180…180, + = right
  const magnitude = Math.abs(delta);
  if (magnitude < 30) return 'continuez tout droit';
  if (magnitude > 150) return 'faites demi-tour';
  const side = delta > 0 ? 'droite' : 'gauche';
  return magnitude < 60 ? `légèrement à ${side}` : `tournez à ${side}`;
}

export { RouteStrategy, ShortestPathStrategy, AvoidStairsStrategy };
