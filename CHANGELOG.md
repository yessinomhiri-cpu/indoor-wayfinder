# Changelog

All notable changes to Indoor Wayfinder are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
