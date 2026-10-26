/**
 * Parser for the plain-text Magic: The Gathering Comprehensive Rules
 * (https://magic.wizards.com/en/rules → "TXT").
 *
 * Shape of the file:
 *   title, "These rules are effective as of <date>.", introduction,
 *   "Contents" (a list of chapter/section headings, ending with Glossary / Credits),
 *   the body — chapters ("1. Game Concepts"), sections ("100. General"),
 *   rules ("100.1. …"), subrules ("100.1a …") and "Example: …" paragraphs —
 *   then "Glossary" (term line + definition lines, blank-line separated) and "Credits".
 */

export interface Rule {
  /** "100", "100.1" or "100.1a". Sections are rules too, so every id resolves. */
  id: string;
  text: string;
  examples: string[];
  parent?: string;
  children: string[];
}

export interface Chapter {
  id: number;
  title: string;
  sections: string[];
}

export interface RulesDoc {
  effectiveDate?: string;
  chapters: Chapter[];
  rules: Record<string, Rule>;
  glossary: Record<string, string>;
}

// The real file is inconsistent: a few rules omit the period after the number
// ("606.5 If…") or add one after a subrule letter ("119.1d. In…").
const CHAPTER = /^(\d)\. (.+)$/;
const SECTION = /^(\d{3})\. (.+)$/;
const RULE = /^(\d{3}\.\d+)\.?\s+(.*)$/;
const SUBRULE = /^(\d{3}\.\d+[a-z]+)\.?\s+(.*)$/;
const EXAMPLE = /^Example:\s*(.*)$/;

/** Strips the BOM, normalises line endings, and turns Unicode line/paragraph separators into spaces. */
export function normaliseText(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2028\u2029]/g, ' ');
}

function lastIndexOfLine(lines: string[], value: string): number {
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i]!.trim() === value) return i;
  return -1;
}

export function parseComprehensiveRules(raw: string): RulesDoc {
  const lines = normaliseText(raw).split('\n');
  const doc: RulesDoc = { chapters: [], rules: {}, glossary: {} };

  const date = /These rules are effective as of ([^.]+)\./.exec(lines.slice(0, 40).join('\n'));
  if (date) doc.effectiveDate = date[1]!.trim();

  // The contents list repeats the chapter headings, so the body starts at the
  // second "1. <title>" line; the glossary and credits are the last such headings.
  const firstChapterLines = lines.map((l, i) => (CHAPTER.test(l.trim()) && l.trim().startsWith('1. ') ? i : -1)).filter((i) => i >= 0);
  const bodyStart = firstChapterLines.length > 1 ? firstChapterLines[1]! : (firstChapterLines[0] ?? 0);
  const glossaryStart = lastIndexOfLine(lines, 'Glossary');
  const creditsStart = lastIndexOfLine(lines, 'Credits');
  const bodyEnd = glossaryStart > bodyStart ? glossaryStart : lines.length;

  let chapter: Chapter | undefined;
  let current: Rule | undefined;

  const add = (id: string, text: string, parent?: string): Rule => {
    const rule: Rule = { id, text, examples: [], children: [], ...(parent ? { parent } : {}) };
    doc.rules[id] = rule;
    if (parent) doc.rules[parent]?.children.push(id);
    return rule;
  };

  for (let i = bodyStart; i < bodyEnd; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    let m: RegExpExecArray | null;

    if ((m = RULE.exec(line))) {
      const id = m[1]!;
      current = add(id, m[2]!, id.split('.')[0]);
    } else if ((m = SUBRULE.exec(line))) {
      const id = m[1]!;
      current = add(id, m[2]!, id.replace(/[a-z]+$/, ''));
    } else if ((m = SECTION.exec(line))) {
      current = add(m[1]!, m[2]!);
      chapter?.sections.push(m[1]!);
    } else if ((m = CHAPTER.exec(line))) {
      chapter = { id: Number(m[1]), title: m[2]!, sections: [] };
      doc.chapters.push(chapter);
      current = undefined;
    } else if ((m = EXAMPLE.exec(line))) {
      current?.examples.push(m[1]!);
    } else if (current) {
      // A wrapped paragraph or a bare list line belonging to the previous rule.
      if (current.examples.length) current.examples[current.examples.length - 1] += `\n${line}`;
      else current.text += `\n${line}`;
    }
  }

  if (glossaryStart > bodyStart) {
    const end = creditsStart > glossaryStart ? creditsStart : lines.length;
    let block: string[] = [];
    const flush = () => {
      if (block.length >= 2) doc.glossary[block[0]!] = block.slice(1).join('\n');
      block = [];
    };
    for (let i = glossaryStart + 1; i < end; i++) {
      const line = lines[i]!.trim();
      if (line) block.push(line);
      else flush();
    }
    flush();
  }

  return doc;
}

/** "117.3a" → "117", the section a rule belongs to. */
export function sectionOf(id: string): string {
  return id.slice(0, 3);
}
