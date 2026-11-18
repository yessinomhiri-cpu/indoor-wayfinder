/**
 * ==========================================================================
 * Module       : camera-guide.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-18
 * Modified     : 2026-11-18
 * Version      : 3.4.0 (camera mode: compass + step counter)
 * Description  : "Caméra" guidance mode, for phones without ARCore or the
 *                WebXR/WebGPU flag. The rear camera fills the screen (like
 *                the photo app) and a transparent WebGPU canvas draws the
 *                big 3D guide arrow on top of it:
 *                - the compass (Device Orientation API) turns the arrow
 *                  towards the route, relative to where the phone points;
 *                - the accelerometer (DeviceMotion) counts steps, and each
 *                  step moves the user along the route (RouteFollower);
 *                - the phone tilt (beta) pitches the virtual camera, so the
 *                  arrow stays "in front of you" in the corridor.
 *                Without a compass (desktop + webcam), the keyboard
 *                simulates the walk: ↑ step forward, ↓ step back, ← → turn.
 *                All 3D is rendered with Three.js WebGPURenderer (gpu.js).
 * ==========================================================================
 */

import * as THREE from 'three';
import { createWebGPURenderer } from './gpu.js';
import { createGuideArrow } from './ar.js';
import { GUIDE_MODE, smoothAngle } from './ar-guidance.js';
import { StepDetector, RouteFollower } from './route-follower.js';

const DEG = Math.PI / 180;
/** Arrow in front of the virtual camera (m): 2 m ahead, 35 cm below. */
const ARROW_POSITION = new THREE.Vector3(0, -0.35, -2);
const STATE_INTERVAL_MS = 200;
const KEY_TURN_DEG = 15;

export class CameraGuide {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.root – Full-screen section (hidden when idle).
   * @param {HTMLVideoElement} options.video – Camera preview.
   * @param {HTMLElement} options.canvasHost – Receives the WebGPU canvas.
   * @param {import('./geo.js').Compass} options.compass – Heading source.
   * @param {Function} [options.onState] – (state) ≈ 5 times per second.
   * @param {Function} [options.onArrive] – () once at the destination.
   */
  constructor({ root, video, canvasHost, compass, onState, onArrive }) {
    this.root = root;
    this.video = video;
    this.canvasHost = canvasHost;
    this.compass = compass;
    this.onState = onState || (() => {});
    this.onArrive = onArrive || (() => {});

    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.arrow = null;
    this.stream = null;
    this.follower = null;
    this.stepDetector = new StepDetector();
    this.isActive = false;
    this.arrivedNotified = false;
    this.yaw = null;
    this.pitch = 0;
    this.targetPitch = 0;
    this.lastFrame = null;
    this.lastEmit = 0;
    this.motionEvents = 0;
    this.simulatedHeading = null; // keyboard walk (no compass)

    this.onMotion = (event) => this.#handleMotion(event);
    this.onOrientation = (event) => this.#handleOrientation(event);
    this.onKey = (event) => this.#handleKey(event);
    this.onResize = () => this.#resize();
  }

  /**
   * start
   * -----
   * Opens the rear camera, prepares the WebGPU overlay and starts guiding.
   *
   * @param {Object} route – CampusRouter result (found).
   * @throws {Error} name 'NotAllowedError' (camera refused) or message 'webgpu'.
   */
  async start(route) {
    if (this.isActive) return;
    this.follower = new RouteFollower(route);
    this.stepDetector.reset();
    this.arrivedNotified = false;
    this.yaw = null;
    this.lastFrame = null;
    this.motionEvents = 0;
    this.simulatedHeading = null;

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});

    if (!this.renderer) {
      this.renderer = await createWebGPURenderer({ alpha: true });
      if (!this.renderer) {
        this.#stopStream();
        throw new Error('webgpu');
      }
      this.canvasHost.appendChild(this.renderer.domElement);
      this.#buildScene();
    }

    this.root.hidden = false;
    this.arrow.userData.appear();
    this.#resize();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('devicemotion', this.onMotion);
    window.addEventListener('deviceorientation', this.onOrientation);
    window.addEventListener('keydown', this.onKey);
    if (this.compass) this.compass.start().catch(() => {});
    this.isActive = true;
    this.renderer.setAnimationLoop((time) => this.#frame(time));
  }

  /** Stops the camera, the sensors and the rendering. */
  stop() {
    if (!this.isActive) return;
    this.isActive = false;
    if (this.renderer) this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('devicemotion', this.onMotion);
    window.removeEventListener('deviceorientation', this.onOrientation);
    window.removeEventListener('keydown', this.onKey);
    this.#stopStream();
    this.root.hidden = true;
  }

  /** Stairs / lift done: continue on the next floor. */
  nextLeg() {
    return this.follower ? this.follower.nextLeg() : false;
  }

  /** @returns {Object|null} Last guidance state (position on the plan…). */
  get state() {
    return this.follower ? this.follower.state(this.#heading()) : null;
  }

  // ---------------------------------------------------------------------------

  #buildScene() {
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.8));
    const light = new THREE.DirectionalLight(0xffffff, 1.2);
    light.position.set(0.5, 2, 1);
    this.scene.add(light);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.05, 50);
    this.camera.rotation.order = 'YXZ';
    this.arrow = createGuideArrow();
    this.arrow.position.copy(ARROW_POSITION);
    this.scene.add(this.arrow);
  }

  #resize() {
    if (!this.renderer || !this.camera) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  #stopStream() {
    if (this.stream) this.stream.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }

  /** Compass heading, or the keyboard heading on a computer. */
  #heading() {
    if (this.compass && this.compass.heading !== null) return this.compass.heading;
    return this.simulatedHeading;
  }

  #handleMotion(event) {
    const a = event.accelerationIncludingGravity;
    if (!a || a.x === null || a.x === undefined) return;
    this.motionEvents++;
    const magnitude = Math.hypot(a.x, a.y || 0, a.z || 0);
    if (this.stepDetector.feed(magnitude, event.timeStamp || performance.now())) {
      this.follower.step(this.#heading());
    }
  }

  #handleOrientation(event) {
    if (event.beta === null || event.beta === undefined) return;
    // Phone upright (beta ≈ 90°) → look straight ahead; tilted down → look down
    this.targetPitch = Math.max(-60, Math.min(35, event.beta - 90)) * DEG;
  }

  /** Desktop test: ↑ step, ↓ step back, ← → turn, without compass. */
  #handleKey(event) {
    if (!this.isActive || (this.compass && this.compass.heading !== null)) return;
    const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    if (this.simulatedHeading === null) {
      const state = this.follower.state(null);
      this.simulatedHeading = state ? state.targetBearing : 0;
    }
    if (event.key === 'ArrowLeft') this.simulatedHeading = (this.simulatedHeading - KEY_TURN_DEG + 360) % 360;
    if (event.key === 'ArrowRight') this.simulatedHeading = (this.simulatedHeading + KEY_TURN_DEG) % 360;
    if (event.key === 'ArrowUp') this.follower.step(this.simulatedHeading);
    if (event.key === 'ArrowDown') this.follower.step((this.simulatedHeading + 180) % 360);
  }

  #frame(time) {
    if (!this.isActive || !this.follower) return;
    const dt = this.lastFrame === null ? 0 : Math.min(250, time - this.lastFrame);
    this.lastFrame = time;
    const heading = this.#heading();
    const state = this.follower.state(heading);
    if (!state) return;

    // Arrow: route direction relative to the phone (+ = to the right)
    const turn = state.relativeTurn * DEG;
    const yaw = Math.atan2(Math.sin(turn), -Math.cos(turn));
    this.yaw = this.yaw === null ? yaw : smoothAngle(this.yaw, yaw, dt, 180);
    const mode = state.arrived ? GUIDE_MODE.ARRIVED : heading === null ? GUIDE_MODE.CALIBRATING : GUIDE_MODE.GUIDE;
    this.arrow.rotation.y = this.yaw;
    this.arrow.position.y = ARROW_POSITION.y + (mode === GUIDE_MODE.ARRIVED ? Math.sin(time / 250) * 0.06 : 0);
    this.arrow.userData.setMode(mode, time, state.relativeTurn);

    // Virtual camera follows the phone tilt
    this.pitch += (this.targetPitch - this.pitch) * (1 - Math.exp(-dt / 150));
    this.camera.rotation.x = this.pitch;
    this.renderer.render(this.scene, this.camera);

    if (time - this.lastEmit > STATE_INTERVAL_MS) {
      this.lastEmit = time;
      this.onState({
        ...state,
        mode,
        hasCompass: Boolean(this.compass && this.compass.heading !== null),
        compassReliable: Boolean(this.compass && this.compass.isReliable),
        keyboard: this.simulatedHeading !== null,
        heading,
        motionSensor: this.motionEvents > 0
      });
    }
    if (state.arrived && !this.arrivedNotified) {
      this.arrivedNotified = true;
      this.onArrive();
    }
  }
}
