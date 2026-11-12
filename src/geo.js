/**
 * ==========================================================================
 * Module       : geo.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-12
 * Modified     : 2026-11-12
 * Version      : 3.0.0 (compass + outdoor GPS)
 * Description  : Device APIs for orientation and position (Observer
 *                pattern: subscribers are notified on every change).
 *                - Compass: true-north heading of the phone's back camera
 *                  from DeviceOrientation (absolute) events, smoothed, with
 *                  the magnetic declination of Tunis applied.
 *                - GpsTracker: Geolocation watchPosition converted to the
 *                  campus frame; used outdoors only (QR codes indoors).
 * ==========================================================================
 */

/** Magnetic declination at El Ghazala, Tunis (≈ +3.5° E in 2026). */
const DECLINATION_DEG = 3.5;
const DEG = Math.PI / 180;

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

/** @returns {string} Short cardinal (N, NE, E, SE, S, SO, O, NO). */
export function shortCardinal(heading) {
  return CARDINALS[Math.round((((heading % 360) + 360) % 360) / 45) % 8];
}

/**
 * headingFromEuler
 * ----------------
 * True-north heading (degrees) of the direction the back camera faces,
 * from W3C DeviceOrientation angles (intrinsic Z-X'-Y'', earth frame
 * x = east, y = north, z = up). When the phone lies flat the camera faces
 * the ground, so the heading of the top edge of the screen is used instead.
 *
 * @param {number} alpha
 * @param {number} beta
 * @param {number} gamma
 * @param {number} [screenAngle=0] – screen.orientation.angle.
 * @returns {number} Heading in degrees, 0 = north, clockwise (magnetic).
 */
export function headingFromEuler(alpha, beta, gamma, screenAngle = 0) {
  const cA = Math.cos(alpha * DEG); const sA = Math.sin(alpha * DEG);
  const cB = Math.cos(beta * DEG); const sB = Math.sin(beta * DEG);
  const cG = Math.cos(gamma * DEG); const sG = Math.sin(gamma * DEG);

  // Back camera = −Z of the device, expressed in the earth frame
  const east = -(cA * sG + sA * sB * cG);
  const north = -(sA * sG - cA * sB * cG);
  const up = -(cB * cG);

  let heading;
  if (Math.abs(up) < 0.85) {
    heading = Math.atan2(east, north) / DEG;
  } else {
    // Flat phone: top edge of the screen (device +Y), corrected for rotation
    heading = Math.atan2(-sA * cB, cA * cB) / DEG - screenAngle;
  }
  return ((heading % 360) + 360) % 360;
}

// ===========================================================================
// Compass
// ===========================================================================

export class Compass {
  constructor() {
    this.heading = null;       // true-north degrees, smoothed
    this.raw = null;
    this.absolute = false;
    this.listeners = new Set();
    this.started = false;
    this.lastEventTime = 0;
    this.jitter = 0;           // deg, running estimate (high = interference)
    this.#vector = { x: 0, y: 0 };
    this.#onAbsolute = (event) => this.#handle(event, true);
    this.#onRelative = (event) => this.#handle(event, false);
  }

  #vector;
  #onAbsolute;
  #onRelative;

  /** @returns {boolean} True when the browser exposes orientation events. */
  static isSupported() {
    return 'DeviceOrientationEvent' in window;
  }

  /**
   * start
   * -----
   * Must be called from a user gesture on iOS (permission prompt).
   *
   * @returns {Promise<boolean>} True when listening.
   */
  async start() {
    if (!Compass.isSupported()) return false;
    if (!this.started) {
      // Listen first: readings are used whenever the browser delivers them
      window.addEventListener('deviceorientationabsolute', this.#onAbsolute);
      window.addEventListener('deviceorientation', this.#onRelative);
      this.started = true;
    }
    const request = window.DeviceOrientationEvent && window.DeviceOrientationEvent.requestPermission;
    if (typeof request !== 'function') return true;
    try {
      // Rejects without a user gesture on iOS: the caller retries on tap
      this.permission = await request.call(window.DeviceOrientationEvent);
    } catch (error) {
      this.permission = 'prompt';
    }
    return this.permission === 'granted';
  }

  /** @type {'granted'|'denied'|'prompt'|null} last permission answer */
  permission = null;

  stop() {
    window.removeEventListener('deviceorientationabsolute', this.#onAbsolute);
    window.removeEventListener('deviceorientation', this.#onRelative);
    this.started = false;
  }

  /** @param {Function} listener – (heading, compass) on every update. */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** @returns {boolean} True when readings are recent and stable. */
  get isReliable() {
    return this.heading !== null && this.absolute && performance.now() - this.lastEventTime < 2000 && this.jitter < 12;
  }

  #handle(event, isAbsoluteEvent) {
    let magnetic = null;
    if (typeof event.webkitCompassHeading === 'number') {
      // iOS: heading of the top edge; already magnetic-north referenced
      magnetic = event.webkitCompassHeading;
      this.absolute = true;
    } else if (event.alpha !== null && (isAbsoluteEvent || event.absolute)) {
      magnetic = headingFromEuler(event.alpha, event.beta || 0, event.gamma || 0, screen.orientation ? screen.orientation.angle : 0);
      this.absolute = true;
    } else {
      // Relative readings (Chrome's plain 'deviceorientation') have no north
      // reference; Chrome sends the absolute ones as 'deviceorientationabsolute'.
      return;
    }

    const heading = (magnetic + DECLINATION_DEG + 360) % 360;
    this.raw = heading;

    // Circular low-pass filter
    const k = 0.18;
    const x = Math.sin(heading * DEG);
    const y = Math.cos(heading * DEG);
    if (this.heading === null) {
      this.#vector = { x, y };
    } else {
      this.#vector.x += (x - this.#vector.x) * k;
      this.#vector.y += (y - this.#vector.y) * k;
    }
    const smoothed = ((Math.atan2(this.#vector.x, this.#vector.y) / DEG) + 360) % 360;
    if (this.heading !== null) {
      const diff = Math.abs(((heading - smoothed + 540) % 360) - 180);
      this.jitter += (diff - this.jitter) * 0.1;
    }
    this.heading = smoothed;
    this.lastEventTime = performance.now();
    for (const listener of this.listeners) listener(this.heading, this);
  }
}

// ===========================================================================
// GPS
// ===========================================================================

export class GpsTracker {
  /**
   * @param {{toLocal:Function}} frame – Converts (lat, lon) → [x, y] metres.
   */
  constructor(frame) {
    this.frame = frame;
    this.watchId = null;
    this.fix = null;
    this.error = null;
    this.listeners = new Set();
  }

  static isSupported() {
    return 'geolocation' in navigator;
  }

  /** @param {Function} listener – (fix|null, error|null) */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get isRunning() {
    return this.watchId !== null;
  }

  start() {
    if (this.watchId !== null || !GpsTracker.isSupported()) return;
    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy, heading, speed } = position.coords;
        const [x, y] = this.frame.toLocal(latitude, longitude);
        this.fix = { lat: latitude, lon: longitude, x, y, accuracy, heading, speed, time: position.timestamp };
        this.error = null;
        this.#emit();
      },
      (error) => {
        this.error = error;
        this.#emit();
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
    );
  }

  stop() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.fix = null;
    this.#emit();
  }

  #emit() {
    for (const listener of this.listeners) listener(this.fix, this.error);
  }
}
