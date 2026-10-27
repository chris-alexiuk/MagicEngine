import { describe, expect, it } from 'vitest';
import { chars, hasKeyword, manaAbilities } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Aid', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever an Equipment you control enters, you may attach it to target creature you control.' }),
  makeCard({ name: 'Hammer', type_line: 'Legendary Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Whenever Hammer or another Equipment you control enters, you may attach that Equipment to target creature you control.\nEquipped creature gets +2/+0.\nEquip {4}' }),
  makeCard({ name: 'Blade', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equipped creature gets +1/+0.\nEquip {3}' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Archivist', type_line: 'Creature — Human Cleric', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Whenever an opponent searches their library, you gain 1 life and draw a card.' }),
  makeCard({ name: 'Tutor', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Search your library for a card, put that card into your hand, then shuffle.' }),
  makeCard({ name: 'Mimic', type_line: 'Artifact Creature — Shapeshifter', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: 'As this creature enters, choose a creature type.\nEach other creature you control of the chosen type enters with an additional +1/+1 counter on it.' }),
  makeCard({ name: 'Elf', type_line: 'Creature — Elf', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Rite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Kicker {5}\nCreate a token that's a copy of target creature. If this spell was kicked, create five of those tokens instead." }),
  makeCard({ name: 'Tide', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Until end of turn, whenever a player taps an Island for mana, that player adds an additional {U}.' }),
  makeCard({ name: 'Monument', type_line: 'Legendary Artifact', mana_cost: '{0}', oracle_text: 'Whenever you tap a permanent for {C}, add an additional {C}.' }),
  makeCard({ name: 'Wastes Card', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {C}.' }),
  makeCard({ name: 'Mutation', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature\nEnchanted creature is an Insect artifact creature with base power and toughness 0/1 and has indestructible, and it loses all other abilities, card types, and creature types.' }),
  makeCard({ name: 'Moon Prison', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature, land, or planeswalker\nEnchanted permanent is a colorless land with "{T}: Add {C}" and loses all other card types and abilities.' }),
  makeCard({ name: 'Flyer', type_line: 'Creature — Bird', mana_cost: '{U}', cmc: 1, colors: ['U'], color_identity: ['U'], power: '3', toughness: '3', oracle_text: 'Flying' }),
  makeCard({ name: 'Spirit Guard', type_line: 'Creature — Spirit', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Bolster Spirit', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Untap target creature. If it's a Spirit, put a +1/+1 counter on it." }),
  makeCard({ name: 'Dual', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {C}.\n{T}: Add {G}.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const yes = (g: GameState) => (g.pending?.kind === 'may' ? act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'may', yes: true } }) : g);
const tokens = (g: GameState, p: string) => g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === p);

describe('staples (slice 155)', () => {
  it("Sigarda's Aid and Hammer of Nazahn attach an entering Equipment", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Aid', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const blade = give(g, 'alice', 'Blade', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: blade }));
    if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: bear }]] } });
    g = settle(yes(settle(g)));
    expect(g.objects[blade]!.attachedTo?.id).toBe(bear);
  });

  it('Hammer of Nazahn attaches itself', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const hammer = give(g, 'alice', 'Hammer', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: hammer }));
    if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: bear }]] } });
    g = settle(yes(settle(g)));
    expect(g.objects[hammer]!.attachedTo?.id).toBe(bear);
  });

  it('Archivist of Oghma: an opponent searching their library', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Archivist', 'battlefield');
    const life = g.players.alice!.life;
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Tutor', 'hand') }));
    expect(g.pending?.kind).toBe('search');
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'search', objects: [g.zones.library.bob![0]!] } }));
    g = settle(g);
    expect(g.players.alice!.life).toBe(life + 1);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
    // Its controller's own searches don't count.
    g = toStep(g, 'main1', 'alice');
    const life2 = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Tutor', 'hand') }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [g.zones.library.alice![0]!] } }));
    expect(g.players.alice!.life).toBe(life2);
  });

  it('Metallic Mimic: others of the chosen type enter with a +1/+1 counter', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mimic = give(g, 'alice', 'Mimic', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: mimic }));
    if (g.pending?.kind === 'as_enters') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', choice: 'Elf' } }));
    expect(g.objects[mimic]!.counters['+1/+1'] ?? 0).toBe(0);
    const elf = give(g, 'alice', 'Elf', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: elf }));
    expect(g.objects[elf]!.counters['+1/+1']).toBe(1);
    const bear = give(g, 'alice', 'Bear', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear }));
    expect(g.objects[bear]!.counters['+1/+1'] ?? 0).toBe(0);
  });

  it('Rite of Replication: five copies when kicked', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g.players.alice!.pool.C = 5;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Rite', 'hand'), kicked: true, targets: [[{ kind: 'object', object: bear }]] }));
    expect(tokens(g, 'alice')).toHaveLength(5);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Rite', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect(tokens(g, 'alice')).toHaveLength(6);
  });

  it('High Tide: Islands make an extra {U} this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const island = give(g, 'alice', 'Island', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Tide', 'hand') }));
    g = act(g, { type: 'activate_mana', player: 'alice', object: island, ability: 0 });
    expect(g.players.alice!.pool.U).toBe(2);
    // Next turn it's over.
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    g = act(g, { type: 'activate_mana', player: 'alice', object: island, ability: 0 });
    expect(g.players.alice!.pool.U).toBe(1);
  });

  it('Forsaken Monument: tapping for {C} adds an additional {C}', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Monument', 'battlefield');
    const dual = give(g, 'alice', 'Dual', 'battlefield');
    const wastes = give(g, 'alice', 'Wastes Card', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: wastes, ability: 0 });
    expect(g.players.alice!.pool.C).toBe(2);
    g = act(g, { type: 'activate_mana', player: 'alice', object: dual, ability: 1 });
    expect(g.players.alice!.pool).toMatchObject({ C: 2, G: 1 });
  });

  it('Darksteel Mutation and Imprisoned in the Moon set types and remove abilities', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const flyer = give(g, 'bob', 'Flyer', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mutation', 'hand'), targets: [[{ kind: 'object', object: flyer }]] }));
    let c = chars(g, g.objects[flyer]!);
    expect(c.types.sort()).toEqual(['Artifact', 'Creature']);
    expect(c.subtypes).toEqual(['Insect']);
    expect([c.power, c.toughness]).toEqual([0, 1]);
    expect(hasKeyword(g, g.objects[flyer]!, 'flying')).toBe(false);
    expect(hasKeyword(g, g.objects[flyer]!, 'indestructible')).toBe(true);
    const other = give(g, 'bob', 'Flyer', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Moon Prison', 'hand'), targets: [[{ kind: 'object', object: other }]] }));
    c = chars(g, g.objects[other]!);
    expect(c.types).toEqual(['Land']);
    expect(c.colors).toEqual([]);
    expect(hasKeyword(g, g.objects[other]!, 'flying')).toBe(false);
    expect(manaAbilities(g, g.objects[other]!)).toHaveLength(1);
  });

  it('"If it\'s a Spirit, …" asks about the target as it is now', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const spirit = give(g, 'alice', 'Spirit Guard', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolster Spirit', 'hand'), targets: [[{ kind: 'object', object: spirit }]] }));
    expect(g.objects[spirit]!.counters['+1/+1']).toBe(1);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolster Spirit', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[bear]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});
