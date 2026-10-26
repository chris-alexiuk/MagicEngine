import type { Automation, CardDB, CardDef, Color, FaceDef, LegalityCode } from '@mtg/schema';
import { COLORS, SCHEMA_VERSION, stripReminder } from '@mtg/schema';
import { defaultRegistry, type ParserRegistry } from './parser.js';
import type { ScryfallCard, ScryfallFace } from './scryfall.js';
import { parseTypeLine } from './typeline.js';

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
}

export interface CompileResult {
  db: CardDB;
  skipped: Record<SkipReason, number>;
}

export function compileCards(input: ScryfallCard[], opts: CompileOptions = {}): CompileResult {
  const registry = opts.registry ?? defaultRegistry;
  const skipped: Record<SkipReason, number> = { layout: 0, digital_only: 0, un_set: 0, no_oracle_id: 0, duplicate: 0 };
  const cards = new Map<string, CardDef>();
  const tokens = new Map<string, CardDef>();

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
  };
}

function skipReason(card: ScryfallCard): SkipReason | null {
  if (card.object !== 'card' || SKIP_LAYOUTS.has(card.layout)) return 'layout';
  if (card.games && !card.games.includes('paper') && !card.games.includes('mtgo')) return 'digital_only';
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
  const parsed = registry.parse(oracle, { cardName: card.name, faceName: face.name, typeLine });

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
  for (const key of ['power', 'toughness', 'loyalty', 'defense'] as const) {
    const v = face[key];
    if (v !== undefined) out[key] = v;
  }
  // DFC faces carry their own images; split/adventure/flip share the card image (first face only).
  const imageSource = face.image_uris?.normal ?? (index === 0 ? card.image_uris?.normal : undefined);
  if (imageSource) out.img = imageSource.replace(IMAGE_PREFIX, '');
  return out;
}

/**
 * Re-runs the parser over an existing card DB's oracle text, so grammar changes can be
 * measured against the full card pool without downloading Scryfall data again.
 */
export function reparseDB(db: CardDB, registry: ParserRegistry = defaultRegistry): CardDB {
  const reparse = (card: CardDef): CardDef => {
    const faces = card.faces.map((f) => {
      const p = registry.parse(f.oracle, { cardName: card.name, faceName: f.name, typeLine: f.typeLine });
      return { ...f, keywords: p.keywords, abilities: p.abilities, unparsed: p.unparsed };
    });
    return { ...card, faces, automation: automationOf(faces) };
  };
  return { ...db, schema: SCHEMA_VERSION, cards: db.cards.map(reparse), tokens: db.tokens.map(reparse) };
}

function automationOf(faces: FaceDef[]): Automation {
  const unparsed = faces.reduce((n, f) => n + f.unparsed.length, 0);
  if (unparsed === 0) return 'full';
  // Reminder-only lines describe rules the engine applies anyway (a shockland's
  // intrinsic mana ability from its land types, saga lore counters), so they count as handled.
  const reminderOnly = (f: FaceDef) => f.oracle.split('\n').filter((l) => l.trim() && !stripReminder(l)).length;
  const parsed = faces.reduce((n, f) => n + f.keywords.length + f.abilities.length + reminderOnly(f), 0);
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
