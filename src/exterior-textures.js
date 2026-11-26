/**
 * ==========================================================================
 * Module       : exterior-textures.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-26
 * Modified     : 2026-11-26
 * Version      : 3.7.0 (SUP'COM exterior redesign)
 * Description  : Procedural canvas textures for the SUP'COM exterior model:
 *                tower façade bay (white render + tall glazed curtain),
 *                entrance-wing curtain wall, forecourt paving, the
 *                "SUP'COM" sign and the Tunisian flag. Everything is drawn
 *                in code (no image copied from supcom.tn or the forum);
 *                proportions follow the official SUP'COM 3D video.
 *                Texture scale: one tile = TILE.* metres, applied with UVs
 *                in metres / tile size by exterior.js.
 * ==========================================================================
 */

import * as THREE from 'three';

/** Real-world size of one texture tile, in metres. */
export const TILE = {
  tower: { width: 12, height: 3.6 },   // one floor, one structural bay
  wing: { width: 3, height: 3.6 },     // one floor, two curtain-wall modules
  paving: { width: 4, height: 4 }
};

const PX_PER_METRE = 64;

/** Deterministic pseudo-random numbers (stable textures between runs). */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function canvas(width, height) {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return { element, ctx: element.getContext('2d') };
}

function toTexture(element, { repeat = true } = {}) {
  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** Glass with a sky reflection: pale at the top, deeper blue-grey below. */
function paintGlass(ctx, x, y, width, height, tone = 0) {
  const gradient = ctx.createLinearGradient(0, y, 0, y + height);
  gradient.addColorStop(0, tone ? '#9fb7cc' : '#b8cde0');
  gradient.addColorStop(0.45, tone ? '#6d879f' : '#87a2bb');
  gradient.addColorStop(1, tone ? '#3b4f63' : '#4d647a');
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, width, height);
  // Diagonal reflection streak
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.beginPath();
  ctx.moveTo(x + width * 0.15, y + height);
  ctx.lineTo(x + width * 0.45, y);
  ctx.lineTo(x + width * 0.62, y);
  ctx.lineTo(x + width * 0.32, y + height);
  ctx.fill();
  ctx.restore();
}

/** Off-white render with a faint grain. */
function paintRender(ctx, x, y, width, height, seed) {
  ctx.fillStyle = '#efeee9';
  ctx.fillRect(x, y, width, height);
  const rand = random(seed);
  for (let i = 0; i < (width * height) / 90; i++) {
    const shade = 225 + Math.floor(rand() * 22);
    ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade - 4}, 0.35)`;
    ctx.fillRect(x + rand() * width, y + rand() * height, 2, 2);
  }
}

/** Mullion grid over a glazed area. */
function paintMullions(ctx, x, y, width, height, columns, rows, color = '#e8ecef', line = 5) {
  ctx.fillStyle = color;
  for (let c = 0; c <= columns; c++) {
    const px = x + (width * c) / columns - line / 2;
    ctx.fillRect(Math.round(px), y, line, height);
  }
  for (const row of rows) {
    ctx.fillRect(x, Math.round(y + height * row - line / 2), width, line);
  }
}

/**
 * Tower bay: [white render with a narrow window][tall glazed curtain][render].
 * Stacked floors line the glazed parts up into the tall glass strips of the
 * SUP'COM towers.
 */
export function createTowerTexture() {
  const W = TILE.tower.width * PX_PER_METRE;
  const H = TILE.tower.height * PX_PER_METRE;
  const { element, ctx } = canvas(W, H);
  const m = (metres) => Math.round(metres * PX_PER_METRE);

  paintRender(ctx, 0, 0, W, H, 7);

  // Tall curtain glazing (spans the full floor height → continuous between floors)
  const gx = m(4.2);
  const gw = m(5.4);
  paintGlass(ctx, gx, 0, gw, H);
  paintMullions(ctx, gx, 0, gw, H, 4, [0.33, 0.72], '#e6eaee', 6);
  // Recess shadow along the glazing edges
  ctx.fillStyle = 'rgba(70, 76, 84, 0.35)';
  ctx.fillRect(gx - 4, 0, 4, H);
  ctx.fillRect(gx + gw, 0, 4, H);

  // Narrow punched window in the solid panel
  const wx = m(1.6);
  const wy = m(0.9);
  const ww = m(0.9);
  const wh = m(1.9);
  ctx.fillStyle = '#c9ccce';
  ctx.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);
  paintGlass(ctx, wx, wy, ww, wh, 1);
  paintMullions(ctx, wx, wy, ww, wh, 1, [0.5], '#dfe3e6', 4);

  // Floor joint in the render
  ctx.fillStyle = 'rgba(120, 124, 128, 0.35)';
  ctx.fillRect(0, H - 3, gx, 3);
  ctx.fillRect(gx + gw, H - 3, W - gx - gw, 3);
  return toTexture(element);
}

/**
 * Entrance wing curtain wall: glass modules, white slab-edge band at each floor.
 */
export function createWingTexture() {
  const W = TILE.wing.width * PX_PER_METRE;
  const H = TILE.wing.height * PX_PER_METRE;
  const { element, ctx } = canvas(W, H);
  paintGlass(ctx, 0, 0, W, H, 1);
  paintMullions(ctx, 0, 0, W, H, 2, [0.42], '#d9dee3', 6);
  // Slab-edge band (white) at the floor line
  const band = Math.round(0.42 * PX_PER_METRE);
  ctx.fillStyle = '#f1f1ee';
  ctx.fillRect(0, H - band, W, band);
  ctx.fillStyle = 'rgba(90, 96, 104, 0.4)';
  ctx.fillRect(0, H - band - 3, W, 3);
  return toTexture(element);
}

/** Forecourt paving: light stone slabs in a running bond. */
export function createPavingTexture() {
  const size = 512;
  const { element, ctx } = canvas(size, size);
  const rand = random(42);
  const rows = 8;           // 0.5 m courses on a 4 m tile
  const slab = size / 4;    // 1 m slabs
  const course = size / rows;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * slab * 0.5;
    for (let c = -1; c < 5; c++) {
      const shade = 196 + Math.floor(rand() * 26);
      ctx.fillStyle = `rgb(${shade}, ${shade - 3}, ${shade - 10})`;
      ctx.fillRect(c * slab + offset, r * course, slab, course);
    }
  }
  ctx.strokeStyle = 'rgba(110, 106, 98, 0.55)';
  ctx.lineWidth = 2;
  for (let r = 0; r <= rows; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * course);
    ctx.lineTo(size, r * course);
    ctx.stroke();
    const offset = (r % 2) * slab * 0.5;
    for (let c = 0; c <= 4; c++) {
      ctx.beginPath();
      ctx.moveTo(c * slab + offset, r * course);
      ctx.lineTo(c * slab + offset, (r + 1) * course);
      ctx.stroke();
    }
  }
  return toTexture(element);
}

/** The white "SUP'COM" sign of the entrance wing (SUP navy, 'COM red). */
export function createSignTexture() {
  const { element, ctx } = canvas(1024, 300);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 1024, 300);
  ctx.strokeStyle = '#c9ced4';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 1018, 294);
  ctx.font = '800 150px "Arial Black", "Segoe UI", system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  const sup = 'SUP';
  const com = "'COM";
  const total = ctx.measureText(sup + com).width;
  let x = (1024 - total) / 2;
  ctx.fillStyle = '#1d2c6b';
  ctx.fillText(sup, x, 190);
  x += ctx.measureText(sup).width;
  ctx.fillStyle = '#d71920';
  ctx.fillText(com, x, 190);
  ctx.font = '600 34px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = '#4b5563';
  ctx.textAlign = 'center';
  ctx.fillText('École Supérieure des Communications de Tunis', 512, 255);
  return toTexture(element, { repeat: false });
}

/** Flag of Tunisia (red field, white disc, red crescent and star). */
export function createTunisiaFlagTexture() {
  const W = 360;
  const H = 240;
  const { element, ctx } = canvas(W, H);
  ctx.fillStyle = '#e70013';
  ctx.fillRect(0, 0, W, H);
  const cx = W / 2;
  const cy = H / 2;
  const r = H / 4;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // Crescent: red disc minus an offset white disc
  ctx.fillStyle = '#e70013';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.75, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx + r * 0.2, cy, r * 0.6, 0, Math.PI * 2);
  ctx.fill();
  // Five-pointed star
  ctx.fillStyle = '#e70013';
  ctx.beginPath();
  const sx = cx + r * 0.22;
  const outer = r * 0.45;
  const inner = outer * 0.4;
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 ? inner : outer;
    const a = -Math.PI / 2 - 0.3 + (i * Math.PI) / 5; // slightly tilted, as on the flag
    const px = sx + Math.cos(a) * radius;
    const py = cy + Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  return toTexture(element, { repeat: false });
}
