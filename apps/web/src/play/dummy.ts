import { apply, blockDeclarationProblem, type ChoiceAnswer, type GameState, type PendingChoice, type PlayerId, type Target, type TargetPrompt } from '@mtg/engine';

/**
 * The practice dummy in a solo playtest: a seat that never acts. It keeps its opening hand, passes priority, and
 * answers anything it's asked with the plainest legal answer (no blocks, keep the cards on top, decline "may"). Every
 * answer is applied through the engine like anyone else's, and checked with apply() first.
 */

const firstTargets = (prompts: readonly TargetPrompt[]): Target[][] => prompts.map((pr) => pr.candidates.slice(0, pr.upTo ? (pr.min ?? 0) : pr.count));

function candidates(g: GameState, p: PendingChoice): ChoiceAnswer[] {
  const me = p.player;
  const hand = [...(g.zones.hand[me] ?? [])];
  switch (p.kind) {
    case 'mulligan':
      return [{ kind: 'mulligan', keep: true }];
    case 'bottom_cards':
      return [{ kind: 'bottom_cards', objects: hand.slice(-p.count) }];
    case 'opening_battlefield':
      return [{ kind: 'opening_battlefield', objects: [] }];
    case 'discard_to_hand_size':
      return [{ kind: 'discard_to_hand_size', objects: hand.slice(-p.count) }];
    case 'discard':
      return [{ kind: 'discard', objects: hand.slice(-Math.min(p.count, hand.length)) }];
    case 'keep_tapped':
      return [{ kind: 'keep_tapped', objects: [] }];
    case 'untap_limit':
      return [{ kind: 'untap_limit', objects: p.candidates.slice(0, p.n) }];
    case 'dredge':
      return [{ kind: 'dredge', object: null }];
    case 'legend_rule':
      return [{ kind: 'legend_rule', keep: p.objects[0]! }];
    case 'commander_zone':
      return [{ kind: 'commander_zone', move: true }];
    case 'manual_resolution':
      return [{ kind: 'manual_resolution', done: true }];
    case 'declare_attackers':
      return [{ kind: 'declare_attackers', attacks: [] }];
    case 'declare_blockers': {
      if (!blockDeclarationProblem(g, me, [])) return [{ kind: 'declare_blockers', blocks: [] }];
      // A block it's forced to make (a lure): the first creature able to block each attacker.
      const blocks = p.blockers.flatMap((blocker, i) => (p.attackers[i % p.attackers.length] ? [{ blocker, attacker: p.attackers[i % p.attackers.length]! }] : []));
      return [{ kind: 'declare_blockers', blocks }];
    }
    case 'assign_combat_damage':
      return [{ kind: 'assign_combat_damage', assignments: Object.fromEntries(p.choices.map((c) => [c.attacker, c.suggested])) }];
    case 'trigger_targets': {
      if (p.modes) {
        const i = p.modes.options.findIndex((o, k) => !p.modes!.used?.includes(k) && o.prompts.every((pr) => pr.candidates.length >= (pr.upTo ? (pr.min ?? 0) : pr.count)));
        const modes = i < 0 ? [] : Array.from({ length: Math.max(1, p.modes.min) }, () => i);
        return [{ kind: 'trigger_targets', modes, targets: [...(i < 0 ? [] : firstTargets(p.modes.options[i]!.prompts)), ...firstTargets(p.prompts)] }];
      }
      return [{ kind: 'trigger_targets', targets: firstTargets(p.prompts) }];
    }
    case 'scry':
      return [{ kind: 'scry', top: [...p.objects], bottom: [] }];
    case 'surveil':
      return [{ kind: 'surveil', top: [...p.objects], graveyard: [] }];
    case 'may':
      return [{ kind: 'may', yes: false }, { kind: 'may', yes: true }];
    case 'choose_option':
      return p.options.map((choice) => ({ kind: 'choose_option', choice }));
    case 'cast_free':
      return [{ kind: 'cast_free', cast: false }];
    case 'copy_targets':
      return [{ kind: 'copy_targets' }, { kind: 'copy_targets', targets: firstTargets(p.prompts) }];
    case 'pay':
      return [{ kind: 'pay', pay: false }];
    case 'search':
      return [{ kind: 'search', objects: p.mustFind ? p.candidates.slice(0, p.count) : [] }];
    case 'sacrifice':
      return [{ kind: 'sacrifice', objects: p.candidates.slice(0, p.count) }];
    case 'proliferate':
      return [{ kind: 'proliferate', objects: [], players: [] }];
    case 'choose_objects':
      return [{ kind: 'choose_objects', objects: p.candidates.slice(0, p.min) }];
    case 'as_enters':
      if (p.options?.length) return p.options.map((choice) => ({ kind: 'as_enters', choice }));
      if (p.choice === 'enchant') return (p.candidates ?? []).map((attach) => ({ kind: 'as_enters', attach }));
      if (p.choice === 'copy') return [{ kind: 'as_enters', copy: null }];
      if (p.choice === 'size') return [{ kind: 'as_enters', size: { power: 1, toughness: 1 } }];
      if (p.choice === 'loyalty') return [{ kind: 'as_enters', loyalty: 1 }];
      if (p.choice === 'reveal' || p.choice === 'discard_or_leave') return [{ kind: 'as_enters', reveal: null }];
      if (p.choice === 'devour') return [{ kind: 'as_enters', sacrifice: [] }];
      if (p.choice === 'sacrifice_or_leave') return [{ kind: 'as_enters', sacrifice: (p.candidates ?? []).slice(0, p.amount ?? 1) }];
      return [{ kind: 'as_enters', pay: false }, { kind: 'as_enters', pay: true }];
  }
  return [];
}

/** The dummy's answer to the choice it's asked, or null if none of its plain answers is legal. */
export function dummyAnswer(g: GameState): { player: PlayerId; answer: ChoiceAnswer } | null {
  const p = g.pending;
  if (!p) return null;
  for (const answer of candidates(g, p)) {
    try {
      if (apply(g, { type: 'choose', player: p.player, answer }).ok) return { player: p.player, answer };
    } catch {
      /* try the next answer */
    }
  }
  return null;
}
