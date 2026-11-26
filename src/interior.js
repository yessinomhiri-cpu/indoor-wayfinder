/**
 * ==========================================================================
 * Module       : interior.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-26
 * Modified     : 2026-11-26
 * Version      : 3.8.0 (daylight cut-away interior)
 * Description  : Daylight interior of each SUP'COM floor for the cut-away
 *                3D view, generated from assets/campus/supcom.json:
 *                floor slab with each room's floor tinted (rooms found by a
 *                flood fill of the routing grid inside their bounding box),
 *                walls cut at CUT_HEIGHT with a dark section line on top,
 *                door swings, stair treads, glass lift shafts and the four
 *                amphitheatres with tiers rising away from a stage, seat
 *                rows, a lectern and a board. The plans give no furniture:
 *                the amphitheatre seating is a plausible layout, not a survey.
 *                Floors are built on first display (fast start-up).
 *                WebGPU only. Local frame: x = east, y = north → world (x, h, −y).
 * ==========================================================================
 */

import * as THREE from 'three';
import { Soup, UP } from './mesh-soup.js';

/** Height at which walls (and the exterior) are cut in the cut-away view. */
export const CUT_HEIGHT = 2.2;

const SLAB = 0.15;            // interior floor level above the floor base (over the forecourt paving)
const WALL_CAP = 0.14;        // width of the dark section line on top of the walls

const COLOR = {
  corridor: 0xcdd0d2,
  rooms: [0xe9e1d2, 0xe3dac8, 0xeee7da, 0xe6dfd4],
  wall: 0xf4f3ef,
  section: 0x4b5563,
  door: 0x9c6b3e,
  tread: 0x9aa0a6,
  glass: 0x9cc7e6,
  tierTop: 0xb8946a,
  tierSide: 0x8d6b47,
  stage: 0x6b4f35,
  seat: 0x9b2c2c,
  board: 0xf8fafc,
  lectern: 0x5b4636
};

const AMPHI = {
  stageDepth: 3.5,   // flat stage nearest the tower centre (m)
  rowDepth: 0.9,     // depth of one tier (m)
  maxRise: 1.7,      // highest tier above the stage floor (m)
  seatSpacing: 0.56
};

const colorOf = (hex) => new THREE.Color(hex).toArray();

export class CampusInterior {
  /**
   * @param {import('./navigation.js').CampusMap} campus – Campus model.
   */
  constructor(campus) {
    this.campus = campus;
    this.group = new THREE.Group();
    this.group.name = 'campusInterior';
    /** @type {Map<number, THREE.Group>} level → built floor */
    this.levels = new Map();
    this.materials = {
      slab: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
      wall: new THREE.MeshStandardMaterial({ color: COLOR.wall, roughness: 0.8, side: THREE.DoubleSide }),
      section: new THREE.MeshStandardMaterial({ color: COLOR.section, roughness: 0.9, side: THREE.DoubleSide }),
      door: new THREE.LineBasicMaterial({ color: COLOR.door }),
      tread: new THREE.MeshStandardMaterial({ color: COLOR.tread, roughness: 0.8, side: THREE.DoubleSide }),
      glass: new THREE.MeshStandardMaterial({ color: COLOR.glass, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.35, depthWrite: false }),
      tier: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }),
      seat: new THREE.MeshStandardMaterial({ color: COLOR.seat, roughness: 0.8 }),
      board: new THREE.MeshStandardMaterial({ color: COLOR.board, roughness: 0.4, side: THREE.DoubleSide }),
      lectern: new THREE.MeshStandardMaterial({ color: COLOR.lectern, roughness: 0.6 })
    };
  }

  /**
   * show
   * ----
   * @param {number[]} levels – Floors to display (built on first use).
   */
  show(levels) {
    for (const level of levels) if (!this.levels.has(level)) this.#buildLevel(level);
    for (const [level, group] of this.levels) group.visible = levels.includes(level);
  }

  /** @returns {THREE.Mesh[]} Floor slabs of the displayed floors (tap to place). */
  get pickTargets() {
    return [...this.levels.values()].filter((group) => group.visible).map((group) => group.userData.slab).filter(Boolean);
  }

  // ---------------------------------------------------------------------------
  // One floor
  // ---------------------------------------------------------------------------

  #buildLevel(level) {
    const campus = this.campus;
    const floor = campus.getFloor(level);
    const group = new THREE.Group();
    group.name = `interior-${level}`;
    this.levels.set(level, group);
    this.group.add(group);
    if (!floor) return;

    const base = level * campus.floorHeight;
    const rooms = this.#findRooms(level);

    const slab = this.#buildSlab(level, base, rooms);
    if (slab) {
      group.add(slab);
      group.userData.slab = slab;
    }
    group.add(...this.#buildWalls([...(floor.walls || []), ...(floor.columns || [])], base));
    group.add(this.#buildLines(floor.doors || [], base + SLAB + 0.02, this.materials.door));
    const treads = this.#buildTreads(floor.stairs || [], base);
    if (treads) group.add(treads);
    for (const lift of floor.lifts || []) group.add(this.#buildLift(lift, base));
    for (const room of rooms.list.filter((r) => r.place.kind === 'amphi')) group.add(this.#buildAmphitheatre(room, rooms, base));

    group.traverse((child) => {
      if (child.isMesh && child.material !== this.materials.glass) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }

  /**
   * Room regions: flood fill of the indoor cells from each room's interior
   * point, kept inside its bounding box (doors open into the corridors).
   *
   * @returns {{map: Int16Array, list: {place, index, cells: number[]}[]}}
   */
  #findRooms(level) {
    const campus = this.campus;
    const { width, height, res, minX, minY } = campus;
    const cells = campus.cells[campus.levels.indexOf(level)];
    const map = new Int16Array(width * height);
    const list = [];
    const indoor = (i) => cells[i] > 0 && cells[i] <= 4;
    const places = campus.getPlaces().filter((p) => p.level === level && p.bbox && (p.kind === 'room' || p.kind === 'amphi'));
    for (const place of places) {
      const [bx0, by0, bx1, by1] = place.bbox;
      const cx0 = Math.max(0, Math.floor((bx0 - 0.3 - minX) / res));
      const cy0 = Math.max(0, Math.floor((by0 - 0.3 - minY) / res));
      const cx1 = Math.min(width - 1, Math.floor((bx1 + 0.3 - minX) / res));
      const cy1 = Math.min(height - 1, Math.floor((by1 + 0.3 - minY) / res));
      const sx = Math.floor((place.x - minX) / res);
      const sy = Math.floor((place.y - minY) / res);
      const start = sy * width + sx;
      if (sx < cx0 || sx > cx1 || sy < cy0 || sy > cy1 || !indoor(start) || map[start]) continue;
      const index = list.length + 1;
      const region = [start];
      map[start] = index;
      for (let k = 0; k < region.length; k++) {
        const i = region[k];
        const x = i % width;
        const y = (i - x) / width;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < cx0 || nx > cx1 || ny < cy0 || ny > cy1) continue;
          const j = ny * width + nx;
          if (map[j] || !indoor(j)) continue;
          map[j] = index;
          region.push(j);
        }
      }
      list.push({ place, index, cells: region });
    }
    return { map, list };
  }

  /** Floor slab: one quad per run of cells of the same room (or corridor) along a row. */
  #buildSlab(level, base, rooms) {
    const campus = this.campus;
    const { width, height, res, minX, minY } = campus;
    const cells = campus.cells[campus.levels.indexOf(level)];
    const corridor = colorOf(COLOR.corridor);
    const tones = COLOR.rooms.map(colorOf);
    const soup = new Soup();
    const y = base + SLAB;
    for (let cy = 0; cy < height; cy++) {
      let cx = 0;
      while (cx < width) {
        const i = cy * width + cx;
        if (!(cells[i] > 0 && cells[i] <= 4)) { cx++; continue; }
        const key = rooms.map[i];
        const start = cx;
        while (cx < width) {
          const j = cy * width + cx;
          if (!(cells[j] > 0 && cells[j] <= 4) || rooms.map[j] !== key) break;
          cx++;
        }
        const x0 = minX + start * res;
        const x1 = minX + cx * res;
        const y0 = minY + cy * res;
        const y1 = y0 + res;
        const color = key ? tones[key % tones.length] : corridor;
        soup.quad([x0, y, -y0], [x1, y, -y0], [x1, y, -y1], [x0, y, -y1], [UP, UP], null, color);
      }
    }
    if (soup.empty) return null;
    const mesh = new THREE.Mesh(soup.geometry(), this.materials.slab);
    mesh.userData.level = level;
    return mesh;
  }

  /** Walls as vertical faces cut at CUT_HEIGHT, with a dark section line on top. */
  #buildWalls(parts, base) {
    const faces = new Soup();
    const caps = new Soup();
    const y0 = base + SLAB;
    const y1 = base + CUT_HEIGHT;
    for (const part of parts) {
      for (let i = 0; i + 3 < part.length; i += 2) {
        const ax = part[i]; const ay = part[i + 1];
        const bx = part[i + 2]; const by = part[i + 3];
        const length = Math.hypot(bx - ax, by - ay);
        if (length < 1e-3) continue;
        const nx = (by - ay) / length;
        const ny = -(bx - ax) / length;
        const normal = [nx, 0, -ny];
        faces.quad([ax, y0, -ay], [bx, y0, -by], [bx, y1, -by], [ax, y1, -ay], [normal, normal]);
        const w = WALL_CAP / 2;
        const top = y1 + 0.004;
        caps.quad(
          [ax - nx * w, top, -(ay - ny * w)], [bx - nx * w, top, -(by - ny * w)],
          [bx + nx * w, top, -(by + ny * w)], [ax + nx * w, top, -(ay + ny * w)],
          [UP, UP]
        );
      }
    }
    return [new THREE.Mesh(faces.geometry(), this.materials.wall), new THREE.Mesh(caps.geometry(), this.materials.section)];
  }

  #buildLines(parts, height, material) {
    const positions = [];
    for (const part of parts) {
      for (let i = 0; i + 3 < part.length; i += 2) {
        positions.push(part[i], height, -part[i + 1], part[i + 2], height, -part[i + 3]);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return new THREE.LineSegments(geometry, material);
  }

  /** Stair treads: the plan's tread lines as low concrete bars. */
  #buildTreads(parts, base) {
    const soup = new Soup();
    for (const part of parts) {
      for (let i = 0; i + 3 < part.length; i += 2) {
        const a = [part[i], part[i + 1]];
        const b = [part[i + 2], part[i + 3]];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.05) continue;
        soup.box(a, b, 0.07, base + SLAB, base + SLAB + 0.16);
      }
    }
    return soup.empty ? null : new THREE.Mesh(soup.geometry(), this.materials.tread);
  }

  /** Glass lift shaft over the lift outline of the plan. */
  #buildLift(part, base) {
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (let i = 0; i + 1 < part.length; i += 2) {
      minX = Math.min(minX, part[i]); maxX = Math.max(maxX, part[i]);
      minY = Math.min(minY, part[i + 1]); maxY = Math.max(maxY, part[i + 1]);
    }
    const height = CUT_HEIGHT - SLAB;
    const shaft = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(maxX - minX, 0.5), height, Math.max(maxY - minY, 0.5)),
      this.materials.glass
    );
    shaft.position.set((minX + maxX) / 2, base + SLAB + height / 2, -(minY + maxY) / 2);
    return shaft;
  }

  // ---------------------------------------------------------------------------
  // Amphitheatres
  // ---------------------------------------------------------------------------

  /**
   * Fan-shaped amphitheatre: stage on the side of the tower centre, tiers
   * rising outward in arcs around that centre, seat rows on each tier.
   */
  #buildAmphitheatre(room, rooms, base) {
    const campus = this.campus;
    const { width, res, minX, minY } = campus;
    const group = new THREE.Group();
    group.name = `amphi-${room.place.id}`;
    const block = campus.blocks.find((b) => b.id === room.place.block) || { x: room.place.x, y: room.place.y };
    const centre = (i) => {
      const x = i % width;
      return [minX + (x + 0.5) * res, minY + ((i - x) / width + 0.5) * res];
    };
    const radius = (i) => {
      const [x, y] = centre(i);
      return Math.hypot(x - block.x, y - block.y);
    };
    let rMin = Infinity;
    let rMax = 0;
    for (const i of room.cells) {
      const r = radius(i);
      rMin = Math.min(rMin, r);
      rMax = Math.max(rMax, r);
    }
    const rows = Math.max(1, Math.floor((rMax - rMin - AMPHI.stageDepth) / AMPHI.rowDepth));
    const rise = Math.min(0.17, AMPHI.maxRise / rows);
    const tierOf = (r) => (r - rMin < AMPHI.stageDepth ? -1 : Math.min(rows - 1, Math.floor((r - rMin - AMPHI.stageDepth) / AMPHI.rowDepth)));
    const floorY = base + SLAB;
    const heightOf = (tier) => (tier < 0 ? 0.3 : 0.08 + rise * (tier + 1));

    // Tiers and stage: boxes over runs of cells of the same tier along each row
    const soup = new Soup();
    const top = colorOf(COLOR.tierTop);
    const stage = colorOf(COLOR.stage);
    const byRow = new Map();
    for (const i of room.cells) {
      const y = Math.floor(i / width);
      if (!byRow.has(y)) byRow.set(y, []);
      byRow.get(y).push(i % width);
    }
    const stageCells = [];
    for (const [cy, xs] of byRow) {
      xs.sort((a, b) => a - b);
      let k = 0;
      while (k < xs.length) {
        const startX = xs[k];
        const tier = tierOf(radius(cy * width + startX));
        let endX = startX;
        while (k + 1 < xs.length && xs[k + 1] === endX + 1 && tierOf(radius(cy * width + xs[k + 1])) === tier) {
          k++;
          endX = xs[k];
        }
        k++;
        const y = minY + (cy + 0.5) * res;
        const a = [minX + startX * res, y];
        const b = [minX + (endX + 1) * res, y];
        soup.box(a, b, res, floorY, floorY + heightOf(tier), tier < 0 ? stage : top);
        if (tier < 0) for (let x = startX; x <= endX; x++) stageCells.push(cy * width + x);
      }
    }
    group.add(new THREE.Mesh(soup.geometry(), this.materials.tier));

    // Seat rows along each tier's arc (only where the room is, away from walls)
    const inRoom = (x, y) => {
      const cx = Math.floor((x - minX) / res);
      const cy = Math.floor((y - minY) / res);
      return rooms.map[cy * width + cx] === room.index;
    };
    const seats = [];
    for (let tier = 0; tier < rows; tier++) {
      const r = rMin + AMPHI.stageDepth + (tier + 0.45) * AMPHI.rowDepth;
      const step = AMPHI.seatSpacing / r;
      for (let angle = -Math.PI; angle < Math.PI; angle += step) {
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const x = block.x + dx * r;
        const y = block.y + dy * r;
        // the seat and the space around it must be inside the amphitheatre
        if (!inRoom(x, y) || !inRoom(x + dx * 0.4, y + dy * 0.4) || !inRoom(x - dx * 0.4, y - dy * 0.4)
          || !inRoom(x - dy * 0.35, y + dx * 0.35) || !inRoom(x + dy * 0.35, y - dx * 0.35)) continue;
        seats.push({ x, y, yaw: Math.atan2(dx, -dy), h: floorY + heightOf(tier) });
      }
    }
    if (seats.length) {
      const seatMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.48, 0.08, 0.44).translate(0, 0.44, 0), this.materials.seat, seats.length);
      const backMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.48, 0.5, 0.06).translate(0, 0.7, 0.2), this.materials.seat, seats.length);
      const matrix = new THREE.Matrix4();
      const rotation = new THREE.Quaternion();
      const one = new THREE.Vector3(1, 1, 1);
      seats.forEach((seat, index) => {
        rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), seat.yaw);
        matrix.compose(new THREE.Vector3(seat.x, seat.h, -seat.y), rotation, one);
        seatMesh.setMatrixAt(index, matrix);
        backMesh.setMatrixAt(index, matrix);
      });
      group.add(seatMesh, backMesh);
    }

    // Board and lectern on the stage, facing the seats
    if (stageCells.length) {
      let sx = 0;
      let sy = 0;
      for (const i of stageCells) {
        const [x, y] = centre(i);
        sx += x;
        sy += y;
      }
      sx /= stageCells.length;
      sy /= stageCells.length;
      const dx = sx - block.x;
      const dy = sy - block.y;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      const yaw = Math.atan2(ux, -uy); // local +z → toward the seats
      const stageTop = floorY + heightOf(-1);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.2), this.materials.board);
      board.position.set(sx - ux * 1.2, stageTop + 1.3, -(sy - uy * 1.2));
      board.rotation.y = yaw;
      const lectern = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.5).translate(0, 0.55, 0), this.materials.lectern);
      lectern.position.set(sx + ux * 0.6 + uy * 1.6, stageTop, -(sy + uy * 0.6 - ux * 1.6));
      lectern.rotation.y = yaw;
      group.add(board, lectern);
    }
    return group;
  }
}
