# Changelog

All notable changes to Indoor Wayfinder are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [3.0.0] - 2026-11-12

The app now maps the **real SUP'COM building** (four floors) and renders
everything with **WebGPU**.

### Added

- `scripts/build-campus.mjs` imports SUP'COM's own floor plans (public ArcGIS
  layer behind supnav.supcom.tn: walls, doors, stairs, lifts, façade, columns
  of the RDC and floors 1–3, plus 18 labels) and the surrounding campus from
  OpenStreetMap into `assets/campus/supcom.json`: 25 cm walkable grid per
  floor, 233 auto-detected rooms with stable codes (`A1-07`), official places
  (4 amphitheatres, accueil, bureau d'ordre, buvette, entrée), 7 stair / lift
  connectors, 34 neighbouring buildings.
- Multi-floor Dijkstra router (`CampusRouter`) with stairs / lifts edges, the
  *Sans escaliers* strategy (lifts only), path smoothing, French turn-by-turn
  steps with compass bearings, single-pass distances to all places.
- WebGPU 3D campus (`CampusView3D`): 4 stacked floors, floor tabs, plan view
  (north up), neighbouring buildings, route tube + chevrons, beacon, position,
  heading, GPS fix; tap to place yourself.
- Compass (`deviceorientationabsolute`, Tunis declination) with an N/E/S/O rose;
  the AR arrow and new floor chevrons follow the real corridor bearing.
- Outdoor GPS (`watchPosition`) as a start point when accurate (≤ 30 m).
- Survey mode: name rooms from their door plates, record doorways missing from
  the CAD plans, undo, export `corrections.json` (re-imported by the script).
- QR cards for the real SUP'COM places; printable board per floor; deep links
  `?depart=…&destination=…`; Screen Wake Lock during AR; arrival vibration.

### Changed

- Three.js r160 → **r187** (`three.webgpu.js`). `WebGPURenderer` everywhere;
  no WebGL in the app code. AR sessions require the `webgpu` feature
  (`XRGPUBinding`; Chrome flag `#webxr-webgpu-binding` until enabled by
  default). The XR loop is registered before `setSession()` as r187 requires.
- The fictional "Bâtiment A" graph, its QR cards and screenshots are removed.
- Destinations: all 241 places of the 4 floors, searchable.
- Cache bumped to `v3.0.0`; the page reloads on a worker update only when it
  was already controlled.

### Known limits

- 25 RDC rooms (outer rings of Blocs A and B) have no doorway on the plan:
  routes stop at the nearest point with "Accès à confirmer".
- AR on WebGPU is verified on a simulated WebXR device, not yet on the S23.

## [2.3.2] - 2026-11-12

### Fixed

- **"The requested session requires user activation" on Android.** When the
  full AR configuration (DOM overlay + anchors) was rejected, `ar.js`
  silently retried `requestSession()` in the same tap. Chrome treats the tap
  as used by the first request, so the retry always failed with this message
  and the real cause was hidden.
  Now there is exactly **one** `requestSession()` per tap: if the full
  configuration is rejected, the app shows the real cause and asks for a
  second tap, which uses the simplified hit-test-only configuration.
- Nothing is awaited before `requestSession()` any more (the startup support
  check is reused), and double taps while a session is starting are ignored.

### Changed

- Simplified AR mode (no DOM overlay): a message explains beforehand that the
  page UI is hidden and that the Android **Back** button exits AR.
- Cache bumped to `v2.3.2`.

## [2.3.1] - 2026-11-12

### Fixed

- **Guidage AR failed on Android.** Three.js requests the `local-floor`
  reference space inside `renderer.xr.setSession()`, but the session never
  asked for that feature. When it was refused, ending the half-initialised
  session crashed Three's own end handler (`Cannot read properties of null
  (reading 'cancelAnimationFrame')`) and the app showed the error banner.
  `ar.js` now requests `local-floor` as an optional feature and checks the
  reference space *before* `setSession`, falling back to `local`.
- The WebXR DOM overlay root is now the UI layer (`#ui-overlay`) instead of
  `document.body`, whose opaque background and WebGL canvas could hide the
  camera feed.
- `requestSession()` is the first asynchronous step after the tap, so Chrome
  still sees the user gesture.
- Taps on overlay buttons (e.g. **Quitter AR**) no longer place the arrow
  (`beforexrselect`); rejected `session.end()` / arrow placement promises are
  handled.

### Changed

- AR failures show the real reason (permission refused, ARCore/Chrome not
  supported, …) and fall back to the 3D route view instead of a generic error.
- During AR the scanner/destination bar is hidden and the route panel is
  compact; the status line names the next step of the route.
- Cache bumped to `v2.3.1`.

## [2.3.0] - 2026-11-12

The destination is now shown in real 3D on every phone, not only through
WebXR AR.

### Added

- `src/view3d.js`: real-time Three.js model of the floor generated from
  `assets/building.json` — floor slab, corridors, room blocks, labels.
- The Dijkstra route is drawn as a glowing tube with chevrons that flow toward
  the destination; the destination has a light column, a floating pin and a
  label; the scanned node has a pulsing "Vous êtes ici" marker.
- **2D / 3D** toggle on the floor plan. Choosing a destination switches to 3D
  and frames the route above the route panel.
- Touch controls in 3D: drag to rotate, pinch / wheel to zoom, tap a room to
  simulate a QR scan (demo mode, same as the 2D plan).
- **Any start, any end:** a **Départ** picker in the destination sheet sets
  the start point without a QR code, and every node of `building.json`
  (including the three corridors) can be chosen as the destination.
- QR codes for all 12 nodes in `docs/qr-codes/` (8 new cards) and a
  `full-sheet.png` with all of them, so every node can also be a scanned start.
- Node test checking all 144 start/end pairs: valid edges, symmetric distances.

### Changed

- When `immersive-ar` is not supported, the route button reads **Voir en 3D**
  and opens the 3D view instead of only showing "non supporté". A failed AR
  session also falls back to the 3D view.
- In 3D the route panel hides the step list (the steps are drawn in 3D); it is
  still shown in 2D.
- `src/view3d.js` added to the offline app shell; cache bumped to `v2.3.0`.

## [2.2.2] - 2026-11-12

### Fixed

- A new Service Worker now navigates already-open tabs after activation, so a
  phone cannot keep running an older cached `main.js` with a newer page.
- Cache bumped to `v2.2.2`.

## [2.2.1] - 2026-11-12

### Fixed

- Mobile deployment could mix an older cached `main.js`/`navigation.js` with
  the new page after a redeploy, triggering the generic fallback.
- Service Worker now reloads once after a new worker claims the page.
- Fallback banner has an explicit **Réinitialiser l'application** button that
  unregisters the worker, clears caches and reloads.
- Fallback message no longer incorrectly claims that 3D/WebXR failed; it now
  reports a startup/module failure with a recovery action.
- Cache bumped to `v2.2.1`.

## [2.2.0] - 2026-11-11

Concrete demo pass: the home screen is now the real building graph, not the
demo cube.

### Added

- Interactive SVG floor plan generated from `assets/building.json`.
- Click a graph node to simulate a QR position (explicitly labelled demo).
- Dijkstra route highlighted on the map with total distance and steps.
- QR image upload fallback for desktop browsers without a camera.
- WebXR support badge (`AR : disponible` / `AR : non disponible`).
- Map/AR view switch: the Three.js canvas is shown only during AR.

### Changed

- The demo cube, grid and ground glow are hidden outside AR.
- Map is the default view; 3D rendering is skipped while the map is visible.
- AR start shows the canvas before requesting the session; failure restores the map.
- Cache version bumped to `v2.2.0`.

### Verified

- 12 nodes, 12 edges and 9 readable labels rendered in the SVG.
- QR image `ENTREE` uploaded → position chip → Salle B12 26 m / 3 steps.
- Clicking the HALL node recomputes the route to Salle B12 (16 m / 2 steps).
- Map route highlight has 3 edges; no console errors.
- Desktop `AR : non disponible` fallback works.

## [2.1.0] - 2026-11-11

Sprint 2–4: real QR localization, real Dijkstra routing and the first
`immersive-ar` implementation. Response to the first evaluation (C-- / A / C).

### Added

- `src/scanner.js`: rear camera, native `BarcodeDetector`, jsQR fallback.
- `src/navigation.js`: weighted graph, adjacency list, Dijkstra and Strategy.
- `assets/building.json`: 12 nodes and 12 edges for Bâtiment A.
- Graph-driven destination list with computed distances (no hard-coded metres).
- Route panel with total distance, ordered legs and per-leg distances.
- `src/ar.js`: `immersive-ar`, hit test, `XRAnchor`, floor reticle and arrow.
- AR start/stop controls and unsupported-device fallback.
- Position chip, rescan actions and route recalculation after each QR.
- Nine Node tests for the graph and routing.
- `docs/technical.md`, `docs/user-manual.md`, `docs/design-notebook.md`.
- Completed `ATTRIBUTION.md` with assets, licenses and AI tools.

### Changed

- Destination IDs now match graph node IDs (`SALLE_B12`, `AMPHI_A`, …).
- Scanner throttles detection to ~6 fps and cancels pending starts safely.
- Service Worker cache bumped to `v2.1.0` and includes scanner/navigation/AR.
- File headers and package version bumped to 2.1.0.
- README updated with current status, screenshots and verification evidence.

### Verified

- `node --test scripts/test-navigation.mjs`: 9/9.
- Fake-camera `ENTREE` QR → position chip → 9 destinations → Salle B12 route
  26 m / 3 steps.
- AR unsupported path returns a clear message without a JS error.
- Offline shell and accessibility checks still pass.

## [2.0.0] - 2026-11-06

Sprint 2 initial integration by Yassine Mhiri.

### Added

- Live camera viewfinder and QR scanner module.
- Building graph JSON and Dijkstra module.
- Printable QR test board and draft attribution file.
- Service Worker cache entries for the new modules and jsQR.

## [1.2.0] - 2026-11-05

Sprint 1 audit: accessibility, failure handling, offline support and AR readiness.

### Added

- PWA icon set: 180, 192 and 512 `any` icons plus 192/512 `maskable` icons.
- Offline Service Worker: precaches the shell, icons and pinned Three.js module.
- Install metadata: stable manifest id, direction, categories and screenshot.
- Persistent fallback banner for WebGL, CDN and context-loss failures.
- `noscript` message for browsers with JavaScript disabled.
- Focus trap and `inert` background management for both dialogs.
- `aria-haspopup`, `aria-controls` and `aria-expanded` on dialog triggers.
- `aria-pressed` selected state for destination items.
- `touchcancel` handling and drag-state cleanup for the destination sheet.
- Changelog and version headers for v1.2.0.

### Changed

- Destination items are announced as buttons instead of list items.
- Status toast is informational only (no pointer-only dismiss interaction).
- Empty search results are announced as a status update.
- Muted text lifted to `#8494a8` (5.5:1 on cards).
- The reserved arrow is now a flat 1 m floor decal with its origin at the tail.
- The render loop uses `renderer.setAnimationLoop` for WebXR compatibility.
- Rendering pauses while a modal covers the 3D scene.
- Scanner sweep animation pauses while the scanner is closed.
- Viewport uses `100dvh`, a block canvas and `visualViewport` resize handling.

### Fixed

- Hidden dialogs no longer enter the tab order.
- Tab focus can no longer escape an open dialog into the background.
- Pinch zoom is no longer blocked by the viewport meta tag.
- WebGL failure no longer leaves the whole UI unresponsive.
- WebGL context loss no longer leaves a silently broken canvas.
- Swipe-to-dismiss no longer leaves the sheet offset after a cancel.
- Salle B12 is now tagged RDC, consistent with the one-floor scope.

### Verified

- Desktop Chrome: no console errors; Three.js renders.
- Keyboard: Tab skips closed dialogs, stays inside open dialogs, Escape restores focus.
- Forced WebGL failure and blocked CDN both show the fallback banner.
- Offline reload after the first controlled load boots the shell and canvas.
- Manifest is valid; every icon returns 200 with cache disabled.

## [1.1.0] - 2026-11-04

### Changed

- Dark glassmorphism design system and mobile-first UI polish.
- Cube edges, ground glow, fog and responsive camera.
- Scan overlay mockup and destination bottom sheet with live search.
- Accessibility states, reduced-motion support and network badge.

## [1.0.0] - 2026-11-04

### Added

- Initial PWA shell with Three.js r160 loaded from jsDelivr.
- Rotating cube scene, responsive renderer and import map.
- Base manifest and module structure.
