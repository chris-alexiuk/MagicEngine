import { readFileSync } from 'node:fs';
import { compileCard, compileCards, type ScryfallCard } from '@mtg/compiler';
import type { CardDef } from '@mtg/schema';
import { describe, expect, it } from 'vitest';
import { deckToText } from './exportDeck';
import { importText } from './importDeck';
import { commanderProblem, copyLimit, pairProblem, validateDeck, type Deck } from './model';
import { buildIndex, normalizeName } from './names';
import { parseCardLine, parseDeckText } from './parse';
import { archidektToText, moxfieldToText, parseDeckUrl } from './remote';

const fixture = JSON.parse(
  readFileSync(new URL('../../../../packages/compiler/test/fixtures/scryfall-sample.json', import.meta.url), 'utf8'),
) as ScryfallCard[];

const make = (fields: Partial<ScryfallCard> & { name: string; type_line: string }): CardDef =>
  compileCard({ object: 'card', id: `t-${fields.name}`, oracle_id: `t-${fields.name}`, layout: 'normal', set: 'tst', rarity: 'common', oracle_text: '', mana_cost: '', legalities: { commander: 'legal' }, ...fields } as ScryfallCard, `t-${fields.name}`);

const extra: CardDef[] = [
  make({ name: 'Jötun Grunt', type_line: 'Creature — Giant Soldier', mana_cost: '{1}{W}', color_identity: ['W'] }),
  make({ name: 'Partner A', type_line: 'Legendary Creature — Human', oracle_text: 'Partner', color_identity: ['W'] }),
  make({ name: 'Partner B', type_line: 'Legendary Creature — Elf', oracle_text: 'Partner (You can have two commanders if both have partner.)', color_identity: ['G'] }),
  make({ name: 'Pir Test', type_line: 'Legendary Creature — Human', oracle_text: 'Partner with Toothy Test', color_identity: ['G'] }),
  make({ name: 'Toothy Test', type_line: 'Legendary Creature — Illusion', oracle_text: 'Partner with Pir Test', color_identity: ['U'] }),
  make({ name: 'Wilson Test', type_line: 'Legendary Creature — Bear Warrior', oracle_text: 'Choose a Background', color_identity: ['G'] }),
  make({ name: 'Sage Test', type_line: 'Legendary Enchantment — Background', oracle_text: 'Commander creatures you own have trample.', color_identity: ['U'] }),
  make({ name: 'Walker Commander', type_line: 'Legendary Planeswalker — Test', oracle_text: 'Walker Commander can be your commander.', color_identity: ['R'] }),
  make({ name: 'Rat Pack', type_line: 'Creature — Rat', oracle_text: 'A deck can have any number of cards named Rat Pack.', color_identity: ['B'] }),
  make({ name: 'Seven Test', type_line: 'Creature — Dwarf', oracle_text: 'A deck can have up to seven cards named Seven Test.', color_identity: ['R'] }),
  make({ name: 'Banned Thing', type_line: 'Artifact', legalities: { commander: 'banned' } }),
];
const cards = [...compileCards(fixture).db.cards, ...extra];
const index = buildIndex(cards);
const card = (n: string) => index.get(n)!;

describe('names', () => {
  it('normalises case, accents, apostrophes and split-card slashes', () => {
    expect(normalizeName('  Jotun  GRUNT ')).toBe('jotun grunt');
    expect(normalizeName('Jötun Grunt')).toBe('jotun grunt');
    expect(normalizeName('Uro, Titan of Nature’s Wrath')).toBe(normalizeName("Uro, Titan of Nature's Wrath"));
    expect(normalizeName('Fire/Ice')).toBe('fire // ice');
  });

  it('finds double-faced and split cards by full name or front face', () => {
    expect(index.lookup('Fire // Ice')?.name).toBe('Fire // Ice');
    expect(index.lookup('fire/ice')?.name).toBe('Fire // Ice');
    expect(index.lookup('Fire')?.name).toBe('Fire // Ice');
    expect(index.lookup('Delver of Secrets')?.name).toBe('Delver of Secrets // Insectile Aberration');
    expect(index.lookup('Insectile Aberration')?.name).toBe('Delver of Secrets // Insectile Aberration');
    expect(index.lookup('Bonecrusher Giant')?.name).toBe('Bonecrusher Giant // Stomp');
    expect(index.lookup('jotun grunt')?.name).toBe('Jötun Grunt');
    expect(index.lookup('Not A Card')).toBeUndefined();
  });
});

describe('parseCardLine', () => {
  it('reads counts in every common style', () => {
    expect(parseCardLine('1 Sol Ring')).toMatchObject({ count: 1, name: 'Sol Ring' });
    expect(parseCardLine('4x Lightning Bolt')).toMatchObject({ count: 4, name: 'Lightning Bolt' });
    expect(parseCardLine('2 x Forest')).toMatchObject({ count: 2, name: 'Forest' });
    expect(parseCardLine('Sol Ring')).toMatchObject({ count: 1, name: 'Sol Ring' });
    expect(parseCardLine('Island x12')).toMatchObject({ count: 12, name: 'Island' });
  });

  it('strips Moxfield printings and foil markers', () => {
    expect(parseCardLine('1 Sol Ring (CMM) 400')).toMatchObject({ count: 1, name: 'Sol Ring', set: 'CMM', number: '400' });
    expect(parseCardLine('1 Arcane Signet (CMM) 297 *F*')).toMatchObject({ name: 'Arcane Signet', set: 'CMM', number: '297', foil: 'foil' });
    expect(parseCardLine('1 Command Tower (CMM) 1028 *E*')).toMatchObject({ name: 'Command Tower', foil: 'etched' });
    expect(parseCardLine('1 Sol Ring (PLST) C21-263')).toMatchObject({ name: 'Sol Ring', set: 'PLST', number: 'C21-263' });
    expect(parseCardLine('1 Fire // Ice (MH2) 290')).toMatchObject({ name: 'Fire // Ice' });
  });

  it('strips Archidekt categories and tags, keeping what they say', () => {
    expect(parseCardLine('1x Sol Ring (cmm) 400 [Ramp]')).toMatchObject({ name: 'Sol Ring', set: 'CMM', categories: ['Ramp'] });
    expect(parseCardLine('1x Kinnan, Bonder Prodigy (iko) 192 [Commander{top}] ^Have,#37d67a^')).toMatchObject({ name: 'Kinnan, Bonder Prodigy', categories: ['Commander{top}'] });
    expect(parseCardLine('1x Atraxa *CMDR*')).toMatchObject({ name: 'Atraxa', cmdr: true });
  });

  it('rejects lines that are not cards', () => {
    expect(parseCardLine('---')).toBeNull();
    expect(parseCardLine('0 Sol Ring')).toBeNull();
  });
});

describe('parseDeckText', () => {
  it('reads Moxfield / Arena sections', () => {
    const p = parseDeckText('About\nName Kinnan Combo\n\nCommander\n1 Kinnan, Bonder Prodigy (IKO) 192\n\nDeck\n1 Sol Ring (CMM) 400 *F*\n2 Island\n\nSideboard\n1 Counterspell\n');
    expect(p.title).toBe('Kinnan Combo');
    expect(p.entries.map((e) => [e.section, e.name, e.count])).toEqual([
      ['commander', 'Kinnan, Bonder Prodigy', 1],
      ['main', 'Sol Ring', 1],
      ['main', 'Island', 2],
      ['sideboard', 'Counterspell', 1],
    ]);
  });

  it('treats a trailing one- or two-card group of an MTGO list as possible commanders', () => {
    const p = parseDeckText('1 Sol Ring\n1 Island\n\n1 Kinnan, Bonder Prodigy\n');
    expect(p.entries.find((e) => e.name === 'Kinnan, Bonder Prodigy')).toMatchObject({ maybeCommander: true, section: 'main' });
    expect(p.entries.find((e) => e.name === 'Sol Ring')?.maybeCommander).toBeUndefined();
  });

  it('reads SB: lines, header variants, and skips comments and tokens', () => {
    const p = parseDeckText('// a comment\nCommanders (1)\n1 Kinnan, Bonder Prodigy\nMainboard:\n1 Sol Ring\nSB: 1 Counterspell\nTokens\n1 Soldier\nMaybeboard\n1 Rhystic Study');
    expect(p.entries.map((e) => [e.section, e.name])).toEqual([
      ['commander', 'Kinnan, Bonder Prodigy'],
      ['main', 'Sol Ring'],
      ['sideboard', 'Counterspell'],
      ['maybeboard', 'Rhystic Study'],
    ]);
    expect(p.skipped.map((s) => s.raw)).toEqual(['1 Soldier']);
  });
});

describe('resolveImport', () => {
  it('matches names case-insensitively, by front face, and lists every unmatched line', () => {
    const r = importText('Commander\n1 kinnan, bonder prodigy\n\nDeck\n1 sol ring\n1 Fire\n1 Delver of Secrets\n3 Islandd\n1 Totally Fake Card (XYZ) 1\n', index);
    expect(r.commanders).toEqual(['Kinnan, Bonder Prodigy']);
    expect(r.main).toEqual([
      { name: 'Sol Ring', count: 1 },
      { name: 'Fire // Ice', count: 1 },
      { name: 'Delver of Secrets // Insectile Aberration', count: 1 },
    ]);
    expect(r.unmatched).toEqual([
      { line: 8, raw: '3 Islandd', name: 'Islandd' },
      { line: 9, raw: '1 Totally Fake Card (XYZ) 1', name: 'Totally Fake Card' },
    ]);
  });

  it('takes the MTGO sideboard commander only if it can be one', () => {
    expect(importText('1 Sol Ring\n\n1 Kinnan, Bonder Prodigy', index).commanders).toEqual(['Kinnan, Bonder Prodigy']);
    const notCommander = importText('1 Sol Ring\n\n1 Counterspell', index);
    expect(notCommander.commanders).toEqual([]);
    expect(notCommander.main.map((c) => c.name)).toEqual(['Sol Ring', 'Counterspell']);
  });

  it('merges repeated lines and keeps a commander out of the 99', () => {
    const r = importText('Commander\n1 Kinnan, Bonder Prodigy\nDeck\n1 Island\n2 Island\n1 Kinnan, Bonder Prodigy', index);
    expect(r.main).toEqual([{ name: 'Island', count: 3 }]);
    expect(r.notes.join(' ')).toMatch(/kept it as commander/);
  });
});

describe('commander rules', () => {
  it('knows who can be a commander', () => {
    expect(commanderProblem(card('Kinnan, Bonder Prodigy'))).toBeNull();
    expect(commanderProblem(card('Walker Commander'))).toBeNull();
    expect(commanderProblem(card('Sol Ring'))).toMatch(/legendary creature/);
    expect(commanderProblem(card('Jace, the Mind Sculptor'))).toMatch(/legendary creature/);
  });

  it('pairs partners, "partner with", and Backgrounds', () => {
    expect(pairProblem(card('Partner A'), card('Partner B'))).toBeNull();
    expect(pairProblem(card('Pir Test'), card('Toothy Test'))).toBeNull();
    expect(pairProblem(card('Wilson Test'), card('Sage Test'))).toBeNull();
    expect(pairProblem(card('Partner A'), card('Pir Test'))).toMatch(/can’t be commanders together/);
    expect(pairProblem(card('Kinnan, Bonder Prodigy'), card('Partner A'))).toMatch(/can’t be commanders together/);
  });

  it('exempts basics and "any number" cards from the singleton rule', () => {
    expect(copyLimit(card('Forest'))).toBe(Infinity);
    expect(copyLimit(card('Rat Pack'))).toBe(Infinity);
    expect(copyLimit(card('Seven Test'))).toBe(7);
    expect(copyLimit(card('Sol Ring'))).toBe(1);
  });
});

describe('validateDeck', () => {
  const deck = (d: Partial<Deck>): Pick<Deck, 'commanders' | 'main'> => ({ commanders: [], main: [], ...d });
  const lookup = (n: string) => index.get(n);

  it('accepts a legal 100-card deck', () => {
    const r = validateDeck(deck({ commanders: ['Kinnan, Bonder Prodigy'], main: [{ name: 'Sol Ring', count: 1 }, { name: 'Island', count: 49 }, { name: 'Forest', count: 49 }] }), lookup);
    expect(r.total).toBe(100);
    expect(r.identity).toEqual(['U', 'G']);
    expect(r.problems).toEqual([]);
    expect(r.automation.full + r.automation.partial + r.automation.manual).toBe(100);
  });

  it('reports size, identity, singleton, banned and unknown cards', () => {
    const r = validateDeck(
      deck({ commanders: ['Kinnan, Bonder Prodigy'], main: [{ name: 'Sol Ring', count: 2 }, { name: 'Lightning Bolt', count: 1 }, { name: 'Banned Thing', count: 1 }, { name: 'Gone Card', count: 1 }, { name: 'Rat Pack', count: 20 }] }),
      lookup,
    );
    const kinds = r.problems.map((p) => p.kind);
    expect(kinds).toEqual(expect.arrayContaining(['size', 'identity', 'singleton', 'banned', 'unknown']));
    expect(r.byCard.get('Sol Ring')).toEqual(['singleton']);
    expect(r.byCard.get('Lightning Bolt')).toEqual(['identity']);
    expect(r.byCard.get('Rat Pack')).toEqual(['identity']);
    expect(r.byCard.get('Banned Thing')).toEqual(['banned']);
    expect(r.byCard.get('Gone Card')).toEqual(['unknown']);
  });

  it('checks commanders and pairs', () => {
    expect(validateDeck(deck({}), lookup).problems.map((p) => p.kind)).toContain('commander');
    expect(validateDeck(deck({ commanders: ['Sol Ring'] }), lookup).byCard.get('Sol Ring')).toContain('commander');
    expect(validateDeck(deck({ commanders: ['Kinnan, Bonder Prodigy', 'Partner A'] }), lookup).problems.some((p) => /together/.test(p.message))).toBe(true);
    const bg = validateDeck(deck({ commanders: ['Wilson Test', 'Sage Test'] }), lookup);
    expect(bg.problems.filter((p) => p.kind === 'commander')).toEqual([]);
    expect(bg.identity).toEqual(['U', 'G']);
  });
});

describe('export and remote decks', () => {
  it('round-trips through text', () => {
    const d = { commanders: ['Kinnan, Bonder Prodigy'], main: [{ name: 'Sol Ring', count: 1 }, { name: 'Island', count: 98 }], sideboard: [{ name: 'Counterspell', count: 1 }] };
    const text = deckToText(d);
    expect(text).toBe('Commander\n1 Kinnan, Bonder Prodigy\n\nDeck\n98 Island\n1 Sol Ring\n\nSideboard\n1 Counterspell\n');
    const back = importText(text, index);
    expect(back.commanders).toEqual(d.commanders);
    expect(back.main).toEqual([{ name: 'Island', count: 98 }, { name: 'Sol Ring', count: 1 }]);
    expect(back.sideboard).toEqual(d.sideboard);
  });

  it('recognises deck URLs', () => {
    expect(parseDeckUrl('https://www.moxfield.com/decks/AbC_12-x')).toEqual({ site: 'moxfield', id: 'AbC_12-x' });
    expect(parseDeckUrl('https://archidekt.com/decks/123456/kinnan')).toEqual({ site: 'archidekt', id: '123456' });
    expect(parseDeckUrl('1 Sol Ring')).toBeNull();
  });

  it('turns Moxfield and Archidekt API answers into deck text', () => {
    const mox = moxfieldToText({ boards: { commanders: { cards: { a: { quantity: 1, card: { name: 'Kinnan, Bonder Prodigy' } } } }, mainboard: { cards: { b: { quantity: 2, card: { name: 'Island' } } } } } });
    expect(importText(mox, index)).toMatchObject({ commanders: ['Kinnan, Bonder Prodigy'], main: [{ name: 'Island', count: 2 }] });
    const arch = archidektToText({
      categories: [{ name: 'Commander', isPremier: true }, { name: 'Maybeboard', includedInDeck: false }, { name: 'Ramp' }],
      cards: [
        { quantity: 1, categories: ['Commander'], card: { oracleCard: { name: 'Kinnan, Bonder Prodigy' } } },
        { quantity: 1, categories: ['Ramp'], card: { oracleCard: { name: 'Sol Ring' } } },
        { quantity: 1, categories: ['Maybeboard'], card: { oracleCard: { name: 'Rhystic Study' } } },
      ],
    });
    expect(importText(arch, index)).toMatchObject({ commanders: ['Kinnan, Bonder Prodigy'], main: [{ name: 'Sol Ring', count: 1 }], sideboard: [{ name: 'Rhystic Study', count: 1 }] });
  });
});
