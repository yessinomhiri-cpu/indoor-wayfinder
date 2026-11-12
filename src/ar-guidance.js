/**
 * ==========================================================================
 * Module       : ar-guidance.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-12
 * Modified     : 2026-11-12
 * Version      : 3.1.0 (live AR guidance)
 * Description  : Real-time localization and turn-by-turn guidance during an
 *                immersive-ar session. Pure logic (no rendering):
 *                - Frame alignment: the QR scan fixes the start point; ARCore
 *                  (WebXR viewer pose) tracks every step and rotation; the
 *                  yaw between the AR world and true north starts from the
 *                  compass and is then corrected by MAP MATCHING: the walked
 *                  trajectory is fitted to the walkable cells of the SUP'COM
 *                  plan (one cannot walk through walls).
 *                - Floor tracking from the camera height (stairs) or a
 *                  confirmation after a lift.
 *                - Route following: projection on the route, next manoeuvre
 *                  ("Dans 6 m, tournez à gauche"), remaining distance,
 *                  off-route detection (→ reroute), arrival.
 *
 *                Conventions: campus x = east, y = north (metres); bearing
 *                0° = north, clockwise. AR (WebXR) yaw = atan2(f.x, −f.z) of
 *                the camera forward vector f. bearing = yaw + phi.
 * ==========================================================================
 */

import { bearingOf } from './navigation.js';

const DEG = Math.PI / 180;
const SAMPLE_SPACING = 0.35;   // m of walking between trajectory samples
const MAX_SAMPLES = 220;      // ≈ 75 m of trajectory
const FIT_INTERVAL = 600;      // ms
const FIT_MIN_TRAVEL = 1.5;    // m walked since the last fit
const OFF_ROUTE_DISTANCE = 3.2;
const OFF_ROUTE_TIME = 2500;   // ms
const ARRIVAL_DISTANCE = 2;
const LOOKAHEAD = 4;           // m along the route for the direction arrow
const ROUTE_WEIGHT = 0.2;      // soft route-shape prior (walls dominate)

const wrapDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const wrapRad = (r) => Math.atan2(Math.sin(r), Math.cos(r));

export class ARGuidance {
  /**
   * @param {import('./navigation.js').CampusMap} campus
   */
  constructor(campus) {
    this.campus = campus;
    this.route = null;
    this.reset();
  }

  reset() {
    this.started = false;
    this.phi = 0;             // rad: bearing = yawXR + phi
    this.delta = [0, 0];      // m: translation correction (east, north)
    this.start = null;        // campus start {level, x, y}
    this.startXR = null;      // AR camera position at start
    this.levelBase = 0;
    this.yBase = 0;
    this.level = 0;
    this.samples = [];
    this.lastSample = null;
    this.lastFitTime = 0;
    this.travelSinceFit = 0;
    this.travelled = 0;
    this.calibration = { source: 'none', confidence: 0, fits: 0 };
    this.compassPrior = null; // rad
    this.routeField = null;   // Float32Array distance to the route (current floor)
    this.legIndex = 0;
    this.offRouteSince = null;
    this.awaitingLift = null;
    this.arrived = false;
    this.lastState = null;
  }

  // ===========================================================================
  // Session start & calibration
  // ===========================================================================

  /**
   * begin
   * -----
   * @param {Object} options
   * @param {{level:number,x:number,y:number}} options.start – Scanned position.
   * @param {Object} options.route – CampusRouter result.
   * @param {{x:number,y:number,z:number}} options.startXR – AR camera position.
   * @param {number} options.yawXR – AR camera yaw (rad).
   * @param {number|null} options.heading – Compass heading (deg) or null.
   */
  begin({ start, route, startXR, yawXR, heading }) {
    this.reset();
    this.start = { ...start };
    this.level = start.level;
    this.levelBase = start.level;
    this.startXR = { ...startXR };
    this.yBase = startXR.y;
    this.setRoute(route);
    if (heading !== null && heading !== undefined) {
      this.phi = wrapRad(heading * DEG - yawXR);
      this.compassPrior = this.phi;
      this.calibration = { source: 'compass', confidence: 0.4, fits: 0 };
    } else {
      // No compass: assume the user faces the first route segment
      this.alignToRoute(yawXR);
    }
    this.started = true;
  }

  /** Replaces the route (rerouting) and restarts leg tracking. */
  setRoute(route) {
    this.route = route && route.found ? route : null;
    this.legIndex = 0;
    if (this.route) {
      const index = this.route.legs.findIndex((leg) => leg.level === this.level);
      this.legIndex = Math.max(0, index);
      this.route.legs.forEach((leg) => { leg.cumulative = cumulativeLengths(leg.points); });
    }
    this.routeEpoch = (this.routeEpoch || 0) + 1;
    this.#buildRouteField();
    this.offRouteSince = null;
    this.arrived = false;
  }

  /**
   * updateCompass
   * -------------
   * Keeps a compass prior for the map matching (circular smoothing).
   */
  updateCompass(heading, yawXR, reliable) {
    if (!this.started || heading === null || !reliable) return;
    const sample = wrapRad(heading * DEG - yawXR);
    this.compassPrior = this.compassPrior === null
      ? sample
      : wrapRad(this.compassPrior + 0.05 * wrapRad(sample - this.compassPrior));
    // Before any map-matching fit, follow the compass
    if (this.calibration.source === 'compass' && this.calibration.fits === 0) {
      this.phi = this.compassPrior;
    }
  }

  /**
   * alignToRoute
   * ------------
   * Manual calibration: the user faces the direction shown for the next
   * part of the route (mini-map) and taps "Aligner".
   */
  alignToRoute(yawXR) {
    const target = this.#currentTargetBearing();
    if (target === null) return false;
    this.phi = wrapRad(target * DEG - yawXR);
    this.samples = [];
    this.calibration = { source: 'manual', confidence: 0.7, fits: 0 };
    return true;
  }

  /**
   * snapTo
   * ------
   * "Je suis à …": the user confirms a known place; the translation is
   * corrected so the current AR position maps onto it.
   */
  snapTo(place, xr) {
    if (!place || !this.started) return;
    if (place.level !== this.level) {
      this.levelBase = place.level;
      this.yBase = xr.y;
      this.level = place.level;
    }
    const raw = this.#rawCampus(xr.x, xr.z, this.phi, [0, 0]);
    this.delta = [place.x - raw[0], place.y - raw[1]];
    this.samples = [];
    this.awaitingLift = null;
    this.calibration.confidence = Math.max(this.calibration.confidence, 0.8);
    if (this.route) this.setRoute(this.route);
  }

  /** After a lift ride, the user confirms having left the lift. */
  confirmLiftExit(xr) {
    if (!this.awaitingLift) return;
    const { connector, toLevel } = this.awaitingLift;
    this.snapTo({ level: toLevel, x: connector.x, y: connector.y }, xr);
    this.legIndex = Math.min(this.legIndex + 1, this.route.legs.length - 1);
  }

  // ===========================================================================
  // Per-frame update
  // ===========================================================================

  /**
   * update
   * ------
   * @param {{x:number,y:number,z:number}} xr – AR camera position.
   * @param {number} yawXR – AR camera yaw (rad).
   * @param {number} now – Timestamp (ms).
   * @returns {Object} Guidance state for the HUD and the AR visuals.
   */
  update(xr, yawXR, now) {
    if (!this.started) return null;

    this.lastXR = xr;
    this.#trackLevel(xr.y);
    this.#recordSample(xr);
    if (now - this.lastFitTime > FIT_INTERVAL && this.travelSinceFit > FIT_MIN_TRAVEL && this.samples.length >= 8) {
      this.#mapMatch();
      this.lastFitTime = now;
      this.travelSinceFit = 0;
    }

    const [x, y] = this.toCampus(xr.x, xr.z);
    const bearing = ((((yawXR + this.phi) / DEG) % 360) + 360) % 360;
    const state = {
      position: { level: this.level, x, y },
      bearing,
      calibration: { ...this.calibration, phi: this.phi / DEG },
      awaitingLift: this.awaitingLift ? { ...this.awaitingLift, connector: this.awaitingLift.connector.name } : null,
      arrived: false,
      offRoute: false,
      reroute: false
    };

    if (this.route) Object.assign(state, this.#follow(x, y, bearing, now));
    this.lastState = state;
    return state;
  }

  // ===========================================================================
  // Frame transforms
  // ===========================================================================

  /** AR (x, z) → campus (x east, y north) with the current alignment. */
  toCampus(xrX, xrZ) {
    return this.#rawCampus(xrX, xrZ, this.phi, this.delta);
  }

  /** Campus (x, y) → AR (x, z). */
  toXR(x, y) {
    const e = x - this.start.x - this.delta[0];
    const n = y - this.start.y - this.delta[1];
    const c = Math.cos(this.phi);
    const s = Math.sin(this.phi);
    return [this.startXR.x + e * c - n * s, this.startXR.z - e * s - n * c];
  }

  /** XR direction (unit x, z) of a campus bearing in degrees. */
  directionOfBearing(bearing) {
    const theta = bearing * DEG - this.phi;
    return [Math.sin(theta), -Math.cos(theta)];
  }

  #rawCampus(xrX, xrZ, phi, delta) {
    const dx = xrX - this.startXR.x;
    const dz = xrZ - this.startXR.z;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    return [
      this.start.x + delta[0] + (dx * c - dz * s),
      this.start.y + delta[1] - (dx * s + dz * c)
    ];
  }

  // ===========================================================================
  // Level tracking
  // ===========================================================================

  #trackLevel(y) {
    if (this.awaitingLift) return;
    const height = this.campus.floorHeight;
    const k = (y - this.yBase) / height;
    const rounded = Math.round(k);
    if (Math.abs(k - rounded) > 0.25) return; // between floors (on the stairs)
    const level = Math.max(Math.min(this.levelBase + rounded, Math.max(...this.campus.levels)), Math.min(...this.campus.levels));
    if (level !== this.level) {
      const previousLeg = this.#currentLeg();
      this.level = level;
      this.samples = [];
      if (this.route) {
        const next = this.route.legs.findIndex((leg, index) => index >= this.legIndex && leg.level === level);
        if (next >= 0) {
          this.legIndex = next;
          // The stairs / lift landing on this floor is known from the plan:
          // re-anchor the translation there (stairs also move horizontally).
          if (previousLeg && previousLeg.exit && previousLeg.exit.toLevel === level && this.lastXR) {
            const [lx, ly] = this.route.legs[next].points[0];
            const [cx, cy] = this.toCampus(this.lastXR.x, this.lastXR.z);
            if (Math.hypot(lx - cx, ly - cy) < 10) {
              this.delta = [this.delta[0] + lx - cx, this.delta[1] + ly - cy];
            }
          }
        }
      }
      this.#buildRouteField();
    }
  }

  // ===========================================================================
  // Map matching (fit the walked trajectory to the walkable cells)
  // ===========================================================================

  #recordSample(xr) {
    if (!this.lastSample) {
      this.lastSample = { x: xr.x, z: xr.z };
      this.samples.push({ x: xr.x, z: xr.z, level: this.level, onRoute: true, epoch: this.routeEpoch });
      return;
    }
    const step = Math.hypot(xr.x - this.lastSample.x, xr.z - this.lastSample.z);
    if (step < SAMPLE_SPACING) return;
    this.travelled += step;
    this.travelSinceFit += step;
    this.lastSample = { x: xr.x, z: xr.z };
    this.samples.push({ x: xr.x, z: xr.z, level: this.level, onRoute: this.#onRouteNow(), epoch: this.routeEpoch });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  /**
   * Score of an alignment: walls are a hard constraint (one cannot walk
   * through them), the route shape a soft one (people walk the corridors the
   * route follows). Higher is better.
   */
  #scoreCandidate(phi, delta) {
    const campus = this.campus;
    const field = this.routeField;
    let score = 0;
    for (const sample of this.samples) {
      if (sample.level !== this.level) continue;
      const [x, y] = this.#rawCampus(sample.x, sample.z, phi, delta);
      const index = campus.cellIndex(x, y);
      const klass = campus.walkClass(this.level, index);
      score += klass >= 2 ? 1 : klass === 1 ? 0.6 : -3;
      // Route shape only for stretches walked on the current route
      if (field && index >= 0 && sample.onRoute && sample.epoch === this.routeEpoch) score -= ROUTE_WEIGHT * field[index];
    }
    return score;
  }

  #mapMatch() {
    const locked = this.calibration.source === 'map' && this.calibration.confidence > 0.6;
    const span = (locked ? 12 : 30) * DEG;
    const angleStep = 1 * DEG;
    const offsetStep = 0.5;
    const offsetSteps = 2; // ±1 m: absorbs ARCore drift
    const prior = this.compassPrior;
    const results = [];

    for (let a = -span; a <= span + 1e-9; a += angleStep) {
      const phi = wrapRad(this.phi + a);
      // Weak compass prior: a tie-breaker only
      const compassCost = prior === null ? 0 : (Math.abs(wrapRad(phi - prior)) / DEG) * 0.05;
      let bestForPhi = { score: -Infinity, phi, delta: this.delta };
      for (let i = -offsetSteps; i <= offsetSteps; i++) {
        for (let j = -offsetSteps; j <= offsetSteps; j++) {
          const delta = [this.delta[0] + i * offsetStep, this.delta[1] + j * offsetStep];
          const score = this.#scoreCandidate(phi, delta) - compassCost - Math.hypot(i, j) * offsetStep * 0.8;
          if (score > bestForPhi.score) bestForPhi = { score, phi, delta };
        }
      }
      results.push(bestForPhi);
    }

    results.sort((p, q) => q.score - p.score);
    const best = results[0];
    // Sharpness: best vs the best alignment at least 6° away
    const rival = results.find((r) => Math.abs(wrapRad(r.phi - best.phi)) > 6 * DEG);
    const margin = rival ? best.score - rival.score : best.score;
    const current = this.#scoreCandidate(this.phi, this.delta);

    if (best.score - current > 0.3) {
      const k = margin > 3 ? 0.85 : 0.5;
      this.phi = wrapRad(this.phi + k * wrapRad(best.phi - this.phi));
      this.delta = [this.delta[0] + k * (best.delta[0] - this.delta[0]), this.delta[1] + k * (best.delta[1] - this.delta[1])];
      this.calibration.source = 'map';
    }
    this.calibration.fits++;
    const samples = this.samples.filter((s) => s.level === this.level).length || 1;
    this.calibration.confidence = Math.max(0.2, Math.min(0.95, 0.3 + margin / samples * 2 + Math.min(this.travelled, 40) / 160));
  }

  /**
   * Distance (m, capped at 5) from every cell of the current floor to the
   * route legs drawn on that floor (chamfer transform), for the route prior.
   */
  #buildRouteField() {
    this.routeField = null;
    if (!this.route) return;
    const campus = this.campus;
    const { width, height, res } = campus;
    const size = width * height;
    const field = new Float32Array(size).fill(1e9);
    let any = false;
    for (const leg of this.route.legs) {
      if (leg.level !== this.level) continue;
      for (let i = 1; i < leg.points.length; i++) {
        const [x0, y0] = leg.points[i - 1];
        const [x1, y1] = leg.points[i];
        const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (res * 0.5)));
        for (let s = 0; s <= steps; s++) {
          const index = campus.cellIndex(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps);
          if (index >= 0) { field[index] = 0; any = true; }
        }
      }
    }
    if (!any) return;
    const d1 = res;
    const d2 = res * Math.SQRT2;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        let v = field[i];
        if (x > 0) v = Math.min(v, field[i - 1] + d1);
        if (y > 0) v = Math.min(v, field[i - width] + d1);
        if (x > 0 && y > 0) v = Math.min(v, field[i - width - 1] + d2);
        if (x < width - 1 && y > 0) v = Math.min(v, field[i - width + 1] + d2);
        field[i] = v;
      }
    }
    for (let y = height - 1; y >= 0; y--) {
      for (let x = width - 1; x >= 0; x--) {
        const i = y * width + x;
        let v = field[i];
        if (x < width - 1) v = Math.min(v, field[i + 1] + d1);
        if (y < height - 1) v = Math.min(v, field[i + width] + d1);
        if (x < width - 1 && y < height - 1) v = Math.min(v, field[i + width + 1] + d2);
        if (x > 0 && y < height - 1) v = Math.min(v, field[i + width - 1] + d2);
        field[i] = Math.min(v, 5);
      }
    }
    this.routeField = field;
  }

  // ===========================================================================
  // Route following
  // ===========================================================================

  /** True while the last known position is close to the route. */
  #onRouteNow() {
    const state = this.lastState;
    return !state || state.lateral === undefined || state.lateral < 2;
  }

  #currentLeg() {
    if (!this.route) return null;
    return this.route.legs[this.legIndex] || null;
  }

  #currentTargetBearing() {
    const leg = this.#currentLeg();
    if (!leg || leg.points.length < 2) return null;
    const position = this.lastState ? this.lastState.position : this.start;
    const projection = projectOnPolyline(leg.points, leg.cumulative || cumulativeLengths(leg.points), position.x, position.y);
    const target = pointAt(leg.points, leg.cumulative || cumulativeLengths(leg.points), projection.s + LOOKAHEAD);
    if (Math.hypot(target[0] - position.x, target[1] - position.y) < 0.3) {
      const [x0, y0] = leg.points[0];
      const [x1, y1] = leg.points[1];
      return bearingOf(x0, y0, x1, y1);
    }
    return bearingOf(position.x, position.y, target[0], target[1]);
  }

  #follow(x, y, bearing, now) {
    const legs = this.route.legs;
    let leg = this.#currentLeg();
    if (!leg) return {};

    // If the user walked onto a later leg of the same floor, follow it
    if (leg.level !== this.level) {
      const next = legs.findIndex((l, i) => i >= this.legIndex && l.level === this.level);
      if (next >= 0) { this.legIndex = next; leg = legs[next]; }
    }

    const cumulative = leg.cumulative;
    const length = cumulative[cumulative.length - 1];
    const projection = projectOnPolyline(leg.points, cumulative, x, y);
    const target = pointAt(leg.points, cumulative, Math.min(projection.s + LOOKAHEAD, length));
    let targetBearing = bearingOf(x, y, target[0], target[1]);
    if (Math.hypot(target[0] - x, target[1] - y) < 0.5) {
      const last = leg.points.length - 1;
      targetBearing = bearingOf(leg.points[Math.max(0, last - 1)][0], leg.points[Math.max(0, last - 1)][1], leg.points[last][0], leg.points[last][1]);
    }

    // Remaining distance (this leg + following legs)
    let remaining = Math.max(0, length - projection.s);
    for (let i = this.legIndex + 1; i < legs.length; i++) {
      remaining += legs[i].cumulative[legs[i].cumulative.length - 1];
    }

    // Next manoeuvre on this leg
    const manoeuvre = nextManoeuvre(leg, projection.s);
    const isLastLeg = this.legIndex === legs.length - 1;
    let instruction;
    if (manoeuvre) {
      const ahead = manoeuvre.at - projection.s;
      instruction = {
        kind: manoeuvre.kind,
        distance: ahead,
        text: ahead > 25 ? `Tout droit sur ${Math.round(ahead)} m` : `Dans ${Math.max(1, Math.round(ahead))} m, ${manoeuvre.label}`
      };
    } else if (leg.exit) {
      const ahead = length - projection.s;
      const verb = leg.exit.kind === 'lift' ? 'prenez l’ascenseur' : 'prenez l’escalier';
      const where = leg.exit.toLevel === 0 ? 'au rez-de-chaussée' : `à l’étage ${leg.exit.toLevel}`;
      instruction = {
        kind: leg.exit.kind,
        distance: ahead,
        text: ahead > 3 ? `Dans ${Math.round(ahead)} m, ${verb} (${leg.exit.name}) ${where}` : `${verb[0].toUpperCase()}${verb.slice(1)} ${where} (${leg.exit.name})`
      };
      if (leg.exit.kind === 'lift' && ahead < 3 && !this.awaitingLift) {
        const connector = this.campus.connectors.find((c) => c.id === leg.exit.id);
        if (connector) this.awaitingLift = { connector, toLevel: leg.exit.toLevel };
      }
    } else {
      const ahead = length - projection.s;
      instruction = { kind: 'arrive', distance: ahead, text: ahead > ARRIVAL_DISTANCE ? `Destination dans ${Math.round(ahead)} m` : 'Vous êtes arrivé' };
    }

    // Facing away from the route: say so before any distance instruction
    const relativeTurn = wrapDeg(targetBearing - bearing);
    if (instruction.kind !== 'arrive' || instruction.distance > ARRIVAL_DISTANCE) {
      if (Math.abs(relativeTurn) > 120) {
        instruction = { ...instruction, kind: 'u-turn', text: `Faites demi-tour — ${instruction.text.charAt(0).toLowerCase()}${instruction.text.slice(1)}` };
      } else if (Math.abs(relativeTurn) > 50) {
        instruction = { ...instruction, kind: relativeTurn > 0 ? 'right' : 'left', text: `Tournez-vous vers la ${relativeTurn > 0 ? 'droite' : 'gauche'} — ${instruction.text.charAt(0).toLowerCase()}${instruction.text.slice(1)}` };
      }
    }

    // Off route / arrival
    let offRoute = false;
    let reroute = false;
    if (projection.distance > OFF_ROUTE_DISTANCE) {
      offRoute = true;
      if (this.offRouteSince === null) this.offRouteSince = now;
      if (now - this.offRouteSince > OFF_ROUTE_TIME) { reroute = true; this.offRouteSince = now; }
    } else {
      this.offRouteSince = null;
    }
    const arrived = isLastLeg && length - projection.s <= ARRIVAL_DISTANCE && projection.distance < OFF_ROUTE_DISTANCE;
    if (arrived) this.arrived = true;

    return {
      legIndex: this.legIndex,
      progress: projection.s,
      lateral: projection.distance,
      targetBearing,
      relativeTurn,
      instruction,
      remaining,
      offRoute,
      reroute,
      arrived: this.arrived,
      ahead: polylineAhead(leg.points, cumulative, projection.s, 25),
      manoeuvres: upcomingManoeuvres(leg, projection.s, 25)
    };
  }
}

// =============================================================================
// Polyline helpers
// =============================================================================

export function cumulativeLengths(points) {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    out.push(out[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  return out;
}

export function projectOnPolyline(points, cumulative, x, y) {
  let best = { s: 0, distance: Infinity, segment: 0 };
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const vx = x1 - x0;
    const vy = y1 - y0;
    const lengthSq = vx * vx + vy * vy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - x0) * vx + (y - y0) * vy) / lengthSq));
    const distance = Math.hypot(x - (x0 + vx * t), y - (y0 + vy * t));
    if (distance < best.distance) best = { s: cumulative[i - 1] + t * Math.sqrt(lengthSq), distance, segment: i - 1 };
  }
  if (points.length === 1) best = { s: 0, distance: Math.hypot(x - points[0][0], y - points[0][1]), segment: 0 };
  return best;
}

export function pointAt(points, cumulative, s) {
  if (points.length === 1) return points[0];
  for (let i = 1; i < points.length; i++) {
    if (s <= cumulative[i]) {
      const t = (s - cumulative[i - 1]) / ((cumulative[i] - cumulative[i - 1]) || 1);
      return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t];
    }
  }
  return points[points.length - 1];
}

/** Points of the polyline between s and s + distance (for drawing ahead). */
function polylineAhead(points, cumulative, s, distance) {
  const out = [pointAt(points, cumulative, s)];
  const end = s + distance;
  for (let i = 1; i < points.length; i++) {
    if (cumulative[i] > s && cumulative[i] < end) out.push(points[i]);
  }
  out.push(pointAt(points, cumulative, Math.min(end, cumulative[cumulative.length - 1])));
  return out;
}

function turnAt(points, i) {
  const a = bearingOf(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  const b = bearingOf(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
  return { delta: wrapDeg(b - a), bearing: b };
}

function describe(delta) {
  const m = Math.abs(delta);
  const side = delta > 0 ? 'droite' : 'gauche';
  if (m > 150) return { kind: 'u-turn', label: 'faites demi-tour' };
  if (m >= 60) return { kind: delta > 0 ? 'right' : 'left', label: `tournez à ${side}` };
  return { kind: delta > 0 ? 'slight-right' : 'slight-left', label: `légèrement à ${side}` };
}

function nextManoeuvre(leg, s) {
  const points = leg.points;
  for (let i = 1; i < points.length - 1; i++) {
    if (leg.cumulative[i] <= s + 0.5) continue;
    const { delta, bearing } = turnAt(points, i);
    if (Math.abs(delta) < 30) continue;
    return { at: leg.cumulative[i], point: points[i], bearing, ...describe(delta) };
  }
  return null;
}

function upcomingManoeuvres(leg, s, distance) {
  const out = [];
  const points = leg.points;
  for (let i = 1; i < points.length - 1; i++) {
    const at = leg.cumulative[i];
    if (at <= s || at > s + distance) continue;
    const { delta, bearing } = turnAt(points, i);
    if (Math.abs(delta) < 30) continue;
    out.push({ at, point: points[i], bearing, ...describe(delta) });
  }
  if (leg.exit) {
    const at = leg.cumulative[leg.cumulative.length - 1];
    if (at > s && at <= s + distance) out.push({ at, point: points[points.length - 1], kind: leg.exit.kind, label: leg.exit.name });
  }
  return out;
}
