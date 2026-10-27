import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import { give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Still Silence', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Activated abilities of artifacts can't be activated." }),
  makeCard({ name: 'Grounding', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Activated abilities of artifacts and creatures can't be activated unless they're mana abilities." }),
  makeCard({ name: 'Life Stone', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}: You gain 1 life.' }),
  makeCard({ name: 'Mana Stone', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}: Add {C}.' }),
];

describe("CR 602.5: activated abilities that can't be activated", () => {
  it('"Activated abilities of artifacts can\'t be activated." — mana abilities too', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'bob', 'Still Silence', 'battlefield');
    const life = give(g, 'alice', 'Life Stone', 'battlefield');
    const mana = give(g, 'alice', 'Mana Stone', 'battlefield');
    expect(illegal(g, { type: 'activate', player: 'alice', object: life, ability: 0 })).toBeTruthy();
    expect(illegal(g, { type: 'activate_mana', player: 'alice', object: mana, ability: 0 })).toBeTruthy();
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === life)).toBe(false);
  });

  it('"… unless they\'re mana abilities"', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'bob', 'Grounding', 'battlefield');
    const life = give(g, 'alice', 'Life Stone', 'battlefield');
    const mana = give(g, 'alice', 'Mana Stone', 'battlefield');
    expect(illegal(g, { type: 'activate', player: 'alice', object: life, ability: 0 })).toBeTruthy();
    const r = legalActions(g, 'alice');
    expect(r.some((a) => a.type === 'activate' && a.object === life)).toBe(false);
    expect(() => illegal(g, { type: 'activate_mana', player: 'alice', object: mana, ability: 0 })).toThrow();
  });
});
