import type { CardDef, FaceDef } from '@mtg/schema';
import { imageUrl } from '@mtg/schema';
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { useBundledArt } from '../art';
import { keywordIcons, KeywordIcons, ManaCost, ManaSymbol, RulesText, TypeIcon } from './mana';

/**
 * A card at any size, at a card's 63:88 proportions.
 *
 * With images, it's the whole Scryfall image: never cropped and never drawn over, so the artist and copyright line
 * stay visible. Without them (offline, a missing scan, or a page whose security policy blocks the image CDN) it's a
 * proxy drawn like a printed card. The proxy lays itself out by its own width (container queries): large, it shows
 * the rules text; small, a compact face with the name, cost, type icon, keyword icons and power/toughness.
 */

// ---------------------------------------------------------------------------
// Whether this page can load card images at all
// ---------------------------------------------------------------------------

let loaded = 0;
let failed = 0;
let blocked = false;
const listeners = new Set<() => void>();
const markBlocked = () => {
  if (blocked) return;
  blocked = true;
  listeners.forEach((l) => l());
};
if (typeof window !== 'undefined') {
  // A content security policy that blocks the CDN reports it: stop asking for images at once.
  window.addEventListener('securitypolicyviolation', (e) => {
    if (/scryfall/.test(e.blockedURI) || e.violatedDirective.startsWith('img-src')) markBlocked();
  });
}
function noteImage(ok: boolean) {
  if (ok) loaded++;
  // No policy report (some browsers don't send one): a dozen failures and not one image is as good as blocked.
  else if (++failed >= 12 && loaded === 0) markBlocked();
}
/** True once it's clear images can't load here (every card then draws as a proxy, with no failed requests). */
export function useImagesBlocked(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => blocked,
    () => blocked,
  );
}

// ---------------------------------------------------------------------------
// The proxy face
// ---------------------------------------------------------------------------

/** The frame colour: the card's colour, gold for several, land and artifact frames otherwise. */
export function frameOf(face: FaceDef): string {
  if (face.colors.length > 1) return 'gold';
  if (face.colors.length === 1) return face.colors[0]!.toLowerCase();
  if (face.types.includes('Land')) return 'land';
  if (face.types.includes('Artifact')) return 'artifact';
  return 'colorless';
}

/** How much rules text there is, which sets its size in the text box. */
function textLength(oracle: string): 's' | 'm' | 'l' | 'xl' {
  const n = oracle.replace(/\([^)]*\)/g, '').length;
  return n <= 70 ? 's' : n <= 140 ? 'm' : n <= 250 ? 'l' : 'xl';
}

const BASIC_TYPES: Record<string, string> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };

/** The mana a land makes, for its compact face: its basic land types, else the symbols after "Add" in its text. */
function landMana(face: FaceDef): string[] {
  if (!face.types.includes('Land')) return [];
  const basic = face.subtypes.flatMap((t) => (BASIC_TYPES[t] ? [BASIC_TYPES[t]!] : []));
  if (basic.length) return basic;
  if (/any colou?r/i.test(face.oracle)) return ['W', 'U', 'B', 'R', 'G'];
  const out = new Set<string>();
  for (const m of face.oracle.matchAll(/Add ((?:\{[WUBRGC]\}(?:, | or )?)+)/g)) for (const s of m[1]!.matchAll(/\{([WUBRGC])\}/g)) out.add(s[1]!);
  return [...out];
}

export interface Stats {
  /** Current power/toughness, loyalty or defense ("3/3", "4"); defaults to the printed values. */
  pt?: string;
  /** Up or down from what's printed. */
  mod?: 'up' | 'down';
  /** Extra keyword ids it has now (granted). */
  keywords?: string[];
}

export function ProxyFace({ face, stats }: { face: FaceDef; stats?: Stats }) {
  const printed = face.power !== undefined ? `${face.power}/${face.toughness}` : (face.loyalty ?? face.defense);
  const pt = stats?.pt ?? printed;
  const kws = keywordIcons([...face.keywords, ...(stats?.keywords ?? []).map((id) => ({ id }))]);
  const reminderless = face.oracle.replace(/\s*\([^)]*\)/g, '');
  const lands = landMana(face);
  return (
    <span className={`cf frame-${frameOf(face)}`} data-len={textLength(face.oracle)} {...(reminderless.trim() ? {} : { 'data-text': 'none' })} aria-hidden="true">
      <span className="cf-in">
        <span className="cf-name">
          <span className="cf-title">{face.name}</span>
          <ManaCost cost={face.manaCost} className="cf-cost" />
        </span>
        <span className="cf-art">
          {lands.length ? (
            <span className={`cf-land-mana n${Math.min(lands.length, 5)}`}>
              {lands.map((c) => (
                <ManaSymbol key={c} symbol={c} />
              ))}
            </span>
          ) : (
            <TypeIcon types={face.types} className="cf-glyph" />
          )}
          <KeywordIcons ids={kws} />
        </span>
        <span className="cf-type">{face.typeLine}</span>
        <span className="cf-text">
          {reminderless.split('\n').map((line, i) => (
            <span key={i} className="cf-line">
              <RulesText text={line} />
            </span>
          ))}
        </span>
        {pt && <span className={`cf-pt${face.loyalty && !face.power ? ' loyalty' : ''}${stats?.mod ? ` ${stats.mod}` : ''}`}>{pt}</span>}
      </span>
    </span>
  );
}

/** The back of a card (hidden hands, libraries, face-down permanents). */
export function CardBackFace({ label }: { label?: string }) {
  return (
    <span className="card back" aria-hidden="true">
      <span className="cf-back">
        <span className="cf-back-mark" />
        {label && <span className="cf-back-label">{label}</span>}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// A card: image when possible, proxy otherwise
// ---------------------------------------------------------------------------

/** True once the element is on screen or about to be (at once where that can't be watched, or when `now`). */
function useSeen(ref: RefObject<Element | null>, now: boolean): boolean {
  const [seen, setSeen] = useState(now || typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setSeen(true);
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen]);
  return seen;
}

/** Another printing's scan to draw instead of the card's own (a deck's "Seymour Guado" for Kinnan, Bonder Prodigy). */
export interface Printing {
  img?: string;
  backImg?: string;
}

export function CardView({
  card,
  faceIndex = 0,
  sizes,
  eager = false,
  stats,
  printing,
}: {
  card: CardDef;
  faceIndex?: number;
  /** The `sizes` attribute: how wide the card is drawn (picks the small or normal scan). */
  sizes: string;
  eager?: boolean;
  stats?: Stats;
  printing?: Printing | undefined;
}) {
  const face = card.faces[faceIndex] ?? card.faces[0]!;
  // Split and adventure halves share the front image.
  const own = face.img ?? card.faces[0]!.img;
  const other = printing && (faceIndex > 0 && face.img ? printing.backImg : printing.img);
  const path = other ?? own;
  const noImages = useImagesBlocked();
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useSeen(ref, eager);
  // Art shipped with the app comes first (a host that blocks the CDN has nothing else); then the CDN.
  const art = useBundledArt(path, seen);
  const fromBundle = art.bundled && !art.failed;
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  useEffect(() => setState('loading'), [path, fromBundle]);
  const tryImage = Boolean(path) && state !== 'failed' && (fromBundle ? art.url !== null : !noImages);
  return (
    <span ref={ref} className={`card${state === 'loaded' && tryImage ? ' has-img' : ''}`}>
      {/* The proxy sits underneath while the image loads, so a slow or blocked image never leaves a blank card. */}
      {(state !== 'loaded' || !tryImage) && <ProxyFace face={face} {...(stats ? { stats } : {})} />}
      {tryImage && fromBundle && (
        <img className={state === 'loaded' ? 'card-img loaded' : 'card-img'} src={art.url!} alt={face.name} decoding="async" draggable={false} onLoad={() => setState('loaded')} onError={() => setState('failed')} />
      )}
      {tryImage && !fromBundle && (
        <img
          className={state === 'loaded' ? 'card-img loaded' : 'card-img'}
          src={imageUrl(path!, 'normal')}
          srcSet={`${imageUrl(path!, 'small')} 146w, ${imageUrl(path!, 'normal')} 488w`}
          sizes={sizes}
          alt={face.name}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => {
            noteImage(true);
            setState('loaded');
          }}
          onError={() => {
            noteImage(false);
            setState('failed');
          }}
        />
      )}
    </span>
  );
}
