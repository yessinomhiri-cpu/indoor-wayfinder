/**
 * ==========================================================================
 * Module       : main.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-04
 * Modified     : 2026-11-12
 * Version      : 3.1.0 (SUP'COM campus – WebGPU, multi-floor, compass, GPS)
 * Description  : Application controller and NavigationService facade: wires
 *                the QR scanner, the SUP'COM campus model and router, the
 *                WebGPU 3D view, immersive-ar guidance, compass, outdoor GPS,
 *                survey mode and the mobile UI (accessible dialogs, toast,
 *                destination sheet, route panel), plus Service Worker
 *                registration.
 * ==========================================================================
 */

import { QrScanner } from './scanner.js';
import { CampusMap, CampusRouter, ShortestPathStrategy, AvoidStairsStrategy } from './navigation.js';
import { CampusView3D } from './view3d.js';
import { ARGuide, isUserActivationError } from './ar.js';
import { Compass, GpsTracker, shortCardinal } from './geo.js';
import { SurveyStore } from './survey.js';
import { hasWebGPU } from './gpu.js';

const APP_VERSION = '3.1.0';
const CAMPUS_URL = 'assets/campus/supcom.json';
const WALKING_SPEED = 1.2; // m/s

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

const sceneContainer = $('scene-container');
const uiOverlayElement = $('ui-overlay');
const mapViewElement = $('map-view');
const map3dElement = $('map-3d');
const mapUnsupportedElement = $('map-unsupported');
const mapHintElement = $('map-hint');
const mapEyebrowElement = $('map-eyebrow');
const floorTabsElement = $('floor-tabs');
const view3dButton = $('btn-view-3d');
const viewTopButton = $('btn-view-top');
const gpsButton = $('btn-gps');
const surveyButton = $('btn-survey');
const compassButton = $('btn-compass');
const compassRoseElement = $('compass-rose');
const compassReadoutElement = $('compass-readout');
const arSupportBadgeElement = $('ar-support-badge');

const renderFallbackElement = $('render-fallback');
const renderFallbackMessageElement = $('render-fallback-message');
const statusToastElement = $('status-toast');
const statusMessageElement = $('status-message');
const networkStatusBadge = $('network-status-badge');
const networkStatusLabel = $('network-status-label');

const surveyPanelElement = $('survey-panel');
const surveyHelpElement = $('survey-help');
const surveyNameInput = $('survey-name');
const surveySaveButton = $('btn-survey-save');
const surveyPassageButton = $('btn-survey-passage');
const surveyUndoButton = $('btn-survey-undo');
const surveyExportButton = $('btn-survey-export');
const surveyCountElement = $('survey-count');

const routePanelElement = $('route-panel');
const routeTitleElement = $('route-title');
const routeSummaryElement = $('route-summary');
const routeStepsElement = $('route-steps');
const avoidStairsInput = $('route-avoid-stairs');
const startArButton = $('btn-start-ar');
const startArLabelElement = $('btn-start-ar-label');
const stopArButton = $('btn-stop-ar');
const closeRouteButton = $('btn-close-route');
const rescanRouteButton = $('btn-rescan-route');

const positionChipElement = $('position-chip');
const positionLabelElement = $('position-label');
const rescanButton = $('btn-rescan');
const scanTriggerButton = $('btn-scan');
const destinationTriggerButton = $('btn-destination');

const scanOverlayElement = $('scan-overlay');
const scanVideoElement = $('scan-video');
const scanCanvasElement = $('scan-canvas');
const closeScanButton = $('btn-close-scan');
const qrFileInput = $('qr-file-input');

const sheetBackdropElement = $('sheet-backdrop');
const destinationSheetElement = $('destination-sheet');
const sheetDragHandleBar = $('sheet-drag-handle-bar');
const closeDestinationButton = $('btn-close-destination');
const startSelectElement = $('start-select');
const destinationSearchInput = $('destination-search-input');
const destinationListScroll = $('destination-list-scroll');
const destinationsLoadingElement = $('destinations-loading');
const noDestinationsFoundMsg = $('no-destinations-found');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {CampusMap|null} */
let campus = null;
/** @type {CampusRouter|null} */
let router = null;
/** @type {CampusView3D|null} */
let view = null;
/** @type {ARGuide|null} */
let arGuide = null;
let arStatus = { supported: false, reason: 'loading' };

const qrScanner = new QrScanner();
const compass = new Compass();
const survey = new SurveyStore();
/** @type {GpsTracker|null} */
let gps = null;

/**
 * Where the user is: a place (QR / picker) or a point (map tap / GPS).
 * @type {{level:number, x:number, y:number, name:string, placeId:string|null, source:string}|null}
 */
let currentPosition = null;
/** @type {string|null} */
let currentDestinationId = null;
/** @type {Object|null} */
let currentRoute = null;
/** @type {Map<string, number>} */
let distanceCache = new Map();
let distanceCacheKey = '';
let surveyMode = false;
let surveySelection = null;
let passageStart = null;
let wakeLock = null;
let toastTimer = null;

// ===========================================================================
// UI helpers
// ===========================================================================

/**
 * showStatusToast
 * ---------------
 * @param {string} message – Text of the discreet status toast.
 * @param {number} [durationMs=4200]
 */
function showStatusToast(message, durationMs = 4200) {
  if (!statusToastElement || !statusMessageElement) return;
  statusMessageElement.textContent = message;
  statusToastElement.classList.remove('toast-hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => statusToastElement.classList.add('toast-hidden'), durationMs);
}

function showRenderFallback(message) {
  if (renderFallbackMessageElement && message) renderFallbackMessageElement.textContent = message;
  if (renderFallbackElement) renderFallbackElement.hidden = false;
}

const levelLabel = (level) => (level === 0 ? 'Rez-de-chaussée' : `Étage ${level}`);
const levelShort = (level) => (level === 0 ? 'RDC' : `E${level}`);
const blockLabel = (block) => (block && block !== 'H' ? `Bloc ${block}` : 'Hall');

/** Selector for elements that can receive keyboard focus. */
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapFocus(event, container) {
  if (event.key !== 'Tab') return;
  const items = [...container.querySelectorAll(FOCUSABLE_SELECTOR)]
    .filter((element) => !element.closest('[inert]') && element.getClientRects().length > 0);
  if (!items.length) { event.preventDefault(); return; }
  const first = items[0];
  const last = items[items.length - 1];
  if (!container.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

// ===========================================================================
// Position & destination (NavigationService)
// ===========================================================================

/**
 * setCurrentPlace
 * ---------------
 * Applies a place as the current position (QR scan or start picker).
 *
 * @param {string} placeId – Place id, room code or alias.
 * @param {string} source – 'qr' | 'manual'.
 * @returns {boolean} True when the place exists.
 */
function setCurrentPlace(placeId, source) {
  const place = campus && campus.getPlace(placeId);
  if (!place) return false;
  setCurrentPosition({ level: place.level, x: place.x, y: place.y, name: place.name, placeId: place.id, source });
  return true;
}

/**
 * setCurrentPosition
 * ------------------
 * Observer entry point: every position change refreshes the chip, the
 * distances, the route and the 3D view.
 */
function setCurrentPosition(position) {
  currentPosition = position;
  updatePositionChip();
  distanceCacheKey = '';
  scheduleDistanceUpdate();
  updateRoute();

  if (currentDestinationId && position.placeId === currentDestinationId) {
    if ('vibrate' in navigator) {
      try { navigator.vibrate([200, 100, 200]); } catch (error) { /* not supported */ }
    }
    showStatusToast('🎉 Vous êtes arrivé à destination', 6000);
  }
}

function currentEndpoint() {
  if (!currentPosition) return null;
  return currentPosition.placeId || { level: currentPosition.level, x: currentPosition.x, y: currentPosition.y };
}

function updatePositionChip() {
  if (positionChipElement) positionChipElement.hidden = !currentPosition;
  if (positionLabelElement) {
    positionLabelElement.textContent = currentPosition
      ? `${currentPosition.name} (${levelShort(currentPosition.level)})`
      : '—';
  }
  if (startSelectElement) startSelectElement.value = currentPosition && currentPosition.placeId ? currentPosition.placeId : '';
}

/**
 * selectDestination
 * -----------------
 * @param {string} placeId – Destination place id.
 */
function selectDestination(placeId) {
  const place = campus.getPlace(placeId);
  if (!place) return;
  currentDestinationId = place.id;
  showStatusToast(`Destination : ${place.name}`, 3500);
  closeDestinationSheet();
  updateRoute();
  renderDestinationList();
}

/**
 * updateRoute
 * -----------
 * Recomputes the multi-floor route (Dijkstra, current strategy) and refreshes
 * the route panel and the 3D view.
 */
function updateRoute() {
  if (!campus) return;
  const destination = currentDestinationId ? campus.getPlace(currentDestinationId) : null;
  currentRoute = null;
  if (destination && currentPosition) {
    currentRoute = router.findRoute(currentEndpoint(), destination.id);
  }
  renderRoutePanel(destination);
  if (view) {
    view.setState({ current: currentPosition, destination, route: currentRoute });
    if (compass.heading !== null) view.setHeading(compass.heading);
  }
  updateMapHint();
  updateFloorTabs();
}

function renderRoutePanel(destination) {
  if (!routePanelElement) return;
  if (!destination) {
    routePanelElement.classList.remove('is-open');
    routePanelElement.hidden = true;
    return;
  }
  routeTitleElement.textContent = `${destination.name} · ${levelShort(destination.level)}`;
  routeStepsElement.replaceChildren();
  startArButton.disabled = true;

  if (!currentPosition) {
    routeSummaryElement.textContent = 'Scannez un QR code ou choisissez un départ pour calculer l’itinéraire.';
  } else if (!currentRoute || !currentRoute.found) {
    routeSummaryElement.textContent = currentRoute && currentRoute.reason ? currentRoute.reason : 'Aucun itinéraire disponible.';
  } else if (currentRoute.distance === 0 && !currentRoute.legs.length) {
    routeSummaryElement.textContent = 'Vous êtes déjà sur place.';
  } else {
    const floorsChanged = currentRoute.steps.filter((s) => s.kind === 'stairs' || s.kind === 'lift').length;
    const connectorSeconds = currentRoute.steps.reduce((sum, s) => sum + (s.kind === 'stairs' ? 20 : s.kind === 'lift' ? 45 : 0), 0);
    const minutes = Math.max(1, Math.round((currentRoute.distance / WALKING_SPEED + connectorSeconds) / 60));
    routeSummaryElement.textContent =
      `${Math.round(currentRoute.distance)} m · ≈ ${minutes} min` +
      (floorsChanged ? ` · ${floorsChanged} changement${floorsChanged > 1 ? 's' : ''} d’étage` : '') +
      (currentRoute.approximate ? ' · accès à confirmer' : '');

    let index = 0;
    for (const step of currentRoute.steps) {
      const item = document.createElement('li');
      item.className = 'route-step';
      if (step.kind === 'warning') item.classList.add('is-warning');
      if (step.kind === 'stairs' || step.kind === 'lift') item.classList.add('is-connector');
      const badge = document.createElement('span');
      badge.className = 'route-step-index';
      badge.textContent = step.kind === 'start' ? '•' : step.kind === 'arrive' ? '★' : step.kind === 'stairs' ? '▤' : step.kind === 'lift' ? '⇅' : step.kind === 'warning' ? '!' : String(++index);
      const label = document.createElement('span');
      label.className = 'route-step-name';
      label.textContent = step.text;
      item.append(badge, label);
      if (step.kind === 'walk') {
        const distance = document.createElement('span');
        distance.className = 'route-step-distance';
        distance.textContent = shortCardinal(step.bearing);
        item.appendChild(distance);
      }
      routeStepsElement.appendChild(item);
    }
    startArButton.disabled = false;
  }

  routePanelElement.hidden = false;
  routePanelElement.classList.add('is-compact');
  requestAnimationFrame(() => {
    routePanelElement.classList.add('is-open');
    if (view) view.resize();
  });
}

function hideRoutePanel() {
  routePanelElement.classList.remove('is-open');
  routePanelElement.hidden = true;
  if (view) view.resize();
}

function updateMapHint() {
  if (!mapHintElement) return;
  if (!campus) { mapHintElement.textContent = 'Chargement du plan de SUP’COM…'; return; }
  if (surveyMode) {
    mapHintElement.textContent = passageStart
      ? 'Relevé : touchez l’autre côté du passage manquant.'
      : 'Relevé : touchez une salle pour la nommer.';
    return;
  }
  if (!currentPosition) {
    mapHintElement.textContent = 'Scannez un QR code, choisissez un départ, ou touchez le plan pour vous placer.';
    return;
  }
  if (currentRoute && currentRoute.found && currentRoute.distance > 0) {
    mapHintElement.textContent = 'Suivez la ligne cyan · glissez pour pivoter, pincez pour zoomer.';
    return;
  }
  mapHintElement.textContent = `Position : ${currentPosition.name}. Choisissez une destination.`;
}

// ===========================================================================
// Distances for the destination list (one Dijkstra pass, deferred)
// ===========================================================================

let distanceTimer = null;
function scheduleDistanceUpdate() {
  clearTimeout(distanceTimer);
  distanceTimer = setTimeout(() => {
    const endpoint = currentEndpoint();
    const key = endpoint ? `${JSON.stringify(endpoint)}|${router.strategy.label}` : '';
    if (!endpoint || key === distanceCacheKey) return;
    distanceCache = router.distancesFrom(endpoint);
    distanceCacheKey = key;
    renderDestinationList();
  }, 120);
}

// ===========================================================================
// Destination sheet & start picker
// ===========================================================================

const KIND_ICON = { amphi: '🎓', place: '🏛️', room: '🚪', stairs: '▤', lift: '⇅' };
const KIND_ORDER = { amphi: 0, place: 1, stairs: 2, lift: 3, room: 4 };

function sortedPlaces() {
  return campus.getPlaces().sort((a, b) =>
    (b.official || b.surveyed ? 1 : 0) - (a.official || a.surveyed ? 1 : 0) ||
    (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) ||
    a.level - b.level ||
    String(a.code || a.id).localeCompare(String(b.code || b.id), 'fr', { numeric: true }));
}

function renderStartOptions() {
  if (!startSelectElement || !campus) return;
  const placeholder = startSelectElement.querySelector('option[value=""]');
  startSelectElement.replaceChildren();
  if (placeholder) startSelectElement.appendChild(placeholder);
  const groups = new Map();
  for (const place of sortedPlaces()) {
    const key = place.official || place.surveyed ? 'Lieux principaux' : levelLabel(place.level);
    if (!groups.has(key)) {
      const group = document.createElement('optgroup');
      group.label = key;
      groups.set(key, group);
      startSelectElement.appendChild(group);
    }
    const option = document.createElement('option');
    option.value = place.id;
    option.textContent = `${place.name} — ${levelShort(place.level)}`;
    groups.get(key).appendChild(option);
  }
  startSelectElement.value = currentPosition && currentPosition.placeId ? currentPosition.placeId : '';
}

function renderDestinationList() {
  if (!destinationListScroll) return;
  destinationListScroll.querySelectorAll('.destination-item').forEach((item) => item.remove());
  if (!campus) return;
  if (destinationsLoadingElement) destinationsLoadingElement.style.display = 'none';

  const fragment = document.createDocumentFragment();
  for (const place of sortedPlaces()) {
    const item = document.createElement('article');
    item.className = 'destination-item';
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-pressed', String(currentDestinationId === place.id));
    item.dataset.destinationId = place.id;

    const icon = document.createElement('div');
    icon.className = 'dest-icon-badge';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = KIND_ICON[place.kind] || '📍';

    const details = document.createElement('div');
    details.className = 'dest-details';
    const name = document.createElement('div');
    name.className = 'dest-name';
    name.textContent = place.name;
    const description = document.createElement('div');
    description.className = 'dest-description';
    description.textContent = [
      blockLabel(place.block),
      levelLabel(place.level),
      place.area ? `${place.area} m²` : null,
      place.code && place.code !== place.id ? place.code : null,
      !place.official && !place.surveyed && place.kind === 'room' ? 'nom à relever' : null
    ].filter(Boolean).join(' · ');
    details.append(name, description);

    const meta = document.createElement('div');
    meta.className = 'dest-meta';
    const tag = document.createElement('span');
    tag.className = 'dest-tag';
    tag.textContent = levelShort(place.level);
    const distance = document.createElement('span');
    distance.className = 'dest-distance';
    if (currentPosition && currentPosition.placeId === place.id) distance.textContent = 'Départ';
    else if (!currentPosition) distance.textContent = '—';
    else if (distanceCache.has(place.id)) distance.textContent = `${Math.round(distanceCache.get(place.id))} m`;
    else distance.textContent = distanceCacheKey ? 'accès ?' : '…';
    meta.append(tag, distance);

    item.append(icon, details, meta);
    fragment.appendChild(item);
  }
  if (noDestinationsFoundMsg) destinationListScroll.insertBefore(fragment, noDestinationsFoundMsg);
  else destinationListScroll.appendChild(fragment);
  filterDestinations(destinationSearchInput ? destinationSearchInput.value : '');
}

function filterDestinations(query) {
  const normalized = normalize(query);
  let visible = 0;
  destinationListScroll.querySelectorAll('.destination-item').forEach((item) => {
    const match = !normalized || normalize(item.textContent).includes(normalized) ||
      normalize(item.dataset.destinationId).includes(normalized);
    item.style.display = match ? 'flex' : 'none';
    if (match) visible++;
  });
  if (noDestinationsFoundMsg) noDestinationsFoundMsg.style.display = visible ? 'none' : 'block';
}

const normalize = (text) => (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function openDestinationSheet() {
  if (!destinationSheetElement || !campus) return;
  uiOverlayElement.inert = true;
  mapViewElement.inert = true;
  destinationSheetElement.inert = false;
  sheetBackdropElement.classList.add('is-open');
  destinationSheetElement.classList.add('is-open');
  destinationSheetElement.setAttribute('aria-hidden', 'false');
  destinationTriggerButton.setAttribute('aria-expanded', 'true');
  destinationSearchInput.value = '';
  renderDestinationList();
  setTimeout(() => destinationSearchInput.focus(), 150);
}

function closeDestinationSheet() {
  if (!destinationSheetElement) return;
  destinationSheetElement.style.transform = '';
  sheetBackdropElement.classList.remove('is-open');
  destinationSheetElement.classList.remove('is-open');
  destinationSheetElement.setAttribute('aria-hidden', 'true');
  destinationSheetElement.inert = true;
  uiOverlayElement.inert = false;
  mapViewElement.inert = false;
  destinationTriggerButton.setAttribute('aria-expanded', 'false');
}

function setupTouchDismissSheet(sheet, handle) {
  if (!sheet || !handle) return;
  let startY = 0;
  let currentY = 0;
  const reset = () => { sheet.style.transform = ''; startY = currentY = 0; };
  handle.addEventListener('touchstart', (e) => { startY = currentY = e.touches[0].clientY; }, { passive: true });
  handle.addEventListener('touchmove', (e) => {
    currentY = e.touches[0].clientY;
    const delta = currentY - startY;
    sheet.style.transform = delta > 0 ? `translateY(${Math.min(delta, 200)}px)` : '';
  }, { passive: true });
  handle.addEventListener('touchend', () => {
    const dismiss = currentY - startY > 60;
    reset();
    if (dismiss) closeDestinationSheet();
  });
  handle.addEventListener('touchcancel', reset);
}

// ===========================================================================
// QR scanner
// ===========================================================================

function handleQrDetection(rawQrCode) {
  const value = (rawQrCode || '').trim();
  if (!campus) { showStatusToast('Plan du campus en cours de chargement…', 3000); return; }
  if (setCurrentPlace(value, 'qr')) {
    if ('vibrate' in navigator) {
      try { navigator.vibrate([100, 50, 100]); } catch (error) { /* not supported */ }
    }
    const place = campus.getPlace(value);
    showStatusToast(`📍 Vous êtes ici : ${place.name} (${levelShort(place.level)})`, 6000);
    closeScanOverlay();
    if (view) view.focusPlace(place);
  } else {
    showStatusToast(`⚠️ QR code inconnu : ${value}`, 3500);
  }
}

async function openScanOverlay() {
  if (!scanOverlayElement) return;
  uiOverlayElement.inert = true;
  mapViewElement.inert = true;
  scanOverlayElement.inert = false;
  scanOverlayElement.classList.add('is-open');
  scanOverlayElement.setAttribute('aria-hidden', 'false');
  scanTriggerButton.setAttribute('aria-expanded', 'true');
  closeScanButton.focus();
  try {
    await qrScanner.start(scanVideoElement, scanCanvasElement);
  } catch (error) {
    console.warn('[main] Caméra indisponible :', error);
    showStatusToast('Accès à la caméra refusé ou non disponible', 4000);
  }
}

function closeScanOverlay() {
  if (!scanOverlayElement) return;
  qrScanner.stop();
  scanOverlayElement.classList.remove('is-open');
  scanOverlayElement.setAttribute('aria-hidden', 'true');
  scanOverlayElement.inert = true;
  uiOverlayElement.inert = false;
  mapViewElement.inert = false;
  scanTriggerButton.setAttribute('aria-expanded', 'false');
  scanTriggerButton.focus();
}

// ===========================================================================
// 3D view, floors, map taps
// ===========================================================================

function updateFloorTabs() {
  if (!floorTabsElement || !view) return;
  const shown = view.showAllFloors ? 'all' : String(view.getFloor());
  floorTabsElement.querySelectorAll('[data-floor]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.floor === shown));
  });
  if (mapEyebrowElement) {
    mapEyebrowElement.textContent = `Campus El Ghazala · ${view.showAllFloors ? 'Tous les niveaux' : levelLabel(view.getFloor())}`;
  }
}

function getRoutePanelOcclusion() {
  if (!map3dElement || !routePanelElement || routePanelElement.hidden) return 0;
  const canvasRect = map3dElement.getBoundingClientRect();
  const panelRect = routePanelElement.getBoundingClientRect();
  return Math.max(0, canvasRect.bottom - panelRect.top);
}

/**
 * placeAt
 * -------
 * Room or place under a point of the plan (smallest room bbox first).
 */
function placeAt(level, x, y) {
  let best = null;
  for (const place of campus.getPlaces()) {
    if (place.level !== level) continue;
    if (place.bbox) {
      const [x0, y0, x1, y1] = place.bbox;
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
        const area = (x1 - x0) * (y1 - y0);
        if (!best || area < best.area) best = { place, area };
      }
    }
  }
  if (best) return best.place;
  let nearest = null;
  for (const place of campus.getPlaces()) {
    if (place.level !== level) continue;
    const distance = Math.hypot(place.x - x, place.y - y);
    if (distance < 6 && (!nearest || distance < nearest.distance)) nearest = { place, distance };
  }
  return nearest ? nearest.place : null;
}

function handleMapPick({ level, x, y, outdoor }) {
  if (surveyMode) {
    handleSurveyPick(level, x, y);
    return;
  }
  const place = placeAt(level, x, y);
  setCurrentPosition({
    level,
    x,
    y,
    name: place ? place.name : outdoor ? 'Extérieur (point du plan)' : `Point du plan (${levelShort(level)})`,
    placeId: null,
    source: 'map'
  });
  showStatusToast(`Démo — position placée : ${place ? place.name : 'point du plan'} (${levelShort(level)})`, 3500);
}

// ===========================================================================
// Survey mode
// ===========================================================================

function setSurveyMode(enabled) {
  surveyMode = enabled;
  surveyButton.setAttribute('aria-pressed', String(enabled));
  surveyPanelElement.hidden = !enabled;
  surveySelection = null;
  passageStart = null;
  surveyPassageButton.setAttribute('aria-pressed', 'false');
  surveyNameInput.value = '';
  surveyNameInput.disabled = true;
  surveySaveButton.disabled = true;
  surveyHelpElement.textContent = 'Touchez une salle sur le plan pour lui donner le nom affiché sur sa porte.';
  updateSurveyCount();
  updateMapHint();
}

function handleSurveyPick(level, x, y) {
  if (surveyPassageButton.getAttribute('aria-pressed') === 'true') {
    if (!passageStart) {
      passageStart = { level, x, y };
      surveyHelpElement.textContent = 'Passage : touchez maintenant l’autre côté de la porte manquante.';
    } else {
      if (passageStart.level !== level) {
        showStatusToast('Les deux points du passage doivent être au même étage', 3500);
        return;
      }
      survey.addPassage({ level, from: [passageStart.x, passageStart.y], to: [x, y], note: 'Passage relevé sur place' });
      showStatusToast('Passage enregistré (pris en compte après export + import)', 4000);
      passageStart = null;
      surveyHelpElement.textContent = 'Passage enregistré. Touchez deux points pour un autre passage.';
    }
    updateMapHint();
    return;
  }

  const place = placeAt(level, x, y);
  if (!place) {
    surveyHelpElement.textContent = 'Aucune salle détectée ici — touchez l’intérieur d’une salle.';
    return;
  }
  surveySelection = place;
  surveyNameInput.disabled = false;
  surveySaveButton.disabled = false;
  surveyNameInput.value = survey.names[place.code || place.id] || (place.official || place.surveyed ? place.name : '');
  surveyHelpElement.textContent = `${place.code || place.id} · ${blockLabel(place.block)} · ${levelLabel(place.level)}${place.area ? ` · ${place.area} m²` : ''}`;
  surveyNameInput.focus();
  if (view) view.focusPlace(place);
}

function saveSurveyName() {
  if (!surveySelection) return;
  const code = surveySelection.code || surveySelection.id;
  const name = surveyNameInput.value.trim();
  survey.nameRoom(code, name);
  if (name) campus.renamePlace(surveySelection.id, name);
  showStatusToast(name ? `Salle ${code} : « ${name} » enregistrée` : `Nom de ${code} effacé`, 3500);
  renderStartOptions();
  renderDestinationList();
}

function updateSurveyCount() {
  if (surveyCountElement) surveyCountElement.textContent = String(survey.count);
}

/** Applies names saved on this device (survey mode) to the campus model. */
function applySurveyNames() {
  for (const [code, name] of Object.entries(survey.names)) campus.renamePlace(code, name);
}

// ===========================================================================
// Compass & GPS
// ===========================================================================

function handleHeading(heading) {
  if (compassRoseElement) compassRoseElement.style.transform = `rotate(${-heading}deg)`;
  if (compassButton) compassButton.classList.toggle('is-off', !compass.isReliable);
  if (compassReadoutElement) compassReadoutElement.textContent = `${shortCardinal(heading)} ${Math.round(heading)}°`;
  if (view) view.setHeading(heading);
}

async function startCompass(fromGesture) {
  const ok = await compass.start();
  if (!ok && fromGesture && compass.heading === null) {
    showStatusToast(compass.permission === 'denied'
      ? 'Boussole refusée : autorisez « Capteurs de mouvement » pour ce site dans Chrome'
      : 'Boussole indisponible sur cet appareil', 4500);
  }
  if (fromGesture) {
    setTimeout(() => {
      if (compass.heading === null) showStatusToast('Boussole : aucune mesure (capteur absent ou ordinateur)', 4500);
      else if (!compass.isReliable) showStatusToast('Boussole perturbée : faites un 8 avec le téléphone pour la calibrer', 5000);
    }, 2500);
  }
}

function toggleGps() {
  if (!gps) return;
  if (gps.isRunning) {
    gps.stop();
    gpsButton.setAttribute('aria-pressed', 'false');
    if (view) view.setGps(null);
    showStatusToast('GPS désactivé', 2500);
    return;
  }
  if (!GpsTracker.isSupported()) {
    showStatusToast('GPS non disponible sur ce navigateur', 3500);
    return;
  }
  gps.start();
  gpsButton.setAttribute('aria-pressed', 'true');
  showStatusToast('GPS : recherche de la position… (à l’extérieur des bâtiments)', 4000);
}

function handleGpsFix(fix, error) {
  if (error && !fix) {
    showStatusToast(error.code === 1 ? 'Localisation refusée : autorisez-la dans Chrome' : 'Position GPS indisponible', 4500);
    gpsButton.setAttribute('aria-pressed', 'false');
    return;
  }
  if (!fix) return;
  const near = Math.hypot(fix.x, fix.y) < 700;
  if (view) view.setGps(near ? fix : null);
  if (!near) {
    showStatusToast(`GPS : vous êtes à ${Math.round(Math.hypot(fix.x, fix.y))} m de SUP’COM`, 4000);
    return;
  }
  // Outdoors only: GPS is too imprecise inside the building (use QR codes)
  if (fix.accuracy > 30) {
    showStatusToast(`GPS imprécis (± ${Math.round(fix.accuracy)} m) : scannez un QR code à l’intérieur`, 4000);
    return;
  }
  if (!currentPosition || currentPosition.source === 'gps') {
    setCurrentPosition({ level: 0, x: fix.x, y: fix.y, name: `Position GPS (± ${Math.round(fix.accuracy)} m)`, placeId: null, source: 'gps' });
  }
}

// ===========================================================================
// AR guidance (WebXR immersive-ar on WebGPU)
// ===========================================================================

function setARView(isAR) {
  mapViewElement.hidden = isAR;
  sceneContainer.classList.toggle('is-ar-active', isAR);
  if (view) view.setActive(!isAR);
}

function updateARControls(isActive) {
  startArButton.hidden = isActive;
  stopArButton.hidden = !isActive;
  document.body.classList.toggle('is-ar-session', isActive);
  arHudElement.hidden = !isActive;
  setARView(isActive);
  if (isActive) {
    requestWakeLock();
    arLandmarkRefresh = 0;
    lastArState = null;
    arInstructionText.textContent = 'Initialisation du suivi…';
    arInstructionSub.textContent = 'Visez le sol et marchez lentement';
  } else {
    releaseWakeLock();
    // Back on the map: show where the AR tracking left the user
    if (lastArState && lastArState.position && campus) {
      const p = lastArState.position;
      const place = placeAt(p.level, p.x, p.y);
      setCurrentPosition({ level: p.level, x: p.x, y: p.y, name: place ? place.name : 'Position AR', placeId: null, source: 'ar' });
    }
  }
}

// ===========================================================================
// Live AR guidance HUD
// ===========================================================================

const arHudElement = $('ar-hud');
const arInstructionElement = $('ar-instruction');
const arInstructionText = $('ar-instruction-text');
const arInstructionSub = $('ar-instruction-sub');
const arTurnIcon = $('ar-turn-icon');
const arMinimap = $('ar-minimap');
const arCalibrationElement = $('ar-calibration');
const arLiftButton = $('btn-ar-lift');
const arAlignButton = $('btn-ar-align');
const arLandmarkSelect = $('ar-landmark');
const arQuitButton = $('btn-ar-quit');
let lastArState = null;
let arLandmarkRefresh = 0;
/** @type {Map<number, Float32Array>} wall segments per floor for the mini-map */
const minimapWalls = new Map();

/**
 * updateArHud
 * -----------
 * Observer of ARGuidance (≈ 6 Hz): instruction, live direction arrow,
 * remaining distance, location, calibration and mini-map.
 */
function updateArHud(state) {
  lastArState = state;
  if (!state) return;
  const { position } = state;
  const place = placeAt(position.level, position.x, position.y);

  if (state.arrived) {
    arInstructionText.textContent = '🎉 Vous êtes arrivé';
    arInstructionSub.textContent = currentDestinationId ? campus.getPlace(currentDestinationId).name : '';
  } else if (state.awaitingLift) {
    arInstructionText.textContent = `Prenez l’ascenseur jusqu’${state.awaitingLift.toLevel === 0 ? 'au rez-de-chaussée' : `à l’étage ${state.awaitingLift.toLevel}`}`;
    arInstructionSub.textContent = 'À la sortie, touchez « Je suis sorti de l’ascenseur ».';
  } else if (state.instruction) {
    arInstructionText.textContent = state.offRoute ? 'Hors itinéraire — recalcul…' : state.instruction.text;
    arInstructionSub.textContent = [
      state.remaining !== undefined ? `${Math.round(state.remaining)} m restants` : null,
      levelLabel(position.level),
      place ? place.name : null
    ].filter(Boolean).join(' · ');
  }
  arInstructionElement.classList.toggle('is-off-route', Boolean(state.offRoute));
  arInstructionElement.classList.toggle('is-arrived', Boolean(state.arrived));
  // The arrow turns with the user: direction of the route relative to the phone
  if (state.relativeTurn !== undefined) arTurnIcon.style.transform = `rotate(${state.relativeTurn}deg)`;
  arLiftButton.hidden = !state.awaitingLift;

  const calibration = state.calibration;
  const source = calibration.source === 'map' ? 'calée sur les murs' : calibration.source === 'manual' ? 'alignement manuel' : 'boussole';
  arCalibrationElement.textContent = `Position ${source} · confiance ${Math.round(calibration.confidence * 100)} %`;

  drawMiniMap(state);

  // Nearby places for "Je suis à…" (refreshed every ~2 s)
  if (performance.now() - arLandmarkRefresh > 2000) {
    arLandmarkRefresh = performance.now();
    const nearby = campus.getPlaces()
      .filter((p) => p.level === position.level)
      .map((p) => ({ p, d: Math.hypot(p.x - position.x, p.y - position.y) }))
      .filter(({ d }) => d < 25)
      .sort((a, b) => a.d - b.d)
      .slice(0, 12);
    const selected = arLandmarkSelect.value;
    arLandmarkSelect.replaceChildren(new Option('Je suis à…', ''));
    for (const { p, d } of nearby) arLandmarkSelect.appendChild(new Option(`${p.name} (≈ ${Math.round(d)} m)`, p.id));
    arLandmarkSelect.value = selected && campus.getPlace(selected) ? selected : '';
  }
}

/** Heading-up mini-map of the real walls around the user (Canvas 2D). */
function drawMiniMap(state) {
  const context = arMinimap.getContext('2d');
  const size = arMinimap.width;
  const scale = size / 2 / 18; // 18 m radius
  const { x, y, level } = state.position;
  context.clearRect(0, 0, size, size);
  context.save();
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  context.clip();
  context.translate(size / 2, size / 2);
  context.rotate(-state.bearing * Math.PI / 180); // heading up
  const px = (wx) => (wx - x) * scale;
  const py = (wy) => -(wy - y) * scale;

  if (!minimapWalls.has(level)) {
    const floor = campus.getFloor(level);
    const segments = [];
    for (const part of [...(floor.walls || []), ...(floor.facade || [])]) {
      for (let i = 0; i + 3 < part.length; i += 2) segments.push(part[i], part[i + 1], part[i + 2], part[i + 3]);
    }
    minimapWalls.set(level, new Float32Array(segments));
  }
  const walls = minimapWalls.get(level);
  context.strokeStyle = 'rgba(203, 213, 225, 0.85)';
  context.lineWidth = 1.5;
  context.beginPath();
  const range = 20;
  for (let i = 0; i < walls.length; i += 4) {
    if (Math.abs(walls[i] - x) > range && Math.abs(walls[i + 2] - x) > range) continue;
    if (Math.abs(walls[i + 1] - y) > range && Math.abs(walls[i + 3] - y) > range) continue;
    context.moveTo(px(walls[i]), py(walls[i + 1]));
    context.lineTo(px(walls[i + 2]), py(walls[i + 3]));
  }
  context.stroke();

  if (state.ahead && state.ahead.length > 1) {
    context.strokeStyle = '#00d2ff';
    context.lineWidth = 4;
    context.lineCap = 'round';
    context.beginPath();
    state.ahead.forEach(([ax, ay], i) => (i ? context.lineTo(px(ax), py(ay)) : context.moveTo(px(ax), py(ay))));
    context.stroke();
  }
  context.restore();

  // User (always at the centre, pointing up)
  context.fillStyle = '#10b981';
  context.beginPath();
  context.moveTo(size / 2, size / 2 - 12);
  context.lineTo(size / 2 + 8, size / 2 + 8);
  context.lineTo(size / 2, size / 2 + 3);
  context.lineTo(size / 2 - 8, size / 2 + 8);
  context.closePath();
  context.fill();
  // North tick
  const n = -state.bearing * Math.PI / 180;
  context.fillStyle = '#f87171';
  context.font = 'bold 20px system-ui';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('N', size / 2 + Math.sin(n) * (size / 2 - 14), size / 2 - Math.cos(n) * (size / 2 - 14));
}

/** Off route for a few seconds: new route from the tracked position. */
function rerouteFrom(position) {
  if (!currentDestinationId) return;
  const route = router.findRoute({ level: position.level, x: position.x, y: position.y, maxSnap: 6 }, currentDestinationId);
  if (!route.found) return;
  currentRoute = route;
  arGuide.setRoute(route);
  showStatusToast('Itinéraire recalculé depuis votre position', 3000);
}

function handleArArrival() {
  if ('vibrate' in navigator) {
    try { navigator.vibrate([200, 100, 200, 100, 300]); } catch (error) { /* not supported */ }
  }
  showStatusToast('🎉 Vous êtes arrivé à destination', 6000);
}

function describeArError(error) {
  const name = error && error.name ? error.name : 'Error';
  const detail = error && error.message ? error.message : String(error);
  switch (name) {
    case 'NotAllowedError':
      return 'AR refusée : autorisez la caméra pour ce site dans Chrome, puis réessayez.';
    case 'SecurityError':
      if (isUserActivationError(error)) return 'Le toucher n’a pas été pris en compte par Chrome : touchez à nouveau « Guidage AR ».';
      return `AR bloquée par le navigateur (HTTPS requis) — ${detail}`;
    case 'NotSupportedError':
      return `AR WebGPU non supportée ici (Chrome + ARCore + chrome://flags/#webxr-webgpu-binding) — ${detail}`;
    default:
      return `Erreur AR (${name}) — ${detail}`;
  }
}

function arUnavailableMessage() {
  switch (arStatus.reason) {
    case 'webgpu-binding':
      return 'AR WebGPU : activez chrome://flags/#webxr-webgpu-binding dans Chrome Android, puis relancez Chrome. Itinéraire affiché en 3D.';
    case 'webgpu':
      return 'WebGPU indisponible sur ce téléphone : AR impossible. Itinéraire affiché en 3D.';
    case 'immersive-ar':
      return 'AR non disponible (Chrome Android + Google Play Services for AR requis). Itinéraire affiché en 3D.';
    case 'webxr':
      return 'WebXR non disponible sur ce navigateur. Itinéraire affiché en 3D.';
    default:
      return 'Vérification de l’AR en cours…';
  }
}

/**
 * startARGuide
 * ------------
 * Nothing is awaited before arGuide.start(): Chrome only accepts the session
 * request while the tap is fresh.
 */
async function startARGuide() {
  if (arGuide && arGuide.isActive) { arGuide.stop(); return; }
  if (arGuide && arGuide.isStarting) return;
  if (!currentRoute || !currentRoute.found || !currentPosition) {
    showStatusToast('Choisissez un départ et une destination', 3500);
    return;
  }
  if (!arGuide || !arStatus.supported) {
    view && view.setViewMode('3d');
    showStatusToast(arUnavailableMessage(), 8000);
    return;
  }

  const minimal = arGuide.sessionMode === 'minimal';
  const startPromise = arGuide.start(
    currentRoute,
    { level: currentPosition.level, x: currentPosition.x, y: currentPosition.y },
    campus.getPlace(currentDestinationId)
  );
  showStatusToast(minimal
    ? 'AR (mode simplifié) : interface masquée pendant l’AR — touchez le sol pour la flèche, bouton Retour pour quitter.'
    : 'Démarrage de la session AR… tenez-vous à l’endroit du QR scanné.', minimal ? 8000 : 4000);
  setARView(true);

  try {
    await startPromise;
  } catch (error) {
    console.error('[main] AR session failed:', error);
    updateARControls(false);
    if (error && error.retryNextTap) {
      showStatusToast(`AR : configuration simplifiée prête — touchez à nouveau « Guidage AR ». (cause : ${error.name}: ${error.message})`, 15000);
      return;
    }
    showStatusToast(describeArError(error), 15000);
  }
}

function updateArBadge() {
  if (!arSupportBadgeElement) return;
  const text = arStatus.supported ? 'AR : WebGPU prête'
    : arStatus.reason === 'webgpu-binding' ? 'AR : flag WebGPU-XR'
    : arStatus.reason === 'loading' ? 'AR : vérification…'
    : 'AR : non disponible';
  arSupportBadgeElement.textContent = text;
  arSupportBadgeElement.classList.toggle('is-ready', arStatus.supported);
  if (startArLabelElement) startArLabelElement.textContent = arStatus.supported ? 'Guidage AR' : 'Voir en 3D';
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen');
  } catch (error) {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}

// ===========================================================================
// Events
// ===========================================================================

function initUIEventListeners() {
  scanTriggerButton.addEventListener('click', openScanOverlay);
  closeScanButton.addEventListener('click', closeScanOverlay);
  destinationTriggerButton.addEventListener('click', openDestinationSheet);
  closeDestinationButton.addEventListener('click', closeDestinationSheet);
  sheetBackdropElement.addEventListener('click', closeDestinationSheet);
  setupTouchDismissSheet(destinationSheetElement, sheetDragHandleBar);
  destinationSearchInput.addEventListener('input', (event) => filterDestinations(event.target.value));

  const pick = (event) => {
    const item = event.target.closest('.destination-item');
    if (item) selectDestination(item.dataset.destinationId);
  };
  destinationListScroll.addEventListener('click', pick);
  destinationListScroll.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(event); }
  });

  startSelectElement.addEventListener('change', () => {
    const id = startSelectElement.value;
    if (id && setCurrentPlace(id, 'manual')) {
      const place = campus.getPlace(id);
      showStatusToast(`Départ : ${place.name} (${levelShort(place.level)})`, 3000);
    }
  });

  qrFileInput.addEventListener('change', async () => {
    const [file] = qrFileInput.files || [];
    if (!file) return;
    showStatusToast('Lecture du QR code…', 2500);
    try {
      const value = await qrScanner.scanImage(file);
      if (value) handleQrDetection(value);
      else showStatusToast('Aucun QR code lisible dans cette image', 4000);
    } catch (error) {
      console.error('[main] QR image decode failed:', error);
      showStatusToast('Impossible de lire cette image', 4000);
    } finally {
      qrFileInput.value = '';
    }
  });

  rescanButton.addEventListener('click', openScanOverlay);
  rescanRouteButton.addEventListener('click', openScanOverlay);
  closeRouteButton.addEventListener('click', () => { hideRoutePanel(); destinationTriggerButton.focus(); });
  startArButton.addEventListener('click', startARGuide);
  stopArButton.addEventListener('click', () => arGuide && arGuide.stop());
  arQuitButton.addEventListener('click', () => arGuide && arGuide.stop());
  arAlignButton.addEventListener('click', () => {
    if (arGuide && arGuide.alignToRoute()) showStatusToast('Aligné : face au trajet affiché sur la mini-carte', 3000);
  });
  arLiftButton.addEventListener('click', () => {
    if (!arGuide) return;
    arGuide.confirmLiftExit();
    showStatusToast('Étage confirmé, guidage repris', 3000);
  });
  arLandmarkSelect.addEventListener('change', () => {
    const place = campus.getPlace(arLandmarkSelect.value);
    if (!place || !arGuide) return;
    arGuide.snapToPlace(place);
    arLandmarkSelect.value = '';
    showStatusToast(`Position recalée : ${place.name}`, 3000);
  });
  avoidStairsInput.addEventListener('change', () => {
    router.setStrategy(avoidStairsInput.checked ? new AvoidStairsStrategy() : new ShortestPathStrategy());
    distanceCacheKey = '';
    scheduleDistanceUpdate();
    updateRoute();
    showStatusToast(router.strategy.label, 2500);
  });

  floorTabsElement.addEventListener('click', (event) => {
    const button = event.target.closest('[data-floor]');
    if (!button || !view) return;
    view.setFloor(button.dataset.floor === 'all' ? 'all' : Number(button.dataset.floor));
    updateFloorTabs();
  });
  view3dButton.addEventListener('click', () => {
    if (!view) return;
    view.setViewMode('3d');
    view3dButton.setAttribute('aria-pressed', 'true');
    viewTopButton.setAttribute('aria-pressed', 'false');
  });
  viewTopButton.addEventListener('click', () => {
    if (!view) return;
    view.setViewMode('top');
    view3dButton.setAttribute('aria-pressed', 'false');
    viewTopButton.setAttribute('aria-pressed', 'true');
  });
  gpsButton.addEventListener('click', toggleGps);
  compassButton.addEventListener('click', () => startCompass(true));

  surveyButton.addEventListener('click', () => setSurveyMode(!surveyMode));
  surveySaveButton.addEventListener('click', saveSurveyName);
  surveyNameInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') saveSurveyName(); });
  surveyPassageButton.addEventListener('click', () => {
    const on = surveyPassageButton.getAttribute('aria-pressed') !== 'true';
    surveyPassageButton.setAttribute('aria-pressed', String(on));
    passageStart = null;
    surveyHelpElement.textContent = on
      ? 'Passage manquant : touchez un côté de la porte absente du plan, puis l’autre côté.'
      : 'Touchez une salle sur le plan pour lui donner le nom affiché sur sa porte.';
    updateMapHint();
  });
  surveyUndoButton.addEventListener('click', () => {
    const undone = survey.undo();
    if (undone) {
      campus.resetSurveyNames();
      applySurveyNames();
      renderStartOptions();
      renderDestinationList();
    }
    showStatusToast(undone ? 'Dernière saisie annulée' : 'Rien à annuler', 2500);
  });
  surveyExportButton.addEventListener('click', () => {
    if (!survey.count) { showStatusToast('Aucune saisie à exporter', 2500); return; }
    survey.download();
    showStatusToast('corrections.json exporté : à fusionner dans assets/campus/', 4500);
  });
  survey.subscribe(updateSurveyCount);

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (scanOverlayElement.classList.contains('is-open')) closeScanOverlay();
      else if (destinationSheetElement.classList.contains('is-open')) closeDestinationSheet();
      else if (routePanelElement.classList.contains('is-open')) hideRoutePanel();
    } else if (event.key === 'Tab') {
      if (scanOverlayElement.classList.contains('is-open')) trapFocus(event, scanOverlayElement);
      else if (destinationSheetElement.classList.contains('is-open')) trapFocus(event, destinationSheetElement);
    }
  });

  window.addEventListener('online', updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);
  updateNetworkStatus();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && arGuide && arGuide.isActive) requestWakeLock();
  });
}

function updateNetworkStatus() {
  if (!networkStatusBadge || !networkStatusLabel) return;
  const online = navigator.onLine;
  networkStatusBadge.classList.toggle('is-offline', !online);
  networkStatusLabel.textContent = online ? 'En ligne' : 'Hors ligne';
  if (!online) showStatusToast('Mode hors ligne actif', 3500);
}

// ===========================================================================
// PWA
// ===========================================================================

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;
  // Reload once when a NEW worker takes over an already-controlled page, so
  // the HTML and the cached modules come from the same deployment.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || refreshing) return;
    refreshing = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then((registration) => registration.update().catch(() => {}))
      .catch((error) => console.warn('[Indoor Wayfinder] Service worker registration failed:', error));
  });
}

// ===========================================================================
// Bootstrap
// ===========================================================================

async function init() {
  initUIEventListeners();
  qrScanner.onDetect((code) => handleQrDetection(code));
  compass.subscribe(handleHeading);
  // Start the compass now (Android needs no permission) and again on the
  // first tap, which is the user gesture iOS / recent Chrome require.
  startCompass(false).catch(() => {});
  const startCompassOnTap = (event) => {
    if (compass.permission === 'granted' || compass.heading !== null) {
      document.removeEventListener('pointerdown', startCompassOnTap, true);
      return;
    }
    // Never on the AR button: that tap's activation belongs to requestSession()
    if (event.target.closest && event.target.closest('#btn-start-ar')) return;
    startCompass(false).catch(() => {});
  };
  document.addEventListener('pointerdown', startCompassOnTap, true);

  try {
    campus = await CampusMap.load(CAMPUS_URL);
  } catch (error) {
    console.error('[Indoor Wayfinder] Campus load failed:', error);
    if (mapHintElement) mapHintElement.textContent = 'Plan de SUP’COM indisponible.';
    showRenderFallback('Le plan de SUP’COM n’a pas pu être chargé. Vérifiez votre connexion, puis réinitialisez.');
    return;
  }
  applySurveyNames();
  router = new CampusRouter(campus);
  gps = new GpsTracker(campus);
  gps.subscribe(handleGpsFix);
  renderStartOptions();
  renderDestinationList();
  updateMapHint();

  // WebGPU campus view
  if (await hasWebGPU()) {
    view = new CampusView3D({ container: map3dElement, campus, onPick: handleMapPick, getBottomOcclusion: getRoutePanelOcclusion });
    const ok = await view.init().catch((error) => { console.error('[view3d] init failed:', error); return false; });
    if (ok) {
      view.setActive(true);
      updateFloorTabs();
    } else {
      view = null;
    }
  }
  if (!view) {
    mapUnsupportedElement.hidden = false;
    showStatusToast('WebGPU indisponible : vue 3D désactivée', 5000);
  } else {
    showStatusToast(`Plan de SUP’COM chargé : ${campus.getPlaces().length} lieux sur ${campus.levels.length} niveaux`, 4500);
  }

  // AR on WebGPU (prepared ahead so the tap only requests the session)
  arGuide = new ARGuide({
    container: sceneContainer,
    campus,
    overlayRoot: uiOverlayElement,
    compass,
    onStatus: (message) => showStatusToast(message, 6000),
    onSessionState: updateARControls,
    onGuidance: updateArHud,
    onReroute: rerouteFrom,
    onArrive: handleArArrival
  });
  arStatus = await arGuide.prepare().catch(() => ({ supported: false, reason: 'webgpu' }));
  updateArBadge();

  // Deep link: ?depart=ID&destination=ID (e.g. from a printed QR poster)
  const params = new URLSearchParams(window.location.search);
  if (params.get('depart')) setCurrentPlace(params.get('depart'), 'qr');
  if (params.get('destination')) selectDestination(params.get('destination'));
  // Field tests: ?debug exposes the live AR tracking state in the console
  if (params.has('debug')) window.__iwDebug = { get arState() { return lastArState; }, campus, router };

  console.log(`[Indoor Wayfinder] v${APP_VERSION} – SUP'COM campus, ${campus.getPlaces().length} places, renderer WebGPU: ${Boolean(view)}`);
}

init().catch((error) => {
  console.error('[Indoor Wayfinder] init failed:', error);
  showRenderFallback('Une erreur a interrompu le démarrage. Réinitialisez l’application.');
});
registerServiceWorker();
