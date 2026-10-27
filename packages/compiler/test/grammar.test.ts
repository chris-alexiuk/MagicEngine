import { describe, expect, it } from 'vitest';
import { ParserRegistry } from '../src/parser.js';

const parser = new ParserRegistry();
const parse = (text: string, typeLine = 'Instant', name = 'Test Card') => parser.parse(text, { cardName: name, faceName: name, typeLine });
const one = (text: string, typeLine?: string, name?: string) => {
  const r = parse(text, typeLine, name);
  expect(r.unparsed).toEqual([]);
  return r.abilities[0]!;
};

describe('effects', () => {
  it('damage to "any target"', () => {
    expect(one('Lightning Bolt deals 3 damage to any target.', 'Instant', 'Lightning Bolt')).toEqual({
      kind: 'spell',
      text: 'Lightning Bolt deals 3 damage to any target.',
      targets: [{ what: 'any', filter: { types: ['Creature', 'Planeswalker', 'Battle'] }, text: 'any target' }],
      effects: [{ type: 'deal_damage', amount: 3, to: { ref: 'target', index: 0 } }],
    });
  });

  it('later sentences modify earlier ones ("It can\'t be regenerated.")', () => {
    expect(one("Destroy target nonblack creature. It can't be regenerated.")).toMatchObject({
      targets: [{ what: 'object', filter: { types: ['Creature'], notColors: ['B'] } }],
      effects: [{ type: 'destroy', what: { ref: 'target', index: 0 }, noRegen: true }],
    });
  });

  it('a second clause reuses the subject without declaring a new target', () => {
    const a = one('Target player draws two cards and loses 2 life.');
    expect(a).toMatchObject({
      targets: [{ what: 'player', text: 'target player' }],
      effects: [
        { type: 'draw', amount: 2, who: { ref: 'target', index: 0 } },
        { type: 'lose_life', amount: 2, who: { ref: 'target', index: 0 } },
      ],
    });
  });

  it('pronouns point at the last target ("its controller", "it")', () => {
    expect(one("Exile target creature. Its controller gains 2 life.")).toMatchObject({
      effects: [
        { type: 'move', to: 'exile', what: { ref: 'target', index: 0 } },
        { type: 'gain_life', who: { ref: 'controller_of', of: { ref: 'target', index: 0 } } },
      ],
    });
    expect(one('Untap target creature. It gets +2/+2 until end of turn.')).toMatchObject({
      effects: [{ type: 'untap' }, { type: 'modify', what: { ref: 'target', index: 0 }, power: 2, toughness: 2, until: 'eot' }],
    });
  });

  it('noun phrases: disjunctions, "non-", controllers, zones and comparisons', () => {
    const filter = (text: string) => (one(text) as { targets: { filter: unknown }[] }).targets[0]!.filter;
    expect(filter('Destroy target artifact or enchantment.')).toEqual({ types: ['Artifact', 'Enchantment'] });
    expect(filter('Destroy target noncreature, nonland permanent.')).toEqual({ notTypes: ['Creature', 'Land'] });
    expect(filter("Return target creature you don't control to its owner's hand.")).toEqual({ types: ['Creature'], controller: 'not_you' });
    expect(filter('Destroy target creature with power 4 or greater.')).toEqual({ types: ['Creature'], power: { op: 'ge', n: 4 } });
    expect(filter('Counter target instant or sorcery spell.')).toEqual({ zone: 'stack', types: ['Instant', 'Sorcery'] });
    expect(filter('Return target creature card from your graveyard to your hand.')).toEqual({ zone: 'graveyard', owner: 'you', types: ['Creature'] });
    expect(filter('Destroy target attacking or blocking creature.')).toEqual({ types: ['Creature'], combat: 'attacking_or_blocking' });
    expect(filter('Destroy target creature without flying.')).toEqual({ types: ['Creature'], notKeywords: ['flying'] });
  });

  it('tokens, plain and predefined (CR 111.4, CR 111.10)', () => {
    const a = one('Create two 1/1 white Soldier creature tokens with vigilance.') as unknown as { effects: { token: object; amount: number }[] };
    expect(a.effects[0]).toMatchObject({
      type: 'create_token',
      amount: 2,
      token: { name: 'Soldier Token', typeLine: 'Token Creature — Soldier', power: '1', toughness: '1', colors: ['W'], keywords: [{ id: 'vigilance' }] },
    });
    const t = one('Create a Treasure token.') as unknown as { effects: { token: { abilities: unknown[] } }[] };
    expect(t.effects[0]!.token.abilities[0]).toMatchObject({ kind: 'activated', mana: true, cost: { tap: true, other: [{ type: 'sacrifice_self' }] } });
  });

  it('"you may" wraps the optional part', () => {
    expect(one('You may draw a card.')).toMatchObject({ effects: [{ type: 'may', effects: [{ type: 'draw', amount: 1 }] }] });
  });

  it('modal spells keep each mode’s targets apart (CR 700.2c)', () => {
    const a = one('Choose one —\n• Destroy target artifact.\n• Destroy target enchantment.');
    expect(a).toMatchObject({
      effects: [],
      modes: {
        min: 1,
        max: 1,
        options: [
          { text: 'Destroy target artifact.', targets: [{ filter: { types: ['Artifact'] } }], effects: [{ what: { ref: 'target', index: 0 } }] },
          { text: 'Destroy target enchantment.', targets: [{ filter: { types: ['Enchantment'] } }], effects: [{ what: { ref: 'target', index: 0 } }] },
        ],
      },
    });
  });

  it('is all-or-nothing', () => {
    expect(parse('Draw a card for each creature card with a name sticker on it.').unparsed).toHaveLength(1);
    // A modal spell keeps the modes it can read; the others are left to players (CR 700.2).
    const modal = parse('Choose one —\n• Destroy target artifact.\n• Venture into the dungeon.');
    expect(modal.unparsed).toEqual([]);
    expect(modal.abilities[0]).toMatchObject({ modes: { options: [{ effects: [{ type: 'destroy' }] }, { manual: true, effects: [] }] } });
    expect(parse('Choose one —\n• Venture into the dungeon.\n• Learn.').unparsed).toHaveLength(3);
    // Bare instructions only make sense on instants and sorceries.
    expect(parse('Draw a card.', 'Creature — Elf').unparsed).toEqual(['Draw a card.']);
  });
});

describe('triggered abilities', () => {
  it('self triggers; "it" after dying is the card in the graveyard (CR 603.10a)', () => {
    expect(one('When this creature enters, draw a card.', 'Creature — Elf')).toMatchObject({
      kind: 'triggered',
      trigger: { type: 'enters', subject: { ref: 'self' } },
    });
    expect(one("When this creature dies, return it to its owner's hand.", 'Creature — Spirit')).toMatchObject({
      trigger: { type: 'dies', subject: { ref: 'self' } },
      effects: [{ type: 'move', to: 'hand', what: { ref: 'trigger_object' } }],
    });
  });

  it('other objects, steps and casting', () => {
    expect(one('Whenever another creature you control dies, you gain 1 life.', 'Creature — Vampire')).toMatchObject({
      trigger: { type: 'dies', subject: { ref: 'all', filter: { types: ['Creature'], controller: 'you', other: true } } },
    });
    expect(one('Landfall — Whenever a land you control enters, you gain 1 life.', 'Creature — Elf')).toMatchObject({
      trigger: { type: 'enters', subject: { ref: 'all', filter: { types: ['Land'], controller: 'you' } } },
    });
    expect(one('At the beginning of your upkeep, you lose 1 life.', 'Enchantment')).toMatchObject({
      trigger: { type: 'phase', step: 'upkeep', whose: 'you' },
    });
    expect(one('At the beginning of each end step, draw a card.', 'Enchantment')).toMatchObject({
      trigger: { type: 'phase', step: 'end', whose: 'each' },
    });
    expect(one('Whenever you cast a noncreature spell, scry 1.', 'Creature — Wizard')).toMatchObject({
      trigger: { type: 'cast', who: 'you', filter: { notTypes: ['Creature'] } },
    });
    expect(one('Whenever this creature deals combat damage to a player, that player discards a card.', 'Creature — Rogue')).toMatchObject({
      trigger: { type: 'deals_combat_damage', to: 'player' },
      effects: [{ type: 'discard', who: { ref: 'trigger_player' } }],
    });
  });

  it('modal triggers', () => {
    expect(one('When this creature enters, choose one —\n• You gain 3 life.\n• Draw a card.', 'Creature — Elf')).toMatchObject({
      trigger: { type: 'enters' },
      modes: { min: 1, max: 1, options: [{ effects: [{ type: 'gain_life' }] }, { effects: [{ type: 'draw' }] }] },
    });
  });

  it('CR 603.4: intervening "if" clauses become a condition on the trigger', () => {
    expect(one('When this creature enters, if you control a Forest, draw a card.', 'Creature — Elf')).toMatchObject({
      trigger: { type: 'enters' },
      condition: { type: 'count', who: 'you', filter: { subtypes: ['Forest'] }, min: 1 },
    });
    // Conditions the grammar doesn't know leave the line unparsed.
    expect(parse('When this creature enters, if you descended this turn, draw a card.', 'Creature — Elf').unparsed).toHaveLength(1);
  });

  it('keywords whose definitions use conditions: persist (CR 702.79a)', () => {
    const kw = parse('Persist', 'Creature — Elf').keywords[0]!;
    expect(kw.abilities![0]).toMatchObject({
      trigger: { type: 'dies', subject: { ref: 'self' } },
      condition: { type: 'counters', of: { ref: 'trigger_object' }, counter: '-1/-1', max: 0 },
      effects: [{ type: 'move', what: { ref: 'trigger_object' }, to: 'battlefield', counters: { '-1/-1': 1 } }],
    });
  });
});

describe('activated and static abilities', () => {
  it('costs: mana, tap, sacrifice, life; activation limits', () => {
    expect(one('{2}, {T}, Sacrifice this artifact: Draw a card.', 'Artifact')).toMatchObject({
      kind: 'activated',
      cost: { mana: '{2}', tap: true, other: [{ type: 'sacrifice_self' }] },
    });
    expect(one('{T}, Pay 2 life: Draw a card. Activate only as a sorcery.', 'Creature — Vampire')).toMatchObject({
      cost: { tap: true, other: [{ type: 'pay_life', amount: 2 }] },
      timing: 'sorcery',
    });
  });

  it('CR 606.4: loyalty costs on planeswalkers', () => {
    const r = parse('+1: Draw a card.\n−3: Destroy target creature.', 'Legendary Planeswalker — Test');
    expect(r.abilities.map((a) => (a.kind === 'activated' ? a.cost.loyalty : null))).toEqual([1, -3]);
  });

  it('anthems, lords and attached bonuses', () => {
    expect(one('Other Elf creatures you control get +1/+1.', 'Creature — Elf')).toEqual({
      kind: 'static',
      text: 'Other Elf creatures you control get +1/+1.',
      effect: { type: 'continuous', affected: { ref: 'all', filter: { subtypes: ['Elf'], types: ['Creature'], controller: 'you', other: true } }, power: 1, toughness: 1 },
    });
    expect(one('Other Zombies you control get +1/+1.', 'Creature — Zombie')).toMatchObject({
      effect: { affected: { filter: { subtypes: ['Zombie'] } } },
    });
    expect(one('Enchanted creature gets +2/+2 and has trample.', 'Enchantment — Aura')).toMatchObject({
      effect: { affected: { ref: 'attached' }, power: 2, toughness: 2, keywords: [{ id: 'trample' }] },
    });
    expect(one("This creature can't block.", 'Creature — Goblin')).toMatchObject({ effect: { affected: { ref: 'self' }, rules: ['cant_block'] } });
    expect(one('This creature enters with two +1/+1 counters on it.', 'Creature — Hydra')).toMatchObject({
      effect: { type: 'enters_with_counters', counter: '+1/+1', amount: 2 },
    });
  });

  it('CR 702.5a: what an Aura can enchant becomes a filter', () => {
    expect(parse('Enchant creature you control', 'Enchantment — Aura').keywords).toEqual([
      { id: 'enchant', text: 'creature you control', filter: { types: ['Creature'], controller: 'you' } },
    ]);
  });
});

describe('static abilities, slice 3', () => {
  it('CR 611.3a: conditions in front of a static ability', () => {
    expect(one('During your turn, this creature has first strike.', 'Creature — Human')).toMatchObject({
      effect: { type: 'continuous', affected: { ref: 'self' }, keywords: [{ id: 'first_strike' }], condition: { type: 'your_turn', value: true } },
    });
    expect(one('As long as this creature is equipped, it gets +2/+0 and has menace.', 'Creature — Human')).toMatchObject({
      effect: { affected: { ref: 'self' }, power: 2, keywords: [{ id: 'menace' }], condition: { type: 'has_attached', subtype: 'Equipment' } },
    });
    expect(one('As long as enchanted permanent is a creature, it gets -1/-1 and can’t block.', 'Enchantment — Aura')).toMatchObject({
      effect: { affected: { ref: 'attached' }, power: -1, rules: ['cant_block'], condition: { type: 'is', of: { ref: 'attached' }, filter: { types: ['Creature'] } } },
    });
    expect(one('As long as you have 30 or more life and an opponent has 10 or less life, this creature gets +6/+6.', 'Creature — Vampire')).toMatchObject({
      effect: { condition: { type: 'and', all: [{ type: 'life', op: 'ge', n: 30 }, { type: 'life', op: 'le', n: 10, who: 'any_opponent' }] } },
    });
  });

  it('a condition after the effect: "~ gets +2/+2 as long as …"', () => {
    expect(one('This creature gets +2/+2 as long as seven or more cards are in your graveyard.', 'Creature — Zombie')).toMatchObject({
      effect: { power: 2, condition: { type: 'graveyard', op: 'ge', n: 7 } },
    });
    expect(one('This creature has reach as long as it has a +1/+1 counter on it.', 'Creature — Dog')).toMatchObject({
      effect: { keywords: [{ id: 'reach' }], condition: { type: 'counters', of: { ref: 'self' }, counter: '+1/+1', min: 1 } },
    });
  });

  it('rules for players: hand size, extra lands, skipping the draw, the top of the library', () => {
    expect(one('You have no maximum hand size.', 'Land')).toMatchObject({ effect: { type: 'player_rule', who: 'you', rule: 'no_max_hand_size' } });
    expect(one('You may play two additional lands on each of your turns.', 'Enchantment')).toMatchObject({ effect: { rule: 'extra_lands', amount: 2 } });
    expect(one('Skip your draw step.', 'Enchantment')).toMatchObject({ effect: { rule: 'skip_draw' } });
    expect(one('You may look at the top card of your library any time.', 'Artifact')).toMatchObject({ effect: { rule: 'look_at_top' } });
  });

  it('CR 614.12: lands that check, or ask, as they enter', () => {
    expect(one('This land enters tapped unless you control a Plains or an Island.', 'Land')).toMatchObject({
      effect: { type: 'enters_tapped', unless: { type: 'count', who: 'you', filter: { subtypes: ['Plains', 'Island'] }, min: 1 } },
    });
    expect(one('This land enters tapped unless you control two or fewer other lands.', 'Land')).toMatchObject({
      effect: { unless: { type: 'count', filter: { types: ['Land'], other: true }, max: 2 } },
    });
    expect(one("As this land enters, you may pay 2 life. If you don't, it enters tapped.", 'Land — Forest Island')).toMatchObject({
      effect: { type: 'as_enters', choice: 'pay_life', amount: 2 },
    });
    expect(one('This land enters tapped. As it enters, choose a color other than green.', 'Land')).toMatchObject({
      effect: { type: 'as_enters', choice: 'color', except: 'G', tapped: true },
    });
    expect(one('Creatures you control of the chosen type get +1/+1.', 'Artifact')).toMatchObject({
      effect: { affected: { filter: { types: ['Creature'], controller: 'you', chosenType: true } } },
    });
    expect(one('{T}: Add {G} or one mana of the chosen color.', 'Land')).toMatchObject({ effects: [{ type: 'add_mana', options: [['G'], ['chosen']] }] });
  });

  it('CR 509.1b–c: blocking restrictions and requirements', () => {
    expect(one("This creature can't be blocked by creatures with power 2 or less.", 'Creature — Rogue')).toMatchObject({
      effect: { combat: { cantBeBlockedBy: { types: ['Creature'], power: { op: 'le', n: 2 } } } },
    });
    expect(one('This creature can block only creatures with flying.', 'Creature — Bird')).toMatchObject({ effect: { combat: { canBlockOnly: { keywords: ['flying'] } } } });
    expect(one("This creature can't be blocked except by three or more creatures.", 'Creature — Ogre')).toMatchObject({ effect: { combat: { minBlockers: 3 } } });
    expect(one('All creatures able to block this creature do so.', 'Creature — Beast')).toMatchObject({ effect: { combat: { mustBeBlocked: 'all' } } });
    expect(one('Target creature gets +3/+3 until end of turn and must be blocked this turn if able.')).toMatchObject({
      effects: [{ type: 'modify', power: 3 }, { type: 'modify', combat: { mustBeBlocked: 'one' } }],
    });
  });
});

describe('effects, slice 3', () => {
  it('CR 113.6m: abilities that work from the graveyard', () => {
    expect(one('{2}{B}: Return this card from your graveyard to your hand.', 'Creature — Zombie')).toMatchObject({
      zone: 'graveyard',
      effects: [{ type: 'move', what: { ref: 'self' }, to: 'hand' }],
    });
    expect(one('When this creature dies, return this card from your graveyard to your hand.', 'Creature — Spirit')).toMatchObject({
      effects: [{ type: 'move', what: { ref: 'trigger_object' } }],
    });
    expect(one('When this creature dies, return this card from your graveyard to your hand.', 'Creature — Spirit')).not.toHaveProperty('zone');
    expect(one('{1}, Exile this card from your graveyard: Draw a card.', 'Creature — Skeleton')).toMatchObject({ zone: 'graveyard', cost: { other: [{ type: 'exile_self' }] } });
    expect(one('Return target permanent card from your graveyard to your hand.', 'Sorcery')).toMatchObject({
      targets: [{ filter: { zone: 'graveyard', types: ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'] } }],
    });
  });

  it('keyword actions: adapt (CR 701.46a), explore (CR 701.44a), the monarch (CR 725)', () => {
    expect(one('{2}{G}: Adapt 2.', 'Creature — Mutant')).toMatchObject({
      effects: [{ type: 'if', cond: { type: 'counters', counter: '+1/+1', max: 0 }, effects: [{ type: 'add_counters', amount: 2 }] }],
    });
    expect(one('When this creature enters, it explores.', 'Creature — Merfolk')).toMatchObject({ effects: [{ type: 'explore', what: { ref: 'self' } }] });
    expect(one('When this creature enters, you become the monarch.', 'Creature — Human')).toMatchObject({ effects: [{ type: 'become_monarch', who: { ref: 'you' } }] });
  });

  it('CR 610.3: exile until ~ leaves the battlefield', () => {
    expect(one('When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.', 'Enchantment')).toMatchObject({
      effects: [{ type: 'move', to: 'exile', until: 'source_leaves' }],
    });
  });
});

describe('counted amounts (CR 107.3, CR 608.2h)', () => {
  const count = (filter: object) => ({ kind: 'count', filter });
  it('"for each", "equal to", "where X is"', () => {
    expect(one('Draw a card for each creature you control.')).toMatchObject({
      effects: [{ type: 'draw', amount: { ...count({ types: ['Creature'], controller: 'you' }), times: 1 } }],
    });
    expect(one('Target creature gets +1/+1 until end of turn for each creature you control.')).toMatchObject({
      effects: [{ type: 'modify', power: { kind: 'count', times: 1 }, toughness: { kind: 'count', times: 1 }, until: 'eot' }],
    });
    expect(one('You gain life equal to your devotion to white.')).toMatchObject({ effects: [{ type: 'gain_life', amount: { kind: 'devotion', colors: ['W'] } }] });
    expect(one('Target creature gets -X/-X until end of turn, where X is the number of Swamps you control.')).toMatchObject({
      effects: [{ type: 'modify', power: { kind: 'count', filter: { subtypes: ['Swamp'] }, times: -1 } }],
    });
    expect(one('Draw cards equal to the number of cards in your hand.')).toMatchObject({ effects: [{ type: 'draw', amount: { kind: 'cards', zone: 'hand', who: 'you' } }] });
    expect(one('Destroy target creature. You gain life equal to its toughness.')).toMatchObject({
      effects: [{ type: 'destroy' }, { type: 'gain_life', amount: { kind: 'stat', stat: 'toughness', of: { ref: 'target', index: 0 } } }],
    });
    expect(one('When this creature dies, it deals damage equal to its power to any target.', 'Creature — Zombie')).toMatchObject({
      effects: [{ type: 'deal_damage', amount: { kind: 'stat', stat: 'power', of: { ref: 'trigger_object' } } }],
    });
  });

  it('CR 604.3: characteristic-defining P/T, and counted lords', () => {
    expect(one("This creature's power and toughness are each equal to the number of creature cards in your graveyard.", 'Creature — Lhurgoyf')).toMatchObject({
      effect: { setLayer: '7a', setPower: { kind: 'cards', zone: 'graveyard', who: 'you', filter: { types: ['Creature'] } } },
    });
    expect(one('This creature gets +1/+1 for each other creature you control.', 'Creature — Soldier')).toMatchObject({
      effect: { power: { kind: 'count', filter: { types: ['Creature'], other: true } } },
    });
    expect(one('Enchanted creature has base power and toughness 1/1.', 'Enchantment — Aura')).toMatchObject({
      effect: { affected: { ref: 'attached' }, setPower: 1, setToughness: 1, setLayer: '7b' },
    });
  });
});

describe('slice 5', () => {
  it('CR 714.2: Saga chapters are triggered abilities', () => {
    const r = parse('I, II — Draw a card.\nIII — Exile this Saga, then return it to the battlefield transformed under your control.', 'Enchantment — Saga', 'Moth Story');
    expect(r.unparsed).toEqual([]);
    expect(r.abilities).toMatchObject([
      { kind: 'triggered', trigger: { type: 'chapter', chapters: [1, 2] }, effects: [{ type: 'draw' }] },
      { trigger: { chapters: [3] }, effects: [{ type: 'move', to: 'exile' }, { type: 'move', to: 'battlefield', transformed: true, under: 'you' }] },
    ]);
  });

  it('impulse draw and other keyword actions', () => {
    expect(one('Exile the top two cards of your library. Until the end of your next turn, you may play those cards.')).toMatchObject({
      effects: [{ type: 'exile_top', amount: 2, play: { mode: 'play', until: 'next_turn' } }],
    });
    expect(one('Proliferate.')).toMatchObject({ effects: [{ type: 'proliferate' }] });
    expect(one('Amass Orcs 2.')).toMatchObject({ effects: [{ type: 'amass', subtype: 'Orc', amount: 2 }] });
    expect(one("Tap target creature. It doesn't untap during its controller's next untap step.")).toMatchObject({
      effects: [{ type: 'tap' }, { type: 'skip_untap', what: { ref: 'target', index: 0 } }],
    });
  });

  it('"that much" from the trigger event', () => {
    expect(one('Whenever this creature is dealt damage, put that many +1/+1 counters on it.', 'Creature — Hydra')).toMatchObject({
      trigger: { type: 'dealt_damage' },
      effects: [{ type: 'add_counters', amount: { kind: 'event' } }],
    });
  });
});

describe('slice 6', () => {
  it('CR 614.1a: replacements that change an amount, and "exile it instead"', () => {
    expect(one('If you would gain life, you gain twice that much life instead.', 'Enchantment')).toMatchObject({ effect: { type: 'replace_quantity', event: 'gain_life', op: 'double' } });
    expect(one('If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.', 'Enchantment')).toMatchObject({
      effect: { event: 'counters', counter: '+1/+1', op: 'plus', n: 1, filter: { types: ['Creature'], controller: 'you' } },
    });
    expect(one('If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.', 'Enchantment')).toMatchObject({ effect: { event: 'tokens', op: 'double' } });
    expect(one('If a source would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.', 'Enchantment')).toMatchObject({ effect: { event: 'damage', op: 'double' } });
    expect(one('If a creature an opponent controls would die, exile it instead.', 'Creature — Vampire')).toMatchObject({ effect: { type: 'exile_instead', dies: true, filter: { controller: 'opponent' } } });
  });

  it('CR 613.1d: "becomes a 3/3 green Elemental creature … It\'s still a land."', () => {
    expect(one("{1}{G}: Until end of turn, this land becomes a 3/3 green Elemental creature with trample. It's still a land.", 'Land')).toMatchObject({
      effects: [{ type: 'modify', types: ['Creature'], subtypes: ['Elemental'], colors: ['G'], setPower: 3, setToughness: 3, keywords: [{ id: 'trample' }], retainTypes: true, until: 'eot' }],
    });
  });

  it('Commander: Command Tower, and "you may choose both instead"', () => {
    expect(one("{T}: Add one mana of any color in your commander's color identity.", 'Land')).toMatchObject({ effects: [{ type: 'add_mana', anyColor: 1, identity: true }] });
    const r = parse('Choose one. If you control a commander as you cast this spell, you may choose both instead.\n• Draw a card.\n• You gain 2 life.');
    expect(r.unparsed).toEqual([]);
    expect(r.abilities[0]).toMatchObject({ modes: { max: 1, bonus: { max: 2, condition: { type: 'count', filter: { commander: true } } } } });
  });

  it('CR 716.2a / CR 711.2a: Class levels and leveler striations gate their abilities', () => {
    const c = parse('{1}{G}: Level 2\nCreatures you control get +1/+1.', 'Enchantment — Class', 'Ranger Class');
    expect(c.abilities).toMatchObject([{ activateIf: { type: 'class_level', exactly: 1 }, timing: 'sorcery' }, { gate: { type: 'class_level', min: 2 } }]);
    const l = parse('LEVEL 2-6\n3/3\nFirst strike', 'Creature — Monk', 'Monk');
    expect(l.abilities).toMatchObject([
      { gate: { counter: 'level', min: 2, max: 6 }, effect: { setPower: 3, setToughness: 3, setLayer: '7b' } },
      { gate: { counter: 'level', min: 2, max: 6 }, effect: { keywords: [{ id: 'first_strike' }] } },
    ]);
  });
});

describe('slice 7', () => {
  it('CR 303.4: "Enchant player" / "Enchant opponent", and what refers to that player', () => {
    const r = parse("Enchant opponent\nCreatures enchanted player controls get -1/-1.\nAt the beginning of enchanted player's upkeep, that player loses 1 life.", 'Enchantment — Aura Curse', 'Curse');
    expect(r.unparsed).toEqual([]);
    expect(r.keywords).toMatchObject([{ id: 'enchant', player: 'opponent' }]);
    expect(r.abilities).toMatchObject([
      { effect: { affected: { filter: { controller: 'enchanted' } } } },
      { trigger: { type: 'phase', step: 'upkeep', whose: 'enchanted' }, effects: [{ type: 'lose_life', who: { ref: 'enchanted_player' } }] },
    ]);
  });

  it('"Each opponent attacking that player does the same."', () => {
    expect(one('Whenever enchanted player is attacked, you gain 2 life. Each opponent attacking that player does the same.', 'Enchantment — Aura Curse')).toMatchObject({
      trigger: { type: 'player_attacked', who: 'enchanted' },
      effects: [{ type: 'gain_life' }, { type: 'players_do', players: { ref: 'players', who: 'opponents', attacking: { ref: 'enchanted_player' } }, effects: [{ type: 'gain_life' }] }],
    });
  });

  it('another player chooses: "that player may …. If they do, …"; "discards their hand"', () => {
    expect(one('Whenever a player attacks enchanted player with one or more creatures, that attacking player may discard a card. If the player does, they draw a card.', 'Enchantment — Aura Curse')).toMatchObject({
      effects: [{ type: 'may_do', who: { ref: 'trigger_player' }, effects: [{ type: 'discard', who: { ref: 'trigger_player' } }], then: [{ type: 'draw' }] }],
    });
    expect(one('Whenever a Sliver deals combat damage to a player, its controller may draw a card.', 'Enchantment')).toMatchObject({
      effects: [{ type: 'may', who: { ref: 'controller_of', of: { ref: 'trigger_object' } }, effects: [{ type: 'draw', who: { ref: 'controller_of' } }] }],
    });
    expect(one('At the beginning of your end step, discard your hand.', 'Enchantment')).toMatchObject({ effects: [{ type: 'discard', all: true, who: { ref: 'you' } }] });
  });
});

describe('copy effects (CR 707)', () => {
  it('"enter as a copy of", with exceptions (CR 707.9)', () => {
    expect(one("You may have this creature enter as a copy of any creature on the battlefield, except it's a Spirit in addition to its other types and it has flying.", 'Creature — Shapeshifter')).toMatchObject({
      effect: { type: 'as_enters', choice: 'copy', filter: { types: ['Creature'] }, copyExcept: { addSubtypes: ['Spirit'], keywords: [{ id: 'flying' }] } },
    });
  });

  it('token copies, and "the token" / "it" afterwards', () => {
    expect(one("{T}: Create a token that's a copy of target creature you control, except it isn't legendary. Sacrifice it at the beginning of the next end step.", 'Artifact')).toMatchObject({
      effects: [
        { type: 'create_token', copyOf: { ref: 'target', index: 0 }, except: { nonlegendary: true } },
        { type: 'delayed', effects: [{ type: 'sacrifice', what: { ref: 'created' } }] },
      ],
    });
    expect(one("Whenever another nontoken creature you control dies, create a token that's a copy of that creature, except it's a 4/4 black Zombie.", 'Creature — God')).toMatchObject({
      effects: [{ type: 'create_token', copyOf: { ref: 'trigger_object' }, except: { power: 4, toughness: 4, colors: ['B'], setCreatureTypes: ['Zombie'] } }],
    });
  });
});

describe('quoted abilities (CR 113.1a)', () => {
  it('granted by a static ability, as a keyword instance carrying the compiled ability', () => {
    expect(one('Creatures you control have "{T}: Add {G}."', 'Enchantment')).toMatchObject({
      effect: { type: 'continuous', keywords: [{ id: 'ability', text: '{T}: Add {G}.', abilities: [{ kind: 'activated', mana: true }] }] },
    });
    expect(one('Equipped creature has flying and "Whenever this creature attacks, you gain 1 life."\nEquip {1}', 'Artifact — Equipment')).toMatchObject({
      effect: { keywords: [{ id: 'flying' }, { id: 'ability', abilities: [{ kind: 'triggered', trigger: { type: 'attacks', subject: { ref: 'self' } } }] }] },
    });
  });

  it('granted static abilities about the object itself are read; others, and the card’s own name inside the quotes, stay unread', () => {
    expect(one('Creatures you control have "This creature can\'t block."', 'Enchantment')).toMatchObject({
      effect: { keywords: [{ id: 'ability', abilities: [{ kind: 'static', effect: { rules: ['cant_block'] } }] }] },
    });
    expect(parse('Creatures you control have "Other creatures you control get +1/+1."', 'Enchantment').unparsed).toHaveLength(1);
    expect(parse('Creatures you control have "This creature gets +1/+1 as long as you control a Swamp."', 'Enchantment').unparsed).toHaveLength(1);
    expect(parse('Creatures you control have "{T}: Sacrifice Bomb Totem."', 'Enchantment', 'Bomb Totem').unparsed).toHaveLength(1);
  });

  it('tokens: "with "…"", "named …", and "It has …" afterwards', () => {
    const r = one('{T}: Create a 1/1 blue Faerie creature token named Cloud Sprite. It has flying and "This token can block only creatures with flying."', 'Artifact');
    expect(r).toMatchObject({ effects: [{ type: 'create_token', token: { name: 'Cloud Sprite', keywords: [{ id: 'flying' }], abilities: [{ kind: 'static' }] } }] });
    expect(one('Create a 1/1 green Saproling creature token with "When this token dies, you gain 2 life."', 'Sorcery')).toMatchObject({
      effects: [{ token: { abilities: [{ kind: 'triggered', trigger: { type: 'dies' } }] } }],
    });
  });

  it('CR 114.1: "You get an emblem with "…""', () => {
    expect(one('−6: You get an emblem with "Creatures you control get +2/+2."', 'Legendary Planeswalker — Ajani')).toMatchObject({
      effects: [{ type: 'emblem', abilities: [{ kind: 'static', effect: { type: 'continuous', power: 2 } }] }],
    });
  });
});

describe('copies of spells (CR 707.10)', () => {
  it('"Copy target instant or sorcery spell. You may choose new targets for the copy."', () => {
    expect(one('Copy target instant or sorcery spell you control. You may choose new targets for the copy.', 'Instant')).toMatchObject({
      targets: [{ filter: { zone: 'stack', types: ['Instant', 'Sorcery'], controller: 'you' } }],
      effects: [{ type: 'copy_spell', what: { ref: 'target', index: 0 }, newTargets: true }],
    });
    expect(one('Whenever you cast an instant or sorcery spell, copy that spell twice.', 'Creature — Wizard')).toMatchObject({
      effects: [{ type: 'copy_spell', what: { ref: 'trigger_object' }, amount: 2 }],
    });
  });

  it('"When you cast this spell" works on the stack; storm from its definition', () => {
    expect(one('When you cast this spell, draw a card.', 'Creature — Eldrazi')).toMatchObject({ trigger: { type: 'cast', self: true }, zone: 'stack' });
    const storm = parse('Storm', 'Sorcery', 'Brain Freeze').keywords[0]!;
    expect(storm.abilities).toMatchObject([
      { trigger: { type: 'cast', self: true }, zone: 'stack', effects: [{ type: 'copy_spell', what: { ref: 'self' }, amount: { kind: 'cast_before' }, newTargets: true }] },
    ]);
  });
});

describe('costs chosen as a spell is cast (CR 118.9, CR 601.2f)', () => {
  it('evoke, dash and escape compile from their definitions', () => {
    const evoke = parse('Evoke {2}{U}', 'Creature — Elemental', 'Mulldrifter').keywords[0]!;
    expect(evoke.abilities).toMatchObject([
      { effect: { type: 'cast_option', id: 'evoke', kind: 'alternative', cost: { mana: '{2}{U}' } } },
      { kind: 'triggered', trigger: { type: 'enters' }, condition: { type: 'paid', cost: 'evoke' }, effects: [{ type: 'sacrifice', byController: true }] },
    ]);
    const dash = parse('Dash {2}{R}', 'Creature — Goblin', 'Goblin').keywords[0]!;
    expect(dash.abilities).toMatchObject([
      { effect: { type: 'cast_option', id: 'dash' } },
      { kind: 'triggered', condition: { type: 'paid', cost: 'dash' }, effects: [{ type: 'delayed', effects: [{ type: 'move', to: 'hand' }] }] },
      { effect: { type: 'continuous', condition: { type: 'paid', cost: 'dash' }, keywords: [{ id: 'haste' }] } },
    ]);
    const escape = parse('Escape—{G}{G}{U}{U}, Exile five other cards from your graveyard.', 'Creature — Elk', 'Uro').keywords[0]!;
    expect(escape.abilities).toMatchObject([{ effect: { id: 'escape', zone: 'graveyard', cost: { mana: '{G}{G}{U}{U}', other: [{ type: 'exile_cards', amount: 5 }] } } }]);
  });

  it('buyback, entwine and plain alternative costs', () => {
    expect(parse('Buyback {3}', 'Instant', 'Capsize').keywords[0]!.abilities).toMatchObject([
      { effect: { type: 'cast_option', id: 'buyback', kind: 'additional' } },
      { effect: { type: 'resolve_to_hand', condition: { type: 'paid', cost: 'buyback' } } },
    ]);
    expect(parse('Entwine {2}', 'Sorcery', 'Tooth and Claw').keywords[0]!.abilities).toMatchObject([{ effect: { id: 'entwine', allModes: true } }]);
    expect(one("You may pay {R} rather than pay this spell's mana cost.", 'Instant')).toMatchObject({ effect: { type: 'cast_option', id: 'alt', kind: 'alternative' } });
  });
});

describe('upkeep costs and paying with permanents', () => {
  it('cumulative upkeep (CR 702.24a) and echo (CR 702.30a) from their definitions', () => {
    expect(parse('Cumulative upkeep {1}', 'Enchantment', 'Remora').keywords[0]!.abilities).toMatchObject([
      {
        trigger: { type: 'phase', step: 'upkeep', whose: 'you' },
        condition: { type: 'is', of: { ref: 'self' } },
        effects: [{ type: 'add_counters', counter: 'age' }, { type: 'may_pay', cost: '{1}', times: { kind: 'counters', counter: 'age' }, else: [{ type: 'sacrifice' }] }],
      },
    ]);
    expect(parse('Echo {2}{G}', 'Creature — Beast', 'Beast').keywords[0]!.abilities).toMatchObject([
      { condition: { type: 'arrived_since_upkeep' }, effects: [{ type: 'unless_pays', cost: '{2}{G}', effects: [{ type: 'sacrifice' }] }] },
    ]);
  });

  it('convoke, delve and improvise are applied natively', () => {
    for (const kw of ['Convoke', 'Delve', 'Improvise']) expect(parse(kw, 'Sorcery', 'Spell').manualKeywords).toEqual([]);
  });
});

describe('face-down cards (CR 708)', () => {
  it('morph, megamorph and disguise with mana costs are applied; "when ~ is turned face up"; manifest', () => {
    const r = parse('When this creature is turned face up, draw a card.\nMorph {2}{R}', 'Creature — Ogre', 'Ogre');
    expect(r.unparsed).toEqual([]);
    expect(r.manualKeywords ?? []).toEqual([]);
    expect(r.abilities[0]).toMatchObject({ trigger: { type: 'turned_face_up', subject: { ref: 'self' } } });
    expect(parse('Morph—Reveal a white card in your hand.', 'Creature — Bird', 'Bird').manualKeywords).toHaveLength(1);
    expect(one('Manifest the top card of your library.', 'Sorcery')).toMatchObject({ effects: [{ type: 'manifest', amount: 1 }] });
    expect(one('Cloak the top two cards of your library.', 'Sorcery')).toMatchObject({ effects: [{ type: 'manifest', amount: 2, cloak: true }] });
  });
});

describe('casting as an effect resolves (CR 608.2g)', () => {
  it('cascade and rebound from their definitions; discover; "you may cast it without paying its mana cost"', () => {
    expect(parse('Cascade', 'Creature — Beast', 'Beast').keywords[0]!.abilities).toMatchObject([{ trigger: { type: 'cast', self: true }, zone: 'stack', effects: [{ type: 'cascade' }] }]);
    expect(parse('Rebound', 'Sorcery', 'Spell').keywords[0]!.abilities).toMatchObject([{ effect: { type: 'rebound' } }]);
    expect(one('When this creature enters, discover 3.', 'Creature — Elf')).toMatchObject({ effects: [{ type: 'discover', n: 3 }] });
    expect(one('Exile target instant or sorcery card from your graveyard. You may cast that card without paying its mana cost.', 'Sorcery')).toMatchObject({
      effects: [{ type: 'move', to: 'exile' }, { type: 'cast_free', what: { ref: 'target', index: 0 } }],
    });
  });
});

describe('cards cast later from exile', () => {
  it('foretell, plot, suspend and madness with mana costs are applied natively', () => {
    for (const [line, type] of [['Foretell {1}{R}', 'Instant'], ['Plot {2}{U}', 'Sorcery'], ['Suspend 3—{1}{G}', 'Creature — Beast'], ['Madness {B}', 'Creature — Vampire']] as const) {
      expect(parse(line, type, 'Card').manualKeywords ?? []).toEqual([]);
    }
    expect(parse('Suspend 3—{1}{G}', 'Sorcery', 'Card').keywords).toMatchObject([{ id: 'suspend', n: 3, cost: '{1}{G}' }]);
  });
});

describe('more keywords from CR 702 (slice 16)', () => {
  it('bloodthirst, vanishing, renown, mentor, bargain, exhaust', () => {
    expect(parse('Bloodthirst 2', 'Creature — Ogre', 'Ogre').keywords[0]!.abilities).toMatchObject([
      { effect: { type: 'enters_with_counters', amount: 2, condition: { type: 'this_turn', event: 'opponent_damaged' } } },
    ]);
    expect(parse('Vanishing 3', 'Creature — Spirit', 'Spirit').keywords[0]!.abilities).toMatchObject([
      { effect: { type: 'enters_with_counters', counter: 'time', amount: 3 } },
      { trigger: { type: 'phase', step: 'upkeep' }, effects: [{ type: 'remove_counters', counter: 'time', amount: 1 }] },
      { trigger: { type: 'last_counter_removed', counter: 'time' }, effects: [{ type: 'sacrifice' }] },
    ]);
    expect(parse('Renown 1', 'Creature — Human', 'Human').keywords[0]!.abilities).toMatchObject([
      { condition: { type: 'renowned', not: true }, effects: [{ type: 'add_counters' }, { type: 'become_renowned' }] },
    ]);
    expect(parse('Mentor', 'Creature — Human', 'Human').keywords[0]!.abilities).toMatchObject([{ targets: [{ filter: { powerBelowSource: true, combat: 'attacking' } }] }]);
    expect(parse('Bargain', 'Sorcery', 'Spell').keywords[0]!.abilities).toMatchObject([{ effect: { type: 'cast_option', id: 'bargain', kind: 'additional' } }]);
    expect(one('Exhaust — {2}{G}: Put three +1/+1 counters on this creature.', 'Creature — Elf')).toMatchObject({ kind: 'activated', oncePerGame: true });
  });
});

describe('day and night, saddle (slice 17)', () => {
  it('reads the day/night designation, its changes, and saddle', () => {
    expect(one("If it's neither day nor night, it becomes day as this creature enters.", 'Creature — Human')).toMatchObject({ kind: 'static', effect: { type: 'enters_day' } });
    expect(one('Whenever day becomes night or night becomes day, draw a card.', 'Creature — Human')).toMatchObject({ trigger: { type: 'day_night_changed' } });
    expect(one('It becomes night. Draw a card.', 'Sorcery')).toMatchObject({ effects: [{ type: 'day_night', to: 'night' }, { type: 'draw' }] });
    expect(one("This spell costs {2} less to cast if it's night.", 'Instant')).toMatchObject({ effect: { condition: { type: 'day_night', is: 'night' } } });
    expect(parse('Saddle 2', 'Creature — Horse Mount', 'Horse').keywords[0]!.abilities).toMatchObject([
      { cost: { other: [{ type: 'crew', power: 2 }] }, effects: [{ type: 'become_saddled' }], timing: 'sorcery' },
    ]);
    expect(one('Whenever this creature attacks while saddled, create a Treasure token.', 'Creature — Horse Mount')).toMatchObject({ trigger: { type: 'attacks', saddled: true } });
  });
});

describe('fight, bite and one-line patterns (slice 18)', () => {
  it('fight and "deals damage equal to its power"', () => {
    expect(one("Target creature you control fights target creature you don't control.", 'Sorcery')).toMatchObject({
      effects: [{ type: 'fight', a: { ref: 'target', index: 0 }, b: { ref: 'target', index: 1 } }],
    });
    expect(one("Target creature you control deals damage equal to its power to target creature you don't control.", 'Instant')).toMatchObject({
      effects: [{ type: 'deal_damage', from: { ref: 'target', index: 0 }, to: { ref: 'target', index: 1 }, amount: { kind: 'stat', stat: 'power' } }],
    });
  });
  it('"… instead" replaces the sentence before it, unless it brings new targets', () => {
    expect(one('You gain 4 life. If a creature died this turn, you gain 8 life instead.', 'Instant')).toMatchObject({
      effects: [{ type: 'if', effects: [{ type: 'gain_life', amount: 8 }], else: [{ type: 'gain_life', amount: 4 }] }],
    });
    expect(parse('Exile target artifact or enchantment. If this spell was kicked, exile target nonland permanent instead.', 'Instant', 'Spell').unparsed).toHaveLength(1);
  });
  it('counters filters, "~ or another", "it enters with", raid, multikicker, chosen returns', () => {
    expect(one('Each creature you control with a +1/+1 counter on it has trample.', 'Enchantment')).toMatchObject({ effect: { affected: { filter: { counter: '+1/+1' } } } });
    expect(one('Whenever this creature or another Ally you control enters, you gain 1 life.', 'Creature — Ally')).toMatchObject({
      trigger: { subject: { filter: { orSource: true, subtypes: ['Ally'] } } },
    });
    expect(one('Raid — This creature enters with a +1/+1 counter on it if you attacked this turn.', 'Creature — Orc')).toMatchObject({ effect: { type: 'enters_with_counters', condition: {} } });
    expect(one('This creature enters with a +1/+1 counter on it for each time it was kicked.', 'Creature — Hydra')).toMatchObject({ effect: { perKick: true } });
    expect(one("When this land enters, return a land you control to its owner's hand.", 'Land')).toMatchObject({ effects: [{ type: 'move_chosen', amount: 1, to: 'hand' }] });
    expect(one('Whenever you draw your second card each turn, you gain 1 life.', 'Creature — Human')).toMatchObject({ trigger: { type: 'draw', nth: 2 } });
  });
});

describe('compound triggers, keyword actions, revealed hands (slice 19)', () => {
  it('"enters or attacks", "enters and whenever it attacks", "becomes tapped", heroic', () => {
    expect(one('Whenever this creature enters or attacks, you gain 1 life.', 'Creature — Human')).toMatchObject({ trigger: { type: 'either', of: [{ type: 'enters' }, { type: 'attacks' }] } });
    expect(one('When this creature enters and whenever it attacks, you gain 1 life.', 'Creature — Human')).toMatchObject({ trigger: { type: 'either' } });
    expect(one('Whenever this creature becomes tapped, you gain 1 life.', 'Creature — Human')).toMatchObject({ trigger: { type: 'becomes_tapped', subject: { ref: 'self' } } });
    expect(one('Whenever you cast a spell that targets this creature, you gain 1 life.', 'Creature — Human')).toMatchObject({ trigger: { type: 'cast', targetsSource: true } });
  });
  it('bolster, support, endure, "back in any order", "of their choice", Thoughtseize', () => {
    expect(one('When this creature enters, bolster 2.', 'Creature — Human')).toMatchObject({ effects: [{ type: 'bolster', amount: 2 }] });
    expect(one('Support 2.', 'Sorcery')).toMatchObject({ targets: [{ count: 2, upTo: true }] });
    expect(one('When this creature enters, support 2.', 'Creature — Human')).toMatchObject({ targets: [{ count: 2, upTo: true, filter: { other: true } }] });
    expect(one('When this creature enters, it endures 2.', 'Creature — Spirit')).toMatchObject({ effects: [{ type: 'may_do', else: [{ type: 'create_token' }] }] });
    expect(one('When this creature enters, look at the top three cards of your library, then put them back in any order.', 'Creature — Human')).toMatchObject({ effects: [{ type: 'reorder_top', amount: 3 }] });
    expect(one('Each opponent sacrifices a creature of their choice.', 'Sorcery')).toMatchObject({ effects: [{ type: 'sacrifice_choice' }] });
    expect(one('Target opponent reveals their hand. You choose a nonland card from it. That player discards that card.', 'Sorcery')).toMatchObject({
      effects: [{ type: 'choose_from_hand', then: 'discard', amount: 1, filter: { notTypes: ['Land'] } }],
    });
  });
});

describe('looking at the top of the library, counter costs (slice 20)', () => {
  it('reads dig effects', () => {
    expect(one('Look at the top four cards of your library. Put two of them into your hand and the rest on the bottom of your library in any order.', 'Sorcery')).toMatchObject({
      effects: [{ type: 'dig', amount: 4, take: 2, to: 'hand', rest: 'bottom', order: 'any' }],
    });
    expect(one('When this creature enters, look at the top five cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.', 'Creature — Elf')).toMatchObject({
      effects: [{ type: 'dig', amount: 5, take: 1, optional: true, reveal: true, filter: { types: ['Creature'] }, rest: 'bottom', order: 'random' }],
    });
  });
  it('reads "Remove a counter from ~" costs and Arrest', () => {
    expect(one('{2}, Remove a +1/+1 counter from this creature: You gain 2 life.', 'Creature — Spike')).toMatchObject({ cost: { other: [{ type: 'remove_counters_self', counter: '+1/+1', amount: 1 }] } });
    expect(one("Enchanted creature can't attack or block, and its activated abilities can't be activated.", 'Enchantment — Aura')).toMatchObject({ effect: { rules: ['cant_attack', 'cant_block', 'cant_activate'] } });
  });
});

describe('speed, ascend and more keywords (slice 21)', () => {
  it('"Max speed — [ability]" is gated on max speed (CR 702.178a)', () => {
    expect(one('Max speed — This creature gets +1/+1.', 'Creature — Human')).toMatchObject({ gate: { type: 'max_speed' }, effect: { type: 'continuous' } });
    expect(parse('Start your engines!', 'Creature — Human', 'Racer').manualKeywords ?? []).toEqual([]);
  });
  it('keywords compiled from their definitions', () => {
    for (const k of ['Fabricate 2', 'Extort', 'Riot', 'Unleash', 'Evolve', 'Dethrone', 'Mobilize 2', 'Melee', 'Training', 'Ascend', 'Sunburst']) {
      expect(parse(k, 'Creature — Human', 'Card').manualKeywords ?? []).toEqual([]);
    }
    expect(one("Whenever this creature attacks, create a 1/1 white Soldier creature token that's tapped and attacking.", 'Creature — Human')).toMatchObject({ effects: [{ type: 'create_token', tapped: true, attacking: true }] });
  });
});

describe('partner with, strive, sea serpents (slice 22)', () => {
  it('reads them', () => {
    expect(parse('Partner with Pir, Imaginative Rascal', 'Legendary Creature — Human', 'Toothy, Imaginary Friend').keywords[0]).toMatchObject({
      id: 'partner_with',
      abilities: [{ kind: 'triggered', effects: [{ type: 'may', effects: [{ type: 'search', filter: { name: 'Pir, Imaginative Rascal' } }] }] }],
    });
    expect(one('This spell costs {2}{W} more to cast for each target beyond the first.', 'Instant')).toMatchObject({ effect: { type: 'per_target_cost', cost: '{2}{W}' } });
    expect(one("This creature can't attack unless defending player controls an Island.", 'Creature — Serpent')).toMatchObject({ effect: { combat: { attackOnlyIfDefenderControls: { subtypes: ['Island'] } } } });
    expect(one('When you control no Islands, sacrifice this creature.', 'Creature — Serpent')).toMatchObject({ trigger: { type: 'state' } });
    expect(parse('Diana — Equip {2}', 'Artifact — Equipment', 'Blade').keywords[0]).toMatchObject({ id: 'equip' });
  });
});

describe('granted statics and one-liners (slice 23)', () => {
  it('reads them', () => {
    expect(one('Equipped creature gets +1/+0 and is a Wizard in addition to its other types.', 'Artifact — Equipment')).toMatchObject({ effect: { power: 1, addTypes: { subtypes: ['Wizard'] } } });
    expect(one('Other creatures you control have "Ward—Pay 2 life."', 'Enchantment')).toMatchObject({ effect: { keywords: [{ id: 'ward' }] } });
    expect(one('{T}: You gain 1 life. Activate only during your turn.', 'Creature — Human')).toMatchObject({ activateIf: { type: 'your_turn' } });
    expect(one('{T}: You gain 1 life. Activate only if you control an Island.', 'Creature — Human')).toMatchObject({ activateIf: { type: 'count' } });
    expect(one('Flip a coin. If you win the flip, draw two cards.', 'Sorcery')).toMatchObject({ effects: [{ type: 'flip_coin' }, { type: 'if', cond: { type: 'won_flip' } }] });
    expect(one('Destroy target creature. Then each player draws a card.', 'Sorcery')).toMatchObject({ effects: [{ type: 'destroy' }, { type: 'draw' }] });
    expect(one("At the beginning of each player's draw step, that player draws an additional card.", 'Artifact')).toMatchObject({ effects: [{ type: 'draw', who: { ref: 'trigger_player' } }] });
    expect(one('Whenever this creature blocks a creature, destroy that creature at end of combat.', 'Creature — Human')).toMatchObject({
      effects: [{ type: 'delayed', step: 'end_of_combat', effects: [{ type: 'destroy', what: { ref: 'trigger_object' } }] }],
    });
  });
});

describe('extra turns, switching P/T, cost LKI (slice 24)', () => {
  it('reads them', () => {
    expect(one('Take an extra turn after this one.', 'Sorcery')).toMatchObject({ effects: [{ type: 'extra_turn', who: { ref: 'you' } }] });
    expect(one("Switch target creature's power and toughness until end of turn.", 'Instant')).toMatchObject({ effects: [{ type: 'modify', switchPT: true }] });
    expect(parse("As an additional cost to cast this spell, sacrifice a creature.\nYou gain life equal to the sacrificed creature's toughness.", 'Sorcery', 'Rite').abilities[1]).toMatchObject({
      effects: [{ type: 'gain_life', amount: { kind: 'cost_lki', cost: 'sacrificed', stat: 'toughness' } }],
    });
    expect(one('Destroy target creature that was dealt damage this turn.', 'Instant')).toMatchObject({ targets: [{ filter: { damagedThisTurn: true } }] });
    // Restricted mana abilities stay unread for now.
    expect(parse('{T}: Add {G}. Activate only during your turn.', 'Creature — Elf', 'Elf').unparsed).toHaveLength(1);
  });
});

describe('top-card digs, goad, divided damage (slices 25–26)', () => {
  it('reads them', () => {
    expect(one('Reveal the top card of your library. If it\'s a land card, put it onto the battlefield. Otherwise, put it into your hand.', 'Sorcery')).toMatchObject({
      effects: [{ type: 'dig', amount: 1, take: 1, to: 'battlefield', rest: 'hand', filter: { types: ['Land'] } }],
    });
    expect(one('You may search your library and/or graveyard for a card named Ajani, reveal it, and put it into your hand. If you search your library this way, shuffle.', 'Sorcery')).toMatchObject({
      effects: [{ type: 'may', effects: [{ type: 'search', zones: ['library', 'graveyard'] }] }],
    });
    expect(one('Goad target creature.', 'Sorcery')).toMatchObject({ effects: [{ type: 'goad' }] });
    expect(one('This spell deals 3 damage divided as you choose among one, two, or three targets.', 'Sorcery')).toMatchObject({
      effects: [{ type: 'deal_damage', divided: true, amount: 3 }], targets: [{ count: 3, upTo: true, min: 1 }],
    });
    expect(one('Investigate twice.', 'Sorcery').effects).toHaveLength(2);
    expect(one('You win the game.', 'Sorcery')).toMatchObject({ effects: [{ type: 'game_result', result: 'win' }] });
  });
});
