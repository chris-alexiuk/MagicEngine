import type { CardDef, Color } from '@mtg/schema';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AUTOMATION_LABEL, AutomationMark, CardImage, ManaCost, ManaSymbol } from '../components/bits';
import { CardDetail } from '../components/CardDetail';
import { compileQuery, sortCards } from '../search';
import { deckToText } from './exportDeck';
import { importText, type ImportResult } from './importDeck';
import { addCard, commanderProblem, deckCount, emptyDeck, pairProblem, validateDeck, type Deck, type DeckReport, type ProblemKind } from './model';
import type { CardIndex } from './names';
import { EXPORT_HELP, fetchDeckText, parseDeckUrl, RemoteImportError } from './remote';

const PAGE = 60;

const PROBLEM_LABEL: Record<ProblemKind, string> = {
  size: 'size',
  commander: 'commander',
  identity: 'off-color',
  singleton: 'too many copies',
  banned: 'banned',
  not_legal: 'not legal',
  unknown: 'unknown card',
};

const GROUPS: [string, (c: CardDef) => boolean][] = [
  ['Creatures', (c) => c.faces[0]!.types.includes('Creature')],
  ['Planeswalkers', (c) => c.faces[0]!.types.includes('Planeswalker')],
  ['Instants', (c) => c.faces[0]!.types.includes('Instant')],
  ['Sorceries', (c) => c.faces[0]!.types.includes('Sorcery')],
  ['Artifacts', (c) => c.faces[0]!.types.includes('Artifact')],
  ['Enchantments', (c) => c.faces[0]!.types.includes('Enchantment')],
  ['Battles', (c) => c.faces[0]!.types.includes('Battle')],
  ['Lands', (c) => c.faces[0]!.types.includes('Land')],
];

function Identity({ colors }: { colors: Color[] }) {
  if (!colors.length) return <ManaSymbol symbol="C" />;
  return (
    <span className="mana-cost">
      {colors.map((c) => (
        <ManaSymbol key={c} symbol={c} />
      ))}
    </span>
  );
}

function Coverage({ report }: { report: DeckReport }) {
  return (
    <span className="coverage">
      {(['full', 'partial', 'manual'] as const).map((l) => (
        <span key={l} title={`${AUTOMATION_LABEL[l]}: ${report.automation[l]} cards`}>
          <AutomationMark level={l} /> {report.automation[l]} {AUTOMATION_LABEL[l].toLowerCase()}
        </span>
      ))}
    </span>
  );
}

export function DecksView({ cards, index, decks, setDecks, deckId, go }: { cards: CardDef[]; index: CardIndex; decks: Deck[]; setDecks: (d: Deck[]) => void; deckId: string | null; go: (route: string) => void }) {
  const [importing, setImporting] = useState(false);
  const deck = deckId ? decks.find((d) => d.id === deckId) : undefined;
  const save = (d: Deck) => setDecks(decks.some((x) => x.id === d.id) ? decks.map((x) => (x.id === d.id ? { ...d, updatedAt: new Date().toISOString() } : x)) : [...decks, d]);

  if (deckId && deck) {
    return (
      <DeckEditor
        cards={cards}
        index={index}
        deck={deck}
        onChange={save}
        onDelete={() => {
          if (!window.confirm(`Delete “${deck.name}”?`)) return;
          setDecks(decks.filter((d) => d.id !== deck.id));
          go('#/decks');
        }}
        onBack={() => go('#/decks')}
        onPlay={() => go('#/play')}
      />
    );
  }
  return (
    <div className="page decks">
      <div className="page-head">
        <h2 className="page-title">Decks</h2>
        <div className="btn-row">
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
          <button type="button" className="secondary" onClick={() => setImporting(true)}>
            Import
          </button>
        </div>
      </div>
      {deckId && !deck && <p className="banner warn">That deck doesn’t exist any more.</p>}
      {decks.length === 0 ? (
        <p className="muted lede">No decks yet. Start a new one, or import a list from Moxfield, Archidekt, MTGO, Arena or plain text.</p>
      ) : (
        <ul className="deck-cards">
          {decks.map((d) => {
            const report = validateDeck(d, index.get);
            const cmd = d.commanders.map((n) => index.get(n)).filter((c): c is CardDef => Boolean(c));
            return (
              <li key={d.id}>
                <a className="deck-card" href={`#/decks/${d.id}`}>
                  <span className="deck-thumb">{cmd[0] ? <CardImage card={cmd[0]} sizes="96px" /> : <span className="card-back" />}</span>
                  <span className="deck-meta">
                    <strong>{d.name}</strong>
                    <span className="muted">{d.commanders.join(' & ') || 'No commander yet'}</span>
                    <span>
                      <Identity colors={report.identity} /> {report.total} cards
                    </span>
                    <span className={report.problems.length ? 'deck-status warn' : 'deck-status ok'}>{report.problems.length ? `${report.problems.length} problem${report.problems.length > 1 ? 's' : ''}` : 'Legal'}</span>
                    <Coverage report={report} />
                  </span>
                </a>
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
                const d: Deck = { ...emptyDeck(name), commanders: r.commanders.slice(0, 2), main: r.main, sideboard: r.sideboard, ...(source ? { source } : {}) };
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
// Editor
// ---------------------------------------------------------------------------

function DeckEditor({ cards, index, deck, onChange, onDelete, onBack, onPlay }: { cards: CardDef[]; index: CardIndex; deck: Deck; onChange: (d: Deck) => void; onDelete: () => void; onBack: () => void; onPlay: () => void }) {
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [fit, setFit] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  const [detail, setDetail] = useState<CardDef | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const report = useMemo(() => validateDeck(deck, index.get), [deck, index]);
  const compiled = useMemo(() => compileQuery(deferred), [deferred]);
  const choosingCommander = deck.commanders.length === 0;

  useEffect(() => setLimit(PAGE), [deferred, fit]);

  const results = useMemo(() => {
    const id = report.identity;
    const base = cards.filter((c) => {
      if (!compiled.test(c)) return false;
      if (choosingCommander) return commanderProblem(c) === null;
      return !fit || c.colorIdentity.every((x) => id.includes(x));
    });
    return sortCards(base, 'popularity');
  }, [cards, compiled, fit, report.identity, choosingCommander]);

  const set = (patch: Partial<Deck>) => onChange({ ...deck, ...patch });
  const add = (name: string, n = 1) => set({ main: addCard(deck.main, name, n) });
  const makeCommander = (c: CardDef) => {
    const main = deck.main.some((x) => x.name === c.name) ? addCard(deck.main, c.name, -1) : deck.main;
    set({ commanders: [...deck.commanders, c.name].slice(-2), main });
  };
  const dropCommander = (name: string) => set({ commanders: deck.commanders.filter((n) => n !== name) });
  const canCommand = (c: CardDef) => {
    if (deck.commanders.includes(c.name)) return false;
    if (deck.commanders.length === 0) return commanderProblem(c) === null;
    if (deck.commanders.length === 1) {
      const first = index.get(deck.commanders[0]!);
      return Boolean(first && pairProblem(first, c) === null);
    }
    return false;
  };

  const grouped = useMemo(() => {
    const out: { title: string; rows: { name: string; count: number; card?: CardDef }[] }[] = [];
    const rows = deck.main.map((e) => ({ ...e, card: index.get(e.name) })).sort((a, b) => (a.card?.cmc ?? 99) - (b.card?.cmc ?? 99) || a.name.localeCompare(b.name));
    const used = new Set<string>();
    for (const [title, test] of GROUPS) {
      const list = rows.filter((r) => r.card && !used.has(r.name) && test(r.card));
      list.forEach((r) => used.add(r.name));
      if (list.length) out.push({ title, rows: list });
    }
    const rest = rows.filter((r) => !used.has(r.name));
    if (rest.length) out.push({ title: 'Other', rows: rest });
    return out;
  }, [deck.main, index]);

  const countClass = report.total === 100 ? 'count ok' : 'count warn';
  const row = (name: string, count: number, card: CardDef | undefined, commander = false) => {
    const issues = report.byCard.get(name) ?? [];
    return (
      <li key={`${commander ? 'c' : 'm'}-${name}`} className={issues.length ? 'deck-row has-issue' : 'deck-row'}>
        {commander ? (
          <span className="crown" title="Commander">♛</span>
        ) : (
          <span className="stepper">
            <button type="button" className="step-btn" onClick={() => add(name, -1)} aria-label={`One fewer ${name}`}>
              −
            </button>
            <span className="row-count">{count}</span>
            <button type="button" className="step-btn" onClick={() => add(name, 1)} aria-label={`One more ${name}`}>
              +
            </button>
          </span>
        )}
        <button type="button" className="row-name" onClick={() => card && setDetail(card)} disabled={!card}>
          {name}
        </button>
        {card && <ManaCost cost={card.faces[0]!.manaCost} />}
        {card && (
          <span className="row-auto" title={AUTOMATION_LABEL[card.automation]}>
            <AutomationMark level={card.automation} />
          </span>
        )}
        {issues.map((k) => (
          <span key={k} className="issue">
            {PROBLEM_LABEL[k]}
          </span>
        ))}
        {card?.gameChanger && <span className="issue gc-tag" title="On the Commander Game Changers list">GC</span>}
        {commander ? (
          <button type="button" className="ghost tiny" onClick={() => dropCommander(name)}>
            Remove
          </button>
        ) : (
          card && canCommand(card) && (
            <button type="button" className="ghost tiny" onClick={() => makeCommander(card)} title="Make commander">
              ♛
            </button>
          )
        )}
      </li>
    );
  };

  return (
    <div className="editor">
      <section className="editor-search">
        <div className="editor-search-head">
          <button type="button" className="ghost tiny" onClick={onBack}>
            ← Decks
          </button>
          <button type="button" className="secondary tiny to-deck" onClick={() => document.getElementById('deck-list')?.scrollIntoView({ behavior: 'smooth' })}>
            Deck {report.total}/100 ↓
          </button>
          <input className="text-input grow" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={choosingCommander ? 'Search for a commander' : 'Search cards to add (try t:elf mv<=2)'} autoComplete="off" spellCheck={false} aria-label="Search cards" />
        </div>
        {compiled.errors.length > 0 && (
          <ul className="search-errors" role="status">
            {compiled.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <p className="tally">
          {choosingCommander ? 'Showing cards that can be your commander. ' : ''}
          {results.length.toLocaleString()} cards
          {!choosingCommander && (
            <label className="check small inline">
              <input type="checkbox" checked={fit} onChange={(e) => setFit(e.target.checked)} />
              only cards in the commander’s colors
            </label>
          )}
        </p>
        <ul className="grid editor-grid">
          {results.slice(0, limit).map((c) => {
            const inDeck = deck.main.find((x) => x.name === c.name)?.count ?? 0;
            return (
              <li key={c.id} className="add-tile">
                <button type="button" className="tile" onClick={() => setDetail(c)}>
                  <span className="tile-card">
                    <CardImage card={c} sizes="120px" />
                  </span>
                  <span className={`tile-caption cap-${c.automation}`}>
                    <AutomationMark level={c.automation} />
                    <span className="sr-only">{c.name}, </span>
                    {AUTOMATION_LABEL[c.automation]}
                    {inDeck > 0 && <span className="in-deck">· {inDeck} in deck</span>}
                  </span>
                </button>
                {choosingCommander ? (
                  <button type="button" className="secondary add-btn" onClick={() => makeCommander(c)}>
                    ♛ Commander
                  </button>
                ) : (
                  <button type="button" className="secondary add-btn" onClick={() => add(c.name)} aria-label={`Add ${c.name}`}>
                    + Add
                  </button>
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
      </section>

      <section className="editor-deck" id="deck-list" aria-label="Deck list">
        <div className="deck-head">
          <input className="deck-name" value={deck.name} onChange={(e) => set({ name: e.target.value })} aria-label="Deck name" />
          <div className="deck-stats">
            <span className={countClass}>
              {report.total}/100
            </span>
            <Identity colors={report.identity} />
            <Coverage report={report} />
            {report.gameChangers.length > 0 && <span className="muted" title={report.gameChangers.join(', ')}>{report.gameChangers.length} Game Changer{report.gameChangers.length > 1 ? 's' : ''}</span>}
          </div>
          <div className="btn-row">
            <button type="button" className="primary" onClick={onPlay}>
              Play
            </button>
            <button type="button" className="secondary" onClick={() => setImporting(true)}>
              Import
            </button>
            <button type="button" className="secondary" onClick={() => setExporting(true)}>
              Export
            </button>
            <button type="button" className="ghost danger" onClick={onDelete}>
              Delete
            </button>
          </div>
          {report.problems.length > 0 && (
            <ul className="problems">
              {report.problems.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="deck-groups">
          <h3 className="group-title">Commander{deck.commanders.length > 1 ? 's' : ''}</h3>
          <ul className="deck-rows">
            {deck.commanders.length === 0 && <li className="muted empty-row">Choose a commander from the search results.</li>}
            {deck.commanders.map((n) => row(n, 1, index.get(n), true))}
            {deck.commanders.length === 1 && <li className="muted empty-row small">A partner, “Partner with”, Background or Doctor’s companion can be added as a second commander (♛).</li>}
          </ul>
          {grouped.map((grp) => (
            <div key={grp.title}>
              <h3 className="group-title">
                {grp.title} <span className="muted">({grp.rows.reduce((n, r) => n + r.count, 0)})</span>
              </h3>
              <ul className="deck-rows">{grp.rows.map((r) => row(r.name, r.count, r.card))}</ul>
            </div>
          ))}
          {deck.sideboard.length > 0 && (
            <div>
              <h3 className="group-title">
                Sideboard / maybeboard <span className="muted">(not played)</span>
              </h3>
              <ul className="deck-rows">
                {deck.sideboard.map((c) => (
                  <li key={`s-${c.name}`} className="deck-row">
                    <span className="row-count">{c.count}</span>
                    <span className="row-name static">{c.name}</span>
                    <button type="button" className="ghost tiny" onClick={() => set({ sideboard: deck.sideboard.filter((x) => x.name !== c.name), main: addCard(deck.main, c.name, c.count) })}>
                      Move to deck
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {detail && (
        <CardDialog card={detail} onClose={() => setDetail(null)}>
          <div className="btn-row">
            {canCommand(detail) && (
              <button type="button" className="primary" onClick={() => { makeCommander(detail); setDetail(null); }}>
                ♛ {deck.commanders.length ? 'Add as second commander' : 'Make commander'}
              </button>
            )}
            {!deck.commanders.includes(detail.name) && (
              <button type="button" className="secondary" onClick={() => add(detail.name)}>
                + Add to deck ({deck.main.find((x) => x.name === detail.name)?.count ?? 0})
              </button>
            )}
            {deck.main.some((x) => x.name === detail.name) && (
              <button type="button" className="secondary" onClick={() => add(detail.name, -1)}>
                − Remove one
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
                onChange({ ...deck, commanders: r.commanders.slice(0, 2), main: r.main, sideboard: r.sideboard, ...(source ? { source } : {}) });
                setImporting(false);
              },
            },
            {
              label: 'Add to this deck',
              run: (r) => {
                let main = deck.main;
                for (const c of r.main) main = addCard(main, c.name, c.count);
                const commanders = deck.commanders.length ? deck.commanders : r.commanders.slice(0, 2);
                onChange({ ...deck, commanders, main });
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

function CardDialog({ card, onClose, children }: { card: CardDef; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} className="storage card-dialog" onClose={onClose} aria-label={card.name}>
      <div className="storage-inner">
        <header>
          <span />
          <button type="button" className="ghost" onClick={() => ref.current?.close()}>
            Close
          </button>
        </header>
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
    } catch (err) {
      const why = err instanceof RemoteImportError ? err.message : String(err);
      setRemote({ busy: false, message: `Couldn’t fetch the deck: ${why}`, help: EXPORT_HELP[where.site] });
    }
  };

  return (
    <dialog ref={ref} className="storage import-dialog" onClose={onClose} aria-labelledby="import-title">
      <div className="storage-inner">
        <header>
          <h2 id="import-title">Import a deck</h2>
          <button type="button" className="ghost" onClick={() => ref.current?.close()}>
            Cancel
          </button>
        </header>
        <section>
          <h3>From a link</h3>
          <div className="url-row">
            <input className="text-input grow" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.moxfield.com/decks/… or https://archidekt.com/decks/…" aria-label="Deck link" />
            <button type="button" className="secondary" onClick={() => void fetchUrl()} disabled={remote.busy || !url.trim()}>
              {remote.busy ? 'Fetching…' : 'Fetch'}
            </button>
          </div>
          {remote.message && <p className={remote.help ? 'hint warn' : 'hint'}>{remote.message}</p>}
          {remote.help && <p className="banner">{remote.help}</p>}
          <p className="hint">Deck sites often block requests from other web pages; pasting the exported text always works.</p>
        </section>
        <section>
          <h3>Paste a list</h3>
          <textarea
            className="paste"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            spellCheck={false}
            placeholder={'Commander\n1 Kinnan, Bonder Prodigy\n\nDeck\n1 Sol Ring (CMM) 400\n1x Arcane Signet\n…\n\nMoxfield, Archidekt, MTGO, Arena and plain text all work.'}
            aria-label="Deck list"
          />
        </section>
        {result && (
          <section className="import-result">
            <p>
              <strong>{matched}</strong> cards matched{result.commanders.length ? ` · commander: ${result.commanders.join(' & ')}` : ' · no commander found (choose one after importing)'}
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
              {actions.map((a) => (
                <button key={a.label} type="button" className="primary" disabled={!matched} onClick={() => a.run(result, (name || result.title || result.commanders[0] || 'Imported deck').trim(), source)}>
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

function ExportDialog({ deck, onClose }: { deck: Deck; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const text = deckToText(deck);
  const [copied, setCopied] = useState(false);
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
  return (
    <dialog ref={ref} className="storage import-dialog" onClose={onClose} aria-labelledby="export-title">
      <div className="storage-inner">
        <header>
          <h2 id="export-title">Export “{deck.name}”</h2>
          <button type="button" className="ghost" onClick={() => ref.current?.close()}>
            Done
          </button>
        </header>
        <p className="hint">Plain text with sections — Moxfield, Archidekt and Arena all import this.</p>
        <textarea className="paste" readOnly value={text} rows={14} aria-label="Deck as text" />
        <div className="btn-row">
          <button
            type="button"
            className="primary"
            onClick={() => {
              void navigator.clipboard?.writeText(text).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="secondary" onClick={download}>
            Download .txt
          </button>
        </div>
      </div>
    </dialog>
  );
}
