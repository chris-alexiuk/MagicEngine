import { describe, expect, it } from 'vitest';
import { chars, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Caged Sun', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'As this artifact enters, choose a color.\nCreatures you control of the chosen color get +1/+1.\nWhenever a land\'s ability causes you to add one or more mana of the chosen color, add an additional one mana of that color.' }),
  makeCard({ name: 'Nyxbloom Ancient', type_line: 'Creature — Elemental', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: 'Trample\nIf you tap a permanent for mana, it produces three times as much of that mana instead.' }),
  makeCard({ name: 'Silent Arbiter', type_line: 'Artifact Creature — Construct', mana_cost: '{0}', power: '1', toughness: '5', oracle_text: 'No more than one creature can attack each combat.\nNo more than one creature can block each combat.' }),
  makeCard({ name: "Spymaster's Vault", type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{B}, {T}: Target creature you control connives X, where X is the number of creatures that died this turn.' }),
  makeCard({ name: 'Crackle with Power', type_line: 'Sorcery', mana_cost: '{X}{X}{X}{R}', cmc: 1, colors: ['R'], color_identity: ['R'], oracle_text: 'Crackle with Power deals five times X damage to each of up to X targets.' }),
  makeCard({ name: 'Wan Shi Tong, Librarian', type_line: 'Legendary Creature — Bird Spirit', mana_cost: '{X}{U}{U}', cmc: 2, colors: ['U'], color_identity: ['U'], power: '1', toughness: '1', oracle_text: 'Flash\nFlying, vigilance\nWhen Wan Shi Tong enters, put X +1/+1 counters on him. Then draw half X cards, rounded down.' }),
  makeCard({ name: 'Hydroid Krasis', type_line: 'Creature — Jellyfish Hydra Beast', mana_cost: '{X}{G}{U}', cmc: 2, colors: ['G', 'U'], color_identity: ['G', 'U'], power: '0', toughness: '0', oracle_text: 'When you cast this spell, you gain half X life and draw half X cards. Round down each time.\nFlying, trample\nThis creature enters with X +1/+1 counters on it.' }),
  makeCard({ name: 'Peer into the Abyss', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target player draws cards equal to half the number of cards in their library and loses half their life. Round up each time.' }),
  makeCard({ name: 'Quietus Spike', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equipped creature has deathtouch.\nWhenever equipped creature deals combat damage to a player, that player loses half their life, rounded up.\nEquip {3}' }),
  makeCard({ name: 'Traumatize', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target player mills half their library, rounded down.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Elf', type_line: 'Creature — Elf', mana_cost: '{G}', cmc: 1, colors: ['G'], power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{5}', cmc: 5, power: '5', toughness: '5', oracle_text: '' }),
  makeCard({ name: 'Murder', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const forestOf = (g: GameState, p: string) => give(g, p, 'Forest', 'battlefield');
const toCombat = (g: GameState): GameState => {
  g = toStep(g, 'beginning_of_combat');
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return g;
};

describe('staples (slice 167)', () => {
  it('Caged Sun: an extra mana of the chosen color from lands; +1/+1 for that color', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Caged Sun', 'hand') }));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', choice: 'G' } as never });
    const forest = forestOf(g, 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    expect(chars(g, g.objects[bear]!).power).toBe(3);
    g = act(g, { type: 'activate_mana', player: 'alice', object: forest, ability: 0 });
    expect(g.players.alice!.pool.G).toBe(2);
  });

  it('Nyxbloom Ancient: three times as much, and autotap knows it', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Nyxbloom Ancient', 'battlefield');
    const forest = forestOf(g, 'alice');
    g = act(g, { type: 'activate_mana', player: 'alice', object: forest, ability: 0 });
    expect(g.players.alice!.pool.G).toBe(3);
    g.players.alice!.pool.G = 0;
    const two = [forestOf(g, 'alice'), forestOf(g, 'alice')];
    // Two untapped Forests make six mana: enough for the Ogre.
    const ogre = give(g, 'alice', 'Ogre', 'hand');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === ogre)).toBe(true);
    g = settle(act(g, { type: 'cast', player: 'alice', object: ogre, autoTap: true }));
    expect(g.objects[ogre]!.zone).toBe('battlefield');
    expect(two.every((id) => g.objects[id]!.tapped)).toBe(true);
  });

  it('Silent Arbiter: one attacker, one blocker', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'bob', 'Silent Arbiter', 'battlefield');
    const [a, b] = [give(g, 'alice', 'Bear', 'battlefield'), give(g, 'alice', 'Ogre', 'battlefield')];
    for (const id of [a, b]) g.objects[id]!.sick = false;
    g = toCombat(g);
    const both = { kind: 'declare_attackers' as const, attacks: [a, b].map((attacker) => ({ attacker, target: { kind: 'player' as const, player: 'bob' } })) };
    expect(() => act(g, { type: 'choose', player: 'alice', answer: both })).toThrow(/No more than one creature/);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: b, target: { kind: 'player', player: 'bob' } }] } });
    expect(Object.keys(g.combat!.attackers)).toEqual([b]);
    const blockers = [give(g, 'bob', 'Bear', 'battlefield'), give(g, 'bob', 'Bear', 'battlefield')];
    for (let i = 0; i < 10 && g.pending?.kind !== 'declare_blockers'; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(() => act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: blockers.map((blocker) => ({ blocker, attacker: b })) } } as never)).toThrow(/No more than one creature/);
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: blockers[0]!, attacker: b }] } } as never);
    expect(g.combat!.blockers[blockers[0]!]).toBeDefined();
  });

  it("Spymaster's Vault: connive X — draw X, discard X, a counter for each nonland card", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const vault = give(g, 'alice', "Spymaster's Vault", 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    for (const v of [give(g, 'bob', 'Elf', 'battlefield'), give(g, 'bob', 'Elf', 'battlefield')]) {
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder', 'hand'), targets: [[{ kind: 'object', object: v }]] }));
    }
    const hand = g.zones.hand.alice!.length;
    g.players.alice!.pool.B = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: vault, ability: 0, targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.pending).toMatchObject({ kind: 'discard', count: 2 });
    const ogres = [give(g, 'alice', 'Ogre', 'hand'), give(g, 'alice', 'Ogre', 'hand')];
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: ogres } } as never));
    expect(g.objects[bear]!.counters['+1/+1']).toBe(2);
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
  });

  it('Crackle with Power: five times X to each of up to X targets', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    const life = g.players.bob!.life;
    g.players.alice!.pool.R = 1;
    g.players.alice!.pool.C = 6;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Crackle with Power', 'hand'), x: 2, targets: [[{ kind: 'object', object: ogre }, { kind: 'player', player: 'bob' }]] }));
    expect(g.objects[ogre]!.zone).toBe('graveyard');
    expect(g.players.bob!.life).toBe(life - 10);
  });

  it('Wan Shi Tong: X counters on him, then half X cards rounded down', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const hand = g.zones.hand.alice!.length;
    g.players.alice!.pool.U = 2;
    g.players.alice!.pool.C = 3;
    const wan = give(g, 'alice', 'Wan Shi Tong, Librarian', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: wan, x: 3 }));
    expect(g.objects[wan]!.counters['+1/+1']).toBe(3);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it("Hydroid Krasis: the cast trigger sees the spell's X", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const life = g.players.alice!.life;
    const hand = g.zones.hand.alice!.length;
    g.players.alice!.pool.G = 1;
    g.players.alice!.pool.U = 1;
    g.players.alice!.pool.C = 5;
    const krasis = give(g, 'alice', 'Hydroid Krasis', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: krasis, x: 5 }));
    expect(g.players.alice!.life).toBe(life + 2);
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
    expect(g.objects[krasis]!.counters['+1/+1']).toBe(5);
  });

  it('Peer into the Abyss: half the library and half the life, rounded up', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lib = g.zones.library.bob!.length;
    g.players.bob!.life = 15;
    const hand = g.zones.hand.bob!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Peer into the Abyss', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.zones.hand.bob!.length).toBe(hand + Math.ceil(lib / 2));
    expect(g.players.bob!.life).toBe(7);
  });

  it('Traumatize: half their library, rounded down', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lib = g.zones.library.bob!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Traumatize', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.zones.library.bob!.length).toBe(lib - Math.floor(lib / 2));
  });

  it('Quietus Spike: that player loses half their life, rounded up', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g.objects[bear]!.sick = false;
    const spike = give(g, 'alice', 'Quietus Spike', 'battlefield');
    g.objects[spike]!.attachedTo = { id: bear, zcc: g.objects[bear]!.zcc };
    g.clock++;
    g.players.bob!.life = 21;
    g = toCombat(g);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 40 && g.step !== 'end_of_combat'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } } as never);
      else if (g.pending) break;
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    // 21 - 2 = 19, then half of 19 rounded up (10) is lost.
    expect(g.players.bob!.life).toBe(9);
  });
});
