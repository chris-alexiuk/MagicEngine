import type { CardDB, CardDef } from '@mtg/schema';
import { useEffect, useMemo, useState } from 'react';
import { CardView } from '../components/Card';
import { Identity } from '../deck/bits';
import { deckCount, validateDeck, type Deck } from '../deck/model';
import { narrate, type LogLine } from './log';
import { cardsFor, clearSavedGame, dummySeat, loadSavedGame, modeOf, replay, saveGame, seatFromDeck, type GameSetup, type Mode } from './session';
import { nextLogId, startLive, Table, type Live } from './Table';
import { setSeatSkins } from '../skins';

const SEAT_IDS = ['p1', 'p2', 'p3', 'p4'];
const MODE_KEY = 'mtg-play-mode';

const MODES: { id: Mode; title: string; text: string }[] = [
  { id: 'solo', title: 'Solo playtest', text: 'Your deck against a practice dummy that never acts. Its turn comes around too, so you can act in it. Undo any decision.' },
  { id: 'open', title: 'Open hands', text: 'You play every seat with every hand face up. The table turns to whoever decides.' },
  { id: 'hotseat', title: 'Pass the device', text: '2–4 players share the screen, and each sees only their own hand.' },
];

export function PlayView({ db, decks, lookup, onEditDeck, toolsEl, playtest, clearPlaytest }: { db: CardDB; decks: Deck[]; lookup: (name: string) => CardDef | undefined; onEditDeck: (id: string) => void; toolsEl: HTMLElement | null; playtest: string | null; clearPlaytest: () => void }) {
  const [live, setLive] = useState<Live | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const saved = useMemo(() => (live ? null : loadSavedGame()), [live]);
  const dummyLand = lookup('Wastes') ? 'Wastes' : 'Plains';

  /** What each seat's cards are drawn with (the printings its deck asked for). */
  const dress = (setup: GameSetup) => setSeatSkins(Object.fromEntries(setup.seats.map((s) => [s.id, s.skins ?? {}])));
  const start = (setup: GameSetup) => {
    try {
      const cards = cardsFor(setup.seats, db, lookup);
      dress(setup);
      const l = startLive(setup, cards);
      setLive(l);
      saveGame({ setup, actions: l.actions, marks: [], savedAt: new Date().toISOString() });
      setNotice(null);
      try {
        localStorage.setItem(MODE_KEY, modeOf(setup));
      } catch {
        /* not remembered */
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  // "Playtest" from a deck: straight into a solo game.
  useEffect(() => {
    if (!playtest) return;
    const deck = decks.find((d) => d.id === playtest);
    clearPlaytest();
    if (deck) start({ seats: [seatFromDeck('p1', 'You', deck, lookup), dummySeat('p2', dummyLand)], seed: Math.floor(Math.random() * 2 ** 31), firstPlayer: 'p1', mode: 'solo' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playtest]);

  const resume = () => {
    if (!saved) return;
    try {
      const cards = cardsFor(saved.setup.seats, db, lookup);
      dress(saved.setup);
      const log: LogLine[] = [];
      const state = replay(saved, cards, (before, after, events) => log.push(...narrate(before, after, events, nextLogId)));
      if (!state) {
        setNotice('That saved game no longer replays with this version of the engine or card data, so it was discarded.');
        clearSavedGame();
        return;
      }
      setLive({ setup: saved.setup, cards, state, actions: saved.actions, marks: saved.marks ?? [], log, history: [] });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  if (!live) return <Setup decks={decks} lookup={lookup} onStart={start} saved={saved} onResume={resume} notice={notice} onEditDeck={onEditDeck} dummyLand={dummyLand} />;
  return <Table live={live} setLive={setLive} onLeave={() => setLive(null)} toolsEl={toolsEl} />;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function Setup({ decks, lookup, onStart, saved, onResume, notice, onEditDeck, dummyLand }: { decks: Deck[]; lookup: (n: string) => CardDef | undefined; onStart: (s: GameSetup) => void; saved: ReturnType<typeof loadSavedGame>; onResume: () => void; notice: string | null; onEditDeck: (id: string) => void; dummyLand: string }) {
  const [mode, setMode] = useState<Mode>(() => {
    if (decks.length <= 1) return 'solo';
    try {
      const m = localStorage.getItem(MODE_KEY);
      if (m === 'solo' || m === 'open' || m === 'hotseat') return m;
    } catch {
      /* default */
    }
    return 'solo';
  });
  const [count, setCount] = useState(2);
  const [names, setNames] = useState(['Player 1', 'Player 2', 'Player 3', 'Player 4']);
  const [picks, setPicks] = useState<string[]>(() => SEAT_IDS.map((_, i) => decks[i % Math.max(1, decks.length)]?.id ?? ''));
  const [first, setFirst] = useState<string>('random');
  const reports = useMemo(() => new Map(decks.map((d) => [d.id, validateDeck(d, lookup)])), [decks, lookup]);
  const seats = mode === 'solo' ? 1 : count;
  const ready = SEAT_IDS.slice(0, seats).every((_, i) => decks.some((d) => d.id === picks[i]));

  const go = () => {
    const seed = Math.floor(Math.random() * 2 ** 31);
    if (mode === 'solo') {
      const deck = decks.find((d) => d.id === picks[0])!;
      onStart({ seats: [seatFromDeck('p1', 'You', deck, lookup), dummySeat('p2', dummyLand)], seed, mode, ...(first === 'random' ? {} : { firstPlayer: first === 'p2' ? 'p2' : 'p1' }) });
      return;
    }
    const list = SEAT_IDS.slice(0, count).map((id, i) => seatFromDeck(id, names[i]!.trim() || `Player ${i + 1}`, decks.find((d) => d.id === picks[i])!, lookup));
    onStart({ seats: list, seed, mode, ...(first !== 'random' ? { firstPlayer: first } : {}) });
  };

  const deckRow = (i: number, label: string) => {
    const deck = decks.find((d) => d.id === picks[i]);
    const report = deck ? reports.get(deck.id) : undefined;
    const commander = deck?.commanders[0] ? lookup(deck.commanders[0]) : undefined;
    return (
      <li key={i} className="seat-row">
        <span className="seat-thumb">{commander ? <CardView card={commander} sizes="64px" /> : <span className="seat-thumb-empty" />}</span>
        <span className="seat-fields">
          {mode === 'solo' ? (
            <span className="seat-label">{label}</span>
          ) : (
            <input className="text-input" value={names[i]} onChange={(e) => setNames(names.map((n, j) => (j === i ? e.target.value : n)))} aria-label={`Player ${i + 1} name`} />
          )}
          <select className="text-input" value={picks[i]} onChange={(e) => setPicks(picks.map((p, j) => (j === i ? e.target.value : p)))} aria-label={`${label} deck`}>
            <option value="">Choose a deck…</option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({deckCount(d)})
              </option>
            ))}
          </select>
          {report && deck && (
            <span className={report.problems.length ? 'deck-status warn' : 'deck-status ok'}>
              <Identity colors={report.identity} />
              {report.problems.length ? `${report.problems.length} deck problem${report.problems.length > 1 ? 's' : ''}` : 'Legal'}
              {report.problems.length > 0 && (
                <button type="button" className="linkish" onClick={() => onEditDeck(deck.id)}>
                  Fix
                </button>
              )}
            </span>
          )}
        </span>
      </li>
    );
  };

  return (
    <div className="page setup">
      <h2 className="page-title">Play</h2>
      {notice && <p className="banner warn">{notice}</p>}
      {saved && (
        <div className="banner resume">
          <span>
            Saved {modeOf(saved.setup) === 'solo' ? 'playtest' : 'game'} from {new Date(saved.savedAt).toLocaleString()}: {saved.setup.seats.map((s) => s.name).join(' vs ')}.
          </span>
          <button type="button" className="primary" onClick={onResume}>
            Resume
          </button>
        </div>
      )}
      {decks.length === 0 ? (
        <p className="banner">You don’t have any decks yet. Build or import one under Decks first.</p>
      ) : (
        <>
          <div className="mode-cards" role="radiogroup" aria-label="Kind of game">
            {MODES.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={`mode-card${mode === m.id ? ' on' : ''}`} onClick={() => setMode(m.id)}>
                <strong>{m.title}</strong>
                <span>{m.text}</span>
              </button>
            ))}
          </div>
          {mode !== 'solo' && (
            <div className="seg-group" role="radiogroup" aria-label="Players">
              <span className="seg-label">Players</span>
              {[2, 3, 4].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={count === n} className={count === n ? 'seg active' : 'seg'} onClick={() => setCount(n)}>
                  {n}
                </button>
              ))}
            </div>
          )}
          <ol className="seat-setup">
            {mode === 'solo' ? (
              <>
                {deckRow(0, 'Your deck')}
                <li className="seat-row dummy">
                  <span className="seat-thumb">
                    <span className="seat-thumb-empty" />
                  </span>
                  <span className="seat-fields">
                    <span className="seat-label">Practice dummy</span>
                    <span className="muted">100 {dummyLand}. It never plays, blocks or responds; attack it to see damage land.</span>
                  </span>
                </li>
              </>
            ) : (
              SEAT_IDS.slice(0, count).map((_, i) => deckRow(i, names[i] ?? `Player ${i + 1}`))
            )}
          </ol>
          <label className="inline-field">
            <span>Who goes first</span>
            <select className="text-input" value={first} onChange={(e) => setFirst(e.target.value)}>
              <option value="random">Random</option>
              {mode === 'solo' ? (
                <>
                  <option value="p1">You</option>
                  <option value="p2">The dummy</option>
                </>
              ) : (
                SEAT_IDS.slice(0, count).map((id, i) => (
                  <option key={id} value={id}>
                    {names[i]}
                  </option>
                ))
              )}
            </select>
          </label>
          <button type="button" className="primary big start" disabled={!ready} onClick={go}>
            Start game
          </button>
          <p className="hint">Decks with problems can still be played; the engine plays whatever is in them.</p>
        </>
      )}
    </div>
  );
}
