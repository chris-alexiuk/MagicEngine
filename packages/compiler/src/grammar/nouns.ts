import type { KeywordInstance, ObjectFilter, Ref, TargetSpec } from '@mtg/schema';
import { attempt, type Binder } from './binder.js';
import { capitalise, COLOR_WORDS, parseAmount, SUPERTYPE_WORDS, subtypeOf, TYPE_NOUNS } from './words.js';

/**
 * Noun phrases: "target nonblack creature an opponent controls",
 * "each other Elf you control", "up to two target artifacts", "enchanted creature".
 */

export interface ParsedFilter {
  filter: ObjectFilter;
  plural: boolean;
}

const PLURAL_HEADS = new Set(['permanents', 'spells', 'cards', 'tokens']);
/** CR 110.4: the permanent card types. */
const PERMANENT_TYPES = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'];

/** Post-modifiers, peeled off the end of a phrase one at a time. */
const SUFFIXES: [RegExp, (f: ObjectFilter, m: RegExpExecArray, b: Binder) => boolean][] = [
  [/ you control$/, (f) => !f.controller && ((f.controller = 'you'), true)],
  [/ you don't control$/, (f) => !f.controller && ((f.controller = 'not_you'), true)],
  [/ (?:an opponent controls|your opponents control|opponents control)$/, (f) => !f.controller && ((f.controller = 'opponent'), true)],
  [/ enchanted player controls$/, (f) => !f.controller && ((f.controller = 'enchanted'), true)],
  [/ you own$/, (f) => !f.owner && ((f.owner = 'you'), true)],
  [/ of the chosen type$/, (f) => !f.chosenType && ((f.chosenType = true), true)],
  [/ of the chosen color$/, (f) => !f.chosenColor && ((f.chosenColor = true), true)],
  [/ (?:from|in) your graveyard$/, (f) => !f.zone && ((f.zone = 'graveyard'), (f.owner = 'you'), true)],
  [/ (?:from|in) an opponent's graveyard$/, (f) => !f.zone && ((f.zone = 'graveyard'), (f.owner = 'opponent'), true)],
  [/ (?:from|in) (?:a|any|target player's) graveyard$/, (f) => !f.zone && ((f.zone = 'graveyard'), true)],
  [/ (?:from|in) your library$/, (f) => !f.zone && ((f.zone = 'library'), (f.owner = 'you'), true)],
  [/ (?:from|in) your hand$/, (f) => !f.zone && ((f.zone = 'hand'), (f.owner = 'you'), true)],
  [/ on the battlefield$/, (f) => !f.zone && ((f.zone = 'battlefield'), true)],
  [/ with (power|toughness|mana value) (\d+) or (less|greater)$/, (f, m) => compare(f, m[1]!, Number(m[2]), m[3] === 'less' ? 'le' : 'ge')],
  [/ with (power|toughness|mana value) (\d+)$/, (f, m) => compare(f, m[1]!, Number(m[2]), 'eq')],
  [/ without ([a-z ,]+)$/, (f, m, b) => keywordList(f, 'notKeywords', m[1]!, b)],
  [/ with ([a-z ,]+)$/, (f, m, b) => keywordList(f, 'keywords', m[1]!, b)],
];

function compare(f: ObjectFilter, what: string, n: number, op: 'le' | 'ge' | 'eq'): boolean {
  const key = what === 'power' ? 'power' : what === 'toughness' ? 'toughness' : 'manaValue';
  if (f[key]) return false;
  f[key] = { op, n };
  return true;
}

function keywordList(f: ObjectFilter, key: 'keywords' | 'notKeywords', text: string, b: Binder): boolean {
  const kws = parseKeywordList(text, b);
  if (!kws || f[key] || kws.some((k) => k.text || k.cost || k.n !== undefined)) return false;
  f[key] = kws.map((k) => k.id);
  return true;
}

/** "flying and first strike", "trample, haste" → keyword instances; null if any item isn't a keyword. */
export function parseKeywordList(text: string, b: Binder): KeywordInstance[] | null {
  const items = text.split(/,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+/).filter(Boolean);
  const out: KeywordInstance[] = [];
  for (const item of items) {
    const kw = b.env.keywords.parseChunk(item, true);
    if (!kw) return null;
    out.push(kw);
  }
  return out.length ? out : null;
}

type Category = 'type' | 'color' | 'combat' | 'subtype' | 'super';

function categoryOf(word: string): Category | null {
  if (TYPE_NOUNS[word.toLowerCase()]) return 'type';
  if (COLOR_WORDS[word.toLowerCase()]) return 'color';
  if (word === 'attacking' || word === 'blocking') return 'combat';
  if (SUPERTYPE_WORDS[word.toLowerCase()]) return 'super';
  if (subtypeOf(word)) return 'subtype';
  return null;
}

/** Parses the noun phrase after a determiner: "nonblack creature an opponent controls". */
export function parseFilter(text: string, b: Binder): ParsedFilter | null {
  let rest = text.trim();
  const f: ObjectFilter = {};
  for (let guard = 0; guard < 8; guard++) {
    let matched = false;
    for (const [re, apply] of SUFFIXES) {
      const m = re.exec(rest);
      if (m && m.index > 0 && apply(f, m, b)) {
        rest = rest.slice(0, m.index);
        matched = true;
        break;
      }
    }
    if (!matched) break;
  }

  // "noncreature, nonland permanent": a comma between "non-" words is "and".
  rest = rest.replace(/,\s+(?=non)/g, ' ');
  const parts = rest.split(/,\s*(?:and\/)?or\s+|\s+(?:and\/)?or\s+|,\s+/).map((p) => p.replace(/^an? /, ''));
  const last = parts[parts.length - 1]!;
  const base: ObjectFilter = { ...f };
  const head = parseHeadPhrase(last, f);
  if (!head) return null;
  if (parts.length > 1) {
    // "artifact or enchantment", "red or green creature", "instant or sorcery spell":
    // the earlier words stand in for the first word of the last part.
    const first = last.split(' ')[0]!;
    const cat = categoryOf(first);
    const simple = cat && parts.slice(0, -1).every((alt) => !alt.includes(' ') && categoryOf(alt) === cat);
    if (simple) {
      for (const alt of parts.slice(0, -1)) if (!addAlternative(f, cat, alt, first)) return null;
    } else {
      // Different kinds of words: "creature or Vehicle", "artifact or non-Aura enchantment" — any one of them.
      const anyOf: ObjectFilter[] = [];
      for (const part of parts) {
        const alt: ObjectFilter = base.zone ? { zone: base.zone } : {};
        if (!parseHeadPhrase(part, alt)) return null;
        delete alt.zone;
        anyOf.push(alt);
      }
      return { filter: { ...base, ...(f.zone && !base.zone ? { zone: f.zone } : {}), anyOf }, plural: head.plural };
    }
  }
  return { filter: f, plural: head.plural };
}

function addAlternative(f: ObjectFilter, cat: Category, alt: string, replaced: string): boolean {
  switch (cat) {
    case 'type': {
      const t = TYPE_NOUNS[alt.toLowerCase()]!;
      const r = TYPE_NOUNS[replaced.toLowerCase()]!;
      // The replaced word sits in `types` (as head or the only type adjective); alternatives join it.
      if (!f.types?.includes(r)) return false;
      f.types = [t, ...f.types.filter((x) => x !== t)];
      if (f.allTypes) f.allTypes = f.allTypes.filter((x) => x !== r);
      return true;
    }
    case 'color':
      f.colors = [COLOR_WORDS[alt.toLowerCase()]!, ...(f.colors ?? [])];
      return true;
    case 'combat':
      if (!f.combat) return false;
      f.combat = 'attacking_or_blocking';
      return true;
    case 'subtype':
      f.subtypes = [subtypeOf(alt)!, ...(f.subtypes ?? [])];
      return true;
    default:
      return false;
  }
}

/** Adjectives + head noun: "tapped nonblack Zombie creature". */
function parseHeadPhrase(text: string, f: ObjectFilter): { plural: boolean } | null {
  const words = text.trim().split(/\s+/);
  const headWord = words[words.length - 1]!;
  const adjectives = words.slice(0, -1);
  let plural = false;
  let headType: string | null = null;

  const lower = headWord.toLowerCase();
  if (TYPE_NOUNS[lower]) {
    headType = TYPE_NOUNS[lower]!;
    plural = lower !== headType.toLowerCase() && lower !== 'kindred';
  } else if (/^permanents?$/.test(lower)) {
    plural = lower.endsWith('s');
  } else if (/^spells?$/.test(lower)) {
    if (f.zone && f.zone !== 'stack') return null;
    f.zone = 'stack';
    plural = lower.endsWith('s');
  } else if (/^cards?$/.test(lower)) {
    if (!f.zone || f.zone === 'battlefield') return null; // cards in hand/library/graveyard need the zone stated
    plural = lower.endsWith('s');
  } else if (/^commanders?$/.test(lower)) {
    // CR 903.3
    f.commander = true;
    plural = lower.endsWith('s');
  } else if (/^tokens?$/.test(lower)) {
    f.token = true;
    plural = lower.endsWith('s');
  } else if (subtypeOf(headWord)) {
    f.subtypes = [subtypeOf(headWord)!];
    plural = subtypeOf(headWord) !== headWord;
  } else return null;
  if (PLURAL_HEADS.has(lower)) plural = true;

  const adjTypes: string[] = [];
  for (const raw of adjectives) {
    const w = raw.toLowerCase();
    const non = /^non-?(.+)$/.exec(raw);
    if (non) {
      const x = non[1]!;
      const xl = x.toLowerCase();
      if (TYPE_NOUNS[xl]) (f.notTypes ??= []).push(TYPE_NOUNS[xl]!);
      else if (COLOR_WORDS[xl]) (f.notColors ??= []).push(COLOR_WORDS[xl]!);
      else if (xl === 'token') f.token = false;
      else if (SUPERTYPE_WORDS[xl]) (f.notSupertypes ??= []).push(SUPERTYPE_WORDS[xl]!);
      else if (subtypeOf(capitalise(x))) (f.notSubtypes ??= []).push(subtypeOf(capitalise(x))!);
      else return null;
      continue;
    }
    if (COLOR_WORDS[w]) (f.colors ??= []).push(COLOR_WORDS[w]!);
    else if (w === 'colorless') f.colorless = true;
    else if (w === 'multicolored') f.multicolored = true;
    else if (w === 'tapped') f.tapped = true;
    else if (w === 'untapped') f.tapped = false;
    else if (w === 'attacking') f.combat = 'attacking';
    else if (w === 'blocking') f.combat = 'blocking';
    else if (SUPERTYPE_WORDS[w]) (f.supertypes ??= []).push(SUPERTYPE_WORDS[w]!);
    else if (TYPE_NOUNS[w] && w === TYPE_NOUNS[w]!.toLowerCase()) adjTypes.push(TYPE_NOUNS[w]!);
    else if (w === 'token') f.token = true;
    // "permanent card" (CR 110.4b): a card with a permanent type.
    else if (w === 'permanent' && /^cards?$/.test(lower)) f.types = [...PERMANENT_TYPES];
    else if (subtypeOf(raw) === raw) (f.subtypes ??= []).push(raw);
    else return null;
  }

  if (f.types && adjTypes.length) return null; // "permanent creature card"
  if (headType) {
    f.types = [headType];
    if (adjTypes.length) f.allTypes = adjTypes;
  } else if (adjTypes.length) {
    f.types = [adjTypes[adjTypes.length - 1]!];
    if (adjTypes.length > 1) f.allTypes = adjTypes.slice(0, -1);
  }
  return { plural };
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

export type RefMode = 'effect' | 'static';

const PRONOUNS = /^(?:it|them|that (?:creature|permanent|card|spell|token|land|artifact|enchantment|planeswalker|spell or ability)|those (?:creatures|permanents|cards|tokens))$/i;

export interface ParsedRef {
  ref: Ref;
  plural: boolean;
  /** True when the phrase declared a target. */
  targeted: boolean;
}

/**
 * An object phrase in an effect or static ability. Declares targets on the binder
 * and updates the "it" antecedent.
 */
export function parseObjectRef(text: string, b: Binder, mode: RefMode = 'effect'): ParsedRef | null {
  return attempt(b, (b) => {
    const t = text.trim();
    if (t === '~') return set(b, { ref: { ref: 'self' }, plural: false, targeted: false });
    const named = b.named[t.toLowerCase()];
    if (named) return set(b, { ref: named, plural: false, targeted: false });
    // CR 607.2a: "the exiled card", "all cards exiled with ~" — linked to the ability that exiled them.
    const exiled = /^(?:the exiled (card|cards)|(?:all |each |the )?(cards?) exiled with (?:~|it))$/i.exec(t);
    if (exiled) return set(b, { ref: { ref: 'exiled_with' }, plural: /s$/.test(exiled[1] ?? exiled[2]!) || /^(?:all|each) /i.test(t), targeted: false });
    // "return ~ from your graveyard to your hand": the ability functions from the graveyard (CR 113.6m).
    if (t === '~ from your graveyard') {
      b.selfZone = 'graveyard';
      return set(b, { ref: { ref: 'self' }, plural: false, targeted: false });
    }
    if (PRONOUNS.test(t)) return b.it ? { ref: b.it, plural: /^(them|those)/i.test(t), targeted: false } : null;
    if (/^(?:enchanted|equipped) (?:creature|permanent|land|artifact|planeswalker)$/i.test(t)) {
      return set(b, { ref: { ref: 'attached' }, plural: false, targeted: false });
    }

    if (mode === 'effect') {
      const tm = /^(?:(up to )?((?!another\b|other\b)\w+) )?(another |other )?target (.+)$/i.exec(t);
      if (tm) {
        const count = tm[2] ? parseAmount(tm[2]) : 1;
        if (typeof count !== 'number' || count < 1) return null;
        const pf = parseFilter(tm[4]!, b);
        if (!pf || pf.plural !== count > 1) return null;
        if (tm[3]) pf.filter.other = true;
        const spec: TargetSpec = { what: 'object', filter: pf.filter, text: t.replace(/^\w/, (c) => c.toLowerCase()) };
        if (count > 1) spec.count = count;
        if (tm[1]) spec.upTo = true;
        return set(b, { ref: b.addTarget(spec), plural: count > 1, targeted: true });
      }
    }

    const each = /^(?:each|all) (other )?(.+)$/i.exec(t);
    if (each) {
      const pf = parseFilter(each[2]!, b);
      if (!pf) return null;
      if (each[1]) pf.filter.other = true;
      return set(b, { ref: { ref: 'all', filter: pf.filter }, plural: true, targeted: false });
    }
    // Bare plurals: "Creatures you control", "Other Zombies you control".
    const bare = /^(other )?(.+)$/i.exec(t)!;
    const pf = parseFilter(bare[2]!, b);
    if (!pf || !pf.plural) return null;
    if (bare[1]) pf.filter.other = true;
    return set(b, { ref: { ref: 'all', filter: pf.filter }, plural: true, targeted: false });
  });
}

function set(b: Binder, r: ParsedRef): ParsedRef {
  b.it = r.ref;
  return r;
}

/** Player phrases: "you", "target opponent", "each player", "that player", "its controller". */
export function parsePlayerRef(text: string, b: Binder): Ref | null {
  const t = text.trim().toLowerCase();
  if (t === 'you') return { ref: 'you' };
  if (t === 'each player') return { ref: 'players', who: 'each' };
  if (t === 'each opponent' || t === 'each of your opponents' || t === 'your opponents') return { ref: 'players', who: 'opponents' };
  if (t === 'target player' || t === 'target opponent') {
    const spec: TargetSpec = { what: 'player', text: t };
    if (t === 'target opponent') spec.player = 'opponent';
    const ref = b.addTarget(spec);
    b.player = ref;
    return ref;
  }
  if (t === 'that player' || t === 'they') return b.player;
  // CR 303.4: an Aura attached to a player (Curses).
  if (t === 'enchanted player') return { ref: 'enchanted_player' };
  if (b.named[t]) return b.named[t]!;
  const owner = /^(?:its|that (?:creature|permanent|spell|card)'s) (controller|owner)$/.exec(t);
  if (owner && b.it) return { ref: owner[1] === 'controller' ? 'controller_of' : 'owner_of', of: b.it };
  return null;
}

const ANY_TARGET_TYPES = ['Creature', 'Planeswalker', 'Battle'];

/** Damage recipients: "any target", "target creature or player", "each creature and each player". */
export function parseRecipients(text: string, b: Binder): Ref[] | null {
  return attempt(b, (b) => {
    const t = text.trim();
    const any = /^(?:any (other )?target|(another )?target (creature|player|opponent|planeswalker|battle)(?:,? (?:creature|player|planeswalker|battle))*,? or (creature|player|planeswalker|battle))$/i.exec(t);
    if (any) {
      if (/^any/i.test(t)) {
        const filter = { types: ANY_TARGET_TYPES, ...(any[1] ? { other: true as const } : {}) };
        return [b.addTarget({ what: 'any', filter, text: 'any target' })];
      }
      const words = t.replace(/^(?:another )?target /i, '').split(/,? or |, /).map((w) => w.toLowerCase());
      const isPlayer = (w: string): boolean => w === 'player' || w === 'opponent';
      const players = words.filter(isPlayer);
      // "target creature or planeswalker" has no player: it's an object target, handled below.
      if (players.length === 1) {
        const types = words.filter((w) => !isPlayer(w)).map((w) => TYPE_NOUNS[w]!);
        const spec: TargetSpec = { what: 'any', filter: { types }, text: t.toLowerCase() };
        if (players[0] === 'opponent') spec.player = 'opponent';
        const ref = b.addTarget(spec);
        b.it = ref;
        b.player = ref;
        return [ref];
      }
      if (players.length > 1) return null;
    }
    // "each of two target creatures", "each of up to two targets" (CR 115.4).
    const eachOf = /^each of (up to )?(\w+) (?:other )?targets?(?: (.+))?$/i.exec(t);
    if (eachOf) {
      const count = parseAmount(eachOf[2]!);
      if (typeof count !== 'number' || count < 2) return null;
      let spec: TargetSpec;
      if (!eachOf[3]) spec = { what: 'any', filter: { types: ANY_TARGET_TYPES }, text: t, count };
      else {
        const pf = parseFilter(eachOf[3], b);
        if (!pf || !pf.plural) return null;
        spec = { what: 'object', filter: pf.filter, text: t, count };
      }
      if (eachOf[1]) spec.upTo = true;
      const ref = b.addTarget(spec);
      b.it = ref;
      return [ref];
    }
    const parts = t.split(/ and (?=each |you$|target |~)/);
    const out: Ref[] = [];
    for (const part of parts) {
      const player = parsePlayerRef(part, b);
      if (player) {
        out.push(player);
        continue;
      }
      const obj = parseObjectRef(part, b);
      if (!obj) return null;
      out.push(obj.ref);
    }
    return out;
  });
}
