import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId } from '../src/index.js';
import { act, give, makeCard, passRound, start, toStep } from './helpers.js';

/**
 * One description of "which damage" for every static ability that names damage (schema DamageFilter, damage-filter.ts):
 * the cards here each use one part of it.
 */
const card = (name: string, type_line: string, oracle_text: string, more: Record<string, string> = {}) => makeCard({ name, type_line, oracle_text, mana_cost: '{0}', ...more });
const CARDS = [
  card('Bolt', 'Instant', 'Bolt deals 2 damage to any target.'),
  card('Ping', 'Creature — Wizard', '{T}: This creature deals 1 damage to any target.', { power: '1', toughness: '1' }),
  card('Castigator', 'Creature — Angel', 'If a source would deal damage to you, it deals double that damage to you instead.\nIf a source would deal damage to this creature, it deals double that damage to this creature instead.', { power: '4', toughness: '9' }),
  card('Torbran', 'Legendary Creature — Dwarf', 'If a red source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 2 instead.', { power: '2', toughness: '4' }),
  card('Duo', 'Creature — Devil', 'If a source would deal damage to an opponent, it deals double that damage to that player instead.', { power: '3', toughness: '3' }),
  card('Curse', 'Enchantment — Aura Curse', 'Enchant player\nIf a source would deal damage to enchanted player, it deals double that damage to that player instead.'),
  card('Drums', 'Enchantment — Aura', 'Enchant creature\nIf enchanted creature would deal combat damage to a permanent or player, it deals double that damage instead.'),
  card('Chasm', 'Land', 'Prevent all damage that would be dealt to you.'),
  card('Field', 'Enchantment', "Prevent all damage that would be dealt to you by sources you don't control."),
  card('Gaseous', 'Enchantment — Aura', 'Enchant creature\nPrevent all combat damage that would be dealt to and dealt by enchanted creature.'),
  card('Furrier', 'Creature — Goblin', 'Prevent all damage that this creature would deal to snow creatures.\n{T}: This creature deals 1 damage to any target.', { power: '2', toughness: '2' }),
  card('Yeti', 'Snow Creature — Yeti', '', { power: '3', toughness: '3' }),
  card('Giant', 'Creature — Giant', 'All damage that would be dealt to you and other permanents you control is dealt to this creature instead.', { power: '2', toughness: '7' }),
  card('Beast', 'Creature — Beast', "Combat damage that would be dealt by creatures you control can't be prevented.", { power: '4', toughness: '4' }),
  card('Fog', 'Instant', 'Prevent all combat damage that would be dealt this turn.'),
];
const board = () => toStep(start({ extra: CARDS }), 'main1');
const red = (g: GameState, name: string) => {
  g.cards[name] = { ...g.cards[name]!, faces: [{ ...g.cards[name]!.faces[0]!, colors: ['R'] }] };
};
const cast = (g: GameState, player: PlayerId, name: string, target: string | PlayerId): GameState => {
  const id = give(g, player, name, 'hand');
  const targets = [[g.players[target] ? { kind: 'player' as const, player: target } : { kind: 'object' as const, object: target }]];
  return passRound(act(g, { type: 'cast', player, object: id, autoTap: true, targets }));
};
const ping = (g: GameState, player: PlayerId, source: string, target: string | PlayerId): GameState =>
  passRound(act(g, { type: 'activate', player, object: source, ability: 0, targets: [[g.players[target] ? { kind: 'player' as const, player: target } : { kind: 'object' as const, object: target }]] }));

describe('which damage', () => {
  it('"to you" / "to this creature": the player with the ability, the permanent with it — and no other', () => {
    let g = board();
    const angel = give(g, 'alice', 'Castigator', 'battlefield');
    const bear = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = cast(g, 'alice', 'Bolt', 'alice');
    expect(g.players.alice!.life).toBe(16);
    g = cast(g, 'alice', 'Bolt', 'bob');
    expect(g.players.bob!.life).toBe(18);
    g = cast(g, 'alice', 'Bolt', angel);
    expect(g.objects[angel]!.damage).toBe(4);
    g = cast(g, 'alice', 'Bolt', bear);
    expect(g.objects[bear]!.zone).toBe('graveyard');
  });

  it('"a red source you control … to an opponent or a permanent an opponent controls": the source, and both kinds of recipient', () => {
    let g = board();
    red(g, 'Bolt');
    give(g, 'alice', 'Torbran', 'battlefield');
    const theirs = give(g, 'bob', 'Castigator', 'battlefield');
    const mine = give(g, 'alice', 'Yeti', 'battlefield');
    // To Bob, whose Castigator doubles what is dealt to him: doubled, then plus 2 — the order that leaves him the least
    // (plus 2, then doubled, would be 8).
    g = cast(g, 'alice', 'Bolt', 'bob');
    expect(g.players.bob!.life).toBe(14);
    // To the Castigator itself: the same.
    g = cast(g, 'alice', 'Bolt', theirs);
    expect(g.objects[theirs]!.damage).toBe(6);
    // My own creature, and myself: not an opponent's.
    g = cast(g, 'alice', 'Bolt', mine);
    expect(g.objects[mine]!.damage).toBe(2);
    g = cast(g, 'alice', 'Bolt', 'alice');
    expect(g.players.alice!.life).toBe(18);
    // A source that isn't red: only the Castigator's doubling.
    const wizard = give(g, 'alice', 'Ping', 'battlefield');
    g = ping(g, 'alice', wizard, 'bob');
    expect(g.players.bob!.life).toBe(12);
  });

  it('"to an opponent": the player, not their permanents; "to enchanted player": that one', () => {
    let g = board();
    give(g, 'alice', 'Duo', 'battlefield');
    const theirs = give(g, 'bob', 'Yeti', 'battlefield');
    g = cast(g, 'alice', 'Bolt', 'bob');
    expect(g.players.bob!.life).toBe(16);
    g = cast(g, 'alice', 'Bolt', theirs);
    expect(g.objects[theirs]!.damage).toBe(2);

    let h = board();
    const curse = give(h, 'alice', 'Curse', 'battlefield');
    h.objects[curse]!.attachedToPlayer = 'bob';
    h = cast(h, 'alice', 'Bolt', 'bob');
    expect(h.players.bob!.life).toBe(16);
    h = cast(h, 'alice', 'Bolt', 'alice');
    expect(h.players.alice!.life).toBe(18);
  });

  it('"by sources you don\'t control": whose source it is', () => {
    let g = board();
    give(g, 'alice', 'Field', 'battlefield');
    g = cast(g, 'alice', 'Bolt', 'alice');
    expect(g.players.alice!.life).toBe(18);
    g = toStep(g, 'main1', 'bob');
    g = cast(g, 'bob', 'Bolt', 'alice');
    expect(g.players.alice!.life).toBe(18);
  });

  it('"that this creature would deal to snow creatures": its own damage, to those', () => {
    let g = board();
    const goblin = give(g, 'alice', 'Furrier', 'battlefield');
    const yeti = give(g, 'bob', 'Yeti', 'battlefield');
    const bear = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = ping(g, 'alice', goblin, yeti);
    expect(g.objects[yeti]!.damage).toBe(0);
    g.objects[goblin]!.tapped = false;
    g = ping(g, 'alice', goblin, bear);
    expect(g.objects[bear]!.damage).toBe(1);
    // Another source's damage to the Yeti is dealt.
    g = cast(g, 'alice', 'Bolt', yeti);
    expect(g.objects[yeti]!.damage).toBe(2);
  });

  it('"to you and other permanents you control is dealt to this creature instead": the player and the filter, either', () => {
    let g = board();
    const giant = give(g, 'alice', 'Giant', 'battlefield');
    const bear = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    const theirs = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = cast(g, 'alice', 'Bolt', 'alice');
    g = cast(g, 'alice', 'Bolt', bear);
    expect([g.players.alice!.life, g.objects[bear]!.damage, g.objects[giant]!.damage]).toEqual([20, 0, 4]);
    g = cast(g, 'alice', 'Bolt', theirs);
    expect(g.objects[theirs]!.zone).toBe('graveyard');
    expect(g.objects[giant]!.damage).toBe(4);
  });
});
