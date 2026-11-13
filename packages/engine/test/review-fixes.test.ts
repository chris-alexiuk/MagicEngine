import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import type { ChoiceAnswer, GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

// Rules gaps found by the November 2026 grading audit (random samples of "full" cards checked against their Oracle
// text) and fixed together. The audit's own cases are in audit-a.test.ts and audit-b.test.ts; these are the edges
// around each fix.
const CARDS = [
  makeCard({
    name: 'Bonecrusher Giant // Stomp', layout: 'adventure', type_line: 'Creature — Giant // Instant — Adventure', mana_cost: '{2}{R}', cmc: 3, oracle_text: '',
    card_faces: [
      { object: 'card_face', name: 'Bonecrusher Giant', type_line: 'Creature — Giant', mana_cost: '{2}{R}', power: '4', toughness: '3', oracle_text: '' },
      { object: 'card_face', name: 'Stomp', type_line: 'Instant — Adventure', mana_cost: '{1}{R}', oracle_text: 'Stomp deals 2 damage to any target. (Then exile this card. You may cast the creature later from exile.)' },
    ],
  } as never),
  makeCard({ name: 'Cancel Lite', type_line: 'Instant', mana_cost: '{U}', cmc: 1, oracle_text: 'Counter target spell.' }),
  makeCard({ name: 'Lotus Bloom', type_line: 'Artifact', mana_cost: '', cmc: 0, oracle_text: 'Suspend 3—{0}\n{T}, Sacrifice this artifact: Add three mana of any one color.' }),
  makeCard({ name: 'Ornithopter', type_line: 'Artifact Creature — Thopter', mana_cost: '{0}', cmc: 0, power: '0', toughness: '2', oracle_text: 'Flying' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Ghost', type_line: 'Creature — Spirit', mana_cost: '{1}{U}', cmc: 2, power: '1', toughness: '1', oracle_text: 'Hexproof' }),
  makeCard({ name: 'Strength', type_line: 'Enchantment — Aura', mana_cost: '{G}', cmc: 1, oracle_text: 'Enchant creature\nEnchanted creature gets +2/+2.' }),
  makeCard({ name: 'Curse of Thirst Lite', type_line: 'Enchantment — Aura Curse', mana_cost: '{B}', cmc: 1, oracle_text: "Enchant player\nAt the beginning of enchanted player's upkeep, that player loses 1 life." }),
  makeCard({ name: 'Raise Enchantment', type_line: 'Sorcery', mana_cost: '{W}', cmc: 1, oracle_text: 'Return target enchantment card from your graveyard to the battlefield.' }),
  makeCard({ name: 'Raise Everything', type_line: 'Sorcery', mana_cost: '{W}', cmc: 1, oracle_text: 'Return all permanent cards from your graveyard to the battlefield.' }),
  makeCard({ name: 'Parallel Lives', type_line: 'Enchantment', mana_cost: '{3}{G}', cmc: 4, oracle_text: 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.' }),
  makeCard({ name: 'Peregrin Took', type_line: 'Legendary Creature — Halfling Citizen', mana_cost: '{2}{G}', cmc: 3, power: '2', toughness: '3', oracle_text: 'If one or more tokens would be created under your control, those tokens plus an additional Food token are created instead.' }),
  makeCard({ name: 'Bear Maker', type_line: 'Sorcery', mana_cost: '{G}', cmc: 1, oracle_text: 'Create a 2/2 green Bear creature token.' }),
  makeCard({ name: 'Populate Lite', type_line: 'Instant', mana_cost: '{G}', cmc: 1, oracle_text: 'Populate.' }),
  makeCard({ name: 'Incubate Lite', type_line: 'Sorcery', mana_cost: '{G}', cmc: 1, oracle_text: 'Incubate 2.' }),
  makeCard({ name: 'Amass Lite', type_line: 'Sorcery', mana_cost: '{B}', cmc: 1, oracle_text: 'Amass Orcs 2.' }),
];
const main = (who: 'alice' | 'bob' = 'alice') => toStep(start({ extra: CARDS }), 'main1', who);
const obj = (object: string) => ({ kind: 'object' as const, object });
/** Passes priority, answering choices, until the stack is empty and nothing is being asked (or a choice goes unanswered). */
function settle(g: GameState, answer?: (g: GameState) => ChoiceAnswer | undefined): GameState {
  for (let i = 0; i < 60 && (g.stack.length || g.pending); i++) {
    if (g.pending) {
      const a = answer?.(g);
      if (!a) break;
      g = act(g, { type: 'choose', player: (g.pending as { player: string }).player, answer: a });
    } else g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
}
const mine = (g: GameState, name: string, who = 'alice') => g.zones.battlefield.filter((id) => g.objects[id]!.controller === who && (g.cards[g.objects[id]!.card]?.faces[g.objects[id]!.face]?.name ?? '') === name);

describe('Adventures (CR 715.3d)', () => {
  it('a card on an adventure is cast from exile as the creature only — never as the Adventure again', () => {
    let g = main();
    const giant = give(g, 'alice', 'Bonecrusher Giant // Stomp', 'hand');
    g.players.alice!.pool.R = 8;
    g = settle(act(g, { type: 'cast', player: 'alice', object: giant, face: 1, targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.objects[giant]!.zone).toBe('exile');
    const listed = legalActions(g, 'alice').filter((a) => a.type === 'cast' && a.object === giant);
    expect(listed.map((a) => (a.type === 'cast' ? (a.face ?? 0) : -1))).toEqual([0]);
    expect(illegal(g, { type: 'cast', player: 'alice', object: giant, face: 1, targets: [[{ kind: 'player', player: 'bob' }]] })).toMatch(/can’t be cast from exile/);
    // The other player has no such permission.
    expect(legalActions(g, 'bob').some((a) => a.type === 'cast' && a.object === giant)).toBe(false);
  });

  it('a countered Adventure goes to the graveyard: it was never on an adventure', () => {
    let g = main();
    const giant = give(g, 'alice', 'Bonecrusher Giant // Stomp', 'hand');
    g.players.alice!.pool.R = 4;
    g.players.bob!.pool.U = 1;
    g = act(g, { type: 'cast', player: 'alice', object: giant, face: 1, targets: [[{ kind: 'player', player: 'bob' }]] });
    g = act(g, { type: 'pass', player: 'alice' });
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Cancel Lite', 'hand'), targets: [[obj(giant)]] }));
    expect(g.objects[giant]!.zone).toBe('graveyard');
    expect(g.players.bob!.life).toBe(20);
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === giant)).toBe(false);
  });

  it('cast as the creature, it just enters the battlefield', () => {
    let g = main();
    const giant = give(g, 'alice', 'Bonecrusher Giant // Stomp', 'hand');
    g.players.alice!.pool.R = 3;
    g = settle(act(g, { type: 'cast', player: 'alice', object: giant }));
    expect(g.objects[giant]!.zone).toBe('battlefield');
  });
});

describe('cards with no mana cost (CR 202.1b, 118.6)', () => {
  it('can’t be cast from hand, and isn’t offered; {0} is a cost like any other', () => {
    const g = main();
    const bloom = give(g, 'alice', 'Lotus Bloom', 'hand');
    const thopter = give(g, 'alice', 'Ornithopter', 'hand');
    g.players.alice!.pool.G = 3;
    expect(illegal(g, { type: 'cast', player: 'alice', object: bloom })).toMatch(/no mana cost/);
    const casts = legalActions(g, 'alice').flatMap((a) => (a.type === 'cast' ? [a.object] : []));
    expect(casts).not.toContain(bloom);
    expect(casts).toContain(thopter);
    // Suspending it is still offered.
    expect(legalActions(g, 'alice').some((a) => a.type === 'suspend' && a.object === bloom)).toBe(true);
  });
});

describe('an Aura put onto the battlefield without being cast (CR 303.4f, 303.4g)', () => {
  const raise = (g: GameState, aura: string, answer?: (g: GameState) => ChoiceAnswer | undefined) => {
    g.players.alice!.pool.W = 1;
    return settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Raise Enchantment', 'hand'), targets: [[obj(aura)]] }), answer);
  };

  it('with one thing it could enchant, it enters attached to that', () => {
    let g = main();
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const aura = give(g, 'alice', 'Strength', 'graveyard');
    g = raise(g, aura);
    expect(g.pending).toBeNull();
    expect(g.objects[aura]).toMatchObject({ zone: 'battlefield', attachedTo: { id: bear } });
  });

  it('with nothing it could enchant, it stays in the graveyard', () => {
    let g = main();
    const aura = give(g, 'alice', 'Strength', 'graveyard');
    g = raise(g, aura);
    expect(g.objects[aura]!.zone).toBe('graveyard');
  });

  it('its controller chooses among several — hexproof doesn’t matter, it isn’t targeted', () => {
    let g = main();
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const ghost = give(g, 'bob', 'Ghost', 'battlefield');
    const aura = give(g, 'alice', 'Strength', 'graveyard');
    g = raise(g, aura);
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'enchant', player: 'alice' });
    expect([...(g.pending as { candidates: string[] }).candidates].sort()).toEqual([bear, ghost].sort());
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', attach: aura } })).toMatch(/Choose what/);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', attach: ghost } }));
    expect(g.objects[aura]).toMatchObject({ zone: 'battlefield', attachedTo: { id: ghost } });
  });

  it('"enchant player": a player is chosen', () => {
    let g = main();
    const curse = give(g, 'alice', 'Curse of Thirst Lite', 'graveyard');
    g = raise(g, curse);
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'enchant', options: ['alice', 'bob'] });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', choice: 'bob' } }));
    expect(g.objects[curse]).toMatchObject({ zone: 'battlefield', attachedToPlayer: 'bob' });
  });

  it('it can’t enchant something entering at the same time', () => {
    let g = main();
    give(g, 'alice', 'Bear', 'graveyard');
    const aura = give(g, 'alice', 'Strength', 'graveyard');
    g.players.alice!.pool.W = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Raise Everything', 'hand') }));
    expect(mine(g, 'Bear')).toHaveLength(1);
    expect(g.objects[aura]!.zone).toBe('graveyard');
  });
});

describe('every way of creating tokens goes through the same replacements (CR 614.1a)', () => {
  const tokens = (g: GameState) => g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice');
  const cast = (g: GameState, name: string) => {
    g.players.alice!.pool.G = 1;
    g.players.alice!.pool.B = 1;
    return settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand') }), (s) => (s.pending?.kind === 'choose_objects' ? { kind: 'choose_objects', objects: [s.pending.candidates[0]!] } : undefined));
  };

  it('populate, incubate and amass are doubled like any other token', () => {
    let g = main();
    give(g, 'alice', 'Parallel Lives', 'battlefield');
    g = cast(g, 'Bear Maker');
    expect(tokens(g)).toHaveLength(2);
    g = cast(g, 'Populate Lite');
    expect(tokens(g)).toHaveLength(4);
    g = cast(g, 'Incubate Lite');
    expect(mine(g, 'Incubator')).toHaveLength(2);
    for (const id of mine(g, 'Incubator')) expect(g.objects[id]!.counters['+1/+1']).toBe(2);
    // Amass: two Army tokens are created, the counters go on one of them, and the other — a 0/0 — dies at once.
    const before = g.nextId;
    g = cast(g, 'Amass Lite');
    const armies = tokens(g).filter((id) => g.cards[g.objects[id]!.card]!.faces[0]!.subtypes.includes('Army'));
    expect(armies.map((id) => g.objects[id]!.counters['+1/+1'] ?? 0)).toEqual([2]);
    expect(g.nextId - before).toBeGreaterThanOrEqual(3);
  });

  it('"plus an additional Food token" applies to populate too', () => {
    let g = main();
    give(g, 'alice', 'Peregrin Took', 'battlefield');
    g = cast(g, 'Bear Maker');
    g = cast(g, 'Populate Lite');
    expect(mine(g, 'Bear Token')).toHaveLength(2);
    expect(mine(g, 'Food')).toHaveLength(2);
  });
});

describe('mulligans (CR 103.5)', () => {
  it('the cards to put on the bottom are chosen on keeping, with the whole new hand in view', () => {
    let g = start({ mulligan: true });
    expect(g.pending).toMatchObject({ kind: 'mulligan', player: 'alice' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'mulligan', keep: false } });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'mulligan', keep: true } });
    // Alice looks at seven again and decides before bottoming anything.
    expect(g.pending).toMatchObject({ kind: 'mulligan', player: 'alice' });
    expect(g.zones.hand.alice).toHaveLength(7);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'mulligan', keep: false } });
    expect(g.pending).toMatchObject({ kind: 'mulligan', player: 'alice' });
    expect(g.zones.hand.alice).toHaveLength(7);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'mulligan', keep: true } });
    expect(g.pending).toMatchObject({ kind: 'bottom_cards', player: 'alice', count: 2 });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'bottom_cards', objects: g.zones.hand.alice!.slice(0, 2) } });
    expect(g.zones.hand.alice).toHaveLength(5);
    expect(g.started).toBe(true);
  });
});
