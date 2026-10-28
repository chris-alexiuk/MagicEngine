import { describe, expect, it } from 'vitest';
import { chars, hasKeyword, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Six', type_line: 'Legendary Creature — Wolf', mana_cost: '{0}', power: '2', toughness: '4', oracle_text: 'Reach\nWhenever Six attacks, mill three cards. You may put a land card from among them into your hand.\nDuring your turn, nonland permanent cards in your graveyard have retrace. (You may cast permanent cards from your graveyard by discarding a land card in addition to paying their other costs.)' }),
  makeCard({ name: 'Ripples of Undeath', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'At the beginning of your first main phase, mill three cards. Then you may pay {1} and 3 life. If you do, put a card from among those cards into your hand.' }),
  makeCard({ name: 'Emry', type_line: 'Legendary Creature — Merfolk Wizard', mana_cost: '{0}', power: '1', toughness: '2', oracle_text: '{T}: Choose target artifact card in your graveyard. You may cast that card this turn.' }),
  makeCard({ name: 'Urza', type_line: 'Legendary Artifact Creature — Human Artificer', mana_cost: '{0}', power: '1', toughness: '4', oracle_text: '{5}: Shuffle your library, then exile the top card. Until end of turn, you may play that card without paying its mana cost.' }),
  makeCard({ name: 'Nesting Grounds', type_line: 'Land', oracle_text: '{T}: Add {C}.\n{1}, {T}: Move a counter from target permanent you control onto a second target permanent. Activate only as a sorcery.' }),
  makeCard({ name: 'Kodama', type_line: 'Legendary Creature — Spirit', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Modified creatures you control have trample.' }),
  makeCard({ name: 'Closet', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Whenever a modified creature you control leaves the battlefield, put a +1/+1 counter on this artifact.' }),
  makeCard({ name: 'Watcher', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever a creature you control with a +1/+1 counter on it dies, you gain 5 life.' }),
  makeCard({ name: 'Sludge Titan', type_line: 'Creature — Zombie Giant', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: 'Trample\nWhenever this creature enters or attacks, mill five cards. You may put a creature card and/or a land card from among them into your hand.' }),
  makeCard({ name: 'Void Winnower', type_line: 'Creature — Eldrazi', mana_cost: '{0}', power: '11', toughness: '9', oracle_text: "Your opponents can't cast spells with even mana values. (Zero is even.)\nYour opponents can't block with creatures with even mana values." }),
  makeCard({ name: 'Erebos', type_line: 'Legendary Enchantment Creature — God', mana_cost: '{0}', power: '5', toughness: '6', oracle_text: 'Whenever another creature you control dies, you may pay 2 life. If you do, draw a card.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Ox', type_line: 'Creature — Ox', mana_cost: '{3}', cmc: 3, power: '2', toughness: '4', oracle_text: '' }),
  makeCard({ name: 'Relic', type_line: 'Artifact', mana_cost: '{3}', cmc: 3, oracle_text: '' }),
  makeCard({ name: 'Sword', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equip {2}' }),
  makeCard({ name: 'Murder', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature.' }),
  makeCard({ name: 'Two Drop', type_line: 'Sorcery', mana_cost: '{2}', cmc: 2, oracle_text: 'Draw a card.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const toTop = (g: GameState, p: string, ids: string[]) => {
  const lib = g.zones.library[p]!;
  for (const id of [...ids].reverse()) {
    if (lib.includes(id)) lib.splice(lib.indexOf(id), 1);
    lib.unshift(id);
  }
};
const declareAttack = (g: GameState, attacker: string): GameState => {
  g = toStep(g, 'beginning_of_combat');
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker, target: { kind: 'player', player: 'bob' } }] } });
};

describe('staples (slice 165)', () => {
  it('Six: mill three, a land from among them to your hand', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const six = give(g, 'alice', 'Six', 'battlefield');
    g.objects[six]!.sick = false;
    const bear = give(g, 'alice', 'Bear', 'library');
    const relic = give(g, 'alice', 'Relic', 'library');
    const forest = g.zones.library.alice!.find((id) => chars(g, g.objects[id]!).types.includes('Land'))!;
    toTop(g, 'alice', [bear, relic, forest]);
    g = declareAttack(g, six);
    g = settle(g);
    expect(g.pending?.kind).toBe('choose_objects');
    const p = g.pending as { candidates: string[] };
    // Only the land qualifies.
    expect(p.candidates).toEqual([forest]);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [forest] } }));
    expect(g.objects[forest]!.zone).toBe('hand');
    expect(g.objects[bear]!.zone).toBe('graveyard');
    expect(g.objects[relic]!.zone).toBe('graveyard');
  });

  it('Six: retrace for permanent cards during your turn only', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Six', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'graveyard');
    const land = give(g, 'alice', 'Forest', 'hand');
    g.players.alice!.pool.G = 2;
    expect(() => act(g, { type: 'cast', player: 'alice', object: bear, alt: 'retrace', costs: { discard: [] } })).toThrow();
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear, alt: 'retrace', costs: { discard: [land] } }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.objects[land]!.zone).toBe('graveyard');
    // On an opponent's turn, no retrace.
    const ox = give(g, 'alice', 'Ox', 'graveyard');
    g = toStep(g, 'main1', 'bob');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === ox)).toBe(false);
  });

  it('Ripples of Undeath: pay {1} and 3 life for a card from among those milled', () => {
    let g = toStep(start({ extra: CARDS }), 'upkeep', 'alice');
    give(g, 'alice', 'Ripples of Undeath', 'battlefield');
    const top = g.zones.library.alice!.slice(0, 3);
    const life = g.players.alice!.life;
    g = toStep(g, 'main1', 'alice');
    g = settle(g);
    for (const id of top) expect(g.objects[id]!.zone).toBe('graveyard');
    expect(g.pending?.kind).toBe('pay');
    g.players.alice!.pool.C = 1;
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true } });
    expect(g.pending?.kind).toBe('choose_objects');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [top[1]!] } }));
    expect(g.objects[top[1]!]!.zone).toBe('hand');
    expect(g.players.alice!.life).toBe(life - 3);
  });

  it('Emry: an artifact card cast from the graveyard this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const emry = give(g, 'alice', 'Emry', 'battlefield');
    g.objects[emry]!.sick = false;
    const relic = give(g, 'alice', 'Relic', 'graveyard');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === relic)).toBe(false);
    g = settle(act(g, { type: 'activate', player: 'alice', object: emry, ability: 0, targets: [[{ kind: 'object', object: relic }]] }));
    g.players.alice!.pool.C = 3;
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === relic)).toBe(true);
    g = settle(act(g, { type: 'cast', player: 'alice', object: relic }));
    expect(g.objects[relic]!.zone).toBe('battlefield');
  });

  it('Emry: the permission lasts this turn only', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const emry = give(g, 'alice', 'Emry', 'battlefield');
    g.objects[emry]!.sick = false;
    const relic = give(g, 'alice', 'Relic', 'graveyard');
    g = settle(act(g, { type: 'activate', player: 'alice', object: emry, ability: 0, targets: [[{ kind: 'object', object: relic }]] }));
    g = toStep(toStep(g, 'main1', 'bob'), 'main1', 'alice');
    g.players.alice!.pool.C = 3;
    expect(() => act(g, { type: 'cast', player: 'alice', object: relic })).toThrow();
  });

  it('Urza: shuffle, exile the top card, play it free this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const urza = give(g, 'alice', 'Urza', 'battlefield');
    // Only Two Drops in the library, so whichever ends up on top is one.
    const drops = [0, 1, 2].map(() => give(g, 'alice', 'Two Drop', 'library'));
    g.zones.library.alice = [...drops];
    g.players.alice!.pool.C = 5;
    g = settle(act(g, { type: 'activate', player: 'alice', object: urza, ability: 0 }));
    const exiled = drops.filter((id) => g.objects[id]!.zone === 'exile');
    expect(exiled).toHaveLength(1);
    // No mana left: it's free.
    g = settle(act(g, { type: 'cast', player: 'alice', object: exiled[0]! }));
    expect(g.objects[exiled[0]!]!.zone).toBe('graveyard');
  });

  it('Nesting Grounds: move a counter of the chosen kind', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const nest = give(g, 'alice', 'Nesting Grounds', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const ox = give(g, 'alice', 'Ox', 'battlefield');
    g.objects[bear]!.counters['+1/+1'] = 2;
    g.objects[bear]!.counters.charge = 1;
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: nest, ability: 0, targets: [[{ kind: 'object', object: bear }], [{ kind: 'object', object: ox }]] }));
    expect(g.pending?.kind).toBe('choose_option');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: '+1/+1' } }));
    expect(g.objects[bear]!.counters['+1/+1']).toBe(1);
    expect(g.objects[ox]!.counters['+1/+1']).toBe(1);
    expect(g.objects[bear]!.counters.charge).toBe(1);
  });

  it('Kodama of the West Tree: modified means a counter, an Equipment or your own Aura', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Kodama', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const ox = give(g, 'alice', 'Ox', 'battlefield');
    const sword = give(g, 'alice', 'Sword', 'battlefield');
    expect(hasKeyword(g, g.objects[bear]!, 'trample')).toBe(false);
    g.objects[bear]!.counters['+1/+1'] = 1;
    g.objects[sword]!.attachedTo = { id: ox, zcc: g.objects[ox]!.zcc };
    g.clock++;
    expect(hasKeyword(g, g.objects[bear]!, 'trample')).toBe(true);
    expect(hasKeyword(g, g.objects[ox]!, 'trample')).toBe(true);
  });

  it('look-back: a modified creature leaving, a creature with a counter dying', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const closet = give(g, 'alice', 'Closet', 'battlefield');
    give(g, 'alice', 'Watcher', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const ox = give(g, 'alice', 'Ox', 'battlefield');
    g.objects[bear]!.counters['+1/+1'] = 1;
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[closet]!.counters['+1/+1']).toBe(1);
    expect(g.players.alice!.life).toBe(life + 5);
    // An unmodified creature: nothing.
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder', 'hand'), targets: [[{ kind: 'object', object: ox }]] }));
    expect(g.objects[closet]!.counters['+1/+1']).toBe(1);
    expect(g.players.alice!.life).toBe(life + 5);
  });

  it('Sludge Titan: a creature card and a land card, not two creatures', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'library');
    const ox = give(g, 'alice', 'Ox', 'library');
    const relic = give(g, 'alice', 'Relic', 'library');
    const forest = g.zones.library.alice!.find((id) => chars(g, g.objects[id]!).types.includes('Land'))!;
    toTop(g, 'alice', [bear, ox, relic, forest]);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Sludge Titan', 'hand') }));
    expect(g.pending?.kind).toBe('choose_objects');
    expect(() => act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [bear, ox] } })).toThrow();
    expect(() => act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [relic] } })).toThrow();
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [ox, forest] } }));
    expect(g.objects[ox]!.zone).toBe('hand');
    expect(g.objects[forest]!.zone).toBe('hand');
    expect(g.objects[bear]!.zone).toBe('graveyard');
  });

  it('Void Winnower: no even spells, no even blockers', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Void Winnower', 'battlefield');
    g.players.bob!.pool.C = 2;
    expect(() => act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Two Drop', 'hand') })).toThrow();
    g.players.bob!.pool.C = 0;
    // Bob's even creature (the Bear, 2) can't block; the Ox (3) can.
    g = toStep(g, 'main1', 'alice');
    const attacker = give(g, 'alice', 'Ox', 'battlefield');
    g.objects[attacker]!.sick = false;
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const ox = give(g, 'bob', 'Ox', 'battlefield');
    g = declareAttack(g, attacker);
    for (let i = 0; i < 10 && g.pending?.kind !== 'declare_blockers'; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(() => act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: bear, attacker }] } } as never)).toThrow();
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: ox, attacker }] } } as never);
    expect(g.combat?.blockers[ox]).toBeDefined();
  });

  it('Erebos: pay 2 life to draw when another creature dies', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Erebos', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const life = g.players.alice!.life;
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.pending?.kind).toBe('pay');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true } }));
    expect(g.players.alice!.life).toBe(life - 2);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });
});
