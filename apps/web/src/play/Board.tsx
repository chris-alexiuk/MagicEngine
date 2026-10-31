import type { Characteristics, GameObject, GameState, PlayerId, PlayerView, Target } from '@mtg/engine';
import { ManaSymbol } from '../components/bits';
import { CardBack, shownCard, TableCard } from './cards';
import { publicName } from './log';
import { isChosen, type Pick } from './pick';

export interface BoardHandlers {
  pick: Pick | null;
  selected: string | null;
  /** Objects the player with the device can do something with right now (from legalActions). */
  actionable: ReadonlySet<string>;
  /** Of those, the ones whose only actions are mana abilities (highlighted more quietly). */
  manaOnly: ReadonlySet<string>;
  onCard: (id: string) => void;
  onPlayer: (id: PlayerId) => void;
  onHover: (id: string | null, el?: HTMLElement) => void;
  onZone: (player: PlayerId, zone: 'graveyard' | 'exile') => void;
  /** Characteristics of permanents (layers applied), computed once per state. */
  chars: (id: string) => Characteristics;
}

const obj = (id: string): Target => ({ kind: 'object', object: id });

function cardClass(id: string, h: BoardHandlers, extra = ''): string {
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
  return cls.join(' ');
}

const COUNTER_LABEL: Record<string, string> = { '+1/+1': '+1/+1', '-1/-1': '−1/−1', loyalty: 'loyalty' };

/** One permanent: the card (rotated when tapped), with its numbers in a strip below it — never on the image. */
function Permanent({ g, view, o, h, attached, count }: { g: GameState; view: PlayerView; o: GameObject; h: BoardHandlers; attached: GameObject[]; count?: number }) {
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
        onClick={() => h.onCard(o.id)}
        onMouseEnter={(e) => h.onHover(o.id, e.currentTarget)}
        onMouseLeave={() => h.onHover(null)}
        aria-label={`${name}${o.tapped ? ', tapped' : ''}`}
        aria-pressed={h.selected === o.id}
      >
        <span className="perm-rot">
          <TableCard cards={view.cards} o={vo} sizes="80px" />
        </span>
        {count && count > 1 ? <span className="stack-count">×{count}</span> : null}
      </button>
      <div className="perm-stats">
        {isCreature && (
          <span className={`pt${c.power > printedP || c.toughness > printedT ? ' up' : ''}${c.power < printedP || c.toughness < printedT ? ' down' : ''}`}>
            {c.power}/{c.toughness}
          </span>
        )}
        {o.damage > 0 && <span className="dmg" title="Damage marked">−{o.damage}</span>}
        {loyalty !== null && <span className="loyal" title="Loyalty">{loyalty}</span>}
        {counters.map(([k, n]) => (
          <span key={k} className="ctr" title={`${n} ${k} counter${n === 1 ? '' : 's'}`}>
            {n}× {COUNTER_LABEL[k] ?? k}
          </span>
        ))}
        {isCreature && o.sick && !c.keywords.some((k) => k.id === 'haste') && g.active === o.controller && <span className="sick" title="Summoning sick">sick</span>}
        {o.faceDown && <span className="ctr">face down</span>}
        {o.token && <span className="ctr">token</span>}
      </div>
      {granted.length > 0 && <div className="perm-kw">{granted.join(', ')}</div>}
      {atk && <div className="perm-combat">⚔ {atk.target.kind === 'player' ? (g.players[atk.target.player]?.name ?? '') : publicName(atk.target.object, g)}{atk.blocked ? ' · blocked' : ''}</div>}
      {blk && <div className="perm-combat">⛨ {publicName(blk.blocking, g)}</div>}
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

/** Identical lands with nothing on them, and in the same tapped state, show as one stack — unless they can be chosen now. */
function groupLands(g: GameState, ids: string[], pick: Pick | null, attachedTo: Map<string, GameObject[]>): { o: GameObject; count: number }[] {
  const out: { o: GameObject; count: number; key: string }[] = [];
  for (const id of ids) {
    const o = g.objects[id]!;
    const plain = !pick?.objects.has(id) && !Object.values(o.counters).some((n) => (n ?? 0) > 0) && !attachedTo.has(id) && !o.faceDown && !o.copyOf;
    const key = plain ? `${o.card}|${o.tapped}` : id;
    const hit = plain ? out.find((x) => x.key === key) : undefined;
    if (hit) hit.count++;
    else out.push({ o, count: 1, key });
  }
  return out;
}

function Battlefield({ g, view, player, h }: { g: GameState; view: PlayerView; player: PlayerId; h: BoardHandlers }) {
  const mine = g.zones.battlefield.map((id) => g.objects[id]!).filter((o) => o.controller === player);
  const attachedTo = new Map<string, GameObject[]>();
  const hosted = new Set<string>();
  for (const o of g.zones.battlefield.map((id) => g.objects[id]!)) {
    const host = o.attachedTo && g.objects[o.attachedTo.id];
    if (host && host.zone === 'battlefield' && host.zcc === o.attachedTo!.zcc) {
      attachedTo.set(host.id, [...(attachedTo.get(host.id) ?? []), o]);
      hosted.add(o.id);
    }
  }
  const free = mine.filter((o) => !hosted.has(o.id));
  const creatures: GameObject[] = [];
  const lands: string[] = [];
  const other: GameObject[] = [];
  for (const o of free) {
    const c = h.chars(o.id);
    if (c.types.includes('Creature')) creatures.push(o);
    else if (c.types.includes('Land')) lands.push(o.id);
    else other.push(o);
  }
  // Attachments controlled by this player on someone else's permanent are shown there.
  const row = (list: { o: GameObject; count: number }[], cls: string) => (
    <div className={`bf-row ${cls}`}>
      {list.map(({ o, count }) => (
        <Permanent key={o.id} g={g} view={view} o={o} h={h} attached={attachedTo.get(o.id) ?? []} count={count} />
      ))}
    </div>
  );
  return (
    <div className="battlefield">
      {free.length === 0 && <span className="bf-empty">Nothing on the battlefield yet.</span>}
      {creatures.length > 0 && row(creatures.map((o) => ({ o, count: 1 })), 'row-creatures')}
      {other.length > 0 && row(other.map((o) => ({ o, count: 1 })), 'row-other')}
      {lands.length > 0 && row(groupLands(g, lands, h.pick, attachedTo), 'row-lands')}
    </div>
  );
}

function Pool({ g, player }: { g: GameState; player: PlayerId }) {
  const pool = g.players[player]!.pool;
  const pips = (Object.entries(pool) as [string, number][]).flatMap(([c, n]) => Array.from({ length: n }, () => c));
  const restricted = (g.players[player]!.restricted ?? []).reduce((n, r) => n + r.amount, 0);
  if (!pips.length && !restricted) return null;
  return (
    <span className="pool" title="Mana pool">
      {pips.map((c, i) => (
        <ManaSymbol key={i} symbol={c} />
      ))}
      {restricted > 0 && <span className="muted"> +{restricted} restricted</span>}
    </span>
  );
}

export function Plate({ g, view, player, h, deciding, compact }: { g: GameState; view: PlayerView; player: PlayerId; h: BoardHandlers; deciding: boolean; compact: boolean }) {
  const ps = g.players[player]!;
  const t: Target = { kind: 'player', player };
  const pickable = h.pick?.players.has(player);
  const chosen = isChosen(h.pick, t);
  const handCount = (g.zones.hand[player] ?? []).length;
  const yard = g.zones.graveyard[player] ?? [];
  const exiled = g.zones.exile.filter((id) => g.objects[id]?.owner === player);
  // CR 903.10a: combat damage each commander has dealt this player.
  const cmdDamage = Object.entries(g.commanderDamage[player] ?? {}).filter(([, n]) => n > 0);
  const command = g.zones.command.filter((id) => {
    const o = g.objects[id]!;
    return o.emblem ? o.controller === player : o.owner === player;
  });
  const others = Object.entries(ps.counters ?? {}).filter(([, n]) => n > 0);
  return (
    <div className={`plate${deciding ? ' deciding' : ''}${g.active === player ? ' active' : ''}${ps.lost ? ' lost' : ''}`}>
      <button
        type="button"
        className={`life${pickable ? ' pickable' : ''}${chosen ? ' picked' : ''}`}
        disabled={!pickable}
        onClick={() => h.onPlayer(player)}
        aria-label={`${ps.name}, ${ps.life} life${pickable ? ', choose as target' : ''}`}
      >
        <span className="life-n">{ps.life}</span>
        <span className="life-name">{ps.name}</span>
      </button>
      <div className="plate-line">
        {g.active === player && <span className="badge active-badge">Active</span>}
        {deciding && <span className="badge deciding-badge">Deciding</span>}
        {ps.lost && <span className="badge lost-badge">Out</span>}
        {g.monarch === player && <span className="badge">Monarch</span>}
        {g.initiative === player && <span className="badge">Initiative</span>}
        {ps.poison > 0 && <span className="badge poison">☠ {ps.poison} poison</span>}
        {others.map(([k, n]) => (
          <span key={k} className="badge">
            {n} {k}
          </span>
        ))}
      </div>
      <Pool g={g} player={player} />
      <div className="zones-line">
        <span>Library {(g.zones.library[player] ?? []).length}</span>
        <span>Hand {handCount}</span>
        <button type="button" className="zone-btn" onClick={() => h.onZone(player, 'graveyard')}>
          Graveyard {yard.length}
        </button>
        <button type="button" className="zone-btn" onClick={() => h.onZone(player, 'exile')}>
          Exile {exiled.length}
        </button>
      </div>
      {cmdDamage.length > 0 && (
        <div className="cmd-dmg">
          {cmdDamage.map(([id, n]) => (
            <span key={id} title="Commander damage taken (21 loses)">
              ⚔ {publicName(id, g)} {n}/21
            </span>
          ))}
        </div>
      )}
      {command.length > 0 && (
        <div className={`command${compact ? ' compact' : ''}`} aria-label="Command zone">
          {command.map((id) => {
            const o = view.objects[id] ?? g.objects[id]!;
            const tax = g.commanderCasts[id] ?? 0;
            return (
              <button key={id} type="button" data-id={id} className={cardClass(id, h, 'cmd-card')} onClick={() => h.onCard(id)} onMouseEnter={(e) => h.onHover(id, e.currentTarget)} onMouseLeave={() => h.onHover(null)} title={tax ? `Commander tax {${2 * tax}}` : 'Command zone'}>
                <TableCard cards={view.cards} o={o} sizes="60px" />
                {tax > 0 && <span className="tax">+{2 * tax}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Hand({ view, player, h }: { view: PlayerView; player: PlayerId; h: BoardHandlers }) {
  const hand = view.zones.hand[player];
  if (!Array.isArray(hand)) {
    const n = hand ?? 0;
    return (
      <div className="hand hidden-hand" aria-label={`${n} cards in hand`}>
        {Array.from({ length: Math.min(n, 12) }, (_, i) => (
          <span key={i} className="hand-back">
            <CardBack />
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="hand" aria-label="Your hand">
      {hand.length === 0 && <span className="bf-empty">Your hand is empty</span>}
      {hand.map((id) => {
        const o = view.objects[id];
        if (!o) return null;
        return (
          <button key={id} type="button" data-id={id} className={cardClass(id, h, 'hand-card')} onClick={() => h.onCard(id)} onMouseEnter={(e) => h.onHover(id, e.currentTarget)} onMouseLeave={() => h.onHover(null)} aria-label={publicName(id, view as unknown as GameState)}>
            <TableCard cards={view.cards} o={o} sizes="110px" />
          </button>
        );
      })}
    </div>
  );
}

export function SeatArea({ g, view, player, h, isViewer, deciding, compact }: { g: GameState; view: PlayerView; player: PlayerId; h: BoardHandlers; isViewer: boolean; deciding: boolean; compact: boolean }) {
  return (
    <section className={`seat${isViewer ? ' me' : ' opp'}${compact ? ' compact' : ''}`} aria-label={g.players[player]!.name}>
      <div className="seat-grid">
        <Plate g={g} view={view} player={player} h={h} deciding={deciding} compact={compact} />
        <Battlefield g={g} view={view} player={player} h={h} />
      </div>
      {isViewer && <Hand view={view} player={player} h={h} />}
    </section>
  );
}
