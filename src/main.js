/**
 * ==========================================================================
 * Module       : main.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-04
 * Modified     : 2026-11-12
 * Version      : 2.3.0 (Sprint 4 – routing, 3D route view + immersive AR)
 * Description  : Main application controller. Initializes the Three.js 3D
 *                scene (rotating cube with visible edges, ground depth grid
 *                with fog, radial ground glow, ambient + directional lights,
 *                responsive viewport handling, prefers-reduced-motion) and
 *                powers the mobile-first UI layer (accessible dialogs,
 *                status toast, network monitor, scan overlay, destination
 *                sheet), QR scanning, graph-driven destinations, Dijkstra
 *                routes, a real-time 3D route view, immersive-ar guidance,
 *                graceful 3D fallback and Service Worker registration.
 * ==========================================================================
 */

// ---------------------------------------------------------------------------
// Imports – Three.js is resolved via the import map in index.html (jsDelivr pinned)
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { QrScanner } from './scanner.js';
import { BuildingGraph } from './navigation.js';
import { ARGuide } from './ar.js';
import { FloorView3D } from './view3d.js';

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

/** @type {FloorView3D|null} Real-time 3D floor view (created on first use) */
let floorView3D = null;

/** @type {'2d'|'3d'} Current floor-plan display mode */
let mapViewMode = '2d';

/** @type {boolean} True when immersive-ar is supported on this device */
let isArSupported = false;

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

/** @type {HTMLDivElement} Interactive SVG floor plan */
const mapViewElement = document.getElementById('map-view');

/** @type {SVGSVGElement} SVG element holding the building graph */
const mapSvgElement = document.getElementById('map-svg');

/** @type {HTMLParagraphElement} Hint below the floor plan */
const mapHintElement = document.getElementById('map-hint');

/** @type {HTMLSpanElement} WebXR availability badge */
const arSupportBadgeElement = document.getElementById('ar-support-badge');

/** @type {HTMLInputElement} QR image fallback input */
const qrFileInput = document.getElementById('qr-file-input');

/** @type {HTMLDivElement} Host of the 3D floor view canvas */
const map3dElement = document.getElementById('map-3d');

/** @type {HTMLButtonElement} Switches the floor plan to 2D */
const view2dButton = document.getElementById('btn-view-2d');

/** @type {HTMLButtonElement} Switches the floor plan to 3D */
const view3dButton = document.getElementById('btn-view-3d');

/** @type {HTMLSelectElement} Start-point picker in the destination sheet */
const startSelectElement = document.getElementById('start-select');

/** @type {HTMLSpanElement} Label of the AR / 3D route button */
const startArLabelElement = document.getElementById('btn-start-ar-label');

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

    // The floor plan is an HTML/SVG view; do not render the hidden 3D canvas.
    const mapVisible = Boolean(mapViewElement && !mapViewElement.hidden);
    if (!arActive && (mapVisible || isSceneCoveredByUi())) {
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

  if (setCurrentNode(scannedKey)) {
    if ('vibrate' in navigator) {
      try { navigator.vibrate([100, 50, 100]); } catch (e) {}
    }
    const node = buildingGraph.getNode(scannedKey);
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
  if (mapViewElement) mapViewElement.inert = true;
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
  if (mapViewElement) mapViewElement.inert = false;
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
  if (mapViewElement) mapViewElement.inert = true;
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
  if (mapViewElement) mapViewElement.inert = false;

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
  AMPHI_A: { icon: '🎓', description: 'Amphithéâtre A', tag: 'RDC' },
  COULOIR_EST: { icon: '🚶', description: 'Couloir — accès B12, B14, Labo', tag: 'Couloir' },
  COULOIR_SUD: { icon: '🚶', description: 'Couloir — accès B14', tag: 'Couloir' },
  COULOIR_OUEST: { icon: '🚶', description: 'Couloir — accès B15, Administration', tag: 'Couloir' }
};

/** Presentation for a node added to building.json without visuals above. */
const DEFAULT_DESTINATION_VISUALS = { icon: '📍', description: 'Point du plan', tag: 'RDC' };

/** Circulation nodes are drawn as floor discs in 3D; every other node is a room. */
const CIRCULATION_NODE_IDS = new Set(['ENTREE', 'HALL', 'COULOIR_EST', 'COULOIR_SUD', 'COULOIR_OUEST']);

/**
 * getOrderedNodes
 * ---------------
 * Every graph node, in the DESTINATION_VISUALS order first, so the lists
 * show rooms before corridors and still include any new node.
 *
 * @returns {Array<{id:string,name:string,x:number,y:number}>} Ordered nodes.
 */
function getOrderedNodes() {
  const order = Object.keys(DESTINATION_VISUALS);
  const rank = (id) => (order.includes(id) ? order.indexOf(id) : order.length);
  return buildingGraph.getAllNodes().sort((a, b) => rank(a.id) - rank(b.id));
}

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

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Short labels keep the schematic floor plan readable on a phone. */
const MAP_SHORT_LABELS = {
  ENTREE: 'Entrée',
  HALL: 'Hall',
  SALLE_B12: 'B12',
  SALLE_B14: 'B14',
  SALLE_B15: 'B15',
  LAB_INFO: 'Labo',
  ADMIN: 'Admin',
  BIBLIO: 'Biblio',
  AMPHI_A: 'Amphi A'
};

/**
 * createSvgElement
 * ----------------
 * Small helper for the interactive floor plan.
 *
 * @param {string} tag – SVG tag name.
 * @param {Object} attributes – Attribute map.
 * @returns {SVGElement} Created element.
 */
function createSvgElement(tag, attributes) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
  return element;
}

/**
 * updateMapHint
 * -------------
 * Describes the current demo state below the map.
 */
function updateMapHint() {
  if (!mapHintElement) return;

  if (!isGraphReady) {
    mapHintElement.textContent = 'Chargement du plan du bâtiment…';
    return;
  }
  if (!currentQrNodeId) {
    mapHintElement.textContent = mapViewMode === '3d'
      ? 'Démo : touchez une salle pour simuler un scan QR · glissez pour pivoter.'
      : 'Démo : cliquez sur un nœud pour simuler un scan QR.';
    return;
  }

  const currentNode = buildingGraph.getNode(currentQrNodeId);
  if (!currentDestinationId) {
    mapHintElement.textContent =
      `Position : ${currentNode ? currentNode.name : currentQrNodeId}. Choisissez une destination.`;
    return;
  }
  if (currentRoutePath.length > 1) {
    mapHintElement.textContent =
      `Itinéraire : ${Math.round(currentRouteDistance)} m · ` +
      `${currentRoutePath.length - 1} étapes — suivez la ligne cyan.`;
    return;
  }
  mapHintElement.textContent = 'Aucun itinéraire disponible depuis cette position.';
}

/**
 * renderMap
 * ---------
 * Draws the real building graph as an interactive SVG floor plan. Nodes are
 * clickable in demo mode; the Dijkstra path is highlighted in cyan.
 */
function renderMap() {
  if (!mapSvgElement || !isGraphReady) {
    updateMapHint();
    return;
  }

  syncFloorView3D();

  const nodes = buildingGraph.getAllNodes();
  const edges = buildingGraph.getEdges();
  if (nodes.length === 0) return;

  const width = 360;
  const height = 640;
  const padding = 38;
  const minX = Math.min(...nodes.map((node) => node.x));
  const maxX = Math.max(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxY = Math.max(...nodes.map((node) => node.y));
  const scale = Math.min(
    (width - padding * 2) / Math.max(maxX - minX, 1),
    (height - padding * 2) / Math.max(maxY - minY, 1)
  );
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;

  const project = (node) => ({
    x: offsetX + (node.x - minX) * scale,
    y: height - offsetY - (node.y - minY) * scale
  });

  const positions = new Map();
  for (const node of nodes) {
    positions.set(node.id, project(node));
  }

  const routeEdges = new Set();
  for (let index = 0; index < currentRoutePath.length - 1; index++) {
    const from = currentRoutePath[index];
    const to = currentRoutePath[index + 1];
    routeEdges.add(`${from}|${to}`);
    routeEdges.add(`${to}|${from}`);
  }

  mapSvgElement.replaceChildren();

  const edgeGroup = createSvgElement('g', { 'aria-hidden': 'true' });
  for (const edge of edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;

    const line = createSvgElement('line', {
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      class: `map-edge${routeEdges.has(`${edge.from}|${edge.to}`) ? ' route' : ''}`
    });
    edgeGroup.appendChild(line);
  }
  mapSvgElement.appendChild(edgeGroup);

  const nodeGroup = createSvgElement('g', {});
  for (const node of nodes) {
    const point = positions.get(node.id);
    const group = createSvgElement('g', {
      class: [
        'map-node',
        currentQrNodeId === node.id ? 'current' : '',
        currentDestinationId === node.id ? 'destination' : ''
      ].filter(Boolean).join(' '),
      tabindex: '0',
      role: 'button',
      'data-node-id': node.id,
      'aria-label': `Se positionner à ${node.name}`
    });

    group.appendChild(createSvgElement('circle', {
      cx: point.x,
      cy: point.y,
      r: 7,
      class: 'map-node-circle'
    }));

    const isCurrent = currentQrNodeId === node.id;
    const isDestination = currentDestinationId === node.id;
    const shortLabel = MAP_SHORT_LABELS[node.id];
    const showLabel = Boolean(shortLabel) || isCurrent || isDestination;

    if (showLabel) {
      const isTopRow = Math.abs(node.y) < 1;
      const labelOnLeft = !isTopRow && node.x < 15;
      const labelX = isTopRow
        ? point.x
        : point.x + (labelOnLeft ? -11 : 11);
      const labelY = isTopRow ? point.y - 12 : point.y + 3;
      const label = createSvgElement('text', {
        x: labelX,
        y: labelY,
        class: 'map-node-label',
        'text-anchor': isTopRow ? 'middle' : (labelOnLeft ? 'end' : 'start')
      });
      label.textContent = shortLabel || node.name;
      group.appendChild(label);
    }

    nodeGroup.appendChild(group);
  }
  mapSvgElement.appendChild(nodeGroup);

  updateMapHint();
}

/**
 * setCurrentNode
 * --------------
 * Applies a graph node as the current position. Used by both a real QR scan
 * and the explicit demo click on the floor plan.
 *
 * @param {string} nodeId – Graph node ID.
 * @returns {boolean} True when the node exists.
 */
function setCurrentNode(nodeId) {
  const node = buildingGraph.getNode(nodeId);
  if (!node) return false;

  currentQrNodeId = nodeId;
  updatePositionChip();
  renderDestinationList();
  renderMap();

  if (currentDestinationId) {
    updateRouteForCurrentDestination();
  }

  return true;
}

/**
 * simulatePosition
 * ----------------
 * Demo-only entry point: clicking a graph node simulates a QR scan.
 * The label makes the simulation explicit to the jury.
 *
 * @param {string} nodeId – Graph node ID.
 */
function simulatePosition(nodeId) {
  if (!setCurrentNode(nodeId)) return;
  const node = buildingGraph.getNode(nodeId);
  showStatusToast(`Démo — vous êtes ici : ${node.name}`, 4000);
}

/**
 * setARView
 * ---------
 * Switches between the floor-plan home screen and the AR canvas.
 *
 * @param {boolean} isAR – True while an immersive-ar session is active.
 */
function setARView(isAR) {
  if (mapViewElement) mapViewElement.hidden = isAR;
  if (sceneContainer) sceneContainer.classList.toggle('is-ar-active', isAR);
  if (floorView3D) floorView3D.setActive(!isAR && mapViewMode === '3d');
}

/**
 * getRoutePanelOcclusion
 * ----------------------
 * Pixels of the 3D canvas covered by the route panel, so the 3D camera
 * centres the route in the part of the screen that stays visible.
 *
 * @returns {number} Covered height in CSS pixels.
 */
function getRoutePanelOcclusion() {
  if (!map3dElement || !routePanelElement || routePanelElement.hidden) return 0;
  const canvasRect = map3dElement.getBoundingClientRect();
  const panelRect = routePanelElement.getBoundingClientRect();
  return Math.max(0, canvasRect.bottom - panelRect.top);
}

/**
 * ensureFloorView3D
 * -----------------
 * Creates the 3D floor view on first use.
 *
 * @returns {boolean} True when the 3D view is available.
 */
function ensureFloorView3D() {
  if (floorView3D) return true;
  if (!map3dElement) return false;

  const view = new FloorView3D({
    container: map3dElement,
    labels: MAP_SHORT_LABELS,
    // Works even if the 3D view is created before building.json has loaded
    roomIds: { has: (id) => !CIRCULATION_NODE_IDS.has(id) },
    onNodeTap: (nodeId) => simulatePosition(nodeId),
    getBottomOcclusion: getRoutePanelOcclusion
  });
  if (!view.init()) return false;

  floorView3D = view;
  if (isGraphReady) {
    floorView3D.setGraph(buildingGraph.getAllNodes(), buildingGraph.getEdges());
  }
  syncFloorView3D();
  return true;
}

/**
 * syncFloorView3D
 * ---------------
 * Pushes the current position, destination and route to the 3D view.
 */
function syncFloorView3D() {
  if (!floorView3D || !isGraphReady) return;

  const names = {};
  for (const node of buildingGraph.getAllNodes()) names[node.id] = node.name;

  floorView3D.setState({
    currentId: currentQrNodeId,
    destinationId: currentDestinationId,
    path: currentRoutePath,
    names
  });
}

/**
 * setMapViewMode
 * --------------
 * Switches the floor plan between the 2D SVG graph and the 3D model.
 *
 * @param {'2d'|'3d'} mode – Requested display mode.
 * @returns {boolean} True when the requested mode is shown.
 */
function setMapViewMode(mode) {
  let nextMode = mode;
  if (nextMode === '3d' && !ensureFloorView3D()) {
    showStatusToast('Vue 3D indisponible sur ce navigateur (WebGL)', 4500);
    nextMode = '2d';
  }

  mapViewMode = nextMode;
  const is3d = mapViewMode === '3d';

  if (mapSvgElement) {
    if (is3d) mapSvgElement.setAttribute('hidden', '');
    else mapSvgElement.removeAttribute('hidden');
  }
  if (map3dElement) map3dElement.hidden = !is3d;
  if (view2dButton) view2dButton.setAttribute('aria-pressed', String(!is3d));
  if (view3dButton) view3dButton.setAttribute('aria-pressed', String(is3d));
  if (routePanelElement) routePanelElement.classList.toggle('is-compact', is3d);

  const arActive = Boolean(arGuide && arGuide.isActive);
  if (floorView3D) floorView3D.setActive(is3d && !arActive);

  updateMapHint();
  return nextMode === mode;
}

/**
 * updateStartArLabel
 * ------------------
 * The route button starts immersive-ar when supported, otherwise the 3D view.
 */
function updateStartArLabel() {
  if (startArLabelElement) {
    startArLabelElement.textContent = isArSupported ? 'Guidage AR' : 'Voir en 3D';
  }
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
  if (currentQrNodeId === destinationId) {
    distance.textContent = 'Départ';
  } else {
    distance.textContent = distanceMetres === null ? '—' : `${Math.round(distanceMetres)} m`;
  }

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
  for (const node of getOrderedNodes()) {
    const destinationId = node.id;
    const visuals = DESTINATION_VISUALS[destinationId] || DEFAULT_DESTINATION_VISUALS;

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
  if (startSelectElement) startSelectElement.value = node ? currentQrNodeId : '';
}

/**
 * renderStartOptions
 * ------------------
 * Fills the start-point picker with every graph node.
 */
function renderStartOptions() {
  if (!startSelectElement || !isGraphReady) return;

  const placeholder = startSelectElement.querySelector('option[value=""]');
  startSelectElement.replaceChildren();
  if (placeholder) startSelectElement.appendChild(placeholder);

  for (const node of getOrderedNodes()) {
    const option = document.createElement('option');
    option.value = node.id;
    option.textContent = node.name;
    startSelectElement.appendChild(option);
  }
  startSelectElement.value = currentQrNodeId || '';
}

/**
 * showRoutePanel
 * --------------
 * Reveals the floating route panel with its entry transition.
 */
function showRoutePanel() {
  if (!routePanelElement) return;
  routePanelElement.hidden = false;
  requestAnimationFrame(() => {
    routePanelElement.classList.add('is-open');
    if (floorView3D) floorView3D.resize();
  });
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
  if (floorView3D) floorView3D.resize();
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
    renderMap();
    return;
  }

  if (!currentQrNodeId) {
    routeSummaryElement.textContent = 'Scannez un QR code ou choisissez un départ pour calculer l’itinéraire.';
    showRoutePanel();
    renderMap();
    return;
  }

  const path = buildingGraph.findShortestPath(currentQrNodeId, currentDestinationId);
  if (path.length === 1) {
    routeSummaryElement.textContent = 'Vous êtes déjà sur place.';
    showRoutePanel();
    renderMap();
    return;
  }
  if (path.length < 2) {
    routeSummaryElement.textContent = 'Aucun itinéraire disponible depuis cette position.';
    showRoutePanel();
    renderMap();
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
  renderMap();
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
  setARView(isActive);
}

/**
 * startARGuide
 * ------------
 * Starts the immersive-ar arrow for the current route, or stops it.
 */
async function startARGuide() {
  if (arGuide && arGuide.isActive) {
    arGuide.stop();
    return;
  }
  if (!currentRoutePath || currentRoutePath.length < 2) {
    showStatusToast('Scannez un QR code et choisissez une destination', 4000);
    return;
  }

  const supported = arGuide ? await arGuide.isSupported() : false;
  if (!supported) {
    // No immersive-ar here: show the same route on the 3D floor model.
    if (setMapViewMode('3d')) {
      showStatusToast('AR non disponible sur cet appareil — itinéraire affiché en 3D', 5000);
    }
    return;
  }

  showStatusToast('Démarrage de la session AR…', 3000);
  setARView(true);

  try {
    await arGuide.start(currentRoutePath);
  } catch (error) {
    console.error('[main] AR session failed:', error);
    setARView(false);
    setMapViewMode('3d');
    showStatusToast('Impossible de démarrer la session AR — itinéraire affiché en 3D', 5000);
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
  // Showcase the chosen destination on the 3D floor model
  setMapViewMode('3d');
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

  // 5a. Manual start point (same effect as scanning that node's QR code)
  if (startSelectElement) {
    startSelectElement.addEventListener('change', () => {
      const nodeId = startSelectElement.value;
      if (!nodeId || !setCurrentNode(nodeId)) return;
      const node = buildingGraph.getNode(nodeId);
      showStatusToast(`Départ : ${node.name}`, 3000);
    });
  }

  // 5b. Destination items selection
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

  // 6. Floor-plan demo interaction
  if (mapSvgElement) {
    mapSvgElement.addEventListener('click', (event) => {
      const node = event.target.closest('[data-node-id]');
      if (node) simulatePosition(node.getAttribute('data-node-id'));
    });

    mapSvgElement.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const node = event.target.closest('[data-node-id]');
      if (!node) return;
      event.preventDefault();
      simulatePosition(node.getAttribute('data-node-id'));
    });
  }

  // 7. QR image fallback for desktops without a camera
  if (qrFileInput) {
    qrFileInput.addEventListener('change', async () => {
      const [file] = qrFileInput.files || [];
      if (!file) return;

      showStatusToast('Lecture du QR code…', 2500);
      try {
        const value = await qrScanner.scanImage(file);
        if (value) {
          handleQrDetection(value);
        } else {
          showStatusToast('Aucun QR code lisible dans cette image', 4000);
        }
      } catch (error) {
        console.error('[main] QR image decode failed:', error);
        showStatusToast('Impossible de lire cette image', 4000);
      } finally {
        qrFileInput.value = '';
      }
    });
  }

  // 8. 2D / 3D floor-plan toggle
  if (view2dButton) view2dButton.addEventListener('click', () => setMapViewMode('2d'));
  if (view3dButton) view3dButton.addEventListener('click', () => setMapViewMode('3d'));

  // 9. Route panel and current-position actions
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

  // 10. Global keyboard accessibility: Escape closes, Tab stays inside the dialog
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

  // 11. Online/Offline events
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

  let isRefreshing = false;

  // After a new worker claims the page, reload once so HTML and cached
  // modules always come from the same deployment.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (isRefreshing) return;
    isRefreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then((registration) => registration.update().catch(() => {}))
      .catch((error) => {
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
      renderStartOptions();
      if (floorView3D) {
        floorView3D.setGraph(buildingGraph.getAllNodes(), buildingGraph.getEdges());
      }
      renderDestinationList();
      updatePositionChip();
      renderMap();
      if (currentDestinationId) updateRouteForCurrentDestination();
      console.log('[Indoor Wayfinder] Plan du bâtiment chargé');
    })
    .catch((err) => {
      console.warn('[Indoor Wayfinder] Erreur chargement plan :', err);
      if (destinationsLoadingElement) {
        destinationsLoadingElement.style.display = 'block';
        destinationsLoadingElement.textContent = 'Plan du bâtiment indisponible.';
      }
      if (mapHintElement) mapHintElement.textContent = 'Plan du bâtiment indisponible.';
      if (arSupportBadgeElement) arSupportBadgeElement.textContent = 'AR : indisponible';
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
    cubeGroup.visible = false;
    scene.add(cubeGroup);

    const groundShadowMesh = createGroundShadow();
    groundShadowMesh.visible = false;
    scene.add(groundShadowMesh);

    createLighting(scene);
    const gridHelper = createGridHelper(scene);
    gridHelper.visible = false;

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
    showStatusToast('Plan intérieur prêt ✓', 4000);

    arGuide.isSupported().then((supported) => {
      isArSupported = supported;
      updateStartArLabel();
      if (!arSupportBadgeElement) return;
      arSupportBadgeElement.textContent = supported
        ? 'AR : disponible'
        : 'AR : non disponible';
      arSupportBadgeElement.classList.toggle('is-ready', supported);
    });

    console.log('[Indoor Wayfinder] v2.3.0 – Scene & UI initialized. Three.js r' + THREE.REVISION);
  } catch (error) {
    console.error('[Indoor Wayfinder] 3D initialization failed:', error);
    showRenderFallback('La scène 3D et le guidage AR sont désactivés sur ce navigateur.');
    showStatusToast('Mode dégradé : rendu 3D indisponible', 5000);
    updateStartArLabel();
    if (arSupportBadgeElement) {
      arSupportBadgeElement.textContent = 'AR : indisponible';
      arSupportBadgeElement.classList.remove('is-ready');
    }
  }
}

// Boot application
init();
registerServiceWorker();
