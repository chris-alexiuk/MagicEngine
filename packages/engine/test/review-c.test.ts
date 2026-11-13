/**
 * The November 2026 code review of slices 277–291: the defects it found, each as a test of the correct behaviour
 * (controls — assertions that pin the scenario down — come before the line that used to fail).
 */
import { describe, expect, it } from 'vitest';
import { compileCards, type ScryfallCard } from '@mtg/compiler';
import { chars, legalActions, type Action, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------
// Slice 282: creature types taken from the pool's type lines are known to the compiler only. The engine's own list of
// creature types (schema SUBTYPES.creature) doesn't have them, so everything that asks "which of its subtypes are
// creature types" leaves them out.
// ---------------------------------------------------------------------------------------------------------------------
const scry = (name: string, type_line: string, oracle_text: string, extra: Partial<ScryfallCard> = {}): ScryfallCard =>
  ({ object: 'card', id: `${name}-id`, oracle_id: `${name}-oracle`, name, layout: 'normal', mana_cost: '{0}', cmc: 0, type_line, oracle_text, colors: [], color_identity: [], legalities: { commander: 'legal' }, set: 'tst', rarity: 'common', games: ['paper'], ...extra }) as unknown as ScryfallCard;
// Compiled as a pool, the way the card DB is: Vulcan, Officer, Klingon and Borg aren't in the Comprehensive Rules file.
const POOL = compileCards([
  scry('Vulcan Officer', 'Creature — Vulcan Officer', '', { power: '1', toughness: '1' }),
  scry('Human Officer', 'Creature — Human Officer', '', { power: '1', toughness: '1' }),
  scry('Klingon Chief', 'Creature — Klingon Warrior', 'Other Klingons you control get +1/+1.', { power: '2', toughness: '2' }),
  scry('Klingon Grunt', 'Creature — Klingon', '', { power: '1', toughness: '1' }),
  scry('Drone', 'Artifact Creature — Borg', '', { power: '1', toughness: '1' }),
  scry('Shifter', 'Creature — Shapeshifter', 'Changeling', { power: '1', toughness: '1' }),
  // The "Federation" count of Captain Jonathan Archer, Hoshi Sato, Saavik and Starfleet Academy.
  scry('Federation Count', 'Instant', 'You gain X life, where X is the number of creature types among non-Borg creatures you control.'),
  // Mistform Wakecaster's effect (slice 277).
  scry('Wakecaster Lite', 'Instant', 'Choose a creature type. Each creature you control becomes that type until end of turn.'),
]).db.cards;

describe('review C: creature types registered from the pool (slice 282)', () => {
  const main = () => toStep(start({ extra: POOL }), 'main1', 'alice');

  it('"the number of creature types among non-Borg creatures you control" counts the pool\'s creature types (CR 205.3m)', () => {
    // Control: every card in the pool compiles fully.
    expect(POOL.map((c) => c.automation)).toEqual(POOL.map(() => 'full'));
    let g = main();
    give(g, 'alice', 'Vulcan Officer', 'battlefield');
    give(g, 'alice', 'Human Officer', 'battlefield');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Federation Count', 'hand') } as never));
    // Vulcan, Human, Officer.
    expect(g.players.alice!.life - life).toBe(3);
  });

  it('a changeling is every creature type, the pool\'s too (CR 702.73a)', () => {
    const g = main();
    give(g, 'alice', 'Klingon Chief', 'battlefield');
    const grunt = give(g, 'alice', 'Klingon Grunt', 'battlefield');
    const shifter = give(g, 'alice', 'Shifter', 'battlefield');
    expect(chars(g, g.objects[grunt]!).power).toBe(2);
    expect(chars(g, g.objects[shifter]!).power).toBe(2);
  });

  it('"becomes that type" replaces a pool creature type, and such a type can be chosen (CR 205.1a)', () => {
    let g = main();
    const grunt = give(g, 'alice', 'Klingon Grunt', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Wakecaster Lite', 'hand') } as never));
    const options = (g.pending as { options?: string[] }).options ?? [];
    expect(options).toContain('Bird');
    const bird = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: 'Bird' } } as never);
    expect(chars(bird, bird.objects[grunt]!).subtypes).toEqual(['Bird']);
    expect(options).toContain('Klingon');
  });
});

const CARDS = [
  makeCard({ name: 'Altisaur Lite', type_line: 'Creature — Dinosaur', mana_cost: '{0}', power: '3', toughness: '4', oracle_text: 'If a source would deal damage to another Dinosaur you control, prevent all but 1 of that damage.' }),
  makeCard({ name: 'Raptor', type_line: 'Creature — Dinosaur', mana_cost: '{0}', power: '2', toughness: '5', oracle_text: '' }),
  makeCard({ name: 'Shock Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'This spell deals 3 damage to any target.' }),
  makeCard({ name: 'Major Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Copy target creature spell you control, except it isn't legendary if the spell is legendary." }),
  makeCard({ name: 'Battlemage Lite', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Kicker {U} and/or {R}\nWhen this creature enters, if it was kicked with its {U} kicker, draw a card.\nWhen this creature enters, if it was kicked with its {R} kicker, this creature deals 2 damage to target player.' }),
  makeCard({ name: 'March Lite', type_line: 'Enchantment', mana_cost: '{3}{U}', cmc: 4, oracle_text: 'Each noncreature artifact is an artifact creature with power and toughness each equal to its mana value.' }),
  makeCard({ name: 'Humble Lite', type_line: 'Enchantment', mana_cost: '{2}{W}{W}', cmc: 4, oracle_text: 'All creatures lose all abilities and have base power and toughness 1/1.' }),
  makeCard({ name: 'Anthem Rock', type_line: 'Artifact', mana_cost: '{3}', cmc: 3, oracle_text: 'Creatures you control get +1/+1.' }),
  makeCard({ name: 'Anthem Bear', type_line: 'Creature — Bear', mana_cost: '{3}', cmc: 3, power: '2', toughness: '2', oracle_text: 'Flying\nCreatures you control get +1/+1.' }),
  makeCard({ name: 'Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Hydra Lite', type_line: 'Creature — Snake Hydra', mana_cost: '{X}{G}{G}', power: '0', toughness: '0', oracle_text: 'Morph {0}\nAs this creature is turned face up, put five +1/+1 counters on it.' }),
  makeCard({ name: 'Grow Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Put a +1/+1 counter on target creature.' }),
  makeCard({ name: 'Stunt Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target player chooses three cards from their hand and puts them on top of their library in any order.' }),
  makeCard({ name: 'Exhale Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'As an additional cost to cast this spell, you may behold a Dragon.\nTarget player loses 1 life. If a Dragon was beheld, that player loses 3 life instead.' }),
  makeCard({ name: 'Whelp', type_line: 'Creature — Dragon', mana_cost: '{4}', cmc: 4, power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Fork Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Copy target instant or sorcery spell. You may choose new targets for the copy.' }),
  makeCard({ name: 'Counter Watcher', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever one or more +1/+1 counters are put on a creature you control, you gain 1 life.' }),
];
const main = () => toStep(start({ extra: CARDS }), 'main1', 'alice');

describe('review C: "prevent all but 1" (slice 287)', () => {
  it('two Temple Altisaurs: 1 damage is still dealt to a third Dinosaur (CR 615.1, 616.1)', () => {
    let g = main();
    give(g, 'alice', 'Altisaur Lite', 'battlefield');
    give(g, 'alice', 'Altisaur Lite', 'battlefield');
    const raptor = give(g, 'alice', 'Raptor', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Shock Lite', 'hand'), targets: [[{ kind: 'object', object: raptor }]] } as never));
    // The first effect leaves 1; the second prevents "all but 1" of that 1 — nothing more.
    expect(g.objects[raptor]!.damage).toBe(1);
  });
});

describe('review C: two kicker costs (slice 291)', () => {
  it('a copy of a spell kicked with its {U} kicker was kicked with that kicker too (CR 707.10, 702.33f)', () => {
    let g = main();
    g.players.alice!.pool.U = 1;
    const hand = g.zones.hand.alice!.length;
    const mage = give(g, 'alice', 'Battlemage Lite', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: mage, kicked: [0] } as never);
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Major Lite', 'hand'), targets: [[{ kind: 'object', object: mage }]] } as never);
    for (let i = 0; i < 40 && (g.stack.length || g.pending); i++) {
      if (g.pending) throw new Error(`unexpected pending ${g.pending.kind}`);
      g = act(g, { type: 'pass', player: g.priority! });
    }
    const mages = g.zones.battlefield.filter((id) => chars(g, g.objects[id]!).name === 'Battlemage Lite');
    expect(mages).toHaveLength(2);
    // The copy is kicked (the engine copies that much) …
    expect(mages.every((id) => g.objects[id]!.cast?.kicked)).toBe(true);
    // … so the original and the copy each draw a card.
    expect(g.zones.hand.alice!.length - hand).toBe(2);
  });
});

describe('review C: optional behold and reveal costs (slice 290)', () => {
  it('a copy of a spell whose behold cost was paid does what the beheld spell does (CR 707.10)', () => {
    let g = main();
    const whelp = give(g, 'alice', 'Whelp', 'battlefield');
    const exhale = give(g, 'alice', 'Exhale Lite', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: exhale, targets: [[{ kind: 'player', player: 'bob' }]], extras: ['behold'], costs: { reveal: [whelp] } } as never);
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Fork Lite', 'hand'), targets: [[{ kind: 'object', object: exhale }]] } as never);
    for (let i = 0; i < 40 && (g.stack.length || g.pending); i++) {
      // Keep the copy's target.
      if (g.pending) g = act(g, { type: 'choose', player: g.pending.player, answer: g.pending.kind === 'may' ? { kind: 'may', yes: false } : { kind: 'copy_targets' } } as never);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    // The original and its copy: 3 life each.
    expect(g.players.bob!.life).toBe(14);
  });
});

describe('review C: animation by mana value and "lose all abilities" (slice 286)', () => {
  it('an artifact March of the Machines makes a creature loses its abilities to Humility (CR 613.1d, 613.1f)', () => {
    // Control: a printed creature with the same ability loses it.
    const h = main();
    const bear = give(h, 'alice', 'Anthem Bear', 'battlefield');
    const cub0 = give(h, 'alice', 'Cub', 'battlefield');
    expect(chars(h, h.objects[cub0]!).power).toBe(2);
    give(h, 'bob', 'Humble Lite', 'battlefield');
    expect([chars(h, h.objects[cub0]!).power, chars(h, h.objects[bear]!).power, chars(h, h.objects[bear]!).keywords.length]).toEqual([1, 1, 0]);

    const g = main();
    give(g, 'alice', 'March Lite', 'battlefield');
    const rock = give(g, 'alice', 'Anthem Rock', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    expect(chars(g, g.objects[cub]!).power).toBe(2);
    give(g, 'bob', 'Humble Lite', 'battlefield');
    expect(chars(g, g.objects[rock]!).types).toContain('Creature');
    // The Rock is a creature (layer 4), so it has no abilities (layer 6): nothing gives the Cub +1/+1.
    expect([chars(g, g.objects[cub]!).power, chars(g, g.objects[cub]!).toughness]).toEqual([1, 1]);
  });
});

describe('review C: "as this creature is turned face up" (slice 289)', () => {
  it('Hooded Hydra: its five counters are put on it — abilities that watch for that trigger (CR 122.6)', () => {
    let g = main();
    give(g, 'alice', 'Counter Watcher', 'battlefield');
    g.players.alice!.pool.C = 3;
    const hydra = give(g, 'alice', 'Hydra Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: hydra, alt: 'morph' } as never));
    // Control: the watcher sees counters an effect puts on a creature.
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    const before = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Grow Lite', 'hand'), targets: [[{ kind: 'object', object: cub }]] } as never));
    expect(g.players.alice!.life).toBe(before + 1);

    g = settle(act(g, { type: 'turn_face_up', player: 'alice', object: hydra } as never));
    expect(g.objects[hydra]!.counters['+1/+1']).toBe(5);
    expect(g.players.alice!.life).toBe(before + 2);
  });
});

describe('review C: Stunted Growth (slice 277)', () => {
  it('a player with exactly three cards in hand still chooses the order they go on top ("in any order")', () => {
    let g = main();
    // Bob's hand is exactly three cards.
    for (const id of g.zones.hand.bob!.splice(0)) {
      g.objects[id]!.zone = 'library';
      g.zones.library.bob!.push(id);
    }
    const cards = [1, 2, 3].map(() => give(g, 'bob', 'Cub', 'hand'));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Stunt Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] } as never));
    // With more than three cards bob is asked, in order ("the first one on top"); with three or fewer he should still
    // be asked which goes on top.
    // Today nothing is asked: the three cards are already on top of bob's library, in hand order.
    void cards;
    expect(g.pending).toMatchObject({ kind: 'choose_objects', player: 'bob', ordered: true });
  });
});

describe('review C: the commander_zone choice (CR 903.9a) and a player leaving', () => {
  const X = [
    makeCard({ name: 'Bob Cmd', type_line: 'Legendary Creature — Ogre', mana_cost: '{G}', cmc: 1, power: '2', toughness: '2', oracle_text: '' }),
    makeCard({ name: 'Growth Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Target creature gets +3/+3 until end of turn.' }),
    makeCard({ name: 'Weak Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature\nEnchanted creature gets -2/-2.' }),
  ];
  const forests = Array.from({ length: 40 }, () => 'Forest');

  it('the game goes on when the asked player concedes during another player\'s cleanup step (CR 104.3a, 800.4a)', () => {
    let g = toStep(start({ players: 3, format: 'commander', extra: X, decks: { alice: [...forests.slice(2), 'Growth Lite', 'Weak Lite'], bob: [...forests.slice(1), 'Bob Cmd'], carol: forests }, commanders: { bob: ['Bob Cmd'] } }), 'main1', 'alice');
    const cmd = g.zones.command.find((id) => g.objects[id]!.card === 'Bob Cmd')!;
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: cmd, to: 'battlefield' } });
    // Bob's 2/2 commander: +3/+3 until end of turn, then an Aura giving it -2/-2. It dies as alice's turn ends.
    for (const name of ['Growth Lite', 'Weak Lite']) g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), targets: [[{ kind: 'object', object: cmd }]] } as never));
    expect(g.objects[cmd]!.zone).toBe('battlefield');
    for (let i = 0; i < 200 && g.pending?.kind !== 'commander_zone'; i++) {
      if (g.pending?.kind === 'discard_to_hand_size') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard_to_hand_size', objects: g.zones.hand.alice!.slice(0, g.pending.count) } });
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g).toMatchObject({ step: 'cleanup', active: 'alice', priority: null, pending: { kind: 'commander_zone', player: 'bob', zone: 'graveyard' } });
    // Control: answering it lets the game go on.
    const answered = act(g, { type: 'choose', player: 'bob', answer: { kind: 'commander_zone', move: true } });
    expect(answered.priority !== null || answered.pending !== null).toBe(true);
    // Bob concedes instead (any time, CR 104.3a). Alice and carol must still be able to play.
    g = act(g, { type: 'concede', player: 'bob' });
    expect(g.over).toBe(false);
    expect(g.priority !== null || g.pending !== null).toBe(true);
  });
});

describe('review C: casting a commander for an alternative cost (CR 903.8, 601.2f)', () => {
  const evoker = makeCard({ name: 'Evoke Elemental', type_line: 'Legendary Creature — Elemental', mana_cost: '{4}{G}', cmc: 5, power: '3', toughness: '3', oracle_text: 'Evoke {G}' });
  const reducer = makeCard({ name: 'Cheap Rock', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Creature spells you cast cost {1} less to cast.' });
  const forests = Array.from({ length: 40 }, () => 'Forest');
  const evokes = (g: GameState, id: string) => legalActions(g, 'alice').filter((a): a is Extract<Action, { type: 'cast' }> => a.type === 'cast' && a.object === id && a.alt === 'evoke');

  it('legalActions() lists the evoke cast of a taxed commander whenever apply() accepts it', () => {
    const g = toStep(start({ format: 'commander', extra: [evoker, reducer], decks: { alice: [...forests.slice(2), 'Evoke Elemental', 'Cheap Rock'], bob: forests }, commanders: { alice: ['Evoke Elemental'] } }), 'main1');
    const cmd = g.zones.command.find((id) => g.objects[id]!.card === 'Evoke Elemental')!;
    // It has been cast from the command zone once before: {2} tax.
    g.commanderCasts[cmd] = 1;
    give(g, 'alice', 'Cheap Rock', 'battlefield');
    give(g, 'alice', 'Forest', 'battlefield');
    give(g, 'alice', 'Forest', 'battlefield');
    // {G} (evoke) + {2} (tax) − {1} (Cheap Rock) = {1}{G}: two Forests pay it, and apply() agrees.
    const cast = act(g, { type: 'cast', player: 'alice', object: cmd, alt: 'evoke', autoTap: true });
    expect(cast.objects[cmd]!.zone).toBe('stack');
    // Control: with a third Forest it is listed.
    const h = structuredClone({ ...g, cards: undefined }) as unknown as GameState;
    h.cards = g.cards;
    give(h, 'alice', 'Forest', 'battlefield');
    expect(evokes(h, cmd)).toHaveLength(1);
    // With two, it's legal but not offered: the listing adds the tax after the reduction, so the {1} off is lost.
    expect(evokes(g, cmd)).toHaveLength(1);
  });
});
