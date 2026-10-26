import { chars, hasType } from './characteristics.js';
import type { ManaCost } from './mana.js';
import { RulesError, type CostChoices, type GameEvent, type GameObject, type GameState, type ManaColor, type ObjectId, type PlayerId } from './types.js';
import { moveObject, setTapped, zoneList } from './zones.js';

/**
 * Keywords that pay part of a spell's cost another way (CR 601.2g–h, after the total cost is set):
 * convoke taps creatures for colored or generic mana (CR 702.51a), improvise taps artifacts and
 * delve exiles cards from your graveyard for generic mana (CR 702.126a, 702.66a).
 */
export function payWithHelpers(g: GameState, player: PlayerId, spell: GameObject, keywords: string[], cost: ManaCost, choices: CostChoices, events: GameEvent[]): void {
  const tapped = new Set<ObjectId>();
  const take = (ids: ObjectId[] | undefined, kw: string, ok: (o: GameObject) => boolean, onEach: (o: GameObject) => void) => {
    if (!ids?.length) return;
    if (!keywords.includes(kw)) throw new RulesError(`That spell doesn’t have ${kw}.`);
    for (const id of ids) {
      const o = g.objects[id];
      if (!o || tapped.has(id) || !ok(o)) throw new RulesError(`That can’t help pay for it with ${kw}.`);
      tapped.add(id);
      onEach(o);
    }
  };
  const untappedYours = (o: GameObject) => o.zone === 'battlefield' && o.controller === player && !o.tapped;
  take(choices.convoke, 'convoke', (o) => untappedYours(o) && hasType(g, o, 'Creature'), (o) => {
    // A colored mana it matches, else a generic one.
    const color = chars(g, o).colors.find((c) => (cost.specific[c as ManaColor] ?? 0) > 0) as ManaColor | undefined;
    if (color) cost.specific[color] = cost.specific[color]! - 1;
    else if (cost.generic > 0) cost.generic--;
    else throw new RulesError('There’s no mana left for that creature to pay.');
  });
  take(choices.improvise, 'improvise', (o) => untappedYours(o) && hasType(g, o, 'Artifact'), () => {
    if (cost.generic <= 0) throw new RulesError('There’s no generic mana left for that artifact to pay.');
    cost.generic--;
  });
  const graveyard = zoneList(g, 'graveyard', player);
  take(choices.delve, 'delve', (o) => o.id !== spell.id && graveyard.includes(o.id), () => {
    if (cost.generic <= 0) throw new RulesError('There’s no generic mana left for that card to pay.');
    cost.generic--;
  });
  for (const id of [...(choices.convoke ?? []), ...(choices.improvise ?? [])]) setTapped(g, id, true, events);
  for (const id of choices.delve ?? []) moveObject(g, id, 'exile', events);
}

/** For the legal-action list: help to cover what the pool can't pay, greedily. */
export function helperChoices(g: GameState, player: PlayerId, spell: GameObject, keywords: string[], cost: ManaCost): CostChoices {
  const out: CostChoices = {};
  const untapped = g.zones.battlefield.filter((id) => {
    const o = g.objects[id]!;
    return o.controller === player && !o.tapped;
  });
  let generic = cost.generic;
  const specific = { ...cost.specific };
  if (keywords.includes('convoke')) {
    const picks: ObjectId[] = [];
    for (const id of untapped) {
      const o = g.objects[id]!;
      if (!hasType(g, o, 'Creature')) continue;
      const color = chars(g, o).colors.find((c) => (specific[c as ManaColor] ?? 0) > 0) as ManaColor | undefined;
      if (color) specific[color] = specific[color]! - 1;
      else if (generic > 0) generic--;
      else continue;
      picks.push(id);
    }
    if (picks.length) out.convoke = picks;
  }
  if (keywords.includes('improvise')) {
    const picks = untapped.filter((id) => hasType(g, g.objects[id]!, 'Artifact') && !hasType(g, g.objects[id]!, 'Creature')).slice(0, generic);
    generic -= picks.length;
    if (picks.length) out.improvise = picks;
  }
  if (keywords.includes('delve')) {
    const picks = zoneList(g, 'graveyard', player).filter((id) => id !== spell.id).slice(0, generic);
    if (picks.length) out.delve = picks;
  }
  return out;
}
