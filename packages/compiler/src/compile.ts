import type { Automation, CardDB, CardDef, Color, FaceDef, LegalityCode } from '@mtg/schema';
import { COLORS, keywordSupported, linkTokenArt, manualModes, SCHEMA_VERSION, stripReminder } from '@mtg/schema';
import { defaultRegistry, type ParserRegistry } from './parser.js';
import type { ScryfallCard, ScryfallFace } from './scryfall.js';
import { parseTypeLine } from './typeline.js';
import { registerPoolSubtypes } from './grammar/words.js';
import { altNamesFor, collectAltNames, type AltNameTable } from './printings.js';

/** Layouts that are not game pieces in a normal game (front_card: theme/tutorial cards from starter products). */
const SKIP_LAYOUTS = new Set(['art_series', 'planar', 'scheme', 'vanguard', 'reversible_card_back', 'front_card']);
const TOKEN_LAYOUTS = new Set(['token', 'double_faced_token', 'emblem']);
/** Layouts whose card_faces are distinct game faces (vs. reversible printings of one face). */
const MULTI_FACE_LAYOUTS = new Set([
  'split', 'flip', 'transform', 'modal_dfc', 'adventure', 'prepare', 'double_faced_token', 'meld',
]);

const IMAGE_PREFIX = /^https:\/\/cards\.scryfall\.io\/[a-z_]+\//;
const LEGALITY: Record<string, LegalityCode> = { legal: 'l', restricted: 'r', banned: 'b' };

export type SkipReason = 'layout' | 'digital_only' | 'un_set' | 'no_oracle_id' | 'duplicate';

export interface CompileOptions {
  registry?: ParserRegistry;
  source?: CardDB['source'];
  builtAt?: string;
  /** Alternate names read from other printings (printings.ts). The input's own printings are always read for theirs. */
  altNames?: AltNameTable;
}

export interface CompileResult {
  db: CardDB;
  skipped: Record<SkipReason, number>;
  /** Cards compiled from a printing that exists only on Arena, because the card itself is played on paper (their names). */
  digitalPrintings: string[];
}

export function compileCards(input: ScryfallCard[], opts: CompileOptions = {}): CompileResult {
  const registry = opts.registry ?? defaultRegistry;
  const skipped: Record<SkipReason, number> = { layout: 0, digital_only: 0, un_set: 0, no_oracle_id: 0, duplicate: 0 };
  const cards = new Map<string, CardDef>();
  const tokens = new Map<string, CardDef>();
  const digitalPrintings: string[] = [];
  registerPoolSubtypes(input.flatMap((c) => [c.type_line ?? '', ...(c.card_faces ?? []).map((f) => f.type_line ?? '')]));

  for (const card of input) {
    const reason = skipReason(card);
    if (reason) {
      skipped[reason]++;
      continue;
    }
    const id = card.oracle_id ?? card.card_faces?.[0]?.oracle_id;
    if (!id) {
      skipped.no_oracle_id++;
      continue;
    }
    const target = TOKEN_LAYOUTS.has(card.layout) ? tokens : cards;
    if (target.has(id)) {
      skipped.duplicate++;
      continue;
    }
    target.set(id, compileCard(card, id, registry));
    if (target === cards && onlyOnArena(card)) digitalPrintings.push(card.name);
  }

  linkMelds([...cards.values()]);
  // The tokens cards make are drawn with the printed tokens' scans.
  linkTokenArt([...cards.values(), ...tokens.values()], [...tokens.values()]);
  // The names each card is also printed under.
  const altNames = collectAltNames(input, opts.altNames ?? new Map());
  for (const def of cards.values()) {
    const aka = altNamesFor(altNames, def.id, [def.name, ...def.faces.map((f) => f.name)]);
    if (aka.length) def.aka = aka;
  }
  const byName = (a: CardDef, b: CardDef) => a.name.localeCompare(b.name);
  return {
    db: {
      schema: SCHEMA_VERSION,
      builtAt: opts.builtAt ?? new Date().toISOString(),
      source: opts.source ?? { kind: 'scryfall-oracle-cards' },
      cards: [...cards.values()].sort(byName),
      tokens: [...tokens.values()].sort(byName),
    },
    skipped,
    digitalPrintings,
  };
}

/** This printing exists only on Arena (not on paper, not on Magic Online). */
const onlyOnArena = (card: ScryfallCard): boolean => Boolean(card.games && !card.games.includes('paper') && !card.games.includes('mtgo'));
/** Legal — or banned, or restricted — in a format played with printed cards: the card exists off Arena. */
const playedOnPaper = (card: ScryfallCard): boolean => ['vintage', 'legacy', 'commander'].some((f) => ['legal', 'restricted', 'banned'].includes(card.legalities?.[f] ?? ''));

function skipReason(card: ScryfallCard): SkipReason | null {
  if (card.object !== 'card' || SKIP_LAYOUTS.has(card.layout)) return 'layout';
  // Scryfall's Oracle Cards file has one printing of each card, and that can be an Arena-only printing of a card that is
  // printed on paper too (Crucible of Worlds, from the day an Arena set reprinted it). Only a card that is itself
  // Arena-only — legal nowhere on paper — is left out.
  if (onlyOnArena(card) && !playedOnPaper(card)) return 'digital_only';
  if (card.set_type === 'funny' && !Object.values(card.legalities ?? {}).includes('legal')) return 'un_set';
  return null;
}

export function compileCard(card: ScryfallCard, id: string, registry: ParserRegistry = defaultRegistry): CardDef {
  const rawFaces: ScryfallFace[] =
    card.card_faces && card.card_faces.length > 0
      ? MULTI_FACE_LAYOUTS.has(card.layout)
        ? card.card_faces
        : [card.card_faces[0]!]
      : [card];

  const faces = rawFaces.map((face, i) => compileFace(card, face, i, registry));

  const legal: Record<string, LegalityCode> = {};
  for (const [format, status] of Object.entries(card.legalities ?? {})) {
    const code = LEGALITY[status];
    if (code) legal[format] = code;
  }

  const def: CardDef = {
    id,
    name: card.name,
    layout: card.layout,
    cmc: card.cmc ?? 0,
    colorIdentity: toColors(card.color_identity),
    faces,
    legal,
    set: card.set,
    rarity: card.rarity,
    automation: automationOf(faces),
  };
  if (card.game_changer) def.gameChanger = true;
  if (typeof card.edhrec_rank === 'number') def.rank = card.edhrec_rank;
  return def;
}

function compileFace(card: ScryfallCard, face: ScryfallFace, index: number, registry: ParserRegistry): FaceDef {
  const typeLine = face.type_line ?? card.type_line ?? '';
  const oracle = face.oracle_text ?? '';
  const manaCost = face.mana_cost ?? '';
  const parsed = registry.parse(oracle, { cardName: card.name, faceName: face.name, typeLine, manaCost });

  const out: FaceDef = {
    name: face.name,
    manaCost,
    typeLine,
    ...parseTypeLine(typeLine),
    oracle,
    // Faces may omit colors (split/adventure halves); card-level colors cover color indicators on single faces.
    colors: face.colors
      ? toColors(face.colors)
      : face === card && card.colors
        ? toColors(card.colors)
        : colorsOfCost(manaCost),
    keywords: parsed.keywords,
    abilities: parsed.abilities,
    unparsed: parsed.unparsed,
  };
  if (parsed.extraSubtypes) out.subtypes = [...new Set([...out.subtypes, ...parsed.extraSubtypes])];
  if (parsed.manualKeywords.length) out.manualKeywords = parsed.manualKeywords;
  for (const key of ['power', 'toughness', 'loyalty', 'defense'] as const) {
    const v = face[key];
    if (v !== undefined) out[key] = v;
  }
  // DFC faces carry their own images; split/adventure/flip share the card image (first face only).
  const imageSource = face.image_uris?.normal ?? (index === 0 ? card.image_uris?.normal : undefined);
  if (imageSource) out.img = imageSource.replace(IMAGE_PREFIX, '');
  // With the image, its credit (a face of its own image has an artist of its own).
  const artist = face.artist ?? (out.img ? card.artist : undefined);
  if (artist && out.img) out.artist = artist;
  return out;
}

/**
 * Re-runs the parser over an existing card DB's oracle text, so grammar changes can be
 * measured against the full card pool without downloading Scryfall data again.
 */
export function reparseDB(db: CardDB, registry: ParserRegistry = defaultRegistry): CardDB {
  registerPoolSubtypes([...db.cards, ...db.tokens].flatMap((c) => c.faces.map((f) => f.typeLine)));
  const reparse = (card: CardDef): CardDef => {
    const faces = card.faces.map((f) => {
      const p = registry.parse(f.oracle, { cardName: card.name, faceName: f.name, typeLine: f.typeLine, manaCost: f.manaCost });
      const { manualKeywords: _old, ...rest } = f;
      const subtypes = p.extraSubtypes ? [...new Set([...parseTypeLine(f.typeLine).subtypes, ...p.extraSubtypes])] : parseTypeLine(f.typeLine).subtypes;
      return { ...rest, subtypes, keywords: p.keywords, abilities: p.abilities, unparsed: p.unparsed, ...(p.manualKeywords.length ? { manualKeywords: p.manualKeywords } : {}) };
    });
    // What the sandbox found (CardDef.issues) stands until the sandbox plays the card again — its run starts from the
    // compiler's grade — so a pool reparsed here compares like for like with the pool it was made from.
    const read = automationOf(faces);
    return { ...card, faces, automation: card.issues?.length && read === 'full' ? 'partial' : read };
  };
  const cards = db.cards.map(reparse);
  const tokens = db.tokens.map(reparse);
  linkMelds(cards);
  linkTokenArt([...cards, ...tokens], tokens);
  return { ...db, schema: SCHEMA_VERSION, cards, tokens };
}

/**
 * CR 712.4a / 712.5: a meld ability names the combined back face its pair melds into — a card of its own in the data, whose
 * face is copied into the ability (CR 712.8g: the melded permanent has only that face's characteristics) — and the
 * counterpart, when the ability doesn't (the card that "Melds with" this one, in its reminder text). An ability whose back
 * face is missing, or isn't fully automated itself, is left unparsed.
 */
export function linkMelds(cards: CardDef[]): void {
  const named = new Map(cards.map((c) => [c.name, c]));
  const melds = (v: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] => {
    if (Array.isArray(v)) for (const x of v) melds(x, out);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o.type === 'meld' && typeof o.into === 'string') out.push(o);
      for (const x of Object.values(o)) melds(x, out);
    }
    return out;
  };
  for (const card of cards) {
    if (card.layout !== 'meld') continue;
    let changed = false;
    for (const face of card.faces) {
      const kept = face.abilities.filter((a) => {
        const nodes = melds(a);
        if (!nodes.length) return true;
        const ok = nodes.every((node) => {
          const result = named.get(node.into as string);
          const partner = (node.partner as string | undefined) ?? cards.find((c) => c !== card && c.layout === 'meld' && c.faces[0]?.oracle.includes(`(Melds with ${card.name}.)`))?.name;
          if (!result || result.layout !== 'meld' || result.automation !== 'full' || !partner) return false;
          node.partner = partner;
          node.result = { face: result.faces[0], cmc: result.cmc };
          return true;
        });
        if (!ok) face.unparsed.push(a.text);
        return ok;
      });
      if (kept.length !== face.abilities.length) {
        face.abilities = kept;
        changed = true;
      }
    }
    if (changed) card.automation = automationOf(card.faces);
  }
}

/**
 * How much of a card the compiler read: every line (full), some (partial), none (manual). The grade a card is given
 * before it is played in the sandbox, which can only lower it (CardDef.issues).
 */
export function automationOf(faces: FaceDef[]): Automation {
  const unparsed = faces.reduce((n, f) => n + f.unparsed.length + (f.manualKeywords?.length ?? 0) + manualModes(f).length, 0);
  if (unparsed === 0) return 'full';
  // Reminder-only lines describe rules the engine applies anyway (a shockland's
  // intrinsic mana ability from its land types, saga lore counters), so they count as handled.
  const reminderOnly = (f: FaceDef) => f.oracle.split('\n').filter((l) => l.trim() && !stripReminder(l)).length;
  const parsed = faces.reduce((n, f) => n + f.keywords.filter(keywordSupported).length + f.abilities.length + reminderOnly(f), 0);
  return parsed > 0 ? 'partial' : 'manual';
}

/** Canonical WUBRG order, whatever order the source used. */
function toColors(list: string[] | undefined): Color[] {
  const set = new Set(list ?? []);
  return COLORS.filter((c) => set.has(c));
}

function colorsOfCost(cost: string): Color[] {
  return COLORS.filter((c) => new RegExp(`\\{[^}]*${c}[^}]*\\}`).test(cost));
}
