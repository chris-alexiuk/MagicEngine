import type { AddManaEffect } from '@mtg/schema';
import { MANA_COLORS } from './mana.js';
import { installPlugin, type MechanicPlugin } from './registry.js';
import type { ManaColor } from './types.js';

/** Handlers for the AST nodes the compiler emits today. */
export const corePlugin: MechanicPlugin = {
  id: 'core',
  effects: {
    // CR 106.4: added mana goes into the player's mana pool.
    add_mana(node, ctx) {
      const effect = node as AddManaEffect;
      let mana: ManaColor[] | undefined;
      if (effect.anyColor) {
        const color = typeof ctx.choice === 'string' ? ctx.choice : undefined;
        if (!color || color === 'C' || !MANA_COLORS.includes(color)) return false;
        mana = Array.from({ length: effect.anyColor }, () => color);
      } else if (effect.options) {
        const index = typeof ctx.choice === 'number' ? ctx.choice : effect.options.length === 1 ? 0 : -1;
        const option = effect.options[index];
        if (!option) return false;
        mana = option as ManaColor[];
      }
      if (!mana) return false;
      const pool = ctx.g.players[ctx.controller]!.pool;
      for (const c of mana) pool[c]++;
      ctx.events.push({ type: 'mana_added', player: ctx.controller, mana });
      return true;
    },
  },
  enterReplacements: {
    // CR 614.1d / 614.12: "[This permanent] enters tapped" is a replacement effect on how it enters.
    enters_tapped(_node, o) {
      o.tapped = true;
    },
  },
};

installPlugin(corePlugin);
