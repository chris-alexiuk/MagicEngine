/**
 * Mechanics read from their definitions: a keyword action from CR 701, a keyword from CR 702, and — only for a word the
 * rules don't have yet — the reminder text printed on the card. What each then does at the table is tested in the
 * engine (test/defined-mechanics.test.ts there); here, what is read and what is left alone.
 */
import { describe, expect, it } from 'vitest';
import { compileCards } from '../src/compile.js';
import { DESIGNATIONS } from '../src/designations.js';
import { normaliseSelf } from '../src/parser.js';
import type { ScryfallCard } from '../src/scryfall.js';

const card = (name: string, type_line: string, oracle_text: string): ScryfallCard =>
  ({ object: 'card', id: `${name}-id`, oracle_id: `${name}-oracle`, name, layout: 'normal', mana_cost: '{1}{R}', cmc: 2, type_line, oracle_text, colors: ['R'], color_identity: ['R'], legalities: { commander: 'legal' }, set: 'tst', rarity: 'common', games: ['paper'] }) as unknown as ScryfallCard;
/** One card, compiled as a pool of one — or with the others a set would bring (a Borg, so that "Borg" is a creature type). */
const compile = (oracle_text: string, type_line = 'Creature — Elf', name = 'Probe') => compileCards([card(name, type_line, oracle_text), card('Drone', 'Artifact Creature — Borg', '')]).db.cards.find((c) => c.name === name)!;
const read = (oracle_text: string, type_line?: string, name?: string) => {
  const c = compile(oracle_text, type_line, name);
  return { grade: c.automation, unread: [...c.faces[0]!.unparsed, ...(c.faces[0]!.manualKeywords ?? [])], keywords: c.faces[0]!.keywords, abilities: c.faces[0]!.abilities };
};
const ASSIMILATE = "(Put it onto the battlefield under your control with a +1/+1 counter. It's a Borg artifact creature and loses all other creature types.)";

describe('a keyword action the rules define (CR 701)', () => {
  it('recruit is its definition, wherever a card says it', () => {
    const effects = [
      { type: 'draw', amount: 1, who: { ref: 'you' } },
      { type: 'discard', amount: 1, who: { ref: 'you' } },
      { type: 'if', cond: { type: 'lki_was', what: 'discarded', filter: { notTypes: ['Land'] } }, effects: [{ type: 'create_token', amount: 1 }] },
    ];
    for (const text of ['When this creature enters, recruit.', 'Whenever an opponent casts their first noncreature spell each turn, you recruit.', '{2}, {T}: Recruit.']) {
      const r = read(text);
      expect([text, r.grade]).toEqual([text, 'full']);
      expect(r.abilities[0]).toMatchObject({ effects });
    }
    // Inside a condition: "If that spell's mana value was 2 or less, recruit."
    expect(read("Counter target spell. If that spell's mana value was 2 or less, recruit.", 'Instant').abilities[0]).toMatchObject({ effects: [{ type: 'counter' }, { type: 'if', effects }] });
  });

  it('empower Jace N: a number, or X with what X is', () => {
    const token = { type: 'create_token', token: { types: ['Planeswalker'], subtypes: ['Jace'], colors: ['U'], loyalty: '0', abilities: [{ kind: 'activated', cost: { loyalty: -1 } }, { kind: 'activated', cost: { loyalty: -3 } }] } };
    const chosen = { type: 'choose_object', filter: { controller: 'you', token: true, subtypes: ['Jace'], types: ['Planeswalker'] } };
    expect(read('Empower Jace 2.', 'Sorcery').abilities[0]).toMatchObject({ effects: [{ type: 'if', effects: [token] }, chosen, { type: 'add_counters', what: { ref: 'chosen_object' }, counter: 'loyalty', amount: 2 }] });
    expect(read('Empower Jace 1.', 'Sorcery').abilities[0]).toMatchObject({ effects: [{}, {}, { amount: 1 }] });
    expect(read('Whenever this creature attacks, empower Jace X, where X is the number of creatures you control.').abilities[0]).toMatchObject({ effects: [{}, {}, { amount: { kind: 'count', filter: { controller: 'you', types: ['Creature'] } } }] });
  });

  it('on a card named Jace, "Empower Jace" is still the action', () => {
    expect(normaliseSelf('+1: Empower Jace X, where X is the number of Islands you control.', { cardName: 'Jace, Reality Sculptor', faceName: 'Jace, Reality Sculptor', typeLine: 'Legendary Planeswalker — Jace' })).toBe('+1: Empower Jace X, where X is the number of Islands you control.');
    expect(normaliseSelf('Whenever Jace attacks, empower Jace 1.', { cardName: 'Jace, Tester', faceName: 'Jace, Tester', typeLine: 'Legendary Creature — Human' })).toBe('Whenever ~ attacks, empower Jace 1.');
    expect(read('+1: Empower Jace 2.', 'Legendary Planeswalker — Jace', 'Jace, Reality Sculptor').grade).toBe('full');
  });

  it('an action with a reader of its own keeps it (bolster, CR 701.39a)', () => {
    expect(read('When this creature enters, bolster 2.').abilities[0]).toMatchObject({ effects: [{ type: 'bolster', amount: 2 }] });
  });
});

describe('a keyword the rules define (CR 702), known only from its definition', () => {
  it('the designations those definitions give: named as the rules say them', () => {
    expect(DESIGNATIONS).toEqual(["the city's blessing", 'an enduring story']);
  });

  it('storied: a static ability that gives a designation; "as long as you have an enduring story" asks for it', () => {
    const r = read('Storied (If you control three or more artifacts, legendaries, and/or Sagas, you have an enduring story for the rest of the game.)\nAs long as you have an enduring story, this creature gets +1/+0.');
    expect(r.grade).toBe('full');
    expect(r.keywords).toEqual([
      {
        id: 'storied',
        abilities: [{ kind: 'static', text: 'Storied', effect: { type: 'designation', name: 'an enduring story', condition: { type: 'count', who: 'you', filter: { anyOf: [{ types: ['Artifact'] }, { subtypes: ['Saga'] }, { supertypes: ['Legendary'] }] }, min: 3 } } }],
      },
    ]);
    expect(r.abilities[0]).toMatchObject({ effect: { condition: { type: 'has_designation', name: 'an enduring story' } } });
    expect(read("This creature doesn't untap during your untap step as long as you don't have an enduring story.").abilities[0]).toMatchObject({ effect: { condition: { type: 'not', cond: { type: 'has_designation', name: 'an enduring story' } } } });
  });

  it('ascend: a static ability on a permanent (702.131b), a spell ability on an instant or sorcery (702.131a)', () => {
    const blessing = "the city's blessing";
    expect(read('Ascend').keywords).toEqual([{ id: 'ascend', abilities: [{ kind: 'static', text: 'Ascend', effect: { type: 'designation', name: blessing, condition: { type: 'count', who: 'you', filter: {}, min: 10 } } }] }]);
    expect(read('Ascend\nDraw a card.', 'Sorcery').keywords).toEqual([
      {
        id: 'ascend',
        abilities: [
          {
            kind: 'spell',
            text: 'Ascend',
            effects: [{ type: 'if', cond: { type: 'and', all: [{ type: 'count', who: 'you', filter: {}, min: 10 }, { type: 'not', cond: { type: 'has_designation', name: blessing } }] }, effects: [{ type: 'get_designation', name: blessing }] }],
          },
        ],
      },
    ]);
  });

  it('web-slinging: its cost, and "if it was cast using web-slinging"', () => {
    const r = read("Web-slinging {2}{W} (You may cast this spell for {2}{W} if you also return a tapped creature you control to its owner's hand.)\nWhen this creature enters, if it was cast using web-slinging, you gain 3 life.");
    expect(r.grade).toBe('full');
    expect(r.keywords[0]).toMatchObject({ id: 'web_slinging', cost: '{2}{W}', abilities: [{ kind: 'static', effect: { type: 'cast_option', id: 'web_slinging', kind: 'alternative', cost: { mana: '{2}{W}', other: [{ type: 'return_permanents', amount: 1, filter: { controller: 'you', tapped: true, types: ['Creature'] } }] } } }] });
    expect(r.abilities[0]).toMatchObject({ condition: { type: 'paid', cost: 'web_slinging' } });
  });

  it('a keyword whose definition doesn\'t read is no keyword line: the line is left to the players', () => {
    // Sticker kicker (CR 702.33h): "As an additional cost …, you get a ticket counter and you may put a sticker on this spell."
    expect(read('Sticker kicker {2}', 'Sorcery')).toMatchObject({ grade: 'manual', unread: ['Sticker kicker {2}'], keywords: [] });
  });
});

describe('"that are A, B, and/or C": anything that is any of them', () => {
  it('card types, subtypes, supertypes and colors, one word each', () => {
    expect(read('This creature gets +1/+1 for each permanent you control that is a Vehicle and/or legendary.').abilities[0]).toMatchObject({ effect: { power: { kind: 'count', filter: { controller: 'you', anyOf: [{ subtypes: ['Vehicle'] }, { supertypes: ['Legendary'] }] } } } });
    expect(read("This creature's power is equal to the number of permanents you control that are creatures and/or Vehicles.").abilities[0]).toMatchObject({ effect: { setPower: { kind: 'count', filter: { controller: 'you', anyOf: [{ types: ['Creature'] }, { subtypes: ['Vehicle'] }] } } } });
    expect(read('Creatures that are green and/or white get -2/-2 until end of turn.', 'Sorcery').abilities[0]).toMatchObject({ effects: [{ type: 'modify', what: { ref: 'all', filter: { types: ['Creature'], anyOf: [{ colors: ['G'] }, { colors: ['W'] }] } } }] });
  });

  it('a word that is none of those is not read', () => {
    expect(read('Creatures that are green and/or flurbs get -2/-2 until end of turn.', 'Sorcery').grade).toBe('manual');
  });
});

describe('a word the rules don\'t have yet, read from the reminder text printed with it', () => {
  it('a keyword: "Beam me up {3}{G} (You may cast this card from your graveyard for {3}{G} if you also return a creature you control to its owner\'s hand. Then exile this spell.)"', () => {
    const r = read("Draw a card.\nBeam me up {3}{G} (You may cast this card from your graveyard for {3}{G} if you also return a creature you control to its owner's hand. Then exile this spell.)", 'Sorcery');
    expect(r.grade).toBe('full');
    expect(r.keywords).toEqual([
      {
        id: 'beam_me_up',
        cost: '{3}{G}',
        abilities: [{ kind: 'static', text: 'Beam me up {3}{G}', effect: { type: 'cast_option', id: 'beam_me_up', kind: 'alternative', cost: { other: [{ type: 'return_permanents', amount: 1, filter: { controller: 'you', types: ['Creature'] } }], mana: '{3}{G}' }, zone: 'graveyard', exileOnLeave: true } }],
      },
    ]);
  });

  it('an action: "assimilate target creature card from a graveyard. (Put it onto the battlefield …)"', () => {
    const r = read(`At the beginning of your end step, assimilate target creature card from a graveyard. ${ASSIMILATE}`, 'Enchantment');
    expect(r.grade).toBe('full');
    expect(r.abilities[0]).toMatchObject({
      targets: [{ what: 'object', filter: { zone: 'graveyard', types: ['Creature'] } }],
      effects: [
        { type: 'move', what: { ref: 'target', index: 0 }, to: 'battlefield', under: 'you', counters: { '+1/+1': 1 } },
        { type: 'modify', what: { ref: 'target', index: 0 }, types: ['Artifact'], retainTypes: true, creatureTypes: ['Borg'], until: 'game' },
      ],
    });
  });

  it('a reminder that names the word defines it wherever it stands: "(To assimilate a card, put it …)"', () => {
    const r = read(`{T}: Assimilate target creature card from a graveyard, then you gain 1 life. (To assimilate a card, put it onto the battlefield under your control with a +1/+1 counter. It's a Borg artifact creature and loses all other creature types.)`, 'Artifact');
    expect(r.grade).toBe('full');
    expect(r.abilities[0]).toMatchObject({ effects: [{ type: 'move' }, { type: 'modify' }, { type: 'gain_life' }] });
  });

  it('a reminder for a permanent says something else, and is read as it says', () => {
    const r = read("I — Assimilate target nonartifact creature an opponent controls. (Gain control of it and put a +1/+1 counter on it. It's a Borg artifact creature and loses all other creature types.)\nII, III — You gain 1 life.", 'Enchantment — Saga');
    expect(r.abilities[0]).toMatchObject({ effects: [{ type: 'gain_control' }, { type: 'add_counters', counter: '+1/+1', amount: 1 }, { type: 'modify', creatureTypes: ['Borg'] }] });
  });
});

describe('what the reminder text is never asked', () => {
  it('a keyword the rules define — even one whose definition doesn\'t read yet (haunt, CR 702.55)', () => {
    expect(read('Haunt (When this creature dies, you gain 1 life.)')).toMatchObject({ grade: 'manual', unread: ['Haunt'], keywords: [{ id: 'haunt' }] });
  });

  it('a variant of a keyword the rules define ("Coststorm", "Annihinfect")', () => {
    expect(read('Annihinfect (Whenever this creature attacks, you gain 1 life.)')).toMatchObject({ grade: 'manual', unread: ['Annihinfect'] });
  });

  it('a keyword action the rules define (abandon, CR 701.33)', () => {
    expect(read('When this creature enters, abandon target creature. (Put it onto the battlefield under your control.)').abilities).toEqual([]);
  });

  it('a verb the grammar reads: the rest of that clause is what doesn\'t read', () => {
    expect(read('When this creature enters, exile the Borg assimilated with this creature. (Put it onto the battlefield under your control.)').abilities).toEqual([]);
  });

  it('a short reminder defines only the clause it directly follows', () => {
    expect(read('When this creature enters, assimilate target creature card from a graveyard, then you gain 1 life. (Put it onto the battlefield under your control.)').abilities).toEqual([]);
    expect(read('When this creature enters, you gain 1 life, then assimilate target creature card from a graveyard. (Put it onto the battlefield under your control.)').grade).toBe('full');
  });

  it('a reminder that is no instruction defines nothing', () => {
    expect(read("When this creature enters, flurb target creature. (It can't be blocked this turn.)").abilities).toEqual([]);
  });

  it('a reminder that names another word', () => {
    expect(read('When this creature enters, flurb target creature card from a graveyard. (To assimilate a card, put it onto the battlefield under your control.)').abilities).toEqual([]);
  });

  it('an unknown keyword whose reminder doesn\'t read stays a line for the players', () => {
    expect(read('Sinecure (This creature can occupy a space two spaces higher on the Monk Track than its power.)')).toMatchObject({ grade: 'manual', unread: ['Sinecure'] });
  });

  it('a line that reads without it: the reminder changes nothing', () => {
    const plain = read('Flying\nWhen this creature enters, draw a card.');
    const reminded = read('Flying (This creature can\'t be blocked except by creatures with flying or reach.)\nWhen this creature enters, draw a card. (Put it onto the battlefield.)');
    expect(reminded.keywords).toEqual(plain.keywords);
    expect(reminded.abilities).toEqual(plain.abilities);
  });
});
