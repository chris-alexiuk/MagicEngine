import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DURATIONS, LASTING_EFFECTS } from '@mtg/schema';
import { chars, type GameState } from '../src/index.js';
import { act, actWithEvents, give, makeCard, start, toStep } from './helpers.js';

/**
 * How long an effect lasts is said once for every effect that lasts (schema durations.ts): the grammar reads the words
 * once and the engine ends the effect by them once (duration.ts). So a duration paired with an effect no card pairs it
 * with yet works — these cards' sentences are such pairs.
 */
const CARDS = [
  makeCard({ name: 'Borrow', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Gain control of target creature until your next turn.' }),
  makeCard({ name: 'Borrow Longer', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Gain control of target creature until the end of your next turn.' }),
  makeCard({ name: 'Skirmish', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Gain control of target creature until end of combat.' }),
  makeCard({ name: 'Linger', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Target creature gets +2/+2 until the end of your next turn.' }),
  makeCard({ name: 'Reverse', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Switch target creature's power and toughness until your next turn." }),
  makeCard({ name: 'Swell', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Double the power and toughness of each creature you control until your next turn.' }),
  makeCard({ name: 'Warden', type_line: 'Creature — Human', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'When this creature enters, target land becomes a 3/3 Elemental creature for as long as you control this creature. It\'s still a land.' }),
  makeCard({ name: 'Ox', type_line: 'Creature — Ox', mana_cost: '{0}', power: '1', toughness: '4', oracle_text: '' }),
  // Rubinia Soulsinger's wording, Gaea's Liege's, Shield Broker's, Aven Mimeomancer's, Tamiyo's and Don't Move's.
  makeCard({ name: 'Siren', type_line: 'Creature — Faerie', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'You may choose not to untap this creature during your untap step.\n{T}: Gain control of target creature for as long as you control this creature and this creature remains tapped.' }),
  makeCard({ name: 'Liege', type_line: 'Creature — Avatar', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{T}: Target land becomes a Swamp until this creature leaves the battlefield.' }),
  makeCard({ name: 'Broker', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Put a shield counter on target creature. You gain control of that creature for as long as it has a shield counter on it.' }),
  makeCard({ name: 'Feather', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Put a feather counter on target creature. That creature has base power and toughness 3/1 and has flying for as long as it has a feather counter on it.' }),
  makeCard({ name: 'Pluck', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Remove all counters from target creature.' }),
  makeCard({ name: 'Circle', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Until your next turn, whenever a creature attacks you or a planeswalker you control, it gets -2/-0 until end of turn.' }),
  makeCard({ name: 'Freeze', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Until the end of your next turn, whenever a creature becomes tapped, you gain 1 life.' }),
  makeCard({ name: 'Twiddle', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Untap target permanent.' }),
  makeCard({ name: 'Slay', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature.' }),
  // Makeshift Mannequin's wording and Mathas, Fiend Seeker's: an ability had for as long as the counter is there.
  makeCard({ name: 'Mannequin', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Return target creature card from your graveyard to the battlefield with a mannequin counter on it. For as long as that creature has a mannequin counter on it, it has "When this creature becomes the target of a spell or ability, sacrifice it."' }),
  makeCard({ name: 'Bounty', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Put a bounty counter on target creature an opponent controls. For as long as that creature has a bounty counter on it, it has "When this creature dies, each opponent draws a card and gains 2 life."' }),
  makeCard({ name: 'Grow', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Put a +1/+1 counter on target creature.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 40 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const main = (): GameState => toStep(start({ extra: CARDS }), 'main1', 'alice');

/** From the beginning of combat: the active player attacks `defender` with one creature, and what triggers resolves. */
function attack(g: GameState, attacker: string, defender: string): GameState {
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return settle(act(g, { type: 'choose', player: g.active, answer: { kind: 'declare_attackers', attacks: [{ attacker, target: { kind: 'player', player: defender } }] } }));
}
const cast = (g: GameState, name: string, target?: string, player = 'alice') => settle(act(g, { type: 'cast', player, object: give(g, player, name, 'hand'), ...(target ? { targets: [[{ kind: 'object' as const, object: target }]] } : {}) }));

describe('every effect that lasts takes every duration', () => {
  it('each kind of lasting effect ends what it makes through duration.ts', () => {
    const source = readFileSync(new URL('../src/core-plugin.ts', import.meta.url), 'utf8');
    for (const type of Object.keys(LASTING_EFFECTS)) {
      const start = source.indexOf(`\n  ${type}(node, ctx) {`);
      expect(start, `no handler for ${type}`).toBeGreaterThan(0);
      const body = source.slice(start, source.indexOf('\n  },\n', start));
      expect(/\blasting\(|\blastTurnFor\(/.test(body), `${type} works out its own duration`).toBe(true);
    }
    for (const list of Object.values(LASTING_EFFECTS)) expect(list.every((d) => DURATIONS.includes(d))).toBe(true);
  });

  it('every card here reads in full', () => {
    expect(CARDS.filter((c) => c.automation !== 'full').map((c) => `${c.name}: ${c.faces[0]!.unparsed.join(' | ')}`)).toEqual([]);
  });

  it('"gain control … until your next turn": it ends as that turn begins', () => {
    let g = main();
    const ox = give(g, 'bob', 'Ox', 'battlefield');
    g = cast(g, 'Borrow', ox);
    expect(g.objects[ox]!.controller).toBe('alice');
    // Through the rest of her turn and all of Bob's.
    g = toStep(g, 'end', 'bob');
    expect(g.objects[ox]!.controller).toBe('alice');
    g = toStep(g, 'upkeep', 'alice');
    expect(g.objects[ox]!.controller).toBe('bob');
  });

  it('"… until the end of your next turn": through that turn, gone in its cleanup step', () => {
    let g = main();
    const ox = give(g, 'bob', 'Ox', 'battlefield');
    g = cast(g, 'Borrow Longer', ox);
    g = toStep(g, 'upkeep', 'alice');
    expect(g.objects[ox]!.controller).toBe('alice');
    g = toStep(g, 'end', 'alice');
    expect(g.objects[ox]!.controller).toBe('alice');
    g = toStep(g, 'upkeep', 'bob');
    expect(g.objects[ox]!.controller).toBe('bob');
  });

  it('"… until end of combat"', () => {
    let g = toStep(main(), 'beginning_of_combat', 'alice');
    const ox = give(g, 'bob', 'Ox', 'battlefield');
    g = cast(g, 'Skirmish', ox);
    expect(g.objects[ox]!.controller).toBe('alice');
    g = toStep(g, 'main2', 'alice');
    expect(g.objects[ox]!.controller).toBe('bob');
  });

  it('"+2/+2 until the end of your next turn"', () => {
    let g = main();
    const ox = give(g, 'alice', 'Ox', 'battlefield');
    g = cast(g, 'Linger', ox);
    const size = () => [chars(g, g.objects[ox]!).power, chars(g, g.objects[ox]!).toughness];
    expect(size()).toEqual([3, 6]);
    g = toStep(g, 'main1', 'bob');
    expect(size()).toEqual([3, 6]);
    g = toStep(g, 'end', 'alice');
    expect(size()).toEqual([3, 6]);
    g = toStep(g, 'upkeep', 'bob');
    expect(size()).toEqual([1, 4]);
  });

  it('"switch … until your next turn", "double … until your next turn"', () => {
    let g = main();
    const ox = give(g, 'alice', 'Ox', 'battlefield');
    g = cast(g, 'Reverse', ox);
    const size = () => [chars(g, g.objects[ox]!).power, chars(g, g.objects[ox]!).toughness];
    expect(size()).toEqual([4, 1]);
    // Doubled as it is now, 4/1: +4/+1 (CR 701.10a) — added before the switch (CR 613.4c–d): 5/5, then switched.
    g = cast(g, 'Swell');
    expect(size()).toEqual([5, 5]);
    g = toStep(g, 'end', 'bob');
    expect(size()).toEqual([5, 5]);
    g = toStep(g, 'upkeep', 'alice');
    expect(size()).toEqual([1, 4]);
  });

  it('"becomes … for as long as you control this creature": it ends when you no longer do', () => {
    let g = main();
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    const warden = give(g, 'alice', 'Warden', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: warden });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: forest }]] } });
    g = settle(g);
    const land = () => chars(g, g.objects[forest]!);
    expect([[...land().types].sort(), land().power, land().toughness]).toEqual([['Creature', 'Land'], 3, 3]);
    g = toStep(g, 'main1', 'bob');
    expect(land().types).toContain('Creature');
    // Bob takes the Warden: she no longer controls it.
    g = cast(g, 'Borrow', warden, 'bob');
    expect(g.objects[warden]!.controller).toBe('bob');
    expect(land().types).toEqual(['Land']);
  });

  it('"… for as long as you control this creature and it remains tapped": untapping it ends it, and so does losing it', () => {
    let g = main();
    const ox = give(g, 'bob', 'Ox', 'battlefield');
    const siren = give(g, 'alice', 'Siren', 'battlefield');
    const take = (s: GameState) => settle(act(s, { type: 'activate', player: 'alice', object: siren, ability: 0, targets: [[{ kind: 'object', object: ox }]] }));
    g = take(g);
    expect([g.objects[ox]!.controller, g.objects[siren]!.tapped]).toEqual(['alice', true]);
    // Still hers on Bob's turn: the Siren stays tapped.
    const later = toStep(g, 'main1', 'bob');
    expect(later.objects[ox]!.controller).toBe('alice');
    // Untapped: the Ox goes home.
    const untapped = cast(g, 'Twiddle', siren);
    expect([untapped.objects[siren]!.tapped, untapped.objects[ox]!.controller]).toEqual([false, 'bob']);
    // Bob takes the Siren (still tapped): she no longer controls it, and the Ox goes home.
    const stolen = cast(later, 'Borrow', siren, 'bob');
    expect([stolen.objects[siren]!.controller, stolen.objects[siren]!.tapped, stolen.objects[ox]!.controller]).toEqual(['bob', true, 'bob']);
  });

  it('CR 611.2b: untapped before the ability resolves, and the effect never starts', () => {
    let g = main();
    const ox = give(g, 'bob', 'Ox', 'battlefield');
    const siren = give(g, 'alice', 'Siren', 'battlefield');
    g = act(g, { type: 'activate', player: 'alice', object: siren, ability: 0, targets: [[{ kind: 'object', object: ox }]] });
    const { state, events } = (() => {
      let s = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Twiddle', 'hand'), targets: [[{ kind: 'object', object: siren }]] });
      const seen: string[] = [];
      for (let i = 0; i < 40 && s.stack.length && !s.pending; i++) {
        const r = actWithEvents(s, { type: 'pass', player: s.priority! });
        s = r.state;
        seen.push(...r.events.map((e) => e.type));
      }
      return { state: s, events: seen };
    })();
    expect([state.objects[siren]!.tapped, state.objects[ox]!.controller]).toEqual([false, 'bob']);
    expect(events).not.toContain('control_changed');
    expect(state.effects.filter((e) => e.control)).toEqual([]);
  });

  it('"… until this creature leaves the battlefield"', () => {
    let g = main();
    const forest = give(g, 'bob', 'Forest', 'battlefield');
    const liege = give(g, 'alice', 'Liege', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: liege, ability: 0, targets: [[{ kind: 'object', object: forest }]] }));
    expect(chars(g, g.objects[forest]!).subtypes).toEqual(['Swamp']);
    g = toStep(g, 'main1', 'bob');
    expect(chars(g, g.objects[forest]!).subtypes).toEqual(['Swamp']);
    g = cast(g, 'Slay', liege, 'bob');
    expect(g.objects[liege]!.zone).toBe('graveyard');
    expect(chars(g, g.objects[forest]!).subtypes).toEqual(['Forest']);
  });

  it('"you gain control of that creature for as long as it has a shield counter on it"', () => {
    let g = main();
    const ox = give(g, 'bob', 'Ox', 'battlefield');
    g = cast(g, 'Broker', ox);
    expect([g.objects[ox]!.controller, g.objects[ox]!.counters.shield]).toEqual(['alice', 1]);
    g = toStep(g, 'main1', 'alice');
    expect(g.objects[ox]!.controller).toBe('alice');
    g = cast(g, 'Pluck', ox);
    expect([g.objects[ox]!.controller, g.objects[ox]!.counters.shield ?? 0]).toEqual(['bob', 0]);
  });

  it('"… has base power and toughness 3/1 and has flying for as long as it has a feather counter on it"', () => {
    let g = main();
    const ox = give(g, 'alice', 'Ox', 'battlefield');
    g = cast(g, 'Feather', ox);
    const is = () => { const c = chars(g, g.objects[ox]!); return [c.power, c.toughness, c.keywords.map((k) => k.id)]; };
    expect(is()).toEqual([3, 1, ['flying']]);
    g = toStep(g, 'main1', 'alice');
    expect(is()).toEqual([3, 1, ['flying']]);
    g = cast(g, 'Pluck', ox);
    expect(is()).toEqual([1, 4, []]);
  });

  it('"until your next turn, whenever a creature attacks you …": on each opponent\'s turn, and no longer once yours begins', () => {
    let g = main();
    const ox = give(g, 'bob', 'Ox', 'battlefield');
    const mine = give(g, 'alice', 'Ox', 'battlefield');
    g = cast(g, 'Circle');
    expect(g.turnTriggers?.length).toBe(1);
    g = attack(toStep(g, 'beginning_of_combat', 'bob'), ox, 'alice');
    expect(chars(g, g.objects[ox]!).power).toBe(-1);
    // Her next turn: the ability is gone, and her own attack isn't one on her anyway.
    g = toStep(g, 'upkeep', 'alice');
    expect(g.turnTriggers ?? []).toEqual([]);
    expect(chars(g, g.objects[mine]!).power).toBe(1);
  });

  it('"until the end of your next turn, whenever …": through that turn', () => {
    let g = main();
    const ox = give(g, 'alice', 'Ox', 'battlefield');
    g = cast(g, 'Freeze');
    const life = () => g.players.alice!.life;
    const before = life();
    g = toStep(g, 'main1', 'bob');
    g = attack(toStep(g, 'beginning_of_combat', 'alice'), ox, 'bob');
    expect(life()).toBe(before + 1);
    g = toStep(g, 'upkeep', 'bob');
    expect(g.turnTriggers ?? []).toEqual([]);
  });

  it('"For as long as that creature has a mannequin counter on it, it has …": the creature the card became', () => {
    let g = main();
    const ox = give(g, 'alice', 'Ox', 'graveyard');
    g = cast(g, 'Mannequin', ox);
    expect([g.objects[ox]!.zone, g.objects[ox]!.counters.mannequin]).toEqual(['battlefield', 1]);
    expect(chars(g, g.objects[ox]!).keywords.map((k) => k.id)).toEqual(['ability']);
    // Targeted: sacrificed.
    g = cast(g, 'Grow', ox);
    expect(g.objects[ox]!.zone).toBe('graveyard');
  });

  it('"For as long as that creature has a bounty counter on it, it has …": gone with the counter', () => {
    const marked = (): [GameState, string, number, number] => {
      const g = main();
      const ox = give(g, 'bob', 'Ox', 'battlefield');
      const h = cast(g, 'Bounty', ox);
      return [h, ox, h.zones.hand.alice!.length, h.players.alice!.life];
    };
    // Its controller's opponent — she — draws a card and gains 2 life.
    let [g, ox, cards, life] = marked();
    g = cast(g, 'Slay', ox);
    expect([g.zones.hand.alice!.length - cards, g.players.alice!.life - life]).toEqual([1, 2]);
    // Without the counter it has no such ability.
    [g, ox, cards, life] = marked();
    g = cast(g, 'Pluck', ox);
    expect(chars(g, g.objects[ox]!).keywords).toEqual([]);
    g = cast(g, 'Slay', ox);
    expect([g.objects[ox]!.zone, g.zones.hand.alice!.length - cards, g.players.alice!.life - life]).toEqual(['graveyard', 0, 0]);
  });
});
