import { addCard, commanderProblem, type DeckCard } from './model';
import type { CardIndex } from './names';
import { parseDeckText, type ParsedText } from './parse';

export interface Unmatched {
  line: number;
  raw: string;
  name: string;
}

export interface ImportResult {
  title?: string;
  commanders: string[];
  main: DeckCard[];
  sideboard: DeckCard[];
  /** Lines naming no card in the DB. Never dropped silently: the UI lists them. */
  unmatched: Unmatched[];
  /** Lines that weren't cards (with why). */
  skipped: ParsedText['skipped'];
  notes: string[];
}

/** Matches parsed lines to cards (by DB name) and decides the commanders. */
export function resolveImport(parsed: ParsedText, index: CardIndex): ImportResult {
  const commanders: string[] = [];
  let main: DeckCard[] = [];
  let sideboard: DeckCard[] = [];
  const unmatched: Unmatched[] = [];
  const notes: string[] = [];
  const tentative: { name: string; count: number }[] = [];

  for (const e of parsed.entries) {
    const card = index.lookup(e.name);
    if (!card) {
      unmatched.push({ line: e.line, raw: e.raw, name: e.name });
      continue;
    }
    const name = card.name;
    switch (e.section) {
      case 'commander':
        if (!commanders.includes(name)) commanders.push(name);
        if (e.count > 1) notes.push(`${name} is listed ${e.count} times as commander; using one.`);
        break;
      case 'main':
        if (e.maybeCommander) tentative.push({ name, count: e.count });
        else main = addCard(main, name, e.count);
        break;
      default:
        sideboard = addCard(sideboard, name, e.count);
    }
  }

  // A trailing group of one or two cards with no header (MTGO): the commanders, if they can be.
  if (tentative.length) {
    const fit = !commanders.length && tentative.every((t) => {
      const c = index.get(t.name);
      return c && t.count === 1 && commanderProblem(c) === null;
    });
    if (fit) {
      commanders.push(...tentative.map((t) => t.name));
      notes.push(`Took ${tentative.map((t) => t.name).join(' and ')} from the last group as commander${tentative.length > 1 ? 's' : ''}.`);
    } else for (const t of tentative) main = addCard(main, t.name, t.count);
  }
  if (commanders.length > 2) notes.push(`More than two commanders listed: ${commanders.join(', ')}.`);
  // A commander also listed in the deck: once is enough.
  for (const c of commanders) {
    const dup = main.find((x) => x.name === c);
    if (dup) {
      main = addCard(main, c, -1);
      notes.push(`${c} was in the deck too; kept it as commander only.`);
    }
  }
  return { ...(parsed.title ? { title: parsed.title } : {}), commanders, main, sideboard, unmatched, skipped: parsed.skipped, notes };
}

export function importText(text: string, index: CardIndex): ImportResult {
  return resolveImport(parseDeckText(text), index);
}
