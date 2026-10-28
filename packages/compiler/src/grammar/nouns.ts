import { grantableStatic, isQuoted, parseQuotedAbility } from './quoted.js';
import { keywordSupported, type KeywordInstance, type ObjectFilter, type Ref, type TargetSpec } from '@mtg/schema';
import { attempt, type Binder } from './binder.js';
import { parseCount } from './amounts.js';
import { capitalise, COLOR_WORDS, parseAmount, SUPERTYPE_WORDS, subtypeOf, TYPE_NOUNS } from './words.js';

/**
 * Noun phrases: "target nonblack creature an opponent controls",
 * "each other Elf you control", "up to two target artifacts", "enchanted creature".
 */

export interface ParsedFilter {
  filter: ObjectFilter;
  plural: boolean;
  /** "Merfolk", "Samurai", "Equipment": the same word in the singular and the plural — either, by context. */
  invariant?: boolean;
}

/** Subtypes whose plural is the same word ("Other Merfolk you control get +1/+1"). */
const INVARIANT_PLURALS = new Set(['Merfolk', 'Kithkin', 'Moonfolk', 'Kor', 'Samurai', 'Fish', 'Sheep', 'Djinn', 'Efreet', 'Aetherborn', 'Viashino', 'Vedalken', 'Eldrazi', 'Myr', 'Nephilim', 'Surrakar', 'Jellyfish', 'Starfish', 'Equipment']);

const PLURAL_HEADS = new Set(['permanents', 'spells', 'cards', 'tokens']);
/** CR 110.4: the permanent card types. */
const PERMANENT_TYPES = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'];

/** Post-modifiers, peeled off the end of a phrase one at a time. */
const SUFFIXES: [RegExp, (f: ObjectFilter, m: RegExpExecArray, b: Binder) => boolean][] = [
  // Loot, Exuberant Explorer: "a creature card with mana value less than or equal to the number of lands you control" —
  // counted as the effect applies. Before "you control": that's
  // the count's.
  // Pollywog Prodigy: "a noncreature spell with mana value less than this creature's power".
  // Mockingbird: "with mana value less than or equal to the amount of mana spent to cast this creature".
  // Vedalken Shackles: "target creature with power less than or equal to the number of Islands you control".
  // (A power compared with this creature's own stays powerBelowSource, below.)
  // Buster Sword: "with mana value less than or equal to that damage" — how much the trigger event was.
  // Birthing Pod: "a creature card with mana value equal to 1 plus the sacrificed creature's mana value" (CR 608.2h).
  [/ with (mana value|power|toughness) (less than or equal to|less than|greater than or equal to|greater than|equal to) (the number of .+|(?:~|this creature)'s (?:power|toughness)|the amount of mana spent to cast (?:~|this creature)|that damage|\w+ plus the sacrificed (?:creature|artifact|permanent)'s mana value)$/, (f, m, b) => {
    const key = m[1] === 'mana value' ? 'manaValue' : (m[1] as 'power' | 'toughness');
    if (key !== 'manaValue' && !/^the number of /.test(m[3]!)) return false;
    if (/ plus the sacrificed /.test(m[3]!) && m[2] !== 'equal to') return false;
    // "… in your library" is the card's zone: peeled first.
    if (f[key] || / in (?:your|their|a) (?:library|graveyard|hand)$/.test(m[3]!)) return false;
    if (m[3] === 'that damage' && !b.eventAmount) return false;
    const n = m[3] === 'that damage' ? ({ kind: 'event' } as const) : parseCount(m[3]!, b);
    if (!n) return false;
    const op = ({ 'less than or equal to': 'le', 'less than': 'lt', 'greater than or equal to': 'ge', 'greater than': 'gt', 'equal to': 'eq' } as const)[m[2] as 'less than'];
    f[key] = { op, n };
    return true;
  }],
  // The Darkness Crystal: "target creature card exiled with The Darkness Crystal" (CR 607.2a).
  [/ exiled with (?:~|this (?:artifact|creature|enchantment|permanent|land))$/, (f) => !f.exiledWithSource && !f.zone && ((f.exiledWithSource = true), (f.zone = 'exile'), true)],
  // Arachnogenesis: "the number of creatures attacking you" (not your planeswalkers).
  [/ attacking you$/, (f) => !f.combat && ((f.combat = 'attacking'), (f.attackingYou = true), true)],
  // Oviya, Automech Artisan: "Each creature that's attacking one of your opponents".
  [/ (?:that's|that are) attacking (?:one of your opponents|an opponent)$/, (f) => !f.combat && ((f.combat = 'attacking'), (f.attackingOpponent = true), true)],
  [/ you control$/, (f) => !f.controller && ((f.controller = 'you'), true)],
  [/ you don't control$/, (f) => !f.controller && ((f.controller = 'not_you'), true)],
  // Aku Djinn: "each creature each opponent controls"
  [/ (?:an opponent controls|your opponents control|opponents control|each opponent controls)$/, (f) => !f.controller && ((f.controller = 'opponent'), true)],
  [/ enchanted player controls$/, (f) => !f.controller && ((f.controller = 'enchanted'), true)],
  [/ defending player controls$/, (f) => !f.controller && ((f.controller = 'defending'), true)],
  // "all creatures target player controls", "each creature that player controls"
  [/ (target player|target opponent|that player|the chosen player|chosen player|they) controls?$/, (f, m, b) => {
    if (/control$/.test(m[0]) !== (m[1] === 'they')) return false;
    if (f.controller || f.controlledBy) return false;
    const who = parsePlayerRef(m[1]!, b);
    return Boolean(who && ((f.controlledBy = who), true));
  }],
  // "for each Aura attached to it": it is the source, or what the source enchants or equips.
  [/ attached to (it|~|this creature)$/, (f, m, b) => {
    const to = m[1] !== 'it' ? 'self' : b.it?.ref === 'attached' ? 'attached' : !b.it || b.it.ref === 'self' ? 'self' : null;
    return !f.attachedTo && to !== null && ((f.attachedTo = to), true);
  }],
  // CR 702.134a (mentor)
  [/ with power less than ~'s power$/, (f) => !f.powerBelowSource && ((f.powerBelowSource = true), true)],
  [/ you own$/, (f) => !f.owner && ((f.owner = 'you'), true)],
  // Agent of Treachery: "permanents you don't own" (CR 108.3: the other players own them).
  [/ you don't own$/, (f) => !f.owner && ((f.owner = 'opponent'), true)],
  // "a land card with a basic land type" (Boseiju)
  [/ with a basic land type$/, (f) => !f.subtypes && ((f.subtypes = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']), true)],
  // "target permanent other than this creature", "all creatures other than ~": the same as "another" / "other".
  [/ other than (?:~|this (?:creature|permanent|enchantment|artifact|land|card|planeswalker|Vehicle|Equipment|Aura|battle))$/, (f) => !f.other && ((f.other = true), true)],
  [/ dealt damage by ~ this turn$/, (f) => !f.damagedBySource && ((f.damagedBySource = true), true)],
  // Braids, Arisen Nightmare: "a permanent … that shares a card type with it" — what was sacrificed.
  [/ that shares a card type with the sacrificed permanent$/, (f) => !f.sharesCardTypeWithSacrificed && ((f.sharesCardTypeWithSacrificed = true), true)],
  // Relentless Assault: "Untap all creatures that attacked this turn."
  [/ that attacked this turn$/, (f) => !f.attackedThisTurn && ((f.attackedThisTurn = true), true)],
  // Steel Hellkite: "each nonland permanent with mana value X whose controller was dealt combat damage by this creature
  // this turn"
  [/ whose controller was dealt combat damage by (?:~|this creature) this turn$/, (f) => !f.controllerHitBySource && ((f.controllerHitBySource = true), true)],
  // Transmute (CR 702.53a), transfigure (CR 702.71a)
  [/ with the same mana value as (?:~|the discarded card|this card|this permanent)$/, (f) => !f.sameManaValueAs && ((f.sameManaValueAs = 'self'), true)],
  [/ that (?:aren't|isn't) of the chosen type$/, (f) => !f.notChosenType && ((f.notChosenType = true), true)],
  [/ of (?:the chosen|that) type$/, (f) => !f.chosenType && ((f.chosenType = true), true)],
  [/ that shares a creature type with your commander$/, (f) => !f.sharesTypeWithCommander && ((f.sharesTypeWithCommander = true), true)],
  // Shared Animosity: "that shares a creature type with it"; Coat of Arms: "that shares at least one creature type with it"
  [/ that shares? (?:at least one|a) creature type with (it|~|this creature|that creature)$/, (f, m, b) => {
    if (f.sharesCreatureTypeWith) return false;
    // One object: not "each creature … with it" (Coat of Arms compares each creature with itself in turn).
    const about: Ref | null = m[1] === '~' || m[1] === 'this creature' ? { ref: 'self' } : b.it && ['self', 'trigger_object', 'attached', 'target', 'affected'].includes(b.it.ref) ? b.it : null;
    return Boolean(about && ((f.sharesCreatureTypeWith = about), true));
  }],
  // Mirror Box: "each other creature you control with the same name as that creature" — each one it applies to.
  [/ with the same name as (?:that creature|it)$/, (f, _m, b) => !f.sameNameAs && b.it?.ref === 'affected' && ((f.sameNameAs = b.it), true)],
  [/ of the chosen color$/, (f) => !f.chosenColor && ((f.chosenColor = true), true)],
  [/ with the chosen name$/, (f) => !f.chosenName && ((f.chosenName = true), true)],
  [/ (?:from|in) your graveyard$/, (f) => !f.zone && ((f.zone = 'graveyard'), (f.owner = 'you'), true)],
  [/ (?:from|in) (?:an opponent's|each opponent's|your opponents') graveyards?$/, (f) => !f.zone && ((f.zone = 'graveyard'), (f.owner = 'opponent'), true)],
  [/ (?:from|in) (?:a|any|each) graveyard$/, (f) => !f.zone && ((f.zone = 'graveyard'), true)],
  // "Exile all cards from target player's graveyard": that player's cards only.
  [/ (?:from|in) (target player|target opponent|that player)'s graveyard$/, (f, m, b) => {
    if (f.zone) return false;
    const who = parsePlayerRef(m[1]!, b);
    return Boolean(who && ((f.zone = 'graveyard'), (f.ownedBy = who), true));
  }],
  [/ (?:from|in) all graveyards$/, (f) => !f.zone && ((f.zone = 'graveyard'), true)],
  [/ (?:from|in) your library$/, (f) => !f.zone && ((f.zone = 'library'), (f.owner = 'you'), true)],
  [/ (?:from|in) your hand$/, (f) => !f.zone && ((f.zone = 'hand'), (f.owner = 'you'), true)],
  [/ on the battlefield$/, (f) => !f.zone && ((f.zone = 'battlefield'), true)],
  // All Is Dust: "permanents … that are one or more colors" — not colorless.
  [/ that(?: are|'s| is) one or more colors$/, (f) => !f.colors && ((f.colors = ['W', 'U', 'B', 'R', 'G']), true)],
  // Oran-Rief: "each green creature that entered this turn"
  [/ that entered (?:the battlefield )?this turn$/, (f) => !f.enteredThisTurn && ((f.enteredThisTurn = true), true)],
  // "creature that was dealt damage this turn"
  [/ that was dealt damage this turn$/, (f) => !f.damagedThisTurn && ((f.damagedThisTurn = true), true)],
  // "a card named Pir, Imaginative Rascal" (CR 201.2) — after any zone words are peeled off.
  [/ named ([A-Z].*)$/, (f, m) => !f.name && ((f.name = m[1]!.trim()), true)],
  // Rite of Flame: "for each card named Rite of Flame in each graveyard" — its own name.
  [/ named ~$/, (f, _m, b) => !f.name && ((f.name = b.env.cardName), true)],
  [/ with (power|toughness|mana value) (\d+) or (less|greater)$/, (f, m) => compare(f, m[1]!, Number(m[2]), m[3] === 'less' ? 'le' : 'ge')],
  // Tetsuko Umezawa: "Creatures you control with power or toughness 1 or less" — either.
  [/ with power or toughness (\d+) or (less|greater)$/, (f, m) => {
    if (f.anyOf || f.power || f.toughness) return false;
    const c = { op: m[2] === 'less' ? 'le' : 'ge', n: Number(m[1]) } as const;
    f.anyOf = [{ power: c }, { toughness: c }];
    return true;
  }],
  // Fell the Mighty: "with power greater than target creature's power" — counted as the effect applies.
  [/ with (power|toughness) (greater|less) than (target creature|that creature)'s \1$/, (f, m, b) => {
    const key = m[1] === 'power' ? 'power' : 'toughness';
    if (f[key]) return false;
    const of = parseObjectRef(m[3]!, b)?.ref;
    if (!of) return false;
    f[key] = { op: m[2] === 'greater' ? 'gt' : 'lt', n: { kind: 'stat', stat: key, of } };
    return true;
  }],
  // Kutzil: "creatures you control each with power greater than its base power"
  [/ (?:each )?with power greater than (?:its|their) base power$/, (f) => !f.powerAboveBase && ((f.powerAboveBase = true), true)],
  // Gyruda, Void Winnower: "with an even mana value", "with even mana values" (CR 202.3: 0 is even).
  // Desynchronization: "each nonland permanent that's not historic"
  [/ that's not historic$/, (f) => !f.notHistoric && ((f.notHistoric = true), true)],
  // Sage's Reverie: "each Aura you control that's attached to a creature".
  [/ (?:that's|that are) attached to an? (creature|land|artifact|permanent)$/, (f, m) => !f.attachedToType && ((f.attachedToType = m[1] === 'permanent' ? '' : m[1]!.replace(/^\w/, (c) => c.toUpperCase())), m[1] !== 'permanent')],
  // Urza's Ruinous Blast: "all nonland permanents that aren't legendary"
  [/ (?:that aren't|that isn't|that's not) legendary$/, (f) => !f.notSupertypes && ((f.notSupertypes = ['Legendary']), true)],
  // Winds of Rath: "all creatures that aren't enchanted"
  [/ (?:that aren't|that isn't|that's not) enchanted$/, (f) => f.enchanted === undefined && ((f.enchanted = false), true)],
  [/ (?:that are|that's) enchanted$/, (f) => f.enchanted === undefined && ((f.enchanted = true), true)],
  // Halvar, God of Battle: "Creatures you control that are enchanted or equipped"
  [/ (?:that are|that's) enchanted or equipped$/, (f) => !f.anyOf && ((f.anyOf = [{ enchanted: true }, { equipped: true }]), true)],
  [/ with (?:an )?(even|odd) mana values?$/, (f, m) => !f.manaValueParity && ((f.manaValueParity = m[1] as 'even' | 'odd'), true)],
  // Chord of Calling, Green Sun's Zenith: "a creature card with mana value X or less"
  [/ with mana value X or less$/, (f) => compare(f, 'mana value', 'X', 'le')],
  // Scourge of Fleets: "each creature your opponents control with toughness X or less, where X is …".
  [/ with (power|toughness) X or less$/, (f, m) => compare(f, m[1]!, 'X', 'le')],
  // Steel Hellkite: "each nonland permanent with mana value X"
  [/ with mana value X$/, (f) => compare(f, 'mana value', 'X', 'eq')],
  // Urza's Saga: "an artifact card with mana cost {0} or {1}"
  [/ with mana cost ((?:\{[^}]+\})+)(?: or ((?:\{[^}]+\})+))?$/, (f, m) => !f.manaCostIs && ((f.manaCostIs = [m[1]!, ...(m[2] ? [m[2]] : [])]), true)],
  [/ with (power|toughness|mana value) (\d+)$/, (f, m) => compare(f, m[1]!, Number(m[2]), 'eq')],
  // Scrap Trawler: "target artifact card in your graveyard with lesser mana value" — than the artifact that triggered it.
  [/ with lesser mana value$/, (f, _m, b) => b.it?.ref === 'trigger_object' && !f.manaValue && ((f.manaValue = { op: 'lt', n: { kind: 'stat', stat: 'mana_value', of: { ref: 'trigger_object' } } }), true)],
  // Kozilek's Unsealing: "a creature spell with mana value 4, 5, or 6" — any of them.
  [/ with mana value (\d+), (\d+),? or (\d+)$/, (f, m) => !f.anyOf && !f.manaValue && ((f.anyOf = [m[1], m[2], m[3]].map((n) => ({ manaValue: { op: 'eq' as const, n: Number(n) } }))), true)],
  // "with a +1/+1 counter on it", "with +1/+1 counters on them", "with a counter on it"
  [/ with (?:a|an|one or more) (\S+) counters? on (?:it|them)$/, (f, m) => !f.counter && ((f.counter = m[1]!.replace(/−/g, '-')), true)],
  [/ with (?!a |an )(\S+) counters on (?:it|them)$/, (f, m) => !f.counter && ((f.counter = m[1]!.replace(/−/g, '-')), true)],
  [/ with (?:a counter|counters) on (?:it|them)$/, (f) => !f.counter && ((f.counter = 'any'), true)],
  // Wave Goodbye: "each creature without a +1/+1 counter on it"
  [/ without (?:a|an) (\S+) counters? on (?:it|them)$/, (f, m) => !f.notCounter && ((f.notCounter = m[1]!.replace(/−/g, '-')), true)],
  [/ without (?:a counter|counters) on (?:it|them)$/, (f) => !f.notCounter && ((f.notCounter = 'any'), true)],
  [/ without ([a-z ,]+)$/, (f, m, b) => keywordList(f, 'notKeywords', m[1]!, b)],
  // Shalai: "each creature you control that doesn't have hexproof"
  [/ that (?:doesn't|don't) have ([a-z ,]+)$/, (f, m, b) => keywordList(f, 'notKeywords', m[1]!, b)],
  [/ with ([a-z ,]+)$/, (f, m, b) => keywordList(f, 'keywords', m[1]!, b)],
];

function compare(f: ObjectFilter, what: string, n: number | 'X', op: 'le' | 'ge' | 'eq'): boolean {
  const key = what === 'power' ? 'power' : what === 'toughness' ? 'toughness' : 'manaValue';
  if (f[key]) return false;
  f[key] = { op, n };
  return true;
}

function keywordList(f: ObjectFilter, key: 'keywords' | 'notKeywords', text: string, b: Binder): boolean {
  const kws = parseKeywordList(text, b);
  // Stormtide Leviathan: "without flying or islandwalk" — a landwalk is its kind ("landwalk:island").
  if (!kws || f[key] || kws.some((k) => (k.text && k.id !== 'landwalk') || k.cost || k.n !== undefined)) return false;
  f[key] = kws.map((k) => (k.id === 'landwalk' ? `landwalk:${k.text!.toLowerCase()}` : k.id));
  return true;
}

/**
 * "flying and first strike", "trample, haste", 'haste and "{T}: Add {G}."' → keyword instances;
 * null if any item isn't a keyword. Quoted abilities are `printed` on a token or copy, or granted.
 */
export function parseKeywordList(text: string, b: Binder, printed = false, grant = false): KeywordInstance[] | null {
  // Swords: "protection from black and from green" is two protections (CR 702.16).
  text = text.replace(/\bprotection from (\w+) and from (\w+)\b/g, 'protection from $1, protection from $2');
  // Giver of Runes: "protection from colorless or from the color of your choice" is one protection, chosen.
  text = text.replace(/\bprotection from colorless or from the color of your choice\b/g, 'protection from colorless\u0002the color of your choice');
  const items = text.split(/,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+/).filter(Boolean).map((i) => i.replace('\u0002', ' or from '));
  const out: KeywordInstance[] = [];
  for (const item of items) {
    let kw = isQuoted(item) ? parseQuotedAbility(item, b, printed) : b.env.keywords.parseChunk(item, true);
    if (!kw) return null;
    // Granted: a keyword the engine knows only through its CR definition (prowess, riot, exalted…) carries that
    // definition's abilities; one it can't apply at all (banding) leaves the line unread.
    if (grant && !isQuoted(item) && !keywordSupported(kw)) {
      const r = b.env.parseAbilities?.(capitalise(item), '\u0001', 'Creature');
      const exp = r && !r.unparsed.length && !r.manualKeywords.length && r.keywords.length === 1 && !r.abilities.length ? r.keywords[0]! : null;
      const usable = (a: import('@mtg/schema').AbilityNode) => a.kind === 'triggered' || a.kind === 'activated' || grantableStatic(a) || (a.kind === 'static' && a.effect.type === 'as_enters');
      if (!exp || exp.id !== kw.id || !keywordSupported(exp) || !(exp.abilities ?? []).every(usable)) return null;
      kw = exp;
    }
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
  // "each instant and sorcery card": each card that's either (as with "or").
  rest = rest.replace(/\b(artifact|creature|enchantment|instant|sorcery|land|planeswalker|battle) and (artifact|creature|enchantment|instant|sorcery|land|planeswalker|battle)(?= (?:cards?|spells?)\b)/gi, '$1 or $2');
  // "each Fungus and Saproling you control": either subtype.
  rest = rest.replace(/\b([A-Z][\w-]*) and (?=([A-Z][\w-]*))/g, (m, a: string, z: string) => (subtypeOf(a) === a && subtypeOf(z) === z ? `${a} or ` : m));
  const parts = rest.split(/,\s*(?:and\/)?or\s+|\s+(?:and\/)?or\s+|,\s+/).map((p) => p.replace(/^an? /, ''));
  // "multicolored instant or sorcery spell", "red instant or sorcery spell": the leading words
  // describe every alternative.
  let lead = 0;
  if (parts.length > 1) {
    const words = parts[0]!.split(' ');
    const kind = categoryOf(parts[parts.length - 1]!.split(' ')[0]!);
    if (words.length > 1 && kind && categoryOf(words[words.length - 1]!) === kind && parts.slice(1, -1).every((p) => !p.includes(' '))) {
      parts[0] = words[words.length - 1]!;
      parts[parts.length - 1] = `${words.slice(0, -1).join(' ')} ${parts[parts.length - 1]}`;
      lead = words.length - 1;
    }
  }
  const last = parts[parts.length - 1]!;
  const base: ObjectFilter = { ...f };
  const head = parseHeadPhrase(last, f);
  if (!head) return null;
  if (parts.length > 1) {
    // "artifact or enchantment", "red or green creature", "instant or sorcery spell":
    // the earlier words stand in for the first word of the last part.
    const first = last.split(' ')[lead]!;
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
        anyOf.push(alt);
      }
      // "target spell or permanent" (Venser, Commit): each alternative in its own zone (CR 115.2).
      // A zone word on the last part only ("instant or Aura spell") is shared by every alternative.
      const lastZone = anyOf[anyOf.length - 1]!.zone ?? 'battlefield';
      // A bare "spell" last ("other target creature or spell", Aang) isn't.
      const bare = /^spells?$/.test(last) && anyOf.some((a) => !a.zone);
      if (!base.zone && (bare || anyOf.slice(0, -1).some((a) => a.zone && a.zone !== lastZone))) {
        for (const alt of anyOf) alt.zone ??= 'battlefield';
        return { filter: { ...base, anyOf }, plural: head.plural };
      }
      for (const alt of anyOf) delete alt.zone;
      return { filter: { ...base, ...(f.zone && !base.zone ? { zone: f.zone } : {}), anyOf }, plural: head.plural };
    }
  }
  return { filter: f, plural: head.plural, ...(head.invariant ? { invariant: true } : {}) };
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
function parseHeadPhrase(text: string, f: ObjectFilter): { plural: boolean; invariant?: boolean } | null {
  const words = text.trim().split(/\s+/);
  const headWord = words[words.length - 1]!;
  const adjectives = words.slice(0, -1);
  let plural = false;
  let invariant = false;
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
    if (INVARIANT_PLURALS.has(headWord)) invariant = true;
  } else return null;
  if (PLURAL_HEADS.has(lower)) plural = true;

  const adjTypes: string[] = [];
  for (const raw of adjectives) {
    const w = raw.toLowerCase();
    // "Nontoken creatures you control" at the start of a sentence, too.
    const non = /^[Nn]on-?(.+)$/.exec(raw);
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
    else if (w === 'monocolored') f.monocolored = true;
    // CR 700.6
    else if (w === 'historic') f.historic = true;
    // CR 700.9: equipped, enchanted by an Aura its controller controls, or with a counter on it.
    else if (w === 'modified') f.modified = true;
    else if (w === 'tapped') f.tapped = true;
    else if (w === 'untapped') f.tapped = false;
    else if (w === 'attacking') f.combat = 'attacking';
    // Vengeful Ancestor: "Whenever a goaded creature attacks" (CR 701.15)
    else if (w === 'goaded') f.goaded = true;
    // Greater Auramancy: "Enchanted creatures you control have shroud."; "equipped creatures you control".
    else if (w === 'enchanted' && f.enchanted === undefined) f.enchanted = true;
    else if (w === 'equipped') f.equipped = true;
    else if (w === 'blocking') f.combat = 'blocking';
    else if (SUPERTYPE_WORDS[w]) (f.supertypes ??= []).push(SUPERTYPE_WORDS[w]!);
    else if (TYPE_NOUNS[w] && w === TYPE_NOUNS[w]!.toLowerCase()) adjTypes.push(TYPE_NOUNS[w]!);
    else if (w === 'token') f.token = true;
    // CR 903.3: "commander creatures you own"
    else if (w === 'commander') f.commander = true;
    // "permanent card" (CR 110.4b): a card with a permanent type.
    // Lithoform Engine: "target permanent spell you control" — a spell that will become a permanent.
    else if (w === 'permanent' && /^(?:cards?|spells?)$/.test(lower)) f.types = [...PERMANENT_TYPES];
    else if (subtypeOf(raw) === raw) (f.subtypes ??= []).push(raw);
    // "Urza's land": the subtype is spelled with a curly apostrophe.
    else if (raw.includes("'") && subtypeOf(raw)) (f.subtypes ??= []).push(subtypeOf(raw)!);
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
  return { plural, ...(invariant ? { invariant: true } : {}) };
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

export type RefMode = 'effect' | 'static';

// Wan Shi Tong: "put X +1/+1 counters on him".
// Sneak Attack: "Sacrifice the creature at the beginning of the next end step." — the one just mentioned.
const PRONOUNS = /^(?:it|him|her|them|they|the creature|that (?:creature|permanent|card|spell|token|land|artifact|enchantment|planeswalker|spell or ability)|those (?:creatures|permanents|cards|tokens))$/i;

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
const ABILITY_KINDS: Record<string, ('activated' | 'triggered')[]> = {
  'activated or triggered ability': ['activated', 'triggered'],
  'activated ability': ['activated'],
  'triggered ability': ['triggered'],
};

/** "target activated ability", "target triggered ability or colorless spell", "up to one target activated or triggered ability". */
/** "you", "a creature you control", "you or a permanent you control": what a spell or ability targets. */
function parseTargeting(text: string, b: Binder): { you?: true; filter?: ObjectFilter } | null {
  if (text === 'you') return { you: true };
  const m = /^(you or |you and\/or )?(?:a|an|one or more) (.+?)$/.exec(text);
  if (!m) return null;
  const pf = parseFilter(m[2]!, b.clone());
  if (!pf || pf.plural || (pf.filter.zone && pf.filter.zone !== 'battlefield')) return null;
  return { ...(m[1] ? { you: true as const } : {}), filter: pf.filter };
}

function parseAbilityTarget(t: string, b: Binder): TargetSpec | null {
  const m =
    /^(up to one )?target (activated or triggered ability|activated ability|triggered ability|activated ability, triggered ability, or (.+?) spell|triggered ability or (.+?) spell|instant spell, sorcery spell, activated ability, or triggered ability|spell, activated ability, or triggered ability|spell or ability)( you control| you don't control| an opponent controls)?(?: from (?:a|an) (.+?) source)?$/i.exec(
      t,
    );
  if (!m) return null;
  const spec: TargetSpec = { what: 'ability', abilities: ABILITY_KINDS[m[2]!] ?? ['activated', 'triggered'], text: t.replace(/^\w/, (c) => c.toLowerCase()) };
  const spellWords = m[3] ?? m[4];
  if (spellWords) {
    const pf = parseFilter(`${spellWords} spell`, b);
    if (!pf || pf.plural || pf.filter.zone !== 'stack') return null;
    const { zone: _z, ...spells } = pf.filter;
    spec.spells = spells;
  } else if (/^instant spell, sorcery spell/.test(m[2]!)) spec.spells = { types: ['Instant', 'Sorcery'] };
  else if (/^spell/.test(m[2]!)) spec.spells = {};
  if (m[5]) spec.player = m[5] === ' you control' ? 'you' : 'opponent';
  if (m[6]) {
    const pf = parseFilter(`${m[6]} permanent`, b);
    if (!pf || pf.plural) return null;
    const { zone: _z, ...source } = pf.filter;
    spec.source = source;
  }
  if (m[1]) spec.upTo = true;
  return spec;
}

export function parseObjectRef(text: string, b: Binder, mode: RefMode = 'effect'): ParsedRef | null {
  return attempt(b, (b) => {
    const t = text.trim();
    if (t === '~') return set(b, { ref: { ref: 'self' }, plural: false, targeted: false });
    // A "this turn" ability's reference to what its creator targeted (see the sentence loop in effects.ts).
    const outer = /^TARGETREF(\d+)$/.exec(t);
    if (outer) return set(b, { ref: { ref: 'target', index: Number(outer[1]) }, plural: false, targeted: false });
    const named = b.named[t.toLowerCase()];
    if (named) return set(b, { ref: named, plural: /^(?:the|those) tokens$|most votes$|^(?:each of )?those creatures$|^them$/i.test(t), targeted: false });
    // CR 607.2a: "the exiled card", "all cards exiled with ~" — linked to the ability that exiled them.
    const exiled = /^(?:the exiled (card|cards)|(?:all |each |the )?(cards?) exiled with (?:~|it))$/i.exec(t);
    if (exiled) return set(b, { ref: { ref: 'exiled_with' }, plural: /s$/.test(exiled[1] ?? exiled[2]!) || /^(?:all|each) /i.test(t), targeted: false });
    // "return ~ from your graveyard to your hand": the ability functions from the graveyard (CR 113.6m).
    if (t === '~ from your graveyard') {
      b.selfZone = 'graveyard';
      return set(b, { ref: { ref: 'self' }, plural: false, targeted: false });
    }
    // Talon Gates of Madara: "{4}: Put this card from your hand onto the battlefield." — activated from the hand.
    if (t === '~ from your hand') {
      b.selfZone = 'hand';
      return set(b, { ref: { ref: 'self' }, plural: false, targeted: false });
    }
    // Summon: Knights of Round: "Other creatures you control get +2/+2 until end of turn. Put an indestructible counter on
    // each of them." — that group.
    if (/^each of them$/i.test(t) && b.it?.ref === 'all') return { ref: b.it, plural: true, targeted: false };
    if (PRONOUNS.test(t)) {
      const it = demonstrative(t, b);
      // An instant or sorcery is never "that creature" (Code of Constraint's addendum, read apart from its target), nor is a
      // noncreature permanent "that creature" (Jaya's "… to that creature" is what she targeted).
      if (it?.ref === 'self' && /^(?:that|those|the) (?:creatures?|permanents?|artifact|enchantment|land|planeswalker)$/i.test(t) && /\b(?:Instant|Sorcery)\b/.test(b.env.typeLine)) return null;
      if (it?.ref === 'self' && /^(?:that|those) creatures?$/i.test(t) && !/\b(?:Creature|Vehicle)\b/.test(b.env.typeLine)) return null;
      return it ? { ref: it, plural: /^(them|they|those)/i.test(t), targeted: false } : null;
    }
    // Necropotence: "Whenever you discard a card, exile that card from your graveyard." — where it now is.
    if (/^(?:it|that card) from (?:your|its owner's|their|a) graveyard$/i.test(t) && b.it && b.it.ref !== 'self') return { ref: b.it, plural: false, targeted: false };
    if (/^(?:enchanted|equipped) (?:creature|permanent|land|artifact|planeswalker)$/i.test(t)) {
      return set(b, { ref: { ref: 'attached' }, plural: false, targeted: false });
    }

    if (mode === 'effect') {
      // "any number of target creatures" (CR 115.1d / 601.2c: as many as the player likes)
      const anyNumber = /^any number of (other )?target (.+)$/i.exec(t);
      if (anyNumber) {
        const pf = parseFilter(anyNumber[2]!, b);
        if (!pf || !pf.plural) return null;
        if (anyNumber[1]) pf.filter.other = true;
        const spec: TargetSpec = { what: 'object', filter: pf.filter, text: t.replace(/^\w/, (c) => c.toLowerCase()), count: 100, upTo: true };
        return set(b, { ref: b.addTarget(spec), plural: true, targeted: true });
      }
      // "each of up to two other target creatures" (CR 115.4)
      const eachOf = /^each of (up to )?(\w+) (other )?target (.+)$/i.exec(t);
      if (eachOf) {
        const count = parseAmount(eachOf[2]!);
        const pf = typeof count === 'number' && count >= 2 ? parseFilter(eachOf[4]!, b) : null;
        if (!pf || !pf.plural || typeof count !== 'number') return null;
        if (eachOf[3]) pf.filter.other = true;
        const spec: TargetSpec = { what: 'object', filter: pf.filter, text: t.replace(/^\w/, (c) => c.toLowerCase()), count, ...(eachOf[1] ? { upTo: true } : {}) };
        return set(b, { ref: b.addTarget(spec), plural: true, targeted: true });
      }
      // Siren Stormtamer: "target spell or ability that targets you or a creature you control".
      const targeting = /^((?:up to one )?target .*?\b(?:spell|ability))( that targets (.+))$/.exec(t);
      if (targeting) {
        const want = parseTargeting(targeting[3]!, b);
        if (!want) return null;
        const inner = parseObjectRef(targeting[1]!, b, mode);
        const spec = inner?.targeted && inner.ref.ref === 'target' ? b.targets[inner.ref.index] : undefined;
        if (!inner || !spec || (spec.what !== 'ability' && spec.filter?.zone !== 'stack')) return null;
        spec.targeting = want;
        spec.text = t.replace(/^\w/, (c) => c.toLowerCase());
        return inner;
      }
      // CR 113.1c: "target activated or triggered ability you control from an artifact source" — an ability on the stack.
      const ability = parseAbilityTarget(t, b);
      if (ability) return set(b, { ref: b.addTarget(ability), plural: false, targeted: true });
      // "one or two target creatures", "one, two, or three target creatures", "one or more target creatures": at least one.
      const oneOr = /^(one or two|one, two, or three|one or more) (other )?target (.+)$/i.exec(t);
      if (oneOr) {
        const pf = parseFilter(oneOr[3]!, b);
        if (!pf || !pf.plural) return null;
        if (oneOr[2]) pf.filter.other = true;
        const count = /two$/i.test(oneOr[1]!) ? 2 : /three$/i.test(oneOr[1]!) ? 3 : 100;
        const spec: TargetSpec = { what: 'object', filter: pf.filter, text: t.replace(/^\w/, (c) => c.toLowerCase()), count, upTo: true, min: 1 };
        return set(b, { ref: b.addTarget(spec), plural: true, targeted: true });
      }
      const tm = /^(?:(up to )?((?!another\b|other\b)\w+) )?(another |other )?target (.+)$/i.exec(t);
      // Curse of the Swine: "Exile X target creatures." — as many targets as the X announced (CR 601.2b–c).
      if (tm && tm[2] === 'X') {
        const pf = parseFilter(tm[4]!, b);
        if (!pf || !pf.plural || pf.filter.ownedBy || / from a single graveyard$/.test(tm[4]!)) return null;
        if (tm[3]) pf.filter.other = true;
        const spec: TargetSpec = { what: 'object', filter: pf.filter, text: t.replace(/^\w/, (c) => c.toLowerCase()), countX: true, ...(tm[1] ? { upTo: true } : {}) };
        return set(b, { ref: b.addTarget(spec), plural: true, targeted: true });
      }
      // Sudden Spoiling: "creatures target player controls" — not a number of targets; a bare plural below.
      if (tm && !(tm[2] && !tm[1] && parseAmount(tm[2]) === null && !tm[3])) {
        const count = tm[2] ? parseAmount(tm[2]) : 1;
        if (typeof count !== 'number' || count < 1) return null;
        // "up to two target cards from a single graveyard"
        const single = / from a single graveyard$/.test(tm[4]!);
        const pf = parseFilter(single ? `${tm[4]!.replace(/ from a single graveyard$/, '')} in a graveyard` : tm[4]!, b);
        if (!pf || pf.plural !== count > 1 || pf.filter.ownedBy) return null;
        if (tm[3]) pf.filter.other = true;
        const spec: TargetSpec = { what: 'object', filter: pf.filter, text: t.replace(/^\w/, (c) => c.toLowerCase()), ...(single ? { sameOwner: true } : {}) };
        if (count > 1) spec.count = count;
        if (tm[1]) spec.upTo = true;
        return set(b, { ref: b.addTarget(spec), plural: count > 1, targeted: true });
      }
    }

    const each = /^(?:each|all) (other )?(.+)$/i.exec(t);
    if (each) {
      let pf = parseFilter(each[2]!, b);
      // "all artifacts and enchantments [your opponents control]", "all artifacts, creatures, and enchantments":
      // anything that's any of them.
      const list = pf ? null : /^((?:[a-z-]+, )*[a-z-]+),? and ([a-z-]+s\b.*)$/.exec(each[2]!);
      if (list && !/ and /.test(list[2]!)) pf = parseFilter(`${list[1]}, or ${list[2]}`.replace(/^(\w+), or /, '$1 or '), b);
      // "all creatures you don't control and all planeswalkers you don't control"
      const both = pf ? null : /^(.+?) and (?:all|each) (.+)$/.exec(each[2]!);
      if (both) {
        const x = parseFilter(both[1]!, b);
        const y = x ? parseFilter(both[2]!, b) : null;
        if (x && y && x.plural && y.plural && !x.filter.zone && !y.filter.zone) pf = { filter: { anyOf: [x.filter, y.filter] }, plural: true };
      }
      if (!pf) return null;
      if (each[1]) pf.filter.other = true;
      return set(b, { ref: { ref: 'all', filter: pf.filter }, plural: true, targeted: false });
    }
    // Bare plurals: "Creatures you control", "Other Zombies you control".
    const bare = /^(other )?(.+)$/i.exec(t)!;
    // Valley Floodcaller: "Birds, Frogs, Otters, and Rats you control get +1/+1" — every creature of those types.
    let pf = parseFilter(bare[2]!, b) ?? (/^[A-Z]\w+s, (?:[A-Z]\w+s, )*and [A-Z]\w+s\b/.test(bare[2]!) ? parseFilter(bare[2]!.replace(/, and /, ', or '), b) : null);
    // Sorin, Vengeful Bloodlord: "creatures and planeswalkers you control have lifelink" — anything that's either.
    const bareList = pf ? null : /^((?:[a-z-]+, )*[a-z-]+s),? and ([a-z-]+s\b.*)$/.exec(bare[2]!);
    if (bareList && !/ and /.test(bareList[2]!)) pf = parseFilter(`${bareList[1]}, or ${bareList[2]}`.replace(/^(\w+), or /, '$1 or '), b);
    // Shalai: "planeswalkers you control and other creatures you control" — either.
    const pair = pf || bare[1] ? null : /^(.+? you control) and (other )?(.+? you control)$/.exec(bare[2]!);
    if (pair) {
      const x = parseFilter(pair[1]!, b);
      const y = x ? parseFilter(pair[3]!, b) : null;
      if (x && y && x.plural && y.plural && !x.filter.zone && !y.filter.zone) pf = { filter: { anyOf: [x.filter, { ...y.filter, ...(pair[2] ? { other: true } : {}) }] }, plural: true };
    }
    // "Equipment you control have equip {1}" — the same word in the plural, without an article.
    if (!pf || (!pf.plural && !pf.invariant && !/^Equipment\b/.test(bare[2]!))) return null;
    if (bare[1]) pf.filter.other = true;
    return set(b, { ref: { ref: 'all', filter: pf.filter }, plural: true, targeted: false });
  });
}

function set(b: Binder, r: ParsedRef): ParsedRef {
  if (r.ref.ref === 'self' && b.it && b.it.ref !== 'self') b.other = b.it;
  b.it = r.ref;
  return r;
}

/** "that creature", "that card": not the source when the text named the source after another object (`Binder.other`). */
function demonstrative(t: string, b: Binder): Ref | null {
  return /^(?:that|those) /i.test(t) && b.it?.ref === 'self' && b.other ? b.other : b.it;
}

/** Player phrases: "you", "target opponent", "each player", "that player", "its controller". */
export function parsePlayerRef(text: string, b: Binder): Ref | null {
  const t = text.trim().toLowerCase();
  if (t === 'you') return { ref: 'you' };
  if (t === 'each player') return { ref: 'players', who: 'each' };
  // In a free-for-all game (CR 806), every other player is an opponent: "each other player sacrifices a creature".
  if (t === 'each opponent' || t === 'each of your opponents' || t === 'your opponents' || t === 'each other player') return { ref: 'players', who: 'opponents' };
  // Papalymo Totolymo: "each opponent who lost life this turn"
  const lost = /^each (opponent|player) who lost life this turn$/.exec(t);
  if (lost) return { ref: 'players', who: lost[1] === 'player' ? 'each' : 'opponents', lostLife: true };
  // Kediss: "… deals combat damage to an opponent, it deals that much damage to each other opponent."
  if (t === 'each other opponent' && b.player?.ref === 'trigger_player') return { ref: 'players', who: 'opponents', except: b.player };
  // CR 115.1: "up to one target player" (Endurance) — none at all is a legal choice.
  // Priest of Forgotten Gods: "Any number of target players each lose 2 life …" (CR 115.1d).
  // Gleaming Splendor: "Two target players each draw a card."
  const anyPlayers = /^(any number of|two|three) target (players|opponents)$/.exec(t);
  if (anyPlayers) {
    // Not "that player" / "their" later: each of them would need counting for themselves.
    const count = anyPlayers[1] === 'two' ? { count: 2 } : anyPlayers[1] === 'three' ? { count: 3 } : { count: 100, upTo: true as const };
    const spec: TargetSpec = { what: 'player', text: t, ...count, ...(anyPlayers[2] === 'opponents' ? { player: 'opponent' as const } : {}) };
    return b.addTarget(spec);
  }
  const playerTarget = /^(up to one )?target (player|opponent)$/.exec(t);
  if (playerTarget) {
    const spec: TargetSpec = { what: 'player', text: t };
    if (playerTarget[2] === 'opponent') spec.player = 'opponent';
    if (playerTarget[1]) spec.upTo = true;
    const ref = b.addTarget(spec);
    b.player = ref;
    return ref;
  }
  // "Destroy target artifact an opponent controls. That player may search …": its controller.
  if (t === 'that player' && !b.player && b.it?.ref === 'target') return { ref: 'controller_of', of: b.it };
  if (t === 'that player' || t === 'they') return b.player;
  // CR 303.4: an Aura attached to a player (Curses).
  if (t === 'enchanted player') return { ref: 'enchanted_player' };
  // "As ~ enters, choose a player." — "the chosen player" (CR 614.12).
  // Haunt the Network: "Choose target opponent. … Then the chosen player loses X life" — that target.
  if (t === 'the chosen player') return b.named[t] ?? { ref: 'chosen_player' };
  // Skyclave Apparition: "the exiled card's owner" (CR 607.2a)
  if (t === "the exiled card's owner") return { ref: 'owner_of', of: { ref: 'exiled_with' } };
  if (b.named[t]) {
    // "… defending player … the number of artifacts they control": "they" is that player.
    if (t === 'defending player' && !b.player) b.player = b.named[t]!;
    return b.named[t]!;
  }
  const owner = /^(?:its|(that (?:creature|permanent|spell|card|land|artifact|enchantment|planeswalker|token))'s) (controller|owner)$/.exec(t);
  // Gloom Sower: "Whenever ~ becomes blocked by a creature, that creature's controller …" — the creature the trigger names.
  const of = owner ? (owner[1] && b.named[owner[1]]) || (owner[1] ? demonstrative(owner[1], b) : b.it) : null;
  if (owner && of) return { ref: owner[2] === 'controller' ? 'controller_of' : 'owner_of', of };
  return null;
}

const ANY_TARGET_TYPES = ['Creature', 'Planeswalker', 'Battle'];

/** Damage recipients: "any target", "target creature or player", "each creature and each player". */
export function parseRecipients(text: string, b: Binder): Ref[] | null {
  return attempt(b, (b) => {
    // Delayed Blast Fireball: "each opponent and each creature they control" — the opponents' creatures.
    const t = text.trim().replace(/^each opponent and each (creature|planeswalker|creature and planeswalker) they control$/, 'each opponent and each $1 your opponents control');
    // Raid Bombardment: "the player or planeswalker that creature is attacking"; Myr Battlesphere: "… it's attacking".
    const attacked = /^the player or planeswalker (that creature|it|~) is attacking$/.exec(t.replace(/ it's attacking$/, ' it is attacking'));
    if (attacked) {
      const of = parseObjectRef(attacked[1]!, b);
      return of && !of.plural ? [{ ref: 'attacked_by', of: of.ref }] : null;
    }
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
      // Crackle with Power: "each of up to X targets" — as many as the X announced (CR 601.2b–c).
      const countX = eachOf[2] === 'X';
      const count = countX ? 1 : parseAmount(eachOf[2]!);
      if (typeof count !== 'number' || (count < 2 && !countX)) return null;
      const n = countX ? { countX: true as const } : { count };
      let spec: TargetSpec;
      if (!eachOf[3]) spec = { what: 'any', filter: { types: ANY_TARGET_TYPES }, text: t, ...n };
      else {
        const pf = parseFilter(eachOf[3], b);
        if (!pf || !pf.plural) return null;
        spec = { what: 'object', filter: pf.filter, text: t, ...n };
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
      // End the Festivities: "each creature and planeswalker they control" — each creature and each planeswalker.
      const obj = parseObjectRef(part, b) ?? (/^each (creature|planeswalker|battle) and (creature|planeswalker|battle) /.test(part) ? parseObjectRef(part.replace(/^each (\w+) and (\w+) /, 'each $1 or $2 '), b) : null);
      if (!obj) return null;
      out.push(obj.ref);
    }
    return out;
  });
}
