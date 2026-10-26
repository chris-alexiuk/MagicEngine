import type { StaticAbility } from '@mtg/schema';
import type { GrammarRule } from '../parser.js';

/** "~ enters tapped." (current templating) and "~ enters the battlefield tapped." (older). */
export const entersTappedRule: GrammarRule = {
  id: 'enters_tapped',
  parse(line, original) {
    if (!/^~ enters(?: the battlefield)? tapped\.$/.test(line)) return null;
    const node: StaticAbility = { kind: 'static', text: original, effect: { type: 'enters_tapped' } };
    return node;
  },
};
