import { describe, expect, it } from 'vitest';
import { legalActions, viewFor, type GameState } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{U}', ...extra });

const CARDS = [
  card('Impulse Two', 'Sorcery', 'Look at the top four cards of your library. Put two of them into your hand and the rest on the bottom of your library in any order.'),
  card('Grave Dig', 'Sorcery', 'Look at the top three cards of your library. Put one of them into your hand and the rest into your graveyard.'),
  card('Seeker', 'Creature — Elf', 'When this creature enters, look at the top five cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.', { power: '1', toughness: '1' }),
  card('Spike Feeder', 'Creature — Spike', 'This creature enters with two +1/+1 counters on it.\n{2}, Remove a +1/+1 counter from this creature: You gain 2 life.', { power: '0', toughness: '0' }),
  card('Blood Price', 'Sorcery', 'As an additional cost to cast this spell, pay 3 life.\nDraw two cards.', { mana_cost: '{B}' }),
  card('Arrest', 'Enchantment — Aura', "Enchant creature\nEnchanted creature can't attack or block, and its activated abilities can't be activated.", { mana_cost: '{W}' }),
  card('Elf Pinger', 'Creature — Elf', '{T}: You gain 1 life.', { power: '1', toughness: '1' }),
  card('Party Spell', 'Sorcery', 'This spell costs {1} less to cast for each creature in your party.\nDraw a card.', { mana_cost: '{4}{U}' }),
  card('Cleric', 'Creature — Human Cleric', '', { power: '1', toughness: '1' }),
  card('Rogue Wizard', 'Creature — Human Rogue Wizard', '', { power: '1', toughness: '1' }),
  card('Rogue', 'Creature — Human Rogue', '', { power: '1', toughness: '1' }),
];

function setup(): GameState {
  const g = toStep(start({ extra: CARDS, decks: { alice: [...Array.from({ length: 20 }, () => 'Island'), ...Array.from({ length: 20 }, () => 'Grizzly Bears')], bob: Array.from({ length: 40 }, () => 'Forest') } }), 'main1');
  // Custom decks: the extra cards still need to be known to give() them.
  for (const c of CARDS) g.cards[c.name] = c;
  return g;
}
const cast = (g: GameState, name: string, extra: Record<string, unknown> = {}) => {
  g.players.alice!.pool.U += 1;
  g.players.alice!.pool.B += 1;
  g.players.alice!.pool.W += 1;
  return passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), ...extra }));
};

describe('looking at the top of the library', () => {
  it('“Put two of them into your hand and the rest on the bottom in any order”', () => {
    let g = cast(setup(), 'Impulse Two');
    const top = g.zones.library.alice!.slice(0, 4);
    expect(g.pending).toMatchObject({ kind: 'choose_objects', min: 2, max: 2 });
    // The chooser sees the four cards; the opponent doesn't.
    expect(viewFor(g, 'alice').objects[top[3]!]).toBeDefined();
    expect(viewFor(g, 'bob').objects[top[3]!]).toBeUndefined();
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [top[0]!, top[2]!] } });
    expect(g.pending).toMatchObject({ kind: 'choose_objects', ordered: true, candidates: [top[1], top[3]] });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [top[3]!, top[1]!] } });
    expect(g.objects[top[0]!]!.zone).toBe('hand');
    expect(g.objects[top[2]!]!.zone).toBe('hand');
    expect(g.zones.library.alice!.slice(-2)).toEqual([top[3], top[1]]);
  });

  it('“… and the rest into your graveyard”', () => {
    let g = cast(setup(), 'Grave Dig');
    const top = g.zones.library.alice!.slice(0, 3);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [top[1]!] } });
    expect(top.map((id) => g.objects[id]!.zone)).toEqual(['graveyard', 'hand', 'graveyard']);
  });

  it('“You may reveal a creature card from among them”: only creature cards, or none', () => {
    let g = cast(setup(), 'Seeker');
    g = passRound(g);
    const top = g.zones.library.alice!.slice(0, 5);
    expect(g.pending).toMatchObject({ kind: 'choose_objects', min: 0, max: 1 });
    if (g.pending?.kind !== 'choose_objects') return;
    const creatures = g.pending.candidates;
    expect(creatures.every((id) => g.objects[id]!.card === 'Grizzly Bears')).toBe(true);
    const land = top.find((id) => g.objects[id]!.card === 'Island');
    if (land) expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [land] } })).toBeTruthy();
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [] } });
    expect(top.every((id) => g.objects[id]!.zone === 'library')).toBe(true);
    expect(g.zones.library.alice!.slice(-5).sort()).toEqual([...top].sort());
  });
});

describe('costs and restrictions', () => {
  it('“Remove a +1/+1 counter from ~” as a cost (CR 118.3)', () => {
    let g = cast(setup(), 'Spike Feeder');
    const spike = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Spike Feeder')!;
    for (let i = 0; i < 2; i++) {
      g.players.alice!.pool.C = 2;
      g = passRound(act(g, { type: 'activate', player: 'alice', object: spike, ability: 0 }));
    }
    expect(g.players.alice!.life).toBe(24);
    expect(g.objects[spike]!.zone).toBe('graveyard');
  });

  it('“As an additional cost to cast this spell, pay 3 life”', () => {
    const g = cast(setup(), 'Blood Price');
    expect(g.players.alice!.life).toBe(17);
  });

  it('Arrest: its activated abilities can’t be activated (CR 602.5)', () => {
    let g = setup();
    const elf = give(g, 'alice', 'Elf Pinger', 'battlefield');
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === elf)).toBe(true);
    g = cast(g, 'Arrest', { targets: [[{ kind: 'object', object: elf }]] });
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === elf)).toBe(false);
    expect(illegal(g, { type: 'activate', player: 'alice', object: elf, ability: 0 })).toBeTruthy();
  });

  it('CR 700.8: the party counts one each of Cleric, Rogue, Warrior and Wizard', () => {
    let g = setup();
    give(g, 'alice', 'Cleric', 'battlefield');
    give(g, 'alice', 'Rogue Wizard', 'battlefield');
    give(g, 'alice', 'Rogue', 'battlefield');
    // Cleric + Rogue + Wizard (the Rogue Wizard as the Wizard): three, so {4}{U} costs {1}{U}.
    g.players.alice!.pool.U = 1;
    g.players.alice!.pool.C = 1;
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Party Spell', 'hand') }));
    expect(g.players.alice!.pool.C).toBe(0);
  });
});
