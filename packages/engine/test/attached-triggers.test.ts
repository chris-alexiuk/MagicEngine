import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{1}', ...extra });

const CARDS = [
  card('Grizzly', 'Creature — Bear', '', { power: '2', toughness: '2' }),
  card('Lonely Bear', 'Creature — Bear', "This creature can't attack alone.", { power: '3', toughness: '3' }),
  card('Rally Blade', 'Artifact — Equipment', 'Whenever equipped creature attacks, it gets +2/+0 until end of turn.\nEquip {1}'),
  card('Second Chance', 'Enchantment — Aura', 'Enchant creature\nWhen enchanted creature dies, return that card to the battlefield under your control.'),
  card('Murder Lite', 'Instant', 'Destroy target creature.'),
  card('Wrath Lite', 'Sorcery', 'Destroy all creatures and all enchantments.'),
  card('Titan Lite', 'Creature — Eldrazi', "If this creature would be put into a graveyard from anywhere, reveal this creature and shuffle it into its owner's library instead.", { power: '10', toughness: '10' }),
  card('Henge Lite', 'Sorcery', 'Return target historic card from your graveyard to your hand.'),
  card('Relic', 'Artifact', ''),
  card('Survey Lite', 'Sorcery', 'Look at the top seven cards of your library. Put up to two land cards from among them onto the battlefield tapped. Put the rest on the bottom of your library in a random order.'),
  card('Sanctifier Lite', 'Sorcery', 'Look at the top two cards of your library. Put one of them into your graveyard.'),
];

function setup(): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  g.players.alice!.pool = { W: 0, U: 5, B: 5, R: 0, G: 10, C: 10 };
  return g;
}
function settle(g: GameState): GameState {
  for (let i = 0; i < 40 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const cast = (g: GameState, name: string, targets?: unknown[][]) =>
  act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), ...(targets ? { targets } : {}) } as never);
const obj = (object: string) => ({ kind: 'object' as const, object });

describe('triggers on the enchanted or equipped creature', () => {
  it('“Whenever equipped creature attacks, it gets +2/+0”', () => {
    let g = setup();
    const bear = give(g, 'alice', 'Grizzly', 'battlefield');
    const blade = give(g, 'alice', 'Rally Blade', 'battlefield');
    g.objects[blade]!.attachedTo = { id: bear, zcc: g.objects[bear]!.zcc };
    g = toStep(g, 'declare_attackers');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'bob' } }] } });
    g = settle(g);
    while (g.step !== 'end_of_combat' && g.step !== 'main2') {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks: [] } });
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.players.bob!.life).toBe(16);
  });

  it('CR 603.10a: “When enchanted creature dies, return that card …” — even when the Aura dies with it', () => {
    for (const how of ['murder', 'wrath'] as const) {
      let g = setup();
      const bear = give(g, 'alice', 'Grizzly', 'battlefield');
      const aura = give(g, 'alice', 'Second Chance', 'battlefield');
      g.objects[aura]!.attachedTo = { id: bear, zcc: g.objects[bear]!.zcc };
      g = how === 'murder' ? cast(g, 'Murder Lite', [[obj(bear)]]) : cast(g, 'Wrath Lite');
      g = settle(g);
      expect(g.objects[bear]!.zone).toBe('battlefield');
      expect(g.objects[aura]!.zone).toBe('graveyard');
    }
  });
});

describe('CR 506.5, CR 614.1a, CR 700.6, digs', () => {
  it('“can’t attack alone”', () => {
    let g = setup();
    const lonely = give(g, 'alice', 'Lonely Bear', 'battlefield');
    const bear = give(g, 'alice', 'Grizzly', 'battlefield');
    g = toStep(g, 'declare_attackers');
    const bob = { kind: 'player' as const, player: 'bob' };
    expect(() => act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: lonely, target: bob }] } })).toThrow(/alone/);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: lonely, target: bob }, { attacker: bear, target: bob }] } });
    expect(Object.keys(g.combat!.attackers)).toHaveLength(2);
  });

  it('“If ~ would be put into a graveyard from anywhere, … shuffle it into its owner’s library instead”', () => {
    let g = setup();
    const titan = give(g, 'alice', 'Titan Lite', 'battlefield');
    const library = g.zones.library.alice!.length;
    g = settle(cast(g, 'Murder Lite', [[obj(titan)]]));
    expect(g.objects[titan]!.zone).toBe('library');
    expect(g.zones.library.alice!.length).toBe(library + 1);
  });

  it('CR 700.6: historic — an artifact card is, a bear isn’t', () => {
    let g = setup();
    const relic = give(g, 'alice', 'Relic', 'graveyard');
    const bear = give(g, 'alice', 'Grizzly', 'graveyard');
    expect(() => cast(g, 'Henge Lite', [[obj(bear)]])).toThrow(/legal target/);
    g = settle(cast(g, 'Henge Lite', [[obj(relic)]]));
    expect(g.objects[relic]!.zone).toBe('hand');
  });

  it('“Put up to two land cards from among them onto the battlefield tapped”', () => {
    let g = setup();
    const before = g.zones.battlefield.length;
    g = settle(cast(g, 'Survey Lite'));
    if (g.pending?.kind === 'choose_objects') {
      g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: g.pending.candidates.slice(0, 2) } });
    }
    const lands = g.zones.battlefield.slice(before).map((id) => g.objects[id]!);
    expect(lands).toHaveLength(2);
    expect(lands.every((o) => o.tapped)).toBe(true);
  });

  it('“Look at the top two cards. Put one of them into your graveyard.” — the other stays on top', () => {
    let g = setup();
    const [first, second] = g.zones.library.alice!;
    g = settle(cast(g, 'Sanctifier Lite'));
    expect(g.pending?.kind).toBe('choose_objects');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [first!] } });
    expect(g.objects[first!]!.zone).toBe('graveyard');
    expect(g.zones.library.alice![0]).toBe(second);
  });
});
