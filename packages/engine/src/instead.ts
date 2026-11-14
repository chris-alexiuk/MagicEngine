/**
 * One path for "instead" (CR 614–616).
 *
 * Something about to happen — a card changing zones, an amount being gained or dealt, a permanent entering — is a
 * `Happening`. Before it happens, every replacement effect that applies to it is found: each kind of happening has its
 * rules (instead-moves.ts, instead-enters.ts, quantities.ts), and a rule gives one `Replacement` for each effect of
 * its sort that applies to the happening as it now stands. One
 * is applied at a time; each at most once to the same happening (CR 614.5); after each, the happening as it has become
 * is looked at afresh — an effect may apply now that didn't, or no longer apply (CR 616.1f, 616.2).
 *
 * With several to choose from, the affected player — or the controller of the affected object, its owner if it has
 * none — chooses which applies first (CR 616.1): after the effects the rules put first (CR 616.1a–d, `first`). Where
 * every order comes to the same thing nobody is asked. Where it doesn't, the player is: the action that led here stops
 * (`OrderNeeded`), `apply` hands back the game as it was with the question pending, and with the answer the action is
 * applied again from the start, the answer known (actions.ts). Nothing is asked while the engine only looks ahead —
 * listing what is legal, planning which lands pay: there the first takes it. For amounts nobody is asked at all: the
 * order is the one that serves the affected player best (`Choice.prefer`).
 *
 * A replacement effect is one rule in a table. The function that performs the happening (zones.ts `moveObject`) knows
 * none of them by name.
 */
import type { GameEvent, GameObject, GameState, PlayerId, ZoneName } from './types.js';

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

export type Happening = Move | Amount | Enter;

/** One replacement effect, as it applies to one happening. */
export interface Replacement<H extends Happening = Happening> {
  /** This effect and no other: the same key means the same effect, which applies to a happening once (CR 614.5). */
  key: string;
  /** For the player choosing between several: the card it comes from, and what it says. */
  label: string;
  /** CR 616.1a–d: a self-replacement effect; one that says under whose control a permanent enters; one that makes it enter as a copy. */
  first?: 'self' | 'control' | 'copy';
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
  if (h.kind === 'enter') return `${h.tapped}/${JSON.stringify(h.counters)}`;
  return `${h.to}/${h.position ?? ''}/${h.also
    .map((a) => a.key)
    .filter(Boolean)
    .sort()
    .join(',')}`;
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

/** Every outcome some order of applying the effects leads to. (More than a handful of effects at once: taken to differ.) */
function outcomes<H extends Happening>(g: GameState, h: H | null, rules: Rules<H>, applied: ReadonlySet<string>, depth = 0): Set<string> {
  if (!h) return new Set([outcome(null)]);
  const options = candidates(g, h, rules, applied);
  if (!options.length) return new Set([outcome(h)]);
  if (depth > 5 || options.length > 4) return new Set(['?', '??']);
  const out = new Set<string>();
  for (const r of options) for (const end of outcomes(g, r.apply(h), rules, new Set([...applied, r.key]), depth + 1)) out.add(end);
  return out;
}

/**
 * How the choice between several effects is made (CR 616.1).
 * `by`: that player is asked, where the order matters; `about` says what is about to happen, for the question.
 * `prefer`: nobody is asked — the order taken is the one whose outcome serves the affected player best (which of two
 * outcomes is the better: positive if the first). For amounts: nobody wants to be asked, each time a counter is put on
 * a creature, whether it is doubled before one is added.
 */
export type Choice<H extends Happening> = { by: PlayerId; about: () => { text: string; sourceName: string } } | { prefer: (a: H | null, b: H | null) => number };

/**
 * A happening as the replacement effects that apply to it leave it (CR 614, 616.1) — null if nothing happens instead.
 */
export function replaced<H extends Happening>(g: GameState, h: H, rules: Rules<H>, choice: Choice<H>): H | null {
  const applied = new Set<string>();
  let now: H | null = h;
  for (let guard = 0; now && guard < 64; guard++) {
    const options: Replacement<H>[] = candidates(g, now, rules, applied);
    if (!options.length) return now;
    let pick = options[0]!;
    if (options.length > 1) {
      if ('prefer' in choice) pick = best(g, now, rules, applied, options, choice.prefer);
      // (Every order comes to the same thing: no one needs to say which.)
      else if (orders && outcomes(g, now, rules, applied).size > 1) pick = chosen(choice.by, choice.about, options);
    }
    applied.add(pick.key);
    now = pick.apply(now);
  }
  return now;
}

/** The effect to apply first on the way to the outcome the affected player likes best. (More than six at once: the first.) */
function best<H extends Happening>(g: GameState, h: H, rules: Rules<H>, applied: ReadonlySet<string>, options: Replacement<H>[], prefer: (a: H | null, b: H | null) => number): Replacement<H> {
  if (options.length > 6) return options[0]!;
  const end = (at: H | null, done: ReadonlySet<string>): H | null => {
    if (!at) return null;
    const next = candidates(g, at, rules, done);
    if (!next.length) return at;
    let top: H | null | undefined;
    for (const r of next.slice(0, 6)) {
      const got = end(r.apply(at), new Set([...done, r.key]));
      if (top === undefined || prefer(got, top) > 0) top = got;
    }
    return top ?? null;
  };
  let pick = options[0]!;
  let top: H | null | undefined;
  for (const r of options) {
    const got = end(r.apply(h), new Set([...applied, r.key]));
    if (top === undefined || prefer(got, top) > 0) {
      top = got;
      pick = r;
    }
  }
  return pick;
}

function chosen<H extends Happening>(chooser: PlayerId, about: () => { text: string; sourceName: string }, options: Replacement<H>[]): Replacement<H> {
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
