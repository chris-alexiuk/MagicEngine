import type { Automation, CardDef, Color } from '@mtg/schema';
import { COLORS } from '@mtg/schema';
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AUTOMATION_LABEL, AutomationMark } from '../components/bits';
import { CardView } from '../components/Card';
import { lookOf, SeatMat } from '../components/Mat';
import { CardDetail } from '../components/CardDetail';
import { ManaCost, ManaSymbol, TypeIcon } from '../components/mana';
import { compileQuery, sortCards } from '../search';
import { Coverage, CurveChart, deckStats, Identity, PipChart } from './bits';
import { deckToText } from './exportDeck';
import { importText } from './importDeck';
import { addCard, commanderProblem, emptyDeck, pairProblem, pruneSkins, skinOf, validateDeck, type Deck, type ProblemKind } from './model';
import type { CardIndex } from './names';
import { withPrinting } from '../skins';
import { EXPORT_HELP, fetchDeckText, parseDeckUrl, RemoteImportError } from './remote';
import type { ImportResult } from './importDeck';

const PAGE = 80;

const PROBLEM_LABEL: Record<ProblemKind, string> = {
  size: 'size',
  commander: 'commander',
  identity: 'off-colour',
  singleton: 'too many copies',
  banned: 'banned',
  not_legal: 'not legal',
  unknown: 'unknown card',
};

const GROUPS: [string, string, (c: CardDef) => boolean][] = [
  ['Creatures', 'Creature', (c) => c.faces[0]!.types.includes('Creature')],
  ['Planeswalkers', 'Planeswalker', (c) => c.faces[0]!.types.includes('Planeswalker')],
  ['Battles', 'Battle', (c) => c.faces[0]!.types.includes('Battle')],
  ['Instants', 'Instant', (c) => c.faces[0]!.types.includes('Instant')],
  ['Sorceries', 'Sorcery', (c) => c.faces[0]!.types.includes('Sorcery')],
  ['Artifacts', 'Artifact', (c) => c.faces[0]!.types.includes('Artifact')],
  ['Enchantments', 'Enchantment', (c) => c.faces[0]!.types.includes('Enchantment')],
  ['Lands', 'Land', (c) => c.faces[0]!.types.includes('Land')],
];

const TYPE_CHIPS = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle'];
const MV_CHIPS: [string, (mv: number) => boolean][] = [
  ['0–1', (n) => n <= 1],
  ['2', (n) => n === 2],
  ['3', (n) => n === 3],
  ['4', (n) => n === 4],
  ['5', (n) => n === 5],
  ['6+', (n) => n >= 6],
];

const toggle = <T,>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

/** The deck banner's wash: its colour identity, faint, from one corner to the other. */
const TINT: Record<string, string> = { W: '#e8dcb2', U: '#4f86c0', B: '#6b5f6e', R: '#c45a3a', G: '#4b9058', C: '#8a9099' };
function bannerTint(identity: readonly Color[]): React.CSSProperties {
  const a = TINT[identity[0] ?? 'C']!;
  const b = TINT[identity[identity.length - 1] ?? 'C']!;
  return { ['--tint-a' as string]: a, ['--tint-b' as string]: b };
}

// ---------------------------------------------------------------------------
// A large card beside whatever's under the pointer
// ---------------------------------------------------------------------------

function usePreview() {
  const [p, setP] = useState<{ card: CardDef; rect: DOMRect } | null>(null);
  const bind = (card: CardDef | undefined) =>
    card
      ? {
          onMouseEnter: (e: React.MouseEvent<HTMLElement>) => setP({ card, rect: e.currentTarget.getBoundingClientRect() }),
          onMouseLeave: () => setP(null),
        }
      : {};
  const node = p ? <Preview card={p.card} rect={p.rect} /> : null;
  return { bind, node, hide: () => setP(null) };
}

function Preview({ card, rect }: { card: CardDef; rect: DOMRect }) {
  const w = Math.min(300, Math.max(230, window.innerHeight * 0.34));
  const h = w * (88 / 63);
  const left = rect.right + 18 + w < window.innerWidth - 8 ? rect.right + 18 : Math.max(8, rect.left - 18 - w);
  const top = Math.max(54, Math.min(rect.top + rect.height / 2 - h / 2, window.innerHeight - h - 8));
  return (
    <div className="hover-preview" aria-hidden="true" style={{ left, top, width: w }}>
      <span className="preview-card">
        <CardView card={card} sizes={`${Math.round(w)}px`} eager />
      </span>
    </div>
  );
}

/** A card as a deck draws it: with the printing the deck asked for, if it asked for one. */
function dressed(deck: Pick<Deck, 'skins'>, card: CardDef): CardDef;
function dressed(deck: Pick<Deck, 'skins'>, card: CardDef | undefined): CardDef | undefined;
function dressed(deck: Pick<Deck, 'skins'>, card: CardDef | undefined): CardDef | undefined {
  return card && withPrinting(card, skinOf(deck, card));
}

// ---------------------------------------------------------------------------
// The deck list
// ---------------------------------------------------------------------------

export function DecksView({ cards, index, decks, setDecks, deckId, go }: { cards: CardDef[]; index: CardIndex; decks: Deck[]; setDecks: (d: Deck[]) => void; deckId: string | null; go: (route: string) => void }) {
  const [importing, setImporting] = useState(false);
  const deck = deckId ? decks.find((d) => d.id === deckId) : undefined;
  const save = (next: Deck) => {
    const d = pruneSkins(next);
    setDecks(decks.some((x) => x.id === d.id) ? decks.map((x) => (x.id === d.id ? { ...d, updatedAt: new Date().toISOString() } : x)) : [...decks, d]);
  };
  const playtest = (id: string) => go(`#/play?playtest=${id}`);

  if (deckId && deck) {
    return (
      <DeckEditor
        cards={cards}
        index={index}
        deck={deck}
        onChange={save}
        onDelete={() => {
          setDecks(decks.filter((d) => d.id !== deck.id));
          go('#/decks');
        }}
        onBack={() => go('#/decks')}
        onPlaytest={() => playtest(deck.id)}
      />
    );
  }
  return (
    <div className="page decks">
      <div className="page-head">
        <h2 className="page-title">Decks</h2>
        <div className="btn-row">
          <button type="button" className="secondary" onClick={() => setImporting(true)}>
            Import
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              const d = emptyDeck(`Deck ${decks.length + 1}`);
              setDecks([...decks, d]);
              go(`#/decks/${d.id}`);
            }}
          >
            New deck
          </button>
        </div>
      </div>
      {deckId && !deck && <p className="banner warn">That deck doesn’t exist any more.</p>}
      {decks.length === 0 ? (
        <div className="empty-state">
          <p>No decks yet.</p>
          <p className="muted">Start a new one, or import a list from Moxfield, Archidekt, MTGO, Arena or plain text.</p>
        </div>
      ) : (
        <ul className="deck-tiles">
          {decks.map((d) => {
            const report = validateDeck(d, index.get);
            const cmd = d.commanders.map((n) => dressed(d, index.get(n))).filter((c): c is CardDef => Boolean(c));
            return (
              <li key={d.id} className="deck-tile">
                <a className="deck-tile-link" href={`#/decks/${d.id}`}>
                  <span className={`deck-tile-cards n${Math.max(1, cmd.length)}`}>
                    {cmd.length ? (
                      cmd.map((c) => (
                        <span key={c.id} className="deck-tile-card">
                          <CardView card={c} sizes="120px" />
                        </span>
                      ))
                    ) : (
                      <span className="deck-tile-card empty" />
                    )}
                  </span>
                  <span className="deck-tile-info">
                    <strong className="deck-tile-name">{d.name}</strong>
                    <span className="muted">{d.commanders.join(' & ') || 'No commander yet'}</span>
                    <span className="deck-tile-row">
                      <Identity colors={report.identity} />
                      <span className={report.total === 100 ? 'count ok' : 'count'}>{report.total}/100</span>
                      <span className={report.problems.length ? 'deck-status warn' : 'deck-status ok'}>{report.problems.length ? `${report.problems.length} problem${report.problems.length > 1 ? 's' : ''}` : 'Legal'}</span>
                    </span>
                    <Coverage report={report} />
                  </span>
                </a>
                <button type="button" className="secondary tiny playtest" onClick={() => playtest(d.id)} disabled={report.total === 0}>
                  Playtest
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {importing && (
        <ImportDialog
          index={index}
          onClose={() => setImporting(false)}
          actions={[
            {
              label: 'Create deck',
              run: (r, name, source) => {
                const d: Deck = pruneSkins({ ...emptyDeck(name), commanders: r.commanders.slice(0, 2), main: r.main, sideboard: r.sideboard, ...(source ? { source } : {}), ...(Object.keys(r.skins).length ? { skins: r.skins } : {}) });
                setDecks([...decks, d]);
                setImporting(false);
                go(`#/decks/${d.id}`);
              },
            },
          ]}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

type Row = { name: string; count: number; card?: CardDef };

function DeckEditor({ cards, index, deck, onChange, onDelete, onBack, onPlaytest }: { cards: CardDef[]; index: CardIndex; deck: Deck; onChange: (d: Deck) => void; onDelete: () => void; onBack: () => void; onPlaytest: () => void }) {
  const [detail, setDetail] = useState<CardDef | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Asked on the page: a host that embeds it never shows a browser dialog (it answers "no" for it).
  const [deleting, setDeleting] = useState(false);
  const [layout, setLayout] = useState<'stacks' | 'list'>(() => (localStorage.getItem('mtg-deck-layout') === 'list' ? 'list' : 'stacks'));
  const [menu, setMenu] = useState<{ name: string; rect: DOMRect; commander: boolean } | null>(null);
  const preview = usePreview();
  const report = useMemo(() => validateDeck(deck, index.get), [deck, index]);
  const commanders = deck.commanders.map((n) => dressed(deck, index.get(n)));

  const set = (patch: Partial<Deck>) => onChange({ ...deck, ...patch });
  const add = (name: string, n = 1) => set({ main: addCard(deck.main, name, n) });
  const makeCommander = (c: CardDef) => {
    const main = deck.main.some((x) => x.name === c.name) ? addCard(deck.main, c.name, -1) : deck.main;
    set({ commanders: [...deck.commanders, c.name].slice(-2), main });
  };
  const dropCommander = (name: string) => set({ commanders: deck.commanders.filter((n) => n !== name), main: addCard(deck.main, name, 1) });
  const canCommand = (c: CardDef) => {
    if (deck.commanders.includes(c.name)) return false;
    if (deck.commanders.length === 0) return commanderProblem(c) === null;
    if (deck.commanders.length === 1) {
      const first = index.get(deck.commanders[0]!);
      return Boolean(first && pairProblem(first, c) === null);
    }
    return false;
  };

  const rows: Row[] = useMemo(() => deck.main.map((e) => ({ ...e, card: dressed(deck, index.get(e.name)) })).sort((a, b) => (a.card?.cmc ?? 99) - (b.card?.cmc ?? 99) || a.name.localeCompare(b.name)), [deck.main, deck.skins, index]); // eslint-disable-line react-hooks/exhaustive-deps
  const grouped = useMemo(() => {
    const out: { title: string; type: string; rows: Row[] }[] = [];
    const used = new Set<string>();
    for (const [title, type, test] of GROUPS) {
      const list = rows.filter((r) => r.card && !used.has(r.name) && test(r.card));
      list.forEach((r) => used.add(r.name));
      if (list.length) out.push({ title, type, rows: list });
    }
    const rest = rows.filter((r) => !used.has(r.name));
    if (rest.length) out.push({ title: 'Other', type: '', rows: rest });
    return out;
  }, [rows]);
  const stats = useMemo(() => deckStats([...rows, ...commanders.map((card) => ({ card, count: 1 }))]), [rows, commanders]); // eslint-disable-line react-hooks/exhaustive-deps

  const setView = (v: 'stacks' | 'list') => {
    setLayout(v);
    try {
      localStorage.setItem('mtg-deck-layout', v);
    } catch {
      /* not remembered */
    }
  };
  const openMenu = (name: string, el: HTMLElement, commander = false) => setMenu({ name, rect: el.getBoundingClientRect(), commander });
  const menuCard = menu ? index.get(menu.name) : undefined;
  /** Draws a card with one of its other-name printings (or, with none, its usual one). */
  const setSkin = (card: CardDef, aka?: NonNullable<CardDef['aka']>[number]) => {
    const { [card.name]: _, ...rest } = deck.skins ?? {};
    const skins = aka ? { ...rest, [card.name]: { as: aka.name, set: aka.set, number: aka.number } } : rest;
    const { skins: __, ...bare } = deck;
    onChange(Object.keys(skins).length ? { ...bare, skins } : bare);
  };
  const skinName = (name: string) => deck.skins?.[name]?.as;

  return (
    <div className="editor">
      <div className="editor-main">
        <header className="deck-banner" style={bannerTint(report.identity)}>
          <SeatMat look={{ ...lookOf(commanders), colors: [...report.identity] }} />
          <div className={`banner-cards n${Math.max(1, commanders.length)}`}>
            {commanders.length ? (
              commanders.map((c, i) =>
                c ? (
                  <button key={c.id} type="button" className="banner-card" onClick={(e) => openMenu(deck.commanders[i]!, e.currentTarget, true)} {...preview.bind(c)} aria-label={`${c.name} (commander)`}>
                    <CardView card={c} sizes="160px" eager />
                  </button>
                ) : null,
              )
            ) : (
              <span className="banner-card empty">
                <span>Choose a commander from the search</span>
              </span>
            )}
          </div>
          <div className="banner-info">
            <button type="button" className="crumb" onClick={onBack}>
              All decks
            </button>
            <input className="deck-name" value={deck.name} onChange={(e) => set({ name: e.target.value })} aria-label="Deck name" />
            <p className="banner-sub">{deck.commanders.map((n) => (skinName(n) ? `${n} (as ${skinName(n)})` : n)).join(' & ') || 'No commander yet'}</p>
            <div className="banner-stats">
              <Identity colors={report.identity} />
              <span className={report.total === 100 ? 'stat ok' : 'stat warn'}>
                <strong>{report.total}</strong>/100
              </span>
              <span className="stat">
                <strong>{stats.avgMV.toFixed(2)}</strong> avg mana value
              </span>
              <span className="stat">
                <strong>{stats.lands}</strong> lands
              </span>
              <span className="stat" title={report.gameChangers.length ? report.gameChangers.join(', ') : 'No cards from the Game Changers list'}>
                <strong>{report.gameChangers.length}</strong> Game Changer{report.gameChangers.length === 1 ? '' : 's'}
                <span className="muted"> · {report.gameChangers.length === 0 ? 'bracket 1–2' : report.gameChangers.length <= 3 ? 'bracket 3+' : 'bracket 4+'}</span>
              </span>
            </div>
            <Coverage report={report} />
            <div className="banner-actions">
              <button type="button" className="primary" onClick={onPlaytest} disabled={report.total === 0}>
                Playtest
              </button>
              <button type="button" className="secondary" onClick={() => setImporting(true)}>
                Import
              </button>
              <button type="button" className="secondary" onClick={() => setExporting(true)}>
                Export
              </button>
              {deleting ? (
                <span className="confirm-row" role="group" aria-label={`Delete ${deck.name}?`}>
                  <span className="confirm-ask">Delete this deck?</span>
                  <button type="button" className="ghost danger" onClick={onDelete}>
                    Delete
                  </button>
                  <button type="button" className="ghost" onClick={() => setDeleting(false)}>
                    Keep it
                  </button>
                </span>
              ) : (
                <button type="button" className="ghost danger" onClick={() => setDeleting(true)}>
                  Delete
                </button>
              )}
            </div>
          </div>
          <div className="banner-charts">
            <CurveChart curve={stats.curve} />
            <PipChart pips={stats.pips} />
          </div>
        </header>

        {report.problems.length > 0 && (
          <ul className="problems">
            {report.problems.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
        )}

        <div className="deck-toolbar">
          <span className="seg-group compact" role="radiogroup" aria-label="Layout">
            <button type="button" role="radio" aria-checked={layout === 'stacks'} className={layout === 'stacks' ? 'seg active' : 'seg'} onClick={() => setView('stacks')}>
              Stacks
            </button>
            <button type="button" role="radio" aria-checked={layout === 'list'} className={layout === 'list' ? 'seg active' : 'seg'} onClick={() => setView('list')}>
              List
            </button>
          </span>
          <span className="muted small">Click a card for +1, −1 and more. Hover to see it large.</span>
        </div>

        {layout === 'stacks' ? (
          <div className="stack-columns">
            {commanders.some(Boolean) && (
              <section className="stack-col" aria-label="Commander">
                <h3 className="col-title">
                  <i className="ms ms-commander" aria-hidden="true" /> Commander <span className="muted">{commanders.length}</span>
                </h3>
                <ol className="card-stack">
                  {commanders.map((c, i) =>
                    c ? (
                      <li key={c.id} className="stack-entry">
                        <span className="stack-gutter">
                          <AutomationMark level={c.automation} size={10} />
                        </span>
                        <button type="button" className="stack-card-btn" onClick={(e) => openMenu(deck.commanders[i]!, e.currentTarget, true)} {...preview.bind(c)} aria-label={`${c.name} (commander)`}>
                          <CardView card={c} sizes="170px" />
                        </button>
                      </li>
                    ) : null,
                  )}
                </ol>
              </section>
            )}
            {grouped.map((grp) => (
              <section key={grp.title} className="stack-col" aria-label={grp.title}>
                <h3 className="col-title">
                  {grp.type && <TypeIcon types={[grp.type]} />} {grp.title} <span className="muted">{grp.rows.reduce((n, r) => n + r.count, 0)}</span>
                </h3>
                <ol className="card-stack">
                  {grp.rows.map((r) => {
                    const issues = report.byCard.get(r.name) ?? [];
                    return (
                      <li key={r.name} className={issues.length ? 'stack-entry has-issue' : 'stack-entry'}>
                        <span className="stack-gutter">
                          {r.count > 1 && <span className="stack-count">{r.count}</span>}
                          {r.card && <AutomationMark level={r.card.automation} size={10} />}
                          {issues.length > 0 && (
                            <span className="stack-issue" title={issues.map((k) => PROBLEM_LABEL[k]).join(', ')}>
                              !
                            </span>
                          )}
                        </span>
                        <button type="button" className="stack-card-btn" onClick={(e) => openMenu(r.name, e.currentTarget)} {...preview.bind(r.card)} aria-label={`${r.count} ${r.name}`}>
                          {r.card ? <CardView card={r.card} sizes="170px" /> : <span className="unknown-card">{r.name}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
            {grouped.length === 0 && <p className="empty-state muted">The deck is empty. Search on the right to add cards.</p>}
          </div>
        ) : (
          <div className="list-columns">
            {grouped.map((grp) => (
              <section key={grp.title} className="list-group">
                <h3 className="col-title">
                  {grp.type && <TypeIcon types={[grp.type]} />} {grp.title} <span className="muted">{grp.rows.reduce((n, r) => n + r.count, 0)}</span>
                </h3>
                <ul className="deck-rows">
                  {grp.rows.map((r) => {
                    const issues = report.byCard.get(r.name) ?? [];
                    return (
                      <li key={r.name} className={issues.length ? 'deck-row has-issue' : 'deck-row'}>
                        <span className="stepper">
                          <button type="button" className="step-btn" onClick={() => add(r.name, -1)} aria-label={`One fewer ${r.name}`}>
                            −
                          </button>
                          <span className="row-count">{r.count}</span>
                          <button type="button" className="step-btn" onClick={() => add(r.name, 1)} aria-label={`One more ${r.name}`}>
                            +
                          </button>
                        </span>
                        <button type="button" className="row-name" onClick={(e) => openMenu(r.name, e.currentTarget)} {...preview.bind(r.card)}>
                          {r.name}
                          {skinName(r.name) && <span className="row-as"> as {skinName(r.name)}</span>}
                        </button>
                        {r.card && <ManaCost cost={r.card.faces[0]!.manaCost} />}
                        {r.card && <AutomationMark level={r.card.automation} />}
                        {issues.map((k) => (
                          <span key={k} className="issue">
                            {PROBLEM_LABEL[k]}
                          </span>
                        ))}
                        {r.card?.gameChanger && (
                          <span className="issue gc-tag" title="On the Commander Game Changers list">
                            GC
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}

        {deck.sideboard.length > 0 && (
          <section className="sideboard">
            <h3 className="col-title">
              Sideboard and maybeboard <span className="muted">not played</span>
            </h3>
            <ul className="deck-rows">
              {deck.sideboard.map((c) => (
                <li key={`s-${c.name}`} className="deck-row">
                  <span className="row-count">{c.count}</span>
                  <span className="row-name static" {...preview.bind(dressed(deck, index.get(c.name)))}>
                    {c.name}
                  </span>
                  <button type="button" className="ghost tiny" onClick={() => set({ sideboard: deck.sideboard.filter((x) => x.name !== c.name), main: addCard(deck.main, c.name, c.count) })}>
                    Move to deck
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <SearchPanel cards={cards} deck={deck} identity={report.identity} canCommand={canCommand} onAdd={(c) => add(c.name)} onCommander={makeCommander} onDetail={setDetail} bind={preview.bind} />

      {menu && (
        <DeckCardMenu
          rect={menu.rect}
          title={menu.name}
          onClose={() => setMenu(null)}
          items={[
            ...(menu.commander
              ? [{ label: 'Move to the deck (not a commander)', run: () => dropCommander(menu.name) }]
              : [
                  { label: '+1', run: () => add(menu.name, 1), keep: true },
                  { label: '−1', run: () => add(menu.name, -1), keep: (deck.main.find((x) => x.name === menu.name)?.count ?? 0) > 1 },
                  ...(menuCard && canCommand(menuCard) ? [{ label: deck.commanders.length ? 'Make second commander' : 'Make commander', run: () => makeCommander(menuCard) }] : []),
                ]),
            // A printing with a name of its own: draw the card with it, or go back to the usual one.
            ...(menuCard?.aka ?? []).filter((a) => a.img && skinOf(deck, menuCard!) !== a).map((a) => ({ label: `Show as ${a.name} (${a.set.toUpperCase()})`, run: () => setSkin(menuCard!, a) })),
            ...(menuCard && skinOf(deck, menuCard) ? [{ label: 'Show the usual printing', run: () => setSkin(menuCard) }] : []),
            ...(menuCard ? [{ label: 'Details', run: () => setDetail(dressed(deck, menuCard)) }] : []),
          ]}
        />
      )}
      {preview.node}
      {detail && (
        <CardDialog card={detail} onClose={() => setDetail(null)}>
          <div className="btn-row">
            {canCommand(detail) && (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  makeCommander(detail);
                  setDetail(null);
                }}
              >
                {deck.commanders.length ? 'Add as second commander' : 'Make commander'}
              </button>
            )}
            {!deck.commanders.includes(detail.name) && (
              <button type="button" className="secondary" onClick={() => add(detail.name)}>
                Add to deck ({deck.main.find((x) => x.name === detail.name)?.count ?? 0})
              </button>
            )}
            {deck.main.some((x) => x.name === detail.name) && (
              <button type="button" className="secondary" onClick={() => add(detail.name, -1)}>
                Remove one
              </button>
            )}
          </div>
        </CardDialog>
      )}
      {importing && (
        <ImportDialog
          index={index}
          onClose={() => setImporting(false)}
          actions={[
            {
              label: 'Replace this deck’s cards',
              run: (r, _name, source) => {
                const { skins: _, ...bare } = deck;
                onChange({ ...bare, commanders: r.commanders.slice(0, 2), main: r.main, sideboard: r.sideboard, ...(source ? { source } : {}), ...(Object.keys(r.skins).length ? { skins: r.skins } : {}) });
                setImporting(false);
              },
            },
            {
              label: 'Add to this deck',
              run: (r) => {
                let main = deck.main;
                for (const c of r.main) main = addCard(main, c.name, c.count);
                const cmds = deck.commanders.length ? deck.commanders : r.commanders.slice(0, 2);
                const skins = { ...r.skins, ...deck.skins };
                onChange({ ...deck, commanders: cmds, main, ...(Object.keys(skins).length ? { skins } : {}) });
                setImporting(false);
              },
            },
          ]}
        />
      )}
      {exporting && <ExportDialog deck={deck} onClose={() => setExporting(false)} />}
    </div>
  );
}

function DeckCardMenu({ rect, title, items, onClose }: { rect: DOMRect; title: string; items: { label: string; run: () => void; keep?: boolean }[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: rect.left, top: rect.bottom });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, rect.left + rect.width / 2 - el.offsetWidth / 2));
    const below = rect.top + 34;
    const top = below + el.offsetHeight < window.innerHeight - 8 ? below : Math.max(8, rect.top - el.offsetHeight - 6);
    setPos({ left, top });
  }, [rect]);
  useEffect(() => {
    const away = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const t = setTimeout(() => document.addEventListener('pointerdown', away), 0);
    window.addEventListener('keydown', esc);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);
  useEffect(() => ref.current?.querySelector<HTMLButtonElement>('button')?.focus(), []);
  return (
    <div ref={ref} className="card-menu" role="menu" style={{ left: pos.left, top: pos.top }}>
      <p className="menu-title">{title}</p>
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          className="menu-item"
          onClick={() => {
            it.run();
            if (!it.keep) onClose();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search with filter chips
// ---------------------------------------------------------------------------

function SearchPanel({ cards, deck, identity, canCommand, onAdd, onCommander, onDetail, bind }: { cards: CardDef[]; deck: Deck; identity: Color[]; canCommand: (c: CardDef) => boolean; onAdd: (c: CardDef) => void; onCommander: (c: CardDef) => void; onDetail: (c: CardDef) => void; bind: (c: CardDef | undefined) => object }) {
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [types, setTypes] = useState<string[]>([]);
  const [colors, setColors] = useState<(Color | 'C')[]>([]);
  const [mvs, setMvs] = useState<string[]>([]);
  const [levels, setLevels] = useState<Automation[]>([]);
  const [fit, setFit] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  const compiled = useMemo(() => compileQuery(deferred), [deferred]);
  const choosingCommander = deck.commanders.length === 0;
  useEffect(() => setLimit(PAGE), [deferred, types, colors, mvs, levels, fit]);

  const results = useMemo(() => {
    const mvTests = MV_CHIPS.filter(([k]) => mvs.includes(k)).map(([, t]) => t);
    const base = cards.filter((c) => {
      if (!compiled.test(c)) return false;
      const f = c.faces[0]!;
      if (types.length && !types.some((t) => f.types.includes(t))) return false;
      if (colors.length && !colors.some((x) => (x === 'C' ? c.colorIdentity.length === 0 : c.colorIdentity.includes(x)))) return false;
      if (mvTests.length && !mvTests.some((t) => t(c.cmc))) return false;
      if (levels.length && !levels.includes(c.automation)) return false;
      if (choosingCommander) return commanderProblem(c) === null;
      return !fit || c.colorIdentity.every((x) => identity.includes(x));
    });
    return sortCards(base, 'popularity');
  }, [cards, compiled, types, colors, mvs, levels, fit, identity, choosingCommander]);

  const chip = (on: boolean, label: React.ReactNode, onClick: () => void, key: string) => (
    <button key={key} type="button" className={on ? 'chip-btn selected' : 'chip-btn'} aria-pressed={on} onClick={onClick}>
      {label}
    </button>
  );
  const any = types.length + colors.length + mvs.length + levels.length > 0;

  return (
    <aside className="editor-search" aria-label="Add cards">
      <input className="text-input search-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={choosingCommander ? 'Search for a commander' : 'Search cards to add (try t:elf mv<=2)'} autoComplete="off" spellCheck={false} aria-label="Search cards" />
      {compiled.errors.length > 0 && (
        <ul className="search-errors" role="status">
          {compiled.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="filter-chips" aria-label="Filters">
        <div className="chip-row">{TYPE_CHIPS.map((t) => chip(types.includes(t), <><TypeIcon types={[t]} /> {t}</>, () => setTypes(toggle(types, t)), t))}</div>
        <div className="chip-row">
          {[...COLORS, 'C' as const].map((c) => chip(colors.includes(c), <ManaSymbol symbol={c} />, () => setColors(toggle(colors, c)), c))}
          <span className="chip-sep" />
          {MV_CHIPS.map(([k]) => chip(mvs.includes(k), k, () => setMvs(toggle(mvs, k)), `mv${k}`))}
        </div>
        <div className="chip-row">
          {(['full', 'partial', 'manual'] as const).map((l) => chip(levels.includes(l), <><AutomationMark level={l} /> {AUTOMATION_LABEL[l]}</>, () => setLevels(toggle(levels, l)), l))}
          {any && (
            <button
              type="button"
              className="linkish"
              onClick={() => {
                setTypes([]);
                setColors([]);
                setMvs([]);
                setLevels([]);
              }}
            >
              Clear
            </button>
          )}
        </div>
        {!choosingCommander && (
          <label className="check small">
            <input type="checkbox" checked={fit} onChange={(e) => setFit(e.target.checked)} />
            Only the commander’s colours
          </label>
        )}
      </div>
      <p className="tally">
        {choosingCommander ? 'Cards that can be your commander: ' : ''}
        {results.length.toLocaleString()}
      </p>
      <ul className="result-rows">
        {results.slice(0, limit).map((c) => {
          const inDeck = deck.main.find((x) => x.name === c.name)?.count ?? 0;
          const f = c.faces[0]!;
          return (
            <li key={c.id} className="result-row">
              <button type="button" className="result-main" onClick={() => onDetail(c)} {...bind(c)}>
                <span className="result-type">
                  <TypeIcon types={f.types} />
                </span>
                <span className="result-name">{c.name}</span>
                <ManaCost cost={f.manaCost} />
              </button>
              <span className="result-mark" title={AUTOMATION_LABEL[c.automation]}>
                <AutomationMark level={c.automation} size={10} />
              </span>
              {choosingCommander ? (
                <button type="button" className="secondary tiny add-btn" onClick={() => onCommander(c)}>
                  Commander
                </button>
              ) : (
                <>
                  {canCommand(c) && (
                    <button type="button" className="ghost tiny add-btn" onClick={() => onCommander(c)} title="Add as the second commander">
                      Partner
                    </button>
                  )}
                  <button type="button" className="secondary tiny add-btn" onClick={() => onAdd(c)} aria-label={`Add ${c.name}`}>
                    {inDeck ? `+1 (${inDeck})` : 'Add'}
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {results.length > limit && (
        <button type="button" className="secondary more" onClick={() => setLimit(limit + PAGE)}>
          Show more
        </button>
      )}
    </aside>
  );
}

function CardDialog({ card, onClose, children }: { card: CardDef; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} className="sheet card-dialog" onClose={onClose} aria-label={card.name}>
      <div className="sheet-inner">
        {children}
        <CardDetail card={card} onClose={() => ref.current?.close()} />
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

type ImportAction = { label: string; run: (r: ImportResult, name: string, source?: string) => void };

function ImportDialog({ index, onClose, actions }: { index: CardIndex; onClose: () => void; actions: ImportAction[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<'paste' | 'link'>('paste');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [source, setSource] = useState<string | undefined>();
  const [remote, setRemote] = useState<{ busy: boolean; message?: string; help?: string }>({ busy: false });
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const result = useMemo(() => (text.trim() ? importText(text, index) : null), [text, index]);
  const matched = result ? result.commanders.length + result.main.reduce((n, c) => n + c.count, 0) : 0;

  const fetchUrl = async () => {
    const where = parseDeckUrl(url);
    if (!where) {
      setRemote({ busy: false, message: 'That isn’t a Moxfield or Archidekt deck link.' });
      return;
    }
    setRemote({ busy: true });
    try {
      const got = await fetchDeckText(where);
      setText(got.text);
      if (got.name) setName(got.name);
      setSource(url.trim());
      setRemote({ busy: false, message: `Fetched from ${where.site === 'moxfield' ? 'Moxfield' : 'Archidekt'}.` });
      setTab('paste');
    } catch (err) {
      const why = err instanceof RemoteImportError ? err.message : String(err);
      setRemote({ busy: false, message: `Couldn’t fetch the deck: ${why}`, help: EXPORT_HELP[where.site] });
    }
  };

  return (
    <dialog ref={ref} className="sheet import-dialog" onClose={onClose} aria-labelledby="import-title">
      <div className="sheet-inner">
        <header className="sheet-head">
          <h2 id="import-title">Import a deck</h2>
          <button type="button" className="ghost" onClick={() => ref.current?.close()}>
            Cancel
          </button>
        </header>
        <div className="seg-group compact" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'paste'} className={tab === 'paste' ? 'seg active' : 'seg'} onClick={() => setTab('paste')}>
            Paste a list
          </button>
          <button type="button" role="tab" aria-selected={tab === 'link'} className={tab === 'link' ? 'seg active' : 'seg'} onClick={() => setTab('link')}>
            From a link
          </button>
        </div>
        {tab === 'link' ? (
          <section className="import-link">
            <div className="url-row">
              <input className="text-input grow" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://moxfield.com/decks/… or https://archidekt.com/decks/…" aria-label="Deck link" />
              <button type="button" className="primary" onClick={() => void fetchUrl()} disabled={remote.busy || !url.trim()}>
                {remote.busy ? 'Fetching…' : 'Fetch'}
              </button>
            </div>
            {remote.message && <p className={remote.help ? 'hint warn' : 'hint'}>{remote.message}</p>}
            {remote.help && <p className="banner">{remote.help}</p>}
            <p className="hint">Deck sites often block requests from other pages. Exporting the deck as text there and pasting it here always works.</p>
          </section>
        ) : (
          <textarea
            className="paste"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            spellCheck={false}
            placeholder={'Commander\n1 Kinnan, Bonder Prodigy\n\nDeck\n1 Sol Ring (CMM) 400\n1x Arcane Signet\n…\n\nMoxfield, Archidekt, MTGO, Arena and plain text all work.'}
            aria-label="Deck list"
          />
        )}
        {result && (
          <section className="import-result">
            <p className="import-summary">
              <strong>{matched}</strong> cards matched
              {result.commanders.length ? (
                <>
                  {' '}· commander <strong>{result.commanders.join(' & ')}</strong>
                </>
              ) : (
                ' · no commander found (choose one after importing)'
              )}
              {result.sideboard.length ? ` · ${result.sideboard.reduce((n, c) => n + c.count, 0)} in sideboard/maybeboard` : ''}
            </p>
            {result.notes.map((n, i) => (
              <p key={i} className="hint">
                {n}
              </p>
            ))}
            {result.unmatched.length > 0 && (
              <div className="unmatched">
                <p className="warn-text">
                  {result.unmatched.length} line{result.unmatched.length > 1 ? 's' : ''} didn’t match any card and won’t be imported:
                </p>
                <ul>
                  {result.unmatched.map((u) => (
                    <li key={u.line}>
                      <span className="line-no">line {u.line}</span> <code>{u.raw}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.skipped.length > 0 && (
              <details>
                <summary className="hint">{result.skipped.length} other line(s) skipped</summary>
                <ul>
                  {result.skipped.map((s) => (
                    <li key={s.line} className="hint">
                      line {s.line}: <code>{s.raw}</code> — {s.why}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <label className="inline-field">
              <span>Deck name</span>
              <input className="text-input" value={name || result.title || ''} onChange={(e) => setName(e.target.value)} placeholder={result.commanders[0] ?? 'Imported deck'} />
            </label>
            <div className="btn-row">
              {actions.map((a, i) => (
                <button key={a.label} type="button" className={i === 0 ? 'primary' : 'secondary'} disabled={!matched} onClick={() => a.run(result, (name || result.title || result.commanders[0] || 'Imported deck').trim(), source)}>
                  {a.label}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </dialog>
  );
}

/**
 * Whether the app is shown inside another page's frame. A frame usually can't start a download or write to the
 * clipboard, and neither failure is ever reported to the page — so what would do nothing there isn't offered.
 */
const framed = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

function ExportDialog({ deck, onClose }: { deck: Deck; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const text = deckToText(deck);
  // 'selected': the clipboard wasn't available, so the text is selected for the player to copy themselves.
  const [copied, setCopied] = useState<'no' | 'yes' | 'selected'>('no');
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deck.name.replace(/[^\w\- ]+/g, '').trim() || 'deck'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const select = () => {
    area.current?.focus();
    area.current?.select();
    setCopied('selected');
  };
  const copy = () => {
    if (!navigator.clipboard?.writeText) return select();
    void navigator.clipboard.writeText(text).then(() => setCopied('yes'), select);
  };
  return (
    <dialog ref={ref} className="sheet import-dialog" onClose={onClose} aria-labelledby="export-title">
      <div className="sheet-inner">
        <header className="sheet-head">
          <h2 id="export-title">Export “{deck.name}”</h2>
          <button type="button" className="ghost" onClick={() => ref.current?.close()}>
            Done
          </button>
        </header>
        <p className="hint">Plain text with sections. Moxfield, Archidekt and Arena all import it.</p>
        <textarea ref={area} className="paste" readOnly value={text} rows={14} aria-label="Deck as text" />
        <div className="btn-row">
          <button type="button" className="primary" onClick={copy}>
            {copied === 'yes' ? 'Copied' : 'Copy'}
          </button>
          {!framed && (
            <button type="button" className="secondary" onClick={download}>
              Download .txt
            </button>
          )}
        </div>
        <p className="hint" role="status">
          {copied === 'selected' ? 'The list is selected: press Ctrl+C (⌘C on a Mac) to copy it.' : ''}
        </p>
      </div>
    </dialog>
  );
}
