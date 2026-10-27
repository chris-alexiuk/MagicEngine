import type { KeywordInstance } from '@mtg/schema';

/**
 * Keyword abilities (CR 702) the compiler recognises on keyword lines.
 *
 * `param` says what follows the keyword name:
 *   none     — "Flying"
 *   number   — "Bushido 1", "Crew 3"
 *   cost     — "Equip {2}", "Ward—Pay 3 life", "Escape—{3}{B}{B}, Exile four other cards…"
 *   quality  — "Protection from red", "Enchant creature", "Affinity for artifacts"
 *
 * Adding a mechanic = adding a spec here (or via registry.addKeyword) plus an
 * engine handler keyed by the same id. Nothing else in the compiler changes.
 */
export type KeywordParam = 'none' | 'number' | 'cost' | 'quality';

export interface KeywordSpec {
  id: string;
  /** Lower-case name as printed. */
  name: string;
  param: KeywordParam;
}

const none = (names: string[]): KeywordSpec[] => names.map((name) => ({ id: slug(name), name, param: 'none' }));
const num = (names: string[]): KeywordSpec[] => names.map((name) => ({ id: slug(name), name, param: 'number' }));
const cost = (names: string[]): KeywordSpec[] => names.map((name) => ({ id: slug(name), name, param: 'cost' }));
const quality = (pairs: [string, string][]): KeywordSpec[] =>
  pairs.map(([id, name]) => ({ id, name, param: 'quality' }));

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export const CORE_KEYWORDS: KeywordSpec[] = [
  ...none([
    'flying', 'first strike', 'double strike', 'deathtouch', 'defender', 'flash', 'haste', 'hexproof',
    'indestructible', 'lifelink', 'menace', 'reach', 'trample', 'vigilance', 'fear', 'intimidate', 'shroud',
    'skulk', 'horsemanship', 'changeling', 'devoid', 'flanking', 'phasing', 'wither', 'infect', 'persist',
    'undying', 'exalted', 'convoke', 'delve', 'cascade', 'prowess', 'split second', 'rebound', 'storm',
    'living weapon', 'sunburst', 'provoke', 'soulbond', 'battle cry', 'evolve', 'extort', 'dethrone', 'mentor',
    'riot', 'ascend', 'myriad', 'melee', 'partner', 'improvise', 'assist', 'jump-start', 'undaunted', 'training',
    'decayed', 'daybound', 'nightbound', 'enlist', 'ravenous', 'read ahead', 'unleash', 'haunt', 'epic',
    'gravestorm', 'retrace', 'conspire', 'fuse', 'double team', 'demonstrate', 'banding', 'bargain',
    'living metal', 'cipher', 'aftermath', 'exploit', 'ingest', 'friends forever', 'choose a background',
    'doctor\'s companion', 'compleated', 'for mirrodin!', 'shadow', 'totem armor', 'umbra armor', 'hidden agenda',
    'station', 'start your engines!', 'job select', 'increment',
  ]),
  ...num([
    'absorb', 'afflict', 'afterlife', 'amplify', 'annihilator', 'bloodthirst', 'bushido', 'crew', 'dredge',
    'fabricate', 'fading', 'frenzy', 'graft', 'modular', 'poisonous', 'rampage', 'renown', 'ripple', 'soulshift',
    'tribute', 'vanishing', 'devour', 'toxic', 'backup', 'hideaway', 'casualty', 'saddle', 'mobilize',
    'cumulative upkeep', 'reinforce', 'firebending',
  ]),
  ...cost([
    'bestow', 'blitz', 'buyback', 'cycling', 'dash', 'disturb', 'echo', 'embalm', 'emerge', 'encore', 'entwine',
    'equip', 'escape', 'eternalize', 'evoke', 'flashback', 'foretell', 'fortify', 'kicker', 'multikicker',
    'level up', 'madness', 'megamorph', 'morph', 'mutate', 'ninjutsu', 'commander ninjutsu', 'outlast', 'overload',
    'plot', 'prowl', 'reconfigure', 'replicate', 'scavenge', 'spectacle', 'surge', 'transmute', 'unearth', 'ward',
    'miracle', 'disguise', 'cleave', 'offspring', 'freerunning', 'squad', 'suspend', 'impending', 'transfigure',
    'more than meets the eye', 'aura swap', 'recover', 'warp', 'harmonize', 'sneak', 'exhaust', 'craft',
    'cumulative upkeep', 'reinforce', 'awaken',
  ]),
  ...quality([
    ['protection', 'protection from'],
    ['hexproof_from', 'hexproof from'],
    ['enchant', 'enchant'],
    ['affinity', 'affinity for'],
    ['partner_with', 'partner with'],
    ['companion', 'companion'],
  ]),
];

const LANDWALK = /^((?:non)?[a-z]+ ?[a-z]*)walk$/; // forestwalk, nonbasic landwalk, legendary landwalk
const TYPECYCLING = /^((?:basic )?[a-z]+)cycling (.+)$/; // plainscycling {2}, basic landcycling {1}{G}
const MANA_RUN = /^(\{[^}]+\})+$/;
const NUMBER_DASH_COST = /^\d+—.+/; // suspend 4—{1}{U}, impending 4—{2}{G}{G}
const AND_OR_COSTS = /^(\{[^}]+\})+ and\/or (\{[^}]+\})+$/; // kicker {1}{U} and/or {2}
const QUALIFIED_COST = /^[a-z][a-z ]{0,40} (\{[^}]+\})+$/i; // equip legendary creature {3}, craft with artifact {3}{U}

/**
 * Decides whether the text after a cost keyword is really a cost, so that
 * ordinary sentences such as "Cycling abilities you activate cost {1} less"
 * are not mistaken for a keyword line.
 */
function isCostArg(arg: string, emDash: boolean, strict: boolean): boolean {
  if (arg === '') return false;
  if (MANA_RUN.test(arg)) return true;
  if (strict) return false;
  return emDash || NUMBER_DASH_COST.test(arg) || AND_OR_COSTS.test(arg) || QUALIFIED_COST.test(arg);
}

export class KeywordRegistry {
  private specs: KeywordSpec[] = [];

  constructor(initial: KeywordSpec[] = CORE_KEYWORDS) {
    for (const spec of initial) this.add(spec);
  }

  add(spec: KeywordSpec): void {
    this.specs.push(spec);
    // Longest names first so "double strike" wins over a hypothetical "double".
    this.specs.sort((a, b) => b.name.length - a.name.length);
  }

  get all(): readonly KeywordSpec[] {
    return this.specs;
  }

  /**
   * Parses one comma-separated chunk, e.g. "first strike" or "ward {2}".
   * `strictCost` requires cost params to be pure mana (used when a line was split on commas).
   */
  parseChunk(raw: string, strictCost: boolean): KeywordInstance | null {
    const chunk = raw.trim().replace(/\.$/, '');
    const lower = chunk.toLowerCase();

    const walk = LANDWALK.exec(lower);
    if (walk) return { id: 'landwalk', text: walk[1]!.trim() };

    const typecycle = TYPECYCLING.exec(lower);
    if (typecycle && typecycle[1] !== 'cycling') {
      const c = chunk.slice(chunk.length - typecycle[2]!.length);
      if (!strictCost || MANA_RUN.test(c)) return { id: 'typecycling', text: typecycle[1], cost: c };
    }

    for (const spec of this.specs) {
      if (!lower.startsWith(spec.name)) continue;
      const rest = chunk.slice(spec.name.length);
      // Must end at a word boundary: "flash" must not match "flashback".
      if (rest && !/^[\s—]/.test(rest)) continue;
      const emDash = /^\s*—/.test(rest);
      const arg = rest.replace(/^\s*—\s*|^\s+/, '');

      switch (spec.param) {
        case 'none':
          if (arg === '') return { id: spec.id };
          break;
        case 'number':
          if (/^(\d+|X)$/.test(arg)) return arg === 'X' ? { id: spec.id, text: 'X' } : { id: spec.id, n: Number(arg) };
          break; // a same-named cost spec (e.g. cumulative upkeep {1}) may still match below
        case 'cost':
          if (isCostArg(arg, emDash, strictCost)) {
            // "Suspend 4—{1}{U}": a number and a cost (CR 702.62a).
            const numbered = /^(\d+)—(.+)$/.exec(arg);
            return numbered ? { id: spec.id, n: Number(numbered[1]), cost: numbered[2]! } : { id: spec.id, cost: arg };
          }
          break;
        case 'quality':
          if (arg !== '') return { id: spec.id, text: arg };
          break;
      }
    }
    return null;
  }

  /**
   * Returns the keywords on a line if the whole line is a keyword line, else null.
   * Tries the line as one keyword first (cost forms may contain commas), then a comma list.
   */
  parseLine(line: string): KeywordInstance[] | null {
    const whole = this.parseChunk(line, false);
    if (whole) return [whole];
    const parts = line.split(/,\s*/);
    if (parts.length < 2) return null;
    const out: KeywordInstance[] = [];
    for (const part of parts) {
      const kw = this.parseChunk(part, true);
      if (!kw) return null;
      out.push(kw);
    }
    return out;
  }
}
