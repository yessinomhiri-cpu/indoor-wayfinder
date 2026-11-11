/**
 * ==========================================================================
 * Module       : main.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-04
 * Modified     : 2026-11-11
 * Version      : 2.1.0 (Sprint 3/4 – routing + immersive AR)
 * Description  : Main application controller. Initializes the Three.js 3D
 *                scene (rotating cube with visible edges, ground depth grid
 *                with fog, radial ground glow, ambient + directional lights,
 *                responsive viewport handling, prefers-reduced-motion) and
 *                powers the mobile-first UI layer (accessible dialogs,
 *                status toast, network monitor, scan overlay, destination
 *                sheet), QR scanning, graph-driven destinations, Dijkstra
 *                routes, immersive-ar guidance, graceful 3D fallback and
 *                Service Worker registration.
 * ==========================================================================
 */

// ---------------------------------------------------------------------------
// Imports – Three.js is resolved via the import map in index.html (jsDelivr pinned)
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { QrScanner } from './scanner.js';
import { BuildingGraph } from './navigation.js';
import { ARGuide } from './ar.js';

// ---------------------------------------------------------------------------
// Application State & Services
// ---------------------------------------------------------------------------

/** @type {BuildingGraph} Building graph model */
const buildingGraph = new BuildingGraph();

/** @type {QrScanner} Scanner engine */
const qrScanner = new QrScanner();

/** @type {string|null} ID of the active QR node calibrated in the building */
let currentQrNodeId = null;

/** @type {string|null} ID of the target destination chosen by the user */
let currentDestinationId = null;

/** @type {boolean} True once assets/building.json has been parsed */
let isGraphReady = false;

/** @type {string[]} Current Dijkstra path from the scanned node to the destination */
let currentRoutePath = [];

/** @type {number} Current route distance in metres */
let currentRouteDistance = 0;

/** @type {Object|null} Immersive AR controller (set during init) */
let arGuide = null;

/** @type {number|null} Timeout identifier for auto-dismissing status toast */
let toastDismissTimerId = null;

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------

/** @type {HTMLDivElement} Host element for the Three.js canvas */
const sceneContainer = document.getElementById('scene-container');

/** @type {HTMLDivElement} UI overlay wrapping header, toast, and action bar */
const uiOverlayElement = document.getElementById('ui-overlay');

/** @type {HTMLDivElement} Persistent banner shown when the 3D renderer fails */
const renderFallbackElement = document.getElementById('render-fallback');

/** @type {HTMLSpanElement} Message inside the 3D failure banner */
const renderFallbackMessageElement = document.getElementById('render-fallback-message');

/** @type {HTMLDivElement} Floating status toast pill */
const statusToastElement = document.getElementById('status-toast');

/** @type {HTMLSpanElement} Text label inside the status toast */
const statusMessageElement = document.getElementById('status-message');

/** @type {HTMLDivElement} Connectivity badge element */
const networkStatusBadge = document.getElementById('network-status-badge');

/** @type {HTMLSpanElement} Connectivity status text label */
const networkStatusLabel = document.getElementById('network-status-label');

/** @type {HTMLButtonElement} Primary trigger button for the scanner overlay */
const scanTriggerButton = document.getElementById('btn-scan');

/** @type {HTMLButtonElement} Secondary trigger button for destination sheet */
const destinationTriggerButton = document.getElementById('btn-destination');

/** @type {HTMLDivElement} Fullscreen scan reticle overlay */
const scanOverlayElement = document.getElementById('scan-overlay');

/** @type {HTMLVideoElement} Video preview element for camera stream */
const scanVideoElement = document.getElementById('scan-video');

/** @type {HTMLCanvasElement} Off-screen canvas for frame pixel analysis */
const scanCanvasElement = document.getElementById('scan-canvas');

/** @type {HTMLButtonElement} Close button for scan overlay */
const closeScanButton = document.getElementById('btn-close-scan');

/** @type {HTMLDivElement} Modal backdrop for destination bottom sheet */
const sheetBackdropElement = document.getElementById('sheet-backdrop');

/** @type {HTMLElement} Destination bottom sheet panel */
const destinationSheetElement = document.getElementById('destination-sheet');

/** @type {HTMLDivElement} Drag handle bar of the bottom sheet */
const sheetDragHandleBar = document.getElementById('sheet-drag-handle-bar');

/** @type {HTMLButtonElement} Close button for destination sheet */
const closeDestinationButton = document.getElementById('btn-close-destination');

/** @type {HTMLInputElement} Search input field for destination rooms */
const destinationSearchInput = document.getElementById('destination-search-input');

/** @type {HTMLDivElement} Scroll container holding destination room items */
const destinationListScroll = document.getElementById('destination-list-scroll');

/** @type {HTMLDivElement} Empty search message */
const noDestinationsFoundMsg = document.getElementById('no-destinations-found');

/** @type {HTMLParagraphElement} Loading message inside the destination sheet */
const destinationsLoadingElement = document.getElementById('destinations-loading');

/** @type {HTMLDivElement} Current-position chip above the action bar */
const positionChipElement = document.getElementById('position-chip');

/** @type {HTMLSpanElement} Name of the current graph node */
const positionLabelElement = document.getElementById('position-label');

/** @type {HTMLButtonElement} Re-scan button inside the position chip */
const rescanButton = document.getElementById('btn-rescan');

/** @type {HTMLElement} Floating route panel */
const routePanelElement = document.getElementById('route-panel');

/** @type {HTMLHeadingElement} Destination name inside the route panel */
const routeTitleElement = document.getElementById('route-title');

/** @type {HTMLParagraphElement} Distance and step count inside the route panel */
const routeSummaryElement = document.getElementById('route-summary');

/** @type {HTMLOListElement} Ordered route steps */
const routeStepsElement = document.getElementById('route-steps');

/** @type {HTMLButtonElement} Starts the immersive-ar guide */
const startArButton = document.getElementById('btn-start-ar');

/** @type {HTMLButtonElement} Closes the route panel */
const closeRouteButton = document.getElementById('btn-close-route');

/** @type {HTMLButtonElement} Re-scans a QR code from the route panel */
const rescanRouteButton = document.getElementById('btn-rescan-route');

/** @type {HTMLButtonElement} Ends the immersive-ar session */
const stopArButton = document.getElementById('btn-stop-ar');

// ---------------------------------------------------------------------------
// Three.js 3D Scene Initialization
// ---------------------------------------------------------------------------

/**
 * createScene
 * -----------
 * Builds the Three.js Scene with a deep night blue background and exponential
 * fog that smoothly fades the ground grid toward the horizon.
 *
 * @returns {THREE.Scene} The configured scene object.
 */
function createScene() {
  const scene = new THREE.Scene();
  const backgroundHex = 0x070913; // Cohesive with CSS var(--color-bg-base)

  scene.background = new THREE.Color(backgroundHex);
  // Fog creates spatial depth, blending the grid gracefully into the dark horizon
  scene.fog = new THREE.FogExp2(backgroundHex, 0.08);

  return scene;
}

/**
 * createCamera
 * ------------
 * Constructs a PerspectiveCamera calibrated for a mobile portrait viewport,
 * tilted slightly downward to preview the central object and ground grid.
 *
 * @returns {THREE.PerspectiveCamera} The configured camera.
 */
function createCamera() {
  const aspectRatio = window.innerWidth / window.innerHeight;
  const fieldOfView = 58; // Vertical FOV in degrees
  const nearClippingPlane = 0.1;
  const farClippingPlane = 80;

  const camera = new THREE.PerspectiveCamera(
    fieldOfView,
    aspectRatio,
    nearClippingPlane,
    farClippingPlane
  );

  // Position camera to observe the cube and ground grid in portrait mode
  camera.position.set(0, 2.2, 4.4);
  camera.lookAt(0, 0.9, 0);

  return camera;
}

/**
 * createRenderer
 * --------------
 * Creates the WebGLRenderer with antialiasing enabled, limits pixel ratio
 * to 2 (protecting mobile battery and frame rate), and appends canvas to DOM.
 *
 * @param {HTMLElement} container – Target DOM element for the canvas.
 * @returns {THREE.WebGLRenderer} The configured renderer.
 */
function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  });

  // Strict pixel ratio ceiling at 2 for mobile efficiency
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Keep the canvas transparent where nothing is drawn (required in AR mode)
  renderer.setClearColor(0x000000, 0);

  container.appendChild(renderer.domElement);

  return renderer;
}

/**
 * createCube
 * ----------
 * Creates a rotating cube mesh (BoxGeometry + MeshStandardMaterial) with
 * visible edge lines (EdgesGeometry + LineSegments) for a modern look.
 * Both the solid mesh and its edge wireframe are grouped together.
 *
 * @returns {THREE.Group} The cube group containing the mesh and its edges.
 */
function createCube() {
  const cubeGroup = new THREE.Group();
  cubeGroup.name = 'cubeGroup';

  // --- Solid cube mesh ---
  const cubeSize = 1.15;
  const cubeGeometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
  const cubeMaterial = new THREE.MeshStandardMaterial({
    color: 0x00d2ff,          // Cyan accent matching design system
    roughness: 0.32,
    metalness: 0.6,
    emissive: 0x003d59,
    emissiveIntensity: 0.3,
  });
  const cubeMesh = new THREE.Mesh(cubeGeometry, cubeMaterial);
  cubeGroup.add(cubeMesh);

  // --- Visible edge lines for modern aesthetic ---
  const edgesGeometry = new THREE.EdgesGeometry(cubeGeometry);
  const edgesMaterial = new THREE.LineBasicMaterial({
    color: 0x66e5ff,          // Lighter cyan for edge contrast
    transparent: true,
    opacity: 0.55,
  });
  const edgeLines = new THREE.LineSegments(edgesGeometry, edgesMaterial);
  cubeGroup.add(edgeLines);

  // Position the cube above the ground plane
  cubeGroup.position.set(0, 1.15, 0);

  return cubeGroup;
}

// ---------------------------------------------------------------------------
// Reserved: Navigation Arrow – used in Step 4 (WebXR)
// ---------------------------------------------------------------------------

/**
 * createArrow
 * -----------
 * Builds a flat, forward-pointing floor arrow from an extruded 2D shape.
 * The group origin is the arrow tail at floor level; the tip points along
 * +Z. An AR caller can place the group at a floor hit pose and yaw it
 * toward the next node with `rotation.y = Math.atan2(dx, dz)`.
 *
 * NOTE: This function is NOT called in the current build. It is reserved
 * for Sprint 4 (WebXR) where the arrow replaces the cube as the live
 * navigation indicator.
 *
 * @returns {THREE.Group} Arrow group with its origin at floor level.
 */
function createArrow() {
  const arrowAnchor = new THREE.Group();
  arrowAnchor.name = 'arrowAnchor';

  // Flat arrow outline in the XY plane, pointing along +Y (1 metre long)
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(-0.08, 0);
  arrowShape.lineTo(-0.08, 0.55);
  arrowShape.lineTo(-0.22, 0.55);
  arrowShape.lineTo(0, 1.0);
  arrowShape.lineTo(0.22, 0.55);
  arrowShape.lineTo(0.08, 0.55);
  arrowShape.lineTo(0.08, 0);
  arrowShape.closePath();

  // Extrude 4 cm, then lay the shape on the XZ floor plane (+Y becomes +Z)
  const arrowGeometry = new THREE.ExtrudeGeometry(arrowShape, {
    depth: 0.04,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 1
  });
  arrowGeometry.rotateX(Math.PI / 2);
  arrowGeometry.translate(0, 0.04, 0);

  // Unlit material: readable in AR without scene lights
  const arrowMaterial = new THREE.MeshBasicMaterial({
    color: 0x00d2ff,
    side: THREE.DoubleSide,
    toneMapped: false
  });

  const arrowMesh = new THREE.Mesh(arrowGeometry, arrowMaterial);
  arrowAnchor.add(arrowMesh);

  return arrowAnchor;
}

/**
 * createGroundShadow
 * ------------------
 * Generates a planar circular ground halo directly underneath the cube
 * using a procedural radial gradient canvas texture.
 *
 * @returns {THREE.Mesh} The ground shadow plane mesh.
 */
function createGroundShadow() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');

  // Radial gradient: cyan glow in center fading to transparent
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(0, 210, 255, 0.45)');
  gradient.addColorStop(0.35, 'rgba(0, 150, 230, 0.25)');
  gradient.addColorStop(0.75, 'rgba(10, 18, 40, 0.08)');
  gradient.addColorStop(1, 'rgba(7, 9, 19, 0)');

  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);

  const shadowTexture = new THREE.CanvasTexture(canvas);

  const shadowGeometry = new THREE.PlaneGeometry(2.8, 2.8);
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
  });

  const groundShadowMesh = new THREE.Mesh(shadowGeometry, shadowMaterial);
  groundShadowMesh.rotation.x = -Math.PI / 2;
  groundShadowMesh.position.set(0, 0.02, 0);

  return groundShadowMesh;
}

/**
 * createLighting
 * --------------
 * Adds a lightweight 2-light setup: one soft ambient fill light and one
 * directional key light to produce specular highlights on the cube faces.
 * Limited to 2 lights for mobile performance.
 *
 * @param {THREE.Scene} scene – Scene to populate with lights.
 */
function createLighting(scene) {
  // Ambient fill light – soft overall illumination
  const ambientLight = new THREE.AmbientLight(0xd5e6fb, 0.65);
  scene.add(ambientLight);

  // Directional key light – drives specular reflections on the cube
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.35);
  directionalLight.position.set(4, 9, 6);
  scene.add(directionalLight);
}

/**
 * createGridHelper
 * ----------------
 * Places a coordinate grid on the XZ floor plane. In combination with
 * scene exponential fog, it creates smooth horizon fading.
 *
 * @param {THREE.Scene} scene – Target scene.
 * @returns {THREE.GridHelper} The configured grid helper.
 */
function createGridHelper(scene) {
  const gridSize = 30;
  const gridDivisions = 30;
  const centerLineColor = 0x00d2ff; // Cyan accent for primary axis
  const gridLineColor = 0x162035;   // Subtle slate blue for grid

  const gridHelper = new THREE.GridHelper(
    gridSize,
    gridDivisions,
    centerLineColor,
    gridLineColor
  );

  gridHelper.position.set(0, 0, 0);
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = 0.55;

  scene.add(gridHelper);
  return gridHelper;
}

// ---------------------------------------------------------------------------
// Viewport & Orientation Handling
// ---------------------------------------------------------------------------

/**
 * handleWindowResize
 * ------------------
 * Synchronizes camera aspect ratio and renderer viewport dimensions whenever
 * the window is resized or device orientation changes.
 *
 * @param {THREE.PerspectiveCamera} camera – Active camera.
 * @param {THREE.WebGLRenderer} renderer – Active WebGL renderer.
 */
function handleWindowResize(camera, renderer) {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ---------------------------------------------------------------------------
// Render Animation Loop
// ---------------------------------------------------------------------------

/**
 * startAnimationLoop
 * ------------------
 * Registers the frame callback with Three.js. `setAnimationLoop` uses
 * requestAnimationFrame in normal mode and the XR frame loop inside a
 * WebXR session, which is required for immersive-ar rendering. The cube
 * rotates slowly on Y and slightly on X while floating up and down. The
 * ground shadow breathes in sync. Rendering is skipped while a modal
 * overlay covers the scene. Respects prefers-reduced-motion.
 *
 * @param {THREE.WebGLRenderer} renderer – Active renderer.
 * @param {THREE.Scene} scene – Active scene.
 * @param {THREE.PerspectiveCamera} camera – Active camera.
 * @param {THREE.Group} cubeGroup – The rotating cube group.
 * @param {THREE.Mesh} groundShadowMesh – The ground halo mesh.
 */
function startAnimationLoop(renderer, scene, camera, cubeGroup, groundShadowMesh) {
  const clock = new THREE.Clock();
  const baseCubeAltitudeY = 1.15;
  const bobbingAmplitude = 0.1;
  const bobbingFrequency = 1.5;
  const rotationSpeedY = 0.4;  // Radians per second (slow Y rotation)
  const rotationSpeedX = 0.15; // Radians per second (slight X tilt)

  // Accessibility check for user motion preferences
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  /**
   * isSceneCoveredByUi
   * ------------------
   * Returns true while a full-screen modal hides the 3D scene.
   *
   * @returns {boolean} Whether rendering can be skipped for this frame.
   */
  function isSceneCoveredByUi() {
    return Boolean(
      (scanOverlayElement && scanOverlayElement.classList.contains('is-open')) ||
      (destinationSheetElement && destinationSheetElement.classList.contains('is-open'))
    );
  }

  /**
   * animate (inner)
   * ---------------
   * Single frame callback for the Three.js animation loop.
   *
   * @param {number} time – Elapsed time in milliseconds.
   * @param {XRFrame} frame – Current WebXR frame (undefined outside AR).
   */
  function animate(time, frame) {
    const arActive = Boolean(arGuide && arGuide.isActive);

    if (arActive && frame) {
      arGuide.update(frame);
    }

    // Keep the last frame on screen while a UI overlay is open (not in AR).
    if (!arActive && isSceneCoveredByUi()) {
      return;
    }

    const elapsedTime = clock.getElapsedTime();

    if (!reducedMotionQuery.matches) {
      // Slow rotation on Y axis + slight rotation on X
      cubeGroup.rotation.y = elapsedTime * rotationSpeedY;
      cubeGroup.rotation.x = elapsedTime * rotationSpeedX;

      // Subtle vertical floating
      const verticalOffset = Math.sin(elapsedTime * bobbingFrequency) * bobbingAmplitude;
      cubeGroup.position.y = baseCubeAltitudeY + verticalOffset;

      // Synchronized shadow breathing
      if (groundShadowMesh) {
        const shadowScale = 1.0 + verticalOffset * 0.7;
        groundShadowMesh.scale.set(shadowScale, shadowScale, 1);
        groundShadowMesh.material.opacity = 0.75 - verticalOffset * 0.8;
      }
    }

    renderer.render(scene, camera);
  }

  // Kick off the loop (rAF normally, XR frames when a WebXR session is active)
  renderer.setAnimationLoop(animate);
}

// ---------------------------------------------------------------------------
// UI Interactions: Discreet Status Toast
// ---------------------------------------------------------------------------

/**
 * showStatusToast
 * ---------------
 * Displays the discreet status toast under the header with a message and
 * auto-hides it after the specified duration.
 *
 * @param {string} message – Status message to display.
 * @param {number} durationMs – Time in milliseconds before fading out.
 */
function showStatusToast(message, durationMs = 4200) {
  if (!statusToastElement || !statusMessageElement) return;

  statusMessageElement.textContent = message;
  statusToastElement.classList.remove('toast-hidden');

  if (toastDismissTimerId) {
    clearTimeout(toastDismissTimerId);
  }

  toastDismissTimerId = window.setTimeout(() => {
    statusToastElement.classList.add('toast-hidden');
    toastDismissTimerId = null;
  }, durationMs);
}

// ---------------------------------------------------------------------------
// Accessibility: Modal Focus Management
// ---------------------------------------------------------------------------

/**
 * showRenderFallback
 * ------------------
 * Reveals the persistent 3D failure banner with a readable explanation.
 *
 * @param {string} message – User-facing fallback message.
 */
function showRenderFallback(message) {
  if (renderFallbackMessageElement && message) {
    renderFallbackMessageElement.textContent = message;
  }
  if (renderFallbackElement) {
    renderFallbackElement.hidden = false;
  }
}

/** Selector for elements that can receive keyboard focus. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

/**
 * getTabbableElements
 * -------------------
 * Returns the visible, non-inert focusable elements inside a container.
 *
 * @param {HTMLElement} container – Dialog or panel to inspect.
 * @returns {HTMLElement[]} Tabbable elements in DOM order.
 */
function getTabbableElements(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.closest('[inert]')) return false;
    if (window.getComputedStyle(element).visibility === 'hidden') return false;
    return element.getClientRects().length > 0;
  });
}

/**
 * trapFocus
 * ---------
 * Keeps Tab and Shift+Tab navigation inside an open dialog.
 *
 * @param {KeyboardEvent} event – Keydown event.
 * @param {HTMLElement} container – Open dialog.
 */
function trapFocus(event, container) {
  if (event.key !== 'Tab') return;

  const tabbableElements = getTabbableElements(container);
  if (tabbableElements.length === 0) {
    event.preventDefault();
    return;
  }

  const firstElement = tabbableElements[0];
  const lastElement = tabbableElements[tabbableElements.length - 1];
  const activeElement = document.activeElement;

  if (!container.contains(activeElement)) {
    event.preventDefault();
    (event.shiftKey ? lastElement : firstElement).focus();
    return;
  }

  if (event.shiftKey && activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
  } else if (!event.shiftKey && activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  }
}

// ---------------------------------------------------------------------------
// UI Interactions: Scan Reticle Overlay (Camera + QR Detection)
// ---------------------------------------------------------------------------

/**
 * handleQrDetection
 * -----------------
 * Callback invoked when a QR code is successfully decoded from camera.
 * Updates current position and closes scanner overlay.
 *
 * @param {string} rawQrCode - Scanned QR code value.
 */
function handleQrDetection(rawQrCode) {
  const scannedKey = (rawQrCode || '').trim().toUpperCase();
  console.log('[main] QR Code détecté :', scannedKey);

  const node = buildingGraph.getNode(scannedKey);
  if (node) {
    currentQrNodeId = scannedKey;
    updatePositionChip();
    renderDestinationList();
    if (currentDestinationId) {
      updateRouteForCurrentDestination();
    }
    if ('vibrate' in navigator) {
      try { navigator.vibrate([100, 50, 100]); } catch (e) {}
    }
    showStatusToast(`📍 Vous êtes ici : ${node.name}`, 6000);
    closeScanOverlay();
  } else if (!isGraphReady) {
    showStatusToast('Plan du bâtiment en cours de chargement…', 3000);
  } else {
    showStatusToast(`⚠️ QR code inconnu : ${scannedKey}`, 3000);
  }
}

/**
 * openScanOverlay
 * ---------------
 * Displays the scan viewfinder overlay, starts the camera feed, and activates
 * the QR code detection loop.
 */
async function openScanOverlay() {
  if (!scanOverlayElement) return;

  if (uiOverlayElement) uiOverlayElement.inert = true;
  if (destinationSheetElement) destinationSheetElement.inert = true;
  scanOverlayElement.inert = false;
  scanOverlayElement.classList.add('is-open');
  scanOverlayElement.setAttribute('aria-hidden', 'false');
  if (scanTriggerButton) scanTriggerButton.setAttribute('aria-expanded', 'true');
  if (closeScanButton) {
    closeScanButton.focus();
  }

  // Start live camera QR scanner
  if (scanVideoElement && scanCanvasElement) {
    try {
      await qrScanner.start(scanVideoElement, scanCanvasElement);
    } catch (error) {
      console.warn('[main] Accès caméra refusé ou indisponible :', error);
      showStatusToast('Accès à la caméra refusé ou non disponible', 4000);
    }
  }
}

/**
 * closeScanOverlay
 * ----------------
 * Closes the scan viewfinder overlay, stops the camera, and returns focus to the scanner button.
 */
function closeScanOverlay() {
  if (!scanOverlayElement) return;

  // Stop camera feed and scanning loop
  qrScanner.stop();

  scanOverlayElement.classList.remove('is-open');
  scanOverlayElement.setAttribute('aria-hidden', 'true');
  scanOverlayElement.inert = true;
  if (uiOverlayElement) uiOverlayElement.inert = false;
  if (scanTriggerButton) {
    scanTriggerButton.setAttribute('aria-expanded', 'false');
    scanTriggerButton.focus();
  }
}

// ---------------------------------------------------------------------------
// UI Interactions: Destination Bottom Sheet Mockup
// ---------------------------------------------------------------------------

/**
 * openDestinationSheet
 * --------------------
 * Opens the destination selection bottom sheet and focuses search input.
 */
function openDestinationSheet() {
  if (!destinationSheetElement || !sheetBackdropElement) return;

  if (uiOverlayElement) uiOverlayElement.inert = true;
  if (scanOverlayElement) scanOverlayElement.inert = true;
  destinationSheetElement.inert = false;

  sheetBackdropElement.classList.add('is-open');
  sheetBackdropElement.setAttribute('aria-hidden', 'false');

  destinationSheetElement.classList.add('is-open');
  destinationSheetElement.setAttribute('aria-hidden', 'false');
  if (destinationTriggerButton) destinationTriggerButton.setAttribute('aria-expanded', 'true');

  if (destinationSearchInput) {
    destinationSearchInput.value = '';
    filterDestinations('');
    // Focus search input after transition starts
    setTimeout(() => destinationSearchInput.focus(), 150);
  }
}

/**
 * closeDestinationSheet
 * ---------------------
 * Closes the destination bottom sheet and returns focus to destination button.
 */
function closeDestinationSheet() {
  if (!destinationSheetElement || !sheetBackdropElement) return;

  destinationSheetElement.style.transform = '';

  sheetBackdropElement.classList.remove('is-open');
  sheetBackdropElement.setAttribute('aria-hidden', 'true');

  destinationSheetElement.classList.remove('is-open');
  destinationSheetElement.setAttribute('aria-hidden', 'true');
  destinationSheetElement.inert = true;
  if (uiOverlayElement) uiOverlayElement.inert = false;

  if (destinationTriggerButton) {
    destinationTriggerButton.setAttribute('aria-expanded', 'false');
    destinationTriggerButton.focus();
  }
}

/**
 * Presentation metadata for graph nodes that can be chosen as destinations.
 * Distances are always computed from the graph; nothing here is a distance.
 */
const DESTINATION_VISUALS = {
  ENTREE: { icon: '🚪', description: 'Entrée / sortie principale', tag: 'Sortie', alert: true },
  HALL: { icon: '🏛️', description: 'Hall principal et accueil', tag: 'RDC' },
  SALLE_B12: { icon: '💻', description: 'Laboratoire Réseaux & Télécoms', tag: 'RDC' },
  SALLE_B14: { icon: '📚', description: 'Salle de cours', tag: 'RDC' },
  SALLE_B15: { icon: '🧪', description: 'Salle de travaux pratiques', tag: 'RDC' },
  LAB_INFO: { icon: '🖥️', description: 'Laboratoire informatique', tag: 'RDC' },
  ADMIN: { icon: '🏢', description: 'Administration', tag: 'RDC' },
  BIBLIO: { icon: '📖', description: 'Bibliothèque', tag: 'RDC' },
  AMPHI_A: { icon: '🎓', description: 'Amphithéâtre A', tag: 'RDC' }
};

/**
 * getDestinationDistance
 * ----------------------
 * Returns the Dijkstra distance from the current QR node, or null when the
 * position is unknown or no route exists.
 *
 * @param {string} destinationId – Target graph node.
 * @returns {number|null} Distance in metres.
 */
function getDestinationDistance(destinationId) {
  if (!isGraphReady || !currentQrNodeId) {
    return null;
  }
  if (currentQrNodeId === destinationId) {
    return 0;
  }
  const path = buildingGraph.findShortestPath(currentQrNodeId, destinationId);
  if (path.length < 2) return null;
  return buildingGraph.getPathDistance(path);
}

/**
 * createDestinationItem
 * ---------------------
 * Builds one destination button from graph data + presentation metadata.
 *
 * @param {string} destinationId – Graph node ID.
 * @param {{name:string}} node – Graph node.
 * @param {Object} visuals – Icon, description and tag.
 * @returns {HTMLElement} Destination button element.
 */
function createDestinationItem(destinationId, node, visuals) {
  const item = document.createElement('article');
  item.className = 'destination-item';
  item.setAttribute('role', 'button');
  item.setAttribute('tabindex', '0');
  item.setAttribute('aria-pressed', String(currentDestinationId === destinationId));
  item.dataset.destinationId = destinationId;
  item.dataset.destinationName = node.name;

  const icon = document.createElement('div');
  icon.className = `dest-icon-badge${visuals.alert ? ' alert-type' : ''}`;
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = visuals.icon;

  const details = document.createElement('div');
  details.className = 'dest-details';

  const name = document.createElement('div');
  name.className = 'dest-name';
  name.textContent = node.name;

  const description = document.createElement('div');
  description.className = 'dest-description';
  description.textContent = visuals.description;

  details.append(name, description);

  const meta = document.createElement('div');
  meta.className = 'dest-meta';

  const tag = document.createElement('span');
  tag.className = `dest-tag${visuals.alert ? ' alert-tag' : ''}`;
  tag.textContent = visuals.tag;

  const distance = document.createElement('span');
  distance.className = 'dest-distance';
  const distanceMetres = getDestinationDistance(destinationId);
  distance.textContent = distanceMetres === null ? '—' : `${Math.round(distanceMetres)} m`;

  meta.append(tag, distance);
  item.append(icon, details, meta);

  return item;
}

/**
 * renderDestinationList
 * ---------------------
 * Replaces the hard-coded room list with destinations from building.json.
 */
function renderDestinationList() {
  if (!destinationListScroll) return;

  const query = destinationSearchInput ? destinationSearchInput.value : '';
  destinationListScroll.querySelectorAll('.destination-item').forEach((item) => item.remove());

  if (!isGraphReady) {
    if (destinationsLoadingElement) {
      destinationsLoadingElement.style.display = 'block';
      destinationsLoadingElement.textContent = 'Chargement du plan du bâtiment…';
    }
    if (noDestinationsFoundMsg) noDestinationsFoundMsg.style.display = 'none';
    return;
  }

  if (destinationsLoadingElement) destinationsLoadingElement.style.display = 'none';

  let renderedCount = 0;
  for (const [destinationId, visuals] of Object.entries(DESTINATION_VISUALS)) {
    const node = buildingGraph.getNode(destinationId);
    if (!node) continue;

    const item = createDestinationItem(destinationId, node, visuals);
    if (noDestinationsFoundMsg) {
      destinationListScroll.insertBefore(item, noDestinationsFoundMsg);
    } else {
      destinationListScroll.appendChild(item);
    }
    renderedCount++;
  }

  filterDestinations(query);

  if (noDestinationsFoundMsg) {
    noDestinationsFoundMsg.style.display = renderedCount === 0 ? 'block' : 'none';
  }
}

/**
 * filterDestinations
 * ------------------
 * Filters the list of destination rooms based on user query string.
 *
 * @param {string} query – User search string.
 */
function filterDestinations(query) {
  if (!isGraphReady) {
    if (noDestinationsFoundMsg) noDestinationsFoundMsg.style.display = 'none';
    return;
  }

  const normalizedQuery = (query || '').trim().toLowerCase();
  const items = destinationListScroll ? destinationListScroll.querySelectorAll('.destination-item') : [];
  let visibleCount = 0;

  items.forEach((item) => {
    const textContent = (item.textContent || '').toLowerCase();
    const isMatching = textContent.includes(normalizedQuery);
    item.style.display = isMatching ? 'flex' : 'none';
    if (isMatching) visibleCount++;
  });

  if (noDestinationsFoundMsg) {
    noDestinationsFoundMsg.style.display = visibleCount === 0 ? 'block' : 'none';
  }
}

/**
 * updatePositionChip
 * ------------------
 * Shows the current graph node above the action bar.
 */
function updatePositionChip() {
  const node = currentQrNodeId ? buildingGraph.getNode(currentQrNodeId) : null;
  if (positionChipElement) positionChipElement.hidden = !node;
  if (positionLabelElement) positionLabelElement.textContent = node ? node.name : '—';
}

/**
 * showRoutePanel
 * --------------
 * Reveals the floating route panel with its entry transition.
 */
function showRoutePanel() {
  if (!routePanelElement) return;
  routePanelElement.hidden = false;
  requestAnimationFrame(() => routePanelElement.classList.add('is-open'));
}

/**
 * hideRoutePanel
 * --------------
 * Hides the route panel and clears the current route.
 */
function hideRoutePanel() {
  if (!routePanelElement) return;
  routePanelElement.classList.remove('is-open');
  routePanelElement.hidden = true;
}

/**
 * addRouteStep
 * ------------
 * Appends one readable leg to the route list.
 *
 * @param {number|null} index – Step number, or null for the departure row.
 * @param {string} name – Node display name.
 * @param {number|null} distance – Leg distance in metres.
 */
function addRouteStep(index, name, distance) {
  if (!routeStepsElement) return;

  const item = document.createElement('li');
  item.className = 'route-step';

  const badge = document.createElement('span');
  badge.className = 'route-step-index';
  badge.textContent = index === null ? '•' : String(index);

  const label = document.createElement('span');
  label.className = 'route-step-name';
  label.textContent = name;

  item.append(badge, label);

  if (distance !== null) {
    const distanceLabel = document.createElement('span');
    distanceLabel.className = 'route-step-distance';
    distanceLabel.textContent = `${Math.round(distance)} m`;
    item.appendChild(distanceLabel);
  }

  routeStepsElement.appendChild(item);
}

/**
 * updateRouteForCurrentDestination
 * --------------------------------
 * Recomputes Dijkstra from the current QR node and renders the route panel.
 * This is the only place where route distances are produced.
 */
function updateRouteForCurrentDestination() {
  if (!routeTitleElement || !routeSummaryElement || !routeStepsElement) return;

  if (!currentDestinationId) {
    hideRoutePanel();
    return;
  }

  const destination = buildingGraph.getNode(currentDestinationId);
  if (!destination) {
    hideRoutePanel();
    return;
  }

  routeTitleElement.textContent = destination.name;
  routeStepsElement.replaceChildren();
  currentRoutePath = [];
  currentRouteDistance = 0;
  if (startArButton) startArButton.disabled = true;

  if (!isGraphReady) {
    routeSummaryElement.textContent = 'Chargement du plan du bâtiment…';
    showRoutePanel();
    return;
  }

  if (!currentQrNodeId) {
    routeSummaryElement.textContent = 'Scannez un QR code pour calculer l’itinéraire.';
    showRoutePanel();
    return;
  }

  const path = buildingGraph.findShortestPath(currentQrNodeId, currentDestinationId);
  if (path.length === 1) {
    routeSummaryElement.textContent = 'Vous êtes déjà sur place.';
    showRoutePanel();
    return;
  }
  if (path.length < 2) {
    routeSummaryElement.textContent = 'Aucun itinéraire disponible depuis cette position.';
    showRoutePanel();
    return;
  }

  currentRoutePath = path;
  currentRouteDistance = buildingGraph.getPathDistance(path);

  const stepCount = path.length - 1;
  routeSummaryElement.textContent =
    `${Math.round(currentRouteDistance)} m · ${stepCount} étape${stepCount > 1 ? 's' : ''}`;

  const startNode = buildingGraph.getNode(path[0]);
  addRouteStep(null, `Départ : ${startNode ? startNode.name : path[0]}`, null);

  for (let index = 1; index < path.length; index++) {
    const node = buildingGraph.getNode(path[index]);
    const legDistance = buildingGraph.getPathDistance([path[index - 1], path[index]]);
    addRouteStep(index, node ? node.name : path[index], legDistance);
  }

  if (startArButton) startArButton.disabled = false;
  showRoutePanel();
}

/**
 * updateARControls
 * ----------------
 * Swaps the start/stop AR buttons when the session state changes.
 *
 * @param {boolean} isActive – True while immersive-ar is running.
 */
function updateARControls(isActive) {
  if (startArButton) startArButton.hidden = isActive;
  if (stopArButton) stopArButton.hidden = !isActive;
}

/**
 * startARGuide
 * ------------
 * Starts the immersive-ar arrow for the current route, or stops it.
 */
async function startARGuide() {
  if (!arGuide) {
    showStatusToast('Guidage AR indisponible sur ce navigateur', 4000);
    return;
  }
  if (arGuide.isActive) {
    arGuide.stop();
    return;
  }
  if (!currentRoutePath || currentRoutePath.length < 2) {
    showStatusToast('Scannez un QR code et choisissez une destination', 4000);
    return;
  }

  const supported = await arGuide.isSupported();
  if (!supported) {
    showStatusToast('WebXR AR non supporté sur cet appareil', 5000);
    return;
  }

  showStatusToast('Démarrage de la session AR…', 3000);

  try {
    await arGuide.start(currentRoutePath);
  } catch (error) {
    console.error('[main] AR session failed:', error);
    showStatusToast('Impossible de démarrer la session AR', 4500);
  }
}

/**
 * selectDestination
 * -----------------
 * Handles destination item selection, updates application state, provides
 * toast feedback, and dismisses the bottom sheet.
 *
 * @param {string} destinationId – Unique room ID.
 * @param {string} destinationName – Human-readable room title.
 */
function selectDestination(destinationId, destinationName) {
  currentDestinationId = destinationId;

  if (destinationListScroll) {
    destinationListScroll.querySelectorAll('.destination-item').forEach((item) => {
      const isSelected = item.getAttribute('data-destination-id') === destinationId;
      item.setAttribute('aria-pressed', String(isSelected));
    });
  }

  showStatusToast(`Destination : ${destinationName}`, 4000);
  closeDestinationSheet();
  updateRouteForCurrentDestination();
}

/**
 * setupTouchDismissSheet
 * ----------------------
 * Implements mobile downward swipe-to-dismiss gesture on the bottom sheet.
 *
 * @param {HTMLElement} sheetElement – Bottom sheet element.
 * @param {HTMLElement} handleBarElement – Drag handle trigger area.
 */
function setupTouchDismissSheet(sheetElement, handleBarElement) {
  if (!sheetElement || !handleBarElement) return;

  let touchStartY = 0;
  let currentTouchY = 0;

  /** Resets the drag transform and cached touch positions. */
  function resetDragState() {
    sheetElement.style.transform = '';
    touchStartY = 0;
    currentTouchY = 0;
  }

  handleBarElement.addEventListener('touchstart', (event) => {
    touchStartY = event.touches[0].clientY;
    currentTouchY = touchStartY;
  }, { passive: true });

  handleBarElement.addEventListener('touchmove', (event) => {
    currentTouchY = event.touches[0].clientY;
    const deltaY = currentTouchY - touchStartY;
    sheetElement.style.transform = deltaY > 0
      ? `translateY(${Math.min(deltaY, 200)}px)`
      : '';
  }, { passive: true });

  handleBarElement.addEventListener('touchend', () => {
    const shouldDismiss = currentTouchY - touchStartY > 60;
    resetDragState();
    // If pulled down further than 60px, dismiss
    if (shouldDismiss) {
      closeDestinationSheet();
    }
  });

  handleBarElement.addEventListener('touchcancel', resetDragState);
}

// ---------------------------------------------------------------------------
// Network Status Monitoring
// ---------------------------------------------------------------------------

/**
 * updateNetworkStatus
 * -------------------
 * Checks navigator.onLine and updates the compact header status indicator.
 */
function updateNetworkStatus() {
  if (!networkStatusBadge || !networkStatusLabel) return;

  const isOnline = navigator.onLine;
  if (isOnline) {
    networkStatusBadge.classList.remove('is-offline');
    networkStatusLabel.textContent = 'En ligne';
  } else {
    networkStatusBadge.classList.add('is-offline');
    networkStatusLabel.textContent = 'Hors ligne';
    showStatusToast('Mode hors ligne actif', 3500);
  }
}

// ---------------------------------------------------------------------------
// UI Event Listeners Registration
// ---------------------------------------------------------------------------

/**
 * initUIEventListeners
 * ---------------------
 * Binds all interactive click, key, touch, and search listeners cleanly.
 */
function initUIEventListeners() {
  // 1. Scan overlay triggers
  if (scanTriggerButton) {
    scanTriggerButton.addEventListener('click', openScanOverlay);
  }
  if (closeScanButton) {
    closeScanButton.addEventListener('click', closeScanOverlay);
  }

  // 2. Destination bottom sheet triggers
  if (destinationTriggerButton) {
    destinationTriggerButton.addEventListener('click', openDestinationSheet);
  }
  if (closeDestinationButton) {
    closeDestinationButton.addEventListener('click', closeDestinationSheet);
  }
  if (sheetBackdropElement) {
    sheetBackdropElement.addEventListener('click', closeDestinationSheet);
  }

  // 3. Mobile swipe down gesture to dismiss sheet
  setupTouchDismissSheet(destinationSheetElement, sheetDragHandleBar);

  // 4. Destination search input
  if (destinationSearchInput) {
    destinationSearchInput.addEventListener('input', (event) => {
      filterDestinations(event.target.value);
    });
  }

  // 5. Destination items selection
  if (destinationListScroll) {
    destinationListScroll.addEventListener('click', (event) => {
      const item = event.target.closest('.destination-item');
      if (item) {
        const destId = item.getAttribute('data-destination-id');
        const destName = item.getAttribute('data-destination-name');
        selectDestination(destId, destName);
      }
    });

    destinationListScroll.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        const item = event.target.closest('.destination-item');
        if (item) {
          event.preventDefault();
          const destId = item.getAttribute('data-destination-id');
          const destName = item.getAttribute('data-destination-name');
          selectDestination(destId, destName);
        }
      }
    });
  }

  // 6. Route panel and current-position actions
  if (rescanButton) rescanButton.addEventListener('click', openScanOverlay);
  if (rescanRouteButton) rescanRouteButton.addEventListener('click', openScanOverlay);
  if (closeRouteButton) {
    closeRouteButton.addEventListener('click', () => {
      hideRoutePanel();
      if (destinationTriggerButton) destinationTriggerButton.focus();
    });
  }
  if (startArButton) startArButton.addEventListener('click', startARGuide);
  if (stopArButton) stopArButton.addEventListener('click', () => arGuide?.stop());

  // 7. Global keyboard accessibility: Escape closes, Tab stays inside the dialog
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (scanOverlayElement && scanOverlayElement.classList.contains('is-open')) {
        closeScanOverlay();
      } else if (destinationSheetElement && destinationSheetElement.classList.contains('is-open')) {
        closeDestinationSheet();
      } else if (routePanelElement && routePanelElement.classList.contains('is-open')) {
        hideRoutePanel();
      }
    } else if (event.key === 'Tab') {
      if (scanOverlayElement && scanOverlayElement.classList.contains('is-open')) {
        trapFocus(event, scanOverlayElement);
      } else if (destinationSheetElement && destinationSheetElement.classList.contains('is-open')) {
        trapFocus(event, destinationSheetElement);
      }
    }
  });

  // 8. Online/Offline events
  window.addEventListener('online', updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);
  updateNetworkStatus();
}

// ---------------------------------------------------------------------------
// PWA: Service Worker Registration
// ---------------------------------------------------------------------------

/**
 * registerServiceWorker
 * ---------------------
 * Registers the offline app-shell worker after the page has loaded.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.warn('[Indoor Wayfinder] Service worker registration failed:', error);
    });
  });
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * init
 * ----
 * Application entrypoint. Instantiates the Three.js 3D scene with a rotating
 * cube, registers resize listeners, starts the render loop, and initializes
 * UI handlers.
 */
function init() {
  // 1. Connect QR detector and load building graph
  qrScanner.onDetect((code) => handleQrDetection(code));
  buildingGraph.loadGraph('assets/building.json')
    .then(() => {
      isGraphReady = true;
      renderDestinationList();
      updatePositionChip();
      if (currentDestinationId) updateRouteForCurrentDestination();
      console.log('[Indoor Wayfinder] Plan du bâtiment chargé');
    })
    .catch((err) => {
      console.warn('[Indoor Wayfinder] Erreur chargement plan :', err);
      if (destinationsLoadingElement) {
        destinationsLoadingElement.style.display = 'block';
        destinationsLoadingElement.textContent = 'Plan du bâtiment indisponible.';
      }
    });

  // 2. Bind UI first so the shell remains usable if WebGL is unavailable
  initUIEventListeners();

  try {
    // 2. Build core Three.js components
    const scene = createScene();
    const camera = createCamera();
    const renderer = createRenderer(sceneContainer);

    // 3. Populate 3D scene elements
    const cubeGroup = createCube();
    scene.add(cubeGroup);

    const groundShadowMesh = createGroundShadow();
    scene.add(groundShadowMesh);

    createLighting(scene);
    const gridHelper = createGridHelper(scene);

    // 4. Prepare the immersive-ar controller (session starts on demand)
    arGuide = new ARGuide({
      renderer,
      scene,
      camera,
      arrowFactory: createArrow,
      demoObjects: [cubeGroup, groundShadowMesh, gridHelper],
      getDirection: (fromId, toId) => buildingGraph.getDirectionVector(fromId, toId),
      onStatus: (message) => showStatusToast(message, 5000),
      onSessionState: updateARControls
    });

    // 5. React to viewport resizing & orientation changes
    window.addEventListener('resize', () => {
      handleWindowResize(camera, renderer);
    });
    window.addEventListener('orientationchange', () => {
      setTimeout(() => handleWindowResize(camera, renderer), 100);
    });
    window.visualViewport?.addEventListener('resize', () => {
      handleWindowResize(camera, renderer);
    });

    renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      renderer.setAnimationLoop(null);
      showRenderFallback('Le contexte 3D a été perdu. Rechargez la page pour réessayer.');
    });

    // 6. Start 3D animation loop
    startAnimationLoop(renderer, scene, camera, cubeGroup, groundShadowMesh);

    // 7. Display initial discrete status toast
    showStatusToast('Scène 3D initialisée ✓', 4000);

    console.log('[Indoor Wayfinder] v2.1.0 – Scene & UI initialized. Three.js r' + THREE.REVISION);
  } catch (error) {
    console.error('[Indoor Wayfinder] 3D initialization failed:', error);
    showRenderFallback('La scène 3D et le guidage AR sont désactivés sur ce navigateur.');
    showStatusToast('Mode dégradé : rendu 3D indisponible', 5000);
  }
}

// Boot application
init();
registerServiceWorker();
