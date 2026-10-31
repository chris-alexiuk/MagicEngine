/**
 * Deck-list text in the common export formats:
 *
 *   plain             1 Sol Ring · 1x Sol Ring · Sol Ring · Sol Ring x1
 *   Moxfield          1 Sol Ring (CMM) 400 *F*      with "Commander" / "Deck" / "Sideboard" headers
 *   Arena             About / Name …, then Commander / Deck / Sideboard sections
 *   MTGO              main deck, a blank line, then the sideboard (where MTGO keeps the commander); "SB: 1 Name"
 *   Archidekt         1x Sol Ring (cmm) 400 [Ramp] · [Commander{top}] · [Maybeboard{noDeck}]
 *   TappedOut         1x Atraxa, Praetors' Voice *CMDR*
 *
 * The parser only reads the text; matching names to cards happens in resolveImport().
 */

export type Section = 'commander' | 'main' | 'sideboard' | 'maybeboard' | 'companion';

export interface ParsedEntry {
  /** 1-based line number in the pasted text. */
  line: number;
  raw: string;
  count: number;
  name: string;
  section: Section;
  /** A trailing blank-line group of one or two cards in a list with no section headers (MTGO keeps the commander there). */
  maybeCommander?: true;
  set?: string;
  number?: string;
  foil?: 'foil' | 'etched';
}

export interface ParsedText {
  title?: string;
  entries: ParsedEntry[];
  /** Lines that weren't cards or headers (comments are dropped silently). */
  skipped: { line: number; raw: string; why: string }[];
}

const HEADERS: [RegExp, Section | 'about' | 'tokens'][] = [
  [/^commanders?$/, 'commander'],
  [/^(deck|main|main ?deck|main ?board|mainboard|library)$/, 'main'],
  [/^(side|side ?board|sideboard)$/, 'sideboard'],
  [/^(maybe|maybe ?board|considering|wishlist)$/, 'maybeboard'],
  [/^companions?$/, 'companion'],
  [/^(tokens?|attractions?|stickers?|contraptions?)$/, 'tokens'],
  [/^about$/, 'about'],
];

function header(line: string): Section | 'about' | 'tokens' | null {
  const t = line
    .replace(/^\/\/\s*/, '')
    .replace(/\s*\(\s*\d+\s*\)\s*$/, '')
    .replace(/\s*:\s*\d*\s*$/, '')
    .trim()
    .toLowerCase();
  for (const [re, s] of HEADERS) if (re.test(t)) return s;
  return null;
}

/** Strips export decorations from one card line and reads its count, set and markers. */
export function parseCardLine(text: string): Omit<ParsedEntry, 'line' | 'raw' | 'section'> & { categories: string[]; cmdr: boolean } | null {
  let s = text.trim();
  let count = 1;
  let explicitCount = false;
  const categories: string[] = [];
  let cmdr = false;
  let foil: ParsedEntry['foil'];
  // Archidekt colour tags ^Have,#37d67a^ and categories [Ramp,Commander{top}].
  s = s.replace(/\s*\^[^^]*\^/g, '');
  s = s.replace(/\s*\[([^\]]*)\]/g, (_, cats: string) => {
    for (const c of cats.split(',')) categories.push(c.trim());
    return '';
  });
  // Foil / etched markers, TappedOut's commander marker.
  s = s.replace(/\s*\*([A-Za-z]{1,5})\*/g, (_, m: string) => {
    const k = m.toUpperCase();
    if (k === 'CMDR') cmdr = true;
    else if (k.includes('E')) foil = 'etched';
    else if (k.includes('F')) foil = 'foil';
    return '';
  });
  // Moxfield tags at the end ("#Ramp #Draw").
  s = s.replace(/(\s+#[^\s#][^#]*)+$/, '');
  let set: string | undefined;
  let number: string | undefined;
  const printing = /\s+\(([A-Za-z0-9]{2,6})\)(?:\s+(\S+))?\s*$/.exec(s);
  if (printing) {
    set = printing[1]!.toUpperCase();
    number = printing[2];
    s = s.slice(0, printing.index);
  }
  const lead = /^(\d+)\s*[xX]?\s+(.+)$/.exec(s);
  const trail = /^(.+?)\s+[xX]\s?(\d+)$/.exec(s);
  if (lead) {
    count = Number(lead[1]);
    s = lead[2]!;
    explicitCount = true;
  } else if (trail) {
    count = Number(trail[2]);
    s = trail[1]!;
    explicitCount = true;
  }
  const name = s.trim();
  if (!name || !/[A-Za-z]/.test(name)) return null;
  if (explicitCount && count <= 0) return null;
  return { count, name, categories, cmdr, ...(set ? { set } : {}), ...(number ? { number } : {}), ...(foil ? { foil } : {}) };
}

export function parseDeckText(text: string): ParsedText {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const entries: ParsedEntry[] = [];
  const skipped: ParsedText['skipped'] = [];
  let title: string | undefined;
  let section: Section | 'tokens' | 'about' = 'main';
  let sawHeader = false;
  // Blank-line groups of entries, for lists without headers.
  let block = 0;
  const blockOf = new Map<ParsedEntry, number>();
  let blankPending = false;

  lines.forEach((rawLine, i) => {
    const raw = rawLine.trim();
    const line = i + 1;
    if (!raw) {
      if (entries.length) blankPending = true;
      return;
    }
    const h = header(raw);
    if (h) {
      section = h;
      sawHeader = true;
      blankPending = false;
      return;
    }
    if (section === 'about') {
      const m = /^name\s+(.+)$/i.exec(raw);
      if (m) title = m[1]!.trim();
      return;
    }
    if (raw.startsWith('//') || raw.startsWith('#')) return;
    if (section === 'tokens') {
      skipped.push({ line, raw, why: 'Tokens and other extras aren’t part of the deck.' });
      return;
    }
    let body = raw;
    let lineSection: Section = section;
    const sb = /^SB:\s*(.+)$/i.exec(body);
    if (sb) {
      body = sb[1]!;
      lineSection = 'sideboard';
    }
    const parsed = parseCardLine(body);
    if (!parsed) {
      skipped.push({ line, raw, why: 'Not a card line.' });
      return;
    }
    if (blankPending) {
      block++;
      blankPending = false;
    }
    const cats = parsed.categories.map((c) => c.toLowerCase());
    if (parsed.cmdr || cats.some((c) => /^commander\b/.test(c))) lineSection = 'commander';
    else if (cats.some((c) => c.startsWith('maybeboard') || c.includes('{nodeck}'))) lineSection = 'maybeboard';
    else if (cats.some((c) => c.startsWith('sideboard'))) lineSection = 'sideboard';
    const entry: ParsedEntry = {
      line,
      raw,
      count: parsed.count,
      name: parsed.name,
      section: lineSection,
      ...(parsed.set ? { set: parsed.set } : {}),
      ...(parsed.number ? { number: parsed.number } : {}),
      ...(parsed.foil ? { foil: parsed.foil } : {}),
    };
    entries.push(entry);
    blockOf.set(entry, block);
  });

  // MTGO-style lists: no headers, the last blank-separated group holds one or two cards — likely the commander(s).
  if (!sawHeader && block > 0) {
    const last = entries.filter((e) => blockOf.get(e) === block && e.section === 'main');
    const cards = last.reduce((n, e) => n + e.count, 0);
    if (last.length && cards <= 2) for (const e of last) e.maybeCommander = true;
  }
  return { ...(title ? { title } : {}), entries, skipped };
}
