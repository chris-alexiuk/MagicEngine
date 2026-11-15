/**
 * One path for "instead" (CR 614–616).
 *
 * Something about to happen is a `Happening`: a card changing zones, a card being drawn, a permanent entering, damage
 * being dealt, a permanent being destroyed, tokens being created, life or another amount being gained, lost or put.
 * Before it happens, every replacement effect that applies to it is found: each kind of happening has its rules
 * (instead-moves.ts, instead-draws.ts, instead-enters.ts, instead-damage.ts, instead-destroy.ts, instead-tokens.ts,
 * quantities.ts), and a rule gives one `Replacement` for each effect of its sort that applies to the happening as it
 * now stands. One is applied at a time; each at most once to the same happening (CR 614.5); after each, the happening
 * as it has become is looked at afresh — an effect may apply now that didn't, or no longer apply (CR 616.1f, 616.2).
 *
 * With several to choose from, the affected player — or the controller of the affected object, its owner if it has
 * none — chooses which applies first (CR 616.1): after the effects the rules put first (CR 616.1a–d, `first`).
 *   - `Choice.by`: the player is asked, where the order matters — a card changing zones, a permanent about to be
 *     destroyed, tokens. Where every order comes to the same thing nobody is; nor where one order is plainly no worse
 *     than any other (`noWorse`: at least as many tokens of every kind). The action that led here stops
 *     (`OrderNeeded`), `apply` hands back the game as it was with the question pending, and with the answer the action
 *     is applied again from the start, the answer known (actions.ts). Nothing is asked while the engine only looks
 *     ahead — listing what is legal, planning which lands pay, a client's preview (`foresee`): there the first takes it.
 *   - `Choice.prefer`: nobody is asked — amounts, life, draws, damage, how a permanent enters: the order is the one
 *     that serves the affected player best.
 * An effect its player "may" apply (CR 903.9b: a commander to the command zone instead) is one they are asked about,
 * alone or among the others; left unapplied, it has had its turn.
 *
 * A replacement effect is one rule in a table. The functions that perform the happening (zones.ts `moveObject` and
 * `drawCard`, registry.ts `onEnterBattlefield`, combat.ts `dealDamage`, permanents.ts `destroy` and `createTokens`,
 * quantities.ts `replaceQuantity` and `applyLifeGain`) know none of them by name.
 */
import type { FaceDef } from '@mtg/schema';
import type { DamageRecipient, GameEvent, GameObject, GameState, PlayerId, ZoneName } from './types.js';

/** Something a replacement effect adds to what it replaced: "… with a void counter on it", "… and you gain 2 life". */
export interface Also {
  /** What it is, for telling one outcome from another ("counter:void", "life:p1:2"); '' if it makes none to anyone. */
  key: string;
  /**
   * Done once the happening has taken place — `late`: after everything else about it (its event included); `early`
   * (as a permanent enters): before its counters are put on it.
   */
  run: (g: GameState, o: GameObject, events: GameEvent[]) => void;
  late?: true;
  early?: true;
}

/** CR 400.6: an object about to move from one zone to another. */
export interface Move {
  kind: 'move';
  object: GameObject;
  from: ZoneName;
  to: ZoneName;
  /** In a library: where. */
  position?: 'top' | 'bottom' | number;
  /** CR 701.9a: it is being discarded. */
  discard?: true;
  also: Also[];
}

/** CR 614.1a: an amount about to be gained, lost, dealt, put or made — life, damage, counters, tokens, cards milled. */
export interface Amount {
  kind: 'amount';
  n: number;
}

/** CR 119: a player about to gain life, or to lose it. */
export interface Life {
  kind: 'life';
  player: PlayerId;
  n: number;
  /** It is lost, not gained. */
  loss: boolean;
}

/** CR 614.12: a permanent about to be on the battlefield, as the effects on how it enters would have it. */
export interface Enter {
  kind: 'enter';
  object: GameObject;
  tapped: boolean;
  /**
   * The counters it enters with, by kind — put on it as one (CR 122.6), whichever effects gave them: "that many plus
   * one" adds one to the lot.
   */
  counters: Record<string, number>;
  /** What else an effect does as it enters, in the order the effects applied. */
  also: Also[];
}

/** CR 121.1: a player about to draw. One card as it starts; an effect may make it more, or another player's. */
export interface Draw {
  kind: 'draw';
  player: PlayerId;
  n: number;
  /** It would be the first card that player draws in their draw step ("except the first one you draw in each of your draw steps"). */
  first: boolean;
  /** Laboratory Maniac: that player wins the game instead. */
  wins?: true;
}

/** CR 120.1: damage about to be dealt by a source to a player or permanent. */
export interface Damage {
  kind: 'damage';
  source: GameObject;
  to: DamageRecipient;
  amount: number;
  combat: boolean;
  /** CR 615.12: it can't be prevented. */
  unpreventable: boolean;
  /** What preventing it has used up that could have been kept: shield counters, damage a "prevent the next N" still had to give. */
  spent: number;
  /** What the effects do once it is settled: the record of what was prevented, a shield used up, "put that many counters" (CR 615.5). */
  also: Also[];
}

/** CR 701.8a: a permanent about to be destroyed. */
export interface Destroy {
  kind: 'destroy';
  object: GameObject;
  /** CR 701.19c: it can't be regenerated. */
  noRegen: boolean;
  /** It isn't destroyed: what replaced that ("shield", "regenerated", "umbra:<the Aura>"). Unset: it still would be. */
  saved?: string;
  /** What is done instead. */
  also: Also[];
}

/** So many tokens of one kind among those about to be created. */
export interface TokenLot {
  /** What each is: this face — for a copy (CR 707.2), the face it copies. */
  face: FaceDef;
  /** A copy: of this card's face. */
  copy?: { card: string; face: number };
  n: number;
  /** An effect added them to the ones asked for ("those tokens plus an additional Food token"): they aren't "those tokens". */
  added?: true;
}

/** CR 111.1: a player about to create tokens. */
export interface Tokens {
  kind: 'tokens';
  player: PlayerId;
  lots: TokenLot[];
  /**
   * The effects that have added their one token to the event this creation is part of ("create X Halflings and X
   * Foods" is one event, and "plus an additional Food token" adds one Food to it).
   */
  already: readonly string[];
}

export type Happening = Move | Amount | Life | Enter | Draw | Damage | Destroy | Tokens;

/** One replacement effect, as it applies to one happening. */
export interface Replacement<H extends Happening = Happening> {
  /** This effect and no other: the same key means the same effect, which applies to a happening once (CR 614.5). */
  key: string;
  /** For the player choosing between several: the card it comes from, and what it says. */
  label: string;
  /** CR 616.1a–d: a self-replacement effect; one that says under whose control a permanent enters; one that makes it enter as a copy. */
  first?: 'self' | 'control' | 'copy';
  /**
   * "may": it applies only if its player wants it to (CR 903.9b: "its owner may put it into the command zone instead").
   * `ask`: the question, where it is the only effect; `no`: what leaving it unapplied is called; `by`: who decides,
   * where that isn't the one who orders the effects.
   */
  may?: { ask: string; no: string; by?: PlayerId };
  /** The happening as this effect leaves it. Null: nothing happens instead. Changes nothing itself. */
  apply: (h: H) => H | null;
}

/** The effects of one sort that apply to a happening as it stands. Changes nothing. */
export type Rule<H extends Happening = Happening> = (g: GameState, h: H) => Replacement<H>[];
/** The rules for one kind of happening, by name — in the order their effects are offered, and taken where nobody chooses. */
export type Rules<H extends Happening = Happening> = Record<string, Rule<H>>;

// ---------------------------------------------------------------------------
// The choice (CR 616.1)
// ---------------------------------------------------------------------------

/** A player has to choose between replacement effects before the action can go on. */
export class OrderNeeded extends Error {
  constructor(
    readonly player: PlayerId,
    readonly text: string,
    readonly sourceName: string,
    readonly options: { key: string; label: string }[],
  ) {
    super('A player has to choose which replacement effect applies first.');
  }
}

/**
 * The choices the action being applied has been given so far, and which is next; `same`: what was chosen between the
 * same effects earlier in this action (five creatures die at once: one question, not five). Null while nothing is
 * being applied for real.
 */
let orders: { answers: string[]; next: number; same: Map<string, string> } | null = null;

/** Runs an action that may ask: `answers` are the choices it was given when it asked before. */
export function deciding<T>(answers: string[], run: () => T): T {
  const was = orders;
  orders = { answers, next: 0, same: new Map() };
  try {
    return run();
  } finally {
    orders = was;
  }
}

/** Runs something on a copy of the game to see what would come of it: nothing is asked, the first effect takes it. */
export function lookingAhead<T>(run: () => T): T {
  const was = orders;
  orders = null;
  try {
    return run();
  } finally {
    orders = was;
  }
}

const FIRST = ['self', 'control', 'copy'] as const;

/** What a happening comes to, as far as anyone can tell two outcomes apart. */
function outcome(h: Happening | null): string {
  if (!h) return 'nothing';
  if (h.kind === 'amount') return String(h.n);
  if (h.kind === 'life') return String(h.loss ? -h.n : h.n);
  if (h.kind === 'enter') return `${h.tapped}/${JSON.stringify(h.counters)}`;
  if (h.kind === 'draw') return `${h.player}/${h.n}/${h.wins ?? ''}`;
  if (h.kind === 'damage') return `${h.to.kind === 'player' ? h.to.player : h.to.object}/${h.amount}/${h.spent}`;
  if (h.kind === 'destroy') return h.saved ?? 'destroyed';
  if (h.kind === 'tokens') return JSON.stringify(Object.entries(tokenCounts(h)).sort(([a], [b]) => (a < b ? -1 : 1)));
  return `${h.to}/${h.position ?? ''}/${h.also
    .map((a) => a.key)
    .filter(Boolean)
    .sort()
    .join(',')}`;
}

/** How many tokens of each kind are about to be created (a kind: what the token is, whoever asked for it). */
export function tokenCounts(h: Tokens): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const lot of h.lots) {
    if (lot.n <= 0) continue;
    const kind = lot.copy ? `copy:${lot.copy.card}:${lot.copy.face}` : JSON.stringify(lot.face);
    counts[kind] = (counts[kind] ?? 0) + lot.n;
  }
  return counts;
}

/** The effects to choose from now: those not applied yet, and of those the ones the rules put first. */
function candidates<H extends Happening>(g: GameState, h: H, rules: Rules<H>, applied: ReadonlySet<string>): Replacement<H>[] {
  const all = Object.values(rules)
    .flatMap((rule) => rule(g, h))
    .filter((r) => !applied.has(r.key));
  for (const kind of FIRST) {
    const some = all.filter((r) => r.first === kind);
    if (some.length) return some;
  }
  return all;
}

/** One thing that can be done next with a happening: an effect applied — or, one that may be, left unapplied. */
interface Step<H extends Happening> {
  key: string;
  label: string;
  of: Replacement<H>;
  apply: (h: H) => H | null;
}

/** What can be done next with a happening. (An effect left unapplied has had its turn: it isn't offered again.) */
function steps<H extends Happening>(g: GameState, h: H, rules: Rules<H>, applied: ReadonlySet<string>): Step<H>[] {
  return candidates(g, h, rules, applied).flatMap((r) => {
    const applying: Step<H> = { key: r.key, label: r.label, of: r, apply: r.apply };
    return r.may ? [applying, { key: `${r.key}:no`, label: r.may.no, of: r, apply: (as: H) => as }] : [applying];
  });
}

/** Every outcome some order of applying the effects leads to. (More than a handful of effects at once: taken to differ.) */
function outcomes<H extends Happening>(g: GameState, h: H | null, rules: Rules<H>, applied: ReadonlySet<string>, depth = 0): Set<string> {
  if (!h) return new Set([outcome(null)]);
  const options = steps(g, h, rules, applied);
  if (!options.length) return new Set([outcome(h)]);
  if (depth > 5 || options.length > 4) return new Set(['?', '??']);
  const out = new Set<string>();
  for (const s of options) for (const end of outcomes(g, s.apply(h), rules, new Set([...applied, s.of.key]), depth + 1)) out.add(end);
  return out;
}

/**
 * How the choice between several effects is made (CR 616.1).
 * `by`: that player is asked, where the order matters; `about` says what is about to happen, for the question.
 *   `noWorse`: whether one outcome is plainly at least as good for that player as another. Where some order comes to an
 *   outcome no worse than any other's, it is taken unasked ("plus an additional Food token", then "twice that many").
 * `prefer`: nobody is asked — the order taken is the one whose outcome serves the affected player best (which of two
 * outcomes is the better: positive if the first). For amounts: nobody wants to be asked, each time a counter is put on
 * a creature, whether it is doubled before one is added.
 */
export type Choice<H extends Happening> =
  | { by: PlayerId; about: () => { text: string; sourceName: string }; noWorse?: (a: H | null, b: H | null) => boolean }
  | { prefer: (a: H | null, b: H | null) => number };

/**
 * A happening as the replacement effects that apply to it leave it (CR 614, 616.1) — null if nothing happens instead.
 * `applied`: the effects that have had their turn at this happening already (it is part of one they applied to, CR
 * 614.5); the ones that apply now are added.
 */
export function replaced<H extends Happening>(g: GameState, h: H, rules: Rules<H>, choice: Choice<H>, applied: Set<string> = new Set()): H | null {
  let now: H | null = h;
  for (let guard = 0; now && guard < 64; guard++) {
    const options: Step<H>[] = steps(g, now, rules, applied);
    if (!options.length) return now;
    let pick = options[0]!;
    if (options.length > 1) {
      if ('prefer' in choice) pick = best(g, now, rules, applied, options, choice.prefer);
      else {
        const plain = choice.noWorse ? plainest(g, now, rules, applied, options, choice.noWorse) : undefined;
        if (plain) pick = plain;
        // (Every order comes to the same thing: no one needs to say which.)
        else if (orders && outcomes(g, now, rules, applied).size > 1) {
          // One effect that may be left unapplied, and no other: its player is asked whether it applies.
          const lone = options.every((s) => s.of === options[0]!.of) ? options[0]!.of.may : undefined;
          pick = lone ? chosen(lone.by ?? choice.by, () => ({ text: lone.ask, sourceName: choice.about().sourceName }), options) : chosen(choice.by, choice.about, options);
        }
      }
    }
    applied.add(pick.of.key);
    now = pick.apply(now);
  }
  return now;
}

/** The step to take first on the way to the outcome the affected player likes best. (More than six at once: the first.) */
function best<H extends Happening>(g: GameState, h: H, rules: Rules<H>, applied: ReadonlySet<string>, options: Step<H>[], prefer: (a: H | null, b: H | null) => number): Step<H> {
  if (options.length > 6) return options[0]!;
  const end = (at: H | null, done: ReadonlySet<string>): H | null => {
    if (!at) return null;
    const next = steps(g, at, rules, done);
    if (!next.length) return at;
    let top: H | null | undefined;
    for (const s of next.slice(0, 6)) {
      const got = end(s.apply(at), new Set([...done, s.of.key]));
      if (top === undefined || prefer(got, top) > 0) top = got;
    }
    return top ?? null;
  };
  let pick = options[0]!;
  let top: H | null | undefined;
  for (const s of options) {
    const got = end(s.apply(h), new Set([...applied, s.of.key]));
    if (top === undefined || prefer(got, top) > 0) {
      top = got;
      pick = s;
    }
  }
  return pick;
}

/**
 * The step to take first on the way to an outcome that is plainly no worse for the chooser than any outcome of any
 * order — undefined where no order comes to one (or with more than six steps to choose from).
 */
function plainest<H extends Happening>(g: GameState, h: H, rules: Rules<H>, applied: ReadonlySet<string>, options: Step<H>[], noWorse: (a: H | null, b: H | null) => boolean): Step<H> | undefined {
  if (options.length > 6) return undefined;
  // Every outcome each first step can lead to, one of each (by what tells two outcomes apart).
  const ends = (at: H | null, done: ReadonlySet<string>, into: Map<string, H | null>): void => {
    const next = at ? steps(g, at, rules, done) : [];
    if (!at || !next.length) return void into.set(outcome(at), at);
    for (const s of next.slice(0, 6)) ends(s.apply(at), new Set([...done, s.of.key]), into);
  };
  const reach = options.map((s) => {
    const into = new Map<string, H | null>();
    ends(s.apply(h), new Set([...applied, s.of.key]), into);
    return into;
  });
  const all = new Map<string, H | null>();
  for (const into of reach) for (const [k, e] of into) all.set(k, e);
  const everything = [...all.values()];
  const i = reach.findIndex((into) => [...into.values()].some((e) => everything.every((other) => noWorse(e, other))));
  return i < 0 ? undefined : options[i];
}

function chosen<H extends Happening>(chooser: PlayerId, about: () => { text: string; sourceName: string }, options: Step<H>[]): Step<H> {
  const o = orders!;
  const which = options
    .map((r) => r.key)
    .sort()
    .join('|');
  const before = o.same.get(which);
  let key = before;
  if (key === undefined && o.next < o.answers.length) {
    key = o.answers[o.next++];
    // (An answer to another question: the game went on in between — a player conceded. What follows it is void.)
    if (!options.some((r) => r.key === key)) {
      o.answers.length = o.next - 1;
      o.next = o.answers.length;
      key = undefined;
    }
  }
  const pick = options.find((r) => r.key === key);
  if (!pick) {
    const { text, sourceName } = about();
    throw new OrderNeeded(
      chooser,
      text,
      sourceName,
      options.map((r) => ({ key: r.key, label: r.label })),
    );
  }
  o.same.set(which, pick.key);
  return pick;
}
