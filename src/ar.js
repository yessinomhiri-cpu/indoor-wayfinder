/**
 * ==========================================================================
 * Module       : ar.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-11
 * Modified     : 2026-11-11
 * Version      : 2.1.0 (Sprint 4 – immersive-ar hit test + floor arrow)
 * Description  : WebXR immersive-ar controller. Starts a hit-test session,
 *                places a reticle on the real floor, anchors the navigation
 *                arrow on tap, and restores the demo scene when the session
 *                ends. Three.js renders; WebXR provides the tracking.
 * ==========================================================================
 */

import * as THREE from 'three';

export class ARGuide {
  /**
   * @param {Object} options
   * @param {THREE.WebGLRenderer} options.renderer
   * @param {THREE.Scene} options.scene
   * @param {THREE.Camera} options.camera
   * @param {Function} options.arrowFactory – Returns the THREE.Group arrow.
   * @param {THREE.Object3D[]} options.demoObjects – Cube, grid and glow to hide.
   * @param {Function} options.getDirection – (fromId, toId) => {dx, dy}.
   * @param {Function} options.onStatus – User-facing status callback.
   * @param {Function} options.onSessionState – (isActive) callback.
   */
  constructor({ renderer, scene, camera, arrowFactory, demoObjects, getDirection, onStatus, onSessionState }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.arrowFactory = arrowFactory;
    this.demoObjects = demoObjects || [];
    this.getDirection = getDirection;
    this.onStatus = onStatus || (() => {});
    this.onSessionState = onSessionState || (() => {});

    this.session = null;
    this.hitTestSource = null;
    this.referenceSpace = null;
    this.viewerSpace = null;
    this.lastHit = null;
    this.reticle = null;
    this.arrow = null;
    this.anchor = null;
    this.route = [];
    this.isActive = false;
    this.savedSceneState = null;
    this.savedVisibility = new Map();
  }

  /**
   * isSupported
   * -----------
   * @returns {Promise<boolean>} True when immersive-ar can start.
   */
  async isSupported() {
    if (!navigator.xr) return false;
    try {
      return await navigator.xr.isSessionSupported('immersive-ar');
    } catch (error) {
      return false;
    }
  }

  /**
   * start
   * -----
   * Requests an immersive-ar session with hit testing, attaches it to the
   * Three.js renderer and prepares the reticle + arrow.
   *
   * @param {string[]} route – Dijkstra path; route[0] is the current node.
   */
  async start(route) {
    if (this.isActive) return;
    if (!navigator.xr) {
      throw new Error('WebXR n’est pas disponible sur ce navigateur');
    }

    const supported = await this.isSupported();
    if (!supported) {
      throw new Error('La session immersive-ar n’est pas supportée');
    }

    this.route = route || [];
    this.session = await this.#requestSession();
    this.session.addEventListener('end', () => {
      this.#handleSessionEnd();
    });

    try {
      this.renderer.xr.enabled = true;
      this.renderer.xr.setReferenceSpaceType('local-floor');
      await this.renderer.xr.setSession(this.session);
      this.referenceSpace = this.renderer.xr.getReferenceSpace();

      this.savedSceneState = {
        background: this.scene.background,
        fog: this.scene.fog
      };
      this.scene.background = null;
      this.scene.fog = null;
      this.#hideDemoObjects(true);

      this.reticle = this.#createReticle();
      this.scene.add(this.reticle);

      this.arrow = this.arrowFactory();
      this.arrow.visible = false;
      this.scene.add(this.arrow);

      this.viewerSpace = await this.session.requestReferenceSpace('viewer');
      this.hitTestSource = await this.session.requestHitTestSource({
        space: this.viewerSpace
      });
    } catch (error) {
      try {
        await this.session.end();
      } catch (endError) {
        console.warn('[ar] Could not close failed session:', endError);
      }
      throw error;
    }

    this.session.addEventListener('select', () => {
      this.#placeArrow();
    });

    this.isActive = true;
    this.onSessionState(true);
    this.onStatus('AR active : visez le sol, puis touchez pour placer la flèche.');
  }

  /**
   * update
   * ------
   * Called from the Three.js animation loop with the current XRFrame.
   * Keeps the reticle on the floor and the anchored arrow in place.
   *
   * @param {XRFrame} frame – Current WebXR frame (undefined outside AR).
   */
  update(frame) {
    if (!this.isActive || !frame || !this.hitTestSource) return;

    const referenceSpace = this.renderer.xr.getReferenceSpace() || this.referenceSpace;
    if (!referenceSpace) return;

    if (this.anchor && this.arrow) {
      const anchorPose = frame.getPose(this.anchor.anchorSpace, referenceSpace);
      if (anchorPose) {
        this.#applyFloorPose(this.arrow, anchorPose);
      }
      return;
    }

    const results = frame.getHitTestResults(this.hitTestSource);
    if (results.length > 0) {
      this.lastHit = results[0];
      const pose = this.lastHit.getPose(referenceSpace);
      if (pose && this.reticle) {
        this.reticle.visible = true;
        this.#applyFloorPose(this.reticle, pose);
      }
    } else {
      this.lastHit = null;
      if (this.reticle) this.reticle.visible = false;
    }
  }

  /**
   * stop
   * ----
   * Ends the current immersive-ar session.
   */
  stop() {
    if (this.session) {
      this.session.end();
    }
  }

  /**
   * #requestSession
   * ---------------
   * Tries DOM overlay + anchors first, then falls back to hit-test only.
   *
   * @returns {Promise<XRSession>} Active AR session.
   */
  async #requestSession() {
    const fullOptions = {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'anchors'],
      domOverlay: { root: document.body }
    };

    try {
      return await navigator.xr.requestSession('immersive-ar', fullOptions);
    } catch (error) {
      if (error && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
        throw error;
      }
      console.warn('[ar] Full AR options rejected, retrying hit-test only:', error);
      return navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test']
      });
    }
  }

  /**
   * #createReticle
   * --------------
   * @returns {THREE.Mesh} Flat cyan ring placed on the detected floor.
   */
  #createReticle() {
    const geometry = new THREE.RingGeometry(0.12, 0.16, 32);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: 0x00d2ff,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'arReticle';
    mesh.visible = false;
    return mesh;
  }

  /**
   * #placeArrow
   * -----------
   * Anchors the arrow at the last hit and points it away from the viewer.
   * Route-bearing calibration (compass/QR orientation) is a Sprint 5 item.
   */
  async #placeArrow() {
    if (!this.lastHit || !this.arrow) return;

    const referenceSpace = this.renderer.xr.getReferenceSpace() || this.referenceSpace;
    const pose = this.lastHit.getPose(referenceSpace);
    if (!pose) return;

    this.#applyFloorPose(this.arrow, pose);

    const cameraYaw = this.#getCameraForwardYaw();
    this.arrow.rotation.y = cameraYaw !== null ? cameraYaw : this.#getRouteYaw();
    this.arrow.visible = true;
    if (this.reticle) this.reticle.visible = false;

    try {
      if (typeof this.lastHit.createAnchor === 'function') {
        this.anchor = await this.lastHit.createAnchor();
      }
    } catch (error) {
      console.warn('[ar] XRAnchor unavailable; keeping the hit pose:', error);
    }

    this.onStatus('Flèche placée. Suivez la direction indiquée.');
  }

  /**
   * #getCameraForwardYaw
   * --------------------
   * @returns {number|null} Yaw that points the arrow away from the phone.
   */
  #getCameraForwardYaw() {
    const xrCamera = this.renderer.xr.getCamera();
    if (!xrCamera) return null;

    const forward = new THREE.Vector3();
    xrCamera.getWorldDirection(forward);
    forward.y = 0;

    if (forward.lengthSq() < 1e-6) return null;
    return Math.atan2(forward.x, forward.z);
  }

  /**
   * #applyFloorPose
   * ---------------
   * Copies a hit/anchor pose translation to a flat object on the floor.
   *
   * @param {THREE.Object3D} object – Arrow or reticle.
   * @param {XRPose} pose – Pose in the current reference space.
   */
  #applyFloorPose(object, pose) {
    object.position.set(
      pose.transform.position.x,
      pose.transform.position.y + 0.005,
      pose.transform.position.z
    );
  }

  /**
   * #getRouteYaw
   * ------------
   * Converts the graph direction of the first leg into a Three.js Y rotation.
   * Graph x maps to world x; graph y maps to world z.
   *
   * @returns {number} Yaw in radians.
   */
  #getRouteYaw() {
    if (!this.route || this.route.length < 2 || !this.getDirection) return 0;
    const direction = this.getDirection(this.route[0], this.route[1]);
    if (!direction) return 0;
    return Math.atan2(direction.dx, direction.dy);
  }

  /**
   * #hideDemoObjects
   * ----------------
   * @param {boolean} hidden – Whether to hide the non-AR demo objects.
   */
  #hideDemoObjects(hidden) {
    for (const object of this.demoObjects) {
      if (!object) continue;
      if (!this.savedVisibility.has(object)) {
        this.savedVisibility.set(object, object.visible);
      }
      object.visible = hidden ? false : this.savedVisibility.get(object);
    }
  }

  /**
   * #handleSessionEnd
   * -----------------
   * Cleans up XR resources and restores the normal Three.js scene.
   */
  #handleSessionEnd() {
    this.isActive = false;

    if (this.hitTestSource) {
      this.hitTestSource.cancel();
      this.hitTestSource = null;
    }

    if (this.reticle) {
      this.scene.remove(this.reticle);
      this.reticle.geometry.dispose();
      this.reticle.material.dispose();
      this.reticle = null;
    }

    if (this.arrow) {
      this.scene.remove(this.arrow);
      this.arrow.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((material) => material.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      this.arrow = null;
    }

    this.anchor = null;
    this.lastHit = null;
    this.session = null;

    if (this.savedSceneState) {
      this.scene.background = this.savedSceneState.background;
      this.scene.fog = this.savedSceneState.fog;
      this.savedSceneState = null;
    }
    this.#hideDemoObjects(false);
    this.onSessionState(false);
    this.onStatus('Session AR terminée.');
  }
}
