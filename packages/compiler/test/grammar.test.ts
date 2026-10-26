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
    expect(parse('Draw a card for each creature you control.').unparsed).toHaveLength(1);
    expect(parse('Choose one —\n• Destroy target artifact.\n• Exile the top card of your library. You may play it this turn.').unparsed).toHaveLength(3);
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
