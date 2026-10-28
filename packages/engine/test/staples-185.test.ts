import { describe, expect, it } from 'vitest';
import { chars, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Monument to Endurance', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "Whenever you discard a card, choose one that hasn't been chosen this turn —\n• Draw a card.\n• Create a Treasure token.\n• Each opponent loses 3 life." }),
  makeCard({ name: 'Looting', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw two cards, then discard two cards.' }),
  makeCard({ name: 'Daily Kit', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "{0}: Choose one that hasn't been chosen this turn —\n• Draw a card.\n• You gain 2 life." }),
  makeCard({ name: 'Puzzle Box', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "{0}: Choose one that hasn't been chosen —\n• Draw a card.\n• You gain 2 life." }),
  makeCard({ name: 'Well of Lost Dreams', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Whenever you gain life, you may pay {X}, where X is less than or equal to the amount of life you gained. If you do, draw X cards.' }),
  makeCard({ name: 'Salve', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'You gain 3 life.' }),
  makeCard({ name: 'Primordial Ooze', type_line: 'Creature — Ooze', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "This creature attacks each combat if able.\nAt the beginning of your upkeep, put a +1/+1 counter on this creature. Then you may pay {X}, where X is the number of +1/+1 counters on it. If you don't, tap this creature and it deals X damage to you." }),
  makeCard({ name: 'Jugan Lite', type_line: 'Creature — Dragon', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever another creature you control enters, you may pay {X}. When you do, put X +1/+1 counters on that creature.' }),
  makeCard({ name: 'Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Tempt with Glory', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Tempting offer — Put a +1/+1 counter on each creature you control. Each opponent may put a +1/+1 counter on each creature they control. For each opponent who does, put a +1/+1 counter on each creature you control.' }),
  makeCard({ name: 'Tempt with Immortality', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Tempting offer — Return a creature card from your graveyard to the battlefield. Each opponent may return a creature card from their graveyard to the battlefield. For each opponent who does, return a creature card from your graveyard to the battlefield.' }),
  makeCard({ name: "Smuggler's Share", type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'At the beginning of each end step, draw a card for each opponent who drew two or more cards this turn, then create a Treasure token for each opponent who had two or more lands enter the battlefield under their control this turn.' }),
  makeCard({ name: 'Teysa Lite', type_line: 'Creature — Human Advisor', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'At the beginning of your end step, investigate for each opponent who lost life this turn.' }),
  makeCard({ name: 'Gift of Words', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Each opponent draws two cards.' }),
  makeCard({ name: 'Bolt', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Bolt deals 3 damage to any target.' }),
  makeCard({ name: 'Cut a Deal', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each opponent draws a card, then you draw a card for each opponent who drew a card this way.' }),
  makeCard({ name: 'Forest Call', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Search your library for any number of Forest cards, put them onto the battlefield tapped, then shuffle.' }),
  makeCard({ name: 'Chromatic Orrery', type_line: 'Legendary Artifact', mana_cost: '{0}', oracle_text: 'You may spend mana as though it were mana of any color.' }),
  makeCard({ name: 'Oath Lite', type_line: 'Legendary Enchantment', mana_cost: '{0}', oracle_text: 'You may spend mana as though it were mana of any color to cast planeswalker spells.' }),
  makeCard({ name: 'Hurl Through Hell', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Exile target creature. Until the end of your next turn, you may cast that card and you may spend mana as though it were mana of any color to cast that spell.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Walker', type_line: 'Legendary Planeswalker — Test', mana_cost: '{1}{G}', cmc: 2, loyalty: '3', oracle_text: '+1: You gain 1 life.' }),
  makeCard({ name: 'Arena of Glory', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {R}.\n{R}, {T}, Exert this land: Add {R}{R}. If any of that mana is spent on a creature spell, it gains haste until end of turn.' }),
  makeCard({ name: 'Goblin Pair', type_line: 'Creature — Goblin', mana_cost: '{R}{R}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Hostage Taker', type_line: 'Creature — Human Pirate', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: 'When this creature enters, exile another target creature or artifact until this creature leaves the battlefield. You may cast that card for as long as it remains exiled, and you may spend mana as though it were mana of any type to cast that spell.' }),
  makeCard({ name: 'Toxrill Lite', type_line: 'Creature — Slug Horror', mana_cost: '{0}', power: '7', toughness: '7', oracle_text: "Creatures you don't control get -1/-1 for each slime counter on them." }),
  makeCard({ name: 'Frenzied Baloth', type_line: 'Creature — Beast', mana_cost: '{0}', power: '3', toughness: '2', oracle_text: "Trample, haste\nCreature spells you control can't be countered.\nCombat damage can't be prevented." }),
  makeCard({ name: 'Chasm Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Prevent all damage that would be dealt to you.' }),
  makeCard({ name: 'Diregraf Colossus', type_line: 'Creature — Zombie Giant', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'This creature enters with a +1/+1 counter on it for each Zombie card in your graveyard.' }),
  makeCard({ name: 'Zombie', type_line: 'Creature — Zombie', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Thirst for Knowledge', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Draw three cards. Then discard two cards unless you discard an artifact card.' }),
  makeCard({ name: 'Trinket', type_line: 'Artifact', mana_cost: '{1}', cmc: 1, oracle_text: '' }),
  makeCard({ name: 'Kreat Lite', type_line: 'Creature — Goblin', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "Whenever one or more Goblins you control attack, create a 1/1 red Goblin creature token that's tapped and attacking." }),
  makeCard({ name: 'Hedge Shredder', type_line: 'Artifact Creature — Vehicle', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: 'Whenever one or more land cards are put into your graveyard from your library, put them onto the battlefield tapped.' }),
  makeCard({ name: 'Mill Three', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Mill three cards.' }),
  makeCard({ name: 'Reality Chip Lite', type_line: 'Legendary Artifact — Equipment', mana_cost: '{0}', oracle_text: 'As long as this Equipment is attached to a creature, you may play lands and cast spells from the top of your library.\nEquip {0}' }),
  makeCard({ name: 'Electro Lite', type_line: 'Legendary Creature — Human Villain', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: "You don't lose unspent red mana as steps and phases end." }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const kitActions = (g: GameState, id: string) => legalActions(g, 'alice').filter((a) => a.type === 'activate' && a.object === id);

describe('staples (slice 185): choose one that hasn\'t been chosen', () => {
  it('Monument to Endurance: each mode once per turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Monument to Endurance', 'battlefield');
    const hand = [give(g, 'alice', 'Island', 'hand'), give(g, 'alice', 'Island', 'hand')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Looting', 'hand') }));
    expect(g.pending?.kind).toBe('discard');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: hand } });
    expect(g.pending?.kind).toBe('trigger_targets');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', modes: [2], targets: [] } });
    const p = g.pending;
    expect(p?.kind === 'trigger_targets' && p.modes?.used).toEqual([2]);
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', modes: [2], targets: [] } })).toMatch(/already been chosen/);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', modes: [0], targets: [] } });
    const life = g.players.bob!.life;
    const cards = g.zones.hand.alice!.length;
    g = settle(g);
    expect(g.players.bob!.life).toBe(life - 3);
    expect(g.zones.hand.alice!.length).toBe(cards + 1);
    // A new turn: every mode again (with no discards to hand size on the way).
    for (const id of g.zones.hand.alice!.splice(0)) {
      g.objects[id]!.zone = 'library';
      g.zones.library.alice!.push(id);
    }
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    const more = [give(g, 'alice', 'Island', 'hand'), give(g, 'alice', 'Island', 'hand')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Looting', 'hand') }));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: more } });
    const q = g.pending;
    expect(q?.kind === 'trigger_targets' && q.modes?.used).toBeUndefined();
  });

  it('with every mode chosen this turn, the ability is removed as it triggers (CR 700.2b)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const monument = give(g, 'alice', 'Monument to Endurance', 'battlefield');
    g.modesChosen = { [`${monument}:${g.objects[monument]!.zcc}:${g.cards[g.objects[monument]!.card]!.faces[0]!.abilities[0]!.text}`]: { turn: g.turn, modes: [0, 1, 2] } };
    const hand = [give(g, 'alice', 'Island', 'hand'), give(g, 'alice', 'Island', 'hand')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Looting', 'hand') }));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: hand } });
    expect(g.pending).toBeNull();
    expect(g.stack.length).toBe(0);
  });

  it('an activated ability: the modes not chosen this turn; none once all are', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const kit = give(g, 'alice', 'Daily Kit', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: kit, ability: 0, modes: [1] }));
    expect(illegal(g, { type: 'activate', player: 'alice', object: kit, ability: 0, modes: [1] })).toMatch(/already been chosen/);
    expect(kitActions(g, kit).map((a) => (a as { modes?: number[] }).modes)).toEqual([[0]]);
    g = settle(act(g, { type: 'activate', player: 'alice', object: kit, ability: 0, modes: [0] }));
    expect(kitActions(g, kit)).toEqual([]);
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    expect(kitActions(g, kit).length).toBe(1);
  });

  it('"that hasn\'t been chosen": not again on a later turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const box = give(g, 'alice', 'Puzzle Box', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: box, ability: 0, modes: [0] }));
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    expect(kitActions(g, box).map((a) => (a as { modes?: number[] }).modes)).toEqual([[1]]);
  });
});

describe('staples (slice 185): you may pay {X}', () => {
  it('Well of Lost Dreams: X up to the life gained, then draw X', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Well of Lost Dreams', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salve', 'hand') }));
    expect(g.pending).toMatchObject({ kind: 'pay', cost: '{X}', x: { max: 3 } });
    g.players.alice!.pool.C = 4;
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true, x: 4 } })).toMatch(/greater than 3/);
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true, x: 2 } }));
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
    expect(g.players.alice!.pool.C).toBe(2);
  });

  it('Primordial Ooze: X is its +1/+1 counters; if you don\'t pay, it taps and deals X damage to you', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const ooze = give(g, 'alice', 'Primordial Ooze', 'battlefield');
    g.objects[ooze]!.counters['+1/+1'] = 2;
    g = toStep(g, 'upkeep', 'alice');
    g = settle(g);
    expect(g.pending).toMatchObject({ kind: 'pay', cost: '{3}' });
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: false } }));
    expect(g.objects[ooze]!.tapped).toBe(true);
    expect(g.players.alice!.life).toBe(life - 3);
  });

  it('"When you do": the reflexive ability uses the X paid', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Jugan Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: cub }));
    expect(g.pending).toMatchObject({ kind: 'pay', x: {} });
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true, x: 2 } }));
    expect(g.objects[cub]!.counters['+1/+1']).toBe(2);
  });
});

describe('staples (slice 185): tempting offer', () => {
  it('each opponent who accepts does it too; then you do it again for each of them', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const [mine, bobs, carols] = [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'bob', 'Cub', 'battlefield'), give(g, 'carol', 'Cub', 'battlefield')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Tempt with Glory', 'hand') }));
    expect(g.pending).toMatchObject({ kind: 'may', player: 'bob' });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'may', yes: true } });
    expect(g.pending).toMatchObject({ kind: 'may', player: 'carol' });
    g = settle(act(g, { type: 'choose', player: 'carol', answer: { kind: 'may', yes: false } }));
    expect(g.objects[mine]!.counters['+1/+1']).toBe(2);
    expect(g.objects[bobs]!.counters['+1/+1']).toBe(1);
    expect(g.objects[carols]!.counters['+1/+1'] ?? 0).toBe(0);
  });

  it('an opponent who can\'t do it isn\'t offered it', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const [a1, a2, b1] = [give(g, 'alice', 'Cub', 'graveyard'), give(g, 'alice', 'Cub', 'graveyard'), give(g, 'bob', 'Cub', 'graveyard')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Tempt with Immortality', 'hand') }));
    if (g.pending?.kind === 'choose_objects') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [a1] } });
    expect(g.pending).toMatchObject({ kind: 'may', player: 'bob' });
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'may', yes: true } }));
    expect(g.pending).toBeNull();
    expect([a1, a2, b1].map((id) => g.objects[id]!.zone)).toEqual(['battlefield', 'battlefield', 'battlefield']);
    expect(g.objects[b1]!.controller).toBe('bob');
  });
});

describe('staples (slice 185): each opponent who …', () => {
  it('Teysa: for each opponent who lost life this turn', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    give(g, 'alice', 'Teysa Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    g = toStep(g, 'end', 'alice');
    g = settle(g);
    const clues = g.zones.battlefield.filter((id) => g.objects[id]!.controller === 'alice' && g.cards[g.objects[id]!.card]!.name === 'Clue');
    expect(clues.length).toBe(1);
  });

  it('Cut a Deal: for each opponent who drew a card this way (not one with no library)', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    for (const id of g.zones.library.bob!.splice(0)) {
      g.objects[id]!.zone = 'exile';
      g.zones.exile.push(id);
    }
    const [mine, carols] = [g.zones.hand.alice!.length, g.zones.hand.carol!.length];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Cut a Deal', 'hand') }));
    expect(g.zones.hand.carol!.length).toBe(carols + 1);
    expect(g.zones.hand.alice!.length).toBe(mine + 1);
  });

  it("Smuggler's Share: for each opponent who drew two or more cards this turn", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', "Smuggler's Share", 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Gift of Words', 'hand') }));
    const hand = g.zones.hand.alice!.length;
    g = toStep(g, 'end', 'alice');
    g = settle(g);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });
});

describe('staples (slice 185): search for any number of cards', () => {
  it('as many as you like, none at all too', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const forests = [give(g, 'alice', 'Forest', 'library'), give(g, 'alice', 'Forest', 'library'), give(g, 'alice', 'Forest', 'library')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Forest Call', 'hand') }));
    expect(g.pending?.kind).toBe('search');
    const p = g.pending as { candidates: string[]; count: number; mustFind: boolean };
    expect(p.candidates).toEqual(expect.arrayContaining(forests));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: forests } }));
    expect(forests.every((id) => g.objects[id]!.zone === 'battlefield' && g.objects[id]!.tapped)).toBe(true);
  });
});

describe('staples (slice 185): spending mana as though it were mana of any color (CR 609.4b)', () => {
  it('Chromatic Orrery: any mana pays colored costs ({C} still needs colorless)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'hand');
    g.players.alice!.pool.U = 2;
    expect(illegal(g, { type: 'cast', player: 'alice', object: bear })).toMatch(/mana/i);
    give(g, 'alice', 'Chromatic Orrery', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.players.alice!.pool.U).toBe(0);
  });

  it('only for the spells it names', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Oath Lite', 'battlefield');
    const [bear, walker] = [give(g, 'alice', 'Bear', 'hand'), give(g, 'alice', 'Walker', 'hand')];
    g.players.alice!.pool.U = 2;
    expect(illegal(g, { type: 'cast', player: 'alice', object: bear })).toMatch(/mana/i);
    g = settle(act(g, { type: 'cast', player: 'alice', object: walker }));
    expect(g.objects[walker]!.zone).toBe('battlefield');
  });

  it('Hurl Through Hell: cast the exiled card until the end of your next turn, with mana of any color', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Hurl Through Hell', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[bear]!.zone).toBe('exile');
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    g.players.alice!.pool.R = 2;
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === bear)).toBe(true);
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.objects[bear]!.controller).toBe('alice');
  });
});

describe('staples (slice 186): Arena of Glory', () => {
  it('exerted as a cost (it stays tapped), and the creature cast with its mana has haste this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const arena = give(g, 'alice', 'Arena of Glory', 'battlefield');
    g.players.alice!.pool.R = 1;
    g = act(g, { type: 'activate_mana', player: 'alice', object: arena, ability: 1 });
    expect(g.objects[arena]!.exerted).toBe(true);
    const goblin = give(g, 'alice', 'Goblin Pair', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: goblin }));
    expect(chars(g, g.objects[goblin]!).keywords.some((k) => k.id === 'haste')).toBe(true);
    g = toStep(g, 'main1', 'bob');
    expect(chars(g, g.objects[goblin]!).keywords.some((k) => k.id === 'haste')).toBe(false);
    g = toStep(g, 'main1', 'alice');
    expect(g.objects[arena]!.tapped).toBe(true);
  });
});

describe('staples (slice 187): Hostage Taker', () => {
  it('cast the exiled card for as long as it remains exiled, with mana of any type', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const taker = give(g, 'alice', 'Hostage Taker', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: taker }));
    if (g.pending?.kind === 'trigger_targets') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: bear }]] } }));
    expect(g.objects[bear]!.zone).toBe('exile');
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.objects[bear]!.controller).toBe('alice');
  });
});

const toAttack = (g: GameState) => {
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return g;
};

describe('staples (slice 187)', () => {
  it('Toxrill: each creature you don\'t control gets -1/-1 for each slime counter on it', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Toxrill Lite', 'battlefield');
    const [a, b] = [give(g, 'bob', 'Zombie', 'battlefield'), give(g, 'bob', 'Zombie', 'battlefield')];
    g.objects[a]!.counters.slime = 1;
    expect([chars(g, g.objects[a]!).power, chars(g, g.objects[b]!).power]).toEqual([1, 2]);
  });

  it('Frenzied Baloth: combat damage can\'t be prevented', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const baloth = give(g, 'alice', 'Frenzied Baloth', 'battlefield');
    give(g, 'bob', 'Chasm Lite', 'battlefield');
    const life = g.players.bob!.life;
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: baloth, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 30 && g.step !== 'end'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } } as never);
      else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
      else break;
    }
    expect(g.players.bob!.life).toBe(life - 3);
  });

  it('Diregraf Colossus: a counter for each Zombie card in your graveyard', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Zombie', 'graveyard');
    give(g, 'alice', 'Zombie', 'graveyard');
    const colossus = give(g, 'alice', 'Diregraf Colossus', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: colossus }));
    expect(g.objects[colossus]!.counters['+1/+1']).toBe(2);
  });

  it('Thirst for Knowledge: discard an artifact card, or two cards', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const trinket = give(g, 'alice', 'Trinket', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Thirst for Knowledge', 'hand') }));
    const hand = g.zones.hand.alice!.length;
    expect(g.pending?.kind).toBe('pay');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true } }));
    // Another artifact card drawn: which one is the player's choice.
    if (g.pending?.kind === 'choose_objects') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [trinket] } }));
    expect(g.objects[trinket]!.zone).toBe('graveyard');
    expect(g.zones.hand.alice!.length).toBe(hand - 1);
  });

  it('"Whenever one or more Goblins you control attack": only when one of them attacks', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const kreat = give(g, 'alice', 'Kreat Lite', 'battlefield');
    const zombie = give(g, 'alice', 'Zombie', 'battlefield');
    g.objects[kreat]!.sick = false;
    g.objects[zombie]!.sick = false;
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: zombie, target: { kind: 'player', player: 'bob' } }] } });
    g = settle(g);
    const goblins = () => g.zones.battlefield.filter((id) => g.objects[id]!.controller === 'alice' && g.cards[g.objects[id]!.card]!.name === 'Goblin Token');
    expect(goblins().length).toBe(0);
  });
});

describe('staples (slice 187): from the library', () => {
  it('Hedge Shredder: the land cards milled at once go onto the battlefield tapped', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Hedge Shredder', 'battlefield');
    const lib = g.zones.library.alice!;
    const forests = [give(g, 'alice', 'Forest', 'library'), give(g, 'alice', 'Forest', 'library')];
    for (const f of forests) lib.splice(lib.indexOf(f), 1);
    lib.unshift(...forests, give(g, 'alice', 'Bear', 'library'));
    lib.splice(lib.lastIndexOf(lib[2]!), 1);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mill Three', 'hand') }));
    g = settle(g);
    expect(forests.map((id) => [g.objects[id]!.zone, g.objects[id]!.tapped])).toEqual([['battlefield', true], ['battlefield', true]]);
  });

  it('The Reality Chip: playing from the top only while attached to a creature', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const chip = give(g, 'alice', 'Reality Chip Lite', 'battlefield');
    const bear = give(g, 'alice', 'Zombie', 'battlefield');
    const top = g.zones.library.alice![0]!;
    const playsTop = () => legalActions(g, 'alice').some((a) => (a.type === 'cast' || a.type === 'play_land') && (a as { object: string }).object === top);
    g.players.alice!.pool.C = 9;
    g.players.alice!.pool.G = 9;
    expect(playsTop()).toBe(false);
    g = settle(act(g, { type: 'activate', player: 'alice', object: chip, ability: 0, targets: [[{ kind: 'object', object: bear }]] }));
    g.players.alice!.pool.C = 9;
    g.players.alice!.pool.G = 9;
    g.players.alice!.pool.W = 9;
    g.players.alice!.pool.U = 9;
    g.players.alice!.pool.B = 9;
    g.players.alice!.pool.R = 9;
    expect(g.objects[chip]!.attachedTo?.id).toBe(bear);
    expect(playsTop()).toBe(true);
  });
});

describe('staples (slice 188): keeping unspent mana (CR 500.5)', () => {
  it("Electro: unspent red mana isn't lost as steps and phases end; other mana is", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Electro Lite', 'battlefield');
    g.players.alice!.pool.R = 2;
    g.players.alice!.pool.G = 1;
    g = toStep(g, 'end', 'alice');
    expect([g.players.alice!.pool.R, g.players.alice!.pool.G]).toEqual([2, 0]);
  });
});
