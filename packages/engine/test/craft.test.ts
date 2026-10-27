import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import { faceOf } from '../src/zones.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({
    name: 'Idol // Awakened',
    layout: 'transform',
    type_line: 'Artifact // Artifact Creature — Golem',
    mana_cost: '{1}',
    oracle_text: '',
    card_faces: [
      { object: 'card_face', name: 'Idol', type_line: 'Artifact', mana_cost: '{1}', oracle_text: 'Craft with artifact {2} ({2}, Exile this artifact, Exile another artifact you control or an artifact card from your graveyard: Return this card transformed under its owner’s control. Craft only as a sorcery.)' },
      { object: 'card_face', name: 'Awakened', type_line: 'Artifact Creature — Golem', mana_cost: '', power: '4', toughness: '4', oracle_text: '' },
    ],
  } as never),
  makeCard({ name: 'Trinket', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '' }),
];

describe('CR 702.167: craft', () => {
  it('exiles itself and an artifact card from the graveyard, then returns transformed', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const idol = give(g, 'alice', 'Idol // Awakened', 'battlefield');
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 };
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === idol)).toBe(false);
    const t = give(g, 'alice', 'Trinket', 'graveyard');
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === idol)).toBe(true);
    g = act(g, { type: 'activate', player: 'alice', object: idol, ability: 0, costs: { exile: [t] } });
    expect(g.objects[idol]!.zone).toBe('exile');
    expect(g.objects[t]!.zone).toBe('exile');
    while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.objects[idol]!.zone).toBe('battlefield');
    expect(faceOf(g, g.objects[idol]!).name).toBe('Awakened');
  });
});
