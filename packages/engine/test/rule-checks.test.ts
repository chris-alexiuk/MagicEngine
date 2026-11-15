import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId } from '../src/index.js';
import { RULE_CHECKS, checkRules } from '../scripts/lib/rule-checks.js';
import { act, give, makeCard, start, toStep, type StartOptions } from './helpers.js';

/**
 * The rules stated as properties (scripts/lib/rule-checks.ts) are what the random games and the card sandbox are held
 * to. A property that can't fail proves nothing — so each one is shown a state that breaks its rule, made by hand past
 * the engine, and has to name the rule. The exceptions cards make have to pass, and so does an ordinary game.
 */
const card = (name: string, type_line: string, oracle_text: string, more: Record<string, string> = {}) => makeCard({ name, type_line, oracle_text, mana_cost: '{0}', ...more });
const CARDS = [
  card('Stone Ward', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.'),
  card('Grave Ward', 'Enchantment — Aura', 'Enchant creature card in a graveyard'),
  card('Zone Ward', 'Enchantment — Aura', 'Enchant zone'),
  card('Hex', 'Enchantment — Aura Curse', 'Enchant player'),
  card('Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip {1}'),
  card('Old King', 'Legendary Creature — Human Noble', '', { power: '2', toughness: '2' }),
  card('Walker', 'Legendary Planeswalker — Tester', '+1: You gain 1 life.', { loyalty: '3' }),
  card('Statue', 'Artifact Creature — Golem', 'Indestructible', { power: '2', toughness: '2' }),
  card('Unlife', 'Enchantment', "You don't lose the game for having 0 or less life."),
  card('Angel', 'Artifact Creature — Angel', "You can't lose the game and your opponents can't win the game.", { power: '4', toughness: '4' }),
  card('Mirror Hall', 'Artifact', 'The "legend rule" doesn\'t apply to permanents you control.'),
];
/** Alice's first main phase: she has priority, nothing is waiting. */
const main = (opts: StartOptions = {}): GameState => toStep(start({ extra: CARDS, ...opts }), 'main1', 'alice');
const put = (g: GameState, name: string, player: PlayerId = 'alice') => g.objects[give(g, player, name, 'battlefield')]!;
/** Which rule the state breaks ("704.5f"), or null. */
const broken = (g: GameState, before?: GameState): string | null => checkRules(g, before)?.match(/^CR ([0-9a-z.]+):/)?.[1] ?? null;

/** For each rule, a state that breaks it. */
const BREAKS: Record<string, () => { g: GameState; before?: GameState }> = {
  '704.5a': () => {
    const g = main();
    g.players.bob!.life = 0;
    return { g };
  },
  '704.5c': () => {
    const g = main();
    g.players.bob!.poison = 10;
    return { g };
  },
  '704.6c': () => {
    const g = main({ format: 'commander' });
    g.commanderDamage.bob = { 'some commander': 21 };
    return { g };
  },
  '704.5d': () => {
    const g = main();
    g.objects[give(g, 'alice', 'Grizzly Bears', 'graveyard')]!.token = true;
    return { g };
  },
  '704.5f': () => {
    const g = main();
    put(g, 'Grizzly Bears').counters['-1/-1'] = 2;
    return { g };
  },
  '704.5g': () => {
    const g = main();
    put(g, 'Grizzly Bears').damage = 2;
    return { g };
  },
  '704.5i': () => {
    const g = main();
    put(g, 'Walker').counters.loyalty = 0;
    return { g };
  },
  '704.5j': () => {
    const g = main();
    put(g, 'Old King');
    put(g, 'Old King');
    return { g };
  },
  '704.5m': () => {
    const g = main();
    put(g, 'Stone Ward');
    return { g };
  },
  '704.5n': () => {
    const g = main();
    const forest = put(g, 'Forest');
    put(g, 'Blade').attachedTo = { id: forest.id, zcc: forest.zcc };
    return { g };
  },
  '704.5q': () => {
    const g = main();
    const bear = put(g, 'Grizzly Bears');
    bear.counters['+1/+1'] = 2;
    bear.counters['-1/-1'] = 1;
    return { g };
  },
  '107.1': () => {
    const g = main();
    put(g, 'Forest').counters.charge = -1;
    return { g };
  },
  '603.3': () => {
    const g = main();
    const forest = put(g, 'Forest');
    g.triggers.push({ id: 't1', controller: 'alice', source: { id: forest.id, zcc: forest.zcc }, sourceName: 'Forest' } as GameState['triggers'][number]);
    return { g };
  },
  '514.2': () => {
    const before = main();
    const g = structuredClone(before);
    g.turn += 1;
    put(g, 'Grizzly Bears').damage = 1;
    return { g, before };
  },
  '511.3': () => {
    const g = main();
    const bear = put(g, 'Grizzly Bears');
    g.combat = { attackers: { [bear.id]: { zcc: bear.zcc, target: { kind: 'player', player: 'bob' }, blocked: false, blockers: [] } }, blockers: {}, attackersDeclared: true, toDeclareBlockers: [], firstStrikers: null, damageStep: null };
    return { g };
  },
  '800.4a': () => {
    const g = main({ players: 3 });
    put(g, 'Forest', 'carol');
    g.players.carol!.lost = true;
    return { g };
  },
  '104.2a': () => {
    const g = main();
    g.players.bob!.lost = true;
    return { g };
  },
};

describe('each rule check', () => {
  it('has a state here that breaks it', () => {
    expect(RULE_CHECKS.map((c) => c.rule).filter((rule) => !BREAKS[rule])).toEqual([]);
    expect(Object.keys(BREAKS).filter((rule) => !RULE_CHECKS.some((c) => c.rule === rule))).toEqual([]);
  });

  for (const check of RULE_CHECKS) {
    it(`CR ${check.rule}: names the rule when a state breaks it — ${check.says}`, () => {
      const make = BREAKS[check.rule];
      if (!make) return;
      const { g, before } = make();
      expect(checkRules(g, before)).toMatch(new RegExp(`^CR ${check.rule.replace(/\./g, '\\.')}: `));
      // The engine, given the same state and a pass, puts it right: state-based actions (or the end of the game).
      if (['603.3', '514.2', '511.3', '800.4a', '104.2a', '704.5d', '107.1', '704.6c'].includes(check.rule)) return;
      const after = act(g, { type: 'pass', player: g.priority! });
      expect(broken(after)).toBeNull();
    });
  }
});

describe('what a rule check leaves alone', () => {
  it('an ordinary game: nothing is broken, turn after turn', () => {
    let g = main();
    put(g, 'Grizzly Bears');
    put(g, 'Grizzly Bears', 'bob');
    for (let i = 0; i < 60 && !g.over; i++) {
      const before = g;
      g = toStep(act(g, { type: 'pass', player: g.priority! }), g.step === 'main1' ? 'main2' : 'main1');
      expect(checkRules(g, before)).toBeNull();
    }
    expect(g.turn).toBeGreaterThan(20);
  });

  it('a state the rules promise nothing about yet: a choice is waiting, or the game is over', () => {
    const g = main();
    g.players.bob!.life = 0;
    expect(broken({ ...g, over: true })).toBeNull();
    expect(broken({ ...g, priority: null })).toBeNull();
  });

  it('CR 704.5a: "You don\'t lose the game for having 0 or less life", and "You can\'t lose the game"', () => {
    const g = main();
    g.players.alice!.life = -3;
    expect(broken(g)).toBe('704.5a');
    const unlife = put(g, 'Unlife');
    expect(broken(g)).toBeNull();
    // Poison is another matter (CR 704.5c) — until she can't lose at all.
    g.players.alice!.poison = 10;
    expect(broken(g)).toBe('704.5c');
    put(g, 'Angel');
    expect(broken(g)).toBeNull();
    unlife.zone = 'graveyard';
    g.zones.battlefield = g.zones.battlefield.filter((id) => id !== unlife.id);
    g.zones.graveyard.alice!.push(unlife.id);
    expect(broken(g)).toBeNull();
  });

  it('CR 704.5g: an indestructible creature keeps its damage', () => {
    const g = main();
    put(g, 'Statue').damage = 5;
    expect(broken(g)).toBeNull();
  });

  it('CR 704.5j: the legend rule where it doesn\'t apply; the same name under two players', () => {
    const g = main();
    put(g, 'Old King');
    put(g, 'Old King', 'bob');
    expect(broken(g)).toBeNull();
    put(g, 'Old King');
    expect(broken(g)).toBe('704.5j');
    put(g, 'Mirror Hall');
    expect(broken(g)).toBeNull();
  });

  it('CR 704.5m: attached to what it can enchant — a creature, a card in a graveyard, a player', () => {
    const g = main();
    const bear = put(g, 'Grizzly Bears');
    const ward = put(g, 'Stone Ward');
    ward.attachedTo = { id: bear.id, zcc: bear.zcc };
    expect(broken(g)).toBeNull();
    // The creature it was on is gone (a new object now, CR 400.7); a land is nothing it can enchant.
    ward.attachedTo = { id: bear.id, zcc: bear.zcc + 1 };
    expect(checkRules(g)).toMatch(/704\.5m.*attached to nothing/);
    const forest = put(g, 'Forest');
    ward.attachedTo = { id: forest.id, zcc: forest.zcc };
    expect(checkRules(g)).toMatch(/704\.5m.*which it can't enchant/);
    ward.attachedTo = { id: bear.id, zcc: bear.zcc };

    // Animate Dead's kind: a creature card in a graveyard is what it enchants.
    const dead = g.objects[give(g, 'bob', 'Grizzly Bears', 'graveyard')]!;
    const grave = put(g, 'Grave Ward');
    grave.attachedTo = { id: dead.id, zcc: dead.zcc };
    expect(broken(g)).toBeNull();
    grave.attachedTo = { id: bear.id, zcc: bear.zcc };
    expect(broken(g)).toBe('704.5m');
    grave.attachedTo = { id: dead.id, zcc: dead.zcc };

    const hex = put(g, 'Hex');
    expect(broken(g)).toBe('704.5m');
    hex.attachedToPlayer = 'bob';
    expect(broken(g)).toBeNull();
  });

  it('CR 704.5m: an Aura whose "enchant" the grammar couldn\'t read is attached by hand, and left alone', () => {
    const g = main();
    put(g, 'Zone Ward');
    expect(broken(g)).toBeNull();
  });

  it('CR 704.5n: Equipment unattached, or on a creature', () => {
    const g = main();
    const blade = put(g, 'Blade');
    expect(broken(g)).toBeNull();
    const bear = put(g, 'Grizzly Bears');
    blade.attachedTo = { id: bear.id, zcc: bear.zcc };
    expect(broken(g)).toBeNull();
  });

  it('CR 514.2: damage dealt this turn stays until the turn ends', () => {
    const before = main();
    const g = structuredClone(before);
    put(g, 'Grizzly Bears').damage = 1;
    expect(broken(g, before)).toBeNull();
  });

  it('CR 704.6c: 21 damage from a commander counts in a Commander game only', () => {
    const g = main();
    g.commanderDamage.bob = { 'some commander': 21 };
    expect(broken(g)).toBeNull();
  });
});
