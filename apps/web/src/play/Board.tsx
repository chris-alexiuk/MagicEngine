import type { Characteristics, GameObject, GameState, PlayerId, PlayerView, Target } from '@mtg/engine';
import { ManaSymbol } from '../components/bits';
import { CardBack, shownCard, TableCard } from './cards';
import { publicName } from './log';
import { isChosen, type Pick } from './pick';

/**
 * The table, laid out like a digital client: each seat has a front lane (creatures, toward the middle of the table)
 * and a back lane (lands on the left, other permanents on the right), with the player's plate, piles and command zone
 * along the outer edge. The player with the device sits at the bottom with their hand.
 */

export interface BoardHandlers {
  pick: Pick | null;
  selected: string | null;
  /** Objects the player with the device can do something with right now (from legalActions). */
  actionable: ReadonlySet<string>;
  /** Of those, the ones whose only actions are mana abilities (highlighted more quietly). */
  manaOnly: ReadonlySet<string>;
  /** Objects and players targeted by the stack entry in focus. */
  targeted: ReadonlySet<string>;
  onCard: (id: string) => void;
  onPlayer: (id: PlayerId) => void;
  onHover: (id: string | null, el?: HTMLElement) => void;
  onZone: (player: PlayerId, zone: 'graveyard' | 'exile') => void;
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
    if (!h.pick.objects.has(id) && !isChosen(h.pick, obj(id))) cls.push('dim');
  } else {
    if (h.actionable.has(id)) cls.push(h.manaOnly.has(id) ? 'actionable mana-only' : 'actionable');
    if (h.selected === id) cls.push('selected');
  }
  if (h.targeted.has(id)) cls.push('targeted');
  return cls.join(' ');
}

const COUNTER_LABEL: Record<string, string> = { '+1/+1': '+1/+1', '-1/-1': '−1/−1', loyalty: 'loyalty' };

/** Which attacker each creature in combat belongs to, numbered for pairing badges (1 = first attacker). */
export function combatPairs(g: GameState): Map<string, number> {
  const out = new Map<string, number>();
  const attackers = Object.keys(g.combat?.attackers ?? {});
  attackers.forEach((id, i) => out.set(id, i + 1));
  for (const [id, b] of Object.entries(g.combat?.blockers ?? {})) {
    const n = out.get(b.blocking);
    if (n) out.set(id, n);
  }
  return out;
}

/** One permanent (or a stack of identical ones): the card, rotated when tapped, with its numbers in a strip below it. */
function Permanent({ g, view, o, h, attached, members, pair }: { g: GameState; view: PlayerView; o: GameObject; h: BoardHandlers; attached: GameObject[]; members: string[]; pair?: number }) {
  const count = members.length;
  const c = h.chars(o.id);
  const vo = view.objects[o.id] ?? o;
  const shown = shownCard(view.cards, vo);
  const face = shown?.card.faces[shown.face];
  const isCreature = c.types.includes('Creature');
  const printedP = face?.power !== undefined ? Number(face.power) : NaN;
  const printedT = face?.toughness !== undefined ? Number(face.toughness) : NaN;
  const counters = Object.entries(o.counters).filter(([k, n]) => (n ?? 0) > 0 && !(k === 'loyalty' && c.types.includes('Planeswalker')));
  const loyalty = c.types.includes('Planeswalker') ? (o.counters.loyalty ?? 0) : null;
  const atk = g.combat?.attackers[o.id];
  const blk = g.combat?.blockers[o.id];
  const printedKw = new Set(face?.keywords.map((k) => k.id) ?? []);
  const granted = c.keywords.filter((k) => !printedKw.has(k.id)).map((k) => k.id.replace(/_/g, ' '));
  const name = publicName(o.id, view as unknown as GameState);
  return (
    <div className={`perm${o.tapped ? ' tapped' : ''}${atk ? ' attacking' : ''}${blk ? ' blocking' : ''}`}>
      <button
        type="button"
        className={cardClass(o.id, h, 'perm-card')}
        data-id={o.id}
        {...(count > 1 ? { 'data-group': members.join(' ') } : {})}
        onClick={() => h.onCard(o.id)}
        onMouseEnter={(e) => h.onHover(o.id, e.currentTarget)}
        onMouseLeave={() => h.onHover(null)}
        aria-label={`${name}${o.tapped ? ', tapped' : ''}${count > 1 ? `, ${count} of them` : ''}`}
        aria-pressed={h.selected === o.id}
      >
        <span className="perm-rot">
          <TableCard cards={view.cards} o={vo} sizes="96px" />
        </span>
        {count > 1 && <span className="stack-count">×{count}</span>}
        {pair && <span className={`pair-badge${atk ? ' atk' : ' blk'}`} title={atk ? `Attacker ${pair}` : `Blocks attacker ${pair}`}>{pair}</span>}
      </button>
      <div className="perm-stats">
        {isCreature && (
          <span className={`pt${c.power > printedP || c.toughness > printedT ? ' up' : ''}${c.power < printedP || c.toughness < printedT ? ' down' : ''}`}>
            {c.power}/{c.toughness}
          </span>
        )}
        {o.damage > 0 && <span className="dmg" title="Damage marked">−{o.damage}</span>}
        {loyalty !== null && <span className="loyal" title="Loyalty">◆{loyalty}</span>}
        {counters.map(([k, n]) => (
          <span key={k} className="ctr" title={`${n} ${k} counter${n === 1 ? '' : 's'}`}>
            {n}× {COUNTER_LABEL[k] ?? k}
          </span>
        ))}
        {isCreature && o.sick && !c.keywords.some((k) => k.id === 'haste') && g.active === o.controller && <span className="sick" title="Summoning sick">sick</span>}
        {o.faceDown && <span className="ctr">face down</span>}
      </div>
      {granted.length > 0 && <div className="perm-kw">{granted.join(', ')}</div>}
      {atk && <div className="perm-combat">→ {atk.target.kind === 'player' ? (g.players[atk.target.player]?.name ?? '') : publicName(atk.target.object, g)}{atk.blocked ? ' · blocked' : ''}</div>}
      {attached.length > 0 && (
        <div className="perm-attached">
          {attached.map((a) => (
            <button key={a.id} type="button" data-id={a.id} className={cardClass(a.id, h, 'attach-chip')} onClick={() => h.onCard(a.id)} onMouseEnter={(e) => h.onHover(a.id, e.currentTarget)} onMouseLeave={() => h.onHover(null)}>
              ⧉ {publicName(a.id, view as unknown as GameState)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Identical lands and tokens with nothing on them, in the same state, show as one stack — unless they can be chosen now. */
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
    const key = plain ? `${o.card}|${o.tapped}|${o.sick}|${h.actionable.has(o.id)}` : o.id;
    const hit = plain ? out.find((x) => x.key === key) : undefined;
    if (hit) hit.members.push(o.id);
    else out.push({ o, members: [o.id], key });
  }
  return out;
}

function Lanes({ g, view, player, h, top }: { g: GameState; view: PlayerView; player: PlayerId; h: BoardHandlers; top: boolean }) {
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
  const pairs = combatPairs(g);
  const render = (list: { o: GameObject; members: string[] }[]) =>
    list.map(({ o, members }) => <Permanent key={o.id} g={g} view={view} o={o} h={h} attached={attachedTo.get(o.id) ?? []} members={members} {...(pairs.get(o.id) ? { pair: pairs.get(o.id)! } : {})} />);
  const front = (
    <div className="lane front" aria-label="Creatures">
      {creatures.length === 0 && <span className="lane-empty">No creatures</span>}
      {render(group(g, creatures, h, attachedTo, (o) => Boolean(o.token)))}
    </div>
  );
  const back = (
    <div className="lane back">
      <div className="lane-lands" aria-label="Lands">
        {render(group(g, lands, h, attachedTo, () => true))}
      </div>
      <div className="lane-other" aria-label="Other permanents">
        {render(group(g, other, h, attachedTo, (o) => Boolean(o.token)))}
      </div>
    </div>
  );
  return (
    <div className={`lanes${top ? ' far' : ' near'}`}>
      {top ? back : front}
      {top ? front : back}
    </div>
  );
}

function Pool({ g, player }: { g: GameState; player: PlayerId }) {
  const pool = g.players[player]!.pool;
  const pips = (Object.entries(pool) as [string, number][]).flatMap(([c, n]) => Array.from({ length: n }, () => c));
  const restricted = (g.players[player]!.restricted ?? []).reduce((n, r) => n + r.amount, 0);
  if (!pips.length && !restricted) return null;
  return (
    <span className="chip pool" title="Mana pool">
      {pips.map((c, i) => (
        <ManaSymbol key={i} symbol={c} />
      ))}
      {restricted > 0 && <span> +{restricted}</span>}
    </span>
  );
}

/** Life, name and status chips. The life total is the player's target button when a player can be chosen. */
export function Plate({ g, player, h, deciding }: { g: GameState; player: PlayerId; h: BoardHandlers; deciding: boolean }) {
  const ps = g.players[player]!;
  const t: Target = { kind: 'player', player };
  const pickable = h.pick?.players.has(player);
  const chosen = isChosen(h.pick, t);
  // CR 903.10a: combat damage each commander has dealt this player.
  const cmdDamage = Object.entries(g.commanderDamage[player] ?? {}).filter(([, n]) => n > 0);
  const others = Object.entries(ps.counters ?? {}).filter(([, n]) => n > 0);
  return (
    <div className={`plate${deciding ? ' deciding' : ''}${g.active === player ? ' active' : ''}${ps.lost ? ' lost' : ''}`}>
      <button
        type="button"
        className={`life${pickable ? ' pickable' : ''}${chosen ? ' picked' : ''}${h.targeted.has(player) ? ' targeted' : ''}`}
        disabled={!pickable}
        onClick={() => h.onPlayer(player)}
        aria-label={`${ps.name}, ${ps.life} life${pickable ? ', choose as target' : ''}`}
      >
        <span className="life-n">{ps.life}</span>
        <span className="life-name">{ps.name}</span>
      </button>
      <div className="chips">
        {g.active === player && <span className="chip turn-chip">Turn</span>}
        {deciding && <span className="chip deciding-chip">Deciding</span>}
        {ps.lost && <span className="chip warn-chip">Out</span>}
        {g.monarch === player && <span className="chip">Monarch</span>}
        {g.initiative === player && <span className="chip">Initiative</span>}
        {ps.poison > 0 && <span className="chip warn-chip">☠ {ps.poison}</span>}
        {cmdDamage.map(([id, n]) => (
          <span key={id} className="chip warn-chip" title={`Commander damage from ${publicName(id, g)} (21 loses)`}>
            ⚔ {publicName(id, g).split(',')[0]} {n}
          </span>
        ))}
        {others.map(([k, n]) => (
          <span key={k} className="chip">
            {n} {k}
          </span>
        ))}
        <Pool g={g} player={player} />
      </div>
    </div>
  );
}

/** Library, graveyard and exile as piles (with counts); graveyard and exile open a viewer. */
function Piles({ g, view, player, h }: { g: GameState; view: PlayerView; player: PlayerId; h: BoardHandlers }) {
  const yard = g.zones.graveyard[player] ?? [];
  const exiled = g.zones.exile.filter((id) => g.objects[id]?.owner === player);
  const lit = (ids: string[]) => ids.some((id) => h.actionable.has(id) && !h.manaOnly.has(id));
  const topOf = (ids: string[]) => {
    const id = ids[ids.length - 1];
    const o = id ? view.objects[id] : undefined;
    return o ? <TableCard cards={view.cards} o={o} sizes="48px" /> : <span className="pile-empty" />;
  };
  return (
    <div className="piles">
      <span className="pile" title="Library" aria-label={`Library, ${(g.zones.library[player] ?? []).length} cards`}>
        <span className="pile-card">{(g.zones.library[player] ?? []).length ? <CardBack /> : <span className="pile-empty" />}</span>
        <span className="pile-n">{(g.zones.library[player] ?? []).length}</span>
        <span className="pile-label">Library</span>
      </span>
      <button type="button" className={`pile${lit(yard) ? ' lit' : ''}`} onClick={() => h.onZone(player, 'graveyard')} title="Graveyard — open" aria-label={`Graveyard, ${yard.length} cards`}>
        <span className="pile-card">{topOf(yard)}</span>
        <span className="pile-n">{yard.length}</span>
        <span className="pile-label">Graveyard</span>
      </button>
      <button type="button" className={`pile${lit(exiled) ? ' lit' : ''}`} onClick={() => h.onZone(player, 'exile')} title="Exile — open" aria-label={`Exile, ${exiled.length} cards`}>
        <span className="pile-card">{topOf(exiled)}</span>
        <span className="pile-n">{exiled.length}</span>
        <span className="pile-label">Exile</span>
      </button>
    </div>
  );
}

/** The command zone: commanders (with their tax) and emblems. */
function Command({ g, view, player, h }: { g: GameState; view: PlayerView; player: PlayerId; h: BoardHandlers }) {
  const ids = g.zones.command.filter((id) => {
    const o = g.objects[id]!;
    return o.emblem ? o.controller === player : o.owner === player;
  });
  if (!ids.length) return null;
  return (
    <div className="command" aria-label="Command zone">
      {ids.map((id) => {
        const o = view.objects[id] ?? g.objects[id]!;
        const tax = 2 * (g.commanderCasts[id] ?? 0);
        return (
          <span key={id} className="cmd-slot">
            <button type="button" data-id={id} className={cardClass(id, h, 'cmd-card')} onClick={() => h.onCard(id)} onMouseEnter={(e) => h.onHover(id, e.currentTarget)} onMouseLeave={() => h.onHover(null)} aria-label={`${publicName(id, g)} (command zone${tax ? `, tax ${tax}` : ''})`}>
              <TableCard cards={view.cards} o={o} sizes="72px" />
            </button>
            <span className="cmd-tax">{g.objects[id]?.emblem ? 'Emblem' : tax ? `Tax {${tax}}` : 'Commander'}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Cards the player can play from somewhere other than their hand (graveyard, exile, top of library). */
function Elsewhere({ g, view, player, h }: { g: GameState; view: PlayerView; player: PlayerId; h: BoardHandlers }) {
  const ids = [...h.actionable].filter((id) => {
    const o = g.objects[id];
    return o && o.owner === player && (o.zone === 'graveyard' || o.zone === 'exile' || o.zone === 'library');
  });
  if (!ids.length) return null;
  return (
    <div className="elsewhere" aria-label="Playable from other zones">
      {ids.map((id) => {
        const o = view.objects[id];
        if (!o) return null;
        return (
          <span key={id} className="else-slot">
            <button type="button" data-id={id} className={cardClass(id, h, 'else-card')} onClick={() => h.onCard(id)} onMouseEnter={(e) => h.onHover(id, e.currentTarget)} onMouseLeave={() => h.onHover(null)} aria-label={`${publicName(id, view as unknown as GameState)} (${o.zone})`}>
              <TableCard cards={view.cards} o={o} sizes="80px" />
            </button>
            <span className="else-zone">{o.zone === 'library' ? 'Library top' : o.zone === 'graveyard' ? 'Graveyard' : 'Exile'}</span>
          </span>
        );
      })}
    </div>
  );
}

/** The hand, fanned and overlapping along the bottom edge; a card lifts on hover. */
export function Hand({ view, player, h }: { view: PlayerView; player: PlayerId; h: BoardHandlers }) {
  const hand = view.zones.hand[player];
  if (!Array.isArray(hand)) return null;
  const mid = (hand.length - 1) / 2;
  return (
    <div className="hand" aria-label="Your hand" style={{ ['--n' as string]: hand.length }}>
      {hand.length === 0 && <span className="lane-empty">Your hand is empty</span>}
      {hand.map((id, i) => {
        const o = view.objects[id];
        if (!o) return null;
        const off = i - mid;
        return (
          <button
            key={id}
            type="button"
            data-id={id}
            className={cardClass(id, h, 'hand-card')}
            style={{ ['--r' as string]: `${off * 1.6}deg`, ['--y' as string]: `${Math.abs(off) ** 1.6 * 1.5}px` }}
            onClick={() => h.onCard(id)}
            onMouseEnter={(e) => h.onHover(id, e.currentTarget)}
            onMouseLeave={() => h.onHover(null)}
            aria-label={publicName(id, view as unknown as GameState)}
          >
            <TableCard cards={view.cards} o={o} sizes="128px" />
          </button>
        );
      })}
    </div>
  );
}

/** Another player's hidden hand: a small fan of card backs and the count. */
function HiddenHand({ count }: { count: number }) {
  return (
    <span className="hidden-hand" title={`${count} cards in hand`}>
      <span className="backs">
        {Array.from({ length: Math.min(count, 7) }, (_, i) => (
          <span key={i} className="mini-back">
            <CardBack />
          </span>
        ))}
      </span>
      <span className="pile-label">Hand {count}</span>
    </span>
  );
}

/**
 * A seat: the edge column (life, status, piles, command zone) on the left of the lanes, the same for everyone.
 * Opponents (top) have their back lane above their creatures; the player with the device (bottom) has creatures
 * toward the middle, then the back lane, then their hand across the bottom.
 */
export function Seat({ g, view, player, h, me, deciding }: { g: GameState; view: PlayerView; player: PlayerId; h: BoardHandlers; me: boolean; deciding: boolean }) {
  const handCount = (g.zones.hand[player] ?? []).length;
  return (
    <section className={`seat${me ? ' me' : ' opp'}${deciding ? ' deciding' : ''}`} aria-label={g.players[player]!.name}>
      <div className="seat-edge">
        <Plate g={g} player={player} h={h} deciding={deciding} />
        <Piles g={g} view={view} player={player} h={h} />
        <div className="edge-row">
          <Command g={g} view={view} player={player} h={h} />
          {!me && <HiddenHand count={handCount} />}
        </div>
      </div>
      <Lanes g={g} view={view} player={player} h={h} top={!me} />
      {me && (
        <div className="dock">
          <Elsewhere g={g} view={view} player={player} h={h} />
          <Hand view={view} player={player} h={h} />
        </div>
      )}
    </section>
  );
}
