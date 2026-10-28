import { describe, expect, it } from 'vitest';
import { chars, hasKeyword, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Tear Asunder', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Kicker {1}{B}\nExile target artifact or enchantment. If this spell was kicked, exile target nonland permanent instead.' }),
  makeCard({ name: 'Jilt', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Kicker {1}{R}\nReturn target creature to its owner\'s hand. If this spell was kicked, it deals 2 damage to another target creature.' }),
  makeCard({ name: 'Probe', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Kicker {1}{B}\nDraw three cards, then discard two cards. If this spell was kicked, target player discards two cards.' }),
  makeCard({ name: 'Into the Flood Maw', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Gift a tapped Fish\nReturn target creature an opponent controls to its owner's hand. If the gift was promised, instead return target nonland permanent an opponent controls to its owner's hand." }),
  makeCard({ name: 'Rakdos Charm', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Choose one —\n• Exile target player's graveyard.\n• Destroy target artifact.\n• Each creature deals 1 damage to its controller." }),
  makeCard({ name: 'Wave of Reckoning', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each creature deals damage to itself equal to its power.' }),
  makeCard({ name: "Kamahl's Will", type_line: 'Instant', mana_cost: '{0}', oracle_text: "Choose target creature you don't control. Each creature you control deals damage equal to its power to that creature." }),
  makeCard({ name: 'Inspiring Call', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Draw a card for each creature you control with a +1/+1 counter on it. Those creatures gain indestructible until end of turn.' }),
  makeCard({ name: 'Unbreakable Formation', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Creatures you control gain indestructible until end of turn.\nAddendum — If you cast this spell during your main phase, put a +1/+1 counter on each of those creatures and they gain vigilance until end of turn.' }),
  makeCard({ name: 'Code of Constraint', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Target creature gets -4/-0 until end of turn.\nDraw a card.\nAddendum — If you cast this spell during your main phase, tap that creature and it doesn't untap during its controller's next untap step." }),
  makeCard({ name: 'Return to Dust', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Exile target artifact or enchantment. If you cast this spell during your main phase, you may exile up to one other target artifact or enchantment.' }),
  makeCard({ name: 'Essence Flux', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Exile target creature you control, then return that card to the battlefield under its owner's control. If it's a Spirit, put a +1/+1 counter on it." }),
  makeCard({ name: 'Inspiring Statuary', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Nonartifact spells you cast have improvise.' }),
  makeCard({ name: "Archdruid's Charm", type_line: 'Instant', mana_cost: '{0}', oracle_text: "Choose one —\n• Search your library for a creature or land card and reveal it. Put it onto the battlefield tapped if it's a land card. Otherwise, put it into your hand. Then shuffle.\n• Put a +1/+1 counter on target creature you control. It deals damage equal to its power to target creature you don't control.\n• Exile target artifact or enchantment." }),
  makeCard({ name: "Dawn's Truce", type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Gift a card\nYou and permanents you control gain hexproof until end of turn. If the gift was promised, permanents you control also gain indestructible until end of turn.' }),
  makeCard({ name: "Sevinne's Reclamation", type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Return target permanent card with mana value 3 or less from your graveyard to the battlefield. If this spell was cast from a graveyard, you may copy this spell and may choose a new target for the copy.\nFlashback {0}' }),
  makeCard({ name: 'Midnight Clock', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{2}{U}: Put an hour counter on this artifact.\nWhen the twelfth hour counter is put on this artifact, shuffle your hand and graveyard into your library, then draw seven cards. Exile this artifact.' }),
  makeCard({ name: 'Dread General', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each opponent chooses a permanent they control of each permanent type and sacrifices the rest.' }),
  makeCard({ name: 'Annihilation', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each player chooses two lands they control, then sacrifices the rest.' }),
  makeCard({ name: 'Bloodletter of Aclazotz', type_line: 'Creature — Vampire Demon', mana_cost: '{0}', power: '2', toughness: '4', oracle_text: 'Flying\nIf an opponent would lose life during your turn, they lose twice that much life instead.' }),
  makeCard({ name: 'Drain', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each opponent loses 2 life.' }),
  makeCard({ name: 'Cloud Key', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'As this artifact enters, choose artifact, creature, enchantment, instant, or sorcery.\nSpells you cast of the chosen type cost {1} less to cast.' }),
  makeCard({ name: 'Mule', type_line: 'Artifact Creature — Construct', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Charm', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: '' }),
  makeCard({ name: 'Two Drop', type_line: 'Sorcery', mana_cost: '{1}', cmc: 1, oracle_text: 'Draw a card.' }),
  makeCard({ name: 'Increasing Devotion', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Create five 1/1 white Human creature tokens. If this spell was cast from a graveyard, create ten of those tokens instead.\nFlashback {0}' }),
  makeCard({ name: 'Archon of Valor\'s Reach', type_line: 'Creature — Archon', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: 'As this creature enters, choose artifact, enchantment, instant, sorcery, or planeswalker.\nPlayers can\'t cast spells of the chosen type.' }),
  makeCard({ name: 'Increasing Vengeance', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Copy target instant or sorcery spell you control. If this spell was cast from a graveyard, copy that spell twice instead. You may choose new targets for the copies.' }),
  makeCard({ name: 'Shock', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Shock deals 2 damage to any target.' }),
  makeCard({ name: 'Relic', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: '' }),
  makeCard({ name: 'Wall', type_line: 'Creature — Wall', mana_cost: '{0}', power: '0', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Wisp', type_line: 'Creature — Spirit', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Big Bolt', type_line: 'Instant', mana_cost: '{3}{R}', cmc: 4, oracle_text: 'Big Bolt deals 3 damage to any target.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const obj = (id: string) => ({ kind: 'object' as const, object: id });

describe('staples (slice 170: targets chosen knowing kicker, gift, addendum; each creature deals damage)', () => {
  it('Tear Asunder: unkicked, an artifact; kicked, one nonland permanent instead (CR 601.2c)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const relic = give(g, 'bob', 'Relic', 'battlefield');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    // Unkicked: a creature isn't a legal target.
    expect(() => act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Tear Asunder', 'hand'), targets: [[obj(ogre)]] })).toThrow();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Tear Asunder', 'hand'), targets: [[obj(relic)]] }));
    expect(g.objects[relic]!.zone).toBe('exile');
    g.players.alice!.pool.B = 1;
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Tear Asunder', 'hand'), kicked: true, targets: [[obj(ogre)]] }));
    expect(g.objects[ogre]!.zone).toBe('exile');
  });

  it('Jilt: kicked, "another target creature" can\'t be the creature returned', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g.players.alice!.pool.R = 1;
    g.players.alice!.pool.C = 1;
    const jilt = give(g, 'alice', 'Jilt', 'hand');
    expect(() => act(g, { type: 'cast', player: 'alice', object: jilt, kicked: true, targets: [[obj(ogre)], [obj(ogre)]] })).toThrow(/different/);
    g = settle(act(g, { type: 'cast', player: 'alice', object: jilt, kicked: true, targets: [[obj(ogre)], [obj(bear)]] }));
    expect(g.objects[ogre]!.zone).toBe('hand');
    expect(g.objects[bear]!.zone).toBe('graveyard');
  });

  it('Probe: unkicked, it has no target', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const probe = give(g, 'alice', 'Probe', 'hand');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === probe && !(a as { targets?: unknown[] }).targets)).toBe(true);
    g = act(g, { type: 'cast', player: 'alice', object: probe });
    expect(g.stack.length).toBe(1);
  });

  it('Into the Flood Maw: with the gift promised, a nonland permanent instead', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const relic = give(g, 'bob', 'Relic', 'battlefield');
    const maw = give(g, 'alice', 'Into the Flood Maw', 'hand');
    // The gift's offer comes with a target it can have.
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === maw && (a as { extras?: string[] }).extras?.includes('gift'))).toBe(true);
    g = settle(act(g, { type: 'cast', player: 'alice', object: maw, extras: ['gift'], targets: [[obj(relic)]] }));
    expect(g.objects[relic]!.zone).toBe('hand');
  });

  it('Rakdos Charm: each creature deals 1 damage to its controller', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Bear', 'battlefield');
    give(g, 'bob', 'Bear', 'battlefield');
    give(g, 'bob', 'Ogre', 'battlefield');
    const [a, b] = [g.players.alice!.life, g.players.bob!.life];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Rakdos Charm', 'hand'), modes: [2] }));
    expect(g.players.alice!.life).toBe(a - 1);
    expect(g.players.bob!.life).toBe(b - 2);
  });

  it('Wave of Reckoning: each creature deals damage to itself equal to its power', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    const wall = give(g, 'bob', 'Wall', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Wave of Reckoning', 'hand') }));
    expect(g.objects[ogre]!.zone).toBe('graveyard');
    expect(g.objects[bear]!.zone).toBe('graveyard');
    expect(g.objects[wall]!.zone).toBe('battlefield');
  });

  it("Kamahl's Will: each creature you control deals damage equal to its power to the target", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Bear', 'battlefield');
    give(g, 'alice', 'Wisp', 'battlefield');
    const wall = give(g, 'bob', 'Wall', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', "Kamahl's Will", 'hand'), targets: [[obj(wall)]] }));
    expect(g.objects[wall]!.zone).toBe('graveyard');
  });

  it('Inspiring Call: those creatures — the ones counted — gain indestructible', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [b1, b2, b3] = [0, 1, 2].map(() => give(g, 'alice', 'Bear', 'battlefield'));
    g.objects[b1!]!.counters['+1/+1'] = 1;
    g.objects[b2!]!.counters['+1/+1'] = 1;
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Inspiring Call', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
    expect(hasKeyword(g, g.objects[b1!]!, 'indestructible')).toBe(true);
    expect(hasKeyword(g, g.objects[b3!]!, 'indestructible')).toBe(false);
  });

  it('Unbreakable Formation: the addendum only when cast during your main phase', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Unbreakable Formation', 'hand') }));
    expect(g.objects[bear]!.counters['+1/+1']).toBe(1);
    expect(hasKeyword(g, g.objects[bear]!, 'vigilance')).toBe(true);
    // In combat, it isn't the main phase.
    let h = toStep(start({ extra: CARDS }), 'beginning_of_combat', 'alice');
    const bear2 = give(h, 'alice', 'Bear', 'battlefield');
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Unbreakable Formation', 'hand') }));
    expect(hasKeyword(h, h.objects[bear2]!, 'indestructible')).toBe(true);
    expect(h.objects[bear2]!.counters['+1/+1'] ?? 0).toBe(0);
  });

  it('Code of Constraint: "that creature" in the addendum is the target', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Code of Constraint', 'hand'), targets: [[obj(ogre)]] }));
    expect(g.objects[ogre]!.tapped).toBe(true);
    expect(chars(g, g.objects[ogre]!).power).toBe(1);
  });

  it('Return to Dust: the second target only during your main phase', () => {
    let g = toStep(start({ extra: CARDS }), 'beginning_of_combat', 'alice');
    const [r1, r2] = [0, 1].map(() => give(g, 'bob', 'Relic', 'battlefield'));
    expect(() => act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Return to Dust', 'hand'), targets: [[obj(r1!)], [obj(r2!)]] })).toThrow();
    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [s1, s2] = [0, 1].map(() => give(h, 'bob', 'Relic', 'battlefield'));
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Return to Dust', 'hand'), targets: [[obj(s1!)], [obj(s2!)]] }));
    if (h.pending?.kind === 'may') h = settle(act(h, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    expect(h.objects[s1!]!.zone).toBe('exile');
    expect(h.objects[s2!]!.zone).toBe('exile');
  });

  it('Essence Flux: a Spirit gets the counter as it returns; another creature doesn\'t', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const wisp = give(g, 'alice', 'Wisp', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Essence Flux', 'hand'), targets: [[obj(wisp)]] }));
    expect(g.objects[wisp]!.zone).toBe('battlefield');
    expect(g.objects[wisp]!.counters['+1/+1']).toBe(1);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Essence Flux', 'hand'), targets: [[obj(bear)]] }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.objects[bear]!.counters['+1/+1'] ?? 0).toBe(0);
  });

  it('Inspiring Statuary: nonartifact spells you cast have improvise', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Inspiring Statuary', 'battlefield');
    const relics = [0, 1, 2].map(() => give(g, 'alice', 'Relic', 'battlefield'));
    g.players.alice!.pool.R = 1;
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Big Bolt', 'hand'), costs: { improvise: relics }, targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.players.bob!.life).toBe(life - 3);
    expect(relics.every((id) => g.objects[id]!.tapped)).toBe(true);
  });

  it("Archdruid's Charm: a land onto the battlefield tapped, a creature into your hand", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const forest = give(g, 'alice', 'Forest', 'library');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', "Archdruid's Charm", 'hand'), modes: [0] }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [forest] } } as never));
    expect(g.objects[forest]!.zone).toBe('battlefield');
    expect(g.objects[forest]!.tapped).toBe(true);
    const bear = give(g, 'alice', 'Bear', 'library');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', "Archdruid's Charm", 'hand'), modes: [0] }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [bear] } } as never));
    expect(g.objects[bear]!.zone).toBe('hand');
  });
  it("Dawn's Truce: you and your permanents get hexproof; indestructible too with the gift", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', "Dawn's Truce", 'hand'), extras: ['gift'] }));
    expect(hasKeyword(g, g.objects[bear]!, 'hexproof')).toBe(true);
    expect(hasKeyword(g, g.objects[bear]!, 'indestructible')).toBe(true);
  });

  it("Sevinne's Reclamation: from the graveyard, it copies itself for another target", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [r1, r2] = [0, 1].map(() => give(g, 'alice', 'Relic', 'graveyard'));
    const sev = give(g, 'alice', "Sevinne's Reclamation", 'graveyard');
    g = act(g, { type: 'cast', player: 'alice', object: sev, targets: [[obj(r1!)]] });
    g = settle(g);
    if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    expect(g.pending?.kind).toBe('copy_targets');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'copy_targets', targets: [[obj(r2!)]] } } as never));
    expect(g.objects[r1!]!.zone).toBe('battlefield');
    expect(g.objects[r2!]!.zone).toBe('battlefield');
    expect(g.objects[sev]!.zone).toBe('exile');
  });

  it('Midnight Clock: the twelfth hour counter, not the eleventh or thirteenth', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const clock = give(g, 'alice', 'Midnight Clock', 'battlefield');
    g.objects[clock]!.counters.hour = 10;
    const pay = () => {
      g.players.alice!.pool.U = 1;
      g.players.alice!.pool.C = 2;
      g = settle(act(g, { type: 'activate', player: 'alice', object: clock, ability: 0 }));
    };
    pay();
    expect(g.objects[clock]!.zone).toBe('battlefield');
    give(g, 'alice', 'Relic', 'graveyard');
    pay();
    expect(g.objects[clock]!.zone).toBe('exile');
    expect(g.zones.hand.alice!.length).toBe(7);
    expect(g.zones.graveyard.alice!.length).toBe(0);
  });

  it('Liliana-style: each opponent keeps one permanent of each type (one may count twice) and sacrifices the rest', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mule = give(g, 'bob', 'Mule', 'battlefield');
    const relic = give(g, 'bob', 'Relic', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const charm = give(g, 'bob', 'Charm', 'battlefield');
    const mine = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Dread General', 'hand') }));
    // Bob's artifact: the Mule (an artifact creature) or the Relic.
    expect(g.pending).toMatchObject({ kind: 'choose_objects', player: 'bob' });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'choose_objects', objects: [mule] } });
    // His creature: the Mule again.
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'choose_objects', objects: [mule] } }));
    expect(g.objects[mule]!.zone).toBe('battlefield');
    expect(g.objects[charm]!.zone).toBe('battlefield');
    expect(g.objects[relic]!.zone).toBe('graveyard');
    expect(g.objects[bear]!.zone).toBe('graveyard');
    expect(g.objects[mine]!.zone).toBe('battlefield');
  });

  it('"chooses two lands they control, then sacrifices the rest"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lands = [0, 1, 2].map(() => give(g, 'bob', 'Forest', 'battlefield'));
    const mineLand = give(g, 'alice', 'Forest', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Annihilation', 'hand') }));
    if (g.pending?.player === 'alice') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: (g.pending as { candidates: string[] }).candidates.slice(0, 2) } }));
    expect(g.pending).toMatchObject({ kind: 'choose_objects', player: 'bob', min: 2, max: 2 });
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'choose_objects', objects: [lands[0]!, lands[1]!] } }));
    expect(g.objects[lands[2]!]!.zone).toBe('graveyard');
    expect(g.objects[lands[0]!]!.zone).toBe('battlefield');
    expect(g.objects[mineLand]!.zone).toBe('battlefield');
  });

  it('Bloodletter of Aclazotz: opponents lose twice the life on your turn; the damage is the same', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Bloodletter of Aclazotz', 'battlefield');
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Drain', 'hand') }));
    expect(g.players.bob!.life).toBe(life - 4);
    g.players.alice!.pool.R = 1;
    g.players.alice!.pool.C = 3;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Big Bolt', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.players.bob!.life).toBe(life - 10);
    // Not on an opponent's turn.
    let h = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(h, 'alice', 'Bloodletter of Aclazotz', 'battlefield');
    const hl = h.players.bob!.life;
    h = act(h, { type: 'pass', player: 'bob' });
    h.players.alice!.pool.R = 1;
    h.players.alice!.pool.C = 3;
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Big Bolt', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(h.players.bob!.life).toBe(hl - 3);
  });

  it('Cloud Key: spells of the chosen card type cost {1} less', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const key = give(g, 'alice', 'Cloud Key', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: key }));
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'card_type' });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', choice: 'Sorcery' } }));
    expect(g.objects[key]!.chosen?.cardType).toBe('Sorcery');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Two Drop', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });
  it('Increasing Devotion: ten tokens cast from a graveyard, five from the hand', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const tokens = () => g.zones.battlefield.filter((id) => g.objects[id]!.token).length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Increasing Devotion', 'hand') }));
    expect(tokens()).toBe(5);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Increasing Devotion', 'graveyard') }));
    expect(tokens()).toBe(15);
  });

  it("Archon of Valor's Reach: players can't cast spells of the chosen card type", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', "Archon of Valor's Reach", 'hand') }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', choice: 'Sorcery' } }));
    expect(() => act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Two Drop', 'hand') })).toThrow();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Shock', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.players.bob!.life).toBe(18);
  });

  it('Increasing Vengeance: new targets for the copy cast from the hand too', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const shock = give(g, 'alice', 'Shock', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: shock, targets: [[{ kind: 'player', player: 'bob' }]] });
    const iv = give(g, 'alice', 'Increasing Vengeance', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: iv, targets: [[obj(shock)]] });
    g = settle(g);
    expect(g.pending?.kind).toBe('copy_targets');
  });
});
