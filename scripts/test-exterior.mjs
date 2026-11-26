/**
 * ==========================================================================
 * Module       : test-exterior.mjs
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-26
 * Modified     : 2026-11-26
 * Version      : 3.7.0
 * Description  : Node tests for the exterior data written by
 *                scripts/build-campus.mjs (floor outlines and forecourt)
 *                that src/exterior.js extrudes into the Campus view.
 * ==========================================================================
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const campus = JSON.parse(await readFile(new URL('../assets/campus/supcom.json', import.meta.url), 'utf8'));

const points = (flat) => {
  const list = [];
  for (let i = 0; i + 1 < flat.length; i += 2) list.push([flat[i], flat[i + 1]]);
  return list;
};

/** Shoelace area: positive = counter-clockwise (x east, y north). */
const signedArea = (ring) => ring.reduce((sum, [x0, y0], i) => {
  const [x1, y1] = ring[(i + 1) % ring.length];
  return sum + (x0 * y1 - x1 * y0) / 2;
}, 0);

const inRing = (ring, x, y) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

test('every floor has an outline: counter-clockwise outer rings, clockwise holes', () => {
  for (const floor of campus.floors) {
    assert.ok(Array.isArray(floor.outline) && floor.outline.length > 0, `floor ${floor.short} has no outline`);
    for (const polygon of floor.outline) {
      const outer = points(polygon.outer);
      assert.ok(outer.length >= 3);
      assert.ok(signedArea(outer) > 25, `floor ${floor.short}: outer ring must be CCW`);
      for (const hole of polygon.holes) assert.ok(signedArea(points(hole)) < 0, `floor ${floor.short}: hole must be CW`);
    }
  }
});

test('the ground-floor outline matches the building (blocks inside, plausible area)', () => {
  const ground = campus.floors.find((floor) => floor.level === 0);
  const rings = ground.outline.map((polygon) => points(polygon.outer));
  const area = rings.reduce((sum, ring) => sum + signedArea(ring), 0);
  assert.ok(area > 4000 && area < 14000, `RDC footprint ${Math.round(area)} m²`);
  for (const block of campus.blocks) {
    assert.ok(rings.some((ring) => inRing(ring, block.x, block.y)), `${block.name} outside the RDC outline`);
  }
});

const distanceToRing = (ring, x, y) => Math.min(...ring.map(([ax, ay], i) => {
  const [bx, by] = ring[(i + 1) % ring.length];
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}));

test('upper floors stay within the ground floor (no floating storeys)', () => {
  const ground = campus.floors.find((floor) => floor.level === 0).outline.map((polygon) => points(polygon.outer));
  // Shared façades lie on the RDC outline itself: 1 m tolerance
  const over = (x, y) => ground.some((g) => inRing(g, x, y) || distanceToRing(g, x, y) < 1);
  for (const floor of campus.floors.filter((f) => f.level > 0)) {
    for (const polygon of floor.outline) {
      const ring = points(polygon.outer);
      const inside = ring.filter(([x, y]) => over(x, y)).length;
      assert.ok(inside / ring.length > 0.9, `floor ${floor.short}: ${inside}/${ring.length} vertices over the RDC`);
    }
  }
});

test('the forecourt apron surrounds the building and the main entrance', () => {
  const apron = campus.exterior.apron.map(points);
  assert.equal(apron.length, 1);
  const entrance = campus.places.find((place) => place.id === 'ENTREE_PRINCIPALE');
  assert.ok(entrance);
  assert.ok(inRing(apron[0], entrance.x, entrance.y));
  for (const block of campus.blocks) assert.ok(inRing(apron[0], block.x, block.y));
});
