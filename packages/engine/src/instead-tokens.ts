/**
 * The replacement effects on tokens about to be created (CR 111.1, 614.1a): each sort is a rule here, and `createTokens`
 * (permanents.ts) puts every creation to them through instead.ts.
 *
 *   one_of_each   Academy Manufactor: "If you would create a Clue, Food, or Treasure token, instead create one of each."
 *   added         "those tokens plus an additional Food token", "… plus that many 1/1 green Squirrel creature tokens"
 *   changed       "twice that many of those tokens", "three times that many"
 *   swapped       Divine Visitation: "that many 4/4 white Angel creature tokens … are created instead"
 *
 * CR 616.1: the player creating them orders the effects. Where one order leaves at least as many tokens of every kind
 * as any other does, it is the one taken, unasked — "plus an additional Food token" before "twice that many". Where no
 * order does (two Angels, or an Angel and a Squirrel), the player is asked.
 */
import type { FaceDef, ObjectFilter, QuantityReplacementNode } from '@mtg/schema';
import { tokenCounts, type Replacement, type Rules, type TokenLot, type Tokens } from './instead.js';
import { says, statics } from './instead-moves.js';
import { changedBy } from './quantities.js';
import type { GameState, PlayerId } from './types.js';

/** One effect on tokens being created, wherever it comes from. */
interface TokenEffect {
  key: string;
  label: string;
  /** Whose tokens it is about. */
  on: (player: PlayerId) => boolean;
  node: QuantityReplacementNode | { type: 'token_one_of_each'; tokens: FaceDef[] };
}

function scan(g: GameState): TokenEffect[] {
  const out: TokenEffect[] = [];
  for (const s of statics(g, 'replace_quantity')) {
    const e = s.node as unknown as QuantityReplacementNode;
    if (e.event !== 'tokens') continue;
    const you = s.source.controller;
    // "under your control" — Primal Vigor: anyone's.
    out.push({ key: s.key, label: says(g, s.source, s.text), on: (p) => !e.who || e.who === 'each' || (e.who === 'you' ? p === you : p !== you), node: e });
  }
  for (const s of statics(g, 'token_one_of_each')) {
    const you = s.source.controller;
    out.push({ key: s.key, label: says(g, s.source, s.text), on: (p) => p === you, node: s.node as unknown as { type: 'token_one_of_each'; tokens: FaceDef[] } });
  }
  return out;
}

/** The effects in force, found once for the creation being settled: nothing changes while it is. */
let found: { g: GameState; effects: TokenEffect[] } | undefined;

/** Runs the settling of one creation of tokens. */
export function settling<T>(g: GameState, run: () => T): T {
  const was = found;
  found = { g, effects: scan(g) };
  try {
    return run();
  } finally {
    found = was;
  }
}

const effectsOn = (g: GameState, player: PlayerId): TokenEffect[] => (found?.g === g ? found.effects : scan(g)).filter((e) => e.on(player));

/** Whether an effect on "one or more Treasure tokens", "creature tokens" is about these. */
const fits = (f: ObjectFilter | undefined, lot: TokenLot): boolean => lot.n > 0 && (!f?.types || f.types.some((t) => lot.face.types.includes(t))) && (!f?.subtypes || f.subtypes.some((t) => lot.face.subtypes.includes(t)));

const TRINKETS = ['Clue', 'Food', 'Treasure'];
const trinket = (lot: TokenLot): boolean => lot.n > 0 && !lot.copy && lot.face.subtypes.some((t) => TRINKETS.includes(t));

export const TOKEN_RULES: Rules<Tokens> = {
  /** Academy Manufactor: each Clue, Food or Treasure token about to be created becomes one of each. */
  one_of_each(g, h) {
    if (!h.lots.some(trinket)) return [];
    const out: Replacement<Tokens>[] = [];
    for (const e of effectsOn(g, h.player)) {
      if (e.node.type !== 'token_one_of_each') continue;
      const faces = e.node.tokens as FaceDef[];
      out.push({ key: e.key, label: e.label, apply: (t) => ({ ...t, lots: t.lots.flatMap((lot) => (trinket(lot) ? faces.map((face) => ({ face, n: lot.n, ...(lot.added ? { added: true as const } : {}) })) : [lot])) }) });
    }
    return out;
  },

  /**
   * Peregrin Took: "those tokens plus an additional Food token"; Chatterfang: "… plus that many 1/1 green Squirrel
   * creature tokens". One token for the whole event, or as many as the tokens it is about.
   */
  added(g, h) {
    const out: Replacement<Tokens>[] = [];
    for (const e of effectsOn(g, h.player)) {
      if (e.node.type !== 'replace_quantity' || e.node.op !== 'extra' || !e.node.extra) continue;
      const { token, thatMany } = e.node.extra;
      const f = e.node.tokenFilter;
      if (!h.lots.some((lot) => fits(f, lot)) || (!thatMany && h.already.includes(e.key))) continue;
      out.push({
        key: e.key,
        label: e.label,
        apply: (t) => ({ ...t, lots: [...t.lots, { face: token, n: thatMany ? t.lots.reduce((sum, lot) => sum + (fits(f, lot) ? lot.n : 0), 0) : 1, added: true }] }),
      });
    }
    return out;
  },

  /** Doubling Season: "twice that many of those tokens"; Ojer Taq: "three times that many" creature tokens. */
  changed(g, h) {
    const out: Replacement<Tokens>[] = [];
    for (const e of effectsOn(g, h.player)) {
      if (e.node.type !== 'replace_quantity' || e.node.op === 'extra' || e.node.op === 'swap') continue;
      const node = e.node;
      if (!h.lots.some((lot) => fits(node.tokenFilter, lot))) continue;
      out.push({ key: e.key, label: e.label, apply: (t) => ({ ...t, lots: t.lots.map((lot) => (fits(node.tokenFilter, lot) ? { ...lot, n: changedBy(node, lot.n) } : lot)) }) });
    }
    return out;
  },

  /** Divine Visitation: that many Angels instead of the creature tokens — of a copy of a creature too. */
  swapped(g, h) {
    const out: Replacement<Tokens>[] = [];
    for (const e of effectsOn(g, h.player)) {
      if (e.node.type !== 'replace_quantity' || e.node.op !== 'swap' || !e.node.extra) continue;
      const { token } = e.node.extra;
      const f = e.node.tokenFilter;
      if (!h.lots.some((lot) => fits(f, lot))) continue;
      out.push({ key: e.key, label: e.label, apply: (t) => ({ ...t, lots: t.lots.map((lot) => (fits(f, lot) ? { face: token, n: lot.n, ...(lot.added ? { added: true as const } : {}) } : lot)) }) });
    }
    return out;
  },
};

/** CR 616.1: an outcome with at least as many tokens of every kind as another is no worse for the one creating them. */
export function noFewerTokens(a: Tokens | null, b: Tokens | null): boolean {
  if (!b) return true;
  if (!a) return !Object.keys(tokenCounts(b)).length;
  const mine = tokenCounts(a);
  return Object.entries(tokenCounts(b)).every(([kind, n]) => (mine[kind] ?? 0) >= n);
}

/** What is about to be created, for the player choosing between the effects on it. */
export function tokensQuestion(g: GameState, h: Tokens): { text: string; sourceName: string } {
  const who = g.players[h.player]?.name ?? h.player;
  const what = h.lots.map((lot) => `${lot.n} ${lot.face.name}`).join(', ');
  return { text: `${who} would create tokens (${what}), and more than one effect replaces that. Which applies first?`, sourceName: h.lots[0]?.face.name ?? 'Tokens' };
}
