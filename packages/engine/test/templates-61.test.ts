import { describe, expect, it } from 'vitest';
import { chars, legalActions, power, toughness } from '../src/index.js';
import { manaValueOf } from '../src/zones.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Bog', type_line: 'Basic Land — Swamp', mana_cost: '', oracle_text: '({T}: Add {B}.)' }),
  makeCard({ name: 'Choices', type_line: 'Sorcery', mana_cost: '{U}', oracle_text: 'Escalate {1} (Pay this cost for each mode chosen beyond the first.)\nChoose one or more —\n• You gain 2 life.\n• Draw a card.' }),
  makeCard({ name: 'Proto Golem', type_line: 'Artifact Creature — Golem', mana_cost: '{6}', cmc: 6, power: '6', toughness: '6', oracle_text: 'Prototype {1}{R} — 2/2\nTrample' }),
  makeCard({ name: 'Aura Lover', type_line: 'Creature — Spirit', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'This creature gets +2/+2 for each Aura attached to it.' }),
  makeCard({ name: 'Charm', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature' }),
  makeCard({ name: 'Storage Vault', type_line: 'Land', mana_cost: '', oracle_text: 'This land enters tapped with two charge counters on it.' }),
  makeCard({ name: 'Mayhem Imp', type_line: 'Creature — Imp', mana_cost: '{3}{B}', power: '2', toughness: '2', oracle_text: 'Mayhem {B} (You may cast this card from your graveyard for {B} if you discarded it this turn. Timing rules still apply.)' }),
  makeCard({ name: 'Rummage', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Discard a card, then draw a card.' }),
  makeCard({ name: 'Brawler', type_line: 'Creature — Human', mana_cost: '{1}{W}', power: '2', toughness: '2', oracle_text: 'Power-up — {4}{W}: Put two +1/+1 counters on this creature. (Activate each power-up ability only once. Reduce the cost by its mana cost if it entered this turn.)' }),
  makeCard({ name: 'Scrub', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Exile up to two target cards from a single graveyard.' }),
  makeCard({ name: 'Swamp Gate', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {C}.\n{T}: Add {B} or {R}. Activate only if you control a Swamp.' }),
];

describe('templates (slice 61)', () => {
  it('CR 602.5b: a mana ability that can be activated only if you control a Swamp', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const gate = give(g, 'alice', 'Swamp Gate', 'battlefield');
    const offers = () => legalActions(g, 'alice').filter((a) => a.type === 'activate_mana' && a.object === gate);
    expect(offers().length).toBe(1);
    expect(() => act(g, { type: 'activate_mana', player: 'alice', object: gate, ability: 1, choice: 0 })).toThrow(/can't be activated/);
    give(g, 'alice', 'Bog', 'battlefield');
    expect(offers().length).toBe(3);
    g = act(g, { type: 'activate_mana', player: 'alice', object: gate, ability: 1, choice: 1 });
    expect(g.players.alice!.pool.R).toBe(1);
  });

  it('CR 702.120a escalate: an additional cost for each mode beyond the first', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const c = give(g, 'alice', 'Choices', 'hand');
    g.players.alice!.pool = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 };
    expect(() => act(g, { type: 'cast', player: 'alice', object: c, modes: [0, 1] })).toThrow(/mana/);
    g.players.alice!.pool.C = 1;
    g = act(g, { type: 'cast', player: 'alice', object: c, modes: [0, 1] });
    expect(g.players.alice!.pool).toMatchObject({ U: 0, C: 0 });
  });

  it('CR 718.3b prototype: the inset mana cost, power, toughness and color while on the stack and battlefield', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const p = give(g, 'alice', 'Proto Golem', 'hand');
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 1, G: 0, C: 1 };
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === p && a.alt === 'prototype')).toBe(true);
    g = act(g, { type: 'cast', player: 'alice', object: p, alt: 'prototype' });
    expect(manaValueOf(g, g.objects[p]!)).toBe(2);
    while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
    const o = g.objects[p]!;
    expect([power(g, o), toughness(g, o), chars(g, o).colors]).toEqual([2, 2, ['R']]);
    // CR 718.4: elsewhere it's the normal card.
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: p, to: 'hand' } } as never);
    expect(manaValueOf(g, g.objects[p]!)).toBe(6);
  });

  it('"+2/+2 for each Aura attached to it"; "enters tapped with two charge counters"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const l = give(g, 'alice', 'Aura Lover', 'battlefield');
    const a = give(g, 'alice', 'Charm', 'battlefield');
    g.objects[a]!.attachedTo = { id: l, zcc: g.objects[l]!.zcc };
    expect(power(g, g.objects[l]!)).toBe(3);
    const v = give(g, 'alice', 'Storage Vault', 'hand');
    g = act(g, { type: 'play_land', player: 'alice', object: v });
    expect(g.objects[v]!.tapped).toBe(true);
    expect(g.objects[v]!.counters.charge).toBe(2);
  });

  it('CR 702.187 mayhem: cast from the graveyard the turn it was discarded', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const imp = give(g, 'alice', 'Mayhem Imp', 'graveyard');
    g.players.alice!.pool = { W: 0, U: 0, B: 1, R: 0, G: 0, C: 0 };
    // Put into the graveyard some other way: no.
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === imp)).toBe(false);
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: imp, to: 'hand' } } as never);
    const r = give(g, 'alice', 'Rummage', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: r });
    for (let i = 0; i < 8 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'discard') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: [imp] } });
      else if (g.pending) throw new Error(`unexpected ${g.pending.kind}`);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.objects[imp]!.zone).toBe('graveyard');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === imp && a.alt === 'mayhem')).toBe(true);
    g = act(g, { type: 'cast', player: 'alice', object: imp, alt: 'mayhem' });
    expect(g.objects[imp]!.zone).toBe('stack');
  });

  it('CR 702.193 power-up: cheaper by its mana cost the turn it entered; only once', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const b = give(g, 'alice', 'Brawler', 'hand');
    g.players.alice!.pool = { W: 1, U: 0, B: 0, R: 0, G: 0, C: 1 };
    g = act(g, { type: 'cast', player: 'alice', object: b });
    while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
    // {4}{W} less {1}{W}: {3}.
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 };
    expect(() => act(g, { type: 'activate', player: 'alice', object: b, ability: 0 })).toThrow(/mana/);
    g.players.alice!.pool.C = 3;
    g = act(g, { type: 'activate', player: 'alice', object: b, ability: 0 });
    while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.objects[b]!.counters['+1/+1']).toBe(2);
    g.players.alice!.pool = { W: 5, U: 0, B: 0, R: 0, G: 0, C: 0 };
    expect(() => act(g, { type: 'activate', player: 'alice', object: b, ability: 0 })).toThrow(/only once/);
  });

  it('"up to two target cards from a single graveyard"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const s = give(g, 'alice', 'Scrub', 'hand');
    const a = give(g, 'alice', 'Bog', 'graveyard');
    const b1 = give(g, 'bob', 'Bog', 'graveyard');
    const b2 = give(g, 'bob', 'Bog', 'graveyard');
    const t = (id: string) => ({ kind: 'object' as const, object: id });
    expect(() => act(g, { type: 'cast', player: 'alice', object: s, targets: [[t(a), t(b1)]] })).toThrow(/one graveyard/);
    g = act(g, { type: 'cast', player: 'alice', object: s, targets: [[t(b1), t(b2)]] });
    while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
    expect([g.objects[b1]!.zone, g.objects[b2]!.zone, g.objects[a]!.zone]).toEqual(['exile', 'exile', 'graveyard']);
  });
});

describe('Circle of Protection', () => {
  it('"The next time a red source of your choice would deal damage to you this turn, prevent that damage."', () => {
    const cop = makeCard({ name: 'Circle', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: '{0}: The next time a red source of your choice would deal damage to you this turn, prevent that damage.' });
    const bolt = makeCard({ name: 'Zap', type_line: 'Instant', mana_cost: '{R}', colors: ['R'], oracle_text: 'Zap deals 3 damage to any target.' });
    let g = toStep(start({ extra: [cop, bolt] }), 'main1', 'alice');
    const c = give(g, 'alice', 'Circle', 'battlefield');
    const z1 = give(g, 'bob', 'Zap', 'hand');
    const z2 = give(g, 'bob', 'Zap', 'hand');
    g.players.bob!.pool = { W: 0, U: 0, B: 0, R: 2, G: 0, C: 0 };
    // Bob can cast it at instant speed when he has priority: give him priority by having Alice pass with nothing.
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: z1, targets: [[{ kind: 'player', player: 'alice' }]] });
    g = act(g, { type: 'pass', player: 'bob' });
    g = act(g, { type: 'activate', player: 'alice', object: c, ability: 0 });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.pending).toMatchObject({ kind: 'choose_objects', candidates: [z1] });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [z1] } });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.players.alice!.life).toBe(20);
    // Used up: the next one hits.
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: z2, targets: [[{ kind: 'player', player: 'alice' }]] });
    while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.players.alice!.life).toBe(17);
  });
});

describe('mana abilities (slice 65)', () => {
  it('depletion lands, "for each Elf you control", "Activate only once each turn"', () => {
    const CARDS2 = [
      makeCard({ name: 'Depleted', type_line: 'Land', mana_cost: '', oracle_text: 'This land enters tapped with two depletion counters on it.\n{T}, Remove a depletion counter from this land: Add {U}{U}. If there are no depletion counters on this land, sacrifice it.' }),
      makeCard({ name: 'Archdruid', type_line: 'Creature — Elf Druid', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '{T}: Add {G} for each Elf you control.' }),
      makeCard({ name: 'Prism', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{1}: Add two mana of any one color. Activate only once each turn.' }),
    ];
    let g = toStep(start({ extra: CARDS2 }), 'main1', 'alice');
    const d = give(g, 'alice', 'Depleted', 'battlefield');
    g.objects[d]!.counters.depletion = 1;
    g = act(g, { type: 'activate_mana', player: 'alice', object: d, ability: 0, costs: {} });
    expect(g.players.alice!.pool.U).toBe(2);
    expect(g.objects[d]!.zone).toBe('graveyard');
    const a = give(g, 'alice', 'Archdruid', 'battlefield');
    give(g, 'alice', 'Archdruid', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: a, ability: 0 });
    expect(g.players.alice!.pool.G).toBe(2);
    const p = give(g, 'alice', 'Prism', 'battlefield');
    g.players.alice!.pool.C = 2;
    g = act(g, { type: 'activate_mana', player: 'alice', object: p, ability: 0, choice: 'R' });
    expect(g.players.alice!.pool.R).toBe(2);
    expect(() => act(g, { type: 'activate_mana', player: 'alice', object: p, ability: 0, choice: 'R' })).toThrow(/once each turn/);
  });
});

describe('untap up to N (slice 65)', () => {
  it('"When this creature enters, untap up to two lands."', () => {
    const whale = makeCard({ name: 'Whale', type_line: 'Creature — Whale', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: 'When this creature enters, untap up to two lands.' });
    let g = toStep(start({ extra: [whale] }), 'main1', 'alice');
    const lands = [give(g, 'alice', 'Forest', 'battlefield'), give(g, 'alice', 'Forest', 'battlefield'), give(g, 'alice', 'Forest', 'battlefield')];
    for (const l of lands) g.objects[l]!.tapped = true;
    const w = give(g, 'alice', 'Whale', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: w });
    for (let i = 0; i < 8 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'choose_objects') {
        expect(g.pending.max).toBe(2);
        g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: lands.slice(0, 2) } });
      } else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(lands.map((l) => g.objects[l]!.tapped)).toEqual([false, false, true]);
  });
});

describe('storage lands (slice 67)', () => {
  it('"Remove any number of storage counters from this land: Add {B} for each storage counter removed this way."', () => {
    const vault = makeCard({ name: 'Vault', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {C}.\n{1}, Remove any number of storage counters from this land: Add {B} for each storage counter removed this way.' });
    let g = toStep(start({ extra: [vault] }), 'main1', 'alice');
    const v = give(g, 'alice', 'Vault', 'battlefield');
    g.objects[v]!.counters.storage = 3;
    g.players.alice!.pool.C = 1;
    expect(() => act(g, { type: 'activate_mana', player: 'alice', object: v, ability: 1, costs: { counters: 4 } })).toThrow(/enough/);
    g = act(g, { type: 'activate_mana', player: 'alice', object: v, ability: 1, costs: { counters: 2 } });
    expect(g.players.alice!.pool).toMatchObject({ B: 2, C: 0 });
    expect(g.objects[v]!.counters.storage).toBe(1);
  });
});

describe('CR 700.2d: the same mode more than once', () => {
  it('"Choose three. You may choose the same mode more than once."', () => {
    const conf = makeCard({ name: 'Confluence', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Choose three. You may choose the same mode more than once.\n• You gain 2 life.\n• Draw a card.\n• Target player mills two cards.' });
    let g = toStep(start({ extra: [conf] }), 'main1', 'alice');
    const c = give(g, 'alice', 'Confluence', 'hand');
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'cast', player: 'alice', object: c, modes: [1, 1, 0] });
    while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.zones.hand.alice!.length).toBe(hand - 1 + 2);
    expect(g.players.alice!.life).toBe(22);
    // Each instance of a targeted mode has its own target.
    const c2 = give(g, 'alice', 'Confluence', 'hand');
    const lib = g.zones.library.bob!.length;
    g = act(g, { type: 'cast', player: 'alice', object: c2, modes: [2, 2, 2], targets: [[{ kind: 'player', player: 'bob' }], [{ kind: 'player', player: 'bob' }], [{ kind: 'player', player: 'bob' }]] });
    while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.zones.library.bob!.length).toBe(lib - 6);
  });
});

describe('X in additional costs', () => {
  it('"As an additional cost to cast this spell, pay X life."', () => {
    const agony = makeCard({ name: 'Agony', type_line: 'Sorcery', mana_cost: '{X}', oracle_text: 'As an additional cost to cast this spell, pay X life.\nTarget player loses X life.' });
    let g = toStep(start({ extra: [agony] }), 'main1', 'alice');
    const a = give(g, 'alice', 'Agony', 'hand');
    g.players.alice!.pool.C = 3;
    g = act(g, { type: 'cast', player: 'alice', object: a, x: 3, targets: [[{ kind: 'player', player: 'bob' }]] });
    expect(g.players.alice!.life).toBe(17);
    while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.players.bob!.life).toBe(17);
  });
});

describe('CR 701.59: collect evidence', () => {
  it('an optional additional cost; "If evidence was collected"', () => {
    const study = makeCard({ name: 'Study', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'As an additional cost to cast this spell, you may collect evidence 4.\nDraw a card. If evidence was collected, draw two cards instead.' });
    const big = makeCard({ name: 'Big Thing', type_line: 'Creature — Beast', mana_cost: '{3}', cmc: 3, power: '3', toughness: '3', oracle_text: '' });
    let g = toStep(start({ extra: [study, big] }), 'main1', 'alice');
    const s = give(g, 'alice', 'Study', 'hand');
    const b1 = give(g, 'alice', 'Big Thing', 'graveyard');
    const b2 = give(g, 'alice', 'Big Thing', 'graveyard');
    expect(() => act(g, { type: 'cast', player: 'alice', object: s, extras: ['collect_evidence'], costs: { exile: [b1] } })).toThrow(/total mana value/);
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === s && a.extras?.includes('collect_evidence'))).toBe(true);
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'cast', player: 'alice', object: s, extras: ['collect_evidence'], costs: { exile: [b1, b2] } });
    expect([g.objects[b1]!.zone, g.objects[b2]!.zone]).toEqual(['exile', 'exile']);
    while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.zones.hand.alice!.length).toBe(hand - 1 + 2);
  });
});
