/**
 * ==========================================================================
 * Module       : main.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-04
 * Modified     : 2026-11-04
 * Version      : 1.1.0 (Week 1 – Rotating cube with edges, arrow reserved)
 * Description  : Main application controller. Initializes the Three.js 3D
 *                scene (rotating cube with visible edges, ground depth grid
 *                with fog, radial ground glow, ambient + directional lights,
 *                responsive viewport handling, prefers-reduced-motion) and
 *                powers the mobile-first UI layer (status toast, network
 *                monitor, scan overlay, destination bottom sheet).
 * ==========================================================================
 */

// ---------------------------------------------------------------------------
// Imports – Three.js is resolved via the import map in index.html (jsDelivr pinned)
// ---------------------------------------------------------------------------
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Application State (prepared for scanner.js & navigation.js integration)
// ---------------------------------------------------------------------------

/** @type {string|null} ID of the active QR node calibrated in the building */
let currentQrNodeId = null;

/** @type {string|null} ID of the target destination chosen by the user */
let currentDestinationId = null;

/** @type {number|null} Timeout identifier for auto-dismissing status toast */
let toastDismissTimerId = null;

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------

/** @type {HTMLDivElement} Host element for the Three.js canvas */
const sceneContainer = document.getElementById('scene-container');

/** @type {HTMLDivElement} UI overlay wrapping header, toast, and action bar */
const uiOverlayElement = document.getElementById('ui-overlay');

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
    alpha: false,
    powerPreference: 'high-performance'
  });

  // Strict pixel ratio ceiling at 2 for mobile efficiency
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

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
 * Generates a procedural 3D waypoint arrow (cylinder shaft + cone tip)
 * combined into a single group. Uses MeshStandardMaterial with cyan accent
 * color, subtle metallic sheen, and emissive glow.
 *
 * NOTE: This function is NOT called in the current build. It is reserved
 * for Step 4 (WebXR) where the arrow will replace the cube as the live
 * navigation indicator anchored to the AR scene.
 *
 * @returns {THREE.Group} The arrow anchor group.
 */
function createArrow() {
  const arrowAnchor = new THREE.Group();
  arrowAnchor.name = 'arrowAnchor';

  // Metallic cyan accent material matching design system
  const arrowMaterial = new THREE.MeshStandardMaterial({
    color: 0x00d2ff,
    roughness: 0.28,
    metalness: 0.65,
    emissive: 0x003d59,
    emissiveIntensity: 0.35,
  });

  // Arrow shaft: cylinder geometry
  const shaftRadius = 0.13;
  const shaftHeight = 0.9;
  const shaftGeometry = new THREE.CylinderGeometry(
    shaftRadius,
    shaftRadius,
    shaftHeight,
    32
  );
  const shaftMesh = new THREE.Mesh(shaftGeometry, arrowMaterial);
  shaftMesh.position.set(0, -0.25, 0);
  arrowAnchor.add(shaftMesh);

  // Arrow head: cone geometry
  const headRadius = 0.38;
  const headHeight = 0.7;
  const headGeometry = new THREE.ConeGeometry(headRadius, headHeight, 32);
  const headMesh = new THREE.Mesh(headGeometry, arrowMaterial);
  headMesh.position.set(0, 0.55, 0);
  arrowAnchor.add(headMesh);

  // Position arrow at comfortable eye level and tilt slightly forward
  arrowAnchor.position.set(0, 1.15, 0);
  arrowAnchor.rotation.x = 0.25;

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
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ---------------------------------------------------------------------------
// Render Animation Loop
// ---------------------------------------------------------------------------

/**
 * startAnimationLoop
 * ------------------
 * Coordinates the requestAnimationFrame loop. The cube rotates slowly on Y
 * and slightly on X while floating up and down. The ground shadow breathes
 * in sync. Respects prefers-reduced-motion.
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
   * animate (inner)
   * ---------------
   * Single frame callback for requestAnimationFrame.
   */
  function animate() {
    requestAnimationFrame(animate);

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

  // Kick off the loop
  animate();
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
// UI Interactions: Scan Reticle Overlay Mockup
// ---------------------------------------------------------------------------

/**
 * openScanOverlay
 * ---------------
 * Displays the scan viewfinder overlay and updates accessibility attributes.
 */
function openScanOverlay() {
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
}

/**
 * closeScanOverlay
 * ----------------
 * Closes the scan viewfinder overlay and returns focus to the scanner button.
 */
function closeScanOverlay() {
  if (!scanOverlayElement) return;

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
 * filterDestinations
 * ------------------
 * Filters the list of destination rooms based on user query string.
 *
 * @param {string} query – User search string.
 */
function filterDestinations(query) {
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

  handleBarElement.addEventListener('touchstart', (event) => {
    touchStartY = event.touches[0].clientY;
  }, { passive: true });

  handleBarElement.addEventListener('touchmove', (event) => {
    currentTouchY = event.touches[0].clientY;
    const deltaY = currentTouchY - touchStartY;
    if (deltaY > 0) {
      // Provide direct downward follow feedback
      sheetElement.style.transform = `translateY(${Math.min(deltaY, 200)}px)`;
    }
  }, { passive: true });

  handleBarElement.addEventListener('touchend', () => {
    const deltaY = currentTouchY - touchStartY;
    sheetElement.style.transform = '';
    // If pulled down further than 60px, dismiss
    if (deltaY > 60) {
      closeDestinationSheet();
    }
    touchStartY = 0;
    currentTouchY = 0;
  });
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
  // 1. Toast dismissal on click
  if (statusToastElement) {
    statusToastElement.addEventListener('click', () => {
      statusToastElement.classList.add('toast-hidden');
      if (toastDismissTimerId) {
        clearTimeout(toastDismissTimerId);
        toastDismissTimerId = null;
      }
    });
  }

  // 2. Scan overlay triggers
  if (scanTriggerButton) {
    scanTriggerButton.addEventListener('click', openScanOverlay);
  }
  if (closeScanButton) {
    closeScanButton.addEventListener('click', closeScanOverlay);
  }

  // 3. Destination bottom sheet triggers
  if (destinationTriggerButton) {
    destinationTriggerButton.addEventListener('click', openDestinationSheet);
  }
  if (closeDestinationButton) {
    closeDestinationButton.addEventListener('click', closeDestinationSheet);
  }
  if (sheetBackdropElement) {
    sheetBackdropElement.addEventListener('click', closeDestinationSheet);
  }

  // 4. Mobile swipe down gesture to dismiss sheet
  setupTouchDismissSheet(destinationSheetElement, sheetDragHandleBar);

  // 5. Destination search input
  if (destinationSearchInput) {
    destinationSearchInput.addEventListener('input', (event) => {
      filterDestinations(event.target.value);
    });
  }

  // 6. Destination items selection
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

  // 7. Global keyboard accessibility: Escape closes, Tab stays inside the dialog
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (scanOverlayElement && scanOverlayElement.classList.contains('is-open')) {
        closeScanOverlay();
      } else if (destinationSheetElement && destinationSheetElement.classList.contains('is-open')) {
        closeDestinationSheet();
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
  // 1. Build core Three.js components
  const scene = createScene();
  const camera = createCamera();
  const renderer = createRenderer(sceneContainer);

  // 2. Populate 3D scene elements
  const cubeGroup = createCube();
  scene.add(cubeGroup);

  const groundShadowMesh = createGroundShadow();
  scene.add(groundShadowMesh);

  createLighting(scene);
  createGridHelper(scene);

  // 3. React to viewport resizing & orientation changes
  window.addEventListener('resize', () => {
    handleWindowResize(camera, renderer);
  });
  window.addEventListener('orientationchange', () => {
    setTimeout(() => handleWindowResize(camera, renderer), 100);
  });

  // 4. Start 3D animation loop
  startAnimationLoop(renderer, scene, camera, cubeGroup, groundShadowMesh);

  // 5. Initialize UI overlays & interactions
  initUIEventListeners();

  // 6. Display initial discrete status toast
  showStatusToast('Scène 3D initialisée ✓', 4000);

  console.log('[Indoor Wayfinder] v1.1.0 – Scene & UI initialized. Three.js r' + THREE.REVISION);
}

// Boot application
init();
