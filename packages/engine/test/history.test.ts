import { describe, expect, it } from 'vitest';
import { happened, viewFor, type Action, type GameState } from '../src/index.js';
import { cardExiled, creatureDied, descended, died, leftBattlefield, leftGraveyard, nonlandLeft, putIntoGraveyard, returnedToHand, sacrificed, tokensCreated } from '../src/history.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

/**
 * What happened this turn is kept once — each move, token and sacrifice, with what it was about as it then was — and
 * the "this turn" questions are asked of that one history (src/history.ts). Here: what the history holds after real
 * plays. That each card's question is answered rightly from it is tested with the cards (morbid, revolt, descend, …).
 */
const CARDS = [
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Relic', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '' }),
  makeCard({ name: 'Slay', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target permanent.' }),
  makeCard({ name: 'Banish', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Exile target permanent.' }),
  makeCard({ name: 'Recall', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Return target creature to its owner's hand." }),
  makeCard({ name: 'Raise', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Return target creature card from your graveyard to your hand.' }),
  makeCard({ name: 'Summon', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Create a 1/1 white Spirit creature token.' }),
  makeCard({ name: 'Wake', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Target land you control becomes a 3/3 Elemental creature until end of turn. It's still a land." }),
  makeCard({ name: 'Seize', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Gain control of target creature until end of turn.' }),
  makeCard({ name: 'Altar', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Sacrifice a creature: You gain 1 life.' }),
  makeCard({ name: 'Rummage', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Discard a card.' }),
  makeCard({ name: 'Augury', type_line: 'Instant', mana_cost: '{3}{U}', cmc: 4, oracle_text: 'Draw two cards.\nForetell {1}{U}' }),
  makeCard({ name: 'Insight', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw two cards.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 40 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const main = (): GameState => toStep(start({ extra: CARDS }), 'main1', 'alice');
const at = (object: string) => [[{ kind: 'object' as const, object }]];
const cast = (g: GameState, name: string, more: Partial<Extract<Action, { type: 'cast' }>> = {}) => settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), ...more }));

describe('the turn\'s history: what happened, with what it was about as it then was', () => {
  it('a creature that died: who controlled it, whose it is, what it was', () => {
    let g = main();
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    expect([creatureDied(g), died(g)]).toEqual([false, []]);
    g = cast(g, 'Slay', { targets: at(bear) });
    expect(died(g)).toMatchObject([{ id: bear, controller: 'bob', owner: 'bob', token: false, types: ['Creature'], subtypes: ['Bear'], printed: ['Creature'] }]);
    expect([creatureDied(g), leftBattlefield(g).length, nonlandLeft(g)]).toEqual([true, 1, true]);
    // CR 700.11: a permanent card put into its owner's graveyard — Bob descended, Alice didn't (her instant isn't one).
    expect([descended(g, 'bob'), descended(g, 'alice')]).toEqual([1, 0]);
  });

  it('as it last existed, not as its card is printed: a land that was a creature when it died', () => {
    let g = main();
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    g = cast(g, 'Wake', { targets: at(forest) });
    g = cast(g, 'Slay', { targets: at(forest) });
    expect(died(g)).toMatchObject([{ id: forest, printed: ['Land'] }]);
    expect(died(g)[0]!.types).toEqual(expect.arrayContaining(['Land', 'Creature']));
    // A creature died; no nonland permanent left the battlefield.
    expect([creatureDied(g), nonlandLeft(g)]).toEqual([true, false]);
  });

  it('under the control it left with: a creature stolen for the turn', () => {
    let g = main();
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    give(g, 'alice', 'Altar', 'battlefield');
    g = cast(g, 'Seize', { targets: at(bear) });
    const altar = g.zones.battlefield.find((id) => g.cards[g.objects[id]!.card]!.name === 'Altar')!;
    g = settle(act(g, { type: 'activate', player: 'alice', object: altar, ability: 0, costs: { sacrifice: [bear] } }));
    // Alice sacrificed it; it died under her control and went to Bob's graveyard.
    expect(sacrificed(g, 'alice')).toMatchObject([{ id: bear, controller: 'alice', owner: 'bob', types: ['Creature'] }]);
    expect([sacrificed(g, 'bob'), sacrificed(g).length]).toEqual([[], 1]);
    expect(died(g)).toMatchObject([{ controller: 'alice', owner: 'bob' }]);
    expect(putIntoGraveyard(g).filter((c) => c.owner === 'bob').map((c) => c.types)).toEqual([['Creature']]);
  });

  it('a token: created, dead, and not a card', () => {
    let g = main();
    g = cast(g, 'Summon');
    expect([tokensCreated(g, 'alice'), tokensCreated(g, 'bob')]).toEqual([1, 0]);
    const spirit = g.zones.battlefield.find((id) => g.objects[id]!.token)!;
    g = cast(g, 'Slay', { targets: at(spirit) });
    expect(died(g)).toMatchObject([{ token: true, types: ['Creature'], subtypes: ['Spirit'] }]);
    // A token put into a graveyard isn't a card put there (CR 700.11), nor one exiled.
    expect(descended(g, 'alice')).toBe(0);
    g = cast(g, 'Summon');
    const other = g.zones.battlefield.find((id) => g.objects[id]!.token)!;
    g = cast(g, 'Banish', { targets: at(other) });
    expect([happened(g, 'exiled').length, cardExiled(g)]).toEqual([1, false]);
    const relic = give(g, 'bob', 'Relic', 'battlefield');
    g = cast(g, 'Banish', { targets: at(relic) });
    expect(cardExiled(g)).toBe(true);
  });

  it('to a hand from the battlefield, and out of a graveyard', () => {
    let g = main();
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = cast(g, 'Recall', { targets: at(bear) });
    expect([returnedToHand(g), died(g), leftBattlefield(g).length]).toEqual([['bob'], [], 1]);
    const dead = give(g, 'alice', 'Bear', 'graveyard');
    expect(leftGraveyard(g)).toEqual([]);
    g = cast(g, 'Raise', { targets: at(dead) });
    expect(leftGraveyard(g)).toEqual([{ owner: 'alice', types: ['Creature'] }]);
  });

  it('from anywhere: a card discarded is a card put into a graveyard, not a permanent that left', () => {
    let g = main();
    const bear = give(g, 'alice', 'Bear', 'hand');
    g = cast(g, 'Rummage');
    if (g.pending) g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: [bear] } }));
    expect(g.objects[bear]!.zone).toBe('graveyard');
    expect(putIntoGraveyard(g).some((c) => c.event.type === 'moved' && c.event.object === bear && c.event.from === 'hand')).toBe(true);
    expect([descended(g, 'alice'), died(g), leftBattlefield(g)]).toEqual([1, [], []]);
  });

  it('holds nothing hidden: a card drawn isn\'t there, and one exiled face down is there as no more than that', () => {
    let g = main();
    g = cast(g, 'Insight');
    // Two cards moved from her library to her hand: not kept (the spell's own moves, seen by all, are).
    const kept = (g.history ?? []).flatMap((h) => (h.e.type === 'moved' ? [`${h.e.from}>${h.e.to}`] : []));
    expect(kept).toEqual(['hand>stack', 'stack>graveyard']);
    // CR 702.143a: foretold — exiled from her hand face down.
    const augury = give(g, 'alice', 'Augury', 'hand');
    g.players.alice!.pool.C = 2;
    g = act(g, { type: 'foretell', player: 'alice', object: augury });
    expect(g.objects[augury]).toMatchObject({ zone: 'exile' });
    expect(happened(g, 'exiled')).toMatchObject([{ e: { object: augury, from: 'hand', to: 'exile', card: '' }, was: { owner: 'alice', token: false, types: [], printed: [] } }]);
    // A card was put into exile this turn, all the same.
    expect(cardExiled(g)).toBe(true);
    // So every player's view carries the history whole, and Bob's says nothing of which card it was.
    const bobs = viewFor(g, 'bob');
    expect(bobs.history).toEqual(g.history);
    expect(JSON.stringify(bobs.history)).not.toContain('Augury');
  });

  it('a new turn: this turn\'s history becomes the last turn\'s', () => {
    let g = main();
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = cast(g, 'Slay', { targets: at(bear) });
    expect(creatureDied(g)).toBe(true);
    g = toStep(g, 'main1', 'bob');
    expect([creatureDied(g), creatureDied(g, true), died(g, true).map((w) => w.id)]).toEqual([false, true, [bear]]);
    g = toStep(g, 'main1', 'alice');
    expect([creatureDied(g), creatureDied(g, true)]).toEqual([false, false]);
  });
});
