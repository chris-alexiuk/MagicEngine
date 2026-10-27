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
