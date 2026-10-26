import { describe, expect, it } from 'vitest';
import { power, type GameState } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{G}', ...extra });

const CARDS = [
  makeCard({
    name: 'Daywalker // Nightstalker',
    layout: 'transform',
    type_line: 'Creature — Human Werewolf // Creature — Werewolf',
    oracle_text: '',
    mana_cost: '{G}',
    card_faces: [
      { object: 'card_face', name: 'Daywalker', type_line: 'Creature — Human Werewolf', mana_cost: '{G}', power: '2', toughness: '2', oracle_text: 'Daybound' },
      { object: 'card_face', name: 'Nightstalker', type_line: 'Creature — Werewolf', mana_cost: '', power: '4', toughness: '4', oracle_text: 'Nightbound' },
    ],
  } as never),
  card('Watcher', 'Creature — Human', 'Whenever day becomes night or night becomes day, draw a card.', { power: '1', toughness: '1' }),
  card('Dawnkeeper', 'Creature — Human', "If it's neither day nor night, it becomes day as this creature enters.", { power: '1', toughness: '1' }),
  card('Dusk', 'Sorcery', 'It becomes night. Draw a card.'),
  makeCard({
    name: 'Restless Wolf // Restless Beast',
    layout: 'transform',
    type_line: 'Creature — Human Werewolf // Creature — Werewolf',
    oracle_text: '',
    mana_cost: '{G}',
    card_faces: [
      { object: 'card_face', name: 'Restless Wolf', type_line: 'Creature — Human Werewolf', mana_cost: '{G}', power: '2', toughness: '2', oracle_text: 'Daybound' },
      { object: 'card_face', name: 'Restless Beast', type_line: 'Creature — Werewolf', mana_cost: '', power: '4', toughness: '4', oracle_text: 'Nightbound\nAt the beginning of your upkeep, transform this creature.' },
    ],
  } as never),
  card('Night Spell', 'Instant', "This spell costs {2} less to cast if it's night.\nDraw a card.", { mana_cost: '{2}{G}' }),
  card('Steed', 'Creature — Horse Mount', 'Whenever this creature attacks while saddled, it gets +2/+2 until end of turn.\nSaddle 2', { power: '2', toughness: '2' }),
];

function setup(): GameState {
  return toStep(start({ extra: CARDS }), 'main1');
}
const cast = (g: GameState, name: string, extra: Record<string, unknown> = {}) => {
  g.players.alice!.pool.G += 3;
  return passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), ...extra }));
};

describe('CR 731 / CR 702.145: day and night', () => {
  it('a daybound permanent makes it day; no spells on a turn makes it night, two make it day again', () => {
    let g = setup();
    expect(g.dayNight).toBeUndefined();
    g = cast(g, 'Daywalker // Nightstalker');
    const wolf = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Daywalker // Nightstalker')!;
    // CR 702.145d
    expect(g.dayNight).toBe('day');
    // Alice cast a spell this turn, so it stays day into Bob's turn.
    g = toStep(g, 'upkeep', 'bob');
    expect(g.dayNight).toBe('day');
    // Bob casts nothing: at Alice's untap it becomes night and the wolf transforms (CR 702.145b).
    g = toStep(g, 'upkeep', 'alice');
    expect(g.dayNight).toBe('night');
    expect(g.objects[wolf]!.face).toBe(1);
    expect(power(g, g.objects[wolf]!)).toBe(4);
    // Alice casts two spells: at Bob's untap it becomes day (CR 731.2b) and the nightbound side turns back.
    g = toStep(g, 'main1', 'alice');
    g = cast(g, 'Night Spell');
    g = cast(g, 'Night Spell');
    g = toStep(g, 'upkeep', 'bob');
    expect(g.dayNight).toBe('day');
    expect(g.objects[wolf]!.face).toBe(0);
  });

  it('only one spell keeps it night; it enters transformed at night and can’t transform except by daybound', () => {
    let g = setup();
    g.dayNight = 'night';
    g = cast(g, 'Restless Wolf // Restless Beast');
    const wolf = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Restless Wolf // Restless Beast')!;
    // CR 702.145b: it entered transformed.
    expect(g.objects[wolf]!.face).toBe(1);
    // One spell each turn: it stays night (CR 731.2b needs two).
    g = toStep(g, 'main1', 'bob');
    expect(g.dayNight).toBe('night');
    g.players.bob!.pool.G = 3;
    g = passRound(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Night Spell', 'hand') }));
    g = toStep(g, 'upkeep', 'alice');
    expect(g.dayNight).toBe('night');
    // Its own upkeep trigger can't transform it (CR 702.145e).
    while (g.stack.length) g = passRound(g);
    expect(g.objects[wolf]!.face).toBe(1);
  });

  it('"whenever day becomes night or night becomes day" — not when it first becomes day', () => {
    let g = setup();
    give(g, 'alice', 'Watcher', 'battlefield');
    const hand = () => g.zones.hand.alice!.length;
    const before = hand();
    g = cast(g, 'Dawnkeeper');
    expect(g.dayNight).toBe('day');
    while (g.stack.length) g = passRound(g);
    expect(hand()).toBe(before);
    g = cast(g, 'Dusk');
    while (g.stack.length) g = passRound(g);
    // Dusk: one card, plus the Watcher's trigger.
    expect(hand()).toBe(before + 2);
  });

  it('"if it’s night" conditions', () => {
    let g = setup();
    const spell = give(g, 'alice', 'Night Spell', 'hand');
    g.players.alice!.pool.G = 1;
    expect(illegal(g, { type: 'cast', player: 'alice', object: spell })).toBeTruthy();
    g = cast(g, 'Dusk');
    g.players.alice!.pool.G = 1;
    g = passRound(act(g, { type: 'cast', player: 'alice', object: spell }));
    expect(g.objects[spell]!.zone).toBe('graveyard');
  });
});

describe('CR 702.171: saddle', () => {
  it('tap other creatures with total power N: saddled until end of turn; "attacks while saddled"', () => {
    let g = setup();
    const steed = give(g, 'alice', 'Steed', 'battlefield');
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = passRound(act(g, { type: 'activate', player: 'alice', object: steed, ability: 0, costs: { crew: [bears] } }));
    expect(g.objects[bears]!.tapped).toBe(true);
    expect(g.objects[steed]!.saddledTurn).toBe(g.turn);
    g = passRound(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: steed, target: { kind: 'player', player: 'bob' } }] } });
    g = passRound(g);
    expect(power(g, g.objects[steed]!)).toBe(4);
    // Saddled only until end of turn; saddle only as a sorcery.
    g = toStep(g, 'main1', 'bob');
    expect(g.objects[steed]!.saddledTurn).not.toBe(g.turn);
    expect(illegal(g, { type: 'activate', player: 'alice', object: steed, ability: 0, costs: { crew: [bears] } })).toBeTruthy();
  });

  it('an unsaddled attack doesn’t trigger', () => {
    let g = setup();
    const steed = give(g, 'alice', 'Steed', 'battlefield');
    g = passRound(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: steed, target: { kind: 'player', player: 'bob' } }] } });
    expect(g.stack.length).toBe(0);
    expect(power(g, g.objects[steed]!)).toBe(2);
  });
});
