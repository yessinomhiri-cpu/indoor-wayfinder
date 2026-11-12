/**
 * ==========================================================================
 * Module       : gpu.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-12
 * Modified     : 2026-11-12
 * Version      : 3.0.0 (WebGPU rendering)
 * Description  : WebGPU capability checks and renderer factory. Every 3D
 *                view of the app (campus view and AR session) is rendered by
 *                Three.js WebGPURenderer on the WebGPU backend. A renderer is
 *                only created when a WebGPU adapter exists, and is rejected if
 *                Three.js did not end up on the WebGPU backend.
 * ==========================================================================
 */

import * as THREE from 'three';

/** @type {Promise<GPUAdapter|null>|null} */
let adapterPromise = null;

/**
 * getWebGPUAdapter
 * ----------------
 * @returns {Promise<GPUAdapter|null>} The default adapter, or null.
 */
export function getWebGPUAdapter() {
  if (!adapterPromise) {
    adapterPromise = (async () => {
      if (!('gpu' in navigator) || !navigator.gpu) return null;
      try {
        return await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      } catch (error) {
        console.warn('[gpu] requestAdapter failed:', error);
        return null;
      }
    })();
  }
  return adapterPromise;
}

/**
 * hasWebGPU
 * ---------
 * @returns {Promise<boolean>} True when WebGPU rendering is available.
 */
export async function hasWebGPU() {
  return Boolean(await getWebGPUAdapter());
}

/**
 * hasWebXRWebGPUBinding
 * ---------------------
 * WebXR sessions rendered with WebGPU need XRGPUBinding. In Chrome it is
 * still behind chrome://flags/#webxr-webgpu-binding.
 *
 * @returns {boolean}
 */
export function hasWebXRWebGPUBinding() {
  return typeof globalThis.XRGPUBinding !== 'undefined';
}

/**
 * createWebGPURenderer
 * --------------------
 * @param {Object} [options]
 * @param {boolean} [options.xr=false] – Request an XR-compatible adapter.
 * @param {boolean} [options.alpha=true] – Transparent canvas.
 * @returns {Promise<THREE.WebGPURenderer|null>} Initialised renderer, or null.
 */
export async function createWebGPURenderer({ xr = false, alpha = true } = {}) {
  if (!(await hasWebGPU())) return null;

  const renderer = new THREE.WebGPURenderer({ antialias: true, alpha });
  // The adapter must be XR-compatible before init() when AR will use it.
  if (xr) renderer.xr.enabled = true;

  try {
    await renderer.init();
  } catch (error) {
    console.warn('[gpu] WebGPU renderer init failed:', error);
    renderer.dispose();
    return null;
  }

  if (!renderer.backend || renderer.backend.isWebGPUBackend !== true) {
    // Never keep a non-WebGPU backend.
    renderer.dispose();
    return null;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, alpha ? 0 : 1);
  return renderer;
}
