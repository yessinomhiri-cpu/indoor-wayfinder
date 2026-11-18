/**
 * ==========================================================================
 * Module       : nav-format.js
 * Project      : Indoor Wayfinder – AR Indoor Navigation PWA
 * Team         : SUP'COM SIA – Indoor Wayfinder
 * Authors      : Amin, Yassine, Oussema
 * Created      : 2026-11-18
 * Modified     : 2026-11-18
 * Version      : 3.5.0 (guidance screen)
 * Description  : Presentation of a guidance instruction for the "Google
 *                Maps"-style card shared by the AR and camera modes:
 *                "Dans 6 m, tournez à gauche" → big distance "6 m", action
 *                "Tournez à gauche", turn icon "left". Pure (tested in Node);
 *                the SVG icons are plain path strings.
 * ==========================================================================
 */

/** 24×24 stroke icons, one per manoeuvre. */
export const TURN_ICONS = Object.freeze({
  straight: 'M12 20V5M6 11l6-6 6 6',
  left: 'M17 20v-7a4 4 0 0 0-4-4H5M9 5 5 9l4 4',
  right: 'M7 20v-7a4 4 0 0 1 4-4h8M15 5l4 4-4 4',
  'slight-left': 'M15 20v-6L8 7M8 13V7h6',
  'slight-right': 'M9 20v-6l7-7M10 7h6v6',
  'u-turn': 'M16 20V9a4 4 0 0 0-8 0v6M4 11l4 4 4-4',
  stairs: 'M3 20h5v-5h5v-5h5V5h3',
  lift: 'M6 3h12v18H6zM9 10l3-3 3 3M9 14l3 3 3-3',
  arrive: 'M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'
});

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * formatInstruction
 * -----------------
 * @param {{kind:string, text:string}|null} instruction – Guidance instruction.
 * @param {Object} [flags]
 * @param {boolean} [flags.arrived] – Destination reached.
 * @param {boolean} [flags.offRoute] – Off the route (AR).
 * @returns {{distance:string, text:string, icon:string}}
 */
export function formatInstruction(instruction, { arrived = false, offRoute = false } = {}) {
  if (arrived) return { distance: '', text: 'Vous êtes arrivé', icon: 'arrive' };
  if (offRoute) return { distance: '', text: 'Hors itinéraire — recalcul…', icon: 'u-turn' };
  if (!instruction || !instruction.text) return { distance: '', text: 'Initialisation…', icon: 'straight' };
  const text = instruction.text.replace(/^🎉\s*/, '');

  let match = /^(Tournez-vous vers la (droite|gauche)|Faites demi-tour) — /.exec(text);
  if (match) {
    return { distance: '', text: match[1], icon: match[2] === 'droite' ? 'right' : match[2] === 'gauche' ? 'left' : 'u-turn' };
  }
  match = /^Tout droit sur (\d+) m$/.exec(text);
  if (match) return { distance: `${match[1]} m`, text: 'Tout droit', icon: 'straight' };
  match = /^Destination dans (\d+) m$/.exec(text);
  if (match) return { distance: `${match[1]} m`, text: 'Destination', icon: 'arrive' };
  match = /^Dans (\d+) m, (.+)$/.exec(text);
  if (match) return { distance: `${match[1]} m`, text: capitalize(match[2]), icon: iconFor(instruction.kind) };
  return { distance: '', text, icon: iconFor(instruction.kind) };
}

/**
 * iconFor
 * -------
 * @param {string} kind – Instruction kind.
 * @returns {string} Key of TURN_ICONS.
 */
export function iconFor(kind) {
  return Object.prototype.hasOwnProperty.call(TURN_ICONS, kind) ? kind : 'straight';
}

/**
 * formatRemaining
 * ---------------
 * @param {number} remaining – Metres left.
 * @param {number} speed – Walking speed (m/s).
 * @returns {string} "42 m restants · ≈ 1 min"
 */
export function formatRemaining(remaining, speed) {
  const metres = Math.max(0, Math.round(remaining));
  const minutes = Math.max(1, Math.round(metres / speed / 60));
  return `${metres} m restants · ≈ ${minutes} min`;
}
