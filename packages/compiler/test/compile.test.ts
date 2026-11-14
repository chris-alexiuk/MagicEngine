import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { CORE_NODES, NODE_FIELDS, faceAbilities, imageUrl, manualModes, nodeFields, nodeTags, undeclaredFields } from '@mtg/schema';
import { describe, expect, it } from 'vitest';
import { automationOf, compileCards, reparseDB } from '../src/compile.js';
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

  it('a card played on paper is kept even when the printing in the file exists only on Arena', () => {
    // Scryfall's file has one printing of each card. The day an Arena set reprinted Crucible of Worlds that printing
    // became its entry, and the card vanished from the pool: the printing was digital, the card isn't.
    const card = (name: string, games: string[], legalities: Record<string, string>): ScryfallCard =>
      ({ object: 'card', id: `id-${name}`, oracle_id: `oracle-${name}`, name, layout: 'normal', set: 'tst', set_type: 'expansion', rarity: 'rare', games, digital: !games.includes('paper'), legalities, keywords: [], mana_cost: '{3}', type_line: 'Artifact', oracle_text: 'You may play lands from your graveyard.', colors: [], cmc: 3, color_identity: [] }) as unknown as ScryfallCard;
    const r = compileCards([
      card('Crucible of Worlds', ['arena'], { standard: 'not_legal', historic: 'legal', legacy: 'legal', vintage: 'legal', commander: 'legal' }),
      // Banned or restricted is still a card that exists on paper.
      card('Restricted Thing', ['arena'], { vintage: 'restricted', legacy: 'banned', commander: 'banned' }),
      // Made for Arena: legal nowhere on paper.
      card('Alchemy Thing', ['arena'], { alchemy: 'legal', historic: 'legal', legacy: 'not_legal', vintage: 'not_legal', commander: 'not_legal' }),
      card('Paper Thing', ['paper', 'mtgo'], { vintage: 'legal', commander: 'legal' }),
    ]);
    expect(r.db.cards.map((c) => c.name)).toEqual(['Crucible of Worlds', 'Paper Thing', 'Restricted Thing']);
    expect(r.skipped.digital_only).toBe(1);
    expect(r.digitalPrintings).toEqual(['Crucible of Worlds', 'Restricted Thing']);
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
    expect(valakut.faces[1]!.abilities[0]).toMatchObject({ kind: 'static', effect: { type: 'as_enters', choice: 'pay_life', amount: 3 } });
    expect(valakut.faces[1]!.abilities[1]).toMatchObject({ mana: true });
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
    expect(byName('Kinnan, Bonder Prodigy').automation).toBe('partial'); // mana-ability triggers aren't compiled yet
    expect(byName('Breeding Pool').automation).toBe('full'); // intrinsic mana, and the shock clause (CR 614.12)
    // Escape is applied (CR 702.138a); "sacrifice it unless it escaped" too (slice 173).
    expect(byName('Uro, Titan of Nature\'s Wrath').automation).toBe('full');
    expect(byName('Uro, Titan of Nature\'s Wrath').faces[0]!.manualKeywords ?? []).toEqual([]);
  });
});

describe('the compiler/engine contract', () => {
  it('emits only node tags the engine core handles (schema CORE_NODES)', () => {
    const seen = { effects: new Set<string>(), statics: new Set<string>(), triggers: new Set<string>(), costs: new Set<string>(), conditions: new Set<string>(), amounts: new Set<string>() };
    for (const card of [...db.cards, ...db.tokens]) {
      for (const face of card.faces) {
        for (const a of faceAbilities(face)) {
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

  it('puts only declared parameters on its nodes (schema NODE_FIELDS)', () => {
    expect(undeclaredFields([...db.cards, ...db.tokens])).toEqual([]);
    // (The walk does find the nodes: a mana ability's node and what it carries.)
    const elves = db.cards.find((c) => c.name === 'Llanowar Elves')!;
    expect([...nodeFields(elves).keys()]).toContain('add_mana');
    expect(NODE_FIELDS.add_mana).toContain('options');
  });

  it('a parameter nobody declared is caught', () => {
    const elves = structuredClone(db.cards.find((c) => c.name === 'Llanowar Elves')!);
    const node = (elves.faces[0]!.abilities[0] as unknown as { effects: Record<string, unknown>[] }).effects[0]!;
    node.onTuesdays = true;
    expect(undeclaredFields([elves])).toEqual(['add_mana.onTuesdays']);
  });
});

describe('grades', () => {
  it("a reparse keeps what the sandbox found, and the grade it lowered: its finding stands until it plays the card again", () => {
    const pool = structuredClone(db);
    const elves = pool.cards.find((c) => c.name === 'Llanowar Elves')!;
    expect(automationOf(elves.faces)).toBe('full');
    elves.issues = ['is offered, and then refused'];
    elves.automation = 'partial';
    const again = reparseDB(pool).cards.find((c) => c.name === 'Llanowar Elves')!;
    expect(again.issues).toEqual(['is offered, and then refused']);
    expect(again.automation).toBe('partial');
    // Every other card is graded by how much of it is read, as before.
    const others = reparseDB(pool).cards.filter((c) => c.name !== 'Llanowar Elves');
    expect(others.every((c) => c.automation === automationOf(c.faces))).toBe(true);
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
    // Every unparsed line lands in some template, and the counts add up.
    const lines = db.cards.flatMap((c) => c.faces.flatMap((f) => [...f.unparsed, ...manualModes(f)])).length;
    expect(report.topTemplates.reduce((n, t) => n + t.count, 0)).toBe(lines);
    expect(coverageMarkdown(report)).toContain('| full |');
  });

  it('stays small', () => {
    // ~30 cards here; the real DB is ~30k. Guard against accidentally shipping bulky fields.
    const perCard = gzipSync(JSON.stringify(db)).length / db.cards.length;
    expect(perCard).toBeLessThan(600);
  });
});
