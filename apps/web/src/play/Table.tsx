import type { CardDef } from '@mtg/schema';
import { annotateOracle } from '@mtg/schema';
import { chars, legalActions, viewFor, withCharsCache, type Action, type Characteristics, type ChoiceAnswer, type GameState, type PendingChoice, type PlayerId, type PlayerView, type Step } from '@mtg/engine';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AUTOMATION_LABEL, AutomationMark, TestPlayIssues, automationHint } from '../components/bits';
import { CardBackFace, CardView } from '../components/Card';
import { RulesText } from '../components/mana';
import { Actions, ActionBarSlot, PlanArrows } from './actionbar';
import { Arrows, type ArrowSpec } from './Arrows';
import { abilityCounts, abilityRows } from './abilities';
import { clickOutcome, dragAction } from './click';
import { cardClass, Command, Elsewhere, Hand, MySeat, OpponentSeat, Piles, Plate, Pool, type BoardHandlers } from './Board';
import { lookOf as matLook, type SeatLook } from '../components/Mat';
import { shownCard } from './cards';
import { ActionFlow, CHOICE_TITLE, ChoicePanel, needsChoices } from './Choices';
import { actionLabel, actionObject, manaPreview, previewLabel, targetLabel } from './labels';
import { spendText } from './mana-text';
import { asYou, lineFor, narrate, publicName, STEP_NAME, type LogLine } from './log';
import { useCardMotion } from './motion';
import type { Pick } from './pick';
import { openView, previewTaps } from './preview';
import { extraCasts, hasXRange } from './probes';
import { advance, canUndoIn, clearSavedGame, decider, DEFAULT_STOPS, defaultStops, dummiesOf, modeOf, newGame, passUntilDone, peekPass, replay, saveGame, step, TURN_STEPS, type Ctx, type GameSetup, type Mode, type PassUntil, type Stops } from './session';
import { withPrinting } from '../skins';

type Choosing = Extract<Action, { type: 'cast' | 'activate' }>;

export interface Live {
  setup: GameSetup;
  cards: Record<string, CardDef>;
  state: GameState;
  actions: Action[];
  /** Where each of the players' own decisions starts in `actions`. */
  marks: number[];
  log: LogLine[];
  /** States before recent decisions, for a quick undo (older ones are replayed). */
  history: { state: GameState; actions: number; log: number }[];
}

let logId = 0;
export const nextLogId = () => ++logId;

// Each seat's stops as its player last set them, kept apart for each kind of game (a solo playtest stops in the
// dummy's turn; a table of people passing the device doesn't stop in each other's). A new key whenever what the
// defaults mean changes, so nobody keeps the old ones without having chosen them.
const STOPS_KEY = 'mtg-stops-v3';

function storedStops(): Record<string, Record<string, Partial<Stops>>> {
  try {
    const v = JSON.parse(localStorage.getItem(STOPS_KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, Record<string, Partial<Stops>>>) : {};
  } catch {
    return {};
  }
}

function useStops(seats: PlayerId[], mode: Mode) {
  const [stops, setStops] = useState<Record<PlayerId, Stops>>(() => {
    const stored = storedStops()[mode] ?? {};
    return Object.fromEntries(seats.map((p) => [p, { ...defaultStops(mode), ...(stored[p] ?? {}) }]));
  });
  const update = (p: PlayerId, s: Stops) => {
    const next = { ...stops, [p]: s };
    setStops(next);
    try {
      localStorage.setItem(STOPS_KEY, JSON.stringify({ ...storedStops(), [mode]: next }));
    } catch {
      /* not remembered */
    }
  };
  return [stops, update] as const;
}

/** A new game's first state, with the dummy's opening choices already made. */
export function startLive(setup: GameSetup, cards: Record<string, CardDef>): Live {
  const { state, events } = newGame(setup, cards);
  const log = narrate(state, state, events, nextLogId);
  const ctx: Ctx = { stops: {}, passUntil: null, dummies: dummiesOf(setup) };
  const first = advance(state, ctx);
  for (const s of first.steps) log.push(...narrate(s.before, s.after, s.events, nextLogId));
  return { setup, cards, state: first.state, actions: first.steps.map((s) => s.action), marks: [], log, history: [] };
}

/** How wide hand cards are: large enough to read their names and art (their lower part sits below the window's edge). */
function useHandWidth(): number {
  const calc = () => Math.round(Math.min(164, Math.max(84, window.innerHeight * 0.152, Math.min(window.innerWidth * 0.08, 124))));
  const [w, setW] = useState(calc);
  useEffect(() => {
    const on = () => setW(calc());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

/** Whether an action puts a spell or an ability on the stack (where holding priority means something). */
const goesOnStack = (a: Action): boolean => a.type === 'cast' || a.type === 'activate' || a.type === 'activate_manual';

/** What kind of decision a choice is, for its heading (cards shown with nothing to choose among them are a look). */
const choiceTitle = (p: PendingChoice): string => (p.kind === 'choose_objects' && !p.candidates.length ? 'Look' : (CHOICE_TITLE[p.kind] ?? p.kind));

/** Overlays for choices about cards that aren't on the table (or need room to read). */
const OVERLAY_KINDS = new Set<PendingChoice['kind']>(['mulligan', 'bottom_cards', 'opening_battlefield', 'scry', 'surveil', 'search', 'dredge', 'cast_free', 'commander_zone', 'assign_combat_damage']);
function isOverlay(g: GameState, p: PendingChoice): boolean {
  if (OVERLAY_KINDS.has(p.kind)) return true;
  // (Cards shown with nothing to choose among them count too: the five Kinnan looked at.)
  if (p.kind === 'choose_objects') return [...p.candidates, ...(p.seen ?? [])].some((id) => g.objects[id]?.zone !== 'battlefield' && g.objects[id]?.zone !== 'hand');
  return false;
}

export function Table({ live, setLive, onLeave, toolsEl }: { live: Live; setLive: (l: Live) => void; onLeave: () => void; toolsEl: HTMLElement | null }) {
  const g = live.state;
  const mode = modeOf(live.setup);
  const dummies = useMemo(() => dummiesOf(live.setup), [live.setup]);
  const humans = g.order.filter((p) => !dummies.has(p));
  const [stops, setStop] = useStops(g.order, mode);
  const [holder, setHolder] = useState<PlayerId | null>(null);
  const [passUntil, setPassUntil] = useState<PassUntil>(null);
  // Holding priority for one spell or ability (Shift+click, or the box ticked while its targets are chosen): the seat
  // that keeps priority until it has been asked, and whether the one being chosen for now was begun that way.
  const [holdOnce, setHoldOnce] = useState<PlayerId | null>(null);
  const [flowHold, setFlowHold] = useState(false);
  const [menu, setMenu] = useState<{ id: string; rect: DOMRect; full: boolean } | null>(null);
  const [flow, setFlow] = useState<Choosing | null>(null);
  const [pick, setPickState] = useState<Pick | null>(null);
  const [error, setError] = useState<{ text: string; bug: boolean } | null>(null);
  const [hover, setHover] = useState<{ id: string; rect: DOMRect; inHand: boolean } | null>(null);
  const [zone, setZone] = useState<{ player: PlayerId; zone: 'graveyard' | 'exile' } | null>(null);
  const [showStops, setShowStops] = useState(false);
  const [conceding, setConceding] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [planArrows, setPlanArrows] = useState<ArrowSpec[]>([]);
  const [lastSeat, setLastSeat] = useState<PlayerId>(humans[0] ?? g.order[0]!);
  const setPick = useCallback((p: Pick | null) => setPickState(p), []);
  const tableRef = useRef<HTMLDivElement>(null);
  const handW = useHandWidth();
  const ctx: Ctx = { stops, passUntil, dummies, holding: holdOnce };
  // Shift held as a card, or an entry of its menu, is clicked: it's cast or activated and priority is kept, this once.
  const shift = useRef(false);
  useEffect(() => {
    const note = (e: Event) => {
      shift.current = Boolean((e as MouseEvent | KeyboardEvent).shiftKey);
    };
    const clear = () => {
      shift.current = false;
    };
    // (Capture, at the window: before the click reaches the card.)
    const kinds = ['keydown', 'keyup', 'pointerdown', 'pointerup', 'mousedown', 'click'];
    for (const k of kinds) window.addEventListener(k, note, true);
    window.addEventListener('blur', clear);
    return () => {
      for (const k of kinds) window.removeEventListener(k, note, true);
      window.removeEventListener('blur', clear);
    };
  }, []);
  // What each seat is dressed in: its commanders' colours, and its first commander's art for the playmat.
  const looks = useMemo(() => {
    const out: Record<PlayerId, SeatLook> = {};
    for (const s of live.setup.seats) out[s.id] = matLook(s.commanders.map((n) => live.cards[n] && withPrinting(live.cards[n]!, s.skins?.[n])));
    return out;
  }, [live.setup, live.cards]);
  const lookOf = (p: PlayerId): SeatLook => looks[p] ?? { colors: [] };

  // Who sits at the bottom, and whose hand and choices the screen shows.
  const who = decider(g);
  const curtained = mode === 'hotseat' && Boolean(who && holder !== who);
  let viewer: PlayerId | null;
  if (mode === 'hotseat') viewer = curtained ? null : holder;
  else if (mode === 'open') viewer = who && !dummies.has(who) ? who : null;
  else viewer = humans[0] ?? null;
  useEffect(() => {
    if (viewer) setLastSeat(viewer);
  }, [viewer]);
  const seat = viewer ?? (mode === 'hotseat' ? (who ?? lastSeat) : lastSeat);
  const view = useMemo(() => (mode === 'open' ? openView(g, seat) : viewFor(g, seat)), [g, seat, mode]);

  const myPriority = Boolean(viewer && g.priority === viewer && !g.pending && !g.over);
  const legal = useMemo(() => (myPriority ? legalActions(g, viewer!) : []), [g, viewer, myPriority]);
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
    (window as unknown as { magicEngine?: unknown }).magicEngine = { state: g, viewer, legal, mode };
  }, [g, viewer, legal, mode]);

  const pendingMine = viewer && g.pending && g.pending.player === viewer ? (view.pending as PendingChoice) : null;
  const top = g.stack[g.stack.length - 1];

  // ---- acting -------------------------------------------------------------
  const commit = (r: ReturnType<typeof step>, extraMark = true, until: PassUntil = passUntil, held: PlayerId | null = holdOnce): boolean => {
    if (!r.ok) return false;
    const lines = r.applied.steps.flatMap((s) => narrate(s.before, s.after, s.events, nextLogId));
    const actions = [...live.actions, ...r.applied.steps.map((s) => s.action)];
    const marks = extraMark ? [...live.marks, live.actions.length] : live.marks;
    const history = [...live.history, { state: g, actions: live.actions.length, log: live.log.length }].slice(-40);
    setLive({ ...live, state: r.applied.state, actions, marks, log: [...live.log, ...lines], history });
    saveGame({ setup: live.setup, actions, marks, savedAt: new Date().toISOString() });
    setError(null);
    setFlow(null);
    setMenu(null);
    setPickState(null);
    setPlanArrows([]);
    setHover(null);
    setPassUntil(until && !passUntilDone(r.applied.state, until) ? until : null);
    setFlowHold(false);
    // Holding priority this once is over when that seat has been asked with it (a choice it has to make first isn't that).
    setHoldOnce(held && r.applied.state.pending?.player === held ? held : null);
    return true;
  };
  /** `hold`: keep priority after this spell or ability goes on the stack, whatever the seat's stops say. */
  const act = (action: Action, fromList = true, hold = false): boolean => {
    const held = hold && viewer ? viewer : holdOnce;
    const r = step(g, action, held === holdOnce ? ctx : { ...ctx, holding: held });
    if (!r.ok) {
      // An action the engine listed (or a pending choice's answer) shouldn't be refused: that's an engine bug.
      console.error('MagicEngine: the engine refused an action.', JSON.stringify(action), r.error);
      setError({ text: r.error, bug: fromList });
      return false;
    }
    return commit(r, true, passUntil, held);
  };
  const answer = (a: ChoiceAnswer) => viewer && act({ type: 'choose', player: viewer, answer: a });
  const choose = (a: Action) => {
    setError(null);
    setMenu(null);
    const hold = shift.current && goesOnStack(a);
    if (needsChoices(g, a)) {
      setFlow(a as Choosing);
      setFlowHold(hold);
    } else act(a, true, hold);
  };
  // The switch beside the pass button: this seat's own setting, kept with its stops.
  const holding = Boolean(viewer && (stops[viewer] ?? DEFAULT_STOPS).hold);
  const toggleHold = () => viewer && setStop(viewer, { ...(stops[viewer] ?? DEFAULT_STOPS), hold: !holding });
  const pass = () => viewer && act({ type: 'pass', player: viewer });
  /** Passes priority, and keeps passing for this seat until the turn ends or (with a step) that step is reached. */
  const passUntilThen = (until: NonNullable<PassUntil>) => {
    const r = step(g, { type: 'pass', player: until.player }, { ...ctx, passUntil: until });
    if (!commit(r, true, until)) setError({ text: r.ok ? '' : r.error, bug: true });
  };
  const endTurn = () => viewer && passUntilThen({ player: viewer, turn: g.turn });
  const toStep = (s: Step) => viewer && passUntilThen({ player: viewer, turn: g.turn, step: s });

  // ---- undo (solo and open hands): back to before the last decision ----------
  const undoable = canUndoIn(mode) && live.marks.length > 0 && !curtained;
  const undo = () => {
    if (!undoable) return;
    const mark = live.marks[live.marks.length - 1]!;
    const snap = live.history[live.history.length - 1];
    let next: Live | null = null;
    if (snap && snap.actions === mark) {
      next = { ...live, state: snap.state, actions: live.actions.slice(0, mark), marks: live.marks.slice(0, -1), log: live.log.slice(0, snap.log), history: live.history.slice(0, -1) };
    } else {
      // Not in memory (a resumed game): replay everything before that decision.
      const log: LogLine[] = [];
      const state = replay({ setup: live.setup, actions: live.actions.slice(0, mark) }, live.cards, (b, a, e) => log.push(...narrate(b, a, e, nextLogId)));
      if (state) next = { ...live, state, actions: live.actions.slice(0, mark), marks: live.marks.slice(0, -1), log, history: [] };
    }
    if (!next) return;
    setLive(next);
    saveGame({ setup: live.setup, actions: next.actions, marks: next.marks, savedAt: new Date().toISOString() });
    setFlow(null);
    setMenu(null);
    setPickState(null);
    setPassUntil(null);
    setHoldOnce(null);
    setFlowHold(false);
    setError(null);
  };

  // A new decision for someone else: drop what this seat was doing.
  useEffect(() => {
    if (curtained) {
      setFlow(null);
      setFlowHold(false);
      setMenu(null);
      setPickState(null);
    }
  }, [curtained]);

  // ---- clicking cards -------------------------------------------------------
  const optionsFor = (id: string) => {
    // X spells and abilities are listed as a range: the menu asks for the number.
    const all = byObject.get(id) ?? [];
    const extra = myPriority && viewer ? extraCasts(g, viewer, id, all) : [];
    return { listed: all.filter((a) => !hasXRange(a)), extra };
  };
  const onCard = (id: string, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    if (pick?.objects.has(id)) {
      pick.onPick({ kind: 'object', object: id });
      return;
    }
    if (pick || flow || pendingMine || !myPriority) return;
    const { listed, extra } = optionsFor(id);
    // A permanent with several abilities always shows them all, rather than doing the one that can be paid for now.
    const out = clickOutcome(listed, extra, viewer ? abilityCounts(g, viewer, id) : undefined);
    if (out.kind === 'act') choose(out.action);
    else if (out.kind === 'menu') setMenu({ id, rect, full: false });
  };
  const onDragPlay = (id: string) => {
    if (!myPriority || flow || pendingMine) return;
    const a = dragAction(optionsFor(id).listed);
    if (a) choose(a);
    else {
      const el = tableRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
      if (el) setMenu({ id, rect: el.getBoundingClientRect(), full: true });
    }
  };

  // The stack entry in focus (hovered, else the top): what it targets is highlighted on the table.
  const [stackFocus, setStackFocus] = useState<number | null>(null);
  const focusEntry = g.stack[stackFocus ?? g.stack.length - 1];
  const targeted = useMemo(() => new Set((focusEntry?.targets ?? []).flat().flatMap((t) => (t.kind === 'object' ? [t.id] : t.kind === 'player' ? [t.player] : []))), [focusEntry]);

  // Hovering something castable shows the lands autotap would use for it.
  const willTap = useMemo(() => {
    if (!hover || !myPriority) return new Set<string>();
    const a = (byObject.get(hover.id) ?? []).find((x) => x.type === 'cast' || x.type === 'activate');
    return new Set(a ? previewTaps(g, a) : []);
  }, [hover, byObject, g, myPriority]);

  const h: BoardHandlers = {
    pick: curtained ? null : pick,
    selected: menu?.id ?? null,
    actionable: flow || g.pending || curtained ? new Set() : actionable,
    manaOnly,
    targeted,
    willTap,
    onCard,
    onMenu: (id, el) => {
      if (pick || curtained) return;
      setMenu({ id, rect: el.getBoundingClientRect(), full: true });
    },
    onPlayer: (p) => pick?.players.has(p) && pick.onPick({ kind: 'player', player: p }),
    onHover: (id, el) => setHover(id && el ? { id, rect: el.getBoundingClientRect(), inHand: el.classList.contains('hand-card') } : null),
    onZone: (player, z) => setZone({ player, zone: z }),
    onDragPlay,
    chars: (id) => charMap.get(id) ?? chars(g, g.objects[id]!),
  };

  // ---- arrows ---------------------------------------------------------------
  const arrows = useMemo(() => {
    const out: ArrowSpec[] = [];
    for (const [id, a] of Object.entries(g.combat?.attackers ?? {})) {
      out.push({ from: { id }, to: a.target.kind === 'player' ? { player: a.target.player } : { id: a.target.object }, kind: 'attack' });
    }
    for (const [id, b] of Object.entries(g.combat?.blockers ?? {})) out.push({ from: { id }, to: { id: b.blocking }, kind: 'block' });
    if (focusEntry && !curtained) {
      const from = { id: focusEntry.kind === 'spell' ? focusEntry.object : `stack:${focusEntry.id}` };
      for (const t of focusEntry.targets.flat()) {
        if (t.kind === 'object') out.push({ from, to: { id: t.id }, kind: 'target' });
        else if (t.kind === 'player') out.push({ from, to: { player: t.player }, kind: 'target' });
      }
    }
    return [...out, ...planArrows];
  }, [g, focusEntry, planArrows, curtained]);

  useCardMotion(tableRef, g);

  // ---- the pass button --------------------------------------------------------
  const peeked = useMemo(() => (myPriority && !top && viewer ? peekPass(g, viewer, ctx) : null), [g, myPriority, top, viewer, stops, passUntil]); // eslint-disable-line react-hooks/exhaustive-deps
  // Being asked to discard at cleanup is the turn ending, as far as the button's name goes.
  const peek = peeked?.kind === 'step' && peeked.step === 'cleanup' ? ({ kind: 'end' } as const) : peeked;
  // On someone else's turn, passing to its end is passing to the next turn: the viewer's own, when they're next.
  const nextIsMine = (() => {
    const alive = g.order.filter((p) => !g.players[p]?.lost);
    const i = alive.indexOf(g.active);
    return i >= 0 && alive[(i + 1) % alive.length] === viewer;
  })();
  const passLabel = top
    ? `Resolve ${top.kind === 'spell' ? publicName(top.object, g).split(' // ')[0] : 'ability'}`
    : !peek || peek.kind === 'other'
      ? 'Pass'
      : peek.kind === 'end'
        ? g.active === viewer
          ? 'End turn'
          : nextIsMine
            ? 'To your turn'
            : 'Pass turn'
        : `To ${STEP_TO[peek.step] ?? STEP_NAME[peek.step].toLowerCase()}`;
  // The two buttons beside it are left out where the main one already does the same.
  const passEndsTurn = !top && peek?.kind === 'end';
  const passGoesToEnd = !top && peek?.kind === 'step' && peek.step === 'end';

  // ---- keys: Space/Enter primary, Esc cancel, F2 pass, F6 pass to end of turn, Z undo -----
  const keyState = useRef({ pass, endTurn, toStep, undo, toggleHold, myPriority, flow, menu, step: g.step });
  keyState.current = { pass, endTurn, toStep, undo, toggleHold, myPriority, flow, menu, step: g.step };
  useEffect(() => {
    // A button clicked with the mouse doesn't keep the keyboard: Space after "Attack with all" is the main button, not
    // that one again. (A button reached with Tab keeps it — `detail` is 0 for a keyboard click.)
    const onClick = (e: MouseEvent) => {
      const b = (e.target as HTMLElement | null)?.closest('button');
      if (e.detail > 0 && b && b.closest('.actions, .tools, .stops-pop')) b.blur();
    };
    document.addEventListener('click', onClick);
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      const k = keyState.current;
      if (e.key === 'Escape') {
        setShowStops(false);
        if (k.menu) setMenu(null);
        else if (k.flow) {
          setFlow(null);
          setFlowHold(false);
          setPickState(null);
        } else setViewing(null);
        return;
      }
      if (document.querySelector('dialog[open], .curtain')) return;
      if ((e.key === ' ' || e.key === 'Enter') && (!t || t === document.body || t.classList.contains('table') || t.classList.contains('tcard'))) {
        const btn = document.querySelector<HTMLButtonElement>('.overlay .actions .primary:not(:disabled), .action-bar .actions .primary:not(:disabled)');
        if (btn) {
          e.preventDefault();
          btn.click();
        }
      } else if (e.key === 'F2' && k.myPriority && !k.flow) {
        e.preventDefault();
        k.pass();
      } else if (e.key === 'F4' && k.myPriority && !k.flow && TURN_STEPS.indexOf(k.step) < TURN_STEPS.indexOf('end')) {
        e.preventDefault();
        k.toStep('end');
      } else if (e.key === 'F6' && k.myPriority && !k.flow) {
        e.preventDefault();
        k.endTurn();
      } else if ((e.key === 'z' || e.key === 'Z') && !e.altKey) {
        e.preventDefault();
        k.undo();
      } else if ((e.key === 'h' || e.key === 'H') && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        k.toggleHold();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, []);

  // ---- layout -------------------------------------------------------------------
  const others = (() => {
    const i = g.order.indexOf(seat);
    return [...g.order.slice(i + 1), ...g.order.slice(0, i)];
  })();
  const overlayChoice = pendingMine && isOverlay(g, pendingMine);
  const choicePanel = pendingMine ? (
    <ChoicePanel key={JSON.stringify(pendingMine).length + pendingMine.kind + live.actions.length} g={g} view={view} pending={pendingMine} me={viewer!} answer={answer} act={(a) => act(a)} setPick={setPick} />
  ) : null;
  const [barEl, setBarEl] = useState<HTMLElement | null>(null);
  const [overlayBarEl, setOverlayBarEl] = useState<HTMLElement | null>(null);
  const prompt = error || (pendingMine && !overlayChoice) || flow;
  const nOpp = others.length;
  // The largest a battlefield card is drawn; each seat's cards shrink from there to fit its room.
  const oppMax = nOpp === 1 ? 138 : nOpp === 2 ? 112 : 96;
  const myMax = 164;
  const beforeEnd = TURN_STEPS.indexOf(g.step) < TURN_STEPS.indexOf('end');

  return (
    <PlanArrows.Provider value={setPlanArrows}>
      <ActionBarSlot.Provider value={barEl}>
        <div className={`play mode-${mode} seats-${g.order.length}${prompt ? ' prompting' : ''}${myPriority ? ' my-priority' : ''}${viewer && who === viewer ? ' my-move' : ''}`} style={{ ['--hand-w' as string]: `${handW}px` }}>
          <div className="table" ref={tableRef} tabIndex={-1}>
            <div className={`opps n${nOpp}`}>
              {others.map((p) => (
                <OpponentSeat key={p} g={g} view={view} player={p} h={h} deciding={who === p && !dummies.has(p)} maxW={oppMax} look={lookOf(p)} />
              ))}
            </div>
            <TurnBar
              g={g}
              view={view}
              who={who}
              log={live.log}
              viewer={viewer}
              logViewer={mode === 'open' ? null : viewer}
              pick={curtained ? null : pick}
              onFocus={setStackFocus}
              onHover={h.onHover}
              stops={stops[(viewer ?? humans[0])!] ?? DEFAULT_STOPS}
              goTo={myPriority && !flow ? toStep : null}
              toggleStop={
                viewer
                  ? (s) => {
                      const mine = stops[viewer] ?? DEFAULT_STOPS;
                      const k = g.active === viewer ? 'mine' : 'theirs';
                      setStop(viewer, { ...mine, [k]: mine[k].includes(s) ? mine[k].filter((x) => x !== s) : [...mine[k], s] });
                    }
                  : null
              }
            />
            <MySeat g={g} view={view} player={seat} h={h} deciding={who === seat} maxW={myMax} look={lookOf(seat)} />
            <div className="dock">
              <div className="dock-left">
                <Plate g={g} player={seat} h={h} deciding={who === seat} me look={lookOf(seat)} />
                <Command g={g} view={view} player={seat} h={h} />
                <Pool g={g} player={seat} />
              </div>
              <div className="dock-hand">
                <Elsewhere g={g} view={view} player={seat} h={h} />
                {curtained ? <div className="hand hand-hidden">Hand hidden until {g.players[who!]!.name} takes the device</div> : <Hand view={view} player={seat} h={h} cardW={handW} />}
              </div>
              <div className="dock-right">
                <Piles g={g} view={view} player={seat} h={h} />
                <div className="action-bar" ref={setBarEl} aria-label="Actions" />
              </div>
            </div>

            {myPriority && !flow && (
              <Actions
                hint={top ? `${top.kind === 'spell' ? publicName(top.object, g) : `${top.sourceName}’s ability`} is on the stack` : null}
                aside={
                  <button
                    type="button"
                    role="switch"
                    aria-checked={holding}
                    className="hold-toggle"
                    onClick={toggleHold}
                    title="Keep priority when your own spell or ability goes on the stack, so you can respond to it yourself before it resolves (H). Shift+click a card to hold priority for that one only."
                  >
                    Hold priority
                    <span className="switch" aria-hidden="true" />
                  </button>
                }
              >
                <button type="button" className="primary pass" onClick={pass} title="Space or F2">
                  {passLabel}
                </button>
                {beforeEnd && !passGoesToEnd && (
                  <button type="button" className="secondary" title="Pass until this turn’s end step and stop there, unless something targets you first (F4)" onClick={() => toStep('end')}>
                    To end step
                  </button>
                )}
                {!passEndsTurn && (
                  <button type="button" className="secondary" title="Pass until this turn is over, unless something targets you (F6)" onClick={endTurn}>
                    {g.active === viewer ? 'End turn' : 'Pass turn'}
                  </button>
                )}
              </Actions>
            )}

            {prompt && (
              <aside className="prompt-panel" aria-live="polite" aria-label="Decision">
                {error && (
                  <div className="banner warn">
                    <strong>{error.bug ? 'The engine refused an action it offered.' : 'That isn’t allowed.'}</strong> {error.text}
                    {error.bug && <span className="hint"> (Logged to the console with the action.)</span>}
                  </div>
                )}
                {pendingMine && !overlayChoice ? (
                  <>
                    <p className="prompt-kind">{choiceTitle(pendingMine)}</p>
                    <Resolving g={g} view={view} />
                    {choicePanel}
                  </>
                ) : flow ? (
                  <>
                    <ActionFlow
                      key={JSON.stringify(flow)}
                      g={g}
                      view={view}
                      action={flow}
                      setPick={setPick}
                      onCommit={(a) => act(a, false, flowHold || shift.current)}
                      onCancel={() => {
                        setFlow(null);
                        setFlowHold(false);
                        setPickState(null);
                      }}
                    />
                    {/* Responding to your own spell starts here: it stays on the stack with priority still yours. */}
                    {holding ? (
                      <p className="hint hold-note">Holding priority: you keep it after this goes on the stack.</p>
                    ) : (
                      <label className="check small hold-note" title="Keep priority after this goes on the stack, so you can respond to it yourself before it resolves. (Shift+click a card does the same.)">
                        <input type="checkbox" checked={flowHold} onChange={(e) => setFlowHold(e.target.checked)} />
                        Hold priority after this
                      </label>
                    )}
                  </>
                ) : null}
              </aside>
            )}

            <Arrows root={tableRef} arrows={arrows} version={`${live.actions.length}:${hover?.id ?? ''}:${handW}`} />
            {hover && !menu && !curtained && !hover.inHand && <HoverPreview view={view} id={hover.id} rect={hover.rect} />}
            {menu && (
              <CardMenu
                g={g}
                view={view}
                viewer={viewer}
                id={menu.id}
                rect={menu.rect}
                actions={byObject.get(menu.id) ?? []}
                extra={optionsFor(menu.id).extra}
                onChoose={choose}
                onView={() => {
                  setViewing(menu.id);
                  setMenu(null);
                }}
                onClose={() => setMenu(null)}
              />
            )}
            {overlayChoice && choicePanel && (
              <div className="overlay" role="dialog" aria-label={choiceTitle(pendingMine)}>
                <ActionBarSlot.Provider value={overlayBarEl}>
                  <div className={`overlay-panel kind-${pendingMine.kind}`}>
                    <p className="prompt-kind">{choiceTitle(pendingMine)}</p>
                    <Resolving g={g} view={view} />
                    {choicePanel}
                    <div className="overlay-actions" ref={setOverlayBarEl} />
                  </div>
                </ActionBarSlot.Provider>
              </div>
            )}
            {g.over && <GameOver g={g} onNew={() => { clearSavedGame(); onLeave(); }} />}
          </div>

          {showLog && <LogDrawer log={live.log} viewer={mode === 'open' ? null : viewer} onClose={() => setShowLog(false)} all={mode === 'open'} names={mode === 'open' ? Object.fromEntries(g.order.map((p) => [p, g.players[p]!.name])) : null} />}
          {curtained && who && <Curtain g={g} who={who} log={live.log} onReady={() => setHolder(who)} />}
          {zone && <ZoneDialog g={g} view={view} player={zone.player} zone={zone.zone} h={h} onClose={() => setZone(null)} />}
          {viewing && <CardViewer view={view} id={viewing} onClose={() => setViewing(null)} />}
          {toolsEl &&
            createPortal(
              <div className="play-tools">
                {canUndoIn(mode) && (
                  <button type="button" className="tool" onClick={undo} disabled={!undoable} title="Undo your last decision (Z)">
                    Undo
                  </button>
                )}
                <span className="tool-wrap">
                  <button type="button" className={`tool${showStops ? ' on' : ''}`} onClick={() => setShowStops(!showStops)} aria-expanded={showStops} disabled={!viewer && mode !== 'solo'}>
                    Stops
                  </button>
                  {showStops && (viewer ?? humans[0]) && <StopsEditor stops={stops[(viewer ?? humans[0])!] ?? DEFAULT_STOPS} onChange={(s) => setStop((viewer ?? humans[0])!, s)} name={g.players[(viewer ?? humans[0])!]!.name} mode={mode} onClose={() => setShowStops(false)} />}
                </span>
                <button type="button" className={`tool${showLog ? ' on' : ''}`} onClick={() => setShowLog(!showLog)} aria-expanded={showLog}>
                  Log
                </button>
                <button type="button" className="tool" onClick={onLeave} title="The game is saved; resume it from Play">
                  Leave
                </button>
                {/* Asked on the page: some hosts (an embedded page) never show a browser dialog, and answer "no" for it. */}
                {viewer && !g.over && !conceding && (
                  <button type="button" className="tool danger" onClick={() => setConceding(true)}>
                    Concede
                  </button>
                )}
                {viewer && !g.over && conceding && (
                  <span className="tool-confirm" role="group" aria-label={`Concede the game for ${g.players[viewer]!.name}?`}>
                    <span className="tool-ask">{g.players[viewer]!.name === 'You' ? 'Concede the game?' : `Concede for ${g.players[viewer]!.name}?`}</span>
                    <button
                      type="button"
                      className="tool danger"
                      onClick={() => {
                        setConceding(false);
                        act({ type: 'concede', player: viewer });
                      }}
                    >
                      Concede
                    </button>
                    <button type="button" className="tool" onClick={() => setConceding(false)}>
                      Keep playing
                    </button>
                  </span>
                )}
              </div>,
              toolsEl,
            )}
        </div>
      </ActionBarSlot.Provider>
    </PlanArrows.Provider>
  );
}

/** What a choice is for: the spell or ability that stopped partway through resolving to ask. */
function Resolving({ g, view }: { g: GameState; view: PlayerView }) {
  const e = g.resolving?.entry;
  if (!e) return null;
  const id = e.kind === 'spell' ? e.object : e.source.id;
  const o = view.objects[id];
  const shown = o ? shownCard(view.cards, o) : null;
  const text = e.kind === 'ability' ? e.text : (shown?.card.faces[shown.face]?.oracle ?? '');
  return (
    <div className="resolving">
      {shown && (
        <span className="resolving-card">
          <CardView card={shown.card} faceIndex={shown.face} sizes="60px" />
        </span>
      )}
      <p>
        <strong>{e.kind === 'spell' ? publicName(e.object, g).split(' // ')[0] : e.sourceName}</strong>
        <span className="resolving-text">
          <RulesText text={text} />
        </span>
      </p>
    </div>
  );
}

const STEP_TO: Partial<Record<Step, string>> = {
  beginning_of_combat: 'combat',
  declare_attackers: 'combat',
  declare_blockers: 'blocks',
  combat_damage: 'damage',
  end_of_combat: 'end of combat',
  main1: 'main phase',
  main2: 'main 2',
  end: 'end step',
  upkeep: 'upkeep',
  draw: 'draw step',
};

// ---------------------------------------------------------------------------
// The turn bar: whose turn it is, where in it we are (a later step is a button: pass until then), the latest event,
// and the stack
// ---------------------------------------------------------------------------

const PHASES: { steps: Step[]; label: string; goto: Step }[] = [
  { steps: ['untap', 'upkeep'], label: 'Upkeep', goto: 'upkeep' },
  { steps: ['draw'], label: 'Draw', goto: 'draw' },
  { steps: ['main1'], label: 'Main 1', goto: 'main1' },
  { steps: ['beginning_of_combat', 'declare_attackers', 'declare_blockers', 'combat_damage', 'end_of_combat'], label: 'Combat', goto: 'beginning_of_combat' },
  { steps: ['main2'], label: 'Main 2', goto: 'main2' },
  { steps: ['end', 'cleanup'], label: 'End', goto: 'end' },
];

function TurnBar({
  g,
  view,
  who,
  log,
  viewer,
  logViewer,
  pick,
  onFocus,
  onHover,
  stops,
  goTo,
  toggleStop,
}: {
  g: GameState;
  view: PlayerView;
  who: PlayerId | null;
  log: LogLine[];
  viewer: PlayerId | null;
  logViewer: PlayerId | null;
  pick: Pick | null;
  onFocus: (i: number | null) => void;
  onHover: (id: string | null, el?: HTMLElement) => void;
  /** The seat's usual stops, marked on the steps. */
  stops: Stops;
  /** Passes until a later step of this turn (null when the seat can't pass now). */
  goTo: ((s: Step) => void) | null;
  /** Adds or removes a usual stop for this kind of turn (the seat's own, or another player's). */
  toggleStop: ((s: Step) => void) | null;
}) {
  const name = (p: PlayerId) => g.players[p]?.name ?? p;
  const last = [...log].reverse().find((l) => lineFor(l, logViewer));
  const at = TURN_STEPS.indexOf(g.step);
  const mine = g.active === viewer;
  const usual = mine ? stops.mine : stops.theirs;
  return (
    <div className="turnbar">
      <div className="turn-now">
        {g.started ? (
          <>
            {/* A player's own count: everyone's first turn is turn 1, then everyone's second is turn 2. */}
            <span className="turn-no">Turn {g.players[g.active]?.turnsBegun ?? g.turn}</span>
            <span className="turn-who">{mine ? 'Your turn' : `${name(g.active)}’s turn`}</span>
          </>
        ) : (
          <span className="turn-who">Opening hands</span>
        )}
      </div>
      {g.started && (
        <ol className="steps" aria-label="Steps of the turn">
          {PHASES.map((ph) => {
            const now = ph.steps.includes(g.step);
            const later = TURN_STEPS.indexOf(ph.goto) > at;
            const can = later && Boolean(goTo);
            const stop = ph.steps.some((s) => usual.includes(s));
            const label = now && ph.label === 'Combat' ? STEP_NAME[g.step].replace(/ step$/, '') : ph.label;
            const whose = mine ? 'your turns' : 'other players’ turns';
            return (
              <li key={ph.label} className={`step${now ? ' now' : later ? ' later' : ' past'}${stop ? ' stop' : ''}`} aria-current={now ? 'step' : undefined}>
                <button
                  type="button"
                  aria-disabled={!can}
                  onClick={() => can && goTo?.(ph.goto)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    toggleStop?.(ph.goto);
                  }}
                  title={`${can ? `Pass until ${ph.label === 'End' ? 'the end step' : ph.label.toLowerCase()} and stop there. ` : ''}${toggleStop ? `Right-click to ${stop ? 'stop' : 'start'} stopping here on ${whose}.` : ''}`}
                >
                  {label}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <p className="ticker" aria-live="polite">
        {who && who !== viewer && !g.over ? <span className="waiting">Waiting for {name(who)}… </span> : null}
        {last ? <RulesText text={asYou(last.text)} /> : ''}
      </p>
      <StackZone g={g} view={view} pick={pick} onFocus={onFocus} onHover={onHover} />
    </div>
  );
}

/** The stack, as overlapping cards at the right of the turn bar (top of the stack in front). */
function StackZone({ g, view, pick, onFocus, onHover }: { g: GameState; view: PlayerView; pick: Pick | null; onFocus: (i: number | null) => void; onHover: (id: string | null, el?: HTMLElement) => void }) {
  if (!g.stack.length) return null;
  return (
    <div className="stack-zone" aria-label={`Stack, ${g.stack.length} item${g.stack.length > 1 ? 's' : ''}`}>
      <ol className="stack-cards">
        {g.stack.map((e, i) => {
          const targets = e.targets.flat().map((t) => targetLabel(g, t.kind === 'object' ? { kind: 'object', object: t.id } : t));
          const entryId = e.kind === 'ability' ? e.id : null;
          const objId = e.kind === 'spell' ? e.object : null;
          const pickable = Boolean((entryId && pick?.entries.has(entryId)) || (objId && pick?.objects.has(objId)));
          const chosen = pick?.chosen.some((c) => (c.kind === 'ability' && c.entry === entryId) || (c.kind === 'object' && c.object === objId));
          const o = objId ? view.objects[objId] : undefined;
          const shown = o ? shownCard(view.cards, o) : null;
          const src = e.kind === 'ability' ? g.objects[e.source.id] : undefined;
          const srcShown = src && view.objects[src.id] ? shownCard(view.cards, view.objects[src.id]!) : null;
          return (
            <li key={entryId ?? objId ?? i} className={`stack-item${i === g.stack.length - 1 ? ' stack-top' : ''}${pickable ? ' pickable' : ''}${chosen ? ' picked' : ''}`} style={{ zIndex: i + 1 }}>
              <button
                type="button"
                className="stack-card"
                data-id={objId ?? `stack:${entryId}`}
                aria-disabled={!pickable}
                onMouseEnter={(ev) => {
                  onFocus(i);
                  if (objId) onHover(objId, ev.currentTarget);
                }}
                onMouseLeave={() => {
                  onFocus(null);
                  onHover(null);
                }}
                onClick={() => {
                  if (!pickable) return;
                  if (entryId && pick?.entries.has(entryId)) pick.onPick({ kind: 'ability', entry: entryId });
                  else if (objId && pick?.objects.has(objId)) pick.onPick({ kind: 'object', object: objId });
                }}
                aria-label={`${e.kind === 'spell' ? publicName(e.object, g) : `${e.sourceName}’s ability`}${targets.length ? `, targeting ${targets.join(', ')}` : ''}`}
              >
                {shown ? (
                  <CardView card={shown.card} faceIndex={shown.face} sizes="146px" />
                ) : (
                  <span className="ability-card">
                    {srcShown && (
                      <span className="ability-src">
                        <CardView card={srcShown.card} faceIndex={srcShown.face} sizes="60px" />
                      </span>
                    )}
                    <strong>{e.kind === 'ability' ? e.sourceName : ''}</strong>
                    <span className="ability-text">{e.kind === 'ability' ? <RulesText text={e.text} /> : ''}</span>
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
  );
}

// ---------------------------------------------------------------------------
// Menus, previews, dialogs
// ---------------------------------------------------------------------------

/**
 * A card's actions, in a small menu at the card. For a permanent its player controls, every activated ability it has
 * is there, in the order the card prints them: the ways each can be used now, or the ability greyed out with why not.
 */
function CardMenu({ g, view, viewer, id, rect, actions, extra, onChoose, onView, onClose }: { g: GameState; view: PlayerView; viewer: PlayerId | null; id: string; rect: DOMRect; actions: Action[]; extra: Action[]; onChoose: (a: Action) => void; onView: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: rect.left, top: rect.top });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.left + rect.width / 2 - w / 2));
    const above = rect.top - hgt - 8;
    const top = above > 8 ? above : Math.max(8, Math.min(window.innerHeight - hgt - 8, rect.bottom + 8));
    setPos({ left, top });
  }, [rect]);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener('pointerdown', away), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', away);
    };
  }, [onClose]);
  useEffect(() => ref.current?.querySelector<HTMLButtonElement>('button')?.focus(), []);
  // One X picker for each spell face or ability that takes an X.
  const xGroups = new Map<string, Choosing[]>();
  for (const a of extra) {
    if ((a.type !== 'cast' && a.type !== 'activate') || a.x === undefined || (a.type === 'cast' && a.kicked)) continue;
    const key = a.type === 'cast' ? `cast:${a.face ?? 0}:${a.alt ?? ''}` : `activate:${a.ability}`;
    xGroups.set(key, [...(xGroups.get(key) ?? []), a]);
  }
  const kicks = extra.filter((a) => a.type === 'cast' && a.kicked);
  // The permanent's abilities (none for a card in hand or one somebody else controls), and what each mana ability
  // would add, worked out once for as long as the menu shows this state.
  const rows = useMemo(() => (viewer ? abilityRows(g, viewer, id, actions) : []), [g, viewer, id, actions]);
  const made = useMemo(() => new Map(rows.flatMap((r) => (r.mana ? r.actions : [])).map((a) => [a, a.type === 'activate_mana' ? manaPreview(g, a) : null])), [g, rows]);
  const inRows = new Set(rows.flatMap((r) => r.actions));
  const rowKeys = new Set(rows.filter((r) => !r.mana).map((r) => `activate:${r.index}`));
  // Everything else it can do: cast it, play it, turn it face up, lines resolved by hand. (An X is asked for below.)
  const others = [...actions.filter((a) => !inRows.has(a) && !hasXRange(a)), ...kicks];
  const label = (a: Action) => {
    const m = made.get(a);
    return m ? previewLabel(m) : actionLabel(g, a);
  };
  return (
    <div ref={ref} className="card-menu" role="menu" aria-label={publicName(id, view as unknown as GameState)} style={{ left: pos.left, top: pos.top }}>
      <p className="menu-title">{publicName(id, view as unknown as GameState)}</p>
      {others.map((a, i) => (
        <button key={i} type="button" role="menuitem" className={`menu-item${a.type === 'activate_mana' ? ' mana' : ''}`} onClick={() => onChoose(a)}>
          <RulesText text={actionLabel(g, a)} />
        </button>
      ))}
      {[...xGroups].filter(([key]) => !rowKeys.has(key)).map(([key, xs]) => (
        <XCast key={key} g={g} options={xs} onChoose={onChoose} />
      ))}
      {rows.map((row) => {
        const xs = row.mana ? undefined : xGroups.get(`activate:${row.index}`);
        if (!row.actions.length && !xs) {
          return (
            <p key={row.key} className="menu-item unavailable" title={row.detail}>
              <span className="menu-ability">
                <RulesText text={row.text} />
              </span>
              <span className="menu-why">{row.why}</span>
            </p>
          );
        }
        // A mana ability with a choice of mana: the ability once, then each thing it could add.
        const several = row.mana && row.actions.length > 1;
        return (
          <div key={row.key} className="menu-group">
            {several && (
              <p className="menu-ability-text">
                <RulesText text={row.text} />
              </p>
            )}
            {row.actions.map((a, i) => {
              const spend = made.get(a)?.spend;
              return (
                <button key={i} type="button" role="menuitem" className={`menu-item${row.mana ? ' mana' : ''}`} title={row.text} onClick={() => onChoose(a)}>
                  <span>
                    <RulesText text={label(a)} />
                  </span>
                  {spend && !several && <span className="menu-hint">only for {spendText(spend)}</span>}
                </button>
              );
            })}
            {xs && <XCast g={g} options={xs} onChoose={onChoose} />}
          </div>
        );
      })}
      <button type="button" role="menuitem" className="menu-item quiet" onClick={onView}>
        View card
      </button>
    </div>
  );
}

function XCast({ g, options, onChoose }: { g: GameState; options: Choosing[]; onChoose: (a: Action) => void }) {
  const values = options.map((a) => a.x ?? 0);
  const [x, setX] = useState(values[values.length - 1] ?? 0);
  const a = options.find((o) => o.x === x) ?? options[0]!;
  return (
    <div className="x-cast">
      <label>
        X
        <select value={x} onChange={(e) => setX(Number(e.target.value))}>
          {values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <button type="button" role="menuitem" className="menu-item" onClick={() => onChoose(a)}>
        {actionLabel(g, a)}
      </button>
    </div>
  );
}

/** The whole card, large, beside the card under the pointer, with any lines you resolve by hand. */
function HoverPreview({ view, id, rect }: { view: PlayerView; id: string; rect: DOMRect }) {
  const o = view.objects[id];
  if (!o) return null;
  const shown = shownCard(view.cards, o);
  if (!shown) return null;
  const w = Math.min(300, Math.max(230, window.innerHeight * 0.32));
  const hgt = w * (88 / 63);
  const left = rect.right + 16 + w < window.innerWidth - 8 ? rect.right + 16 : Math.max(8, rect.left - 16 - w);
  const top = Math.max(54, Math.min(rect.top + rect.height / 2 - hgt / 2, window.innerHeight - hgt - 8));
  const face = shown.card.faces[shown.face] ?? shown.card.faces[0]!;
  const lines = annotateOracle(face).filter((l) => l.status === 'manual');
  return (
    <div className="hover-preview" aria-hidden="true" style={{ left, top, width: w }}>
      <span className="preview-card">
        <CardView card={shown.card} faceIndex={shown.face} sizes={`${Math.round(w)}px`} eager />
      </span>
      {lines.length > 0 && (
        <div className="preview-manual">
          <p>Resolve by hand:</p>
          {lines.map((l, i) => (
            <p key={i}>
              <RulesText text={l.text} />
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function CardViewer({ view, id, onClose }: { view: PlayerView; id: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const o = view.objects[id];
  const shown = o ? shownCard(view.cards, o) : null;
  const card = shown?.card;
  return (
    <dialog ref={ref} className="sheet card-viewer" onClose={onClose} aria-label={card?.name ?? 'Card'}>
      <form method="dialog" className="sheet-inner viewer-inner">
        <span className="viewer-card">{card ? <CardView card={card} faceIndex={shown!.face} sizes="340px" eager /> : <CardBackFace />}</span>
        {card && (
          <div className="viewer-text">
            <h2>{card.faces[shown!.face]?.name ?? card.name}</h2>
            <p className="viewer-auto">
              <AutomationMark level={card.automation} size={13} /> {AUTOMATION_LABEL[card.automation]} — {automationHint(card)}
            </p>
            <TestPlayIssues card={card} />
            {annotateOracle(card.faces[shown!.face] ?? card.faces[0]!).map((l, i) => (
              <p key={i} className={`oracle-line line-${l.status}`}>
                <RulesText text={l.text} />
              </p>
            ))}
          </div>
        )}
        <button type="submit" className="ghost viewer-close">
          Close
        </button>
      </form>
    </dialog>
  );
}

function GameOver({ g, onNew }: { g: GameState; onNew: () => void }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div className="game-over" role="status">
      <p className="over-title">{g.winner ? asYou(`${g.players[g.winner]!.name} wins`) : 'The game is a draw'}</p>
      <div className="btn-row">
        <button type="button" className="primary" onClick={onNew}>
          New game
        </button>
        <button type="button" className="ghost" onClick={() => setHidden(true)}>
          Look at the table
        </button>
      </div>
    </div>
  );
}

function StopsEditor({ stops, onChange, name, mode, onClose }: { stops: Stops; onChange: (s: Stops) => void; name: string; mode: Mode; onClose: () => void }) {
  const steps: Step[] = ['upkeep', 'draw', 'main1', 'beginning_of_combat', 'declare_attackers', 'declare_blockers', 'combat_damage', 'end_of_combat', 'main2', 'end'];
  const toggle = (list: Step[], s: Step) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]);
  type Pick2 = { mine: Step[]; theirs: Step[] };
  const same = (a: Step[], b: Step[]) => a.length === b.length && b.every((x) => a.includes(x));
  const usual = defaultStops(mode);
  return (
    <div className="stops-pop" role="dialog" aria-label="Stops">
      <p className="pop-title">{name === 'You' ? 'Where you stop' : `Where ${name} stops`}</p>
      <p className="hint">
        At these steps the game waits for you, whether or not you have anything to do there. Everywhere else, with nothing on the stack, priority is passed for you. Combat choices and anything you could answer always stop. To stop somewhere once, click that step in the turn bar.
      </p>
      <div className="stops-presets" role="group" aria-label="Presets">
        {(
          [
            [mode === 'solo' ? 'Main phases, and the other turn' : 'Main phases', { mine: usual.mine, theirs: usual.theirs }],
            ['Every step of my turn', { mine: steps, theirs: usual.theirs }],
            ['Every step of every turn', { mine: steps, theirs: steps }],
          ] as [string, Pick2][]
        ).map(([label, v]) => {
          const on = same(stops.mine, v.mine) && same(stops.theirs, v.theirs);
          return (
            <button key={label} type="button" className={on ? 'chip-btn selected' : 'chip-btn'} aria-pressed={on} onClick={() => onChange({ ...stops, mine: [...v.mine], theirs: [...v.theirs], ...(v.mine.length > 2 ? { skipIfNothing: false } : {}) })}>
              {label}
            </button>
          );
        })}
      </div>
      {(['mine', 'theirs'] as const).map((k) => (
        <div key={k} className="stops-row">
          <span className="stops-label">{k === 'mine' ? 'Your turn' : mode === 'solo' ? 'The other turn' : 'Their turns'}</span>
          <span className="chip-row">
            {steps.map((s) => (
              <button key={s} type="button" className={stops[k].includes(s) ? 'chip-btn selected' : 'chip-btn'} aria-pressed={stops[k].includes(s)} onClick={() => onChange({ ...stops, [k]: toggle(stops[k], s) })}>
                {STEP_NAME[s].replace(/ step$/, '')}
              </button>
            ))}
          </span>
        </div>
      ))}
      <label className="check small">
        <input type="checkbox" checked={stops.skipIfNothing} onChange={(e) => onChange({ ...stops, skipIfNothing: e.target.checked })} />
        Skip a stop when there is nothing I could do there but make mana
      </label>
      <label className="check small">
        <input type="checkbox" checked={stops.hold} onChange={(e) => onChange({ ...stops, hold: e.target.checked })} />
        Hold priority: ask me while my own spell or ability is on the stack
      </label>
      <p className="hint keys">Keys: Space or Enter for the main button. F2 pass, F4 to the end step, F6 end the turn, H hold priority, Z undo, Esc cancel. Shift+click a card to cast it and hold priority once.</p>
      <button type="button" className="ghost tiny" onClick={onClose}>
        Done
      </button>
    </div>
  );
}

function LogDrawer({ log, viewer, all, names, onClose }: { log: LogLine[]; viewer: PlayerId | null; all: boolean; names: Record<PlayerId, string> | null; onClose: () => void }) {
  const ref = useRef<HTMLOListElement>(null);
  const shown = log.filter((l) => lineFor(l, viewer, all)).slice(-400);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length]);
  return (
    <aside className="log-drawer" aria-label="Game log">
      <header>
        <h2>Log</h2>
        <button type="button" className="ghost tiny" onClick={onClose}>
          Close
        </button>
      </header>
      <ol className="log" ref={ref}>
        {shown.map((l) => (
          <li key={l.id} className={`log-${l.kind}${l.only ? ' private' : ''}`}>
            <RulesText text={l.only && names ? `${names[l.only]}: ${l.text}` : asYou(l.text)} />
          </li>
        ))}
      </ol>
    </aside>
  );
}

function Curtain({ g, who, log, onReady }: { g: GameState; who: PlayerId; log: LogLine[]; onReady: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), [who]);
  const recent = log.filter((l) => !l.only).slice(-5);
  const reason = g.pending ? choiceTitle(g.pending) : 'Priority';
  return (
    <div className="curtain" role="dialog" aria-modal="true" aria-labelledby="curtain-title">
      <div className="curtain-inner">
        <p className="muted">{reason}</p>
        <h2 id="curtain-title">Pass to {g.players[who]!.name}</h2>
        <p className="muted">Everyone else, look away — the next screen shows {g.players[who]!.name}’s hand.</p>
        {recent.length > 0 && (
          <ol className="curtain-log">
            {recent.map((l) => (
              <li key={l.id}>
                <RulesText text={l.text} />
              </li>
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

function ZoneDialog({ g, view, player, zone, h, onClose }: { g: GameState; view: PlayerView; player: PlayerId; zone: 'graveyard' | 'exile'; h: BoardHandlers; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const ids = zone === 'graveyard' ? [...(g.zones.graveyard[player] ?? [])].reverse() : g.zones.exile.filter((id) => g.objects[id]?.owner === player);
  return (
    <dialog ref={ref} className="sheet zone-dialog" onClose={onClose} aria-labelledby="zone-title">
      <form method="dialog" className="sheet-inner">
        <header className="sheet-head">
          <h2 id="zone-title">
            {asYou(`${g.players[player]!.name}’s ${zone}`)} <span className="muted">{ids.length}</span>
          </h2>
          <button type="submit" className="ghost">
            Close
          </button>
        </header>
        {ids.some((id) => h.actionable.has(id)) && <p className="hint">Lit cards can be played now.</p>}
        {ids.length === 0 ? (
          <p className="muted">Empty.</p>
        ) : (
          <div className="zone-grid">
            {ids.map((id) => {
              const o = view.objects[id];
              const shown = o ? shownCard(view.cards, o) : null;
              const can = h.actionable.has(id);
              return (
                <button
                  key={id}
                  type="button"
                  data-id={id}
                  className={cardClass(id, h, 'zone-card')}
                  onClick={(e) => {
                    if (!can) return;
                    h.onCard(id, e.currentTarget);
                    ref.current?.close();
                  }}
                  onMouseEnter={(e) => h.onHover(id, e.currentTarget)}
                  onMouseLeave={() => h.onHover(null)}
                  aria-label={o ? publicName(id, view as unknown as GameState) : 'Face-down card'}
                >
                  {shown ? <CardView card={shown.card} faceIndex={shown.face} sizes="160px" /> : <CardBackFace />}
                </button>
              );
            })}
          </div>
        )}
      </form>
    </dialog>
  );
}
