/**
 * ==========================================================================
 * Module       : mesh-soup.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-26
 * Modified     : 2026-11-26
 * Version      : 3.8.0 (shared by the exterior and interior models)
 * Description  : Growing triangle soup used to build merged meshes (one
 *                draw call per material) for the procedural SUP'COM models:
 *                quads and boxes with normals, UVs and vertex colours.
 * ==========================================================================
 */

import * as THREE from 'three';

export const UP = [0, 1, 0];

/** Growing non-indexed triangle soup with normals, UVs and optional colours. */
export class Soup {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.uvs = [];
    this.colors = [];
  }

  /**
   * Quad a0-b0-b1-a1 (counter-clockwise seen from the front).
   *
   * @param {number[][]} [normals] – [normal at a, normal at b].
   * @param {number[]} [uvs] – [u0, v0, u1, v1].
   * @param {number[]} [color] – [r, g, b] for the whole quad.
   */
  quad(a0, b0, b1, a1, normals = null, uvs = null, color = null) {
    this.positions.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1);
    if (normals) {
      const [na, nb] = normals;
      this.normals.push(...na, ...nb, ...nb, ...na, ...nb, ...na);
    }
    const [u0, v0, u1, v1] = uvs || [0, 0, 1, 1];
    this.uvs.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    if (color) for (let i = 0; i < 6; i++) this.colors.push(...color);
  }

  /**
   * Axis-free box: footprint a→b (plan x, y), `width` across, from y0 to y1
   * (world heights). Top and four sides, no bottom; flat normals are computed
   * by geometry() (use a double-sided material).
   */
  box([ax, ay], [bx, by], width, y0, y1, color = null) {
    const length = Math.hypot(bx - ax, by - ay) || 1e-6;
    const nx = ((by - ay) / length) * (width / 2);
    const ny = (-(bx - ax) / length) * (width / 2);
    const p = (x, y, h) => [x, h, -y];
    const c = [
      [ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]
    ];
    this.quad(p(...c[0], y1), p(...c[1], y1), p(...c[2], y1), p(...c[3], y1), null, null, color);
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = c[i];
      const [x1, z1] = c[(i + 1) % 4];
      this.quad(p(x0, z0, y0), p(x1, z1, y0), p(x1, z1, y1), p(x0, z0, y1), null, null, color);
    }
  }

  geometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    if (this.colors.length === this.positions.length) {
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    }
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
