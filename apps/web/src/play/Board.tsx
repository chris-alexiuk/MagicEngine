import type { Characteristics, GameObject, GameState, PlayerId, PlayerView, Target } from '@mtg/engine';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CardBackFace, CardView, type Stats } from '../components/Card';
import { ManaSymbol } from '../components/mana';
import { ringOf, SeatMat, type SeatLook } from '../components/Mat';
import { shownCard } from './cards';
import { fitCardWidth, fitRow, itemWidth, RATIO, type Item } from './fit';
import { publicName } from './log';
import { isChosen, type Pick } from './pick';

/**
 * The table, laid out like a digital client. Each seat has a front lane (creatures, toward the middle) and a back lane
 * (lands on the left, other permanents on the right). Card sizes are fitted to each seat's room. A seat's plate (life,
 * name, status) and piles sit on its outer edge; the player whose screen it is sits at the bottom with their hand.
 */

export interface BoardHandlers {
  pick: Pick | null;
  /** The card whose menu is open. */
  selected: string | null;
  /** Objects the player with the screen can do something with right now (from legalActions). */
  actionable: ReadonlySet<string>;
  /** Of those, the ones whose only actions are mana abilities (clickable, but not lit up). */
  manaOnly: ReadonlySet<string>;
  /** Objects and players targeted by the stack entry in focus. */
  targeted: ReadonlySet<string>;
  /** Lands autotap would use for the card under the pointer. */
  willTap: ReadonlySet<string>;
  onCard: (id: string, el: HTMLElement) => void;
  onMenu: (id: string, el: HTMLElement) => void;
  onPlayer: (id: PlayerId) => void;
  onHover: (id: string | null, el?: HTMLElement) => void;
  onZone: (player: PlayerId, zone: 'graveyard' | 'exile') => void;
  /** Dragging a hand card onto the battlefield plays it. */
  onDragPlay?: (id: string) => void;
  /** Characteristics of permanents (layers applied), computed once per state. */
  chars: (id: string) => Characteristics;
}

const obj = (id: string): Target => ({ kind: 'object', object: id });

/** One look for "you can act on this" everywhere: hand, battlefield, command zone, other zones. */
export function cardClass(id: string, h: BoardHandlers, extra = ''): string {
  const cls = ['tcard'];
  if (extra) cls.push(extra);
  if (h.pick) {
    if (h.pick.objects.has(id)) cls.push('pickable');
    if (isChosen(h.pick, obj(id))) cls.push('picked');
  } else {
    if (h.actionable.has(id)) cls.push(h.manaOnly.has(id) ? 'actionable mana-only' : 'actionable');
    if (h.selected === id) cls.push('selected');
  }
  if (h.targeted.has(id)) cls.push('targeted');
  if (h.willTap.has(id)) cls.push('will-tap');
  return cls.join(' ');
}

/** Right-click (or a long press on touch) opens a card's full menu. */
function menuProps(id: string, h: BoardHandlers) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
      e.preventDefault();
      h.onMenu(id, e.currentTarget);
    },
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => {
      const el = e.currentTarget;
      timer = setTimeout(() => h.onMenu(id, el), 520);
    },
    onTouchEnd: () => timer && clearTimeout(timer),
    onTouchMove: () => timer && clearTimeout(timer),
  };
}

const COUNTER_LABEL: Record<string, string> = { '+1/+1': '+1/+1', '-1/-1': '−1/−1' };

/** Which attacker each creature in combat belongs to, numbered for pairing badges (1 = first attacker). */
export function combatPairs(g: GameState): Map<string, number> {
  const out = new Map<string, number>();
  Object.keys(g.combat?.attackers ?? {}).forEach((id, i) => out.set(id, i + 1));
  for (const [id, b] of Object.entries(g.combat?.blockers ?? {})) {
    const n = out.get(b.blocking);
    if (n) out.set(id, n);
  }
  return out;
}

/** What a permanent shows on its face now: current power/toughness (or loyalty, defense) and granted keywords. */
function statsOf(o: GameObject, c: Characteristics, printed: { power?: string; toughness?: string; keywords: { id: string }[] } | undefined): Stats {
  const out: Stats = {};
  if (c.types.includes('Creature')) {
    out.pt = `${c.power}/${c.toughness}`;
    const p = Number(printed?.power);
    const t = Number(printed?.toughness);
    if (c.power > p || c.toughness > t) out.mod = 'up';
    else if (c.power < p || c.toughness < t) out.mod = 'down';
  } else if (c.types.includes('Planeswalker')) out.pt = String(o.counters.loyalty ?? 0);
  else if (c.types.includes('Battle')) out.pt = String(o.counters.defense ?? 0);
  const had = new Set(printed?.keywords.map((k) => k.id) ?? []);
  const granted = c.keywords.filter((k) => !had.has(k.id)).map((k) => k.id);
  if (granted.length) out.keywords = granted;
  return out;
}

/** One permanent (or a pile of identical ones): the card, turned sideways when tapped, chips under it. */
function Permanent({ g, view, o, h, attached, members, pair }: { g: GameState; view: PlayerView; o: GameObject; h: BoardHandlers; attached: GameObject[]; members: string[]; pair?: number }) {
  const count = members.length;
  const c = h.chars(o.id);
  const vo = view.objects[o.id] ?? o;
  const shown = shownCard(view.cards, vo);
  const face = shown?.card.faces[shown.face];
  const stats = statsOf(o, c, face);
  const counters = Object.entries(o.counters).filter(([k, n]) => (n ?? 0) > 0 && k !== 'loyalty' && k !== 'defense');
  const atk = g.combat?.attackers[o.id];
  const blk = g.combat?.blockers[o.id];
  const name = publicName(o.id, view as unknown as GameState);
  const sick = c.types.includes('Creature') && o.sick && !c.keywords.some((k) => k.id === 'haste') && g.active === o.controller;
  const layers = Math.min(count, 4);
  return (
    <div className={`perm${o.tapped ? ' tapped' : ''}${atk ? ' attacking' : ''}${blk ? ' blocking' : ''}${sick ? ' sick' : ''}`} style={{ ['--k' as string]: layers }}>
      <button
        type="button"
        className={cardClass(o.id, h, 'perm-card')}
        data-id={o.id}
        {...(count > 1 ? { 'data-group': members.join(' ') } : {})}
        onClick={(e) => h.onCard(o.id, e.currentTarget)}
        onMouseEnter={(e) => h.onHover(o.id, e.currentTarget)}
        onMouseLeave={() => h.onHover(null)}
        {...menuProps(o.id, h)}
        aria-label={`${name}${o.tapped ? ', tapped' : ''}${count > 1 ? `, ${count} of them` : ''}${stats.pt ? `, ${stats.pt}` : ''}`}
      >
        {Array.from({ length: layers }, (_, i) => (
          <span key={i} className="perm-face" style={{ ['--i' as string]: i }}>
            {shown && !(o.faceDown && o.controller !== view.viewer) ? <CardView card={shown.card} faceIndex={shown.face} sizes="146px" stats={stats} /> : <CardBackFace {...(stats.pt ? { label: stats.pt } : {})} />}
          </span>
        ))}
        {o.token && <span className="token-mark" title="Token">T</span>}
        {count > 1 && <span className="count-badge">×{count}</span>}
        {pair && <span className={`pair-badge${atk ? ' atk' : ' blk'}`} title={atk ? `Attacker ${pair}` : `Blocks attacker ${pair}`}>{pair}</span>}
      </button>
      <span className="perm-chips">
        {stats.pt && <span className={`chip-pt${stats.mod ? ` ${stats.mod}` : ''}`}>{stats.pt}</span>}
        {o.damage > 0 && <span className="chip-dmg" title="Damage marked">−{o.damage}</span>}
        {counters.map(([k, n]) => (
          <span key={k} className="chip-ctr" title={`${n} ${k} counter${n === 1 ? '' : 's'}`}>
            {COUNTER_LABEL[k] ? `${n}× ${COUNTER_LABEL[k]}` : `${n} ${k}`}
          </span>
        ))}
        {o.faceDown && <span className="chip-ctr">face down</span>}
      </span>
      {attached.length > 0 && (
        <span className="perm-attached">
          {attached.map((a) => (
            <button key={a.id} type="button" data-id={a.id} className={cardClass(a.id, h, 'attach-chip')} onClick={(e) => h.onCard(a.id, e.currentTarget)} onMouseEnter={(e) => h.onHover(a.id, e.currentTarget)} onMouseLeave={() => h.onHover(null)} {...menuProps(a.id, h)}>
              {publicName(a.id, view as unknown as GameState)}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

/** Identical lands and tokens with nothing on them, in the same state, show as one pile — unless they can be chosen now. */
function group(g: GameState, list: GameObject[], h: BoardHandlers, attachedTo: Map<string, GameObject[]>, stackable: (o: GameObject) => boolean): { o: GameObject; members: string[] }[] {
  const out: { o: GameObject; members: string[]; key: string }[] = [];
  for (const o of list) {
    const plain =
      stackable(o) &&
      !h.pick?.objects.has(o.id) &&
      !h.targeted.has(o.id) &&
      !Object.values(o.counters).some((n) => (n ?? 0) > 0) &&
      !attachedTo.has(o.id) &&
      !o.faceDown &&
      !o.copyOf &&
      !g.combat?.attackers[o.id] &&
      !g.combat?.blockers[o.id] &&
      h.selected !== o.id;
    const key = plain ? `${o.card}|${o.tapped}|${o.sick}|${h.actionable.has(o.id)}|${h.manaOnly.has(o.id)}|${h.willTap.has(o.id)}` : o.id;
    const hit = plain ? out.find((x) => x.key === key) : undefined;
    if (hit) hit.members.push(o.id);
    else out.push({ o, members: [o.id], key });
  }
  return out;
}

/** The size of an element, kept current. */
function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e!.contentRect;
      setSize((s) => (Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** Lands are drawn a little smaller than creatures, so the creatures read first. */
const LAND_SCALE = 0.88;
/** The room between a seat's lands and its other permanents in the back lane. */
const GROUP_GAP = 22;

function Lanes({ g, view, player, h, far, maxW }: { g: GameState; view: PlayerView; player: PlayerId; h: BoardHandlers; far: boolean; maxW: number }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const all = g.zones.battlefield.map((id) => g.objects[id]!);
  const attachedTo = new Map<string, GameObject[]>();
  const hosted = new Set<string>();
  for (const o of all) {
    const host = o.attachedTo && g.objects[o.attachedTo.id];
    if (host && host.zone === 'battlefield' && host.zcc === o.attachedTo!.zcc) {
      attachedTo.set(host.id, [...(attachedTo.get(host.id) ?? []), o]);
      hosted.add(o.id);
    }
  }
  const mine = all.filter((o) => o.controller === player && !hosted.has(o.id));
  const creatures: GameObject[] = [];
  const lands: GameObject[] = [];
  const other: GameObject[] = [];
  for (const o of mine) {
    const c = h.chars(o.id);
    if (c.types.includes('Creature')) creatures.push(o);
    else if (c.types.includes('Land')) lands.push(o);
    else other.push(o);
  }
  const front = group(g, creatures, h, attachedTo, (o) => Boolean(o.token));
  const backLands = group(g, lands, h, attachedTo, () => true);
  const backOther = group(g, other, h, attachedTo, (o) => Boolean(o.token));
  const items = (list: { o: GameObject; members: string[] }[], scale = 1): Item[] => list.map(({ o, members }) => ({ tapped: o.tapped, stack: members.length, scale }));
  // Two lanes; or, while there are few enough permanents, one row of larger cards (lands, creatures, the rest). The
  // row is sized as if everything were tapped, so tapping for mana never resizes or rearranges the table.
  const [cw, oneRow] = useMemo((): [number, boolean] => {
    // The back lane holds two groups, set further apart than cards within a group (GROUP_GAP in the stylesheet).
    const others = items(backOther).map((it, i) => (i === 0 && backLands.length ? { ...it, pad: GROUP_GAP - 8 } : it));
    const two = fitCardWidth([items(front), [...items(backLands, LAND_SCALE), ...others]], { width: size.w - 2, height: size.h, max: maxW, min: 36, chips: 15, emptyLane: Math.min(48, size.h * 0.18) });
    const tapped = (list: Item[]) => list.map((it) => ({ ...it, tapped: true }));
    const one = fitRow([tapped(items(backLands, LAND_SCALE)), tapped(items(front)), tapped(items(backOther))], { width: size.w, height: size.h, max: maxW, min: 36, chips: 15, groupGap: 28 });
    return one > two ? [one, true] : [two, false];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, maxW, JSON.stringify([items(front), items(backLands), items(backOther)])]);
  const pairs = combatPairs(g);
  const render = (list: { o: GameObject; members: string[] }[]) =>
    list.map(({ o, members }) => <Permanent key={o.id} g={g} view={view} o={o} h={h} attached={attachedTo.get(o.id) ?? []} members={members} {...(pairs.get(o.id) ? { pair: pairs.get(o.id)! } : {})} />);
  const frontLane = (
    <div className="lane front" aria-label="Creatures">
      {render(front)}
    </div>
  );
  const backLane = (
    <div className="lane back">
      <div className="lane-lands" aria-label="Lands">
        {render(backLands)}
      </div>
      <div className="lane-other" aria-label="Other permanents">
        {render(backOther)}
      </div>
    </div>
  );
  const style = { ['--cw' as string]: `${cw}px`, ['--ch' as string]: `${(cw * RATIO).toFixed(1)}px` };
  if (oneRow) {
    return (
      <div ref={ref} className={`lanes one-row${far ? ' far' : ' near'}`} style={style}>
        <div className="lane-lands" aria-label="Lands">
          {render(backLands)}
        </div>
        {frontLane}
        <div className="lane-other" aria-label="Other permanents">
          {render(backOther)}
        </div>
      </div>
    );
  }
  return (
    <div ref={ref} className={`lanes${far ? ' far' : ' near'}${size.w ? '' : ' measuring'}`} style={style}>
      {far ? backLane : frontLane}
      {far ? frontLane : backLane}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The seat's edge: plate, piles, command zone, mana pool
// ---------------------------------------------------------------------------

export function Pool({ g, player }: { g: GameState; player: PlayerId }) {
  const pool = g.players[player]!.pool;
  const entries = (Object.entries(pool) as [string, number][]).filter(([, n]) => n > 0);
  const restricted = (g.players[player]!.restricted ?? []).reduce((n, r) => n + r.amount, 0);
  if (!entries.length && !restricted) return null;
  return (
    <span className="pool" title="Mana pool" aria-label="Mana pool">
      {entries.map(([c, n]) => (
        <span key={c} className="pool-item">
          <ManaSymbol symbol={c} />
          {n > 1 && <span className="pool-n">{n}</span>}
        </span>
      ))}
      {restricted > 0 && <span className="pool-item pool-n">+{restricted}</span>}
    </span>
  );
}

/** Life, name and status. The plate is the player's button when a player can be chosen (a target, who to attack). */
export function Plate({ g, player, h, deciding, me, look }: { g: GameState; player: PlayerId; h: BoardHandlers; deciding: boolean; me?: boolean; look?: SeatLook }) {
  const ps = g.players[player]!;
  const t: Target = { kind: 'player', player };
  const pickable = Boolean(h.pick?.players.has(player));
  const chosen = isChosen(h.pick, t);
  // CR 903.10a: combat damage each commander has dealt this player.
  const cmdDamage = Object.entries(g.commanderDamage[player] ?? {}).filter(([, n]) => n > 0);
  const others = Object.entries(ps.counters ?? {}).filter(([, n]) => n > 0);
  // The life total flashes when it changes, with the change beside it.
  const last = useRef(ps.life);
  const [delta, setDelta] = useState<{ n: number; key: number } | null>(null);
  useEffect(() => {
    if (ps.life === last.current) return;
    const n = ps.life - last.current;
    last.current = ps.life;
    setDelta({ n, key: Date.now() });
    const t = setTimeout(() => setDelta(null), 1400);
    return () => clearTimeout(t);
  }, [ps.life]);
  return (
    <div className={`plate${me ? ' mine' : ''}${deciding ? ' deciding' : ''}${g.active === player ? ' active' : ''}${ps.lost ? ' lost' : ''}`} data-plate={player} style={{ ['--ring' as string]: ringOf(look?.colors ?? []) } as CSSProperties}>
      <button
        type="button"
        className={`life${pickable ? ' pickable' : ''}${chosen ? ' picked' : ''}${h.targeted.has(player) ? ' targeted' : ''}${delta ? (delta.n < 0 ? ' hurt' : ' healed') : ''}`}
        disabled={!pickable}
        onClick={() => h.onPlayer(player)}
        aria-label={`${ps.name}, ${ps.life} life${pickable ? ', choose' : ''}`}
      >
        <span className="life-n">{ps.life}</span>
        {delta && (
          <span key={delta.key} className={`life-delta${delta.n < 0 ? ' down' : ' up'}`} aria-hidden="true">
            {delta.n > 0 ? `+${delta.n}` : delta.n}
          </span>
        )}
      </button>
      <span className="plate-meta">
        <span className="plate-name">{ps.name}</span>
        <span className="plate-chips">
          {g.active === player && <span className="chip turn-chip">{me ? 'Your turn' : 'Their turn'}</span>}
          {ps.lost && <span className="chip warn-chip">Out</span>}
          {g.monarch === player && <span className="chip">Monarch</span>}
          {g.initiative === player && <span className="chip">Initiative</span>}
          {ps.poison > 0 && <span className="chip warn-chip" title="Poison counters">☠ {ps.poison}</span>}
          {cmdDamage.map(([id, n]) => (
            <span key={id} className="chip warn-chip" title={`Commander damage from ${publicName(id, g)} (21 loses)`}>
              <i className="ms ms-commander" aria-hidden="true" /> {n}
              <span className="sr-only"> from {publicName(id, g)}</span>
            </span>
          ))}
          {others.map(([k, n]) => (
            <span key={k} className="chip">
              {n} {k}
            </span>
          ))}
        </span>
      </span>
    </div>
  );
}

/** Library, graveyard and exile; graveyard and exile open a viewer. */
export function Piles({ g, view, player, h }: { g: GameState; view: PlayerView; player: PlayerId; h: BoardHandlers }) {
  const yard = g.zones.graveyard[player] ?? [];
  const exiled = g.zones.exile.filter((id) => g.objects[id]?.owner === player);
  const lib = (g.zones.library[player] ?? []).length;
  const lit = (ids: string[]) => ids.some((id) => h.actionable.has(id) && !h.manaOnly.has(id));
  const top = (ids: string[]) => {
    const id = ids[ids.length - 1];
    const o = id ? view.objects[id] : undefined;
    const shown = o ? shownCard(view.cards, o) : null;
    return shown ? <CardView card={shown.card} faceIndex={shown.face} sizes="60px" /> : <span className="pile-empty" />;
  };
  return (
    <div className="piles">
      <span className="pile" title={`Library: ${lib}`} aria-label={`Library, ${lib} cards`}>
        <span className={`pile-card${lib > 1 ? ' deep' : ''}`}>
          {lib ? <CardBackFace /> : <span className="pile-empty" />}
          <span className="pile-n">{lib}</span>
        </span>
        <span className="pile-name">Library</span>
      </span>
      <button type="button" className={`pile${lit(yard) ? ' lit' : ''}`} onClick={() => h.onZone(player, 'graveyard')} title={`Graveyard: ${yard.length}`} aria-label={`Graveyard, ${yard.length} cards`}>
        <span className="pile-card">
          {top(yard)}
          <span className="pile-n">{yard.length}</span>
        </span>
        <span className="pile-name">Graveyard</span>
      </button>
      <button type="button" className={`pile${lit(exiled) ? ' lit' : ''}`} onClick={() => h.onZone(player, 'exile')} title={`Exile: ${exiled.length}`} aria-label={`Exile, ${exiled.length} cards`}>
        <span className="pile-card">
          {top(exiled)}
          <span className="pile-n">{exiled.length}</span>
        </span>
        <span className="pile-name">Exile</span>
      </button>
    </div>
  );
}

/** The command zone: commanders (with their tax) and emblems. */
export function Command({ g, view, player, h }: { g: GameState; view: PlayerView; player: PlayerId; h: BoardHandlers }) {
  const ids = g.zones.command.filter((id) => {
    const o = g.objects[id]!;
    return o.emblem ? o.controller === player : o.owner === player;
  });
  if (!ids.length) return null;
  return (
    <div className="command" aria-label="Command zone">
      {ids.map((id) => {
        const o = view.objects[id] ?? g.objects[id]!;
        const shown = shownCard(view.cards, o);
        const tax = 2 * (g.commanderCasts[id] ?? 0);
        return (
          <span key={id} className="cmd-slot">
            <button type="button" data-id={id} className={cardClass(id, h, 'cmd-card')} onClick={(e) => h.onCard(id, e.currentTarget)} onMouseEnter={(e) => h.onHover(id, e.currentTarget)} onMouseLeave={() => h.onHover(null)} {...menuProps(id, h)} aria-label={`${publicName(id, g)} (command zone${tax ? `, tax ${tax}` : ''})`}>
              {shown ? <CardView card={shown.card} faceIndex={shown.face} sizes="80px" /> : <CardBackFace />}
            </button>
            <span className={`cmd-tax${tax || g.objects[id]?.emblem ? '' : ' plain'}`}>{g.objects[id]?.emblem ? 'Emblem' : tax ? <>Tax <ManaSymbol symbol={String(tax)} /></> : 'Commander'}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Cards the player can play from somewhere other than their hand (graveyard, exile, top of library). */
export function Elsewhere({ g, view, player, h }: { g: GameState; view: PlayerView; player: PlayerId; h: BoardHandlers }) {
  const ids = [...h.actionable].filter((id) => {
    const o = g.objects[id];
    return o && o.owner === player && (o.zone === 'graveyard' || o.zone === 'exile' || o.zone === 'library') && !h.manaOnly.has(id);
  });
  if (!ids.length) return null;
  return (
    <div className="elsewhere" aria-label="Playable from other zones">
      {ids.map((id) => {
        const o = view.objects[id];
        const shown = o ? shownCard(view.cards, o) : null;
        if (!o || !shown) return null;
        return (
          <span key={id} className="else-slot">
            <button type="button" data-id={id} className={cardClass(id, h, 'else-card')} onClick={(e) => h.onCard(id, e.currentTarget)} onMouseEnter={(e) => h.onHover(id, e.currentTarget)} onMouseLeave={() => h.onHover(null)} {...menuProps(id, h)} aria-label={`${publicName(id, view as unknown as GameState)} (${o.zone})`}>
              <CardView card={shown.card} faceIndex={shown.face} sizes="80px" />
            </button>
            <span className="else-zone">{o.zone === 'library' ? 'Library' : o.zone === 'graveyard' ? 'Graveyard' : 'Exile'}</span>
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hands
// ---------------------------------------------------------------------------

/** The hand along the bottom edge, overlapping to fit; a card lifts and grows under the pointer. Drag one up to play it. */
export function Hand({ view, player, h, cardW }: { view: PlayerView; player: PlayerId; h: BoardHandlers; cardW: number }) {
  const hand = view.zones.hand[player];
  const [ref, size] = useSize<HTMLDivElement>();
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const [ghost, setGhost] = useState<{ id: string; x: number; y: number } | null>(null);
  // The card under the pointer is drawn large above its slot; the slot itself stays the size it was, so the
  // neighbours can still be pointed at (the large copy doesn't take the pointer).
  const [zoom, setZoom] = useState<string | null>(null);
  if (!Array.isArray(hand)) return null;
  const n = hand.length;
  const cw = cardW;
  const room = Math.max(size.w - cw - 8, 0);
  const step = n > 1 ? Math.min(cw * 0.94, room / (n - 1)) : 0;
  const start = (size.w - (cw + step * (n - 1))) / 2;
  const mid = (n - 1) / 2;
  return (
    <div ref={ref} className="hand" aria-label="Your hand" style={{ ['--hand-w' as string]: `${cw}px` }}>
      {n === 0 && <span className="hand-empty">No cards in hand</span>}
      {hand.map((id, i) => {
        const o = view.objects[id];
        const shown = o ? shownCard(view.cards, o) : null;
        if (!o || !shown) return null;
        const off = i - mid;
        return (
          <button
            key={id}
            type="button"
            data-id={id}
            className={cardClass(id, h, zoom === id && !ghost ? 'hand-card zoomed' : 'hand-card')}
            style={{ left: `${start + i * step}px`, zIndex: i + 1, ['--r' as string]: `${off * Math.min(1.4, 9 / Math.max(n, 1))}deg`, ['--y' as string]: `${Math.min(7, Math.abs(off) ** 1.6 * 0.9)}px` }}
            onClick={(e) => {
              if (drag.current?.moved) return;
              h.onCard(id, e.currentTarget);
            }}
            onPointerDown={(e) => {
              if (e.button !== 0 || e.pointerType === 'touch') return;
              drag.current = { id, x: e.clientX, y: e.clientY, moved: false };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || d.id !== id) return;
              if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) d.moved = true;
              if (d.moved) setGhost({ id, x: e.clientX, y: e.clientY });
            }}
            onPointerUp={(e) => {
              const d = drag.current;
              if (!d || d.id !== id) return;
              const handTop = ref.current?.getBoundingClientRect().top ?? 0;
              if (d.moved && e.clientY < handTop - 20) h.onDragPlay?.(id);
              setGhost(null);
              // The click that follows a drag is ignored; clear the drag after it.
              setTimeout(() => (drag.current = null), 0);
            }}
            onPointerCancel={() => {
              drag.current = null;
              setGhost(null);
            }}
            onMouseEnter={(e) => {
              setZoom(id);
              h.onHover(id, e.currentTarget);
            }}
            onMouseLeave={() => {
              setZoom(null);
              h.onHover(null);
            }}
            onFocus={() => setZoom(id)}
            onBlur={() => setZoom(null)}
            {...menuProps(id, h)}
            aria-label={publicName(id, view as unknown as GameState)}
          >
            <CardView card={shown.card} faceIndex={shown.face} sizes="146px" />
          </button>
        );
      })}
      {(() => {
        // The large copy of the card under the pointer, above the whole hand; it never takes the pointer.
        const i = zoom && !ghost ? hand.indexOf(zoom) : -1;
        const o = i >= 0 ? view.objects[zoom!] : undefined;
        const shown = o ? shownCard(view.cards, o) : null;
        if (!shown) return null;
        return (
          <span className={`hand-zoom${h.actionable.has(zoom!) && !h.pick ? ' lit' : ''}${h.pick?.objects.has(zoom!) ? ' lit' : ''}`} style={{ left: `${start + i * step + cw / 2}px` }} aria-hidden="true">
            <CardView card={shown.card} faceIndex={shown.face} sizes="280px" eager />
          </span>
        );
      })()}
      {ghost && view.objects[ghost.id] && (
        <span className="drag-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">
          {(() => {
            const s = shownCard(view.cards, view.objects[ghost.id]!);
            return s ? <CardView card={s.card} faceIndex={s.face} sizes="146px" /> : null;
          })()}
        </span>
      )}
    </div>
  );
}

/** Another player's hand: face-down (with the count), or face up when every hand is open. */
function OtherHand({ g, view, player, h }: { g: GameState; view: PlayerView; player: PlayerId; h: BoardHandlers }) {
  const ids = view.zones.hand[player];
  const count = (g.zones.hand[player] ?? []).length;
  if (Array.isArray(ids) && ids.length) {
    return (
      <span className="other-hand open" aria-label={`${g.players[player]!.name}’s hand, ${count} cards`}>
        {ids.map((id) => {
          const o = view.objects[id];
          const shown = o ? shownCard(view.cards, o) : null;
          return (
            <span key={id} className="mini-card" data-id={id} onMouseEnter={(e) => h.onHover(id, e.currentTarget)} onMouseLeave={() => h.onHover(null)}>
              {shown ? <CardView card={shown.card} faceIndex={shown.face} sizes="60px" /> : <CardBackFace />}
            </span>
          );
        })}
      </span>
    );
  }
  return (
    <span className="other-hand" title={`${count} cards in hand`} aria-label={`${count} cards in hand`}>
      {Array.from({ length: Math.min(count, 7) }, (_, i) => (
        <span key={i} className="mini-card back">
          <CardBackFace />
        </span>
      ))}
      <span className="other-hand-n">{count}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

/** An opponent's seat: the edge bar (plate, command zone, hand, piles) above their lanes. */
export function OpponentSeat({ g, view, player, h, deciding, maxW, extra, look }: { g: GameState; view: PlayerView; player: PlayerId; h: BoardHandlers; deciding: boolean; maxW: number; extra?: ReactNode; look: SeatLook }) {
  return (
    <section className={`seat opp${deciding ? ' deciding' : ''}${g.active === player ? ' active' : ''}${g.players[player]!.lost ? ' lost' : ''}`} data-player={player} aria-label={g.players[player]!.name}>
      <SeatMat look={look} />
      <header className="seat-bar">
        <Plate g={g} player={player} h={h} deciding={deciding} look={look} />
        <Command g={g} view={view} player={player} h={h} />
        <Pool g={g} player={player} />
        {extra}
        <span className="grow" />
        <OtherHand g={g} view={view} player={player} h={h} />
        <Piles g={g} view={view} player={player} h={h} />
      </header>
      <Lanes g={g} view={view} player={player} h={h} far maxW={maxW} />
    </section>
  );
}

/** Your battlefield (your plate, hand and piles are in the dock below it). */
export function MySeat({ g, view, player, h, deciding, maxW, look }: { g: GameState; view: PlayerView; player: PlayerId; h: BoardHandlers; deciding: boolean; maxW: number; look: SeatLook }) {
  return (
    <section className={`seat me${deciding ? ' deciding' : ''}${g.active === player ? ' active' : ''}`} data-player={player} aria-label={`${g.players[player]!.name}’s battlefield`}>
      <SeatMat look={look} />
      <Lanes g={g} view={view} player={player} h={h} far={false} maxW={maxW} />
    </section>
  );
}

export { itemWidth, type SeatLook };
