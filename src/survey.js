/**
 * ==========================================================================
 * Module       : survey.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-12
 * Modified     : 2026-11-12
 * Version      : 3.0.0 (survey mode)
 * Description  : On-site survey store. The SUP'COM CAD plans give the walls,
 *                doors and rooms but not the room names, and a few doorways
 *                are missing. While walking the building, the team names
 *                rooms and records missing passages; entries are kept in
 *                localStorage and exported in the assets/campus/
 *                corrections.json format consumed by scripts/build-campus.mjs
 *                (Command pattern: each edit is an undoable entry).
 * ==========================================================================
 */

const STORAGE_KEY = 'indoor-wayfinder.survey.v1';

export class SurveyStore {
  constructor() {
    this.names = {};
    this.passages = [];
    this.history = [];
    this.listeners = new Set();
    this.#load();
  }

  /** @param {Function} listener – () on every change. */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** @returns {number} Number of surveyed entries. */
  get count() {
    return Object.keys(this.names).length + this.passages.length;
  }

  /**
   * nameRoom
   * --------
   * @param {string} code – Room code (e.g. A1-07) or place id.
   * @param {string} name – Name read on the door plate.
   */
  nameRoom(code, name) {
    const trimmed = (name || '').trim();
    const previous = this.names[code];
    if (trimmed) this.names[code] = trimmed;
    else delete this.names[code];
    this.history.push({ undo: () => { if (previous) this.names[code] = previous; else delete this.names[code]; } });
    this.#save();
  }

  /**
   * addPassage
   * ----------
   * @param {{level:number, from:[number,number], to:[number,number], width?:number, note?:string}} passage
   */
  addPassage(passage) {
    const entry = {
      level: passage.level,
      from: passage.from.map(round),
      to: passage.to.map(round),
      width: passage.width || 1,
      note: passage.note || ''
    };
    this.passages.push(entry);
    this.history.push({ undo: () => { this.passages = this.passages.filter((p) => p !== entry); } });
    this.#save();
  }

  /** Undoes the last edit. */
  undo() {
    const last = this.history.pop();
    if (!last) return false;
    last.undo();
    this.#save();
    return true;
  }

  /** @returns {Object} corrections.json content. */
  toCorrections() {
    return {
      about: "Corrections relevées sur place (mode relevé d'Indoor Wayfinder). Relancer `node scripts/build-campus.mjs` après fusion.",
      exported: new Date().toISOString(),
      passages: this.passages,
      names: this.names
    };
  }

  /**
   * download
   * --------
   * Hands the viewer a corrections.json file to save.
   */
  download() {
    const blob = new Blob([JSON.stringify(this.toCorrections(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'corrections.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  #load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      this.names = data.names || {};
      this.passages = data.passages || [];
    } catch (error) {
      this.names = {};
      this.passages = [];
    }
  }

  #save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ names: this.names, passages: this.passages }));
    } catch (error) {
      // Private mode / storage full: keep the in-memory copy
    }
    for (const listener of this.listeners) listener();
  }
}

const round = (value) => Math.round(value * 100) / 100;
