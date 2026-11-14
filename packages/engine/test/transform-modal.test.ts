import { describe, expect, it } from 'vitest';
import { chars } from '../src/index.js';
import { act, give, makeCard, passRound, start, toStep } from './helpers.js';

// CR 701.27a: "Only permanents represented by double-faced tokens and double-faced cards can transform." A modal
// double-faced card is one (CR 712.1); only a meld card can't (CR 712.4c). King T'Challa // Black Panther, Hope
// Enduring and ten more can be cast as either face and have "{cost}: Transform ~." — which did nothing. (Found by the
// card sandbox: the ability "resolved and changed nothing".)

const king = makeCard({
  name: 'Test King // Test Panther',
  layout: 'modal_dfc',
  type_line: 'Legendary Creature — Human Noble // Legendary Creature — Human Warrior',
  mana_cost: '{1}{W}{U}',
  cmc: 3,
  oracle_text: '',
  card_faces: [
    { object: 'card_face', name: 'Test King', type_line: 'Legendary Creature — Human Noble', mana_cost: '{1}{W}{U}', power: '2', toughness: '3', oracle_text: '{4}{W}{U}: Transform Test King. Activate only as a sorcery.' },
    { object: 'card_face', name: 'Test Panther', type_line: 'Legendary Creature — Human Warrior', mana_cost: '{4}{W}{U}', power: '5', toughness: '5', oracle_text: 'Double strike' },
  ],
} as never);

describe('CR 701.27a: a modal double-faced permanent transforms when an ability says so', () => {
  it('the card is read in full', () => {
    expect(king.automation).toBe('full');
    expect(king.layout).toBe('modal_dfc');
  });

  it('its other face comes up: the same object, with that face’s characteristics', () => {
    let g = toStep(start({ extra: [king] }), 'main1', 'alice');
    Object.assign(g.players.alice!.pool, { W: 2, U: 2, C: 6 });
    const id = give(g, 'alice', 'Test King // Test Panther', 'battlefield');
    const zcc = g.objects[id]!.zcc;
    g = passRound(act(g, { type: 'activate', player: 'alice', object: id, ability: 0, autoTap: true }));
    const o = g.objects[id]!;
    expect(o.zone).toBe('battlefield');
    expect(o.zcc).toBe(zcc);
    expect(o.face).toBe(1);
    expect(chars(g, o).name).toBe('Test Panther');
    expect([chars(g, o).power, chars(g, o).toughness]).toEqual([5, 5]);
    expect(chars(g, o).keywords.map((k) => k.id)).toContain('double_strike');
  });
});
