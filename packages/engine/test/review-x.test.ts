import { describe, expect, it } from 'vitest';
import { apply, chars, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

// X that comes from somewhere other than the mana cost printed in the corner: a kicker, a foretell or cycling cost, an
// additional cost, or the text ("where X is …"). The audit asked whether each of these really gets its X.
const CARDS = [
  makeCard({ name: 'Kangee, Aerie Keeper', type_line: 'Legendary Creature — Bird Wizard', mana_cost: '{2}{W}{U}', cmc: 4, power: '2', toughness: '2', oracle_text: 'Kicker {X}{2} (You may pay an additional {X}{2} as you cast this spell.)\nFlying\nWhen Kangee enters, if it was kicked, put X feather counters on it.\nOther Bird creatures get +1/+1 for each feather counter on Kangee.' }),
  makeCard({ name: 'Starnheim Unleashed', type_line: 'Sorcery', mana_cost: '{2}{W}{W}', cmc: 4, oracle_text: 'Create a 4/4 white Angel Warrior creature token with flying and vigilance. If this spell was foretold, create X of those tokens instead.\nForetell {X}{X}{W} (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)' }),
  makeCard({ name: "Valor's Flagship", type_line: 'Legendary Artifact — Vehicle', mana_cost: '{4}{W}{W}{W}', cmc: 7, power: '7', toughness: '7', oracle_text: 'Flying, first strike, lifelink\nCrew 3\nCycling {X}{2}{W} ({X}{2}{W}, Discard this card: Draw a card.)\nWhen you cycle this card, create X 1/1 colorless Pilot creature tokens with "This token saddles Mounts and crews Vehicles as though its power were 2 greater."' }),
  makeCard({ name: 'Fire Covenant', type_line: 'Instant', mana_cost: '{1}{B}{R}', cmc: 3, oracle_text: 'As an additional cost to cast this spell, pay X life.\nFire Covenant deals X damage divided as you choose among any number of target creatures.' }),
  makeCard({ name: 'The Destruction of Praxis', type_line: 'Sorcery', mana_cost: '{3}{B}{B}', cmc: 5, oracle_text: 'All creatures get -X/-X until end of turn, where X is the number of differently named lands you control. If X is 6 or more, create two 2/1 red Warrior creature tokens with haste.' }),
  makeCard({ name: 'Shantotto, Tactician Magician', type_line: 'Legendary Creature — Dwarf Wizard', mana_cost: '{1}{U}{R}', cmc: 3, power: '0', toughness: '4', oracle_text: 'Whenever you cast a noncreature spell, Shantotto gets +X/+0 until end of turn, where X is the amount of mana spent to cast that spell. If X is 4 or more, draw a card.' }),
  makeCard({ name: 'Obsessive Pursuit', type_line: 'Enchantment', mana_cost: '{1}{B}', cmc: 2, oracle_text: "When this enchantment enters and at the beginning of your upkeep, you lose 1 life and create a Clue token. (It's an artifact with \"{2}, Sacrifice this token: Draw a card.\")\nWhenever you attack, put X +1/+1 counters on target attacking creature, where X is the number of permanents you've sacrificed this turn. If X is three or more, that creature gains lifelink until end of turn." }),
  makeCard({ name: 'Altar', type_line: 'Artifact', mana_cost: '{1}', cmc: 1, oracle_text: 'Sacrifice a creature: You gain 1 life.' }),
  makeCard({ name: 'Rock', type_line: 'Artifact', mana_cost: '{4}', cmc: 4, oracle_text: '' }),
  makeCard({ name: 'Pebble', type_line: 'Artifact', mana_cost: '{2}', cmc: 2, oracle_text: '' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{2}{R}', cmc: 3, power: '3', toughness: '3', oracle_text: '' }),
  ...['A', 'B', 'C', 'D', 'E', 'F'].map((n) => makeCard({ name: `Land ${n}`, type_line: 'Land', mana_cost: '', cmc: 0, oracle_text: '{T}: Add {B}.' })),
];
const main = () => toStep(start({ extra: CARDS }), 'main1', 'alice');
function settle(g: GameState): GameState {
  for (let i = 0; i < 40 && (g.stack.length || g.pending); i++) {
    if (g.pending) break;
    g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
}
const tokens = (g: GameState) => g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice');

describe('X from a cost that isn’t the mana cost, or from the text', () => {
  it('Kangee: kicked with X = 3, it gets three feather counters', () => {
    let g = main();
    const kangee = give(g, 'alice', 'Kangee, Aerie Keeper', 'hand');
    g.players.alice!.pool.W = 5;
    g.players.alice!.pool.U = 4;
    g = settle(act(g, { type: 'cast', player: 'alice', object: kangee, kicked: true, x: 3 }));
    expect(g.objects[kangee]).toMatchObject({ zone: 'battlefield', counters: { feather: 3 } });
    expect(g.players.alice!.pool.W + g.players.alice!.pool.U).toBe(0);
  });

  it('Starnheim Unleashed: foretold and cast with X = 2, two Angels; cast from hand, one', () => {
    let g = main();
    const plain = give(g, 'alice', 'Starnheim Unleashed', 'hand');
    g.players.alice!.pool.W = 4;
    g = settle(act(g, { type: 'cast', player: 'alice', object: plain }));
    expect(tokens(g)).toHaveLength(1);

    g = main();
    const card = give(g, 'alice', 'Starnheim Unleashed', 'hand');
    g.players.alice!.pool.W = 2;
    g = act(g, { type: 'foretell', player: 'alice', object: card });
    g = toStep(toStep(g, 'main1', 'bob'), 'main1', 'alice');
    g.players.alice!.pool.W = 5;
    g = settle(act(g, { type: 'cast', player: 'alice', object: card, alt: 'foretell', x: 2 }));
    expect(tokens(g)).toHaveLength(2);
    expect(g.players.alice!.pool.W).toBe(0);
  });

  it("Valor's Flagship: cycled with X = 2, two Pilots", () => {
    let g = main();
    const ship = give(g, 'alice', "Valor's Flagship", 'hand');
    g.players.alice!.pool.W = 5;
    // Cycling is an activated ability of the card in hand, listed with the range of X that can be paid for.
    const cycle = legalActions(g, 'alice').flatMap((a) => (a.type === 'activate' && a.object === ship ? [a] : []))[0];
    expect(cycle).toMatchObject({ x: 0, xMax: 2 });
    g = settle(act(g, { ...cycle!, x: 2 }));
    expect(g.objects[ship]!.zone).toBe('graveyard');
    expect(tokens(g)).toHaveLength(2);
  });

  it('Fire Covenant: X life paid is X damage to divide', () => {
    let g = main();
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    const covenant = give(g, 'alice', 'Fire Covenant', 'hand');
    g.players.alice!.pool.B = 2;
    g.players.alice!.pool.R = 1;
    // Listed with the least X there is something to divide for: 1, for its one target.
    const listed = legalActions(g, 'alice').flatMap((a) => (a.type === 'cast' && a.object === covenant ? [a] : []));
    expect(listed.map((a) => [a.x, a.targets?.[0]?.length])).toEqual([[1, 1]]);
    expect(apply(g, listed[0]!).ok).toBe(true);
    g = settle(act(g, { type: 'cast', player: 'alice', object: covenant, x: 3, targets: [[{ kind: 'object', object: ogre }]], divide: [3] }));
    expect(g.players.alice!.life).toBe(17);
    expect(g.objects[ogre]!.zone).toBe('graveyard');
  });

  it('The Destruction of Praxis: "If X is 6 or more" is the X the text defined', () => {
    let g = main();
    for (const n of ['A', 'B', 'C', 'D', 'E']) give(g, 'alice', `Land ${n}`, 'battlefield');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    g.players.alice!.pool.B = 10;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'The Destruction of Praxis', 'hand') }));
    // Five differently named lands: -5/-5, and no Warriors.
    expect(g.objects[ogre]!.zone).toBe('graveyard');
    expect(tokens(g)).toHaveLength(0);
    give(g, 'alice', 'Land F', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'The Destruction of Praxis', 'hand') }));
    // Six: the Warriors are created (2/1s made after the -6/-6 was handed out: it doesn't reach them, CR 611.2c).
    expect(tokens(g)).toHaveLength(2);
  });

  it('Shantotto: +X/+0 for the mana spent, and a card when that is 4 or more', () => {
    let g = main();
    const shan = give(g, 'alice', 'Shantotto, Tactician Magician', 'battlefield');
    const hand = () => g.zones.hand.alice!.length;
    g.players.alice!.pool.R = 6;
    const before = hand();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Pebble', 'hand') }));
    expect(chars(g, g.objects[shan]!).power).toBe(2);
    expect(hand()).toBe(before);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Rock', 'hand') }));
    expect(chars(g, g.objects[shan]!).power).toBe(6);
    expect(hand()).toBe(before + 1);
  });

  it('Obsessive Pursuit: counters for the permanents sacrificed this turn, and lifelink at three', () => {
    let g = main();
    give(g, 'alice', 'Obsessive Pursuit', 'battlefield');
    const altar = give(g, 'alice', 'Altar', 'battlefield');
    const attacker = give(g, 'alice', 'Ogre', 'battlefield', { sick: false });
    for (let i = 0; i < 3; i++) {
      const fodder = give(g, 'alice', 'Ogre', 'battlefield');
      g = settle(act(g, { type: 'activate', player: 'alice', object: altar, ability: 0, costs: { sacrifice: [fodder] } }));
    }
    for (let i = 0; i < 20 && g.pending?.kind !== 'declare_attackers'; i++) g = act(g, { type: 'pass', player: g.priority! });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker, target: { kind: 'player', player: 'bob' } }] } });
    if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: attacker }]] } });
    g = settle(g);
    expect(g.objects[attacker]!.counters['+1/+1']).toBe(3);
    expect(chars(g, g.objects[attacker]!).keywords.some((k) => k.id === 'lifelink')).toBe(true);
  });
});
