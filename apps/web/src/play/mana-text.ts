import type { ManaSpend, ObjectFilter } from '@mtg/schema';

/** Mana as its symbols, for text that's drawn with them ("{G}{G}"). */
export const manaSymbols = (mana: readonly string[]): string => mana.map((c) => `{${c}}`).join('');

/** A card's name the way players say it at the table: "Kinnan" for "Kinnan, Bonder Prodigy". */
export const shortName = (name: string): string => name.split(' // ')[0]!.split(',')[0]!;

const SIMPLE = new Set(['types', 'allTypes', 'subtypes', 'supertypes', 'notTypes', 'multicolored', 'colorless', 'chosenType']);

/** What kind of spell or source a spending restriction is about ("creature", "Dragon", "instant or sorcery"); '' for any. */
function kindOf(f: ObjectFilter): string {
  if (Object.keys(f).some((k) => !SIMPLE.has(k))) return 'certain';
  const parts: string[] = [];
  if (f.colorless) parts.push('colorless');
  if (f.multicolored) parts.push('multicolored');
  if (f.supertypes?.length) parts.push(f.supertypes.map((t) => t.toLowerCase()).join(' '));
  if (f.notTypes?.length) parts.push(f.notTypes.map((t) => `non${t.toLowerCase()}`).join(' '));
  if ((f as { chosenType?: true }).chosenType) parts.push('chosen-type');
  if (f.subtypes?.length) parts.push(f.subtypes.join(' or '));
  const types = [...(f.allTypes ?? []), ...(f.types ?? [])].map((t) => t.toLowerCase());
  if (types.length) parts.push(f.allTypes?.length ? types.join(' ') : types.join(' or '));
  return parts.join(' ');
}

/**
 * What restricted mana can be spent on (CR 106.6), in a few words: "creature abilities", "creature spells",
 * "artifact spells and abilities". (The card's own sentence is longer; this is for a chip beside the mana.)
 */
export function spendText(s: ManaSpend): string {
  const spells = s.spells ? kindOf(s.spells) : null;
  const abilities = s.abilities ? kindOf(s.abilities) : null;
  // A Powerstone: anything except casting a spell that isn't an artifact.
  if (s.other && spells) return `anything but non${spells} spells`;
  if (spells !== null && abilities !== null && spells === abilities) return `${spells ? `${spells} ` : ''}spells and abilities`;
  const parts: string[] = [];
  if (spells !== null) parts.push(`${spells ? `${spells} ` : ''}spells`);
  if (abilities !== null) parts.push(`${abilities ? `${abilities} ` : ''}abilities`);
  if (s.special?.includes('unlock') && !parts.length) parts.push('unlocking doors');
  if (s.special?.includes('face_up') && !parts.length) parts.push('turning permanents face up');
  return parts.join(' or ') || 'some things';
}
