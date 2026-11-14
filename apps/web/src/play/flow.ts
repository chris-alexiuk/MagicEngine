import { choiceModes, choicePrompts, costPromptOpen, costPrompts, type Action, type CostPrompt, type GameState } from '@mtg/engine';

/*
 * What the table asks the player before an action is sent (CR 601.2b–h): its modes, its targets, and what pays its
 * costs. The engine says what each of those can be; nothing here decides what is legal.
 */

/** An action whose choices the player makes before it is sent: modes and targets (a spell, an ability), and what pays its costs. */
export type Choosing = Extract<Action, { type: 'cast' | 'activate' | 'activate_mana' }>;
export type Targeting = Extract<Action, { type: 'cast' | 'activate' }>;
export const targeting = (a: Action): a is Targeting => a.type === 'cast' || a.type === 'activate';

/** What the action's costs ask the player to choose, where there is something to decide (the engine's `costPrompts`). */
export function openCostPrompts(g: GameState, a: Choosing): CostPrompt[] {
  try {
    const prompts = costPrompts(g, a);
    return prompts.some(costPromptOpen) ? prompts : [];
  } catch {
    return [];
  }
}

export function needsChoices(g: GameState, a: Action): a is Choosing {
  if (a.type !== 'cast' && a.type !== 'activate' && a.type !== 'activate_mana') return false;
  if (openCostPrompts(g, a).length) return true;
  if (!targeting(a)) return false;
  try {
    return Boolean(choiceModes(g, a)) || choicePrompts(g, a).length > 0;
  } catch {
    return false;
  }
}

