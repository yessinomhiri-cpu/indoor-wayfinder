/**
 * ==========================================================================
 * Module       : route-follower.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-18
 * Modified     : 2026-11-18
 * Version      : 3.4.0 (camera mode: compass + step counter)
 * Description  : Pure logic of the camera guidance mode (no ARCore needed):
 *                - StepDetector: counts steps from the accelerometer
 *                  (DeviceMotion), peak detection on the acceleration norm;
 *                - RouteFollower: pedestrian dead reckoning constrained to
 *                  the route. The QR scan gives the start; every step moves
 *                  the user along the route (forward when facing the route,
 *                  backward when facing away); the compass gives the
 *                  direction of the arrow relative to the phone.
 *                No DOM and no Three.js: tested in Node
 *                (scripts/test-camera-guide.mjs).
 * ==========================================================================
 */

import { bearingOf } from './navigation.js';
import { cumulativeLengths, pointAt } from './ar-guidance.js';

const DEG = Math.PI / 180;

/** Metres along the route the arrow aims at (same as the AR mode). */
const LOOKAHEAD = 4;
/** Distance to the destination considered "arrived". */
const ARRIVAL_DISTANCE = 2;
/** A step counts forward when the phone faces within this angle of the route. */
const FORWARD_ANGLE = 70;
/** A step counts backward beyond this angle. */
const BACKWARD_ANGLE = 110;

/**
 * wrapDeg
 * -------
 * @param {number} angle – Degrees.
 * @returns {number} Same angle in ]−180, 180].
 */
export function wrapDeg(angle) {
  let a = angle % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

// ===========================================================================
// Step detector
// ===========================================================================

/**
 * StepDetector
 * ------------
 * Feed it |accelerationIncludingGravity| (m/s²) at the DeviceMotion rate.
 * A slow average follows gravity, a fast one follows the body bounce; a step
 * is the bounce going above `threshold` then back under the average, at
 * least `minIntervalMs` after the previous step (max ≈ 3 steps / s).
 */
export class StepDetector {
  /**
   * @param {Object} [options]
   * @param {number} [options.threshold=1.2] – m/s² above the average.
   * @param {number} [options.minIntervalMs=320] – Shortest step period.
   */
  constructor({ threshold = 1.2, minIntervalMs = 320 } = {}) {
    this.threshold = threshold;
    this.minIntervalMs = minIntervalMs;
    this.reset();
  }

  reset() {
    this.baseline = null;
    this.fast = null;
    this.lastTime = null;
    this.lastStep = -Infinity;
    this.armed = false;
    this.count = 0;
  }

  /**
   * feed
   * ----
   * @param {number} magnitude – Acceleration norm (m/s²).
   * @param {number} time – ms.
   * @returns {boolean} True when this sample completes a step.
   */
  feed(magnitude, time) {
    if (!Number.isFinite(magnitude)) return false;
    if (this.baseline === null) {
      this.baseline = magnitude;
      this.fast = magnitude;
      this.lastTime = time;
      return false;
    }
    const dt = Math.max(1, Math.min(200, time - this.lastTime));
    this.lastTime = time;
    this.baseline += (magnitude - this.baseline) * (1 - Math.exp(-dt / 1000));
    this.fast += (magnitude - this.fast) * (1 - Math.exp(-dt / 50));
    const bounce = this.fast - this.baseline;

    if (!this.armed && bounce > this.threshold && time - this.lastStep >= this.minIntervalMs) {
      this.armed = true;
    } else if (this.armed && bounce < 0) {
      this.armed = false;
      this.lastStep = time;
      this.count++;
      return true;
    }
    return false;
  }
}

// ===========================================================================
// Route follower
// ===========================================================================

/**
 * RouteFollower
 * -------------
 * Position = a distance `s` along the current leg of the route.
 */
export class RouteFollower {
  /**
   * @param {Object} route – CampusRouter result (found, legs[]).
   * @param {Object} [options]
   * @param {number} [options.stepLength=0.7] – Metres per step.
   */
  constructor(route, { stepLength = 0.7 } = {}) {
    this.stepLength = stepLength;
    this.setRoute(route);
  }

  /** New route (QR rescan, reroute): back to its start. */
  setRoute(route) {
    this.route = route && route.found && route.legs && route.legs.length ? route : null;
    this.legIndex = 0;
    this.s = 0;
    this.steps = 0;
    this.arrived = false;
    if (this.route) this.route.legs.forEach((leg) => { leg.cumulative = cumulativeLengths(leg.points); });
  }

  get leg() {
    return this.route ? this.route.legs[this.legIndex] : null;
  }

  get legLength() {
    const leg = this.leg;
    return leg ? leg.cumulative[leg.cumulative.length - 1] : 0;
  }

  /** At the end of a leg that continues on another floor. */
  get awaitingFloorChange() {
    const leg = this.leg;
    return Boolean(leg && leg.exit && this.legIndex < this.route.legs.length - 1 && this.s >= this.legLength - 1);
  }

  /**
   * routeBearingAt
   * --------------
   * @returns {number|null} Bearing of the route segment at the position.
   */
  routeBearingAt() {
    const leg = this.leg;
    if (!leg || leg.points.length < 2) return null;
    const a = pointAt(leg.points, leg.cumulative, Math.min(this.s, Math.max(0, this.legLength - 0.3)));
    const b = pointAt(leg.points, leg.cumulative, Math.min(this.s + 1, this.legLength));
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.05) return null;
    return bearingOf(a[0], a[1], b[0], b[1]);
  }

  /**
   * step
   * ----
   * One detected step. Facing the route → forward; facing away → backward;
   * sideways (looking at a door, turning) → no move.
   *
   * @param {number|null} heading – Compass heading (deg) or null.
   * @returns {number} Metres moved along the route (+, − or 0).
   */
  step(heading) {
    if (!this.route || this.arrived) return 0;
    this.steps++;
    // On the stairs / in the lift: wait for "Je suis à l'étage N"
    if (this.awaitingFloorChange) return 0;
    const bearing = this.routeBearingAt();
    let move = this.stepLength;
    if (heading !== null && heading !== undefined && bearing !== null) {
      const diff = Math.abs(wrapDeg(heading - bearing));
      if (diff > BACKWARD_ANGLE) move = -this.stepLength;
      else if (diff > FORWARD_ANGLE) move = 0;
    }
    const before = this.s;
    this.s = Math.max(0, Math.min(this.legLength, this.s + move));
    const isLastLeg = this.legIndex === this.route.legs.length - 1;
    if (isLastLeg && this.legLength - this.s <= ARRIVAL_DISTANCE) this.arrived = true;
    return this.s - before;
  }

  /** Stairs / lift done: start the next leg (next floor). */
  nextLeg() {
    if (!this.route || this.legIndex >= this.route.legs.length - 1) return false;
    this.legIndex++;
    this.s = 0;
    return true;
  }

  /**
   * state
   * -----
   * @param {number|null} heading – Compass heading of the phone (deg).
   * @returns {Object|null} { position, targetBearing, relativeTurn, instruction,
   *   remaining, arrived, awaitingFloorChange, steps, legIndex }.
   */
  state(heading) {
    const leg = this.leg;
    if (!leg) return null;
    const length = this.legLength;
    const [x, y] = pointAt(leg.points, leg.cumulative, this.s);
    const target = pointAt(leg.points, leg.cumulative, Math.min(this.s + LOOKAHEAD, length));
    let targetBearing = Math.hypot(target[0] - x, target[1] - y) > 0.3
      ? bearingOf(x, y, target[0], target[1])
      : this.routeBearingAt();
    if (targetBearing === null) targetBearing = bearingOf(leg.points[0][0], leg.points[0][1], leg.points[leg.points.length - 1][0], leg.points[leg.points.length - 1][1]);

    let remaining = Math.max(0, length - this.s);
    for (let i = this.legIndex + 1; i < this.route.legs.length; i++) {
      remaining += this.route.legs[i].cumulative[this.route.legs[i].cumulative.length - 1];
    }

    const instruction = this.#instruction(leg, length);
    const hasHeading = heading !== null && heading !== undefined;
    const relativeTurn = hasHeading ? wrapDeg(targetBearing - heading) : 0;
    if (hasHeading && !this.arrived && !this.awaitingFloorChange) {
      if (Math.abs(relativeTurn) > 120) {
        instruction.kind = 'u-turn';
        instruction.text = `Faites demi-tour — ${lowerFirst(instruction.text)}`;
      } else if (Math.abs(relativeTurn) > 50) {
        instruction.kind = relativeTurn > 0 ? 'right' : 'left';
        instruction.text = `Tournez-vous vers la ${relativeTurn > 0 ? 'droite' : 'gauche'} — ${lowerFirst(instruction.text)}`;
      }
    }

    return {
      position: { level: leg.level, x, y },
      targetBearing,
      relativeTurn,
      instruction,
      remaining,
      arrived: this.arrived,
      awaitingFloorChange: this.awaitingFloorChange,
      nextLevel: this.awaitingFloorChange ? this.route.legs[this.legIndex + 1].level : null,
      steps: this.steps,
      legIndex: this.legIndex,
      progress: this.s,
      ahead: this.#ahead(leg, 25)
    };
  }

  /** Route points from the position to `distance` metres ahead (mini-map). */
  #ahead(leg, distance) {
    const end = Math.min(this.s + distance, this.legLength);
    const out = [pointAt(leg.points, leg.cumulative, this.s)];
    for (let i = 1; i < leg.points.length; i++) {
      if (leg.cumulative[i] > this.s && leg.cumulative[i] < end) out.push(leg.points[i]);
    }
    out.push(pointAt(leg.points, leg.cumulative, end));
    return out;
  }

  #instruction(leg, length) {
    if (this.arrived) return { kind: 'arrive', distance: 0, text: 'Vous êtes arrivé' };
    if (this.awaitingFloorChange) {
      const verb = leg.exit.kind === 'lift' ? 'Prenez l’ascenseur' : 'Prenez l’escalier';
      const level = this.route.legs[this.legIndex + 1].level;
      return { kind: leg.exit.kind, distance: 0, text: `${verb} jusqu’${level === 0 ? 'au rez-de-chaussée' : `à l’étage ${level}`}` };
    }
    // Next turn on this leg
    for (let i = 1; i < leg.points.length - 1; i++) {
      if (leg.cumulative[i] <= this.s + 0.5) continue;
      const a = bearingOf(leg.points[i - 1][0], leg.points[i - 1][1], leg.points[i][0], leg.points[i][1]);
      const b = bearingOf(leg.points[i][0], leg.points[i][1], leg.points[i + 1][0], leg.points[i + 1][1]);
      const delta = wrapDeg(b - a);
      if (Math.abs(delta) < 30) continue;
      const ahead = leg.cumulative[i] - this.s;
      const side = delta > 0 ? 'droite' : 'gauche';
      const label = Math.abs(delta) > 150 ? 'faites demi-tour' : Math.abs(delta) >= 60 ? `tournez à ${side}` : `légèrement à ${side}`;
      return {
        kind: Math.abs(delta) >= 60 ? (delta > 0 ? 'right' : 'left') : (delta > 0 ? 'slight-right' : 'slight-left'),
        distance: ahead,
        text: ahead > 25 ? `Tout droit sur ${Math.round(ahead)} m` : `Dans ${Math.max(1, Math.round(ahead))} m, ${label}`
      };
    }
    const ahead = length - this.s;
    if (leg.exit) {
      const verb = leg.exit.kind === 'lift' ? 'l’ascenseur' : 'l’escalier';
      return { kind: leg.exit.kind, distance: ahead, text: `Dans ${Math.max(1, Math.round(ahead))} m, ${verb}` };
    }
    return { kind: 'arrive', distance: ahead, text: `Destination dans ${Math.max(1, Math.round(ahead))} m` };
  }
}

function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** Exposed for tests. */
export const ROUTE_FOLLOWER = Object.freeze({ LOOKAHEAD, ARRIVAL_DISTANCE, FORWARD_ANGLE, BACKWARD_ANGLE, DEG });
