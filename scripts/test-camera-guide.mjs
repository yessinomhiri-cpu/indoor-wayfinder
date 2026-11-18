/**
 * ==========================================================================
 * Module       : test-camera-guide.mjs
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-18
 * Modified     : 2026-11-18
 * Version      : 3.4.0
 * Description  : Node tests of the camera guidance mode logic
 *                (src/route-follower.js): step counting from simulated
 *                accelerometer signals and walks along real SUP'COM routes
 *                with a noisy compass.
 * ==========================================================================
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CampusMap, CampusRouter } from '../src/navigation.js';
import { StepDetector, RouteFollower, wrapDeg } from '../src/route-follower.js';
import { VoiceAnnouncer, speakable } from '../src/voice.js';
import { formatInstruction, formatRemaining, TURN_ICONS } from '../src/nav-format.js';

const campus = new CampusMap(JSON.parse(readFileSync(new URL('../assets/campus/supcom.json', import.meta.url), 'utf8')));
const router = new CampusRouter(campus);
const G = 9.81;

/** Deterministic pseudo-random noise in [−1, 1]. */
function noise(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return (s / 2147483648) * 2 - 1;
  };
}

/** Accelerometer norm of a walk: gravity + bounce at `hz` steps per second. */
function walkSignal({ seconds, hz, amplitude, noiseLevel, seed = 7, rate = 60 }) {
  const rnd = noise(seed);
  const samples = [];
  for (let i = 0; i < seconds * rate; i++) {
    const t = (i * 1000) / rate;
    const bounce = amplitude * Math.sin(2 * Math.PI * hz * (t / 1000));
    samples.push([G + bounce + noiseLevel * rnd(), t]);
  }
  return samples;
}

function countSteps(samples) {
  const detector = new StepDetector();
  let steps = 0;
  for (const [m, t] of samples) if (detector.feed(m, t)) steps++;
  return steps;
}

test('steps: a normal walk (1.8 steps/s for 20 s) is counted within ±10 %', () => {
  const steps = countSteps(walkSignal({ seconds: 20, hz: 1.8, amplitude: 2.5, noiseLevel: 0.4 }));
  assert.ok(Math.abs(steps - 36) <= 4, `${steps} steps counted for 36`);
});

test('steps: a slow walk (1.2 steps/s, softer bounce) is still counted', () => {
  const steps = countSteps(walkSignal({ seconds: 20, hz: 1.2, amplitude: 1.8, noiseLevel: 0.3, seed: 3 }));
  assert.ok(Math.abs(steps - 24) <= 3, `${steps} steps counted for 24`);
});

test('steps: standing still with a shaky hand counts nothing', () => {
  const steps = countSteps(walkSignal({ seconds: 20, hz: 1.8, amplitude: 0.25, noiseLevel: 0.35, seed: 11 }));
  assert.equal(steps, 0);
});

test('steps: never more than ~3 per second, even with violent shaking', () => {
  const steps = countSteps(walkSignal({ seconds: 10, hz: 8, amplitude: 6, noiseLevel: 1, seed: 5 }));
  assert.ok(steps <= 32, `${steps} steps in 10 s`);
});

/**
 * Walks a route with the camera mode: at each step the user faces the route
 * (true bearing + compass error); returns the follower and the step count.
 */
function walkRoute(follower, { compassNoise = 15, maxSteps = 2000, seed = 21 } = {}) {
  const rnd = noise(seed);
  let n = 0;
  while (!follower.arrived && n < maxSteps) {
    if (follower.awaitingFloorChange) { follower.nextLeg(); continue; }
    const bearing = follower.routeBearingAt();
    follower.step(bearing === null ? null : bearing + compassNoise * rnd());
    n++;
  }
  return n;
}

test('route: Entrée principale → Amphi IBN KHALDOUN is reached step by step with a ±15° compass', () => {
  const route = router.findRoute('ENTREE_PRINCIPALE', 'AMPHI_IBN_KHALDOUN');
  assert.ok(route.found);
  const follower = new RouteFollower(route);
  const length = follower.legLength;
  const steps = walkRoute(follower);
  assert.ok(follower.arrived, 'arrived');
  const expected = (length - 2) / 0.7;
  assert.ok(Math.abs(steps - expected) <= 3, `${steps} steps for ${length.toFixed(1)} m`);
  const state = follower.state(follower.routeBearingAt());
  assert.equal(state.instruction.text, 'Vous êtes arrivé');
  assert.ok(state.remaining <= 2.01);
});

test('route: facing away walks back, looking sideways does not move', () => {
  const route = router.findRoute('ENTREE_PRINCIPALE', 'AMPHI_IBN_KHALDOUN');
  const follower = new RouteFollower(route);
  for (let i = 0; i < 10; i++) follower.step(follower.routeBearingAt());
  const s = follower.s;
  assert.ok(Math.abs(s - 7) < 1e-6);
  const bearing = follower.routeBearingAt();
  assert.equal(follower.step(bearing + 90), 0, 'sideways step ignored');
  assert.ok(follower.step(bearing + 180) < 0, 'step back');
  assert.ok(Math.abs(follower.s - (s - 0.7)) < 1e-6);
  // Never before the start
  for (let i = 0; i < 50; i++) follower.step(follower.routeBearingAt() + 180);
  assert.equal(follower.s, 0);
});

test('route: without compass every step counts forward', () => {
  const follower = new RouteFollower(router.findRoute('ENTREE_PRINCIPALE', 'AMPHI_IBN_KHALDOUN'));
  for (let i = 0; i < 5; i++) follower.step(null);
  assert.ok(Math.abs(follower.s - 3.5) < 1e-6);
  assert.equal(follower.state(null).relativeTurn, 0);
});

test('arrow: points along the route relative to the phone, and the text says which way to turn', () => {
  const follower = new RouteFollower(router.findRoute('ENTREE_PRINCIPALE', 'AMPHI_IBN_KHALDOUN'));
  const ahead = follower.state(null).targetBearing;
  assert.ok(Math.abs(follower.state(ahead).relativeTurn) < 1e-9, 'facing the route: arrow straight ahead');
  const right = follower.state(ahead - 90); // route is 90° to the right of the phone
  assert.ok(Math.abs(right.relativeTurn - 90) < 1e-9);
  assert.match(right.instruction.text, /^Tournez-vous vers la droite/);
  const back = follower.state(ahead + 180);
  assert.match(back.instruction.text, /^Faites demi-tour/);
  assert.ok(Math.abs(Math.abs(back.relativeTurn) - 180) < 1e-9);
});

test('arrow: announces the coming turn with its distance', () => {
  const route = router.findRoute('ENTREE_PRINCIPALE', 'AMPHI_IBN_KHALDOUN');
  const follower = new RouteFollower(route);
  const texts = new Set();
  walkRoute(follower, {
    compassNoise: 0
  });
  // Re-walk and collect the instructions shown
  follower.setRoute(route);
  while (!follower.arrived) {
    const heading = follower.routeBearingAt();
    texts.add(follower.state(heading).instruction.text.replace(/\d+/g, 'N'));
    follower.step(heading);
  }
  assert.ok([...texts].some((t) => /^Dans N m, (tournez|légèrement)/.test(t) || /^Tout droit sur N m$/.test(t) || /^Destination dans N m$/.test(t)), [...texts].join(' | '));
  assert.ok(texts.has('Vous êtes arrivé') || follower.arrived);
});

test('route: stairs to the 3rd floor wait for the user, then continue upstairs', () => {
  const target = campus.getPlaces().find((p) => p.level === 3 && p.kind === 'room' && router.findRoute('ENTREE_PRINCIPALE', p.id).legs.length === 2);
  const route = router.findRoute('ENTREE_PRINCIPALE', target.id);
  const follower = new RouteFollower(route);
  let waited = null;
  let n = 0;
  while (!follower.awaitingFloorChange && n++ < 2000) follower.step(follower.routeBearingAt());
  waited = follower.state(follower.routeBearingAt());
  assert.ok(waited.awaitingFloorChange);
  assert.equal(waited.nextLevel, 3);
  assert.match(waited.instruction.text, /^Prenez l’(escalier|ascenseur) jusqu’à l’étage 3$/);
  assert.equal(follower.step(follower.routeBearingAt()), 0, 'no move past the stairs');
  assert.ok(follower.nextLeg());
  assert.equal(follower.state(null).position.level, 3);
  walkRoute(follower);
  assert.ok(follower.arrived);
});

test('wrapDeg keeps angles in ]−180, 180]', () => {
  assert.equal(wrapDeg(190), -170);
  assert.equal(wrapDeg(-190), 170);
  assert.equal(wrapDeg(180), 180);
  assert.equal(wrapDeg(-180), 180);
  assert.equal(wrapDeg(720 + 10), 10);
});

// =============================================================================
// Voice guidance (VoiceAnnouncer)
// =============================================================================

/** Walks a route and returns everything the voice would say, with the metres walked. */
function spokenWalk(route, { facingAt = null } = {}) {
  const follower = new RouteFollower(route);
  const voice = new VoiceAnnouncer();
  const spoken = [];
  let t = 0;
  let n = 0;
  const listen = (heading) => {
    const said = voice.next(follower.state(heading), t);
    if (said) spoken.push({ ...said, at: follower.s, leg: follower.legIndex });
  };
  while (n++ < 3000) {
    t += 600;
    if (follower.awaitingFloorChange) { listen(follower.routeBearingAt()); follower.nextLeg(); continue; }
    let heading = follower.routeBearingAt();
    if (facingAt !== null && Math.abs(follower.s - facingAt) < 0.4) {
      for (let k = 0; k < 30; k++) { t += 600; listen(heading + 180); } // 18 s facing backwards
    }
    listen(heading);
    if (follower.arrived) break;
    follower.step(heading);
  }
  listen(follower.routeBearingAt());
  return spoken;
}

test('voice: speakable French (metres, no emoji)', () => {
  assert.equal(speakable('Dans 9 m, tournez à gauche'), 'Dans 9 mètres, tournez à gauche');
  assert.equal(speakable('Dans 1 m, l’escalier'), 'Dans 1 mètre, l’escalier');
  assert.equal(speakable('Tournez-vous vers la droite — tout droit sur 28 m'), 'Tournez-vous vers la droite, tout droit sur 28 mètres');
});

test('voice: a real walk is announced once per turn (12 m before, then 3 m before), arrival once', () => {
  const spoken = spokenWalk(router.findRoute('ENTREE_PRINCIPALE', 'AMPHI_IBN_KHALDOUN'));
  const texts = spoken.map((s) => s.text);
  assert.ok(texts.length >= 3, texts.join(' | '));
  assert.ok(!/^(Tournez à|Légèrement)/.test(texts[0]), `first: ${texts[0]}`);
  assert.equal(texts.filter((t) => t === 'Vous êtes arrivé à destination').length, 1);
  assert.equal(texts[texts.length - 1], 'Vous êtes arrivé à destination');
  // Never the same sentence twice in a row
  for (let i = 1; i < texts.length; i++) assert.notEqual(texts[i], texts[i - 1], texts.join(' | '));
  // "Dans N mètres, …" always comes before the matching short order
  const shortOrders = spoken.filter((s) => /^(Tournez à|Légèrement)/.test(s.text));
  assert.ok(shortOrders.length >= 1, texts.join(' | '));
  for (const order of shortOrders) {
    assert.ok(order.vibrate, 'vibrate at the turn');
    assert.ok(spoken.some((s) => s.at < order.at && /^Dans \d+ mètres?,/.test(s.text)), `no warning before "${order.text}"`);
  }
  assert.ok(texts.length <= 12, `too talkative: ${texts.length} sentences`);
});

test('voice: facing backwards is said, but not more than every 8 s', () => {
  const spoken = spokenWalk(router.findRoute('ENTREE_PRINCIPALE', 'AMPHI_IBN_KHALDOUN'), { facingAt: 7 });
  const facing = spoken.filter((s) => /^Faites demi-tour$|^Tournez-vous/.test(s.text));
  // 18 s facing the wrong way → 2 or 3 reminders, not 30
  assert.ok(facing.length >= 2 && facing.length <= 3, `${facing.length} reminders`);
});

test('voice: the stairs are announced once, then the walk continues upstairs', () => {
  const target = campus.getPlaces().find((p) => p.level === 3 && p.kind === 'room' && router.findRoute('ENTREE_PRINCIPALE', p.id).legs.length === 2);
  const spoken = spokenWalk(router.findRoute('ENTREE_PRINCIPALE', target.id)).map((s) => s.text);
  const floors = spoken.filter((t) => /jusqu’à l’étage 3$/.test(t));
  assert.equal(floors.length, 1, spoken.join(' | '));
  assert.equal(spoken[spoken.length - 1], 'Vous êtes arrivé à destination');
});

test('voice: reset starts a new session', () => {
  const voice = new VoiceAnnouncer();
  const state = { instruction: { kind: 'left', text: 'Dans 20 m, tournez à gauche', distance: 20 }, legIndex: 0, progress: 0 };
  assert.ok(voice.next(state, 0));
  assert.equal(voice.next(state, 100), null);
  voice.reset();
  assert.ok(voice.next(state, 200));
});

// =============================================================================
// Guidance card (nav-format)
// =============================================================================

test('card: distance, action and icon are split out of the instruction', () => {
  assert.deepEqual(formatInstruction({ kind: 'left', text: 'Dans 6 m, tournez à gauche' }), { distance: '6 m', text: 'Tournez à gauche', icon: 'left' });
  assert.deepEqual(formatInstruction({ kind: 'right', text: 'Tout droit sur 28 m' }), { distance: '28 m', text: 'Tout droit', icon: 'straight' });
  assert.deepEqual(formatInstruction({ kind: 'arrive', text: 'Destination dans 9 m' }), { distance: '9 m', text: 'Destination', icon: 'arrive' });
  assert.deepEqual(formatInstruction({ kind: 'left', text: 'Tournez-vous vers la gauche — tout droit sur 28 m' }), { distance: '', text: 'Tournez-vous vers la gauche', icon: 'left' });
  assert.deepEqual(formatInstruction({ kind: 'u-turn', text: 'Faites demi-tour — dans 4 m, tournez à droite' }), { distance: '', text: 'Faites demi-tour', icon: 'u-turn' });
  assert.equal(formatInstruction({ kind: 'stairs', text: 'Prenez l’escalier jusqu’à l’étage 3' }).icon, 'stairs');
  assert.equal(formatInstruction(null, { arrived: true }).text, 'Vous êtes arrivé');
  assert.equal(formatInstruction({ kind: 'left', text: 'x' }, { offRoute: true }).icon, 'u-turn');
});

test('card: every instruction of a real walk has an icon and a short action', () => {
  const route = router.findRoute('ENTREE_PRINCIPALE', 'AMPHI_IBN_KHALDOUN');
  const follower = new RouteFollower(route);
  let n = 0;
  while (!follower.arrived && n++ < 500) {
    const heading = follower.routeBearingAt();
    const card = formatInstruction(follower.state(heading).instruction);
    assert.ok(TURN_ICONS[card.icon], card.icon);
    assert.ok(card.text.length > 0 && card.text.length <= 40, card.text);
    assert.ok(!/^Dans \d/.test(card.text), `distance not split: ${card.text}`);
    follower.step(heading);
  }
  assert.equal(formatRemaining(42.4, 1.25), '42 m restants · ≈ 1 min');
  assert.equal(formatRemaining(300, 1.25), '300 m restants · ≈ 4 min');
});
