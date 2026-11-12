/**
 * ==========================================================================
 * Module       : view3d.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-12
 * Modified     : 2026-11-12
 * Version      : 2.3.0 (Sprint 4 – 3D route preview)
 * Description  : Real-time Three.js view of the building floor generated
 *                from assets/building.json. Shows corridors, rooms, the
 *                current QR position, the Dijkstra route (animated chevrons)
 *                and a beacon on the destination. Works on any WebGL device,
 *                so it is also the fallback when immersive-ar is unavailable.
 * ==========================================================================
 */

import * as THREE from 'three';

const COLOR_ACCENT = 0x00d2ff;
const COLOR_CURRENT = 0x10b981;
const COLOR_ROOM = 0x1e3a5f;
const COLOR_ROOM_EDGE = 0x64748b;
const COLOR_CORRIDOR = 0x1b2539;
const COLOR_FLOOR = 0x0a1020;

const ROOM_SIZE = 3.4;
const ROOM_HEIGHT = 1.8;
const CORRIDOR_WIDTH = 2.4;
const ROUTE_HEIGHT = 0.25;

/** Camera limits (radians / metres). */
const MIN_ELEVATION = 0.35;
const MAX_ELEVATION = 1.45;
const MIN_DISTANCE = 8;
const MAX_DISTANCE = 140;

export class FloorView3D {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container – Element that hosts the canvas.
   * @param {Object<string,string>} [options.labels] – Short node labels.
   * @param {{has:Function}} [options.roomIds] – Set (or predicate object) of nodes drawn as rooms.
   * @param {Function} [options.onNodeTap] – (nodeId) callback on tap.
   * @param {Function} [options.getBottomOcclusion] – Pixels of the canvas
   *        hidden by UI at the bottom; the view centres above them.
   */
  constructor({ container, labels, roomIds, onNodeTap, getBottomOcclusion }) {
    this.container = container;
    this.labels = labels || {};
    this.roomIds = roomIds || new Set();
    this.onNodeTap = onNodeTap || (() => {});
    this.getBottomOcclusion = getBottomOcclusion || (() => 0);

    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.clock = new THREE.Clock();
    this.isActive = false;
    this.frameId = null;

    this.nodePositions = new Map();
    this.roomMeshes = new Map();
    this.pickables = [];
    this.buildingGroup = null;
    this.routeGroup = null;
    this.routeCurve = null;
    this.routeLength = 0;
    this.chevrons = [];
    this.pulseObjects = [];
    this.beaconPin = null;
    this.buildingRadius = 20;
    this.lastStateKey = '';
    this.lastFrame = null;

    this.target = new THREE.Vector3();
    this.goalTarget = new THREE.Vector3();
    this.azimuth = 0.4;
    this.elevation = 0.95;
    this.distance = 60;
    this.goalDistance = 60;

    this.pointers = new Map();
    this.gesture = null;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  }

  /**
   * init
   * ----
   * Creates the WebGL renderer. Returns false when WebGL is unavailable so
   * the caller can keep the 2D plan.
   *
   * @returns {boolean} True when the 3D view is ready.
   */
  init() {
    if (this.renderer) return true;

    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (error) {
      console.warn('[view3d] WebGL unavailable:', error);
      this.renderer = null;
      return false;
    }

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.style.touchAction = 'none';
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x070913, 90, 200);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.5, 400);

    this.scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x0b1020, 1.1));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(20, 40, 25);
    this.scene.add(keyLight);

    this.#bindPointerControls();
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => this.resize()).observe(this.container);
    } else {
      window.addEventListener('resize', () => this.resize());
    }

    this.renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.#stopLoop();
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      if (this.isActive) this.#startLoop();
    });

    return true;
  }

  /**
   * setGraph
   * --------
   * Builds the static floor model: slab, corridors, rooms, nodes, labels.
   *
   * @param {Array<{id:string,name:string,x:number,y:number}>} nodes
   * @param {Array<{from:string,to:string}>} edges
   */
  setGraph(nodes, edges) {
    if (!this.scene || nodes.length === 0) return;

    if (this.buildingGroup) {
      this.scene.remove(this.buildingGroup);
      disposeObject(this.buildingGroup);
    }
    this.nodePositions.clear();
    this.roomMeshes.clear();
    this.pickables = [];

    // Graph x → world x, graph y → world -z (north is away from the camera,
    // like the top of the 2D plan). The model is centred on the origin.
    const minX = Math.min(...nodes.map((node) => node.x));
    const maxX = Math.max(...nodes.map((node) => node.x));
    const minY = Math.min(...nodes.map((node) => node.y));
    const maxY = Math.max(...nodes.map((node) => node.y));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    for (const node of nodes) {
      this.nodePositions.set(node.id, new THREE.Vector3(node.x - centerX, 0, -(node.y - centerY)));
    }

    const group = new THREE.Group();
    group.name = 'building3D';

    // Floor slab + subtle grid
    const width = maxX - minX + 14;
    const depth = maxY - minY + 14;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.4, depth),
      new THREE.MeshStandardMaterial({ color: COLOR_FLOOR, roughness: 0.9 })
    );
    slab.position.y = -0.2;
    group.add(slab);

    const grid = new THREE.GridHelper(Math.max(width, depth), Math.round(Math.max(width, depth) / 2), 0x1e2a44, 0x131b2e);
    grid.position.y = 0.01;
    grid.material.transparent = true;
    grid.material.opacity = 0.6;
    group.add(grid);

    // Corridors: one flat strip per graph edge
    const corridorMaterial = new THREE.MeshStandardMaterial({ color: COLOR_CORRIDOR, roughness: 0.8 });
    for (const edge of edges) {
      const from = this.nodePositions.get(edge.from);
      const to = this.nodePositions.get(edge.to);
      if (!from || !to) continue;

      const length = from.distanceTo(to);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(CORRIDOR_WIDTH, 0.06, length + CORRIDOR_WIDTH), corridorMaterial);
      strip.position.copy(from).add(to).multiplyScalar(0.5);
      strip.position.y = 0.03;
      strip.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
      group.add(strip);
    }

    // Rooms (translucent blocks) and corridor nodes (discs)
    const discGeometry = new THREE.CylinderGeometry(0.7, 0.7, 0.12, 24);
    const hitGeometry = new THREE.SphereGeometry(1.8, 8, 6);
    const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });

    for (const node of nodes) {
      const position = this.nodePositions.get(node.id);
      const isRoom = this.roomIds.has(node.id);

      if (isRoom) {
        const geometry = new THREE.BoxGeometry(ROOM_SIZE, ROOM_HEIGHT, ROOM_SIZE);
        const material = new THREE.MeshStandardMaterial({
          color: COLOR_ROOM,
          roughness: 0.4,
          metalness: 0.2,
          transparent: true,
          opacity: 0.55
        });
        const room = new THREE.Mesh(geometry, material);
        room.position.set(position.x, ROOM_HEIGHT / 2 + 0.06, position.z);
        room.userData.nodeId = node.id;

        const edgesLines = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry),
          new THREE.LineBasicMaterial({ color: COLOR_ROOM_EDGE, transparent: true, opacity: 0.8 })
        );
        room.add(edgesLines);

        group.add(room);
        this.roomMeshes.set(node.id, room);
        this.pickables.push(room);
      } else {
        const disc = new THREE.Mesh(
          discGeometry,
          new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 })
        );
        disc.position.set(position.x, 0.12, position.z);
        group.add(disc);
        this.roomMeshes.set(node.id, disc);
      }

      // Generous invisible hit volume so small nodes are easy to tap
      const hit = new THREE.Mesh(hitGeometry, hitMaterial);
      hit.position.set(position.x, 1, position.z);
      hit.userData.nodeId = node.id;
      group.add(hit);
      this.pickables.push(hit);

      const labelText = this.labels[node.id];
      if (labelText) {
        const label = createLabelSprite(labelText, { scale: 1.9 });
        label.position.set(position.x, (isRoom ? ROOM_HEIGHT : 0.4) + 1.2, position.z);
        group.add(label);
      }
    }

    this.buildingGroup = group;
    this.scene.add(group);

    // A tilted view of a flat floor needs less room than its bounding sphere
    this.buildingRadius = (Math.hypot(maxX - minX, maxY - minY) / 2) * 0.82 + 2;
    this.lastStateKey = '';
    this.#frame(new THREE.Vector3(), this.buildingRadius, true);
  }

  /**
   * setState
   * --------
   * Highlights the current node, destination and route.
   *
   * @param {Object} state
   * @param {string|null} state.currentId – Scanned node.
   * @param {string|null} state.destinationId – Chosen destination.
   * @param {string[]} state.path – Dijkstra path (may be empty).
   * @param {Object<string,string>} [state.names] – Full node names.
   */
  setState({ currentId, destinationId, path, names }) {
    if (!this.scene || !this.buildingGroup) return;

    const routePath = Array.isArray(path) ? path : [];
    const stateKey = `${currentId}|${destinationId}|${routePath.join('>')}`;
    if (stateKey === this.lastStateKey) return;
    this.lastStateKey = stateKey;

    if (this.routeGroup) {
      this.scene.remove(this.routeGroup);
      disposeObject(this.routeGroup);
    }
    this.routeGroup = new THREE.Group();
    this.routeGroup.name = 'route3D';
    this.routeCurve = null;
    this.routeLength = 0;
    this.chevrons = [];
    this.pulseObjects = [];
    this.beaconPin = null;

    // Reset room colours, then tint the current node and destination
    for (const [nodeId, mesh] of this.roomMeshes) {
      const isRoom = this.roomIds.has(nodeId);
      mesh.material.color.setHex(isRoom ? COLOR_ROOM : 0x334155);
      mesh.material.emissive?.setHex(0x000000);
      if (isRoom) mesh.material.opacity = 0.55;
    }

    const currentPosition = currentId ? this.nodePositions.get(currentId) : null;
    const destinationPosition = destinationId ? this.nodePositions.get(destinationId) : null;

    if (routePath.length > 1) {
      this.#buildRoute(routePath);
    }

    if (destinationPosition) {
      this.#tintNode(destinationId, COLOR_ACCENT);
      this.#buildBeacon(destinationPosition, names?.[destinationId] || this.labels[destinationId] || destinationId);
    }

    if (currentPosition) {
      this.#tintNode(currentId, COLOR_CURRENT);
      this.#buildCurrentMarker(currentPosition);
    }

    this.scene.add(this.routeGroup);

    // Frame the route, else the destination, else the whole floor
    if (routePath.length > 1) {
      const box = new THREE.Box3();
      for (const nodeId of routePath) {
        const point = this.nodePositions.get(nodeId);
        if (point) box.expandByPoint(point);
      }
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      this.#frame(sphere.center, Math.max(sphere.radius + 3, 9));
    } else if (destinationPosition) {
      this.#frame(destinationPosition, 12);
    } else if (currentPosition) {
      this.#frame(new THREE.Vector3(), this.buildingRadius);
    }
  }

  /**
   * setActive
   * ---------
   * Starts or pauses the render loop (only renders while visible).
   *
   * @param {boolean} active – Whether the 3D view is on screen.
   */
  setActive(active) {
    if (!this.renderer) return;
    this.isActive = active;
    if (active) {
      this.resize();
      this.#startLoop();
    } else {
      this.#stopLoop();
    }
  }

  /**
   * resize
   * ------
   * Matches the canvas to its container and re-centres above the UI.
   */
  resize() {
    if (!this.renderer || !this.camera) return;
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = width / height;

    // Shift the projection so the scene centre sits in the visible area
    const occlusion = Math.min(Math.max(this.getBottomOcclusion() || 0, 0), height * 0.6);
    if (occlusion > 0) {
      this.camera.setViewOffset(width, height, 0, occlusion / 2, width, height);
    } else {
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();

    // Keep the last framed area in view (e.g. when the route panel opens)
    if (this.lastFrame) {
      this.#frame(this.lastFrame.center, this.lastFrame.radius);
    }
  }

  // ---------------------------------------------------------------------------
  // Scene builders
  // ---------------------------------------------------------------------------

  /**
   * #buildRoute
   * -----------
   * Glowing tube along the path plus chevrons that flow toward the target.
   *
   * @param {string[]} routePath – Node IDs.
   */
  #buildRoute(routePath) {
    const curve = new THREE.CurvePath();
    const points = routePath
      .map((nodeId) => this.nodePositions.get(nodeId))
      .filter(Boolean)
      .map((point) => new THREE.Vector3(point.x, ROUTE_HEIGHT, point.z));

    for (let index = 0; index < points.length - 1; index++) {
      curve.add(new THREE.LineCurve3(points[index], points[index + 1]));
    }
    if (curve.curves.length === 0) return;

    this.routeCurve = curve;
    this.routeLength = curve.getLength();

    const segments = Math.max(16, Math.round(this.routeLength * 2));
    const core = new THREE.Mesh(
      new THREE.TubeGeometry(curve, segments, 0.22, 8, false),
      new THREE.MeshBasicMaterial({ color: COLOR_ACCENT, toneMapped: false })
    );
    const glow = new THREE.Mesh(
      new THREE.TubeGeometry(curve, segments, 0.6, 8, false),
      new THREE.MeshBasicMaterial({
        color: COLOR_ACCENT,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false
      })
    );
    this.routeGroup.add(core, glow);

    // Rounded joints at corners
    const jointGeometry = new THREE.SphereGeometry(0.22, 12, 8);
    const jointMaterial = new THREE.MeshBasicMaterial({ color: COLOR_ACCENT, toneMapped: false });
    for (const point of points) {
      const joint = new THREE.Mesh(jointGeometry, jointMaterial);
      joint.position.copy(point);
      this.routeGroup.add(joint);
    }

    // Chevrons, one every ~3 m
    const chevronShape = new THREE.Shape();
    chevronShape.moveTo(-0.7, -0.35);
    chevronShape.lineTo(0, 0.35);
    chevronShape.lineTo(0.7, -0.35);
    chevronShape.lineTo(0.7, -0.05);
    chevronShape.lineTo(0, 0.65);
    chevronShape.lineTo(-0.7, -0.05);
    chevronShape.closePath();
    const chevronGeometry = new THREE.ShapeGeometry(chevronShape);
    chevronGeometry.rotateX(-Math.PI / 2); // lay flat, tip toward -Z
    chevronGeometry.rotateY(Math.PI);      // tip toward +Z
    const chevronMaterial = new THREE.MeshBasicMaterial({
      color: 0xe0faff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      toneMapped: false
    });

    const count = Math.max(3, Math.round(this.routeLength / 3));
    for (let index = 0; index < count; index++) {
      const chevron = new THREE.Mesh(chevronGeometry, chevronMaterial);
      chevron.userData.offset = index / count;
      this.routeGroup.add(chevron);
      this.chevrons.push(chevron);
    }
    this.#updateChevrons(0);
  }

  /**
   * #buildBeacon
   * ------------
   * Light column, pulsing floor ring, floating pin and label on the target.
   *
   * @param {THREE.Vector3} position – Destination position.
   * @param {string} name – Destination name.
   */
  #buildBeacon(position, name) {
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.1, 14, 32, 1, true),
      new THREE.MeshBasicMaterial({
        color: COLOR_ACCENT,
        transparent: true,
        opacity: 0.14,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false
      })
    );
    beam.position.set(position.x, 7, position.z);
    this.routeGroup.add(beam);

    const ring = createPulseRing(COLOR_ACCENT);
    ring.position.set(position.x, 0.08, position.z);
    this.routeGroup.add(ring);
    this.pulseObjects.push(ring);

    const pin = new THREE.Group();
    const pinMaterial = new THREE.MeshStandardMaterial({
      color: COLOR_ACCENT,
      emissive: COLOR_ACCENT,
      emissiveIntensity: 0.6,
      roughness: 0.3
    });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.8, 24, 16), pinMaterial);
    head.position.y = 1.4;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.4, 24), pinMaterial);
    tip.rotation.x = Math.PI;
    tip.position.y = 0.55;
    pin.add(head, tip);
    pin.position.set(position.x, ROOM_HEIGHT + 1.6, position.z);
    pin.userData.baseY = pin.position.y;
    this.routeGroup.add(pin);
    this.beaconPin = pin;

    const label = createLabelSprite(`📍 ${name}`, { scale: 2.1, accent: true });
    label.position.set(position.x, ROOM_HEIGHT + 5.6, position.z);
    this.routeGroup.add(label);
  }

  /**
   * #buildCurrentMarker
   * -------------------
   * Green puck + pulsing ring + "Vous êtes ici" label.
   *
   * @param {THREE.Vector3} position – Scanned node position.
   */
  #buildCurrentMarker(position) {
    const puck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.9, 0.3, 32),
      new THREE.MeshStandardMaterial({ color: COLOR_CURRENT, emissive: COLOR_CURRENT, emissiveIntensity: 0.5 })
    );
    puck.position.set(position.x, 0.3, position.z);
    this.routeGroup.add(puck);

    const ring = createPulseRing(COLOR_CURRENT);
    ring.position.set(position.x, 0.09, position.z);
    this.routeGroup.add(ring);
    this.pulseObjects.push(ring);

    const label = createLabelSprite('Vous êtes ici', { scale: 1.6, color: '#a7f3d0' });
    label.position.set(position.x, 2.4, position.z);
    this.routeGroup.add(label);
  }

  /**
   * #tintNode
   * ---------
   * @param {string} nodeId – Node to highlight.
   * @param {number} color – Hex colour.
   */
  #tintNode(nodeId, color) {
    const mesh = this.roomMeshes.get(nodeId);
    if (!mesh) return;
    mesh.material.color.setHex(color);
    mesh.material.emissive?.setHex(color);
    if (mesh.material.emissiveIntensity !== undefined) mesh.material.emissiveIntensity = 0.35;
    if (this.roomIds.has(nodeId)) mesh.material.opacity = 0.75;
  }

  // ---------------------------------------------------------------------------
  // Animation
  // ---------------------------------------------------------------------------

  /**
   * #updateChevrons
   * ---------------
   * Moves chevrons along the route toward the destination.
   *
   * @param {number} elapsed – Seconds since start.
   */
  #updateChevrons(elapsed) {
    if (!this.routeCurve || this.routeLength <= 0) return;
    const speed = 2.2; // metres per second
    const shift = this.reducedMotion.matches ? 0 : (elapsed * speed) / this.routeLength;

    for (const chevron of this.chevrons) {
      const t = (chevron.userData.offset + shift) % 1;
      const point = this.routeCurve.getPointAt(t);
      const tangent = this.routeCurve.getTangentAt(t);
      chevron.position.set(point.x, ROUTE_HEIGHT + 0.25, point.z);
      chevron.rotation.y = Math.atan2(tangent.x, tangent.z);
    }
  }

  /**
   * #frame
   * ------
   * Moves the camera goal so a sphere fits in the visible canvas.
   *
   * @param {THREE.Vector3} center – Sphere centre.
   * @param {number} radius – Sphere radius in metres.
   * @param {boolean} [immediate] – Jump instead of animating.
   */
  #frame(center, radius, immediate = false) {
    if (!this.camera) return;
    this.lastFrame = { center: center.clone(), radius };
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = this.camera.aspect || 1;
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const fitFov = Math.min(verticalFov, horizontalFov);

    const height = Math.max(this.container.clientHeight, 1);
    const occlusion = Math.min(Math.max(this.getBottomOcclusion() || 0, 0), height * 0.6);
    const visibleRatio = Math.max((height - occlusion) / height, 0.4);

    const distance = (radius / Math.sin(fitFov / 2)) / Math.sqrt(visibleRatio);
    this.goalTarget.copy(center);
    this.goalDistance = THREE.MathUtils.clamp(distance, MIN_DISTANCE, MAX_DISTANCE);

    if (immediate) {
      this.target.copy(this.goalTarget);
      this.distance = this.goalDistance;
    }
  }

  /**
   * #updateCamera
   * -------------
   * Eases toward the goal and applies the orbit position.
   *
   * @param {number} delta – Seconds since last frame.
   */
  #updateCamera(delta) {
    const ease = this.reducedMotion.matches ? 1 : 1 - Math.exp(-delta * 4);
    this.target.lerp(this.goalTarget, ease);
    this.distance += (this.goalDistance - this.distance) * ease;

    const horizontal = this.distance * Math.cos(this.elevation);
    this.camera.position.set(
      this.target.x + horizontal * Math.sin(this.azimuth),
      this.target.y + this.distance * Math.sin(this.elevation),
      this.target.z + horizontal * Math.cos(this.azimuth)
    );
    this.camera.lookAt(this.target);
  }

  #startLoop() {
    if (this.frameId !== null) return;
    this.clock.getDelta();
    const loop = () => {
      this.frameId = requestAnimationFrame(loop);
      this.#renderFrame();
    };
    this.frameId = requestAnimationFrame(loop);
  }

  #stopLoop() {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  #renderFrame() {
    const delta = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.elapsedTime;
    const animate = !this.reducedMotion.matches;

    this.#updateCamera(delta);
    this.#updateChevrons(elapsed);

    if (animate) {
      for (const ring of this.pulseObjects) {
        const phase = (elapsed * 0.8) % 1;
        const scale = 1 + phase * 1.6;
        ring.scale.set(scale, 1, scale);
        ring.material.opacity = 0.7 * (1 - phase);
      }
      if (this.beaconPin) {
        this.beaconPin.position.y = this.beaconPin.userData.baseY + Math.sin(elapsed * 2.2) * 0.35;
        this.beaconPin.rotation.y = elapsed * 1.2;
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------------------------
  // Touch / mouse orbit controls
  // ---------------------------------------------------------------------------

  #bindPointerControls() {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('pointerdown', (event) => {
      canvas.setPointerCapture?.(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size === 1) {
        this.gesture = { startX: event.clientX, startY: event.clientY, startTime: performance.now(), moved: false };
      } else {
        this.gesture = { moved: true, pinchDistance: this.#pinchDistance() };
      }
    });

    canvas.addEventListener('pointermove', (event) => {
      const previous = this.pointers.get(event.pointerId);
      if (!previous || !this.gesture) return;
      const current = { x: event.clientX, y: event.clientY };
      this.pointers.set(event.pointerId, current);

      if (this.pointers.size >= 2) {
        const pinch = this.#pinchDistance();
        if (this.gesture.pinchDistance) {
          this.#zoomBy(this.gesture.pinchDistance / pinch);
        }
        this.gesture.pinchDistance = pinch;
        return;
      }

      const totalMove = Math.hypot(current.x - this.gesture.startX, current.y - this.gesture.startY);
      if (totalMove > 8) this.gesture.moved = true;
      if (!this.gesture.moved) return;

      this.azimuth -= (current.x - previous.x) * 0.008;
      this.elevation = THREE.MathUtils.clamp(
        this.elevation + (current.y - previous.y) * 0.006,
        MIN_ELEVATION,
        MAX_ELEVATION
      );
    });

    const endPointer = (event) => {
      const gesture = this.gesture;
      const wasSingle = this.pointers.size === 1;
      this.pointers.delete(event.pointerId);

      if (event.type === 'pointerup' && wasSingle && gesture && !gesture.moved &&
          performance.now() - gesture.startTime < 500) {
        this.#handleTap(event);
      }
      if (this.pointers.size === 0) this.gesture = null;
      else if (this.gesture) this.gesture.pinchDistance = this.#pinchDistance();
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.#zoomBy(1 + event.deltaY * 0.0015);
    }, { passive: false });
  }

  #pinchDistance() {
    const [first, second] = Array.from(this.pointers.values());
    if (!first || !second) return 0;
    return Math.hypot(first.x - second.x, first.y - second.y) || 1;
  }

  #zoomBy(factor) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    this.goalDistance = THREE.MathUtils.clamp(this.goalDistance * factor, MIN_DISTANCE, MAX_DISTANCE);
  }

  #handleTap(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.camera);
    const hit = raycaster.intersectObjects(this.pickables, false)[0];
    if (hit && hit.object.userData.nodeId) {
      this.onNodeTap(hit.object.userData.nodeId);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * createLabelSprite
 * -----------------
 * Text label drawn on a canvas texture; always faces the camera.
 *
 * @param {string} text – Label text.
 * @param {Object} [options]
 * @param {number} [options.scale] – Height in metres.
 * @param {boolean} [options.accent] – Cyan pill for the destination.
 * @param {string} [options.color] – Text colour.
 * @returns {THREE.Sprite} Label sprite.
 */
function createLabelSprite(text, { scale = 1.5, accent = false, color = '#e2e8f0' } = {}) {
  const fontSize = 44;
  const paddingX = 26;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  context.font = font;
  const textWidth = Math.ceil(context.measureText(text).width);

  canvas.width = textWidth + paddingX * 2;
  canvas.height = fontSize + 30;

  context.font = font;
  context.fillStyle = accent ? 'rgba(0, 150, 200, 0.92)' : 'rgba(7, 9, 19, 0.78)';
  context.strokeStyle = accent ? 'rgba(186, 230, 253, 0.95)' : 'rgba(148, 163, 184, 0.45)';
  context.lineWidth = 3;
  roundRect(context, 2, 2, canvas.width - 4, canvas.height - 4, (canvas.height - 4) / 2);
  context.fill();
  context.stroke();

  context.fillStyle = accent ? '#ffffff' : color;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    toneMapped: false
  }));
  sprite.renderOrder = 10;
  sprite.scale.set(scale * (canvas.width / canvas.height), scale, 1);
  return sprite;
}

/**
 * roundRect
 * ---------
 * Path helper (CanvasRenderingContext2D.roundRect is not universal yet).
 */
function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.arc(x + width - radius, y + radius, radius, -Math.PI / 2, Math.PI / 2);
  context.lineTo(x + radius, y + height);
  context.arc(x + radius, y + radius, radius, Math.PI / 2, Math.PI * 1.5);
  context.closePath();
}

/**
 * createPulseRing
 * ---------------
 * @param {number} color – Hex colour.
 * @returns {THREE.Mesh} Flat ring that the loop scales and fades.
 */
function createPulseRing(color) {
  const geometry = new THREE.RingGeometry(1.1, 1.45, 40);
  geometry.rotateX(-Math.PI / 2);
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false
  }));
}

/**
 * disposeObject
 * -------------
 * Frees GPU resources of a subtree.
 *
 * @param {THREE.Object3D} root – Object to dispose.
 */
function disposeObject(root) {
  const materials = new Set();
  const geometries = new Set();
  root.traverse((child) => {
    if (child.geometry) geometries.add(child.geometry);
    if (child.material) {
      (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => materials.add(material));
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => {
    if (material.map) material.map.dispose();
    material.dispose();
  });
}
