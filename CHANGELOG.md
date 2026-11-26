# Changelog

All notable changes to Indoor Wayfinder are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [3.7.1] - 2026-11-26

### Changed

- **The site opens on the Campus view** (SUP'COM exterior, all floors).
  Choosing a floor, a place or a route still switches to the 3D interior.
- **Entrance arch set against the front wall** of the glazed wing: its back
  face is placed on the most protruding point of the façade under its span
  (measured on the floor outlines), instead of standing 13 m out. The three
  flagpoles moved to the left of the arch, 3 m from the wall.
- Shadow map type `PCFShadowMap` (r187 WebGPU no longer has the soft
  variant; removes a console warning). Cache bumped to `v3.7.1`.

## [3.7.0] - 2026-11-26

**Real SUP'COM exterior in the Campus view (daylight, WebGPU).**

### Changed

- **Campus view redesigned** after the official SUP'COM 3D video
  (`https://www.supcom.tn/public/supcom.mp4`, SUP'COM II building):
  white rendered towers with tall glazed curtains, a ring of steel columns
  under a grey sloped crown, the glazed entrance wing with its grey fascia
  and **SUP'COM** sign, the white parabolic arch over the entrance steps,
  three Tunisian flags, a paved forecourt, lawn beds, palms, trees and lamp
  posts, roads drawn as ribbons, a gradient sky and sun shadows.
- The building is **extruded from the real floor outlines** of the SUP'COM
  plans (one prism per floor), so the towers, the wing, the set-backs and the
  partial upper floors match the plans instead of generic cylinders.
- Campus view switches to a **daylight palette** (sky, fog, lights, ground,
  OSM areas by kind) and hides the interior floors; 3D and Plan keep the
  night palette. Choosing a floor, a place or a route from the Campus view
  returns to the 3D view and updates the toolbar.

### Added

- `src/exterior.js` (`CampusExterior`): the exterior model, built once at
  start-up from `assets/campus/supcom.json`; instanced columns, palms, trees.
- `src/exterior-textures.js`: procedural canvas textures (tower bay,
  curtain wall, paving, sign, flag). No image, model or texture is copied
  from supcom.tn or forum.supcom.tn.
- `scripts/build-campus.mjs` now writes `floors[].outline` (marching squares
  on each floor footprint, simplified) and `exterior.apron` (6 m forecourt).
  Routing grid, places, rooms and connectors are unchanged.
- `scripts/test-exterior.mjs`: 4 tests on the outline and forecourt data.

### Removed

- The previous night exterior (lit window bands, rims, radial plaza, toy
  palms, floating gate, stars) and the window bands drawn on every floor.

### Verified

- Chrome with WebGPU: Campus view renders with shadows; 3D / Plan / floor
  tabs switch back to the interior; 68/68 Node tests pass; no `webgl` in the
  code. Cache bumped to `v3.7.0` with the two new modules.

## [3.6.0] - 2026-11-26

**Campus exterior view, adapted from the SUP'COM Forum 3D visual language.**

### Added

- **Campus view button** (`3D / Campus / Plan`) in the WebGPU map toolbar.
  It lowers the camera and frames the whole building with the new exterior
  layer.
- **Exterior layer** around the real three-block plan: lit façade window
  bands on the three circular towers, tower rims, a night plaza with radial
  paving, palms, lamp posts and a SUP'COM entrance gate. Everything is
  generated from the existing campus JSON and Three.js primitives; no GLB or
  external asset is loaded.
- The visual language is adapted from the public Forum SUP'COM 3D campus
  (`https://forum.supcom.tn`); no model, texture or source code was copied.
  The reference is recorded in `ATTRIBUTION.md`.

### Verified

- Chrome with WebGPU: default 3D map, **Campus** view, route and floor
  controls render without console errors; 64/64 Node tests still pass.
- Cache bumped to `v3.6.0` so installed PWAs receive the new `view3d.js`.

## [3.5.1] - 2026-11-18

### Fixed

- **QR scan on the phone: black screen, nothing read, no explanation.** When
  the camera could not start (permission blocked, camera used by another
  app…), the scan screen stayed dark with the sweep line still moving, and
  the error message was drawn UNDER the scan screen. The scan screen now
  shows the reason and the fix (« Caméra bloquée pour ce site » → cadenas →
  Autorisations → Caméra, or Android settings; « Caméra occupée »; « Aucune
  caméra trouvée »; « La caméra ne renvoie pas d'image » after 4 s), with
  **Réessayer** and **Choisir mon départ** buttons.
- The scanner kept only « Accès à la caméra refusé » for every failure; the
  real reason (`NotAllowedError`, `NotReadableError`…) is now kept.
- Phones that refuse the preferred camera settings: the scanner retries with
  simpler ones (rear camera, then any camera).
- Without the native BarcodeDetector, the camera waited for jsQR to download
  before opening; it now opens immediately and jsQR loads in parallel.

### Verified

- Chrome with a fake camera showing a real QR card: read, « Vous êtes ici :
  Entrée principale ». Refused camera → « Caméra bloquée pour ce site » on
  the scan screen. Busy camera → « Caméra occupée ». Strict camera → second
  settings accepted, QR read. 3 new Node tests (64).

## [3.5.0] - 2026-11-18

**Design pass: one guidance button, voice, 3-step bar, Google Maps-style
guidance card, arrow polish, lighter 3D map. Plus a real bug fix.**

### Fixed

- **The page reloaded by itself ~10 s after the first visit.** On activation
  the service worker called `client.navigate()` on every open tab: a first
  visitor saw the app reload in the middle of a QR scan, and after each
  deploy open tabs reloaded even during AR / camera guidance. The worker now
  only claims the page; after an update the page reloads once, and waits for
  the end of the guidance if one is running. (This was also the "3D view
  freeze" wrongly reported in 3.2.0.)

### Added

- **One « Démarrer le guidage » button** with a chip saying which mode it
  starts: AR when the phone supports it, otherwise the camera mode. If the
  AR session is refused, the camera mode starts instead. « Mode caméra »
  stays available as an option when AR exists.
- **Voice guidance** (`src/voice.js`, Web Speech API, fr-FR) for AR and
  camera modes: first instruction, each turn ~12 m before (« Dans 10 mètres,
  tournez à gauche ») and ~3 m before (« Tournez à gauche ») with a
  vibration, stairs / lift once, « Faites demi-tour » at most every 8 s,
  arrival once. 🔊/🔇 button, remembered on the phone.
- **3-step bar** ① Scanner ② Destination ③ Guidage above the bottom
  buttons: ✓ when done, the next step highlighted, tap to open it.
- **Google Maps-style guidance card** (`src/nav-format.js`) in both modes:
  turn icon (straight, left, right, slight, U-turn, stairs, lift, arrival),
  distance in large type, short action, progress bar, « 42 m restants ·
  ≈ 1 min · floor · place ». The camera mode also gets the wall mini-map.
- **Guide arrow polish:** soft shadow under it, leans into the turn, pop-in
  animation, colour changes fade.
- 7 Node tests (voice on real walks, the card formatter); 61 in total.

### Changed

- **3D map frame budget** (`view3d.js`): full speed while touched or moving,
  30 fps for the route animation, 4 fps when nothing moves. Measured in
  Chrome: idle map with a route 720 → 144 frames in 5 s; idle map without a
  route 720 → 20 frames in 5 s. Hidden room labels are no longer drawn
  (125 → 54 draw calls zoomed out).
- The map leaves exactly the height of the bottom bar (no more hint text
  under the buttons).
- Cache bumped to `v3.5.0`.

### Verified

- Full app in headless Chrome (WebGPU, service worker on): home screen with
  the 3-step bar; route panel with the single button; camera guidance with
  the new card, mini-map and polished arrow (keyboard walk, 45° turn).

### Not covered

- Room names (item 7 of the design plan) need the survey at SUP'COM.

## [3.4.0] - 2026-11-18

**Camera mode: the camera image with a 3D arrow, on any Android phone.**

### Added

- **Caméra** button in the route panel (after the QR scan and the choice of
  destination). The rear camera fills the screen like the photo app, and a
  transparent WebGPU canvas draws the big 3D guide arrow on top of it.
  No ARCore and no `chrome://flags` needed.
- `src/camera-guide.js` (`CameraGuide`): camera stream, WebGPU overlay, the
  compass turns the arrow towards the route relative to the phone, the
  phone tilt pitches the virtual camera, the accelerometer counts steps.
- `src/route-follower.js`: `StepDetector` (peak detection on the
  acceleration norm, ≤ 3 steps/s) and `RouteFollower` (each step moves the
  user 0.7 m along the route: forward when facing the route, backward when
  facing away, no move when looking sideways; waits on the stairs until
  « Je suis à l'étage N »). Same French instructions as the AR mode.
- HUD: instruction, metres left, floor, step count; **Rescanner** reopens
  the camera mode automatically after the new QR scan; **Quitter** puts the
  position reached on the map.
- Desktop test without a compass: keyboard ↑ step, ↓ step back, ← → turn.
- `scripts/test-camera-guide.mjs`: 11 Node tests (step counting on simulated
  walks and shaking, the Entrée → Amphi IBN KHALDOUN walk with a ±15°
  compass, backward / sideways steps, stairs to the 3rd floor, instructions).

### Changed

- The 3D campus view pauses during the camera mode (one WebGPU scene at a
  time on the phone).
- Cache bumped to `v3.4.0`; `npm test` runs 54 tests.

### Verified

- Chrome with a fake webcam: `CameraGuide` on the real SUP'COM route; the
  camera image is visible through the transparent WebGPU canvas; 10 steps
  = 7 m; turning right 90° → « Tournez-vous vers la gauche »; 76 steps →
  « Vous êtes arrivé », green arrow.

## [3.3.0] - 2026-11-18

**Floating guide arrow ("Live View" style).**

### Added

- A big 3D arrow (≈ 64 cm, blue with a white rim) floats 2 m in front of the
  user at chest height (45 cm under the phone), follows them as they walk and
  always points along the route (bearing to the route point 4 m ahead).
  Position and direction are smoothed (120 ms / 180 ms) so it neither shakes
  with the hand nor snaps at corners; it turns the short way round.
- Colours: **blue** follow · **grey, half transparent** while the position is
  not reliable yet (confidence < 50 %, the HUD says « Calibrage… marchez
  quelques mètres ») · **orange** off route · **green, pointing down and
  bouncing** at arrival.
- Drawn without depth test, so walls and occluders never hide it; the floor
  chevrons and the tap-to-place arrow are kept.
- 3 Node tests: colour modes, angle smoothing, and a simulated walk (unknown
  AR yaw, compass off by 12°) where the blue arrow stays within 25° of the
  true route direction and turns blue within the first 15 m.

### Changed

- Cache bumped to `v3.3.0`; `npm test` runs 43 tests.

### Verified

- The four arrow states rendered with Three.js r187 `WebGPURenderer` in Chrome
  (corridor scene, camera at phone height).

## [3.2.1] - 2026-11-17

### Changed

- Cache bumped to `v3.2.1` so phones that cached 3.2.0 download the floor
  fallback (`ar.js`, `ar-guidance.js`).

## [3.2.0] - 2026-11-17

**Demo-phone readiness for WebGPU AR.** WebGPU stays the only renderer
(supervisor requirement); this release makes it checkable on the phone.

### Added

- `diagnostic.html` + `src/diagnostic.js`: checks HTTPS, Chrome Android,
  `xrCompatible` WebGPU adapter, GPU device (test render), WebXR,
  `immersive-ar` (ARCore), `XRGPUBinding` (`chrome://flags/#webxr-webgpu-binding`),
  camera permission, BarcodeDetector, compass, Wake Lock, vibration, Service
  Worker and offline cache, with a French fix for every failure and a verdict.
- Live tests: rear camera + QR read, compass rate, and a **real 20 s
  `immersive-ar` + `webgpu` session** rendered through `XRGPUBinding` with raw
  WebGPU (start time, FPS, p95 frame time, stutters, tracking %, time to
  floor, anchor). Plain-text report to copy into the test log.
- `docs/demo-phone-setup.md`: one-time phone setup, live test targets,
  defence-day checklist and test log.
- `scripts/test-diagnostic.mjs`: 9 Node tests for the verdict logic.
- **Fixed-distance arrow fallback** (cahier risk "Hit Testing instable"):
  `FloorEstimator` (`src/ar-guidance.js`) tracks the floor as *searching*,
  *detected* (median of ARCore hits) or *estimated* (no floor after 3 s:
  1.45 m under the phone, smoothed over 1.2 s). A tap with no floor places the
  arrow 1.5 m ahead on the estimated floor, anchored with
  `XRFrame.createAnchor` when available. One status message when the floor
  state changes; the HUD shows « sol détecté / estimé ».
- 6 Node tests for the floor fallback and the fixed-distance arrow.

### Changed

- The **AR : …** badge links to the diagnostic; "AR unavailable" messages
  point to it.
- Cache bumped to `v3.2.0` (diagnostic precached); `npm test` runs 40 tests.

### Fixed

- Without an ARCore floor hit, the chevrons followed the hand (floor = phone
  height − 1.45 m every frame); the estimate is now smoothed.
- A tap without a floor hit did nothing; it now places the arrow at 1.5 m.
- After a storey change, old floor hits outvoted the new floor for up to 8
  hits; they are now dropped when they no longer match the phone height.
- A new tap now deletes the previous `XRAnchor` instead of leaking it.

### Known issue (corrected in 3.5.0)

- ~~The 3D campus view freezes headless Chrome.~~ Wrong diagnosis: the
  cause was the service worker forcing a reload of every open tab when it
  activated (see 3.5.0, Fixed).

### Verified

- Desktop Chrome (real clock, phone viewport): every check completes, the
  verdict lists ARCore and the flag as the two blockers.
- After opening the app twice: Service Worker in control, the 5 critical
  files cached (6.9 MB).
- Simulated ARCore device whose `XRGPUBinding` returns real GPU textures:
  floor found → "AR WebGPU fonctionnelle"; no floor → warning; flag off →
  AR test disabled with the flag card; session refused → flag fix shown.
  No WebGPU validation errors.

## [3.1.0] - 2026-11-12

**Real turn-by-turn AR guidance.** The AR mode now knows where the user is at
every moment and guides step by step, instead of placing one arrow.

### Added

- `src/ar-guidance.js` (`ARGuidance`): live localization during the AR session.
  The QR scan fixes the start point, ARCore tracks every step and rotation, and
  the yaw between the AR world and true north starts from the compass and is
  then corrected by **map matching**: the walked trajectory is fitted to the
  walkable cells of the SUP'COM plan (walls are a hard constraint, the route a
  soft one). Floors are followed from the phone height on stairs, and the
  position is re-anchored on the stairs landing; lifts are confirmed with a
  button.
- AR visuals in a frame aligned with the plan: the next 25 m of the route as
  flowing chevrons on the floor, large turn arrows at the coming turns,
  stairs / lift signs, destination pin, and the **real walls as invisible depth
  occluders** so guidance never shows through a wall.
- AR HUD (DOM overlay): live instruction ("Dans 6 m, tournez à gauche",
  "Faites demi-tour"), an arrow that turns with the user, remaining distance,
  floor and current room / corridor, position confidence, heading-up mini-map
  of the real walls, **Aligner sur le trajet**, **Je suis à…** (snap to a nearby
  place), **Je suis sorti de l'ascenseur**, **Quitter AR**.
- Automatic rerouting after leaving the route; arrival detection with
  vibration; the map shows where AR tracking left the user.
- `scripts/test-guidance.mjs`: 12 simulated walks through SUP'COM (unknown AR
  yaw, compass biased by ±15°): mean position error < 0.6 m, alignment within
  3°, arrival, stairs to the 3rd floor, rerouting and "Faites demi-tour".
- `?debug` exposes the live tracking state for field tests.

### Changed

- Cache bumped to `v3.1.0`; `npm test` runs both test files (25 tests).

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
