import { describe, expect, it } from 'vitest';
import { hasKeyword, power, type GameState } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{G}', ...extra });
const creature = (name: string, text: string, pt: string, subtype = 'Beast') =>
  card(name, `Creature — ${subtype}`, text, { power: pt.split('/')[0], toughness: pt.split('/')[1] });

const CARDS = [
  card('Prey', 'Sorcery', "Target creature you control fights target creature you don't control."),
  card('Bite', 'Instant', "Target creature you control deals damage equal to its power to target creature you don't control."),
  card('Wither Away', 'Instant', 'Kicker {2}\nTarget creature gets -2/-2 until end of turn. If this spell was kicked, that creature gets -5/-5 until end of turn instead.'),
  card('Searing', 'Instant', 'This spell deals 3 damage to target creature. If a creature dealt damage this way would die this turn, exile it instead.', { mana_cost: '{R}' }),
  card('Grave Bargain', 'Sorcery', 'As an additional cost to cast this spell, exile a creature card from your graveyard.\nDraw two cards.'),
  card('Two Cards', 'Sorcery', 'Draw two cards.'),
  card('One Card', 'Sorcery', 'Draw a card.'),
  card('Trampling Banner', 'Enchantment', 'Each creature you control with a +1/+1 counter on it has trample.'),
  card('Bounce Grove', 'Land', "When this land enters, return a land you control to its owner's hand.", { mana_cost: '' }),
  creature('Big Beast', '', '3/3'),
  creature('Kicked Hydra', 'Multikicker {1}\nThis creature enters with a +1/+1 counter on it for each time it was kicked.', '0/0'),
  creature('Ally Leader', 'Whenever this creature or another Ally you control enters, put a +1/+1 counter on this creature.', '1/1', 'Human Ally'),
  creature('Ally Scout', '', '1/1', 'Elf Ally'),
  creature('Scholar', 'Whenever you draw your second card each turn, put a +1/+1 counter on this creature.', '1/1'),
  creature('Stinger', 'Whenever this creature deals combat damage to a creature, destroy that creature.', '1/1'),
  creature('Charger', "This creature has first strike as long as it's attacking.", '2/2'),
];
const bob = { kind: 'player' as const, player: 'bob' };
const obj = (object: string) => ({ kind: 'object' as const, object });

function setup(): GameState {
  return toStep(start({ extra: CARDS }), 'main1');
}
const cast = (g: GameState, name: string, extra: Record<string, unknown> = {}) => {
  g.players.alice!.pool.G += 6;
  g.players.alice!.pool.R += 1;
  return passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), ...extra }));
};

describe('CR 701.14: fight', () => {
  it('each deals damage equal to its power to the other', () => {
    let g = setup();
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    const beast = give(g, 'bob', 'Big Beast', 'battlefield');
    g = cast(g, 'Prey', { targets: [[obj(bears)], [obj(beast)]] });
    expect(g.objects[bears]!.zone).toBe('graveyard');
    expect(g.objects[beast]!).toMatchObject({ zone: 'battlefield', damage: 2 });
  });

  it('“deals damage equal to its power”: only one way', () => {
    let g = setup();
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    const theirs = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = cast(g, 'Bite', { targets: [[obj(bears)], [obj(theirs)]] });
    expect(g.objects[theirs]!.zone).toBe('graveyard');
    expect(g.objects[bears]!).toMatchObject({ zone: 'battlefield' });
    expect(g.objects[bears]!.damage ?? 0).toBe(0);
  });
});

describe('“… instead” and other one-line patterns', () => {
  it('“If this spell was kicked, that creature gets -5/-5 instead” (CR 608.2c)', () => {
    let g = setup();
    const a = give(g, 'bob', 'Big Beast', 'battlefield');
    const b = give(g, 'bob', 'Big Beast', 'battlefield');
    g = cast(g, 'Wither Away', { targets: [[obj(a)]] });
    expect(power(g, g.objects[a]!)).toBe(1);
    g = cast(g, 'Wither Away', { targets: [[obj(b)]], kicked: true });
    expect(g.objects[b]!.zone).toBe('graveyard');
  });

  it('“If a creature dealt damage this way would die this turn, exile it instead” (CR 614.1a)', () => {
    let g = setup();
    const theirs = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = cast(g, 'Searing', { targets: [[obj(theirs)]] });
    expect(g.objects[theirs]!.zone).toBe('exile');
  });

  it('CR 702.33c: multikicker — kicked any number of times', () => {
    let g = setup();
    g.players.alice!.pool.C = 3;
    g = cast(g, 'Kicked Hydra', { kicked: 3 });
    const hydra = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Kicked Hydra')!;
    expect(g.objects[hydra]!.counters['+1/+1']).toBe(3);
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Wither Away', 'hand'), kicked: 2, targets: [[obj(hydra)]] })).toMatch(/only once/);
  });

  it('“exile a creature card from your graveyard” as an additional cost', () => {
    let g = setup();
    const dead = give(g, 'alice', 'Grizzly Bears', 'graveyard');
    const land = give(g, 'alice', 'Forest', 'graveyard');
    const spell = give(g, 'alice', 'Grave Bargain', 'hand');
    g.players.alice!.pool.G = 1;
    expect(illegal(g, { type: 'cast', player: 'alice', object: spell, costs: { exile: [land] } })).toBeTruthy();
    g = passRound(act(g, { type: 'cast', player: 'alice', object: spell, costs: { exile: [dead] } }));
    expect(g.objects[dead]!.zone).toBe('exile');
  });

  it('“each creature you control with a +1/+1 counter on it”', () => {
    let g = setup();
    give(g, 'alice', 'Trampling Banner', 'battlefield');
    const a = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    const b = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g.objects[a]!.counters['+1/+1'] = 1;
    expect(hasKeyword(g, g.objects[a]!, 'trample')).toBe(true);
    expect(hasKeyword(g, g.objects[b]!, 'trample')).toBe(false);
  });

  it('“return a land you control to its owner’s hand” — chosen, not targeted', () => {
    let g = setup();
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    g = act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Bounce Grove', 'hand') });
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'choose_objects', player: 'alice' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [forest] } });
    expect(g.objects[forest]!.zone).toBe('hand');
  });

  it('“Whenever ~ or another Ally you control enters”', () => {
    let g = setup();
    g = cast(g, 'Ally Leader');
    const leader = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Ally Leader')!;
    while (g.stack.length) g = passRound(g);
    expect(g.objects[leader]!.counters['+1/+1']).toBe(1);
    g = cast(g, 'Ally Scout');
    while (g.stack.length) g = passRound(g);
    g = cast(g, 'Big Beast');
    while (g.stack.length) g = passRound(g);
    expect(g.objects[leader]!.counters['+1/+1']).toBe(2);
  });

  it('“Whenever you draw your second card each turn”', () => {
    let g = setup();
    const scholar = give(g, 'alice', 'Scholar', 'battlefield');
    g = cast(g, 'Two Cards');
    while (g.stack.length) g = passRound(g);
    expect(g.objects[scholar]!.counters['+1/+1']).toBe(1);
    g = cast(g, 'One Card');
    while (g.stack.length) g = passRound(g);
    expect(g.objects[scholar]!.counters['+1/+1']).toBe(1);
  });

  it('“deals combat damage to a creature” and “as long as it’s attacking”', () => {
    let g = setup();
    const stinger = give(g, 'alice', 'Stinger', 'battlefield');
    const charger = give(g, 'alice', 'Charger', 'battlefield');
    const beast = give(g, 'bob', 'Big Beast', 'battlefield');
    expect(hasKeyword(g, g.objects[charger]!, 'first_strike')).toBe(false);
    g = passRound(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [stinger, charger].map((attacker) => ({ attacker, target: bob })) } });
    expect(hasKeyword(g, g.objects[charger]!, 'first_strike')).toBe(true);
    g = passRound(g);
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: beast, attacker: stinger }] } });
    for (let i = 0; i < 6 && g.objects[beast]!.zone === 'battlefield'; i++) g = passRound(g);
    expect(g.objects[beast]!.zone).toBe('graveyard');
  });
});
