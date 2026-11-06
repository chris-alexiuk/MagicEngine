import { describe, expect, it } from 'vitest';
import { chars, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Marsh Lite', type_line: 'Land — Swamp', mana_cost: '', oracle_text: '({T}: Add {B}.)' }),
  makeCard({ name: 'Bog Walker Lite', type_line: 'Creature — Zombie', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Swampwalk' }),
  makeCard({ name: 'Staff Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "Creatures with landwalk abilities can be blocked as though they didn't have those abilities." }),
  makeCard({ name: 'Herbalist Lite', type_line: 'Creature — Human Cleric', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{0}, Exile the top card of your library: You gain 1 life.' }),
  makeCard({ name: 'Alliance Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: '{0}: Target nonattacking, nonblocking creature gets +0/+2 until end of turn.' }),
  makeCard({ name: 'Giant Lite', type_line: 'Creature — Zombie Giant', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Whenever this creature attacks or blocks, sacrifice it unless you exile a card from your graveyard.' }),
  makeCard({ name: 'Sweeper Lite', type_line: 'Artifact Creature — Construct', mana_cost: '{0}', power: '4', toughness: '6', oracle_text: 'Whenever this creature attacks, destroy all Auras attached to target land.' }),
  makeCard({ name: 'Land Aura Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant land' }),
  makeCard({ name: 'Tome Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{0}, {T}: Draw a card. Then discard a card unless you exile a historic card from your graveyard.' }),
  makeCard({ name: 'Relic Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '' }),
  makeCard({ name: 'Scarab Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "{T}, Sacrifice this artifact: Return all Auras attached to target permanent you own to their owners' hands. Draw a card at the beginning of the next turn's upkeep." }),
  makeCard({ name: 'Creature Aura Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature' }),
  makeCard({ name: 'Gear Lite', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equip {1}' }),
  makeCard({ name: 'Strip Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy all Auras and Equipment attached to target creature.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const choose = (g: GameState, answer: Record<string, unknown>) => settle(act(g, { type: 'choose', player: (g.pending as { player: string }).player, answer } as never));
const main = () => toStep(start({ extra: CARDS }), 'main1', 'alice');
const attackWith = (g: GameState, attackers: string[], to = 'bob', who = 'alice'): GameState => {
  g = toStep(g, 'beginning_of_combat', who);
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return act(g, { type: 'choose', player: who, answer: { kind: 'declare_attackers', attacks: attackers.map((attacker) => ({ attacker, target: { kind: 'player' as const, player: to } })) } });
};
const toBlocks = (g: GameState): GameState => {
  for (let i = 0; i < 40 && !(g.pending && (g.pending as { kind: string }).kind === 'declare_blockers'); i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
};

describe('slice 278 staples', () => {
  it('Staff of the Ages: landwalkers can be blocked as though they had no landwalk', () => {
    for (const staff of [false, true]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
      give(g, 'alice', 'Marsh Lite', 'battlefield');
      const cub = give(g, 'alice', 'Cub', 'battlefield');
      const walker = give(g, 'bob', 'Bog Walker Lite', 'battlefield');
      if (staff) give(g, 'alice', 'Staff Lite', 'battlefield');
      g = toBlocks(attackWith(g, [walker], 'alice', 'bob'));
      const block = { type: 'choose', player: 'alice', answer: { kind: 'declare_blockers', blocks: [{ blocker: cub, attacker: walker }] } } as never;
      if (staff) expect(act(g, block).pending?.kind ?? 'ok').not.toBe('declare_blockers');
      else illegal(g, block);
    }
  });

  it('Royal Herbalist: exiling the top card of your library is a cost', () => {
    let g = main();
    const herb = give(g, 'alice', 'Herbalist Lite', 'battlefield');
    const top = g.zones.library.alice![0]!;
    g = settle(act(g, { type: 'activate', player: 'alice', object: herb, ability: 0 } as never));
    expect([g.players.alice!.life, g.objects[top]!.zone]).toEqual([21, 'exile']);
    g.zones.library.alice = [];
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && (a as { object: string }).object === herb)).toBe(false);
  });

  it('Unlikely Alliance: only a creature that is neither attacking nor blocking', () => {
    let g = main();
    const ally = give(g, 'alice', 'Alliance Lite', 'battlefield');
    const [a, b] = [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'alice', 'Cub', 'battlefield')];
    g = attackWith(g, [a]);
    while (g.pending) g = choose(g, { kind: 'declare_blockers', blocks: [] });
    illegal(g, { type: 'activate', player: 'alice', object: ally, ability: 0, targets: [[{ kind: 'object', object: a }]] } as never);
    g = settle(act(g, { type: 'activate', player: 'alice', object: ally, ability: 0, targets: [[{ kind: 'object', object: b }]] } as never));
    expect([chars(g, g.objects[b]!).toughness, chars(g, g.objects[a]!).toughness]).toEqual([3, 1]);
  });

  it('Rotting Giant: sacrificed on attack unless a graveyard card is exiled', () => {
    let g = main();
    const giant = give(g, 'alice', 'Giant Lite', 'battlefield');
    g = settle(attackWith(g, [giant]));
    expect(g.objects[giant]!.zone).toBe('graveyard');

    let h = main();
    const giant2 = give(h, 'alice', 'Giant Lite', 'battlefield');
    const dead = give(h, 'alice', 'Cub', 'graveyard');
    h = settle(attackWith(h, [giant2]));
    for (let i = 0; i < 5 && h.pending && (h.pending as { player: string }).player === 'alice'; i++) {
      const p = h.pending as { kind: string };
      h = choose(h, p.kind === 'pay' ? { kind: 'pay', pay: true } : p.kind === 'choose_objects' ? { kind: 'choose_objects', objects: [dead] } : { kind: 'may', yes: true });
    }
    expect([h.objects[giant2]!.zone, h.objects[dead]!.zone]).toEqual(['battlefield', 'exile']);
  });

  it('Street Sweeper: destroys all Auras attached to the target land', () => {
    let g = main();
    const sweeper = give(g, 'alice', 'Sweeper Lite', 'battlefield');
    const land = give(g, 'bob', 'Marsh Lite', 'battlefield');
    const auras = [give(g, 'bob', 'Land Aura Lite', 'battlefield'), give(g, 'alice', 'Land Aura Lite', 'battlefield')];
    for (const x of auras) g.objects[x]!.attachedTo = { id: land, zcc: g.objects[land]!.zcc };
    const other = give(g, 'bob', 'Land Aura Lite', 'battlefield');
    const land2 = give(g, 'bob', 'Marsh Lite', 'battlefield');
    g.objects[other]!.attachedTo = { id: land2, zcc: g.objects[land2]!.zcc };
    g = attackWith(g, [sweeper]);
    if (g.pending) g = choose(g, { kind: 'trigger_targets', targets: [[{ kind: 'object', object: land }]] });
    g = settle(g);
    expect([...auras, other].map((x) => g.objects[x]!.zone)).toEqual(['graveyard', 'graveyard', 'battlefield']);
  });
  it("Urza's Tome: discard unless you exile a historic card from your graveyard", () => {
    for (const historic of [false, true]) {
      let g = main();
      const tome = give(g, 'alice', 'Tome Lite', 'battlefield');
      const gy = give(g, 'alice', historic ? 'Relic Lite' : 'Cub', 'graveyard');
      const hand = g.zones.hand.alice!.length;
      g = settle(act(g, { type: 'activate', player: 'alice', object: tome, ability: 0 } as never));
      for (let i = 0; i < 5 && g.pending; i++) {
        const p = g.pending as { kind: string; options?: unknown[] };
        g = choose(g, p.kind === 'pay' ? { kind: 'pay', pay: true } : p.kind === 'choose_objects' ? { kind: 'choose_objects', objects: [gy] } : p.kind === 'discard' ? { kind: 'discard', objects: [g.zones.hand.alice![0]!] } : { kind: 'may', yes: true });
      }
      expect([g.zones.hand.alice!.length - hand, g.objects[gy]!.zone]).toEqual(historic ? [1, 'exile'] : [0, 'graveyard']);
    }
  });

  it('Scarab of the Unseen: returns every Aura on a permanent you own, then draws next upkeep', () => {
    let g = main();
    const scarab = give(g, 'alice', 'Scarab Lite', 'battlefield');
    g.zones.hand.alice = []; // stay under the maximum hand size through cleanup
    const [mine, theirs] = [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'bob', 'Cub', 'battlefield')];
    const auras = [give(g, 'alice', 'Creature Aura Lite', 'battlefield'), give(g, 'bob', 'Creature Aura Lite', 'battlefield')];
    for (const x of auras) g.objects[x]!.attachedTo = { id: mine, zcc: g.objects[mine]!.zcc };
    illegal(g, { type: 'activate', player: 'alice', object: scarab, ability: 0, targets: [[{ kind: 'object', object: theirs }]] } as never);
    g = settle(act(g, { type: 'activate', player: 'alice', object: scarab, ability: 0, targets: [[{ kind: 'object', object: mine }]] } as never));
    expect(auras.map((x) => [g.objects[x]!.zone, g.objects[x]!.owner])).toEqual([['hand', 'alice'], ['hand', 'bob']]);
    const hand = g.zones.hand.alice!.length;
    g = toStep(g, 'upkeep', 'bob');
    g = settle(g);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('Strip Bare: destroys the Auras and Equipment on the target creature only', () => {
    let g = main();
    const [cub, other] = [give(g, 'bob', 'Cub', 'battlefield'), give(g, 'bob', 'Cub', 'battlefield')];
    const on = [give(g, 'bob', 'Creature Aura Lite', 'battlefield'), give(g, 'alice', 'Gear Lite', 'battlefield')];
    for (const x of on) g.objects[x]!.attachedTo = { id: cub, zcc: g.objects[cub]!.zcc };
    const off = give(g, 'bob', 'Creature Aura Lite', 'battlefield');
    g.objects[off]!.attachedTo = { id: other, zcc: g.objects[other]!.zcc };
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Strip Lite', 'hand'), targets: [[{ kind: 'object', object: cub }]] } as never));
    expect([...on, off].map((x) => g.objects[x]!.zone)).toEqual(['graveyard', 'graveyard', 'battlefield']);
  });
});
