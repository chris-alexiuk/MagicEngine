import type { Automation, CardDef, Color } from '@mtg/schema';
import { COLORS } from '@mtg/schema';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AUTOMATION_LABEL, AutomationMark, CardImage, ManaSymbol } from './components/bits';
import { CardDetail } from './components/CardDetail';
import { StoragePanel } from './components/StoragePanel';
import { loadCardDB, type LoadedDB } from './db';
import { compileQuery, FILTER_HELP, sortCards, type SortKey } from './search';

const BASE = import.meta.env.BASE_URL;
const PAGE = 120;
const LEVELS: Automation[] = ['full', 'partial', 'manual'];
const COLOR_NAMES: Record<Color, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; loaded: LoadedDB };

export function App() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [identity, setIdentity] = useState<Color[]>([]);
  const [levels, setLevels] = useState<Automation[]>([]);
  const [sort, setSort] = useState<SortKey>('name');
  const [limit, setLimit] = useState(PAGE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [storageOpen, setStorageOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  // The detail panel sticks just below the header, whose height changes as filters wrap.
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const ro = new ResizeObserver(() =>
      document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`),
    );
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    loadCardDB(BASE)
      .then((loaded) => setLoad({ status: 'ready', loaded }))
      .catch((err: unknown) => setLoad({ status: 'error', message: err instanceof Error ? err.message : String(err) }));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => setLimit(PAGE), [deferredQuery, identity, levels, sort]);

  const cards = load.status === 'ready' ? load.loaded.db.cards : [];
  const compiled = useMemo(() => compileQuery(deferredQuery), [deferredQuery]);

  const { matches, counts } = useMemo(() => {
    const base = cards.filter(
      (c) => compiled.test(c) && (identity.length === 0 || c.colorIdentity.every((x) => identity.includes(x))),
    );
    const counts: Record<Automation, number> = { full: 0, partial: 0, manual: 0 };
    for (const c of base) counts[c.automation]++;
    const filtered = levels.length === 0 ? base : base.filter((c) => levels.includes(c.automation));
    return { matches: sortCards(filtered, sort), counts };
  }, [cards, compiled, identity, levels, sort]);

  const selected: CardDef | undefined = useMemo(
    () => (selectedId ? cards.find((c) => c.id === selectedId) : undefined),
    [cards, selectedId],
  );

  const toggle = <T,>(list: T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  return (
    <div className="app">
      <header className="top" ref={headerRef}>
        <h1 className="brand">MagicEngine</h1>
        <div className="search">
          <label htmlFor="q" className="sr-only">
            Search cards
          </label>
          <input
            id="q"
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, or try t:elf id:ug mv<=2"
            autoComplete="off"
            spellCheck={false}
          />
          {compiled.errors.length > 0 && (
            <ul className="search-errors" role="status">
              {compiled.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" className="ghost storage-btn" onClick={() => setStorageOpen(true)}>
          Storage
        </button>

        <div className="filters">
          <fieldset className="identity">
            <legend>Color identity</legend>
            {COLORS.map((c) => (
              <label key={c} className={identity.includes(c) ? 'pip-toggle on' : 'pip-toggle'} title={COLOR_NAMES[c]}>
                <input type="checkbox" checked={identity.includes(c)} onChange={() => setIdentity(toggle(identity, c))} />
                <ManaSymbol symbol={c} />
                <span className="sr-only">{COLOR_NAMES[c]}</span>
              </label>
            ))}
          </fieldset>

          <fieldset className="levels">
            <legend>Engine</legend>
            {LEVELS.map((l) => (
              <label key={l} className={levels.includes(l) ? 'level on' : 'level'}>
                <input type="checkbox" checked={levels.includes(l)} onChange={() => setLevels(toggle(levels, l))} />
                <AutomationMark level={l} />
                {AUTOMATION_LABEL[l]}
                <span className="count">{counts[l].toLocaleString()}</span>
              </label>
            ))}
          </fieldset>

          <label className="sort">
            <span>Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="name">Name</option>
              <option value="popularity">Popularity in Commander</option>
              <option value="mv">Mana value</option>
            </select>
          </label>

          <details className="guide">
            <summary>Search guide</summary>
            <dl>
              {FILTER_HELP.map(([example, meaning]) => (
                <div key={example}>
                  <dt>
                    <code>{example}</code>
                  </dt>
                  <dd>{meaning}</dd>
                </div>
              ))}
            </dl>
          </details>
        </div>
      </header>

      <main className={selected ? 'layout has-detail' : 'layout'}>
        <section className="results" aria-live="polite">
          {load.status === 'loading' && <p className="state">Loading card data…</p>}
          {load.status === 'error' && (
            <div className="state error">
              <p>{load.message}</p>
              <p>
                Build the card data first: <code>pnpm cards:fixture</code> for the small sample, or{' '}
                <code>pnpm cards:build</code> for every card. Then reload.
              </p>
            </div>
          )}
          {load.status === 'ready' && (
            <>
              <p className="tally">
                {matches.length === cards.length
                  ? `${cards.length.toLocaleString()} cards`
                  : `${matches.length.toLocaleString()} of ${cards.length.toLocaleString()} cards`}
              </p>
              {matches.length === 0 ? (
                <p className="state">No cards match. Remove a filter or check the search guide.</p>
              ) : (
                <ul className="grid">
                  {matches.slice(0, limit).map((card) => (
                    <li key={card.id}>
                      <button
                        type="button"
                        className={card.id === selectedId ? 'tile selected' : 'tile'}
                        onClick={() => setSelectedId(card.id)}
                        aria-pressed={card.id === selectedId}
                      >
                        <span className="tile-card">
                          <CardImage card={card} sizes="146px" />
                        </span>
                        <span className={`tile-caption cap-${card.automation}`}>
                          <AutomationMark level={card.automation} />
                          <span className="sr-only">{card.name}, </span>
                          {AUTOMATION_LABEL[card.automation]}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {matches.length > limit && (
                <button type="button" className="secondary more" onClick={() => setLimit(limit + PAGE)}>
                  Show {Math.min(PAGE, matches.length - limit)} more
                </button>
              )}
            </>
          )}
        </section>

        <aside className="side">
          {selected ? (
            <CardDetail card={selected} onClose={() => setSelectedId(null)} />
          ) : (
            <div className="side-empty">
              <p>Select a card to see how the engine reads it.</p>
              <p className="muted">
                Each rules line is marked as something the engine runs or something you resolve by hand during a game.
              </p>
            </div>
          )}
        </aside>
      </main>

      <StoragePanel
        open={storageOpen}
        onClose={() => setStorageOpen(false)}
        meta={load.status === 'ready' ? load.loaded.meta : null}
      />
    </div>
  );
}
