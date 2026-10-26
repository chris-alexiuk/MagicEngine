import { keywordSupported, type Automation, type CardDB } from '@mtg/schema';
import { normaliseSelf, stripAbilityWord } from './parser.js';

export interface TemplateStat {
  template: string;
  count: number;
  examples: string[];
}

export interface CoverageReport {
  builtAt: string;
  cardCount: number;
  totals: Record<Automation, number>;
  byLayout: Record<string, Record<Automation, number>>;
  /** Unparsed oracle lines grouped by shape, most common first: the parser's to-do list. */
  topTemplates: TemplateStat[];
  keywordCounts: Record<string, number>;
  /** Keywords the engine doesn't apply yet, by number of cards: the engine's to-do list. */
  manualKeywords: Record<string, number>;
}

const NUMBER_WORDS = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|X)\b/g;

/** Collapses an oracle line into a template so similar lines group together. */
export function templateOf(line: string, cardName: string, faceName: string): string {
  return normaliseSelf(stripAbilityWord(line), { cardName, faceName, typeLine: '' })
    .replace(/(\{(?![TQ]\})[^}]+\})+/g, '{M}') // mana costs/symbols, keeping {T} and {Q}
    .replace(/[+-]\d+\/[+-]\d+/g, '±N/±N')
    .replace(/\b\d+\b/g, 'N')
    .replace(NUMBER_WORDS, 'N');
}

export function buildCoverage(db: CardDB, topN = 200): CoverageReport {
  const totals: Record<Automation, number> = { full: 0, partial: 0, manual: 0 };
  const byLayout: Record<string, Record<Automation, number>> = {};
  const templates = new Map<string, TemplateStat>();
  const keywordCounts: Record<string, number> = {};
  const manualKeywords: Record<string, number> = {};

  for (const card of db.cards) {
    totals[card.automation]++;
    const layout = (byLayout[card.layout] ??= { full: 0, partial: 0, manual: 0 });
    layout[card.automation]++;

    for (const face of card.faces) {
      for (const kw of face.keywords) {
        keywordCounts[kw.id] = (keywordCounts[kw.id] ?? 0) + 1;
        if (!keywordSupported(kw)) manualKeywords[kw.id] = (manualKeywords[kw.id] ?? 0) + 1;
      }
      for (const line of face.unparsed) {
        const t = templateOf(line, card.name, face.name);
        const stat = templates.get(t) ?? { template: t, count: 0, examples: [] };
        stat.count++;
        if (stat.examples.length < 3) stat.examples.push(card.name);
        templates.set(t, stat);
      }
    }
  }

  return {
    builtAt: db.builtAt,
    cardCount: db.cards.length,
    totals,
    byLayout,
    topTemplates: [...templates.values()].sort((a, b) => b.count - a.count).slice(0, topN),
    keywordCounts: Object.fromEntries(Object.entries(keywordCounts).sort((a, b) => b[1] - a[1])),
    manualKeywords: Object.fromEntries(Object.entries(manualKeywords).sort((a, b) => b[1] - a[1])),
  };
}

export function coverageMarkdown(report: CoverageReport, rows = 100): string {
  const pct = (n: number) => (report.cardCount ? ((100 * n) / report.cardCount).toFixed(1) : '0.0');
  const esc = (s: string) => s.replace(/\|/g, '\\|');
  const lines = [
    `# Card coverage report`,
    ``,
    `Built ${report.builtAt} · ${report.cardCount.toLocaleString('en-US')} cards`,
    ``,
    `"Full" means the engine runs every line; "manual" means players resolve all of it by hand. A keyword the engine doesn't apply yet counts as a manual line.`,
    ``,
    `| Status | Cards | Share |`,
    `|---|---:|---:|`,
    ...(['full', 'partial', 'manual'] as const).map(
      (k) => `| ${k} | ${report.totals[k].toLocaleString('en-US')} | ${pct(report.totals[k])}% |`,
    ),
    ``,
    `## Top unparsed templates`,
    ``,
    `Each row is a grammar rule waiting to be written. \`~\` = the card itself, \`N\` = a number, \`{M}\` = a mana cost.`,
    ``,
    `| # | Lines | Template | Examples |`,
    `|---:|---:|---|---|`,
    ...report.topTemplates
      .slice(0, rows)
      .map((t, i) => `| ${i + 1} | ${t.count} | ${esc(t.template)} | ${esc(t.examples.join(', '))} |`),
    ``,
    `## Keywords the engine doesn't apply yet`,
    ``,
    `| Keyword | Cards |`,
    `|---|---:|`,
    ...Object.entries(report.manualKeywords)
      .slice(0, 60)
      .map(([k, n]) => `| ${k.replace(/_/g, ' ')} | ${n} |`),
    ``,
  ];
  return lines.join('\n');
}
