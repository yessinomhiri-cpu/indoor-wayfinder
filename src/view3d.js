/**
 * ==========================================================================
 * Module       : view3d.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-12
 * Modified     : 2026-11-26
 * Version      : 3.9.0 (clearer labels; daylight cut-away 3D view of each floor)
 * Description  : Real-time WebGPU view of the SUP'COM campus generated from
 *                assets/campus/supcom.json: the main building with its four
 *                floors (walls, doors, stairs, lifts from the SUP'COM plans),
 *                the surrounding campus buildings (OpenStreetMap), the
 *                multi-floor route with animated chevrons, the destination
 *                beacon, the current position, the GPS fix and the heading.
 *                Orbit view (drag / pinch), top view ("Plan", north up) or
 *                the "Campus" view: daylight exterior model (exterior.js).
 *                Local frame: x = east, y = north → world (x, height, −y).
 * ==========================================================================
 */

import * as THREE from 'three';
import { createWebGPURenderer } from './gpu.js';
import { CampusExterior, DAYLIGHT } from './exterior.js';
import { CampusInterior, CUT_HEIGHT } from './interior.js';

const COLOR = {
  accent: 0x00d2ff,
  current: 0x10b981,
  gps: 0x3b82f6,
  wall: 0x9fb3cf,
  facade: 0xd7e3f5,
  door: 0x5b7bb2,
  stairs: 0xef4444,
  lift: 0x22c55e,
  slab: [0x16233d, 0x1a2a47, 0x1e3152, 0x22385c],
  ground: 0x0b1324,
  campusBuilding: 0x334155,
  parking: 0x111c30,
  path: 0x2a3a58
};

/** Night palette of the Plan view. */
const NIGHT = {
  background: null,
  fog: { color: 0x070913, near: 380, far: 900 },
  ground: COLOR.ground,
  areas: { parking: COLOR.parking, green: COLOR.parking, land: COLOR.parking },
  building: COLOR.campusBuilding,
  hemisphere: { sky: 0xdbeafe, ground: 0x0b1020, intensity: 1.25 },
  sun: 1.4
};

const WALL_HEIGHT = 2.9;
const FACADE_HEIGHT = 3.3;
const ROUTE_LIFT = 0.35;     // route drawn just above the floor slab
const MIN_ELEVATION = 0.3;
const MAX_ELEVATION = 1.553; // ≈ 89°, top view
const MIN_DISTANCE = 10;
const MAX_DISTANCE = 520;

/** Local plan point → world vector. */
const toWorld = (x, y, height = 0) => new THREE.Vector3(x, height, -y);

export class CampusView3D {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container – Host element for the canvas.
   * @param {import('./navigation.js').CampusMap} options.campus – Campus model.
   * @param {Function} [options.onPick] – ({level, x, y}) when a floor is tapped.
   * @param {Function} [options.getBottomOcclusion] – Pixels hidden by UI at the bottom.
   * @param {Function} [options.onViewModeChange] – (mode) when the view leaves
   *        the Campus view by itself (route, floor or place selected).
   */
  constructor({ container, campus, onPick, getBottomOcclusion, onViewModeChange }) {
    this.container = container;
    this.campus = campus;
    this.onPick = onPick || (() => {});
    this.getBottomOcclusion = getBottomOcclusion || (() => 0);
    this.onViewModeChange = onViewModeChange || (() => {});

    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.timer = new THREE.Timer();
    this.isActive = false;

    this.floorGroups = new Map();   // level → Group
    this.floorSlabs = [];           // pickable meshes
    this.labelSprites = [];         // { sprite, level, official }
    this.labelGroups = new Map();   // level → Group of labels (3D and Plan)
    this.exterior = null;           // CampusExterior (Campus view, cut-away shell)
    this.interior = null;           // CampusInterior (cut-away 3D view)
    this.daylight = false;          // current palette
    this.environment = null;        // lights, ground and context materials (theme)
    this.activeLevel = 0;
    this.showAllFloors = false;
    this.viewMode = '3d';

    this.routeGroup = null;
    this.routeCurve = null;
    this.routeLength = 0;
    this.chevrons = [];
    this.pulses = [];
    this.beaconPin = null;
    this.gpsGroup = null;
    this.headingCone = null;
    this.currentPoint = null;

    this.target = new THREE.Vector3();
    this.goalTarget = new THREE.Vector3();
    this.azimuth = 0.35;
    this.elevation = 0.95;
    this.goalElevation = 0.95;
    this.distance = 160;
    this.goalDistance = 160;
    this.lastFrame = null;

    this.pointers = new Map();
    this.gesture = null;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  }

  /**
   * init
   * ----
   * Creates the WebGPU renderer and builds the campus.
   *
   * @returns {Promise<boolean>} False when WebGPU is unavailable.
   */
  async init() {
    if (this.renderer) return true;
    const renderer = await createWebGPURenderer();
    if (!renderer) return false;
    this.renderer = renderer;

    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.display = 'block';
    this.container.appendChild(renderer.domElement);

    // Shadows are cast only by the exterior's sun (Campus view)
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(NIGHT.fog.color, NIGHT.fog.near, NIGHT.fog.far);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.5, 2000);

    const hemisphere = new THREE.HemisphereLight(NIGHT.hemisphere.sky, NIGHT.hemisphere.ground, NIGHT.hemisphere.intensity);
    const sun = new THREE.DirectionalLight(0xffffff, NIGHT.sun);
    sun.position.set(60, 140, 40);
    this.scene.add(hemisphere, sun);
    this.environment = { hemisphere, sun };

    this.#buildContext();
    this.#buildFloors();
    this.exterior = new CampusExterior(this.campus);
    this.interior = new CampusInterior(this.campus);
    this.scene.add(this.exterior.group, this.interior.group);
    this.#buildNorthArrow();
    this.setFloor(0);
    this.#bindPointerControls();

    if ('ResizeObserver' in window) {
      new ResizeObserver(() => this.resize()).observe(this.container);
    } else {
      window.addEventListener('resize', () => this.resize());
    }

    this.resize();
    this.frameBuilding(true);
    return true;
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * setActive
   * ---------
   * @param {boolean} active – Render only while the view is visible.
   */
  setActive(active) {
    if (!this.renderer) return;
    this.isActive = active;
    if (active) {
      this.resize();
      this.renderer.setAnimationLoop(() => this.#renderFrame());
    } else {
      this.renderer.setAnimationLoop(null);
    }
  }

  /**
   * setFloor
   * --------
   * @param {number|'all'} level – Floor to show (floors above are hidden).
   */
  setFloor(level) {
    // Picking one floor means looking inside: leave the exterior view
    if (level !== 'all' && this.viewMode === 'campus') this.#leaveCampus();
    this.showAllFloors = level === 'all';
    if (!this.showAllFloors) this.activeLevel = level;
    this.#updateScene();
    if (this.lastFrame) this.#frame(this.lastFrame.center, this.lastFrame.radius);
  }

  /**
   * #updateScene
   * ------------
   * What each view shows:
   * - Campus: the whole exterior, daylight;
   * - 3D (cut-away): the exterior cut just above the chosen floor and that
   *   floor's interior, daylight; "Tous" stacks every floor's interior;
   * - Plan: the night floor plans seen from above (lower floors dimmed).
   */
  #updateScene() {
    const mode = this.viewMode;
    const daylight = mode !== 'top';
    if (daylight !== this.daylight) {
      this.daylight = daylight;
      this.#applyEnvironment(daylight);
    }
    const levels = this.campus.levels;
    const active = this.showAllFloors ? Math.max(...levels) : this.activeLevel;

    if (mode === '3d') {
      this.exterior.setCut(this.showAllFloors ? null : this.#levelHeight(active) + CUT_HEIGHT, this.showAllFloors);
      this.interior.show(this.showAllFloors ? levels : [active]);
    } else {
      this.exterior.setCut(null);
      this.interior.show([]);
    }

    for (const [floorLevel, group] of this.floorGroups) {
      group.visible = mode === 'top' && floorLevel <= active;
      const dim = !this.showAllFloors && floorLevel < active;
      group.traverse((child) => {
        if (!child.material || child.userData.keepOpacity) return;
        const base = child.userData.baseOpacity ?? 1;
        child.material.transparent = true;
        child.material.opacity = dim ? base * 0.18 : base;
        child.material.depthWrite = !dim && base >= 1;
      });
    }
    for (const [floorLevel, group] of this.labelGroups) {
      group.visible = mode !== 'campus' && (mode === 'top' ? floorLevel <= active : this.showAllFloors || floorLevel === active);
    }
    for (const label of this.labelSprites) {
      label.sprite.visible = label.level === active || (this.showAllFloors && label.official);
    }
    if (this.routeGroup) this.#updateRouteVisibility();
  }

  /** @returns {number} Currently shown floor. */
  getFloor() {
    return this.activeLevel;
  }

  /**
   * setViewMode
   * -----------
   * @param {'3d'|'top'|'campus'} mode – Cut-away orbit view of a floor, top
   *        view (north up, night plan), or the low-angle campus exterior view.
   * @param {{immediate?: boolean}} [options] – Jump to the view without easing
   *        (used for the first view when the site opens).
   */
  setViewMode(mode, { immediate = false } = {}) {
    this.viewMode = mode;
    if (mode === 'top') {
      this.goalElevation = MAX_ELEVATION;
      this.azimuth = 0;
    } else if (mode === 'campus') {
      const viewpoint = this.exterior.viewpoint;
      this.goalElevation = 0.3;
      this.azimuth = viewpoint.azimuth;
      this.#frame(viewpoint.centre, viewpoint.radius, immediate);
    } else {
      this.goalElevation = 0.95;
    }
    this.#updateScene();
  }

  /** Back to the interior 3D view (and tell the UI). */
  #leaveCampus() {
    this.setViewMode('3d');
    this.onViewModeChange('3d');
  }

  /**
   * #applyEnvironment
   * -----------------
   * Daylight (Campus and cut-away 3D views) or the night palette of the Plan
   * view: sky, fog, lights, ground and surroundings colours, shadowing sun.
   */
  #applyEnvironment(daylight) {
    const theme = daylight ? DAYLIGHT : NIGHT;
    const { hemisphere, sun, ground, grid, pathLines, areaMaterials, buildingMaterial } = this.environment;
    this.exterior.group.visible = daylight;
    this.scene.background = theme.background === null ? null : new THREE.Color(theme.background);
    this.scene.fog.color.setHex(theme.fog.color);
    this.scene.fog.near = theme.fog.near;
    this.scene.fog.far = theme.fog.far;
    hemisphere.color.setHex(theme.hemisphere.sky);
    hemisphere.groundColor.setHex(theme.hemisphere.ground);
    hemisphere.intensity = theme.hemisphere.intensity;
    sun.visible = !daylight; // the exterior brings its own shadow-casting sun
    ground.material.color.setHex(theme.ground);
    grid.visible = !daylight;
    pathLines.visible = !daylight;
    for (const [kind, material] of Object.entries(areaMaterials)) material.color.setHex(theme.areas[kind]);
    buildingMaterial.color.setHex(theme.building);
    buildingMaterial.opacity = daylight ? 1 : 0.9;
  }

  /**
   * setState
   * --------
   * @param {Object} state
   * @param {{level,x,y,name}|null} state.current – Current position.
   * @param {{level,x,y,name}|null} state.destination – Destination place.
   * @param {Object|null} state.route – CampusRouter result.
   */
  setState({ current, destination, route }) {
    if (!this.scene) return;
    if (this.routeGroup) {
      this.scene.remove(this.routeGroup);
      disposeObject(this.routeGroup);
    }
    this.routeGroup = new THREE.Group();
    this.routeCurve = null;
    this.routeLength = 0;
    this.chevrons = [];
    this.pulses = this.pulses.filter((p) => p.userData.gps);
    this.beaconPin = null;
    this.currentPoint = current;

    if (route && route.found && route.legs.length) this.#buildRoute(route);
    if (destination) this.#buildBeacon(destination);
    if (current) this.#buildCurrentMarker(current);
    this.scene.add(this.routeGroup);
    this.#updateRouteVisibility();

    // A route or a destination is shown inside the building
    // (the Campus view shows every floor: pick the route's floor instead)
    const fromCampus = this.viewMode === 'campus' && Boolean((route && route.found) || destination);
    if (fromCampus) this.#leaveCampus();
    const pickFloor = !this.showAllFloors || fromCampus;

    // Show the floor where the route starts, and frame the route
    if (route && route.found && route.legs.length) {
      const points = route.legs.flatMap((leg) => leg.points.map(([x, y]) => toWorld(x, y, this.#levelHeight(leg.level))));
      const box = new THREE.Box3().setFromPoints(points);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      if (pickFloor) this.setFloor(route.legs.length > 1 ? 'all' : route.legs[0].level);
      this.#frame(sphere.center, Math.max(sphere.radius + 6, 14));
    } else if (destination) {
      if (pickFloor) this.setFloor(destination.level);
      this.#frame(toWorld(destination.x, destination.y, this.#levelHeight(destination.level)), 22);
    } else if (current) {
      if (pickFloor) this.setFloor(current.level);
      this.#frame(toWorld(current.x, current.y, this.#levelHeight(current.level)), 30);
    }
  }

  /**
   * setGps
   * ------
   * @param {{x:number,y:number,accuracy:number}|null} fix – Local GPS fix.
   */
  setGps(fix) {
    if (!this.scene) return;
    if (!fix) {
      if (this.gpsGroup) this.gpsGroup.visible = false;
      return;
    }
    if (!this.gpsGroup) {
      this.gpsGroup = new THREE.Group();
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(1.1, 20, 12),
        new THREE.MeshBasicMaterial({ color: COLOR.gps })
      );
      dot.position.y = 1.1;
      const halo = new THREE.Mesh(
        new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: COLOR.gps, transparent: true, opacity: 0.18, depthWrite: false })
      );
      halo.name = 'accuracy';
      halo.position.y = 0.06;
      const ring = createPulseRing(COLOR.gps);
      ring.userData.gps = true;
      this.pulses.push(ring);
      this.gpsGroup.add(halo, ring, dot);
      this.scene.add(this.gpsGroup);
    }
    this.gpsGroup.visible = true;
    this.gpsGroup.position.copy(toWorld(fix.x, fix.y, 0));
    const halo = this.gpsGroup.getObjectByName('accuracy');
    const radius = Math.max(2, Math.min(fix.accuracy || 10, 80));
    halo.scale.set(radius, 1, radius);
  }

  /**
   * setHeading
   * ----------
   * Draws the user's compass heading on the current position.
   *
   * @param {number|null} heading – Degrees, 0 = north, clockwise.
   */
  setHeading(heading) {
    if (!this.scene) return;
    if (heading === null || !this.currentPoint) {
      if (this.headingCone) this.headingCone.visible = false;
      return;
    }
    if (!this.headingCone) {
      const geometry = new THREE.ConeGeometry(1.1, 3.4, 3);
      geometry.rotateX(-Math.PI / 2); // tip toward −Z = north
      geometry.translate(0, 0, -2.4);
      this.headingCone = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: COLOR.current, transparent: true, opacity: 0.85 }));
      this.headingCone.userData.keepOpacity = true;
      this.scene.add(this.headingCone);
    }
    const p = this.currentPoint;
    this.headingCone.visible = !this.showAllFloors ? p.level <= this.activeLevel : true;
    this.headingCone.position.copy(toWorld(p.x, p.y, this.#levelHeight(p.level) + 0.6));
    this.headingCone.rotation.y = -THREE.MathUtils.degToRad(heading);
  }

  /** Frames the whole main building. */
  frameBuilding(immediate = false) {
    const box = new THREE.Box3();
    const floor = this.campus.getFloor(0);
    for (const part of floor.facade || floor.walls || []) {
      for (let i = 0; i < part.length; i += 2) box.expandByPoint(toWorld(part[i], part[i + 1], 0));
    }
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.#frame(sphere.center, sphere.radius * 0.95, immediate);
  }

  /** Frames a place. */
  focusPlace(place) {
    if (!place) return;
    const fromCampus = this.viewMode === 'campus';
    if (fromCampus) this.#leaveCampus();
    if (!this.showAllFloors || fromCampus) this.setFloor(place.level);
    this.#frame(toWorld(place.x, place.y, this.#levelHeight(place.level)), 18);
  }

  /** Matches the canvas to its container and re-centres above the UI. */
  resize() {
    if (!this.renderer || !this.camera) return;
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = width / height;
    const occlusion = Math.min(Math.max(this.getBottomOcclusion() || 0, 0), height * 0.6);
    if (occlusion > 0) this.camera.setViewOffset(width, height, 0, occlusion / 2, width, height);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    if (this.lastFrame) this.#frame(this.lastFrame.center, this.lastFrame.radius);
  }

  // ===========================================================================
  // Scene construction
  // ===========================================================================

  #levelHeight(level) {
    return level * this.campus.floorHeight;
  }

  #buildContext() {
    const context = this.campus.data.context;
    const group = new THREE.Group();
    group.name = 'campusContext';

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: COLOR.ground, roughness: 1 })
    );
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    group.add(ground);

    const grid = new THREE.GridHelper(1000, 100, 0x1e2a44, 0x131b2e);
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    grid.position.y = -0.02;
    group.add(grid);

    // OSM areas by kind (one colour at night, distinct colours in daylight)
    const areaMaterials = {
      parking: new THREE.MeshStandardMaterial({ color: COLOR.parking, roughness: 1 }),
      green: new THREE.MeshStandardMaterial({ color: COLOR.parking, roughness: 1 }),
      land: new THREE.MeshStandardMaterial({ color: COLOR.parking, roughness: 1 })
    };
    const areaKind = (kind) => (kind === 'parking' ? 'parking' : /pitch|park|grass|garden|meadow|recreation/.test(kind) ? 'green' : 'land');
    for (const area of context.areas) {
      const shape = polygonShape(area.polygon);
      if (!shape) continue;
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), areaMaterials[areaKind(area.kind)]);
      mesh.position.y = area.kind === 'parking' ? 0.03 : 0.01;
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    // Ways as lines (the daylight exterior draws them as road ribbons)
    const pathPoints = [];
    for (const path of context.paths) {
      for (let i = 0; i + 3 < path.line.length; i += 2) {
        pathPoints.push(toWorld(path.line[i], path.line[i + 1], 0.03), toWorld(path.line[i + 2], path.line[i + 3], 0.03));
      }
    }
    const pathLines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pathPoints),
      new THREE.LineBasicMaterial({ color: COLOR.path })
    );
    group.add(pathLines);

    const buildingMaterial = new THREE.MeshStandardMaterial({ color: COLOR.campusBuilding, roughness: 0.8, transparent: true, opacity: 0.9 });
    Object.assign(this.environment, { ground, grid, pathLines, areaMaterials, buildingMaterial });

    for (const building of context.buildings) {
      const shape = polygonShape(building.polygon);
      if (!shape) continue;
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: building.height, bevelEnabled: false });
      geometry.rotateX(-Math.PI / 2); // shape (x, north) extruded upward → world (x, h, −north)
      const mesh = new THREE.Mesh(geometry, buildingMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      if (building.name) {
        const [cx, cy] = polygonCentre(building.polygon);
        const label = createLabelSprite(building.name, { scale: 3, muted: true });
        label.position.copy(toWorld(cx, cy, building.height + 3));
        group.add(label);
      }
    }

    this.scene.add(group);
  }

  #buildFloors() {
    const campus = this.campus;
    for (const floor of campus.floors) {
      const group = new THREE.Group();
      group.name = `floor-${floor.level}`;
      const base = this.#levelHeight(floor.level);

      // Floor slab from the walkable indoor cells (1 m blocks)
      const slab = this.#buildSlab(floor.level, base);
      if (slab) group.add(slab);

      // Walls and façade as vertical quads
      group.add(wallMesh(floor.walls || [], base, WALL_HEIGHT, COLOR.wall, 1));
      if (floor.columns) group.add(wallMesh(floor.columns, base, WALL_HEIGHT, COLOR.wall, 1));
      if (floor.facade) {
        const facade = wallMesh(floor.facade, base, FACADE_HEIGHT, COLOR.facade, 0.55);
        group.add(facade);
      }

      // Doors, stairs and lifts as lines on the floor
      group.add(lineMesh(floor.doors || [], base + 0.03, COLOR.door));
      group.add(lineMesh(floor.stairs || [], base + 0.04, COLOR.stairs));
      group.add(lineMesh(floor.lifts || [], base + 0.05, COLOR.lift));

      // Labels: official SUP'COM places, connectors and room codes (shared
      // by the cut-away 3D view and the Plan view)
      const labels = new THREE.Group();
      labels.name = `labels-${floor.level}`;
      this.labelGroups.set(floor.level, labels);
      this.scene.add(labels);
      for (const place of campus.getPlaces()) {
        if (place.level !== floor.level && !(place.connector && this.#connectorServes(place.connector, floor.level))) continue;
        const official = place.official || place.surveyed;
        const isConnector = place.kind === 'stairs' || place.kind === 'lift';
        const text = isConnector ? (place.kind === 'lift' ? '⇅ Ascenseur' : '▤ Escalier') : (official ? place.name : place.code || place.id);
        const label = createLabelSprite(text, { scale: official ? 2.6 : 1.9, muted: !official, accent: false });
        label.position.copy(toWorld(place.x, place.y, base + (official ? 4.2 : 3.4)));
        labels.add(label);
        this.labelSprites.push({ sprite: label, level: floor.level, official: official && !isConnector });
      }

      this.floorGroups.set(floor.level, group);
      this.scene.add(group);
    }
  }

  #connectorServes(connectorId, level) {
    const connector = this.campus.connectors.find((c) => c.id === connectorId);
    return Boolean(connector && connector.levels.includes(level));
  }

  /** Merged quads covering indoor walkable cells, in 1 m blocks. */
  #buildSlab(level, base) {
    const campus = this.campus;
    const block = Math.max(1, Math.round(1 / campus.res));
    const bw = Math.ceil(campus.width / block);
    const bh = Math.ceil(campus.height / block);
    const filled = new Uint8Array(bw * bh);
    const floorIndex = campus.levels.indexOf(level);
    const cells = campus.cells[floorIndex];
    for (let i = 0; i < cells.length; i++) {
      const value = cells[i];
      if (!value || value > 4) continue; // blocked or outdoor
      const cx = i % campus.width;
      const cy = (i - cx) / campus.width;
      filled[Math.floor(cy / block) * bw + Math.floor(cx / block)] = 1;
    }

    const positions = [];
    const size = block * campus.res;
    for (let by = 0; by < bh; by++) {
      let bx = 0;
      while (bx < bw) {
        if (!filled[by * bw + bx]) { bx++; continue; }
        const start = bx;
        while (bx < bw && filled[by * bw + bx]) bx++;
        const x0 = campus.minX + start * size;
        const x1 = campus.minX + bx * size;
        const y0 = campus.minY + by * size;
        const y1 = y0 + size;
        positions.push(
          x0, base, -y0, x1, base, -y0, x1, base, -y1,
          x0, base, -y0, x1, base, -y1, x0, base, -y1
        );
      }
    }
    if (!positions.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: COLOR.slab[level % COLOR.slab.length],
      roughness: 0.9,
      side: THREE.DoubleSide
    }));
    mesh.userData.level = level;
    mesh.userData.baseOpacity = 1;
    this.floorSlabs.push(mesh);
    return mesh;
  }

  #buildNorthArrow() {
    const shape = new THREE.Shape();
    shape.moveTo(0, 6);
    shape.lineTo(2.4, -2);
    shape.lineTo(0, -0.6);
    shape.lineTo(-2.4, -2);
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    const arrow = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xf8fafc, side: THREE.DoubleSide }));
    const box = new THREE.Box3();
    for (const group of this.floorGroups.values()) box.expandByObject(group);
    const label = createLabelSprite('N', { scale: 4, accent: true });
    const anchor = new THREE.Group();
    anchor.add(arrow, label);
    label.position.set(0, 1, -9);
    anchor.position.set(box.max.x + 14, 0.1, box.min.z + 6);
    this.scene.add(anchor);
  }

  // ----- route ----------------------------------------------------------------

  #buildRoute(route) {
    const curve = new THREE.CurvePath();
    const points = [];
    for (const leg of route.legs) {
      const height = this.#levelHeight(leg.level) + ROUTE_LIFT;
      for (const [x, y] of leg.points) points.push({ p: toWorld(x, y, height), level: leg.level });
    }
    for (let i = 0; i < points.length - 1; i++) {
      if (points[i].p.distanceToSquared(points[i + 1].p) < 1e-6) continue;
      curve.add(new THREE.LineCurve3(points[i].p, points[i + 1].p));
    }
    if (!curve.curves.length) return;
    this.routeCurve = curve;
    this.routeLength = curve.getLength();

    // One tube per floor leg so each can follow its floor's visibility
    for (const leg of route.legs) {
      if (leg.points.length < 2) continue;
      const height = this.#levelHeight(leg.level) + ROUTE_LIFT;
      const legCurve = new THREE.CurvePath();
      for (let i = 0; i < leg.points.length - 1; i++) {
        const a = toWorld(leg.points[i][0], leg.points[i][1], height);
        const b = toWorld(leg.points[i + 1][0], leg.points[i + 1][1], height);
        if (a.distanceToSquared(b) > 1e-6) legCurve.add(new THREE.LineCurve3(a, b));
      }
      if (!legCurve.curves.length) continue;
      const segments = Math.max(8, Math.round(legCurve.getLength()));
      const core = new THREE.Mesh(
        new THREE.TubeGeometry(legCurve, segments, 0.28, 8, false),
        new THREE.MeshBasicMaterial({ color: COLOR.accent })
      );
      const glow = new THREE.Mesh(
        new THREE.TubeGeometry(legCurve, segments, 0.75, 8, false),
        new THREE.MeshBasicMaterial({ color: COLOR.accent, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      core.userData.level = glow.userData.level = leg.level;
      core.userData.keepOpacity = glow.userData.keepOpacity = true;
      this.routeGroup.add(core, glow);

      // Vertical link to the next floor (stairs / lift)
      if (leg.exit) {
        const [ex, ey] = leg.points[leg.points.length - 1];
        const top = this.#levelHeight(leg.exit.toLevel) + ROUTE_LIFT;
        const link = new THREE.Mesh(
          new THREE.CylinderGeometry(0.35, 0.35, Math.abs(top - height), 10),
          new THREE.MeshBasicMaterial({ color: leg.exit.kind === 'lift' ? COLOR.lift : COLOR.stairs })
        );
        link.position.copy(toWorld(ex, ey, (top + height) / 2));
        link.userData.level = Math.min(leg.level, leg.exit.toLevel);
        link.userData.keepOpacity = true;
        link.userData.connector = true;
        this.routeGroup.add(link);
      }
    }

    // Chevrons flowing toward the destination
    const shape = new THREE.Shape();
    shape.moveTo(-0.9, -0.45);
    shape.lineTo(0, 0.45);
    shape.lineTo(0.9, -0.45);
    shape.lineTo(0.9, -0.05);
    shape.lineTo(0, 0.85);
    shape.lineTo(-0.9, -0.05);
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    geometry.rotateY(Math.PI);
    const material = new THREE.MeshBasicMaterial({ color: 0xe0faff, side: THREE.DoubleSide });
    const count = Math.max(4, Math.round(this.routeLength / 3));
    for (let i = 0; i < count; i++) {
      const chevron = new THREE.Mesh(geometry, material);
      chevron.userData.offset = i / count;
      chevron.userData.keepOpacity = true;
      this.routeGroup.add(chevron);
      this.chevrons.push(chevron);
    }
    this.#updateChevrons(0);
  }

  #buildBeacon(place) {
    const base = this.#levelHeight(place.level);
    const position = toWorld(place.x, place.y, base);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 22, 32, 1, true),
      new THREE.MeshBasicMaterial({ color: COLOR.accent, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    beam.position.copy(position).add(new THREE.Vector3(0, 11, 0));
    beam.userData.level = place.level;
    beam.userData.keepOpacity = true;

    const ring = createPulseRing(COLOR.accent);
    ring.position.copy(position).add(new THREE.Vector3(0, 0.08, 0));
    ring.userData.level = place.level;
    this.pulses.push(ring);

    const pin = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: COLOR.accent, emissive: COLOR.accent, emissiveIntensity: 0.6 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.95, 24, 16), material);
    head.position.y = 1.6;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.6, 24), material);
    tip.rotation.x = Math.PI;
    tip.position.y = 0.6;
    pin.add(head, tip);
    pin.position.copy(position).add(new THREE.Vector3(0, 3.2, 0));
    pin.userData.baseY = pin.position.y;
    pin.userData.level = place.level;
    this.beaconPin = pin;

    const label = createLabelSprite(`📍 ${place.name}`, { scale: 2.8, accent: true });
    label.position.copy(position).add(new THREE.Vector3(0, 8, 0));
    label.userData.level = place.level;

    for (const object of [beam, ring, pin, label]) {
      object.userData.keepOpacity = true;
      this.routeGroup.add(object);
    }
  }

  #buildCurrentMarker(point) {
    const position = toWorld(point.x, point.y, this.#levelHeight(point.level));
    const puck = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 0.35, 32),
      new THREE.MeshStandardMaterial({ color: COLOR.current, emissive: COLOR.current, emissiveIntensity: 0.5 })
    );
    puck.position.copy(position).add(new THREE.Vector3(0, 0.3, 0));
    const ring = createPulseRing(COLOR.current);
    ring.position.copy(position).add(new THREE.Vector3(0, 0.09, 0));
    this.pulses.push(ring);
    const label = createLabelSprite('Vous êtes ici', { scale: 2, color: '#a7f3d0' });
    label.position.copy(position).add(new THREE.Vector3(0, 3.4, 0));
    for (const object of [puck, ring, label]) {
      object.userData.level = point.level;
      object.userData.keepOpacity = true;
      this.routeGroup.add(object);
    }
  }

  #updateRouteVisibility() {
    if (!this.routeGroup) return;
    const active = this.showAllFloors ? Infinity : this.activeLevel;
    for (const child of this.routeGroup.children) {
      if (child.userData.level === undefined) continue;
      child.visible = child.userData.level <= active;
    }
    for (const chevron of this.chevrons) chevron.visible = true;
  }

  // ===========================================================================
  // Animation & camera
  // ===========================================================================

  #updateChevrons(elapsed) {
    if (!this.routeCurve || this.routeLength <= 0) return;
    const shift = this.reducedMotion.matches ? 0 : (elapsed * 2.4) / this.routeLength;
    const active = this.showAllFloors ? Infinity : this.activeLevel;
    for (const chevron of this.chevrons) {
      const t = (chevron.userData.offset + shift) % 1;
      const point = this.routeCurve.getPointAt(t);
      const tangent = this.routeCurve.getTangentAt(t);
      chevron.position.set(point.x, point.y + 0.3, point.z);
      chevron.rotation.y = Math.atan2(tangent.x, tangent.z);
      const level = Math.round((point.y - ROUTE_LIFT) / this.campus.floorHeight);
      chevron.visible = level <= active && Math.abs(tangent.y) < 0.9;
    }
  }

  #frame(center, radius, immediate = false) {
    if (!this.camera) return;
    this.lastFrame = { center: center.clone(), radius };
    const vertical = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * (this.camera.aspect || 1));
    const fit = Math.min(vertical, horizontal);
    const height = Math.max(this.container.clientHeight, 1);
    const occlusion = Math.min(Math.max(this.getBottomOcclusion() || 0, 0), height * 0.6);
    const visible = Math.max((height - occlusion) / height, 0.4);
    this.goalTarget.copy(center);
    this.goalDistance = THREE.MathUtils.clamp((radius / Math.sin(fit / 2)) / Math.sqrt(visible), MIN_DISTANCE, MAX_DISTANCE);
    if (immediate) {
      this.target.copy(this.goalTarget);
      this.distance = this.goalDistance;
      this.elevation = this.goalElevation;
    }
  }

  #updateCamera(delta) {
    const ease = this.reducedMotion.matches ? 1 : 1 - Math.exp(-delta * 4);
    this.target.lerp(this.goalTarget, ease);
    this.distance += (this.goalDistance - this.distance) * ease;
    this.elevation += (this.goalElevation - this.elevation) * ease;
    const horizontal = this.distance * Math.cos(this.elevation);
    this.camera.position.set(
      this.target.x + horizontal * Math.sin(this.azimuth),
      this.target.y + this.distance * Math.sin(this.elevation),
      this.target.z + horizontal * Math.cos(this.azimuth)
    );
    // Top view: keep north at the top of the screen
    this.camera.up.set(0, 1, 0);
    if (this.elevation > 1.5) this.camera.up.set(-Math.sin(this.azimuth), 0, -Math.cos(this.azimuth));
    this.camera.lookAt(this.target);
  }

  /**
   * #frameInterval
   * --------------
   * Frame budget (battery): full speed while the user touches the map or the
   * camera moves, 30 fps for the route / beacon animations, 4 fps when
   * nothing moves (any missed change still shows within 250 ms).
   *
   * @returns {number} Minimum ms between two rendered frames.
   */
  #frameInterval() {
    const camera = this.camera;
    const last = this.lastRenderedPose;
    const moving = !last
      || camera.position.distanceToSquared(last.position) > 1e-4 // 1 cm: the easing never stops exactly
      || 1 - Math.abs(camera.quaternion.dot(last.quaternion)) > 1e-7;
    if (this.pointers.size > 0 || moving) return 0;
    const animated = !this.reducedMotion.matches && (this.chevrons.length > 0 || this.pulses.length > 0 || this.beaconPin);
    return animated ? 1000 / 30 : 250;
  }

  #renderFrame() {
    this.timer.update();
    const delta = Math.min(this.timer.getDelta(), 0.1);
    const elapsed = this.timer.getElapsed();
    this.#updateCamera(delta);

    const now = performance.now();
    if (now - (this.lastRenderTime || 0) < this.#frameInterval() - 2) return;
    this.lastRenderTime = now;
    if (!this.lastRenderedPose) this.lastRenderedPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    this.lastRenderedPose.position.copy(this.camera.position);
    this.lastRenderedPose.quaternion.copy(this.camera.quaternion);

    this.#updateChevrons(elapsed);

    // Room codes only when close enough to read them (hidden = not drawn)
    const close = this.distance < 90;
    for (const label of this.labelSprites) {
      if (label.official) continue;
      label.sprite.visible = close;
      label.sprite.material.opacity = 1;
    }

    if (!this.reducedMotion.matches) {
      for (const ring of this.pulses) {
        const phase = (elapsed * 0.8) % 1;
        const scale = 1 + phase * 1.8;
        ring.scale.set(scale, 1, scale);
        ring.material.opacity = 0.7 * (1 - phase);
      }
      if (this.beaconPin) {
        this.beaconPin.position.y = this.beaconPin.userData.baseY + Math.sin(elapsed * 2.2) * 0.4;
        this.beaconPin.rotation.y = elapsed * 1.2;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  // ===========================================================================
  // Touch / mouse controls
  // ===========================================================================

  #bindPointerControls() {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('pointerdown', (event) => {
      try { canvas.setPointerCapture?.(event.pointerId); } catch { /* pointer already released */ }
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.gesture = this.pointers.size === 1
        ? { startX: event.clientX, startY: event.clientY, startTime: performance.now(), moved: false }
        : { moved: true, pinch: this.#pinchDistance(), centre: this.#pinchCentre() };
    });

    canvas.addEventListener('pointermove', (event) => {
      const previous = this.pointers.get(event.pointerId);
      if (!previous || !this.gesture) return;
      const current = { x: event.clientX, y: event.clientY };
      this.pointers.set(event.pointerId, current);

      if (this.pointers.size >= 2) {
        const pinch = this.#pinchDistance();
        if (this.gesture.pinch) this.#zoomBy(this.gesture.pinch / pinch);
        this.gesture.pinch = pinch;
        // Two-finger drag pans
        const centre = this.#pinchCentre();
        if (this.gesture.centre) this.#pan(centre.x - this.gesture.centre.x, centre.y - this.gesture.centre.y);
        this.gesture.centre = centre;
        return;
      }

      if (Math.hypot(current.x - this.gesture.startX, current.y - this.gesture.startY) > 8) this.gesture.moved = true;
      if (!this.gesture.moved) return;
      const dx = current.x - previous.x;
      const dy = current.y - previous.y;
      if (event.shiftKey || event.buttons === 2 || this.viewMode === 'top') {
        this.#pan(dx, dy);
      } else {
        this.azimuth -= dx * 0.008;
        this.goalElevation = THREE.MathUtils.clamp(this.goalElevation + dy * 0.006, MIN_ELEVATION, MAX_ELEVATION);
        this.elevation = this.goalElevation;
      }
    });

    const end = (event) => {
      const gesture = this.gesture;
      const single = this.pointers.size === 1;
      this.pointers.delete(event.pointerId);
      if (event.type === 'pointerup' && single && gesture && !gesture.moved && performance.now() - gesture.startTime < 500) {
        this.#pick(event);
      }
      if (!this.pointers.size) this.gesture = null;
      else if (this.gesture) { this.gesture.pinch = this.#pinchDistance(); this.gesture.centre = this.#pinchCentre(); }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.#zoomBy(1 + event.deltaY * 0.0015);
    }, { passive: false });
  }

  #pinchDistance() {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) || 1 : 0;
  }

  #pinchCentre() {
    const [a, b] = [...this.pointers.values()];
    return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
  }

  #zoomBy(factor) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    this.goalDistance = THREE.MathUtils.clamp(this.goalDistance * factor, MIN_DISTANCE, MAX_DISTANCE);
  }

  #pan(dx, dy) {
    const scale = this.distance * 0.0016;
    const right = new THREE.Vector3(Math.cos(this.azimuth), 0, -Math.sin(this.azimuth));
    const forward = new THREE.Vector3(-Math.sin(this.azimuth), 0, -Math.cos(this.azimuth));
    const move = right.multiplyScalar(-dx * scale).add(forward.multiplyScalar(dy * scale));
    this.goalTarget.add(move);
    this.target.add(move);
    this.lastFrame = null;
  }

  #pick(event) {
    if (this.viewMode === 'campus') return; // exterior view: nothing to pick
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.camera);
    const candidates = this.viewMode === '3d'
      ? this.interior.pickTargets
      : this.floorSlabs.filter((slab) => slab.parent.visible && (this.showAllFloors || slab.userData.level === this.activeLevel));
    const hit = raycaster.intersectObjects(candidates, false)[0];
    if (hit) {
      this.onPick({ level: hit.object.userData.level, x: hit.point.x, y: -hit.point.z });
      return;
    }
    // Outside the building: ground plane at the RDC
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const point = raycaster.ray.intersectPlane(ground, new THREE.Vector3());
    if (point) this.onPick({ level: 0, x: point.x, y: -point.z, outdoor: true });
  }
}

// =============================================================================
// Geometry helpers
// =============================================================================

/** Vertical quads for flat [x,y,x,y,…] polylines. */
function wallMesh(parts, base, height, color, opacity) {
  const positions = [];
  for (const part of parts) {
    for (let i = 0; i + 3 < part.length; i += 2) {
      const ax = part[i]; const ay = -part[i + 1];
      const bx = part[i + 2]; const by = -part[i + 3];
      positions.push(
        ax, base, ay, bx, base, by, bx, base + height, by,
        ax, base, ay, bx, base + height, by, ax, base + height, ay
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.75,
    side: THREE.DoubleSide,
    transparent: opacity < 1,
    opacity
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.baseOpacity = opacity;
  return mesh;
}

/** Line segments for flat polylines at a fixed height. */
function lineMesh(parts, height, color) {
  const positions = [];
  for (const part of parts) {
    for (let i = 0; i + 3 < part.length; i += 2) {
      positions.push(part[i], height, -part[i + 1], part[i + 2], height, -part[i + 3]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }));
  lines.userData.baseOpacity = 1;
  return lines;
}

function polygonShape(flat) {
  if (!flat || flat.length < 6) return null;
  const shape = new THREE.Shape();
  shape.moveTo(flat[0], flat[1]);
  for (let i = 2; i < flat.length; i += 2) shape.lineTo(flat[i], flat[i + 1]);
  shape.closePath();
  return shape;
}

function polygonCentre(flat) {
  let x = 0; let y = 0;
  const n = flat.length / 2;
  for (let i = 0; i < flat.length; i += 2) { x += flat[i]; y += flat[i + 1]; }
  return [x / n, y / n];
}

function createPulseRing(color) {
  const geometry = new THREE.RingGeometry(1.2, 1.6, 40);
  geometry.rotateX(-Math.PI / 2);
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false
  }));
}

/**
 * Camera-facing text label drawn on a canvas texture: opaque pill, white
 * bold text with a dark outline, drawn at high resolution so it stays sharp
 * on phones and readable over the daylight model (no fog, no tone mapping).
 */
function createLabelSprite(text, { scale = 1.5, accent = false, muted = false, color = '#ffffff' } = {}) {
  const fontSize = 84;
  const pad = Math.round(fontSize * 0.55);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const font = `700 ${fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  context.font = font;
  canvas.width = Math.ceil(context.measureText(text).width) + pad * 2;
  canvas.height = Math.round(fontSize * 1.45);
  context.font = font;
  context.fillStyle = accent ? 'rgb(0, 132, 180)' : muted ? 'rgba(30, 41, 59, 0.96)' : 'rgba(8, 15, 35, 0.97)';
  context.strokeStyle = accent ? 'rgb(186, 230, 253)' : muted ? 'rgba(203, 213, 225, 0.85)' : 'rgba(125, 211, 252, 0.9)';
  context.lineWidth = 6;
  const r = (canvas.height - 6) / 2;
  context.beginPath();
  context.moveTo(3 + r, 3);
  context.lineTo(canvas.width - 3 - r, 3);
  context.arc(canvas.width - 3 - r, 3 + r, r, -Math.PI / 2, Math.PI / 2);
  context.lineTo(3 + r, canvas.height - 3);
  context.arc(3 + r, 3 + r, r, Math.PI / 2, Math.PI * 1.5);
  context.closePath();
  context.fill();
  context.stroke();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.lineWidth = 8;
  context.strokeStyle = 'rgba(2, 6, 23, 0.9)';
  context.strokeText(text, canvas.width / 2, canvas.height / 2 + 3);
  context.fillStyle = accent ? '#ffffff' : color;
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 3);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    fog: false,
    toneMapped: false
  }));
  sprite.renderOrder = 10;
  sprite.userData.keepOpacity = true;
  sprite.scale.set(scale * (canvas.width / canvas.height), scale, 1);
  return sprite;
}

function disposeObject(root) {
  const materials = new Set();
  const geometries = new Set();
  root.traverse((child) => {
    if (child.geometry) geometries.add(child.geometry);
    if (child.material) (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => materials.add(m));
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
}
