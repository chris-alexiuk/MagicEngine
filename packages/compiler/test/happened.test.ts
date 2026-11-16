/**
 * A question about what happened this turn is read once, from two parts: what happened (schema HAPPENINGS) and a noun
 * phrase for what it happened to. Here, what is read and what isn't; what the engine answers is tested there
 * (engine test/happened.test.ts, history.test.ts, and the tests of the cards that ask).
 */
import { describe, expect, it } from 'vitest';
import { HAPPENED_FILTER, HAPPENINGS } from '@mtg/schema';
import { compileCards } from '../src/compile.js';
import type { ScryfallCard } from '../src/scryfall.js';

const card = (name: string, type_line: string, oracle_text: string): ScryfallCard =>
  ({ object: 'card', id: `${name}-id`, oracle_id: `${name}-oracle`, name, layout: 'normal', mana_cost: '{1}{R}', cmc: 2, type_line, oracle_text, colors: ['R'], color_identity: ['R'], legalities: { commander: 'legal' }, set: 'tst', rarity: 'common' }) as ScryfallCard;
const read = (oracle_text: string, type_line = 'Creature — Bird', name = 'Probe') => {
  const c = compileCards([card(name, type_line, oracle_text)]).db.cards.find((x) => x.name === name)!;
  const face = c.faces[0]!;
  return { grade: c.automation, unread: face.unparsed, abilities: face.abilities as { condition?: unknown; effects?: { amount?: unknown; cond?: unknown; type: string }[]; effect?: { condition?: unknown } }[] };
};
/** The condition of "At the beginning of your end step, if [words], draw a card." */
const asked = (words: string) => {
  const r = read(`At the beginning of your end step, if ${words}, draw a card.`);
  return r.grade === 'full' ? r.abilities[0]!.condition : null;
};
/** The amount of "At the beginning of your end step, you gain 1 life for each [words]." */
const counted = (words: string) => {
  const r = read(`At the beginning of your end step, you gain 1 life for each ${words}.`);
  return r.grade === 'full' ? r.abilities[0]!.effects![0]!.amount : null;
};

describe('"if [something happened] this turn"', () => {
  it('what happened, and to what', () => {
    const cases: [string, object][] = [
      ['a creature died this turn', { type: 'happened', what: 'died', filter: { types: ['Creature'] }, min: 1 }],
      ['a permanent left the battlefield under your control this turn', { what: 'left', filter: { controller: 'you' }, min: 1 }],
      ['a nonland permanent left the battlefield this turn', { what: 'left', filter: { notTypes: ['Land'] }, min: 1 }],
      ['an artifact or creature was put into a graveyard from the battlefield this turn', { what: 'died', filter: { types: ['Artifact', 'Creature'] }, min: 1 }],
      ['an enchantment was put into your graveyard from the battlefield this turn', { what: 'died', filter: { types: ['Enchantment'], owner: 'you' }, min: 1 }],
      ['a permanent was returned to your hand from the battlefield this turn', { what: 'returned_to_hand', filter: { owner: 'you' }, min: 1 }],
      ['a permanent was put into your hand from the battlefield this turn', { what: 'returned_to_hand', filter: { owner: 'you' }, min: 1 }],
      ["you've sacrificed a Food this turn", { what: 'sacrificed', filter: { subtypes: ['Food'], controller: 'you' }, min: 1 }],
      ['you sacrificed a nontoken permanent this turn', { what: 'sacrificed', filter: { token: false, controller: 'you' }, min: 1 }],
      ['you created a token this turn', { what: 'created', filter: { controller: 'you' }, min: 1 }],
    ];
    for (const [words, node] of cases) expect([words, asked(words)]).toEqual([words, expect.objectContaining(node)]);
  });

  it('whose it was: "under your control", "you controlled", "an opponent\'s"', () => {
    expect(asked('a creature died under your control this turn')).toMatchObject({ what: 'died', filter: { types: ['Creature'], controller: 'you' } });
    expect(asked('a creature you controlled died this turn')).toMatchObject({ what: 'died', filter: { types: ['Creature'], controller: 'you' } });
    expect(asked("a creature died under an opponent's control this turn")).toMatchObject({ what: 'died', filter: { types: ['Creature'], controller: 'opponent' } });
    expect(asked('a land you controlled was put into a graveyard from the battlefield this turn')).toMatchObject({ what: 'died', filter: { types: ['Land'], controller: 'you' } });
  });

  it('how many: "three or more", "one or more", "no"', () => {
    expect(asked('three or more creatures died this turn')).toMatchObject({ what: 'died', min: 3 });
    expect(asked("you've sacrificed three or more Clues this turn")).toMatchObject({ what: 'sacrificed', filter: { subtypes: ['Clue'], controller: 'you' }, min: 3 });
    expect(asked('one or more cards were put into exile this turn')).toMatchObject({ what: 'exiled', card: true, min: 1 });
    const none = asked('no creatures died this turn') as { min?: number; max?: number };
    expect([none.min, none.max]).toEqual([undefined, 0]);
    expect(asked('no permanents left the battlefield this turn')).toEqual({ type: 'happened', what: 'left', max: 0 });
  });

  it('about cards: as they are printed, and never tokens', () => {
    expect(asked('a card left your graveyard this turn')).toEqual({ type: 'happened', what: 'left_graveyard', card: true, filter: { owner: 'you' }, min: 1 });
    expect(asked('three or more creature cards left your graveyard this turn')).toMatchObject({ what: 'left_graveyard', card: true, filter: { types: ['Creature'], owner: 'you' }, min: 3 });
    expect(asked('a creature card was put into your graveyard from anywhere this turn')).toMatchObject({ what: 'put_into_graveyard', card: true, filter: { types: ['Creature'], owner: 'you' }, min: 1 });
    expect(asked('three or more creature cards were put into graveyards from anywhere this turn')).toMatchObject({ what: 'put_into_graveyard', card: true, filter: { types: ['Creature'] }, min: 3 });
    // What dies or leaves the battlefield is a permanent, not a card; what leaves a graveyard is a card.
    expect(asked('a creature card died this turn')).toBeNull();
    expect(asked('a creature left your graveyard this turn')).toBeNull();
  });

  it('what "died" is a creature unless the words name another kind', () => {
    expect(asked('a Zubera died this turn')).toMatchObject({ what: 'died', filter: { types: ['Creature'], subtypes: ['Zubera'] } });
    expect(asked('another Human died under your control this turn')).toMatchObject({ what: 'died', filter: { types: ['Creature'], subtypes: ['Human'], controller: 'you' } });
    expect(asked('a non-Skeleton creature died this turn')).toMatchObject({ what: 'died', filter: { types: ['Creature'], notSubtypes: ['Skeleton'] } });
  });

  it('only what the history knows of a thing can be asked of it', () => {
    // Modified, named, with a keyword: nothing the engine could answer, so the line isn't read.
    for (const words of ['a modified creature died under your control this turn', 'a creature not named Probe died this turn', 'a creature with flying died this turn']) expect([words, asked(words)]).toEqual([words, null]);
    for (const key of ['types', 'notTypes', 'subtypes', 'notSubtypes', 'token', 'controller', 'owner']) expect(HAPPENED_FILTER).toContain(key);
    for (const kind of ['died', 'left', 'returned_to_hand', 'put_into_graveyard', 'exiled', 'left_graveyard', 'sacrificed', 'created']) expect(HAPPENINGS).toContain(kind);
  });

  it('"another", said after the sentence has dealt with a creature, is left to the player — not answered as "a"', () => {
    // Chain Assassination: another than the one just destroyed. The spell destroys; the question is the player's.
    const r = read('Destroy target creature. If another creature died this turn, draw a card.', 'Instant');
    expect(r.grade).toBe('partial');
    expect(r.abilities[0]!.effects).toMatchObject([{ type: 'destroy' }, { type: 'manual', text: 'If another creature died this turn, draw a card.' }]);
  });
});

describe('"for each [thing that happened] this turn", "the number of [them]"', () => {
  it('the same question, counted', () => {
    const cases: [string, object][] = [
      ['creature that died this turn', { kind: 'happened', what: 'died', filter: { types: ['Creature'] } }],
      ['nontoken creature that died this turn', { what: 'died', filter: { types: ['Creature'], token: false } }],
      ['Zubera that died this turn', { what: 'died', filter: { types: ['Creature'], subtypes: ['Zubera'] } }],
      ['creature that died under your control this turn', { what: 'died', filter: { types: ['Creature'], controller: 'you' } }],
      ['nontoken creature you controlled that died this turn', { what: 'died', filter: { types: ['Creature'], token: false, controller: 'you' } }],
      ['nontoken creature put into your graveyard from the battlefield this turn', { what: 'died', filter: { types: ['Creature'], token: false, owner: 'you' } }],
      ['creature that left the battlefield under your control this turn', { what: 'left', filter: { types: ['Creature'], controller: 'you' } }],
      ['permanent sacrificed this turn', { what: 'sacrificed' }],
    ];
    for (const [words, node] of cases) expect([words, counted(words)]).toEqual([words, expect.objectContaining(node)]);
  });

  it('"the number of …", in the plural', () => {
    const n = (words: string) => {
      const r = read(`{T}: You gain X life, where X is the number of ${words}.`, 'Artifact');
      return r.grade === 'full' ? r.abilities[0]!.effects![0]!.amount : null;
    };
    expect(n('creatures that died this turn')).toMatchObject({ kind: 'happened', what: 'died', filter: { types: ['Creature'] } });
    expect(n("permanents you've sacrificed this turn")).toEqual({ kind: 'happened', what: 'sacrificed', filter: { controller: 'you' } });
    expect(n('tokens you created this turn')).toEqual({ kind: 'happened', what: 'created', filter: { controller: 'you' } });
    expect(n('Treasure tokens you created this turn')).toEqual({ kind: 'happened', what: 'created', filter: { subtypes: ['Treasure'], controller: 'you' } });
    expect(n('artifacts that were put into graveyards from the battlefield this turn')).toEqual({ kind: 'happened', what: 'died', filter: { types: ['Artifact'] } });
    expect(n('cards put into your graveyard from anywhere this turn')).toEqual({ kind: 'happened', what: 'put_into_graveyard', card: true, filter: { owner: 'you' } });
  });

  it('gravestorm, from its rule (CR 702.69a): "for each permanent that was put into a graveyard from the battlefield this turn"', () => {
    const c = compileCards([card('Storm', 'Sorcery', 'Gravestorm\nDraw a card.')]).db.cards[0]!;
    expect(c.automation).toBe('full');
    expect(c.faces[0]!.keywords).toMatchObject([{ id: 'gravestorm', abilities: [{ kind: 'triggered', effects: [{ type: 'copy_spell', amount: { kind: 'happened', what: 'died' } }] }] }]);
  });
});
