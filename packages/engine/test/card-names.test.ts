import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Needle', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "As this artifact enters, choose a card name.\nActivated abilities of sources with the chosen name can't be activated unless they're mana abilities." }),
  makeCard({ name: 'Mage of Silence', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "As this creature enters, choose a nonland card name.\nSpells with the chosen name can't be cast." }),
  makeCard({ name: 'Life Stone', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}: You gain 1 life.' }),
  makeCard({ name: 'Ping', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'You gain 1 life.' }),
];

function enter(g: GameState, name: string, choice: string): GameState {
  g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand') });
  for (let i = 0; i < 10 && (g.stack.length || g.pending); i++) {
    if (g.pending?.kind === 'as_enters') {
      expect(g.pending.options).toContain(choice);
      g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', choice } });
    } else g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
}

describe('CR 201.3: choosing a card name as a permanent enters', () => {
  it('Needle: the named card\'s activated abilities can\'t be activated; others can', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const stone = give(g, 'bob', 'Life Stone', 'battlefield');
    g = enter(g, 'Needle', 'Life Stone');
    g = act(toStep(g, 'main1', 'bob'), { type: 'pass', player: 'bob' });
    g = toStep(g, 'main1', 'bob');
    expect(illegal(g, { type: 'activate', player: 'bob', object: stone, ability: 0 })).toBeTruthy();
  });

  it('Mage: "Spells with the chosen name can\'t be cast." (a nonland name)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = enter(g, 'Mage of Silence', 'Ping');
    expect(g.pending).toBeNull();
    const ping = give(g, 'alice', 'Ping', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: ping })).toMatch(/can't be cast/);
    const forest = g.zones.hand.alice!.find((id) => g.cards[g.objects[id]!.card]!.name === 'Forest');
    expect(forest).toBeDefined();
  });
});
