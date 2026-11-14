import { describe, expect, it } from 'vitest';
import { costPromptOpen, costPrompts, defaultChoiceAtX, legalActions, whyNotActivated, withCostAnswers, type Action, type GameState } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

// CR 601.2h (and 602.2b for abilities): the player chooses what pays each part of a cost — which creature is
// sacrificed, which cards are discarded or exiled, which creatures crew. The legal-action list fills in a default; a
// client asks. `costPrompts` is what it asks: read from the same description of a cost's parts (payment.ts costAsks)
// that apply() checks and pays by, so what a prompt offers is what the engine accepts.

type Listed = Extract<Action, { type: 'cast' | 'activate' | 'activate_mana' }>;
const listed = (g: GameState, object: string, also: (a: Listed) => boolean = () => true): Listed => {
  const found = legalActions(g, 'alice').find((a): a is Listed => (a.type === 'cast' || a.type === 'activate' || a.type === 'activate_mana') && a.object === object && also(a));
  if (!found) throw new Error('not listed');
  return found;
};
const zoneOf = (g: GameState, id: string) => g.objects[id]!.zone;

const altar = makeCard({ name: 'Test Altar', type_line: 'Artifact', mana_cost: '{1}', oracle_text: 'Sacrifice a creature: Draw a card.' });
const tower = makeCard({ name: 'Test Tower', type_line: 'Land', oracle_text: '{T}, Sacrifice a creature: Add {B}{B}.' });
const looter = makeCard({ name: 'Test Looter', type_line: 'Artifact', mana_cost: '{1}', oracle_text: '{1}, Discard two cards: Draw three cards.' });
const bear = makeCard({ name: 'Test Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', power: '2', toughness: '2', oracle_text: '' });
const ox = makeCard({ name: 'Test Ox', type_line: 'Creature — Ox', mana_cost: '{3}{G}', power: '4', toughness: '4', oracle_text: '' });
const cart = makeCard({ name: 'Test Cart', type_line: 'Artifact — Vehicle', mana_cost: '{2}', power: '5', toughness: '5', oracle_text: 'Crew 3' });

describe('what a cost asks the player to choose', () => {
  it('"Sacrifice a creature": the player says which — the listed action only has a default', () => {
    let g = toStep(start({ extra: [altar, bear, ox] }), 'main1', 'alice');
    const src = give(g, 'alice', 'Test Altar', 'battlefield');
    const first = give(g, 'alice', 'Test Bear', 'battlefield');
    const second = give(g, 'alice', 'Test Ox', 'battlefield');
    const a = listed(g, src);
    expect(a.costs?.sacrifice).toEqual([first]);
    const prompts = costPrompts(g, a);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ list: 'sacrifice', at: 0, min: 1, max: 1, candidates: [first, second], chosen: [first], verb: 'sacrifice', text: 'Choose a creature to sacrifice.' });
    expect(costPromptOpen(prompts[0]!)).toBe(true);
    g = act(g, withCostAnswers(a, prompts, [[second]]));
    expect([zoneOf(g, first), zoneOf(g, second)]).toEqual(['battlefield', 'graveyard']);
  });

  it('with one creature there is nothing to decide', () => {
    const g = toStep(start({ extra: [altar, bear] }), 'main1', 'alice');
    const src = give(g, 'alice', 'Test Altar', 'battlefield');
    give(g, 'alice', 'Test Bear', 'battlefield');
    expect(costPrompts(g, listed(g, src)).map(costPromptOpen)).toEqual([false]);
  });

  it('a mana ability with a cost to choose for asks the same way (CR 605.3a)', () => {
    let g = toStep(start({ extra: [tower, bear, ox] }), 'main1', 'alice');
    const src = give(g, 'alice', 'Test Tower', 'battlefield');
    give(g, 'alice', 'Test Bear', 'battlefield');
    const second = give(g, 'alice', 'Test Ox', 'battlefield');
    const a = listed(g, src);
    expect(a.type).toBe('activate_mana');
    const prompts = costPrompts(g, a);
    expect(prompts.map((p) => [p.list, p.min, p.candidates.length])).toEqual([['sacrifice', 1, 2]]);
    g = act(g, withCostAnswers(a, prompts, [[second]]));
    expect(zoneOf(g, second)).toBe('graveyard');
    expect(g.players.alice!.pool.B).toBe(2);
  });

  it('"Discard two cards": two of the cards in hand, as chosen', () => {
    let g = toStep(start({ extra: [looter] }), 'main1', 'alice');
    const src = give(g, 'alice', 'Test Looter', 'battlefield');
    g.players.alice!.pool.C = 1;
    const hand = [...g.zones.hand.alice!];
    const a = listed(g, src);
    const prompts = costPrompts(g, a);
    expect(prompts[0]).toMatchObject({ list: 'discard', min: 2, max: 2, text: 'Choose two cards to discard.' });
    expect(prompts[0]!.candidates).toEqual(hand);
    const picked = [hand[3]!, hand[5]!];
    g = act(g, withCostAnswers(a, prompts, [picked]));
    expect(picked.map((id) => zoneOf(g, id))).toEqual(['graveyard', 'graveyard']);
    expect(zoneOf(g, hand[0]!)).toBe('hand');
  });

  it('CR 702.122a: a crew cost takes any creatures whose power adds up — the prompt says what each counts for', () => {
    let g = toStep(start({ extra: [cart, bear, ox] }), 'main1', 'alice');
    const src = give(g, 'alice', 'Test Cart', 'battlefield');
    const small = give(g, 'alice', 'Test Bear', 'battlefield');
    const small2 = give(g, 'alice', 'Test Bear', 'battlefield');
    const big = give(g, 'alice', 'Test Ox', 'battlefield');
    const a = listed(g, src);
    // By default the strongest creature that is enough.
    expect(a.costs?.crew).toEqual([big]);
    const [p] = costPrompts(g, a);
    expect(p).toMatchObject({ list: 'crew', min: 0, verb: 'tap', text: 'Choose creatures to tap: total power 3 or greater.' });
    expect(p!.total).toEqual({ need: 3, of: 'power', each: { [small]: 2, [small2]: 2, [big]: 4 } });
    // One Bear isn't enough; two are.
    expect(illegal(g, withCostAnswers(a, [p!], [[small]]))).toBe('Crewing needs total power 3 or greater.');
    g = act(g, withCostAnswers(a, [p!], [[small, small2]]));
    expect([small, small2, big].map((id) => g.objects[id]!.tapped)).toEqual([true, true, false]);
  });
});

// Lunar Hatchling: "Escape—{4}{G}{U}, Exile a land you control, Exile five other cards from your graveyard." Two parts
// that both exile: each takes its own share of the chosen cards (the land first), where the engine used to hold one
// list up against each part and refuse both. (Found by the card sandbox: "offered, then refused".)
describe('two parts of a cost that take the same kind of thing', () => {
  const hatchling = makeCard({
    name: 'Test Hatchling',
    type_line: 'Creature — Beast',
    mana_cost: '{4}{G}{U}',
    power: '6',
    toughness: '6',
    oracle_text: 'Flying, trample\nEscape—{4}{G}{U}, Exile a land you control, Exile five other cards from your graveyard. (You may cast this card from your graveyard for its escape cost.)',
  });

  it('the card is read in full', () => {
    expect(hatchling.automation).toBe('full');
  });

  it('escapes: the land and the five cards are exiled, and it enters', () => {
    let g = toStep(start({ extra: [hatchling] }), 'main1', 'alice');
    const id = give(g, 'alice', 'Test Hatchling', 'graveyard');
    const land = give(g, 'alice', 'Forest', 'battlefield');
    const land2 = give(g, 'alice', 'Forest', 'battlefield');
    const yard = Array.from({ length: 6 }, () => give(g, 'alice', 'Forest', 'graveyard'));
    Object.assign(g.players.alice!.pool, { G: 1, U: 1, C: 4 });
    const a = listed(g, id, (x) => x.type === 'cast' && x.alt === 'escape');
    expect(a.costs?.exile).toEqual([land, ...yard.slice(0, 5)]);
    const prompts = costPrompts(g, a);
    expect(prompts.map((p) => [p.list, p.at, p.min, p.max, p.text])).toEqual([
      ['exile', 0, 1, 1, 'Choose a land to exile.'],
      ['exile', 1, 5, 5, 'Choose five cards in your graveyard to exile.'],
    ]);
    // The other land, and the last five cards.
    g = passRound(act(g, withCostAnswers(a, prompts, [[land2], yard.slice(1)])));
    expect(zoneOf(g, id)).toBe('battlefield');
    expect([land, land2].map((x) => zoneOf(g, x))).toEqual(['battlefield', 'exile']);
    expect(yard.map((x) => zoneOf(g, x))).toEqual(['graveyard', 'exile', 'exile', 'exile', 'exile', 'exile']);
  });

  it('a land that isn’t one, or four cards, is refused with what the part asks for', () => {
    const g = toStep(start({ extra: [hatchling] }), 'main1', 'alice');
    const id = give(g, 'alice', 'Test Hatchling', 'graveyard');
    give(g, 'alice', 'Forest', 'battlefield');
    const yard = Array.from({ length: 6 }, () => give(g, 'alice', 'Forest', 'graveyard'));
    Object.assign(g.players.alice!.pool, { G: 1, U: 1, C: 4 });
    const a = listed(g, id, (x) => x.type === 'cast' && x.alt === 'escape');
    expect(illegal(g, { ...a, costs: { exile: yard } })).toBe('Choose 1 permanent(s) you control to exile.');
    expect(illegal(g, { ...a, costs: { exile: [a.costs!.exile![0]!, ...yard.slice(0, 4)] } })).toBe('Choose 5 other card(s) in your graveyard to exile.');
  });
});

// CR 107.3a, 601.2b: "As an additional cost to cast this spell, discard X cards" — X is announced as the spell is cast,
// and that many cards are discarded. The list has the spell once, with the least X and the most that can be paid for;
// at another X the engine's default choices include the cards to discard. (The sandbox found twelve such cards whose
// X could only ever be 0: the choices for another X carried no cards.)
describe('a cost that takes X objects', () => {
  const firestorm = makeCard({ name: 'Test Firestorm', type_line: 'Instant', mana_cost: '{R}', oracle_text: 'As an additional cost to cast this spell, discard X cards.\nTest Firestorm deals X damage to each of X targets.' });
  const general = makeCard({ name: 'Test General', type_line: 'Creature — Squirrel', mana_cost: '{2}{B}', power: '3', toughness: '3', oracle_text: '{B}, Sacrifice X Squirrels: Target creature gets +X/-X until end of turn.' });
  const squirrel = makeCard({ name: 'Test Squirrel', type_line: 'Creature — Squirrel', mana_cost: '{G}', power: '1', toughness: '1', oracle_text: '' });

  it('the cards are read in full', () => {
    expect([firestorm.automation, general.automation]).toEqual(['full', 'full']);
  });

  it('a spell: X from 0 to the cards there are to discard, each X with its cards', () => {
    let g = toStep(start({ extra: [firestorm] }), 'main1', 'alice');
    const id = give(g, 'alice', 'Test Firestorm', 'hand');
    g.players.alice!.pool.R = 1;
    const others = g.zones.hand.alice!.filter((x) => x !== id);
    const a = listed(g, id);
    expect(a).toMatchObject({ x: 0, xMax: others.length });
    const two = defaultChoiceAtX(g, a as Extract<Action, { type: 'cast' }>, 2)!;
    expect(two.costs?.discard).toEqual(others.slice(0, 2));
    expect(two.targets?.[0]).toHaveLength(2);
    // The player picks other cards than the default.
    const cast = { ...a, x: 2, ...two } as Listed;
    const prompts = costPrompts(g, cast);
    expect(prompts[0]).toMatchObject({ list: 'discard', min: 2, max: 2, chosen: others.slice(0, 2) });
    const picked = [others[4]!, others[6]!];
    g = act(g, withCostAnswers(cast, prompts, [picked]));
    expect(picked.map((x) => zoneOf(g, x))).toEqual(['graveyard', 'graveyard']);
    expect(g.zones.hand.alice).toHaveLength(others.length - 2);
    g = passRound(g);
    // 2 damage to each of its two targets (the first two candidates: the players).
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([18, 18]);
  });

  it('without the cards for it, an X is refused', () => {
    const g = toStep(start({ extra: [firestorm] }), 'main1', 'alice');
    const id = give(g, 'alice', 'Test Firestorm', 'hand');
    g.players.alice!.pool.R = 1;
    const a = listed(g, id);
    expect(illegal(g, { ...a, x: 2, targets: [[{ kind: 'player', player: 'alice' }, { kind: 'player', player: 'bob' }]] } as Action)).toBe('Choose 2 card(s) to discard to pay the cost.');
    expect(defaultChoiceAtX(g, a as Extract<Action, { type: 'cast' }>, 40)).toBeNull();
  });

  it('an ability: "Sacrifice X Squirrels" is listed with the range there are Squirrels for', () => {
    let g = toStep(start({ extra: [general, squirrel, bear] }), 'main1', 'alice');
    const src = give(g, 'alice', 'Test General', 'battlefield');
    const s1 = give(g, 'alice', 'Test Squirrel', 'battlefield');
    const s2 = give(g, 'alice', 'Test Squirrel', 'battlefield');
    const target = give(g, 'bob', 'Test Bear', 'battlefield');
    g.players.alice!.pool.B = 1;
    const a = listed(g, src);
    // Itself and the two tokens.
    expect(a).toMatchObject({ type: 'activate', x: 0, xMax: 3 });
    // By default not the creature the ability targets (the General, the first candidate): it wouldn't be there.
    const two = defaultChoiceAtX(g, a as Extract<Action, { type: 'activate' }>, 2)!;
    expect(two.targets).toEqual([[{ kind: 'object', object: src }]]);
    expect(two.costs!.sacrifice).toEqual([s1, s2]);
    const activation = { ...a, x: 2, ...two, targets: [[{ kind: 'object', object: target }]] } as Listed;
    const prompts = costPrompts(g, activation);
    expect(prompts[0]).toMatchObject({ list: 'sacrifice', min: 2, max: 2, candidates: [src, s1, s2] });
    g = passRound(act(g, withCostAnswers(activation, prompts, [[s1, s2]])));
    expect([zoneOf(g, src), zoneOf(g, s1), zoneOf(g, s2)]).toEqual(['battlefield', 'graveyard', 'graveyard']);
    // +2/-2 on a 2/2: it dies.
    expect(zoneOf(g, target)).toBe('graveyard');
  });
});

// CR 702.51a: convoke — "Your creatures can help cast this spell. Each creature you tap while casting this spell pays
// for {1} or for one mana of that creature's color." Which creatures is the caster's choice.
describe('convoke, as a choice', () => {
  const chant = makeCard({ name: 'Test Chant', type_line: 'Sorcery', mana_cost: '{2}{G}', oracle_text: 'Convoke\nYou gain 3 life.' });

  it('the list taps creatures only for what mana can’t pay; the prompt lets the player tap more', () => {
    let g = toStep(start({ extra: [chant, bear] }), 'main1', 'alice');
    const id = give(g, 'alice', 'Test Chant', 'hand');
    const lands = [give(g, 'alice', 'Forest', 'battlefield'), give(g, 'alice', 'Forest', 'battlefield'), give(g, 'alice', 'Forest', 'battlefield')];
    const bears = [give(g, 'alice', 'Test Bear', 'battlefield'), give(g, 'alice', 'Test Bear', 'battlefield')];
    const a = listed(g, id);
    expect(a.costs?.convoke).toBeUndefined();
    const prompts = costPrompts(g, a);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ list: 'convoke', min: 0, max: 2, candidates: bears, chosen: [], optional: true });
    g = passRound(act(g, withCostAnswers(a, prompts, [bears])));
    expect(g.players.alice!.life).toBe(23);
    expect(bears.map((b) => g.objects[b]!.tapped)).toEqual([true, true]);
    // Two Bears paid for {G} and {1}: one land was tapped for the rest.
    expect(lands.filter((l) => g.objects[l]!.tapped)).toHaveLength(1);
  });
});

// CR 601.2f: a spell cast without paying its mana cost still has its additional costs ("As an additional cost to cast
// this spell, sacrifice a creature") — cascade into one used to be refused for want of a creature chosen.
describe('a free cast pays its additional costs', () => {
  const beast = makeCard({ name: 'Test Cascader', type_line: 'Creature — Beast', mana_cost: '{3}{R}', cmc: 4, power: '4', toughness: '4', oracle_text: 'Cascade' });
  const offering = makeCard({ name: 'Test Offering', type_line: 'Sorcery', mana_cost: '{1}{B}', cmc: 2, oracle_text: 'As an additional cost to cast this spell, sacrifice a creature.\nYou draw two cards.' });

  function cascading(): { g: GameState; spell: string; first: string; second: string } {
    let g = toStep(start({ extra: [beast, offering, bear, ox] }), 'main1', 'alice');
    const spell = give(g, 'alice', 'Test Offering', 'library');
    const lib = g.zones.library.alice!;
    lib.splice(lib.indexOf(spell), 1);
    lib.unshift(spell);
    const first = give(g, 'alice', 'Test Bear', 'battlefield');
    const second = give(g, 'alice', 'Test Ox', 'battlefield');
    g.players.alice!.pool.R = 4;
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Test Cascader', 'hand') }));
    expect(g.pending).toMatchObject({ kind: 'cast_free', object: spell });
    return { g, spell, first, second };
  }

  it('with nothing said about the cost, the engine’s default pays it', () => {
    const { g: before, spell, first, second } = cascading();
    const hand = before.zones.hand.alice!.length;
    const g = passRound(act(before, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true } }));
    expect(zoneOf(g, spell)).toBe('graveyard');
    expect([zoneOf(g, first), zoneOf(g, second)]).toEqual(['graveyard', 'battlefield']);
    expect(g.zones.hand.alice).toHaveLength(hand + 2);
  });

  it('the caster is asked, and what they choose is what is sacrificed', () => {
    const { g: before, spell, first, second } = cascading();
    const prompts = costPrompts(before, { type: 'cast', player: 'alice', object: spell });
    // (The Cascader itself is still a spell: cascade triggers as it is cast.)
    expect(prompts.map((p) => [p.list, p.min, p.candidates.length])).toEqual([['sacrifice', 1, 2]]);
    const g = passRound(act(before, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true, costs: { sacrifice: [second] } } }));
    expect([zoneOf(g, first), zoneOf(g, second)]).toEqual(['battlefield', 'graveyard']);
  });
});

// "Why can't I use this?" — the engine's own reading, in the order that makes a useful answer: whether the ability may
// be activated at all, then whether its costs can be paid, and only then whether there is something to target.
describe('why an ability is not offered', () => {
  const cannon = makeCard({ name: 'Test Cannon', type_line: 'Artifact', mana_cost: '{4}', oracle_text: 'Pay 50 life: Test Cannon deals 50 damage to any target.' });
  const knife = makeCard({ name: 'Test Knife', type_line: 'Artifact', mana_cost: '{1}', oracle_text: '{T}, Sacrifice a creature: Destroy target artifact an opponent controls.' });

  it('a cost that can’t be paid is the reason, though the ability also targets', () => {
    const g = toStep(start({ extra: [cannon] }), 'main1', 'alice');
    const src = give(g, 'alice', 'Test Cannon', 'battlefield');
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === src)).toBe(false);
    expect(whyNotActivated(g, 'alice', src, 0)).toBe('You don’t have 50 life to pay.');
    g.players.alice!.life = 60;
    expect(whyNotActivated(g, 'alice', src, 0)).toBeNull();
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === src)).toBe(true);
  });

  it('nothing to sacrifice; then nothing to target; then it is offered', () => {
    const g = toStep(start({ extra: [knife, bear, altar] }), 'main1', 'alice');
    const src = give(g, 'alice', 'Test Knife', 'battlefield');
    expect(whyNotActivated(g, 'alice', src, 0)).toBe('Choose 1 permanent(s) to sacrifice to pay the cost.');
    give(g, 'alice', 'Test Bear', 'battlefield');
    expect(whyNotActivated(g, 'alice', src, 0)).toBe('Choose targets: target artifact an opponent controls.');
    give(g, 'bob', 'Test Altar', 'battlefield');
    expect(whyNotActivated(g, 'alice', src, 0)).toBeNull();
    g.objects[src]!.tapped = true;
    expect(whyNotActivated(g, 'alice', src, 0)).toBe('Test Knife is already tapped.');
  });

  it('not the player’s move', () => {
    const g = toStep(start({ extra: [knife] }), 'main1', 'alice');
    const src = give(g, 'alice', 'Test Knife', 'battlefield');
    expect(whyNotActivated(g, 'bob', src, 0)).toBe('You don’t have priority.');
  });
});
