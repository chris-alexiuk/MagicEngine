/**
 * The last reading of a line nothing else read: one sentence the player can carry out is left to them and the rest is
 * compiled; or, for a triggered ability, the trigger is compiled and all it does is left to its controller. What the
 * engine then does is tested there (test/by-hand.test.ts); here, what is read this way, and what must not be.
 */
import { describe, expect, it } from 'vitest';
import { annotateOracle, byHand } from '@mtg/schema';
import { compileCards } from '../src/compile.js';
import type { ScryfallCard } from '../src/scryfall.js';

const card = (name: string, type_line: string, oracle_text: string): ScryfallCard =>
  ({ object: 'card', id: `${name}-id`, oracle_id: `${name}-oracle`, name, layout: 'normal', mana_cost: '{1}{R}', cmc: 2, type_line, oracle_text, colors: ['R'], color_identity: ['R'], legalities: { commander: 'legal' }, set: 'tst', rarity: 'common' }) as ScryfallCard;
const read = (oracle_text: string, type_line = 'Sorcery', name = 'Probe') => {
  const c = compileCards([card(name, type_line, oracle_text)]).db.cards.find((x) => x.name === name)!;
  const face = c.faces[0]!;
  return { grade: c.automation, unread: face.unparsed, abilities: face.abilities, steps: byHand(face.abilities), lines: annotateOracle(face) };
};

describe('one sentence left to the player', () => {
  it('an instruction that can be carried out by hand, among sentences that read', () => {
    const r = read('Target player mills four cards. You shuffle up to four cards from your graveyard into your library.');
    expect([r.grade, r.unread]).toEqual(['partial', []]);
    expect(r.abilities).toMatchObject([{ kind: 'spell', effects: [{ type: 'mill', amount: 4 }, { type: 'manual', text: 'You shuffle up to four cards from your graveyard into your library.' }] }]);
    // The card's view marks the line as run by the engine but for that sentence.
    expect(r.lines).toMatchObject([{ status: 'partly', byHand: ['You shuffle up to four cards from your graveyard into your library.'] }]);
  });

  it('in the middle, with what follows still compiled; in the words the card prints', () => {
    const r = read('Sacrifice a creature. Return up to X cards from your graveyard to your hand, where X is the number of colors that creature was. Exile Probe.');
    expect(r.grade).toBe('partial');
    expect(r.abilities[0]).toMatchObject({ effects: [{ type: 'sacrifice_choice' }, { type: 'manual', text: 'Return up to X cards from your graveyard to your hand, where X is the number of colors that creature was.' }, { type: 'move', to: 'exile' }] });
    // The card's own name, not the "~" the grammar reads it as.
    const named = read('{1}, {T}: Another target creature gains indestructible until end of turn. Put a +1/+1 counter and a lifelink counter on that creature and a +1/+1 counter and a lifelink counter on Arwen.', 'Legendary Creature — Elf Noble', 'Arwen, Mortal Queen');
    expect(named.steps).toEqual(['Put a +1/+1 counter and a lifelink counter on that creature and a +1/+1 counter and a lifelink counter on Arwen.']);
  });

  it('never a card graded fully automatic', () => {
    for (const text of ['Target player mills four cards. You shuffle up to four cards from your graveyard into your library.', "Exile all permanents. Exile all cards from all hands and graveyards. Each player's life total becomes 1."]) expect(read(text).grade).toBe('partial');
  });

  it('not a sentence that says how another is carried out', () => {
    // "The token has …", "This cost is reduced …": the engine would have done the other sentence wrongly.
    for (const text of [
      'Create a white Aura enchantment token named Mask attached to another target permanent. The token has enchant permanent and umbra armor.',
      'Add seven {R}. This mana can\'t be spent to cast creature spells.',
      'Target opponent loses 5 life unless that player discards two cards or sacrifices a creature or planeswalker of their choice. Repeat this process once.',
    ]) {
      const r = read(text);
      expect([text, r.steps, r.grade]).toEqual([text, [], 'manual']);
    }
  });

  it('not when a later sentence leans on anything: the engine would read it as if the unread one weren\'t there', () => {
    const r = read('{2}, {T}: Roll a d20 and subtract the number of cards in your hand. If the result is 0 or less, discard your hand.', 'Artifact');
    expect([r.steps, r.unread.length]).toEqual([[], 1]);
  });

  it('not one with a target, nor one that acts later', () => {
    for (const text of [
      'Draw a card. Put target creature card from a graveyard onto the battlefield under your control if its mana value is odd and prime.',
      "Create a 3/3 blue Illusion creature token. Exile those tokens when Probe's controller loses the game.",
    ]) expect([text, read(text).steps]).toEqual([text, []]);
  });
});

describe('a triggered ability the engine knows only the trigger of', () => {
  it('the trigger is compiled, what it does is its controller\'s, and the line stays an unread one', () => {
    const text = 'Whenever this creature attacks, add {C}{C} at the beginning of your next main phase this turn.';
    const r = read(text, 'Creature — Werewolf');
    expect([r.grade, r.unread]).toEqual(['manual', [text]]);
    expect(r.abilities).toMatchObject([{ kind: 'triggered', text, trigger: { type: 'attacks', subject: { ref: 'self' } }, effects: [], manual: true }]);
    expect(r.lines).toMatchObject([{ status: 'manual' }]);
  });

  it('with the rest of the card read as before', () => {
    const r = read('Flying\nAt the beginning of your end step, draw a card for each card type among spells you\'ve cast this turn.', 'Creature — Bird');
    expect(r.grade).toBe('partial');
    expect(r.abilities).toMatchObject([{ kind: 'triggered', trigger: { type: 'phase', step: 'end', whose: 'you' }, manual: true }]);
  });

  it('"This ability triggers only once each turn." is kept by the engine', () => {
    const r = read('Whenever you draw a card, conjure a duplicate of it into your hand. This ability triggers only once each turn.', 'Enchantment');
    expect(r.abilities).toMatchObject([{ kind: 'triggered', manual: true, oncePerTurn: true }]);
  });

  it('the whole trigger, where it has commas of its own', () => {
    const r = read('Whenever you cast an instant, sorcery, or Wizard spell, conjure a card named Probe into your hand.', 'Enchantment');
    expect(r.abilities).toMatchObject([{ manual: true, trigger: { type: 'cast', who: 'you', filter: { anyOf: [{ types: ['Instant'] }, { types: ['Sorcery'] }, { subtypes: ['Wizard'] }] } } }]);
  });

  it('a trigger that is a list is read whole, or not at all', () => {
    // "Whenever this creature attacks" alone would trigger for less than the card says.
    const r = read('Whenever this creature attacks, blocks, or becomes the target of a spell or ability, conjure a card named Probe into your hand.', 'Creature — Bird');
    expect(r.abilities).toMatchObject([{ manual: true, trigger: { type: 'either', of: [{ type: 'attacks' }, { type: 'blocks' }, { type: 'becomes_target' }] } }]);
    const part = read('Whenever this creature attacks, blocks, or becomes renowned by an opponent, conjure a card named Probe into your hand.', 'Creature — Bird');
    expect([part.abilities, part.unread.length]).toEqual([[], 1]);
  });

  it('not one that may work from another zone: where it works is in what is unread', () => {
    const r = read('At the beginning of your upkeep, if this card is in your graveyard, you may exile a black creature card other than this card from your graveyard. If you do, return this card to the battlefield.', 'Creature — Horror');
    expect([r.abilities, r.unread.length]).toEqual([[], 1]);
  });

  it('not inside a quoted ability: what a card gives is all read, or the line isn\'t', () => {
    const r = read('Creatures you control have "Whenever this creature attacks, add {C}{C} at the beginning of your next main phase this turn."', 'Enchantment');
    expect([r.abilities, r.unread.length, r.grade]).toEqual([[], 1, 'manual']);
  });
});

describe('what already read is read as before', () => {
  it('a line that reads in full has nothing by hand', () => {
    for (const [text, type] of [
      ['Target player mills four cards. You gain 2 life.', 'Sorcery'],
      ['Whenever this creature attacks, draw a card.', 'Creature — Bird'],
      ["At the beginning of your upkeep, if this card is in your graveyard, you may pay 1 life. If you do, return it to your hand.", 'Creature — Zombie'],
    ] as const) {
      const r = read(text, type);
      expect([text, r.grade, r.steps, r.abilities.some((a) => a.kind === 'triggered' && a.manual)]).toEqual([text, 'full', [], false]);
    }
  });
});
