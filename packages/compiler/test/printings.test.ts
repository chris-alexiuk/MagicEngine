import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { compileCards } from '../src/compile.js';
import { altNamesOf, collectAltNames } from '../src/printings.js';
import { eachCard, readAltNames } from '../src/printings-file.js';
import type { ScryfallCard } from '../src/scryfall.js';

// The names a card is printed under on its other printings (Scryfall's flavor_name): a deck list may use any of them.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/scryfall-sample.json', import.meta.url), 'utf8')) as ScryfallCard[];
const kinnan = fixture.find((c) => c.name === 'Kinnan, Bonder Prodigy')!;
const delver = fixture.find((c) => c.name.startsWith('Delver of Secrets'))!;
const image = (id: string, side = 'front') => ({ normal: `https://cards.scryfall.io/normal/${side}/a/b/${id}.jpg?1` });

/** Another printing of a fixture card. */
const printing = (of: ScryfallCard, extra: Partial<ScryfallCard>): ScryfallCard => ({ ...of, lang: 'en', ...extra });
const seymour = printing(kinnan, { id: 'p-fca-55', set: 'fca', collector_number: '55', released_at: '2025-06-13', flavor_name: 'Seymour Guado', image_uris: image('p-fca-55') });
const seymourFoil = printing(kinnan, { id: 'p-fca-455', set: 'fca', collector_number: '455', released_at: '2025-06-13', flavor_name: 'Seymour Guado', image_uris: image('p-fca-455') });

describe('alternate names from printings', () => {
  it('a printing with a name of its own gives that name, with the printing', () => {
    expect(altNamesOf(seymour)).toEqual([{ oracleId: kinnan.oracle_id, released: '2025-06-13', alt: { name: 'Seymour Guado', set: 'fca', number: '55', img: 'front/a/b/p-fca-55.jpg?1' } }]);
    // An ordinary printing has none; nor has a translation, whatever it's called.
    expect(altNamesOf(printing(kinnan, { set: 'iko', collector_number: '192' }))).toEqual([]);
    expect(altNamesOf(printing(kinnan, { lang: 'ja', printed_name: '結合の神童、キナン' }))).toEqual([]);
    // A name that only differs in accents or case from the card's own isn't another name.
    expect(altNamesOf(printing(kinnan, { printed_name: 'KINNAN, BONDER PRODIGY' }))).toEqual([]);
  });

  it('a name on several printings is kept once, with the earliest', () => {
    const table = collectAltNames([seymourFoil, seymour, printing(kinnan, { set: 'sld', collector_number: '9', released_at: '2026-01-01', flavor_name: 'Another Name' })]);
    expect(table.get(kinnan.oracle_id!)!.map((x) => [x.alt.name, x.alt.number])).toEqual([['Seymour Guado', '55'], ['Another Name', '9']]);
  });

  it('faces named one by one make a whole name, as a card’s own name is made', () => {
    const faces = delver.card_faces!;
    const godzilla = printing(delver, {
      set: 'sld',
      collector_number: '700',
      card_faces: [{ ...faces[0]!, flavor_name: 'Small Monster', image_uris: image('f', 'front') }, { ...faces[1]!, flavor_name: 'Big Monster', image_uris: image('f', 'back') }],
    });
    expect(altNamesOf(godzilla)[0]!.alt).toEqual({ name: 'Small Monster // Big Monster', set: 'sld', number: '700', img: 'front/a/b/f.jpg?1', backImg: 'back/a/b/f.jpg?1' });
  });

  it('a reversible card is two cards back to back: each face’s name belongs to its own card', () => {
    const reversible = {
      object: 'card', id: 'rev', name: 'Kinnan, Bonder Prodigy // Sol Ring', layout: 'reversible_card', lang: 'en', set: 'sld', collector_number: '1', rarity: 'rare',
      card_faces: [
        { name: 'Kinnan, Bonder Prodigy', oracle_id: kinnan.oracle_id, flavor_name: 'Face One', image_uris: image('rev', 'front') },
        { name: 'Sol Ring', oracle_id: 'sol-ring-oracle', image_uris: image('rev', 'back') },
      ],
    } as ScryfallCard;
    expect(altNamesOf(reversible).map((x) => [x.oracleId, x.alt.name, x.alt.img])).toEqual([[kinnan.oracle_id, 'Face One', 'front/a/b/rev.jpg?1']]);
  });

  it('the compiled card carries them, sorted, without its own name', () => {
    const table = collectAltNames([seymour, printing(kinnan, { set: 'x', collector_number: '1', flavor_name: 'Aaron' })]);
    const { db } = compileCards(fixture, { altNames: table });
    expect(db.cards.find((c) => c.name === 'Kinnan, Bonder Prodigy')!.aka).toEqual([
      { name: 'Aaron', set: 'x', number: '1', img: expect.any(String) },
      { name: 'Seymour Guado', set: 'fca', number: '55', img: 'front/a/b/p-fca-55.jpg?1' },
    ]);
    expect(db.cards.filter((c) => c.aka).map((c) => c.name)).toEqual(['Kinnan, Bonder Prodigy']);
    // The file being compiled is read for names too: the one printing it has of each card may be such a printing.
    const own = compileCards(fixture.map((c) => (c === kinnan ? seymour : c)));
    expect(own.db.cards.find((c) => c.name === 'Kinnan, Bonder Prodigy')!.aka?.map((a) => a.name)).toEqual(['Seymour Guado']);
  });

  it('reads an all-printings file card by card, in either of Scryfall’s formats, gzipped or not', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'printings-'));
    const cards = [printing(kinnan, { set: 'iko', collector_number: '192' }), seymour, seymourFoil];
    const jsonl = join(dir, 'a.jsonl.gz');
    writeFileSync(jsonl, gzipSync(cards.map((c) => JSON.stringify(c)).join('\n') + '\n'));
    const array = join(dir, 'b.json');
    writeFileSync(array, `[\n${cards.map((c) => JSON.stringify(c)).join(',\n')}\n]\n`);
    for (const file of [jsonl, array]) {
      const seen: string[] = [];
      expect(await eachCard(file, (c) => seen.push(c.set))).toBe(3);
      expect(seen).toEqual(['iko', 'fca', 'fca']);
      const { table, printings } = await readAltNames(file);
      expect(printings).toBe(3);
      expect(table.get(kinnan.oracle_id!)!.map((x) => `${x.alt.name} ${x.alt.set} ${x.alt.number}`)).toEqual(['Seymour Guado fca 55']);
    }
  });
});
