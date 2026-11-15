import { describe, expect, it } from 'vitest';
import { chars, type Action, type ChoiceAnswer, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

/**
 * "[Trigger], if this card is in your graveyard, [effect]" works from the graveyard whatever the trigger is (CR 113.6,
 * 603.4): the condition is read once for every kind of trigger. These are the wordings of Auntie's Snitch, Blood
 * Operative, Bridge from Below, Infesting Radroach, Moss-Pit Skeleton and Pyrewild Shaman.
 */
const CARDS = [
  makeCard({ name: 'Snitch', type_line: 'Creature — Goblin Rogue', mana_cost: '{0}', power: '3', toughness: '1', oracle_text: 'Whenever a Goblin or Rogue you control deals combat damage to a player, if this card is in your graveyard, you may return this card to your hand.' }),
  makeCard({ name: 'Operative', type_line: 'Creature — Vampire', mana_cost: '{0}', power: '3', toughness: '1', oracle_text: 'Whenever you surveil, if this card is in your graveyard, you may pay 3 life. If you do, return this card to your hand.' }),
  makeCard({ name: 'Bridge', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Whenever a nontoken creature is put into your graveyard from the battlefield, if this card is in your graveyard, create a 2/2 black Zombie creature token.\nWhen a creature is put into an opponent's graveyard from the battlefield, if this card is in your graveyard, exile this card." }),
  makeCard({ name: 'Roach', type_line: 'Creature — Insect', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Whenever an opponent mills a nonland card, if this creature is in your graveyard, you may return it to your hand.' }),
  makeCard({ name: 'Skeleton', type_line: 'Creature — Skeleton', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever one or more +1/+1 counters are put on a creature you control, if this card is in your graveyard, you may put this card on top of your library.' }),
  makeCard({ name: 'Shaman', type_line: 'Creature — Shaman', mana_cost: '{0}', power: '3', toughness: '1', oracle_text: 'Whenever one or more creatures you control deal combat damage to a player, if this card is in your graveyard, you may pay {3}. If you do, return this card to your hand.' }),
  makeCard({ name: 'Goblin', type_line: 'Creature — Goblin', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Peek', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Surveil 1.' }),
  makeCard({ name: 'Slay', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature.' }),
  makeCard({ name: 'Grow', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Put a +1/+1 counter on target creature.' }),
  makeCard({ name: 'Grind', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target player mills a card.' }),
  makeCard({ name: 'Summon', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Create a 1/1 white Spirit creature token.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 40 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const main = (): GameState => toStep(start({ extra: CARDS }), 'main1', 'alice');
const at = (object: string) => [[{ kind: 'object' as const, object }]];
const cast = (g: GameState, name: string, more: Partial<Extract<Action, { type: 'cast' }>> = {}, player = 'alice') => settle(act(g, { type: 'cast', player, object: give(g, player, name, 'hand'), ...more }));
const answer = (g: GameState, a: ChoiceAnswer) => settle(act(g, { type: 'choose', player: g.pending!.player, answer: a }));
/** The active player attacks the other with one creature; nothing blocks; combat damage is dealt. */
function hit(g: GameState, attacker: string, defender: string): GameState {
  g = toStep(g, 'beginning_of_combat', g.active);
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  g = act(g, { type: 'choose', player: g.active, answer: { kind: 'declare_attackers', attacks: [{ attacker, target: { kind: 'player', player: defender } }] } });
  for (let i = 0; i < 40 && !g.pending && g.step !== 'main2'; i++) g = act(g, { type: 'pass', player: g.priority! });
  if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks: [] } });
  for (let i = 0; i < 40 && !g.pending && g.step !== 'main2'; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}

describe('"…, if this card is in your graveyard, …": the ability works from there, whatever it triggers on', () => {
  it('every card here reads in full', () => {
    expect(CARDS.filter((c) => c.automation !== 'full').map((c) => `${c.name}: ${c.faces[0]!.unparsed.join(' | ')}`)).toEqual([]);
  });

  it('"Whenever a Goblin or Rogue you control deals combat damage to a player, …, you may return this card to your hand"', () => {
    let g = main();
    const snitch = give(g, 'alice', 'Snitch', 'graveyard');
    const goblin = give(g, 'alice', 'Goblin', 'battlefield');
    g = hit(g, goblin, 'bob');
    expect(g.pending).toMatchObject({ kind: 'may', player: 'alice' });
    g = answer(g, { kind: 'may', yes: true });
    expect(g.objects[snitch]!.zone).toBe('hand');
  });

  it('… not for a creature that is neither, and not from the battlefield', () => {
    let g = main();
    const snitch = give(g, 'alice', 'Snitch', 'graveyard');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = hit(g, bear, 'bob');
    expect([g.pending, g.objects[snitch]!.zone]).toEqual([null, 'graveyard']);
    // On the battlefield the ability doesn't work: its own combat damage brings nothing back.
    let h = main();
    const there = give(h, 'alice', 'Snitch', 'battlefield');
    h = hit(h, there, 'bob');
    expect([h.pending, h.objects[there]!.zone]).toEqual([null, 'battlefield']);
  });

  it('"Whenever you surveil, …, you may pay 3 life. If you do, return this card to your hand"', () => {
    let g = main();
    const operative = give(g, 'alice', 'Operative', 'graveyard');
    const life = g.players.alice!.life;
    g = cast(g, 'Peek');
    if (g.pending?.kind === 'surveil') g = answer(g, { kind: 'surveil', top: g.pending.objects, graveyard: [] });
    expect(g.pending).toMatchObject({ kind: 'pay', player: 'alice' });
    g = answer(g, { kind: 'pay', pay: true });
    expect([g.objects[operative]!.zone, life - g.players.alice!.life]).toEqual(['hand', 3]);
    // The opponent's surveil isn't yours.
    let h = toStep(main(), 'main1', 'bob');
    const theirs = give(h, 'alice', 'Operative', 'graveyard');
    h = cast(h, 'Peek', {}, 'bob');
    if (h.pending?.kind === 'surveil') h = answer(h, { kind: 'surveil', top: h.pending.objects, graveyard: [] });
    expect([h.pending, h.objects[theirs]!.zone]).toEqual([null, 'graveyard']);
  });

  it('"Whenever a nontoken creature is put into your graveyard from the battlefield, …, create a 2/2 black Zombie creature token"', () => {
    let g = main();
    const bridge = give(g, 'alice', 'Bridge', 'graveyard');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const zombies = () => g.zones.battlefield.filter((id) => g.objects[id]!.token && chars(g, g.objects[id]!).subtypes.includes('Zombie')).length;
    g = cast(g, 'Slay', { targets: at(bear) });
    expect([zombies(), g.objects[bridge]!.zone]).toEqual([1, 'graveyard']);
    // A token dying makes none (it's put into the graveyard, but it isn't a nontoken creature).
    g = cast(g, 'Summon');
    const spirit = g.zones.battlefield.find((id) => g.objects[id]!.token && chars(g, g.objects[id]!).subtypes.includes('Spirit'))!;
    g = cast(g, 'Slay', { targets: at(spirit) });
    expect(zombies()).toBe(1);
    // "When a creature is put into an opponent's graveyard from the battlefield, …, exile this card."
    const theirs = give(g, 'bob', 'Bear', 'battlefield');
    g = cast(g, 'Slay', { targets: at(theirs) });
    expect([g.objects[bridge]!.zone, zombies()]).toEqual(['exile', 1]);
  });

  it('"Whenever an opponent mills a nonland card, …, you may return it to your hand"', () => {
    let g = main();
    const roach = give(g, 'alice', 'Roach', 'graveyard');
    // (Test setup: a nonland card on top of Bob's library.)
    const top = give(g, 'bob', 'Bear', 'library');
    g.zones.library.bob = [top, ...g.zones.library.bob!.filter((id) => id !== top)];
    g = cast(g, 'Grind', { targets: [[{ kind: 'player', player: 'bob' }]] });
    expect(g.objects[top]!.zone).toBe('graveyard');
    expect(g.pending).toMatchObject({ kind: 'may', player: 'alice' });
    g = answer(g, { kind: 'may', yes: true });
    expect(g.objects[roach]!.zone).toBe('hand');
    // Her own milling isn't an opponent's.
    let h = main();
    const mine = give(h, 'alice', 'Roach', 'graveyard');
    const card = give(h, 'alice', 'Bear', 'library');
    h.zones.library.alice = [card, ...h.zones.library.alice!.filter((id) => id !== card)];
    h = cast(h, 'Grind', { targets: [[{ kind: 'player', player: 'alice' }]] });
    expect([h.objects[card]!.zone, h.pending, h.objects[mine]!.zone]).toEqual(['graveyard', null, 'graveyard']);
  });

  it('"Whenever one or more +1/+1 counters are put on a creature you control, …, you may put this card on top of your library"', () => {
    let g = main();
    const skeleton = give(g, 'alice', 'Skeleton', 'graveyard');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = cast(g, 'Grow', { targets: at(bear) });
    expect(g.pending).toMatchObject({ kind: 'may', player: 'alice' });
    g = answer(g, { kind: 'may', yes: true });
    expect([g.objects[skeleton]!.zone, g.zones.library.alice![0]]).toEqual(['library', skeleton]);
  });

  it('"Whenever one or more creatures you control deal combat damage to a player, …, you may pay {3}. If you do, return this card to your hand"', () => {
    let g = main();
    const shaman = give(g, 'alice', 'Shaman', 'graveyard');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    for (let i = 0; i < 3; i++) give(g, 'alice', 'Forest', 'battlefield');
    g = hit(g, bear, 'bob');
    expect(g.pending).toMatchObject({ kind: 'pay', player: 'alice', cost: '{3}' });
    g = answer(g, { kind: 'pay', pay: true });
    expect(g.objects[shaman]!.zone).toBe('hand');
  });
});
