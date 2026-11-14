import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import type { Action, GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

// CR 117.3c: a player who casts a spell receives priority afterward — so they can respond to their own spell before
// anyone else can. Here: Nature's Claim on one's own artifact, countered by one's own An Offer You Can't Refuse, for
// the two Treasures; the artifact stays.
const CARDS = [
  makeCard({ name: "Nature's Claim", type_line: 'Instant', mana_cost: '{G}', cmc: 1, oracle_text: 'Destroy target artifact or enchantment. Its controller gains 4 life.' }),
  makeCard({ name: "An Offer You Can't Refuse", type_line: 'Instant', mana_cost: '{U}', cmc: 1, oracle_text: 'Counter target noncreature spell. Its controller creates two Treasure tokens. (They\'re artifacts with "{T}, Sacrifice this token: Add one mana of any color.")' }),
  makeCard({ name: 'Sol Ring', type_line: 'Artifact', mana_cost: '{1}', cmc: 1, oracle_text: '{T}: Add {C}{C}.' }),
  makeCard({ name: 'Island', type_line: 'Basic Land — Island', mana_cost: '', cmc: 0, oracle_text: '({T}: Add {U}.)' }),
];
const of = (g: GameState, id: string) => legalActions(g, 'alice').filter((a) => 'object' in a && a.object === id);
const mine = (g: GameState, name: string) => Object.values(g.objects).filter((o) => o.zone === 'battlefield' && o.controller === 'alice' && g.cards[o.card]?.faces[0]?.name === name).length;

describe('responding to your own spell', () => {
  it("Nature's Claim on your own artifact, countered by your own An Offer You Can't Refuse: two Treasures, and the artifact stays", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ring = give(g, 'alice', 'Sol Ring', 'battlefield');
    give(g, 'alice', 'Forest', 'battlefield');
    give(g, 'alice', 'Island', 'battlefield');
    const claim = give(g, 'alice', "Nature's Claim", 'hand');
    const offer = give(g, 'alice', "An Offer You Can't Refuse", 'hand');
    const life = g.players.alice!.life;

    const cast = of(g, claim).find((a) => a.type === 'cast') as Extract<Action, { type: 'cast' }>;
    g = act(g, { ...cast, targets: [[{ kind: 'object', object: ring }]] });
    // The caster has priority again, with their spell on the stack.
    expect(g.priority).toBe('alice');
    expect(g.stack.map((s) => (s.kind === 'spell' ? g.objects[s.object]!.card : 'ability'))).toEqual(["Nature's Claim"]);

    // Their own spell is a legal target for their counterspell.
    const counter = of(g, offer).find((a) => a.type === 'cast') as Extract<Action, { type: 'cast' }>;
    expect(counter).toBeTruthy();
    g = act(g, { ...counter, targets: [[{ kind: 'object', object: claim }]] });
    expect(g.stack.length).toBe(2);

    // Both pass: the Offer resolves. The Claim is countered and its controller — the same player — gets the Treasures.
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.stack.length).toBe(0);
    expect(g.objects[claim]!.zone).toBe('graveyard');
    expect(g.objects[offer]!.zone).toBe('graveyard');
    expect(mine(g, 'Treasure')).toBe(2);
    expect(mine(g, 'Sol Ring')).toBe(1);
    expect(g.players.alice!.life).toBe(life);
    expect(g.priority).toBe('alice');
  });
});
