import type { Amount, Color, FaceDef } from '@mtg/schema';
import type { Binder } from './binder.js';
import { parseKeywordList } from './nouns.js';
import { isQuoted, quotedText } from './quoted.js';
import { COLOR_WORDS, parseAmount, subtypeOf, TYPE_NOUNS } from './words.js';

/** CR 111.10: predefined tokens, by the name effects use ("a Treasure token"). */
const PREDEFINED: Record<string, { typeLine: string; text: string; colors?: Color[]; name?: string; pt?: [string, string] }> = {
  Treasure: { typeLine: 'Artifact — Treasure', text: '{T}, Sacrifice this token: Add one mana of any color.' }, // CR 111.10a
  Food: { typeLine: 'Artifact — Food', text: '{2}, {T}, Sacrifice this token: You gain 3 life.' }, // CR 111.10b
  Gold: { typeLine: 'Artifact — Gold', text: 'Sacrifice this token: Add one mana of any color.' }, // CR 111.10c
  Walker: { typeLine: 'Creature — Zombie', text: '', colors: ['B'], name: 'Walker', pt: ['2', '2'] }, // CR 111.10d
  Shard: { typeLine: 'Enchantment — Shard', text: '{2}, Sacrifice this token: Scry 1, then draw a card.' }, // CR 111.10e
  Clue: { typeLine: 'Artifact — Clue', text: '{2}, Sacrifice this token: Draw a card.' }, // CR 111.10f
  Blood: { typeLine: 'Artifact — Blood', text: '{1}, {T}, Discard a card, Sacrifice this token: Draw a card.' }, // CR 111.10g
  Powerstone: { typeLine: 'Artifact — Powerstone', text: "{T}: Add {C}. This mana can't be spent to cast a nonartifact spell." },
  'Cursed Role': { typeLine: 'Enchantment — Aura Role', name: 'Cursed', text: 'Enchant creature\nEnchanted creature has base power and toughness 1/1.' },
  'Monster Role': { typeLine: 'Enchantment — Aura Role', name: 'Monster', text: 'Enchant creature\nEnchanted creature gets +1/+1 and has trample.' },
  'Royal Role': { typeLine: 'Enchantment — Aura Role', name: 'Royal', text: 'Enchant creature\nEnchanted creature gets +1/+1 and has ward {1}.' },
  'Sorcerer Role': { typeLine: 'Enchantment — Aura Role', name: 'Sorcerer', text: 'Enchant creature\nEnchanted creature gets +1/+1 and has “Whenever this creature attacks, scry 1.”' },
  'Virtuous Role': { typeLine: 'Enchantment — Aura Role', name: 'Virtuous', text: 'Enchant creature\nEnchanted creature gets +1/+1 for each enchantment you control.' },
  'Wicked Role': {
    typeLine: 'Enchantment — Aura Role',
    name: 'Wicked',
    text: 'Enchant creature\nEnchanted creature gets +1/+1.\nWhen this token is put into a graveyard from the battlefield, each opponent loses 1 life.',
  },
  'Young Hero Role': {
    typeLine: 'Enchantment — Aura Role',
    name: 'Young Hero',
    text: 'Enchant creature\nEnchanted creature has “Whenever this creature attacks, if its toughness is 3 or less, put a +1/+1 counter on it.”',
  },
  Map: { typeLine: 'Artifact — Map', text: '{1}, {T}, Sacrifice this token: Target creature you control explores. Activate only as a sorcery.' },
  Junk: { typeLine: 'Artifact — Junk', text: '{T}, Sacrifice this token: Exile the top card of your library. You may play that card this turn. Activate only as a sorcery.' },
  Lander: { typeLine: 'Artifact — Lander', text: '{2}, {T}, Sacrifice this token: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.' },
  Mutagen: { typeLine: 'Artifact — Mutagen', text: '{1}, {T}, Sacrifice this token: Put a +1/+1 counter on target creature. Activate only as a sorcery.' },
  Vibranium: { typeLine: 'Artifact — Vibranium', text: "Indestructible\n{T}: Add {C}. This mana can't be spent to cast a nonartifact spell." },
  Heartwood: { typeLine: 'Artifact — Heartwood', text: '{T}: Add {R} or {G}.', colors: ['R', 'G'] },
};

export interface ParsedToken {
  amount: Amount;
  face: FaceDef;
  tapped: boolean;
  /** "an X/X … token": its power and toughness are X, worked out as the effect resolves. */
  size?: 'X';
}

/**
 * "a 1/1 white Soldier creature token with flying", "two Treasure tokens",
 * "a tapped 2/2 black Zombie creature token". CR 111.4: an unnamed token is named
 * after its subtypes plus "Token".
 */
export function parseTokenPhrase(text: string, b: Binder): ParsedToken | null {
  // Dark Depths: "Marit Lage, a legendary 20/20 black Avatar creature token with flying and indestructible" — the name first.
  const named = /^([A-Z][^,]+), (a legendary .+ token(?: with .+)?)$/.exec(text.trim());
  if (named) {
    const inner = parseTokenPhrase(named[2]!, b);
    return inner && inner.amount === 1 ? { ...inner, face: { ...inner.face, name: named[1]! } } : null;
  }
  // CR 111.4: "named X" gives it that name instead.
  // Koma: "a 3/3 blue Serpent creature token named Koma's Coil" — the card's own name was shortened to "~".
  const legendary = /^(\w+) (tapped )?legendary /.test(text.trim());
  if (legendary) text = text.trim().replace(/^(\w+ (?:tapped )?)legendary /, '$1');
  const m = /^(\w+) (tapped )?(?:(\d+|X)\/(\d+|X) )?(.+?) tokens?(?: named ((?:~'s )?[A-Z][^,]*?))?(?: with (.+))?$/.exec(text.trim());
  if (m?.[6]?.startsWith('~')) m[6] = m[6].replace(/^~/, b.env.faceName.split(',')[0]!);
  if (!m) return null;
  const amount = parseAmount(m[1]!);
  if (amount === null) return null;
  // Koma, World-Eater: "four 3/3 blue Serpent creature tokens named Koma's Coil".
  const plural = /tokens(?: named (?:~'s )?[A-Z][^,]*?)?(?: with .+)?$/.test(text.trim());
  // A numeral comes from a keyword definition ("create N … tokens" with N = 1), so either number is fine.
  if ((amount === 1) === plural && amount !== 'X' && !/^\d+$/.test(m[1]!)) return null;
  const tapped = Boolean(m[2]);
  const words = m[5]!;
  // Only "X/X": one number for both.
  const sizeX = m[3] === 'X' || m[4] === 'X';
  if (sizeX && (m[3] !== 'X' || m[4] !== 'X')) return null;

  const predefined = PREDEFINED[words];
  if (predefined) {
    if (m[3] || m[6] || m[7]) return null;
    return { amount, tapped, face: tokenFace(b, predefined.name ?? words.replace(/ Role$/, ''), predefined.typeLine, predefined.text, predefined.colors ?? [], predefined.pt) };
  }

  // Colors, then subtypes, then card types.
  const parts = words.split(' ');
  const colors: Color[] = [];
  let i = 0;
  for (; i < parts.length; i++) {
    const w = parts[i]!;
    if (COLOR_WORDS[w]) colors.push(COLOR_WORDS[w]!);
    else if (w === 'and' && colors.length) continue;
    else if (w === 'colorless') continue;
    else break;
  }
  // Replicating Ring: "eight colorless snow artifact tokens named Replicated Ring" (CR 205.4a: snow is a supertype).
  const snow = parts[i] === 'snow';
  if (snow) i++;
  const subtypes: string[] = [];
  for (; i < parts.length && subtypeOf(parts[i]!) === parts[i]; i++) subtypes.push(parts[i]!);
  const types: string[] = [];
  for (; i < parts.length; i++) {
    const t = TYPE_NOUNS[parts[i]!];
    if (!t || t.toLowerCase() !== parts[i]) return null;
    types.push(t);
  }
  // A token without subtypes needs a name (CR 111.4).
  if ((!subtypes.length && !m[6]) || !types.length) return null;
  const isCreature = types.includes('Creature');
  const extra = m[7] ? withText(m[7], b) : { text: '', quoted: [] };
  if (!extra) return null;
  // Wrenn and Seven: "a green Treefolk creature token with reach and "This token's power and toughness are each equal to
  // the number of lands you control."" — no stated size; it's defined by the ability (CR 604.3).
  const cda = isCreature && !m[3] && /^This (?:token|creature)'s power and toughness are each equal to /m.test(extra.text);
  if (isCreature !== Boolean(m[3]) && !cda) return null; // creature tokens state P/T; others don't
  const typeLine = subtypes.length ? `${types.join(' ')} — ${subtypes.join(' ')}` : types.join(' ');
  const face = tokenFace(b, m[6] ?? `${subtypes.join(' ')} Token`, typeLine, extra.text, colors, isCreature ? (cda ? ['*', '*'] : [m[3]!, m[4]!]) : undefined);
  // CR 205.4a: a legendary token is a legendary permanent (the legend rule applies to it).
  if (legendary) {
    face.supertypes = ['Legendary'];
    face.typeLine = `Legendary ${face.typeLine}`;
  }
  if (snow) {
    face.supertypes = [...face.supertypes, 'Snow'];
    face.typeLine = face.typeLine.replace(/^Token /, 'Token Snow ');
  }
  // A quoted ability the grammar can't read leaves the whole phrase unread, rather than a token resolved by hand.
  if (extra.quoted.some((q) => face.unparsed.includes(q))) return null;
  return { amount, tapped, face, ...(sizeX ? { size: 'X' as const } : {}) };
}

/** What a "with …" clause adds to a token: keywords on one line, each quoted ability on its own. */
function withText(text: string, b: Binder): { text: string; quoted: string[] } | null {
  const items = text.split(/,\s*(?:and\s+)?|\s+and\s+/).filter(Boolean);
  const words = items.filter((i) => !isQuoted(i));
  const quoted = items.filter(isQuoted).map((i) => quotedText(i, b));
  if (quoted.some((t) => t === null)) return null;
  if (words.length && !parseKeywordList(words.join(', '), b)) return null;
  const lines = [...(words.length ? [words.join(', ').replace(/^\w/, (c) => c.toUpperCase())] : []), ...(quoted as string[])];
  return { text: lines.join('\n'), quoted: quoted as string[] };
}

/** "Create a 1/1 Eldrazi Scion token. It has "Sacrifice this token: Add {C}."" — more of the token's own text. */
export function addTokenText(face: FaceDef, text: string, b: Binder): FaceDef | null {
  const extra = withText(text, b);
  if (!extra) return null;
  const typeLine = face.typeLine.replace(/^Token /, '');
  const next = tokenFace(b, face.name, typeLine, [face.oracle, extra.text].filter(Boolean).join('\n'), face.colors, face.power !== undefined ? [face.power, face.toughness!] : undefined);
  return extra.quoted.some((q) => next.unparsed.includes(q)) ? null : next;
}

function tokenFace(b: Binder, name: string, typeLine: string, text: string, colors: Color[], pt?: [string, string]): FaceDef {
  const [left, right = ''] = typeLine.split(' — ');
  const parsed = b.env.parseAbilities?.(text, name, typeLine) ?? { keywords: [], abilities: [], unparsed: text ? text.split('\n') : [], manualKeywords: [] };
  const face: FaceDef = {
    name,
    manaCost: '',
    typeLine: `Token ${typeLine}`,
    supertypes: [],
    types: left!.split(' '),
    subtypes: right ? right.split(' ') : [],
    oracle: text,
    colors,
    keywords: parsed.keywords,
    abilities: parsed.abilities,
    unparsed: parsed.unparsed,
  };
  if (parsed.manualKeywords.length) face.manualKeywords = parsed.manualKeywords;
  if (pt) {
    face.power = pt[0];
    face.toughness = pt[1];
  }
  return face;
}
