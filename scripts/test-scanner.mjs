/**
 * ==========================================================================
 * Module       : test-scanner.mjs
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-18
 * Modified     : 2026-11-18
 * Version      : 3.5.1
 * Description  : Node tests of the camera error messages shown on the scan
 *                screen (src/scanner.js describeCameraError).
 * ==========================================================================
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { describeCameraError } from '../src/scanner.js';

test('camera blocked: says how to allow it in Chrome and in Android settings', () => {
  for (const name of ['NotAllowedError', 'SecurityError', 'PermissionDeniedError']) {
    const { title, text } = describeCameraError(name);
    assert.equal(title, 'Caméra bloquée pour ce site');
    assert.match(text, /cadenas/);
    assert.match(text, /Paramètres Android/);
  }
});

test('camera busy, missing, unsupported, silent: each has its own explanation', () => {
  assert.equal(describeCameraError('NotReadableError').title, 'Caméra occupée');
  assert.equal(describeCameraError('AbortError').title, 'Caméra occupée');
  assert.equal(describeCameraError('NotFoundError').title, 'Aucune caméra trouvée');
  assert.equal(describeCameraError('NotSupportedError').title, 'Caméra indisponible dans ce navigateur');
  assert.equal(describeCameraError('NoFrames').title, 'La caméra ne renvoie pas d’image');
  assert.equal(describeCameraError('DecoderError').title, 'Lecteur de QR non chargé');
});

test('unknown errors still give an action and keep the error name for support', () => {
  const { title, text } = describeCameraError('WeirdError');
  assert.equal(title, 'Caméra indisponible');
  assert.match(text, /Réessayez/);
  assert.match(text, /WeirdError/);
  assert.ok(describeCameraError(undefined).text.length > 10);
});
