/**
 * Rules engine — milestone 2.
 *
 * Contract (fixed now so the web client and server can be built against it):
 *   - Pure and deterministic: no DOM, no clock, no Math.random. Same seed + same
 *     actions ⇒ same game. Runs in a Web Worker (client) and in Node (server).
 *   - State changes only through `apply(state, action)`, which returns the new
 *     state plus the events it produced. The event log is the replay, the
 *     network protocol and the bug report.
 *   - When a player must choose, the engine returns a PendingChoice instead of
 *     guessing. UI, remote players and (later) bots answer the same way.
 *   - Card behaviour comes from the compiled AST. Each `EffectNode.type`,
 *     keyword id and trigger type resolves through a registry, so a mechanic is
 *     a plugin that registers handlers; nothing in the core switches on card names.
 *   - Anything without a handler falls back to manual resolution.
 */
import type { EffectNode } from '@mtg/schema';

export type PlayerId = string;

export interface PendingChoice {
  player: PlayerId;
  kind: string; // 'targets' | 'mode' | 'blockers' | 'order_triggers' | 'mulligan' | …
  prompt: string;
  options: unknown;
}

/** A mechanic plugin registers handlers by the string tags that appear in the AST. */
export interface MechanicPlugin {
  id: string;
  effects?: Record<string, EffectHandler>;
  keywords?: Record<string, unknown>;
}

/** `ctx` becomes a typed game context in milestone 2. */
export type EffectHandler = (node: EffectNode, ctx: unknown) => void;
