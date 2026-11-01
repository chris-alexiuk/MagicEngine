import type { KeywordInstance } from '@mtg/schema';

/**
 * Mana and card symbols, drawn with the Mana font (mana-font, SIL OFL 1.1), bundled and self-hosted so they work
 * where a CDN stylesheet can't load.
 */

const PAIRS = new Set(['wu', 'wb', 'ub', 'ur', 'br', 'bg', 'rw', 'rg', 'gw', 'gu']);
const NUMBERS = new Set([...Array.from({ length: 21 }, (_, i) => String(i)), '100', '1000000']);
const SINGLE = new Set(['w', 'u', 'b', 'r', 'g', 'c', 's', 'e', 'x', 'y', 'z', 'p', 'h', 'l', 'd']);
const SPECIAL: Record<string, string> = { T: 'tap', Q: 'untap', '∞': 'infinity', '½': '1-2', CHAOS: 'chaos', PW: 'planeswalker', TK: 'ticket', A: 'acorn', P: 'p', PAW: 'paw' };

const pair = (a: string, b: string) => (PAIRS.has(a + b) ? a + b : PAIRS.has(b + a) ? b + a : null);

/** The mana-font class for a symbol as written between braces ("W", "2/U", "G/P", "W/U/P", "T"), or null. */
export function manaClass(symbol: string): string | null {
  const s = symbol.trim().toUpperCase();
  if (SPECIAL[s]) return SPECIAL[s]!;
  const parts = s.split('/').map((p) => p.toLowerCase());
  if (parts.length === 1) return NUMBERS.has(parts[0]!) || SINGLE.has(parts[0]!) ? parts[0]! : null;
  const [a, b, c] = parts as [string, string, string | undefined];
  if (parts.length === 2 && b === 'p') return SINGLE.has(a) ? `${a}p` : null;
  if (parts.length === 3 && c === 'p') {
    const p = pair(a, b);
    return p ? `${p}p` : null;
  }
  if (parts.length !== 2) return null;
  if (a === '2' || a === 'c') return `${a}${b}`;
  return pair(a, b);
}

export function ManaSymbol({ symbol }: { symbol: string }) {
  const cls = manaClass(symbol);
  if (!cls)
    return (
      <span className="pip-text" title={`{${symbol}}`}>
        {symbol}
      </span>
    );
  return (
    <span className="mana-sym" title={`{${symbol}}`}>
      <i className={`ms ms-cost ms-${cls}`} aria-hidden="true" />
      <span className="sr-only">{`{${symbol}}`}</span>
    </span>
  );
}

export const costSymbols = (cost: string) => [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);

export function ManaCost({ cost, className }: { cost: string; className?: string }) {
  const symbols = costSymbols(cost);
  if (symbols.length === 0) return null;
  return (
    <span className={className ? `mana-cost ${className}` : 'mana-cost'}>
      {symbols.map((s, i) => (
        <ManaSymbol key={i} symbol={s} />
      ))}
    </span>
  );
}

/** Rules text with its symbols drawn inline ({T}, {2/W}, {E}, …). */
export function RulesText({ text }: { text: string }) {
  const parts = text.split(/(\{[^}]+\})/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\{([^}]+)\}$/.exec(p);
        return m ? <ManaSymbol key={i} symbol={m[1]!} /> : p ? <span key={i}>{p}</span> : null;
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Card type and keyword icons (for compact card faces and the deck columns)
// ---------------------------------------------------------------------------

const TYPE_ORDER = ['Creature', 'Planeswalker', 'Battle', 'Land', 'Instant', 'Sorcery', 'Artifact', 'Enchantment'] as const;

/** The most telling type of a card, for its icon. */
export function mainType(types: readonly string[]): (typeof TYPE_ORDER)[number] | null {
  return TYPE_ORDER.find((t) => types.includes(t)) ?? null;
}

export function TypeIcon({ types, className }: { types: readonly string[]; className?: string }) {
  const t = mainType(types);
  if (!t) return null;
  return <i className={`ms ms-${t.toLowerCase()}${className ? ` ${className}` : ''}`} aria-hidden="true" />;
}

/** Evergreen keywords that have an icon, in the order a card face lists them. */
const KEYWORD_ICONS = ['flying', 'first_strike', 'double_strike', 'deathtouch', 'lifelink', 'trample', 'vigilance', 'haste', 'reach', 'menace', 'hexproof', 'indestructible', 'defender', 'flash', 'ward', 'shroud', 'protection', 'prowess', 'infect', 'toxic'] as const;
const KEYWORD_ABBR: Record<string, string> = { flying: 'Flying', first_strike: 'First strike', double_strike: 'Double strike', deathtouch: 'Deathtouch', lifelink: 'Lifelink', trample: 'Trample', vigilance: 'Vigilance', haste: 'Haste', reach: 'Reach', menace: 'Menace', hexproof: 'Hexproof', indestructible: 'Indestructible', defender: 'Defender', flash: 'Flash', ward: 'Ward', shroud: 'Shroud', protection: 'Protection', prowess: 'Prowess', infect: 'Infect', toxic: 'Toxic' };

export function keywordIcons(keywords: readonly Pick<KeywordInstance, 'id'>[]): string[] {
  const ids = new Set(keywords.map((k) => k.id));
  return KEYWORD_ICONS.filter((k) => ids.has(k));
}

export function KeywordIcons({ ids, max = 4 }: { ids: readonly string[]; max?: number }) {
  if (!ids.length) return null;
  return (
    <span className="kw-icons" title={ids.map((k) => KEYWORD_ABBR[k] ?? k).join(', ')}>
      {ids.slice(0, max).map((k) => (
        <i key={k} className={`ms ms-ability-${k.replace(/_/g, '-')}`} aria-hidden="true" />
      ))}
      <span className="sr-only">{ids.map((k) => KEYWORD_ABBR[k] ?? k).join(', ')}</span>
    </span>
  );
}
