import type { GameState, PlayerId, Target, TargetPrompt } from '@mtg/engine';
import { sameTarget } from './labels';

/**
 * What the board offers to click right now. While a choice is being made, only these objects, players and stack
 * entries respond; they come from the engine's candidates (a target prompt or a pending choice), never from the UI.
 */
export interface Pick {
  objects: ReadonlySet<string>;
  players: ReadonlySet<string>;
  entries: ReadonlySet<string>;
  /** What's chosen so far (shown as selected). */
  chosen: readonly Target[];
  onPick: (t: Target) => void;
}

export function pickOf(candidates: readonly Target[], chosen: readonly Target[], onPick: (t: Target) => void): Pick {
  return {
    objects: new Set(candidates.flatMap((t) => (t.kind === 'object' ? [t.object] : []))),
    players: new Set(candidates.flatMap((t) => (t.kind === 'player' ? [t.player] : []))),
    entries: new Set(candidates.flatMap((t) => (t.kind === 'ability' ? [t.entry] : []))),
    chosen,
    onPick,
  };
}

export const isChosen = (pick: Pick | null, t: Target) => Boolean(pick?.chosen.some((c) => sameTarget(c, t)));

/** The player a target stands for: the player, or the permanent's controller (a card's owner elsewhere). */
export function playerOfTarget(g: GameState, t: Target | undefined): PlayerId | undefined {
  if (!t || t.kind === 'ability') return undefined;
  if (t.kind === 'player') return t.player;
  const o = g.objects[t.object];
  return o ? (o.zone === 'battlefield' ? o.controller : o.owner) : undefined;
}

/** A prompt's candidates given the targets picked for earlier prompts ("… that player controls", "attached to it"). */
export function liveCandidates(g: GameState, prompts: readonly TargetPrompt[], picked: readonly Target[][], i: number): Target[] {
  const pr = prompts[i]!;
  let out = pr.candidates;
  if (pr.controlledByTarget !== undefined) {
    const who = playerOfTarget(g, picked[pr.controlledByTarget]?.[0]);
    out = out.filter((t) => who !== undefined && playerOfTarget(g, t) === who);
  }
  if (pr.attachedToTarget !== undefined) {
    const host = picked[pr.attachedToTarget]?.[0];
    out = out.filter((t) => t.kind === 'object' && host?.kind === 'object' && g.objects[t.object]?.attachedTo?.id === host.object);
  }
  const mine = picked[i] ?? [];
  if (pr.sameOwner && mine.length) {
    const owner = mine[0]!.kind === 'object' ? g.objects[mine[0]!.object]?.owner : undefined;
    out = out.filter((t) => t.kind === 'object' && g.objects[t.object]?.owner === owner);
  }
  if (pr.perPlayer && mine.length) {
    const taken = new Set(mine.map((t) => playerOfTarget(g, t)));
    out = out.filter((t) => mine.some((m) => sameTarget(m, t)) || !taken.has(playerOfTarget(g, t)));
  }
  return out;
}

/** The fewest and most targets a prompt takes. */
export function promptRange(pr: TargetPrompt): [number, number] {
  return pr.upTo ? [pr.min ?? 0, pr.count] : [pr.count, pr.count];
}
