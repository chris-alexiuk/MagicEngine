import { describe, expect, it } from 'vitest';
import { countHappened, happened, viewFor, type Action, type Asked, type GameState, type Was } from '../src/index.js';
import { descended, putIntoGraveyard, tokensCreated } from '../src/history.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

/**
 * What happened this turn is kept once — each move, token and sacrifice, with what it was about as it then was — and
 * the "this turn" questions are asked of that one history (src/history.ts). Here: what the history holds after real
 * plays. That each card's question is read and answered rightly from it is tested with the cards (happened.test.ts,
 * and the tests of morbid, revolt, descend, …).
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
/** What happened, of one kind: each thing as it then was. */
const was = (g: GameState, kind: Asked['what'], lastTurn = false): Was[] => happened(g, kind, lastTurn).map((h) => h.was);
/** The answer to a question, for Alice. */
const asks = (g: GameState, asked: Asked): number => countHappened(g, asked, 'alice');
const CREATURE_DIED: Asked = { what: 'died', filter: { types: ['Creature'] } };
const NONLAND_LEFT: Asked = { what: 'left', filter: { notTypes: ['Land'] } };
const CARD_EXILED: Asked = { what: 'exiled', card: true };

describe('the turn\'s history: what happened, with what it was about as it then was', () => {
  it('a creature that died: who controlled it, whose it is, what it was', () => {
    let g = main();
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    expect([asks(g, CREATURE_DIED), was(g, 'died')]).toEqual([0, []]);
    g = cast(g, 'Slay', { targets: at(bear) });
    expect(was(g, 'died')).toMatchObject([{ id: bear, controller: 'bob', owner: 'bob', token: false, types: ['Creature'], subtypes: ['Bear'], printed: ['Creature'] }]);
    expect([asks(g, CREATURE_DIED), was(g, 'left').length, asks(g, NONLAND_LEFT)]).toEqual([1, 1, 1]);
    // "Under your control", "under an opponent's control": Alice asks, and it was Bob's.
    expect([asks(g, { what: 'died', filter: { controller: 'you' } }), asks(g, { what: 'died', filter: { controller: 'opponent' } })]).toEqual([0, 1]);
    // CR 700.11: a permanent card put into its owner's graveyard — Bob descended, Alice didn't (her instant isn't one).
    expect([descended(g, 'bob'), descended(g, 'alice')]).toEqual([1, 0]);
  });

  it('as it last existed, not as its card is printed: a land that was a creature when it died', () => {
    let g = main();
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    g = cast(g, 'Wake', { targets: at(forest) });
    g = cast(g, 'Slay', { targets: at(forest) });
    expect(was(g, 'died')).toMatchObject([{ id: forest, printed: ['Land'] }]);
    expect(was(g, 'died')[0]!.types).toEqual(expect.arrayContaining(['Land', 'Creature']));
    // A creature died; no nonland permanent left the battlefield. Asked about the card ("a creature card was put into
    // a graveyard"), it is a land card.
    expect([asks(g, CREATURE_DIED), asks(g, NONLAND_LEFT)]).toEqual([1, 0]);
    expect([asks(g, { what: 'put_into_graveyard', card: true, filter: { types: ['Creature'] } }), asks(g, { what: 'put_into_graveyard', card: true, filter: { types: ['Land'] } })]).toEqual([0, 1]);
  });

  it('under the control it left with: a creature stolen for the turn', () => {
    let g = main();
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    give(g, 'alice', 'Altar', 'battlefield');
    g = cast(g, 'Seize', { targets: at(bear) });
    const altar = g.zones.battlefield.find((id) => g.cards[g.objects[id]!.card]!.name === 'Altar')!;
    g = settle(act(g, { type: 'activate', player: 'alice', object: altar, ability: 0, costs: { sacrifice: [bear] } }));
    // Alice sacrificed it; it died under her control and went to Bob's graveyard.
    expect(was(g, 'sacrificed')).toMatchObject([{ id: bear, controller: 'alice', owner: 'bob', types: ['Creature'] }]);
    // "You sacrificed" is Alice's to say, not Bob's.
    expect([asks(g, { what: 'sacrificed', filter: { controller: 'you' } }), countHappened(g, { what: 'sacrificed', filter: { controller: 'you' } }, 'bob')]).toEqual([1, 0]);
    expect(was(g, 'died')).toMatchObject([{ controller: 'alice', owner: 'bob' }]);
    // "Put into your graveyard from the battlefield": Bob's graveyard.
    expect([asks(g, { what: 'died', filter: { owner: 'you' } }), countHappened(g, { what: 'died', filter: { owner: 'you' } }, 'bob')]).toEqual([0, 1]);
    expect(putIntoGraveyard(g).filter((c) => c.owner === 'bob').map((c) => c.types)).toEqual([['Creature']]);
  });

  it('a token: created, dead, and not a card', () => {
    let g = main();
    g = cast(g, 'Summon');
    expect([tokensCreated(g, 'alice'), tokensCreated(g, 'bob')]).toEqual([1, 0]);
    const spirit = g.zones.battlefield.find((id) => g.objects[id]!.token)!;
    g = cast(g, 'Slay', { targets: at(spirit) });
    expect(was(g, 'died')).toMatchObject([{ token: true, types: ['Creature'], subtypes: ['Spirit'] }]);
    expect([asks(g, CREATURE_DIED), asks(g, { what: 'died', filter: { types: ['Creature'], token: false } })]).toEqual([1, 0]);
    // A token put into a graveyard isn't a card put there (CR 700.11), nor one exiled.
    expect(descended(g, 'alice')).toBe(0);
    g = cast(g, 'Summon');
    const other = g.zones.battlefield.find((id) => g.objects[id]!.token)!;
    g = cast(g, 'Banish', { targets: at(other) });
    expect([happened(g, 'exiled').length, asks(g, CARD_EXILED)]).toEqual([1, 0]);
    const relic = give(g, 'bob', 'Relic', 'battlefield');
    g = cast(g, 'Banish', { targets: at(relic) });
    expect(asks(g, CARD_EXILED)).toBe(1);
  });

  it('to a hand from the battlefield, and out of a graveyard', () => {
    let g = main();
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = cast(g, 'Recall', { targets: at(bear) });
    expect([was(g, 'returned_to_hand').map((w) => w.owner), was(g, 'died'), was(g, 'left').length]).toEqual([['bob'], [], 1]);
    const dead = give(g, 'alice', 'Bear', 'graveyard');
    expect(was(g, 'left_graveyard')).toEqual([]);
    g = cast(g, 'Raise', { targets: at(dead) });
    expect(was(g, 'left_graveyard')).toMatchObject([{ owner: 'alice', printed: ['Creature'] }]);
    expect([asks(g, { what: 'left_graveyard', card: true, filter: { owner: 'you' } }), asks(g, { what: 'left_graveyard', card: true, filter: { owner: 'you', types: ['Land'] } })]).toEqual([1, 0]);
  });

  it('from anywhere: a card discarded is a card put into a graveyard, not a permanent that left', () => {
    let g = main();
    const bear = give(g, 'alice', 'Bear', 'hand');
    g = cast(g, 'Rummage');
    if (g.pending) g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: [bear] } }));
    expect(g.objects[bear]!.zone).toBe('graveyard');
    expect(putIntoGraveyard(g).some((c) => c.event.type === 'moved' && c.event.object === bear && c.event.from === 'hand')).toBe(true);
    expect([descended(g, 'alice'), was(g, 'died'), was(g, 'left')]).toEqual([1, [], []]);
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
    expect(asks(g, CARD_EXILED)).toBe(1);
    // So every player's view carries the history whole, and Bob's says nothing of which card it was.
    const bobs = viewFor(g, 'bob');
    expect(bobs.history).toEqual(g.history);
    expect(JSON.stringify(bobs.history)).not.toContain('Augury');
  });

  it('a new turn: this turn\'s history becomes the last turn\'s', () => {
    let g = main();
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = cast(g, 'Slay', { targets: at(bear) });
    expect(asks(g, CREATURE_DIED)).toBe(1);
    g = toStep(g, 'main1', 'bob');
    expect([asks(g, CREATURE_DIED), asks(g, { ...CREATURE_DIED, lastTurn: true }), was(g, 'died', true).map((w) => w.id)]).toEqual([0, 1, [bear]]);
    g = toStep(g, 'main1', 'alice');
    expect([asks(g, CREATURE_DIED), asks(g, { ...CREATURE_DIED, lastTurn: true })]).toEqual([0, 0]);
  });
});
