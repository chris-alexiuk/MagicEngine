import { describe, expect, it } from 'vitest';
import { chars, legalActions, manaAbilities } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Map', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Whenever a land an opponent controls enters, if that player controls more lands than you, you may put a land card from your hand onto the battlefield.' }),
  makeCard({ name: 'Apprentice', type_line: 'Creature — Human Artificer', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: 'Lieutenant — At the beginning of combat on your turn, if you control your commander, create a 1/1 colorless Thopter artifact creature token with flying. That token gains haste until end of turn.' }),
  makeCard({ name: 'Ashaya', type_line: 'Legendary Creature — Avatar', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Nontoken creatures you control are Forest lands in addition to their other types.' }),
  makeCard({ name: 'Boromir', type_line: 'Legendary Creature — Human Soldier', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Whenever an opponent casts a spell, if no mana was spent to cast it, counter that spell.' }),
  makeCard({ name: 'Elixir', type_line: 'Legendary Artifact', mana_cost: '{0}', oracle_text: 'You may activate abilities of creatures you control as though those creatures had haste.' }),
  makeCard({ name: 'Tapper', type_line: 'Creature — Human', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{T}: You gain 1 life.' }),
  makeCard({ name: 'Vesuva', type_line: 'Land', mana_cost: '', oracle_text: 'You may have this land enter tapped as a copy of any land on the battlefield.' }),
  makeCard({ name: 'Floodcaller', type_line: 'Creature — Otter Wizard', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever you cast a noncreature spell, Birds, Frogs, Otters, and Rats you control get +1/+1 until end of turn. Untap them.' }),
  makeCard({ name: 'Frog', type_line: 'Creature — Frog', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Opt', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Draw a card.' }),
  makeCard({ name: 'Paid Opt', type_line: 'Instant', mana_cost: '{U}', cmc: 1, colors: ['U'], color_identity: ['U'], oracle_text: 'Draw a card.' }),
  makeCard({ name: 'Rampage', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Destroy all artifacts and enchantments. For each permanent destroyed this way, its controller creates a 3/3 green Centaur creature token.' }),
  makeCard({ name: 'Rock', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '' }),
  makeCard({ name: 'Spark Double', type_line: 'Creature — Illusion', mana_cost: '{0}', power: '0', toughness: '0', oracle_text: "You may have this creature enter as a copy of a creature or planeswalker you control, except it enters with an additional +1/+1 counter on it if it's a creature, it enters with an additional loyalty counter on it if it's a planeswalker, and it isn't legendary." }),
  makeCard({ name: 'Walker', type_line: 'Legendary Planeswalker — Test', mana_cost: '{0}', loyalty: '3', oracle_text: '+1: You gain 1 life.' }),
  makeCard({ name: 'Hero', type_line: 'Legendary Creature — Human', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: '' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const yes = (g: GameState) => (g.pending?.kind === 'may' ? act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'may', yes: true } }) : g);
const tokens = (g: GameState, p: string) => g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === p);

describe('staples (slice 156)', () => {
  it("Archaeomancer's Map: a land when an opponent with more lands plays one", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Map', 'battlefield');
    give(g, 'bob', 'Forest', 'battlefield');
    const mine = give(g, 'alice', 'Forest', 'hand');
    g = act(g, { type: 'play_land', player: 'bob', object: give(g, 'bob', 'Forest', 'hand') });
    g = settle(yes(settle(g)));
    if (g.pending?.kind === 'choose_objects') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [mine] } }));
    expect(g.objects[mine]!.zone).toBe('battlefield');
  });

  it('Boromir counters spells cast without mana', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Boromir', 'battlefield');
    const free = give(g, 'bob', 'Opt', 'hand');
    g = settle(act(g, { type: 'cast', player: 'bob', object: free }));
    expect(g.objects[free]!.zone).toBe('graveyard');
    const hand = g.zones.hand.bob!.length;
    g.players.bob!.pool.U = 1;
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Paid Opt', 'hand') }));
    expect(g.zones.hand.bob!.length).toBe(hand + 1);
  });

  it('Thousand-Year Elixir: {T} abilities of new creatures', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const tapper = give(g, 'alice', 'Tapper', 'battlefield', { sick: true });
    expect(illegal(g, { type: 'activate', player: 'alice', object: tapper, ability: 0 })).toMatch(/under your control/);
    give(g, 'alice', 'Elixir', 'battlefield');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'activate', player: 'alice', object: tapper, ability: 0 }));
    expect(g.players.alice!.life).toBe(life + 1);
  });

  it('Ashaya: creatures are Forest lands and tap for {G}', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Ashaya', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const c = chars(g, g.objects[bear]!);
    expect(c.types).toContain('Land');
    expect(c.subtypes).toContain('Forest');
    expect(manaAbilities(g, g.objects[bear]!)).toHaveLength(1);
  });

  it('Vesuva enters tapped as a copy, untapped otherwise', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const forest = give(g, 'bob', 'Forest', 'battlefield');
    const vesuva = give(g, 'alice', 'Vesuva', 'hand');
    g = act(g, { type: 'play_land', player: 'alice', object: vesuva });
    expect(g.pending?.kind).toBe('as_enters');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', copy: forest } });
    expect(g.objects[vesuva]!.tapped).toBe(true);
    expect(chars(g, g.objects[vesuva]!).subtypes).toContain('Forest');
    g = toStep(g, 'main1', 'bob');
    const second = give(g, 'bob', 'Vesuva', 'hand');
    g = act(g, { type: 'play_land', player: 'bob', object: second });
    if (g.pending?.kind === 'as_enters') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'as_enters', copy: null } });
    expect(g.objects[second]!.tapped).toBe(false);
  });

  it('Valley Floodcaller pumps and untaps several types', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const otter = give(g, 'alice', 'Floodcaller', 'battlefield');
    const frog = give(g, 'alice', 'Frog', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g.objects[frog]!.tapped = true;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Opt', 'hand') }));
    expect(chars(g, g.objects[frog]!).power).toBe(2);
    expect(chars(g, g.objects[otter]!).power).toBe(3);
    expect(chars(g, g.objects[bear]!).power).toBe(2);
    expect(g.objects[frog]!.tapped).toBe(false);
  });

  it('Rampage of the Clans: a Centaur for each permanent destroyed, for its controller', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'bob', 'Rock', 'battlefield');
    give(g, 'bob', 'Rock', 'battlefield');
    give(g, 'alice', 'Rock', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Rampage', 'hand') }));
    expect(tokens(g, 'bob')).toHaveLength(2);
    expect(tokens(g, 'alice')).toHaveLength(1);
  });

  it('Spark Double: a nonlegendary copy with an extra counter; of a planeswalker, with its loyalty', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const hero = give(g, 'alice', 'Hero', 'battlefield');
    const double = give(g, 'alice', 'Spark Double', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: double });
    g = settle(g);
    expect(g.pending?.kind).toBe('as_enters');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', copy: hero } }));
    expect(g.objects[double]!.zone).toBe('battlefield');
    expect(g.objects[double]!.counters['+1/+1']).toBe(1);
    expect(chars(g, g.objects[double]!).supertypes).not.toContain('Legendary');
    expect(g.objects[hero]!.zone).toBe('battlefield');
    const walker = give(g, 'alice', 'Walker', 'battlefield');
    g.objects[walker]!.counters.loyalty = 3;
    const second = give(g, 'alice', 'Spark Double', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: second }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', copy: walker } }));
    expect(g.objects[second]!.zone).toBe('battlefield');
    expect(g.objects[second]!.counters.loyalty).toBe(4);
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === second)).toBe(true);
  });

  it('Loyal Apprentice: a Thopter while you control your commander', () => {
    let g = start({ extra: CARDS, format: 'commander', commanders: { alice: ['Hero'] } });
    g = toStep(g, 'main1', 'alice');
    give(g, 'alice', 'Apprentice', 'battlefield');
    g = toStep(g, 'beginning_of_combat', 'alice');
    g = settle(g);
    expect(tokens(g, 'alice')).toHaveLength(0);
    const commander = g.zones.command.find((id) => g.objects[id]!.owner === 'alice')!;
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    g.players.alice!.pool.C = 3;
    g = settle(act(g, { type: 'cast', player: 'alice', object: commander }));
    g = toStep(g, 'beginning_of_combat', 'alice');
    g = settle(g);
    expect(tokens(g, 'alice')).toHaveLength(1);
  });
});
