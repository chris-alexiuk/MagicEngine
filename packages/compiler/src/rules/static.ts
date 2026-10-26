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

/** "Equipped creature gets +2/+0." / "Enchanted creature gets -3/-3." — a layer 7c continuous effect. */
export const attachedPumpRule: GrammarRule = {
  id: 'attached_pump',
  parse(line, original) {
    const m = /^(Equipped|Enchanted) creature gets ([+-]\d+)\/([+-]\d+)\.$/.exec(line);
    if (!m) return null;
    const node: StaticAbility = {
      kind: 'static',
      text: original,
      effect: {
        type: 'modify_pt',
        affected: { attachedBy: m[1] === 'Equipped' ? 'equipment' : 'aura' },
        power: Number(m[2]),
        toughness: Number(m[3]),
      },
    };
    return node;
  },
};
