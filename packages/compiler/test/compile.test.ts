import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { CORE_NODES, imageUrl, nodeTags } from '@mtg/schema';
import { describe, expect, it } from 'vitest';
import { compileCards } from '../src/compile.js';
import { buildCoverage, coverageMarkdown, templateOf } from '../src/coverage.js';
import type { ScryfallCard } from '../src/scryfall.js';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/scryfall-sample.json', import.meta.url), 'utf8'),
) as ScryfallCard[];
const { db, skipped } = compileCards(fixture, { builtAt: '2026-10-26T00:00:00.000Z', source: { kind: 'fixture' } });
const byName = (name: string) => {
  const c = db.cards.find((x) => x.name === name);
  if (!c) throw new Error(`missing ${name}`);
  return c;
};

describe('compileCards', () => {
  it('splits cards from tokens and skips non-game objects', () => {
    expect(db.tokens.map((t) => t.name)).toEqual(['Soldier']);
    expect(skipped).toMatchObject({ layout: 1, digital_only: 1, un_set: 1 });
    expect(db.cards).toHaveLength(fixture.length - 4);
    expect(db.cards.map((c) => c.name)).toEqual([...db.cards.map((c) => c.name)].sort((a, b) => a.localeCompare(b)));
  });

  it('keeps structural data', () => {
    const kinnan = byName('Kinnan, Bonder Prodigy');
    expect(kinnan).toMatchObject({ cmc: 2, colorIdentity: ['U', 'G'], gameChanger: true, rank: 1900, rarity: 'mythic' });
    expect(kinnan.faces[0]).toMatchObject({
      supertypes: ['Legendary'],
      types: ['Creature'],
      subtypes: ['Human', 'Druid'],
      power: '2',
      toughness: '2',
    });
    expect(byName('Sol Ring').legal).toMatchObject({ commander: 'l', modern: 'b', vintage: 'r' });
    expect(byName('Sol Ring').legal.standard).toBeUndefined();
  });

  it('handles multi-face layouts', () => {
    const fireIce = byName('Fire // Ice');
    expect(fireIce.faces.map((f) => [f.name, f.colors])).toEqual([
      ['Fire', ['R']],
      ['Ice', ['U']],
    ]);
    expect(fireIce.faces[0]!.img).toBeDefined();
    expect(fireIce.faces[1]!.img).toBeUndefined(); // split halves share one image

    const delver = byName('Delver of Secrets // Insectile Aberration');
    expect(delver.faces[1]).toMatchObject({ name: 'Insectile Aberration', keywords: [{ id: 'flying' }], colors: ['U'] });
    expect(delver.faces[1]!.img).toMatch(/^back\//);

    const valakut = byName('Valakut Awakening // Valakut Stoneforge');
    expect(valakut.faces[1]!.abilities[0]).toMatchObject({ mana: true });
  });

  it('stores compact image paths that rebuild into Scryfall URLs', () => {
    const path = byName('Grizzly Bears').faces[0]!.img!;
    expect(path).toMatch(/^front\/[0-9a-f]\/[0-9a-f]\/[0-9a-f-]+\.jpg\?\d+$/);
    expect(imageUrl(path, 'small')).toBe(`https://cards.scryfall.io/small/${path}`);
    expect(imageUrl(path, 'png')).toContain('.png?');
  });

  it('grades automation', () => {
    expect(byName('Grizzly Bears').automation).toBe('full'); // vanilla
    expect(byName('Forest').automation).toBe('full'); // reminder text only; intrinsic ability from subtype
    expect(byName('Serra Angel').automation).toBe('full');
    expect(byName('Birds of Paradise').automation).toBe('full');
    expect(byName('Bonesplitter').automation).toBe('full');
    expect(byName('Thornwood Falls').automation).toBe('full'); // enters tapped, gain-life trigger, mana ability
    expect(byName('Counterspell').automation).toBe('full');
    expect(byName('Rhystic Study').automation).toBe('full'); // "you may draw a card unless that player pays {1}"
    expect(byName('Kinnan, Bonder Prodigy').automation).toBe('manual'); // mana-ability triggers aren't compiled yet
    expect(byName('Breeding Pool').automation).toBe('partial'); // intrinsic mana works; the shock clause is manual
    expect(byName('Uro, Titan of Nature\'s Wrath').automation).toBe('partial'); // escape keyword parsed
  });
});

describe('the compiler/engine contract', () => {
  it('emits only node tags the engine core handles (schema CORE_NODES)', () => {
    const seen = { effects: new Set<string>(), statics: new Set<string>(), triggers: new Set<string>(), costs: new Set<string>() };
    for (const card of [...db.cards, ...db.tokens]) {
      for (const face of card.faces) {
        for (const a of face.abilities) {
          const tags = nodeTags(a);
          for (const k of Object.keys(seen) as (keyof typeof seen)[]) for (const t of tags[k]) seen[k].add(t);
        }
      }
    }
    for (const k of Object.keys(seen) as (keyof typeof seen)[]) {
      expect([...seen[k]].filter((t) => !(CORE_NODES[k] as readonly string[]).includes(t))).toEqual([]);
    }
    expect(seen.effects.size).toBeGreaterThan(3);
  });
});

describe('coverage report', () => {
  const report = buildCoverage(db);

  it('totals every card', () => {
    const { full, partial, manual } = report.totals;
    expect(full + partial + manual).toBe(db.cards.length);
  });

  it('groups unparsed lines into templates', () => {
    expect(templateOf('Lightning Bolt deals 3 damage to any target.', 'Lightning Bolt', 'Lightning Bolt')).toBe(
      '~ deals N damage to any target.',
    );
    const commanderMana = report.topTemplates.find((t) => t.template.includes("commander's color identity"));
    expect(commanderMana).toMatchObject({ count: 2 });
    expect(coverageMarkdown(report)).toContain('| full |');
  });

  it('stays small', () => {
    // ~30 cards here; the real DB is ~30k. Guard against accidentally shipping bulky fields.
    const perCard = gzipSync(JSON.stringify(db)).length / db.cards.length;
    expect(perCard).toBeLessThan(600);
  });
});
