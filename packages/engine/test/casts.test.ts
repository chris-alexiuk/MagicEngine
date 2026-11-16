import { describe, expect, it } from 'vitest';
import { chars, legalActions, viewFor, type Action, type GameEvent, type GameState } from '../src/index.js';
import { casts, lifeChange, lifeChanged } from '../src/history.js';
import { act, actWithEvents, give, illegal, makeCard, start, toStep } from './helpers.js';

/**
 * The spells cast this turn are kept in the turn's history (src/history.ts), each as it was cast and in the order
 * they were cast, and every question about them is asked of that: storm's "each spell cast before it", "your second
 * spell each turn", "if you've cast another blue spell this turn", "can't cast more than one spell each turn". Here:
 * what the history holds after real plays, and the questions whose answer depends on the spell as it was cast rather
 * than on what its card has become since.
 */
const CARDS = [
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Entity', type_line: 'Creature — Elemental', mana_cost: '{1}{R}', cmc: 2, power: '1', toughness: '1', oracle_text: 'This creature enters with a +1/+1 counter on it for each other spell cast this turn.' }),
  makeCard({ name: 'Zap', type_line: 'Instant', mana_cost: '{R}', cmc: 1, oracle_text: 'Zap deals 2 damage to any target.' }),
  makeCard({ name: 'Crackle', type_line: 'Sorcery', mana_cost: '{X}{R}', cmc: 1, oracle_text: 'Crackle deals X damage to any target.' }),
  makeCard({ name: 'Salve', type_line: 'Instant', mana_cost: '{W}', cmc: 1, oracle_text: 'You gain 3 life.' }),
  makeCard({ name: 'Recall', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Return target creature to its owner's hand." }),
  makeCard({ name: 'Slay', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature.' }),
  makeCard({ name: 'Grapeshot Lite', type_line: 'Sorcery', mana_cost: '{R}', cmc: 1, oracle_text: 'Grapeshot Lite deals 1 damage to any target.\nStorm' }),
  makeCard({
    name: 'Bonecrusher Giant // Stomp', layout: 'adventure', type_line: 'Creature — Giant // Instant — Adventure', mana_cost: '{2}{R}', cmc: 3, oracle_text: '',
    card_faces: [
      { object: 'card_face', name: 'Bonecrusher Giant', type_line: 'Creature — Giant', mana_cost: '{2}{R}', power: '4', toughness: '3', oracle_text: '' },
      { object: 'card_face', name: 'Stomp', type_line: 'Instant — Adventure', mana_cost: '{1}{R}', oracle_text: 'Stomp deals 2 damage to any target. (Then exile this card. You may cast the creature later from exile.)' },
    ],
  } as never),
  makeCard({ name: 'Wheel', type_line: 'Artifact', mana_cost: '{4}', cmc: 4, oracle_text: '{T}: You gain 1 life.\nMorph {3} (You may cast this card face down as a 2/2 creature for {3}. Turn it face up any time for its morph cost.)' }),
  makeCard({ name: 'Mastery Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Exile target card that's an instant or sorcery from your graveyard. For each card exiled this way, copy it, and you may cast the copy without paying its mana cost. Exile this spell.\nOverload {1}" }),
  makeCard({ name: 'Insight', type_line: 'Instant', mana_cost: '{U}', cmc: 1, oracle_text: 'When you cast this spell, draw a card.\nYou gain 1 life.' }),
  makeCard({ name: 'Twincast Lite', type_line: 'Instant', mana_cost: '{U}', cmc: 1, oracle_text: 'Copy target instant or sorcery spell. You may choose new targets for the copy.' }),
  makeCard({ name: 'Cancel', type_line: 'Instant', mana_cost: '{U}', cmc: 1, oracle_text: 'Counter target spell.' }),
  makeCard({ name: 'Thousand', type_line: 'Enchantment', mana_cost: '{1}', cmc: 1, oracle_text: "Whenever you cast an instant or sorcery spell, copy it for each other instant and sorcery spell you've cast before it this turn. You may choose new targets for the copies." }),
  makeCard({ name: 'Law', type_line: 'Enchantment', mana_cost: '{2}{W}', cmc: 3, oracle_text: "Each player can't cast more than one spell each turn." }),
  makeCard({ name: 'Scepter', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Imprint — When this artifact enters, you may exile an instant card with mana value 2 or less from your hand.\n{2}, {T}: You may copy the exiled card. If you do, you may cast the copy without paying its mana cost.' }),
  makeCard({ name: 'Second', type_line: 'Enchantment', mana_cost: '{1}', cmc: 1, oracle_text: 'Whenever you cast your second spell each turn, you gain 1 life.' }),
  makeCard({ name: 'Phoenix Lite', type_line: 'Enchantment', mana_cost: '{1}', cmc: 1, oracle_text: "At the beginning of your end step, if you've cast three or more instant and sorcery spells this turn, draw a card." }),
  makeCard({ name: 'Reeds', type_line: 'Enchantment', mana_cost: '{1}', cmc: 1, oracle_text: "At the beginning of your end step, if you've cast a noncreature spell this turn, draw a card." }),
  makeCard({ name: 'Prey', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Cast this spell only if an opponent cast a creature spell this turn.\nYou gain 1 life.' }),
  makeCard({ name: 'Barrage', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Target creature you control gets +1/+0 until end of turn if you've cast another instant or sorcery spell this turn." }),
  makeCard({ name: 'Thief', type_line: 'Creature — Faerie Rogue', mana_cost: '{U}', cmc: 1, power: '1', toughness: '1', oracle_text: "When this creature enters, draw a card if you've cast another blue spell this turn." }),
  makeCard({ name: 'Conduit', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'The first creature spell you cast each turn costs {2} less to cast.' }),
  makeCard({ name: 'Rhino', type_line: 'Enchantment', mana_cost: '{1}', cmc: 1, oracle_text: "At the beginning of your end step, if you've cast a spell with mana value 4 or greater this turn, draw a card." }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const main = (): GameState => {
  const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
  for (const p of ['alice', 'bob']) g.players[p]!.pool = { W: 9, U: 9, B: 9, R: 9, G: 9, C: 9 };
  return g;
};
const at = (object: string) => [[{ kind: 'object' as const, object }]];
const bob = [[{ kind: 'player' as const, player: 'bob' }]];
type Cast = Partial<Extract<Action, { type: 'cast' }>>;
const cast = (g: GameState, name: string, more: Cast = {}, who = 'alice') => settle(act(g, { type: 'cast', player: who, object: give(g, who, name, 'hand'), ...more }));
/** The turn's casts, briefly: who, what it was, its mana value. */
const told = (g: GameState, lastTurn = false) => casts(g, lastTurn).map((c) => [c.player, c.spell?.name, c.was.types.join(' '), c.mv]);
const drawsAtEnd = (g: GameState): number => {
  const hand = g.zones.hand.alice!.length;
  g = settle(toStep(g, 'end', 'alice'));
  return g.zones.hand.alice!.length - hand;
};

describe('the spells cast this turn, each as it was cast', () => {
  it('who cast what, in order: its types on the stack, its mana value with X as chosen, where it was cast from', () => {
    let g = main();
    g = cast(g, 'Bear');
    g = cast(g, 'Crackle', { x: 3, targets: bob });
    g = cast(g, 'Zap', { targets: bob }, 'alice');
    expect(told(g)).toEqual([
      ['alice', 'Bear', 'Creature', 2],
      ['alice', 'Crackle', 'Sorcery', 4],
      ['alice', 'Zap', 'Instant', 1],
    ]);
    expect(casts(g).map((c) => [c.from, c.spent, c.warped])).toEqual([['hand', 2, false], ['hand', 4, false], ['hand', 1, false]]);
    // Each is the spell it was (CR 400.7): the Bear on the battlefield is one zone change on.
    const bear = casts(g)[0]!;
    expect([g.objects[bear.id]!.zone, g.objects[bear.id]!.zcc - bear.zcc!]).toEqual(['battlefield', 1]);
    // Next turn it is last turn's.
    g = toStep(g, 'upkeep', 'bob');
    expect([told(g), told(g, true).length]).toEqual([[], 3]);
  });

  it('a spell is told, as it is recorded, which of its caster\'s spells this turn it is and what they had spent before it', () => {
    let g = main();
    const seen: GameEvent[] = [];
    for (const [name, more] of [['Zap', { targets: bob }], ['Crackle', { x: 2, targets: bob }], ['Bear', {}]] as [string, Cast][]) {
      const r = actWithEvents(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), ...more });
      seen.push(...r.events.filter((e) => e.type === 'cast'));
      g = settle(r.state);
    }
    expect(seen.map((e) => (e.type === 'cast' ? [e.nth, e.manaBefore, e.manaSpent] : []))).toEqual([[1, 0, 1], [2, 1, 3], [3, 4, 2]]);
    // Bob's first is his first.
    g = act(g, { type: 'pass', player: 'alice' });
    const r = actWithEvents(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Zap', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] });
    expect(r.events.filter((e) => e.type === 'cast')).toMatchObject([{ player: 'bob', nth: 1, manaBefore: 0 }]);
  });

  it('an Adventure cast as its instant was an instant spell — though the card is a creature card in exile now', () => {
    let g = main();
    g = cast(g, 'Bonecrusher Giant // Stomp', { face: 1, targets: bob });
    const stomp = casts(g)[0]!;
    expect([g.objects[stomp.id]!.zone, g.objects[stomp.id]!.face, told(g)]).toEqual(['exile', 0, [['alice', 'Stomp', 'Instant', 2]]]);
    expect(stomp.was.subtypes).toEqual(['Adventure']);
    // "Only if an opponent cast a creature spell this turn": she hasn't — until she casts one.
    const prey = give(g, 'bob', 'Prey', 'hand');
    const bobMayCastPrey = (h: GameState) => legalActions(act(h, { type: 'pass', player: 'alice' }), 'bob').some((a) => a.type === 'cast' && a.object === prey);
    expect(bobMayCastPrey(g)).toBe(false);
    expect(bobMayCastPrey(cast(g, 'Bear'))).toBe(true);
    // "If you've cast another instant or sorcery spell this turn": she has.
    const mine = give(g, 'alice', 'Bear', 'battlefield');
    g = cast(g, 'Barrage', { targets: at(mine) });
    expect(chars(g, g.objects[mine]!).power).toBe(3);
  });

  it('"another instant or sorcery spell": not this spell itself', () => {
    let g = main();
    const mine = give(g, 'alice', 'Bear', 'battlefield');
    g = cast(g, 'Barrage', { targets: at(mine) });
    expect(chars(g, g.objects[mine]!).power).toBe(2);
  });

  it('a card cast face down was a creature spell with no name (CR 708.4) — and which card it is, no one is told', () => {
    let g = main();
    give(g, 'alice', 'Reeds', 'battlefield');
    const wheel = give(g, 'alice', 'Wheel', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: wheel, alt: 'morph' }));
    const [c] = casts(g);
    expect([c!.was.types, c!.spell!.name, c!.mv, c!.spell!.object]).toEqual([['Creature'], '', 0, undefined]);
    // The history goes to every player as it is: nothing in it says which card.
    expect(JSON.stringify(viewFor(g, 'bob').history)).not.toContain('Wheel');
    // "If you've cast a noncreature spell this turn": an artifact card, but a creature spell.
    expect(drawsAtEnd(g)).toBe(0);
  });

  it('"a noncreature spell this turn": the same card cast face up is one', () => {
    let g = main();
    give(g, 'alice', 'Reeds', 'battlefield');
    g = cast(g, 'Wheel');
    expect(drawsAtEnd(g)).toBe(1);
  });

  it('"a spell with mana value 4 or greater": X counts as it was chosen (CR 202.3e), though the card is in a graveyard now', () => {
    for (const [x, drew] of [[2, 0], [3, 1]] as const) {
      let g = main();
      give(g, 'alice', 'Rhino', 'battlefield');
      g = cast(g, 'Crackle', { x, targets: bob });
      expect([x, drawsAtEnd(g)]).toEqual([x, drew]);
    }
  });
});

describe('a copy that was cast is a spell cast (CR 707.12) — gone though it is once it has resolved', () => {
  const overloaded = (g: GameState, order: string[]): GameState => {
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mastery Lite', 'hand'), alt: 'overload' });
    g = settle(g);
    expect(g.pending).toMatchObject({ kind: 'choose_objects', ordered: true });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: order } });
    return g;
  };
  const yes = (g: GameState, targets?: unknown): GameState => act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true, ...(targets ? { targets } : {}) } as never });

  it('two spells cast as one spell resolves are the second and the third: "your second spell each turn" triggers once', () => {
    let g = main();
    give(g, 'alice', 'Second', 'battlefield');
    const [s1, s2] = [give(g, 'alice', 'Salve', 'graveyard'), give(g, 'alice', 'Salve', 'graveyard')];
    const life = g.players.alice!.life;
    g = overloaded(g, [s1, s2]);
    g = settle(yes(yes(g)));
    // 3 + 3 from the two copies, and 1 — once — for the second spell.
    expect(g.players.alice!.life - life).toBe(7);
    expect(told(g)).toEqual([['alice', 'Mastery Lite', 'Sorcery', 0], ['alice', 'Salve', 'Instant', 1], ['alice', 'Salve', 'Instant', 1]]);
    // The copies have ceased to exist (CR 707.10a); that they were cast is still known.
    expect(casts(g).slice(1).map((c) => g.objects[c.id])).toEqual([undefined, undefined]);
  });

  it('"if you\'ve cast three or more instant and sorcery spells this turn" counts them', () => {
    let g = main();
    give(g, 'alice', 'Phoenix Lite', 'battlefield');
    const [s1, s2] = [give(g, 'alice', 'Salve', 'graveyard'), give(g, 'alice', 'Salve', 'graveyard')];
    g = settle(yes(yes(overloaded(g, [s1, s2]))));
    expect(drawsAtEnd(g)).toBe(1);
  });

  it('"can\'t cast more than one spell each turn" counts one', () => {
    // A Scepter with a Salve imprinted, set up the turn before.
    let g = main();
    const salve = give(g, 'alice', 'Salve', 'hand');
    const scepter = give(g, 'alice', 'Scepter', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: scepter }));
    if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    if (g.pending?.kind === 'choose_objects') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [salve] } });
    g = toStep(toStep(settle(g), 'upkeep', 'bob'), 'main1', 'alice');
    g.players.alice!.pool = { W: 9, U: 9, B: 9, R: 9, G: 9, C: 9 };
    give(g, 'bob', 'Law', 'battlefield');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'activate', player: 'alice', object: scepter, ability: 0 }));
    g = settle(yes(g));
    // The one spell she has cast this turn is a copy, and it is gone: it was a spell cast all the same.
    expect([g.players.alice!.life - life, told(g), g.objects[casts(g)[0]!.id]]).toEqual([3, [['alice', 'Salve', 'Instant', 1]], undefined]);
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Zap', 'hand'), targets: bob })).toBe("Zap can't be cast (Law).");
    // Bob has cast none: he may.
    const zap = give(g, 'bob', 'Zap', 'hand');
    g.players.bob!.pool.R = 1;
    expect(legalActions(act(g, { type: 'pass', player: 'alice' }), 'bob').some((a) => a.type === 'cast' && a.object === zap)).toBe(true);
  });

  it('its "When you cast this spell" triggers — and a copy that was only put onto the stack has none (CR 707.10)', () => {
    let g = main();
    const insight = give(g, 'alice', 'Insight', 'graveyard');
    const hand = () => g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mastery Lite', 'hand'), targets: at(insight) }));
    const before = hand();
    g = settle(yes(g));
    expect(hand() - before).toBe(1);
    // Copied on the stack, the copy isn't cast: one card for the Insight she casts, none for its copy.
    const mine = give(g, 'alice', 'Insight', 'hand');
    const twin = give(g, 'alice', 'Twincast Lite', 'hand');
    const start = hand();
    g = act(g, { type: 'cast', player: 'alice', object: mine });
    g = act(g, { type: 'cast', player: 'alice', object: twin, targets: at(mine) });
    for (let i = 0; i < 12 && (g.stack.length || g.pending); i++) g = g.pending?.kind === 'copy_targets' ? act(g, { type: 'choose', player: 'alice', answer: { kind: 'copy_targets' } }) : settle(g);
    expect(hand() - start).toBe(-2 + 1);
  });

  it('storm on one counts the spells cast before it, the one cast just ahead of it in the same resolution too (CR 702.40a)', () => {
    let g = main();
    const [zap, shot] = [give(g, 'alice', 'Zap', 'graveyard'), give(g, 'alice', 'Grapeshot Lite', 'graveyard')];
    const life = g.players.bob!.life;
    g = overloaded(g, [zap, shot]);
    g = yes(g, bob);
    g = yes(g, bob);
    for (let i = 0; i < 12 && (g.stack.length || g.pending); i++) g = g.pending?.kind === 'copy_targets' ? act(g, { type: 'choose', player: 'alice', answer: { kind: 'copy_targets' } }) : settle(g);
    // Mastery, then the Zap, were cast before the Grapeshot: two copies of it. 2 + 1 + 1 + 1.
    expect(life - g.players.bob!.life).toBe(5);
  });
});

describe('"each spell cast before it this turn": the turn\'s casts ahead of its own', () => {
  it('storm doesn\'t count what was cast in response', () => {
    let g = main();
    const life = g.players.bob!.life;
    g = cast(g, 'Zap', { targets: bob });
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Grapeshot Lite', 'hand'), targets: bob });
    // In response to the storm trigger, another spell.
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Zap', 'hand'), targets: bob });
    for (let i = 0; i < 12 && (g.stack.length || g.pending); i++) g = g.pending?.kind === 'copy_targets' ? act(g, { type: 'choose', player: 'alice', answer: { kind: 'copy_targets' } }) : settle(g);
    // Two Zaps (4), the Grapeshot (1) and its one copy (1).
    expect(life - g.players.bob!.life).toBe(6);
  });
});

describe('"copy it", of a spell that has been countered since: it is copied as it was cast (CR 608.2h)', () => {
  /** Everything on the stack resolves; a copy keeps the targets it has. */
  const resolveAll = (g: GameState): GameState => {
    for (let i = 0; i < 20 && (g.stack.length || g.pending); i++) g = g.pending?.kind === 'copy_targets' ? act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'copy_targets' } }) : settle(g);
    return g;
  };

  it('storm: the spell is countered in response to the storm trigger, and the copies are made all the same', () => {
    let g = main();
    const life = g.players.bob!.life;
    g = cast(g, 'Zap', { targets: bob });
    const shot = give(g, 'alice', 'Grapeshot Lite', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: shot, targets: bob });
    expect(g.stack.length).toBe(2);
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Cancel', 'hand'), targets: at(shot) });
    g = act(act(g, { type: 'pass', player: 'bob' }), { type: 'pass', player: 'alice' });
    // The Grapeshot is countered; its storm trigger is still on the stack.
    expect([g.objects[shot]!.zone, g.stack.length]).toEqual(['graveyard', 1]);
    g = resolveAll(g);
    // The Zap (2), and one copy of the Grapeshot (1) for the one spell cast before it — the Cancel came after.
    expect(life - g.players.bob!.life).toBe(3);
  });

  it('"Whenever you cast an instant or sorcery spell, copy it for each other …": the same', () => {
    let g = main();
    give(g, 'alice', 'Thousand', 'battlefield');
    const life = g.players.bob!.life;
    g = resolveAll(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Zap', 'hand'), targets: bob }));
    expect(life - g.players.bob!.life).toBe(2);
    const zap = give(g, 'alice', 'Zap', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: zap, targets: bob });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Cancel', 'hand'), targets: at(zap) });
    g = resolveAll(g);
    // The second Zap never resolved; its one copy did.
    expect([g.objects[zap]!.zone, life - g.players.bob!.life]).toEqual(['graveyard', 4]);
  });
});

describe('"another spell": any cast but this object\'s own (CR 400.7)', () => {
  it('the same card cast earlier this turn was another spell', () => {
    let g = main();
    const thief = give(g, 'alice', 'Thief', 'hand');
    const hand = () => g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: thief }));
    // The only blue spell this turn is itself: no card. (One fewer in hand: the Thief.)
    const before = hand();
    g = cast(g, 'Recall', { targets: at(thief) });
    expect(hand()).toBe(before + 1);
    g = settle(act(g, { type: 'cast', player: 'alice', object: thief }));
    // Cast again, it is another spell than the Thief cast before: a card.
    expect([g.objects[thief]!.zone, hand()]).toEqual(['battlefield', before + 1]);
  });

  it('its own cast isn\'t, even if it has left the battlefield before its ability resolves', () => {
    let g = main();
    const thief = give(g, 'alice', 'Thief', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: thief });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    expect([g.objects[thief]!.zone, g.stack.length]).toEqual(['battlefield', 1]);
    const hand = g.zones.hand.alice!.length;
    // In response to its enters ability, it dies.
    g = act(g, { type: 'pass', player: 'alice' });
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Slay', 'hand'), targets: at(thief) }));
    expect([g.objects[thief]!.zone, g.zones.hand.alice!.length]).toEqual(['graveyard', hand]);
  });

  it('"enters with a +1/+1 counter on it for each other spell cast this turn": not for the spell it was', () => {
    for (const others of [0, 2]) {
      let g = main();
      for (let i = 0; i < others; i++) g = cast(g, 'Zap', { targets: bob });
      const entity = give(g, 'alice', 'Entity', 'hand');
      g = settle(act(g, { type: 'cast', player: 'alice', object: entity }));
      expect([others, g.objects[entity]!.zone, g.objects[entity]!.counters['+1/+1'] ?? 0]).toEqual([others, 'battlefield', others]);
    }
  });

  it('"the first creature spell you cast each turn": cast again, the same card is the second', () => {
    let g = main();
    give(g, 'alice', 'Conduit', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'hand');
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 };
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    g = cast(g, 'Recall', { targets: at(bear) });
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 };
    expect(illegal(g, { type: 'cast', player: 'alice', object: bear })).toBeTruthy();
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
  });
});

describe('life gained and lost this turn', () => {
  it('how much, by whom — this turn and the last', () => {
    let g = main();
    g = cast(g, 'Salve');
    g = cast(g, 'Zap', { targets: [[{ kind: 'player', player: 'alice' }]] });
    g = cast(g, 'Salve');
    expect([lifeChange(g, 'alice', 1), lifeChange(g, 'alice', -1), lifeChange(g, 'bob', 1), lifeChanged(g, 1), lifeChanged(g, -1)]).toEqual([6, 2, 0, ['alice'], ['alice']]);
    g = toStep(g, 'upkeep', 'bob');
    expect([lifeChange(g, 'alice', 1), lifeChange(g, 'alice', 1, true), lifeChanged(g, -1, true)]).toEqual([0, 6, ['alice']]);
  });

  it('a player\'s first gain and first loss of the turn are marked on the event, as it is recorded', () => {
    let g = main();
    const life: GameEvent[] = [];
    for (const [name, more] of [['Salve', {}], ['Salve', {}], ['Zap', { targets: [[{ kind: 'player', player: 'alice' }]] }], ['Zap', { targets: [[{ kind: 'player', player: 'alice' }]] }]] as [string, Cast][]) {
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), ...more });
      while (g.stack.length) {
        const r = actWithEvents(g, { type: 'pass', player: g.priority! });
        life.push(...r.events.filter((e) => e.type === 'life'));
        g = r.state;
      }
    }
    expect(life.map((e) => (e.type === 'life' ? [e.delta, Boolean(e.firstGain), Boolean(e.firstLoss)] : []))).toEqual([[3, true, false], [3, false, false], [-2, false, true], [-2, false, false]]);
  });
});
