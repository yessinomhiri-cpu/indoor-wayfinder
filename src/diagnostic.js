/**
 * ==========================================================================
 * Module       : diagnostic.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-17
 * Modified     : 2026-11-26
 * Version      : 3.6.0 (WebGPU AR readiness diagnostic)
 * Description  : Checks, on the demo phone itself, every link of the WebGPU
 *                AR chain used by the app:
 *                HTTPS → Chrome Android → WebGPU adapter (xrCompatible) →
 *                GPU device → WebXR → immersive-ar (ARCore) → XRGPUBinding
 *                (chrome://flags/#webxr-webgpu-binding) → camera, QR, compass,
 *                wake lock, vibration → offline cache.
 *                The "real AR test" opens an immersive-ar session with the
 *                'webgpu' feature, exactly as Three.js r187 does
 *                (XRGPUBinding + projection layer), renders every frame with
 *                raw WebGPU and measures FPS, tracking, floor hit testing and
 *                anchors. Nothing leaves the phone: the report is only copied
 *                to the clipboard on request.
 *                The pure helpers (parseBrowser, frameStats, summarize,
 *                formatReport) are exported for the Node tests.
 * ==========================================================================
 */

export const APP_VERSION = '3.7.0';

/** Check outcomes. */
export const STATUS = Object.freeze({
  OK: 'ok',
  WARN: 'warn',
  FAIL: 'fail',
  SKIP: 'skip',
  PENDING: 'pending'
});

/** Chrome flag that exposes XRGPUBinding (WebXR rendered with WebGPU). */
export const WEBXR_WEBGPU_FLAG = 'chrome://flags/#webxr-webgpu-binding';

/** Duration of the real AR session test. */
const AR_TEST_DURATION_MS = 20000;

/** Files that must be in the Service Worker cache for the offline demo. */
const OFFLINE_REQUIRED = [
  ['Plan SUP’COM (supcom.json)', 'assets/campus/supcom.json'],
  ['Three.js r187 WebGPU', 'https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.webgpu.js'],
  ['Three.js core', 'https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.core.js'],
  ['Three.js TSL', 'https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.tsl.js'],
  ['jsQR', 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm']
];

/**
 * CHECKS
 * ------
 * Ordered list of the checks shown on the page. `blocksAr` marks the links
 * whose failure makes WebGPU AR impossible.
 */
export const CHECKS = [
  { id: 'https', group: 'Navigateur', label: 'Connexion HTTPS', blocksAr: true },
  { id: 'browser', group: 'Navigateur', label: 'Chrome sur Android', blocksAr: false },
  { id: 'webgpu-api', group: 'WebGPU', label: 'API WebGPU (navigator.gpu)', blocksAr: true },
  { id: 'webgpu-adapter', group: 'WebGPU', label: 'Adaptateur GPU compatible XR', blocksAr: true },
  { id: 'webgpu-device', group: 'WebGPU', label: 'Device GPU + rendu de test', blocksAr: true },
  { id: 'webxr-api', group: 'WebXR', label: 'API WebXR (navigator.xr)', blocksAr: true },
  { id: 'immersive-ar', group: 'WebXR', label: 'Session immersive-ar (ARCore)', blocksAr: true },
  { id: 'xrgpubinding', group: 'WebXR', label: 'Liaison WebXR ↔ WebGPU (XRGPUBinding)', blocksAr: true },
  { id: 'camera-permission', group: 'Capteurs', label: 'Autorisation caméra', blocksAr: true },
  { id: 'barcode', group: 'Capteurs', label: 'Lecture QR native (BarcodeDetector)', blocksAr: false },
  { id: 'orientation', group: 'Capteurs', label: 'Boussole (deviceorientationabsolute)', blocksAr: false },
  { id: 'wakelock', group: 'Capteurs', label: 'Écran allumé (Screen Wake Lock)', blocksAr: false },
  { id: 'vibration', group: 'Capteurs', label: 'Vibration à l’arrivée', blocksAr: false },
  { id: 'service-worker', group: 'Hors ligne', label: 'Service Worker actif', blocksAr: false },
  { id: 'offline-cache', group: 'Hors ligne', label: 'Fichiers en cache pour le hors-ligne', blocksAr: false },
  { id: 'camera-live', group: 'Tests en direct', label: 'Caméra arrière + lecture d’un QR', blocksAr: false, interactive: true },
  { id: 'compass-live', group: 'Tests en direct', label: 'Boussole en direct', blocksAr: false, interactive: true },
  { id: 'ar-session', group: 'Tests en direct', label: 'Session AR WebGPU réelle', blocksAr: false, interactive: true }
];

// ===========================================================================
// Pure helpers (tested in Node)
// ===========================================================================

/**
 * parseBrowser
 * ------------
 * @param {string} userAgent – navigator.userAgent.
 * @returns {{isAndroid:boolean, androidVersion:string|null, chromeMajor:number|null,
 *            isChrome:boolean, otherBrowser:string|null}}
 */
export function parseBrowser(userAgent) {
  const ua = String(userAgent || '');
  const android = /Android\s+([\d.]+)/.exec(ua);
  const chrome = /Chrome\/(\d+)\./.exec(ua);
  const otherBrowser = /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /EdgA?\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : null;
  return {
    isAndroid: Boolean(android),
    androidVersion: android ? android[1] : null,
    chromeMajor: chrome ? Number(chrome[1]) : null,
    isChrome: Boolean(chrome) && !otherBrowser,
    otherBrowser
  };
}

/**
 * frameStats
 * ----------
 * @param {number[]} timestamps – XR frame times in ms, in order.
 * @returns {{frames:number, fps:number, p95IntervalMs:number, longFrames:number}}
 *          longFrames counts intervals above 50 ms (visible stutter).
 */
export function frameStats(timestamps) {
  const frames = timestamps.length;
  if (frames < 2) return { frames, fps: 0, p95IntervalMs: 0, longFrames: 0 };
  const intervals = [];
  for (let i = 1; i < frames; i++) intervals.push(timestamps[i] - timestamps[i - 1]);
  const spanMs = timestamps[frames - 1] - timestamps[0];
  const sorted = [...intervals].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return {
    frames,
    fps: spanMs > 0 ? Math.round(((frames - 1) * 1000 / spanMs) * 10) / 10 : 0,
    p95IntervalMs: Math.round(p95 * 10) / 10,
    longFrames: intervals.filter((interval) => interval > 50).length
  };
}

/**
 * summarize
 * ---------
 * @param {Array<{id:string, status:string, blocksAr?:boolean}>} results
 * @returns {{level:string, title:string, blocking:Array, warnings:Array}}
 */
export function summarize(results) {
  const blocking = results.filter((result) => result.blocksAr && result.status === STATUS.FAIL);
  const warnings = results.filter((result) => result.status === STATUS.WARN);
  const session = results.find((result) => result.id === 'ar-session');
  const stillChecking = results.some((result) => !result.interactive && result.status === STATUS.PENDING);

  if (blocking.length) return { level: STATUS.FAIL, title: 'AR WebGPU impossible sur cet appareil pour l’instant', blocking, warnings };
  if (stillChecking) return { level: STATUS.PENDING, title: 'Vérification en cours…', blocking, warnings };
  if (session && session.status === STATUS.OK) return { level: STATUS.OK, title: 'AR WebGPU fonctionnelle : prêt pour la démo', blocking, warnings };
  if (session && session.status === STATUS.FAIL) return { level: STATUS.FAIL, title: 'La session AR réelle a échoué', blocking: [session], warnings };
  if (session && session.status === STATUS.WARN) return { level: STATUS.WARN, title: 'AR WebGPU fonctionne, avec des réserves', blocking, warnings };
  return { level: STATUS.PENDING, title: 'Prérequis OK : lancez le test AR réel', blocking, warnings };
}

/**
 * formatReport
 * ------------
 * @param {Array} results – Check results in display order.
 * @param {Object} meta – { date, url, userAgent, model }.
 * @returns {string} Plain-text report for the test log.
 */
export function formatReport(results, meta) {
  const tags = { ok: 'OK  ', warn: 'WARN', fail: 'FAIL', skip: 'SKIP', pending: '... ' };
  const summary = summarize(results);
  const lines = [
    `Indoor Wayfinder – diagnostic AR WebGPU (v${APP_VERSION})`,
    `Date      : ${meta.date}`,
    `URL       : ${meta.url}`,
    `Appareil  : ${meta.model || 'inconnu'}`,
    `Navigateur: ${meta.userAgent}`,
    `Verdict   : ${summary.title}`,
    ''
  ];
  for (const result of results) {
    lines.push(`[${tags[result.status] || result.status}] ${result.label}${result.detail ? ' — ' + result.detail : ''}`);
    if (result.fix && (result.status === STATUS.FAIL || result.status === STATUS.WARN)) lines.push(`        → ${result.fix}`);
  }
  return lines.join('\n');
}

/**
 * describeSessionError
 * --------------------
 * @param {*} error – requestSession() rejection.
 * @returns {string} What to fix, in French.
 */
export function describeSessionError(error) {
  const name = error && error.name ? error.name : 'Error';
  const message = error && error.message ? error.message : String(error);
  switch (name) {
    case 'NotSupportedError':
      return `Chrome refuse immersive-ar avec la fonctionnalité « webgpu » : activez ${WEBXR_WEBGPU_FLAG}, relancez Chrome, et mettez à jour Google Play Services for AR. (${message})`;
    case 'NotAllowedError':
      return `Session refusée : autorisez la caméra pour ce site (cadenas → Autorisations → Caméra). (${message})`;
    case 'SecurityError':
      return /activation/i.test(message)
        ? 'Chrome n’a pas vu le toucher : touchez à nouveau le bouton.'
        : `Bloqué par la sécurité du navigateur : ouvrez la page en HTTPS. (${message})`;
    case 'InvalidStateError':
      return 'Une autre session XR est déjà ouverte : fermez-la ou relancez Chrome.';
    default:
      return `${name} : ${message}`;
  }
}

// ===========================================================================
// Browser checks
// ===========================================================================

const ok = (detail, extra = {}) => ({ status: STATUS.OK, detail, ...extra });
const warn = (detail, fix, extra = {}) => ({ status: STATUS.WARN, detail, fix, ...extra });
const fail = (detail, fix, extra = {}) => ({ status: STATUS.FAIL, detail, fix, ...extra });
const skip = (detail) => ({ status: STATUS.SKIP, detail });

/** Shared WebGPU objects, reused by the real AR test. */
const gpuState = { adapter: null, device: null, deviceLost: null };

/** Rejects after `ms` milliseconds. */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} : délai de ${ms} ms dépassé`)), ms))
  ]);
}

/**
 * checkHttps
 * ----------
 * Camera, WebXR and the Service Worker all require a secure context.
 */
async function checkHttps() {
  return window.isSecureContext
    ? ok(`${location.protocol}//${location.host}`)
    : fail(`Page servie en ${location.protocol}`, 'Ouvrez l’adresse HTTPS de l’application (Vercel / GitHub Pages).');
}

/**
 * checkBrowser
 * ------------
 * WebGPU AR is only implemented in Chrome on Android (ARCore).
 */
async function checkBrowser(meta) {
  const browser = parseBrowser(navigator.userAgent);
  let model = '';
  try {
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      const values = await navigator.userAgentData.getHighEntropyValues(['model', 'platformVersion']);
      model = values.model || '';
    }
  } catch (error) {
    model = '';
  }
  meta.model = model;
  const description = [
    browser.isAndroid ? `Android ${browser.androidVersion}` : 'pas Android',
    browser.otherBrowser || (browser.chromeMajor ? `Chrome ${browser.chromeMajor}` : 'navigateur inconnu'),
    model
  ].filter(Boolean).join(' · ');

  if (browser.isAndroid && browser.isChrome) return ok(description);
  if (browser.otherBrowser) return warn(description, `Ouvrez le lien dans Google Chrome : ${browser.otherBrowser} n’a pas l’AR WebGPU.`);
  return warn(description, 'L’AR WebGPU de la démo vise Chrome sur Android ; sur PC, seuls la 3D et l’itinéraire seront testés.');
}

/**
 * checkWebGPUApi
 */
async function checkWebGPUApi() {
  return navigator.gpu
    ? ok('navigator.gpu présent')
    : fail('navigator.gpu absent', 'Mettez Chrome à jour (WebGPU sur Android : Chrome 121+, Android 12+). Vérifiez chrome://gpu.');
}

/**
 * checkWebGPUAdapter
 * ------------------
 * Same request as Three.js r187 (xrCompatible adapter for WebXR).
 */
async function checkWebGPUAdapter() {
  if (!navigator.gpu) return skip('WebGPU absent');
  let adapter = null;
  try {
    adapter = await withTimeout(navigator.gpu.requestAdapter({ powerPreference: 'high-performance', xrCompatible: true }), 8000, 'requestAdapter');
  } catch (error) {
    return fail(`requestAdapter a échoué : ${error.message}`, 'Relancez Chrome ; vérifiez chrome://gpu (WebGPU doit être « Hardware accelerated »).');
  }
  if (!adapter) {
    return fail('Aucun adaptateur GPU (xrCompatible)', 'GPU non pris en charge ou bloqué : vérifiez chrome://gpu, mettez Chrome à jour.');
  }
  gpuState.adapter = adapter;
  let info = adapter.info || null;
  if (!info && typeof adapter.requestAdapterInfo === 'function') {
    try { info = await withTimeout(adapter.requestAdapterInfo(), 3000, 'requestAdapterInfo'); } catch (error) { info = null; }
  }
  const isFallback = Boolean(adapter.isFallbackAdapter || (info && info.isFallbackAdapter));
  const name = info ? [info.vendor, info.architecture, info.description].filter(Boolean).join(' · ') : '';
  const detail = `${name || 'GPU'}${isFallback ? ' (rendu logiciel)' : ''}`;
  return isFallback
    ? warn(detail, 'Adaptateur logiciel : l’AR sera lente. Activez l’accélération matérielle.')
    : ok(detail);
}

/**
 * checkWebGPUDevice
 * -----------------
 * Creates the device the AR test will reuse and renders one test frame
 * (clear pass) to prove the GPU queue really works.
 */
async function checkWebGPUDevice() {
  if (!gpuState.adapter) return skip('pas d’adaptateur');
  try {
    const device = await withTimeout(gpuState.adapter.requestDevice(), 8000, 'requestDevice');
    gpuState.device = device;
    device.lost.then((info) => {
      gpuState.deviceLost = info && info.message ? info.message : 'device perdu';
      gpuState.device = null;
    });
    const started = performance.now();
    const texture = device.createTexture({
      size: [64, 64],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0.8, b: 1, a: 1 } }]
    });
    pass.end();
    device.queue.submit([encoder.finish()]);
    await withTimeout(device.queue.onSubmittedWorkDone(), 3000, 'GPU');
    texture.destroy();
    const elapsed = Math.round(performance.now() - started);
    return ok(`rendu de test en ${elapsed} ms · texture max ${device.limits.maxTextureDimension2D}px`);
  } catch (error) {
    return fail(`Device GPU inutilisable : ${error.message}`, 'Fermez les autres onglets 3D, relancez Chrome, puis rechargez cette page.');
  }
}

/**
 * checkWebXRApi
 */
async function checkWebXRApi() {
  return navigator.xr
    ? ok('navigator.xr présent')
    : fail('navigator.xr absent', 'Utilisez Chrome sur Android, en HTTPS.');
}

/**
 * checkImmersiveAr
 * ----------------
 * False here almost always means ARCore (Google Play Services for AR) is
 * missing, outdated, or the phone is not ARCore-certified.
 */
async function checkImmersiveAr() {
  if (!navigator.xr) return skip('WebXR absent');
  try {
    const supported = await withTimeout(navigator.xr.isSessionSupported('immersive-ar'), 5000, 'isSessionSupported');
    return supported
      ? ok('immersive-ar supporté')
      : fail('immersive-ar non supporté', 'Installez ou mettez à jour « Google Play Services for AR » (Play Store). Le téléphone doit être certifié ARCore.');
  } catch (error) {
    return fail(`isSessionSupported a échoué : ${error.message}`, 'Mettez à jour Chrome et Google Play Services for AR.');
  }
}

/**
 * checkXRGPUBinding
 * -----------------
 * The link the professor's WebGPU requirement depends on.
 */
async function checkXRGPUBinding() {
  if (typeof globalThis.XRGPUBinding === 'undefined') {
    return fail('XRGPUBinding absent (flag désactivé)', `Ouvrez ${WEBXR_WEBGPU_FLAG} → Enabled → Relaunch.`);
  }
  const prototype = globalThis.XRGPUBinding.prototype;
  const missing = ['createProjectionLayer', 'getViewSubImage', 'getPreferredColorFormat']
    .filter((method) => typeof prototype[method] !== 'function');
  return missing.length
    ? warn(`XRGPUBinding incomplet (manque ${missing.join(', ')})`, 'Mettez Chrome à jour : la version de la liaison est trop ancienne pour Three.js r187.')
    : ok('XRGPUBinding disponible');
}

/**
 * checkCameraPermission
 */
async function checkCameraPermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return fail('getUserMedia absent', 'Ouvrez la page en HTTPS dans Chrome.');
  }
  if (!navigator.permissions || !navigator.permissions.query) return ok('API caméra présente');
  try {
    const permission = await navigator.permissions.query({ name: 'camera' });
    if (permission.state === 'denied') {
      return fail('Caméra refusée pour ce site', 'Cadenas de la barre d’adresse → Autorisations → Caméra → Autoriser.');
    }
    return ok(permission.state === 'granted' ? 'autorisée' : 'sera demandée au premier usage');
  } catch (error) {
    return ok('API caméra présente');
  }
}

/**
 * checkBarcodeDetector
 */
async function checkBarcodeDetector() {
  if (!('BarcodeDetector' in window)) {
    return warn('BarcodeDetector absent', 'Le secours jsQR sera utilisé (un peu plus lent) : aucune action requise.');
  }
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    return formats.includes('qr_code')
      ? ok('qr_code supporté')
      : warn(`formats : ${formats.join(', ') || 'aucun'}`, 'Le secours jsQR sera utilisé.');
  } catch (error) {
    return warn(`getSupportedFormats a échoué : ${error.message}`, 'Le secours jsQR sera utilisé.');
  }
}

async function checkOrientation() {
  return 'ondeviceorientationabsolute' in window
    ? ok('événement disponible (test en direct ci-dessous)')
    : warn('deviceorientationabsolute absent', 'L’alignement AR se fera sans boussole (« Aligner sur le trajet »).');
}

async function checkWakeLock() {
  return 'wakeLock' in navigator
    ? ok('navigator.wakeLock présent')
    : warn('Wake Lock absent', 'Réglez la mise en veille de l’écran sur 5 min pendant la démo.');
}

async function checkVibration() {
  return typeof navigator.vibrate === 'function'
    ? ok('navigator.vibrate présent')
    : warn('Vibration absente', 'Aucune action : l’arrivée reste annoncée à l’écran.');
}

async function checkServiceWorker() {
  if (!('serviceWorker' in navigator)) return fail('Service Worker non supporté', 'Utilisez Chrome en HTTPS.');
  if (navigator.serviceWorker.controller) return ok('page contrôlée par sw.js');
  const registration = await withTimeout(navigator.serviceWorker.getRegistration(), 3000, 'getRegistration').catch(() => null);
  return registration
    ? warn('enregistré mais ne contrôle pas encore cette page', 'Rechargez la page une fois (en ligne).')
    : warn('aucun Service Worker', 'Ouvrez d’abord l’application (index.html) en ligne, puis revenez ici.');
}

async function checkOfflineCache() {
  if (!('caches' in window)) return skip('Cache API absente');
  const missing = [];
  for (const [label, path] of OFFLINE_REQUIRED) {
    const url = new URL(path, location.href).href;
    const match = await caches.match(url).catch(() => null);
    if (!match) missing.push(label);
  }
  let usage = '';
  try {
    const estimate = await navigator.storage.estimate();
    usage = ` · ${(estimate.usage / 1048576).toFixed(1)} Mo utilisés`;
  } catch (error) {
    usage = '';
  }
  return missing.length
    ? warn(`manquant : ${missing.join(', ')}${usage}`, 'Ouvrez l’application en ligne, attendez le chargement complet, rechargez une fois, puis refaites le diagnostic.')
    : ok(`les ${OFFLINE_REQUIRED.length} fichiers critiques sont en cache${usage}`);
}

const AUTOMATIC_CHECKS = {
  https: checkHttps,
  browser: checkBrowser,
  'webgpu-api': checkWebGPUApi,
  'webgpu-adapter': checkWebGPUAdapter,
  'webgpu-device': checkWebGPUDevice,
  'webxr-api': checkWebXRApi,
  'immersive-ar': checkImmersiveAr,
  xrgpubinding: checkXRGPUBinding,
  'camera-permission': checkCameraPermission,
  barcode: checkBarcodeDetector,
  orientation: checkOrientation,
  wakelock: checkWakeLock,
  vibration: checkVibration,
  'service-worker': checkServiceWorker,
  'offline-cache': checkOfflineCache
};

// ===========================================================================
// Page controller
// ===========================================================================

/**
 * DiagnosticPage
 * --------------
 * Runs the checks, renders them and drives the three live tests.
 */
class DiagnosticPage {
  constructor(root) {
    this.root = root;
    this.listElement = root.querySelector('#diag-list');
    this.summaryElement = root.querySelector('#diag-summary');
    this.overlayElement = document.getElementById('ar-test-overlay');
    this.meta = { date: '', url: location.href, userAgent: navigator.userAgent, model: '' };
    this.results = CHECKS.map((check) => ({ ...check, status: check.interactive ? STATUS.SKIP : STATUS.PENDING, detail: check.interactive ? 'pas encore lancé' : '', fix: '' }));
    this.arTestRunning = false;
    this.cameraStream = null;
  }

  result(id) {
    return this.results.find((result) => result.id === id);
  }

  set(id, outcome) {
    Object.assign(this.result(id), { fix: '', ...outcome });
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Automatic checks
  // ---------------------------------------------------------------------------

  async runAll() {
    this.meta.date = new Date().toLocaleString('fr-FR');
    for (const result of this.results) {
      if (result.interactive) continue;
      result.status = STATUS.PENDING;
      result.detail = '';
    }
    this.render();
    for (const check of CHECKS) {
      if (check.interactive) continue;
      try {
        this.set(check.id, await AUTOMATIC_CHECKS[check.id](this.meta));
      } catch (error) {
        this.set(check.id, fail(`erreur inattendue : ${error.message}`, 'Copiez le rapport et envoyez-le à l’équipe.'));
      }
    }
    this.updateButtons();
  }

  // ---------------------------------------------------------------------------
  // Live test 1: rear camera + QR
  // ---------------------------------------------------------------------------

  async runCameraTest() {
    const video = document.getElementById('camera-preview');
    const box = document.getElementById('camera-box');
    this.stopCamera();
    this.set('camera-live', { status: STATUS.PENDING, detail: 'ouverture de la caméra…' });
    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
    } catch (error) {
      this.set('camera-live', fail(`${error.name} : ${error.message}`, 'Autorisez la caméra pour ce site, fermez les autres applications caméra.'));
      return;
    }
    video.srcObject = this.cameraStream;
    box.hidden = false;
    await video.play().catch(() => {});
    const track = this.cameraStream.getVideoTracks()[0];
    const settings = track.getSettings();
    const resolution = `${settings.width || video.videoWidth}×${settings.height || video.videoHeight}`;
    const facing = settings.facingMode ? ` · ${settings.facingMode === 'environment' ? 'arrière' : settings.facingMode}` : '';
    this.set('camera-live', { status: STATUS.PENDING, detail: `caméra ${resolution}${facing} · montrez un QR code (15 s)…` });

    let decode;
    let engine;
    try {
      if ('BarcodeDetector' in window && (await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        engine = 'BarcodeDetector';
        decode = async () => {
          const codes = await detector.detect(video);
          return codes.length ? codes[0].rawValue : null;
        };
      } else {
        const module = await import('jsqr');
        const jsQR = module.default || module;
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        engine = 'jsQR';
        decode = async () => {
          if (!video.videoWidth) return null;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          context.drawImage(video, 0, 0);
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
          return code ? code.data : null;
        };
      }
    } catch (error) {
      this.stopCamera();
      this.set('camera-live', warn(`caméra OK (${resolution}) mais lecteur QR indisponible : ${error.message}`, 'Vérifiez la connexion pour charger jsQR une première fois.'));
      return;
    }

    const started = performance.now();
    while (this.cameraStream && performance.now() - started < 15000) {
      let value = null;
      try { value = await decode(); } catch (error) { value = null; }
      if (value) {
        const seconds = ((performance.now() - started) / 1000).toFixed(1);
        this.stopCamera();
        if (navigator.vibrate) navigator.vibrate(80);
        this.set('camera-live', ok(`caméra ${resolution}${facing} · QR lu en ${seconds} s par ${engine} : « ${value.slice(0, 60)} »`));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 160));
    }
    const stoppedByUser = !this.cameraStream;
    this.stopCamera();
    this.set('camera-live', warn(`caméra ${resolution}${facing} OK, ${stoppedByUser ? 'test arrêté' : 'aucun QR lu en 15 s'} (${engine})`, 'Imprimez un QR de docs/qr-codes, tenez-le à 30–50 cm, bien éclairé.'));
  }

  stopCamera() {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach((track) => track.stop());
      this.cameraStream = null;
    }
    const box = document.getElementById('camera-box');
    if (box) box.hidden = true;
  }

  // ---------------------------------------------------------------------------
  // Live test 2: compass
  // ---------------------------------------------------------------------------

  async runCompassTest() {
    if (!('ondeviceorientationabsolute' in window)) {
      this.set('compass-live', warn('événement absent', 'Utilisez « Aligner sur le trajet » pendant l’AR.'));
      return;
    }
    this.set('compass-live', { status: STATUS.PENDING, detail: 'tenez le téléphone à plat et tournez lentement (4 s)…' });
    const headings = [];
    const listener = (event) => {
      if (event.alpha == null) return;
      headings.push((360 - event.alpha) % 360);
    };
    window.addEventListener('deviceorientationabsolute', listener);
    await new Promise((resolve) => setTimeout(resolve, 4000));
    window.removeEventListener('deviceorientationabsolute', listener);

    if (!headings.length) {
      this.set('compass-live', warn('aucune mesure reçue', 'Capteur magnétique absent ou bloqué : l’AR utilisera l’alignement sur le trajet.'));
      return;
    }
    let swept = 0;
    for (let i = 1; i < headings.length; i++) {
      let delta = Math.abs(headings[i] - headings[i - 1]);
      if (delta > 180) delta = 360 - delta;
      swept += delta;
    }
    const last = Math.round(headings[headings.length - 1]);
    const rate = Math.round(headings.length / 4);
    const detail = `${rate} mesures/s · cap actuel ${last}° · rotation mesurée ${Math.round(swept)}°`;
    this.set('compass-live', rate < 5
      ? warn(detail, 'Fréquence faible : calibrez la boussole (geste en 8) avant la démo.')
      : ok(detail));
  }

  // ---------------------------------------------------------------------------
  // Live test 3: real WebGPU AR session
  // ---------------------------------------------------------------------------

  /**
   * runArSessionTest
   * ----------------
   * requestSession() is the FIRST asynchronous call of the tap (Chrome
   * consumes the user activation). The WebGPU device was created by the
   * automatic checks beforehand.
   */
  async runArSessionTest() {
    if (this.arTestRunning) return;
    if (!navigator.xr) { this.set('ar-session', fail('WebXR absent', 'Utilisez Chrome Android.')); return; }
    if (!gpuState.device) {
      this.set('ar-session', fail(`pas de device WebGPU${gpuState.deviceLost ? ' (' + gpuState.deviceLost + ')' : ''}`, 'Relancez le diagnostic (bouton « Relancer »).'));
      return;
    }
    if (typeof globalThis.XRGPUBinding === 'undefined') {
      this.set('ar-session', fail('XRGPUBinding absent', `Activez ${WEBXR_WEBGPU_FLAG}, puis relancez Chrome.`));
      return;
    }

    const device = gpuState.device;
    const requestedAt = performance.now();
    let session;
    try {
      session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['webgpu', 'hit-test'],
        optionalFeatures: ['local-floor', 'anchors', 'dom-overlay'],
        domOverlay: { root: this.overlayElement }
      });
    } catch (error) {
      this.set('ar-session', fail('requestSession refusée', describeSessionError(error)));
      return;
    }

    this.arTestRunning = true;
    this.updateButtons();
    const metrics = {
      startMs: Math.round(performance.now() - requestedAt),
      features: Array.from(session.enabledFeatures || []),
      referenceSpace: '',
      colorFormat: '',
      layerSize: '',
      timestamps: [],
      trackedFrames: 0,
      hitFrames: 0,
      firstHitMs: null,
      anchor: 'non testé',
      renderErrors: 0,
      firstRenderError: '',
      setupError: ''
    };
    this.overlayElement.classList.add('is-active');
    const liveElement = document.getElementById('ar-test-live');
    let step = 'XRGPUBinding';
    let binding;
    let layer;
    let referenceSpace;
    let hitTestSource = null;
    let ended = false;
    let anchorTried = false;
    let sessionStartedAt = performance.now();
    let lastOverlayUpdate = 0;

    const finish = () => {
      if (ended) return;
      ended = true;
      if (hitTestSource) { try { hitTestSource.cancel(); } catch (error) { /* already gone */ } }
      this.overlayElement.classList.remove('is-active');
      this.arTestRunning = false;
      this.reportArSession(metrics);
      this.updateButtons();
    };
    session.addEventListener('end', finish);
    const endSession = () => { session.end().catch(() => finish()); };
    document.getElementById('btn-ar-test-stop').onclick = endSession;

    try {
      binding = new globalThis.XRGPUBinding(session, device);
      step = 'getPreferredColorFormat';
      metrics.colorFormat = binding.getPreferredColorFormat();
      step = 'createProjectionLayer';
      layer = binding.createProjectionLayer({ colorFormat: metrics.colorFormat });
      metrics.layerSize = `${layer.textureWidth}×${layer.textureHeight}`;
      step = 'updateRenderState(layers)';
      session.updateRenderState({ layers: [layer] });
      step = 'requestReferenceSpace';
      for (const type of ['local-floor', 'local']) {
        try {
          referenceSpace = await session.requestReferenceSpace(type);
          metrics.referenceSpace = type;
          break;
        } catch (error) {
          referenceSpace = null;
        }
      }
      if (!referenceSpace) throw new Error('aucun espace de référence (local-floor / local)');
      step = 'requestHitTestSource';
      const viewerSpace = await session.requestReferenceSpace('viewer');
      hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
    } catch (error) {
      metrics.setupError = `${step} : ${error.name || 'Error'} ${error.message}`;
      endSession();
      return;
    }

    sessionStartedAt = performance.now();
    const onFrame = (time, frame) => {
      if (ended) return;
      session.requestAnimationFrame(onFrame);
      metrics.timestamps.push(time);

      const pose = frame.getViewerPose(referenceSpace);
      let hit = null;
      if (pose) {
        metrics.trackedFrames++;
        const hits = frame.getHitTestResults(hitTestSource);
        if (hits.length) {
          hit = hits[0];
          metrics.hitFrames++;
          if (metrics.firstHitMs === null) metrics.firstHitMs = Math.round(performance.now() - sessionStartedAt);
          if (!anchorTried && metrics.features.includes('anchors') && typeof hit.createAnchor === 'function') {
            anchorTried = true;
            metrics.anchor = 'en cours';
            hit.createAnchor()
              .then((anchor) => { metrics.anchor = 'ok'; if (anchor && anchor.delete) anchor.delete(); })
              .catch((error) => { metrics.anchor = `échec : ${error.message}`; });
          }
        }

        // Render with raw WebGPU: transparent clear, light green tint when
        // the floor is detected (premultiplied alpha).
        try {
          const encoder = device.createCommandEncoder();
          for (const view of pose.views) {
            const subImage = binding.getViewSubImage(layer, view);
            const viewDescriptor = typeof subImage.getViewDescriptor === 'function'
              ? subImage.getViewDescriptor()
              : { dimension: '2d', baseArrayLayer: subImage.imageIndex || 0, arrayLayerCount: 1 };
            const pass = encoder.beginRenderPass({
              colorAttachments: [{
                view: subImage.colorTexture.createView(viewDescriptor),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: hit ? { r: 0, g: 0.22, b: 0.1, a: 0.28 } : { r: 0, g: 0, b: 0, a: 0 }
              }]
            });
            pass.end();
          }
          device.queue.submit([encoder.finish()]);
        } catch (error) {
          metrics.renderErrors++;
          if (!metrics.firstRenderError) metrics.firstRenderError = `${error.name || 'Error'} ${error.message}`;
        }
      }

      const elapsed = performance.now() - sessionStartedAt;
      if (liveElement && time - lastOverlayUpdate > 250) {
        lastOverlayUpdate = time;
        const stats = frameStats(metrics.timestamps);
        const remaining = Math.max(0, Math.ceil((AR_TEST_DURATION_MS - elapsed) / 1000));
        liveElement.textContent = [
          `${stats.fps} img/s · suivi ${pose ? 'OK' : 'perdu'}`,
          hit ? 'Sol détecté ✔ (teinte verte)' : 'Cherche le sol : visez-le, bougez lentement',
          `Ancre : ${metrics.anchor} · fin dans ${remaining} s`
        ].join('\n');
      }
      if (elapsed > AR_TEST_DURATION_MS) endSession();
    };
    session.requestAnimationFrame(onFrame);
  }

  /**
   * reportArSession
   * ---------------
   * Turns the session metrics into a verdict.
   */
  reportArSession(metrics) {
    const stats = frameStats(metrics.timestamps);
    const tracked = stats.frames ? Math.round(metrics.trackedFrames * 100 / stats.frames) : 0;
    const parts = [
      `démarrage ${metrics.startMs} ms`,
      `${stats.fps} img/s (p95 ${stats.p95IntervalMs} ms, ${stats.longFrames} saccades)`,
      `suivi ${tracked} %`,
      metrics.firstHitMs !== null ? `sol trouvé en ${(metrics.firstHitMs / 1000).toFixed(1)} s` : 'sol jamais trouvé',
      `ancre ${metrics.anchor}`,
      `espace ${metrics.referenceSpace || '—'}`,
      `couche ${metrics.layerSize || '—'} ${metrics.colorFormat}`,
      `fonctions [${metrics.features.join(', ')}]`
    ];
    if (metrics.renderErrors) parts.push(`${metrics.renderErrors} erreurs de rendu (${metrics.firstRenderError})`);
    const detail = parts.join(' · ');

    if (metrics.setupError) {
      this.set('ar-session', fail(`session ouverte mais ${metrics.setupError}`, 'Mettez Chrome à jour : la liaison WebXR/WebGPU de cette version est incompatible. Copiez le rapport pour l’équipe.'));
      return;
    }
    if (!stats.frames) {
      this.set('ar-session', fail(`aucune image XR reçue · ${detail}`, 'Le rendu WebGPU ne démarre pas : relancez Chrome, puis retestez.'));
      return;
    }
    if (metrics.renderErrors > stats.frames / 2) {
      this.set('ar-session', fail(detail, 'Le rendu WebGPU dans la couche XR échoue : copiez le rapport pour l’équipe.'));
      return;
    }
    const problems = [];
    if (metrics.firstHitMs === null) problems.push('visez un sol texturé et bien éclairé, bougez lentement le téléphone');
    if (tracked < 60) problems.push('suivi ARCore faible : plus de lumière, évitez les murs unis');
    if (stats.fps < 24) problems.push('fluidité faible : fermez les autres applications, désactivez l’économie d’énergie');
    if (metrics.features.indexOf('dom-overlay') === -1) problems.push('dom-overlay refusé : le HUD AR sera masqué (mode simplifié)');
    if (metrics.anchor.startsWith('échec')) problems.push('ancres refusées : la flèche restera posée sans XRAnchor');
    this.set('ar-session', problems.length ? warn(detail, problems.join(' ; ') + '.') : ok(detail));
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  updateButtons() {
    const arButton = document.getElementById('btn-test-ar');
    const blocking = summarize(this.results).blocking.filter((result) => result.id !== 'ar-session');
    arButton.disabled = this.arTestRunning || blocking.length > 0 || !gpuState.device;
    arButton.title = blocking.length ? `Bloqué : ${blocking[0].label}` : '';
  }

  render() {
    const icons = { ok: '✓', warn: '!', fail: '✕', skip: '–', pending: '…' };
    const fragment = document.createDocumentFragment();
    let currentGroup = '';
    for (const result of this.results) {
      if (result.group !== currentGroup) {
        currentGroup = result.group;
        const heading = document.createElement('h2');
        heading.className = 'diag-group';
        heading.textContent = currentGroup;
        fragment.appendChild(heading);
      }
      const row = document.createElement('div');
      row.className = `diag-row is-${result.status}`;
      const icon = document.createElement('span');
      icon.className = 'diag-icon';
      icon.textContent = icons[result.status] || '?';
      icon.setAttribute('aria-label', result.status);
      const body = document.createElement('div');
      body.className = 'diag-body';
      const label = document.createElement('div');
      label.className = 'diag-label';
      label.textContent = result.label;
      const detail = document.createElement('div');
      detail.className = 'diag-detail';
      detail.textContent = result.detail || (result.status === STATUS.PENDING ? 'vérification…' : '');
      body.append(label, detail);
      if (result.fix && (result.status === STATUS.FAIL || result.status === STATUS.WARN)) {
        const fix = document.createElement('div');
        fix.className = 'diag-fix';
        fix.textContent = '→ ' + result.fix;
        body.appendChild(fix);
      }
      row.append(icon, body);
      fragment.appendChild(row);
    }
    this.listElement.replaceChildren(fragment);

    const summary = summarize(this.results);
    this.summaryElement.className = `diag-summary is-${summary.level}`;
    this.summaryElement.querySelector('#diag-summary-title').textContent = summary.title;
    const steps = this.summaryElement.querySelector('#diag-summary-steps');
    steps.replaceChildren(...summary.blocking.map((result) => {
      const item = document.createElement('li');
      item.textContent = `${result.label} : ${result.fix || result.detail}`;
      return item;
    }));
    const flagCard = document.getElementById('flag-card');
    if (flagCard) flagCard.hidden = this.result('xrgpubinding').status !== STATUS.FAIL;
  }

  async copyText(text, button) {
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copié ✓';
    } catch (error) {
      window.prompt('Copiez ce texte :', text);
    }
    setTimeout(() => { button.textContent = original; }, 1800);
  }

  bind() {
    document.getElementById('btn-rerun').addEventListener('click', () => this.runAll());
    document.getElementById('btn-test-camera').addEventListener('click', () => this.runCameraTest());
    document.getElementById('btn-stop-camera').addEventListener('click', () => this.stopCamera());
    document.getElementById('btn-test-compass').addEventListener('click', () => this.runCompassTest());
    // No await before requestSession(): the call must stay inside the tap.
    document.getElementById('btn-test-ar').addEventListener('click', () => { this.runArSessionTest(); });
    document.getElementById('btn-copy-report').addEventListener('click', (event) => {
      this.copyText(formatReport(this.results, this.meta), event.currentTarget);
    });
    document.getElementById('btn-copy-flag').addEventListener('click', (event) => {
      this.copyText(WEBXR_WEBGPU_FLAG, event.currentTarget);
    });
    this.overlayElement.addEventListener('beforexrselect', (event) => event.preventDefault());
  }
}

/**
 * init
 * ----
 * Entry point of diagnostic.html.
 */
export function init() {
  const root = document.getElementById('diag-root');
  if (!root) return;
  const page = new DiagnosticPage(root);
  page.bind();
  page.render();
  page.runAll();
  if (new URLSearchParams(location.search).has('debug')) window.__iwDiagnostic = page;
}

if (typeof document !== 'undefined') init();
