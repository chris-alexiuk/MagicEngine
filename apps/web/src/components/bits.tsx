import type { Automation, CardDef, FaceDef } from '@mtg/schema';
import { imageUrl } from '@mtg/schema';
import { useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Mana symbols, drawn locally so a search page doesn't fetch dozens of icons.
// ---------------------------------------------------------------------------

const COLOR_CLASS: Record<string, string> = { W: 'w', U: 'u', B: 'b', R: 'r', G: 'g', C: 'c', S: 'c' };

export function ManaSymbol({ symbol }: { symbol: string }) {
  const parts = symbol.split('/');
  if (parts.length === 2 && parts[1] !== 'P') {
    const [a, b] = parts as [string, string];
    return (
      <span className={`pip hybrid pip-${COLOR_CLASS[a] ?? 'c'} pip2-${COLOR_CLASS[b] ?? 'c'}`} title={`{${symbol}}`}>
        <span className="sr-only">{`{${symbol}}`}</span>
      </span>
    );
  }
  const base = parts[0]!;
  const phyrexian = parts[1] === 'P';
  const cls = COLOR_CLASS[base] ?? 'c';
  const label = base === 'T' ? '↷' : base === 'Q' ? '↶' : phyrexian ? 'ϕ' : /^[WUBRG]$/.test(base) ? '' : base;
  return (
    <span className={`pip pip-${cls}${label && label.length > 1 ? ' pip-wide' : ''}`} title={`{${symbol}}`}>
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">{`{${symbol}}`}</span>
    </span>
  );
}

export function ManaCost({ cost }: { cost: string }) {
  const symbols = [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
  if (symbols.length === 0) return null;
  return (
    <span className="mana-cost">
      {symbols.map((s, i) => (
        <ManaSymbol key={i} symbol={s} />
      ))}
    </span>
  );
}

/** Renders oracle text with inline mana symbols. */
export function RulesText({ text }: { text: string }) {
  const parts = text.split(/(\{[^}]+\})/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\{([^}]+)\}$/.exec(p);
        return m ? <ManaSymbol key={i} symbol={m[1]!} /> : <span key={i}>{p}</span>;
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Automation marker: shape carries the meaning, not just color.
// ---------------------------------------------------------------------------

export const AUTOMATION_LABEL: Record<Automation, string> = {
  full: 'Automatic',
  partial: 'Partial',
  manual: 'Manual',
};

export const AUTOMATION_HINT: Record<Automation, string> = {
  full: 'The engine runs every line of this card.',
  partial: 'The engine runs some lines; you resolve the rest in play.',
  manual: 'You resolve this card’s rules text in play.',
};

export function AutomationMark({ level, size = 12 }: { level: Automation; size?: number }) {
  return (
    <svg className={`mark mark-${level}`} width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      {level === 'full' && <path d="M6 0.8 L11.2 6 L6 11.2 L0.8 6 Z" className="mark-fill" />}
      {level === 'partial' && <path d="M6 0.8 L6 11.2 L0.8 6 Z" className="mark-fill" />}
      <path d="M6 0.8 L11.2 6 L6 11.2 L0.8 6 Z" className="mark-outline" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Card image with a text "proxy" fallback (offline, missing scan, blocked CDN).
// ---------------------------------------------------------------------------

/** The frame color a text proxy uses: the card's color, gold for several, gray for colorless, brown for lands. */
function frameOf(face: FaceDef): string {
  if (face.colors.length > 1) return 'gold';
  if (face.colors.length === 1) return face.colors[0]!.toLowerCase();
  return face.types.includes('Land') ? 'land' : 'colorless';
}

/** A text stand-in drawn like a card frame: name and cost, art area, type line, rules text, P/T box. */
export function Proxy({ face }: { face: FaceDef }) {
  const pt = face.power !== undefined ? `${face.power}/${face.toughness}` : face.loyalty ?? face.defense;
  return (
    <div className={`proxy frame-${frameOf(face)}`} aria-hidden="true">
      <div className="proxy-head">
        <span className="proxy-name">{face.name}</span>
        <ManaCost cost={face.manaCost} />
      </div>
      <div className="proxy-art" />
      <div className="proxy-type">{face.typeLine}</div>
      <div className="proxy-text">
        {face.oracle.split('\n').map((line, i) => (
          <p key={i}>
            <RulesText text={line} />
          </p>
        ))}
      </div>
      {pt && <div className="proxy-pt">{pt}</div>}
    </div>
  );
}

export function CardImage({
  card,
  faceIndex = 0,
  sizes,
  eager = false,
}: {
  card: CardDef;
  faceIndex?: number;
  sizes: string;
  eager?: boolean;
}) {
  const face = card.faces[faceIndex] ?? card.faces[0]!;
  // Split/adventure halves share the front image.
  const path = face.img ?? card.faces[0]!.img;
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  useEffect(() => setState('loading'), [path]);

  // The text proxy sits underneath, so a slow or blocked image never leaves a blank card.
  return (
    <span className="card-frame">
      {state !== 'loaded' && <Proxy face={face} />}
      {path && state !== 'failed' && (
        <img
          className={state === 'loaded' ? 'card-img loaded' : 'card-img'}
          src={imageUrl(path, 'normal')}
          srcSet={`${imageUrl(path, 'small')} 146w, ${imageUrl(path, 'normal')} 488w`}
          sizes={sizes}
          alt={face.name}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
        />
      )}
    </span>
  );
}
