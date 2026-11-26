/**
 * ==========================================================================
 * Module       : exterior.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-26
 * Modified     : 2026-11-26
 * Version      : 3.7.1 (arch against the entrance wall)
 * Description  : Daylight exterior model of the SUP'COM main building for
 *                the "Campus" view, built from the real floor outlines in
 *                assets/campus/supcom.json (one prism per floor, so set-backs
 *                and the partial upper floors follow the SUP'COM plans).
 *                Architecture after the official SUP'COM 3D video
 *                (supcom.tn): white rendered towers with tall glazed
 *                curtains, ring of steel columns under a grey sloped crown,
 *                glazed entrance wing with a grey fascia carrying the
 *                SUP'COM sign, white parabolic arch over the entrance steps,
 *                flagpoles, paved forecourt, palms and trees.
 *                WebGPU only (rendered by view3d.js / WebGPURenderer).
 *                Local frame: x = east, y = north → world (x, height, −y).
 * ==========================================================================
 */

import * as THREE from 'three';
import {
  TILE,
  createTowerTexture,
  createWingTexture,
  createPavingTexture,
  createSignTexture,
  createTunisiaFlagTexture
} from './exterior-textures.js';

/** Daylight palette used by the view while the exterior is shown. */
export const DAYLIGHT = {
  background: 0xd3e3f1,
  fog: { color: 0xd8e4ee, near: 380, far: 1500 },
  ground: 0x9ba57a,
  areas: { parking: 0x7b7f84, green: 0x6f9a4a, land: 0xb9b294 },
  building: 0xd8d3c8,
  hemisphere: { sky: 0xe4f0ff, ground: 0x8d8a76, intensity: 1.15 },
  sky: { zenith: 0x4f86c6, horizon: 0xd6e6f3, below: 0xc9d3d6 }
};

/** Road ribbons drawn over the OSM ways (width in metres, colour). */
const ROADS = {
  residential: { width: 7, color: 0x6a6e74 },
  service: { width: 5, color: 0x74787d },
  footway: { width: 2.4, color: 0xd6cfbf },
  path: { width: 2, color: 0xcbbf9f }
};

const UP = [0, 1, 0];

/** Height of each flat ground layer (avoids depth fighting at a distance). */
const LAYER = { road: 0.06, apron: 0.1, forecourt: 0.12, lawn: 0.16 };

const COLOR = {
  roof: 0xb8b7b1,
  crown: 0x9c9fa3,
  fascia: 0x8d9195,
  column: 0xb7bcc2,
  arch: 0xf4f4f1,
  stone: 0xdcd8cf,
  lawn: 0x5f8b3d,
  trunk: 0x7a6248,
  palmLeaf: 0x4c7a36,
  pole: 0xd5d9dd
};

const TOWER_REFERENCE_RADIUS = 26;  // metres, sets the bay rhythm around a tower
const WING_AXIS_DISTANCE = 12;      // edges this close to the A–B axis are the glazed wing
const TOWER_CLEARANCE = 24;         // …and this far from every tower centre
const COVER_TEST = 2;               // metres inward to test whether a floor is covered
const CROWN = [[0.05, -1.5], [1.9, 0.45], [1.9, 1.05], [0, 1.05]];   // (offset, height above roof)
const FASCIA = [[0, -0.1], [0.35, -0.1], [0.35, 2.3], [0, 2.3]];
const COLUMN_OFFSET = 1.35;
const COLUMN_SPACING = 6.5;

/** Local plan point → world vector. */
const toWorld = (x, y, height = 0) => new THREE.Vector3(x, height, -y);

/** Deterministic pseudo-random numbers (the scene is identical on every load). */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// =============================================================================
// Plan geometry helpers
// =============================================================================

const toPoints = (flat) => {
  const points = [];
  for (let i = 0; i + 1 < flat.length; i += 2) points.push([flat[i], flat[i + 1]]);
  return points;
};

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const inPolygon = (polygon, x, y) => inRing(polygon.outer, x, y) && !polygon.holes.some((hole) => inRing(hole, x, y));

function distanceToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Per-ring edge data: outward normals (right of the travel direction — the
 * outline rings keep the building on their left) and mitred vertex normals.
 */
function ringFrame(ring) {
  const n = ring.length;
  const edges = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-6;
    edges.push({ a, b, length, dir: [(b[0] - a[0]) / length, (b[1] - a[1]) / length], normal: [(b[1] - a[1]) / length, -(b[0] - a[0]) / length] });
  }
  const miters = ring.map((_, i) => {
    const previous = edges[(i - 1 + n) % n].normal;
    const next = edges[i].normal;
    let mx = previous[0] + next[0];
    let my = previous[1] + next[1];
    const length = Math.hypot(mx, my);
    if (length < 1e-6) return next;
    mx /= length;
    my /= length;
    const scale = 1 / Math.max(0.4, mx * next[0] + my * next[1]);
    return [mx * scale, my * scale];
  });
  return { edges, miters };
}

/** Growing non-indexed triangle soup with normals and UVs. */
class Soup {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.uvs = [];
  }

  /** Quad a0-b0-b1-a1 (counter-clockwise seen from the front). */
  quad(a0, b0, b1, a1, normals = null, uvs = null) {
    this.positions.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1);
    if (normals) {
      const [na, nb] = normals;
      this.normals.push(...na, ...nb, ...nb, ...na, ...nb, ...na);
    }
    const [u0, v0, u1, v1] = uvs || [0, 0, 1, 1];
    this.uvs.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
  }

  geometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    if (this.normals.length === this.positions.length) {
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    } else {
      geometry.computeVertexNormals();
    }
    return geometry;
  }

  get empty() {
    return this.positions.length === 0;
  }
}

// =============================================================================
// Exterior model
// =============================================================================

export class CampusExterior {
  /**
   * @param {import('./navigation.js').CampusMap} campus – Campus model.
   */
  constructor(campus) {
    this.campus = campus;
    this.floorHeight = campus.floorHeight;
    this.group = new THREE.Group();
    this.group.name = 'campusExterior';
    this.group.visible = false;

    this.floors = campus.floors
      .filter((floor) => floor.outline && floor.outline.length)
      .sort((a, b) => a.level - b.level)
      .map((floor) => ({
        level: floor.level,
        polygons: floor.outline.map((polygon) => ({ outer: toPoints(polygon.outer), holes: polygon.holes.map(toPoints) }))
      }));

    this.blocks = campus.blocks || [];
    this.#locateEntrance();

    this.#buildFacades();
    this.#buildRoofs();
    this.#buildRoads();
    this.#buildForecourt();
    this.#buildArch();
    this.#buildFlags();
    this.#buildSign();
    this.#buildLandscape();
    this.#buildSky();
    this.#buildSun();

    this.group.traverse((child) => {
      if (child.isMesh && !child.userData.noShadow) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }

  /**
   * Camera framing for the Campus view: three-quarter view of the entrance.
   *
   * @returns {{centre: THREE.Vector3, radius: number, azimuth: number}}
   */
  get viewpoint() {
    const { x, y } = this.siteCentre;
    const front = this.front;
    return {
      centre: toWorld(x + front[0] * 14, y + front[1] * 14, 6),
      radius: this.siteRadius * 0.62,
      azimuth: Math.atan2(front[0], -front[1]) + 0.45
    };
  }

  // ---------------------------------------------------------------------------
  // Queries on the floor outlines
  // ---------------------------------------------------------------------------

  /** Highest floor whose outline contains (x, y), or −1. */
  #levelAt(x, y) {
    let top = -1;
    for (const floor of this.floors) {
      if (floor.polygons.some((polygon) => inPolygon(polygon, x, y))) top = floor.level;
    }
    return top;
  }

  /** Roof height at (x, y) (0 outside the building). */
  #roofAt(x, y) {
    const level = this.#levelAt(x, y);
    return level < 0 ? 0 : (level + 1) * this.floorHeight;
  }

  #floorCovers(level, x, y) {
    const floor = this.floors.find((f) => f.level === level);
    return Boolean(floor && floor.polygons.some((polygon) => inPolygon(polygon, x, y)));
  }

  /** Glazed entrance wing (between the two towers that frame the entrance) or tower. */
  #isWing(x, y) {
    if (!this.wingAxis) return false;
    return distanceToSegment(x, y, ...this.wingAxis) < WING_AXIS_DISTANCE
      && this.blocks.every((block) => Math.hypot(x - block.x, y - block.y) > TOWER_CLEARANCE);
  }

  #nearestBlock(x, y) {
    let best = null;
    let bestDistance = Infinity;
    for (const block of this.blocks) {
      const distance = Math.hypot(x - block.x, y - block.y);
      if (distance < bestDistance) { bestDistance = distance; best = block; }
    }
    return best;
  }

  /**
   * Entrance frame: the façade point F of the main entrance, the outward
   * direction `front` and the façade direction `along` (front rotated +90°).
   */
  #locateEntrance() {
    const ground = this.floors[0];
    const points = ground ? ground.polygons.flatMap((polygon) => polygon.outer) : [[0, 0]];
    const box = points.reduce((acc, [x, y]) => {
      acc.minX = Math.min(acc.minX, x); acc.maxX = Math.max(acc.maxX, x);
      acc.minY = Math.min(acc.minY, y); acc.maxY = Math.max(acc.maxY, y);
      return acc;
    }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const centre = this.blocks.length
      ? this.blocks.reduce((acc, b) => ({ x: acc.x + b.x / this.blocks.length, y: acc.y + b.y / this.blocks.length }), { x: 0, y: 0 })
      : { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    this.siteCentre = centre;
    this.siteRadius = Math.max(40, ...points.map(([x, y]) => Math.hypot(x - centre.x, y - centre.y)));

    const place = this.campus.getPlace('ENTREE') || { x: centre.x, y: centre.y + this.siteRadius };
    let fx = place.x - centre.x;
    let fy = place.y - centre.y;
    const length = Math.hypot(fx, fy) || 1;
    fx /= length;
    fy /= length;
    this.front = [fx, fy];

    // Façade point: march from outside toward the entrance until inside the RDC
    const facadeAlong = ([dx, dy]) => {
      for (let d = 40; d >= -10; d -= 0.25) {
        const x = place.x + dx * d;
        const y = place.y + dy * d;
        if (this.#levelAt(x, y) >= 0) return [x, y];
      }
      return [place.x, place.y];
    };
    this.facadePoint = facadeAlong(this.front);

    // Square the entrance frame on the real ground-floor façade there
    const edge = this.#facadeEdge(0, this.facadePoint, 8);
    if (edge) {
      this.front = edge.normal;
      this.facadePoint = facadeAlong(this.front);
    }
    this.along = [-this.front[1], this.front[0]];

    // Wing axis: the two towers closest to the entrance
    const towers = [...this.blocks].sort((a, b) =>
      Math.hypot(a.x - place.x, a.y - place.y) - Math.hypot(b.x - place.x, b.y - place.y));
    this.wingAxis = towers.length >= 2 ? [[towers[0].x, towers[0].y], [towers[1].x, towers[1].y]] : null;
  }

  /**
   * Length-weighted façade direction of a floor's outline near `point`
   * (edges facing roughly toward `this.front`), with the closest point on it.
   *
   * @returns {{normal: number[], point: number[]}|null}
   */
  #facadeEdge(level, [px, py], radius) {
    const floor = this.floors.find((f) => f.level === level);
    if (!floor) return null;
    let nx = 0;
    let ny = 0;
    let closest = null;
    let closestDistance = Infinity;
    for (const polygon of floor.polygons) {
      for (const edge of ringFrame(polygon.outer).edges) {
        if (edge.normal[0] * this.front[0] + edge.normal[1] * this.front[1] < 0.6) continue;
        const distance = distanceToSegment(px, py, edge.a, edge.b);
        if (distance > radius) continue;
        nx += edge.normal[0] * edge.length;
        ny += edge.normal[1] * edge.length;
        if (distance < closestDistance) {
          closestDistance = distance;
          const t = Math.max(0, Math.min(edge.length, (px - edge.a[0]) * edge.dir[0] + (py - edge.a[1]) * edge.dir[1]));
          closest = [edge.a[0] + edge.dir[0] * t, edge.a[1] + edge.dir[1] * t];
        }
      }
    }
    const length = Math.hypot(nx, ny);
    return length ? { normal: [nx / length, ny / length], point: closest } : null;
  }

  /** World position at (along, front, height) around the entrance façade point. */
  #entrancePoint(along, front, height = 0) {
    const [x, y] = this.facadePoint;
    return toWorld(x + this.along[0] * along + this.front[0] * front, y + this.along[1] * along + this.front[1] * front, height);
  }

  /** Yaw so that a local +z axis faces the entrance's outward direction. */
  get #entranceYaw() {
    return Math.atan2(this.front[0], -this.front[1]);
  }

  // ---------------------------------------------------------------------------
  // Building
  // ---------------------------------------------------------------------------

  /** Texture coordinate along the façade (metres / tile width). */
  #facadeU(edge, point, wing) {
    const [x, y] = point;
    if (wing && this.wingAxis) {
      const [[ax, ay], [bx, by]] = this.wingAxis;
      const length = Math.hypot(bx - ax, by - ay) || 1;
      const axis = [(bx - ax) / length, (by - ay) / length];
      if (Math.abs(edge.dir[0] * axis[0] + edge.dir[1] * axis[1]) > 0.5) {
        return ((x - ax) * axis[0] + (y - ay) * axis[1]) / TILE.wing.width;
      }
      return null;
    }
    const block = this.#nearestBlock(x, y);
    if (!block) return null;
    const radial = [x - block.x, y - block.y];
    const r = Math.hypot(...radial) || 1;
    const tangent = [-radial[1] / r, radial[0] / r];
    if (Math.abs(edge.dir[0] * tangent[0] + edge.dir[1] * tangent[1]) < 0.5) return null;
    const bays = Math.max(6, Math.round((2 * Math.PI * TOWER_REFERENCE_RADIUS) / TILE.tower.width));
    return (Math.atan2(radial[1], radial[0]) / (2 * Math.PI)) * bays;
  }

  #buildFacades() {
    const h = this.floorHeight;
    const tower = new Soup();
    const wing = new Soup();
    const crown = new Soup();
    const fascia = new Soup();
    const columns = [];

    for (const floor of this.floors) {
      const bottom = floor.level * h;
      const top = bottom + h;
      for (const polygon of floor.polygons) {
        for (const ring of [polygon.outer, ...polygon.holes]) {
          const { edges, miters } = ringFrame(ring);
          const n = edges.length;
          let columnCarry = COLUMN_SPACING / 2;

          edges.forEach((edge, i) => {
            const mid = [(edge.a[0] + edge.b[0]) / 2, (edge.a[1] + edge.b[1]) / 2];
            const isWing = this.#isWing(...mid);
            const soup = isWing ? wing : tower;
            const tile = isWing ? TILE.wing : TILE.tower;

            // ---- wall
            let ua = this.#facadeU(edge, edge.a, isWing);
            let ub = this.#facadeU(edge, edge.b, isWing);
            if (ua === null || ub === null) {
              ua = 0;
              ub = edge.length / tile.width;
            } else if (!isWing) {
              const bays = Math.max(6, Math.round((2 * Math.PI * TOWER_REFERENCE_RADIUS) / TILE.tower.width));
              if (ub - ua > bays / 2) ub -= bays;
              if (ua - ub > bays / 2) ub += bays;
            }
            const smooth = (vertex, other) => {
              const m = miters[vertex];
              const dot = m[0] * other.normal[0] + m[1] * other.normal[1];
              const k = Math.hypot(...m) || 1;
              return !isWing && dot / k > 0.85 ? [m[0] / k, 0, -m[1] / k] : [other.normal[0], 0, -other.normal[1]];
            };
            const na = smooth(i, edge);
            const nb = smooth((i + 1) % n, edge);
            soup.quad(
              [edge.a[0], bottom, -edge.a[1]], [edge.b[0], bottom, -edge.b[1]],
              [edge.b[0], top, -edge.b[1]], [edge.a[0], top, -edge.a[1]],
              [na, nb], [ua, 0, ub, 1]
            );

            // ---- roof edge: crown (towers) or fascia (wing) and the column ring
            const inner = [mid[0] - edge.normal[0] * COVER_TEST, mid[1] - edge.normal[1] * COVER_TEST];
            if (this.#floorCovers(floor.level + 1, ...inner)) {
              columnCarry = COLUMN_SPACING / 2;
              return;
            }
            const profile = isWing ? FASCIA : CROWN;
            const target = isWing ? fascia : crown;
            const offsetA = miters[i];
            const offsetB = miters[(i + 1) % n];
            for (let k = 0; k + 1 < profile.length; k++) {
              const [d0, z0] = profile[k];
              const [d1, z1] = profile[k + 1];
              const p = (point, offset, d, z) => [point[0] + offset[0] * d, top + z, -(point[1] + offset[1] * d)];
              target.quad(
                p(edge.a, offsetA, d0, z0), p(edge.b, offsetB, d0, z0),
                p(edge.b, offsetB, d1, z1), p(edge.a, offsetA, d1, z1)
              );
            }

            if (isWing || floor.level < 1) return;
            let s = columnCarry;
            for (; s < edge.length; s += COLUMN_SPACING) {
              const x = edge.a[0] + edge.dir[0] * s + edge.normal[0] * COLUMN_OFFSET;
              const y = edge.a[1] + edge.dir[1] * s + edge.normal[1] * COLUMN_OFFSET;
              const base = this.#roofAt(x, y);
              if (top - base < 3) continue;
              columns.push({ x, y, base, height: top + 0.5 - base });
            }
            columnCarry = s - edge.length;
          });
        }
      }
    }

    const towerMap = createTowerTexture();
    const wingMap = createWingTexture();
    const meshes = [
      [tower, new THREE.MeshStandardMaterial({ map: towerMap, roughness: 0.62, metalness: 0.04 })],
      [wing, new THREE.MeshStandardMaterial({ map: wingMap, roughness: 0.3, metalness: 0.25 })],
      [crown, new THREE.MeshStandardMaterial({ color: COLOR.crown, roughness: 0.7, side: THREE.DoubleSide })],
      [fascia, new THREE.MeshStandardMaterial({ color: COLOR.fascia, roughness: 0.6, side: THREE.DoubleSide })]
    ];
    for (const [soup, material] of meshes) {
      if (soup.empty) continue;
      this.group.add(new THREE.Mesh(soup.geometry(), material));
    }

    if (columns.length) {
      const geometry = new THREE.CylinderGeometry(0.26, 0.3, 1, 14).translate(0, 0.5, 0);
      const material = new THREE.MeshStandardMaterial({ color: COLOR.column, roughness: 0.35, metalness: 0.6 });
      const mesh = new THREE.InstancedMesh(geometry, material, columns.length);
      const matrix = new THREE.Matrix4();
      columns.forEach((column, index) => {
        matrix.makeScale(1, column.height, 1).setPosition(column.x, column.base, -column.y);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    }
  }

  /** Flat roof caps; lower caps are hidden under the floors above them. */
  #buildRoofs() {
    const material = new THREE.MeshStandardMaterial({ color: COLOR.roof, roughness: 0.9 });
    for (const floor of this.floors) {
      for (const polygon of floor.polygons) {
        const shape = new THREE.Shape(polygon.outer.map(([x, y]) => new THREE.Vector2(x, y)));
        for (const hole of polygon.holes) shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
        const geometry = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
        const roof = new THREE.Mesh(geometry, material);
        roof.position.y = (floor.level + 1) * this.floorHeight - 0.02;
        this.group.add(roof);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Ground: roads, forecourt, entrance
  // ---------------------------------------------------------------------------

  /** Campus roads and footways (OpenStreetMap ways) as flat ribbons. */
  #buildRoads() {
    const soups = new Map();
    for (const path of this.campus.data.context?.paths || []) {
      const style = ROADS[path.kind] || ROADS.service;
      const points = toPoints(path.line);
      if (points.length < 2) continue;
      if (!soups.has(style)) soups.set(style, new Soup());
      const soup = soups.get(style);
      // Open-polyline miter normals
      const normals = points.map((_, i) => {
        const a = points[Math.max(0, i - 1)];
        const b = points[Math.min(points.length - 1, i + 1)];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return [(b[1] - a[1]) / length, -(b[0] - a[0]) / length];
      });
      const half = style.width / 2;
      for (let i = 0; i + 1 < points.length; i++) {
        const side = (k, sign) => [points[k][0] + normals[k][0] * half * sign, LAYER.road, -(points[k][1] + normals[k][1] * half * sign)];
        soup.quad(side(i, 1), side(i + 1, 1), side(i + 1, -1), side(i, -1), [UP, UP]);
      }
    }
    for (const [style, soup] of soups) {
      const mesh = new THREE.Mesh(soup.geometry(), new THREE.MeshStandardMaterial({ color: style.color, roughness: 0.95, side: THREE.DoubleSide }));
      mesh.userData.noShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  #buildForecourt() {
    const paving = createPavingTexture();
    paving.repeat.set(1 / TILE.paving.width, 1 / TILE.paving.height);
    const pavingMaterial = new THREE.MeshStandardMaterial({ map: paving, roughness: 0.55, metalness: 0.05 });

    // Paved apron around the building (from the plans) …
    for (const flat of this.campus.data.exterior?.apron || []) {
      const shape = new THREE.Shape(toPoints(flat).map(([x, y]) => new THREE.Vector2(x, y)));
      const apron = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), pavingMaterial);
      apron.position.y = LAYER.apron;
      apron.castShadow = false;
      this.group.add(apron);
    }

    // … and the forecourt in front of the entrance
    const forecourt = new THREE.Shape([
      [-27, -2], [27, -2], [27, 30], [16, 40], [-16, 40], [-27, 30]
    ].map(([a, f]) => {
      const p = this.#entrancePoint(a, f);
      return new THREE.Vector2(p.x, -p.z);
    }));
    const court = new THREE.Mesh(new THREE.ShapeGeometry(forecourt).rotateX(-Math.PI / 2), pavingMaterial);
    court.position.y = LAYER.forecourt;
    this.group.add(court);

    // Entrance terrace and steps (local x = along the façade, z = outward)
    const stone = new THREE.MeshStandardMaterial({ color: COLOR.stone, roughness: 0.7 });
    const parts = [
      { width: 30, depth: 7, height: 0.45, front: 3.5 },
      { width: 31, depth: 0.45, height: 0.3, front: 7.2 },
      { width: 32, depth: 0.45, height: 0.15, front: 7.65 }
    ];
    for (const part of parts) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(part.width, part.height, part.depth), stone);
      step.position.copy(this.#entrancePoint(0, part.front, part.height / 2));
      step.rotation.y = this.#entranceYaw;
      this.group.add(step);
    }

    // Lawn beds on both sides of the forecourt
    const lawn = new THREE.MeshStandardMaterial({ color: COLOR.lawn, roughness: 1 });
    for (const side of [-1, 1]) {
      const bed = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), lawn);
      bed.scale.set(6, 1, 13);
      bed.position.copy(this.#entrancePoint(side * 21.5, 20, LAYER.lawn));
      bed.rotation.y = this.#entranceYaw;
      bed.userData.noShadow = true;
      bed.receiveShadow = true;
      this.group.add(bed);
    }
  }

  /**
   * Distance from the entrance façade point to the building along `front`,
   * measured at `along` metres along the façade (0 at the entrance; positive
   * when the wall stands further out there).
   */
  #wallOffset(along) {
    for (let front = 30; front >= -10; front -= 0.1) {
      const p = this.#entrancePoint(along, front);
      if (this.#levelAt(p.x, -p.z) >= 0) return front;
    }
    return 0;
  }

  /** White parabolic arch shell set against the front wall of the entrance wing. */
  #buildArch() {
    const span = 15;       // half span (m)
    const height = 9.2;
    const thickness = 1.15;
    const footWidth = 1.7;
    const depth = 4.2;
    const bevel = 0.12;
    const segments = 48;
    const outer = [];
    const inner = [];
    for (let i = 0; i <= segments; i++) {
      const t = -1 + (2 * i) / segments;
      outer.push(new THREE.Vector2(t * span, height * (1 - t * t)));
      const innerSpan = span - footWidth;
      inner.push(new THREE.Vector2(t * innerSpan, (height - thickness) * (1 - t * t)));
    }
    const shape = new THREE.Shape([...outer, ...inner.reverse()]);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: 1
    });
    geometry.translate(0, 0, -depth / 2);
    const arch = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: COLOR.arch, roughness: 0.45 }));
    // Back face against the wall: the most protruding façade point under the span
    let wall = -Infinity;
    for (let along = -span; along <= span; along += 0.5) wall = Math.max(wall, this.#wallOffset(along));
    arch.position.copy(this.#entrancePoint(0, wall + depth / 2 + bevel, 0));
    arch.rotation.y = this.#entranceYaw;
    this.group.add(arch);
  }

  /** Three flagpoles with the Tunisian flag, left of the arch. */
  #buildFlags() {
    const poleMaterial = new THREE.MeshStandardMaterial({ color: COLOR.pole, roughness: 0.3, metalness: 0.7 });
    const flagMaterial = new THREE.MeshStandardMaterial({ map: createTunisiaFlagTexture(), roughness: 0.8, side: THREE.DoubleSide });
    const flagGeometry = new THREE.PlaneGeometry(2.7, 1.8, 12, 1);
    const position = flagGeometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i) + 1.35;
      position.setX(i, x);
      position.setZ(i, Math.sin(x * 2.3) * 0.16 * (x / 2.7));
    }
    flagGeometry.computeVertexNormals();
    const poleHeight = 14.5;
    [-17.5, -20, -22.5].forEach((along, index) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, poleHeight, 10).translate(0, poleHeight / 2, 0), poleMaterial);
      // 3 m in front of the wall at that point (the façade is not straight)
      pole.position.copy(this.#entrancePoint(along, Math.max(this.#wallOffset(along), 0) + 3, 0));
      this.group.add(pole);
      const flag = new THREE.Mesh(flagGeometry, flagMaterial);
      flag.position.copy(pole.position).add(new THREE.Vector3(0, poleHeight - 1.05 - index * 0.25, 0));
      flag.rotation.y = this.#entranceYaw - Math.PI / 2 + 0.35;
      this.group.add(flag);
    });
  }

  /** "SUP'COM" sign on the fascia of the entrance wing. */
  #buildSign() {
    const [x, y] = this.facadePoint;
    const level = this.#levelAt(x - this.front[0] * 1.5, y - this.front[1] * 1.5);
    const roof = level < 0 ? this.floorHeight * 2 : (level + 1) * this.floorHeight;
    // Mount on the fascia of the top floor (it may be set back from the RDC)
    const edge = this.#facadeEdge(level, this.facadePoint, 12) || { normal: this.front, point: this.facadePoint };
    const offset = FASCIA[1][0] + 0.25; // stands off the fascia (it may curve slightly)
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(7.5, 2.2),
      new THREE.MeshStandardMaterial({ map: createSignTexture(), roughness: 0.5 })
    );
    sign.position.copy(toWorld(edge.point[0] + edge.normal[0] * offset, edge.point[1] + edge.normal[1] * offset, roof + 1.1));
    sign.rotation.y = Math.atan2(edge.normal[0], -edge.normal[1]);
    sign.userData.noShadow = true;
    this.group.add(sign);
  }

  // ---------------------------------------------------------------------------
  // Landscape
  // ---------------------------------------------------------------------------

  #buildLandscape() {
    const rand = random(2017);
    const palms = [];
    const trees = [];
    const lamps = [];

    // Palms lining the forecourt
    for (const front of [10, 17, 24, 31]) {
      for (const side of [-1, 1]) palms.push({ position: this.#entrancePoint(side * 21.5, front), height: 9 + rand() * 2.5 });
    }
    for (const front of [8, 22, 36]) {
      for (const side of [-1, 1]) lamps.push(this.#entrancePoint(side * 27.5, front));
    }

    // Trees and palms around the apron, outside the forecourt and buildings
    const osmBuildings = (this.campus.data.context?.buildings || []).map((b) => toPoints(b.polygon));
    const inForecourt = (x, y) => {
      const dx = x - this.facadePoint[0];
      const dy = y - this.facadePoint[1];
      const along = dx * this.along[0] + dy * this.along[1];
      const front = dx * this.front[0] + dy * this.front[1];
      return Math.abs(along) < 31 && front > -6 && front < 44;
    };
    for (const flat of this.campus.data.exterior?.apron || []) {
      const ring = toPoints(flat);
      const { edges } = ringFrame(ring);
      let carry = 0;
      let index = 0;
      for (const edge of edges) {
        let s = carry;
        for (; s < edge.length; s += 13) {
          const offset = 5 + rand() * 6;
          const x = edge.a[0] + edge.dir[0] * s + edge.normal[0] * offset;
          const y = edge.a[1] + edge.dir[1] * s + edge.normal[1] * offset;
          index++;
          if (inForecourt(x, y) || this.#levelAt(x, y) >= 0) continue;
          if (osmBuildings.some((polygon) => inRing(polygon, x, y))) continue;
          const position = toWorld(x, y, 0);
          if (index % 3 === 0) palms.push({ position, height: 8 + rand() * 3 });
          else trees.push({ position, height: 5 + rand() * 2.5 });
        }
        carry = s - edge.length;
      }
    }

    this.#addPalms(palms, rand);
    this.#addTrees(trees, rand);
    this.#addLamps(lamps);
  }

  #addPalms(palms, rand) {
    if (!palms.length) return;
    const trunkGeometry = new THREE.CylinderGeometry(0.2, 0.34, 1, 8).translate(0, 0.5, 0);
    const trunks = new THREE.InstancedMesh(trunkGeometry, new THREE.MeshStandardMaterial({ color: COLOR.trunk, roughness: 0.95 }), palms.length);
    const crowns = new THREE.InstancedMesh(palmCrownGeometry(), new THREE.MeshStandardMaterial({ color: COLOR.palmLeaf, roughness: 0.85, side: THREE.DoubleSide }), palms.length);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    palms.forEach((palm, index) => {
      matrix.makeScale(1, palm.height, 1).setPosition(palm.position);
      trunks.setMatrixAt(index, matrix);
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
      const size = 0.85 + rand() * 0.3;
      scale.set(size, size, size);
      matrix.compose(palm.position.clone().setY(palm.height), rotation, scale);
      crowns.setMatrixAt(index, matrix);
    });
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    this.group.add(trunks, crowns);
  }

  #addTrees(trees, rand) {
    if (!trees.length) return;
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.16, 0.24, 1, 6).translate(0, 0.5, 0),
      new THREE.MeshStandardMaterial({ color: COLOR.trunk, roughness: 0.95 }),
      trees.length
    );
    const foliage = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }),
      trees.length
    );
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();
    const greens = [0x4f7f3a, 0x5d8c41, 0x45703a, 0x6b9348];
    trees.forEach((tree, index) => {
      const trunkHeight = tree.height * 0.45;
      matrix.makeScale(1, trunkHeight, 1).setPosition(tree.position);
      trunks.setMatrixAt(index, matrix);
      const radius = tree.height * 0.38;
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
      scale.set(radius, radius * 1.1, radius);
      matrix.compose(tree.position.clone().setY(trunkHeight + radius * 0.8), rotation, scale);
      foliage.setMatrixAt(index, matrix);
      foliage.setColorAt(index, color.setHex(greens[index % greens.length]));
    });
    trunks.instanceMatrix.needsUpdate = true;
    foliage.instanceMatrix.needsUpdate = true;
    if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
    this.group.add(trunks, foliage);
  }

  #addLamps(lamps) {
    if (!lamps.length) return;
    const material = new THREE.MeshStandardMaterial({ color: 0x5b6470, roughness: 0.4, metalness: 0.6 });
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.1, 6, 8).translate(0, 3, 0), material, lamps.length);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.18, 0.5).translate(0, 6.05, 0), material, lamps.length);
    const matrix = new THREE.Matrix4();
    lamps.forEach((position, index) => {
      matrix.makeTranslation(position.x, position.y, position.z);
      poles.setMatrixAt(index, matrix);
      heads.setMatrixAt(index, matrix);
    });
    poles.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    this.group.add(poles, heads);
  }

  // ---------------------------------------------------------------------------
  // Sky and sun
  // ---------------------------------------------------------------------------

  /** Gradient sky dome that follows the camera. */
  #buildSky() {
    const radius = 1300;
    const geometry = new THREE.SphereGeometry(radius, 32, 16);
    const colors = [];
    const zenith = new THREE.Color(DAYLIGHT.sky.zenith);
    const horizon = new THREE.Color(DAYLIGHT.sky.horizon);
    const below = new THREE.Color(DAYLIGHT.sky.below);
    const color = new THREE.Color();
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const t = position.getY(i) / radius;
      if (t >= 0) color.copy(horizon).lerp(zenith, Math.pow(t, 0.55));
      else color.copy(horizon).lerp(below, Math.min(1, -t * 4));
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const sky = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false
    }));
    sky.name = 'sky';
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    sky.userData.noShadow = true;
    sky.onBeforeRender = (renderer, scene, camera) => sky.position.copy(camera.position);
    this.group.add(sky);
  }

  /** Afternoon sun from the west-north-west (lights the entrance façade). */
  #buildSun() {
    const { x, y } = this.siteCentre;
    const centre = toWorld(x, y, 0);
    const sun = new THREE.DirectionalLight(0xfff3df, 2.4);
    const azimuth = THREE.MathUtils.degToRad(295); // from the north, clockwise
    const elevation = THREE.MathUtils.degToRad(38);
    const direction = new THREE.Vector3(
      Math.sin(azimuth) * Math.cos(elevation),
      Math.sin(elevation),
      -Math.cos(azimuth) * Math.cos(elevation)
    );
    sun.position.copy(centre).addScaledVector(direction, 260);
    sun.target.position.copy(centre);
    sun.castShadow = true;
    const extent = this.siteRadius + 45;
    Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 20, far: 600 });
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.35;
    this.sun = sun;
    this.group.add(sun, sun.target);
  }
}

/** Palm crown: ten drooping fronds as tapered strips (merged, one draw call). */
function palmCrownGeometry() {
  const positions = [];
  const indices = [];
  const fronds = 10;
  const segments = 7;
  const length = 4.4;
  for (let f = 0; f < fronds; f++) {
    const angle = (f / fronds) * Math.PI * 2 + (f % 2) * 0.2;
    const lift = f % 2 ? 0.7 : 1.1;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const start = positions.length / 3;
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const r = t * length;
      const y = lift * Math.sin(Math.PI * t * 0.75) - 1.9 * t * t;
      const width = 0.62 * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.05));
      const px = cos * r;
      const pz = sin * r;
      positions.push(px - sin * width, y, pz + cos * width, px + sin * width, y, pz - cos * width);
      if (s < segments) {
        const i = start + s * 2;
        indices.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
