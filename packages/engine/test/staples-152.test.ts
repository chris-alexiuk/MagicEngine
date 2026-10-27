import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Bowmasters', type_line: 'Creature — Orc Archer', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'When this creature enters and whenever an opponent draws a card except the first one they draw in each of their draw steps, this creature deals 1 damage to any target. Then amass Orcs 1.' }),
  makeCard({ name: 'Divination', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw a card.' }),
  makeCard({ name: 'Quick Draw', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Draw a card.' }),
  makeCard({ name: 'Aid', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'You may cast Aura and Equipment spells as though they had flash.' }),
  makeCard({ name: 'Blade', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equipped creature gets +1/+0.\nEquip {1}' }),
  makeCard({ name: 'Rock', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '' }),
  makeCard({ name: 'Gates', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {C}.\n{4}: Put this card from your hand onto the battlefield.' }),
  makeCard({ name: 'Mox', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Imprint — When this artifact enters, you may exile a nonartifact, nonland card from your hand.\n{T}: Add one mana of any of the exiled card\'s colors.' }),
  makeCard({ name: 'Red Spell', type_line: 'Instant', mana_cost: '{R}', colors: ['R'], color_identity: ['R'], oracle_text: 'Draw a card.' }),
  makeCard({ name: 'Plaza', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {C}.\n{3}, {T}, Exile this land: Target legendary creature gains hexproof and indestructible until end of turn.' }),
  makeCard({ name: 'Legend', type_line: 'Legendary Creature — Human', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Awakening', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Put any number of cards from your hand on the bottom of your library, then draw that many cards plus one.' }),
  makeCard({ name: 'Oracle', type_line: 'Creature — Merfolk Wizard', mana_cost: '{U}{U}', cmc: 2, colors: ['U'], color_identity: ['U'], power: '1', toughness: '3', oracle_text: 'When this creature enters, look at the top X cards of your library, where X is your devotion to blue. Put up to one of them on top of your library and the rest on the bottom of your library in a random order. If X is greater than or equal to the number of cards in your library, you win the game.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 30 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const anyTarget = (g: GameState, player: string) => {
  if (g.pending?.kind === 'trigger_targets') return act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player }]] } });
  return g;
};

describe('staples (slice 152)', () => {
  it('Orcish Bowmasters: on entering, and on extra draws only', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const life = g.players.bob!.life;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bowmasters', 'hand') });
    g = settle(g);
    g = settle(anyTarget(g, 'bob'));
    expect(g.players.bob!.life).toBe(life - 1);
    // Bob draws in his draw step: no trigger; an extra draw: a trigger.
    g = settle(toStep(g, 'draw', 'bob'));
    expect(g.pending?.kind).not.toBe('trigger_targets');
    g = toStep(g, 'main1', 'bob');
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Divination', 'hand') });
    g = settle(g);
    g = settle(anyTarget(g, 'bob'));
    expect(g.players.bob!.life).toBe(life - 2);
  });

  it('Sigarda\'s Aid: Equipment at instant speed, not other artifacts', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Aid', 'battlefield');
    const blade = give(g, 'alice', 'Blade', 'hand');
    const rock = give(g, 'alice', 'Rock', 'hand');
    g = toStep(g, 'upkeep', 'bob');
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.priority).toBe('alice');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === blade)).toBe(true);
    expect(illegal(g, { type: 'cast', player: 'alice', object: rock })).toBeTruthy();
  });

  it('Talon Gates: put from the hand onto the battlefield', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const gates = give(g, 'alice', 'Gates', 'hand');
    g.players.alice!.pool.C = 4;
    g = act(g, { type: 'activate', player: 'alice', object: gates, ability: 0 });
    g = settle(g);
    expect(g.objects[gates]!.zone).toBe('battlefield');
  });

  it('Chrome Mox: imprint, then mana of its colors', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const red = give(g, 'alice', 'Red Spell', 'hand');
    const mox = give(g, 'alice', 'Mox', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: mox }));
    if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    if (g.pending?.kind === 'choose_objects') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [red] } }));
    expect(g.objects[red]!.zone).toBe('exile');
    const options = legalActions(g, 'alice').filter((a) => a.type === 'activate_mana' && a.object === mox);
    expect(options.map((a) => (a as { choice?: string }).choice)).toEqual(['R']);
    g = act(g, { type: 'activate_mana', player: 'alice', object: mox, ability: 0, choice: 'R' });
    expect(g.players.alice!.pool.R).toBe(1);
    expect(illegal({ ...g, objects: { ...g.objects, [mox]: { ...g.objects[mox]!, tapped: false } } }, { type: 'activate_mana', player: 'alice', object: mox, ability: 0, choice: 'G' })).toBeTruthy();
  });

  it('Plaza of Heroes: exile it as a cost', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const plaza = give(g, 'alice', 'Plaza', 'battlefield');
    const legend = give(g, 'alice', 'Legend', 'battlefield');
    g.players.alice!.pool.C = 3;
    g = settle(act(g, { type: 'activate', player: 'alice', object: plaza, ability: 0, targets: [[{ kind: 'object', object: legend }]] }));
    expect(g.objects[plaza]!.zone).toBe('exile');
  });

  it('Valakut Awakening: put cards on the bottom, draw that many plus one', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const spell = give(g, 'alice', 'Awakening', 'hand');
    const hand = g.zones.hand.alice!.filter((id) => id !== spell);
    g = settle(act(g, { type: 'cast', player: 'alice', object: spell }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: hand.slice(0, 2) } }));
    expect(g.zones.hand.alice!.length).toBe(hand.length + 1);
    const lib = g.zones.library.alice!;
    expect(lib.slice(-2).sort()).toEqual(hand.slice(0, 2).sort());
  });

  it("Thassa's Oracle wins when devotion covers the library", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.zones.library.alice = g.zones.library.alice!.slice(0, 2);
    g.players.alice!.pool.U = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Oracle', 'hand') }));
    if (g.pending?.kind === 'choose_objects') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [] } }));
    g = settle(g);
    expect(g.over).toBeTruthy();
    expect(g.players.bob!.lost).toBeTruthy();
  });
});
