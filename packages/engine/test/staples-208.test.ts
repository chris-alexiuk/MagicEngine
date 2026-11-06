import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Fountain Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{0}, {T}, Untap a tapped creature you control: Create a 1/1 green and white Citizen creature token.\n{0}, {T}, Untap two tapped creatures you control: Draw a card.' }),
  makeCard({ name: 'Annex Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "Creatures can't attack you or planeswalkers you control unless their controller pays {W/P} for each of those creatures." }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const main = () => toStep(start({ extra: CARDS }), 'main1', 'alice');

describe('slice 283 staples', () => {
  it('Halo Fountain: untapping tapped creatures you control is the cost', () => {
    let g = main();
    const fountain = give(g, 'alice', 'Fountain Lite', 'battlefield');
    const [a, b] = [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'alice', 'Cub', 'battlefield')];
    g.objects[a]!.tapped = true;
    illegal(g, { type: 'activate', player: 'alice', object: fountain, ability: 1, costs: { crew: [a] } } as never);
    illegal(g, { type: 'activate', player: 'alice', object: fountain, ability: 0, costs: { crew: [b] } } as never);
    const tokens = g.zones.battlefield.length;
    g = settle(act(g, { type: 'activate', player: 'alice', object: fountain, ability: 0, costs: { crew: [a] } } as never));
    expect([g.objects[a]!.tapped, g.objects[fountain]!.tapped, g.zones.battlefield.length]).toEqual([false, true, tokens + 1]);
    g.objects[fountain]!.tapped = false;
    g.objects[a]!.tapped = true;
    g.objects[b]!.tapped = true;
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'activate', player: 'alice', object: fountain, ability: 1, costs: { crew: [a, b] } } as never));
    expect([g.objects[a]!.tapped, g.objects[b]!.tapped, g.zones.hand.alice!.length]).toEqual([false, false, hand + 1]);
  });

  it("Norn's Annex: each attacker costs {W/P} — white mana or 2 life", () => {
    let g = main();
    give(g, 'bob', 'Annex Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'battlefield', { sick: false });
    g = toStep(g, 'beginning_of_combat', 'alice');
    for (let i = 0; i < 20 && g.pending?.kind !== 'declare_attackers'; i++) g = act(g, { type: 'pass', player: g.priority! });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: cub, target: { kind: 'player', player: 'bob' } }] } });
    expect([g.combat?.attackers[cub] !== undefined, g.players.alice!.life]).toEqual([true, 18]);
  });
});
