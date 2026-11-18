/**
 * ==========================================================================
 * Module       : voice.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-18
 * Modified     : 2026-11-18
 * Version      : 3.5.0 (voice guidance)
 * Description  : Spoken French guidance (Web Speech API, speechSynthesis)
 *                and a vibration at each turn, for both the AR and the
 *                camera modes.
 *                - VoiceAnnouncer (pure, tested in Node) decides WHAT to say
 *                  and WHEN from the guidance state: the first instruction,
 *                  each turn once ~12 m before and once ~3 m before, the
 *                  stairs / lift, "Faites demi-tour" at most every 8 s, and
 *                  the arrival once. Nothing is ever repeated.
 *                - Voice wraps speechSynthesis (fr-FR) with an on/off switch
 *                  remembered on the phone.
 * ==========================================================================
 */

/** Instruction kinds that are announced as a manoeuvre. */
const MANOEUVRES = new Set(['left', 'right', 'slight-left', 'slight-right', 'u-turn', 'stairs', 'lift', 'arrive']);

/** What to say when the manoeuvre is right in front of the user. */
const NOW_TEXT = {
  left: 'Tournez à gauche',
  right: 'Tournez à droite',
  'slight-left': 'Légèrement à gauche',
  'slight-right': 'Légèrement à droite',
  'u-turn': 'Faites demi-tour',
  stairs: 'Prenez l’escalier',
  lift: 'Prenez l’ascenseur',
  arrive: 'Votre destination est juste devant vous'
};

/**
 * speakable
 * ---------
 * @param {string} text – On-screen instruction ("Dans 9 m, tournez à gauche").
 * @returns {string} Text for the speech engine ("Dans 9 mètres, …").
 */
export function speakable(text) {
  return String(text)
    .replace(/(\d+) m\b/g, (match, n) => `${n} ${Number(n) > 1 ? 'mètres' : 'mètre'}`)
    .replace(/ — /g, ', ')
    .replace(/🎉\s*/g, '');
}

/** True for "Tournez-vous vers …" / "Faites demi-tour — …" (facing the wrong way). */
function isFacingCorrection(text) {
  return /^Tournez-vous vers/.test(text) || /^Faites demi-tour —/.test(text);
}

/**
 * VoiceAnnouncer
 * --------------
 * Turns a stream of guidance states into a few spoken announcements.
 * State fields used (AR and camera modes share them): instruction
 * {kind, text, distance}, arrived, awaitingFloorChange / awaitingLift,
 * legIndex, progress.
 */
export class VoiceAnnouncer {
  /**
   * @param {Object} [options]
   * @param {number} [options.preDistance=12] – "Dans N mètres…" (m).
   * @param {number} [options.nowDistance=3] – "Tournez à gauche" (m).
   * @param {number} [options.facingRepeatMs=8000] – Min. delay between "Faites demi-tour".
   */
  constructor({ preDistance = 12, nowDistance = 3, facingRepeatMs = 8000 } = {}) {
    this.preDistance = preDistance;
    this.nowDistance = nowDistance;
    this.facingRepeatMs = facingRepeatMs;
    this.reset();
  }

  /** New guidance session. */
  reset() {
    this.said = new Set();
    this.started = false;
    this.lastFacing = -Infinity;
    this.arrivedSaid = false;
  }

  /**
   * next
   * ----
   * @param {Object} state – Guidance state.
   * @param {number} now – Time (ms).
   * @returns {{text:string, vibrate:boolean}|null} Announcement, or null.
   */
  next(state, now) {
    if (!state) return null;
    if (state.arrived) {
      if (this.arrivedSaid) return null;
      this.arrivedSaid = true;
      this.started = true;
      return { text: 'Vous êtes arrivé à destination', vibrate: true };
    }

    const leg = state.legIndex || 0;
    if (state.awaitingFloorChange || state.awaitingLift) {
      const key = `floor:${leg}`;
      if (this.said.has(key)) return null;
      this.said.add(key);
      this.started = true;
      const level = state.awaitingLift ? state.awaitingLift.toLevel : state.nextLevel;
      const verb = state.awaitingLift ? 'Prenez l’ascenseur' : (state.instruction && state.instruction.kind === 'lift' ? 'Prenez l’ascenseur' : 'Prenez l’escalier');
      const where = level === 0 ? 'au rez-de-chaussée' : level !== null && level !== undefined ? `à l’étage ${level}` : '';
      return { text: where ? `${verb} jusqu’${where}` : verb, vibrate: true };
    }

    const instruction = state.instruction;
    if (!instruction || !instruction.text) return null;

    if (isFacingCorrection(instruction.text)) {
      if (now - this.lastFacing < this.facingRepeatMs) return null;
      this.lastFacing = now;
      this.started = true;
      return { text: speakable(instruction.text.split(' — ')[0]), vibrate: false };
    }

    if (!this.started) {
      this.started = true;
      this.#markPassed(state);
      return { text: speakable(instruction.text), vibrate: false };
    }

    if (!MANOEUVRES.has(instruction.kind) || !Number.isFinite(instruction.distance)) return null;
    const id = this.#manoeuvreId(state);
    if (instruction.distance <= this.nowDistance) {
      if (this.said.has(`${id}:now`)) return null;
      this.said.add(`${id}:now`);
      this.said.add(`${id}:pre`);
      return { text: NOW_TEXT[instruction.kind], vibrate: instruction.kind !== 'arrive' };
    }
    if (instruction.distance <= this.preDistance) {
      if (this.said.has(`${id}:pre`)) return null;
      this.said.add(`${id}:pre`);
      return { text: speakable(instruction.text), vibrate: false };
    }
    return null;
  }

  /** A manoeuvre is identified by its leg and its position along the route. */
  #manoeuvreId(state) {
    const at = (state.progress || 0) + (state.instruction.distance || 0);
    return `${state.legIndex || 0}:${state.instruction.kind}:${Math.round(at / 2)}`;
  }

  /** The first instruction already covers a manoeuvre that is close. */
  #markPassed(state) {
    const instruction = state.instruction;
    if (!MANOEUVRES.has(instruction.kind) || !Number.isFinite(instruction.distance)) return;
    if (instruction.distance <= this.preDistance) this.said.add(`${this.#manoeuvreId(state)}:pre`);
  }
}

// ===========================================================================
// Speech output
// ===========================================================================

const STORAGE_KEY = 'iw-voice';

/**
 * Voice
 * -----
 * speechSynthesis in French, switchable, preference kept in localStorage.
 */
export class Voice {
  constructor() {
    this.synth = typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis : null;
    let saved = null;
    try { saved = window.localStorage.getItem(STORAGE_KEY); } catch (error) { saved = null; }
    this.enabled = saved !== 'off';
    this.frenchVoice = null;
    if (this.synth) {
      const pick = () => {
        const voices = this.synth.getVoices();
        this.frenchVoice = voices.find((v) => /^fr(-|_)FR/i.test(v.lang)) || voices.find((v) => /^fr/i.test(v.lang)) || null;
      };
      pick();
      if (typeof this.synth.addEventListener === 'function') this.synth.addEventListener('voiceschanged', pick);
    }
  }

  /** @returns {boolean} True when the browser can speak. */
  get supported() {
    return Boolean(this.synth);
  }

  /**
   * speak
   * -----
   * Interrupts the previous sentence: the newest instruction matters most.
   * @param {string} text
   */
  speak(text) {
    if (!this.enabled || !this.synth || !text) return;
    try {
      this.synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'fr-FR';
      if (this.frenchVoice) utterance.voice = this.frenchVoice;
      utterance.rate = 1.05;
      this.synth.speak(utterance);
    } catch (error) {
      console.warn('[voice] speech failed:', error);
    }
  }

  /** Stops any sentence being spoken. */
  silence() {
    if (this.synth) this.synth.cancel();
  }

  /**
   * toggle
   * ------
   * @returns {boolean} New state.
   */
  toggle() {
    this.enabled = !this.enabled;
    try { window.localStorage.setItem(STORAGE_KEY, this.enabled ? 'on' : 'off'); } catch (error) { /* private mode */ }
    if (!this.enabled) this.silence();
    return this.enabled;
  }
}
