import { describe, expect, it } from 'vitest';
import { chars, hasKeyword, legalActions, viewFor, type GameState } from '../src/index.js';
import { nameOf } from '../src/zones.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, ...extra });

const CARDS = [
  card('Hidden Ogre', 'Creature — Ogre', 'When this creature enters, you gain 5 life.\nWhen this creature is turned face up, draw a card.\nMorph {2}{R}', { mana_cost: '{4}{R}', power: '5', toughness: '4' }),
  card('Hidden Elf', 'Creature — Elf', 'Megamorph {G}', { mana_cost: '{2}{G}', power: '2', toughness: '3' }),
  card('Masked Thief', 'Creature — Rogue', 'Disguise {1}{U}', { mana_cost: '{3}{U}', power: '3', toughness: '2' }),
  card('Reveal Sight', 'Sorcery', 'Manifest the top card of your library.', { mana_cost: '{G}' }),
  card('Zap', 'Instant', 'Zap deals 2 damage to any target.', { mana_cost: '{R}' }),
];

function setup(): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  return g;
}

describe('CR 708: face-down spells and permanents', () => {
  it('morph: cast face down for {3} as a nameless 2/2 with no abilities; its enters ability doesn’t trigger (CR 708.3)', () => {
    let g = setup();
    g.players.alice!.pool.C = 3;
    const ogre = give(g, 'alice', 'Hidden Ogre', 'hand');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === ogre && a.alt === 'morph')).toBe(true);
    g = passRound(act(g, { type: 'cast', player: 'alice', object: ogre, alt: 'morph' }));
    const o = g.objects[ogre]!;
    expect(o.zone).toBe('battlefield');
    expect(chars(g, o)).toMatchObject({ name: '', power: 2, toughness: 2, subtypes: [], types: ['Creature'] });
    expect(g.stack).toHaveLength(0);
    expect(g.players.alice!.life).toBe(20);
  });

  it('CR 708.5: other players see only a face-down card', () => {
    let g = setup();
    g.players.alice!.pool.C = 3;
    const ogre = give(g, 'alice', 'Hidden Ogre', 'hand');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: ogre, alt: 'morph' }));
    expect(viewFor(g, 'bob').objects[ogre]!.card).toBe('face-down');
    expect(viewFor(g, 'alice').objects[ogre]!.card).toBe('Hidden Ogre');
  });

  it('CR 702.37e: turning it face up is a special action; “when it’s turned face up” triggers, “when it enters” doesn’t', () => {
    let g = setup();
    g.players.alice!.pool.C = 3;
    const ogre = give(g, 'alice', 'Hidden Ogre', 'hand');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: ogre, alt: 'morph' }));
    expect(illegal(g, { type: 'turn_face_up', player: 'alice', object: ogre })).toMatch(/mana/i);
    g.players.alice!.pool.R = 3;
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'turn_face_up', player: 'alice', object: ogre });
    expect(nameOf(g, g.objects[ogre]!)).toBe('Hidden Ogre');
    expect(chars(g, g.objects[ogre]!).power).toBe(5);
    expect(g.priority).toBe('alice');
    g = passRound(g);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
    expect(g.players.alice!.life).toBe(20);
  });

  it('megamorph adds a +1/+1 counter as it’s turned face up (CR 702.37b)', () => {
    let g = setup();
    g.players.alice!.pool.C = 3;
    const elf = give(g, 'alice', 'Hidden Elf', 'hand');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: elf, alt: 'megamorph' }));
    g.players.alice!.pool.G = 1;
    g = act(g, { type: 'turn_face_up', player: 'alice', object: elf });
    expect(chars(g, g.objects[elf]!)).toMatchObject({ power: 3, toughness: 4 });
  });

  it('disguise: face down it has ward {2} (CR 702.168a)', () => {
    let g = setup();
    g.players.alice!.pool.C = 3;
    const thief = give(g, 'alice', 'Masked Thief', 'hand');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: thief, alt: 'disguise' }));
    expect(hasKeyword(g, g.objects[thief]!, 'ward')).toBe(true);
  });

  it('CR 708.9: a face-down permanent that leaves is revealed; its dies abilities had no chance to trigger', () => {
    let g = setup();
    g.players.alice!.pool.C = 3;
    const ogre = give(g, 'alice', 'Hidden Ogre', 'hand');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: ogre, alt: 'morph' }));
    g = act(g, { type: 'pass', player: 'alice' });
    g.players.bob!.pool.R = 1;
    g = passRound(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Zap', 'hand'), targets: [[{ kind: 'object', object: ogre }]] }));
    expect(g.objects[ogre]!.zone).toBe('graveyard');
    expect(g.objects[ogre]!.faceDown).toBeUndefined();
  });

  it('manifest (CR 701.40a): the top card face down; a creature card can be turned up for its mana cost', () => {
    let g = toStep(start({ extra: CARDS, decks: { alice: Array.from({ length: 40 }, () => 'Hidden Elf'), bob: Array.from({ length: 40 }, () => 'Forest') } }), 'main1');
    g.cards['Reveal Sight'] = CARDS.find((c) => c.name === 'Reveal Sight')!;
    g.players.alice!.pool.G = 1;
    const top = g.zones.library.alice![0]!;
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Reveal Sight', 'hand') }));
    expect(g.objects[top]!).toMatchObject({ zone: 'battlefield', faceDown: 'manifest' });
    // It has megamorph, so that cost works too.
    g.players.alice!.pool.G = 1;
    g = act(g, { type: 'turn_face_up', player: 'alice', object: top });
    expect(nameOf(g, g.objects[top]!)).toBe('Hidden Elf');
  });
});
