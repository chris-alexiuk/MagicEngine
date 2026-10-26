import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractKeywordDefinitions } from '../src/keywords.js';
import type { RulesDoc } from '../src/parse.js';
import { extractSubtypes } from '../src/subtypes.js';

const doc = JSON.parse(readFileSync(new URL('../../../docs/rules/rules.json', import.meta.url), 'utf8')) as RulesDoc;

describe('data the compiler reads from the Comprehensive Rules', () => {
  it('subtype lists (CR 205.3)', () => {
    const lists = extractSubtypes(doc);
    expect(lists.creature).toContain('Elf');
    expect(lists.creature).toContain('Time Lord');
    expect(lists.land).toEqual(expect.arrayContaining(['Forest', 'Island', 'Plains', 'Swamp', 'Mountain']));
    expect(lists.artifact).toContain('Equipment');
    expect(lists.enchantment).toContain('Aura');
    // No stray phrases from the surrounding sentences.
    for (const list of Object.values(lists)) expect(list.every((t) => /^[A-Z][\w’'-]*(?: [A-Z][\w’'-]*)*$/.test(t))).toBe(true);
  });

  it('keyword definitions (CR 702)', () => {
    const defs = extractKeywordDefinitions(doc);
    expect(defs.prowess).toEqual({
      rule: '702.108a',
      pattern: 'Prowess',
      meaning: ['Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.'],
    });
    expect(defs.cycling).toMatchObject({ pattern: 'Cycling [cost]', zone: 'hand', meaning: ['[Cost], Discard this card: Draw a card.'] });
    // A variant inherits the zone stated for its keyword (702.29a → 702.29e).
    expect(defs.typecycling).toMatchObject({ rule: '702.29e', zone: 'hand' });
    // Unquoted keyword name; parentheticals ("(See rule 509 …)") aren't part of the meaning.
    expect(defs.ward!.meaning).toHaveLength(1);
    expect(defs.bushido!.meaning).toHaveLength(1);
    // Keywords with several abilities.
    expect(defs.vanishing!.meaning).toHaveLength(3);
  });
});
