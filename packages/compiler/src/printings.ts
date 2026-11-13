import type { AltName } from '@mtg/schema';
import type { ScryfallCard, ScryfallFace } from './scryfall.js';

/**
 * Alternate names. Scryfall's Oracle Cards file has one printing of each card; the names a card carries on its other
 * printings — a Universes Beyond or Secret Lair reskin ("Seymour Guado" on a Kinnan, Bonder Prodigy), the Godzilla
 * series — are on those printings, in the Default Cards file (every English printing). This reads them out, so a
 * deck list written with such a name finds the card.
 */

const IMAGE_PREFIX = /^https:\/\/cards\.scryfall\.io\/[a-z_]+\//;
/** Not game pieces, or not cards a deck list names. */
const SKIP_LAYOUTS = new Set(['art_series', 'planar', 'scheme', 'vanguard', 'front_card', 'token', 'double_faced_token', 'emblem']);

const same = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' }) === 0;
const img = (uri: string | undefined) => (uri ? uri.replace(IMAGE_PREFIX, '') : undefined);
/** The name a printing gives a card or face instead of its own, if it does. */
const otherName = (x: { name: string; flavor_name?: string; printed_name?: string }) => {
  const n = x.flavor_name ?? x.printed_name;
  return n && !same(n, x.name) ? n : undefined;
};

/** The alternate names one printing carries, by the oracle id of the card each belongs to. */
export function altNamesOf(card: ScryfallCard): { oracleId: string; alt: AltName; released: string }[] {
  if (card.object !== 'card' || SKIP_LAYOUTS.has(card.layout)) return [];
  // Translations aren't alternate names (and a list in another language isn't something the importer reads).
  if (card.lang && card.lang !== 'en') return [];
  const number = card.collector_number ?? '';
  const released = card.released_at ?? '';
  const faces: ScryfallFace[] = card.card_faces ?? [];
  const entry = (oracleId: string | undefined, name: string, front?: string, back?: string) =>
    oracleId ? [{ oracleId, released, alt: { name, set: card.set, number, ...(front ? { img: front } : {}), ...(back ? { backImg: back } : {}) } }] : [];

  // A reversible card is two cards printed back to back, each with its own identity.
  if (card.layout === 'reversible_card') {
    return faces.flatMap((f) => {
      const n = otherName(f);
      return n ? entry(f.oracle_id, n, img(f.image_uris?.normal)) : [];
    });
  }
  const oracleId = card.oracle_id ?? faces[0]?.oracle_id;
  const front = img(card.image_uris?.normal ?? faces[0]?.image_uris?.normal);
  const back = card.image_uris ? undefined : img(faces[1]?.image_uris?.normal);
  const whole = otherName(card);
  if (whole) return entry(oracleId, whole, front, back);
  // Named face by face ("Godzilla, Doom Inevitable // …"): the whole name is the faces', as a card's own name is.
  if (faces.some(otherName)) return entry(oracleId, faces.map((f) => otherName(f) ?? f.name).join(' // '), front, back);
  return [];
}

/**
 * Gathers alternate names from printings into `into` (by oracle id). A name on several printings — foil and
 * non-foil versions, a reprint — is kept once, with its earliest printing.
 */
export function collectAltNames(printings: Iterable<ScryfallCard>, into: AltNameTable = new Map()): AltNameTable {
  for (const card of printings) {
    for (const { oracleId, alt, released } of altNamesOf(card)) {
      const list = into.get(oracleId) ?? [];
      if (!into.has(oracleId)) into.set(oracleId, list);
      const order = `${released || '9999'}|${alt.set}|${alt.number.padStart(8, '0')}`;
      const had = list.findIndex((x) => same(x.alt.name, alt.name));
      if (had < 0) list.push({ alt, order });
      else if (order < list[had]!.order) list[had] = { alt, order };
    }
  }
  return into;
}

export type AltNameTable = Map<string, { alt: AltName; order: string }[]>;

/** A card's alternate names from the table, without any that are just its own name or a face's. */
export function altNamesFor(table: AltNameTable, oracleId: string, ownNames: readonly string[]): AltName[] {
  return (table.get(oracleId) ?? [])
    .map((x) => x.alt)
    .filter((a) => !ownNames.some((n) => same(n, a.name)))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}
