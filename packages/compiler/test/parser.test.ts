import { describe, expect, it } from 'vitest';
import { normaliseSelf, ParserRegistry, stripAbilityWord, stripReminder } from '../src/parser.js';
import type { GrammarRule } from '../src/parser.js';

const ctx = (name: string, typeLine = '') => ({ cardName: name, faceName: name, typeLine });
const parser = new ParserRegistry();

describe('text helpers', () => {
  it('strips reminder text', () => {
    expect(stripReminder('({T}: Add {G}.)')).toBe('');
    expect(stripReminder('Basic landcycling {1} ({1}, Discard this card: Search…)')).toBe('Basic landcycling {1}');
  });

  it('strips ability words but not modal headers', () => {
    expect(stripAbilityWord('Landfall — Whenever a land you control enters, add one mana of any color.')).toBe(
      'Whenever a land you control enters, add one mana of any color.',
    );
    expect(stripAbilityWord('Descend 4 — Whenever this creature attacks, draw a card.')).toBe(
      'Whenever this creature attacks, draw a card.',
    );
    expect(stripAbilityWord('Choose one —')).toBe('Choose one —');
  });

  it('normalises self-references in old and new templating', () => {
    expect(normaliseSelf('Kinnan, Bonder Prodigy enters tapped.', ctx('Kinnan, Bonder Prodigy'))).toBe('~ enters tapped.');
    expect(normaliseSelf('When Uro enters, sacrifice it.', ctx("Uro, Titan of Nature's Wrath"))).toBe(
      'When ~ enters, sacrifice it.',
    );
    expect(normaliseSelf('This land enters tapped.', ctx('Thornwood Falls'))).toBe('~ enters tapped.');
    // Names only match as whole words.
    expect(normaliseSelf('Ice Age is not Ice.', ctx('Ice'))).toBe('~ Age is not ~.');
    expect(normaliseSelf('Choice of Damnations', ctx('Ice'))).toBe('Choice of Damnations');
  });
});

describe('core grammar rules', () => {
  it('compiles simple mana abilities', () => {
    const r = parser.parse('{T}: Add {G}.', ctx('Llanowar Elves'));
    expect(r.unparsed).toEqual([]);
    expect(r.abilities).toEqual([
      { kind: 'activated', text: '{T}: Add {G}.', cost: { tap: true }, effects: [{ type: 'add_mana', options: [['G']] }], mana: true },
    ]);
  });

  it('compiles choice, multi-symbol and any-color production', () => {
    const effects = (text: string) => parser.parse(text, ctx('X')).abilities.map((a) => (a.kind === 'activated' ? a.effects[0] : null));
    expect(effects('{T}: Add {G} or {U}.')).toEqual([{ type: 'add_mana', options: [['G'], ['U']] }]);
    expect(effects('{T}: Add {W}, {U}, or {B}.')).toEqual([{ type: 'add_mana', options: [['W'], ['U'], ['B']] }]);
    expect(effects('{T}: Add {C}{C}.')).toEqual([{ type: 'add_mana', options: [['C', 'C']] }]);
    expect(effects('{T}: Add one mana of any color.')).toEqual([{ type: 'add_mana', anyColor: 1 }]);
  });

  it('includes mana in costs', () => {
    const r = parser.parse('{1}, {T}: Add {R}{R}.', ctx('X'));
    expect(r.abilities[0]).toMatchObject({ cost: { mana: '{1}', tap: true } });
  });

  it('CR 605.1a: mana abilities can have other untargeted effects (painlands)', () => {
    const r = parser.parse('{T}: Add {B} or {G}. This land deals 1 damage to you.', ctx('Llanowar Wastes', 'Land'));
    expect(r.unparsed).toEqual([]);
    expect(r.abilities[0]).toMatchObject({
      mana: true,
      effects: [{ type: 'add_mana', options: [['B'], ['G']] }, { type: 'deal_damage', amount: 1, to: { ref: 'you' } }],
    });
    // A mana ability can't target (CR 605.1a), so this stays a normal activated ability, unparsed here.
    expect(parser.parse('{T}: Add {R}. This land deals 1 damage to target player.', ctx('X', 'Land')).unparsed).toHaveLength(1);
  });

  it('compiles enters-tapped in both templatings', () => {
    for (const text of ['This land enters tapped.', 'Coastal Tower enters the battlefield tapped.']) {
      const r = parser.parse(text, ctx('Coastal Tower'));
      expect(r.abilities).toEqual([{ kind: 'static', text, effect: { type: 'enters_tapped' } }]);
    }
  });

  it('compiles equipment/aura pumps', () => {
    const r = parser.parse('Equipped creature gets +2/+0.\nEquip {1}', ctx('Bonesplitter'));
    expect(r.unparsed).toEqual([]);
    expect(r.keywords).toEqual([{ id: 'equip', cost: '{1}' }]);
    expect(r.abilities[0]).toMatchObject({
      kind: 'static',
      effect: { type: 'continuous', affected: { ref: 'attached' }, power: 2, toughness: 0 },
    });
  });

  it('records unparsed lines verbatim (minus reminder text)', () => {
    const r = parser.parse('Exile the top card of your library. You may play it this turn. (Reminder.)', ctx('Light Up', 'Instant'));
    expect(r.unparsed).toEqual(['Exile the top card of your library. You may play it this turn.']);
  });

  it('accepts plugin grammar rules', () => {
    const proliferateRule: GrammarRule = {
      id: 'proliferate',
      parse: (line, original) => (line === 'Proliferate.' ? { kind: 'spell', text: original, effects: [{ type: 'proliferate' }] } : null),
    };
    expect(parser.parse('Proliferate.', ctx('Tezzeret’s Gambit', 'Sorcery')).unparsed).toEqual(['Proliferate.']);
    const extended = new ParserRegistry();
    extended.addRule(proliferateRule);
    expect(extended.parse('Proliferate.', ctx('Tezzeret’s Gambit', 'Sorcery')).unparsed).toEqual([]);
    expect(() => extended.addRule(proliferateRule)).toThrow(/duplicate/);
  });
});
