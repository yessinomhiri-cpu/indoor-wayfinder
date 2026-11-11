/**
 * ==========================================================================
 * Module       : scanner.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-04
 * Modified     : 2026-11-11
 * Version      : 2.1.0 (Sprint 2/3 – QR camera reader)
 * Description  : Reads QR codes from the device camera. Uses the native
 *                BarcodeDetector API when available (Chrome Android 83+),
 *                and falls back to the jsQR library loaded from jsDelivr.
 *                Emits detected QR data via a callback (Observer-style).
 * ==========================================================================
 */

// ---------------------------------------------------------------------------
// jsQR fallback – loaded from the import map in index.html
// The dynamic import avoids blocking the main thread when
// BarcodeDetector is natively available.
// ---------------------------------------------------------------------------

/** @type {Function|null} Lazy-loaded reference to the jsQR function */
let jsQRFunction = null;

/**
 * loadJsQR
 * --------
 * Dynamically imports the jsQR library from jsDelivr (version pinned in
 * the import map). Called only when BarcodeDetector is unavailable.
 *
 * @returns {Promise<Function>} The jsQR scanning function.
 */
async function loadJsQR() {
  if (jsQRFunction) return jsQRFunction;

  try {
    const module = await import('jsqr');
    jsQRFunction = module.default || module;
    console.log('[scanner] jsQR loaded as fallback');
    return jsQRFunction;
  } catch (error) {
    console.error('[scanner] Failed to load jsQR:', error);
    throw new Error('Cannot load QR scanner library');
  }
}

// ===========================================================================
// QrScanner class
// ===========================================================================

/**
 * QrScanner
 * ---------
 * Manages the camera feed and continuously scans frames for QR codes.
 *
 * Usage:
 *   const scanner = new QrScanner();
 *   scanner.onDetect((qrData) => console.log('Scanned:', qrData));
 *   await scanner.start();   // opens camera, begins scanning
 *   scanner.stop();           // releases camera
 *
 * The scanner avoids reporting the same QR code twice in a row by
 * keeping a short cooldown per code value.
 */
export class QrScanner {
  // --- DOM elements ---
  /** @type {HTMLVideoElement} Live camera feed (created internally) */
  #videoElement = null;

  /** @type {HTMLCanvasElement} Off-screen canvas for frame analysis */
  #canvasElement = null;

  /** @type {CanvasRenderingContext2D} 2D context of the canvas */
  #canvasContext = null;

  // --- Detection back-end ---
  /** @type {BarcodeDetector|null} Native detector (Chrome Android) */
  #nativeDetector = null;

  /** @type {boolean} True when using jsQR instead of BarcodeDetector */
  #useJsQrFallback = false;

  // --- State ---
  /** @type {boolean} True while the scan loop is active */
  #isScanning = false;

  /** @type {number|null} requestAnimationFrame ID (for cancellation) */
  #animationFrameId = null;

  /** @type {MediaStream|null} Active camera MediaStream */
  #mediaStream = null;

  /** @type {Function|null} Callback invoked when a QR code is read */
  #onDetectCallback = null;

  /** @type {string|null} Last detected QR value (de-duplication) */
  #lastDetectedValue = null;

  /** @type {number} Timestamp of the last detection (ms) */
  #lastDetectedTime = 0;

  /** @type {number} Minimum ms between two identical detections */
  #cooldownMs = 2000;

  /** @type {Promise<void>|null} Backend probe, awaited before start */
  #backendReady = null;

  /** @type {boolean} True while one async detection is in flight */
  #isDetecting = false;

  /** @type {number} Timestamp of the last detection attempt */
  #lastDetectionAt = 0;

  /** @type {number} Generation token used to cancel a pending start */
  #startGeneration = 0;

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  /**
   * constructor
   * -----------
   * Detects whether BarcodeDetector is available and prepares the
   * appropriate scanning back-end.
   */
  constructor() {
    this.#backendReady = this.#detectBackend();
  }

  // -----------------------------------------------------------------------
  // Back-end detection
  // -----------------------------------------------------------------------

  /**
   * #detectBackend  (private)
   * -------------------------
   * Checks the browser for native BarcodeDetector support.
   * Sets #useJsQrFallback = true if the native API is missing or
   * does not support the 'qr_code' format.
   */
  async #detectBackend() {
    if ('BarcodeDetector' in window) {
      try {
        const formats = await BarcodeDetector.getSupportedFormats();
        if (formats.includes('qr_code')) {
          this.#nativeDetector = new BarcodeDetector({
            formats: ['qr_code']
          });
          console.log('[scanner] Using native BarcodeDetector');
          return;
        }
      } catch (error) {
        console.warn('[scanner] BarcodeDetector probe failed:', error);
      }
    }

    this.#useJsQrFallback = true;
    console.log('[scanner] Will use jsQR fallback');
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * onDetect
   * --------
   * Registers a callback that fires every time a QR code is read.
   *
   * @param {Function} callback – fn(qrDataString)
   */
  onDetect(callback) {
    this.#onDetectCallback = callback;
  }

  /**
   * start
   * -----
   * Opens the rear camera, displays the feed in the given <video>
   * element, and begins the scan loop.
   *
   * @param {HTMLVideoElement} videoElement – Visible video element for
   *        the camera preview.
   * @param {HTMLCanvasElement} canvasElement – Hidden canvas used to
   *        grab pixel data from the video.
   * @throws {Error} If camera access is denied or unavailable.
   */
  async start(videoElement, canvasElement) {
    if (this.#isScanning) return; // already running

    const generation = ++this.#startGeneration;

    this.#videoElement = videoElement;
    this.#canvasElement = canvasElement;
    this.#canvasContext = canvasElement.getContext('2d', {
      willReadFrequently: true
    });
    if (!this.#canvasContext) {
      throw new Error('Contexte canvas 2D indisponible');
    }

    // Wait for the BarcodeDetector probe before choosing a backend
    await this.#backendReady;
    if (generation !== this.#startGeneration) return;

    // Load jsQR if we need the fallback
    if (this.#useJsQrFallback) {
      await loadJsQR();
    }
    if (generation !== this.#startGeneration) return;

    // Request camera access (prefer rear camera)
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',  // rear camera on mobile
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
    } catch (error) {
      console.error('[scanner] Camera access denied:', error);
      throw new Error('Accès à la caméra refusé');
    }

    // The overlay may have been closed while the permission prompt was open
    if (generation !== this.#startGeneration) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.#mediaStream = stream;

    // Connect stream to video element
    try {
      this.#videoElement.srcObject = stream;
      await this.#videoElement.play();
    } catch (error) {
      console.error('[scanner] Video playback failed:', error);
      this.#releaseMediaStream();
      throw new Error('Lecture de la caméra impossible');
    }

    if (generation !== this.#startGeneration) {
      this.#releaseMediaStream();
      return;
    }

    // Start scan loop
    this.#isScanning = true;
    this.#lastDetectedValue = null;
    this.#lastDetectionAt = 0;
    console.log('[scanner] Scanning started');
    this.#scanLoop();
  }

  /**
   * stop
   * ----
   * Stops the scan loop and releases the camera.
   */
  stop() {
    this.#startGeneration++;
    this.#isScanning = false;

    // Cancel animation frame
    if (this.#animationFrameId !== null) {
      cancelAnimationFrame(this.#animationFrameId);
      this.#animationFrameId = null;
    }

    this.#releaseMediaStream();

    console.log('[scanner] Scanning stopped');
  }

  /**
   * #releaseMediaStream
   * -------------------
   * Stops every camera track and detaches the video source.
   */
  #releaseMediaStream() {
    if (this.#mediaStream) {
      this.#mediaStream.getTracks().forEach((track) => track.stop());
      this.#mediaStream = null;
    }
    if (this.#videoElement) {
      this.#videoElement.srcObject = null;
    }
  }

  /**
   * isScanning
   * ----------
   * @returns {boolean} True if the scanner is currently active.
   */
  get isScanning() {
    return this.#isScanning;
  }

  // -----------------------------------------------------------------------
  // Private – scan loop
  // -----------------------------------------------------------------------

  /**
   * #scanLoop  (private)
   * ---------------------
   * Runs on each animation frame. Draws the current video frame onto
   * the off-screen canvas and attempts to detect a QR code.
   */
  #scanLoop() {
    if (!this.#isScanning) return;

    this.#animationFrameId = requestAnimationFrame(() => this.#scanLoop());

    // Skip if video is not ready
    if (this.#videoElement.readyState < this.#videoElement.HAVE_ENOUGH_DATA) {
      return;
    }

    const videoWidth = this.#videoElement.videoWidth;
    const videoHeight = this.#videoElement.videoHeight;
    if (!videoWidth || !videoHeight) return;

    // Detect at ~6-7 fps, not on every display frame
    const now = performance.now();
    if (this.#isDetecting || now - this.#lastDetectionAt < 150) {
      return;
    }
    this.#lastDetectionAt = now;

    // Draw the current video frame onto the hidden canvas
    if (this.#canvasElement.width !== videoWidth) {
      this.#canvasElement.width = videoWidth;
    }
    if (this.#canvasElement.height !== videoHeight) {
      this.#canvasElement.height = videoHeight;
    }
    this.#canvasContext.drawImage(this.#videoElement, 0, 0);

    this.#detectQrCode();
  }

  /**
   * #detectQrCode  (private)
   * -------------------------
   * Tries to find a QR code in the current canvas content.
   * Uses BarcodeDetector if available, otherwise jsQR.
   */
  async #detectQrCode() {
    if (this.#isDetecting) return;
    this.#isDetecting = true;

    let detectedValue = null;

    try {
      if (!this.#useJsQrFallback && this.#nativeDetector) {
        // --- Native BarcodeDetector path ---
        const barcodes = await this.#nativeDetector.detect(
          this.#canvasElement
        );
        if (barcodes.length > 0) {
          detectedValue = barcodes[0].rawValue;
        }
      } else if (jsQRFunction) {
        // --- jsQR fallback path ---
        const imageData = this.#canvasContext.getImageData(
          0,
          0,
          this.#canvasElement.width,
          this.#canvasElement.height
        );
        const result = jsQRFunction(
          imageData.data,
          imageData.width,
          imageData.height
        );
        if (result) {
          detectedValue = result.data;
        }
      }
    } catch (error) {
      // Detection errors are non-fatal — just skip this frame
    } finally {
      this.#isDetecting = false;
    }

    // If the overlay was closed while detection was in flight, ignore the result
    if (!this.#isScanning) return;

    // If a QR code was found, check cooldown and notify
    if (detectedValue) {
      this.#handleDetection(detectedValue);
    }
  }

  /**
   * #handleDetection  (private)
   * ----------------------------
   * Handles a newly detected QR value. Applies a cooldown to avoid
   * firing the callback dozens of times for the same code.
   *
   * @param {string} value – The raw QR code content.
   */
  #handleDetection(value) {
    const now = Date.now();

    // De-duplicate: ignore if same value was detected recently
    if (
      value === this.#lastDetectedValue &&
      now - this.#lastDetectedTime < this.#cooldownMs
    ) {
      return;
    }

    this.#lastDetectedValue = value;
    this.#lastDetectedTime = now;

    console.log('[scanner] QR detected:', value);

    if (this.#onDetectCallback) {
      this.#onDetectCallback(value);
    }
  }
}

