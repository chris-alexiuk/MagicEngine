import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOABLE } from '@mtg/schema';
import { chars, type Action, type ChoiceAnswer, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

/**
 * "[Do this]. If you do, [that]." is read once, for whatever this is — so long as the engine can tell it was done
 * (schema DOABLE): that happens only then (CR 608.2c). These sentences are the wordings of cards that had no reader of
 * their own for it (Energy Tap, Charitable Levy, Nyla, Riders of the Mark, Vanish into Memory, Kindle the Carnage,
 * Thief of Existence, Roll-Roll-Roll-Roll).
 */
const CARDS = [
  makeCard({ name: 'Tap In', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Tap target untapped creature you control. If you do, add an amount of {C} equal to that creature's mana value." }),
  makeCard({ name: 'Hold', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Tap target creature.' }),
  makeCard({ name: 'Levy', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever a player casts a noncreature spell, put a collection counter on this enchantment. Then if there are three or more collection counters on it, sacrifice it. If you do, draw a card, then you may search your library for a Plains card, put it onto the battlefield tapped, then shuffle.' }),
  makeCard({ name: 'Sleuth', type_line: 'Creature — Fox', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "When this creature enters, exile up to one target creature card from your graveyard. If you do, you lose X life and create X Clue tokens, where X is that card's mana value." }),
  makeCard({ name: 'Riders', type_line: 'Creature — Human Knight', mana_cost: '{0}', power: '2', toughness: '4', oracle_text: "Haste\nAt the beginning of your end step, if this creature attacked this turn, return it to its owner's hand. If you do, create a number of 1/1 white Human Soldier creature tokens equal to its toughness." }),
  makeCard({ name: 'Vanish', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Exile target creature. You draw cards equal to that creature's power. At the beginning of your next upkeep, return that card to the battlefield under its owner's control. If you do, discard cards equal to that creature's toughness." }),
  makeCard({ name: 'Kindle', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Discard a card at random. If you do, Kindle deals damage equal to that card's mana value to each creature. You may repeat this process any number of times." }),
  makeCard({ name: 'Thief', type_line: 'Creature — Eldrazi', mana_cost: '{0}', power: '3', toughness: '4', oracle_text: 'When you cast this spell, exile up to one target noncreature, nonland permanent an opponent controls with mana value 4 or less. If you do, this creature gains "When this creature leaves the battlefield, target opponent draws a card."' }),
  makeCard({ name: 'Roll', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Exile up to one target creature or land you control. If you do, return it to the battlefield under its owner's control at the beginning of the next end step." }),
  makeCard({ name: 'Trinket', type_line: 'Artifact', mana_cost: '{1}', cmc: 1, oracle_text: '' }),
  makeCard({ name: 'Engine', type_line: 'Artifact', mana_cost: '{3}', cmc: 3, oracle_text: '' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Ox', type_line: 'Creature — Ox', mana_cost: '{3}', cmc: 3, power: '1', toughness: '4', oracle_text: '' }),
  makeCard({ name: 'Wall', type_line: 'Creature — Wall', mana_cost: '{0}', power: '0', toughness: '6', oracle_text: 'Defender' }),
  makeCard({ name: 'Signal', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'You gain 1 life.' }),
  makeCard({ name: 'Slay', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature.' }),
  makeCard({ name: 'Grow', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Put a +1/+1 counter on target creature.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 40 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const main = (): GameState => toStep(start({ extra: CARDS }), 'main1', 'alice');
const at = (object: string) => [[{ kind: 'object' as const, object }]];
const cast = (g: GameState, name: string, more: Partial<Extract<Action, { type: 'cast' }>> = {}, player = 'alice') => settle(act(g, { type: 'cast', player, object: give(g, player, name, 'hand'), ...more }));
const answer = (g: GameState, a: ChoiceAnswer) => settle(act(g, { type: 'choose', player: g.pending!.player, answer: a }));
const tokens = (g: GameState, name: string) => g.zones.battlefield.filter((id) => g.objects[id]!.token && chars(g, g.objects[id]!).name.startsWith(name)).length;
const hand = (g: GameState, p = 'alice') => g.zones.hand[p]!.length;

describe('"[do this]. If you do, [that]", for any instruction the engine can tell was done', () => {
  it('the engine judges each kind of instruction that may be followed by "if you do"', () => {
    const source = readFileSync(new URL('../src/core-plugin.ts', import.meta.url), 'utf8');
    const body = source.slice(source.indexOf('\nfunction feasible('), source.indexOf('\n}\n', source.indexOf('\nfunction feasible(')));
    for (const kind of DOABLE) expect(body.includes(`e.type === '${kind}'`), `feasible doesn't judge ${kind}`).toBe(true);
  });

  it('every card here reads in full', () => {
    expect(CARDS.filter((c) => c.automation !== 'full').map((c) => `${c.name}: ${c.faces[0]!.unparsed.join(' | ')}`)).toEqual([]);
  });

  it('"Tap target untapped creature you control. If you do, add …": only if it was tapped by this', () => {
    let g = main();
    const ox = give(g, 'alice', 'Ox', 'battlefield');
    const done = cast(g, 'Tap In', { targets: at(ox) });
    expect([done.objects[ox]!.tapped, done.players.alice!.pool.C]).toEqual([true, 3]);
    // Tapped in response: it can't be tapped again, so nothing is added.
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Tap In', 'hand'), targets: at(ox) });
    g = cast(g, 'Hold', { targets: at(ox) });
    expect([g.objects[ox]!.tapped, g.players.alice!.pool.C ?? 0]).toEqual([true, 0]);
  });

  it('"Then if there are three or more … counters on it, sacrifice it. If you do, draw a card, then you may search …"', () => {
    let g = main();
    const levy = give(g, 'alice', 'Levy', 'battlefield');
    g = cast(cast(g, 'Signal'), 'Signal');
    const before = hand(g);
    expect([g.objects[levy]!.zone, g.objects[levy]!.counters.collection]).toEqual(['battlefield', 2]);
    g = cast(g, 'Signal');
    // The third: sacrificed, a card drawn, and the search offered.
    expect(g.objects[levy]!.zone).toBe('graveyard');
    expect(hand(g)).toBe(before + 1);
    expect(g.pending).toMatchObject({ kind: 'may', player: 'alice' });
  });

  it('"exile up to one target creature card from your graveyard. If you do, you lose X life and create X Clue tokens, where X is that card\'s mana value"', () => {
    let g = main();
    const bear = give(g, 'alice', 'Bear', 'graveyard');
    const life = g.players.alice!.life;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Sleuth', 'hand') });
    g = settle(g);
    if (g.pending?.kind === 'trigger_targets') g = answer(g, { kind: 'trigger_targets', targets: at(bear) });
    expect(g.objects[bear]!.zone).toBe('exile');
    expect([life - g.players.alice!.life, tokens(g, 'Clue')]).toEqual([2, 2]);
    // With no card chosen, nothing was exiled: no life lost, no Clues.
    let h = main();
    const was = h.players.alice!.life;
    h = act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Sleuth', 'hand') });
    h = settle(h);
    if (h.pending?.kind === 'trigger_targets') h = answer(h, { kind: 'trigger_targets', targets: [[]] });
    expect([was - h.players.alice!.life, tokens(h, 'Clue')]).toEqual([0, 0]);
  });

  it('"return it to its owner\'s hand. If you do, create … tokens equal to its toughness": as it last was on the battlefield (CR 608.2h)', () => {
    let g = main();
    const riders = give(g, 'alice', 'Riders', 'battlefield');
    g = cast(g, 'Grow', { targets: at(riders) });
    g = toStep(g, 'beginning_of_combat', 'alice');
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: riders, target: { kind: 'player', player: 'bob' } }] } });
    g = toStep(g, 'end', 'alice');
    g = settle(g);
    expect(g.objects[riders]!.zone).toBe('hand');
    // 2/4 with a +1/+1 counter: five Soldiers.
    expect(tokens(g, 'Human Soldier')).toBe(5);
  });

  it('with no attack, the end-step ability does nothing', () => {
    let g = main();
    const riders = give(g, 'alice', 'Riders', 'battlefield');
    g = settle(toStep(g, 'end', 'alice'));
    expect([g.objects[riders]!.zone, tokens(g, 'Human Soldier')]).toEqual(['battlefield', 0]);
  });

  it('"At the beginning of your next upkeep, return that card …. If you do, discard cards equal to that creature\'s toughness"', () => {
    let g = main();
    const ox = give(g, 'bob', 'Ox', 'battlefield');
    const before = hand(g);
    g = cast(g, 'Vanish', { targets: at(ox) });
    expect(g.objects[ox]!.zone).toBe('exile');
    expect(hand(g)).toBe(before + 1);
    g = toStep(g, 'upkeep', 'alice');
    g = settle(g);
    expect([g.objects[ox]!.zone, g.objects[ox]!.controller]).toEqual(['battlefield', 'bob']);
    // A 1/4: four cards to discard.
    expect(g.pending).toMatchObject({ kind: 'discard', player: 'alice', count: 4 });
  });

  it('… and if the card is no longer in exile to return, nothing is discarded', () => {
    let g = main();
    const ox = give(g, 'bob', 'Ox', 'battlefield');
    g = cast(g, 'Vanish', { targets: at(ox) });
    // (Test setup: the exiled card is taken out of exile.)
    g.zones.exile = g.zones.exile.filter((id) => id !== ox);
    g.zones.graveyard.bob!.push(ox);
    g.objects[ox]!.zone = 'graveyard';
    g.objects[ox]!.zcc++;
    g = settle(toStep(g, 'upkeep', 'alice'));
    expect(g.objects[ox]!.zone).toBe('graveyard');
    expect(g.pending).toBeNull();
  });

  it('"Discard a card at random. If you do, … damage equal to that card\'s mana value …. You may repeat this process": each time, that time\'s card', () => {
    let g = main();
    const wall = give(g, 'bob', 'Wall', 'battlefield');
    for (const id of [...g.zones.hand.alice!]) {
      g.zones.hand.alice = g.zones.hand.alice!.filter((x) => x !== id);
      g.zones.library.alice!.push(id);
      g.objects[id]!.zone = 'library';
    }
    give(g, 'alice', 'Bear', 'hand');
    give(g, 'alice', 'Engine', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Kindle', 'hand') });
    g = settle(g);
    // One card discarded (2 or 3 damage), and the offer to go again.
    expect(g.pending).toMatchObject({ kind: 'may' });
    const first = g.objects[wall]!.damage;
    expect([2, 3]).toContain(first);
    g = answer(g, { kind: 'may', yes: true });
    // The other card: its own mana value, not the two together — 5 in all on a 0/6.
    expect([g.objects[wall]!.zone, g.objects[wall]!.damage]).toEqual(['battlefield', 5]);
    // With an empty hand nothing is discarded, and nothing more is dealt.
    g = answer(g, { kind: 'may', yes: true });
    expect(g.objects[wall]!.damage).toBe(5);
  });

  it('"When you cast this spell, exile up to one target …. If you do, this creature gains …": the permanent it becomes has it', () => {
    let g = main();
    const trinket = give(g, 'bob', 'Trinket', 'battlefield');
    const thief = give(g, 'alice', 'Thief', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: thief });
    if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: at(trinket) } });
    g = settle(g);
    expect([g.objects[trinket]!.zone, g.objects[thief]!.zone]).toEqual(['exile', 'battlefield']);
    const before = hand(g, 'bob');
    g = cast(g, 'Slay', { targets: at(thief) });
    if (g.pending?.kind === 'trigger_targets') g = answer(g, { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] });
    expect(hand(g, 'bob')).toBe(before + 1);
  });

  it('… and with nothing exiled, it gains nothing', () => {
    let g = main();
    const thief = give(g, 'alice', 'Thief', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: thief });
    if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[]] } });
    g = settle(g);
    const before = hand(g, 'bob');
    g = cast(g, 'Slay', { targets: at(thief) });
    expect([g.objects[thief]!.zone, g.pending, hand(g, 'bob')]).toEqual(['graveyard', null, before]);
  });

  it('"Exile up to one target …. If you do, return it … at the beginning of the next end step"', () => {
    let g = main();
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = cast(g, 'Roll', { targets: at(bear) });
    expect(g.objects[bear]!.zone).toBe('exile');
    g = settle(toStep(g, 'end', 'alice'));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    // None chosen: nothing is set up to return.
    let h = cast(main(), 'Roll', { targets: [[]] });
    expect(h.delayed).toEqual([]);
    h = settle(toStep(h, 'end', 'alice'));
    expect(h.pending).toBeNull();
  });
});
