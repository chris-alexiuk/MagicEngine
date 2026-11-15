/**
 * Rules as properties of the game: each entry is something a rule makes true whenever a player has priority (CR 704.3:
 * state-based actions have been performed by then; CR 603.3: triggered abilities are on the stack), said in the
 * rule's own terms and with its number — not in terms of how the engine brings it about. Random games (fuzz.ts) and
 * the card sandbox check them after every action, so the rule is verified against whatever the cards made happen.
 *
 * A rule that changes is one entry here to change. An entry is only as strong as it is certain: where a card can make
 * an exception ("You don't lose the game for having 0 or less life"), the entry says so through the same question the
 * engine asks (playerRule, legendRuleExempt), and leaves alone what the engine itself couldn't read (`unsized`).
 */
import { chars, hasKeyword, hasType, toughness, withStableChars } from '../../src/characteristics.js';
import { cantLose } from '../../src/flow.js';
import { legendRuleExempt, playerRule } from '../../src/player-rules.js';
import { canAttach, canEnchantPlayer } from '../../src/permanents.js';
import type { GameObject, GameState } from '../../src/types.js';

export interface RuleCheck {
  /** The rule it states (CR number). */
  rule: string;
  /** What the rule makes true. */
  says: string;
  /** What breaks it in this state (`before`: the state one action earlier), or null. */
  broken: (g: GameState, before: GameState | undefined) => string | null;
}

const permanents = (g: GameState): GameObject[] => g.zones.battlefield.map((id) => g.objects[id]!).filter(Boolean);
const named = (g: GameState, o: GameObject): string => `${chars(g, o).name || o.card} (${o.id})`;
const first = <T,>(items: T[], says: (t: T) => string | null): string | null => {
  for (const t of items) {
    const s = says(t);
    if (s) return s;
  }
  return null;
};

export const RULE_CHECKS: RuleCheck[] = [
  {
    rule: '704.5a',
    says: 'A player with 0 or less life has lost the game.',
    broken: (g) => first(g.order, (p) => (!g.players[p]!.lost && g.players[p]!.life <= 0 && !playerRule(g, p, 'no_lose_for_life') && !cantLose(g, p) ? `${p} is at ${g.players[p]!.life} life and still playing` : null)),
  },
  {
    rule: '704.5c',
    says: 'A player with ten or more poison counters has lost the game.',
    broken: (g) => first(g.order, (p) => (!g.players[p]!.lost && g.players[p]!.poison >= 10 && !cantLose(g, p) ? `${p} has ${g.players[p]!.poison} poison counters and is still playing` : null)),
  },
  {
    rule: '704.6c',
    says: 'In a Commander game, a player dealt 21 or more combat damage by the same commander has lost the game.',
    broken: (g) =>
      g.config.format !== 'commander'
        ? null
        : first(g.order, (p) => (!g.players[p]!.lost && Object.values(g.commanderDamage[p] ?? {}).some((n) => n >= 21) && !cantLose(g, p) ? `${p} has taken 21 or more combat damage from one commander and is still playing` : null)),
  },
  {
    rule: '704.5d',
    says: "A token that has left the battlefield has ceased to exist.",
    broken: (g) =>
      first(
        [...g.order.flatMap((p) => [...(g.zones.hand[p] ?? []), ...(g.zones.library[p] ?? []), ...(g.zones.graveyard[p] ?? [])]), ...g.zones.exile, ...g.zones.command],
        (id) => (g.objects[id]?.token ? `the token ${g.objects[id]!.card} (${id}) is in ${g.objects[id]!.zone}` : null),
      ),
  },
  {
    rule: '704.5f',
    says: 'No creature on the battlefield has toughness 0 or less.',
    broken: (g) => first(permanents(g), (o) => (hasType(g, o, 'Creature') && !o.unsized && toughness(g, o) <= 0 ? `${named(g, o)} has toughness ${toughness(g, o)}` : null)),
  },
  {
    rule: '704.5g',
    says: "No creature has damage marked on it equal to or greater than its toughness, unless it's indestructible.",
    broken: (g) =>
      first(permanents(g), (o) => (hasType(g, o, 'Creature') && !o.unsized && toughness(g, o) > 0 && o.damage >= toughness(g, o) && !hasKeyword(g, o, 'indestructible') ? `${named(g, o)} has ${o.damage} damage and toughness ${toughness(g, o)}` : null)),
  },
  {
    rule: '704.5i',
    says: 'No planeswalker on the battlefield has loyalty 0.',
    broken: (g) => first(permanents(g), (o) => (hasType(g, o, 'Planeswalker') && !o.unsized && (o.counters.loyalty ?? 0) <= 0 ? `${named(g, o)} has loyalty ${o.counters.loyalty ?? 0}` : null)),
  },
  {
    rule: '704.5j',
    says: 'No player controls two legendary permanents with the same name (the "legend rule"), unless it doesn\'t apply to them.',
    broken: (g) => {
      const seen = new Set<string>();
      return first(permanents(g), (o) => {
        const c = chars(g, o);
        if (!c.supertypes.includes('Legendary') || !c.name || legendRuleExempt(g, o)) return null;
        const key = `${o.controller}\u0000${c.name}`;
        if (seen.has(key)) return `${o.controller} controls two legendary permanents named ${c.name}`;
        seen.add(key);
        return null;
      });
    },
  },
  {
    rule: '704.5m',
    says: 'Every Aura on the battlefield is attached to an object or a player it can enchant.',
    broken: (g) =>
      first(permanents(g), (o) => {
        const c = chars(g, o);
        if (!c.subtypes.includes('Aura')) return null;
        // What it can enchant is what its enchant ability says (CR 303.4). One the grammar couldn't read ("Enchant
        // zone", "Enchant creature with another Aura attached to it") is attached by hand: the engine can't say what
        // is legal for it, and leaves it alone.
        if (!c.keywords.some((k) => k.id === 'enchant' && (k.filter || k.player)) && !o.becameAura) return null;
        if (o.attachedToPlayer !== undefined) return canEnchantPlayer(g, o, o.attachedToPlayer) ? null : `${named(g, o)} is attached to ${o.attachedToPlayer}, whom it can't enchant`;
        // The object it is attached to, wherever that is (Animate Dead: a creature card in a graveyard).
        const at = o.attachedTo ? g.objects[o.attachedTo.id] : undefined;
        if (!at || at.zcc !== o.attachedTo!.zcc) return `${named(g, o)} is an Aura attached to nothing`;
        return canAttach(g, o, at) ? null : `${named(g, o)} is attached to ${named(g, at)}, which it can't enchant`;
      }),
  },
  {
    rule: '704.5n',
    says: "No Equipment is attached to a permanent it can't equip.",
    broken: (g) =>
      first(permanents(g), (o) => {
        if (!o.attachedTo || !chars(g, o).subtypes.includes('Equipment')) return null;
        const at = g.objects[o.attachedTo.id];
        if (!at || at.zcc !== o.attachedTo.zcc) return `${named(g, o)} is attached to something that is gone`;
        return canAttach(g, o, at) ? null : `${named(g, o)} is attached to ${named(g, at)}, which it can't equip`;
      }),
  },
  {
    rule: '704.5q',
    says: 'No permanent has both a +1/+1 counter and a -1/-1 counter on it.',
    broken: (g) => first(permanents(g), (o) => ((o.counters['+1/+1'] ?? 0) > 0 && (o.counters['-1/-1'] ?? 0) > 0 ? `${named(g, o)} has +1/+1 and -1/-1 counters` : null)),
  },
  {
    rule: '107.1',
    says: 'A number of counters is a whole number, never less than none.',
    broken: (g) => first(permanents(g), (o) => first(Object.entries(o.counters), ([k, n]) => (Number.isInteger(n) && n >= 0 ? null : `${named(g, o)} has ${n} ${k} counters`))),
  },
  {
    rule: '603.3',
    says: 'When a player has priority, every ability that has triggered is on the stack.',
    broken: (g) => (g.triggers.length ? `${g.triggers.length} triggered abilit${g.triggers.length === 1 ? 'y is' : 'ies are'} waiting (${g.triggers[0]!.sourceName})` : null),
  },
  {
    rule: '514.2',
    says: 'Damage marked on permanents is removed in the cleanup step: none is left as the next turn begins.',
    broken: (g, before) => (before && before.turn !== g.turn ? first(permanents(g), (o) => (o.damage > 0 ? `${named(g, o)} still has ${o.damage} damage from an earlier turn` : null)) : null),
  },
  {
    rule: '511.3',
    says: 'Outside the combat phase no creature is attacking or blocking.',
    broken: (g) => (!['beginning_of_combat', 'declare_attackers', 'declare_blockers', 'combat_damage', 'end_of_combat'].includes(g.step) && g.combat && Object.keys(g.combat.attackers ?? {}).length + Object.keys(g.combat.blockers ?? {}).length > 0 ? `creatures are still attacking or blocking in ${g.step}` : null),
  },
  {
    rule: '800.4a',
    says: 'When a player has left the game, nothing they own or control is on the battlefield or the stack.',
    broken: (g) => {
      const gone = (p: string | undefined) => p !== undefined && Boolean(g.players[p]?.lost);
      return (
        first(permanents(g), (o) => (gone(o.owner) || gone(o.controller) ? `${named(g, o)} is on the battlefield though ${gone(o.owner) ? o.owner : o.controller} has left the game` : null)) ??
        first(g.stack, (e) => (gone(e.controller) ? `${e.controller} has left the game and still controls something on the stack` : null))
      );
    },
  },
  {
    rule: '104.2a',
    says: 'The game is over once all but one player have left it.',
    broken: (g) => (!g.over && g.order.filter((p) => !g.players[p]!.lost).length <= 1 ? 'one player is left and the game goes on' : null),
  },
];

/**
 * The first rule this state breaks, if any: "CR 704.5f: … — what is wrong". Only where the rules promise it: a player
 * has priority and nothing is waiting on a choice.
 */
export function checkRules(g: GameState, before?: GameState): string | null {
  if (g.over || g.pending || g.priority === null || !g.started) return null;
  // (Each permanent's characteristics are worked out once for all the entries: they only read the state.)
  return withStableChars(g, () => {
    for (const c of RULE_CHECKS) {
      const bad = c.broken(g, before);
      if (bad) return `CR ${c.rule}: ${c.says} — ${bad}`;
    }
    return null;
  });
}
