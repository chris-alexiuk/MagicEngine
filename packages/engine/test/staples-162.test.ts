import { describe, expect, it } from 'vitest';
import { chars, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Citadel', type_line: 'Legendary Artifact', mana_cost: '{0}', oracle_text: 'You may look at the top card of your library any time.\nYou may play lands and cast spells from the top of your library. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.\n{T}, Sacrifice ten nonland permanents: Each opponent loses 10 life.' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{2}{R}', cmc: 3, colors: ['R'], color_identity: ['R'], power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Breach', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Each nonland card in your graveyard has escape. The escape cost is equal to the card's mana cost plus exile three other cards from your graveyard. (You may cast cards from your graveyard for their escape cost.)\nAt the beginning of the end step, sacrifice this enchantment." }),
  makeCard({ name: 'Ritual', type_line: 'Instant', mana_cost: '{B}', cmc: 1, colors: ['B'], color_identity: ['B'], oracle_text: 'Add {B}{B}{B}.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Dauthi', type_line: 'Creature — Shade', mana_cost: '{0}', power: '3', toughness: '2', oracle_text: "Shadow\nIf a card would be put into an opponent's graveyard from anywhere, instead exile it with a void counter on it.\n{T}, Sacrifice this creature: Choose an exiled card an opponent owns with a void counter on it. You may play it this turn without paying its mana cost." }),
  makeCard({ name: 'Murder', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature.' }),
  makeCard({ name: 'Terror', type_line: 'Creature — Dragon', mana_cost: '{0}', power: '5', toughness: '4', oracle_text: 'Flying\nSpells your opponents cast that target this creature cost an additional 3 life to cast.' }),
  makeCard({ name: 'Etali', type_line: 'Legendary Creature — Dinosaur', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: "Whenever Etali attacks, exile the top card of each player's library, then you may cast any number of spells from among those cards without paying their mana costs." }),
  makeCard({ name: 'Opt', type_line: 'Instant', mana_cost: '{U}', cmc: 1, colors: ['U'], color_identity: ['U'], oracle_text: 'Draw a card.' }),
  makeCard({ name: 'Scepter', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Imprint — When this artifact enters, you may exile an instant card with mana value 2 or less from your hand.\n{2}, {T}: You may copy the exiled card. If you do, you may cast the copy without paying its mana cost.' }),
  makeCard({ name: 'Ruin', type_line: 'Land', mana_cost: '', oracle_text: '{2}, {T}, Sacrifice this land: Destroy target nonbasic land an opponent controls. Each player searches their library for a basic land card, puts it onto the battlefield, then shuffles.' }),
  makeCard({ name: 'Verge', type_line: 'Land', mana_cost: '', oracle_text: '{2}, {T}, Sacrifice this land: Search your library for a Forest card and an Island card, put them onto the battlefield tapped, then shuffle.' }),
  makeCard({ name: 'Odd Land', type_line: 'Land', mana_cost: '', oracle_text: '' }),
  makeCard({ name: 'Gitrog', type_line: 'Legendary Creature — Frog Horror', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: 'Whenever one or more land cards are put into your graveyard from anywhere, draw a card.' }),
  makeCard({ name: 'Mill Two', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Mill two cards.' }),
  makeCard({ name: 'Ojer', type_line: 'Legendary Creature — God', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: 'If one or more creature tokens would be created under your control, three times that many of those tokens are created instead.' }),
  makeCard({ name: 'Soldier Call', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Create a 1/1 white Soldier creature token.' }),
  makeCard({ name: 'Treasure Call', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Create a Treasure token.' }),
  makeCard({ name: 'Portal', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "At the beginning of your upkeep, put target creature card from a graveyard onto the battlefield under your control. It's a Phyrexian in addition to its other types." }),
  makeCard({ name: 'Padeem', type_line: 'Legendary Creature — Vedalken Artificer', mana_cost: '{0}', power: '1', toughness: '4', oracle_text: 'At the beginning of your upkeep, if you control the artifact with the greatest mana value or tied for the greatest mana value, draw a card.' }),
  makeCard({ name: 'Big Rock', type_line: 'Artifact', mana_cost: '{4}', cmc: 4, oracle_text: '' }),
  makeCard({ name: 'Small Rock', type_line: 'Artifact', mana_cost: '{1}', cmc: 1, oracle_text: '' }),
  makeCard({ name: 'Chatterfang', type_line: 'Legendary Creature — Squirrel Warrior', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: '{B}, Sacrifice X Squirrels: Target creature gets +X/-X until end of turn.' }),
  makeCard({ name: 'Squirrel', type_line: 'Creature — Squirrel', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const toTop = (g: GameState, p: string, id: string) => {
  const lib = g.zones.library[p]!;
  lib.splice(lib.indexOf(id), 1);
  lib.unshift(id);
};

describe('staples (slice 162)', () => {
  it("Bolas's Citadel: the top card for life equal to its mana value", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Citadel', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre', 'library');
    toTop(g, 'alice', ogre);
    const life = g.players.alice!.life;
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === ogre)).toBe(true);
    g = settle(act(g, { type: 'cast', player: 'alice', object: ogre }));
    expect(g.objects[ogre]!.zone).toBe('battlefield');
    expect(g.players.alice!.life).toBe(life - 3);
    // Not with too little life (CR 119.4).
    const ogre2 = give(g, 'alice', 'Ogre', 'library');
    toTop(g, 'alice', ogre2);
    g.players.alice!.life = 2;
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === ogre2)).toBe(false);
    expect(illegal(g, { type: 'cast', player: 'alice', object: ogre2 })).toBeTruthy();
  });

  it('Underworld Breach: escape for the mana cost plus three other cards', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Breach', 'battlefield');
    const ritual = give(g, 'alice', 'Ritual', 'graveyard');
    const fuel = [0, 1, 2].map(() => give(g, 'alice', 'Bear', 'graveyard'));
    g.players.alice!.pool.B = 1;
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === ritual && a.alt === 'escape')).toBe(true);
    g = settle(act(g, { type: 'cast', player: 'alice', object: ritual, alt: 'escape', costs: { exile: fuel } } as never));
    expect(g.players.alice!.pool.B).toBe(3);
    for (const id of fuel) expect(g.objects[id]!.zone).toBe('exile');
    // Sacrificed at the end step.
    g = toStep(g, 'end', 'alice');
    g = settle(g);
    expect(g.zones.battlefield.some((id) => g.cards[g.objects[id]!.card]!.name === 'Breach')).toBe(false);
  });

  it('Dauthi Voidwalker: void counters, then a free play of one', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const dauthi = give(g, 'alice', 'Dauthi', 'battlefield');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder', 'hand'), targets: [[{ kind: 'object', object: ogre }]] }));
    expect(g.objects[ogre]!.zone).toBe('exile');
    expect(g.objects[ogre]!.counters.void).toBe(1);
    // Alice's own Murder still goes to her graveyard.
    expect(g.zones.graveyard.alice!.length).toBe(1);
    g = settle(act(g, { type: 'activate', player: 'alice', object: dauthi, ability: 0 }));
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === ogre)).toBe(true);
    g = settle(act(g, { type: 'cast', player: 'alice', object: ogre }));
    expect(g.objects[ogre]!.zone).toBe('battlefield');
    expect(g.objects[ogre]!.controller).toBe('alice');
  });

  it('Terror of the Peaks: 3 life more for spells an opponent aims at it', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const terror = give(g, 'alice', 'Terror', 'battlefield');
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Murder', 'hand'), targets: [[{ kind: 'object', object: terror }]] }));
    expect(g.players.bob!.life).toBe(life - 3);
    expect(g.objects[terror]!.zone).toBe('graveyard');
    // Its controller pays nothing.
    g = toStep(g, 'main1', 'alice');
    const t2 = give(g, 'alice', 'Terror', 'battlefield');
    const mine = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder', 'hand'), targets: [[{ kind: 'object', object: t2 }]] }));
    expect(g.players.alice!.life).toBe(mine);
  });

  it('Etali: cast any number of the exiled spells, in the order chosen', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const etali = give(g, 'alice', 'Etali', 'battlefield');
    const mine = give(g, 'alice', 'Opt', 'library');
    toTop(g, 'alice', mine);
    const theirs = give(g, 'bob', 'Bear', 'library');
    toTop(g, 'bob', theirs);
    g = toStep(g, 'beginning_of_combat');
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: etali, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 10 && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.pending?.kind).toBe('choose_objects');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [theirs, mine] } });
    expect(g.pending).toMatchObject({ kind: 'cast_free', object: theirs });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true } });
    expect(g.pending).toMatchObject({ kind: 'cast_free', object: mine });
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true } }));
    expect(g.objects[theirs]!.zone).toBe('battlefield');
    expect(g.objects[theirs]!.controller).toBe('alice');
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('Isochron Scepter: casts a copy of the imprinted card; the card stays', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const opt = give(g, 'alice', 'Opt', 'hand');
    const scepter = give(g, 'alice', 'Scepter', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: scepter }));
    if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    if (g.pending?.kind === 'choose_objects') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [opt] } });
    g = settle(g);
    expect(g.objects[opt]!.zone).toBe('exile');
    const hand = g.zones.hand.alice!.length;
    for (let n = 1; n <= 2; n++) {
      g.objects[scepter]!.tapped = false;
      g.players.alice!.pool.C = 2;
      g = settle(act(g, { type: 'activate', player: 'alice', object: scepter, ability: 0 }));
      expect(g.pending?.kind).toBe('cast_free');
      g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true } }));
      expect(g.zones.hand.alice!.length).toBe(hand + n);
      expect(g.objects[opt]!.zone).toBe('exile');
    }
    // The copies are gone (CR 704.5e).
    expect(Object.values(g.objects).filter((o) => o.spellCopy)).toHaveLength(0);
    expect(g.zones.graveyard.alice!.filter((id) => g.objects[id]!.card === g.objects[opt]!.card)).toHaveLength(0);
  });

  it('Field of Ruin: each player searches for a basic land, in turn order', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ruin = give(g, 'alice', 'Ruin', 'battlefield');
    const odd = give(g, 'bob', 'Odd Land', 'battlefield');
    g.players.alice!.pool.C = 2;
    const lands = (p: string) => g.zones.battlefield.filter((id) => g.objects[id]!.controller === p && g.cards[g.objects[id]!.card]!.faces[0]!.types.includes('Land')).length;
    const [a0, b0] = [lands('alice'), lands('bob')];
    g = settle(act(g, { type: 'activate', player: 'alice', object: ruin, ability: 0, targets: [[{ kind: 'object', object: odd }]] }));
    for (const p of ['alice', 'bob']) {
      expect(g.pending).toMatchObject({ kind: 'search', player: p });
      const c = (g.pending as { candidates: string[] }).candidates;
      g = settle(act(g, { type: 'choose', player: p, answer: { kind: 'search', objects: c.slice(0, 1) } }));
    }
    expect(lands('alice')).toBe(a0);
    expect(lands('bob')).toBe(b0);
  });

  it('Krosan Verge: a Forest and an Island, not two of one', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const verge = give(g, 'alice', 'Verge', 'battlefield');
    give(g, 'alice', 'Island', 'library');
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'activate', player: 'alice', object: verge, ability: 0 }));
    const c = (g.pending as { candidates: string[] }).candidates;
    const named = (n: string) => c.filter((id) => g.cards[g.objects[id]!.card]!.name === n);
    expect(() => act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: named('Forest').slice(0, 2) } })).toThrow();
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [named('Forest')[0]!, named('Island')[0]!] } }));
    expect(g.objects[named('Forest')[0]!]!.zone).toBe('battlefield');
    expect(g.objects[named('Island')[0]!]!.tapped).toBe(true);
  });

  it('The Gitrog Monster: one card for lands milled together', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Gitrog', 'battlefield');
    const lib = g.zones.library.alice!;
    for (let i = 0; i < 2; i++) toTop(g, 'alice', give(g, 'alice', 'Odd Land', 'library'));
    const hand = g.zones.hand.alice!.length;
    expect(lib.length).toBeGreaterThan(2);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mill Two', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('Ojer Taq triples creature tokens only', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Ojer', 'battlefield');
    const tokens = () => g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Soldier Call', 'hand') }));
    expect(tokens()).toHaveLength(3);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Treasure Call', 'hand') }));
    expect(tokens()).toHaveLength(4);
  });

  it("Portal to Phyrexia: it's a Phyrexian too", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Portal', 'battlefield');
    const dead = give(g, 'bob', 'Ogre', 'graveyard');
    g = toStep(g, 'upkeep', 'alice');
    if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: dead }]] } });
    g = settle(g);
    expect(g.objects[dead]!.zone).toBe('battlefield');
    expect(g.objects[dead]!.controller).toBe('alice');
    const c = chars(g, g.objects[dead]!);
    expect(c.subtypes).toEqual(expect.arrayContaining(['Ogre', 'Phyrexian']));
  });

  it('Padeem: a card with the greatest-mana-value artifact', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Padeem', 'battlefield');
    give(g, 'alice', 'Small Rock', 'battlefield');
    const big = give(g, 'bob', 'Big Rock', 'battlefield');
    let hand = g.zones.hand.alice!.length;
    g = settle(toStep(g, 'draw', 'alice'));
    // Only the draw step's card.
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
    expect(g.objects[big]!.controller).toBe('bob');
    // Tied for the greatest: enough.
    give(g, 'alice', 'Big Rock', 'battlefield');
    g = toStep(g, 'main1', 'bob');
    hand = g.zones.hand.alice!.length;
    g = settle(toStep(g, 'draw', 'alice'));
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
  });

  it('Chatterfang: sacrifice X Squirrels for +X/-X', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const chat = give(g, 'alice', 'Chatterfang', 'battlefield');
    const sq = [0, 1].map(() => give(g, 'alice', 'Squirrel', 'battlefield'));
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    g.players.alice!.pool.B = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: chat, ability: 0, x: 2, targets: [[{ kind: 'object', object: ogre }]], costs: { sacrifice: sq } } as never));
    for (const id of sq) expect(g.objects[id]!.zone).toBe('graveyard');
    expect(chars(g, g.objects[ogre]!).power).toBe(5);
    expect(chars(g, g.objects[ogre]!).toughness).toBe(1);
  });
});
