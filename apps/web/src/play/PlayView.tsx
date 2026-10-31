import type { CardDB, CardDef } from '@mtg/schema';
import { annotateOracle } from '@mtg/schema';
import { chars, legalActions, STEPS, viewFor, withCharsCache, type Action, type Characteristics, type ChoiceAnswer, type GameState, type PlayerId, type Step } from '@mtg/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AUTOMATION_LABEL, AutomationMark, CardImage, RulesText } from '../components/bits';
import { deckCount, validateDeck, type Deck } from '../deck/model';
import { cardClass, Seat, type BoardHandlers } from './Board';
import { Actions, ActionBarSlot } from './actionbar';
import { shownCard, TableCard } from './cards';
import { ActionFlow, CHOICE_TITLE, ChoicePanel, needsChoices, ObjectTile } from './Choices';
import { actionLabel, actionObject, targetLabel } from './labels';
import { narrate, publicName, STEP_NAME, type LogLine } from './log';
import type { Pick } from './pick';
import { extraCasts } from './probes';
import {
  cardsFor,
  clearSavedGame,
  decider,
  DEFAULT_STOPS,
  loadSavedGame,
  newGame,
  replay,
  saveGame,
  seatFromDeck,
  step,
  type GameSetup,
  type Stops,
} from './session';

type Choosing = Extract<Action, { type: 'cast' | 'activate' }>;

interface Live {
  setup: GameSetup;
  cards: Record<string, CardDef>;
  state: GameState;
  actions: Action[];
  log: LogLine[];
}

const SEAT_IDS = ['p1', 'p2', 'p3', 'p4'];

let logId = 0;
const nextLogId = () => ++logId;

export function PlayView({ db, decks, lookup, onEditDeck }: { db: CardDB; decks: Deck[]; lookup: (name: string) => CardDef | undefined; onEditDeck: (id: string) => void }) {
  const [live, setLive] = useState<Live | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const saved = useMemo(() => (live ? null : loadSavedGame()), [live]);

  const start = (setup: GameSetup) => {
    try {
      const cards = cardsFor(setup.seats, db, lookup);
      const { state, events } = newGame(setup, cards);
      const log = narrate(state, state, events, nextLogId);
      setLive({ setup, cards, state, actions: [], log });
      saveGame({ setup, actions: [], savedAt: new Date().toISOString() });
      setNotice(null);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const resume = () => {
    if (!saved) return;
    try {
      const cards = cardsFor(saved.setup.seats, db, lookup);
      const log: LogLine[] = [];
      const state = replay(saved, cards, (before, after, events) => log.push(...narrate(before, after, events, nextLogId)));
      if (!state) {
        setNotice('That saved game no longer replays with this version of the engine or card data, so it was discarded.');
        clearSavedGame();
        return;
      }
      setLive({ setup: saved.setup, cards, state, actions: saved.actions, log });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  if (!live) return <Setup decks={decks} lookup={lookup} onStart={start} saved={saved} onResume={resume} notice={notice} onEditDeck={onEditDeck} />;
  return <Table live={live} setLive={setLive} onLeave={() => setLive(null)} />;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function Setup({ decks, lookup, onStart, saved, onResume, notice, onEditDeck }: { decks: Deck[]; lookup: (n: string) => CardDef | undefined; onStart: (s: GameSetup) => void; saved: ReturnType<typeof loadSavedGame>; onResume: () => void; notice: string | null; onEditDeck: (id: string) => void }) {
  const [count, setCount] = useState(2);
  const [names, setNames] = useState(['Player 1', 'Player 2', 'Player 3', 'Player 4']);
  const [picks, setPicks] = useState<string[]>(() => SEAT_IDS.map((_, i) => decks[i % Math.max(1, decks.length)]?.id ?? ''));
  const [first, setFirst] = useState<string>('random');
  const reports = useMemo(() => new Map(decks.map((d) => [d.id, validateDeck(d, lookup)])), [decks, lookup]);
  const ready = SEAT_IDS.slice(0, count).every((_, i) => decks.some((d) => d.id === picks[i]));

  const go = () => {
    const seats = SEAT_IDS.slice(0, count).map((id, i) => seatFromDeck(id, names[i]!.trim() || `Player ${i + 1}`, decks.find((d) => d.id === picks[i])!));
    onStart({ seats, seed: Math.floor(Math.random() * 2 ** 31), ...(first !== 'random' ? { firstPlayer: first } : {}) });
  };

  return (
    <div className="page setup">
      <h2 className="page-title">New game</h2>
      <p className="muted lede">Same-screen Commander for 2–4 players. Pass the device when the table asks; each player sees only their own hand.</p>
      {notice && <p className="banner warn">{notice}</p>}
      {saved && (
        <div className="banner">
          <span>
            A game from {new Date(saved.savedAt).toLocaleString()} is saved ({saved.setup.seats.map((s) => s.name).join(', ')}, {saved.actions.length} actions).
          </span>
          <button type="button" className="primary" onClick={onResume}>
            Resume it
          </button>
        </div>
      )}
      {decks.length === 0 ? (
        <p className="banner">You don’t have any decks yet. Build or import one under Decks first.</p>
      ) : (
        <>
          <fieldset className="seg-group">
            <legend>Players</legend>
            {[2, 3, 4].map((n) => (
              <label key={n} className={count === n ? 'seg active' : 'seg'}>
                <input type="radio" name="count" checked={count === n} onChange={() => setCount(n)} />
                {n}
              </label>
            ))}
          </fieldset>
          <ol className="seat-setup">
            {SEAT_IDS.slice(0, count).map((id, i) => {
              const deck = decks.find((d) => d.id === picks[i]);
              const report = deck ? reports.get(deck.id) : undefined;
              return (
                <li key={id}>
                  <input className="text-input" value={names[i]} onChange={(e) => setNames(names.map((n, j) => (j === i ? e.target.value : n)))} aria-label={`Player ${i + 1} name`} />
                  <select className="text-input" value={picks[i]} onChange={(e) => setPicks(picks.map((p, j) => (j === i ? e.target.value : p)))} aria-label={`Player ${i + 1} deck`}>
                    <option value="">Choose a deck…</option>
                    {decks.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({deckCount(d)} cards)
                      </option>
                    ))}
                  </select>
                  {report && (
                    <span className={report.problems.length ? 'deck-status warn' : 'deck-status ok'}>
                      {report.problems.length ? `${report.problems.length} deck problem${report.problems.length > 1 ? 's' : ''}` : 'Legal'}
                      {' · '}
                      {report.automation.full} automatic, {report.automation.partial} partial, {report.automation.manual} manual
                      {report.problems.length > 0 && (
                        <button type="button" className="linkish" onClick={() => onEditDeck(deck!.id)}>
                          fix
                        </button>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          <label className="inline-field">
            <span>Who goes first</span>
            <select className="text-input" value={first} onChange={(e) => setFirst(e.target.value)}>
              <option value="random">Random</option>
              {SEAT_IDS.slice(0, count).map((id, i) => (
                <option key={id} value={id}>
                  {names[i]}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">Decks with problems can still be played; the engine plays whatever is in them.</p>
          <button type="button" className="primary big" disabled={!ready} onClick={go}>
            Start game
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

function useStops(seats: PlayerId[]) {
  const [stops, setStops] = useState<Record<PlayerId, Stops>>(() => {
    let stored: Record<string, Stops> = {};
    try {
      stored = JSON.parse(localStorage.getItem('mtg-stops-v1') ?? '{}') as Record<string, Stops>;
    } catch {
      stored = {};
    }
    return Object.fromEntries(seats.map((p) => [p, { ...DEFAULT_STOPS, ...(stored[p] ?? {}) }]));
  });
  const update = (p: PlayerId, s: Stops) => {
    const next = { ...stops, [p]: s };
    setStops(next);
    try {
      localStorage.setItem('mtg-stops-v1', JSON.stringify(next));
    } catch {
      /* not remembered */
    }
  };
  return [stops, update] as const;
}

function Table({ live, setLive, onLeave }: { live: Live; setLive: (l: Live) => void; onLeave: () => void }) {
  const g = live.state;
  const [stops, setStop] = useStops(g.order);
  const [holder, setHolder] = useState<PlayerId | null>(null);
  const [passUntil, setPassUntil] = useState<{ player: PlayerId; turn: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [flow, setFlow] = useState<Choosing | null>(null);
  const [pick, setPickState] = useState<Pick | null>(null);
  const [error, setError] = useState<{ text: string; bug: boolean } | null>(null);
  const [hover, setHover] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [zone, setZone] = useState<{ player: PlayerId; zone: 'graveyard' | 'exile' } | null>(null);
  const [showStops, setShowStops] = useState(false);
  const setPick = useCallback((p: Pick | null) => setPickState(p), []);

  const who = decider(g);
  const curtained = Boolean(who && holder !== who);
  const viewer = curtained ? null : holder;
  // The seat shown at the bottom: whoever has the device (or is about to).
  const seat = viewer ?? who ?? g.order[0]!;
  const view = useMemo(() => viewFor(g, seat), [g, seat]);

  const legal = useMemo(() => (viewer && g.priority === viewer && !g.pending ? legalActions(g, viewer) : []), [g, viewer]);
  const byObject = useMemo(() => {
    const m = new Map<string, Action[]>();
    for (const a of legal) {
      const id = actionObject(a);
      if (id) m.set(id, [...(m.get(id) ?? []), a]);
    }
    return m;
  }, [legal]);
  const actionable = useMemo(() => new Set(byObject.keys()), [byObject]);
  const manaOnly = useMemo(() => new Set([...byObject].filter(([, list]) => list.every((a) => a.type === 'activate_mana')).map(([id]) => id)), [byObject]);
  // One layers pass for the whole battlefield per state (lookups share the engine's cache).
  const charMap = useMemo(() => withCharsCache(() => new Map<string, Characteristics>(g.zones.battlefield.map((id) => [id, chars(g, g.objects[id]!)]))), [g]);
  // For debugging from the console (and the UI tests): the state on screen and what the engine allows.
  useEffect(() => {
    (window as unknown as { magicEngine?: unknown }).magicEngine = { state: g, viewer, legal };
  }, [g, viewer, legal]);
  const extra = useMemo(() => (selected && viewer && g.priority === viewer && !g.pending ? extraCasts(g, viewer, selected, byObject.get(selected) ?? []) : []), [g, selected, viewer, byObject]);

  const act = (action: Action, fromList = true): boolean => {
    const r = step(g, action, stops, passUntil);
    if (!r.ok) {
      // An action the engine listed (or a pending choice's answer) shouldn't be refused: that's an engine bug.
      console.error('MagicEngine: the engine refused an action.', JSON.stringify(action), r.error);
      setError({ text: r.error, bug: fromList });
      return false;
    }
    const lines = r.applied.steps.flatMap((s) => narrate(s.before, s.after, s.events, nextLogId));
    const actions = [...live.actions, ...r.applied.steps.map((s) => s.action)];
    setLive({ ...live, state: r.applied.state, actions, log: [...live.log, ...lines].slice(-800) });
    saveGame({ setup: live.setup, actions, savedAt: new Date().toISOString() });
    setError(null);
    setFlow(null);
    setSelected(null);
    setPickState(null);
    if (passUntil && r.applied.state.turn !== passUntil.turn) setPassUntil(null);
    return true;
  };
  const answer = (a: ChoiceAnswer) => viewer && act({ type: 'choose', player: viewer, answer: a });

  // A new decision for someone else: drop what this seat was doing.
  useEffect(() => {
    if (curtained) {
      setFlow(null);
      setSelected(null);
      setPickState(null);
    }
  }, [curtained]);

  const choose = (a: Action) => {
    setError(null);
    if (needsChoices(g, a)) setFlow(a as Choosing);
    else act(a);
  };

  // The stack entry in focus (hovered, else the top): what it targets is highlighted on the table.
  const [stackFocus, setStackFocus] = useState<number | null>(null);
  const targeted = useMemo(() => {
    const e = g.stack[stackFocus ?? g.stack.length - 1];
    return new Set((e?.targets ?? []).flat().flatMap((t) => (t.kind === 'object' ? [t.id] : t.kind === 'player' ? [t.player] : [])));
  }, [g, stackFocus]);
  const [barEl, setBarEl] = useState<HTMLElement | null>(null);

  const h: BoardHandlers = {
    pick: curtained ? null : pick,
    selected,
    actionable: flow || g.pending ? new Set() : actionable,
    manaOnly,
    targeted,
    onCard: (id) => {
      if (pick?.objects.has(id)) pick.onPick({ kind: 'object', object: id });
      else if (!pick || (!flow && !g.pending)) setSelected(selected === id ? null : id);
    },
    onPlayer: (p) => pick?.players.has(p) && pick.onPick({ kind: 'player', player: p }),
    onHover: (id, el) => setHover(id && el ? { id, rect: el.getBoundingClientRect() } : null),
    onZone: (player, z) => setZone({ player, zone: z }),
    chars: (id) => charMap.get(id) ?? chars(g, g.objects[id]!),
  };

  const others = (() => {
    const i = g.order.indexOf(seat);
    return [...g.order.slice(i + 1), ...g.order.slice(0, i)];
  })();
  const pendingMine = viewer && g.pending && g.pending.player === viewer ? (view.pending as typeof g.pending) : null;
  const myPriority = Boolean(viewer && g.priority === viewer && !g.pending);
  const top = g.stack[g.stack.length - 1];
  const endTurn = () => {
    setPassUntil({ player: viewer!, turn: g.turn });
    const r = step(g, { type: 'pass', player: viewer! }, stops, { player: viewer!, turn: g.turn });
    if (r.ok) {
      const lines = r.applied.steps.flatMap((s) => narrate(s.before, s.after, s.events, nextLogId));
      const actions = [...live.actions, ...r.applied.steps.map((s) => s.action)];
      setLive({ ...live, state: r.applied.state, actions, log: [...live.log, ...lines].slice(-800) });
      saveGame({ setup: live.setup, actions, savedAt: new Date().toISOString() });
      setSelected(null);
    } else setError({ text: r.error, bug: true });
  };
  const choicePanel = pendingMine ? (
    <ChoicePanel key={JSON.stringify(pendingMine).length + pendingMine.kind + live.actions.length} g={g} view={view} pending={pendingMine} me={viewer!} answer={answer} act={(a) => act(a)} setPick={setPick} />
  ) : null;
  // Damage assignment is a step of its own: it opens over the table, like a client's damage prompt.
  const overlayChoice = pendingMine?.kind === 'assign_combat_damage';

  return (
    <ActionBarSlot.Provider value={barEl}>
      <div className={`play seats-${g.order.length}`}>
        <PhaseStrip g={g} who={who} />
        <div className="table">
          <div className={`opponents n${others.length}`}>
            {others.map((p) => (
              <Seat key={p} g={g} view={view} player={p} h={h} me={false} deciding={who === p} />
            ))}
          </div>
          <StackBand g={g} view={view} pick={curtained ? null : pick} onFocus={setStackFocus} onHover={h.onHover} />
          <Seat g={g} view={view} player={seat} h={h} me={!curtained} deciding={who === seat} />
          {hover && !curtained && <HoverPreview view={view} id={hover.id} rect={hover.rect} />}
          {overlayChoice && choicePanel && (
            <div className="overlay" role="dialog" aria-label="Assign combat damage">
              <div className="overlay-panel">{choicePanel}</div>
            </div>
          )}
        </div>

        <aside className="play-side" aria-label="Game controls">
          <LogBox log={live.log} viewer={viewer} />
          <div className="prompt" aria-live="polite">
            {error && (
              <div className="banner warn">
                <strong>{error.bug ? 'The engine refused an action it offered.' : 'That isn’t allowed.'}</strong> {error.text}
                {error.bug && <span className="hint"> (Logged to the console with the action — that’s an engine bug.)</span>}
              </div>
            )}
            {g.over ? (
              <div className="flow-step">
                <p className="flow-title">{g.winner ? `${g.players[g.winner]!.name} wins!` : 'The game is a draw.'}</p>
                <Actions>
                  <button type="button" className="primary" onClick={() => { clearSavedGame(); onLeave(); }}>
                    New game
                  </button>
                </Actions>
              </div>
            ) : curtained ? (
              <p className="hint">Waiting for {g.players[who!]!.name}.</p>
            ) : pendingMine ? (
              <>
                <p className="prompt-kind">{CHOICE_TITLE[pendingMine.kind] ?? pendingMine.kind}</p>
                {overlayChoice ? <p className="hint">Assign combat damage in the panel over the table.</p> : choicePanel}
              </>
            ) : flow ? (
              <ActionFlow key={JSON.stringify(flow)} g={g} view={view} action={flow} setPick={setPick} onCommit={(a) => act(a, false)} onCancel={() => { setFlow(null); setPickState(null); }} />
            ) : myPriority ? (
              <SelectedPanel g={g} view={view} id={selected} actions={selected ? (byObject.get(selected) ?? []) : []} extra={extra} onChoose={choose} />
            ) : null}
          </div>
          {myPriority && !flow && (
            <Actions hint={top ? `${top.kind === 'spell' ? publicName(top.object, g) : `${top.sourceName}’s ability`} is on the stack` : null}>
              <button type="button" className="primary pass" onClick={() => act({ type: 'pass', player: viewer! })}>
                {top ? `Resolve ${top.kind === 'spell' ? publicName(top.object, g).split(' // ')[0] : 'ability'}` : g.active === viewer ? `Pass to ${nextStepName(g.step)}` : 'Pass'}
              </button>
              <button type="button" className="secondary" title="Pass priority until the turn ends, unless an opponent casts or activates something" onClick={endTurn}>
                {g.active === viewer ? 'End turn' : 'Pass the turn'}
              </button>
              <button type="button" className="ghost" onClick={() => setShowStops(!showStops)} aria-expanded={showStops}>
                Stops
              </button>
            </Actions>
          )}
          <div className="action-bar" ref={setBarEl} aria-label="Actions" />
          {showStops && viewer && <StopsEditor stops={stops[viewer] ?? DEFAULT_STOPS} onChange={(s) => setStop(viewer, s)} name={g.players[viewer]!.name} />}
          <div className="side-foot">
            <button type="button" className="ghost tiny" onClick={onLeave}>
              Leave table (game is saved)
            </button>
            {viewer && !g.over && (
              <button
                type="button"
                className="ghost tiny danger"
                onClick={() => {
                  if (window.confirm(`Concede the game for ${g.players[viewer]!.name}?`)) act({ type: 'concede', player: viewer });
                }}
              >
                Concede
              </button>
            )}
          </div>
        </aside>

        {curtained && who && <Curtain g={g} who={who} log={live.log} onReady={() => setHolder(who)} />}
        {zone && <ZoneDialog g={g} view={view} player={zone.player} zone={zone.zone} h={h} onClose={() => setZone(null)} />}
      </div>
    </ActionBarSlot.Provider>
  );
}

function nextStepName(s: Step): string {
  const i = STEPS.indexOf(s);
  const next = STEPS[i + 1];
  return next ? STEP_NAME[next].toLowerCase() : 'the next turn';
}

/** The turn structure along the top edge: whose turn, the current step, and who is deciding. */
function PhaseStrip({ g, who }: { g: GameState; who: PlayerId | null }) {
  const name = (p: PlayerId) => g.players[p]?.name ?? p;
  const shown: [Step, string][] = [
    ['upkeep', 'Upkeep'],
    ['draw', 'Draw'],
    ['main1', 'Main 1'],
    ['beginning_of_combat', 'Combat'],
    ['declare_attackers', 'Attackers'],
    ['declare_blockers', 'Blockers'],
    ['combat_damage', 'Damage'],
    ['end_of_combat', 'End combat'],
    ['main2', 'Main 2'],
    ['end', 'End'],
  ];
  return (
    <div className="phase-strip" aria-label="Turn structure">
      <span className="turn-title">{g.started ? `Turn ${g.turn} · ${name(g.active)}` : 'Opening hands'}</span>
      {g.started && (
        <ol className="steps">
          {shown.map(([s, label]) => (
            <li key={s} className={s === g.step ? 'now' : ''} title={STEP_NAME[s]} aria-current={s === g.step ? 'step' : undefined}>
              {label}
            </li>
          ))}
        </ol>
      )}
      {who && <span className="priority-note">{g.pending ? `${name(who)}: ${(CHOICE_TITLE[g.pending.kind] ?? g.pending.kind).toLowerCase()}` : `${name(who)} has priority`}</span>}
    </div>
  );
}

function SelectedPanel({ g, view, id, actions, extra, onChoose }: { g: GameState; view: ReturnType<typeof viewFor>; id: string | null; actions: Action[]; extra: Action[]; onChoose: (a: Action) => void }) {
  if (!id) return <p className="hint">Click a highlighted card to see what you can do with it, or pass.</p>;
  const o = view.objects[id];
  const shown = o ? shownCard(view.cards, o) : null;
  const xs = extra.filter((a) => a.type === 'cast' && a.x !== undefined) as Choosing[];
  const kicks = extra.filter((a) => a.type === 'cast' && a.kicked);
  return (
    <div className="selected">
      <div className="selected-head">
        {o && (
          <span className="selected-card">
            <TableCard cards={view.cards} o={o} sizes="120px" />
          </span>
        )}
        <div>
          <p className="flow-title">{publicName(id, view as unknown as GameState)}</p>
          {shown && (
            <p className="hint">
              <AutomationMark level={shown.card.automation} /> {AUTOMATION_LABEL[shown.card.automation]}
            </p>
          )}
        </div>
      </div>
      {actions.length + extra.length === 0 ? (
        <p className="hint">Nothing you can do with this right now.</p>
      ) : (
        <ul className="action-list">
          {actions.map((a, i) => (
            <li key={i}>
              <button type="button" className="action-btn" onClick={() => onChoose(a)}>
                <RulesText text={actionLabel(g, a)} />
              </button>
            </li>
          ))}
          {kicks.map((a, i) => (
            <li key={`k${i}`}>
              <button type="button" className="action-btn" onClick={() => onChoose(a)}>
                {actionLabel(g, a)}
              </button>
            </li>
          ))}
          {xs.length > 0 && <XCast g={g} options={xs} onChoose={onChoose} />}
        </ul>
      )}
    </div>
  );
}

function XCast({ g, options, onChoose }: { g: GameState; options: Choosing[]; onChoose: (a: Action) => void }) {
  const values = options.map((a) => a.x ?? 0);
  const [x, setX] = useState(values[values.length - 1] ?? 0);
  const a = options.find((o) => o.x === x) ?? options[0]!;
  return (
    <li className="x-cast">
      <label>
        X =
        <select value={x} onChange={(e) => setX(Number(e.target.value))}>
          {values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="action-btn" onClick={() => onChoose(a)}>
        {actionLabel(g, a)}
      </button>
    </li>
  );
}

function StopsEditor({ stops, onChange, name }: { stops: Stops; onChange: (s: Stops) => void; name: string }) {
  const steps: Step[] = ['upkeep', 'draw', 'main1', 'beginning_of_combat', 'declare_attackers', 'declare_blockers', 'combat_damage', 'end_of_combat', 'main2', 'end'];
  const toggle = (list: Step[], s: Step) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]);
  return (
    <div className="stops">
      <p className="hint">
        Where {name} stops to act when the stack is empty. Everywhere else, priority is passed for them.
      </p>
      {(['mine', 'theirs'] as const).map((k) => (
        <div key={k} className="stops-row">
          <span className="stops-label">{k === 'mine' ? 'My turn' : 'Others’ turns'}</span>
          {steps.map((s) => (
            <button key={s} type="button" className={stops[k].includes(s) ? 'chip-btn selected' : 'chip-btn'} onClick={() => onChange({ ...stops, [k]: toggle(stops[k], s) })}>
              {STEP_NAME[s]}
            </button>
          ))}
        </div>
      ))}
      <label className="check small">
        <input type="checkbox" checked={stops.skipIfNothing} onChange={(e) => onChange({ ...stops, skipIfNothing: e.target.checked })} />
        With something on the stack, skip me if I have nothing to cast or activate (others may notice I wasn’t asked)
      </label>
      <label className="check small">
        <input type="checkbox" checked={stops.hold} onChange={(e) => onChange({ ...stops, hold: e.target.checked })} />
        Hold priority after I cast or activate
      </label>
    </div>
  );
}

/** The stack between the two halves of the table, as overlapping cards (top of the stack on the right). */
function StackBand({ g, view, pick, onFocus, onHover }: { g: GameState; view: ReturnType<typeof viewFor>; pick: Pick | null; onFocus: (i: number | null) => void; onHover: (id: string | null, el?: HTMLElement) => void }) {
  if (!g.stack.length) return <div className="midline" aria-hidden="true" />;
  return (
    <div className="midline">
    <div className="stack-band" aria-label={`Stack, ${g.stack.length} item${g.stack.length > 1 ? 's' : ''}`}>
      <span className="band-label">Stack</span>
      <ol className="stack-cards">
        {g.stack.map((e, i) => {
          const targets = e.targets.flat().map((t) => targetLabel(g, t.kind === 'object' ? { kind: 'object', object: t.id } : t));
          const entryId = e.kind === 'ability' ? e.id : null;
          const objId = e.kind === 'spell' ? e.object : null;
          const pickable = Boolean((entryId && pick?.entries.has(entryId)) || (objId && pick?.objects.has(objId)));
          const chosen = pick?.chosen.some((c) => (c.kind === 'ability' && c.entry === entryId) || (c.kind === 'object' && c.object === objId));
          const o = objId ? view.objects[objId] : undefined;
          return (
            <li key={entryId ?? objId ?? i} className={`stack-item${i === g.stack.length - 1 ? ' stack-top' : ''}${pickable ? ' pickable' : ''}${chosen ? ' picked' : ''}`} style={{ zIndex: i + 1 }}>
              <button
                type="button"
                className="stack-card"
                disabled={!pickable}
                onMouseEnter={(ev) => {
                  onFocus(i);
                  if (objId) onHover(objId, ev.currentTarget);
                }}
                onMouseLeave={() => {
                  onFocus(null);
                  onHover(null);
                }}
                onClick={() => {
                  if (entryId && pick?.entries.has(entryId)) pick.onPick({ kind: 'ability', entry: entryId });
                  else if (objId && pick?.objects.has(objId)) pick.onPick({ kind: 'object', object: objId });
                }}
                aria-label={`${e.kind === 'spell' ? publicName(e.object, g) : `${e.sourceName}’s ability`}${targets.length ? `, targeting ${targets.join(', ')}` : ''}`}
              >
                {o ? (
                  <TableCard cards={view.cards} o={o} sizes="96px" />
                ) : (
                  <span className="ability-card">
                    <strong>{e.kind === 'ability' ? e.sourceName : ''}</strong>
                    <span>{e.kind === 'ability' ? e.text : ''}</span>
                  </span>
                )}
              </button>
              <span className="stack-meta">
                {g.players[e.controller]?.name}
                {targets.length ? ` → ${targets.join(', ')}` : ''}
                {e.kind === 'ability' && e.manual ? ' · by hand' : ''}
                {e.x ? ` · X=${e.x}` : ''}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
    </div>
  );
}

function LogBox({ log, viewer }: { log: LogLine[]; viewer: PlayerId | null }) {
  const ref = useRef<HTMLOListElement>(null);
  const shown = log.filter((l) => !l.only || l.only === viewer).slice(-200);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length]);
  return (
    <div className="log-box">
      <p className="box-title">Log</p>
      <ol className="log" ref={ref}>
        {shown.map((l) => (
          <li key={l.id} className={`log-${l.kind}${l.only ? ' private' : ''}`}>
            {l.text}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Curtain({ g, who, log, onReady }: { g: GameState; who: PlayerId; log: LogLine[]; onReady: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), [who]);
  const recent = log.filter((l) => !l.only).slice(-6);
  const reason = g.pending ? (CHOICE_TITLE[g.pending.kind] ?? g.pending.kind) : 'Priority';
  return (
    <div className="curtain" role="dialog" aria-modal="true" aria-labelledby="curtain-title">
      <div className="curtain-inner">
        <p className="muted">{reason}</p>
        <h2 id="curtain-title">Pass to {g.players[who]!.name}</h2>
        <p className="muted">Everyone else, look away — the next screen shows {g.players[who]!.name}’s hand.</p>
        {recent.length > 0 && (
          <ol className="curtain-log">
            {recent.map((l) => (
              <li key={l.id}>{l.text}</li>
            ))}
          </ol>
        )}
        <button ref={ref} type="button" className="primary big" onClick={onReady}>
          I’m {g.players[who]!.name} — show my cards
        </button>
      </div>
    </div>
  );
}

function ZoneDialog({ g, view, player, zone, h, onClose }: { g: GameState; view: ReturnType<typeof viewFor>; player: PlayerId; zone: 'graveyard' | 'exile'; h: BoardHandlers; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const ids = zone === 'graveyard' ? [...(g.zones.graveyard[player] ?? [])].reverse() : g.zones.exile.filter((id) => g.objects[id]?.owner === player);
  return (
    <dialog ref={ref} className="storage zone-dialog" onClose={onClose} aria-labelledby="zone-title">
      <form method="dialog" className="storage-inner">
        <header>
          <h2 id="zone-title">
            {g.players[player]!.name}’s {zone} ({ids.length})
          </h2>
          <button type="submit" className="ghost">
            Close
          </button>
        </header>
        {ids.some((id) => h.actionable.has(id)) && <p className="hint">Highlighted cards can be played now: choose one to see how.</p>}
        {ids.length === 0 ? (
          <p className="muted">Empty.</p>
        ) : (
          <div className="zone-grid">
            {ids.map((id) => {
              const o = view.objects[id];
              const can = h.actionable.has(id);
              return (
                <span key={id} className="zone-cell">
                  <button
                    type="button"
                    data-id={id}
                    className={cardClass(id, h, 'zone-card')}
                    disabled={!can}
                    onClick={() => {
                      h.onCard(id);
                      ref.current?.close();
                    }}
                  >
                    {o ? <TableCard cards={view.cards} o={o} sizes="110px" /> : <CardBackOnly />}
                  </button>
                  <span className="pick-name">{o ? publicName(id, view as unknown as GameState) : 'Face-down card'}</span>
                </span>
              );
            })}
          </div>
        )}
      </form>
    </dialog>
  );
}

function CardBackOnly() {
  return (
    <span className="tc-frame">
      <span className="card-back" />
    </span>
  );
}

function HoverPreview({ view, id, rect }: { view: ReturnType<typeof viewFor>; id: string; rect: DOMRect }) {
  const o = view.objects[id];
  // Beside the card (right of it if there's room), never under the pointer.
  const w = 250;
  const hgt = 350;
  const left = rect.right + 14 + w < window.innerWidth - 8 ? rect.right + 14 : Math.max(8, rect.left - 14 - w);
  const top = Math.min(Math.max(66, rect.top + rect.height / 2 - hgt / 2), window.innerHeight - hgt - 8);
  if (!o) return null;
  const shown = shownCard(view.cards, o);
  if (!shown) return null;
  const face = shown.card.faces[shown.face] ?? shown.card.faces[0]!;
  const lines = annotateOracle(face).filter((l) => l.status === 'manual');
  return (
    <div className="hover-preview" aria-hidden="true" style={{ left, top }}>
      <span className="hover-card">
        <CardImage card={shown.card} faceIndex={shown.face} sizes="250px" eager />
      </span>
      {lines.length > 0 && (
        <div className="hover-manual">
          <p>Resolve by hand:</p>
          {lines.map((l, i) => (
            <p key={i} className="oracle-line line-manual">
              <RulesText text={l.text} />
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
