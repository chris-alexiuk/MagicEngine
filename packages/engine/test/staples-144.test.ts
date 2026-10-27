import { describe, expect, it } from 'vitest';
import { hasType, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Tower', type_line: 'Land — Urza’s Tower', mana_cost: '', oracle_text: "{T}: Add {C}. If you control an Urza's Mine and an Urza's Power-Plant, add {C}{C}{C} instead." }),
  makeCard({ name: 'Mine', type_line: 'Land — Urza’s Mine', mana_cost: '', oracle_text: '{T}: Add {C}.' }),
  makeCard({ name: 'Plant', type_line: 'Land — Urza’s Power-Plant', mana_cost: '', oracle_text: '{T}: Add {C}.' }),
  makeCard({ name: 'Rite of Flame', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Add {R}{R}, then add {R} for each card named Rite of Flame in each graveyard.' }),
  makeCard({ name: 'Restoration', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw cards equal to the number of cards in your hand plus one. You have no maximum hand size for the rest of the game.' }),
  makeCard({ name: 'Castle', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {G}.\n{T}: Add six {G}. Spend this mana only to cast creature spells or activate abilities of creatures.' }),
  makeCard({ name: 'Magistrate', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: "Your opponents can't cast spells from anywhere other than their hands." }),
  makeCard({ name: 'Orchard', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {G}.\nWhenever you tap this land for mana, target opponent creates a 1/1 colorless Spirit creature token.' }),
  makeCard({ name: 'Ping', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'You gain 1 life.\nFlashback {0}' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 30 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}

describe('staples (slice 144)', () => {
  it("Urza's Tower: {C}{C}{C} with a Mine and a Power-Plant", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const tower = give(g, 'alice', 'Tower', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: tower, ability: 0 });
    expect(g.players.alice!.pool.C).toBe(1);
    give(g, 'alice', 'Mine', 'battlefield');
    give(g, 'alice', 'Plant', 'battlefield');
    g.objects[tower]!.tapped = false;
    g = act(g, { type: 'activate_mana', player: 'alice', object: tower, ability: 0 });
    expect(g.players.alice!.pool.C).toBe(4);
  });

  it('Rite of Flame and Sea Gate Restoration', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'bob', 'Rite of Flame', 'graveyard');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Rite of Flame', 'hand') }));
    expect(g.players.alice!.pool.R).toBe(3);
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Restoration', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(hand * 2 + 1);
    expect(g.playerEffects?.some((e) => e.player === 'alice' && e.rule === 'no_max_hand_size')).toBe(true);
  });

  it('Castle Garenbrig: six restricted {G}', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const castle = give(g, 'alice', 'Castle', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: castle, ability: 1 });
    expect(g.players.alice!.restricted?.reduce((n, r) => n + r.amount, 0)).toBe(6);
  });

  it('Drannith Magistrate: not from graveyards', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Magistrate', 'battlefield');
    const ping = give(g, 'bob', 'Ping', 'graveyard');
    expect(legalActions(g, 'bob').some((a) => a.type === 'cast' && a.object === ping)).toBe(false);
    expect(illegal(g, { type: 'cast', player: 'bob', object: ping })).toBeTruthy();
  });

  it('Forbidden Orchard: an ordinary trigger when it is tapped for mana', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const orchard = give(g, 'alice', 'Orchard', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: orchard, ability: 0 });
    g = settle(g);
    expect(g.zones.battlefield.some((id) => g.objects[id]!.controller === 'bob' && g.objects[id]!.token)).toBe(true);
  });
});

describe('from the top of your library (slice 145)', () => {
  const MORE = [
    makeCard({ name: 'Augur', type_line: 'Creature — Elf', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: 'You may play lands from the top of your library.' }),
    makeCard({ name: 'Eladamri', type_line: 'Creature — Elf', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'You may cast creature spells from the top of your library.' }),
    makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  ];
  it('plays a land and casts a creature from the top', () => {
    let g = toStep(start({ extra: [...CARDS, ...MORE] }), 'main1', 'alice');
    const lib = g.zones.library.alice!;
    const top = lib.find((id) => g.objects[id]!.card === 'Forest')!;
    lib.splice(lib.indexOf(top), 1);
    lib.unshift(top);
    expect(legalActions(g, 'alice').some((a) => a.type === 'play_land' && a.object === top)).toBe(false);
    give(g, 'alice', 'Augur', 'battlefield');
    expect(legalActions(g, 'alice').some((a) => a.type === 'play_land' && a.object === top)).toBe(true);
    g = act(g, { type: 'play_land', player: 'alice', object: top });
    expect(g.objects[top]!.zone).toBe('battlefield');
    give(g, 'alice', 'Eladamri', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'library');
    // give() puts it on the bottom; move it to the top.
    const l = g.zones.library.alice!;
    l.splice(l.indexOf(bear), 1);
    l.unshift(bear);
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
  });
});

describe('Sylvan Library (slice 146)', () => {
  it('draw two more, then pay 4 life or put back each of two cards drawn this turn', () => {
    const LIB = [makeCard({ name: 'Library', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'At the beginning of your draw step, you may draw two additional cards. If you do, choose two cards in your hand drawn this turn. For each of those cards, pay 4 life or put the card on top of your library.' })];
    let g = toStep(start({ extra: [...CARDS, ...LIB] }), 'main1', 'alice');
    give(g, 'alice', 'Library', 'battlefield');
    g = toStep(g, 'draw', 'alice');
    for (let i = 0; i < 10 && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.pending).toMatchObject({ kind: 'may', player: 'alice' });
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    expect(g.pending).toMatchObject({ kind: 'choose_objects', min: 2, max: 2 });
    const cands = (g.pending as { candidates: string[] }).candidates;
    expect(cands).toHaveLength(3);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: cands.slice(0, 2) } });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: 'Pay 4 life' } });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: 'Put it on top of your library' } });
    expect(g.players.alice!.life).toBe(16);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
    expect(g.zones.library.alice![0]).toBe(cands[1]);
  });
});

describe('the Enduring cycle (slice 147)', () => {
  it('returns as an enchantment that isn\'t a creature', () => {
    const MORE = [
      makeCard({ name: 'Enduring', type_line: 'Enchantment Creature — Elk Glimmer', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: "When Enduring dies, if it was a creature, return it to the battlefield under its owner's control. It's an enchantment. (It's not a creature.)" }),
      makeCard({ name: 'Doom', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature.' }),
    ];
    let g = toStep(start({ extra: [...CARDS, ...MORE] }), 'main1', 'alice');
    const elk = give(g, 'alice', 'Enduring', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Doom', 'hand'), targets: [[{ kind: 'object', object: elk }]] }));
    expect(g.objects[elk]!.zone).toBe('battlefield');
    expect(hasType(g, g.objects[elk]!, 'Creature')).toBe(false);
    expect(hasType(g, g.objects[elk]!, 'Enchantment')).toBe(true);
  });
});
