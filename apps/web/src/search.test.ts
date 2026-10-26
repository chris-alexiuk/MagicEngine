import { readFileSync } from 'node:fs';
import { compileCards, type ScryfallCard } from '@mtg/compiler';
import { describe, expect, it } from 'vitest';
import { compileQuery, parseColors, parseQuery, sortCards } from './search';

const fixture = JSON.parse(
  readFileSync(new URL('../../../packages/compiler/test/fixtures/scryfall-sample.json', import.meta.url), 'utf8'),
) as ScryfallCard[];
const { db } = compileCards(fixture);

const names = (q: string) =>
  db.cards
    .filter(compileQuery(q).test)
    .map((c) => c.name)
    .sort();

describe('parseQuery', () => {
  it('tokenises keys, operators, quotes and negation', () => {
    expect(parseQuery('bolt -t:land o:"draw a card" mv<=2')).toEqual([
      { neg: false, key: null, op: ':', value: 'bolt' },
      { neg: true, key: 't', op: ':', value: 'land' },
      { neg: false, key: 'o', op: ':', value: 'draw a card' },
      { neg: false, key: 'mv', op: '<=', value: '2' },
    ]);
  });

  it('parses colors', () => {
    expect(parseColors('gu')).toEqual(['U', 'G']);
    expect(parseColors('colorless')).toEqual([]);
    expect(parseColors('green')).toEqual(['G']);
    expect(parseColors('xyz')).toBeNull();
  });
});

describe('compileQuery', () => {
  it('matches names and types', () => {
    expect(names('kinnan')).toEqual(['Kinnan, Bonder Prodigy']);
    expect(names('t:equipment')).toEqual(['Bonesplitter']);
  });

  it('searches every face', () => {
    expect(names('ice')).toContain('Fire // Ice');
    expect(names('t:adventure')).toEqual(['Bonecrusher Giant // Stomp']);
  });

  it('filters by color identity as a Commander deck would', () => {
    const ug = names('id:ug t:creature');
    expect(ug).toContain('Kinnan, Bonder Prodigy');
    expect(ug).toContain('Llanowar Elves');
    expect(ug).not.toContain('Goblin Guide');
  });

  it('filters by colors, mana value and keywords', () => {
    expect(names('c:ug')).toEqual(['Kinnan, Bonder Prodigy', 'Thrasios, Triton Hero', "Uro, Titan of Nature's Wrath"]);
    expect(names('mv=1 t:creature')).toEqual(['Birds of Paradise', 'Delver of Secrets // Insectile Aberration', 'Goblin Guide', 'Llanowar Elves']);
    expect(names('kw:flying')).toEqual(['Birds of Paradise', 'Delver of Secrets // Insectile Aberration', 'Serra Angel', 'Storm Crow']);
  });

  it('filters by automation and legality', () => {
    expect(names('auto:manual')).toContain('Kinnan, Bonder Prodigy');
    expect(names('auto:full')).toContain('Counterspell');
    expect(names('is:gc')).toEqual(['Jace, the Mind Sculptor', 'Kinnan, Bonder Prodigy', 'Rhystic Study', 'Sol Ring']);
    expect(names('banned:modern')).toEqual(['Sol Ring']);
  });

  it('negates terms', () => {
    expect(names('t:land -o:tapped').every((n) => !['Thornwood Falls', 'Breeding Pool'].includes(n))).toBe(true);
  });

  it('reports unknown filters instead of silently matching nothing', () => {
    const q = compileQuery('zz:foo c:purple');
    expect(q.errors).toHaveLength(2);
  });
});

describe('sortCards', () => {
  it('sorts by popularity with unranked cards last', () => {
    const sorted = sortCards(db.cards, 'popularity');
    expect(sorted[0]!.name).toBe('Kinnan, Bonder Prodigy');
  });
});
