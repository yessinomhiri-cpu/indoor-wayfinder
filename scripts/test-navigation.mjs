/**
 * ==========================================================================
 * Module       : test-navigation.mjs
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-05
 * Modified     : 2026-11-12
 * Version      : 3.0.0 (SUP'COM campus)
 * Description  : Node tests for the SUP'COM campus model, the multi-floor
 *                Dijkstra router, the route strategies, the turn-by-turn
 *                steps and the compass maths. Run: node --test scripts/
 * ==========================================================================
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CampusMap,
  CampusRouter,
  ShortestPathStrategy,
  AvoidStairsStrategy,
  bearingOf,
  bearingToCardinal
} from '../src/navigation.js';
import { headingFromEuler, shortCardinal } from '../src/geo.js';

const data = JSON.parse(readFileSync(new URL('../assets/campus/supcom.json', import.meta.url), 'utf8'));
const campus = new CampusMap(data);
const router = new CampusRouter(campus);

const OFFICIAL = [
  'ENTREE_PRINCIPALE', 'ACCUEIL', 'BUREAU_D_ORDRE', 'BUVETTE',
  'AMPHI_KHAWAREZMI', 'AMPHI_IBN_EL_HAITHEM', 'AMPHI_IBN_KHALDOUN', 'AMPHI_IBN_ROCHD'
];

test('campus data: four floors, grid, connectors, official SUP\'COM places', () => {
  assert.deepEqual(campus.levels, [0, 1, 2, 3]);
  assert.equal(campus.cells.length, 4);
  for (const cells of campus.cells) assert.equal(cells.length, campus.width * campus.height);
  assert.ok(campus.connectors.some((c) => c.kind === 'lift' && c.levels.length === 4), 'a lift serves all floors');
  assert.ok(campus.connectors.some((c) => c.kind === 'stairs' && c.levels.includes(3)), 'stairs reach the 3rd floor');
  for (const id of OFFICIAL) assert.ok(campus.getPlace(id), `${id} exists`);
  for (const level of campus.levels) {
    assert.ok(campus.getPlaces().filter((p) => p.level === level && p.kind === 'room').length >= 20, `rooms on level ${level}`);
  }
});

test('amphitheatres are detected as large rooms (≈ 300 m²)', () => {
  for (const id of OFFICIAL.filter((id) => id.startsWith('AMPHI_'))) {
    const amphi = campus.getPlace(id);
    assert.equal(amphi.kind, 'amphi');
    assert.ok(amphi.area > 250 && amphi.area < 400, `${id} area ${amphi.area}`);
  }
});

test('QR aliases and room codes resolve to places', () => {
  assert.equal(campus.getPlace('ENTREE').id, 'ENTREE_PRINCIPALE');
  assert.equal(campus.getPlace('hall').id, 'ACCUEIL');
  const room = campus.getPlaces().find((p) => p.code && p.code !== p.id);
  assert.equal(campus.getPlace(room.code).id, room.id);
  assert.equal(campus.getPlace('UNKNOWN_PLACE'), null);
});

test('GPS conversions round-trip and the entrance is the origin', () => {
  const entrance = campus.getPlace('ENTREE_PRINCIPALE');
  assert.ok(Math.hypot(entrance.x, entrance.y) < 3);
  const { lat, lon } = campus.toLatLon(25, -40);
  const [x, y] = campus.toLocal(lat, lon);
  assert.ok(Math.abs(x - 25) < 1e-6 && Math.abs(y + 40) < 1e-6);
});

test('every official place is reachable from every other one', () => {
  for (const from of OFFICIAL) {
    for (const to of OFFICIAL) {
      if (from === to) continue;
      const route = router.findRoute(from, to);
      assert.ok(route.found, `${from} → ${to}`);
    }
  }
});

test('every place gets a route from the entrance (missing doorways are flagged)', () => {
  let approximate = 0;
  for (const place of campus.getPlaces()) {
    if (place.id === 'ENTREE_PRINCIPALE') continue;
    const route = router.findRoute('ENTREE_PRINCIPALE', place.id);
    assert.ok(route.found, place.id);
    if (route.approximate) {
      approximate++;
      assert.ok(route.steps.some((s) => s.kind === 'warning'), `${place.id} warns about the missing doorway`);
    }
  }
  assert.ok(approximate < campus.getPlaces().length * 0.15, `few approximate routes (${approximate})`);
});

test('a route to the 3rd floor uses a stair or lift and ends on level 3', () => {
  const target = campus.getPlaces().find((p) => p.level === 3 && p.kind === 'room');
  const route = router.findRoute('ENTREE_PRINCIPALE', target.id);
  assert.ok(route.found);
  assert.equal(route.legs[0].level, 0);
  assert.equal(route.legs[route.legs.length - 1].level, 3);
  assert.ok(route.steps.some((s) => s.kind === 'stairs' || s.kind === 'lift'));
  assert.ok(route.distance > 10 && route.distance < 400);
});

test('AvoidStairsStrategy never uses stairs', () => {
  const avoid = new CampusRouter(campus, new AvoidStairsStrategy());
  const target = campus.getPlaces().find((p) => p.level === 3 && p.kind === 'room');
  const route = avoid.findRoute('ENTREE_PRINCIPALE', target.id);
  assert.ok(route.found);
  assert.ok(route.steps.some((s) => s.kind === 'lift'));
  assert.ok(!route.steps.some((s) => s.kind === 'stairs'));
  assert.equal(new ShortestPathStrategy().connectorCost({ kind: 'stairs' }, 1), 7);
});

test('routes are symmetric enough and steps read in French with compass bearings', () => {
  const a = router.findRoute('AMPHI_KHAWAREZMI', 'AMPHI_IBN_KHALDOUN');
  const b = router.findRoute('AMPHI_IBN_KHALDOUN', 'AMPHI_KHAWAREZMI');
  assert.ok(Math.abs(a.distance - b.distance) / a.distance < 0.1);
  assert.match(a.steps[0].text, /^Départ : /);
  assert.match(a.steps[a.steps.length - 1].text, /^Arrivée : /);
  const walk = a.steps.find((s) => s.kind === 'walk');
  assert.match(walk.text, /archez \d+ m vers le (Nord|Sud|Est|Ouest)/);
});

test('single-source distances match point-to-point routes', () => {
  const distances = router.distancesFrom('ENTREE_PRINCIPALE');
  const route = router.findRoute('ENTREE_PRINCIPALE', 'AMPHI_KHAWAREZMI');
  assert.ok(Math.abs(distances.get('AMPHI_KHAWAREZMI') - route.cost) < 0.5);
});

test('same start and destination', () => {
  const route = router.findRoute('ACCUEIL', 'ACCUEIL');
  assert.ok(route.found);
  assert.equal(route.distance, 0);
});

test('bearings and cardinal names', () => {
  assert.equal(bearingOf(0, 0, 0, 10), 0);
  assert.equal(bearingOf(0, 0, 10, 0), 90);
  assert.equal(bearingToCardinal(225), 'Sud-Ouest');
  assert.equal(shortCardinal(359), 'N');
});

test('compass: heading of the back camera from DeviceOrientation angles', () => {
  // Phone upright (beta 90°), screen facing the user, camera facing north
  assert.ok(Math.abs(headingFromEuler(0, 90, 0)) < 1e-6 || Math.abs(headingFromEuler(0, 90, 0) - 360) < 1e-6);
  // Turning the phone so the camera faces east: alpha = 270°
  assert.ok(Math.abs(headingFromEuler(270, 90, 0) - 90) < 1e-6);
  // Flat phone: heading of the top edge of the screen
  assert.ok(Math.abs(headingFromEuler(90, 0, 0) - 270) < 1e-6);
});
