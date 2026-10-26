import { describe, expect, it } from 'vitest';
import { power, type GameState, type Target } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{G}', ...extra });
const bear = (name: string, oracle_text: string, pt = '2') => card(name, 'Creature — Bear', oracle_text, { power: pt, toughness: pt });

const CARDS = [
  bear('Forest Seer', 'When this creature enters, if you control a Forest, draw a card.'),
  card('Kicked Blade', 'Instant', 'Kicker {1}\nDestroy target creature. If this spell was kicked, draw a card.'),
  bear('Kicked Bear', 'Kicker {2}\nWhen this creature enters, if it was kicked, put two +1/+1 counters on it.'),
  bear('Persistent Elf', 'Persist'),
  bear('Fleeting Bear', 'When this creature enters, sacrifice it at the beginning of the next end step.'),
  card('Slow Insight', 'Instant', "Draw a card at the beginning of the next turn's upkeep."),
  card('Threaten', 'Sorcery', 'Gain control of target creature until end of turn. Untap that creature. It gains haste until end of turn.'),
  card('Control Magic', 'Enchantment — Aura', 'Enchant creature\nYou control enchanted creature.'),
  card('Lava Coil', 'Sorcery', 'Lava Coil deals 4 damage to target creature. If that creature would die this turn, exile it instead.'),
  bear('Ghostly Bear', 'If this creature would be put into a graveyard from anywhere, exile it instead.'),
  card('Fog', 'Instant', 'Prevent all combat damage that would be dealt this turn.'),
  card('Healing Salve', 'Instant', 'Prevent the next 3 damage that would be dealt to any target this turn.'),
  card('Shock', 'Instant', 'Shock deals 2 damage to any target.'),
  bear('Cannibal', 'When this creature enters, you may sacrifice another creature. If you do, draw two cards.'),
  makeCard({
    name: 'Village Wolf // Howling Wolf',
    layout: 'transform',
    type_line: 'Creature — Human Werewolf // Creature — Werewolf',
    oracle_text: '',
    mana_cost: '{G}',
    card_faces: [
      { object: 'card_face', name: 'Village Wolf', type_line: 'Creature — Human Werewolf', mana_cost: '{G}', power: '2', toughness: '2', oracle_text: 'At the beginning of each upkeep, if no spells were cast last turn, transform this creature.' },
      { object: 'card_face', name: 'Howling Wolf', type_line: 'Creature — Werewolf', mana_cost: '', power: '4', toughness: '4', oracle_text: 'At the beginning of each upkeep, if a player cast two or more spells last turn, transform this creature.' },
    ],
  } as never),
];

function setup(lands = 5): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  for (let i = 0; i < lands; i++) give(g, 'alice', 'Forest', 'battlefield');
  return g;
}
const obj = (object: string): Target => ({ kind: 'object', object });
const castIt = (g: GameState, name: string, extra: Record<string, unknown> = {}) =>
  act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), autoTap: true, ...extra });

describe('conditions (CR 603.4, CR 608.2c)', () => {
  it('CR 603.4: an intervening "if" stops the trigger when it’s false', () => {
    let g = setup();
    const hand = g.zones.hand.alice!.length;
    g = passRound(passRound(castIt(g, 'Forest Seer')));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);

    let h = toStep(start({ extra: CARDS }), 'main1');
    give(h, 'alice', 'Forest', 'battlefield');
    h.cards.Forest = { ...h.cards.Forest!, faces: [{ ...h.cards.Forest!.faces[0]!, subtypes: [] }] }; // no Forest subtype now
    h.objects[h.zones.battlefield[0]!]!.tapped = false;
    const before = h.zones.hand.alice!.length;
    h.players.alice!.pool.G = 1;
    h = passRound(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Forest Seer', 'hand') }));
    expect(h.stack).toEqual([]);
    expect(h.zones.hand.alice!.length).toBe(before);
  });

  it('CR 702.33a / CR 702.33d: kicker is paid on top, and "if it was kicked" sees it', () => {
    let g = setup(3);
    const victim = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = passRound(castIt(g, 'Kicked Blade', { kicked: true, targets: [[obj(victim)]] }));
    expect(g.objects[victim]!.zone).toBe('graveyard');
    expect(g.zones.hand.alice!.length).toBe(hand + 1); // the kicked Blade drew a card
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.tapped)).toHaveLength(2);
  });

  it('a kicked permanent remembers it as it enters', () => {
    let g = setup(3);
    const bearId = give(g, 'alice', 'Kicked Bear', 'hand');
    g = passRound(passRound(act(g, { type: 'cast', player: 'alice', object: bearId, autoTap: true, kicked: true })));
    expect(power(g, g.objects[bearId]!)).toBe(4);
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Grizzly Bears', 'hand'), kicked: true })).toMatch(/kicker/);
  });

  it('CR 702.79a / CR 603.10a: persist returns it once, with a -1/-1 counter', () => {
    let g = setup();
    const elf = give(g, 'alice', 'Persistent Elf', 'battlefield');
    g = passRound(passRound(castIt(g, 'Shock', { targets: [[obj(elf)]] })));
    expect(g.objects[elf]).toMatchObject({ zone: 'battlefield', counters: { '-1/-1': 1 } });
    g = passRound(passRound(castIt(g, 'Shock', { targets: [[obj(elf)]] })));
    expect(g.objects[elf]!.zone).toBe('graveyard');
  });
});

describe('delayed triggers (CR 603.7)', () => {
  it('“sacrifice it at the beginning of the next end step”', () => {
    let g = setup();
    const b = give(g, 'alice', 'Fleeting Bear', 'hand');
    g = passRound(passRound(act(g, { type: 'cast', player: 'alice', object: b, autoTap: true })));
    expect(g.delayed).toHaveLength(1);
    g = toStep(g, 'end');
    expect(g.stack).toMatchObject([{ kind: 'ability', sourceName: 'Fleeting Bear' }]);
    g = passRound(g);
    expect(g.objects[b]!.zone).toBe('graveyard');
    expect(g.delayed).toEqual([]);
  });

  it('“at the beginning of the next turn’s upkeep”', () => {
    let g = setup();
    g = passRound(castIt(g, 'Slow Insight'));
    const hand = g.zones.hand.alice!.length;
    g = toStep(g, 'upkeep', 'bob');
    g = passRound(g);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });
});

describe('control, replacement and prevention', () => {
  it('CR 613.1b: Threaten — control until end of turn, then it goes back', () => {
    let g = setup();
    const theirs = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g.objects[theirs]!.tapped = true;
    g = passRound(castIt(g, 'Threaten', { targets: [[obj(theirs)]] }));
    expect(g.objects[theirs]).toMatchObject({ controller: 'alice', tapped: false });
    g = passRound(toStep(g, 'beginning_of_combat'));
    expect(g.pending).toMatchObject({ kind: 'declare_attackers', attackers: [theirs] });
    g = toStep(act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [] } }), 'upkeep', 'bob');
    expect(g.objects[theirs]!.controller).toBe('bob');
  });

  it('Control Magic: control lasts while it’s attached', () => {
    let g = setup();
    const theirs = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const aura = give(g, 'alice', 'Control Magic', 'hand');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: aura, autoTap: true, targets: [[obj(theirs)]] }));
    expect(g.objects[theirs]!.controller).toBe('alice');
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: aura, to: 'graveyard' } });
    expect(g.objects[theirs]!.controller).toBe('bob');
  });

  it('CR 614.1a: “if that creature would die this turn, exile it instead”', () => {
    let g = setup();
    const theirs = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = passRound(castIt(g, 'Lava Coil', { targets: [[obj(theirs)]] }));
    expect(g.objects[theirs]!.zone).toBe('exile');
  });

  it('CR 614.1a: “if this would be put into a graveyard from anywhere, exile it instead”', () => {
    let g = setup();
    const ghost = give(g, 'alice', 'Ghostly Bear', 'battlefield');
    g = passRound(castIt(g, 'Shock', { targets: [[obj(ghost)]] }));
    expect(g.objects[ghost]!.zone).toBe('exile');
  });

  it('CR 615.7: “prevent the next 3 damage” is a shield that gets used up', () => {
    let g = setup();
    g = passRound(castIt(g, 'Healing Salve', { targets: [[{ kind: 'player', player: 'alice' }]] }));
    g = passRound(castIt(g, 'Shock', { targets: [[{ kind: 'player', player: 'alice' }]] }));
    expect(g.players.alice!.life).toBe(20);
    g = passRound(castIt(g, 'Shock', { targets: [[{ kind: 'player', player: 'alice' }]] }));
    expect(g.players.alice!.life).toBe(19);
  });

  it('CR 615.1a: Fog prevents all combat damage this turn', () => {
    let g = setup();
    const attacker = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = passRound(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker, target: { kind: 'player', player: 'bob' } }] } });
    g = passRound(castIt(g, 'Fog'));
    g = toStep(g, 'end_of_combat');
    expect(g.players.bob!.life).toBe(20);
  });

  it('CR 118.12: “you may sacrifice another creature. If you do…” — not offered without one', () => {
    let g = setup();
    const hand = g.zones.hand.alice!.length;
    g = passRound(passRound(castIt(g, 'Cannibal')));
    expect(g.pending).toBeNull();
    expect(g.zones.hand.alice!.length).toBe(hand);
    give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = passRound(passRound(castIt(g, 'Cannibal')));
    expect(g.pending).toMatchObject({ kind: 'may' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    expect(g.pending).toMatchObject({ kind: 'sacrifice' });
  });

  it('werewolves transform when no spells were cast last turn', () => {
    let g = setup();
    const wolf = give(g, 'alice', 'Village Wolf // Howling Wolf', 'battlefield');
    g = toStep(g, 'upkeep', 'bob');
    // Alice didn't cast anything on her turn.
    g = passRound(g);
    expect(g.objects[wolf]!.face).toBe(1);
  });
});
