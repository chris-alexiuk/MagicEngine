import { SUBTYPES, type AsEntersNode, type Color } from '@mtg/schema';
import { chars, hasType, matchesFilter } from './characteristics.js';
import { lifeLoss, replaceQuantity } from './quantities.js';
import { sacrifice } from './permanents.js';
import { RulesError, type ChoiceAnswer, type GameEvent, type GameObject, type GameState, type PlayerId } from './types.js';
import { copiable, withExceptions } from './copies.js';
import { onEnterBattlefield } from './registry.js';
import { faceOf, livePlayers, nameOf, zoneList } from './zones.js';

/**
 * Choices made as a permanent enters (CR 614.12): "As ~ enters, you may pay 2 life. If you
 * don't, it enters tapped." / "As ~ enters, choose a color."
 *
 * The permanent's "enters" replacement records the choice to make; before anyone gets
 * priority again (and before triggered abilities go on the stack), its controller is asked.
 * No player can act in between, so this is the same as choosing as it enters.
 */

const COLORS: Color[] = ['W', 'U', 'B', 'R', 'G'];

/** Called as the permanent enters: "This land enters tapped. As it enters, choose a color." taps it now. */
export function queueAsEnters(g: GameState, o: GameObject, node: AsEntersNode): void {
  if (node.tapped) o.tapped = true;
  (g.asEnters ??= []).push({ object: o.id, zcc: o.zcc, node });
}

function candidatesFor(g: GameState, o: GameObject, node: AsEntersNode): string[] {
  return zoneList(g, 'hand', o.controller).filter((id) => matchesFilter(g, g.objects[id]!, node.filter ?? {}, { controller: o.controller, source: o }));
}

/** Asks for the next pending "as enters" choice. True if a choice is now pending. */
export function promptAsEnters(g: GameState): boolean {
  while (g.asEnters?.length && !g.pending) {
    const next = g.asEnters[0]!;
    const o = g.objects[next.object];
    if (!o || o.zcc !== next.zcc || o.zone !== 'battlefield') {
      g.asEnters.shift();
      continue;
    }
    const { node } = next;
    const base = { kind: 'as_enters' as const, player: o.controller, object: o.id, sourceName: nameOf(g, o), choice: node.choice };
    switch (node.choice) {
      case 'pay_life':
        g.pending = { ...base, text: `Pay ${node.amount} life, or ${nameOf(g, o)} enters tapped.`, amount: node.amount ?? 0 };
        break;
      case 'reveal':
        g.pending = { ...base, text: `Reveal a card, or ${nameOf(g, o)} enters tapped.`, candidates: candidatesFor(g, o, node) };
        break;
      case 'color':
        g.pending = { ...base, text: 'Choose a color.', options: COLORS.filter((c) => c !== node.except) };
        break;
      case 'creature_type':
        g.pending = { ...base, text: 'Choose a creature type.', options: [...SUBTYPES.creature] };
        break;
      case 'player':
        // "As ~ enters, choose a player" / "… choose an opponent" (CR 800.4a: one still in the game).
        g.pending = { ...base, text: node.opponent ? 'Choose an opponent.' : 'Choose a player.', options: livePlayers(g).filter((p) => !node.opponent || p !== o.controller) };
        break;
      case 'card_type':
        // CR 205.2a: the card types.
        g.pending = { ...base, text: 'Choose a card type.', options: node.options ?? ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Instant', 'Kindred', 'Land', 'Planeswalker', 'Sorcery'] };
        break;
      case 'card_name': {
        // CR 201.3: any card name may be chosen; only the names of cards in this game can matter here.
        const kinds = node.filter ?? {};
        const names = new Set<string>();
        for (const def of Object.values(g.cards)) {
          const face = def.faces[0];
          if (!face || def.layout === 'token') continue;
          if (kinds.notTypes?.some((t) => face.types.includes(t)) || (kinds.types && !kinds.types.some((t) => face.types.includes(t)))) continue;
          names.add(def.faces.length > 1 && (def.layout === 'split' || def.layout === 'adventure') ? def.name : face.name);
        }
        g.pending = { ...base, text: 'Choose a card name.', options: [...names].sort() };
        break;
      }
      case 'devour': {
        // CR 702.82a: "As this object enters, you may sacrifice any number of creatures."
        const candidates = g.zones.battlefield.filter((id) => id !== o.id && g.objects[id]!.controller === o.controller && hasType(g, g.objects[id]!, 'Creature'));
        if (!candidates.length) {
          g.asEnters.shift();
          continue;
        }
        g.pending = { ...base, text: `Sacrifice any number of creatures as ${nameOf(g, o)} enters (devour ${node.amount}).`, candidates };
        break;
      }
      case 'counter':
        // CR 702.136a / CR 702.98a: riot and unleash.
        g.pending = { ...base, text: node.elseHaste ? `Have ${nameOf(g, o)} enter with an additional +1/+1 counter? If not, it gains haste.` : `Have ${nameOf(g, o)} enter with an additional +1/+1 counter?` };
        break;
      case 'read_ahead':
        g.pending = { ...base, text: `Choose a chapter for ${nameOf(g, o)} to start on (read ahead).`, options: Array.from({ length: node.amount ?? 1 }, (_, i) => String(i + 1)) };
        break;
      case 'copy': {
        // CR 707.5: "You may have ~ enter as a copy of any creature on the battlefield."
        // Or "any creature card in a graveyard" (Body Double).
        const pool = node.filter?.zone === 'graveyard' ? Object.values(g.zones.graveyard).flat() : g.zones.battlefield;
        const candidates = pool.filter((id) => id !== o.id && matchesFilter(g, g.objects[id]!, node.filter ?? {}, { controller: o.controller, source: o }));
        if (!candidates.length) {
          g.asEnters.shift();
          continue;
        }
        g.pending = { ...base, text: `Choose what ${nameOf(g, o)} enters as a copy of, or nothing.`, candidates };
        break;
      }
    }
  }
  return Boolean(g.pending);
}

export function answerAsEnters(g: GameState, player: PlayerId, answer: Extract<ChoiceAnswer, { kind: 'as_enters' }>, events: GameEvent[]): void {
  const p = g.pending as Extract<NonNullable<GameState['pending']>, { kind: 'as_enters' }>;
  const next = g.asEnters?.[0];
  const o = g.objects[p.object]!;
  if (!next) throw new RulesError('Nothing is entering.');
  switch (p.choice) {
    case 'pay_life': {
      const amount = p.amount ?? 0;
      if (answer.pay) {
        // CR 119.4: a player can pay life only if their life total is at least that much.
        const ps = g.players[player]!;
        if (ps.life < amount) throw new RulesError(`You don’t have ${amount} life to pay.`);
        const lost = lifeLoss(g, player, amount);
        ps.life -= lost;
        events.push({ type: 'life', player, delta: -lost, life: ps.life });
      } else o.tapped = true;
      break;
    }
    case 'devour': {
      const chosen = answer.sacrifice ?? [];
      if (new Set(chosen).size !== chosen.length || !chosen.every((id) => p.candidates?.includes(id))) throw new RulesError('Choose creatures you control to sacrifice.');
      for (const id of chosen) sacrifice(g, g.objects[id]!, player, events);
      // "This permanent enters with N +1/+1 counters on it for each creature sacrificed this way."
      const n = Number(next.node.amount ?? 1) * chosen.length;
      if (n > 0) o.counters['+1/+1'] = (o.counters['+1/+1'] ?? 0) + n;
      break;
    }
    case 'counter': {
      if (answer.pay) o.counters['+1/+1'] = (o.counters['+1/+1'] ?? 0) + 1;
      else if (next.node.elseHaste) {
        // "If you don't, it gains haste" — for as long as it's on the battlefield.
        g.effects.push({ id: `e${g.nextId++}`, timestamp: ++g.clock, source: { id: o.id, zcc: o.zcc }, controller: o.controller, objects: [{ id: o.id, zcc: o.zcc }], keywords: [{ id: 'haste' }], until: 'game' });
      }
      break;
    }
    case 'reveal': {
      if (answer.reveal) {
        if (!p.candidates?.includes(answer.reveal)) throw new RulesError('Reveal one of the cards that qualify.');
        events.push({ type: 'revealed', player, objects: [answer.reveal] });
      } else o.tapped = true;
      break;
    }
    case 'copy': {
      if (answer.copy) {
        if (!p.candidates?.includes(answer.copy)) throw new RulesError('Choose one of the permanents it can copy.');
        const original = g.objects[answer.copy]!;
        // CR 707.2: the copiable values of the original, with this effect's exceptions (CR 707.9).
        o.copyOf = withExceptions(g, copiable(original), next.node.copyExcept);
        events.push({ type: 'became_copy', object: o.id, of: original.id });
        // Vesuva: "You may have this land enter tapped as a copy of any land on the battlefield."
        if (next.node.copyTapped) o.tapped = true;
        // CR 306.5b / 707.5: a copy of a planeswalker enters with its loyalty (a battle, its defense).
        const copied = faceOf(g, o);
        if (copied.loyalty !== undefined && /^\d+$/.test(copied.loyalty) && !o.counters.loyalty) o.counters.loyalty = Number(copied.loyalty);
        if (copied.defense !== undefined && /^\d+$/.test(copied.defense) && !o.counters.defense) o.counters.defense = Number(copied.defense);
        // CR 707.5: the copied permanent's own "enters with" / "as ~ enters" abilities apply as it enters.
        onEnterBattlefield(g, o, events);
        // Spark Double: "… except it enters with an additional +1/+1 counter on it if it's a creature" (CR 614.1c).
        for (const w of next.node.copyExcept?.entersWith ?? []) {
          if (w.ifType && !chars(g, o).types.includes(w.ifType)) continue;
          const n = replaceQuantity(g, 'counters', w.amount, { player: o.controller, object: o, counter: w.counter });
          if (n > 0) o.counters[w.counter] = (o.counters[w.counter] ?? 0) + n;
        }
      }
      break;
    }
    case 'read_ahead': {
      // CR 702.155b: it enters with the chosen number of lore counters.
      const n = Number(answer.choice);
      if (!p.options?.includes(String(answer.choice))) throw new RulesError(`Choose a chapter from 1 to ${p.options?.length}.`);
      o.counters.lore = (o.counters.lore ?? 0) + n;
      events.push({ type: 'counters', object: o.id, counter: 'lore', delta: n });
      break;
    }
    case 'color':
    case 'creature_type':
    case 'card_type':
    case 'player':
    case 'card_name': {
      const choice = answer.choice;
      if (!choice || !p.options?.includes(choice)) throw new RulesError(`Choose one of: ${p.options?.slice(0, 6).join(', ')}…`);
      o.chosen = { ...o.chosen, ...(p.choice === 'color' ? { color: choice as Color } : p.choice === 'card_name' ? { cardName: choice } : p.choice === 'card_type' ? { cardType: choice } : p.choice === 'player' ? { player: choice } : { creatureType: choice }) };
      events.push({ type: 'chosen', object: o.id, choice });
      // Banner of Kinship: counters for each permanent of the chosen type, put on it as it enters (CR 122.6).
      const then = next.node.thenCounters;
      if (then) {
        const counted = g.zones.battlefield.filter((id) => id !== o.id && matchesFilter(g, g.objects[id]!, then.filter, { controller: o.controller, source: o })).length;
        const n = replaceQuantity(g, 'counters', counted, { player: o.controller, object: o, counter: then.counter });
        if (n > 0) {
          o.counters[then.counter] = (o.counters[then.counter] ?? 0) + n;
          events.push({ type: 'counters', object: o.id, counter: then.counter, delta: n, by: o.controller });
        }
      }
      break;
    }
  }
  g.asEnters!.splice(g.asEnters!.indexOf(next), 1);
  g.pending = null;
}

/** CR 603.6d / 707.5: while a permanent is choosing what to enter as a copy of, its "enters" triggers wait. */
export function copyChoicePending(g: GameState): boolean {
  return Boolean(g.asEnters?.some((e) => (e.node.choice === 'copy' || e.node.choice === 'read_ahead') && g.objects[e.object]?.zcc === e.zcc && g.objects[e.object]?.zone === 'battlefield'));
}
