import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractActionDefinitions, extractKeywordDefinitions, sectionNames } from '../src/keywords.js';
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

  it('a keyword defined by "It means": storied (CR 702.195a); ascend, once for a permanent and once for a spell (CR 702.131a–b)', () => {
    const defs = extractKeywordDefinitions(doc);
    expect(defs.storied).toEqual({
      rule: '702.195a',
      pattern: 'Storied',
      meaning: ["Any time you control three or more permanents that are artifacts, Sagas, and/or legendary and you don't have an enduring story, you have an enduring story for the rest of the game."],
    });
    expect(defs.ascend).toEqual({
      rule: '702.131b',
      pattern: 'Ascend',
      meaning: ["Any time you control ten or more permanents and you don't have the city's blessing, you get the city's blessing for the rest of the game."],
      spell: { rule: '702.131a', meaning: ["If you control ten or more permanents and you don't have the city's blessing, you get the city's blessing for the rest of the game."] },
    });
    // A rule with its own way of writing the keyword between the two sentences isn't this form (craft, CR 702.167a).
    expect(defs.craft).toBeUndefined();
  });

  it('keyword actions the rules define by what they mean (CR 701)', () => {
    const defs = extractActionDefinitions(doc);
    expect(defs.recruit).toEqual({ rule: '701.70a', pattern: 'Recruit', meaning: 'Draw a card, then discard a card. If you discarded a nonland card this way, create a 1/1 white Human Soldier creature token.' });
    expect(defs.empower_jace).toMatchObject({ rule: '701.71a', pattern: 'empower Jace N' });
    expect(defs.empower_jace!.meaning).toMatch(/^If you don't control a Jace planeswalker token, create .+ Put N loyalty counters on it\.$/);
    expect(defs.investigate!.meaning).toBe('Create a Clue token.');
    // An action the rules explain in prose has no quoted meaning to read: scry (CR 701.22a).
    expect(defs.scry).toBeUndefined();
    for (const d of Object.values(defs)) expect(d.meaning).toMatch(/[.!]$/);
  });

  it('every keyword action and ability the rules name (the sections of CR 701 and 702)', () => {
    const actions = sectionNames(doc, '701');
    const keywords = sectionNames(doc, '702');
    expect(actions).toEqual(expect.arrayContaining(['recruit', 'empower jace', 'scry', 'venture into the dungeon', 'tap and untap']));
    expect(keywords).toEqual(expect.arrayContaining(['storied', 'ascend', 'web-slinging', 'flying', 'double strike', 'cumulative upkeep']));
    // Section names only: no rule text, nothing from another chapter.
    expect(actions).not.toContain('flying');
    expect(keywords).not.toContain('recruit');
    // ("∞ (infinity)" is a section of CR 702 too: 702.186.)
    expect([...actions, ...keywords].filter((n) => !/^[a-z][a-z' !-]*$/.test(n))).toEqual(['∞ (infinity)']);
    expect(actions.length).toBeGreaterThanOrEqual(70);
    expect(keywords.length).toBeGreaterThanOrEqual(190);
  });
});
