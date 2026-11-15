import { describe, expect, it } from 'vitest';
import { compileCards, type ScryfallCard } from '@mtg/compiler';
import type { CardDef } from '@mtg/schema';
import { chars, legalActions, type Action, type GameState } from '../src/index.js';
import { act, actWithEvents, give, illegal, start, toStep } from './helpers.js';

/**
 * Mechanics the engine has nothing written for: each is what its definition says. Keyword actions come from CR 701
 * (recruit 701.70a, empower Jace 701.71a), keywords from CR 702 (ascend 702.131, storied 702.195a, web-slinging
 * 702.188a), and a word the rules don't have yet from the reminder text printed with it (Beam me up, assimilate).
 * What is read, and what the reminder text is never asked, is tested in the compiler (test/defined-mechanics.test.ts).
 */
const REMINDER = {
  recruit: '(Draw a card, then discard a card. If you discarded a nonland card, create a 1/1 white Human Soldier creature token.)',
  beam: (cost: string) => `(You may cast this card from your graveyard for ${cost} if you also return a creature you control to its owner's hand. Then exile this spell.)`,
  assimilate: "(Put it onto the battlefield under your control with a +1/+1 counter. It's a Borg artifact creature and loses all other creature types.)",
  toAssimilate: "(To assimilate a card, put it onto the battlefield under your control with a +1/+1 counter. It's a Borg artifact creature and loses all other creature types.)",
};
const printed = (fields: Partial<ScryfallCard> & { name: string; type_line: string }): ScryfallCard => ({ object: 'card', id: `test-${fields.name}`, oracle_id: `test-${fields.name}`, layout: 'normal', set: 'tst', rarity: 'common', oracle_text: '', mana_cost: '', ...fields });
/** Compiled together, as a pool is: a creature type newer than the rules file (Borg) is known from the cards' type lines. */
const pool = (cards: ScryfallCard[]): CardDef[] => compileCards(cards).db.cards;
const CARDS = pool([
  printed({ name: 'Lookout', type_line: 'Creature — Human Scout', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: `When this creature enters, recruit. ${REMINDER.recruit}` }),
  printed({ name: 'Trumpets', type_line: 'Instant', mana_cost: '{0}', oracle_text: `Counter target spell. If that spell's mana value was 2 or less, recruit. ${REMINDER.recruit}` }),
  printed({ name: 'Two Drop', type_line: 'Sorcery', mana_cost: '{1}{G}', cmc: 2, oracle_text: 'You gain 1 life.' }),
  printed({ name: 'X Spell', type_line: 'Sorcery', mana_cost: '{X}{G}', cmc: 1, oracle_text: 'You gain X life.' }),
  printed({ name: 'Ascent', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Empower Jace 2.' }),
  printed({ name: 'Echo', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Empower Jace 1.' }),
  printed({ name: 'Enforcer', type_line: 'Creature — Human Soldier', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever this creature attacks, empower Jace X, where X is the number of creatures you control.' }),
  printed({ name: 'Thorin', type_line: 'Legendary Creature — Dwarf Noble', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Storied (If you control three or more artifacts, legendaries, and/or Sagas, you have an enduring story for the rest of the game.)\nAs long as you have an enduring story, this creature gets +2/+2.' }),
  printed({ name: 'Relic', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '' }),
  printed({ name: 'Tale', type_line: 'Enchantment — Saga', mana_cost: '{0}', oracle_text: '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI, II, III — You gain 1 life.' }),
  printed({ name: 'Bard', type_line: 'Creature — Dwarf Bard', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'When this creature enters, if you have an enduring story, draw a card.' }),
  printed({ name: 'Climber', type_line: 'Creature — Merfolk', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "Ascend (If you control ten or more permanents, you get the city's blessing for the rest of the game.)\nThis creature gets +3/+3 as long as you have the city's blessing." }),
  printed({ name: 'Secrets', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Ascend (If you control ten or more permanents, you get the city's blessing for the rest of the game.)\nYou gain 2 life. If you have the city's blessing, you gain 5 life instead." }),
  printed({ name: 'Resupply', type_line: 'Sorcery', mana_cost: '{3}{G}', cmc: 4, oracle_text: `You gain 3 life.\nBeam me up {G} ${REMINDER.beam('{G}')}` }),
  printed({ name: 'Spider', type_line: 'Legendary Creature — Spider Hero', mana_cost: '{4}{G}{G}', cmc: 6, power: '4', toughness: '4', oracle_text: "Web-slinging {G} (You may cast this spell for {G} if you also return a tapped creature you control to its owner's hand.)\nWhen this creature enters, if it was cast using web-slinging, you gain 3 life." }),
  printed({ name: 'Queen', type_line: 'Legendary Artifact Creature — Borg Noble', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: `When this creature enters, assimilate target creature card from an opponent's graveyard. ${REMINDER.assimilate}` }),
  printed({ name: 'Cube', type_line: 'Artifact', mana_cost: '{0}', oracle_text: `{T}: Assimilate target creature card from a graveyard, then you gain 1 life. Activate only as a sorcery. ${REMINDER.toAssimilate}` }),
  printed({ name: 'Elf Knight', type_line: 'Creature — Elf Knight', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle_text: 'Trample' }),
  printed({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
  printed({ name: 'Signal', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'You gain 1 life.' }),
  printed({ name: 'Jace, Tester', type_line: 'Legendary Planeswalker — Jace', mana_cost: '{0}', loyalty: '3', oracle_text: '+1: Empower Jace 2.\n−2: Draw a card.' }),
  printed({ name: 'Wildspeaker', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Planeswalkers you control have "[−4]: Create a 4/4 green Beast creature token with trample."' }),
  printed({ name: 'Pyromancer', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Planeswalkers you control have "[+1]: Add {R}."' }),
  printed({ name: 'Drain', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Counter target spell. At the beginning of your next main phase, add an amount of {C} equal to that spell's mana value." }),
  printed({ name: 'Swindle', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Counter target spell. Create X Treasure tokens, where X is that spell's mana value." }),
]);
const face = (name: string) => CARDS.find((c) => c.name === name)!.faces[0]!;

function settle(g: GameState): GameState {
  for (let i = 0; i < 40 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const main = (who = 'alice'): GameState => toStep(start({ extra: CARDS }), 'main1', who);
const cast = (g: GameState, name: string, more: Partial<Extract<Action, { type: 'cast' }>> = {}, player = 'alice') =>
  act(g, { type: 'cast', player, object: give(g, player, name, 'hand'), ...more });
const tokens = (g: GameState, player = 'alice') => g.zones.battlefield.map((id) => g.objects[id]!).filter((o) => o.token && o.controller === player);
const hand = (g: GameState, player = 'alice') => g.zones.hand[player]!;

describe('every card here reads in full', () => {
  it('no line is left to the players', () => {
    expect(CARDS.filter((c) => c.automation !== 'full').map((c) => `${c.name}: ${c.faces[0]!.unparsed.join(' | ')}`)).toEqual([]);
  });
});

describe('recruit (CR 701.70a): "Draw a card, then discard a card. If you discarded a nonland card this way, create a 1/1 white Human Soldier creature token."', () => {
  it('a nonland card discarded: a Human Soldier', () => {
    let g = main();
    const bear = give(g, 'alice', 'Bear', 'hand');
    const before = hand(g).length;
    g = settle(cast(g, 'Lookout'));
    expect(g.pending).toMatchObject({ kind: 'discard', player: 'alice' });
    // One card drawn, then one to discard.
    expect(hand(g).length).toBe(before + 1);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: [bear] } }));
    expect(g.objects[bear]!.zone).toBe('graveyard');
    expect(tokens(g).map((t) => [chars(g, t).subtypes, chars(g, t).colors, chars(g, t).power, chars(g, t).toughness])).toEqual([[['Human', 'Soldier'], ['W'], 1, 1]]);
  });

  it('a land card discarded: nothing', () => {
    let g = main();
    const forest = give(g, 'alice', 'Forest', 'hand');
    g = settle(cast(g, 'Lookout'));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: [forest] } }));
    expect(g.objects[forest]!.zone).toBe('graveyard');
    expect(tokens(g)).toEqual([]);
  });

  it('"If that spell\'s mana value was 2 or less, recruit": the spell as it was on the stack', () => {
    for (const [spell, x, recruits] of [['Two Drop', undefined, true], ['X Spell', 0, true], ['X Spell', 3, false]] as const) {
      let g = main('bob');
      g.players.bob!.pool.G = 6;
      const it = give(g, 'bob', spell, 'hand');
      g = act(g, { type: 'cast', player: 'bob', object: it, ...(x !== undefined ? { x } : {}) });
      g = act(g, { type: 'pass', player: 'bob' });
      const before = hand(g).length;
      g = settle(cast(g, 'Trumpets', { targets: [[{ kind: 'object', object: it }]] }));
      expect(g.objects[it]!.zone).toBe('graveyard');
      expect([spell, x, g.pending?.kind ?? null, hand(g).length - before]).toEqual([spell, x, recruits ? 'discard' : null, recruits ? 1 : 0]);
    }
  });
});

describe('"that spell\'s mana value", after the spell is countered', () => {
  it('is its mana value on the stack — X counts there (CR 202.3e), and not in the graveyard', () => {
    let g = main('bob');
    g.players.bob!.pool.G = 4;
    const it = give(g, 'bob', 'X Spell', 'hand');
    g = act(g, { type: 'cast', player: 'bob', object: it, x: 3 });
    g = act(g, { type: 'pass', player: 'bob' });
    g = settle(cast(g, 'Swindle', { targets: [[{ kind: 'object', object: it }]] }));
    expect([g.objects[it]!.zone, tokens(g).length]).toEqual(['graveyard', 4]);
  });

  it('a delayed "equal to that spell\'s mana value" keeps it (Mana Drain)', () => {
    let g = main('bob');
    g.players.bob!.pool.G = 4;
    const it = give(g, 'bob', 'X Spell', 'hand');
    g = act(g, { type: 'cast', player: 'bob', object: it, x: 3 });
    g = act(g, { type: 'pass', player: 'bob' });
    g = settle(cast(g, 'Drain', { targets: [[{ kind: 'object', object: it }]] }));
    g = settle(toStep(g, 'main1', 'alice'));
    expect(g.players.alice!.pool.C).toBe(4);
  });
});

describe('empower Jace (CR 701.71a)', () => {
  it('with no Jace token: a blue Jace planeswalker token with 0 loyalty and its two abilities, then N loyalty counters', () => {
    let g = main();
    g = settle(cast(g, 'Ascent'));
    const [jace, ...rest] = tokens(g);
    expect(rest).toEqual([]);
    const c = chars(g, jace!);
    expect([c.types, c.subtypes, c.supertypes, c.colors, jace!.counters.loyalty]).toEqual([['Planeswalker'], ['Jace'], [], ['U'], 2]);

    // The one you have gets the counters: no second token.
    g = settle(cast(g, 'Echo'));
    expect(tokens(g).map((t) => t.counters.loyalty)).toEqual([3]);

    // "[−1]: Surveil 1." and "[−3]: Draw a card." — loyalty abilities, one each turn (CR 606.3).
    const abilities = legalActions(g, 'alice').filter((a) => a.type === 'activate' && a.object === jace!.id);
    expect(abilities).toHaveLength(2);
    const before = hand(g).length;
    g = settle(act(g, abilities[1]!));
    // A card drawn; with 0 loyalty the token is put into the graveyard and ceases to exist (CR 704.5i, 704.5d).
    expect([hand(g).length - before, tokens(g)]).toEqual([1, []]);
  });

  it('a loyalty ability of the token can be activated once a turn, at sorcery speed', () => {
    let g = main();
    g = settle(cast(g, 'Ascent'));
    const jace = tokens(g)[0]!;
    const minusOne = legalActions(g, 'alice').find((a) => a.type === 'activate' && a.object === jace.id)!;
    g = act(g, minusOne);
    for (let i = 0; i < 6 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'surveil') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'surveil', top: g.pending.objects, graveyard: [] } });
      else if (g.pending) throw new Error(`unexpected ${g.pending.kind}`);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.objects[jace.id]!.counters.loyalty).toBe(1);
    expect(legalActions(g, 'alice').filter((a) => a.type === 'activate' && a.object === jace.id)).toEqual([]);
  });

  it('"empower Jace X, where X is the number of creatures you control"', () => {
    let g = main();
    const enforcer = give(g, 'alice', 'Enforcer', 'battlefield');
    give(g, 'alice', 'Bear', 'battlefield');
    give(g, 'alice', 'Bear', 'battlefield');
    g = toStep(g, 'beginning_of_combat', 'alice');
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.pending?.kind).toBe('declare_attackers');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: enforcer, target: { kind: 'player', player: 'bob' } }] } }));
    expect(tokens(g).map((t) => [chars(g, t).subtypes, t.counters.loyalty])).toEqual([[['Jace'], 3]]);
  });
});

describe('loyalty abilities a planeswalker is given: \'Planeswalkers you control have "[−4]: …"\'', () => {
  it('a card named Jace still empowers Jace: the action\'s name is not the card\'s', () => {
    let g = main();
    const jace = give(g, 'alice', 'Jace, Tester', 'battlefield');
    g.objects[jace]!.counters.loyalty = 3;
    const plus = legalActions(g, 'alice').find((a) => a.type === 'activate' && a.object === jace && a.ability === 0)!;
    g = settle(act(g, plus));
    // The token gets the counters — the card is not a Jace planeswalker token.
    expect([g.objects[jace]!.counters.loyalty, tokens(g).map((t) => t.counters.loyalty)]).toEqual([4, [2]]);
  });

  it('the ability costs loyalty, is one of the planeswalker\'s once-a-turn loyalty abilities, and goes when the grant does', () => {
    let g = main();
    const jace = give(g, 'alice', 'Jace, Tester', 'battlefield');
    g.objects[jace]!.counters.loyalty = 5;
    const own = () => legalActions(g, 'alice').filter((a) => a.type === 'activate' && a.object === jace).length;
    expect(own()).toBe(2);
    const way = give(g, 'alice', 'Wildspeaker', 'battlefield');
    // Bob's planeswalkers get nothing from it.
    const bobs = give(g, 'bob', 'Jace, Tester', 'battlefield');
    g.objects[bobs]!.counters.loyalty = 5;
    expect([own(), legalActions(g, 'bob').filter((a) => a.type === 'activate').length]).toEqual([3, 0]);
    const given = legalActions(g, 'alice').find((a) => a.type === 'activate' && a.object === jace && a.ability === 2)!;
    g = settle(act(g, given));
    expect([g.objects[jace]!.counters.loyalty, tokens(g).map((t) => [chars(g, t).subtypes, chars(g, t).power, chars(g, t).keywords.map((k) => k.id)])]).toEqual([1, [[['Beast'], 4, ['trample']]]]);
    // CR 606.3: one loyalty ability of a permanent each turn — its own are spent too.
    expect(own()).toBe(0);
    // Her next turn, with 1 loyalty: only the +1 can be paid for. With 6, all three — and two once the grant is gone.
    g = toStep(toStep(g, 'main1', 'bob'), 'main1', 'alice');
    expect(own()).toBe(1);
    g.objects[jace]!.counters.loyalty = 6;
    expect(own()).toBe(3);
    g.zones.battlefield = g.zones.battlefield.filter((id) => id !== way);
    g.objects[way]!.zone = 'graveyard';
    g.zones.graveyard.alice!.push(way);
    expect(own()).toBe(2);
  });

  it('"[+1]: Add {R}." is a loyalty ability, not a mana ability (CR 605.1a): it uses the stack', () => {
    let g = main();
    const jace = give(g, 'alice', 'Jace, Tester', 'battlefield');
    g.objects[jace]!.counters.loyalty = 3;
    give(g, 'alice', 'Pyromancer', 'battlefield');
    const given = legalActions(g, 'alice').find((a) => a.type === 'activate' && a.object === jace && a.ability === 2)!;
    g = act(g, given);
    expect([g.stack.length, g.players.alice!.pool.R, g.objects[jace]!.counters.loyalty]).toEqual([1, 0, 4]);
    g = settle(g);
    expect(g.players.alice!.pool.R).toBe(1);
  });
});

describe('storied (CR 702.195a) and an enduring story', () => {
  it('"Any time you control three or more permanents that are artifacts, Sagas, and/or legendary and you don\'t have an enduring story, you have an enduring story for the rest of the game."', () => {
    let g = main();
    const thorin = give(g, 'alice', 'Thorin', 'battlefield');
    const relic = give(g, 'alice', 'Relic', 'battlefield');
    g = settle(cast(g, 'Signal'));
    // Two: Thorin (legendary) and an artifact.
    expect(g.players.alice!.designations).toBeUndefined();
    expect(chars(g, g.objects[thorin]!).power).toBe(3);
    give(g, 'alice', 'Tale', 'battlefield');
    const seen = actWithEvents(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Signal', 'hand') });
    g = settle(seen.state);
    expect(seen.events.filter((e) => e.type === 'designation')).toEqual([{ type: 'designation', player: 'alice', name: 'an enduring story' }]);
    expect(g.players.alice!.designations).toEqual({ 'an enduring story': true });
    expect(g.players.bob!.designations).toBeUndefined();
    expect(chars(g, g.objects[thorin]!).power).toBe(5);

    // For the rest of the game: the artifact gone, and Thorin too.
    g.zones.battlefield = g.zones.battlefield.filter((id) => id !== relic);
    g.objects[relic]!.zone = 'graveyard';
    g.zones.graveyard.alice!.push(relic);
    g = toStep(g, 'main2', 'alice');
    expect(chars(g, g.objects[thorin]!).power).toBe(5);
    const before = hand(g).length;
    g = settle(cast(g, 'Bard'));
    expect(hand(g).length - before).toBe(1);
  });

  it('a creature without storied gives nothing; another player\'s permanents don\'t count', () => {
    let g = main();
    give(g, 'alice', 'Thorin', 'battlefield');
    give(g, 'bob', 'Relic', 'battlefield');
    give(g, 'bob', 'Relic', 'battlefield');
    give(g, 'bob', 'Tale', 'battlefield');
    g = settle(cast(g, 'Signal'));
    expect([g.players.alice!.designations, g.players.bob!.designations]).toEqual([undefined, undefined]);
  });
});

describe('ascend (CR 702.131) and the city\'s blessing', () => {
  it('on a permanent (702.131b): a static ability, any time you control ten or more permanents', () => {
    let g = main();
    const climber = give(g, 'alice', 'Climber', 'battlefield');
    for (let i = 0; i < 8; i++) give(g, 'alice', 'Forest', 'battlefield');
    g = settle(cast(g, 'Signal'));
    expect(g.players.alice!.designations).toBeUndefined();
    give(g, 'alice', 'Forest', 'battlefield');
    g = settle(cast(g, 'Signal'));
    expect(g.players.alice!.designations).toEqual({ "the city's blessing": true });
    expect(chars(g, g.objects[climber]!).power).toBe(4);
  });

  it('on an instant or sorcery (702.131a): a spell ability, first as the spell resolves', () => {
    expect(face('Secrets').keywords[0]!.abilities?.map((a) => a.kind)).toEqual(['spell']);
    expect(face('Climber').keywords[0]!.abilities?.map((a) => a.kind)).toEqual(['static']);
    for (const lands of [8, 10]) {
      let g = main();
      for (let i = 0; i < lands; i++) give(g, 'alice', 'Forest', 'battlefield');
      const life = g.players.alice!.life;
      g = settle(cast(g, 'Secrets'));
      expect([lands, g.players.alice!.designations ?? null, g.players.alice!.life - life]).toEqual(lands >= 10 ? [lands, { "the city's blessing": true }, 5] : [lands, null, 2]);
    }
  });
});

describe('web-slinging (CR 702.188a): "You may cast this spell by paying [cost] and returning a tapped creature you control to its owner\'s hand rather than paying its mana cost."', () => {
  it('cast for its cost by returning a tapped creature; "if it was cast using web-slinging" knows', () => {
    let g = main();
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const spider = give(g, 'alice', 'Spider', 'hand');
    g.players.alice!.pool.G = 1;
    // No tapped creature: not offered.
    expect(legalActions(g, 'alice').filter((a) => a.type === 'cast' && a.object === spider && a.alt === 'web_slinging')).toEqual([]);
    g.objects[bear]!.tapped = true;
    const offer = legalActions(g, 'alice').find((a) => a.type === 'cast' && a.object === spider && a.alt === 'web_slinging');
    expect(offer).toBeDefined();
    const life = g.players.alice!.life;
    g = settle(act(g, { ...offer!, costs: { returned: [bear] } } as Action));
    expect([g.objects[spider]!.zone, g.objects[bear]!.zone, g.players.alice!.pool.G, g.players.alice!.life - life]).toEqual(['battlefield', 'hand', 0, 3]);
  });

  it('cast for its mana cost: no life', () => {
    let g = main();
    g.players.alice!.pool.G = 6;
    const life = g.players.alice!.life;
    g = settle(cast(g, 'Spider'));
    expect(g.players.alice!.life - life).toBe(0);
  });
});

describe('a keyword the rules don\'t have yet, from its reminder text: Beam me up', () => {
  it('reads as what the reminder says: an alternative cost from the graveyard, and exile afterwards', () => {
    const kw = face('Resupply').keywords.find((k) => k.id === 'beam_me_up');
    expect(kw).toMatchObject({ id: 'beam_me_up', cost: '{G}', abilities: [{ kind: 'static', effect: { type: 'cast_option', id: 'beam_me_up', kind: 'alternative', zone: 'graveyard', exileOnLeave: true, cost: { mana: '{G}', other: [{ type: 'return_permanents', amount: 1 }] } } }] });
  });

  it('from your graveyard, for its cost and a creature returned to its owner\'s hand; then it is exiled', () => {
    let g = main();
    const card = give(g, 'alice', 'Resupply', 'graveyard');
    g.players.alice!.pool.G = 1;
    // No creature to return: it can't be cast.
    expect(legalActions(g, 'alice').filter((a) => a.type === 'cast' && a.object === card)).toEqual([]);
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const offer = legalActions(g, 'alice').find((a) => a.type === 'cast' && a.object === card);
    expect(offer).toMatchObject({ alt: 'beam_me_up' });
    const life = g.players.alice!.life;
    g = settle(act(g, { ...offer!, costs: { returned: [bear] } } as Action));
    expect([g.objects[card]!.zone, g.objects[bear]!.zone, g.players.alice!.life - life, g.players.alice!.pool.G]).toEqual(['exile', 'hand', 3, 0]);
  });

  it('from your hand it is an ordinary spell: its mana cost, and the graveyard afterwards', () => {
    let g = main();
    g.players.alice!.pool.G = 4;
    const card = give(g, 'alice', 'Resupply', 'hand');
    expect(legalActions(g, 'alice').filter((a) => a.type === 'cast' && a.object === card).map((a) => (a as { alt?: string }).alt)).toEqual([undefined]);
    g = settle(act(g, { type: 'cast', player: 'alice', object: card }));
    expect(g.objects[card]!.zone).toBe('graveyard');
    expect(illegal(g, { type: 'cast', player: 'alice', object: card })).toBeTruthy();
  });
});

describe('an action the rules don\'t have yet, from its reminder text: assimilate', () => {
  it('"assimilate target creature card from an opponent\'s graveyard": under your control with a +1/+1 counter, a Borg artifact creature with no other creature types', () => {
    let g = main();
    const knight = give(g, 'bob', 'Elf Knight', 'graveyard');
    g = cast(g, 'Queen');
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    g = settle(g);
    const o = g.objects[knight]!;
    const c = chars(g, o);
    expect([o.zone, o.controller, o.owner, o.counters['+1/+1']]).toEqual(['battlefield', 'alice', 'bob', 1]);
    expect([[...c.types].sort(), c.subtypes, c.power, c.keywords.map((k) => k.id)]).toEqual([['Artifact', 'Creature'], ['Borg'], 3, ['trample']]);
    // It stays one while it stays on the battlefield.
    g = toStep(g, 'main1', 'bob');
    expect(chars(g, g.objects[knight]!).subtypes).toEqual(['Borg']);
  });

  it('a reminder that names the word ("To assimilate a card, put it …") defines it wherever it stands in the line', () => {
    let g = main();
    const cube = give(g, 'alice', 'Cube', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'graveyard');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'activate', player: 'alice', object: cube, ability: 0, targets: [[{ kind: 'object', object: bear }]] }));
    const c = chars(g, g.objects[bear]!);
    expect([g.objects[bear]!.zone, c.subtypes, [...c.types].sort(), g.objects[bear]!.counters['+1/+1'], g.players.alice!.life - life]).toEqual(['battlefield', ['Borg'], ['Artifact', 'Creature'], 1, 1]);
  });
});
