/**
 * ==========================================================================
 * Module       : ar.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-11
 * Modified     : 2026-11-12
 * Version      : 3.1.0 (live turn-by-turn AR on WebGPU)
 * Description  : WebXR immersive-ar session rendered with Three.js
 *                WebGPURenderer (session feature 'webgpu', XRGPUBinding).
 *                Every frame, the ARCore camera pose is turned into a
 *                position on the SUP'COM plan by ARGuidance (QR start +
 *                visual-inertial tracking + compass + wall map-matching).
 *                In a scene frame aligned with the plan it draws:
 *                - the next 25 m of the route as flowing chevrons on the floor,
 *                - large turn arrows at the coming turns, stairs / lift signs,
 *                - the destination pin,
 *                - the real walls as invisible depth occluders, so guidance
 *                  never shows through a wall.
 *                A tap anchors an arrow (XRAnchor) oriented along the route.
 * ==========================================================================
 */

import * as THREE from 'three';
import { createWebGPURenderer, hasWebXRWebGPUBinding } from './gpu.js';
import { ARGuidance, projectOnPolyline, cumulativeLengths } from './ar-guidance.js';
import { bearingOf } from './navigation.js';

/** Reference spaces in preference order; 'local' is always granted. */
const REFERENCE_SPACE_TYPES = ['local-floor', 'local'];
const WALL_HEIGHT = 2.9;
const CHEVRON_COUNT = 34;
const CHEVRON_SPACING = 0.75;
const CAMERA_HEIGHT = 1.45; // m above the floor when no floor hit yet

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
   * @param {import('./navigation.js').CampusMap} options.campus – Campus model.
   * @param {HTMLElement} [options.overlayRoot] – UI kept above the camera.
   * @param {import('./geo.js').Compass} [options.compass] – Heading source.
   * @param {Function} [options.onStatus] – User-facing status callback.
   * @param {Function} [options.onSessionState] – (isActive) callback.
   * @param {Function} [options.onGuidance] – (state) ≈ 6 times per second.
   * @param {Function} [options.onReroute] – (position) when off route.
   * @param {Function} [options.onArrive] – () once at the destination.
   */
  constructor({ container, campus, overlayRoot, compass, onStatus, onSessionState, onGuidance, onReroute, onArrive }) {
    this.container = container;
    this.campus = campus;
    this.overlayRoot = overlayRoot || null;
    this.compass = compass || null;
    this.onStatus = onStatus || (() => {});
    this.onSessionState = onSessionState || (() => {});
    this.onGuidance = onGuidance || (() => {});
    this.onReroute = onReroute || (() => {});
    this.onArrive = onArrive || (() => {});

    this.guidance = new ARGuidance(campus);
    this.renderer = null;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.6));

    // Plan-aligned frame: outer = AR position + yaw, inner = plan offset.
    // Children use plan coordinates (x = east, y = height, z = −north).
    this.planOuter = new THREE.Group();
    this.planInner = new THREE.Group();
    this.planOuter.add(this.planInner);
    this.scene.add(this.planOuter);

    this.session = null;
    this.isActive = false;
    this.isStarting = false;
    this.sessionMode = 'full';
    this.hitTestSource = null;
    this.viewerSpace = null;
    this.lastHit = null;
    this.reticle = null;
    this.anchoredArrow = null;
    this.anchor = null;
    this.floorHits = [];
    this.floorY = null;
    this.occluderLevel = null;
    this.occluders = null;
    this.chevrons = [];
    this.turnArrows = [];
    this.destinationPin = null;
    this.route = null;
    this.destination = null;
    this.startPoint = null;
    this.lastGuidanceEmit = 0;
    this.arrivedNotified = false;
    this.xrPosition = new THREE.Vector3();

    if (this.overlayRoot) {
      // Taps on HUD buttons must not place the arrow
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
   * @param {{x:number,y:number,level:number}} start – Where the user stands (QR).
   * @param {Object} destination – Destination place.
   */
  async start(route, start, destination) {
    if (this.isActive || this.session || this.isStarting) return;
    if (!navigator.xr || !this.renderer) throw new Error('Session AR non préparée');

    this.route = route;
    this.startPoint = start;
    this.destination = destination;
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
      this.guidance.reset();
      this.floorHits = [];
      this.floorY = null;
      this.arrivedNotified = false;
      // Three.js r187 drives the XR frames with the loop registered BEFORE
      // setSession(), so it must be in place first.
      this.renderer.setAnimationLoop((time, frame) => {
        if (frame) this.#update(frame, time);
        this.renderer.render(this.scene, this.camera);
      });
      this.renderer.xr.setReferenceSpaceType(referenceSpaceType);
      await this.renderer.xr.setSession(session);

      this.#buildVisuals();
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
    this.onStatus('Guidage AR : suivez les chevrons au sol. Marchez quelques mètres pour affiner la position.');
  }

  /** Ends the current session. */
  stop() {
    if (this.session) this.session.end().catch((error) => console.warn('[ar] Session end failed:', error));
  }

  /** @returns {boolean} True when the page UI is visible inside the session. */
  get hasDomOverlay() {
    return Boolean(this.session && this.session.domOverlayState);
  }

  // ----- HUD actions -----------------------------------------------------------

  /** "Aligner": the user faces the direction shown for the route. */
  alignToRoute() {
    const camera = this.#cameraState();
    if (!camera) return false;
    return this.guidance.alignToRoute(camera.yaw);
  }

  /** "Je suis à …": snap the position to a known place. */
  snapToPlace(place) {
    const camera = this.#cameraState();
    if (!camera || !place) return;
    this.guidance.snapTo(place, camera.position);
  }

  /** After a lift ride. */
  confirmLiftExit() {
    const camera = this.#cameraState();
    if (camera) this.guidance.confirmLiftExit(camera.position);
  }

  /** New route after rerouting. */
  setRoute(route) {
    this.route = route;
    this.guidance.setRoute(route);
  }

  #sessionOptions(mode) {
    // 'webgpu' is required: the session is rendered with WebGPU only. The
    // overlay root is the UI layer, never document.body.
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

  #cameraState() {
    if (!this.renderer || !this.renderer.xr.isPresenting) return null;
    const xrCamera = this.renderer.xr.getCamera();
    if (!xrCamera) return null;
    const position = new THREE.Vector3().setFromMatrixPosition(xrCamera.matrixWorld);
    const forward = new THREE.Vector3();
    xrCamera.getWorldDirection(forward);
    // When the phone points at the floor, the top edge of the screen gives the walking direction
    let yaw;
    if (Math.abs(forward.y) > 0.9) {
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(xrCamera.matrixWorld));
      yaw = Math.atan2(up.x, -up.z);
    } else {
      yaw = Math.atan2(forward.x, -forward.z);
    }
    return { position: { x: position.x, y: position.y, z: position.z }, yaw };
  }

  #update(frame, time) {
    if (!this.isActive || !this.hitTestSource) return;
    const referenceSpace = this.renderer.xr.getReferenceSpace();
    const camera = this.#cameraState();
    if (!referenceSpace || !camera) return;

    // Floor height from hit tests below the camera (median of recent hits)
    const results = frame.getHitTestResults(this.hitTestSource);
    this.lastHit = results.length ? results[0] : null;
    if (this.lastHit) {
      const pose = this.lastHit.getPose(referenceSpace);
      if (pose) {
        const y = pose.transform.position.y;
        if (y < camera.position.y - 0.7 && y > camera.position.y - 2.4) {
          this.floorHits.push(y);
          if (this.floorHits.length > 15) this.floorHits.shift();
          this.floorY = median(this.floorHits);
        }
        if (this.reticle) {
          this.reticle.visible = true;
          this.reticle.position.set(pose.transform.position.x, pose.transform.position.y + 0.005, pose.transform.position.z);
        }
      }
    } else if (this.reticle) {
      this.reticle.visible = false;
    }
    const floorY = this.floorY !== null && Math.abs(this.floorY - (camera.position.y - CAMERA_HEIGHT)) < 1.2
      ? this.floorY
      : camera.position.y - CAMERA_HEIGHT;

    // Localization
    if (!this.guidance.started) {
      const heading = this.compass && this.compass.heading !== null ? this.compass.heading : null;
      this.guidance.begin({ start: this.startPoint, route: this.route, startXR: camera.position, yawXR: camera.yaw, heading });
    }
    if (this.compass) this.guidance.updateCompass(this.compass.heading, camera.yaw, this.compass.isReliable);
    const state = this.guidance.update(camera.position, camera.yaw, time);
    if (!state) return;

    // Plan-aligned frame
    const g = this.guidance;
    this.planOuter.position.set(g.startXR.x, floorY, g.startXR.z);
    this.planOuter.rotation.y = g.phi;
    this.planInner.position.set(-(g.start.x + g.delta[0]), 0, g.start.y + g.delta[1]);

    if (this.occluderLevel !== state.position.level) this.#buildOccluders(state.position.level);
    this.#updatePath(state, time);
    this.#updateDestination(state);

    if (this.anchor && this.anchoredArrow) {
      const anchorPose = frame.getPose(this.anchor.anchorSpace, referenceSpace);
      if (anchorPose) this.anchoredArrow.position.set(anchorPose.transform.position.x, anchorPose.transform.position.y + 0.005, anchorPose.transform.position.z);
    }

    if (state.reroute) this.onReroute(state.position);
    if (state.arrived && !this.arrivedNotified) {
      this.arrivedNotified = true;
      this.onArrive();
    }
    if (time - this.lastGuidanceEmit > 160) {
      this.lastGuidanceEmit = time;
      this.onGuidance(state);
    }
  }

  // ===========================================================================
  // Visuals
  // ===========================================================================

  #buildVisuals() {
    this.reticle = createReticle();
    this.scene.add(this.reticle);

    const chevronGeometry = createChevronGeometry(0.28);
    const chevronMaterial = new THREE.MeshBasicMaterial({ color: 0x00d2ff, transparent: true, opacity: 0.92, side: THREE.DoubleSide });
    for (let i = 0; i < CHEVRON_COUNT; i++) {
      const chevron = new THREE.Mesh(chevronGeometry, chevronMaterial.clone());
      chevron.visible = false;
      this.planInner.add(chevron);
      this.chevrons.push(chevron);
    }

    for (let i = 0; i < 3; i++) {
      const arrow = createTurnArrow();
      arrow.visible = false;
      this.planInner.add(arrow);
      this.turnArrows.push(arrow);
    }

    this.destinationPin = createDestinationPin();
    this.destinationPin.visible = false;
    this.planInner.add(this.destinationPin);
  }

  /** Depth-only walls of the current floor: guidance never shows through them. */
  #buildOccluders(level) {
    if (this.occluders) {
      this.planInner.remove(this.occluders);
      this.occluders.geometry.dispose();
      this.occluders.material.dispose();
      this.occluders = null;
    }
    this.occluderLevel = level;
    const floor = this.campus.getFloor(level);
    if (!floor) return;
    const positions = [];
    for (const part of [...(floor.walls || []), ...(floor.facade || []), ...(floor.columns || [])]) {
      for (let i = 0; i + 3 < part.length; i += 2) {
        const ax = part[i]; const az = -part[i + 1];
        const bx = part[i + 2]; const bz = -part[i + 3];
        positions.push(ax, 0, az, bx, 0, bz, bx, WALL_HEIGHT, bz, ax, 0, az, bx, WALL_HEIGHT, bz, ax, WALL_HEIGHT, az);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
    this.occluders = new THREE.Mesh(geometry, material);
    this.occluders.renderOrder = -1; // depth first
    this.planInner.add(this.occluders);
  }

  #updatePath(state, time) {
    const ahead = state.ahead || [];
    // Flowing chevrons along the next metres of the route
    const cumulative = cumulativeLengths(ahead);
    const length = cumulative[cumulative.length - 1] || 0;
    const phase = ((time / 1000) * 1.2) % CHEVRON_SPACING;
    let index = 0;
    for (let d = 0.8 + phase; d < length && index < CHEVRON_COUNT; d += CHEVRON_SPACING, index++) {
      const segment = segmentAt(cumulative, d);
      const [x0, y0] = ahead[segment];
      const [x1, y1] = ahead[segment + 1];
      const t = (d - cumulative[segment]) / ((cumulative[segment + 1] - cumulative[segment]) || 1);
      const chevron = this.chevrons[index];
      chevron.visible = true;
      chevron.position.set(x0 + (x1 - x0) * t, 0.02, -(y0 + (y1 - y0) * t));
      chevron.rotation.y = Math.atan2(x1 - x0, -(y1 - y0));
      // Fade the far end
      chevron.material.opacity = 0.95 * Math.min(1, (length - d) / 4 + 0.15) * (state.offRoute ? 0.45 : 1);
    }
    for (; index < CHEVRON_COUNT; index++) this.chevrons[index].visible = false;

    // Turn arrows and stairs / lift signs at the coming manoeuvres
    const manoeuvres = state.manoeuvres || [];
    this.turnArrows.forEach((arrow, i) => {
      const m = manoeuvres[i];
      if (!m) { arrow.visible = false; return; }
      arrow.visible = true;
      arrow.position.set(m.point[0], 0.03, -m.point[1]);
      if (m.kind === 'stairs' || m.kind === 'lift') {
        arrow.rotation.y = 0;
        arrow.userData.setKind(m.kind);
      } else {
        arrow.userData.setKind('turn');
        // Arrow tip (+Z) along the new direction (plan bearing → local yaw)
        const b = m.bearing * Math.PI / 180;
        arrow.rotation.y = Math.atan2(Math.sin(b), -Math.cos(b));
      }
    });
  }

  #updateDestination(state) {
    const place = this.destination;
    if (!place || !this.destinationPin) return;
    const visible = place.level === state.position.level && state.remaining !== undefined && state.remaining < 40;
    this.destinationPin.visible = visible;
    if (visible) {
      this.destinationPin.position.set(place.x, 0, -place.y);
      this.destinationPin.children[1].position.y = 1.9 + Math.sin(performance.now() / 300) * 0.08;
    }
  }

  // ===========================================================================
  // Tap: anchored arrow oriented along the route (cahier des charges)
  // ===========================================================================

  async #placeArrow() {
    if (!this.lastHit || !this.guidance.started) return;
    const referenceSpace = this.renderer.xr.getReferenceSpace();
    const pose = this.lastHit.getPose(referenceSpace);
    if (!pose) return;

    if (!this.anchoredArrow) {
      this.anchoredArrow = createTurnArrow();
      this.anchoredArrow.userData.setKind('turn');
      this.scene.add(this.anchoredArrow);
    }
    const p = pose.transform.position;
    this.anchoredArrow.position.set(p.x, p.y + 0.005, p.z);

    // Bearing of the route segment closest to the tapped point
    const [cx, cy] = this.guidance.toCampus(p.x, p.z);
    const leg = this.route && this.route.legs ? (this.route.legs.find((l) => l.level === this.guidance.level) || this.route.legs[0]) : null;
    let bearing = null;
    if (leg && leg.points.length > 1) {
      const projection = projectOnPolyline(leg.points, cumulativeLengths(leg.points), cx, cy);
      const i = Math.min(projection.segment, leg.points.length - 2);
      bearing = bearingOf(leg.points[i][0], leg.points[i][1], leg.points[i + 1][0], leg.points[i + 1][1]);
    }
    if (bearing !== null) {
      const [dx, dz] = this.guidance.directionOfBearing(bearing);
      this.anchoredArrow.rotation.y = Math.atan2(dx, dz);
    }
    this.anchoredArrow.visible = true;

    try {
      if (typeof this.lastHit.createAnchor === 'function') this.anchor = await this.lastHit.createAnchor();
    } catch (error) {
      console.warn('[ar] XRAnchor unavailable; keeping the hit pose:', error);
    }
    if (bearing !== null) this.onStatus(`Flèche ancrée, orientée vers ${Math.round(bearing)}° (sens de l’itinéraire).`);
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
    for (const object of [this.reticle, this.anchoredArrow]) {
      if (!object) continue;
      this.scene.remove(object);
      disposeObject(object);
    }
    for (const child of [...this.planInner.children]) {
      this.planInner.remove(child);
      disposeObject(child);
    }
    this.reticle = null;
    this.anchoredArrow = null;
    this.anchor = null;
    this.occluders = null;
    this.occluderLevel = null;
    this.chevrons = [];
    this.turnArrows = [];
    this.destinationPin = null;
    this.lastHit = null;
    this.session = null;
    this.guidance.reset();
    this.onSessionState(false);
    if (wasActive) this.onStatus('Session AR terminée.');
  }
}

// =============================================================================
// Geometry
// =============================================================================

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function segmentAt(cumulative, d) {
  for (let i = 1; i < cumulative.length; i++) if (d <= cumulative[i]) return i - 1;
  return Math.max(0, cumulative.length - 2);
}

function createReticle() {
  const geometry = new THREE.RingGeometry(0.12, 0.16, 32);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
  mesh.visible = false;
  return mesh;
}

/** Flat chevron, tip toward +Z. */
function createChevronGeometry(size) {
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

/**
 * createTurnArrow
 * ---------------
 * Large floor arrow (1.2 m, tip toward +Z) that can also show a stairs /
 * lift sign: userData.setKind('turn' | 'stairs' | 'lift').
 */
export function createTurnArrow() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.12, 0);
  shape.lineTo(-0.12, 0.7);
  shape.lineTo(-0.32, 0.7);
  shape.lineTo(0, 1.2);
  shape.lineTo(0.32, 0.7);
  shape.lineTo(0.12, 0.7);
  shape.lineTo(0.12, 0);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0.04, -0.3);
  const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0x00d2ff, side: THREE.DoubleSide });
  const arrow = new THREE.Mesh(geometry, arrowMaterial);

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  post.position.y = 0.8;
  const sign = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 8, 24), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
  sign.position.y = 1.75;
  const group = new THREE.Group();
  group.add(arrow, post, sign);
  group.userData.setKind = (kind) => {
    const connector = kind === 'stairs' || kind === 'lift';
    arrow.visible = !connector;
    post.visible = sign.visible = connector;
    sign.material.color.setHex(kind === 'lift' ? 0x22c55e : 0xef4444);
  };
  return group;
}

function createDestinationPin() {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x00d2ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  ring.position.y = 0.02;
  const pin = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: 0x00d2ff });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 14), material);
  head.position.y = 0.35;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.4, 20), material);
  tip.rotation.x = Math.PI;
  pin.add(head, tip);
  pin.position.y = 1.9;
  group.add(ring, pin);
  return group;
}

function disposeObject(root) {
  root.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => m.dispose());
  });
}
