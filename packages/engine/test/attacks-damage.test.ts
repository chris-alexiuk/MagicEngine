import { describe, expect, it } from 'vitest';
import { legalActions, viewFor, type Action, type GameState } from '../src/index.js';
import { attackers, attacksBy, attacksMade, combatHits, damageDealt, damageTaken, dealtBy, discards } from '../src/history.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

/**
 * The attacks made, the damage dealt and the cards discarded this turn are kept in the turn's history (src/history.ts),
 * each with what it was about as it then was — the creature as it attacked, the source as it dealt the damage — and
 * the questions about them are asked of that. Here: what the history holds after real plays, and the questions whose
 * answer depends on what a thing was rather than on what has become of it.
 */
const CARDS = [
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{3}{R}', cmc: 4, power: '4', toughness: '4', oracle_text: '' }),
  makeCard({ name: 'Zap', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Zap deals 2 damage to any target.' }),
  makeCard({ name: 'Alarm', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Create two 1/1 white Soldier creature tokens.' }),
  makeCard({ name: 'Tirith', type_line: 'Land', oracle_text: '{T}: Draw a card. Activate only if you attacked with two or more creatures this turn.' }),
  makeCard({ name: 'First', type_line: 'Creature — Human Knight', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Haste\nWhenever this creature attacks for the first time each turn, you gain 1 life.' }),
  makeCard({ name: 'Seize', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'After this main phase, there is an additional combat phase followed by an additional main phase.' }),
  makeCard({ name: 'Blink', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Exile target creature, then return it to the battlefield under its owner's control." }),
  makeCard({ name: 'Rummage', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Discard a card.' }),
  makeCard({ name: 'Spear', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}: Destroy target creature that dealt damage to you this turn.' }),
  makeCard({ name: 'Alchemist', type_line: 'Creature — Human Wizard', mana_cost: '{1}{U}', cmc: 2, power: '1', toughness: '2', oracle_text: 'Morph {U} (You may cast this card face down as a 2/2 creature for {3}. Turn it face up any time for its morph cost.)' }),
];

const main = (who = 'alice'): GameState => toStep(start({ extra: CARDS }), 'main1', who);
const at = (object: string) => [[{ kind: 'object' as const, object }]];
function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const cast = (g: GameState, name: string, more: Partial<Extract<Action, { type: 'cast' }>> = {}, who = 'alice') => settle(act(g, { type: 'cast', player: who, object: give(g, who, name, 'hand'), ...more }));
/** From a main phase: to the declare-attackers choice, and these attack the other player. */
function attackWith(g: GameState, ids: string[]): GameState {
  for (let i = 0; i < 20 && g.pending?.kind !== 'declare_attackers'; i++) g = act(g, { type: 'pass', player: g.priority! });
  const by = (g.pending as { player: string }).player;
  return act(g, { type: 'choose', player: by, answer: { kind: 'declare_attackers', attacks: ids.map((attacker) => ({ attacker, target: { kind: 'player', player: by === 'alice' ? 'bob' : 'alice' } })) } } as never);
}
/** Combat played out to the main phase after it, with these blocks. */
function finishCombat(g: GameState, blocks: { blocker: string; attacker: string }[] = []): GameState {
  for (let i = 0; i < 120 && g.step !== 'main2'; i++) {
    if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks } } as never);
    else if (g.pending) break;
    else g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
}

describe('the attacks made and the damage dealt this turn, each with what it was', () => {
  it('who attacked whom with what; who was dealt how much by what — this turn and the last', () => {
    let g = main();
    const [bear, ogre] = [give(g, 'alice', 'Bear', 'battlefield'), give(g, 'alice', 'Ogre', 'battlefield')];
    g = cast(g, 'Zap', { targets: [[{ kind: 'player', player: 'bob' }]] });
    g = finishCombat(attackWith(g, [bear, ogre]));
    expect(attacksMade(g).map((a) => [a.attacker, a.target, a.by, a.was?.types, a.was?.subtypes, a.was?.zcc])).toEqual([
      [bear, { kind: 'player', player: 'bob' }, 'alice', ['Creature'], ['Bear'], g.objects[bear]!.zcc],
      [ogre, { kind: 'player', player: 'bob' }, 'alice', ['Creature'], ['Ogre'], g.objects[ogre]!.zcc],
    ]);
    expect(damageDealt(g).map((d) => [d.to, d.amount, d.combat, d.was?.types.join()])).toEqual([
      [{ kind: 'player', player: 'bob' }, 2, false, 'Instant'],
      [{ kind: 'player', player: 'bob' }, 2, true, 'Creature'],
      [{ kind: 'player', player: 'bob' }, 4, true, 'Creature'],
    ]);
    expect([damageTaken(g, 'bob'), damageTaken(g, 'bob', false, undefined, true), damageTaken(g, 'alice')]).toEqual([8, 2, 0]);
    expect(combatHits(g).map((h) => [h.player, h.source, h.was.controller])).toEqual([['bob', bear, 'alice'], ['bob', ogre, 'alice']]);
    expect([dealtBy(g, g.objects[ogre]!).length, attacksBy(g, g.objects[ogre]!).length]).toEqual([1, 1]);
    g = toStep(g, 'upkeep', 'bob');
    expect([attacksMade(g).length, damageDealt(g).length, attacksMade(g, true).length, damageTaken(g, 'bob', true)]).toEqual([0, 0, 2, 8]);
  });

  it('a card discarded, as the object it became', () => {
    let g = main();
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Rummage', 'hand') });
    g = settle(g);
    const card = g.zones.hand.alice![0]!;
    if (g.pending) g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: [card] } } as never));
    expect(discards(g)).toEqual([{ id: card, zcc: g.objects[card]!.zcc, player: 'alice' }]);
    expect(g.objects[card]!.zone).toBe('graveyard');
    // Which object it became and whose — not what card it is: no question asks.
    expect(g.history!.find((h) => h.e.type === 'discarded')!.was).toMatchObject({ id: card, controller: 'alice', owner: 'alice', types: [], printed: [] });
  });

  it('a creature attacking face down: nothing in the history says which card it is', () => {
    let g = main();
    const al = give(g, 'alice', 'Alchemist', 'hand');
    g.players.alice!.pool.C = 3;
    g = settle(act(g, { type: 'cast', player: 'alice', object: al, alt: 'morph' }));
    g.objects[al]!.sick = false;
    g = finishCombat(attackWith(g, [al]));
    expect(attacksMade(g)[0]!.was).toMatchObject({ types: ['Creature'], subtypes: [], printed: ['Creature'] });
    expect(damageDealt(g)[0]).toMatchObject({ amount: 2, combat: true, was: { types: ['Creature'], subtypes: [] } });
    expect(JSON.stringify(viewFor(g, 'bob').history)).not.toContain('Alchemist');
  });
});

describe('"if you attacked with two or more creatures this turn"', () => {
  it('counts a creature that attacked and has since died and ceased to exist', () => {
    let g = main();
    const tirith = give(g, 'alice', 'Tirith', 'battlefield');
    g = cast(g, 'Alarm');
    const tokens = g.zones.battlefield.filter((id) => g.objects[id]!.token);
    for (const id of tokens) g.objects[id]!.sick = false;
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    expect(illegal(g, { type: 'activate', player: 'alice', object: tirith, ability: 0 })).toBeTruthy();
    // Both Soldiers attack; the Ogre blocks one and kills it.
    g = finishCombat(attackWith(g, tokens), [{ blocker: ogre, attacker: tokens[0]! }]);
    expect([g.objects[tokens[0]!], g.objects[tokens[1]!]?.zone]).toEqual([undefined, 'battlefield']);
    expect(attackers(attacksMade(g)).length).toBe(2);
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'activate', player: 'alice', object: tirith, ability: 0 }));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('not the other player\'s attackers', () => {
    let g = main('bob');
    const tirith = give(g, 'alice', 'Tirith', 'battlefield');
    const [b1, b2] = [give(g, 'bob', 'Bear', 'battlefield'), give(g, 'bob', 'Bear', 'battlefield')];
    g = finishCombat(attackWith(g, [b1, b2]));
    expect(attackers(attacksMade(g)).map((a) => a.by)).toEqual(['bob', 'bob']);
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === tirith)).toBe(false);
  });
});

describe('what a creature did this turn, it did as that object (CR 400.7)', () => {
  it('"attacks for the first time each turn": exiled and returned, it is a new creature that hasn\'t attacked', () => {
    for (const blink of [false, true]) {
      let g = main();
      const first = give(g, 'alice', 'First', 'battlefield');
      const life = g.players.alice!.life;
      // An additional combat phase, then an additional main phase, before the turn's own combat.
      g = cast(g, 'Seize');
      g = finishCombat(attackWith(g, [first]));
      expect([g.step, g.players.alice!.life - life, attacksBy(g, g.objects[first]!).length]).toEqual(['main2', 1, 1]);
      if (blink) g = cast(g, 'Blink', { targets: at(first) });
      else g.objects[first]!.tapped = false;
      expect(attacksBy(g, g.objects[first]!).length).toBe(blink ? 0 : 1);
      g = finishCombat(attackWith(g, [first]));
      // The same creature attacking again gains nothing; the one that came back is attacking for the first time.
      expect([blink, g.players.alice!.life - life, attacksMade(g).length, attackers(attacksMade(g)).length]).toEqual([blink, blink ? 2 : 1, 2, blink ? 2 : 1]);
    }
  });

  it('"target creature that dealt damage to you this turn": not the creature it is after it left and came back', () => {
    let g = main('bob');
    const spear = give(g, 'alice', 'Spear', 'battlefield');
    const [bear, other] = [give(g, 'bob', 'Bear', 'battlefield'), give(g, 'bob', 'Bear', 'battlefield')];
    g = finishCombat(attackWith(g, [bear]));
    expect(g.players.alice!.life).toBe(18);
    const targets = (h: GameState) => legalActions(act(h, { type: 'pass', player: 'bob' }), 'alice').flatMap((a) => (a.type === 'activate' && a.object === spear ? (a.targets ?? []).flat().map((t) => (t.kind === 'object' ? t.object : '')) : []));
    expect(targets(g)).toEqual([bear]);
    void other;
    g = cast(g, 'Blink', { targets: at(bear) }, 'bob');
    expect(targets(g)).toEqual([]);
  });
});
