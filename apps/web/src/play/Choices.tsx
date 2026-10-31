import {
  attackRestriction,
  attackTax,
  blockDeclarationProblem,
  blockProblem,
  chars,
  choiceModes,
  choicePrompts,
  mustAttack,
  type Action,
  type AttackTarget,
  type ChoiceAnswer,
  type DamageAssignment,
  type GameState,
  type ModeMenu,
  type PendingChoice,
  type PlayerId,
  type PlayerView,
  type Target,
  type TargetPrompt,
  type ZoneName,
} from '@mtg/engine';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RulesText } from '../components/bits';
import { TableCard } from './cards';
import { actionLabel, sameTarget, targetLabel } from './labels';
import { publicName } from './log';
import { liveCandidates, pickOf, promptRange, type Pick } from './pick';

type SetPick = (p: Pick | null) => void;

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

export function ObjectTile({ view, id, selected, onClick, note, disabled }: { view: PlayerView; id: string; selected?: boolean; onClick?: () => void; note?: string; disabled?: boolean }) {
  const o = view.objects[id];
  const name = o ? publicName(id, view as unknown as GameState) : 'Hidden card';
  return (
    <button type="button" className={selected ? 'pick-tile selected' : 'pick-tile'} onClick={onClick} disabled={disabled || !onClick} aria-pressed={selected}>
      <span className="pick-card">{o ? <TableCard cards={view.cards} o={o} sizes="76px" /> : <span className="card-back" />}</span>
      <span className="pick-name">{note ? `${note} · ${name}` : name}</span>
    </button>
  );
}

function TargetChip({ g, t, selected, onClick }: { g: GameState; t: Target; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" className={selected ? 'chip-btn selected' : 'chip-btn'} onClick={onClick} aria-pressed={selected}>
      {targetLabel(g, t)}
    </button>
  );
}

function Confirm({ ok, label = 'Confirm', why, onClick, children }: { ok: boolean; label?: string; why?: string | null; onClick: () => void; children?: React.ReactNode }) {
  return (
    <div className="confirm-row">
      {why && <p className="hint warn">{why}</p>}
      <div className="btn-row">
        <button type="button" className="primary" disabled={!ok} onClick={onClick}>
          {label}
        </button>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

export function ModePicker({
  menu,
  initial,
  onDone,
  onCancel,
  feasible,
}: {
  menu: ModeMenu;
  initial?: number[];
  onDone: (modes: number[]) => void;
  onCancel?: () => void;
  /** Whether these modes can be chosen now (CR 700.2: not a mode whose targets can't be chosen). */
  feasible?: (modes: number[]) => boolean;
}) {
  const [modes, setModes] = useState<number[]>(() => (initial && (!feasible || feasible(initial)) ? initial : []));
  const blocked = useMemo(() => new Set(menu.options.map((_, i) => i).filter((i) => feasible && !feasible([i]))), [menu, feasible]);
  const toggle = (i: number) => {
    if (menu.repeat) setModes([...modes, i].sort((a, b) => a - b));
    else if (modes.includes(i)) setModes(modes.filter((m) => m !== i));
    else if (menu.max === 1) setModes([i]);
    else if (modes.length < menu.max) setModes([...modes, i].sort((a, b) => a - b));
  };
  const fits = !feasible || modes.length === 0 || feasible(modes);
  const ok = modes.length >= menu.min && modes.length <= menu.max && fits;
  return (
    <div className="flow-step">
      <p className="flow-title">
        Choose {menu.min === menu.max ? menu.min : `${menu.min}–${menu.max}`} mode{menu.max === 1 ? '' : 's'}
        {menu.repeat ? ' (a mode can be chosen more than once)' : ''}
      </p>
      <ul className="mode-list">
        {menu.options.map((opt, i) => {
          const n = modes.filter((m) => m === i).length;
          const used = menu.used.includes(i);
          const noTargets = blocked.has(i);
          return (
            <li key={i}>
              <button type="button" className={n ? 'mode selected' : 'mode'} disabled={used || noTargets} onClick={() => toggle(i)} aria-pressed={n > 0}>
                <span className="mode-text">
                  <RulesText text={opt.text} />
                </span>
                {opt.cost && <span className="mode-cost">+{opt.cost}</span>}
                {opt.manual && <span className="mode-manual">resolve by hand</span>}
                {used && <span className="mode-manual">already chosen</span>}
                {noTargets && !used && <span className="mode-manual">no legal targets</span>}
                {n > 1 && <span className="mode-cost">×{n}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <Confirm ok={ok} why={fits ? null : 'There aren’t enough legal targets for these modes together.'} label="Next" onClick={() => onDone(modes)}>
        {menu.repeat && modes.length > 0 && (
          <button type="button" className="ghost" onClick={() => setModes([])}>
            Clear
          </button>
        )}
        {onCancel && (
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </Confirm>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Targets: one prompt at a time, candidates from the engine only.
// ---------------------------------------------------------------------------

export function TargetPicker({
  g,
  view,
  prompts,
  defaults,
  setPick,
  onDone,
  onCancel,
  doneLabel = 'Confirm',
}: {
  g: GameState;
  view: PlayerView;
  prompts: TargetPrompt[];
  defaults?: Target[][];
  setPick: SetPick;
  onDone: (targets: Target[][]) => void;
  onCancel?: () => void;
  doneLabel?: string;
}) {
  const [picked, setPicked] = useState<Target[][]>(() => prompts.map(() => []));
  const [at, setAt] = useState(0);
  const pr = prompts[at];
  const candidates = useMemo(() => (pr ? liveCandidates(g, prompts, picked, at) : []), [g, prompts, picked, at, pr]);
  const [lo, hi] = pr ? promptRange(pr) : [0, 0];
  const mine = picked[at] ?? [];
  const enough = mine.length >= lo && mine.length <= hi;

  const toggle = (t: Target) => {
    const has = mine.some((m) => sameTarget(m, t));
    const next = has ? mine.filter((m) => !sameTarget(m, t)) : hi === 1 ? [t] : mine.length < hi ? [...mine, t] : mine;
    const all = picked.map((list, i) => (i === at ? next : i > at ? [] : list));
    setPicked(all);
  };

  useEffect(() => {
    if (!pr) return;
    setPick(pickOf(candidates, mine, toggle));
    return () => setPick(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, mine, pr]);

  if (!pr) return null;
  const last = at === prompts.length - 1;
  const next = () => (last ? onDone(picked) : setAt(at + 1));
  const players = candidates.filter((t) => t.kind === 'player');
  const objects = candidates.filter((t) => t.kind === 'object');
  const entries = candidates.filter((t) => t.kind === 'ability');
  return (
    <div className="flow-step">
      <p className="flow-title">
        {prompts.length > 1 && <span className="step-count">{at + 1}/{prompts.length} · </span>}
        Choose {pr.upTo ? (lo ? `${lo} to ${hi}` : `up to ${hi}`) : hi}: <RulesText text={pr.text} />
      </p>
      {candidates.length === 0 ? (
        <p className="hint">No legal choices for this one.</p>
      ) : (
        <p className="hint">Click a highlighted card or player, or pick below. {mine.length}/{hi} chosen.</p>
      )}
      {players.length > 0 && (
        <div className="chip-row">
          {players.map((t) => (
            <TargetChip key={targetLabel(g, t)} g={g} t={t} selected={mine.some((m) => sameTarget(m, t))} onClick={() => toggle(t)} />
          ))}
        </div>
      )}
      {entries.length > 0 && (
        <div className="chip-row">
          {entries.map((t) => (
            <TargetChip key={t.kind === 'ability' ? t.entry : ''} g={g} t={t} selected={mine.some((m) => sameTarget(m, t))} onClick={() => toggle(t)} />
          ))}
        </div>
      )}
      {objects.length > 0 && (
        <div className="tile-row">
          {objects.map((t) =>
            t.kind === 'object' ? <ObjectTile key={t.object} view={view} id={t.object} selected={mine.some((m) => sameTarget(m, t))} onClick={() => toggle(t)} /> : null,
          )}
        </div>
      )}
      <Confirm ok={enough} label={last ? doneLabel : 'Next target'} onClick={next}>
        {at > 0 && (
          <button type="button" className="ghost" onClick={() => setAt(at - 1)}>
            Back
          </button>
        )}
        {defaults && defaults.length === prompts.length && (
          <button type="button" className="ghost" onClick={() => onDone(defaults)}>
            Use suggested
          </button>
        )}
        {onCancel && (
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </Confirm>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A listed cast or activation: modes, then targets, then the action.
// ---------------------------------------------------------------------------

type Choosing = Extract<Action, { type: 'cast' | 'activate' }>;

/** Whether a listed action needs the player to choose anything before it's applied. */
export function needsChoices(g: GameState, a: Action): boolean {
  if (a.type !== 'cast' && a.type !== 'activate') return false;
  try {
    return Boolean(choiceModes(g, a)) || choicePrompts(g, a).length > 0;
  } catch {
    return false;
  }
}

export function ActionFlow({ g, view, action, setPick, onCommit, onCancel }: { g: GameState; view: PlayerView; action: Choosing; setPick: SetPick; onCommit: (a: Action) => void; onCancel: () => void }) {
  const menu = useMemo(() => {
    try {
      return choiceModes(g, action);
    } catch {
      return null;
    }
  }, [g, action]);
  const [modes, setModes] = useState<number[] | null>(menu ? null : (action.modes ?? null));
  // A mode set is choosable if every target it asks for has enough legal candidates.
  const feasible = useCallback(
    (m: number[]) => {
      try {
        return choicePrompts(g, action, m).every((pr) => pr.candidates.length >= promptRange(pr)[0]);
      } catch {
        return false;
      }
    },
    [g, action],
  );
  const prompts = useMemo((): { list: TargetPrompt[] } | { error: string } | null => {
    if (menu && !modes) return null;
    try {
      return { list: choicePrompts(g, action, modes ?? action.modes) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, [g, action, menu, modes]);

  const finish = (targets?: Target[][]) => {
    const out: Choosing = { ...action, ...(menu && modes ? { modes } : {}) };
    if (targets) out.targets = targets;
    else if (prompts && 'list' in prompts && !prompts.list.length) delete out.targets;
    onCommit(out);
  };

  useEffect(() => {
    if (prompts && 'list' in prompts && prompts.list.length === 0) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompts]);

  // What's being cast or activated stays in view while its choices are made.
  const head = (
    <p className="prompt-kind">
      {actionLabel(g, action)} · {publicName(action.object, g)}
    </p>
  );
  if (menu && !modes)
    return (
      <div>
        {head}
        <ModePicker menu={menu} initial={action.modes} onDone={setModes} onCancel={onCancel} feasible={feasible} />
      </div>
    );
  if (!prompts) return null;
  if ('error' in prompts)
    return (
      <div className="flow-step">
        {head}
        <p className="hint warn">{prompts.error}</p>
        <button type="button" className="ghost" onClick={onCancel}>
          Back
        </button>
      </div>
    );
  if (!prompts.list.length) return null;
  const sameModes = JSON.stringify(modes ?? action.modes ?? null) === JSON.stringify(action.modes ?? null);
  return (
    <div>
      {head}
      <TargetPicker g={g} view={view} prompts={prompts.list} {...(sameModes && action.targets ? { defaults: action.targets } : {})} setPick={setPick} onDone={finish} onCancel={onCancel} doneLabel="Confirm" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Choosing objects (cards to discard, sacrifice, keep, search for…)
// ---------------------------------------------------------------------------

export function ObjectPicker({
  view,
  candidates,
  min,
  max,
  ordered,
  label,
  title,
  setPick,
  onDone,
  extraOk,
  children,
}: {
  view: PlayerView;
  candidates: string[];
  min: number;
  max: number;
  ordered?: boolean;
  label: string;
  title: React.ReactNode;
  setPick: SetPick;
  onDone: (ids: string[]) => void;
  extraOk?: (ids: string[]) => string | null;
  children?: React.ReactNode;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : max === 1 ? [id] : c.length < max ? [...c, id] : c));
  // Keyed on the candidates' contents: callers may pass a new array each render.
  const key = candidates.join('|');
  useEffect(() => {
    setPick(pickOf(candidates.map((object) => ({ kind: 'object', object })), chosen.map((object) => ({ kind: 'object', object })), (t) => t.kind === 'object' && toggle(t.object)));
    return () => setPick(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, chosen]);
  const problem = chosen.length < min ? `Choose ${min === max ? min : `at least ${min}`}.` : (extraOk?.(chosen) ?? null);
  return (
    <div className="flow-step">
      <p className="flow-title">{title}</p>
      <p className="hint">
        {min === max ? `Choose ${min}` : max >= candidates.length && min === 0 ? 'Choose any number' : `Choose ${min}–${max}`}
        {ordered ? ' (in order: the first you pick comes first)' : ''}. {chosen.length} chosen.
      </p>
      <div className="tile-row">
        {candidates.map((id) => (
          <ObjectTile key={id} view={view} id={id} selected={chosen.includes(id)} onClick={() => toggle(id)} {...(ordered && chosen.includes(id) ? { note: `#${chosen.indexOf(id) + 1}` } : {})} />
        ))}
      </div>
      {children}
      <Confirm ok={!problem && chosen.length <= max} why={chosen.length ? problem : null} label={label} onClick={() => onDone(chosen)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ordering cards (scry, surveil)
// ---------------------------------------------------------------------------

function OrderPicker({ view, objects, other, reorder, onDone }: { view: PlayerView; objects: string[]; other: 'bottom' | 'graveyard'; reorder?: boolean; onDone: (top: string[], rest: string[]) => void }) {
  const [top, setTop] = useState<string[]>(objects);
  const [rest, setRest] = useState<string[]>([]);
  const move = (id: string) => {
    if (reorder) return;
    if (top.includes(id)) {
      setTop(top.filter((x) => x !== id));
      setRest([...rest, id]);
    } else {
      setRest(rest.filter((x) => x !== id));
      setTop([...top, id]);
    }
  };
  const up = (id: string) => {
    const i = top.indexOf(id);
    if (i <= 0) return;
    const next = [...top];
    [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
    setTop(next);
  };
  return (
    <div className="flow-step">
      <p className="hint">Top of library (first is on top){reorder ? '' : ` — click a card to move it to the ${other}`}:</p>
      <div className="tile-row">
        {top.map((id, i) => (
          <div key={id} className="order-cell">
            <ObjectTile view={view} id={id} note={`${i + 1}`} {...(reorder ? {} : { onClick: () => move(id) })} />
            {i > 0 && (
              <button type="button" className="ghost tiny" onClick={() => up(id)}>
                ↑ earlier
              </button>
            )}
          </div>
        ))}
      </div>
      {!reorder && (
        <>
          <p className="hint">{other === 'bottom' ? 'Bottom of library' : 'Graveyard'}:</p>
          <div className="tile-row">
            {rest.length === 0 && <span className="hint">None</span>}
            {rest.map((id) => (
              <ObjectTile key={id} view={view} id={id} onClick={() => move(id)} />
            ))}
          </div>
        </>
      )}
      <Confirm ok label="Confirm" onClick={() => onDone(top, rest)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

function attackTargetLabel(g: GameState, t: AttackTarget) {
  return t.kind === 'player' ? (g.players[t.player]?.name ?? t.player) : publicName(t.object, g);
}
const atKey = (t: AttackTarget) => (t.kind === 'player' ? `p:${t.player}` : `o:${t.object}`);

function AttackersPanel({ g, p, setPick, answer }: { g: GameState; p: Extract<PendingChoice, { kind: 'declare_attackers' }>; setPick: SetPick; answer: (a: ChoiceAnswer) => void }) {
  // Each attacker's legal targets (CR 508.1c restrictions checked by the engine's own test).
  const options = useMemo(() => Object.fromEntries(p.attackers.map((id) => [id, p.targets.filter((t) => !attackRestriction(g, g.objects[id]!, t))])), [g, p]);
  const [plan, setPlan] = useState<Record<string, string>>(() => Object.fromEntries(p.attackers.filter((id) => mustAttack(g, g.objects[id]!) && options[id]?.length).map((id) => [id, atKey(options[id]![0]!)])));
  const [exert, setExert] = useState<string[]>([]);
  const toggle = (id: string) => {
    const opts = options[id] ?? [];
    if (!opts.length) return;
    setPlan((pl) => {
      const next = { ...pl };
      if (next[id]) delete next[id];
      else next[id] = atKey(opts[0]!);
      return next;
    });
  };
  useEffect(() => {
    setPick(pickOf(p.attackers.map((object) => ({ kind: 'object', object })), Object.keys(plan).map((object) => ({ kind: 'object', object })), (t) => t.kind === 'object' && toggle(t.object)));
    return () => setPick(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, p]);
  const attacks = Object.entries(plan).map(([attacker, key]) => ({ attacker, target: (options[attacker] ?? []).find((t) => atKey(t) === key)! })).filter((a) => a.target);
  const tax = attacks.length ? attackTax(g, attacks) : '';
  return (
    <div className="flow-step">
      <p className="flow-title">Declare attackers</p>
      <p className="hint">Click creatures on your battlefield (or below) to attack with them.</p>
      <ul className="combat-list">
        {p.attackers.map((id) => {
          const opts = options[id] ?? [];
          const on = Boolean(plan[id]);
          return (
            <li key={id} className={on ? 'on' : ''}>
              <label className="check">
                <input type="checkbox" checked={on} disabled={!opts.length} onChange={() => toggle(id)} />
                {publicName(id, g)}
                {mustAttack(g, g.objects[id]!) && <span className="tag">must attack</span>}
              </label>
              {on && opts.length > 1 && (
                <select value={plan[id]} onChange={(e) => setPlan({ ...plan, [id]: e.target.value })}>
                  {opts.map((t) => (
                    <option key={atKey(t)} value={atKey(t)}>
                      → {attackTargetLabel(g, t)}
                    </option>
                  ))}
                </select>
              )}
              {on && opts.length === 1 && <span className="muted">→ {attackTargetLabel(g, opts[0]!)}</span>}
              {on && p.exertable?.includes(id) && (
                <label className="check small">
                  <input type="checkbox" checked={exert.includes(id)} onChange={() => setExert(exert.includes(id) ? exert.filter((x) => x !== id) : [...exert, id])} />
                  exert
                </label>
              )}
            </li>
          );
        })}
      </ul>
      {tax && <p className="hint warn">Attacking this way costs {tax}; it’s paid automatically if you can.</p>}
      <Confirm ok label={attacks.length ? `Attack with ${attacks.length}` : 'No attack'} onClick={() => answer({ kind: 'declare_attackers', attacks, ...(exert.length ? { exert: exert.filter((x) => plan[x]) } : {}) })}>
        <button type="button" className="ghost" onClick={() => setPlan(Object.fromEntries(p.attackers.filter((id) => options[id]?.length).map((id) => [id, atKey(options[id]![0]!)])))}>
          All
        </button>
        <button type="button" className="ghost" onClick={() => setPlan({})}>
          None
        </button>
      </Confirm>
    </div>
  );
}

function BlockersPanel({ g, p, me, setPick, answer }: { g: GameState; p: Extract<PendingChoice, { kind: 'declare_blockers' }>; me: PlayerId; setPick: SetPick; answer: (a: ChoiceAnswer) => void }) {
  const can = useMemo(() => Object.fromEntries(p.blockers.map((b) => [b, p.attackers.filter((a) => !blockProblem(g, g.objects[b]!, g.objects[a]!))])), [g, p]);
  const extra = useMemo(() => Object.fromEntries(p.blockers.map((b) => [b, chars(g, g.objects[b]!).combat.reduce((n, r) => n + (r.extraBlocks ?? 0), 0)])), [g, p]);
  const [plan, setPlan] = useState<Record<string, string[]>>({});
  const [armed, setArmed] = useState<string | null>(null);
  const blocks = Object.entries(plan).flatMap(([blocker, list]) => list.map((attacker) => ({ blocker, attacker })));
  const problem = useMemo(() => blockDeclarationProblem(g, me, blocks), [g, me, blocks]);
  const assign = (blocker: string, attacker: string | null) => {
    setPlan((pl) => {
      const next = { ...pl };
      const list = next[blocker] ?? [];
      if (!attacker) delete next[blocker];
      else if (list.includes(attacker)) next[blocker] = list.filter((x) => x !== attacker);
      else next[blocker] = (extra[blocker] ?? 0) > 0 ? [...list, attacker].slice(0, 1 + (extra[blocker] ?? 0)) : [attacker];
      if (next[blocker]?.length === 0) delete next[blocker];
      return next;
    });
  };
  useEffect(() => {
    // Click a blocker, then the attacker it blocks.
    const candidates: Target[] = armed ? (can[armed] ?? []).map((object) => ({ kind: 'object', object })) : p.blockers.filter((b) => (can[b] ?? []).length).map((object) => ({ kind: 'object', object }));
    const chosen: Target[] = armed ? [{ kind: 'object', object: armed }, ...(plan[armed] ?? []).map((object): Target => ({ kind: 'object', object }))] : Object.keys(plan).map((object) => ({ kind: 'object', object }));
    setPick(
      pickOf(candidates, chosen, (t) => {
        if (t.kind !== 'object') return;
        if (armed) {
          assign(armed, t.object);
          setArmed(null);
        } else setArmed(t.object);
      }),
    );
    return () => setPick(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, plan, can]);
  return (
    <div className="flow-step">
      <p className="flow-title">Declare blockers</p>
      <p className="hint">{armed ? `Now click the attacker ${publicName(armed, g)} blocks.` : 'Click one of your creatures, then the attacker it blocks — or use the lists below.'}</p>
      <ul className="combat-list">
        {p.blockers.map((b) => {
          const opts = can[b] ?? [];
          const list = plan[b] ?? [];
          return (
            <li key={b} className={list.length ? 'on' : ''}>
              <span>{publicName(b, g)}</span>
              {opts.length === 0 ? (
                <span className="muted">can’t block these attackers</span>
              ) : (extra[b] ?? 0) > 0 ? (
                <span className="chip-row">
                  {opts.map((a) => (
                    <button key={a} type="button" className={list.includes(a) ? 'chip-btn selected' : 'chip-btn'} onClick={() => assign(b, a)}>
                      {publicName(a, g)}
                    </button>
                  ))}
                </span>
              ) : (
                <select value={list[0] ?? ''} onChange={(e) => assign(b, e.target.value || null)}>
                  <option value="">doesn’t block</option>
                  {opts.map((a) => (
                    <option key={a} value={a}>
                      blocks {publicName(a, g)}
                    </option>
                  ))}
                </select>
              )}
            </li>
          );
        })}
      </ul>
      <Confirm ok={!problem} why={problem} label={blocks.length ? `Block (${blocks.length})` : 'No blocks'} onClick={() => answer({ kind: 'declare_blockers', blocks })} />
    </div>
  );
}

function DamagePanel({ g, p, answer }: { g: GameState; p: Extract<PendingChoice, { kind: 'assign_combat_damage' }>; answer: (a: ChoiceAnswer) => void }) {
  const [plan, setPlan] = useState<Record<string, DamageAssignment[]>>(() => Object.fromEntries(p.choices.map((c) => [c.attacker, c.suggested.map((s) => ({ ...s }))])));
  const recipients = (c: (typeof p.choices)[number]) => {
    const out: DamageAssignment['to'][] = c.blockers.map((object) => ({ kind: 'permanent', object }));
    if (c.trampleTarget) out.push(c.trampleTarget);
    if (c.unblockedTarget && !out.some((r) => JSON.stringify(r) === JSON.stringify(c.unblockedTarget))) out.push(c.unblockedTarget);
    return out;
  };
  const label = (r: DamageAssignment['to']) => (r.kind === 'player' ? (g.players[r.player]?.name ?? r.player) : publicName(r.object, g));
  return (
    <div className="flow-step">
      <p className="flow-title">Assign combat damage</p>
      {p.choices.map((c) => {
        const list = plan[c.attacker] ?? [];
        const total = list.reduce((n, a) => n + a.amount, 0);
        return (
          <div key={c.attacker} className="damage-box">
            <p>
              <strong>{publicName(c.attacker, g)}</strong> — {c.power} damage ({total} assigned)
            </p>
            {recipients(c).map((r) => {
              const k = JSON.stringify(r);
              const cur = list.find((a) => JSON.stringify(a.to) === k)?.amount ?? 0;
              return (
                <label key={k} className="dmg-row">
                  <span>{label(r)}</span>
                  <input
                    type="number"
                    min={0}
                    max={c.power}
                    value={cur}
                    onChange={(e) => {
                      const n = Math.max(0, Math.min(c.power, Number(e.target.value) || 0));
                      const rest = list.filter((a) => JSON.stringify(a.to) !== k);
                      setPlan({ ...plan, [c.attacker]: n ? [...rest, { to: r, amount: n }] : rest });
                    }}
                  />
                </label>
              );
            })}
          </div>
        );
      })}
      <Confirm ok label="Assign" onClick={() => answer({ kind: 'assign_combat_damage', assignments: plan })}>
        <button type="button" className="ghost" onClick={() => setPlan(Object.fromEntries(p.choices.map((c) => [c.attacker, c.suggested.map((s) => ({ ...s }))])))}>
          Suggested
        </button>
      </Confirm>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manual resolution: logged moves by hand, then confirm.
// ---------------------------------------------------------------------------

const MOVE_ZONES: ZoneName[] = ['hand', 'battlefield', 'graveyard', 'exile', 'library', 'command'];

function ManualTools({ g, view, me, act, setPick }: { g: GameState; view: PlayerView; me: PlayerId; act: (a: Action) => void; setPick: SetPick }) {
  const [obj, setObj] = useState<string | null>(null);
  const [counter, setCounter] = useState('+1/+1');
  const [lifeFor, setLifeFor] = useState<PlayerId>(me);
  const [life, setLife] = useState(1);
  // Any card you can see: the battlefield, graveyards, exile, the command zone, your hand.
  const visible = useMemo(() => {
    const ids = [...g.zones.battlefield, ...Object.values(g.zones.graveyard).flat(), ...g.zones.exile, ...g.zones.command, ...(g.zones.hand[me] ?? [])];
    return ids.filter((id) => view.objects[id] && !g.objects[id]?.emblem);
  }, [g, view, me]);
  useEffect(() => {
    setPick(pickOf(visible.map((object) => ({ kind: 'object', object })), obj ? [{ kind: 'object', object: obj }] : [], (t) => t.kind === 'object' && setObj(t.object)));
    return () => setPick(null);
  }, [visible, obj, setPick]);
  const o = obj ? g.objects[obj] : undefined;
  const manual = (op: Extract<Action, { type: 'manual' }>['op']) => act({ type: 'manual', player: me, op });
  return (
    <div className="manual-tools">
      <p className="hint">Make the moves the card says, then press Done. Click any visible card to work on it.</p>
      {o ? (
        <div className="manual-obj">
          <p>
            <strong>{publicName(o.id, g)}</strong> <span className="muted">({o.zone})</span>
          </p>
          <div className="chip-row">
            {MOVE_ZONES.filter((z) => z !== o.zone).map((z) =>
              z === 'library' ? (
                <span key={z} className="chip-row">
                  <button type="button" className="chip-btn" onClick={() => manual({ kind: 'move', object: o.id, to: 'library', position: 'top' })}>
                    → library top
                  </button>
                  <button type="button" className="chip-btn" onClick={() => manual({ kind: 'move', object: o.id, to: 'library', position: 'bottom' })}>
                    → library bottom
                  </button>
                </span>
              ) : (
                <button key={z} type="button" className="chip-btn" onClick={() => manual({ kind: 'move', object: o.id, to: z })}>
                  → {z}
                </button>
              ),
            )}
          </div>
          {o.zone === 'battlefield' && (
            <div className="chip-row">
              <button type="button" className="chip-btn" onClick={() => manual({ kind: 'tap', object: o.id, tapped: !o.tapped })}>
                {o.tapped ? 'Untap' : 'Tap'}
              </button>
              <input className="mini-input" value={counter} onChange={(e) => setCounter(e.target.value)} aria-label="Counter kind" />
              <button type="button" className="chip-btn" onClick={() => manual({ kind: 'counters', object: o.id, counter, delta: 1 })}>
                +1 counter
              </button>
              <button type="button" className="chip-btn" disabled={!(o.counters[counter] ?? 0)} onClick={() => manual({ kind: 'counters', object: o.id, counter, delta: -1 })}>
                −1 counter
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="hint">No card selected.</p>
      )}
      <div className="chip-row">
        <select value={lifeFor} onChange={(e) => setLifeFor(e.target.value)} aria-label="Player">
          {g.order.filter((p) => !g.players[p]!.lost).map((p) => (
            <option key={p} value={p}>
              {g.players[p]!.name}
            </option>
          ))}
        </select>
        <input className="mini-input" type="number" value={life} onChange={(e) => setLife(Number(e.target.value) || 0)} aria-label="Life change" />
        <button type="button" className="chip-btn" onClick={() => manual({ kind: 'life', target: lifeFor, delta: -Math.abs(life) })}>
          lose life
        </button>
        <button type="button" className="chip-btn" onClick={() => manual({ kind: 'life', target: lifeFor, delta: Math.abs(life) })}>
          gain life
        </button>
        <button type="button" className="chip-btn" onClick={() => manual({ kind: 'draw', count: 1 })}>
          draw a card
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The pending choice, whatever it is.
// ---------------------------------------------------------------------------

export const CHOICE_TITLE: Record<PendingChoice['kind'], string> = {
  mulligan: 'Keep or mulligan',
  bottom_cards: 'Put cards on the bottom',
  opening_battlefield: 'Opening hand',
  discard_to_hand_size: 'Discard to hand size',
  keep_tapped: 'Untap step',
  untap_limit: 'Untap step',
  dredge: 'Dredge?',
  legend_rule: 'Legend rule',
  manual_resolution: 'Resolve by hand',
  declare_attackers: 'Declare attackers',
  declare_blockers: 'Declare blockers',
  assign_combat_damage: 'Combat damage',
  trigger_targets: 'Triggered ability',
  scry: 'Scry',
  surveil: 'Surveil',
  discard: 'Discard',
  may: 'Optional',
  choose_option: 'Choose',
  cast_free: 'Cast it?',
  copy_targets: 'Copy’s targets',
  pay: 'Pay?',
  search: 'Search',
  sacrifice: 'Sacrifice',
  proliferate: 'Proliferate',
  choose_objects: 'Choose',
  as_enters: 'As it enters',
};

export function ChoicePanel({ g, view, pending, me, answer, act, setPick }: { g: GameState; view: PlayerView; pending: PendingChoice; me: PlayerId; answer: (a: ChoiceAnswer) => void; act: (a: Action) => void; setPick: SetPick }) {
  const hand = (view.zones.hand[me] as string[] | number) instanceof Array ? (view.zones.hand[me] as string[]) : [];
  const p = pending;
  switch (p.kind) {
    case 'mulligan': {
      const ps = g.players[me]!;
      const next = Math.max(0, ps.mulligans + 1 - (g.config.freeMulligan ? 1 : 0));
      return (
        <div className="flow-step">
          <p className="flow-title">Keep this hand of {hand.length}?</p>
          <p className="hint">
            {ps.mulligans ? `You’ve taken ${ps.mulligans} mulligan${ps.mulligans > 1 ? 's' : ''}. ` : ''}A mulligan draws seven new cards; you then put {next} on the bottom{g.config.freeMulligan && ps.mulligans === 0 ? ' (your first mulligan is free)' : ''}.
          </p>
          <div className="btn-row">
            <button type="button" className="primary" onClick={() => answer({ kind: 'mulligan', keep: true })}>
              Keep
            </button>
            <button type="button" className="secondary" disabled={next >= g.config.startingHandSize} onClick={() => answer({ kind: 'mulligan', keep: false })}>
              Mulligan
            </button>
          </div>
        </div>
      );
    }
    case 'bottom_cards':
      return <ObjectPicker key="bottom" view={view} candidates={hand} min={p.count} max={p.count} label="Put on the bottom" title={`Put ${p.count} card${p.count > 1 ? 's' : ''} from your hand on the bottom of your library`} setPick={setPick} onDone={(objects) => answer({ kind: 'bottom_cards', objects })} />;
    case 'opening_battlefield':
      return <OpeningPanel view={view} p={p} hand={hand} setPick={setPick} answer={answer} />;
    case 'discard_to_hand_size':
      return <ObjectPicker key="dths" view={view} candidates={hand} min={p.count} max={p.count} label="Discard" title={`Discard ${p.count} (maximum hand size)`} setPick={setPick} onDone={(objects) => answer({ kind: 'discard_to_hand_size', objects })} />;
    case 'keep_tapped':
      return <ObjectPicker key="kt" view={view} candidates={p.candidates} min={0} max={p.candidates.length} label="Confirm" title="Choose permanents to keep tapped (you may choose not to untap them)" setPick={setPick} onDone={(objects) => answer({ kind: 'keep_tapped', objects })} />;
    case 'untap_limit':
      return <ObjectPicker key="ul" view={view} candidates={p.candidates} min={0} max={p.n} label="Untap" title={`Choose up to ${p.n} to untap`} setPick={setPick} onDone={(objects) => answer({ kind: 'untap_limit', objects })} />;
    case 'dredge':
      return (
        <div className="flow-step">
          <p className="flow-title">Dredge instead of drawing?</p>
          <div className="tile-row">
            {p.candidates.map((id) => (
              <ObjectTile key={id} view={view} id={id} onClick={() => answer({ kind: 'dredge', object: id })} note="Dredge" />
            ))}
          </div>
          <button type="button" className="primary" onClick={() => answer({ kind: 'dredge', object: null })}>
            Draw normally
          </button>
        </div>
      );
    case 'legend_rule':
      return <ObjectPicker key="lr" view={view} candidates={p.objects} min={1} max={1} label="Keep this one" title={`Legend rule: keep one ${p.name}; the rest go to the graveyard`} setPick={setPick} onDone={([keep]) => keep && answer({ kind: 'legend_rule', keep })} />;
    case 'manual_resolution':
      return (
        <div className="flow-step">
          <p className="flow-title">
            Resolve by hand: <strong>{p.sourceName}</strong>
          </p>
          <blockquote className="manual-text">
            <RulesText text={p.text} />
          </blockquote>
          <ManualTools g={g} view={view} me={me} act={act} setPick={setPick} />
          <Confirm ok label="Done" onClick={() => answer({ kind: 'manual_resolution', done: true })} />
        </div>
      );
    case 'declare_attackers':
      return <AttackersPanel g={g} p={p} setPick={setPick} answer={answer} />;
    case 'declare_blockers':
      return <BlockersPanel g={g} p={p} me={me} setPick={setPick} answer={answer} />;
    case 'assign_combat_damage':
      return <DamagePanel g={g} p={p} answer={answer} />;
    case 'trigger_targets':
      return <TriggerPanel g={g} view={view} p={p} setPick={setPick} answer={answer} />;
    case 'scry':
      return (
        <div>
          <p className="flow-title">Scry {p.objects.length}</p>
          <OrderPicker view={view} objects={p.objects} other="bottom" {...(p.reorder ? { reorder: true } : {})} onDone={(top, bottom) => answer({ kind: 'scry', top, bottom })} />
        </div>
      );
    case 'surveil':
      return (
        <div>
          <p className="flow-title">Surveil {p.objects.length}</p>
          <OrderPicker view={view} objects={p.objects} other="graveyard" onDone={(top, graveyard) => answer({ kind: 'surveil', top, graveyard })} />
        </div>
      );
    case 'discard': {
      const n = Math.min(p.count, hand.length);
      return <ObjectPicker key="disc" view={view} candidates={hand} min={n} max={n} label="Discard" title={`Discard ${p.count}`} setPick={setPick} onDone={(objects) => answer({ kind: 'discard', objects })} />;
    }
    case 'may':
      return (
        <div className="flow-step">
          <p className="flow-title">{p.sourceName}</p>
          <blockquote className="manual-text">
            <RulesText text={p.text} />
          </blockquote>
          <div className="btn-row">
            <button type="button" className="primary" onClick={() => answer({ kind: 'may', yes: true })}>
              Yes
            </button>
            <button type="button" className="secondary" onClick={() => answer({ kind: 'may', yes: false })}>
              No
            </button>
          </div>
        </div>
      );
    case 'choose_option':
      return <OptionsPanel title={p.sourceName} text={p.text} options={p.options} label={(o) => o} onChoose={(choice) => answer({ kind: 'choose_option', choice })} />;
    case 'cast_free':
      return <CastFreePanel g={g} view={view} p={p} setPick={setPick} answer={answer} />;
    case 'copy_targets':
      return <CopyTargetsPanel g={g} view={view} p={p} setPick={setPick} answer={answer} />;
    case 'pay':
      return <PayPanel p={p} answer={answer} />;
    case 'search':
      return (
        <ObjectPicker
          key="search"
          view={view}
          candidates={p.candidates}
          min={p.mustFind ? Math.min(p.count, p.candidates.length) : 0}
          max={Math.min(p.count, p.candidates.length)}
          label="Take these"
          title={
            <>
              Search: <RulesText text={p.text} />
            </>
          }
          setPick={setPick}
          onDone={(objects) => answer({ kind: 'search', objects })}
          extraOk={(ids) => (p.totalMV && ids.reduce((n, id) => n + (p.totalMV!.of[id] ?? 0), 0) > p.totalMV.max ? `Total mana value must be ${p.totalMV.max} or less.` : null)}
        />
      );
    case 'sacrifice':
      return <ObjectPicker key="sac" view={view} candidates={p.candidates} min={Math.min(p.count, p.candidates.length)} max={p.count} label="Sacrifice" title={`Sacrifice ${p.count}`} setPick={setPick} onDone={(objects) => answer({ kind: 'sacrifice', objects })} />;
    case 'proliferate':
      return <ProliferatePanel g={g} view={view} p={p} setPick={setPick} answer={answer} />;
    case 'choose_objects':
      return (
        <ObjectPicker
          key={`co-${p.text}`}
          view={view}
          candidates={p.candidates}
          min={p.min}
          max={p.max}
          {...(p.ordered ? { ordered: true } : {})}
          label="Choose"
          title={<RulesText text={p.text} />}
          setPick={setPick}
          onDone={(objects) => answer({ kind: 'choose_objects', objects })}
          extraOk={(ids) => (p.totalMV && ids.reduce((n, id) => n + (p.totalMV!.of[id] ?? 0), 0) > p.totalMV.max ? `Total mana value must be ${p.totalMV.max} or less.` : null)}
        >
          {(p.revealed?.length || p.seen?.length) ? (
            <>
              <p className="hint">{p.revealed?.length ? 'Revealed:' : 'You also see:'}</p>
              <div className="tile-row">
                {[...(p.revealed ?? []), ...(p.seen ?? [])].filter((id) => !p.candidates.includes(id)).map((id) => (
                  <ObjectTile key={id} view={view} id={id} />
                ))}
              </div>
            </>
          ) : null}
        </ObjectPicker>
      );
    case 'as_enters':
      return <AsEntersPanel g={g} view={view} p={p} setPick={setPick} answer={answer} />;
    default:
      return <FallbackPanel pending={p as PendingChoice} answer={answer} />;
  }
}

function OptionsPanel({ title, text, options, label, onChoose }: { title?: string; text?: string; options: string[]; label: (o: string) => string; onChoose: (o: string) => void }) {
  const [q, setQ] = useState('');
  const shown = options.length > 12 ? options.filter((o) => label(o).toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <div className="flow-step">
      {title && <p className="flow-title">{title}</p>}
      {text && (
        <blockquote className="manual-text">
          <RulesText text={text} />
        </blockquote>
      )}
      {options.length > 12 && <input className="filter-input" placeholder={`Filter ${options.length} options`} value={q} onChange={(e) => setQ(e.target.value)} />}
      <div className="chip-row options">
        {shown.slice(0, 120).map((o) => (
          <button key={o} type="button" className="chip-btn" onClick={() => onChoose(o)}>
            {label(o)}
          </button>
        ))}
        {shown.length > 120 && <span className="hint">…{shown.length - 120} more; filter to narrow.</span>}
      </div>
    </div>
  );
}

function OpeningPanel({ view, p, hand, setPick, answer }: { view: PlayerView; p: Extract<PendingChoice, { kind: 'opening_battlefield' }>; hand: string[]; setPick: SetPick; answer: (a: ChoiceAnswer) => void }) {
  const [chosen, setChosen] = useState<string[] | null>(null);
  if (!chosen)
    return (
      <ObjectPicker
        key="ob1"
        view={view}
        candidates={p.candidates}
        min={0}
        max={p.candidates.length}
        label="Next"
        title="Cards in your opening hand that can begin the game on the battlefield (or be revealed)"
        setPick={setPick}
        onDone={(ids) => {
          const needed = ids.filter((id) => p.exileFor?.includes(id)).length;
          if (!needed) answer({ kind: 'opening_battlefield', objects: ids });
          else setChosen(ids);
        }}
      />
    );
  const needed = chosen.filter((id) => p.exileFor?.includes(id)).length;
  const others = hand.filter((id) => !chosen.includes(id));
  const n = Math.min(needed, others.length);
  return <ObjectPicker key="ob2" view={view} candidates={others} min={n} max={n} label="Begin the game" title={`Exile ${n} other card${n === 1 ? '' : 's'} from your hand`} setPick={setPick} onDone={(exile) => answer({ kind: 'opening_battlefield', objects: chosen, exile })} />;
}

function TriggerPanel({ g, view, p, setPick, answer }: { g: GameState; view: PlayerView; p: Extract<PendingChoice, { kind: 'trigger_targets' }>; setPick: SetPick; answer: (a: ChoiceAnswer) => void }) {
  const [modes, setModes] = useState<number[] | null>(p.modes ? null : []);
  const head = (
    <>
      <p className="flow-title">{p.sourceName}</p>
      <blockquote className="manual-text">
        <RulesText text={p.text} />
      </blockquote>
    </>
  );
  if (p.modes && !modes)
    return (
      <div>
        {head}
        <ModePicker
          menu={{ min: p.modes.min, max: p.modes.max, repeat: Boolean(p.modes.repeat), used: p.modes.used ?? [], options: p.modes.options.map((o) => ({ text: o.text, manual: false })) }}
          feasible={(m) => m.every((i) => (p.modes?.options[i]?.prompts ?? []).every((pr) => pr.candidates.length >= promptRange(pr)[0]))}
          onDone={setModes}
        />
      </div>
    );
  // The chosen modes' prompts (in printed order), then the ability's own.
  const prompts = [...[...(modes ?? [])].sort((a, b) => a - b).flatMap((m) => p.modes?.options[m]?.prompts ?? []), ...p.prompts];
  const done = (targets: Target[][]) => answer({ kind: 'trigger_targets', ...(p.modes ? { modes: [...(modes ?? [])].sort((a, b) => a - b) } : {}), targets });
  if (!prompts.length)
    return (
      <div>
        {head}
        <Confirm ok label="Put it on the stack" onClick={() => done([])} />
      </div>
    );
  return (
    <div>
      {head}
      <TargetPicker key={JSON.stringify(modes)} g={g} view={view} prompts={prompts} setPick={setPick} onDone={done} doneLabel="Put it on the stack" />
    </div>
  );
}

function CastFreePanel({ g, view, p, setPick, answer }: { g: GameState; view: PlayerView; p: Extract<PendingChoice, { kind: 'cast_free' }>; setPick: SetPick; answer: (a: ChoiceAnswer) => void }) {
  const [casting, setCasting] = useState(false);
  const draft: Choosing = { type: 'cast', player: p.player, object: p.object };
  if (!casting)
    return (
      <div className="flow-step">
        <p className="flow-title">{p.sourceName}</p>
        <blockquote className="manual-text">
          <RulesText text={p.text} />
        </blockquote>
        <div className="tile-row">
          <ObjectTile view={view} id={p.object} />
        </div>
        <div className="btn-row">
          <button type="button" className="primary" onClick={() => (needsChoices(g, draft) ? setCasting(true) : answer({ kind: 'cast_free', cast: true }))}>
            Cast {publicName(p.object, g)}
          </button>
          <button type="button" className="secondary" onClick={() => answer({ kind: 'cast_free', cast: false })}>
            Don’t cast
          </button>
        </div>
      </div>
    );
  return (
    <ActionFlow
      g={g}
      view={view}
      action={draft}
      setPick={setPick}
      onCancel={() => setCasting(false)}
      onCommit={(a) => {
        const c = a as Choosing;
        answer({ kind: 'cast_free', cast: true, ...(c.targets ? { targets: c.targets } : {}), ...(c.modes ? { modes: c.modes } : {}) });
      }}
    />
  );
}

function CopyTargetsPanel({ g, view, p, setPick, answer }: { g: GameState; view: PlayerView; p: Extract<PendingChoice, { kind: 'copy_targets' }>; setPick: SetPick; answer: (a: ChoiceAnswer) => void }) {
  const [changing, setChanging] = useState(Boolean(p.mustChange));
  const head = (
    <>
      <p className="flow-title">Copy of {p.sourceName}</p>
      <p className="hint">
        Current targets: {p.current.flat().map((t) => targetLabel(g, t)).join(', ') || 'none'}
        {p.mustChange ? ' — the target must change, if another is legal.' : ''}
      </p>
    </>
  );
  if (!changing)
    return (
      <div className="flow-step">
        {head}
        <div className="btn-row">
          <button type="button" className="primary" onClick={() => answer({ kind: 'copy_targets' })}>
            Keep targets
          </button>
          <button type="button" className="secondary" onClick={() => setChanging(true)}>
            Choose new targets
          </button>
        </div>
      </div>
    );
  return (
    <div>
      {head}
      <TargetPicker g={g} view={view} prompts={p.prompts} defaults={p.current} setPick={setPick} onDone={(targets) => answer({ kind: 'copy_targets', targets })} {...(p.mustChange ? {} : { onCancel: () => setChanging(false) })} />
    </div>
  );
}

function PayPanel({ p, answer }: { p: Extract<PendingChoice, { kind: 'pay' }>; answer: (a: ChoiceAnswer) => void }) {
  const [x, setX] = useState(0);
  return (
    <div className="flow-step">
      <p className="flow-title">{p.sourceName}</p>
      <blockquote className="manual-text">
        <RulesText text={p.text} />
      </blockquote>
      {p.x && (
        <label className="dmg-row">
          <span>X</span>
          <input type="number" min={0} {...(p.x.max !== undefined ? { max: p.x.max } : {})} value={x} onChange={(e) => setX(Math.max(0, Math.min(p.x?.max ?? Infinity, Number(e.target.value) || 0)))} />
        </label>
      )}
      <div className="btn-row">
        <button type="button" className="primary" onClick={() => answer({ kind: 'pay', pay: true, ...(p.x ? { x } : {}) })}>
          Pay <RulesText text={p.cost} />
        </button>
        <button type="button" className="secondary" onClick={() => answer({ kind: 'pay', pay: false })}>
          Don’t pay
        </button>
      </div>
      <p className="hint">Mana is tapped for you automatically.</p>
    </div>
  );
}

function ProliferatePanel({ g, view, p, setPick, answer }: { g: GameState; view: PlayerView; p: Extract<PendingChoice, { kind: 'proliferate' }>; setPick: SetPick; answer: (a: ChoiceAnswer) => void }) {
  const [players, setPlayers] = useState<string[]>([]);
  return (
    <ObjectPicker
      key="prolif"
      view={view}
      candidates={p.objects}
      min={0}
      max={p.objects.length}
      label="Proliferate"
      title="Proliferate: choose any number of permanents and players with counters"
      setPick={setPick}
      onDone={(objects) => answer({ kind: 'proliferate', objects, players })}
    >
      {p.players.length > 0 && (
        <div className="chip-row">
          {p.players.map((pl) => (
            <button key={pl} type="button" className={players.includes(pl) ? 'chip-btn selected' : 'chip-btn'} onClick={() => setPlayers(players.includes(pl) ? players.filter((x) => x !== pl) : [...players, pl])}>
              {g.players[pl]?.name ?? pl}
            </button>
          ))}
        </div>
      )}
    </ObjectPicker>
  );
}

function AsEntersPanel({ g, view, p, setPick, answer }: { g: GameState; view: PlayerView; p: Extract<PendingChoice, { kind: 'as_enters' }>; setPick: SetPick; answer: (a: ChoiceAnswer) => void }) {
  const head = (
    <>
      <p className="flow-title">{p.sourceName}</p>
      <p className="hint">{p.text}</p>
    </>
  );
  if (p.options?.length) {
    const label = (o: string) => (p.choice === 'player' ? (g.players[o]?.name ?? o) : p.choice === 'color' ? ({ W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' } as Record<string, string>)[o] ?? o : o);
    return <OptionsPanel title={p.sourceName} text={p.text} options={p.options} label={label} onChoose={(choice) => answer({ kind: 'as_enters', choice })} />;
  }
  switch (p.choice) {
    case 'reveal':
    case 'discard_or_leave':
    case 'copy': {
      const verb = p.choice === 'copy' ? 'Enter as a copy' : p.choice === 'reveal' ? 'Reveal' : 'Discard';
      return (
        <ObjectPicker
          key={`ae-${p.choice}`}
          view={view}
          candidates={p.candidates ?? []}
          min={0}
          max={1}
          label={verb}
          title={head}
          setPick={setPick}
          onDone={([id]) => answer(p.choice === 'copy' ? { kind: 'as_enters', copy: id ?? null } : { kind: 'as_enters', reveal: id ?? null })}
        />
      );
    }
    case 'devour':
    case 'sacrifice_or_leave': {
      const n = p.choice === 'devour' ? 0 : (p.amount ?? 1);
      return <ObjectPicker key={`ae-${p.choice}`} view={view} candidates={p.candidates ?? []} min={n} max={p.choice === 'devour' ? (p.candidates?.length ?? 0) : n} label="Sacrifice" title={head} setPick={setPick} onDone={(sacrifice) => answer({ kind: 'as_enters', sacrifice })} />;
    }
    default:
      return (
        <div className="flow-step">
          {head}
          <div className="btn-row">
            <button type="button" className="primary" onClick={() => answer({ kind: 'as_enters', pay: true })}>
              {p.choice === 'pay_life' ? `Pay ${p.amount ?? 0} life` : 'Yes'}
            </button>
            <button type="button" className="secondary" onClick={() => answer({ kind: 'as_enters', pay: false })}>
              {p.choice === 'pay_life' ? 'Don’t (it enters tapped)' : 'No'}
            </button>
          </div>
        </div>
      );
  }
}

/** A choice this UI doesn't know yet: show what the engine asks and let the player answer in its own terms. */
function FallbackPanel({ pending, answer }: { pending: PendingChoice; answer: (a: ChoiceAnswer) => void }) {
  const [text, setText] = useState(`{"kind":"${pending.kind}"}`);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flow-step">
      <p className="flow-title">The engine asks: {pending.kind.replace(/_/g, ' ')}</p>
      <pre className="raw">{JSON.stringify(pending, null, 1)}</pre>
      <p className="hint">This table doesn’t have a screen for this choice yet. Answer with the engine’s answer object:</p>
      <textarea className="raw-input" value={text} onChange={(e) => setText(e.target.value)} rows={3} />
      {err && <p className="hint warn">{err}</p>}
      <button
        type="button"
        className="primary"
        onClick={() => {
          try {
            answer(JSON.parse(text) as ChoiceAnswer);
          } catch (e) {
            setErr(String(e));
          }
        }}
      >
        Answer
      </button>
    </div>
  );
}
