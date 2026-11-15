import { describe, expect, it } from 'vitest';
import { chars, legalActions, type Action, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

/**
 * What modifies an effect or a static ability is read once, for whatever it modifies (the compiler's shared readers:
 * a condition, "unless", a counted X). None of these sentences has a reader of its own; each is its plain sentence
 * and the modifier.
 */
const CARDS = [
  makeCard({ name: 'Scrap', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Destroy target artifact if its mana value is 2 or less.' }),
  makeCard({ name: 'Refund', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'You gain 4 life unless you control an artifact.' }),
  makeCard({ name: 'Trinket', type_line: 'Artifact', mana_cost: '{1}', cmc: 1, oracle_text: '' }),
  makeCard({ name: 'Engine', type_line: 'Artifact', mana_cost: '{3}', cmc: 3, oracle_text: '' }),
  makeCard({ name: 'Sleeper', type_line: 'Creature — Giant', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: "This creature doesn't untap during your untap step unless you control an artifact." }),
  makeCard({ name: 'Stalker', type_line: 'Creature — Cat', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'As long as this creature is tapped, you may cast spells as though they had flash.' }),
  makeCard({ name: 'Ledger', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever a creature dies, put a stain counter on this enchantment. Then sacrifice it if it has two or more stain counters on it. When you do, draw a card.' }),
  makeCard({ name: 'Bounty', type_line: 'Sorcery', mana_cost: '{X}{G}', cmc: 1, oracle_text: 'Distribute X +1/+1 counters among any number of target creatures you control.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Bolt', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Bolt deals 3 damage to any target.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 40 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const main = (): GameState => toStep(start({ extra: CARDS }), 'main1', 'alice');
const cast = (g: GameState, name: string, more: Partial<Extract<Action, { type: 'cast' }>> = {}, player = 'alice') => settle(act(g, { type: 'cast', player, object: give(g, player, name, 'hand'), ...more }));
const at = (object: string) => [[{ kind: 'object' as const, object }]];

describe('a condition, "unless" and a counted X, read once for whatever they modify', () => {
  it('every card here reads in full', () => {
    expect(CARDS.filter((c) => c.automation !== 'full').map((c) => `${c.name}: ${c.faces[0]!.unparsed.join(' | ')}`)).toEqual([]);
  });

  it('"[effect] if [condition]": checked as it resolves', () => {
    let g = main();
    const cheap = give(g, 'bob', 'Trinket', 'battlefield');
    const dear = give(g, 'bob', 'Engine', 'battlefield');
    g = cast(g, 'Scrap', { targets: at(dear) });
    expect(g.objects[dear]!.zone).toBe('battlefield');
    g = cast(g, 'Scrap', { targets: at(cheap) });
    expect(g.objects[cheap]!.zone).toBe('graveyard');
  });

  it('"[effect] unless [condition]"', () => {
    let g = main();
    const life = g.players.alice!.life;
    g = cast(g, 'Refund');
    expect(g.players.alice!.life - life).toBe(4);
    give(g, 'alice', 'Trinket', 'battlefield');
    g = cast(g, 'Refund');
    expect(g.players.alice!.life - life).toBe(4);
  });

  it('a static ability "unless [condition]": it holds only while the condition doesn\'t', () => {
    let g = main();
    const sleeper = give(g, 'alice', 'Sleeper', 'battlefield');
    g.objects[sleeper]!.tapped = true;
    g = toStep(toStep(g, 'main1', 'bob'), 'main1', 'alice');
    expect(g.objects[sleeper]!.tapped).toBe(true);
    give(g, 'alice', 'Trinket', 'battlefield');
    g = toStep(toStep(g, 'main1', 'bob'), 'main1', 'alice');
    expect(g.objects[sleeper]!.tapped).toBe(false);
  });

  it('"As long as [condition], you may cast spells as though they had flash": a rule for a player, with its condition', () => {
    let g = main();
    const stalker = give(g, 'alice', 'Stalker', 'battlefield');
    g = toStep(g, 'main1', 'bob');
    const bear = give(g, 'alice', 'Bear', 'hand');
    g.players.alice!.pool.G = 2;
    g = act(g, { type: 'pass', player: 'bob' });
    const offered = () => legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === bear);
    // Bob's turn, Alice has priority: no flash while the Stalker is untapped.
    expect([g.priority, offered()]).toEqual(['alice', false]);
    g.objects[stalker]!.tapped = true;
    expect(offered()).toBe(true);
  });

  it('"sacrifice it if …. When you do, …": done only if the condition held (CR 603.12)', () => {
    let g = main();
    const ledger = give(g, 'alice', 'Ledger', 'battlefield');
    const hand = () => g.zones.hand.alice!.length;
    const first = give(g, 'bob', 'Bear', 'battlefield');
    const second = give(g, 'bob', 'Bear', 'battlefield');
    let before = hand();
    g = cast(g, 'Bolt', { targets: at(first) });
    // One counter: not sacrificed, and nothing drawn.
    expect([g.objects[ledger]!.zone, g.objects[ledger]!.counters.stain, hand() - before]).toEqual(['battlefield', 1, 0]);
    before = hand();
    g = cast(g, 'Bolt', { targets: at(second) });
    expect([g.objects[ledger]!.zone, hand() - before]).toEqual(['graveyard', 1]);
  });

  it('"Distribute X +1/+1 counters among any number of target creatures you control": X as the spell was cast', () => {
    let g = main();
    const a = give(g, 'alice', 'Bear', 'battlefield');
    const b = give(g, 'alice', 'Bear', 'battlefield');
    g.players.alice!.pool.G = 4;
    g = cast(g, 'Bounty', { x: 3, targets: [[{ kind: 'object', object: a }, { kind: 'object', object: b }]], divide: [2, 1] });
    expect([g.objects[a]!.counters['+1/+1'], g.objects[b]!.counters['+1/+1']]).toEqual([2, 1]);
    expect([chars(g, g.objects[a]!).power, chars(g, g.objects[b]!).power]).toEqual([4, 3]);
  });
});
