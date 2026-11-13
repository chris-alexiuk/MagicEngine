import { describe, expect, it } from 'vitest';
import type { CardDef, FaceDef } from '@mtg/schema';
import { tokenArtFinder, tokenTextKey } from '@mtg/schema';
import { compileCards, reparseDB } from '../src/compile.js';
import type { ScryfallCard } from '../src/scryfall.js';

// A token a card makes is drawn with the scan of the printed token that has the same characteristics (CR 111.3).
let n = 0;
const card = (name: string, type_line: string, oracle_text: string, extra: Partial<ScryfallCard> = {}): ScryfallCard => ({
  object: 'card',
  id: `c${++n}`,
  oracle_id: `o${n}`,
  name,
  layout: 'normal',
  lang: 'en',
  set: 'tst',
  rarity: 'common',
  type_line,
  oracle_text,
  mana_cost: '{2}',
  cmc: 2,
  colors: [],
  color_identity: [],
  legalities: { commander: 'legal' },
  games: ['paper'],
  ...extra,
});
const token = (name: string, type_line: string, oracle_text: string, colors: string[], pt: [string, string] | null, img: string): ScryfallCard =>
  card(name, `Token ${type_line}`, oracle_text, {
    layout: 'token',
    set: 'ttst',
    set_type: 'token',
    mana_cost: '',
    colors,
    legalities: {},
    ...(pt ? { power: pt[0], toughness: pt[1] } : {}),
    image_uris: { normal: `https://cards.scryfall.io/normal/front/a/b/${img}.jpg?1` },
  });
const img = (id: string) => `front/a/b/${id}.jpg?1`;

const TOKENS = [
  token('Goblin', 'Creature — Goblin', '', ['R'], ['1', '1'], 'goblin'),
  token('Goblin', 'Creature — Goblin', "This creature can't block.", ['R'], ['1', '1'], 'goblin-cant-block'),
  token('Goblin', 'Creature — Goblin', 'Haste', ['R'], ['2', '1'], 'goblin-haste'),
  token('Treasure', 'Artifact — Treasure', '{T}, Sacrifice this token: Add one mana of any color.', [], null, 'treasure'),
  token('Citizen', 'Creature — Citizen', '', ['G', 'W'], ['1', '1'], 'citizen'),
  token('Angel', 'Creature — Angel', 'Flying\nVigilance', ['W'], ['4', '4'], 'angel'),
  token('Wurm', 'Artifact Creature — Wurm', 'Deathtouch', [], ['3', '3'], 'wurm-deathtouch'),
  token('Wurm', 'Artifact Creature — Wurm', 'Lifelink', [], ['3', '3'], 'wurm-lifelink'),
  token("Koma's Coil", 'Creature — Serpent', '', ['U'], ['3', '3'], 'coil'),
  token('Serpent', 'Creature — Serpent', '', ['U'], ['3', '3'], 'serpent'),
];

/** The faces of the tokens a compiled card's abilities make. */
function made(def: CardDef): FaceDef[] {
  const out: FaceDef[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o.type === 'create_token' && o.token) out.push(o.token as FaceDef);
      Object.values(o).forEach(walk);
    }
  };
  walk(def.faces[0]!.abilities);
  return out;
}
const compile = (...cards: ScryfallCard[]) => compileCards([...cards, ...TOKENS]).db;
const artOf = (name: string, type: string, text: string) => made(compile(card(name, type, text)).cards[0]!).map((f) => f.img);

describe('token art', () => {
  it('a described token takes the image of the printed token with the same characteristics', () => {
    expect(artOf('Mob Boss', 'Creature — Goblin', '{T}: Create a 1/1 red Goblin creature token.')).toEqual([img('goblin')]);
    expect(artOf('Tithe', 'Enchantment', 'When this enchantment enters, create a Treasure token.')).toEqual([img('treasure')]);
  });

  it('the rules text has to be the same: a Goblin that can’t block is another token', () => {
    expect(artOf('Recruiter', 'Sorcery', 'Create a 1/1 red Goblin creature token with "This token can\'t block."')).toEqual([img('goblin-cant-block')]);
    expect(artOf('Raider', 'Sorcery', 'Create a 2/1 red Goblin creature token with haste.')).toEqual([img('goblin-haste')]);
    // Nobody printed a 1/1 Goblin with haste here: no image, and the app draws the token.
    expect(artOf('Rabble', 'Sorcery', 'Create a 1/1 red Goblin creature token with haste.')).toEqual([undefined]);
  });

  it('colours and keywords match however they are listed', () => {
    expect(artOf('Rally', 'Sorcery', 'Create a 1/1 green and white Citizen creature token.')).toEqual([img('citizen')]);
    expect(artOf('Decree', 'Sorcery', 'Create a 4/4 white Angel creature token with flying and vigilance.')).toEqual([img('angel')]);
    expect(tokenTextKey({ name: 'Angel Token', oracle: 'Flying, vigilance' })).toBe(tokenTextKey({ name: 'Angel', oracle: 'Vigilance\nFlying (This creature can fly.)' }));
  });

  it('a printed token’s name for itself reads as "this token"', () => {
    expect(tokenTextKey({ name: "Ajani's Pridemate", oracle: "Whenever you gain life, put a +1/+1 counter on Ajani's Pridemate." })).toBe(
      tokenTextKey({ name: "Ajani's Pridemate", oracle: 'Whenever you gain life, put a +1/+1 counter on this token.' }),
    );
    expect(tokenTextKey({ name: 'Meteorite', oracle: 'When Meteorite enters the battlefield, it deals 2 damage to any target.' })).toBe(
      tokenTextKey({ name: 'Meteorite', oracle: 'When this artifact enters, it deals 2 damage to any target.' }),
    );
  });

  it('a creature type added since the token was printed still finds it', () => {
    // Wurmcoil Engine's tokens are Phyrexian Wurms now; the printed ones say Wurm.
    const arts = artOf('Engine', 'Artifact Creature — Phyrexian Wurm', 'When this creature dies, create a 3/3 colorless Phyrexian Wurm artifact creature token with deathtouch and a 3/3 colorless Phyrexian Wurm artifact creature token with lifelink.');
    expect(arts).toEqual([img('wurm-deathtouch'), img('wurm-lifelink')]);
  });

  it('a token with a name of its own is only that token', () => {
    expect(artOf('Koma', 'Legendary Creature — Serpent', "At the beginning of each upkeep, create a 3/3 blue Serpent creature token named Koma's Coil.")).toEqual([img('coil')]);
    expect(artOf('Serpentine', 'Sorcery', 'Create a 3/3 blue Serpent creature token.')).toEqual([img('serpent')]);
    const find = tokenArtFinder(compile().tokens);
    const coil = made(compile(card('Koma', 'Legendary Creature — Serpent', "At the beginning of each upkeep, create a 3/3 blue Serpent creature token named Koma's Coil.")).cards[0]!)[0]!;
    expect(find({ ...coil, img: undefined, name: 'Storm Serpent' } as FaceDef)).toBeUndefined();
  });

  it('parsing the card data again keeps the images', () => {
    const db = compile(card('Mob Boss', 'Creature — Goblin', '{T}: Create a 1/1 red Goblin creature token.'));
    expect(made(reparseDB(db).cards[0]!).map((f) => f.img)).toEqual([img('goblin')]);
  });
});
