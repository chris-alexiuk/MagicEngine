/**
 * Whether damage is the damage a static ability's description is about (schema `DamageFilter`): its source, who it
 * would be dealt to, in combat or not. One reading for every ability that names damage — prevention, redirection,
 * "deals double that damage instead", "can't be prevented" — from the point of view of the permanent with the ability
 * (`holder`): "you" is its controller, "this creature" is it, "enchanted creature" is what it is attached to.
 */
import type { DamageFilter } from '@mtg/schema';
import { matchesFilter } from './characteristics.js';
import type { DamageRecipient, GameObject, GameState, PlayerId } from './types.js';

/** The damage as it is about to be dealt. */
export interface DamageAbout {
  source: GameObject;
  to: DamageRecipient;
  combat: boolean;
}

function fitsPlayer(players: DamageFilter['players'], holder: GameObject, p: PlayerId): boolean {
  switch (players) {
    case 'you':
      return p === holder.controller;
    case 'opponents':
      return p !== holder.controller;
    case 'each':
      return true;
    // Curse of Bloodletting: the player this Aura is attached to.
    case 'enchanted':
      return p === holder.attachedToPlayer;
    // Sawhorn Nemesis: the player chosen as it entered.
    case 'chosen':
      return holder.chosen?.player !== undefined && p === holder.chosen.player;
    default:
      return false;
  }
}

export function fitsDamage(g: GameState, spec: DamageFilter | undefined, holder: GameObject, d: DamageAbout): boolean {
  if (!spec) return true;
  if (spec.combat !== undefined && spec.combat !== d.combat) return false;
  const ctx = { controller: holder.controller, source: holder };
  // The source may be anywhere (a spell, a card that has left the battlefield).
  if (spec.by && !matchesFilter(g, d.source, spec.by, { ...ctx, anyZone: true })) return false;
  if (spec.players !== undefined || spec.objects !== undefined) {
    if (d.to.kind === 'player') {
      if (!fitsPlayer(spec.players, holder, d.to.player)) return false;
    } else {
      const o = g.objects[d.to.object];
      if (!o || spec.objects === undefined) return false;
      if (spec.objects === 'theirs' ? !fitsPlayer(spec.players, holder, o.controller) : !matchesFilter(g, o, spec.objects, ctx)) return false;
    }
  }
  return !spec.anyOf || spec.anyOf.some((alt) => fitsDamage(g, alt, holder, d));
}
