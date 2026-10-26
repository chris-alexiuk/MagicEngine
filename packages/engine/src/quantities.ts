import type { QuantityReplacementNode, StaticAbility } from '@mtg/schema';
import { matchesFilter, objectAbilities } from './characteristics.js';
import type { DamageRecipient, GameObject, GameState, PlayerId } from './types.js';
import { faceOf } from './zones.js';

/**
 * Replacement effects that change an amount (CR 614.1a): life gained, tokens created, counters
 * put on something, damage dealt. CR 616.1: with several, the affected player (or the affected
 * object's controller) chooses the order — here, the order that's best for them: increases add
 * before they double for what they gain; doubling comes first for damage they're dealt.
 */
export interface QuantitySubject {
  /** Who gains the life, gets the tokens, or puts the counters. */
  player?: PlayerId;
  /** What the counters are put on. */
  object?: GameObject;
  counter?: string;
  /** The damage source and recipient. */
  source?: GameObject;
  to?: DamageRecipient;
  combat?: boolean;
}

export function replaceQuantity(g: GameState, event: QuantityReplacementNode['event'], n: number, subject: QuantitySubject): number {
  if (n <= 0) return n;
  const mods: QuantityReplacementNode[] = [];
  for (const id of g.zones.battlefield) {
    const source = g.objects[id]!;
    for (const a of objectAbilities(g, source)) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'replace_quantity') continue;
      const e = (a as StaticAbility).effect as QuantityReplacementNode;
      if (e.event !== event || !applies(g, e, source, subject)) continue;
      mods.push(e);
    }
  }
  if (!mods.length) return n;
  const plus = mods.filter((m) => m.op === 'plus').reduce((x, m) => x + (m.n ?? 0), 0);
  const factor = mods.reduce((x, m) => x * (m.op === 'double' ? 2 : m.op === 'triple' ? 3 : 1), 1);
  return event === 'damage' ? n * factor + plus : (n + plus) * factor;
}

function applies(g: GameState, e: QuantityReplacementNode, source: GameObject, s: QuantitySubject): boolean {
  const you = source.controller;
  const who = (p: PlayerId | undefined) => !e.who || e.who === 'each' || (e.who === 'you' ? p === you : p !== undefined && p !== you);
  switch (e.event) {
    case 'gain_life':
    case 'tokens':
      return who(s.player);
    case 'counters':
      if (!who(s.player) || !s.object) return false;
      if (e.counter && e.counter !== s.counter) return false;
      return !e.filter || matchesFilter(g, s.object, e.filter, { controller: you, source });
    case 'damage': {
      if (!s.source || (e.noncombat && s.combat)) return false;
      if (e.filter && !matchesFilter(g, s.source, e.filter, { controller: you, source, anyZone: true })) return false;
      if (e.toOpponents) {
        const p = s.to?.kind === 'player' ? s.to.player : s.to ? g.objects[s.to.object]?.controller : undefined;
        if (!p || p === you) return false;
      }
      return true;
    }
    default:
      return false;
  }
}
