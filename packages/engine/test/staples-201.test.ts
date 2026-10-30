import { describe, expect, it } from 'vitest';
import { linkMelds } from '@mtg/compiler';
import { chars } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { manaValueOf } from '../src/zones.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const meldCard = (fields: Parameters<typeof makeCard>[0]) => makeCard({ layout: 'meld', ...fields });

const GISELA = meldCard({ name: 'Gisela, the Broken Blade', type_line: 'Legendary Creature — Angel Horror', mana_cost: '{2}{W}{W}', power: '4', toughness: '3', oracle_text: 'Flying, first strike, lifelink\nAt the beginning of your end step, if you both own and control Gisela and a creature named Bruna, the Fading Light, exile them, then meld them into Brisela, Voice of Nightmares.' });
const BRUNA = meldCard({ name: 'Bruna, the Fading Light', type_line: 'Legendary Creature — Angel Horror', mana_cost: '{5}{W}{W}', power: '5', toughness: '7', oracle_text: 'Flying, vigilance\n(Melds with Gisela, the Broken Blade.)' });
const BRISELA = meldCard({ name: 'Brisela, Voice of Nightmares', type_line: 'Legendary Creature — Eldrazi Angel', cmc: 11, power: '9', toughness: '10', oracle_text: "Flying, first strike, vigilance, lifelink\nYour opponents can't cast spells with mana value 3 or less." });
const MELDS = [
  GISELA,
  BRUNA,
  BRISELA,
  meldCard({ name: 'Hanweir Battlements', type_line: 'Land', oracle_text: '{T}: Add {C}.\n{3}{R}{R}, {T}: If you both own and control this land and a creature named Hanweir Garrison, exile them, then meld them into Hanweir, the Writhing Township.' }),
  meldCard({ name: 'Hanweir Garrison', type_line: 'Creature — Human Soldier', mana_cost: '{2}{R}', power: '2', toughness: '3', oracle_text: '(Melds with Hanweir Battlements.)' }),
  meldCard({ name: 'Hanweir, the Writhing Township', type_line: 'Legendary Creature — Eldrazi Ooze', cmc: 3, power: '7', toughness: '4', oracle_text: 'Trample, haste' }),
  meldCard({ name: 'Mishra, Claimed by Gix', type_line: 'Legendary Creature — Phyrexian Human Artificer', mana_cost: '{2}{B}{R}', power: '3', toughness: '5', oracle_text: 'Whenever you attack, each opponent loses X life and you gain X life, where X is the number of attacking creatures. If Mishra, Claimed by Gix and a creature named Phyrexian Dragon Engine are attacking, and you both own and control them, exile them, then meld them into Mishra, Lost to Phyrexia. It enters tapped and attacking.' }),
  meldCard({ name: 'Phyrexian Dragon Engine', type_line: 'Artifact Creature — Phyrexian Dragon', mana_cost: '{3}', power: '2', toughness: '2', oracle_text: '(Melds with Mishra, Claimed by Gix.)' }),
  meldCard({ name: 'Mishra, Lost to Phyrexia', type_line: 'Legendary Artifact Creature — Phyrexian Artificer', cmc: 7, power: '9', toughness: '9', oracle_text: 'Menace\nWhen Mishra dies, you gain 5 life.' }),
];
linkMelds(MELDS);

const CARDS = [
  ...MELDS,
  makeCard({ name: 'Murder Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature.' }),
  makeCard({ name: 'Bounce Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Return target creature to its owner's hand." }),
  makeCard({ name: 'Exile Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Exile target creature.' }),
  makeCard({ name: 'Copy Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Create a token that's a copy of target creature you control." }),
  makeCard({ name: 'Artist Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever a creature dies, you gain 1 life.' }),
  makeCard({ name: 'Watch Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever a card is put into your graveyard from anywhere, you gain 1 life.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const cast = (g: GameState, who: string, name: string, extra: Record<string, unknown> = {}) => settle(act(g, { type: 'cast', player: who, object: give(g, who, name, 'hand'), ...extra } as never));
const target = (id: string) => ({ targets: [[{ kind: 'object', object: id }]] });
const toAttack = (g: GameState) => {
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return g;
};
const attackWith = (g: GameState, attackers: string[], to = 'bob', who = 'alice'): GameState => {
  g = toAttack(toStep(g, 'beginning_of_combat', who));
  return act(g, { type: 'choose', player: who, answer: { kind: 'declare_attackers', attacks: attackers.map((attacker) => ({ attacker, target: { kind: 'player' as const, player: to } })) } });
};
const named = (g: GameState, name: string) => g.zones.battlefield.filter((id) => g.cards[g.objects[id]!.card]!.name === name);
/** Gisela and Bruna on Alice's battlefield, melded at her end step into Brisela. */
function brisela(extra: string[] = []): { g: GameState; gisela: string; bruna: string } {
  let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
  const gisela = give(g, 'alice', 'Gisela, the Broken Blade', 'battlefield');
  const bruna = give(g, 'alice', 'Bruna, the Fading Light', 'battlefield');
  for (const name of extra) give(g, 'alice', name, 'battlefield');
  g = settle(toStep(g, 'end', 'alice'));
  g = toStep(g, 'main1', 'alice');
  return { g, gisela, bruna };
}

describe('staples (slice 275)', () => {
  it('meld links the counterpart and the combined back face when the pool is compiled (CR 712.4a)', () => {
    const node = (GISELA.faces[0]!.abilities.find((a) => a.kind === 'triggered')! as { effects: Record<string, unknown>[] }).effects[0]!;
    expect([node.type, node.partner, (node.result as { face: { name: string } }).face.name, GISELA.automation]).toEqual(['meld', 'Bruna, the Fading Light', 'Brisela, Voice of Nightmares', 'full']);
    // Without the back face in the pool, the ability isn't automated.
    const alone = makeCard({ layout: 'meld', name: 'Gisela, the Broken Blade', type_line: 'Legendary Creature — Angel Horror', mana_cost: '{2}{W}{W}', power: '4', toughness: '3', oracle_text: GISELA.faces[0]!.oracle });
    linkMelds([alone, makeCard({ layout: 'meld', name: 'Bruna, the Fading Light', type_line: 'Legendary Creature — Angel Horror', oracle_text: '(Melds with Gisela, the Broken Blade.)' })]);
    expect([alone.automation, alone.faces[0]!.unparsed.length]).toEqual(['partial', 1]);
  });

  it('Gisela and Bruna meld into Brisela: one permanent made of two cards (CR 712.8g)', () => {
    const { g, gisela, bruna } = brisela();
    const [b] = named(g, 'Brisela, Voice of Nightmares');
    expect(b).toBe(gisela);
    const c = chars(g, g.objects[b!]!);
    expect([g.zones.battlefield.length, c.power, c.toughness, c.keywords.map((k) => k.id).sort(), manaValueOf(g, g.objects[b!]!)]).toEqual([1, 9, 10, ['first_strike', 'flying', 'lifelink', 'vigilance'], 11]);
    // Bruna's card is part of the permanent, on no zone list of its own.
    expect([g.objects[bruna]!.meldedInto, g.zones.exile]).toEqual([gisela, []]);
  });

  it("Gisela doesn't trigger without Bruna, or with a Bruna someone else owns (CR 603.4)", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const gisela = give(g, 'alice', 'Gisela, the Broken Blade', 'battlefield');
    const theirs = give(g, 'bob', 'Bruna, the Fading Light', 'battlefield');
    g.objects[theirs]!.controller = 'alice';
    g = toStep(g, 'end', 'alice');
    expect(g.stack.length).toBe(0);
    g = toStep(settle(g), 'main1', 'bob');
    expect([g.objects[gisela]!.zone, g.objects[theirs]!.zone]).toEqual(['battlefield', 'battlefield']);
  });

  it('a melded permanent that dies dies once, but puts two cards into the graveyard (CR 712.21)', () => {
    const { g: g0, gisela, bruna } = brisela(['Artist Lite', 'Watch Lite']);
    const life = g0.players.alice!.life;
    const g = cast(g0, 'alice', 'Murder Lite', target(gisela));
    // Artist: one creature died (+1); Watch: Murder Lite and both of Brisela's cards (+3).
    expect([g.objects[gisela]!.zone, g.objects[bruna]!.zone, g.players.alice!.life - life]).toEqual(['graveyard', 'graveyard', 4]);
    expect([g.cards[g.objects[gisela]!.card]!.name, g.cards[g.objects[bruna]!.card]!.name]).toEqual(['Gisela, the Broken Blade', 'Bruna, the Fading Light']);
  });

  it('a melded permanent returned to hand or exiled takes both cards with it', () => {
    const { g: g0, gisela, bruna } = brisela();
    const g = cast(g0, 'alice', 'Bounce Lite', target(gisela));
    expect([g.zones.hand.alice!.includes(gisela), g.zones.hand.alice!.includes(bruna), g.objects[bruna]!.meldedInto]).toEqual([true, true, undefined]);
    const { g: g1, gisela: a, bruna: b } = brisela();
    const g2 = cast(g1, 'alice', 'Exile Lite', target(a));
    expect([g2.objects[a]!.zone, g2.objects[b]!.zone, g2.zones.exile.length]).toEqual(['exile', 'exile', 2]);
  });

  it("a token copy can't be melded: both are exiled and nothing melds (CR 701.42c)", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const gisela = give(g, 'alice', 'Gisela, the Broken Blade', 'battlefield');
    const bruna = give(g, 'alice', 'Bruna, the Fading Light', 'battlefield');
    g = cast(g, 'alice', 'Copy Lite', target(bruna));
    // CR 704.5j: keep the token copy; the card goes to the graveyard.
    const token = (g.pending as { objects: string[] }).objects.find((id) => id !== bruna)!;
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'legend_rule', keep: token } });
    g = settle(toStep(g, 'end', 'alice'));
    expect([g.objects[gisela]!.zone, g.objects[token], named(g, 'Brisela, Voice of Nightmares'), g.zones.battlefield.length]).toEqual(['exile', undefined, [], 0]);
  });

  it('Hanweir Battlements: "{3}{R}{R}, {T}: If you both own and control …" melds into a hasty Hanweir', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const land = give(g, 'alice', 'Hanweir Battlements', 'battlefield');
    give(g, 'alice', 'Hanweir Garrison', 'battlefield');
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 2, G: 0, C: 3 };
    g = settle(act(g, { type: 'activate', player: 'alice', object: land, ability: 0 } as never));
    const [h] = named(g, 'Hanweir, the Writhing Township');
    expect(h).toBe(land);
    const c = chars(g, g.objects[h!]!);
    expect([c.power, c.types, c.keywords.map((k) => k.id).sort(), manaValueOf(g, g.objects[h!]!), g.zones.battlefield.length]).toEqual([7, ['Creature'], ['haste', 'trample'], 3, 1]);
  });

  it('Mishra, Claimed by Gix: both attacking, they meld into an attacking Mishra, Lost to Phyrexia', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mishra = give(g, 'alice', 'Mishra, Claimed by Gix', 'battlefield');
    const engine = give(g, 'alice', 'Phyrexian Dragon Engine', 'battlefield');
    g = settle(attackWith(g, [mishra, engine]));
    const o = g.objects[mishra]!;
    expect([g.cards[o.card]!.name, o.tapped, g.combat!.attackers[mishra]?.zcc === o.zcc, g.objects[engine]!.meldedInto, g.players.bob!.life, g.players.alice!.life]).toEqual(['Mishra, Lost to Phyrexia', true, true, mishra, 18, 22]);
    while (g.step !== 'end_of_combat' && g.priority) g = act(g, { type: 'pass', player: g.priority });
    expect(g.players.bob!.life).toBe(9);
  });

  it("Mishra, Claimed by Gix attacking alone doesn't meld", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mishra = give(g, 'alice', 'Mishra, Claimed by Gix', 'battlefield');
    const engine = give(g, 'alice', 'Phyrexian Dragon Engine', 'battlefield');
    g = settle(attackWith(g, [mishra]));
    expect([g.objects[mishra]!.zone, g.objects[engine]!.zone, g.players.bob!.life]).toEqual(['battlefield', 'battlefield', 19]);
  });

  it("the combined back face's own leaves-the-battlefield trigger looks back at it (CR 603.10a)", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mishra = give(g, 'alice', 'Mishra, Claimed by Gix', 'battlefield');
    const engine = give(g, 'alice', 'Phyrexian Dragon Engine', 'battlefield');
    g = settle(attackWith(g, [mishra, engine]));
    g = toStep(g, 'main2', 'alice');
    const life = g.players.alice!.life;
    g = cast(g, 'alice', 'Murder Lite', target(mishra));
    expect([g.players.alice!.life - life, g.objects[engine]!.zone]).toEqual([5, 'graveyard']);
  });
});

const MORE = [
  makeCard({ name: 'Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{G}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Green Ogre', type_line: 'Creature — Ogre', mana_cost: '{G}', power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Black Ogre', type_line: 'Creature — Ogre', mana_cost: '{B}', power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Blue Bear', type_line: 'Creature — Bear', mana_cost: '{U}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'White Knight', type_line: 'Creature — Human Knight', mana_cost: '{W}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Wall Lite', type_line: 'Creature — Wall', mana_cost: '{0}', power: '0', toughness: '4', oracle_text: 'Defender' }),
  makeCard({ name: 'White Ench', type_line: 'Enchantment', mana_cost: '{W}', oracle_text: '' }),
  makeCard({ name: 'Green Ench', type_line: 'Enchantment', mana_cost: '{G}', oracle_text: '' }),
  makeCard({ name: 'Rock Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '' }),
  makeCard({ name: 'Plains', type_line: 'Basic Land — Plains', mana_cost: '', oracle_text: '({T}: Add {W}.)' }),
  makeCard({ name: 'Bolt Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Bolt Lite deals 3 damage to any target.' }),
  makeCard({ name: 'Ritual Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'You gain 1 life.' }),
  makeCard({ name: 'Elemental Lite', type_line: 'Creature — Elemental', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Filter Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Destroy all enchantments or all nonwhite enchantments.' }),
  makeCard({ name: 'Disarm Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Unattach all Equipment from target creature.' }),
  makeCard({ name: 'Spear Lite', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equipped creature gets +2/+0.\nEquip {0}' }),
  makeCard({ name: 'Feast Lite', type_line: 'Sorcery', mana_cost: '{X}', oracle_text: 'Exile X target cards from a single graveyard.' }),
  makeCard({ name: 'Shovel Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "{0}, {T}: Target player exiles a card from their graveyard. If it's a creature card, you gain 2 life." }),
  makeCard({ name: 'Agent Lite', type_line: 'Creature — Human Rogue', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{0}: Target player loses 1 life and reveals their hand.' }),
  makeCard({ name: 'Focus Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Target creature gets +2/+2 until end of turn. Prevent all damage that would be dealt to that creature this turn by colorless sources.' }),
  makeCard({ name: 'Ping Rock', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{0}: This artifact deals 1 damage to any target.' }),
  makeCard({ name: 'Shock Lite', type_line: 'Instant', mana_cost: '{R}', oracle_text: 'Shock Lite deals 2 damage to any target.' }),
  makeCard({ name: 'Snare Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Prevent all damage target attacking or blocking creature would deal this turn. If that creature is black or red, destroy it.' }),
  makeCard({ name: 'Defeat Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Exile target white creature that's attacking or blocking. If it was a Gideon planeswalker, you gain 5 life." }),
  makeCard({ name: 'Doorman Lite', type_line: 'Creature — Human', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "{0}: Until end of turn, target creature can't be blocked by creatures with power 2 or less and/or Walls." }),
  makeCard({ name: 'Champion Lite', type_line: 'Creature — Human Berserker', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '{0}: This creature gets +3/+3 and becomes a Bear Berserker until end of turn. Activate only once each turn.' }),
  makeCard({ name: 'Griffin Lite', type_line: 'Creature — Griffin', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Flying\n{0}: Prevent the next 1 combat damage that would be dealt to you this turn.' }),
  makeCard({ name: 'Sage Lite', type_line: 'Creature — Human Cleric', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{T}, Sacrifice two lands: Draw three cards, then discard one of them.' }),
  makeCard({ name: 'Hero Lite', type_line: 'Creature — Human Rogue', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever this creature attacks, you may sacrifice an artifact or discard a card. If you do, this creature gets +2/+0 until end of turn.' }),
  makeCard({ name: 'Maggots Lite', type_line: 'Creature — Insect', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'When this creature enters, discard any number of creature cards. For each card discarded this way, put two +1/+1 counters on this creature.' }),
  makeCard({ name: 'Cloud Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Destroy target creature. If a white creature dies this way, Cloud Lite deals damage to that creature's controller equal to the creature's power." }),
  makeCard({ name: 'Spawn Lite', type_line: 'Creature — Homarid', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: 'At the beginning of your upkeep, sacrifice this creature unless you mill two cards.' }),
  makeCard({ name: 'Augur Lite', type_line: 'Creature — Vedalken Wizard', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{0}, {T}: Target player draws a card, then discards a card. If that player discards an artifact card this way, untap this creature.' }),
  makeCard({ name: 'Greevil Lite', type_line: 'Creature — Beast', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '{0}, {T}, Sacrifice this creature: Destroy all enchantments of the color of your choice.' }),
  makeCard({ name: 'Gravebane Lite', type_line: 'Creature — Zombie', mana_cost: '{0}', power: '3', toughness: '2', oracle_text: "If this creature would die, put it on top of its owner's library instead." }),
  makeCard({ name: 'Warp Lite', type_line: 'Sorcery', mana_cost: '{X}', oracle_text: "Look at target player's hand and choose X cards from it. That player discards those cards." }),
  makeCard({ name: 'Collapse Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target player sacrifices an artifact and a land of their choice. Collapse Lite deals 2 damage to that player.' }),
  makeCard({ name: 'Kavu Lite', type_line: 'Creature — Kavu', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: '{0}: Prevent all combat damage blue creatures and black creatures would deal this turn.' }),
  makeCard({ name: 'Guide Lite', type_line: 'Creature — Human Cleric', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{0}, Sacrifice this creature: Reveal cards from the top of your library until you reveal a white card. Put that card into your hand and exile all other cards revealed this way.' }),
  makeCard({ name: 'Shaman Lite', type_line: 'Creature — Elemental Shaman', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: '{0}, {T}: This creature deals X damage to any target and X damage to itself, where X is the number of Elemental cards in your graveyard.' }),
  makeCard({ name: 'Obelisk Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{0}: Return target permanent you both own and control to your hand.' }),
  makeCard({ name: 'Windwright Lite', type_line: 'Artifact Creature — Human Wizard', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'This creature has flying as long as an artifact card is in your graveyard.' }),
  makeCard({ name: 'Enforcers Lite', type_line: 'Creature — Human', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: 'This creature has first strike and trample as long as an instant card and a sorcery card are in your graveyard.' }),
  makeCard({ name: 'Mist Lite', type_line: 'Creature — Dragon', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: '{0}: This creature gains flying. (This effect lasts indefinitely.)\n{0}: This creature loses flying. (This effect lasts indefinitely.)' }),
  makeCard({ name: 'Faerie Lite', type_line: 'Creature — Faerie', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{0}: Target permanent becomes blue in addition to its other colors until end of turn.' }),
];
const choose = (g: GameState, answer: Record<string, unknown>) => settle(act(g, { type: 'choose', player: (g.pending as { player: string }).player, answer } as never));
const activate = (g: GameState, who: string, object: string, extra: Record<string, unknown> = {}, ability = 0) => settle(act(g, { type: 'activate', player: who, object, ability, ...extra } as never));
const main = () => toStep(start({ extra: MORE }), 'main1', 'alice');
const kw = (g: GameState, id: string) => chars(g, g.objects[id]!).keywords.map((k) => k.id).sort();
/** Passes priority until it's `who`'s. */
const until = (g: GameState, who: string) => {
  while (g.priority && g.priority !== who && !g.pending) g = act(g, { type: 'pass', player: g.priority });
  return g;
};
/** Passes until combat damage has been dealt (no blocks). */
const throughCombat = (g: GameState) => {
  for (let i = 0; i < 40 && g.step !== 'end_of_combat' && g.step !== 'main2'; i++) {
    if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks: [] } } as never);
    else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
    else break;
  }
  return g;
};

describe('staples (slice 275, more)', () => {
  it('Essence Filter: "all enchantments or all nonwhite enchantments", chosen as it resolves', () => {
    let g = main();
    const white = give(g, 'bob', 'White Ench', 'battlefield');
    const green = give(g, 'bob', 'Green Ench', 'battlefield');
    g = cast(g, 'alice', 'Filter Lite');
    expect((g.pending as { options: string[] }).options).toEqual(['all enchantments', 'all nonwhite enchantments']);
    g = choose(g, { kind: 'choose_option', choice: 'all nonwhite enchantments' });
    expect([g.objects[white]!.zone, g.objects[green]!.zone]).toEqual(['battlefield', 'graveyard']);
  });

  it('Disarm: "Unattach all Equipment from target creature."', () => {
    let g = main();
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    const spear = give(g, 'alice', 'Spear Lite', 'battlefield');
    g = activate(g, 'alice', spear, target(cub));
    expect(chars(g, g.objects[cub]!).power).toBe(3);
    g = cast(g, 'alice', 'Disarm Lite', target(cub));
    expect([g.objects[spear]!.attachedTo, chars(g, g.objects[cub]!).power, g.objects[spear]!.zone]).toEqual([undefined, 1, 'battlefield']);
  });

  it("Rats' Feast: X target cards from a single graveyard", () => {
    let g = main();
    const [a, b] = [give(g, 'bob', 'Cub', 'graveyard'), give(g, 'bob', 'Bear', 'graveyard')];
    const mine = give(g, 'alice', 'Cub', 'graveyard');
    const feast = give(g, 'alice', 'Feast Lite', 'hand');
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 };
    expect(illegal(g, { type: 'cast', player: 'alice', object: feast, x: 2, targets: [[{ kind: 'object', object: a }, { kind: 'object', object: mine }]] } as never)).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: feast, x: 2, targets: [[{ kind: 'object', object: a }, { kind: 'object', object: b }]] } as never));
    expect([g.objects[a]!.zone, g.objects[b]!.zone, g.objects[mine]!.zone]).toEqual(['exile', 'exile', 'graveyard']);
  });

  it('Graveyard Shovel: you gain 2 life only if the exiled card is a creature card', () => {
    let g = main();
    const shovel = give(g, 'alice', 'Shovel Lite', 'battlefield');
    const cub = give(g, 'bob', 'Cub', 'graveyard');
    const life = g.players.alice!.life;
    g = activate(g, 'alice', shovel, { targets: [[{ kind: 'player', player: 'bob' }]] });
    expect([g.objects[cub]!.zone, g.players.alice!.life - life]).toEqual(['exile', 2]);
    g.objects[shovel]!.tapped = false;
    const rock = give(g, 'bob', 'Rock Lite', 'graveyard');
    g = activate(g, 'alice', shovel, { targets: [[{ kind: 'player', player: 'bob' }]] });
    expect([g.objects[rock]!.zone, g.players.alice!.life - life]).toEqual(['exile', 2]);
  });

  it('Thoughtcutter Agent: "Target player loses 1 life and reveals their hand."', () => {
    let g = main();
    const agent = give(g, 'alice', 'Agent Lite', 'battlefield');
    const life = g.players.bob!.life;
    const r = act(g, { type: 'activate', player: 'alice', object: agent, ability: 0, targets: [[{ kind: 'player', player: 'bob' }]] } as never);
    g = settle(r);
    expect(g.players.bob!.life).toBe(life - 1);
  });

  it("Lithomancer's Focus: damage from colorless sources is prevented, from others it isn't", () => {
    let g = main();
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const rock = give(g, 'alice', 'Ping Rock', 'battlefield');
    g = cast(g, 'alice', 'Focus Lite', target(bear));
    g = activate(g, 'alice', rock, { targets: [[{ kind: 'object', object: bear }]] });
    expect(g.objects[bear]!.damage).toBe(0);
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 };
    g = cast(g, 'alice', 'Shock Lite', target(bear));
    expect(g.objects[bear]!.damage).toBe(2);
  });

  it("Inquisitor's Snare: an attacker's damage is prevented, and a black one is destroyed", () => {
    let g = main();
    const green = give(g, 'alice', 'Green Ogre', 'battlefield');
    const black = give(g, 'alice', 'Black Ogre', 'battlefield');
    g = until(attackWith(g, [green, black]), 'bob');
    g = cast(g, 'bob', 'Snare Lite', target(black));
    expect(g.objects[black]!.zone).toBe('graveyard');
    g = until(g, 'bob');
    g = cast(g, 'bob', 'Snare Lite', target(green));
    const life = g.players.bob!.life;
    g = throughCombat(g);
    expect([g.objects[green]!.zone, g.players.bob!.life]).toEqual(['battlefield', life]);
  });

  it("Gideon's Defeat: \"target white creature that's attacking or blocking\"", () => {
    let g = main();
    const knight = give(g, 'alice', 'White Knight', 'battlefield');
    const idle = give(g, 'alice', 'White Knight', 'battlefield');
    g = until(attackWith(g, [knight]), 'bob');
    expect(illegal(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Defeat Lite', 'hand'), targets: [[{ kind: 'object', object: idle }]] } as never)).toBeTruthy();
    g = cast(g, 'bob', 'Defeat Lite', target(knight));
    expect([g.objects[knight]!.zone, g.objects[idle]!.zone]).toEqual(['exile', 'battlefield']);
  });

  it('Doorman: "can\'t be blocked by creatures with power 2 or less and/or Walls" this turn', () => {
    let g = main();
    const door = give(g, 'alice', 'Doorman Lite', 'battlefield');
    const ogre = give(g, 'alice', 'Green Ogre', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const wall = give(g, 'bob', 'Wall Lite', 'battlefield');
    const big = give(g, 'bob', 'Black Ogre', 'battlefield');
    g = activate(g, 'alice', door, target(ogre));
    g = attackWith(g, [ogre]);
    while (g.pending?.kind !== 'declare_blockers' && g.priority) g = act(g, { type: 'pass', player: g.priority });
    for (const blocker of [bear, wall]) expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker, attacker: ogre }] } } as never)).toBeTruthy();
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: big, attacker: ogre }] } } as never);
    expect(g.combat!.attackers[ogre]!.blocked).toBe(true);
  });

  it('Ursine Champion: "becomes a Bear Berserker" replaces its creature types', () => {
    let g = main();
    const c = give(g, 'alice', 'Champion Lite', 'battlefield');
    g = activate(g, 'alice', c);
    const x = chars(g, g.objects[c]!);
    expect([x.power, x.subtypes]).toEqual([5, ['Bear', 'Berserker']]);
    expect(illegal(g, { type: 'activate', player: 'alice', object: c, ability: 0 } as never)).toBeTruthy();
  });

  it('Decorated Griffin: "Prevent the next 1 combat damage that would be dealt to you this turn."', () => {
    let g = main();
    const ogre = give(g, 'alice', 'Green Ogre', 'battlefield');
    const griffin = give(g, 'bob', 'Griffin Lite', 'battlefield');
    g = until(attackWith(g, [ogre]), 'bob');
    g = activate(g, 'bob', griffin);
    const life = g.players.bob!.life;
    // Not damage from a spell: only combat damage.
    g = until(g, 'alice');
    g = cast(g, 'alice', 'Bolt Lite', { targets: [[{ kind: 'player', player: 'bob' }]] });
    expect(g.players.bob!.life).toBe(life - 3);
    g = throughCombat(g);
    expect(g.players.bob!.life).toBe(life - 3 - 2);
  });

  it('Soldevi Sage: "Draw three cards, then discard one of them." — one of the cards drawn', () => {
    let g = main();
    const sage = give(g, 'alice', 'Sage Lite', 'battlefield');
    const lands = [give(g, 'alice', 'Plains', 'battlefield'), give(g, 'alice', 'Plains', 'battlefield')];
    const top = g.zones.library.alice!.slice(0, 3);
    const hand = g.zones.hand.alice!.length;
    g = activate(g, 'alice', sage, { costs: { sacrifice: lands } });
    expect([...(g.pending as { candidates: string[] }).candidates].sort()).toEqual([...top].sort());
    g = choose(g, { kind: 'choose_objects', objects: [top[0]] });
    expect([g.zones.hand.alice!.length - hand, g.objects[top[0]!]!.zone]).toEqual([2, 'graveyard']);
  });

  it('Contract Hero: "you may sacrifice an artifact or discard a card" — only what can be done', () => {
    let g = main();
    const hero = give(g, 'alice', 'Hero Lite', 'battlefield');
    g = settle(attackWith(g, [hero]));
    g = choose(g, { kind: 'may', yes: true });
    // No artifact: discarding is the only way.
    expect(g.pending?.kind).toBe('discard');
    g = choose(g, { kind: 'discard', objects: g.zones.hand.alice!.slice(0, 1) });
    expect(chars(g, g.objects[hero]!).power).toBe(4);
    let k = main();
    const hero2 = give(k, 'alice', 'Hero Lite', 'battlefield');
    give(k, 'alice', 'Rock Lite', 'battlefield');
    k = choose(settle(attackWith(k, [hero2])), { kind: 'may', yes: true });
    expect((k.pending as { options: string[] }).options).toEqual(['sacrifice an artifact', 'discard a card']);
  });

  it('Mind Maggots: discard any number of creature cards, two +1/+1 counters for each', () => {
    let g = main();
    const cubs = [give(g, 'alice', 'Cub', 'hand'), give(g, 'alice', 'Cub', 'hand')];
    const m = give(g, 'alice', 'Maggots Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: m } as never));
    g = choose(g, { kind: 'choose_objects', objects: cubs });
    expect([g.objects[m]!.counters['+1/+1'], g.objects[cubs[0]!]!.zone]).toEqual([4, 'graveyard']);
  });

  it('Cinder Cloud: damage to the controller only if a white creature died', () => {
    let g = main();
    const knight = give(g, 'bob', 'White Knight', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const life = g.players.bob!.life;
    g = cast(g, 'alice', 'Cloud Lite', target(bear));
    expect([g.objects[bear]!.zone, g.players.bob!.life]).toEqual(['graveyard', life]);
    g = cast(g, 'alice', 'Cloud Lite', target(knight));
    expect([g.objects[knight]!.zone, g.players.bob!.life]).toEqual(['graveyard', life - 2]);
  });

  it('Deep Spawn: "sacrifice this creature unless you mill two cards"', () => {
    let g = toStep(start({ extra: MORE }), 'main1', 'bob');
    const spawn = give(g, 'alice', 'Spawn Lite', 'battlefield');
    const lib = g.zones.library.alice!.length;
    g = settle(toStep(g, 'upkeep', 'alice'));
    expect(g.pending?.kind).toBe('pay');
    g = choose(g, { kind: 'pay', pay: true });
    expect([g.objects[spawn]!.zone, lib - g.zones.library.alice!.length]).toEqual(['battlefield', 2]);
    // CR 701.17b: with fewer than two cards to mill, it can't be paid.
    g = toStep(g, 'main1', 'bob');
    const rest = g.zones.library.alice!.splice(1);
    g.zones.exile.push(...rest);
    for (const id of rest) g.objects[id]!.zone = 'exile';
    g = settle(toStep(g, 'upkeep', 'alice'));
    expect([g.pending, g.objects[spawn]!.zone]).toEqual([null, 'graveyard']);
  });

  it('Lumengrid Augur: untapped only if the card discarded is an artifact card', () => {
    let g = main();
    const augur = give(g, 'alice', 'Augur Lite', 'battlefield');
    const rock = give(g, 'alice', 'Rock Lite', 'library');
    const lib = g.zones.library.alice!;
    lib.unshift(lib.splice(lib.indexOf(rock), 1)[0]!);
    g = activate(g, 'alice', augur, { targets: [[{ kind: 'player', player: 'alice' }]] });
    g = choose(g, { kind: 'discard', objects: [rock] });
    expect(g.objects[augur]!.tapped).toBe(false);
    g = activate(g, 'alice', augur, { targets: [[{ kind: 'player', player: 'alice' }]] });
    g = choose(g, { kind: 'discard', objects: g.zones.hand.alice!.filter((id) => g.cards[g.objects[id]!.card]!.name === 'Forest').slice(0, 1) });
    expect(g.objects[augur]!.tapped).toBe(true);
  });

  it('Root Greevil: "Destroy all enchantments of the color of your choice."', () => {
    let g = main();
    const greevil = give(g, 'alice', 'Greevil Lite', 'battlefield');
    const white = give(g, 'bob', 'White Ench', 'battlefield');
    const green = give(g, 'bob', 'Green Ench', 'battlefield');
    g = activate(g, 'alice', greevil, { costs: { sacrifice: [greevil] } });
    if (g.pending?.kind !== 'choose_option') g = settle(g);
    g = choose(g, { kind: 'choose_option', choice: 'G' });
    expect([g.objects[white]!.zone, g.objects[green]!.zone]).toEqual(['battlefield', 'graveyard']);
  });

  it('Gravebane Zombie: "If this creature would die, put it on top of its owner\'s library instead."', () => {
    let g = main();
    const z = give(g, 'alice', 'Gravebane Lite', 'battlefield');
    g = cast(g, 'alice', 'Bolt Lite', target(z));
    expect([g.objects[z]!.zone, g.zones.library.alice![0]]).toEqual(['library', z]);
  });

  it('Mind Warp: "choose X cards from it. That player discards those cards."', () => {
    let g = main();
    const warp = give(g, 'alice', 'Warp Lite', 'hand');
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 };
    const hand = [...g.zones.hand.bob!];
    g = settle(act(g, { type: 'cast', player: 'alice', object: warp, x: 2, targets: [[{ kind: 'player', player: 'bob' }]] } as never));
    expect((g.pending as { max: number }).max).toBe(2);
    g = choose(g, { kind: 'choose_objects', objects: hand.slice(0, 2) });
    expect([g.zones.hand.bob!.length, g.objects[hand[0]!]!.zone]).toEqual([hand.length - 2, 'graveyard']);
  });

  it('Structural Collapse: "sacrifices an artifact and a land of their choice"', () => {
    let g = main();
    const rock = give(g, 'bob', 'Rock Lite', 'battlefield');
    const land = give(g, 'bob', 'Plains', 'battlefield');
    const life = g.players.bob!.life;
    g = cast(g, 'alice', 'Collapse Lite', { targets: [[{ kind: 'player', player: 'bob' }]] });
    expect([g.objects[rock]!.zone, g.objects[land]!.zone, g.players.bob!.life]).toEqual(['graveyard', 'graveyard', life - 2]);
  });

  it('Radiant Kavu: blue and black creatures\' combat damage is prevented', () => {
    let g = main();
    const kavu = give(g, 'alice', 'Kavu Lite', 'battlefield');
    const blue = give(g, 'alice', 'Blue Bear', 'battlefield');
    const green = give(g, 'alice', 'Green Ogre', 'battlefield');
    g = activate(g, 'alice', kavu);
    const life = g.players.bob!.life;
    g = throughCombat(attackWith(g, [blue, green]));
    expect(g.players.bob!.life).toBe(life - 3);
  });

  it('Sacred Guide: the white card into your hand, the rest revealed exiled', () => {
    let g = main();
    const guide = give(g, 'alice', 'Guide Lite', 'battlefield');
    const lib = g.zones.library.alice!;
    const white = give(g, 'alice', 'White Ench', 'library');
    const cub = give(g, 'alice', 'Cub', 'library');
    lib.splice(lib.indexOf(white), 1);
    lib.splice(lib.indexOf(cub), 1);
    lib.unshift(cub, white);
    g = activate(g, 'alice', guide, { costs: { sacrifice: [guide] } });
    expect([g.objects[white]!.zone, g.objects[cub]!.zone]).toEqual(['hand', 'exile']);
  });

  it('Sunflare Shaman: X damage to any target and X damage to itself', () => {
    let g = main();
    const shaman = give(g, 'alice', 'Shaman Lite', 'battlefield');
    give(g, 'alice', 'Elemental Lite', 'graveyard');
    give(g, 'alice', 'Elemental Lite', 'graveyard');
    const life = g.players.bob!.life;
    g = activate(g, 'alice', shaman, { targets: [[{ kind: 'player', player: 'bob' }]] });
    expect([g.players.bob!.life, g.objects[shaman]!.damage]).toEqual([life - 2, 2]);
  });

  it('Obelisk of Undoing: "target permanent you both own and control"', () => {
    let g = main();
    const obelisk = give(g, 'alice', 'Obelisk Lite', 'battlefield');
    const borrowed = give(g, 'bob', 'Cub', 'battlefield');
    g.objects[borrowed]!.controller = 'alice';
    const own = give(g, 'alice', 'Cub', 'battlefield');
    expect(illegal(g, { type: 'activate', player: 'alice', object: obelisk, ability: 0, targets: [[{ kind: 'object', object: borrowed }]] } as never)).toBeTruthy();
    g = activate(g, 'alice', obelisk, target(own));
    expect(g.objects[own]!.zone).toBe('hand');
  });

  it('Windwright Mage and Bloodfire Enforcers: keywords while the graveyard holds those cards', () => {
    let g = main();
    const mage = give(g, 'alice', 'Windwright Lite', 'battlefield');
    const enf = give(g, 'alice', 'Enforcers Lite', 'battlefield');
    expect([kw(g, mage), kw(g, enf)]).toEqual([[], []]);
    give(g, 'alice', 'Rock Lite', 'graveyard');
    give(g, 'alice', 'Bolt Lite', 'graveyard');
    expect([kw(g, mage), kw(g, enf)]).toEqual([['flying'], []]);
    give(g, 'alice', 'Ritual Lite', 'graveyard');
    expect(kw(g, enf)).toEqual(['first_strike', 'trample']);
  });

  it('Mist Dragon: gains and loses flying for good, the latest one winning', () => {
    let g = main();
    const d = give(g, 'alice', 'Mist Lite', 'battlefield');
    g = activate(g, 'alice', d, {}, 0);
    expect(kw(g, d)).toEqual(['flying']);
    g = activate(g, 'alice', d, {}, 1);
    expect(kw(g, d)).toEqual([]);
    g = activate(g, 'alice', d, {}, 0);
    g = toStep(g, 'main1', 'bob');
    expect(kw(g, d)).toEqual(['flying']);
  });

  it('Indigo Faerie: "becomes blue in addition to its other colors until end of turn"', () => {
    let g = main();
    const f = give(g, 'alice', 'Faerie Lite', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = activate(g, 'alice', f, target(bear));
    expect([...chars(g, g.objects[bear]!).colors].sort()).toEqual(['G', 'U']);
    g = toStep(g, 'main1', 'bob');
    expect(chars(g, g.objects[bear]!).colors).toEqual(['G']);
  });
});
