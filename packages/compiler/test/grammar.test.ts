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
    const modal = parse('Choose one —\n• Destroy target artifact.\n• Open an Attraction.');
    expect(modal.unparsed).toEqual([]);
    expect(modal.abilities[0]).toMatchObject({ modes: { options: [{ effects: [{ type: 'destroy' }] }, { manual: true, effects: [] }] } });
    expect(parse('Choose one —\n• Roll to visit your Attractions.\n• Open an Attraction.').unparsed).toHaveLength(3);
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
    // New targets: chosen as it's cast, knowing whether it's kicked (CR 601.2c) — slice 170's variant.
    expect(one('Exile target artifact or enchantment. If this spell was kicked, exile target nonland permanent instead.', 'Instant')).toMatchObject({
      targets: [{ filter: { types: ['Artifact', 'Enchantment'] } }],
      variant: { condition: { type: 'kicked' }, targets: [{ filter: { notTypes: ['Land'] } }], effects: [{ type: 'move', to: 'exile' }] },
    });
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
    // Mana abilities with a condition on activating (CR 602.5b); timing restrictions stay unread.
    expect(parse('{T}: Add {G}. Activate only during your turn.', 'Creature — Elf', 'Elf').abilities[0]).toMatchObject({ mana: true, activateIf: { type: 'your_turn', value: true } });
    expect(parse('{T}: Add {G}. Activate only as a sorcery.', 'Creature — Elf', 'Elf').unparsed).toHaveLength(1);
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
    expect((one('Investigate twice.', 'Sorcery') as { effects: unknown[] }).effects).toHaveLength(2);
    expect(one('You win the game.', 'Sorcery')).toMatchObject({ effects: [{ type: 'game_result', result: 'win' }] });
  });
});

describe('abilities on the stack (slice 27)', () => {
  it('reads targets that are abilities, copies of them, and activation triggers', () => {
    expect(one('Counter target activated or triggered ability.', 'Instant')).toMatchObject({
      targets: [{ what: 'ability', abilities: ['activated', 'triggered'] }], effects: [{ type: 'counter' }],
    });
    expect(one('Counter target activated ability from an artifact source.', 'Instant')).toMatchObject({ targets: [{ what: 'ability', abilities: ['activated'], source: { types: ['Artifact'] } }] });
    expect(one('Counter target triggered ability or colorless spell.', 'Instant')).toMatchObject({ targets: [{ what: 'ability', spells: { colorless: true } }] });
    expect(one('{2}, {T}: Copy target triggered ability you control. You may choose new targets for the copy.', 'Artifact')).toMatchObject({
      targets: [{ what: 'ability', abilities: ['triggered'], player: 'you' }], effects: [{ type: 'copy_spell', newTargets: true }],
    });
    expect(one("Whenever you activate an ability, if it isn't a mana ability, you may pay {2}. If you do, copy that ability.", 'Artifact')).toMatchObject({
      trigger: { type: 'activate', who: 'you' },
    });
    expect(one('Whenever an opponent activates a loyalty ability, this creature deals 1 damage to that player.', 'Creature — Human')).toMatchObject({
      trigger: { type: 'activate', who: 'opponent', loyalty: true }, effects: [{ type: 'deal_damage', to: { ref: 'trigger_player' } }],
    });
    // An ability "of a creature" could be a mana ability, which never reaches the stack: left to the players.
    expect(parse('Whenever you activate an ability of a creature, draw a card.', 'Creature — Elf', 'Elf').unparsed).toHaveLength(1);
  });
});

describe('preparation cards, shuffling into libraries (slice 28)', () => {
  it('reads them', () => {
    expect(one('This creature enters prepared.', 'Creature — Human')).toMatchObject({ effect: { type: 'enters_prepared' } });
    expect(one("At the beginning of your upkeep, if this creature isn't prepared, it becomes prepared.", 'Creature — Elf')).toMatchObject({
      condition: { type: 'prepared', not: true }, effects: [{ type: 'become_prepared' }],
    });
    expect(one('Each player shuffles their hand and graveyard into their library, then draws seven cards.', 'Sorcery')).toMatchObject({
      effects: [{ type: 'shuffle_zones', zones: ['hand', 'graveyard'] }, { type: 'draw', amount: 7 }],
    });
    expect(one('The owner of target permanent shuffles it into their library.', 'Instant')).toMatchObject({ effects: [{ type: 'move', to: 'library', position: 'shuffle' }] });
    expect(one("Counter target spell. If that spell is countered this way, exile it instead of putting it into its owner's graveyard.", 'Instant')).toMatchObject({
      effects: [{ type: 'counter', exile: true }],
    });
    expect(one('Learn.', 'Sorcery')).toMatchObject({ effects: [{ type: 'may_do' }] });
    expect(one('You may play an additional land this turn.', 'Sorcery')).toMatchObject({ effects: [{ type: 'extra_land' }] });
    expect(one('Target creature has base power and toughness 1/1 until end of turn.', 'Instant')).toMatchObject({ effects: [{ type: 'modify', setPower: 1, setToughness: 1, until: 'eot' }] });
  });
});

describe('attached-creature triggers, historic, more digs (slice 29)', () => {
  it('reads them', () => {
    expect(one('Whenever equipped creature attacks, it gets +2/+0 until end of turn.', 'Artifact — Equipment')).toMatchObject({
      trigger: { type: 'attacks', subject: { ref: 'attached' } }, effects: [{ type: 'modify', what: { ref: 'attached' } }],
    });
    expect(one('When enchanted creature dies, return that card to the battlefield under your control.', 'Enchantment — Aura')).toMatchObject({
      trigger: { type: 'dies', subject: { ref: 'attached' } }, effects: [{ what: { ref: 'trigger_object' } }],
    });
    expect(one('Return target historic card from your graveyard to your hand.', 'Sorcery')).toMatchObject({ targets: [{ filter: { historic: true } }] });
    expect(one("This creature can't attack or block alone.", 'Creature — Human')).toMatchObject({ effect: { rules: ['cant_attack_alone', 'cant_block_alone'] } });
    expect(one("If this creature would be put into a graveyard from anywhere, reveal this creature and shuffle it into its owner's library instead.", 'Creature — Eldrazi')).toMatchObject({
      effect: { type: 'graveyard_to_library' },
    });
    expect(one('Look at the top seven cards of your library. Put up to two land cards from among them onto the battlefield tapped. Put the rest on the bottom of your library in a random order.', 'Sorcery')).toMatchObject({
      effects: [{ type: 'dig', amount: 7, take: 2, to: 'battlefield', tapped: true, optional: true, rest: 'bottom' }],
    });
    expect(one('Look at the top two cards of your library. Put one of them into your graveyard.', 'Sorcery')).toMatchObject({ effects: [{ type: 'dig', take: 1, to: 'graveyard', rest: 'top' }] });
    expect(one('Look at the top three cards of your library, then put one of those cards into your hand and the rest into your graveyard.', 'Sorcery')).toMatchObject({
      effects: [{ type: 'dig', amount: 3, take: 1, to: 'hand', rest: 'graveyard' }],
    });
  });
});

describe('exert and clash (slice 30)', () => {
  it('reads them', () => {
    expect(one('You may exert this creature as it attacks. When you do, it gets +1/+1 until end of turn.', 'Creature — Human Warrior')).toMatchObject({
      kind: 'triggered', trigger: { type: 'exerted', subject: { ref: 'self' }, option: true }, effects: [{ type: 'modify', what: { ref: 'self' } }],
    });
    expect(one('You may exert this creature as it attacks.', 'Creature — Human Warrior')).toMatchObject({ effect: { type: 'exert_option' } });
    expect(one('When this creature enters, clash with an opponent. If you win, put a +1/+1 counter on this creature.', 'Creature — Goblin')).toMatchObject({
      effects: [{ type: 'clash' }, { type: 'if', cond: { type: 'won_clash' } }],
    });
    expect(one('Whenever you win a clash, draw a card.', 'Creature — Goblin')).toMatchObject({ trigger: { type: 'clashed', won: true } });
  });
});

describe('leylines, any-player abilities, activation limits (slice 31)', () => {
  it('reads them', () => {
    expect(one('If this card is in your opening hand, you may begin the game with it on the battlefield.', 'Enchantment')).toMatchObject({ effect: { type: 'begin_on_battlefield' } });
    expect(one('{T}: Draw a card. Any player may activate this ability.', 'Artifact')).toMatchObject({ anyPlayer: true });
    expect(one('{R}: This creature gets +1/+0 until end of turn. Activate no more than twice each turn.', 'Creature — Shapeshifter')).toMatchObject({ maxPerTurn: 2 });
    expect(one('When this creature dies, put its counters on target creature you control.', 'Artifact Creature — Drone')).toMatchObject({ effects: [{ type: 'put_counters' }] });
    expect(one('This spell deals damage to target creature equal to the number of lands you control.', 'Sorcery')).toMatchObject({ effects: [{ type: 'deal_damage', amount: { kind: 'count' } }] });
    expect(one('Exile the top card of your library. During your next turn, you may play that card.', 'Sorcery')).toMatchObject({
      effects: [{ type: 'exile_top', play: { mode: 'play', until: 'during_next_turn' } }],
    });
    expect(one("This land doesn't untap during your untap step if it has a depletion counter on it.", 'Land')).toMatchObject({ effect: { rules: ['doesnt_untap'], condition: { type: 'counters', counter: 'depletion' } } });
  });
});

describe('fading, retrace, transmute, filtered discard costs (slice 32)', () => {
  it('reads them', () => {
    expect(parse('Fading 3', 'Creature — Beast', 'Fader').manualKeywords).toEqual([]);
    expect(parse('Destroy target creature.\nRetrace', 'Instant', 'Ret').manualKeywords).toEqual([]);
    expect(parse('Transmute {1}{B}{B}', 'Creature — Human', 'Tm').manualKeywords).toEqual([]);
    expect(parse('Cumulative upkeep—Pay 1 life.', 'Creature — Spirit', 'Cu').manualKeywords).toEqual([]);
    expect(one('{T}, Discard a land card: Draw a card.', 'Artifact')).toMatchObject({ cost: { other: [{ type: 'discard', filter: { types: ['Land'] } }] } });
    expect(one("Target creature's owner puts it on their choice of the top or bottom of their library.", 'Instant')).toMatchObject({ effects: [{ type: 'move', position: 'choice' }] });
    expect(one("When this creature is put into a graveyard from anywhere, shuffle it into its owner's library.", 'Creature — Horror')).toMatchObject({
      trigger: { type: 'put_into_graveyard' }, zone: 'graveyard',
    });
    expect(one('Exile the top three cards of your library. Until end of turn, you may cast spells from among them.', 'Sorcery')).toMatchObject({
      effects: [{ type: 'exile_top', play: { mode: 'cast', until: 'eot' } }],
    });
  });
});

describe('blitz, warp, disturb, overload, aftermath (slice 33)', () => {
  it('reads them', () => {
    for (const line of ['Blitz {2}{R}', 'Warp {1}{R}', 'Disturb {1}{W}']) expect(parse(line, 'Creature — Human', 'Kw').manualKeywords).toEqual([]);
    const over = parse('Destroy target artifact you don\'t control.\nOverload {5}{R}', 'Instant', 'Storm');
    expect(over.manualKeywords).toEqual([]);
    expect(over.keywords[0]!.abilities![0]).toMatchObject({ effect: { type: 'cast_option', id: 'overload', spell: { effects: [{ type: 'destroy', what: { ref: 'all' } }] } } });
  });
});

describe('bestow, backup, replicate, squad (slice 34)', () => {
  it('reads them', () => {
    expect(parse('Bestow {4}{U}\nFlying\nEnchanted creature gets +1/+1 and has flying.', 'Enchantment Creature — Siren', 'Siren').manualKeywords).toEqual([]);
    const backup = parse('Backup 1\nFlying\nWhenever this creature attacks, draw a card.', 'Creature — Human', 'Backer');
    expect(backup.manualKeywords).toEqual([]);
    expect(backup.keywords[0]!.abilities![0]).toMatchObject({
      trigger: { type: 'enters' },
      effects: [{ type: 'add_counters', amount: 1 }, { type: 'if', effects: [{ type: 'modify', keywords: [{ id: 'flying' }, { id: 'ability' }], until: 'eot' }] }],
    });
    expect(parse('This spell deals 1 damage to any target.\nReplicate {1}', 'Instant', 'Ping').manualKeywords).toEqual([]);
    expect(parse('Squad {2}', 'Creature — Soldier', 'Sq').manualKeywords).toEqual([]);
  });
});

describe('station (slice 35)', () => {
  it('reads station cards', () => {
    const ship = parse("When this Spacecraft enters, put a +1/+1 counter on each creature you control.\nStation (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 8+.)\n8+ | Flying, trample", 'Artifact — Spacecraft', 'Ship');
    expect(ship.unparsed).toEqual([]);
    expect(ship.manualKeywords).toEqual([]);
    expect(ship.abilities.filter((a) => a.gate)).toHaveLength(2);
  });
});

describe('ninjutsu and sneak (slice 36)', () => {
  it('reads them', () => {
    const ninja = parse('Ninjutsu {1}{U}', 'Creature — Human Ninja', 'Ninja');
    expect(ninja.manualKeywords).toEqual([]);
    expect(ninja.keywords[0]!.abilities![0]).toMatchObject({ kind: 'activated', zone: 'hand', cost: { other: [{ type: 'return_unblocked' }] }, effects: [{ type: 'ninjutsu' }] });
    expect(parse('Sneak {2}{G}', 'Creature — Turtle', 'Turtle').manualKeywords).toEqual([]);
  });
});

describe('keyword batch: casualty, graft, devour, umbra armor, jump-start, surge, awaken, equip qualities (slice 37)', () => {
  it('reads them', () => {
    const lines: [string, string][] = [
      ['Draw a card.\nCasualty 2', 'Instant'],
      ['Graft 2', 'Creature — Plant'],
      ['Devour 1', 'Creature — Dragon'],
      ['Enchant creature\nUmbra armor', 'Enchantment — Aura'],
      ['Destroy target creature.\nJump-start', 'Sorcery'],
      ['Draw a card.\nSurge {1}{R}', 'Sorcery'],
      ['Draw a card.\nAwaken 2—{4}{U}', 'Sorcery'],
      ['Equip legendary creature {1}', 'Artifact — Equipment'],
      ['Destroy target creature.\nFlashback—{1}{B}, Pay 3 life.', 'Sorcery'],
    ];
    for (const [text, type] of lines) expect(parse(text, type, 'Kw').manualKeywords).toEqual([]);
    // Awaken's land is targeted only when the awaken cost is paid (CR 702.113a): the plain spell has no target.
    const awaken = parse('Draw a card.\nAwaken 2—{4}{U}', 'Sorcery', 'Kw');
    expect(awaken.abilities[0]).toMatchObject({ kind: 'spell' });
    expect((awaken.abilities[0] as { targets?: unknown[] }).targets).toBeUndefined();
    expect(awaken.keywords[0]!.abilities![0]).toMatchObject({ effect: { id: 'awaken', spell: { targets: [{ filter: { types: ['Land'] } }] } } });
  });
});

describe('myriad, encore, miracle, emerge, enlist (slice 38)', () => {
  it('reads them', () => {
    for (const [text, type] of [['Myriad', 'Creature — Elemental'], ['Encore {4}{U}{U}', 'Creature — Pirate'], ['Draw a card.\nMiracle {W}', 'Sorcery'], ['Emerge {5}{G}', 'Creature — Eldrazi'], ['Enlist', 'Creature — Soldier']] as const) {
      expect(parse(text, type, 'Kw').manualKeywords).toEqual([]);
    }
  });
});

describe('trigger batch (slice 39)', () => {
  it('reads the trigger conditions', () => {
    const cases: [string, Record<string, unknown>][] = [
      ['Whenever you attack, draw a card.', { type: 'you_attack' }],
      ['Whenever you attack with three or more creatures, draw a card.', { type: 'you_attack', min: 3 }],
      ['Whenever you attack a player, that player loses 1 life.', { type: 'you_attack', perPlayer: true }],
      ['Whenever this creature attacks and isn’t blocked, defending player discards a card.', { type: 'unblocked', subject: { ref: 'self' } }],
      ['When you cycle this card, draw a card.', { type: 'activate', keyword: 'cycling', self: true }],
      ['Whenever a player cycles a card, you gain 1 life.', { type: 'activate', who: 'any', keyword: 'cycling' }],
      ['Whenever you cast your second spell each turn, draw a card.', { type: 'cast', nth: 2 }],
      ["Whenever you cast your first spell during each opponent's turn, draw a card.", { type: 'cast', nth: 1, opponentsTurn: true }],
      ['Whenever you cast or copy an instant or sorcery spell, scry 1.', { type: 'cast', orCopy: true }],
      ['Whenever you cast a spell from anywhere other than your hand, draw a card.', { type: 'cast', notFrom: 'hand' }],
      ['Whenever one or more creatures you control deal combat damage to a player, draw a card.', { type: 'combat_damage_batch' }],
      ['At the beginning of your second main phase, draw a card.', { type: 'phase', step: 'main2', whose: 'you' }],
      ['At end of combat, draw a card.', { type: 'phase', step: 'end_of_combat' }],
      ['Whenever one or more cards leave your graveyard, draw a card.', { type: 'leave_graveyard' }],
      ['Whenever this creature becomes untapped, draw a card.', { type: 'becomes_tapped', untapped: true }],
      ['Whenever this creature deals damage to an opponent, that player discards a card.', { type: 'deals_damage', to: 'opponent' }],
      ['Whenever you cycle or discard a card, draw a card.', { type: 'discard', who: 'you' }],
      ['Whenever you discard one or more cards, draw a card.', { type: 'discard', batch: true }],
      ['Whenever this creature and at least two other creatures attack, draw a card.', { type: 'attacks', withOthers: 2 }],
      ['Whenever you scry or surveil, draw a card.', { type: 'scry', kinds: ['scry', 'surveil'] }],
      ['Whenever one or more +1/+1 counters are put on this creature, draw a card.', { type: 'counters_put', counter: '+1/+1' }],
      ['Whenever a creature attacks you or a planeswalker you control, draw a card.', { type: 'attacks', defender: 'you' }],
      ['Whenever an opponent draws a card, you gain 1 life.', { type: 'draw', who: 'opponent' }],
      ['Whenever you sacrifice a Clue, draw a card.', { type: 'sacrificed', filter: { subtypes: ['Clue'] } }],
      ['Whenever you sacrifice another permanent, draw a card.', { type: 'sacrificed', other: true }],
    ];
    for (const [text, trigger] of cases) {
      const r = parse(text, 'Creature — Human', 'Trig');
      expect(r.unparsed, text).toEqual([]);
      expect(r.abilities[0], text).toMatchObject({ kind: 'triggered', trigger });
    }
  });
});

describe('trigger batch 2 (slice 40)', () => {
  it('reads the trigger conditions', () => {
    const cases: [string, string, Record<string, unknown>][] = [
      ['Whenever a creature you control becomes blocked, draw a card.', 'Enchantment', { type: 'becomes_blocked', subject: { ref: 'all' } }],
      ['Whenever one or more tokens you control enter, draw a card.', 'Enchantment', { type: 'enters', batch: true }],
      ['Whenever you cast a kicked spell, draw a card.', 'Enchantment', { type: 'cast', kicked: true }],
      ['When enchanted land dies, draw a card.', 'Enchantment — Aura', { type: 'dies', subject: { ref: 'attached' } }],
      ['Whenever enchanted creature attacks or blocks, draw a card.', 'Enchantment — Aura', { type: 'either' }],
      ['Whenever this creature deals combat damage to a player or planeswalker, draw a card.', 'Creature — Human', { type: 'deals_combat_damage', to: 'player_or_planeswalker' }],
      ['Whenever this creature attacks alone, draw a card.', 'Creature — Human', { type: 'attacks', alone: true }],
      ['Whenever a creature attacks you, draw a card.', 'Enchantment', { type: 'attacks', defender: 'you_only' }],
      ["At the beginning of combat on each opponent's turn, draw a card.", 'Enchantment', { type: 'phase', step: 'beginning_of_combat', whose: 'opponent' }],
      ['Whenever this creature deals damage to a creature, draw a card.', 'Creature — Human', { type: 'deals_damage', to: 'creature' }],
      ['Whenever you gain life for the first time each turn, draw a card.', 'Enchantment', { type: 'gain_life', first: true }],
      ['When this creature becomes monstrous, draw a card.', 'Creature — Human', { type: 'becomes_monstrous' }],
      ['When this creature exploits a creature, draw a card.', 'Creature — Human', { type: 'sacrificed', exploit: true }],
      ['Whenever you cast a spell that targets a creature you control, draw a card.', 'Enchantment', { type: 'cast', targets: { types: ['Creature'], controller: 'you' } }],
      ['Whenever a nontoken creature is put into your graveyard from the battlefield, draw a card.', 'Enchantment', { type: 'dies', subject: { filter: { owner: 'you' } } }],
      ['Whenever a creature deals combat damage to one of your opponents, draw a card.', 'Enchantment', { type: 'deals_combat_damage', to: 'opponent' }],
    ];
    for (const [text, type, trigger] of cases) {
      const r = parse(text, type, 'Trig');
      expect(r.unparsed, text).toEqual([]);
      expect(r.abilities.find((a) => a.kind === 'triggered'), text).toMatchObject({ kind: 'triggered', trigger });
    }
  });
});

describe('restricted mana, multi-blocking, the Ring, dungeons (slices 41–44)', () => {
  it('reads them', () => {
    const mana = parse('{T}: Add {C}{C}. Spend this mana only to cast artifact spells or activate abilities of artifacts.', 'Land', 'Shop');
    expect(mana.abilities[0]).toMatchObject({ effects: [{ type: 'add_mana', spend: { spells: { types: ['Artifact'] }, abilities: { types: ['Artifact'] } } }] });
    const ritual = parse('Add {R}{R}{R}. Spend this mana only to cast instant or sorcery spells.', 'Instant', 'Rite');
    expect(ritual.abilities[0]).toMatchObject({ effects: [{ type: 'add_mana', spend: { spells: { types: ['Instant', 'Sorcery'] } } }] });
    expect(parse('{T}: Add two mana in any combination of colors.', 'Artifact', 'Prism').abilities[0]).toMatchObject({ effects: [{ type: 'add_mana' }] });
    expect(parse('This creature can block an additional creature each combat.', 'Creature — Wall', 'Wall').abilities[0]).toMatchObject({ effect: { combat: { extraBlocks: 1 } } });
    expect(parse('Draw a card. The Ring tempts you.', 'Sorcery', 'Birthday Escape').abilities[0]).toMatchObject({ effects: [{ type: 'draw' }, { type: 'ring_tempts' }] });
    expect(parse('When this creature enters, you take the initiative.', 'Creature — Human', 'Init').abilities[0]).toMatchObject({ effects: [{ type: 'take_initiative' }] });
    const dungeon = parse('Cave Entrance — Scry 1. (Leads to: Goblin Lair, Mine Tunnels)\nGoblin Lair — Create a 1/1 red Goblin creature token.', 'Dungeon', 'Lost Mine');
    expect(dungeon.unparsed).toEqual([]);
    expect(dungeon.abilities[0]).toMatchObject({ kind: 'triggered', trigger: { type: 'room', room: 'Cave Entrance', leadsTo: ['Goblin Lair', 'Mine Tunnels'] }, effects: [{ type: 'scry' }] });
  });
});

describe('ability words, reveal until, spree (slices 45–47)', () => {
  it('reads them', () => {
    const lines: [string, string][] = [
      ['Delirium — This creature gets +2/+2 as long as there are four or more card types among cards in your graveyard.', 'Creature — Horror'],
      ['Target creature gets +1/+1 until end of turn for each basic land type among lands you control.', 'Instant'],
      ['Coven — At the beginning of combat on your turn, if you control three or more creatures with different powers, draw a card.', 'Creature — Human'],
      ['Revolt — When this creature enters, if a permanent you controlled left the battlefield this turn, draw a card.', 'Creature — Human'],
      ['Reveal cards from the top of your library until you reveal a creature card. Put that card into your hand and the rest on the bottom of your library in a random order.', 'Sorcery'],
      ["Counter target spell. If that spell would be put into its owner's graveyard, exile it instead.", 'Instant'],
      ['Firebending 2', 'Creature — Human'],
      ['Spree\n+ {1} — Draw a card.\n+ {2} — You gain 3 life.', 'Sorcery'],
    ];
    for (const [text, type] of lines) {
      const r = parse(text, type, 'Word');
      expect(r.unparsed, text).toEqual([]);
      expect(r.manualKeywords, text).toEqual([]);
    }
    const spree = parse('Spree\n+ {1} — Draw a card.\n+ {2} — You gain 3 life.', 'Sorcery', 'Spree Card');
    expect(spree.abilities[0]).toMatchObject({ modes: { min: 1, max: 2, options: [{ cost: '{1}' }, { cost: '{2}' }] } });
  });
});

describe('gift, crimes, expend, increment (slices 48–49)', () => {
  it('reads them', () => {
    const gift = parse('Gift a card\nDestroy target creature. If the gift was promised, you gain 3 life.', 'Sorcery', 'Gifted');
    expect(gift.unparsed).toEqual([]);
    expect(gift.abilities.map((a) => (a.kind === 'static' ? a.effect.type : a.kind))).toEqual(['cast_option', 'gift_spell', 'spell']);
    const rabbit = parse('Gift a Food\nWhen this creature enters, if the gift wasn\'t promised, draw a card.', 'Creature — Rabbit', 'Rabbit');
    expect(rabbit.abilities[1]).toMatchObject({ kind: 'triggered', condition: { type: 'paid', cost: 'gift' }, effects: [{ type: 'give_gift' }] });
    for (const [text, trigger] of [
      ['Whenever you commit a crime, draw a card.', { type: 'crime' }],
      ['Whenever you expend 4, draw a card.', { type: 'expend', n: 4 }],
      ['Whenever a creature dealt damage by this creature this turn dies, draw a card.', { type: 'dies', subject: { filter: { damagedBySource: true } } }],
    ] as const) {
      expect(parse(text, 'Creature — Human', 'Rogue').abilities[0], text).toMatchObject({ trigger });
    }
    expect(parse('Increment', 'Creature — Human', 'Rogue').manualKeywords).toEqual([]);
  });
});

describe('copies, extra combats, phasing (slices 50–52)', () => {
  it('reads them', () => {
    const copy = parse('{2}: This artifact becomes a copy of target creature until end of turn.', 'Artifact', 'Mirror');
    expect(copy.abilities[0]).toMatchObject({ effects: [{ type: 'become_copy', what: { ref: 'self' }, until: 'eot' }] });
    const plasm = parse('At the beginning of your upkeep, you may have this creature become a copy of another target creature, except it has this ability.', 'Creature — Shapeshifter', 'Plasm');
    expect(plasm.unparsed).toEqual([]);
    expect(parse('After this main phase, there is an additional combat phase followed by an additional main phase.', 'Sorcery', 'Seize').abilities[0]).toMatchObject({ effects: [{ type: 'extra_combat', main: true }] });
    expect(parse('Target creature phases out.', 'Instant', 'Blink').abilities[0]).toMatchObject({ effects: [{ type: 'phase_out' }] });
    expect(parse('Phasing', 'Creature — Spirit', 'Phaser').manualKeywords).toEqual([]);
  });
});

describe('casting restrictions (slice 53)', () => {
  it('reads them', () => {
    const blade = parse("Cast this spell only during the declare attackers step and only if you've been attacked this step.\nDestroy target attacking creature.", 'Instant', 'Blade');
    expect(blade.abilities[0]).toMatchObject({ kind: 'static', effect: { type: 'cast_restriction', during: 'declare_attackers', attacked: true } });
    const response = parse('This spell costs {2} less to cast if it targets a tapped creature.\nDestroy target creature.', 'Instant', 'Response');
    expect(response.abilities[0]).toMatchObject({ effect: { type: 'cost_modifier', self: true, ifTargets: { types: ['Creature'] } } });
    expect(parse('You may cast this spell as though it had flash.', 'Creature — Elf', 'Elf').keywords).toEqual([{ id: 'flash' }]);
  });
});

describe('while tapped, optional untap (slice 54)', () => {
  it('reads them', () => {
    const r = parse('You may choose not to untap this creature during your untap step.\n{T}: Gain control of target creature for as long as this creature remains tapped.', 'Creature — Merfolk', 'Seasinger');
    expect(r.unparsed).toEqual([]);
    expect(r.abilities[0]).toMatchObject({ effect: { rules: ['may_not_untap'] } });
    expect(r.abilities[1]).toMatchObject({ effects: [{ type: 'gain_control', until: 'source_tapped' }] });
    const leech = parse("{T}: Tap target creature. It doesn't untap during its controller's untap step for as long as this creature remains tapped.", 'Creature — Leech', 'Leech');
    expect(leech.abilities[0]).toMatchObject({ effects: [{ type: 'tap' }, { type: 'lock_untap' }] });
  });
});

describe('Rooms, manifest dread, teamwork (slices 55–56)', () => {
  it('reads them', () => {
    const door = parse('When you unlock this door, manifest dread, then put three +1/+1 counters on that creature.', 'Enchantment — Room', 'Hall');
    expect(door.abilities[0]).toMatchObject({
      trigger: { type: 'unlock_door' },
      effects: [{ type: 'manifest', dread: true }, { type: 'add_counters', what: { ref: 'created' } }],
    });
    const eerie = parse('Eerie — Whenever this creature or another enchantment you control enters and whenever you fully unlock a Room, you gain 1 life.', 'Enchantment Creature — Spirit', 'Watcher');
    expect(eerie.abilities[0]).toMatchObject({ trigger: { type: 'either', of: [{}, { type: 'fully_unlocked' }] } });
    const mana = parse('{T}: Add {U}. Spend this mana only to cast an enchantment spell, unlock a door, or turn a permanent face up.', 'Artifact', 'Key');
    expect(JSON.stringify(mana.abilities[0])).toContain('"special":["unlock","face_up"]');
    const plan = parse('Teamwork 4 (As an additional cost to cast this spell, you may tap any number of creatures you control with total power 4 or more.)\nChoose one. If this spell was cast using teamwork, choose both instead.\n• You gain 3 life.\n• Draw a card.', 'Sorcery', 'Plan');
    expect(plan.unparsed).toEqual([]);
    expect(plan.manualKeywords).toEqual([]);
    expect(parse('One or two target creatures each get +2/+1 until end of turn.', 'Instant', 'Pump').abilities[0]).toMatchObject({ targets: [{ count: 2, upTo: true, min: 1 }] });
    expect(parse('Draw two cards. Then discard a card unless this spell was kicked.', 'Instant', 'Loot').abilities[0]).toMatchObject({ effects: [{ type: 'draw' }, { type: 'if', effects: [], else: [{ type: 'discard' }] }] });
  });
});

describe('keywords from CR definitions, read ahead, dredge, blocking requirements (slices 57–60)', () => {
  it('reads them', () => {
    for (const [text, type] of [['Rampage 2', 'Creature — Beast'], ['Afflict 2', 'Creature — Zombie'], ['Ingest', 'Creature — Eldrazi'], ['Ravenous', 'Creature — Dinosaur'], ['Recover {1}{U}', 'Creature — Bird'], ['Provoke', 'Creature — Beast'], ['Dredge 3', 'Creature — Zombie']] as const) {
      const r = parse(text, type, 'Card');
      expect([text, r.manualKeywords, r.unparsed]).toEqual([text, [], []]);
    }
    expect(parse('Prowl {1}{B}\nDraw a card.', 'Kindred Sorcery — Rogue', 'Card').keywords[0]).toMatchObject({ abilities: [{ effect: { type: 'cast_option', id: 'prowl', condition: { type: 'combat_damage_by', sharesType: true } } }] });
    expect(parse('This creature blocks each combat if able.', 'Creature — Ogre', 'Ogre').abilities[0]).toMatchObject({ effect: { rules: ['blocks_each_combat'] } });
    expect(parse('{G}: Target creature blocks this creature this turn if able.', 'Creature — Beast', 'Beast').abilities[0]).toMatchObject({ effects: [{ type: 'must_block', attacker: { ref: 'self' } }] });
    expect(parse('Whenever this creature attacks, tap target creature defending player controls.', 'Creature — Bear', 'Bear').abilities[0]).toMatchObject({ targets: [{ filter: { controller: 'defending' } }] });
    expect(parse('Each opponent exiles the top card of their library.', 'Sorcery', 'Ingest').abilities[0]).toMatchObject({ effects: [{ type: 'exile_top', who: { ref: 'players', who: 'opponents' } }] });
  });
});

describe('conspire, reconfigure, harmonize, prototype, escalate (slices 61–62)', () => {
  it('reads them', () => {
    for (const [text, type] of [['Conspire', 'Instant'], ['Reconfigure {2}', 'Artifact Creature — Equipment Lizard'], ['Harmonize {4}{G}', 'Sorcery'], ['Escalate {1}', 'Sorcery']] as const) {
      const r = parse(text, type, 'Card');
      expect([text, r.manualKeywords, r.unparsed]).toEqual([text, [], []]);
    }
    expect(parse('Prototype {1}{R} — 2/2', 'Artifact Creature — Golem', 'Golem').abilities[0]).toMatchObject({ effect: { type: 'cast_option', id: 'prototype', cost: { mana: '{1}{R}' }, prototype: { power: '2', toughness: '2' } } });
    expect(parse('{T}, Tap an untapped creature you control: Add one mana of any color.', 'Artifact', 'Relic').abilities[0]).toMatchObject({ mana: true, cost: { tap: true, other: [{ type: 'tap_creatures', amount: 1 }] } });
    expect(parse('This creature gets +2/+2 for each Aura attached to it.', 'Creature — Spirit', 'Spirit').abilities[0]).toMatchObject({ effect: { power: { kind: 'count', filter: { attachedTo: 'self' } } } });
    expect(parse('This land enters tapped with two charge counters on it.', 'Land', 'Vault').abilities[0]).toMatchObject({ effect: { type: 'enters_with_counters', counter: 'charge', amount: 2, tapped: true } });
  });
});

describe('mayhem, power-up, removal from combat, single graveyard, Circles of Protection (slice 63)', () => {
  it('reads them', () => {
    expect(parse('Mayhem {1}{R}', 'Creature — Goblin', 'Goblin').keywords[0]).toMatchObject({ abilities: [{ effect: { type: 'cast_option', id: 'mayhem', zone: 'graveyard', condition: { type: 'discarded_this_turn' } } }] });
    expect(parse('Power-up — {4}{W}: Put two +1/+1 counters on this creature.', 'Creature — Human', 'Human').abilities[0]).toMatchObject({ kind: 'activated', oncePerGame: true, powerUp: true });
    expect(parse("You may have this creature assign its combat damage as though it weren't blocked.", 'Creature — Elemental', 'Thorn').abilities[0]).toMatchObject({ effect: { rules: ['assign_as_unblocked'] } });
    expect(parse('Remove target attacking creature from combat.', 'Instant', 'Fog').abilities[0]).toMatchObject({ effects: [{ type: 'remove_from_combat' }] });
    expect(parse('Exile up to two target cards from a single graveyard.', 'Sorcery', 'Scrub').abilities[0]).toMatchObject({ targets: [{ count: 2, upTo: true, sameOwner: true, filter: { zone: 'graveyard' } }] });
    expect(parse('{1}: The next time a red source of your choice would deal damage to you this turn, prevent that damage.', 'Enchantment', 'Circle').abilities[0]).toMatchObject({ effects: [{ type: 'prevent_chosen_source', filter: { colors: ['R'] } }] });
  });
});

describe('layers 4–6 (slice 64)', () => {
  it('reads them', () => {
    const frog = parse('Enchant creature\nEnchanted creature loses all abilities and is a blue Frog creature with base power and toughness 1/1.', 'Enchantment — Aura', 'Frog Curse');
    expect(frog.abilities[0]).toMatchObject({ effect: { type: 'continuous', affected: { ref: 'attached' }, loseAbilities: true, setTypes: { types: ['Creature'], subtypes: ['Frog'] }, colors: ['U'], setPower: 1, setToughness: 1, setLayer: '7b' } });
    expect(parse('Enchant land\nEnchanted land is an Island.', 'Enchantment — Aura', 'Flood').abilities[0]).toMatchObject({ effect: { landTypes: ['Island'] } });
    expect(parse('{1}: This creature becomes the creature type of your choice until end of turn.', 'Creature — Shapeshifter', 'Shifter').abilities[0]).toMatchObject({
      effects: [{ type: 'choose_value', choice: 'creature_type', scope: 'resolution' }, { type: 'modify', creatureTypes: ['chosen'], until: 'eot' }],
    });
    expect(parse('Target creature becomes black and gains fear until end of turn.', 'Instant', 'Fear').abilities[0]).toMatchObject({ effects: [{ colors: ['B'], until: 'eot' }, { keywords: [{ id: 'fear' }], until: 'eot' }] });
    expect(parse('Until end of turn, target creature loses all abilities and has base power and toughness 0/1.', 'Instant', 'Hush').abilities[0]).toMatchObject({ effects: [{ type: 'modify', loseAbilities: true, setPower: 0, setToughness: 1, until: 'eot' }] });
  });
});

describe('mana abilities, craft, storage lands (slices 65–67)', () => {
  it('reads them', () => {
    expect(parse('{T}: Add {G} for each Elf you control.', 'Creature — Elf', 'Archdruid').abilities[0]).toMatchObject({ mana: true, effects: [{ type: 'add_mana', options: [['G']], times: { kind: 'count' } }] });
    expect(parse('{1}: Add two mana of any one color. Activate only once each turn.', 'Artifact', 'Prism').abilities[0]).toMatchObject({ mana: true, oncePerTurn: true });
    expect(parse('{T}, Remove a depletion counter from this land: Add {U}{U}. If there are no depletion counters on this land, sacrifice it.', 'Land', 'Depleted').unparsed).toEqual([]);
    expect(parse('{1}, Remove any number of storage counters from this land: Add {B} for each storage counter removed this way.', 'Land', 'Vault').abilities[0]).toMatchObject({
      mana: true, cost: { other: [{ type: 'remove_counters_self', counter: 'storage', amount: 'X' }] }, effects: [{ times: { kind: 'x' } }],
    });
    expect(parse('Craft with artifact {3}{W}', 'Artifact', 'Idol').keywords[0]).toMatchObject({ abilities: [{ kind: 'activated', timing: 'sorcery', cost: { mana: '{3}{W}', other: [{ type: 'craft', filter: { types: ['Artifact'] } }] } }] });
    expect(parse('When this creature enters, untap up to seven lands.', 'Creature — Whale', 'Whale').abilities[0]).toMatchObject({ effects: [{ type: 'untap_chosen', amount: 7 }] });
    expect(parse("{1}{R}: Target creature can't block this creature this turn.", 'Creature — Goblin', 'Goblin').abilities[0]).toMatchObject({ effects: [{ type: 'cant_block_attacker', attacker: { ref: 'self' } }] });
  });
});

describe('repeatable modes, unpreventable damage, "target player controls", X costs, collect evidence (slice 68)', () => {
  it('reads them', () => {
    const conf = parse('Choose three. You may choose the same mode more than once.\n• You gain 2 life.\n• Draw a card.', 'Instant', 'Confluence');
    expect(conf.abilities[0]).toMatchObject({ modes: { min: 3, max: 3, repeat: true } });
    expect(parse("Damage can't be prevented this turn. Stomp deals 2 damage to any target.", 'Instant', 'Stomp').abilities[0]).toMatchObject({ effects: [{ type: 'damage_unpreventable' }, { type: 'deal_damage' }] });
    expect(parse('Destroy all creatures target opponent controls.', 'Sorcery', 'Wipe').abilities[0]).toMatchObject({ targets: [{ what: 'player', player: 'opponent' }], effects: [{ type: 'destroy', what: { ref: 'all', filter: { controlledBy: { ref: 'target', index: 0 } } } }] });
    expect(parse('As an additional cost to cast this spell, pay X life.', 'Sorcery', 'Agony').abilities[0]).toMatchObject({ effect: { type: 'additional_cost', cost: { type: 'pay_life', amount: 'X' } } });
    expect(parse('As an additional cost to cast this spell, you may collect evidence 6.', 'Instant', 'Study').abilities[0]).toMatchObject({ effect: { type: 'cast_option', id: 'collect_evidence', cost: { other: [{ type: 'collect_evidence', amount: 6 }] } } });
  });
});

describe('dice, splice, votes, counted clauses (slices 69–78)', () => {
  it('reads them', () => {
    const d20 = parse('Roll a d20.\n1—9 | You gain 1 life.\n10—20 | Draw a card.', 'Sorcery', 'Gamble');
    expect(d20.unparsed).toEqual([]);
    expect(d20.abilities[0]).toMatchObject({ effects: [{ type: 'roll_die', sides: 20, table: [{ min: 1, max: 9 }, { min: 10, max: 20 }] }] });
    expect(parse('Roll two d20 and ignore the lower roll.\n1—20 | Draw a card.', 'Sorcery', 'Twice').abilities[0]).toMatchObject({ effects: [{ type: 'roll_die', count: 2, ignoreLower: true }] });
    expect(parse('Whenever you roll one or more dice, you gain 1 life.', 'Creature — Dwarf', 'Fan').abilities[0]).toMatchObject({ trigger: { type: 'die_rolled', who: 'you' } });
    expect(parse('Splice onto Arcane {1}{R}', 'Instant — Arcane', 'Glacial').keywords[0]).toMatchObject({ id: 'splice', cost: '{1}{R}' });
    const bite = parse('Will of the council — Starting with you, each player votes for sickness or psychosis. If sickness gets more votes, you gain 2 life. If psychosis gets more votes or the vote is tied, each opponent discards two cards.', 'Sorcery', 'Bite');
    expect(bite.abilities[0]).toMatchObject({
      effects: [{ type: 'vote', options: ['sickness', 'psychosis'] }, { type: 'if', cond: { type: 'votes', option: 'sickness' } }, { type: 'if', cond: { type: 'votes', option: 'psychosis', orTied: true } }],
    });
    const dilemma = parse('Starting with you, each player votes for death or taxes. Each opponent sacrifices a creature of their choice for each death vote and discards a card for each taxes vote.', 'Sorcery', 'Capital');
    expect(dilemma.abilities[0]).toMatchObject({ effects: [{ type: 'vote' }, { amount: { kind: 'votes', option: 'death' } }, { amount: { kind: 'votes', option: 'taxes' } }] });
    expect(parse("Starting with you, each player votes for a nonland permanent you don't control. Exile each permanent with the most votes or tied for most votes.", 'Sorcery', 'Judgment').abilities[0]).toMatchObject({
      effects: [{ type: 'vote', among: { controller: 'not_you' } }, { type: 'move', what: { ref: 'voted' }, to: 'exile' }],
    });
    expect(parse('Each player secretly votes for truth or consequences, then those votes are revealed. You draw cards equal to the number of truth votes.', 'Sorcery', 'Truth').abilities[0]).toMatchObject({ effects: [{ type: 'vote', secret: true }, { type: 'draw' }] });
    expect(parse('Starting with you, each player votes for time or money. For each time vote, take an extra turn after this one.', 'Sorcery', 'Time').abilities[0]).toMatchObject({ effects: [{ type: 'vote' }, { type: 'repeat', times: { kind: 'votes', option: 'time' } }] });
    expect(parse('While voting, you may vote an additional time.', 'Creature — Human', 'Broker').abilities[0]).toMatchObject({ effect: { type: 'player_rule', rule: 'may_extra_vote' } });
    expect(parse('You gain life equal to the number of creatures in your party.', 'Sorcery', 'Party').abilities[0]).toMatchObject({ effects: [{ amount: { kind: 'party' } }] });
    expect(parse('When this creature enters, destroy all creatures other than this creature.', 'Creature — Angel', 'Angel').abilities[0]).toMatchObject({ effects: [{ type: 'destroy', what: { filter: { other: true } } }] });
    expect(parse('Each player returns all creature cards from their graveyard to the battlefield.', 'Sorcery', 'Rise').abilities[0]).toMatchObject({ effects: [{ type: 'move', what: { ref: 'all', filter: { zone: 'graveyard' } }, to: 'battlefield' }] });
  });
});

describe("can't cast, \"that player\" after an opponent's creature dies (slices 79–83)", () => {
  it('reads them', () => {
    expect(parse("Your opponents can't cast spells during your turn.", 'Enchantment', 'Silence').abilities[0]).toMatchObject({ effect: { type: 'cast_prohibition', who: 'opponents', during: 'your_turn' } });
    expect(parse("Each player can't cast more than one noncreature spell each turn.", 'Enchantment', 'Rule').abilities[0]).toMatchObject({ effect: { type: 'cast_prohibition', who: 'each', maxPerTurn: 1, filter: { notTypes: ['Creature'] } } });
    expect(parse("Players can't cast spells from graveyards or libraries.", 'Enchantment', 'Ban').abilities[0]).toMatchObject({ effect: { type: 'cast_prohibition', fromZones: ['graveyard', 'library'] } });
    expect(parse("Target player can't cast spells this turn.", 'Instant', 'Hush').abilities[0]).toMatchObject({ effects: [{ type: 'prohibit_casting', who: { ref: 'target', index: 0 }, until: 'eot' }] });
    expect(parse("Until your next turn, your opponents can't cast noncreature spells.", 'Sorcery', 'Wait').abilities[0]).toMatchObject({ effects: [{ type: 'prohibit_casting', who: { ref: 'players', who: 'opponents' }, until: 'your_next_turn', filter: { notTypes: ['Creature'] } }] });
    expect(parse('Whenever a creature an opponent controls dies, that player loses 2 life.', 'Creature — Wurm', 'Wurm').abilities[0]).toMatchObject({ effects: [{ type: 'lose_life', who: { ref: 'trigger_player' } }] });
    expect(parse('Target player loses 1 life for each tapped artifact they control.', 'Sorcery', 'Greed').abilities[0]).toMatchObject({ effects: [{ amount: { kind: 'count', filter: { controlledBy: { ref: 'target', index: 0 }, tapped: true } } }] });
  });
});

describe('alternative costs, trap conditions, distributing counters, activation locks (slices 84–88)', () => {
  it('reads them', () => {
    expect(parse("You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.", 'Instant', 'Force').abilities[0]).toMatchObject({
      effect: { type: 'cast_option', kind: 'alternative', cost: { other: [{ type: 'pay_life', amount: 1 }, { type: 'exile_cards', from: 'hand', filter: { colors: ['U'] } }] } },
    });
    expect(parse("You may return an Island you control to its owner's hand rather than pay this spell's mana cost.", 'Instant', 'Daze').abilities[0]).toMatchObject({ effect: { cost: { other: [{ type: 'return_permanents', amount: 1, filter: { subtypes: ['Island'] } }] } } });
    expect(parse("If three or more creatures are attacking, you may pay {U} rather than pay this spell's mana cost.", 'Instant', 'Trap').abilities[0]).toMatchObject({
      effect: { condition: { type: 'count', who: 'all', min: 3, filter: { combat: 'attacking' } }, cost: { mana: '{U}' } },
    });
    expect(parse("If an opponent cast three or more spells this turn, you may pay {0} rather than pay this spell's mana cost.", 'Instant', 'Mind').abilities[0]).toMatchObject({ effect: { condition: { type: 'this_turn', event: 'opponent_cast', min: 3 } } });
    expect(parse('Distribute two -1/-1 counters among one or two target creatures.', 'Instant', 'Agony').abilities[0]).toMatchObject({ targets: [{ count: 2, upTo: true, min: 1 }], effects: [{ type: 'add_counters', counter: '-1/-1', amount: 2, divided: true }] });
    expect(parse("Activated abilities of artifacts can't be activated.", 'Enchantment', 'Silence').abilities[0]).toMatchObject({ effect: { affected: { ref: 'all', filter: { types: ['Artifact'] } }, rules: ['cant_activate'] } });
    expect(parse("Enchant permanent\nEnchanted permanent can't attack or block, and its activated abilities can't be activated unless they're mana abilities.", 'Enchantment — Aura', 'Fetters').abilities[0]).toMatchObject({
      effect: { affected: { ref: 'attached' }, rules: ['cant_attack', 'cant_block', 'cant_activate_nonmana'] },
    });
  });
});

describe('card names, targets for each opponent (slices 89–92)', () => {
  it('reads them', () => {
    const needle = parse("As this artifact enters, choose a card name.\nActivated abilities of sources with the chosen name can't be activated unless they're mana abilities.", 'Artifact', 'Needle');
    expect(needle.abilities[0]).toMatchObject({ effect: { type: 'as_enters', choice: 'card_name' } });
    expect(needle.abilities[1]).toMatchObject({ effect: { affected: { ref: 'all', filter: { chosenName: true } }, rules: ['cant_activate_nonmana'] } });
    const mage = parse("As this creature enters, choose a nonland card name.\nSpells with the chosen name can't be cast.", 'Creature — Human Wizard', 'Mage');
    expect(mage.abilities[0]).toMatchObject({ effect: { choice: 'card_name', filter: { notTypes: ['Land'] } } });
    expect(mage.abilities[1]).toMatchObject({ effect: { type: 'cast_prohibition', who: 'each', filter: { chosenName: true } } });
    expect(parse('For each opponent, exile up to one target creature that player controls.', 'Sorcery', 'Scatter').abilities[0]).toMatchObject({
      targets: [{ perPlayer: 'opponents', upTo: true, filter: { types: ['Creature'] } }],
      effects: [{ type: 'move', what: { ref: 'target', index: 0 }, to: 'exile' }],
    });
    expect(parse("When this creature enters, for each opponent, you may put up to one target creature card from that player's graveyard onto the battlefield under your control.", 'Creature — Avatar', 'Primordial').abilities[0]).toMatchObject({
      targets: [{ perPlayer: 'opponents', filter: { zone: 'graveyard' } }],
    });
  });
});

describe('staples (slices 93–96)', () => {
  it('reads them', () => {
    expect(parse('Search your library for an instant or sorcery card, reveal it, then shuffle and put that card on top.', 'Instant', 'Mystical').abilities[0]).toMatchObject({ effects: [{ type: 'search', to: 'library' }] });
    expect(parse('Draw three cards, then put two cards from your hand on top of your library in any order.', 'Instant', 'Storm').abilities[0]).toMatchObject({ effects: [{ type: 'draw', amount: 3 }, { type: 'choose_from_hand', amount: 2, then: 'library_top' }] });
    expect(parse('Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.', 'Sorcery', 'Cultivate').abilities[0]).toMatchObject({
      effects: [{ type: 'search', amount: 2, upTo: true, to: 'hand', split: { to: 'battlefield', tapped: true } }],
    });
    expect(parse('{T}: Add one mana of any color that a land an opponent controls could produce.', 'Land', 'Orchard').abilities[0]).toMatchObject({ effects: [{ type: 'add_mana', anyColor: 1, couldProduce: 'opponents' }] });
    expect(parse('Each land is a Swamp in addition to its other land types.', 'Legendary Land', 'Urborg').abilities[0]).toMatchObject({ effect: { affected: { ref: 'all', filter: { types: ['Land'] } }, addTypes: { subtypes: ['Swamp'] } } });
    expect(parse('Whenever one or more other creatures die, draw a card.', 'Creature — Human', 'Opportunist').abilities[0]).toMatchObject({ trigger: { type: 'dies', batch: true, subject: { filter: { other: true } } } });
    expect(parse("Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token.", 'Enchantment', 'Tithe').abilities[0]).toMatchObject({
      effects: [{ type: 'unless_pays', payer: { ref: 'trigger_player' }, cost: '{2}' }],
    });
  });
});

describe('costs to attack (slice 97)', () => {
  it('reads them', () => {
    expect(parse("Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.", 'Enchantment', 'Prison').abilities[0]).toMatchObject({ effect: { type: 'attack_tax', cost: '{2}' } });
    expect(parse('Draw cards equal to the greatest power among creatures you control.', 'Sorcery', 'Expertise').abilities[0]).toMatchObject({ effects: [{ type: 'draw', amount: { kind: 'greatest', stat: 'power', filter: { types: ['Creature'], controller: 'you' } } }] });
    expect(parse('You may choose new targets for target spell or ability.', 'Instant', 'Swat').abilities[0]).toMatchObject({ targets: [{ what: 'ability' }], effects: [{ type: 'may', effects: [{ type: 'retarget', what: { ref: 'target', index: 0 } }] }] });
    expect(parse("Nonblack creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.", 'Enchantment', 'Tax').abilities[0]).toMatchObject({
      effect: { type: 'attack_tax', cost: '{1}', planeswalkers: true, filter: { notColors: ['B'] } },
    });
  });
});

describe('staples (slices 100–108)', () => {
  it('reads them', () => {
    expect(parse("During your turn, your opponents can't cast spells or activate abilities of artifacts, creatures, or enchantments.", 'Creature — Human Cleric', 'Abolisher').abilities[0]).toMatchObject({
      effect: { type: 'cast_prohibition', who: 'opponents', activate: { filter: { types: ['Creature', 'Artifact', 'Enchantment'] } }, condition: { type: 'your_turn' } },
    });
    expect(parse("Players can't activate abilities that aren't mana abilities.", 'Enchantment', 'Stifling').abilities[0]).toMatchObject({ effect: { type: 'cast_prohibition', who: 'each', activateOnly: true, activate: { nonMana: true } } });
    expect(parse("Look at the top five cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in a random order. If you didn't put a card into your hand this way, draw a card.", 'Sorcery', 'Seek').abilities[0]).toMatchObject({
      effects: [{ type: 'dig', amount: 5, ifNone: [{ type: 'draw', amount: 1 }] }],
    });
    expect(parse('{T}: Look at the top card of your library. You may put that card into your graveyard.', 'Artifact', 'Glass').abilities[0]).toMatchObject({ effects: [{ type: 'dig', amount: 1, to: 'graveyard', rest: 'top', optional: true }] });
    expect(parse('Draw up to three cards.', 'Sorcery', 'Up').abilities[0]).toMatchObject({ effects: [{ type: 'draw', amount: 3, upTo: true }] });
    expect(parse("Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is this creature's power.", 'Artifact Creature — Human Soldier', 'Sentinel').abilities[0]).toMatchObject({
      trigger: { type: 'cast', who: 'opponent', nth: 1, nthOfKind: true, filter: { notTypes: ['Creature'] } },
      effects: [{ type: 'unless_pays', costX: { kind: 'stat', stat: 'power' } }],
    });
    expect(parse('{T}: Draw a card. Activate only if you created a token this turn.', 'Artifact', 'Idol').abilities[0]).toMatchObject({ activateIf: { type: 'this_turn', event: 'you_created_token' } });
    expect(parse('Artifacts and creatures your opponents control enter tapped.', 'Enchantment', 'Obedience').abilities[0]).toMatchObject({ effect: { type: 'enter_tapped_others', filter: { types: ['Artifact', 'Creature'], controller: 'opponent' } } });
    expect(parse('{T}: You and target opponent each draw a card.', 'Artifact', 'Loran').abilities[0]).toMatchObject({ effects: [{ type: 'draw', who: { ref: 'you' } }, { type: 'draw', who: { ref: 'target', index: 0 } }] });
    expect(parse('Add {R} for each tapped land your opponents control.', 'Instant', 'Geyser').abilities[0]).toMatchObject({ effects: [{ type: 'add_mana', options: [['R']], times: { kind: 'count' } }] });
    expect(parse("{T}: Add X mana of any one color, where X is this creature's power.", 'Creature — Spirit', 'Kami').abilities[0]).toMatchObject({ mana: true, effects: [{ type: 'add_mana', anyColor: 1, times: { kind: 'stat' } }] });
  });
});

describe('staples (slices 113–117)', () => {
  it('reads them', () => {
    expect(parse("Untap all permanents you control during each other player's untap step.", 'Creature — Spirit', 'Muse').abilities[0]).toMatchObject({ effect: { type: 'player_rule', rule: 'untap_during_others' } });
    expect(parse('Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way.', 'Sorcery', 'Windfall').abilities[0]).toMatchObject({
      effects: [{ type: 'discard', all: true }, { type: 'draw', amount: { kind: 'discarded_this_way', max: true } }],
    });
    expect(parse("The owner of target permanent shuffles it into their library, then reveals the top card of their library. If it's a permanent card, they put it onto the battlefield.", 'Instant', 'Warp').abilities[0]).toMatchObject({
      effects: [{ type: 'move', position: 'shuffle' }, { type: 'dig', to: 'battlefield', who: { ref: 'owner_of' } }],
    });
    expect(parse("Until your next turn, your life total can't change and you gain protection from everything.", 'Instant', 'Protection').abilities[0]).toMatchObject({
      effects: [{ type: 'player_effect', rule: 'life_cant_change', until: 'your_next_turn' }, { type: 'player_effect', rule: 'protection_everything' }],
    });
    expect(parse("Creature spells you control can't be countered.", 'Enchantment', 'Rhythm').abilities[0]).toMatchObject({ effect: { type: 'uncounterable', filter: { types: ['Creature'] } } });
    expect(parse('Channel — {3}{U}, Discard this card: Return target creature to its owner\'s hand. This ability costs {1} less to activate for each legendary creature you control.', 'Legendary Land', 'Otawara').abilities[0]).toMatchObject({
      zone: 'hand', costReduction: { amount: 1, per: { kind: 'count', filter: { supertypes: ['Legendary'] } } },
    });
    expect(parse('Destroy target artifact an opponent controls. That player may search their library for a land card with a basic land type, put it onto the battlefield, then shuffle.', 'Instant', 'Boseiju').abilities[0]).toMatchObject({
      effects: [{ type: 'destroy' }, { type: 'may', who: { ref: 'controller_of', of: { ref: 'target', index: 0 } } }],
    });
    expect(parse('Create a Food token or a Treasure token.', 'Sorcery', 'Provisions').abilities[0]).toMatchObject({ effects: [{ type: 'choose_one', labels: ['Food', 'Treasure'] }] });
  });
});

describe('slices 120–122', () => {
  it('reads them', () => {
    expect(parse('Target creature loses flying until end of turn.', 'Instant', 'Ground').abilities[0]).toMatchObject({ effects: [{ type: 'modify', loseKeywords: ['flying'], until: 'eot' }] });
    expect(parse('Creatures your opponents control lose flying.', 'Enchantment', 'Clip').abilities[0]).toMatchObject({ effect: { type: 'continuous', loseKeywords: ['flying'] } });
    expect(parse('Target creature attacks this turn if able.', 'Instant', 'Taunt').abilities[0]).toMatchObject({ effects: [{ type: 'modify', rules: ['attacks_each_combat'], until: 'eot' }] });
    expect(parse("Counter target spell if it's blue.", 'Instant', 'Blast').abilities[0]).toMatchObject({ effects: [{ type: 'if', cond: { type: 'is', filter: { colors: ['U'] } }, effects: [{ type: 'counter' }] }] });
    expect(parse('{T}: Add one mana of any color among legendary creatures and planeswalkers you control.', 'Artifact', 'Amber').abilities[0]).toMatchObject({ mana: true, effects: [{ type: 'add_mana', anyColor: 1, colorsAmong: { supertypes: ['Legendary'] } }] });
    expect(parse('{T}: For each color among permanents you control, add one mana of that color.', 'Creature — Elf', 'Tender').abilities[0]).toMatchObject({ mana: true, effects: [{ type: 'add_mana', eachColor: true }] });
    expect(parse("Whenever you cast a spell, you gain 1 life for each spell you've cast this turn.", 'Artifact', 'Reservoir').abilities[0]).toMatchObject({ effects: [{ type: 'gain_life', amount: { kind: 'spells_cast_this_turn' } }] });
    expect(parse('Exile all graveyards.', 'Sorcery', 'Wake').abilities[0]).toMatchObject({ effects: [{ type: 'move', to: 'exile', what: { ref: 'all', filter: { zone: 'graveyard' } } }] });
  });
});

describe('slices 123–124', () => {
  it('reads them', () => {
    expect(parse('Whenever Goldspan becomes the target of a spell, you gain 2 life.', 'Creature — Dragon', 'Goldspan').abilities[0]).toMatchObject({ trigger: { type: 'becomes_target', targetedBy: 'spell' } });
    expect(parse("Whenever Giant becomes the target of a spell, Giant deals 2 damage to that spell's controller.", 'Creature — Giant', 'Giant').abilities[0]).toMatchObject({ trigger: { type: 'becomes_target', targetedBy: 'spell' }, effects: [{ type: 'deal_damage', to: { ref: 'controller_of' } }] });
    expect(parse('Whenever one or more other creatures you control enter, draw a card.', 'Creature — Vampire', 'Vampire').abilities[0]).toMatchObject({ trigger: { type: 'enters', batch: true, subject: { filter: { other: true, controller: 'you' } } } });
    expect(parse('At the beginning of your upkeep, if an opponent controls more lands than you, you gain 3 life.', 'Enchantment', 'Tax').abilities[0]).toMatchObject({ condition: { type: 'opponent_has_more', filter: { types: ['Land'] } } });
  });
});

describe('slice 125', () => {
  it('reads a choice of additional costs', () => {
    expect(parse('As an additional cost to cast this spell, sacrifice a creature or pay {3}{B}.', 'Sorcery', 'Eaten').abilities[0]).toMatchObject({
      effect: { type: 'additional_cost_choice', options: [{ other: [{ type: 'sacrifice', filter: { types: ['Creature'] } }] }, { mana: '{3}{B}' }] },
    });
    expect(parse('As an additional cost to cast this spell, sacrifice a creature, discard a card, or pay 4 life.', 'Instant', 'Mangle').abilities[0]).toMatchObject({
      effect: { type: 'additional_cost_choice', options: [{ other: [{ type: 'sacrifice' }] }, { other: [{ type: 'discard' }] }, { other: [{ type: 'pay_life', amount: 4 }] }] },
    });
    // "artifact or creature" stays one filter.
    expect(parse('As an additional cost to cast this spell, pay {1} or sacrifice an artifact or creature.', 'Instant', 'Glare').abilities[0]).toMatchObject({
      effect: { options: [{ mana: '{1}' }, { other: [{ type: 'sacrifice', filter: { types: ['Artifact', 'Creature'] } }] }] },
    });
    expect(parse('As an additional cost to cast this spell, behold a Dragon or pay {1}.', 'Instant', 'Exhale').abilities[0]).toMatchObject({
      effect: { options: [{ other: [{ type: 'behold', filter: { subtypes: ['Dragon'] } }] }, { mana: '{1}' }] },
    });
    expect(parse('As an additional cost to cast this spell, reveal a Pirate card from your hand or pay {1}.', 'Creature — Pirate', 'Buc').abilities[0]).toMatchObject({
      effect: { options: [{ other: [{ type: 'reveal_from_hand', filter: { subtypes: ['Pirate'] } }] }, { mana: '{1}' }] },
    });
  });
});

describe('slice 126', () => {
  it('reads blight and forage', () => {
    expect(parse('{T}, Blight 1: Surveil 1.', 'Creature — Goblin', 'Gob').abilities[0]).toMatchObject({ cost: { tap: true, other: [{ type: 'blight', amount: 1 }] } });
    expect(parse('As an additional cost to cast this spell, put a -1/-1 counter on a creature you control.', 'Instant', 'Sting').abilities[0]).toMatchObject({ effect: { type: 'additional_cost', cost: { type: 'blight', amount: 1 } } });
    expect(parse('Pay 1 life, Blight 2: Target opponent blights 2. Activate only as a sorcery.', 'Creature — Goblin', 'Gob').abilities[0]).toMatchObject({ effects: [{ type: 'blight', amount: 2, who: { ref: 'target' } }] });
    expect(parse('When this enchantment enters, you may blight 1. If you do, draw a card.', 'Enchantment', 'Rite').abilities[0]).toMatchObject({ effects: [{ type: 'may_do', effects: [{ type: 'blight', amount: 1 }] }] });
    expect(parse("When this creature enters, you may pay {2}. If you don't, blight 2.", 'Creature — Elf', 'Elf').abilities[0]).toMatchObject({ effects: [{ type: 'may_pay', cost: '{2}', effects: [], else: [{ type: 'blight', amount: 2 }] }] });
    expect(parse('{2}, Forage: Put a +1/+1 counter on each other Squirrel you control.', 'Creature — Squirrel', 'Sq').abilities[0]).toMatchObject({ cost: { mana: '{2}', other: [{ type: 'forage' }] } });
    expect(parse('When this creature enters, you may forage. If you do, draw a card.', 'Creature — Squirrel', 'Sq').abilities[0]).toMatchObject({ effects: [{ type: 'may_do', effects: [{ type: 'forage' }] }] });
    expect(parse('Whenever you forage, put a +1/+1 counter on this creature.', 'Creature — Squirrel', 'Sq').abilities[0]).toMatchObject({ trigger: { type: 'scry', kinds: ['forage'] } });
  });
});

describe('slice 127', () => {
  it('reads reflexive triggered abilities (CR 603.12)', () => {
    const land = parse('When this land enters, sacrifice it. When you do, search your library for a basic Forest card, put it onto the battlefield tapped, then shuffle.', 'Land', 'Tri').abilities[0];
    expect(land).toMatchObject({ effects: [{ type: 'may_do', mandatory: true, effects: [{ type: 'sacrifice' }], then: [{ type: 'reflexive', abilities: [{ kind: 'triggered', trigger: { type: 'reflexive' } }] }] }] });
    const fiend = parse('When this creature enters, you may sacrifice another creature. When you do, destroy target creature an opponent controls.', 'Creature — Demon', 'Fiend').abilities[0] as { targets?: unknown[] };
    expect(fiend.targets).toBeUndefined();
    expect(fiend).toMatchObject({ effects: [{ type: 'may_do', then: [{ type: 'reflexive', abilities: [{ targets: [{ filter: { controller: 'opponent' } }], effects: [{ type: 'destroy' }] }] }] }] });
    expect(parse('Whenever you attack, you may pay {1}{W}. When you do, target creature gains lifelink until end of turn.', 'Creature — Gargoyle', 'G').abilities[0]).toMatchObject({ effects: [{ type: 'may_pay', cost: '{1}{W}', effects: [{ type: 'reflexive' }] }] });
    // "that creature" after an action on some other object doesn't read (it isn't something the new ability sees).
    expect(parse("At the beginning of your end step, you may sacrifice another creature. When you do, Zia deals damage equal to that creature's power to any target.", 'Creature — Dragon', 'Zia').unparsed).toHaveLength(1);
  });
});

describe('slice 128', () => {
  it('reads the pacts, Mana Drain, Command Beacon, random discards, manifesting players', () => {
    expect(parse("Counter target spell. At the beginning of your next upkeep, pay {3}{U}{U}. If you don't, you lose the game.", 'Instant', 'Pact').abilities[0]).toMatchObject({
      effects: [{ type: 'counter' }, { type: 'delayed', step: 'upkeep', whose: 'you', effects: [{ type: 'may_pay', cost: '{3}{U}{U}', effects: [], else: [{ type: 'game_result' }] }] }],
    });
    expect(parse("Counter target spell. At the beginning of your next main phase, add an amount of {C} equal to that spell's mana value.", 'Instant', 'Drain').abilities[0]).toMatchObject({
      effects: [{ type: 'counter' }, { type: 'delayed', step: 'main', whose: 'you', effects: [{ type: 'add_mana', times: { kind: 'stat', stat: 'mana_value' } }] }],
    });
    expect(parse('{T}, Sacrifice this land: Put your commander into your hand from the command zone.', 'Land', 'Beacon').abilities[0]).toMatchObject({ effects: [{ type: 'move', to: 'hand', what: { filter: { commander: true, zone: 'command' } } }] });
    expect(parse('Target player discards two cards at random.', 'Sorcery', 'Rot').abilities[0]).toMatchObject({ effects: [{ type: 'discard', amount: 2, random: true }] });
    expect(parse('Exile target creature. Its controller manifests the top card of their library.', 'Instant', 'Shift').abilities[0]).toMatchObject({ effects: [{ type: 'move' }, { type: 'manifest', who: { ref: 'controller_of' } }] });
  });
});

describe('slice 129', () => {
  it('reads "enters untapped" and named modes', () => {
    expect(parse('When this land enters untapped, you gain 2 life.', 'Land', 'Sanctuary').abilities[0]).toMatchObject({ trigger: { type: 'enters', untapped: true } });
    const named = parse('Choose one —\n• Pray for Protection — Creatures you control gain indestructible until end of turn.\n• Strike a Deal — You and target opponent each draw two cards.', 'Instant', 'Temple');
    expect(named.unparsed).toEqual([]);
    expect(named.abilities[0]).toMatchObject({ modes: { options: [{ text: 'Pray for Protection — Creatures you control gain indestructible until end of turn.' }, { targets: [{ what: 'player' }] }] } });
  });
});

describe('slices 130–131', () => {
  it('grants keywords honestly and reads flashback grants', () => {
    // A granted keyword the engine can't apply leaves the line unread; one defined by its CR text carries its abilities.
    expect(parse('Creatures you control have banding.', 'Enchantment', 'B').unparsed).toHaveLength(1);
    expect(parse('Creatures you control have exalted.', 'Enchantment', 'E').abilities[0]).toMatchObject({ effect: { keywords: [{ id: 'exalted', abilities: [{ kind: 'triggered' }] }] } });
    expect(parse('Nontoken creatures you control have riot.', 'Enchantment', 'R').abilities[0]).toMatchObject({ effect: { affected: { filter: { token: false } }, keywords: [{ id: 'riot', abilities: [{ effect: { type: 'as_enters' } }] }] } });
    expect(parse('Creature spells of the chosen type cost {2} less to cast.', 'Artifact', 'I').abilities[0]).toMatchObject({ effect: { type: 'cost_modifier', filter: { chosenType: true }, amount: 2 } });
    expect(parse('Whenever a creature you control enters or attacks, draw a card.', 'Enchantment', 'K').abilities[0]).toMatchObject({ trigger: { type: 'either', of: [{ type: 'enters' }, { type: 'attacks' }] } });
    expect(parse('When this creature enters, target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost.', 'Creature — Human Wizard', 'Snap').abilities[0]).toMatchObject({
      effects: [{ type: 'modify', until: 'eot', keywords: [{ id: 'flashback', costIsManaCost: true }] }],
    });
    expect(parse("Each instant and sorcery card in your graveyard has flashback. The flashback cost is equal to that card's mana cost.", 'Creature — Human Wizard', 'Lier').abilities[0]).toMatchObject({
      effect: { type: 'continuous', affected: { filter: { zone: 'graveyard', types: ['Instant', 'Sorcery'] } }, keywords: [{ id: 'flashback', costIsManaCost: true }] },
    });
    expect(parse("Spells can't be countered.", 'Creature — Human Wizard', 'Lier').abilities[0]).toMatchObject({ effect: { type: 'uncounterable', anyone: true } });
  });
});

describe('slice 132', () => {
  it('reads mana that makes a spell uncounterable', () => {
    expect(parse("{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and that spell can't be countered.", 'Land', 'Cavern').abilities[0]).toMatchObject({
      mana: true, effects: [{ type: 'add_mana', spend: { spells: { types: ['Creature'], chosenType: true }, uncounterable: true } }],
    });
  });
});

describe('slice 133', () => {
  it('reads Path of Ancestry', () => {
    expect(parse("{T}: Add one mana of any color in your commander's color identity. When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1.", 'Land', 'Path').abilities[0]).toMatchObject({
      mana: true, effects: [{ type: 'add_mana', abilities: [{ kind: 'triggered', trigger: { type: 'mana_spent', filter: { types: ['Creature'], sharesTypeWithCommander: true } }, effects: [{ type: 'scry', amount: 1 }] }] }],
    });
  });
});

describe('slices 134–135', () => {
  it('reads Myriad Landscape and "the next spell you cast this turn"', () => {
    expect(parse('{2}, {T}, Sacrifice this land: Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.', 'Land', 'M').abilities[0]).toMatchObject({
      effects: [{ type: 'search', amount: 2, upTo: true, sameLandType: true, to: 'battlefield', tapped: true }],
    });
    expect(parse("{U}, {T}: The next spell you cast this turn can't be countered.", 'Land', 'V').abilities[0]).toMatchObject({ effects: [{ type: 'next_spell', filter: {}, uncounterable: true }] });
    expect(parse('{1}{U}, {T}: Draw a card. The next instant or sorcery spell you cast this turn costs {X} less to cast, where X is the number of Wizards you control as this ability resolves.', 'Creature — Wizard', 'K').abilities[0]).toMatchObject({
      effects: [{ type: 'draw' }, { type: 'next_spell', filter: { types: ['Instant', 'Sorcery'] }, reduce: { kind: 'count' } }],
    });
  });
});

describe('slice 136', () => {
  it('reads War Room, Gamble, Victimize', () => {
    expect(parse("{3}, {T}, Pay life equal to the number of colors in your commanders' color identity: Draw a card.", 'Land', 'War Room').abilities[0]).toMatchObject({ cost: { other: [{ type: 'pay_life', amount: { kind: 'commander_colors' } }] } });
    expect(parse('Search your library for a card, put that card into your hand, discard a card at random, then shuffle.', 'Sorcery', 'Gamble').abilities[0]).toMatchObject({ effects: [{ type: 'search', to: 'hand' }, { type: 'discard', random: true }] });
    expect(parse('Choose two target creature cards in your graveyard. Sacrifice a creature. If you do, return the chosen cards to the battlefield tapped.', 'Sorcery', 'Victimize').abilities[0]).toMatchObject({
      targets: [{ count: 2 }],
      effects: [{ type: 'may_do', mandatory: true, effects: [{ type: 'sacrifice_choice' }], then: [{ type: 'move', what: { ref: 'target', index: 0 }, to: 'battlefield' }] }],
    });
  });
});

describe('slice 137', () => {
  it('reads a batch of staples', () => {
    expect(parse('This spell costs {X} less to cast, where X is the total power of creatures you control.', 'Creature — Dinosaur', 'Ghalta').abilities[0]).toMatchObject({ effect: { type: 'cost_modifier', self: true, amount: { kind: 'total_power', filter: { controller: 'you', types: ['Creature'] } } } });
    expect(parse("Each spell you cast that's red or green costs {1} less to cast.", 'Creature — Goblin', 'A').abilities[0]).toMatchObject({ effect: { type: 'cost_modifier', who: 'you', filter: { colors: ['R', 'G'] }, amount: 1 } });
    expect(parse('Creature spells you cast with power 4 or greater cost {2} less to cast.', 'Creature — Bear', 'G').abilities[0]).toMatchObject({ effect: { filter: { types: ['Creature'], power: { op: 'ge', n: 4 } }, amount: 2 } });
    expect(parse('Whenever a creature you control dies, each other player sacrifices a creature of their choice.', 'Enchantment', 'P').abilities[0]).toMatchObject({ effects: [{ type: 'sacrifice_choice', who: { ref: 'players', who: 'opponents' } }] });
    expect(parse('Whenever a player sacrifices a permanent, this creature deals 1 damage to any target.', 'Creature — Devil', 'D').abilities[0]).toMatchObject({ trigger: { type: 'sacrificed', who: 'any' } });
    expect(parse('{1}, {T}, Sacrifice this land: You may cast spells this turn as though they had flash.', 'Land', 'Z').abilities[0]).toMatchObject({ effects: [{ type: 'player_effect', rule: 'flash' }] });
    expect(parse("Untap all artifacts you control during each other player's untap step.", 'Artifact', 'C').abilities[0]).toMatchObject({ effect: { type: 'continuous', rules: ['untap_during_others'] } });
    expect(parse('Equipped creature gets +2/+2 and has protection from black and from green.', 'Artifact — Equipment', 'S').abilities[0]).toMatchObject({ effect: { keywords: [{ id: 'protection', text: 'black' }, { id: 'protection', text: 'green' }] } });
  });
});

describe('slice 138', () => {
  it('reads triggered mana abilities (CR 605.1b)', () => {
    expect(parse('Whenever enchanted land is tapped for mana, its controller adds an additional {G}.', 'Enchantment — Aura', 'Growth').abilities[0]).toMatchObject({ trigger: { type: 'tapped_for_mana', subject: { ref: 'attached' }, its: true }, effects: [{ type: 'add_mana', options: [['G']] }] });
    expect(parse('Whenever you tap a Swamp for mana, add an additional {B}.', 'Creature — Spirit', 'Ghast').abilities[0]).toMatchObject({ trigger: { type: 'tapped_for_mana', subject: { filter: { subtypes: ['Swamp'], controller: 'you' } } } });
    expect(parse('Whenever you tap a land for mana, add one mana of any type that land produced.', 'Enchantment', 'Wake').abilities[0]).toMatchObject({ effects: [{ type: 'add_mana', produced: true }] });
  });
});

describe('slices 139–141', () => {
  it('reads Simian Spirit Guide, Cabal Ritual, Minas Tirith, Chord of Calling and doubling', () => {
    expect(parse('Exile this card from your hand: Add {R}.', 'Creature — Ape Spirit', 'Guide').abilities[0]).toMatchObject({ mana: true, zone: 'hand', cost: { other: [{ type: 'exile_self_hand' }] } });
    expect(parse('Add {B}{B}{B}.\nThreshold — Add {B}{B}{B}{B}{B} instead if there are seven or more cards in your graveyard.', 'Instant', 'Ritual').abilities[0]).toMatchObject({
      effects: [{ type: 'if', effects: [{ type: 'add_mana', options: [['B', 'B', 'B', 'B', 'B']] }], else: [{ type: 'add_mana', options: [['B', 'B', 'B']] }] }],
    });
    expect(parse('{1}{W}, {T}: Draw a card. Activate only if you attacked with two or more creatures this turn.', 'Land', 'Tirith').abilities[0]).toMatchObject({ activateIf: { type: 'attacked_with', n: 2 } });
    expect(parse('Search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle.', 'Instant', 'Chord').abilities[0]).toMatchObject({ effects: [{ type: 'search', filter: { manaValue: { op: 'le', n: 'X' } } }] });
    // A target with mana value X can't be checked as targets are chosen: unread.
    expect(parse('When this creature enters, counter target spell with mana value X or less, where X is the number of Faeries you control.', 'Creature — Faerie', 'Sprite').unparsed).toHaveLength(1);
    expect(parse('Double the power and toughness of each creature you control until end of turn.', 'Instant', 'G').abilities[0]).toMatchObject({ effects: [{ type: 'modify', double: 'both', until: 'eot' }] });
    expect(parse('Double the number of +1/+1 counters on each creature you control.', 'Sorcery', 'C').abilities[0]).toMatchObject({ effects: [{ type: 'double_counters', counter: '+1/+1' }] });
  });
});

describe('slices 142–143', () => {
  it('reads Living Death and Bolt Bend', () => {
    expect(parse('Each player exiles all creature cards from their graveyard, then sacrifices all creatures they control, then puts all cards they exiled this way onto the battlefield.', 'Sorcery', 'Death').abilities[0]).toMatchObject({ effects: [{ type: 'swap_graveyard', cardType: 'Creature' }] });
    expect(parse('Change the target of target spell or ability with a single target.', 'Instant', 'Bend').abilities[0]).toMatchObject({ targets: [{ what: 'ability', singleTarget: true }], effects: [{ type: 'retarget', change: true }] });
  });
});

describe('slice 144', () => {
  it('reads a batch of staples', () => {
    expect(parse('Search your library for a creature card, reveal that card, put it into your hand, then shuffle.', 'Instant', 'Call').abilities[0]).toMatchObject({ effects: [{ type: 'search', to: 'hand', filter: { types: ['Creature'] } }] });
    expect(parse("{T}: Add {C}. If you control an Urza's Mine and an Urza's Power-Plant, add {C}{C}{C} instead.", "Land — Urza's Tower", 'Tower').abilities[0]).toMatchObject({
      mana: true, effects: [{ type: 'if', cond: { type: 'and' }, effects: [{ options: [['C', 'C', 'C']] }], else: [{ options: [['C']] }] }],
    });
    expect(parse('Add {R}{R}, then add {R} for each card named Rite of Flame in each graveyard.', 'Sorcery', 'Rite of Flame').abilities[0]).toMatchObject({ effects: [{ type: 'add_mana' }, { type: 'add_mana', times: { kind: 'cards', who: 'each', filter: { name: 'Rite of Flame' } } }] });
    expect(parse('{2}{G}{G}, {T}: Add six {G}. Spend this mana only to cast creature spells or activate abilities of creatures.', 'Land', 'Castle').abilities[0]).toMatchObject({ effects: [{ type: 'add_mana', options: [['G', 'G', 'G', 'G', 'G', 'G']], spend: { spells: { types: ['Creature'] } } }] });
    expect(parse('Aura and Equipment spells you cast cost {1} less to cast.', 'Creature — Human', 'D').abilities[0]).toMatchObject({ effect: { filter: { subtypes: ['Aura', 'Equipment'] } } });
    expect(parse("Your opponents can't cast spells from anywhere other than their hands.", 'Creature — Human', 'M').abilities[0]).toMatchObject({ effect: { fromZones: ['graveyard', 'library', 'exile', 'command'] } });
    expect(parse('Whenever you tap this land for mana, target opponent creates a 1/1 colorless Spirit creature token.', 'Land', 'O').abilities[0]).toMatchObject({ trigger: { type: 'tapped_for_mana', subject: { ref: 'self' } } });
  });
});

describe('slice 145', () => {
  it('reads permissions to play from the top of your library', () => {
    expect(parse('You may play lands from the top of your library.', 'Creature — Elf', 'A').abilities[0]).toMatchObject({ effect: { type: 'top_permission', lands: true } });
    expect(parse('You may cast creature spells from the top of your library.', 'Creature — Elf', 'E').abilities[0]).toMatchObject({ effect: { type: 'top_permission', spells: { types: ['Creature'] } } });
    expect(parse('You may cast Angel spells and Human spells from the top of your library.', 'Creature — Angel', 'S').abilities[0]).toMatchObject({ effect: { spells: { subtypes: ['Angel', 'Human'] } } });
    expect(parse('You may play lands and cast spells from the top of your library.', 'Enchantment', 'F').abilities[0]).toMatchObject({ effect: { lands: true, spells: {} } });
  });
});

describe('slice 146', () => {
  it('reads Sylvan Library', () => {
    expect(parse('At the beginning of your draw step, you may draw two additional cards. If you do, choose two cards in your hand drawn this turn. For each of those cards, pay 4 life or put the card on top of your library.', 'Enchantment', 'Library').abilities[0]).toMatchObject({ effects: [{ type: 'sylvan_library' }] });
  });
});

describe('slice 147', () => {
  it('reads the Enduring cycle', () => {
    expect(parse("When Enduring Vitality dies, if it was a creature, return it to the battlefield under its owner's control. It's an enchantment. (It's not a creature.)", 'Enchantment Creature — Elk Glimmer', 'Enduring Vitality').abilities[0]).toMatchObject({
      condition: { type: 'was_type', cardType: 'Creature' },
      effects: [{ type: 'move', to: 'battlefield' }, { type: 'modify', types: ['Enchantment'], subtypes: [], until: 'game' }],
    });
  });
});

describe('slice 148', () => {
  it("reads a targeted player's graveyard and hand", () => {
    expect(parse("When this land enters, exile target player's graveyard.", 'Land', 'Bog').abilities[0]).toMatchObject({
      targets: [{ what: 'player' }],
      effects: [{ type: 'move', what: { ref: 'all', filter: { zone: 'graveyard', ownedBy: { ref: 'target', index: 0 } } }, to: 'exile' }],
    });
    expect(parse("Add {R} for each card in target opponent's hand.", 'Sorcery', 'W').abilities[0]).toMatchObject({ effects: [{ type: 'add_mana', times: { kind: 'cards', zone: 'hand', player: { ref: 'target', index: 0 } } }] });
    // A target card in a targeted player's graveyard needs the targets checked together: not read.
    expect(parse("Return target creature card from target player's graveyard to the battlefield under your control.", 'Sorcery', 'R').unparsed).toHaveLength(1);
  });
  it('reads the chosen type, "this way" counts and Nykthos', () => {
    expect(parse("Choose a creature type. Destroy all creatures that aren't of the chosen type.", 'Sorcery', 'K').abilities[0]).toMatchObject({ effects: [{ type: 'choose_value' }, { type: 'destroy', what: { filter: { notChosenType: true } } }] });
    expect(parse('Destroy all creatures. You gain 1 life for each creature destroyed this way.', 'Sorcery', 'F').abilities[0]).toMatchObject({ effects: [{}, { type: 'gain_life', amount: { kind: 'moved_this_way', how: 'destroyed', types: ['Creature'] } }] });
    expect(parse('{2}, {T}: Choose a color. Add an amount of mana of that color equal to your devotion to that color.', 'Legendary Land', 'N').abilities[0]).toMatchObject({ mana: true, effects: [{ type: 'add_mana', anyColor: 1, times: { kind: 'devotion', manaColor: true } }] });
  });
  it('reads Plaguecrafter, Lion\'s Eye Diamond, Wonder, Gravecrawler', () => {
    expect(parse("When this creature enters, each player sacrifices a creature or planeswalker of their choice. Each player who can't discards a card.", 'Creature — Human Shaman', 'P').abilities[0]).toMatchObject({ effects: [{ type: 'sacrifice_choice', cant: [{ type: 'discard', who: { ref: 'you' } }] }] });
    expect(parse('Discard your hand, Sacrifice this artifact: Add three mana of any one color. Activate only as an instant.', 'Artifact', 'L').abilities[0]).toMatchObject({ mana: true, timing: 'instant', cost: { other: [{ type: 'discard_hand' }, { type: 'sacrifice_self' }] } });
    expect(parse('As long as this card is in your graveyard and you control an Island, creatures you control have flying.', 'Creature — Incarnation', 'Wonder').abilities[0]).toMatchObject({ effect: { type: 'continuous', fromGraveyard: true, condition: { type: 'count' } } });
    expect(parse('You may cast this card from your graveyard as long as you control a Zombie.', 'Creature — Zombie', 'G').abilities[0]).toMatchObject({ effect: { type: 'cast_option', zone: 'graveyard', withManaCost: true, condition: {} } });
  });
  it("reads free casts from hand, Narset's Reversal and Eldritch Evolution", () => {
    expect(parse('You may cast a spell with mana value 5 or less from your hand without paying its mana cost.', 'Sorcery', 'R').abilities[0]).toMatchObject({ effects: [{ type: 'cast_from_hand', filter: { manaValue: { op: 'le', n: 5 } } }] });
    expect(parse("Copy target instant or sorcery spell, then return it to its owner's hand. You may choose new targets for the copy.", 'Instant', 'N').abilities[0]).toMatchObject({ effects: [{ type: 'copy_spell', newTargets: true }, { type: 'move', to: 'hand' }] });
    expect(parse("Search your library for a creature card with mana value X or less, where X is 2 plus the sacrificed creature's mana value. Put that card onto the battlefield, then shuffle.", 'Sorcery', 'E').abilities[0]).toMatchObject({ effects: [{ type: 'search', filter: { manaValue: { n: { kind: 'cost_lki', plus: 2 } } }, to: 'battlefield' }] });
    // "…, then discards a card": the subject goes on (Anvil of Bogardan).
    expect(parse("At the beginning of each player's draw step, that player draws an additional card, then discards a card.", 'Artifact', 'A').abilities[0]).toMatchObject({
      effects: [{ type: 'draw', who: { ref: 'trigger_player' } }, { type: 'discard', who: { ref: 'trigger_player' } }],
    });
  });
});

describe('slice 149', () => {
  it('reads "you may have …" causatives', () => {
    expect(parse('Whenever a creature an opponent controls enters, you may have that player lose 1 life.', 'Creature — Human', 'S').abilities[0]).toMatchObject({ effects: [{ type: 'may', effects: [{ type: 'lose_life', who: { ref: 'trigger_player' } }] }] });
    expect(parse('When this creature enters, you may have it fight target creature you don\'t control.', 'Creature — Elf', 'A').abilities[0]).toMatchObject({ effects: [{ type: 'may', effects: [{ type: 'fight', a: { ref: 'self' } }] }] });
  });
  it('reads deaths this turn, the Theros Gods and "unless" restrictions', () => {
    expect(parse('At the beginning of your end step, create a Treasure token for each nontoken creature that died this turn.', 'Creature — Cat', 'M').abilities[0]).toMatchObject({ effects: [{ type: 'create_token', amount: { kind: 'died_this_turn', nontoken: true } }] });
    expect(parse('At the beginning of your end step, if two or more creatures died this turn, draw a card.', 'Creature — Cat', 'M').abilities[0]).toMatchObject({ condition: { type: 'amount', amount: { kind: 'died_this_turn' }, op: 'ge', n: 2 } });
    expect(parse("As long as your devotion to red is less than five, Purphoros isn't a creature.", 'Legendary Enchantment Creature — God', 'Purphoros, God of the Forge').abilities[0]).toMatchObject({
      effect: { type: 'continuous', affected: { ref: 'self' }, loseTypes: ['Creature'], condition: { type: 'amount', amount: { kind: 'devotion', colors: ['R'] }, op: 'le', n: 4 } },
    });
    expect(parse("This creature can't attack or block unless you control seven or more lands.", 'Creature — Plant', 'T').abilities[0]).toMatchObject({ effect: { rules: ['cant_attack', 'cant_block'], condition: { type: 'not' } } });
    // Still the per-attack form.
    expect(parse("This creature can't attack unless defending player controls an Island.", 'Creature — Serpent', 'S').unparsed).toHaveLength(0);
  });
  it('reads triggers, targets and sweepers', () => {
    expect(parse('When this enchantment enters and whenever you cast a spell with mana value 5 or greater, draw a card.', 'Enchantment', 'U').abilities[0]).toMatchObject({ trigger: { type: 'either', of: [{ type: 'enters' }, { type: 'cast' }] } });
    expect(parse('Whenever a permanent you control enters tapped, untap it.', 'Artifact', 'A').abilities[0]).toMatchObject({ trigger: { type: 'enters', tapped: true } });
    expect(parse('{U}, Sacrifice this creature: Counter target spell or ability that targets you or a creature you control.', 'Creature — Siren', 'S').abilities[0]).toMatchObject({ targets: [{ what: 'ability', targeting: { you: true, filter: { controller: 'you', types: ['Creature'] } } }] });
    expect(parse('Destroy all artifacts and enchantments your opponents control.', 'Sorcery', 'D').abilities[0]).toMatchObject({ effects: [{ type: 'destroy', what: { filter: { controller: 'opponent', types: ['Artifact', 'Enchantment'] } } }] });
    expect(parse("Destroy all creatures you don't control and all planeswalkers you don't control.", 'Sorcery', 'W').abilities[0]).toMatchObject({ effects: [{ type: 'destroy', what: { filter: { anyOf: [{ types: ['Creature'] }, { types: ['Planeswalker'] }] } } }] });
    expect(parse('{T}: Each player gains control of all creatures they own.', 'Land', 'H').abilities[1] ?? parse('{T}: Each player gains control of all creatures they own.', 'Land', 'H').abilities[0]).toMatchObject({ effects: [{ type: 'gain_control', toOwners: true }] });
    expect(parse("At the beginning of your upkeep, sacrifice a creature. If you can't, sacrifice this artifact.", 'Artifact', 'E').abilities[0]).toMatchObject({ effects: [{ type: 'sacrifice_choice', cant: [{ type: 'sacrifice', what: { ref: 'self' } }] }] });
    expect(parse('At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.', 'Creature — Human', 'D').abilities[0]).toMatchObject({ effects: [{ type: 'reveal_top', life: 'lose' }] });
  });
});

describe('slice 150', () => {
  it('reads wheels, poison, "the damage dealt this way" and Doran', () => {
    expect(parse('Each player discards any number of cards, then draws that many cards.', 'Sorcery', 'F').abilities[0]).toMatchObject({ effects: [{ type: 'wheel', who: { ref: 'players', who: 'each' }, mode: 'any' }] });
    expect(parse('Discard all the cards in your hand, then draw that many cards plus one.', 'Sorcery', 'H').abilities[0]).toMatchObject({ effects: [{ type: 'wheel', who: { ref: 'you' }, mode: 'all', delta: 1 }] });
    expect(parse('When this creature enters, discard up to two cards, then draw that many cards.', 'Creature — Human', 'T').abilities[0]).toMatchObject({ effects: [{ type: 'wheel', mode: 'up_to', upTo: 2 }] });
    expect(parse('Each opponent gets two poison counters.', 'Instant', 'B').abilities[0]).toMatchObject({ effects: [{ type: 'get_counters', counter: 'poison', amount: 2 }] });
    expect(parse('Corrupt deals damage to any target equal to the number of Swamps you control. You gain life equal to the damage dealt this way.', 'Sorcery', 'Corrupt').abilities[0]).toMatchObject({ effects: [{}, { type: 'gain_life', amount: { kind: 'damage_this_way' } }] });
    expect(parse("~ deals damage to target player equal to the number of cards in that player's hand.", 'Sorcery', 'G').abilities[0]).toMatchObject({ effects: [{ type: 'deal_damage', amount: { kind: 'cards', zone: 'hand', player: { ref: 'target', index: 0 } } }] });
    expect(parse('Each creature assigns combat damage equal to its toughness rather than its power.', 'Creature — Treefolk', 'D').abilities[0]).toMatchObject({ effect: { type: 'continuous', rules: ['damage_by_toughness'] } });
  });
});

describe('slice 151', () => {
  it('reads token, counter and draw replacements', () => {
    expect(parse('If one or more tokens would be created under your control, those tokens plus an additional Food token are created instead.', 'Legendary Creature — Halfling', 'P').abilities[0]).toMatchObject({ effect: { type: 'replace_quantity', event: 'tokens', op: 'extra', extra: { token: { subtypes: ['Food'] } } } });
    expect(parse('If you would create one or more Treasure tokens, instead create those tokens plus an additional Treasure token.', 'Creature — Elemental', 'X').abilities[0]).toMatchObject({ effect: { op: 'extra', tokenFilter: { subtypes: ['Treasure'] } } });
    expect(parse('If one or more tokens would be created under your control, those tokens plus that many 1/1 green Squirrel creature tokens are created instead.', 'Legendary Creature — Squirrel', 'C').abilities[0]).toMatchObject({ effect: { op: 'extra', extra: { thatMany: true } } });
    expect(parse('If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.', 'Enchantment', 'D').abilities[0]).toMatchObject({ effect: { event: 'counters', op: 'double', filter: { controller: 'you' } } });
    expect(parse('If you would draw a card except the first one you draw in each of your draw steps, draw two cards instead.', 'Enchantment', 'T').abilities[0]).toMatchObject({ effect: { type: 'draw_replacement', exceptFirst: true } });
    expect(parse('If you would draw a card while your library has no cards in it, you win the game instead.', 'Creature — Human', 'L').abilities[0]).toMatchObject({ effect: { type: 'draw_replacement', emptyWin: true } });
  });
  it('reads Mirkwood Bats, Starting Town, Blood Moon, Oran-Rief', () => {
    expect(parse('Whenever you create or sacrifice a token, each opponent loses 1 life.', 'Creature — Bat', 'M').abilities[0]).toMatchObject({ trigger: { type: 'either', of: [{ type: 'enters', subject: { filter: { token: true } } }, { type: 'sacrificed' }] } });
    expect(parse("This land enters tapped unless it's your first, second, or third turn of the game.", 'Land — Town', 'S').abilities[0]).toMatchObject({ effect: { type: 'enters_tapped', unless: { type: 'early_turn', max: 3 } } });
    expect(parse('Nonbasic lands are Mountains.', 'Enchantment', 'B').abilities[0]).toMatchObject({ effect: { landTypes: ['Mountain'], affected: { filter: { notSupertypes: ['Basic'] } } } });
    expect(parse('{T}: Put a +1/+1 counter on each green creature that entered this turn.', 'Land', 'O').abilities[0]).toMatchObject({ effects: [{ type: 'add_counters', what: { filter: { enteredThisTurn: true } } }] });
  });
});

describe('slice 152', () => {
  it('reads Bowmasters, Herald\'s Horn, flash grants and imprint', () => {
    expect(parse('When this creature enters and whenever an opponent draws a card except the first one they draw in each of their draw steps, this creature deals 1 damage to any target. Then amass Orcs 1.', 'Creature — Orc Archer', 'O').abilities[0]).toMatchObject({ trigger: { type: 'either', of: [{ type: 'enters' }, { type: 'draw', who: 'opponent', exceptFirstInDrawStep: true }] } });
    expect(parse("At the beginning of your upkeep, look at the top card of your library. If it's a creature card of the chosen type, you may reveal it and put it into your hand.", 'Artifact', 'H').abilities[0]).toMatchObject({ effects: [{ type: 'dig', to: 'hand', filter: { types: ['Creature'], chosenType: true }, optional: true }] });
    expect(parse('You may cast Aura and Equipment spells as though they had flash.', 'Enchantment', 'S').abilities[0]).toMatchObject({ effect: { type: 'player_rule', rule: 'flash', filter: { subtypes: ['Aura', 'Equipment'] } } });
    expect(parse('Imprint — When this artifact enters, you may exile a nonartifact, nonland card from your hand.', 'Artifact', 'C').abilities[0]).toMatchObject({ effects: [{ type: 'may', effects: [{ type: 'choose_from_hand', then: 'exile' }] }] });
    expect(parse("{T}: Add one mana of any of the exiled card's colors.", 'Artifact', 'C').abilities[0]).toMatchObject({ mana: true, effects: [{ type: 'add_mana', exiledColors: true }] });
  });
  it('reads Talon Gates, "Exile this land" costs, Valakut Awakening, Entish Restoration and Thassa\'s Oracle', () => {
    expect(parse('{4}: Put this card from your hand onto the battlefield.', 'Land', 'Talon Gates of Madara').abilities[0]).toMatchObject({ zone: 'hand', effects: [{ type: 'move', what: { ref: 'self' }, to: 'battlefield' }] });
    expect(parse('{3}, {T}, Exile this land: Target legendary creature gains hexproof and indestructible until end of turn.', 'Land', 'P').abilities[0]).toMatchObject({ cost: { other: [{ type: 'exile_self_battlefield' }] } });
    expect(parse('Put any number of cards from your hand on the bottom of your library, then draw that many cards plus one.', 'Instant', 'V').abilities[0]).toMatchObject({ effects: [{ type: 'wheel', to: 'bottom', delta: 1 }] });
    expect(parse('Draw two cards. If you control a creature with power 4 or greater, instead draw three cards.', 'Instant', 'E').abilities[0]).toMatchObject({ effects: [{ type: 'if', effects: [{ type: 'draw', amount: 3 }], else: [{ type: 'draw', amount: 2 }] }] });
    expect(parse('When this creature enters, look at the top X cards of your library, where X is your devotion to blue. Put up to one of them on top of your library and the rest on the bottom of your library in a random order. If X is greater than or equal to the number of cards in your library, you win the game.', 'Creature — Merfolk Wizard', 'T').abilities[0]).toMatchObject({ effects: [{ type: 'dig', to: 'top', rest: 'bottom' }, { type: 'if', effects: [{ type: 'game_result', result: 'win' }] }] });
  });
});

describe('slice 153', () => {
  it('reads trailing ifs with Otherwise, distinct names, Maze of Ith and Syr Konrad', () => {
    expect(parse('Whenever a creature you control enters, draw a card if its power is 3 or greater. Otherwise, put two +1/+1 counters on it.', 'Enchantment', 'T').abilities[0]).toMatchObject({ effects: [{ type: 'if', cond: { type: 'is', of: { ref: 'trigger_object' }, filter: { power: { op: 'ge', n: 3 } } }, effects: [{ type: 'draw' }], else: [{ type: 'add_counters' }] }] });
    expect(parse('Whenever this land or another land you control enters, if you control seven or more lands with different names, create a 2/2 black Zombie creature token.', 'Land', 'F').abilities[0]).toMatchObject({ condition: { type: 'distinct_names', filter: { types: ['Land'] }, min: 7 } });
    expect(parse('{T}: Untap target attacking creature. Prevent all combat damage that would be dealt to and dealt by that creature this turn.', 'Land', 'M').abilities[0]).toMatchObject({ effects: [{ type: 'untap' }, { type: 'prevent', combat: true, to: { ref: 'target' } }, { type: 'prevent', combat: true, by: { ref: 'target' } }] });
    expect(parse('Whenever another creature dies, or a creature card is put into a graveyard from anywhere other than the battlefield, or a creature card leaves your graveyard, Konrad deals 1 damage to each opponent.', 'Legendary Creature — Human Knight', 'Konrad').abilities[0]).toMatchObject({ trigger: { type: 'either', of: [{ type: 'dies' }, { type: 'put_into_graveyard', notFromBattlefield: true }, { type: 'leave_graveyard', each: true }] } });
  });
  it('reads Ghalta, Syphon Mind, All Is Dust, Burgeoning and Dragon Tempest', () => {
    expect(parse('When Ghalta enters, put any number of creature cards from your hand onto the battlefield.', 'Legendary Creature — Dinosaur', 'Ghalta').abilities[0]).toMatchObject({ effects: [{ type: 'choose_from_hand', amount: 99, then: 'battlefield', optional: true }] });
    expect(parse('Each other player discards a card. You draw a card for each card discarded this way.', 'Sorcery', 'S').abilities[0]).toMatchObject({ effects: [{ type: 'discard' }, { type: 'draw', amount: { kind: 'discarded_this_way' } }] });
    expect(parse('Each player sacrifices all permanents they control that are one or more colors.', 'Sorcery', 'D').abilities[0]).toMatchObject({ effects: [{ type: 'sacrifice', what: { ref: 'all' }, byController: true }] });
    expect(parse('Whenever an opponent plays a land, you may put a land card from your hand onto the battlefield.', 'Enchantment', 'B').abilities[0]).toMatchObject({ trigger: { type: 'land_played', who: 'opponent' } });
    expect(parse('Whenever a Dragon you control enters, it deals X damage to any target, where X is the number of Dragons you control.', 'Enchantment', 'T').abilities[0]).toMatchObject({ effects: [{ type: 'deal_damage', from: { ref: 'trigger_object' } }] });
  });
  it('reads counter costs, Omniscience, Narset, target lists and two-mana instead', () => {
    expect(parse('Put a -1/-1 counter on this creature: Untap this creature.', 'Creature — Human Druid', 'D').abilities[0]).toMatchObject({ cost: { other: [{ type: 'put_counters_self', counter: '-1/-1', amount: 1 }] } });
    expect(parse('You may cast spells from your hand without paying their mana costs.', 'Enchantment', 'O').abilities[0]).toMatchObject({ effect: { type: 'player_rule', rule: 'free_from_hand' } });
    expect(parse("Each opponent can't draw more than one card each turn.", 'Enchantment', 'N').abilities[0]).toMatchObject({ effect: { type: 'player_rule', who: 'opponents', rule: 'max_one_draw' } });
    expect(parse('Destroy target artifact and target creature.', 'Sorcery', 'D').abilities[0]).toMatchObject({ targets: [{ filter: { types: ['Artifact'] } }, { filter: { types: ['Creature'] } }], effects: [{ type: 'destroy' }, { type: 'destroy' }] });
    expect(parse('{T}: Add one mana of any type that a land you control could produce. If this creature has a +1/+1 counter on it, add three mana of that type instead.', 'Creature — Elf Druid', 'I').abilities[0]).toMatchObject({ mana: true, effects: [{ type: 'if', effects: [{ type: 'add_mana', anyColor: 3 }], else: [{ type: 'add_mana', anyColor: 1 }] }] });
  });
});

describe('slice 154', () => {
  it('reads trigger doublers and Torpor Orb (CR 603.2d)', () => {
    expect(parse('If an artifact or creature entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.', 'Artifact', 'P').abilities[0]).toMatchObject({ effect: { type: 'trigger_extra', cause: { event: 'enters', filter: { types: ['Artifact', 'Creature'] } }, source: { controller: 'you' }, permanent: true } });
    expect(parse('If a creature dying causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.', 'Legendary Creature — Human', 'T').abilities[0]).toMatchObject({ effect: { cause: { event: 'dies' } } });
    expect(parse('If a triggered ability of a Shaman or another Wizard you control triggers, that ability triggers an additional time.', 'Creature — Human Wizard', 'H').abilities[0]).toMatchObject({ effect: { source: { subtypes: ['Shaman', 'Wizard'], other: true, controller: 'you' } } });
    expect(parse('If a triggered ability of another creature you control of the chosen type triggers, it triggers an additional time.', 'Artifact Creature — Golem', 'R').abilities[0]).toMatchObject({ effect: { source: { chosenType: true, other: true } } });
    expect(parse("Creatures entering or dying don't cause abilities to trigger.", 'Creature — Human', 'H').abilities[0]).toMatchObject({ effect: { type: 'trigger_extra', none: true, cause: { event: 'enters_or_dies' } } });
    expect(parse("Permanents entering don't cause abilities of permanents your opponents control to trigger.", 'Legendary Creature — Phyrexian', 'E').abilities[0]).toMatchObject({ effect: { none: true, source: { controller: 'opponent' } } });
    expect(parse('This creature is the chosen type in addition to its other types.', 'Artifact Creature — Golem', 'R').abilities[0]).toMatchObject({ effect: { addTypes: { chosenType: true } } });
  });
  it('reads piles, combinations of mana, Selvala and Second Harvest', () => {
    expect(parse('Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.', 'Instant', 'F').abilities[0]).toMatchObject({ effects: [{ type: 'piles', amount: 5, separator: 'opponent', chooser: 'you', other: 'graveyard' }] });
    expect(parse('Reveal the top X plus one cards of your library and separate them into two piles. An opponent chooses one of those piles. Put that pile into your hand and the other into your graveyard.', 'Instant', 'E').abilities[0]).toMatchObject({ effects: [{ type: 'piles', amount: { kind: 'x', plus: 1 }, separator: 'you', chooser: 'opponent' }] });
    expect(parse('{G}, {T}: Add X mana in any combination of colors, where X is the greatest power among creatures you control.', 'Legendary Creature — Elf', 'S').abilities[0]).toMatchObject({ mana: true, effects: [{ type: 'add_mana', combination: { colors: ['W', 'U', 'B', 'R', 'G'] } }] });
    expect(parse('{5}, {T}: Add five mana in any combination of colors.', 'Land', 'C').abilities[0]).toMatchObject({ effects: [{ type: 'add_mana', combination: { amount: 5 } }] });
    expect(parse('{T}: Add two mana in any combination of {U}, {B}, and/or {R}.', 'Artifact', 'R').abilities[0]).toMatchObject({ effects: [{ type: 'add_mana', options: [['U', 'U'], ['U', 'B'], ['U', 'R'], ['B', 'B'], ['B', 'R'], ['R', 'R']] }] });
    expect(parse("Whenever another creature enters, its controller may draw a card if its power is greater than each other creature's power.", 'Legendary Creature — Elf', 'S').abilities[0]).toMatchObject({ effects: [{ type: 'if', cond: { type: 'is', filter: { powerAboveOthers: true } } }] });
    expect(parse("Whenever you cast a black spell, you may destroy target creature if it's tapped.", 'Creature — Human', 'D').abilities[0]).toMatchObject({ effects: [{ type: 'if', cond: { of: { ref: 'target', index: 0 }, filter: { tapped: true } } }] });
    expect(parse("For each token you control, create a token that's a copy of that permanent.", 'Instant', 'S').abilities[0]).toMatchObject({ effects: [{ type: 'create_token', copyEach: true, copyOf: { ref: 'all', filter: { token: true, controller: 'you' } } }] });
  });
  it('reads Champion of Lambholt and Equipment grants', () => {
    expect(parse("Creatures with power less than this creature's power can't block creatures you control.", 'Creature — Human', 'C').abilities[0]).toMatchObject({ effect: { affected: { ref: 'all', filter: { controller: 'you' } }, combat: { cantBeBlockedBy: { powerBelowSource: true } } } });
    expect(parse('Equipment you control have equip {1}.', 'Legendary Creature — Human', 'A').abilities[0]).toMatchObject({ effect: { affected: { ref: 'all', filter: { subtypes: ['Equipment'] } }, keywords: [{ id: 'equip' }] } });
  });
});

describe('slice 155', () => {
  it('reads Equipment attach triggers, searches, enter-with counters and "five of those tokens instead"', () => {
    expect(parse('Whenever an Equipment you control enters, you may attach it to target creature you control.', 'Enchantment', 'S').abilities[0]).toMatchObject({ effects: [{ type: 'may', effects: [{ type: 'attach', what: { ref: 'trigger_object' } }] }] });
    expect(parse('Whenever an opponent searches their library, you gain 1 life and draw a card.', 'Creature — Human', 'A').abilities[0]).toMatchObject({ trigger: { type: 'searched', who: 'opponent' } });
    expect(parse('Each other creature you control of the chosen type enters with an additional +1/+1 counter on it.', 'Artifact Creature — Shapeshifter', 'M').abilities[0]).toMatchObject({ effect: { type: 'enter_counters_others', counter: '+1/+1', filter: { other: true, chosenType: true } } });
    expect(parse("Create a token that's a copy of target creature. If this spell was kicked, create five of those tokens instead.", 'Sorcery', 'R').abilities[0]).toMatchObject({ effects: [{ type: 'if', effects: [{ type: 'create_token', amount: 5 }], else: [{ type: 'create_token', amount: 1 }] }] });
  });
  it('reads High Tide, Forsaken Monument, Darksteel Mutation, Imprisoned in the Moon and "If it\'s a …"', () => {
    expect(parse('Until end of turn, whenever a player taps an Island for mana, that player adds an additional {U}.', 'Instant', 'H').abilities[0]).toMatchObject({ kind: 'spell', effects: [{ type: 'mana_trigger_this_turn', ability: { trigger: { type: 'tapped_for_mana', its: true } } }] });
    expect(parse('Whenever you tap a permanent for {C}, add an additional {C}.', 'Legendary Artifact', 'F').abilities[0]).toMatchObject({ trigger: { type: 'tapped_for_mana', producedColor: 'C' } });
    expect(parse('Enchanted creature is an Insect artifact creature with base power and toughness 0/1 and has indestructible, and it loses all other abilities, card types, and creature types.', 'Enchantment — Aura', 'D').abilities[0]).toMatchObject({ effect: { setTypes: { types: ['Artifact', 'Creature'], subtypes: ['Insect'] }, setPower: 0, setToughness: 1, loseAbilities: true, keywords: [{ id: 'indestructible' }] } });
    expect(parse('Enchanted permanent is a colorless land with "{T}: Add {C}" and loses all other card types and abilities.', 'Enchantment — Aura', 'I').abilities[0]).toMatchObject({ effect: { setTypes: { types: ['Land'] }, colors: [], loseAbilities: true } });
    expect(parse("Untap target artifact or creature. If it's an artifact creature, put a +1/+1 counter on it.", 'Instant', 'T').abilities[0]).toMatchObject({ effects: [{ type: 'untap' }, { type: 'if', cond: { type: 'is', filter: { types: ['Creature'], allTypes: ['Artifact'] } } }] });
    expect(parse("Destroy target creature. If it's a Spirit, draw a card.", 'Instant', 'T').unparsed).toHaveLength(1);
  });
});

describe('slice 156', () => {
  it("reads Archaeomancer's Map, Lieutenant, Boromir, Thousand-Year Elixir and Ashaya", () => {
    expect(parse('Whenever a land an opponent controls enters, if that player controls more lands than you, you may put a land card from your hand onto the battlefield.', 'Artifact', 'M').abilities[0]).toMatchObject({ condition: { type: 'opponent_has_more', player: { ref: 'trigger_player' } } });
    expect(parse('Lieutenant — At the beginning of combat on your turn, if you control your commander, create a 1/1 colorless Thopter artifact creature token with flying. That token gains haste until end of turn.', 'Creature — Human', 'L').abilities[0]).toMatchObject({ condition: { type: 'count', filter: { commander: true, owner: 'you' } } });
    expect(parse('Whenever an opponent casts a spell, if no mana was spent to cast it, counter that spell.', 'Legendary Creature — Human', 'B').abilities[0]).toMatchObject({ trigger: { type: 'cast', noManaSpent: true } });
    expect(parse('You may activate abilities of creatures you control as though those creatures had haste.', 'Legendary Artifact', 'T').abilities[0]).toMatchObject({ effect: { type: 'player_rule', rule: 'abilities_haste' } });
    expect(parse('Nontoken creatures you control are Forest lands in addition to their other types.', 'Legendary Creature — Avatar', 'A').abilities[0]).toMatchObject({ effect: { addTypes: { types: ['Land'], subtypes: ['Forest'] } } });
  });
  it('reads Vesuva, Spark Double, Valley Floodcaller and Rampage of the Clans', () => {
    expect(parse('You may have this land enter tapped as a copy of any land on the battlefield.', 'Land', 'V').abilities[0]).toMatchObject({ effect: { type: 'as_enters', choice: 'copy', copyTapped: true } });
    expect(parse("You may have this creature enter as a copy of a creature or planeswalker you control, except it enters with an additional +1/+1 counter on it if it's a creature, it enters with an additional loyalty counter on it if it's a planeswalker, and it isn't legendary.", 'Creature — Illusion', 'S').abilities[0]).toMatchObject({ effect: { copyExcept: { nonlegendary: true, entersWith: [{ counter: '+1/+1', ifType: 'Creature' }, { counter: 'loyalty', ifType: 'Planeswalker' }] } } });
    expect(parse('Whenever you cast a noncreature spell, Birds, Frogs, Otters, and Rats you control get +1/+1 until end of turn. Untap them.', 'Creature — Otter Wizard', 'V').abilities[0]).toMatchObject({ effects: [{ type: 'modify' }, { type: 'untap' }] });
    expect(parse('Destroy all artifacts and enchantments. For each permanent destroyed this way, its controller creates a 3/3 green Centaur creature token.', 'Sorcery', 'R').abilities[0]).toMatchObject({ effects: [{}, { type: 'create_token', forEachMoved: { how: 'destroyed' } }] });
  });
});

describe('slice 157', () => {
  it('reads "shares a creature type with it"', () => {
    expect(parse('Whenever a creature you control attacks, it gets +1/+0 until end of turn for each other attacking creature that shares a creature type with it.', 'Enchantment', 'S').abilities[0]).toMatchObject({ effects: [{ power: { kind: 'count', filter: { sharesCreatureTypeWith: { ref: 'trigger_object' }, otherThan: { ref: 'trigger_object' } } } }] });
    expect(parse('Equipped creature gets +1/+1 for each other creature you control that shares a creature type with it.', 'Artifact — Equipment', 'S').abilities[0]).toMatchObject({ effect: { power: { kind: 'count', filter: { sharesCreatureTypeWith: { ref: 'attached' }, otherThan: { ref: 'attached' } } } } });
    // Coat of Arms (slice 180): each creature in turn ('affected').
    expect(parse('Each creature gets +1/+1 for each other creature on the battlefield that shares at least one creature type with it.', 'Artifact', 'C').abilities[0]).toMatchObject({ effect: { power: { kind: 'count', filter: { sharesCreatureTypeWith: { ref: 'affected' }, otherThan: { ref: 'affected' } } } } });
  });
  it('reads "you put counters on", Primal Vigor and mill costs', () => {
    expect(parse('Whenever you put one or more +1/+1 counters on this creature, draw a card. This ability triggers only once each turn.', 'Creature — Angel', 'E').abilities[0]).toMatchObject({ trigger: { type: 'counters_put', byYou: true, subject: { ref: 'self' } }, oncePerTurn: true });
    expect(parse('If one or more tokens would be created, twice that many of those tokens are created instead.', 'Enchantment', 'P').abilities[0]).toMatchObject({ effect: { type: 'replace_quantity', event: 'tokens', who: 'each', op: 'double' } });
    expect(parse('{T}, Mill a card: Add {C}.', 'Artifact Creature — Construct', 'M').abilities[0]).toMatchObject({ mana: true, cost: { tap: true, other: [{ type: 'mill', amount: 1 }] } });
  });
});

describe('slice 158', () => {
  it('reads Shalai, Teferi, Time Raveler, Magda and "that doesn\'t have hexproof"', () => {
    expect(parse('You, planeswalkers you control, and other creatures you control have hexproof.', 'Legendary Creature — Angel', 'S').abilities[0]).toMatchObject({ effect: { type: 'continuous', alsoPlayer: 'hexproof', affected: { ref: 'all', filter: { anyOf: [{ types: ['Planeswalker'] }, { types: ['Creature'], other: true }] } } } });
    expect(parse("{4}{G}{G}: Put two +1/+1 counters on each creature you control that doesn't have hexproof.", 'Legendary Creature — Angel', 'S').abilities[0]).toMatchObject({ effects: [{ type: 'add_counters', what: { filter: { notKeywords: ['hexproof'] } } }] });
    expect(parse('Each opponent can cast spells only any time they could cast a sorcery.', 'Legendary Planeswalker — Teferi', 'T').abilities[0]).toMatchObject({ effect: { type: 'player_rule', who: 'opponents', rule: 'sorcery_timing' } });
    expect(parse('+1: Until your next turn, you may cast sorcery spells as though they had flash.', 'Legendary Planeswalker — Teferi', 'T').abilities[0]).toMatchObject({ effects: [{ type: 'player_effect', rule: 'flash', until: 'your_next_turn', filter: { types: ['Sorcery'] } }] });
    expect(parse('Sacrifice five Treasures: Search your library for an artifact or Dragon card, put that card onto the battlefield, then shuffle.', 'Legendary Creature — Dwarf', 'M').abilities[0]).toMatchObject({ cost: { other: [{ type: 'sacrifice', amount: 5 }] } });
  });
  it("reads Mishra's Bauble and Charismatic Conqueror", () => {
    expect(parse("{T}, Sacrifice this artifact: Look at the top card of target player's library. Draw a card at the beginning of the next turn's upkeep.", 'Artifact', 'M').abilities[0]).toMatchObject({ effects: [{ type: 'look_at_top', who: { ref: 'target' }, amount: 1 }, {}] });
    expect(parse("Whenever an artifact or creature an opponent controls enters untapped, they may tap that permanent. If they don't, you create a 1/1 white Vampire creature token with lifelink.", 'Creature — Vampire', 'C').abilities[0]).toMatchObject({ trigger: { type: 'enters', untapped: true }, effects: [{ type: 'may_do', who: { ref: 'trigger_player' }, effects: [{ type: 'tap', what: { ref: 'trigger_object' } }] }] });
  });
});

describe('slice 159', () => {
  it('reads "X target …" with the announced X, and "Do this only once each turn"', () => {
    expect(parse('Exile X target creatures. For each creature exiled this way, its controller creates a 2/2 green Boar creature token.', 'Sorcery', 'C').abilities[0]).toMatchObject({ targets: [{ countX: true, filter: { types: ['Creature'] } }] });
    expect(parse('{X}, {T}: Untap X target lands.', 'Artifact', 'C').abilities[0]).toMatchObject({ targets: [{ countX: true }] });
    expect(parse('{U}, Sacrifice this enchantment: Return up to X target permanents to their owners\' hands, where X is the number of verse counters on this enchantment.', 'Enchantment', 'R').unparsed).toHaveLength(1);
    expect(parse('When this creature enters, return up to X target Zombie cards from your graveyard to the battlefield, where X is the number of opponents you have.', 'Creature — Zombie', 'R').unparsed).toHaveLength(1);
    expect(parse('Whenever you put one or more +1/+1 counters on a creature you control, you may draw that many cards. Do this only once each turn.', 'Enchantment', 'T').abilities[0]).toMatchObject({ doOnce: true, effects: [{ type: 'may', doOnce: true }] });
  });
  it('reads punishers: "unless they sacrifice … or discard a card", each opponent on their own', () => {
    expect(parse('{T}: Target player loses 3 life unless they sacrifice a nonland permanent of their choice or discard a card.', 'Artifact', 'L').abilities[0]).toMatchObject({ effects: [{ type: 'unless_does', payer: { ref: 'target' }, actions: [[{ type: 'sacrifice_choice' }], [{ type: 'discard' }]], effects: [{ type: 'lose_life', amount: 3 }] }] });
    expect(parse('Each opponent loses 3 life unless that player sacrifices a nonland permanent of their choice or discards a card.', 'Sorcery', 'N').abilities[0]).toMatchObject({ effects: [{ type: 'unless_does', perPlayer: { ref: 'players', who: 'opponents' }, effects: [{ type: 'lose_life', who: { ref: 'you' } }] }] });
    expect(parse("At the beginning of each opponent's upkeep, ~ deals 2 damage to that player unless they sacrifice a creature of their choice.", 'Legendary Enchantment Creature — God', 'Mogis').abilities[0]).toMatchObject({ effects: [{ type: 'unless_does', payer: { ref: 'trigger_player' }, action: [{ type: 'sacrifice_choice' }] }] });
  });
});

describe('slice 160', () => {
  it('reads "For each X, create …", named tokens, and damage to you', () => {
    expect(parse('For each land you control, create a Treasure token.', 'Sorcery', 'B').abilities[0]).toMatchObject({ effects: [{ type: 'create_token', amount: { kind: 'count', filter: { types: ['Land'], controller: 'you' } } }] });
    expect(parse("At the beginning of each upkeep, create a 3/3 blue Serpent creature token named Koma's Coil.", 'Legendary Creature — Serpent', 'Koma, Cosmos Serpent').abilities[0]).toMatchObject({ effects: [{ type: 'create_token', token: { name: "Koma's Coil" } }] });
    expect(parse('Whenever a creature deals damage to you, destroy it.', 'Enchantment', 'M').abilities[0]).toMatchObject({ trigger: { type: 'deals_damage', to: 'you' }, effects: [{ type: 'destroy', what: { ref: 'trigger_object' } }] });
    expect(parse('Whenever an opponent casts a spell from anywhere other than their hand, draw a card.', 'Creature — Spirit', 'G').abilities[0]).toMatchObject({ trigger: { type: 'cast', who: 'opponent', notFrom: 'hand' } });
  });
  it('reads life gained this turn and exact hand sizes', () => {
    expect(parse("At the beginning of your end step, draw a card if you've gained 3 or more life this turn.", 'Legendary Creature — Human', 'H').abilities[0]).toMatchObject({ effects: [{ type: 'if', cond: { type: 'amount', amount: { kind: 'life_this_turn', who: 'you' }, op: 'ge', n: 3 } }] });
    expect(parse('At the beginning of your upkeep, if you have exactly thirteen cards in your hand, you win the game.', 'Creature — Human Wizard', 'T').abilities[0]).toMatchObject({ condition: { type: 'amount', amount: { kind: 'cards', zone: 'hand' }, op: 'eq', n: 13 } });
  });
  it('reads "without a counter", static goad, anyone attacking, and graveyard shuffles', () => {
    expect(parse("Return each creature without a +1/+1 counter on it to its owner's hand.", 'Sorcery', 'W').abilities[0]).toMatchObject({ effects: [{ type: 'move', what: { ref: 'all', filter: { notCounter: '+1/+1' } }, to: 'hand' }] });
    expect(parse('Enchanted creature gets +2/+2 and is goaded.', 'Enchantment — Aura', 'S').abilities[0]).toMatchObject({ effect: { type: 'continuous', affected: { ref: 'attached' }, combat: { goaded: true } } });
    expect(parse('Whenever one or more creatures attack, you may have target attacking creature gain double strike until end of turn.', 'Enchantment', 'D').abilities[0]).toMatchObject({ trigger: { type: 'you_attack', anyone: true } });
    expect(parse("{2}, {T}: You gain 5 life. Shuffle this artifact and your graveyard into their owner's library.", 'Artifact', 'E').abilities[0]).toMatchObject({ effects: [{ type: 'gain_life' }, { type: 'move', what: { ref: 'self' }, position: 'shuffle' }, { type: 'shuffle_zones', zones: ['graveyard'] }] });
    expect(parse('When this creature enters, up to one target player puts all the cards from their graveyard on the bottom of their library in a random order.', 'Creature — Elemental Incarnation', 'N').abilities[0]).toMatchObject({ targets: [{ what: 'player', upTo: true }], effects: [{ type: 'move', position: 'bottom_random' }] });
  });
  it('reads static prevention on permanents only', () => {
    expect(parse('Prevent all combat damage that would be dealt to attacking creatures you control.', 'Artifact', 'D').abilities[0]).toMatchObject({ kind: 'static', effect: { type: 'prevent_damage', damage: 'combat', to: { combat: 'attacking', controller: 'you' } } });
    expect(parse('Prevent all combat damage that would be dealt to and dealt by this creature.', 'Creature — Wall', 'F').abilities[0]).toMatchObject({ effect: { type: 'prevent_damage', toSelf: true, bySelf: true } });
    expect(parse('Prevent all noncombat damage that would be dealt to you and other permanents you control.', 'Legendary Planeswalker', 'W').abilities[0]).toMatchObject({ effect: { type: 'prevent_damage', damage: 'noncombat', toYou: true, to: { other: true } } });
    expect(parse('Prevent all damage that would be dealt to ~ during your turn.', 'Legendary Planeswalker — Gideon', 'G').abilities[0]).toMatchObject({ effect: { toSelf: true, condition: { type: 'your_turn' } } });
    expect(parse('Prevent all combat damage that would be dealt to you.', 'Instant', 'I').abilities[0]).not.toMatchObject({ kind: 'static' });
  });
  it('reads hideaway, playing the exiled card, and its conditions', () => {
    const wind = parse('Hideaway 4\nThis land enters tapped.\n{T}: Add {W}.\n{W}, {T}: You may play the exiled card without paying its mana cost if you attacked with three or more creatures this turn.', 'Land', 'Windbrisk Heights');
    expect(wind.unparsed).toHaveLength(0);
    expect(wind.manualKeywords).toHaveLength(0);
    expect(wind.keywords[0]).toMatchObject({ id: 'hideaway', n: 4, abilities: [{ kind: 'triggered', trigger: { type: 'enters' }, effects: [{ type: 'hideaway', amount: 4 }] }] });
    expect(wind.abilities.at(-1)).toMatchObject({ effects: [{ type: 'if', cond: { type: 'attacked_with', n: 3 }, effects: [{ type: 'play_free', what: { ref: 'exiled_with' } }] }] });
    expect(parse('{R}, {T}: You may play the exiled card without paying its mana cost if an opponent was dealt 7 or more damage this turn.', 'Land', 'S').abilities[0]).toMatchObject({ effects: [{ cond: { amount: { kind: 'life_this_turn', who: 'an_opponent', stat: 'damage' }, n: 7 } }] });
    expect(parse('{U}, {T}: You may play the exiled card without paying its mana cost if a library has twenty or fewer cards in it.', 'Land', 'S').abilities[0]).toMatchObject({ effects: [{ cond: { amount: { kind: 'cards', zone: 'library', least: true }, op: 'le', n: 20 } }] });
    expect(parse('{B}, {T}: You may play the exiled card without paying its mana cost if each player has no cards in hand.', 'Land', 'H').abilities[0]).toMatchObject({ effects: [{ cond: { amount: { kind: 'cards', zone: 'hand', who: 'each' }, op: 'eq', n: 0 } }] });
    expect(parse("When this creature leaves the battlefield, put the exiled card into its owner's hand.", 'Creature — Human Soldier', 'W').abilities[0]).toMatchObject({ effects: [{ type: 'move', what: { ref: 'exiled_with' }, to: 'hand' }] });
  });
  it('reads life lost this turn, and cards put into an opponent’s graveyard', () => {
    expect(parse('At the beginning of your postcombat main phase, add {R} for each 1 life your opponents have lost this turn.', 'Legendary Creature — Zombie Warrior', 'N').abilities[0]).toMatchObject({ effects: [{ type: 'add_mana', times: { kind: 'life_this_turn', who: 'opponents', stat: 'lost' } }] });
    expect(parse('At the beginning of each end step, if an opponent lost 2 or more life this turn, you may put a quest counter on this enchantment.', 'Enchantment', 'B').abilities[0]).toMatchObject({ condition: { amount: { kind: 'life_this_turn', who: 'an_opponent', stat: 'lost' }, n: 2 } });
    expect(parse("Whenever a card is put into an opponent's graveyard from anywhere, if this enchantment has three or more quest counters on it, you may have that player lose 2 life. If you do, you gain 2 life.", 'Enchantment', 'B').abilities[0]).toMatchObject({
      trigger: { type: 'put_into_graveyard', subject: { filter: { token: false, owner: 'opponent' } } },
      effects: [{ type: 'may_do', effects: [{ type: 'lose_life', who: { ref: 'owner_of' } }], then: [{ type: 'gain_life' }] }],
    });
  });
  it('reads "until your next turn" grants, lasting player effects with a rider, repeats, and control changes', () => {
    expect(parse('Put a +1/+1 counter on each creature you control. Those creatures gain flying until your next turn.', 'Sorcery', 'E').abilities[0]).toMatchObject({ effects: [{ type: 'add_counters' }, { type: 'modify', until: 'your_next_turn', keywords: [{ id: 'flying' }] }] });
    expect(parse("Until end of turn, your life total can't change, and permanents you control gain hexproof and indestructible.", 'Instant', 'F').abilities[0]).toMatchObject({ effects: [{ type: 'player_effect', rule: 'life_cant_change', until: 'eot' }, { type: 'modify', until: 'eot' }] });
    expect(parse('Repeat the following process X times. Each opponent loses 3 life unless that player sacrifices a nonland permanent of their choice or discards a card.', 'Sorcery', 'T').abilities[0]).toMatchObject({ effects: [{ type: 'repeat', times: 'X', effects: [{ type: 'unless_does' }] }] });
    expect(parse('{1}, {T}, Remove a wish counter from this artifact: Search your library for a card, put it into your hand, then shuffle. An opponent gains control of this artifact. Activate only during your turn.', 'Artifact', 'W').abilities[0]).toMatchObject({ effects: [{ type: 'search' }, { type: 'gain_control', what: { ref: 'self' }, toOpponent: true }] });
    expect(parse('When enchanted permanent dies or is put into exile, return that card to the battlefield under your control.', 'Enchantment — Aura', 'K').abilities[0]).toMatchObject({ trigger: { type: 'leaves', subject: { ref: 'attached' }, toZones: ['graveyard', 'exile'] } });
    expect(parse("Creatures can't attack you or planeswalkers you control unless their controller pays {X} for each of those creatures, where X is the number of enchantments you control.", 'Enchantment', 'S').abilities[0]).toMatchObject({ effect: { type: 'attack_tax', cost: '{X}', x: { kind: 'count', filter: { types: ['Enchantment'] } }, planeswalkers: true } });
  });
  it('waits for a delayed coin flip, binds the creature put onto the battlefield, and never pumps an instant itself', () => {
    expect(parse('Whenever this creature attacks or blocks, flip a coin at end of combat. If you lose the flip, an opponent gains control of this creature.', 'Creature — Efreet', 'F').abilities[0]).toMatchObject({ effects: [{ type: 'delayed', step: 'end_of_combat', effects: [{ type: 'flip_coin' }, { type: 'if', cond: { type: 'won_flip', not: true } }] }] });
    expect(parse('You may put a creature card from your hand onto the battlefield. That creature gains haste. Sacrifice that creature at the beginning of the next end step.', 'Instant — Arcane', 'T').abilities[0]).toMatchObject({ effects: [{ type: 'may' }, { type: 'modify', what: { ref: 'created' } }, { type: 'delayed', effects: [{ type: 'sacrifice', what: { ref: 'created' } }] }] });
    // Slice 169: "It" is the card found (it had read as the spell itself, so it stayed unread until then).
    expect(parse('Search your library for a Dinosaur creature card, put it onto the battlefield, then shuffle. It gains indestructible until your next turn.', 'Sorcery', 'S').abilities[0]).toMatchObject({ effects: [{ type: 'search' }, { type: 'modify', what: { ref: 'created' } }] });
  });
});

describe('slice 161', () => {
  it("reads impulse draw from another player's library, face-down exile, and tokens attacking each opponent", () => {
    expect(parse("Whenever ~ deals combat damage to a player, create a Treasure token and exile the top card of that player's library. Until end of turn, you may cast that card.", 'Legendary Creature — Monkey Pirate', 'Ragavan, Nimble Pilferer').abilities[0]).toMatchObject({ effects: [{ type: 'create_token' }, { type: 'exile_top', who: { ref: 'trigger_player' }, play: { mode: 'cast', until: 'eot' } }] });
    expect(parse('Pay 1 life: Exile the top card of your library face down. Put that card into your hand at the beginning of your next end step.', 'Enchantment', 'N').abilities[0]).toMatchObject({ effects: [{ type: 'exile_top', faceDown: true }, { type: 'delayed', step: 'end', whose: 'you', effects: [{ type: 'move', what: { ref: 'created' }, to: 'hand' }] }] });
    expect(parse("Whenever you attack, for each opponent, create a 1/1 white Human creature token that's tapped and attacking that player or a planeswalker they control.", 'Legendary Creature — Human Knight', 'A').abilities[0]).toMatchObject({ trigger: { type: 'you_attack' }, effects: [{ type: 'create_token', attackingEach: true, orPlaneswalker: true, tapped: true }] });
    expect(parse('Exile the top card of target opponent\'s library.', 'Sorcery', 'X').abilities[0]).toMatchObject({ targets: [{ what: 'player' }] });
    expect(parse("III — Exile the top three cards of target opponent's library. You may play those cards this turn.", 'Enchantment — Saga', 'K').abilities[0]).toMatchObject({ targets: [{ what: 'player' }], effects: [{ type: 'exile_top', amount: 3, who: { ref: 'target', index: 0 } }] });
    expect(parse('Return each creature card with mana value X or less from your graveyard to the battlefield. Exile those creatures at the beginning of your next upkeep.', 'Sorcery', 'R').unparsed).toHaveLength(1);
  });
  it('reads Academy Manufactor, Guardian Project, Mangara, Veil of Summer and The Ozolith', () => {
    expect(parse('If you would create a Clue, Food, or Treasure token, instead create one of each.', 'Artifact Creature — Assembly-Worker', 'M').abilities[0]).toMatchObject({ effect: { type: 'token_one_of_each', tokens: [{ name: 'Clue' }, { name: 'Food' }, { name: 'Treasure' }] } });
    expect(parse("Whenever a nontoken creature you control enters, if it doesn't have the same name as another creature you control or a creature card in your graveyard, draw a card.", 'Enchantment', 'G').abilities[0]).toMatchObject({ condition: { type: 'unique_name', of: { ref: 'trigger_object' } } });
    expect(parse('Whenever an opponent attacks with creatures, if two or more of those creatures are attacking you and/or planeswalkers you control, draw a card.', 'Legendary Creature — Human Cleric', 'M').abilities[0]).toMatchObject({ trigger: { type: 'you_attack', opponent: true, atYou: 'or_planeswalkers', min: 2 } });
    expect(parse("Draw a card if an opponent has cast a blue or black spell this turn. Spells you control can't be countered this turn. You and permanents you control gain hexproof from blue and from black until end of turn.", 'Instant', 'V').abilities[0]).toMatchObject({
      effects: [
        { type: 'if', cond: { type: 'this_turn', event: 'opponent_cast', filter: { colors: ['U', 'B'] } } },
        { type: 'player_effect', rule: 'spells_uncounterable', until: 'eot' },
        { type: 'player_effect', rule: 'hexproof_from', filter: { colors: ['U', 'B'] } },
        { type: 'modify', keywords: [{ id: 'hexproof_from', text: 'blue' }, { id: 'hexproof_from', text: 'black' }] },
      ],
    });
    const oz = parse('Whenever a creature you control leaves the battlefield, if it had counters on it, put those counters on ~.\nAt the beginning of combat on your turn, if ~ has counters on it, you may move all counters from ~ onto target creature.', 'Legendary Artifact', 'O');
    expect(oz.abilities[0]).toMatchObject({ condition: { type: 'counters', of: { ref: 'trigger_object' }, min: 1 }, effects: [{ type: 'put_lki_counters' }] });
    expect(oz.abilities[1]).toMatchObject({ effects: [{ type: 'may', effects: [{ type: 'move_counters', counter: 'all' }] }] });
  });
  it("reads Urza's Saga: a quote inside a quote, and \"mana cost {0} or {1}\"", () => {
    const saga = parse("(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — This Saga gains \"{T}: Add {C}.\"\nII — This Saga gains \"{2}, {T}: Create a 0/0 colorless Construct artifact creature token with 'This token gets +1/+1 for each artifact you control.'\"\nIII — Search your library for an artifact card with mana cost {0} or {1}, put it onto the battlefield, then shuffle.", "Enchantment Land — Urza's Saga", "Urza's Saga");
    expect(saga.unparsed).toHaveLength(0);
    expect(JSON.stringify(saga.abilities[1])).toContain('"kind":"count"');
    expect(saga.abilities[2]).toMatchObject({ effects: [{ type: 'search', filter: { types: ['Artifact'], manaCostIs: ['{0}', '{1}'] } }] });
  });
});

describe('slice 162', () => {
  it("reads Bolas's Citadel, Underworld Breach, Dauthi Voidwalker and Terror of the Peaks", () => {
    expect(parse('You may play lands and cast spells from the top of your library. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.', 'Legendary Artifact', 'B').abilities[0]).toMatchObject({ effect: { type: 'top_permission', lands: true, spells: {}, lifeCost: true } });
    expect(parse('{T}, Sacrifice ten nonland permanents: Each opponent loses 10 life.', 'Legendary Artifact', 'B').abilities[0]).toMatchObject({ cost: { other: [{ type: 'sacrifice', amount: 10 }] } });
    expect(parse("Each nonland card in your graveyard has escape. The escape cost is equal to the card's mana cost plus exile three other cards from your graveyard.", 'Enchantment', 'U').abilities[0]).toMatchObject({ effect: { type: 'grant_escape', filter: { notTypes: ['Land'] }, exile: 3 } });
    expect(parse("If a card would be put into an opponent's graveyard from anywhere, instead exile it with a void counter on it.", 'Creature — Shade', 'D').abilities[0]).toMatchObject({ effect: { type: 'exile_instead', owner: 'opponents', withCounter: 'void' } });
    expect(parse('{T}, Sacrifice this creature: Choose an exiled card an opponent owns with a void counter on it. You may play it this turn without paying its mana cost.', 'Creature — Shade', 'D').abilities[0]).toMatchObject({ effects: [{ type: 'play_exiled', filter: { zone: 'exile', owner: 'opponent', counter: 'void' }, free: true }] });
    expect(parse('Spells your opponents cast that target this creature cost an additional 3 life to cast.', 'Creature — Dragon', 'T').abilities[0]).toMatchObject({ effect: { type: 'target_life_tax', life: 3 } });
  });
  it('reads Etali and Isochron Scepter', () => {
    expect(parse("Whenever ~ attacks, exile the top card of each player's library, then you may cast any number of spells from among those cards without paying their mana costs.", 'Legendary Creature — Dinosaur', 'E').abilities[0]).toMatchObject({ effects: [{ type: 'exile_top', who: { ref: 'players', who: 'each' } }, { type: 'cast_among_free', what: { ref: 'created' } }] });
    expect(parse('{2}, {T}: You may copy the exiled card. If you do, you may cast the copy without paying its mana cost.', 'Artifact', 'I').abilities[0]).toMatchObject({ effects: [{ type: 'cast_copy_of', what: { ref: 'exiled_with' } }] });
  });
  it('reads each player searching, paired searches, batched graveyard triggers, filtered token triplers and more', () => {
    expect(parse('Each player searches their library for a basic land card, puts it onto the battlefield, then shuffles.', 'Sorcery', 'F').abilities[0]).toMatchObject({ effects: [{ type: 'search', who: { ref: 'players', who: 'each' }, to: 'battlefield' }] });
    expect(parse('Search your library for a Forest card and a Plains card, put them onto the battlefield tapped, then shuffle.', 'Sorcery', 'K').abilities[0]).toMatchObject({ effects: [{ type: 'search', filters: [{ subtypes: ['Forest'] }, { subtypes: ['Plains'] }], amount: 2, tapped: true }] });
    expect(parse('Whenever one or more land cards are put into your graveyard from anywhere, draw a card.', 'Legendary Creature — Frog Horror', 'G').abilities[0]).toMatchObject({ trigger: { type: 'put_into_graveyard', batch: true, subject: { filter: { types: ['Land'], owner: 'you', token: false } } } });
    expect(parse('If one or more creature tokens would be created under your control, three times that many of those tokens are created instead.', 'Legendary Creature — God', 'O').abilities[0]).toMatchObject({ effect: { type: 'replace_quantity', event: 'tokens', op: 'triple', tokenFilter: { types: ['Creature'] } } });
    expect(parse("When ~ dies, return it to the battlefield tapped and transformed under its owner's control.", 'Legendary Creature — God', 'O').abilities[0]).toMatchObject({ effects: [{ type: 'move', to: 'battlefield', tapped: true, transformed: true }] });
    expect(parse('{2}{W}, {T}: Transform this land. Activate only if you attacked with three or more creatures this turn and only as a sorcery.', 'Land', 'T').abilities[0]).toMatchObject({ timing: 'sorcery', activateIf: { type: 'attacked_with', n: 3 } });
    expect(parse("At the beginning of your upkeep, put target creature card from a graveyard onto the battlefield under your control. It's a Phyrexian in addition to its other types.", 'Artifact', 'P').abilities[0]).toMatchObject({ effects: [{ type: 'move' }, { type: 'modify', subtypes: ['Phyrexian'], retainTypes: true }] });
    expect(parse('At the beginning of your upkeep, if you control the artifact with the greatest mana value or tied for the greatest mana value, draw a card.', 'Legendary Creature — Vedalken Artificer', 'P').abilities[0]).toMatchObject({ condition: { type: 'greatest_mv', filter: { types: ['Artifact'] } } });
    expect(parse('{B}, Sacrifice X Squirrels: Target creature gets +X/-X until end of turn.', 'Legendary Creature — Squirrel Warrior', 'C').abilities[0]).toMatchObject({ cost: { other: [{ type: 'sacrifice', amount: 'X', filter: { subtypes: ['Squirrel'] } }] } });
  });
});

describe('slice 163', () => {
  it('reads twice X, the first combat phase, Expressive Iteration, Noxious Gearhulk and Mirror Entity', () => {
    expect(parse('Create twice X 1/1 black and green Pest creature tokens.', 'Sorcery', 'P').abilities[0]).toMatchObject({ effects: [{ type: 'create_token', amount: { kind: 'x', times: 2 } }] });
    expect(parse("Whenever equipped creature attacks, if it's the first combat phase of the turn, untap it. After this phase, there is an additional combat phase.", 'Artifact — Equipment', 'G').abilities[0]).toMatchObject({ condition: { type: 'first_combat' } });
    expect(parse('Look at the top three cards of your library. Put one of them into your hand, put one of them on the bottom of your library, and exile one of them. You may play the exiled card this turn.', 'Instant', 'E').abilities[0]).toMatchObject({ effects: [{ type: 'look_sort', amount: 3, slots: ['hand', 'bottom', 'exile_play'] }] });
    expect(parse('When this creature enters, you may destroy another target creature. If a creature is destroyed this way, you gain life equal to its toughness.', 'Artifact Creature — Construct', 'N').abilities[0]).toMatchObject({ effects: [{ type: 'may' }, { type: 'if', cond: { type: 'amount', amount: { kind: 'moved_this_way', how: 'destroyed' } } }] });
    expect(parse('{X}: Until end of turn, creatures you control have base power and toughness X/X and gain all creature types.', 'Creature — Shapeshifter', 'M').abilities[0]).toMatchObject({ effects: [{ type: 'modify', setPower: 'X', setToughness: 'X', allCreatureTypes: true, until: 'eot' }] });
  });
  it('reads activated ability cost reductions, Demonic Consultation and Tainted Pact', () => {
    expect(parse("Activated abilities of creatures you control cost {2} less to activate. This effect can't reduce the mana in that cost to less than one mana.", 'Enchantment', 'T').abilities[0]).toMatchObject({ effect: { type: 'ability_cost_reduction', amount: 2, minOne: true, filter: { types: ['Creature'], controller: 'you' } } });
    expect(parse("Abilities you activate that aren't mana abilities cost {2} less to activate. This effect can't reduce the mana in that cost to less than one mana.", 'Legendary Creature — Elemental Fox', 'Z').abilities[0]).toMatchObject({ effect: { type: 'ability_cost_reduction', byYou: true } });
    expect(parse('Choose a card name. Exile the top six cards of your library, then reveal cards from the top of your library until you reveal a card with the chosen name. Put that card into your hand and exile all other cards revealed this way.', 'Instant', 'D').abilities[0]).toMatchObject({ effects: [{ type: 'name_and_dig', exileFirst: 6 }] });
    expect(parse('Exile the top card of your library. You may put that card into your hand unless it has the same name as another card exiled this way. Repeat this process until you put a card into your hand or you exile two cards with the same name, whichever comes first.', 'Instant', 'T').abilities[0]).toMatchObject({ effects: [{ type: 'tainted_pact' }] });
  });
});

describe('slice 164', () => {
  it('reads X/X tokens, the exiled card, Soul Shatter, Scapeshift and Ad Nauseam', () => {
    expect(parse("When this creature leaves the battlefield, the exiled card's owner creates an X/X blue Illusion creature token, where X is the mana value of the exiled card.", 'Creature — Kor Spirit', 'S').abilities[0]).toMatchObject({ effects: [{ type: 'create_token', who: { ref: 'owner_of', of: { ref: 'exiled_with' } }, size: { kind: 'stat', stat: 'mana_value', of: { ref: 'exiled_with' } } }] });
    expect(parse('Create X X/X green Ooze creature tokens.', 'Sorcery', 'G').abilities[0]).toMatchObject({ effects: [{ type: 'create_token', amount: 'X', size: 'X' }] });
    expect(parse('Each opponent sacrifices a creature or planeswalker with the greatest mana value among creatures and planeswalkers they control.', 'Instant', 'S').abilities[0]).toMatchObject({ effects: [{ type: 'sacrifice_choice', filter: { types: ['Creature', 'Planeswalker'] }, greatest: 'mana_value' }] });
    expect(parse('Sacrifice any number of lands. Search your library for up to that many land cards, put them onto the battlefield tapped, then shuffle.', 'Sorcery', 'S').abilities[0]).toMatchObject({ effects: [{ type: 'sacrifice_choice', anyNumber: true }, { type: 'search', amount: { kind: 'moved_this_way', how: 'sacrificed' }, upTo: true, tapped: true }] });
    expect(parse('Reveal the top card of your library and put that card into your hand. You lose life equal to its mana value. You may repeat this process any number of times.', 'Instant', 'A').abilities[0]).toMatchObject({ effects: [{ type: 'repeat_may', effects: [{ type: 'reveal_top', life: 'lose' }] }] });
  });
  it("reads what was sacrificed, and leaves an X nothing defines unread", () => {
    expect(parse("Target opponent sacrifices a creature of their choice. You gain life equal to that creature's toughness.", 'Instant', 'T').abilities[0]).toMatchObject({ effects: [{ type: 'sacrifice_choice' }, { type: 'gain_life', amount: { kind: 'cost_lki', cost: 'sacrificed', stat: 'toughness' } }] });
    expect(parse('Whenever this creature attacks, you may sacrifice a Blood token. If you do, it gets +2/+2 until end of turn.', 'Creature — Vampire', 'B').abilities[0]).toMatchObject({ effects: [{ type: 'may_do', then: [{ type: 'modify', what: { ref: 'self' } }] }] });
    expect(parse('Whenever a creature dies, draw X cards.', 'Enchantment', 'D').unparsed).toHaveLength(1);
    expect(parse('When this enchantment enters, create an X/X green Treefolk creature token.', 'Enchantment', 'A').unparsed).toHaveLength(0);
  });
});

describe('slice 165', () => {
  it('reads cards put from among the milled cards, and paying life to do something', () => {
    expect(parse('Whenever ~ attacks, mill three cards. You may put a land card from among them into your hand.', 'Legendary Creature — Wolf', 'S').abilities[0]).toMatchObject({ effects: [{ type: 'mill', amount: 3 }, { type: 'put_from_milled', filter: { types: ['Land'] }, amount: 1, to: 'hand', optional: true }] });
    expect(parse('Mill ten cards. Put up to two creature cards from among the milled cards onto the battlefield.', 'Sorcery', 'V').abilities[0]).toMatchObject({ effects: [{ type: 'mill' }, { type: 'put_from_milled', amount: 2, to: 'battlefield', optional: true }] });
    expect(parse('Whenever this creature enters or attacks, mill five cards. You may put a creature card and/or a land card from among them into your hand.', 'Creature — Zombie Giant', 'S').abilities[0]).toMatchObject({ effects: [{ type: 'mill' }, { type: 'put_from_milled', each: [{ types: ['Creature'] }, { types: ['Land'] }], amount: 2 }] });
    expect(parse('At the beginning of your upkeep, you may pay {1} and 3 life. If you do, draw a card.', 'Enchantment', 'R').abilities[0]).toMatchObject({ effects: [{ type: 'may_pay', cost: '{1}', life: 3 }] });
    expect(parse('Whenever another creature you control dies, you may pay 2 life. If you do, draw a card.', 'Legendary Enchantment Creature — God', 'E').abilities[0]).toMatchObject({ effects: [{ type: 'may_pay', cost: '', life: 2 }] });
  });
  it('reads modified, even mana values, granted retrace, Emry, Urza and Nesting Grounds', () => {
    expect(parse('Modified creatures you control have trample.', 'Legendary Creature — Spirit', 'K').abilities[0]).toMatchObject({ effect: { affected: { filter: { modified: true, controller: 'you' } }, keywords: [{ id: 'trample' }] } });
    expect(parse("Your opponents can't block with creatures with even mana values.", 'Creature — Eldrazi', 'V').abilities[0]).toMatchObject({ effect: { affected: { filter: { manaValueParity: 'even', controller: 'opponent' } }, rules: ['cant_block'] } });
    expect(parse('During your turn, nonland permanent cards in your graveyard have retrace.', 'Legendary Creature — Wolf', 'S').abilities[0]).toMatchObject({ effect: { type: 'grant_retrace', yourTurn: true, filter: { notTypes: ['Land'] } } });
    expect(parse('{T}: Choose target artifact card in your graveyard. You may cast that card this turn.', 'Legendary Creature — Merfolk Wizard', 'E').abilities[0]).toMatchObject({ effects: [{ type: 'grant_play', what: { ref: 'target', index: 0 }, mode: 'cast' }] });
    expect(parse('{5}: Shuffle your library, then exile the top card. Until end of turn, you may play that card without paying its mana cost.', 'Legendary Artifact Creature — Human Artificer', 'U').abilities[0]).toMatchObject({ effects: [{ type: 'shuffle' }, { type: 'exile_top', play: { mode: 'play', until: 'eot', free: true } }] });
    expect(parse('{1}, {T}: Move a counter from target permanent you control onto a second target permanent.', 'Land', 'N').abilities[0]).toMatchObject({ effects: [{ type: 'move_counters', counter: 'any' }] });
  });
});

describe('slice 166', () => {
  it('reads digs of X cards, any number, the rest into your hand or shuffled, and one-card reveals', () => {
    expect(parse('{3}, {T}, Discard a card: Look at the top X cards of your library, where X is the number of artifacts you control. Put one of those cards into your hand and the rest on the bottom of your library in a random order.', 'Artifact', 'F').abilities[0]).toMatchObject({ effects: [{ type: 'dig', amount: { kind: 'count', filter: { types: ['Artifact'], controller: 'you' } }, take: 1, to: 'hand' }] });
    expect(parse('When ~ enters, look at the top five cards of your library. You may reveal any number of Rat cards from among them and put the revealed cards into your hand. Put the rest on the bottom of your library in a random order.', 'Legendary Creature — Rat', 'K').abilities[0]).toMatchObject({ effects: [{ type: 'dig', take: 99, optional: true, filter: { subtypes: ['Rat'] } }] });
    expect(parse('Look at the top five cards of your library. Put any number of permanent cards from among them onto the battlefield and the rest into your hand.', 'Sorcery', 'G').abilities[0]).toMatchObject({ effects: [{ type: 'dig', take: 99, to: 'battlefield', rest: 'hand' }] });
    expect(parse("When this creature enters, look at the top X cards of your library, where X is this creature's power. Put any number of land cards from among them onto the battlefield tapped, then shuffle.", 'Creature — Worm', 'W').abilities[0]).toMatchObject({ effects: [{ type: 'dig', rest: 'shuffle', tapped: true }] });
    expect(parse("{4}: Scry 1, then reveal the top card of your library. If it's a land card, put it onto the battlefield tapped. Otherwise, draw a card.", 'Legendary Creature — Merfolk Wizard', 'T').abilities[0]).toMatchObject({ effects: [{ type: 'scry' }, { type: 'dig', to: 'battlefield', ifNone: [{ type: 'draw' }] }] });
    expect(parse("Whenever a Ninja you control deals combat damage to a player, reveal the top card of your library and put that card into your hand. Each opponent loses life equal to that card's mana value.", 'Legendary Creature — Human Ninja', 'Y').abilities[0]).toMatchObject({ effects: [{ type: 'reveal_top' }, { type: 'lose_life', amount: { kind: 'stat', stat: 'mana_value', of: { ref: 'created' } } }] });
  });
  it('reads a card chosen from your graveyard, Gemstone Caverns and Secluded Courtyard', () => {
    expect(parse('Mill three cards, then you may return a creature or land card from your graveyard to your hand.', 'Sorcery', 'G').abilities[0]).toMatchObject({ effects: [{ type: 'mill' }, { type: 'may', effects: [{ type: 'return_chosen', filter: { types: ['Creature', 'Land'] }, to: 'hand' }] }] });
    expect(parse('Return up to three target land cards from your graveyard to your hand.', 'Sorcery', 'L').abilities[0]).toMatchObject({ targets: [{ upTo: true }] });
    expect(parse("If this card is in your opening hand and you're not the starting player, you may begin the game with ~ on the battlefield with a luck counter on it. If you do, exile a card from your hand.", 'Legendary Land', 'G').abilities[0]).toMatchObject({ effect: { type: 'begin_on_battlefield', notStarting: true, counter: 'luck', exileFromHand: 1 } });
    expect(parse('{T}: Add {C}. If ~ has a luck counter on it, instead add one mana of any color.', 'Legendary Land', 'G').abilities[0]).toMatchObject({ effects: [{ type: 'if' }] });
    expect(parse('{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type or activate an ability of a creature source of the chosen type.', 'Land', 'S').unparsed).toHaveLength(0);
  });
});

describe('slice 167', () => {
  it('reads mana multipliers, Caged Sun, combat limits, connive X and X targets', () => {
    expect(parse('If you tap a permanent for mana, it produces three times as much of that mana instead.', 'Creature — Elemental', 'N').abilities[0]).toMatchObject({ effect: { type: 'mana_multiplier', factor: 3 } });
    expect(parse("Whenever a land's ability causes you to add one or more mana of the chosen color, add an additional one mana of that color.", 'Artifact', 'C').abilities[0]).toMatchObject({ trigger: { type: 'tapped_for_mana', producedColor: 'chosen' }, effects: [{ type: 'add_mana', options: [['chosen']] }] });
    expect(parse('No more than one creature can block each combat.', 'Artifact Creature — Construct', 'S').abilities[0]).toMatchObject({ effect: { type: 'combat_limit', what: 'block', amount: 1 } });
    expect(parse('No more than two creatures can attack you each combat.', 'Artifact', 'C').abilities[0]).toMatchObject({ effect: { type: 'combat_limit', what: 'attack', amount: 2, you: true } });
    expect(parse('{B}, {T}: Target creature you control connives X, where X is the number of creatures that died this turn.', 'Artifact', 'S').abilities[0]).toMatchObject({ effects: [{ type: 'connive', amount: { kind: 'died_this_turn' } }] });
    expect(parse('~ deals five times X damage to each of up to X targets.', 'Sorcery', 'C').abilities[0]).toMatchObject({ targets: [{ what: 'any', countX: true, upTo: true }], effects: [{ type: 'deal_damage', amount: { kind: 'x', times: 5 } }] });
  });
  it('reads halves, rounded up or down', () => {
    expect(parse('When ~ enters, put X +1/+1 counters on him. Then draw half X cards, rounded down.', 'Legendary Creature — Bird Spirit', 'W').abilities[0]).toMatchObject({ effects: [{ type: 'add_counters', what: { ref: 'self' } }, { type: 'draw', amount: { kind: 'x', half: 'down' } }] });
    expect(parse('When you cast this spell, you gain half X life and draw half X cards. Round down each time.', 'Creature — Jellyfish Hydra Beast', 'H').abilities[0]).toMatchObject({ effects: [{ type: 'gain_life', amount: { kind: 'x', half: 'down' } }, { type: 'draw', amount: { kind: 'x', half: 'down' } }] });
    expect(parse('Whenever equipped creature deals combat damage to a player, that player loses half their life, rounded up.', 'Artifact — Equipment', 'Q').abilities[0]).toMatchObject({ effects: [{ type: 'lose_life', amount: { kind: 'life', half: 'up' } }] });
    expect(parse('Target player mills half their library, rounded down.', 'Sorcery', 'T').abilities[0]).toMatchObject({ effects: [{ type: 'mill', amount: { kind: 'cards', zone: 'library', half: 'down' } }] });
    expect(parse('At the beginning of your upkeep, create X 2/2 black Zombie creature tokens, where X is half the number of Zombies you control, rounded down.', 'Enchantment', 'E').abilities[0]).toMatchObject({ effects: [{ type: 'create_token', amount: { kind: 'count', half: 'down' } }] });
    expect(parse('Each opponent loses half their life, rounded up.', 'Sorcery', 'E').unparsed).toHaveLength(1);
  });
});

describe('slice 168', () => {
  it('reads Sneak Attack, Obscuring Haze, Final Fortune, Fell the Mighty and Gratuitous Violence', () => {
    expect(parse('{R}: You may put a creature card from your hand onto the battlefield. That creature gains haste. Sacrifice the creature at the beginning of the next end step.', 'Enchantment', 'S').abilities[0]).toMatchObject({ effects: [{ type: 'may' }, { type: 'modify', what: { ref: 'created' } }, { type: 'delayed', effects: [{ type: 'sacrifice', what: { ref: 'created' } }] }] });
    expect(parse('Prevent all damage that would be dealt this turn by creatures your opponents control.', 'Instant', 'O').abilities[0]).toMatchObject({ effects: [{ type: 'prevent', amount: 'all', by: { ref: 'all', filter: { controller: 'opponent' } } }] });
    expect(parse("Take an extra turn after this one. At the beginning of that turn's end step, you lose the game.", 'Instant', 'F').abilities[0]).toMatchObject({ effects: [{ type: 'extra_turn' }, { type: 'delayed', step: 'end', laterTurn: true }] });
    expect(parse("Destroy all creatures with power greater than target creature's power.", 'Sorcery', 'F').abilities[0]).toMatchObject({ effects: [{ type: 'destroy', what: { ref: 'all', filter: { power: { op: 'gt', n: { kind: 'stat', stat: 'power', of: { ref: 'target', index: 0 } } } } } }] });
    expect(parse('If a creature you control would deal damage to a permanent or player, it deals double that damage instead.', 'Enchantment', 'G').abilities[0]).toMatchObject({ effect: { type: 'replace_quantity', event: 'damage', op: 'double', filter: { types: ['Creature'], controller: 'you' } } });
  });
  it('reads Dark Depths, The Water Crystal, karoos, joined spell lines and "becomes blocked by a creature"', () => {
    expect(parse('When ~ has no ice counters on it, sacrifice it. If you do, create Marit Lage, a legendary 20/20 black Avatar creature token with flying and indestructible.', 'Legendary Land', 'D').abilities[0]).toMatchObject({ trigger: { type: 'state' }, effects: [{ type: 'may_do', then: [{ type: 'create_token', token: { name: 'Marit Lage', supertypes: ['Legendary'] } }] }] });
    expect(parse('If an opponent would mill one or more cards, they mill that many cards plus four instead.', 'Legendary Artifact', 'W').abilities[0]).toMatchObject({ effect: { type: 'replace_quantity', event: 'mill', who: 'opponents', op: 'plus', n: 4 } });
    expect(parse("When this land enters, sacrifice it unless you return an untapped Island you control to its owner's hand.", 'Land', 'C').abilities[0]).toMatchObject({ effects: [{ type: 'unless_does', action: [{ type: 'move_chosen' }] }] });
    expect(parse('Counter target noncreature spell unless its controller pays {1}.\nFerocious — If you control a creature with power 4 or greater, counter that spell instead.', 'Instant', 'S').unparsed).toHaveLength(0);
    expect(parse('Whenever ~ becomes blocked by a creature, destroy that creature.', 'Creature — Basilisk', 'S').abilities[0]).toMatchObject({ effects: [{ type: 'destroy', what: { ref: 'trigger_object' } }] });
    expect(parse('Whenever ~ blocks or becomes blocked by a non-Wall creature, destroy that creature at end of combat.', 'Creature — Cockatrice', 'C').abilities[0]).toMatchObject({ trigger: { type: 'blocks', orBlocked: true, other: { notSubtypes: ['Wall'] } }, effects: [{ type: 'delayed', effects: [{ type: 'destroy', what: { ref: 'trigger_object' } }] }] });
  });
});

describe('slice 169 (what pronouns refer to)', () => {
  it('reads "that creature" as the other object, not the source the text just named', () => {
    expect(parse('When a nonblack creature enters, sacrifice ~. If you do, destroy that creature.', 'Enchantment', 'G').abilities[0]).toMatchObject({ effects: [{ type: 'may_do', then: [{ type: 'destroy', what: { ref: 'trigger_object' } }] }] });
    expect(parse('When a player casts a spell, sacrifice ~ and counter that spell.', 'Enchantment', 'H').abilities[0]).toMatchObject({ effects: [{ type: 'sacrifice' }, { type: 'counter', what: { ref: 'trigger_object' } }] });
    expect(parse("Whenever ~ becomes blocked by a creature, that creature's controller loses 2 life and you gain 2 life.", 'Creature — Horror', 'G').abilities[0]).toMatchObject({ effects: [{ type: 'lose_life', who: { ref: 'controller_of', of: { ref: 'trigger_object' } } }, { type: 'gain_life' }] });
    expect(parse('When this Aura enters, if enchanted creature is a Wolf or Werewolf, untap that creature.', 'Enchantment — Aura', 'H').abilities[0]).toMatchObject({ effects: [{ type: 'untap', what: { ref: 'attached' } }] });
  });
  it('reads what a search or manifest found, the target of a line before, and "its power" of a target', () => {
    expect(parse('{T}, Sacrifice ~: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Then if you control four or more lands, untap that land.', 'Land', 'F').abilities[0]).toMatchObject({ effects: [{ type: 'search' }, { type: 'if', effects: [{ type: 'untap', what: { ref: 'created' } }] }] });
    expect(parse('Tap target creature.\nMetalcraft — If you control three or more artifacts, exile that creature.', 'Instant', 'D').abilities[0]).toMatchObject({ effects: [{ type: 'tap' }, { type: 'if', effects: [{ type: 'move', what: { ref: 'target', index: 0 }, to: 'exile' }] }] });
    expect(parse('Manifest the top card of your library, then put two +1/+1 counters on it.', 'Sorcery', 'F').abilities[0]).toMatchObject({ effects: [{ type: 'manifest' }, { type: 'add_counters', what: { ref: 'created' } }] });
    expect(parse('Target creature gets +X/+0 until end of turn, where X is its power.', 'Instant', 'R').abilities[0]).toMatchObject({ effects: [{ type: 'modify', power: { kind: 'stat', of: { ref: 'target', index: 0 } } }] });
    expect(parse('{T}: ~ deals damage equal to its power to target creature.', 'Creature — Elf', 'J').abilities[0]).toMatchObject({ effects: [{ type: 'deal_damage', amount: { kind: 'stat', of: { ref: 'self' } } }] });
    expect(parse("{1}{B}, {T}, Sacrifice another creature: Draw X cards, where X is that creature's power.", 'Legendary Creature — Human Elf Cleric', 'S').abilities[0]).toMatchObject({ effects: [{ type: 'draw', amount: { kind: 'cost_lki', cost: 'sacrificed', stat: 'power' } }] });
    expect(parse("When this creature enters, target player discards a card. ~ deals damage to that player equal to that card's mana value.", 'Creature — Rat', 'H').abilities[0]).toMatchObject({ effects: [{ type: 'discard' }, { type: 'deal_damage', amount: { kind: 'cost_lki', cost: 'discarded', stat: 'mana_value' } }] });
    expect(parse("At the beginning of your upkeep, put a number of +1/+1 counters on each other creature you control equal to that creature's toughness.", 'Creature — Dragon', 'C').unparsed).toHaveLength(1);
  });
});

describe('slice 170 (targets chosen as it is cast; each creature deals damage)', () => {
  it('reads kicker, gift and addendum targets as a variant, and additive kicker targets', () => {
    expect(parse("Return target creature an opponent controls to its owner's hand. If the gift was promised, instead return target nonland permanent an opponent controls to its owner's hand.", 'Instant', 'I').abilities[0]).toMatchObject({
      targets: [{ filter: { types: ['Creature'] } }],
      variant: { condition: { type: 'paid', cost: 'gift' }, targets: [{ filter: { notTypes: ['Land'] } }] },
    });
    expect(parse('~ deals 4 damage to target creature. If this spell was kicked, it also deals 4 damage to target player or planeswalker.', 'Instant', 'G').abilities[0]).toMatchObject({
      targets: [{}],
      variant: { targets: [{}, {}], effects: [{ type: 'deal_damage' }, { type: 'deal_damage', to: { ref: 'target', index: 1 } }] },
    });
    expect(parse('Exile target artifact or enchantment. If you cast this spell during your main phase, you may exile up to one other target artifact or enchantment.', 'Instant', 'R').abilities[0]).toMatchObject({ variant: { condition: { type: 'cast_in_main_phase' } } });
  });
  it('reads "each creature deals damage", "those creatures", a Spirit back from exile, and granted improvise', () => {
    expect(parse('Each creature deals 1 damage to its controller.', 'Instant', 'R').abilities[0]).toMatchObject({ effects: [{ type: 'each_deals', amount: 1, to: 'controller' }] });
    expect(parse('Each creature deals damage to itself equal to its power.', 'Sorcery', 'W').abilities[0]).toMatchObject({ effects: [{ type: 'each_deals', stat: 'power', to: 'itself' }] });
    expect(parse('Draw a card for each creature you control with a +1/+1 counter on it. Those creatures gain indestructible until end of turn.', 'Instant', 'I').abilities[0]).toMatchObject({
      effects: [{ type: 'draw' }, { type: 'modify', what: { ref: 'all', filter: { counter: '+1/+1', controller: 'you' } } }],
    });
    expect(parse("Exile target creature you control, then return that card to the battlefield under its owner's control. If it's a Spirit, put a +1/+1 counter on it.", 'Instant', 'E').abilities[0]).toMatchObject({
      effects: [{ type: 'move' }, { type: 'move', to: 'battlefield' }, { type: 'if', cond: { type: 'is', filter: { subtypes: ['Spirit'] } } }],
    });
    expect(parse('Nonartifact spells you cast have improvise.', 'Artifact', 'I').abilities[0]).toMatchObject({ effect: { type: 'spell_keyword', keyword: 'improvise', filter: { notTypes: ['Artifact'] } } });
  });
  it("doesn't read an instant as \"that creature\"", () => {
    const r = parse("Target creature gets -4/-0 until end of turn.\nDraw a card.\nAddendum — If you cast this spell during your main phase, tap that creature and it doesn't untap during its controller's next untap step.", 'Instant', 'C');
    expect(r.unparsed).toHaveLength(0);
    expect(JSON.stringify(r.abilities)).not.toContain('"ref":"self"');
    expect(parse('Draw a card. If you cast this spell during your main phase, tap that creature.', 'Instant', 'C').unparsed).toHaveLength(1);
  });
  it('reads keeping permanents and sacrificing the rest, the twelfth counter, life loss doubled and casting from a graveyard', () => {
    expect(parse('Each player chooses from among the permanents they control an artifact, a creature, an enchantment, and a land, then sacrifices the rest.', 'Sorcery', 'C').abilities[0]).toMatchObject({ effects: [{ type: 'keep_choose', slots: [{ types: ['Artifact'] }, {}, {}, { types: ['Land'] }] }] });
    expect(parse('Each player chooses six lands they control, then sacrifices the rest.', 'Sorcery', 'P').abilities[0]).toMatchObject({ effects: [{ type: 'keep_choose', pool: { types: ['Land'] }, count: 6 }] });
    expect(parse('When the twelfth hour counter is put on ~, draw seven cards.', 'Artifact', 'M').abilities[0]).toMatchObject({ trigger: { type: 'counters_put', counter: 'hour', reaches: 12 } });
    expect(parse('If an opponent would lose life during your turn, they lose twice that much life instead.', 'Creature — Vampire Demon', 'B').abilities[0]).toMatchObject({ effect: { type: 'replace_quantity', event: 'lose_life', op: 'double', yourTurn: true } });
    expect(parse('Draw a card. If this spell was cast from a graveyard, draw two cards instead.', 'Sorcery', 'P').abilities[0]).toMatchObject({ effects: [{ type: 'if', cond: { type: 'cast_by_you', from: 'graveyard' } }] });
    expect(parse('As ~ enters, choose artifact, creature, enchantment, instant, or sorcery.', 'Artifact', 'K').abilities[0]).toMatchObject({ effect: { type: 'as_enters', choice: 'card_type', options: ['Artifact', 'Creature', 'Enchantment', 'Instant', 'Sorcery'] } });
  });
});

describe('slice 171', () => {
  it('reads three events for one player, lands entering untapped, base power and counted mana values', () => {
    expect(parse('Whenever an opponent attacks you with two or more creatures, draws their second card each turn, or casts their second spell each turn, you draw a card.', 'Enchantment', 'T').abilities[0]).toMatchObject({ trigger: { type: 'either', of: [{ type: 'you_attack' }, { type: 'draw', nth: 2 }, { type: 'cast', nth: 2 }] } });
    expect(parse('If an opponent would begin an extra turn, that player skips that turn instead.', 'Enchantment', 'T').abilities[0]).toMatchObject({ effect: { type: 'player_rule', who: 'opponents', rule: 'skip_extra_turns' } });
    expect(parse('Lands you control enter untapped.', 'Enchantment', 'S').abilities[0]).toMatchObject({ effect: { type: 'enter_untapped_others', filter: { types: ['Land'], controller: 'you' } } });
    expect(parse('Whenever one or more creatures you control each with power greater than its base power deals combat damage to a player, draw a card.', 'Legendary Creature — Cat Warrior', 'K').abilities[0]).toMatchObject({ trigger: { type: 'combat_damage_batch', filter: { powerAboveBase: true } } });
    expect(parse('Search your library for a card with mana value less than or equal to the number of lands you control, reveal it, put it into your hand, then shuffle.', 'Sorcery', 'B').abilities[0]).toMatchObject({ effects: [{ type: 'search', filter: { manaValue: { op: 'le', n: { kind: 'count', filter: { types: ['Land'], controller: 'you' } } } } }] });
    // Not as a target: it couldn't be checked as targets are chosen.
    expect(parse('Destroy target creature with mana value less than or equal to the number of lands you control.', 'Sorcery', 'D').unparsed).toHaveLength(1);
    expect(parse('At the beginning of your upkeep, you may move any number of +1/+1 counters from ~ onto other creatures.', 'Creature — Elemental', 'F').abilities[0]).toMatchObject({ effects: [{ type: 'may', effects: [{ type: 'move_counters', distribute: true }] }] });
  });
});

describe('slice 172', () => {
  it('reads "this turn" triggered abilities, excess damage and draw stealing', () => {
    expect(parse('Choose target creature you control. Whenever that creature deals combat damage to a player or planeswalker this turn, draw that many cards.', 'Instant', 'H').abilities[0]).toMatchObject({
      targets: [{}],
      effects: [{ type: 'turn_trigger', ability: { trigger: { type: 'deals_combat_damage', subject: { ref: 'target', index: 0 } }, effects: [{ type: 'draw', amount: { kind: 'event' } }] } }],
    });
    expect(parse('−2: Choose target creature an opponent controls. Whenever you attack this turn, ~ deals 1 damage to that creature.', 'Legendary Planeswalker — Jaya', 'J').abilities[0]).toMatchObject({ effects: [{ type: 'turn_trigger', ability: { effects: [{ type: 'deal_damage', to: { ref: 'target', index: 0 } }] } }] });
    // What follows may belong to the ability: unread.
    expect(parse('Whenever you attack this turn, create two 1/1 red Warrior creature tokens that are tapped and attacking. Sacrifice them at the beginning of the next end step.', 'Sorcery', 'D').unparsed).toHaveLength(1);
    expect(parse("Target creature you control deals damage equal to its power to target creature you don't control. If the creature you control has trample, excess damage is dealt to that creature's controller instead.", 'Instant', 'R').abilities[0]).toMatchObject({ effects: [{ type: 'deal_damage', excessToController: true }] });
    expect(parse('Hell to Pay deals X damage to target creature. Create a number of tapped Treasure tokens equal to the amount of excess damage dealt to that creature this way.', 'Sorcery', 'Hell to Pay').abilities[0]).toMatchObject({ effects: [{ type: 'deal_damage' }, { type: 'create_token', amount: { kind: 'excess_this_way' } }] });
    expect(parse('If an opponent would draw a card except the first one they draw in each of their draw steps, instead that player skips that draw and you draw a card.', 'Creature — Human Rogue', 'N').abilities[0]).toMatchObject({ effect: { type: 'draw_replacement', steal: true, exceptFirst: true } });
  });
  it('reads exile-instead riders, the enchanted creature and the attackers', () => {
    expect(parse('If a nontoken creature an opponent controls would die, instead exile it and you gain 2 life.', 'Legendary Artifact', 'D').abilities[0]).toMatchObject({ effect: { type: 'exile_instead', dies: true, gainLife: 2 } });
    expect(parse("At the beginning of the upkeep of enchanted creature's controller, put a -1/-1 counter on that creature.", 'Enchantment — Aura', 'U').abilities[0]).toMatchObject({ effects: [{ type: 'add_counters', what: { ref: 'attached' } }] });
    expect(parse('Whenever you attack with eight or more creatures, those creatures get +4/+4 until end of turn.', 'Enchantment', 'C').abilities[0]).toMatchObject({ effects: [{ type: 'modify', what: { ref: 'all', filter: { combat: 'attacking' } } }] });
    // An enchantment is never "that creature".
    expect(parse('At the beginning of your upkeep, that creature gains haste until end of turn.', 'Enchantment', 'K').unparsed).toHaveLength(1);
  });
});

describe('slice 173', () => {
  it('reads loyalty −X, keyword counters, "unless it escaped" and what an exile found', () => {
    expect(parse("−X: Exile each permanent with mana value X or less that's one or more colors.", 'Legendary Planeswalker — Ugin', 'U').abilities[0]).toMatchObject({ cost: { loyalty: 0, loyaltyX: -1 }, effects: [{ type: 'move', what: { filter: { manaValue: { op: 'le', n: 'X' } } } }] });
    expect(parse('Put two +1/+1 counters and a flying counter on target creature.', 'Instant', 'G').abilities[0]).toMatchObject({ effects: [{ type: 'add_counters', counter: '+1/+1', amount: 2 }, { type: 'add_counters', counter: 'flying', amount: 1 }] });
    expect(parse('When ~ enters, sacrifice it unless it escaped.', 'Legendary Creature — Elder Giant', 'U').abilities[0]).toMatchObject({ effects: [{ type: 'if', cond: { type: 'paid', cost: 'escape' } }] });
    expect(parse('{G}: Exile target card from a graveyard. If it was a creature card, you gain 1 life.', 'Creature — Ooze', 'S').abilities[0]).toMatchObject({ effects: [{ type: 'move' }, { type: 'if', cond: { type: 'is', of: { ref: 'target', index: 0 }, filter: { types: ['Creature'] } } }] });
    expect(parse("Return each nonland permanent that's not historic to its owner's hand.", 'Instant', 'D').abilities[0]).toMatchObject({ effects: [{ type: 'move', what: { filter: { notHistoric: true } } }] });
    expect(parse('When this creature enters, you gain 3 life and get {E}{E}{E}.', 'Creature — Elemental', 'R').abilities[0]).toMatchObject({ effects: [{ type: 'gain_life' }, { type: 'get_counters', counter: 'energy', amount: 3 }] });
  });
});

describe('slice 174', () => {
  it('reads the qualities of protection the engine can tell apart, and leaves the rest', () => {
    expect(parse('{T}: Another target creature you control gains protection from colorless or from the color of your choice until end of turn.', 'Creature — Kor Cleric', 'Giver of Runes').abilities[0]).toMatchObject({ effects: [{ type: 'modify', keywords: [{ id: 'protection', text: 'colorless or from the color of your choice' }] }] });
    expect(parse("Enchanted creature has protection from black. This effect doesn't remove ~.", 'Enchantment — Aura', 'Black Ward').abilities[0]).toMatchObject({ effect: { keywords: [{ id: 'protection', text: 'black', keeps: 'source' }] } });
    expect(parse("Enchanted creature gets +2/+2 and has protection from each color. This effect doesn't remove Auras.", 'Enchantment — Aura', 'Spectra Ward').abilities[0]).toMatchObject({ effect: { keywords: [{ id: 'protection', text: 'each color', keeps: 'auras' }] } });
    expect(parse('Wraiths you control have protection from Ring-bearers.', 'Legendary Creature — Wraith Noble', 'Lord of the Nazgûl').unparsed).toEqual([]);
    expect(parse('{T}: Choose target permanent you control. Creatures you control gain protection from each of that permanent\'s colors until end of turn.', 'Creature — Human Cleric', 'Samite Elder').unparsed.length).toBe(1);
  });
});

describe('slice 175', () => {
  it('reads counters a spell, leaving without dying, "any number of target players", what was sacrificed or discarded', () => {
    expect(parse('Whenever a spell or ability you control counters a spell, you may draw a card. If you do, discard a card.', 'Legendary Creature — Human Wizard', 'Baral, Chief of Compliance').abilities[0]).toMatchObject({ trigger: { type: 'counters_spell', who: 'you' } });
    expect(parse('Whenever one or more other creatures you control leave the battlefield without dying, draw a card.', 'Creature — Frog Wizard', 'Dour Port-Mage').abilities[0]).toMatchObject({ trigger: { type: 'leaves', batch: true, withoutDying: true } });
    expect(parse('{T}, Sacrifice two other creatures: Any number of target players each lose 2 life and sacrifice a creature of their choice. You add {B}{B} and draw a card.', 'Creature — Human Cleric', 'Priest of Forgotten Gods').abilities[0]).toMatchObject({ targets: [{ what: 'player', count: 100, upTo: true }], effects: [{ type: 'lose_life' }, { type: 'sacrifice_choice' }, { type: 'add_mana' }, { type: 'draw' }] });
    expect(parse("Draw two cards. If the discarded card wasn't a land card, ~ deals 2 damage to each opponent.", 'Sorcery', 'Grab the Prize').abilities[0]).toMatchObject({ effects: [{ type: 'draw' }, { type: 'if', cond: { type: 'lki_was', what: 'discarded', filter: { types: ['Land'] }, not: true } }] });
    expect(parse("Whenever an opponent casts a noncreature spell with mana value less than this creature's power, draw a card.", 'Creature — Frog Wizard', 'Pollywog Prodigy').abilities[0]).toMatchObject({ trigger: { filter: { manaValue: { op: 'lt', n: { kind: 'stat', stat: 'power' } } } } });
    // Each of several target players counting their own cards isn't read.
    expect(parse('Destroy all creatures, then any number of target players each mill half their library, rounded down.', 'Sorcery', 'Singularity Rupture').unparsed.length).toBe(1);
  });
});

describe('slice 176', () => {
  it('reads targeted attach, "attacking you", "each other opponent", mana spent', () => {
    expect(parse('{T}: Attach target Aura or Equipment you control to target creature you control. Activate only as a sorcery.', 'Legendary Artifact Creature — Robot', 'Codsworth, Handy Helper').abilities[0]).toMatchObject({ effects: [{ type: 'attach', what: { ref: 'target', index: 0 }, to: { ref: 'target', index: 1 } }] });
    expect(parse('You gain 3 life for each creature attacking you.', 'Instant', 'Blessed Reversal').abilities[0]).toMatchObject({ effects: [{ type: 'gain_life', amount: { filter: { attackingYou: true } } }] });
    expect(parse('Whenever a commander you control deals combat damage to an opponent, it deals that much damage to each other opponent.', 'Legendary Creature — Elemental Lizard', 'Kediss, Emberclaw Familiar').abilities[0]).toMatchObject({ effects: [{ type: 'deal_damage', to: { ref: 'players', who: 'opponents', except: { ref: 'trigger_player' } } }] });
    expect(parse("Whenever you cast a spell, if the amount of mana spent to cast that spell is greater than ~'s power, put a +1/+1 counter on ~.", 'Legendary Artifact Creature — Thopter', 'Liberator').abilities[0]).toMatchObject({ condition: { type: 'amount', amount: { kind: 'mana_spent' }, op: 'gt' } });
  });
});

describe('slice 177', () => {
  it('reads three kinds of counters, legendary/enchanted filters, per-source damage, summed counts, Song of the Dryads', () => {
    expect(parse('Put a +1/+1 counter, a reach counter, and a deathtouch counter on target creature.', 'Instant', 'Gift of the Viper').abilities[0]).toMatchObject({ effects: [{ counter: '+1/+1' }, { counter: 'reach' }, { counter: 'deathtouch' }] });
    expect(parse("Destroy all creatures that aren't enchanted.", 'Sorcery', 'Winds of Rath').abilities[0]).toMatchObject({ effects: [{ type: 'destroy', what: { filter: { enchanted: false } } }] });
    expect(parse("Whenever a source deals damage to ~, that source's controller sacrifices that many permanents of their choice.", 'Creature — Phyrexian Horror', 'Phyrexian Obliterator').abilities[0]).toMatchObject({ trigger: { perSource: true }, effects: [{ type: 'sacrifice_choice', who: { ref: 'trigger_player' }, amount: { kind: 'event' } }] });
    expect(parse('~ gets +1/+1 for each land you control and each land card in your graveyard.', 'Legendary Creature — Elemental Avatar', 'Multani').abilities[0]).toMatchObject({ effect: { power: { kind: 'sum' } } });
    expect(parse('Enchanted permanent is a colorless Forest land.', 'Enchantment — Aura', 'Song of the Dryads').abilities[0]).toMatchObject({ effect: { setTypes: { types: ['Land'] }, colors: [], landTypes: ['Forest'] } });
    expect(parse("Whenever a creature an opponent controls attacks, if you're the defending player, create a 3/3 red Ogre creature token unless that creature's controller pays {3}.", 'Legendary Creature — Ogre Warrior', 'Kazuul, Tyrant of the Cliffs').abilities[0]).toMatchObject({ trigger: { defender: 'you' }, effects: [{ type: 'unless_pays', payer: { ref: 'controller_of', of: { ref: 'trigger_object' } } }] });
  });
});

describe('slice 178', () => {
  it('reads a counter on a chosen creature, counted mana values, total mana value, Giada', () => {
    expect(parse('Whenever equipped creature deals combat damage to a player, put a +1/+1 counter on a creature you control, then proliferate.', 'Artifact — Equipment', 'Sword of Truth and Justice').abilities[0]).toMatchObject({ effects: [{ type: 'add_counters', choose: { controller: 'you', types: ['Creature'] } }, { type: 'proliferate' }] });
    expect(parse('Put a shield counter on a creature you control. It gains flying until end of turn.', 'Instant', 'Shield Up').abilities[0]).toMatchObject({ effects: [{ counter: 'shield' }, { type: 'modify', what: { ref: 'chosen_object' } }] });
    expect(parse('Whenever a player casts a spell with mana value equal to the number of charge counters on ~, counter that spell.', 'Artifact', 'Chalice of the Void').abilities[0]).toMatchObject({ trigger: { filter: { manaValue: { op: 'eq', n: { kind: 'counters', counter: 'charge' } } } } });
    expect(parse('This spell costs {X} less to cast, where X is the total mana value of historic permanents you control.', 'Legendary Artifact — Equipment', 'Excalibur').abilities[0]).toMatchObject({ effect: { amount: { kind: 'total_power', stat: 'mana_value' } } });
    expect(parse('Each other Angel you control enters with an additional +1/+1 counter on it for each Angel you already control.', 'Legendary Creature — Angel', 'Giada').abilities[0]).toMatchObject({ effect: { type: 'enter_counters_others', notEntering: true } });
  });
});

describe('slice 179', () => {
  it('reads casting the exiled card now and emblems that deal damage', () => {
    expect(parse("+1: Exile the top card of your library. You may cast that card. If you don't, ~ deals 2 damage to each opponent.", 'Legendary Planeswalker — Chandra', 'Chandra, Torch of Defiance').abilities[0]).toMatchObject({ effects: [{ type: 'exile_top' }, { type: 'cast_paid', what: { ref: 'created' }, else: [{ type: 'deal_damage' }] }] });
    expect(parse('−7: You get an emblem with "Whenever you cast a spell, this emblem deals 5 damage to any target."', 'Legendary Planeswalker — Chandra', 'Chandra, Torch of Defiance').unparsed).toEqual([]);
  });

  it('reads bonus mana of any color, the cycling X, "that player\'s turn" and "its activated abilities can\'t be activated"', () => {
    expect(parse('Whenever enchanted land is tapped for mana, its controller adds an additional one mana of any color.', 'Enchantment — Aura').abilities[0]).toMatchObject({ trigger: { type: 'tapped_for_mana' }, effects: [{ type: 'add_mana', anyColor: 1 }] });
    expect(parse('When you cycle this card, create an X/X blue Shark creature token with flying.', 'Enchantment', 'Shark Typhoon').unparsed).toEqual([]);
    expect(parse("Whenever an opponent draws a card, if it isn't that player's turn, create a tapped Treasure token. This ability triggers only once each turn.", 'Creature').abilities[0]).toMatchObject({ condition: { type: 'your_turn', value: false, who: { ref: 'trigger_player' } }, oncePerTurn: true });
    expect(parse('When ~ enters, you draw a card and target opponent may draw a card.', 'Creature', 'Tataru Taru').abilities[0]).toMatchObject({ effects: [{ type: 'draw' }, { type: 'may', who: { ref: 'target', index: 0 } }] });
    expect(parse("Tap target permanent. Its activated abilities can't be activated this turn.", 'Instant').abilities[0]).toMatchObject({ effects: [{ type: 'tap' }, { type: 'modify', rules: ['cant_activate'], until: 'eot' }] });
    expect(parse('Target player gains twice X life.', 'Instant').abilities[0]).toMatchObject({ effects: [{ type: 'gain_life', amount: { kind: 'x', times: 2 } }] });
  });

  it('keeps each zone of "target spell or permanent"', () => {
    expect(parse("When Venser enters, return target spell or permanent to its owner's hand.", 'Legendary Creature — Human Wizard', 'Venser, Shaper Savant').abilities[0]).toMatchObject({ targets: [{ filter: { anyOf: [{ zone: 'stack' }, { zone: 'battlefield' }] } }] });
    expect(parse('Destroy target artifact or creature.', 'Instant').abilities[0]).not.toMatchObject({ targets: [{ filter: { anyOf: [{ zone: 'battlefield' }] } }] });
  });

  it("reads Approach of the Second Sun: a prior cast by name and a library position", () => {
    const p = parse("If this spell was cast from your hand and you've cast another spell named Approach of the Second Sun this game, you win the game. Otherwise, put Approach of the Second Sun into its owner's library seventh from the top and you gain 7 life.", 'Sorcery', 'Approach of the Second Sun');
    expect(p.abilities[0]).toMatchObject({ effects: [{ type: 'if', cond: { type: 'and', all: [{ type: 'cast_by_you', fromHand: true }, { type: 'cast_named_before' }] }, else: [{ type: 'move', to: 'library', position: 7 }, { type: 'gain_life' }] }] });
  });
});

describe('slice 180', () => {
  it('reads maximum hand size, untap restrictions and the legend rule', () => {
    expect(parse("Each opponent's maximum hand size is reduced by seven.", 'Creature').abilities[0]).toMatchObject({ effect: { type: 'player_rule', who: 'opponents', rule: 'hand_size_delta', amount: -7 } });
    expect(parse('Your maximum hand size is twenty.', 'Creature').abilities[0]).toMatchObject({ effect: { rule: 'max_hand_size', amount: 20 } });
    expect(parse("Nonbasic lands don't untap during their controllers' untap steps.", 'Enchantment').abilities[0]).toMatchObject({ effect: { type: 'continuous', rules: ['doesnt_untap'] } });
    expect(parse('The "legend rule" doesn\'t apply to Slivers you control.', 'Creature').abilities[0]).toMatchObject({ effect: { rule: 'no_legend_rule', filter: { subtypes: ['Sliver'] } } });
  });
  it('reads per-object counts, next untap steps and Saw in Half', () => {
    expect(parse('Each creature you control gets +1/+1 for each +1/+1 counter on it.', 'Creature').abilities[0]).toMatchObject({ effect: { power: { kind: 'counters', of: { ref: 'affected' } } } });
    expect(parse('Each nontoken creature you control gets +1/+1 for each other creature you control with the same name as that creature.', 'Artifact').abilities[0]).toMatchObject({ effect: { power: { filter: { sameNameAs: { ref: 'affected' }, otherThan: { ref: 'affected' } } } } });
    expect(parse("Tap all creatures target player controls. Those creatures don't untap during that player's next untap step.", 'Sorcery').abilities[0]).toMatchObject({ effects: [{ type: 'tap' }, { type: 'skip_untap' }] });
    expect(parse("When this creature enters, tap target creature an opponent controls. That creature doesn't untap during its controller's untap step for as long as you control this creature.", 'Creature').abilities[0]).toMatchObject({ effects: [{ type: 'tap' }, { type: 'lock_untap', while: 'controlled' }] });
    expect(parse("Destroy target creature. If that creature dies this way, its controller creates two tokens that are copies of that creature, except their power is half that creature's power and their toughness is half that creature's toughness. Round up each time.", 'Instant', 'Saw in Half').abilities[0]).toMatchObject({ effects: [{ type: 'destroy' }, { type: 'if', effects: [{ type: 'create_token', amount: 2, except: { halfStats: 'up' } }] }] });
  });
});

describe('slice 181', () => {
  it('reads Animate Dead as two linked triggered abilities', () => {
    const p = parse('Enchant creature card in a graveyard\nWhen this Aura enters, if it\'s on the battlefield, it loses "enchant creature card in a graveyard" and gains "enchant creature put onto the battlefield with this Aura." Return enchanted creature card to the battlefield under your control and attach this Aura to it. When this Aura leaves the battlefield, that creature\'s controller sacrifices it.\nEnchanted creature gets -1/-0.', 'Enchantment — Aura', 'Animate Dead');
    expect(p.unparsed).toEqual([]);
    expect(p.abilities.map((a) => (a.kind === 'triggered' ? a.effects[0]!.type : a.kind))).toEqual(['reanimate_attach', 'sacrifice_linked', 'static']);
  });
  it('reads Throne of Eldraine and monocolored', () => {
    expect(parse('{T}: Add four mana of the chosen color. Spend this mana only to cast monocolored spells of that color.', 'Legendary Artifact').abilities[0]).toMatchObject({ effects: [{ type: 'add_mana', options: [['chosen', 'chosen', 'chosen', 'chosen']], spend: { spells: { monocolored: true, chosenColor: true } } }] });
    expect(parse('{3}, {T}: Draw two cards. Spend only mana of the chosen color to activate this ability.', 'Legendary Artifact').abilities[0]).toMatchObject({ payOnly: 'chosen' });
    expect(parse('Exile target monocolored permanent.', 'Instant').abilities[0]).toMatchObject({ targets: [{ filter: { monocolored: true } }] });
  });
  it('reads another payer, Kardur and Gisela', () => {
    expect(parse("At the beginning of the upkeep of enchanted creature's controller, that player may pay {1}{B}. If the player does, untap that creature.", 'Enchantment — Aura').abilities[0]).toMatchObject({ effects: [{ type: 'may_pay', payer: { ref: 'trigger_player' }, effects: [{ type: 'untap', what: { ref: 'attached' } }] }] });
    expect(parse('When ~ enters, until your next turn, creatures your opponents control attack each combat if able and attack a player other than you if able.', 'Legendary Creature — Demon', 'Kardur').abilities[0]).toMatchObject({ effects: [{ type: 'goad', quiet: true }] });
    expect(parse('If a source would deal damage to you or a permanent you control, prevent half that damage, rounded up.', 'Legendary Creature — Angel').abilities[0]).toMatchObject({ effect: { type: 'prevent_damage', half: 'up', toYou: true } });
  });
});

describe('slice 182', () => {
  it('reads "can\'t have or gain" and keeps Arrest\'s activation lock', () => {
    expect(parse("Creatures your opponents control lose hexproof and can't have or gain hexproof.", 'Enchantment Creature — Boar').abilities[0]).toMatchObject({ effect: { loseKeywords: ['hexproof'], cantHave: ['hexproof'] } });
    expect(parse("{1}, {T}: Until end of turn, creatures your opponents control lose hexproof and shroud and can't have hexproof or shroud.", 'Land').abilities[0]).toMatchObject({ effects: [{ type: 'modify', cantHave: ['hexproof', 'shroud'], until: 'eot' }] });
    expect(parse("Enchanted creature can't attack or block, and its activated abilities can't be activated.", 'Enchantment — Aura').abilities[0]).toMatchObject({ effect: { rules: ['cant_attack', 'cant_block', 'cant_activate'] } });
    expect(parse("At the beginning of the upkeep of enchanted creature's controller, that player may pay {4}. If the player does, untap the creature.", 'Enchantment — Aura').abilities[0]).toMatchObject({ effects: [{ type: 'may_pay', effects: [{ type: 'untap', what: { ref: 'attached' } }] }] });
  });
  it('reads upkeep and end step conditions', () => {
    expect(parse("At the beginning of each player's upkeep, if that player has no cards in hand, that player draws three cards.", 'Artifact').abilities[0]).toMatchObject({ condition: { type: 'hand', who: { ref: 'trigger_player' } }, effects: [{ type: 'draw', amount: 3, who: { ref: 'trigger_player' } }] });
    expect(parse("At the beginning of your end step, if you control three or more permanents you don't own, draw three cards.", 'Creature').abilities[0]).toMatchObject({ condition: { type: 'count', filter: { owner: 'opponent' }, min: 3 } });
    expect(parse("At the beginning of your end step, if you didn't activate a loyalty ability of a planeswalker this turn, you lose 2 life.", 'Legendary Artifact').abilities[0]).toMatchObject({ condition: { type: 'not', cond: { type: 'this_turn', event: 'you_activated_loyalty' } } });
    expect(parse('At the beginning of your end step, draw a card if your life total is greater than your starting life total. Otherwise, you gain 2 life.', 'Artifact').abilities[0]).toMatchObject({ effects: [{ type: 'if', cond: { type: 'life', op: 'gt', starting: true } }] });
    expect(parse('At the beginning of your upkeep, you may discard all the cards in your hand. If you do, draw that many cards.', 'Enchantment').abilities[0]).toMatchObject({ effects: [{ type: 'may', effects: [{ type: 'wheel', mode: 'all' }] }] });
  });
});

describe('slice 183', () => {
  it('counts for each player', () => {
    expect(parse('At the beginning of each end step, each opponent loses life equal to the life that player lost this turn.', 'Creature').abilities[0]).toMatchObject({ effects: [{ type: 'lose_life', amount: { kind: 'life_this_turn', player: { ref: 'each_player' }, stat: 'lost' }, who: { ref: 'players' } }] });
    expect(parse('Each player draws cards equal to the number of creatures they control.', 'Sorcery').abilities[0]).toMatchObject({ effects: [{ type: 'draw', amount: { kind: 'count', filter: { controlledBy: { ref: 'each_player' } } } }] });
    // Not for effects the engine doesn't count per player.
    expect(parse('Each player creates a 1/1 white Soldier creature token for each creature they control.', 'Sorcery').unparsed).toHaveLength(1);
  });
  it('reads waterbend costs', () => {
    expect(parse('Waterbend {3}, {T}: Tap target creature an opponent controls.', 'Creature').abilities[0]).toMatchObject({ cost: { waterbend: 3, mana: '{3}', tap: true } });
  });
  it('reads airbend', () => {
    expect(parse('When Aang enters, airbend up to one other target creature or spell.', 'Legendary Creature — Human Avatar Ally', 'Aang').abilities[0]).toMatchObject({ targets: [{ upTo: true }], effects: [{ type: 'airbend', what: { ref: 'target', index: 0 } }] });
  });
  it('reads earthbend', () => {
    expect(parse('When this creature enters, earthbend 1.', 'Creature — Badger Mole').abilities[0]).toMatchObject({ targets: [{ filter: { types: ['Land'], controller: 'you' } }], effects: [{ type: 'modify', setPower: 0, keywords: [{ id: 'haste' }] }, { type: 'add_counters', amount: 1 }, { type: 'delayed_leave' }] });
  });
});

describe('slice 185', () => {
  it('reads "choose one that hasn\'t been chosen"', () => {
    const turn = parse("Whenever you discard a card, choose one that hasn't been chosen this turn —\n• Draw a card.\n• Create a Treasure token.\n• Each opponent loses 3 life.", 'Artifact');
    expect(turn.abilities[0]).toMatchObject({ kind: 'triggered', modes: { min: 1, max: 1, unchosen: 'turn' } });
    const ever = parse("{2}, {T}: Choose one that hasn't been chosen —\n• Draw a card.\n• You gain 3 life.", 'Artifact');
    expect(ever.abilities[0]).toMatchObject({ kind: 'activated', modes: { unchosen: 'ever' } });
    // Lita: the header ends with a period.
    expect(parse("Whenever another creature you control enters, choose one that hasn't been chosen this turn.\n• Create a Food token.\n• Scry 1.", 'Creature').abilities[0]).toMatchObject({ modes: { unchosen: 'turn' } });
  });
  it('reads "you may pay {X}"', () => {
    expect(parse('Whenever you gain life, you may pay {X}, where X is less than or equal to the amount of life you gained. If you do, draw X cards.', 'Artifact').abilities[0]).toMatchObject({ effects: [{ type: 'may_pay', cost: '{X}', maxX: { kind: 'event' }, effects: [{ type: 'draw', amount: 'X' }] }] });
    expect(parse("At the beginning of your end step, you may pay {X}. If you do, draw X cards. X can't be greater than the amount of life you gained this turn.", 'Creature').abilities[0]).toMatchObject({ effects: [{ type: 'may_pay', maxX: { kind: 'life_this_turn' } }] });
    expect(parse("At the beginning of your upkeep, put a +1/+1 counter on this creature. Then you may pay {X}, where X is the number of +1/+1 counters on it. If you don't, tap this creature and it deals X damage to you.", 'Creature').abilities[0]).toMatchObject({ effects: [{ type: 'add_counters' }, { type: 'may_pay', xIs: { kind: 'counters' }, else: [{ type: 'tap' }, { type: 'deal_damage', amount: 'X' }] }] });
    expect(parse('Whenever another creature you control enters, you may pay {X}. When you do, put X +1/+1 counters on that creature.', 'Creature').abilities[0]).toMatchObject({ effects: [{ type: 'may_pay', cost: '{X}', effects: [{ type: 'reflexive' }] }] });
  });
  it('reads tempting offers', () => {
    const glory = parse('Tempting offer — Put a +1/+1 counter on each creature you control. Each opponent may put a +1/+1 counter on each creature they control. For each opponent who does, put a +1/+1 counter on each creature you control.', 'Sorcery');
    expect(glory.abilities[0]).toMatchObject({ effects: [{ type: 'add_counters' }, { type: 'tempting_offer', theirs: [{ type: 'add_counters', what: { filter: { controller: 'you' } } }], mine: [{ type: 'add_counters' }] }] });
    const discovery = parse('Tempting offer — Search your library for a land card and put it onto the battlefield. Each opponent may search their library for a land card and put it onto the battlefield. For each opponent who searches a library this way, search your library for a land card and put it onto the battlefield. Then each player who searched a library this way shuffles.', 'Sorcery');
    expect(discovery.abilities[0]).toMatchObject({ effects: [{ type: 'search' }, { type: 'tempting_offer', theirs: [{ type: 'search' }], mine: [{ type: 'search' }] }] });
  });
});
