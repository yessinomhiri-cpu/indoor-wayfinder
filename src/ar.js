/**
 * ==========================================================================
 * Module       : ar.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-11
 * Modified     : 2026-11-12
 * Version      : 3.0.0 (immersive-ar on WebGPU + compass-aligned route)
 * Description  : WebXR immersive-ar controller rendered with Three.js
 *                WebGPURenderer (session feature 'webgpu', XRGPUBinding).
 *                Hit testing places a reticle on the real floor; a tap
 *                anchors the navigation arrow (XRAnchor). The compass gives
 *                the offset between the AR world and true north, so the arrow
 *                and the floor chevrons follow the real direction of the
 *                route computed on the SUP'COM plan.
 * ==========================================================================
 */

import * as THREE from 'three';
import { createWebGPURenderer, hasWebXRWebGPUBinding } from './gpu.js';
import { bearingOf } from './navigation.js';

/** Reference spaces in preference order; 'local' is always granted. */
const REFERENCE_SPACE_TYPES = ['local-floor', 'local'];
const DEG = Math.PI / 180;

/**
 * isUserActivationError
 * ---------------------
 * @param {*} error – requestSession rejection.
 * @returns {boolean} True when Chrome refused because no fresh tap was seen.
 */
export function isUserActivationError(error) {
  return Boolean(error && error.name === 'SecurityError' && /activation/i.test(error.message || ''));
}

/** A rejection that a simpler configuration might avoid. */
function isConfigurationError(error) {
  return Boolean(error) && error.name !== 'NotAllowedError' && error.name !== 'SecurityError';
}

export class ARGuide {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container – Host of the AR canvas.
   * @param {HTMLElement} [options.overlayRoot] – UI kept above the camera.
   * @param {import('./geo.js').Compass} [options.compass] – Heading source.
   * @param {Function} [options.onStatus] – User-facing status callback.
   * @param {Function} [options.onSessionState] – (isActive) callback.
   */
  constructor({ container, overlayRoot, compass, onStatus, onSessionState }) {
    this.container = container;
    this.overlayRoot = overlayRoot || null;
    this.compass = compass || null;
    this.onStatus = onStatus || (() => {});
    this.onSessionState = onSessionState || (() => {});

    this.renderer = null;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.6));

    this.session = null;
    this.isActive = false;
    this.isStarting = false;
    this.sessionMode = 'full';
    this.hitTestSource = null;
    this.viewerSpace = null;
    this.lastHit = null;
    this.reticle = null;
    this.arrow = null;
    this.anchor = null;
    this.trail = null;          // campus-aligned group of floor chevrons
    this.floorY = null;
    this.startXR = null;        // XR position of the start point
    this.northOffset = null;    // radians: XR yaw ↔ true north
    this.northSamples = { x: 0, y: 0, n: 0 };
    this.route = null;
    this.startPoint = null;          // {x, y, level} campus position of the user

    if (this.overlayRoot) {
      // Taps on overlay buttons (e.g. "Quitter AR") must not place the arrow
      this.overlayRoot.addEventListener('beforexrselect', (event) => event.preventDefault());
    }
  }

  // ===========================================================================
  // Capabilities
  // ===========================================================================

  /**
   * prepare
   * -------
   * Creates the XR-compatible WebGPU renderer ahead of time: requesting the
   * session must stay the first asynchronous step of the tap.
   *
   * @returns {Promise<{supported:boolean, reason:string|null}>}
   */
  async prepare() {
    if (!navigator.xr) return { supported: false, reason: 'webxr' };
    let arSupported = false;
    try {
      arSupported = await navigator.xr.isSessionSupported('immersive-ar');
    } catch (error) {
      arSupported = false;
    }
    if (!arSupported) return { supported: false, reason: 'immersive-ar' };
    if (!hasWebXRWebGPUBinding()) return { supported: false, reason: 'webgpu-binding' };

    if (!this.renderer) {
      this.renderer = await createWebGPURenderer({ xr: true });
      if (!this.renderer) return { supported: false, reason: 'webgpu' };
      this.renderer.domElement.style.display = 'block';
      this.container.appendChild(this.renderer.domElement);
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    }
    return { supported: true, reason: null };
  }

  // ===========================================================================
  // Session
  // ===========================================================================

  /**
   * start
   * -----
   * Exactly ONE requestSession() per tap, as the first asynchronous step
   * (Chrome uses up the tap's activation). If the full configuration is
   * rejected, the error carries `retryNextTap` and the next tap uses the
   * minimal one.
   *
   * @param {Object} route – CampusRouter result.
   * @param {{x:number,y:number,level:number}} start – Where the user stands.
   */
  async start(route, start) {
    if (this.isActive || this.session || this.isStarting) return;
    if (!navigator.xr || !this.renderer) throw new Error('Session AR non préparée');

    this.route = route;
    this.startPoint = start;
    this.isStarting = true;
    try {
      await this.#startSession();
    } finally {
      this.isStarting = false;
    }
  }

  async #startSession() {
    const mode = this.sessionMode;
    let session;
    try {
      session = await navigator.xr.requestSession('immersive-ar', this.#sessionOptions(mode));
    } catch (error) {
      if (mode === 'full' && isConfigurationError(error)) {
        this.sessionMode = 'minimal';
        if (error && typeof error === 'object') error.retryNextTap = true;
      }
      throw error;
    }
    this.session = session;
    session.addEventListener('end', () => this.#handleSessionEnd());

    try {
      const referenceSpaceType = await this.#pickReferenceSpaceType(session);
      this.northOffset = null;
      this.northSamples = { x: 0, y: 0, n: 0 };
      this.startXR = null;
      this.floorY = null;
      // Three.js r187 drives the XR frames with the loop registered BEFORE
      // setSession(), so it must be in place first.
      this.renderer.setAnimationLoop((time, frame) => {
        if (frame) this.#update(frame);
        this.renderer.render(this.scene, this.camera);
      });
      this.renderer.xr.setReferenceSpaceType(referenceSpaceType);
      await this.renderer.xr.setSession(session);

      this.reticle = createReticle();
      this.scene.add(this.reticle);
      this.arrow = createArrow();
      this.arrow.visible = false;
      this.scene.add(this.arrow);

      this.viewerSpace = await session.requestReferenceSpace('viewer');
      this.hitTestSource = await session.requestHitTestSource({ space: this.viewerSpace });
    } catch (error) {
      this.renderer.setAnimationLoop(null);
      if (this.session === session) session.end().catch(() => {});
      throw error;
    }

    session.addEventListener('select', () => {
      this.#placeArrow().catch((error) => console.warn('[ar] Arrow placement failed:', error));
    });

    this.isActive = true;
    this.onSessionState(true);
    const compassNote = this.compass && this.compass.isReliable ? '' : ' (boussole en calibration : bougez le téléphone en 8)';
    this.onStatus(`AR active : visez le sol, puis touchez pour placer la flèche${compassNote}.`);
  }

  /** Ends the current session. */
  stop() {
    if (this.session) this.session.end().catch((error) => console.warn('[ar] Session end failed:', error));
  }

  /** @returns {boolean} True when the page UI is visible inside the session. */
  get hasDomOverlay() {
    return Boolean(this.session && this.session.domOverlayState);
  }

  /**
   * #sessionOptions
   * ---------------
   * 'webgpu' is required: the session is rendered with WebGPU only.
   * The overlay root is the UI layer, never document.body (opaque page
   * background and canvas would hide the camera feed).
   */
  #sessionOptions(mode) {
    if (mode === 'minimal') return { requiredFeatures: ['webgpu', 'hit-test'] };
    const options = { requiredFeatures: ['webgpu', 'hit-test'], optionalFeatures: ['local-floor', 'anchors'] };
    if (this.overlayRoot) {
      options.optionalFeatures.push('dom-overlay');
      options.domOverlay = { root: this.overlayRoot };
    }
    return options;
  }

  async #pickReferenceSpaceType(session) {
    let lastError = null;
    for (const type of REFERENCE_SPACE_TYPES) {
      try {
        await session.requestReferenceSpace(type);
        return type;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('Aucun espace de référence AR disponible');
  }

  // ===========================================================================
  // Frame update
  // ===========================================================================

  #update(frame) {
    if (!this.isActive || !this.hitTestSource) return;
    const referenceSpace = this.renderer.xr.getReferenceSpace();
    if (!referenceSpace) return;

    const xrCamera = this.renderer.xr.getCamera();
    this.#updateNorthOffset(xrCamera);

    if (!this.startXR && xrCamera) {
      this.startXR = new THREE.Vector3().setFromMatrixPosition(xrCamera.matrixWorld);
    }

    if (this.anchor && this.arrow) {
      const anchorPose = frame.getPose(this.anchor.anchorSpace, referenceSpace);
      if (anchorPose) applyFloorPose(this.arrow, anchorPose);
    }

    const results = frame.getHitTestResults(this.hitTestSource);
    if (results.length > 0) {
      this.lastHit = results[0];
      const pose = this.lastHit.getPose(referenceSpace);
      if (pose) {
        if (this.floorY === null) this.floorY = pose.transform.position.y;
        if (this.reticle && !this.anchor) {
          this.reticle.visible = true;
          applyFloorPose(this.reticle, pose);
        }
      }
    } else {
      this.lastHit = null;
      if (this.reticle) this.reticle.visible = false;
    }

    if (!this.trail && this.northOffset !== null && this.floorY !== null && this.startXR) {
      this.#buildTrail();
    }
    if (this.trail && this.northOffset !== null) {
      this.trail.rotation.y = this.northOffset;
    }
  }

  /**
   * North offset: the compass gives the true heading of the back camera,
   * WebXR gives its yaw in the AR world; their difference maps any campus
   * bearing to a direction in the AR scene. Averaged on the unit circle.
   */
  #updateNorthOffset(xrCamera) {
    if (!this.compass || !this.compass.isReliable || !xrCamera) return;
    const forward = new THREE.Vector3();
    xrCamera.getWorldDirection(forward);
    if (Math.abs(forward.y) > 0.85) return; // looking at the floor: yaw unstable
    const yawXR = Math.atan2(forward.x, -forward.z); // 0 = −Z, + toward +X
    const offset = this.compass.heading * DEG - yawXR;
    const s = this.northSamples;
    const weight = s.n < 30 ? 1 / (s.n + 1) : 0.03;
    s.x += (Math.sin(offset) - s.x) * weight;
    s.y += (Math.cos(offset) - s.y) * weight;
    s.n++;
    this.northOffset = Math.atan2(s.x, s.y);
  }

  /** XR direction (unit vector) of a true-north bearing in degrees. */
  #directionOfBearing(bearing) {
    const theta = bearing * DEG - this.northOffset;
    return new THREE.Vector3(Math.sin(theta), 0, -Math.cos(theta));
  }

  /**
   * Floor chevrons along the first ~40 m of the route, drawn in a group whose
   * axes are the campus axes (x = east, −z = north) rotated by northOffset.
   */
  #buildTrail() {
    if (!this.route || !this.route.legs || !this.route.legs.length || !this.startPoint) return;
    const leg = this.route.legs.find((l) => l.level === this.startPoint.level) || this.route.legs[0];
    const points = leg.points;
    if (points.length < 2) return;

    const group = new THREE.Group();
    group.position.set(this.startXR.x, this.floorY + 0.01, this.startXR.z);
    const material = new THREE.MeshBasicMaterial({ color: 0x00d2ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    const geometry = chevronGeometry(0.22);

    let travelled = 0;
    for (let i = 1; i < points.length && travelled < 40; i++) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      const length = Math.hypot(x1 - x0, y1 - y0);
      const yaw = Math.atan2(x1 - x0, -(y1 - y0)); // campus frame → group frame
      for (let d = travelled === 0 ? 0.8 : 0; d < length && travelled + d < 40; d += 1) {
        const t = d / length;
        const chevron = new THREE.Mesh(geometry, material);
        chevron.position.set(x0 + (x1 - x0) * t - this.startPoint.x, 0, -((y0 + (y1 - y0) * t) - this.startPoint.y));
        chevron.rotation.y = yaw; // tip (+Z) along the segment
        group.add(chevron);
      }
      travelled += length;
    }
    this.trail = group;
    this.scene.add(group);
  }

  // ===========================================================================
  // Arrow
  // ===========================================================================

  async #placeArrow() {
    if (!this.lastHit || !this.arrow) return;
    const referenceSpace = this.renderer.xr.getReferenceSpace();
    const pose = this.lastHit.getPose(referenceSpace);
    if (!pose) return;

    applyFloorPose(this.arrow, pose);
    const bearing = this.#routeBearingAt(pose.transform.position);
    let direction;
    if (bearing !== null && this.northOffset !== null) {
      direction = this.#directionOfBearing(bearing);
    } else {
      // No reliable compass: point away from the phone
      direction = new THREE.Vector3();
      this.renderer.xr.getCamera().getWorldDirection(direction);
      direction.y = 0;
    }
    this.arrow.rotation.y = Math.atan2(direction.x, direction.z);
    this.arrow.visible = true;
    if (this.reticle) this.reticle.visible = false;

    try {
      if (typeof this.lastHit.createAnchor === 'function') this.anchor = await this.lastHit.createAnchor();
    } catch (error) {
      console.warn('[ar] XRAnchor unavailable; keeping the hit pose:', error);
    }

    const next = this.route && this.route.steps ? this.route.steps.find((s) => s.kind === 'walk') : null;
    if (bearing !== null && this.northOffset !== null) {
      this.onStatus(`Flèche orientée vers ${Math.round(bearing)}° — ${next ? next.text : 'suivez la flèche'}.`);
    } else {
      this.onStatus('Boussole indisponible : flèche orientée devant vous. Recalibrez (mouvement en 8).');
    }
  }

  /** Bearing of the route segment closest to a point of the AR scene. */
  #routeBearingAt(position) {
    if (!this.route || !this.route.legs || !this.startPoint) return null;
    const leg = this.route.legs.find((l) => l.level === this.startPoint.level) || this.route.legs[0];
    if (!leg || leg.points.length < 2) return null;
    if (this.northOffset === null || !this.startXR) {
      const [x0, y0] = leg.points[0];
      const [x1, y1] = leg.points[1];
      return bearingOf(x0, y0, x1, y1);
    }
    // AR point → campus coordinates (inverse of the trail transform)
    const dx = position.x - this.startXR.x;
    const dz = position.z - this.startXR.z;
    const c = Math.cos(-this.northOffset);
    const s = Math.sin(-this.northOffset);
    const gx = dx * c + dz * s;
    const gz = -dx * s + dz * c;
    const px = this.startPoint.x + gx;
    const py = this.startPoint.y - gz;

    let best = null;
    for (let i = 1; i < leg.points.length; i++) {
      const [x0, y0] = leg.points[i - 1];
      const [x1, y1] = leg.points[i];
      const vx = x1 - x0; const vy = y1 - y0;
      const t = Math.max(0, Math.min(1, ((px - x0) * vx + (py - y0) * vy) / (vx * vx + vy * vy || 1)));
      const distance = Math.hypot(px - (x0 + vx * t), py - (y0 + vy * t));
      if (!best || distance < best.distance) best = { distance, bearing: bearingOf(x0, y0, x1, y1) };
    }
    return best ? best.bearing : null;
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  #handleSessionEnd() {
    const wasActive = this.isActive;
    this.isActive = false;
    if (this.renderer) this.renderer.setAnimationLoop(null);
    if (this.hitTestSource) {
      this.hitTestSource.cancel();
      this.hitTestSource = null;
    }
    for (const object of [this.reticle, this.arrow, this.trail]) {
      if (!object) continue;
      this.scene.remove(object);
      disposeObject(object);
    }
    this.reticle = null;
    this.arrow = null;
    this.trail = null;
    this.anchor = null;
    this.lastHit = null;
    this.session = null;
    this.onSessionState(false);
    if (wasActive) this.onStatus('Session AR terminée.');
  }
}

// =============================================================================
// Geometry
// =============================================================================

function applyFloorPose(object, pose) {
  object.position.set(pose.transform.position.x, pose.transform.position.y + 0.005, pose.transform.position.z);
}

function createReticle() {
  const geometry = new THREE.RingGeometry(0.12, 0.16, 32);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x00d2ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  mesh.visible = false;
  return mesh;
}

/**
 * createArrow
 * -----------
 * Flat floor arrow (1 m, extruded 4 cm), origin at the tail, tip toward +Z.
 */
export function createArrow() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.08, 0);
  shape.lineTo(-0.08, 0.55);
  shape.lineTo(-0.22, 0.55);
  shape.lineTo(0, 1.0);
  shape.lineTo(0.22, 0.55);
  shape.lineTo(0.08, 0.55);
  shape.lineTo(0.08, 0);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0.04, 0);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x00d2ff, side: THREE.DoubleSide })));
  return group;
}

/** Small flat chevron, tip toward +Z. */
function chevronGeometry(size) {
  const s = size;
  const shape = new THREE.Shape();
  shape.moveTo(-s, -s * 0.5);
  shape.lineTo(0, s * 0.5);
  shape.lineTo(s, -s * 0.5);
  shape.lineTo(s, -s * 0.05);
  shape.lineTo(0, s * 0.95);
  shape.lineTo(-s, -s * 0.05);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  geometry.rotateY(Math.PI);
  return geometry;
}

function disposeObject(root) {
  root.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => m.dispose());
  });
}
