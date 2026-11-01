import type { CardDef, Color } from '@mtg/schema';
import { COLORS } from '@mtg/schema';
import { AUTOMATION_LABEL, AutomationMark } from '../components/bits';
import { costSymbols, ManaSymbol } from '../components/mana';
import type { DeckReport } from './model';

export function Identity({ colors }: { colors: readonly Color[] }) {
  return (
    <span className="identity-pips" title={colors.length ? `Colour identity: ${colors.join('')}` : 'Colourless'}>
      {colors.length ? colors.map((c) => <ManaSymbol key={c} symbol={c} />) : <ManaSymbol symbol="C" />}
    </span>
  );
}

/** Engine coverage, kept quiet: three marks with counts. */
export function Coverage({ report }: { report: DeckReport }) {
  return (
    <span className="coverage" title="How much of the deck the engine runs by itself">
      {(['full', 'partial', 'manual'] as const).map((l) => (
        <span key={l} title={`${AUTOMATION_LABEL[l]}: ${report.automation[l]} cards`}>
          <AutomationMark level={l} /> {report.automation[l]}
        </span>
      ))}
    </span>
  );
}

export interface DeckStats {
  curve: number[];
  pips: Record<Color | 'C', number>;
  lands: number;
  nonlands: number;
  avgMV: number;
}

/** Mana curve (non-land cards by mana value, 7+ together) and coloured mana symbols in their costs. */
export function deckStats(rows: { card?: CardDef; count: number }[]): DeckStats {
  const curve = Array.from({ length: 8 }, () => 0);
  const pips: Record<Color | 'C', number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  let lands = 0;
  let nonlands = 0;
  let mv = 0;
  for (const { card, count } of rows) {
    if (!card) continue;
    const front = card.faces[0]!;
    if (front.types.includes('Land')) {
      lands += count;
      continue;
    }
    nonlands += count;
    mv += card.cmc * count;
    curve[Math.min(7, Math.floor(card.cmc))]! += count;
    for (const s of costSymbols(front.manaCost)) {
      for (const c of [...COLORS, 'C'] as const) if (s.split('/').includes(c)) pips[c] += count;
    }
  }
  return { curve, pips, lands, nonlands, avgMV: nonlands ? mv / nonlands : 0 };
}

export function CurveChart({ curve }: { curve: number[] }) {
  const max = Math.max(1, ...curve);
  return (
    <figure className="curve" aria-label="Mana curve">
      <figcaption>Mana curve</figcaption>
      <div className="curve-bars">
        {curve.map((n, i) => (
          <span key={i} className="curve-col" title={`${n} card${n === 1 ? '' : 's'} at mana value ${i}${i === 7 ? ' or more' : ''}`}>
            <span className="curve-n">{n || ''}</span>
            <span className="curve-bar" style={{ height: `${(n / max) * 100}%` }} />
            <span className="curve-mv">{i === 7 ? '7+' : i}</span>
          </span>
        ))}
      </div>
    </figure>
  );
}

export function PipChart({ pips }: { pips: DeckStats['pips'] }) {
  const entries = (Object.entries(pips) as [Color | 'C', number][]).filter(([, n]) => n > 0);
  const total = entries.reduce((n, [, x]) => n + x, 0);
  return (
    <figure className="pipchart" aria-label="Coloured mana symbols">
      <figcaption>Mana symbols</figcaption>
      {total === 0 ? (
        <p className="muted small">None yet</p>
      ) : (
        <>
          <div className="pip-bar" role="img" aria-label={entries.map(([c, n]) => `${c} ${n}`).join(', ')}>
            {entries.map(([c, n]) => (
              <span key={c} className={`pip-seg seg-${c.toLowerCase()}`} style={{ flexGrow: n }} />
            ))}
          </div>
          <ul className="pip-legend">
            {entries.map(([c, n]) => (
              <li key={c}>
                <ManaSymbol symbol={c} /> {n} <span className="muted">{Math.round((n / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </figure>
  );
}
