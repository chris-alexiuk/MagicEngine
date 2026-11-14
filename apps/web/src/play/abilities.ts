import { activatedAbilities, apply, manaAbilities, whyNotActivated, type Action, type GameState, type PlayerId } from '@mtg/engine';
import { hasXRange } from './probes';

/**
 * A permanent's activated abilities, for its menu: every one it has, with the ways each can be activated right now —
 * or, when it can't be, why not. So a card with two abilities always shows both, and a click never quietly picks the
 * only one that happens to be payable.
 */
export interface AbilityRow {
  key: string;
  /** The ability as the card prints it. */
  text: string;
  /** A mana ability (CR 605): it adds mana at once, without the stack. */
  mana: boolean;
  /** Which of the engine's two lists it is in, and where (an action's `ability`). */
  index: number;
  /** The ways it can be activated now (for a mana ability, one for each choice of mana). */
  actions: Action[];
  /** It takes an X the player can pay for: the listed range (the menu asks for the number). */
  hasX: boolean;
  /** Why it can't be activated now, in a few words, and in the engine's own words. */
  why?: string;
  detail?: string;
}

/** How many activated abilities a permanent the player controls has (mana abilities counted too). */
export function abilityCounts(g: GameState, player: PlayerId, id: string): { abilities: number; nonMana: number } {
  const o = g.objects[id];
  if (!o || o.zone !== 'battlefield' || o.controller !== player || o.faceDown) return { abilities: 0, nonMana: 0 };
  const nonMana = activatedAbilities(g, o).length;
  return { abilities: nonMana + manaAbilities(g, o).length, nonMana };
}

/** The engine's refusals, in a few words (its own sentence is kept as the row's tooltip). */
const REASONS: [RegExp, string][] = [
  [/is already tapped/, 'Tapped'],
  [/is already untapped/, 'Not tapped'],
  [/hasn.t been under your control since your turn began/, 'Summoning sick'],
  [/enough untapped mana sources|Not enough mana/, 'Not enough mana'],
  [/only be activated as a sorcery|Loyalty abilities can only/, 'Only in your main phase, with the stack empty'],
  [/already activated a loyalty ability/, 'One loyalty ability each turn'],
  [/enough loyalty/, 'Not enough loyalty'],
  [/only once each turn|only \d+ times each turn|no more than \w+ times each turn/, 'Already used this turn'],
  [/can be activated only once\./, 'Already used'],
  [/don.t have priority|Waiting for/, 'Not your move'],
  [/split second/, 'Split second'],
  [/Choose which mana/, 'Nothing it could add right now'],
  [/life to pay|life total can.t change/, 'Not enough life'],
  [/to sacrifice to pay|can.t sacrifice/, 'Nothing to sacrifice'],
  [/to discard to pay/, 'Not enough cards to discard'],
  [/to exile\b|to collect as evidence|to craft with/, 'Nothing to exile for it'],
  [/creature\(s\) you control to (?:un)?tap|creatures you control to crew|Crewing needs|another untapped creature/, 'Not enough creatures to tap'],
  [/don.t have \d+ energy/, 'Not enough energy'],
  [/doesn.t have enough [^ ]+ counters|counter\(s\) to remove/, 'Not enough counters'],
  [/to return to your hand|creature you control to return/, 'Nothing to return'],
  [/doesn.t have enough cards|library/, 'Not enough cards in your library'],
  [/target/i, 'No legal target'],
  [/can.t be activated now|can.t activate/, 'Can’t be activated now'],
];

function reason(error: string): string {
  for (const [re, short] of REASONS) if (re.test(error)) return short;
  return error.length > 64 ? `${error.slice(0, 61)}…` : error;
}

/**
 * Why the engine won't take this ability now. For an activated ability, what the engine's own reading of it says
 * (`whyNotActivated`: whether it may be activated, then whether its costs can be paid, then whether there is anything
 * to choose for it); for a mana ability, what it says to the plain activation.
 */
function whyNot(g: GameState, player: PlayerId, id: string, index: number, mana: boolean): { why: string; detail: string } {
  if (g.over) return { why: 'The game is over', detail: 'The game is over.' };
  if (g.pending || g.priority !== player) return { why: 'Not your move', detail: g.pending ? 'A choice is being made.' : 'You don’t have priority.' };
  try {
    if (!mana) {
      const said = whyNotActivated(g, player, id, index);
      return said ? { why: reason(said), detail: said } : { why: 'Nothing to choose for it right now', detail: 'There is nothing this ability could be activated with right now.' };
    }
    const r = apply(g, { type: 'activate_mana', player, object: id, ability: index, autoTap: true });
    // The engine would take the plain activation, yet didn't list it: it has no choice it could offer for it.
    // (A mana ability with no mana it could add: "any type that a land you control could produce", and no lands.)
    if (r.ok) return { why: 'Would add no mana right now', detail: 'Right now this ability would add no mana.' };
    return { why: reason(r.error), detail: r.error };
  } catch {
    return { why: 'Can’t be activated now', detail: 'This ability can’t be activated right now.' };
  }
}

/**
 * The rows of a permanent's menu: its abilities in the order its text has them. `legal` is what the engine lists for
 * the object now; an ability with nothing listed is shown with why not. Only for a permanent the player controls.
 */
export function abilityRows(g: GameState, player: PlayerId, id: string, legal: readonly Action[]): AbilityRow[] {
  const o = g.objects[id];
  if (!o || o.zone !== 'battlefield' || o.controller !== player || o.faceDown) return [];
  const rows: AbilityRow[] = [];
  activatedAbilities(g, o).forEach((ab, index) => {
    const mine = legal.filter((a) => a.type === 'activate' && a.object === id && a.ability === index);
    rows.push({ key: `a${index}`, text: ab.text, mana: false, index, actions: mine.filter((a) => !hasXRange(a)), hasX: mine.some(hasXRange) });
  });
  manaAbilities(g, o).forEach((ab, index) => {
    rows.push({ key: `m${index}`, text: ab.text, mana: true, index, actions: legal.filter((a) => a.type === 'activate_mana' && a.object === id && a.ability === index), hasX: false });
  });
  for (const row of rows) {
    if (row.actions.length || row.hasX) continue;
    Object.assign(row, whyNot(g, player, id, row.index, row.mana));
  }
  // As printed: by where each ability's text is on the card (abilities it was given come after its own).
  const oracle = g.cards[o.card]?.faces[o.face]?.oracle ?? '';
  const at = (r: AbilityRow) => {
    const i = oracle.indexOf(r.text.replace(/\.$/, ''));
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return rows.map((r, i) => ({ r, i, at: at(r) })).sort((a, b) => a.at - b.at || a.i - b.i).map((x) => x.r);
}
