/**
 * ==========================================================================
 * Module       : test-guidance.mjs
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-12
 * Modified     : 2026-11-12
 * Version      : 3.1.0 (live AR guidance)
 * Description  : Simulated walks through the real SUP'COM plan. The "truth"
 *                is a route walked at a steady pace; the AR world is rotated
 *                by an unknown yaw (as ARCore's is) and the compass is biased.
 *                ARGuidance must recover the alignment from the walls and
 *                the route, keep the position within ~1 m, follow floors on
 *                the stairs, detect leaving the route and the arrival.
 * ==========================================================================
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CampusMap, CampusRouter } from '../src/navigation.js';
import { ARGuidance, cumulativeLengths, pointAt, FloorEstimator, FLOOR_SOURCE, fixedArrowPoint, GUIDE_MODE, guideArrowMode, smoothAngle } from '../src/ar-guidance.js';

const campus = new CampusMap(JSON.parse(readFileSync(new URL('../assets/campus/supcom.json', import.meta.url), 'utf8')));
const router = new CampusRouter(campus);
const DEG = Math.PI / 180;

/** World of the simulated phone: campus → AR with an unknown yaw. */
function arWorld(start, phi) {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  return (x, y) => {
    const e = x - start[0];
    const n = y - start[1];
    return [e * c - n * s, -e * s - n * c];
  };
}

/**
 * Walks a list of legs; returns error statistics and the last state.
 */
function walk(guidance, legs, { phi, compassError = 0, onState } = {}) {
  const toXR = arWorld(legs[0].points[0], phi);
  let t = 0;
  let y = 1.4;
  let sum = 0;
  let n = 0;
  let max = 0;
  let state = null;
  let started = false;
  const step = (x, yy, bearing, level) => {
    const [xx, zz] = toXR(x, yy);
    const yaw = bearing * DEG - phi;
    if (!started) {
      guidance.begin({
        start: { level: legs[0].level, x: legs[0].points[0][0], y: legs[0].points[0][1] },
        route: guidance.route || guidance.pendingRoute,
        startXR: { x: xx, y, z: zz },
        yawXR: yaw,
        heading: bearing + compassError
      });
      started = true;
    }
    t += 33;
    guidance.updateCompass(bearing + compassError, yaw, true);
    state = guidance.update({ x: xx, y, z: zz }, yaw, t);
    if (onState) onState(state);
    if (level !== null && state.position.level === level) {
      const error = Math.hypot(state.position.x - x, state.position.y - yy);
      sum += error;
      n++;
      max = Math.max(max, error);
    }
  };

  legs.forEach((leg, index) => {
    const points = leg.points;
    const cumulative = cumulativeLengths(points);
    const total = cumulative[cumulative.length - 1];
    for (let d = 0; d <= total + 1e-6; d += 0.04) {
      const p = pointAt(points, cumulative, d);
      const q = pointAt(points, cumulative, Math.min(d + 0.5, total));
      const bearing = (Math.atan2(q[0] - p[0], q[1] - p[1]) / DEG + 360) % 360;
      step(p[0], p[1], bearing, leg.level);
    }
    const next = legs[index + 1];
    if (next) {
      // Stairs: climb while moving from the bottom landing to the top one
      const a = points[points.length - 1];
      const b = next.points[0];
      const target = 1.4 + next.level * campus.floorHeight;
      const y0 = y;
      const count = Math.round(Math.abs(target - y0) / 0.04);
      for (let k = 1; k <= count; k++) {
        y = y0 + ((target - y0) * k) / count;
        step(a[0] + ((b[0] - a[0]) * k) / count, a[1] + ((b[1] - a[1]) * k) / count, 0, null);
      }
    }
  });
  return { mean: sum / n, max, state };
}

function routeGuidance(from, to) {
  const route = router.findRoute(from, to);
  const guidance = new ARGuidance(campus);
  guidance.pendingRoute = route;
  return { route, guidance };
}

for (const [from, to] of [
  ['ENTREE_PRINCIPALE', 'AMPHI_IBN_KHALDOUN'],
  ['ACCUEIL', 'BUREAU_D_ORDRE'],
  ['AMPHI_IBN_ROCHD', 'ESCALIER_C']
]) {
  for (const compassError of [0, 14, -15]) {
    test(`walk ${from} → ${to}, compass error ${compassError}°: position within ~1 m, arrival`, () => {
      const { route, guidance } = routeGuidance(from, to);
      const phi = 37 * DEG;
      const result = walk(guidance, route.legs, { phi, compassError });
      assert.ok(result.mean < 0.6, `mean error ${result.mean.toFixed(2)} m`);
      assert.ok(result.max < 1.6, `max error ${result.max.toFixed(2)} m`);
      assert.ok(Math.abs(guidance.phi - phi) / DEG < 3, `alignment ${(guidance.phi / DEG).toFixed(1)}° vs 37°`);
      assert.ok(result.state.arrived, 'arrival detected');
    });
  }
}

test('stairs: floor followed from the phone height, guidance continues upstairs', () => {
  const target = campus.getPlaces().find((p) => p.level === 3 && p.kind === 'room' && router.findRoute('ENTREE_PRINCIPALE', p.id).legs.length === 2);
  const { route, guidance } = routeGuidance('ENTREE_PRINCIPALE', target.id);
  const levels = new Set();
  const result = walk(guidance, route.legs, { phi: -25 * DEG, compassError: -12, onState: (s) => levels.add(s.position.level) });
  assert.ok(levels.has(0) && levels.has(3), `levels seen ${[...levels]}`);
  assert.equal(result.state.position.level, 3);
  assert.ok(result.mean < 0.8, `mean error ${result.mean.toFixed(2)} m`);
  assert.ok(result.state.arrived);
});

test('walking away from the route is detected and asks for a reroute', () => {
  const guided = router.findRoute('ENTREE_PRINCIPALE', 'AMPHI_KHAWAREZMI');
  const walked = router.findRoute('ENTREE_PRINCIPALE', 'AMPHI_IBN_KHALDOUN');
  const guidance = new ARGuidance(campus);
  guidance.pendingRoute = guided;
  let reroutes = 0;
  let turnedBack = false;
  walk(guidance, walked.legs.map((leg) => ({ ...leg, points: leg.points })), {
    phi: 70 * DEG,
    compassError: 6,
    onState: (state) => {
      if (state.reroute) {
        reroutes++;
        guidance.setRoute(router.findRoute(state.position, 'AMPHI_KHAWAREZMI'));
      }
      if (state.instruction && /demi-tour/.test(state.instruction.text)) turnedBack = true;
    }
  });
  assert.ok(reroutes >= 1, 'reroute requested');
  assert.ok(turnedBack, '"Faites demi-tour" shown when facing away');
});

test('frame transforms are inverse of each other', () => {
  const guidance = new ARGuidance(campus);
  guidance.begin({ start: { level: 0, x: 3, y: -4 }, route: null, startXR: { x: 1, y: 1.4, z: 2 }, yawXR: 0.3, heading: 100 });
  const [x, z] = guidance.toXR(12, 7);
  const [cx, cy] = guidance.toCampus(x, z);
  assert.ok(Math.abs(cx - 12) < 1e-9 && Math.abs(cy - 7) < 1e-9);
  // Facing the compass heading means bearing = heading
  const state = guidance.update({ x: 1, y: 1.4, z: 2 }, 0.3, 0);
  assert.ok(Math.abs(state.bearing - 100) < 1e-6);
});

// =============================================================================
// Floor fallback (risk "Hit Testing instable" → arrow at a fixed distance)
// =============================================================================

test('floor: ARCore hits give the median floor, outliers are ignored', () => {
  const floor = new FloorEstimator();
  const cameraY = 1.5;
  for (const y of [0.02, -0.01, 0.0, 0.01, 0.03]) assert.equal(floor.addHit(y, cameraY), true);
  assert.equal(floor.addHit(1.2, cameraY), false, 'a table top 0.3 m under the phone is not the floor');
  assert.equal(floor.addHit(-2.0, cameraY), false, 'a hit 3.5 m below is not the floor');
  const state = floor.update(cameraY, 0);
  assert.equal(state.source, FLOOR_SOURCE.DETECTED);
  assert.ok(Math.abs(state.y - 0.01) < 1e-9);
});

test('floor: no hit → searching, then estimated after 3 s (one change event)', () => {
  const floor = new FloorEstimator({ cameraHeight: 1.45, fallbackAfterMs: 3000 });
  let changes = 0;
  let state;
  for (let t = 0; t <= 4000; t += 16) {
    state = floor.update(1.45, t);
    if (state.changed) changes++;
    if (t < 3000) assert.equal(state.source, FLOOR_SOURCE.SEARCHING);
  }
  assert.equal(state.source, FLOOR_SOURCE.ESTIMATED);
  assert.equal(changes, 1);
  assert.ok(Math.abs(state.y) < 1e-6, 'floor 1.45 m under the phone');
});

test('floor: the estimate does not bob with the hand but follows the stairs', () => {
  const floor = new FloorEstimator({ cameraHeight: 1.45, smoothingMs: 1200 });
  let t = 0;
  for (; t < 5000; t += 16) floor.update(1.45, t);
  // Hand raises the phone 30 cm for 0.3 s
  let maxShift = 0;
  for (const end = t + 300; t < end; t += 16) maxShift = Math.max(maxShift, Math.abs(floor.update(1.75, t).y));
  assert.ok(maxShift < 0.08, `floor moved ${maxShift.toFixed(3)} m for a 30 cm hand movement`);
  // Up one flight of stairs (+3 m), then hold
  for (const end = t + 8000; t < end; t += 16) floor.update(4.45, t);
  assert.ok(Math.abs(floor.update(4.45, t).y - 3) < 0.02, 'floor followed to the next storey');
});

test('floor: a detected floor is dropped after a storey change, back to the estimate', () => {
  const floor = new FloorEstimator();
  for (let i = 0; i < 5; i++) floor.addHit(0, 1.45);
  assert.equal(floor.update(1.45, 0).source, FLOOR_SOURCE.DETECTED);
  let state;
  for (let t = 16; t < 10000; t += 16) state = floor.update(4.45, t);
  assert.equal(state.source, FLOOR_SOURCE.ESTIMATED);
  assert.ok(Math.abs(state.y - 3) < 0.05);
  floor.addHit(3.0, 4.45);
  assert.equal(floor.update(4.45, 10000).source, FLOOR_SOURCE.DETECTED, 'new floor hits take over again');
});

test('floor: reset starts a new search', () => {
  const floor = new FloorEstimator();
  for (let t = 0; t < 4000; t += 16) floor.update(1.45, t);
  floor.reset();
  assert.equal(floor.update(1.45, 50000).source, FLOOR_SOURCE.SEARCHING);
  assert.equal(floor.y, 0);
});

test('fixed-distance arrow: 1.5 m in front of the phone, on the floor', () => {
  const camera = { position: { x: 2, y: 1.45, z: -3 }, yaw: 0 }; // yaw 0 = facing −Z
  const ahead = fixedArrowPoint(camera, 1.5, 0);
  assert.deepEqual(ahead, { x: 2, y: 0, z: -4.5 });
  const right = fixedArrowPoint({ ...camera, yaw: Math.PI / 2 }, 1.5, 0.1); // facing +X
  assert.ok(Math.abs(right.x - 3.5) < 1e-9 && Math.abs(right.z + 3) < 1e-9 && right.y === 0.1);
  const p = fixedArrowPoint({ ...camera, yaw: 2.2 }, 1.5, 0);
  assert.ok(Math.abs(Math.hypot(p.x - 2, p.z + 3) - 1.5) < 1e-9, 'always 1.5 m horizontally');
});

// =============================================================================
// Floating guide arrow ("Live View" style)
// =============================================================================

test('guide arrow: grey while calibrating, blue, orange off route, green at arrival', () => {
  const base = { arrived: false, offRoute: false, calibration: { source: 'map', confidence: 0.8 } };
  assert.equal(guideArrowMode(base), GUIDE_MODE.GUIDE);
  assert.equal(guideArrowMode({ ...base, calibration: { source: 'compass', confidence: 0.4 } }), GUIDE_MODE.CALIBRATING);
  assert.equal(guideArrowMode({ ...base, calibration: { source: 'manual', confidence: 0.3 } }), GUIDE_MODE.GUIDE, '"Aligner" is trusted');
  assert.equal(guideArrowMode({ ...base, offRoute: true }), GUIDE_MODE.OFF_ROUTE);
  assert.equal(guideArrowMode({ ...base, arrived: true, offRoute: true }), GUIDE_MODE.ARRIVED);
  assert.equal(guideArrowMode({ arrived: false, offRoute: false }), GUIDE_MODE.CALIBRATING, 'no calibration yet');
});

test('guide arrow: smoothing turns the short way round and converges', () => {
  // From +170° to −170°: 20° through ±180°, not 340° the long way
  let angle = 170 * DEG;
  const next = smoothAngle(angle, -170 * DEG, 16, 180);
  assert.ok(next > 170 * DEG || next < -170 * DEG, `went the long way: ${(next / DEG).toFixed(1)}°`);
  for (let t = 0; t < 1500; t += 16) angle = smoothAngle(angle, -170 * DEG, 16, 180);
  assert.ok(Math.abs(angle - (-170 * DEG)) < 0.01);
  // No jump in one frame (no snapping)
  const oneFrame = smoothAngle(0, Math.PI / 2, 16, 180) / DEG;
  assert.ok(oneFrame > 3 && oneFrame < 12, `one 16 ms frame turned ${oneFrame.toFixed(1)}° towards a 90° target`);
  assert.ok(Math.abs(smoothAngle(0.3, 0.3, 16, 180) - 0.3) < 1e-12);
});

test('guide arrow points along the route during a real walk (unknown AR yaw, biased compass)', () => {
  const { route, guidance } = routeGuidance('ENTREE_PRINCIPALE', 'AMPHI_IBN_KHALDOUN');
  const leg = route.legs[0];
  const legCumulative = cumulativeLengths(leg.points);
  const phi = 40 * DEG;
  const toXR = arWorld(leg.points[0], phi);
  let checked = 0;
  let worst = 0;
  let blueAfter = null;
  walk(guidance, route.legs, {
    phi,
    compassError: 12,
    onState: (state) => {
      if (state.arrived || guideArrowMode(state) !== GUIDE_MODE.GUIDE) return;
      if (blueAfter === null) blueAfter = state.progress;
      // Arrow direction in the AR world, exactly as ar.js computes it
      const [dx, dz] = guidance.directionOfBearing(state.targetBearing);
      // Expected: from the TRUE position towards the route point 4 m ahead
      const truth = pointAt(leg.points, legCumulative, Math.min(state.progress, legCumulative[legCumulative.length - 1]));
      const ahead = pointAt(leg.points, legCumulative, Math.min(state.progress + 4, legCumulative[legCumulative.length - 1]));
      if (Math.hypot(ahead[0] - truth[0], ahead[1] - truth[1]) < 1.5) return; // last metres
      const [tx, tz] = toXR(truth[0], truth[1]);
      const [ax, az] = toXR(ahead[0], ahead[1]);
      const error = Math.abs(Math.atan2(dx * (az - tz) - dz * (ax - tx), dx * (ax - tx) + dz * (az - tz))) / DEG;
      worst = Math.max(worst, error);
      checked++;
    }
  });
  assert.ok(blueAfter !== null && blueAfter < 15, `arrow turned blue after ${blueAfter} m`);
  assert.ok(checked > 100, `only ${checked} samples`);
  assert.ok(worst < 25, `blue arrow off the route direction by up to ${worst.toFixed(1)}°`);
});
