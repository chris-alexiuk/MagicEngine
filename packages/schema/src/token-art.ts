import type { CardDef, FaceDef } from './index.js';

/**
 * Art for tokens. A card that makes a token describes it in words ("a 1/1 red Goblin creature token"); the printed
 * token cards are in the card data too, each with its scan. This finds the printed token with the same
 * characteristics as a described one (CR 111.3: a token has the characteristics its effect gives it) — name, card
 * types, colours, power and toughness, and rules text — so the described token can be drawn with that scan. A token
 * nobody printed has no match, and is drawn by the app.
 */

const WUBRG = 'WUBRG';
/** CR 111.4: a token that isn't given a name is named after its subtypes, plus "Token". */
const unnamed = (name: string) => name.endsWith(' Token');
const nameOf = (name: string) => name.replace(/ Token$/, '').toLowerCase();
const sorted = (list: readonly string[] | undefined) => [...(list ?? [])].sort().join(' ');
const size = (v: string | undefined) => (v === undefined ? '' : v === 'X' ? '*' : v);

/** What must be the same for two tokens to share a picture, apart from subtypes, name and text. */
function baseKey(f: FaceDef): string {
  const colors = [...f.colors].sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b)).join('');
  return [sorted(f.supertypes), sorted(f.types), colors, `${size(f.power)}/${size(f.toughness)}`].join('|');
}

/**
 * A token's rules text as a comparable string: reminder text dropped, the token's own name and "this token" /
 * "this creature" all read as "this", keywords one per line, lines in a fixed order. (A printed token says "This
 * creature can't block"; the card that makes it says "This token can't block".)
 */
export function tokenTextKey(f: Pick<FaceDef, 'name' | 'oracle'>): string {
  const self = nameOf(f.name);
  const out: string[] = [];
  for (const raw of f.oracle.replace(/\([^)]*\)/g, '').split('\n')) {
    let l = raw.trim().toLowerCase().replace(/[“”]/g, '"').replace(/’/g, "'").replace(/\s+/g, ' ').replace(/\.$/, '');
    if (!l) continue;
    if (self) l = l.split(self).join('this');
    l = l.replace(/\bthis (?:token|creature|artifact|enchantment|permanent|land|vehicle|equipment|aura)\b/g, 'this').replace(/ enters the battlefield\b/g, ' enters');
    const parts = l.split(/,\s*/);
    // A line of keywords ("Flying, vigilance") is each keyword on its own.
    if (!/[:."]/.test(l) && parts.every((p) => p.split(' ').length <= 3)) out.push(...parts);
    else out.push(l);
  }
  return out.sort().join('\n');
}

interface Printed {
  name: string;
  subtypes: ReadonlySet<string>;
  text: string;
  img: string;
}

/** A function from a token's face to the image of the printed token it matches, if any. */
export function tokenArtFinder(tokens: readonly CardDef[]): (face: FaceDef) => string | undefined {
  const index = new Map<string, Printed[]>();
  for (const t of tokens) {
    for (const f of t.faces) {
      // Emblems and the "cards" printed on token stock (rules inserts, helper cards) have no card type.
      if (!f.img || !f.types.length) continue;
      const key = baseKey(f);
      const list = index.get(key) ?? [];
      list.push({ name: nameOf(f.name), subtypes: new Set(f.subtypes), text: tokenTextKey(f), img: f.img });
      index.set(key, list);
    }
  }
  return (face) => {
    const text = tokenTextKey(face);
    const same = (index.get(baseKey(face)) ?? []).filter((p) => p.text === text);
    if (!same.length) return undefined;
    const want = new Set(face.subtypes);
    const name = nameOf(face.name);
    const sameSubtypes = (p: Printed) => p.subtypes.size === want.size && [...want].every((s) => p.subtypes.has(s));
    const exact = same.find((p) => p.name === name && sameSubtypes(p));
    if (exact) return exact.img;
    // A token with a name of its own ("Koma's Coil") is only that token.
    if (!unnamed(face.name)) return undefined;
    const bySubtypes = same.find(sameSubtypes);
    if (bySubtypes) return bySubtypes.img;
    // Creature types added to old tokens since they were printed (a "Wurm" token is a Phyrexian Wurm now): the printed
    // token whose subtypes are all among this one's, most of them first.
    const older = same.filter((p) => p.subtypes.size > 0 && [...p.subtypes].every((s) => want.has(s))).sort((a, b) => b.subtypes.size - a.subtypes.size);
    return older[0]?.img;
  };
}

/** Whether a value in a card's parsed abilities is a token's face ("create_token" and the replacements that make tokens). */
export function isTokenFace(v: unknown): v is FaceDef {
  if (!v || typeof v !== 'object') return false;
  const f = v as Partial<FaceDef>;
  return typeof f.typeLine === 'string' && /(?:^|\s)Token\b/.test(f.typeLine) && Array.isArray(f.types) && Array.isArray(f.subtypes) && typeof f.oracle === 'string' && Array.isArray(f.colors);
}

/**
 * Gives every token described in these cards' abilities the image of its printed token. Returns how many got one.
 * (The abilities are changed in place; a token face that already has an image keeps it.)
 */
export function linkTokenArt(cards: readonly CardDef[], tokens: readonly CardDef[]): number {
  const find = tokenArtFinder(tokens);
  let linked = 0;
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (!v || typeof v !== 'object') return;
    if (isTokenFace(v) && !v.img) {
      const img = find(v);
      if (img) {
        v.img = img;
        linked++;
      }
    }
    for (const x of Object.values(v)) walk(x);
  };
  for (const c of cards) for (const f of c.faces) walk(f.abilities);
  return linked;
}
