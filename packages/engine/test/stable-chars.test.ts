import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import { chars, charsChanged, withStableChars } from '../src/characteristics.js';
import { give, makeCard, start } from './helpers.js';

// Code that only reads the state (listing the legal actions, checking state-based actions) asks for the same
// permanents' characteristics many times over. Inside withStableChars() each object's are worked out once.

const bear = makeCard({ name: 'Plain Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', power: '2', toughness: '2' });
const lord = makeCard({ name: 'Bear Lord', type_line: 'Creature — Bear', mana_cost: '{2}{G}', power: '2', toughness: '2', oracle_text: 'Other Bears you control get +1/+1.' });

describe('characteristics shared by read-only code', () => {
  it('are worked out afresh for every lookup outside withStableChars()', () => {
    const g = start({ extra: [bear] });
    const o = g.objects[give(g, 'alice', 'Plain Bear', 'battlefield')]!;
    expect(chars(g, o)).not.toBe(chars(g, o));
    expect(chars(g, o)).toEqual(chars(g, o));
  });

  it('are worked out once per object inside it — CR 613: with every effect that applies', () => {
    const g = start({ extra: [bear, lord] });
    const o = g.objects[give(g, 'alice', 'Plain Bear', 'battlefield')]!;
    give(g, 'alice', 'Bear Lord', 'battlefield');
    withStableChars(g, () => {
      const first = chars(g, o);
      expect(first.power).toBe(3);
      expect(chars(g, o)).toBe(first);
    });
  });

  it('are worked out again once the code says it changed the state', () => {
    const g = start({ extra: [bear] });
    const o = g.objects[give(g, 'alice', 'Plain Bear', 'battlefield')]!;
    withStableChars(g, () => {
      expect(chars(g, o).power).toBe(2);
      o.counters['+1/+1'] = 1;
      charsChanged();
      expect(chars(g, o).power).toBe(3);
    });
  });

  it('belong to one state: another state asked about meanwhile gets its own', () => {
    const g = start({ extra: [bear] });
    const o = g.objects[give(g, 'alice', 'Plain Bear', 'battlefield')]!;
    const other = structuredClone({ ...g, cards: undefined });
    const h = { ...other, cards: g.cards } as typeof g;
    h.objects[o.id]!.counters['+1/+1'] = 2;
    withStableChars(g, () => {
      expect(chars(g, o).power).toBe(2);
      expect(chars(h, h.objects[o.id]!).power).toBe(4);
      expect(chars(g, o).power).toBe(2);
    });
  });

  it('belong to one object: a stand-in with the same id (a card "as it would be cast face down") gets its own', () => {
    const g = start({ extra: [bear] });
    const o = g.objects[give(g, 'alice', 'Plain Bear', 'battlefield')]!;
    withStableChars(g, () => {
      expect(chars(g, o).power).toBe(2);
      expect(chars(g, { ...o, counters: { '+1/+1': 1 } }).power).toBe(3);
    });
  });

  it('listing the legal actions leaves nothing shared behind', () => {
    const g = start({ extra: [bear] });
    const o = g.objects[give(g, 'alice', 'Plain Bear', 'battlefield')]!;
    legalActions(g, 'alice');
    o.counters['+1/+1'] = 1;
    expect(chars(g, o).power).toBe(3);
  });
});
