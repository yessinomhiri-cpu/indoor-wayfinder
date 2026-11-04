/**
 * ==========================================================================
 * Module       : main.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-04
 * Modified     : 2026-11-04
 * Version      : 0.1.0 (Week 1 – Three.js scene with rotating cube)
 * Description  : Entry point of the application. Creates a Three.js scene
 *                with a perspective camera, a coloured rotating cube, basic
 *                lighting, and a render loop. This file will later bootstrap
 *                the WebXR session, the QR scanner, and the navigation graph.
 * ==========================================================================
 */

// ---------------------------------------------------------------------------
// Imports – Three.js is resolved by the import map in index.html
// ---------------------------------------------------------------------------
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

/** @type {HTMLDivElement} Container that will hold the Three.js <canvas> */
const sceneContainer = document.getElementById('scene-container');

/** @type {HTMLDivElement} Status text shown in the UI overlay */
const statusMessage  = document.getElementById('status-message');

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------

/**
 * createScene
 * -----------
 * Builds and returns the Three.js Scene object with a dark background.
 *
 * @returns {THREE.Scene} The configured scene.
 */
function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f0f23);
  return scene;
}

/**
 * createCamera
 * ------------
 * Builds a PerspectiveCamera sized to the current viewport.
 *
 * @returns {THREE.PerspectiveCamera} The configured camera.
 */
function createCamera() {
  const aspectRatio  = window.innerWidth / window.innerHeight;
  const fieldOfView  = 60;   // degrees
  const nearClip     = 0.1;
  const farClip      = 100;

  const camera = new THREE.PerspectiveCamera(
    fieldOfView, aspectRatio, nearClip, farClip
  );

  // Pull the camera back so the cube is visible
  camera.position.set(0, 1.5, 4);
  camera.lookAt(0, 0, 0);

  return camera;
}

/**
 * createRenderer
 * --------------
 * Builds a WebGLRenderer, enables antialiasing, sets pixel ratio for
 * mobile screens, and appends its <canvas> to the DOM container.
 *
 * @param {HTMLElement} container – The DOM element that hosts the canvas.
 * @returns {THREE.WebGLRenderer} The configured renderer.
 */
function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });

  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  container.appendChild(renderer.domElement);

  return renderer;
}

/**
 * createCube
 * ----------
 * Creates a coloured cube mesh (BoxGeometry + MeshStandardMaterial).
 * The cube will be the placeholder object until the AR arrow is added.
 *
 * @returns {THREE.Mesh} The cube mesh.
 */
function createCube() {
  const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
  const cubeMaterial = new THREE.MeshStandardMaterial({
    color: 0x448aff,       // Blue matching the UI accent
    roughness: 0.4,
    metalness: 0.3,
  });

  const cubeMesh = new THREE.Mesh(cubeGeometry, cubeMaterial);
  cubeMesh.position.set(0, 0, 0);

  return cubeMesh;
}

/**
 * createLighting
 * --------------
 * Adds an ambient light (soft fill) and a directional light (key light)
 * to the scene so the cube's faces are distinguishable.
 *
 * @param {THREE.Scene} scene – The scene to add lights to.
 */
function createLighting(scene) {
  // Ambient light – soft overall illumination
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  // Directional light – simulates a distant light source (like the sun)
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
  directionalLight.position.set(5, 10, 7);
  scene.add(directionalLight);
}

/**
 * createGridHelper
 * ----------------
 * Adds a grid on the XZ plane so the user can perceive depth and
 * orientation. The grid will be removed once the AR camera feed
 * replaces the background.
 *
 * @param {THREE.Scene} scene – The scene to add the grid to.
 */
function createGridHelper(scene) {
  const gridSize      = 10;
  const gridDivisions = 10;
  const gridHelper    = new THREE.GridHelper(
    gridSize, gridDivisions, 0x444466, 0x222244
  );
  scene.add(gridHelper);
}

// ---------------------------------------------------------------------------
// Resize handling
// ---------------------------------------------------------------------------

/**
 * handleWindowResize
 * ------------------
 * Updates the camera aspect ratio and renderer size when the browser
 * window (or device orientation) changes.
 *
 * @param {THREE.PerspectiveCamera} camera   – The active camera.
 * @param {THREE.WebGLRenderer}     renderer – The active renderer.
 */
function handleWindowResize(camera, renderer) {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------

/**
 * startAnimationLoop
 * ------------------
 * Runs the requestAnimationFrame loop. Each frame:
 *   1. Rotates the cube slightly around X and Y.
 *   2. Renders the scene.
 *
 * @param {THREE.WebGLRenderer}     renderer – The active renderer.
 * @param {THREE.Scene}             scene    – The scene to render.
 * @param {THREE.PerspectiveCamera} camera   – The camera to render from.
 * @param {THREE.Mesh}              cube     – The cube mesh to animate.
 */
function startAnimationLoop(renderer, scene, camera, cube) {
  /** Rotation speed in radians per frame (~60 fps) */
  const rotationSpeedX = 0.008;
  const rotationSpeedY = 0.012;

  /**
   * animate (inner)
   * ---------------
   * Single frame callback for requestAnimationFrame.
   */
  function animate() {
    requestAnimationFrame(animate);

    // Rotate the cube
    cube.rotation.x += rotationSpeedX;
    cube.rotation.y += rotationSpeedY;

    // Render the frame
    renderer.render(scene, camera);
  }

  // Kick off the loop
  animate();
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * init
 * ----
 * Main bootstrap function. Creates every Three.js object and starts
 * the render loop. Called once when the module is loaded.
 */
function init() {
  // 1. Build core Three.js objects
  const scene    = createScene();
  const camera   = createCamera();
  const renderer = createRenderer(sceneContainer);

  // 2. Populate the scene
  const rotatingCube = createCube();
  scene.add(rotatingCube);

  createLighting(scene);
  createGridHelper(scene);

  // 3. React to window resize
  window.addEventListener('resize', () => {
    handleWindowResize(camera, renderer);
  });

  // 4. Start the render loop
  startAnimationLoop(renderer, scene, camera, rotatingCube);

  // 5. Update UI status
  statusMessage.textContent = 'Scène 3D chargée ✓';

  console.log('[main.js] Three.js scene initialised – version', THREE.REVISION);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
init();

