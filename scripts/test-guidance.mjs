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
import { ARGuidance, cumulativeLengths, pointAt } from '../src/ar-guidance.js';

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
