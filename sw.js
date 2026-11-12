/**
 * ==========================================================================
 * Module       : sw.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Author       : Oussema Harrabi
 * Created      : 2026-11-05
 * Modified     : 2026-11-05
 * Version      : 2.3.0 (Sprint 4 – offline shell, AR + 3D view modules)
 * Description  : Service Worker for the Indoor Wayfinder PWA. Precaches the
 *                app shell and the pinned Three.js module, serves navigations
 *                network-first with an offline fallback, and serves static
 *                assets cache-first.
 * ==========================================================================
 */

const CACHE_NAME = 'indoor-wayfinder-v2.3.0';
const SCOPE_URL = self.registration.scope;

/** Application files required to boot the shell offline. */
const APP_SHELL = [
  SCOPE_URL,
  new URL('index.html', SCOPE_URL).href,
  new URL('manifest.json', SCOPE_URL).href,
  new URL('src/main.js', SCOPE_URL).href,
  new URL('src/scanner.js', SCOPE_URL).href,
  new URL('src/navigation.js', SCOPE_URL).href,
  new URL('src/ar.js', SCOPE_URL).href,
  new URL('src/view3d.js', SCOPE_URL).href,
  new URL('assets/building.json', SCOPE_URL).href,
  new URL('assets/icons/icon-180.png', SCOPE_URL).href,
  new URL('assets/icons/icon-192.png', SCOPE_URL).href,
  new URL('assets/icons/icon-512.png', SCOPE_URL).href,
  new URL('assets/icons/maskable-192.png', SCOPE_URL).href,
  new URL('assets/icons/maskable-512.png', SCOPE_URL).href
];

/** Pinned CDN module; a failure here must not block the app-shell install. */
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm'
];

/**
 * install
 * -------
 * Precaches the shell, then best-effort caches the pinned Three.js module.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => Promise.all(
        CDN_ASSETS.map((url) => cacheAsset(url))
      ))
      .then(() => self.skipWaiting())
  );
});

/**
 * activate
 * --------
 * Removes caches from older app versions and takes control immediately.
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(async () => {
        await self.clients.claim();
        // Force open tabs to reload from the new cache. This also recovers
        // pages that were loaded from an older deployment.
        const windowClients = await self.clients.matchAll({ type: 'window' });
        await Promise.all(windowClients.map((client) =>
          client.navigate(client.url).catch(() => undefined)
        ));
      })
  );
});

/**
 * fetch
 * -----
 * Navigations: network-first, cached index fallback.
 * Same-origin and jsDelivr assets: cache-first, then network + cache.
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;
  const isPinnedCdn = requestUrl.hostname === 'cdn.jsdelivr.net';

  if (!isSameOrigin && !isPinnedCdn) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  event.respondWith(handleAsset(request));
});

/**
 * handleNavigation
 * ----------------
 * @param {Request} request – Navigation request.
 * @returns {Promise<Response>} Fresh page or cached shell.
 */
async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(new URL('index.html', SCOPE_URL).href, response.clone());
    }
    return response;
  } catch (error) {
    return (
      (await caches.match(new URL('index.html', SCOPE_URL).href)) ||
      (await caches.match(SCOPE_URL)) ||
      Response.error()
    );
  }
}

/**
 * handleAsset
 * -----------
 * @param {Request} request – Static asset request.
 * @returns {Promise<Response>} Cached asset or network response.
 */
async function handleAsset(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) return cachedResponse;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return cachedResponse || Response.error();
  }
}

/**
 * cacheAsset
 * ----------
 * Best-effort cache for cross-origin assets such as the pinned CDN module.
 *
 * @param {string} url – Asset URL.
 * @returns {Promise<void>}
 */
async function cacheAsset(url) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.add(url);
  } catch (error) {
    // The shell still installs if the CDN is unreachable.
  }
}
