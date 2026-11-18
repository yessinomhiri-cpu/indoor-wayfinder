/**
 * ==========================================================================
 * Module       : test-diagnostic.mjs
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-17
 * Modified     : 2026-11-17
 * Version      : 3.2.0
 * Description  : Node tests for the pure helpers of src/diagnostic.js:
 *                browser detection, XR frame statistics, the readiness
 *                verdict, session error messages and the text report.
 * ==========================================================================
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECKS, STATUS, parseBrowser, frameStats, summarize, formatReport, describeSessionError, WEBXR_WEBGPU_FLAG
} from '../src/diagnostic.js';

const S23_CHROME = 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';
const SAMSUNG = 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

/** All automatic checks OK, live tests not run. */
function readyResults() {
  return CHECKS.map((check) => ({
    ...check,
    status: check.interactive ? STATUS.SKIP : STATUS.OK,
    detail: ''
  }));
}

function withStatus(results, id, status, fix = '') {
  return results.map((result) => (result.id === id ? { ...result, status, fix } : result));
}

test('parseBrowser: Chrome Android, Samsung Internet and desktop Chrome', () => {
  assert.deepEqual(parseBrowser(S23_CHROME), {
    isAndroid: true, androidVersion: '14', chromeMajor: 142, isChrome: true, otherBrowser: null
  });
  const samsung = parseBrowser(SAMSUNG);
  assert.equal(samsung.isChrome, false);
  assert.equal(samsung.otherBrowser, 'Samsung Internet');
  const desktop = parseBrowser(DESKTOP);
  assert.equal(desktop.isAndroid, false);
  assert.equal(desktop.isChrome, true);
  assert.equal(parseBrowser('').chromeMajor, null);
});

test('frameStats: steady 60 Hz, stutter and too few frames', () => {
  const steady = Array.from({ length: 61 }, (_, i) => i * (1000 / 60));
  const stats = frameStats(steady);
  assert.equal(stats.frames, 61);
  assert.equal(stats.fps, 60);
  assert.equal(stats.longFrames, 0);

  const stutter = [0, 33, 66, 166, 199, 232];
  const stutterStats = frameStats(stutter);
  assert.equal(stutterStats.longFrames, 1);
  assert.equal(stutterStats.p95IntervalMs, 100);

  assert.deepEqual(frameStats([5]), { frames: 1, fps: 0, p95IntervalMs: 0, longFrames: 0 });
});

test('every blocking prerequisite of the WebGPU AR chain is marked blocksAr', () => {
  const blocking = CHECKS.filter((check) => check.blocksAr).map((check) => check.id);
  for (const id of ['https', 'webgpu-api', 'webgpu-adapter', 'webgpu-device', 'webxr-api', 'immersive-ar', 'xrgpubinding', 'camera-permission']) {
    assert.ok(blocking.includes(id), `${id} must block AR`);
  }
  // A missing BarcodeDetector only falls back to jsQR.
  assert.ok(!blocking.includes('barcode'));
  assert.equal(new Set(CHECKS.map((check) => check.id)).size, CHECKS.length, 'check ids are unique');
});

test('summarize: flag missing blocks AR and lists the fix', () => {
  const results = withStatus(readyResults(), 'xrgpubinding', STATUS.FAIL, `Ouvrez ${WEBXR_WEBGPU_FLAG}`);
  const summary = summarize(results);
  assert.equal(summary.level, STATUS.FAIL);
  assert.equal(summary.blocking.length, 1);
  assert.equal(summary.blocking[0].id, 'xrgpubinding');
});

test('summarize: non-blocking warnings do not block AR', () => {
  const results = withStatus(readyResults(), 'barcode', STATUS.WARN);
  const summary = summarize(results);
  assert.equal(summary.level, STATUS.PENDING);
  assert.equal(summary.title, 'Prérequis OK : lancez le test AR réel');
  assert.equal(summary.warnings.length, 1);
});

test('summarize: verdict follows the real AR session', () => {
  assert.equal(summarize(withStatus(readyResults(), 'ar-session', STATUS.OK)).level, STATUS.OK);
  assert.equal(summarize(withStatus(readyResults(), 'ar-session', STATUS.WARN)).level, STATUS.WARN);
  const failed = summarize(withStatus(readyResults(), 'ar-session', STATUS.FAIL));
  assert.equal(failed.level, STATUS.FAIL);
  assert.equal(failed.blocking[0].id, 'ar-session');
});

test('summarize: still checking while automatic checks are pending', () => {
  const results = withStatus(readyResults(), 'immersive-ar', STATUS.PENDING);
  assert.equal(summarize(results).level, STATUS.PENDING);
  assert.equal(summarize(results).title, 'Vérification en cours…');
});

test('describeSessionError points to the flag, the camera or a new tap', () => {
  assert.match(describeSessionError({ name: 'NotSupportedError', message: 'x' }), /webxr-webgpu-binding/);
  assert.match(describeSessionError({ name: 'NotAllowedError', message: 'x' }), /caméra/);
  assert.match(describeSessionError({ name: 'SecurityError', message: 'requires user activation' }), /touchez à nouveau/);
  assert.match(describeSessionError(new Error('boom')), /boom/);
});

test('formatReport lists every check with its fix', () => {
  const results = withStatus(readyResults(), 'xrgpubinding', STATUS.FAIL, 'activer le flag');
  const report = formatReport(results, { date: '17/11/2026', url: 'https://example.test/diagnostic.html', userAgent: S23_CHROME, model: 'SM-S911B' });
  assert.match(report, /Verdict\s+: AR WebGPU impossible/);
  assert.match(report, /\[FAIL\] Liaison WebXR ↔ WebGPU/);
  assert.match(report, /→ activer le flag/);
  assert.equal(report.split('\n').filter((line) => line.startsWith('[')).length, CHECKS.length);
});
