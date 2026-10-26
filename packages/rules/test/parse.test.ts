import { describe, expect, it } from 'vitest';
import { parseComprehensiveRules } from '../src/parse.js';
import { buildTrace, compareRuleIds, findCitations, traceMarkdown } from '../src/trace.js';

// A miniature file in the real format: CRLF line endings, a BOM, a contents
// list that repeats the headings, wrapped examples, glossary and credits.
const SAMPLE = [
  '\uFEFFMagic: The Gathering Comprehensive Rules',
  '',
  'These rules are effective as of September 25, 2026.',
  '',
  'Introduction',
  '',
  'This document is the ultimate authority for Magic: The Gathering competitive game play.',
  '',
  'Contents',
  '',
  '1. Game Concepts',
  '100. General',
  '101. The Magic Golden Rules',
  '5. Turn Structure',
  '500. General',
  'Glossary',
  'Credits',
  '',
  '1. Game Concepts',
  '',
  '100. General',
  '',
  '100.1. These Magic rules apply to any Magic game with two or more players.',
  '',
  '100.1a A two-player game is a game that begins with only two players.',
  '',
  '100.1b A multiplayer game is a game that begins with more than two players.',
  '',
  '100.1c. A subrule with a stray period, as in the real file.',
  '',
  '100.2 A rule missing its period, with an inline\u2028separator.',
  '',
  '101. The Magic Golden Rules',
  '',
  '101.1. Whenever a card’s text directly contradicts these rules, the card takes precedence.',
  '',
  'Example: If an effect allows a player to cast a spell,',
  'and the rules say otherwise, the effect wins.',
  '',
  '5. Turn Structure',
  '',
  '500. General',
  '',
  '500.1. A turn consists of five phases.',
  '',
  'Glossary',
  '',
  'Active Player',
  'The player whose turn it is. See rule 102.1.',
  '',
  'Ability',
  '1. Text on an object that explains what that object does.',
  '2. An activated or triggered ability on the stack.',
  '',
  'Credits',
  '',
  'Magic: The Gathering Original Game Design: Richard Garfield',
].join('\r\n');

describe('parseComprehensiveRules', () => {
  const doc = parseComprehensiveRules(SAMPLE);

  it('reads the effective date', () => {
    expect(doc.effectiveDate).toBe('September 25, 2026');
  });

  it('skips the contents list and builds chapters from the body', () => {
    expect(doc.chapters.map((c) => [c.id, c.title, c.sections])).toEqual([
      [1, 'Game Concepts', ['100', '101']],
      [5, 'Turn Structure', ['500']],
    ]);
  });

  it('links rules, subrules and sections', () => {
    expect(doc.rules['100']).toMatchObject({ text: 'General', children: ['100.1', '100.2'] });
    expect(doc.rules['100.1']).toMatchObject({ parent: '100', children: ['100.1a', '100.1b', '100.1c'] });
    expect(doc.rules['100.1b']).toMatchObject({
      parent: '100.1',
      text: 'A multiplayer game is a game that begins with more than two players.',
    });
  });

  it('tolerates the real file’s numbering quirks', () => {
    expect(doc.rules['100.1c']!.text).toBe('A subrule with a stray period, as in the real file.');
    expect(doc.rules['100.2']!.text).toBe('A rule missing its period, with an inline separator.');
  });

  it('attaches examples, joining wrapped lines', () => {
    expect(doc.rules['101.1']!.examples).toEqual([
      'If an effect allows a player to cast a spell,\nand the rules say otherwise, the effect wins.',
    ]);
  });

  it('reads the glossary up to the credits', () => {
    expect(doc.glossary['Active Player']).toBe('The player whose turn it is. See rule 102.1.');
    expect(doc.glossary['Ability']).toContain('2. An activated or triggered ability');
    expect(Object.keys(doc.glossary)).toHaveLength(2);
  });
});

describe('trace', () => {
  const doc = parseComprehensiveRules(SAMPLE);

  it('finds citations in code and tests', () => {
    const src = '// CR 100.1a: two players\nif (x) { /* CR 101.1 and CR 999.9 */ }';
    expect(findCitations(src, 'a.ts', 'code').map((c) => [c.rule, c.line])).toEqual([
      ['100.1a', 1],
      ['101.1', 2],
      ['999.9', 2],
    ]);
  });

  it('flags citations of rules that do not exist', () => {
    const report = buildTrace(doc, [
      ...findCitations('// CR 100.1a\n// CR 999.9', 'engine.ts', 'code'),
      ...findCitations("it('CR 100.1a works')", 'engine.test.ts', 'test'),
    ]);
    expect(report.unknown.map((c) => c.rule)).toEqual(['999.9']);
    expect(report.rows).toHaveLength(1);
    expect(report.bySection).toEqual([{ section: '100', title: 'General', total: 5, implemented: 1, tested: 1 }]);
    expect(traceMarkdown(report, doc)).toContain('| 100.1a | A two-player game');
  });

  it('orders rule ids numerically', () => {
    expect(['101', '100.10', '100.2', '100.1a', '100.1'].sort(compareRuleIds)).toEqual([
      '100.1',
      '100.1a',
      '100.2',
      '100.10',
      '101',
    ]);
  });
});
