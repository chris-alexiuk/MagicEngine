import { HAPPENED_FILTER, type AmountExpr, type ConditionNode, type HappeningKind, type ObjectFilter, type Ref } from '@mtg/schema';
import type { Binder } from './binder.js';
import { parseFilter } from './nouns.js';
import { parseAmount } from './words.js';

/**
 * A question about what happened this turn: "a creature died this turn", "creatures that died under your control this
 * turn", "permanents you've sacrificed this turn", "cards put into your graveyard from anywhere this turn". The engine
 * keeps one history of the turn and answers any of them from it (schema HAPPENINGS), so the question is read once
 * here — as a condition ("if …") and as a count ("for each …", "the number of …") — from two parts: what happened,
 * and a noun phrase for what it happened to, read like any other noun phrase.
 */

type Asked = { what: HappeningKind; filter?: ObjectFilter; card?: true; of?: Ref };
type Whose = 'you' | 'opponent' | undefined;

const whose = (word: string | undefined): Whose => (word === 'your' ? 'you' : word ? 'opponent' : undefined);

/**
 * What the thing was: the noun phrase as a filter, with whose it was. "… you controlled" says so in the noun; "card"
 * makes it a question about cards — as printed, and never a token.
 */
function about(what: HappeningKind, noun: string, b: Binder, x: { controller?: Whose; owner?: Whose; of?: Ref; creature?: boolean; cards?: 'only' | 'never' } = {}): Asked | null {
  let n = noun.trim();
  let controller = x.controller;
  const yours = /^(.+) you controlled$/.exec(n);
  if (yours) {
    if (controller) return null;
    controller = 'you';
    n = yours[1]!;
  }
  const cards = /^(?:(.+) )?cards?$/.exec(n);
  if (cards ? x.cards === 'never' : x.cards === 'only') return null;
  if (cards) n = cards[1] ?? '';
  let filter: ObjectFilter = {};
  if (n) {
    const pf = parseFilter(n, b.clone());
    if (!pf) return null;
    filter = { ...pf.filter };
  }
  // Whose it was is said once; and only what the history knows of a thing can be asked of it.
  if (filter.controller && (controller || (filter.controller !== 'you' && filter.controller !== 'opponent'))) return null;
  if (filter.owner || Object.keys(filter).some((k) => !HAPPENED_FILTER.includes(k))) return null;
  // CR 700.4: what "died" is a creature, unless the words name another kind of permanent.
  if (x.creature && !filter.types) filter.types = ['Creature'];
  if (controller) filter.controller = controller;
  if (x.owner) filter.owner = x.owner;
  if (what === 'created') {
    // "tokens you created": a token is all that is created.
    if (filter.token !== true) return null;
    delete filter.token;
  }
  return { what, ...(Object.keys(filter).length ? { filter } : {}), ...(cards ? { card: true as const } : {}), ...(x.of ? { of: x.of } : {}) };
}

/** What happened, and to what: the words between "if"/"for each" and "this turn". */
function happening(clause: string, b: Binder): Asked | null {
  let m: RegExpExecArray | null;
  if ((m = /^(.+?) (?:that )?died(?: under (your|an opponent's) control)?$/.exec(clause))) return about('died', m[1]!, b, { controller: whose(m[2]), creature: true, cards: 'never' });
  if ((m = /^(.+?) (?:that )?left the battlefield(?: under (your|an opponent's) control)?$/.exec(clause))) return about('left', m[1]!, b, { controller: whose(m[2]), cards: 'never' });
  // "put into a graveyard from the battlefield" is "died", said of any permanent; "from anywhere" is said of cards.
  if ((m = /^(.+?) (?:that )?(?:(?:was|were) )?put into (a graveyard|graveyards|your graveyard|their graveyard|that player's graveyard) from (the battlefield|anywhere)$/.exec(clause))) {
    // "their graveyard": the player the sentence is about (Fraying Sanity's enchanted player).
    const other = m[2] === 'their graveyard' || m[2] === "that player's graveyard";
    const of = other && b.player && b.player.ref !== 'you' ? b.player : undefined;
    if (other && !of) return null;
    const owner = other || m[2] === 'your graveyard' ? 'you' : undefined;
    return m[3] === 'anywhere' ? about('put_into_graveyard', m[1]!, b, { owner, ...(of ? { of } : {}), cards: 'only' }) : about('died', m[1]!, b, { owner, ...(of ? { of } : {}), cards: 'never' });
  }
  if ((m = /^(.+?) (?:that )?(?:(?:was|were) )?put into exile$/.exec(clause))) return about('exiled', m[1]!, b, { cards: 'only' });
  if ((m = /^(.+?) (?:that )?left your graveyard$/.exec(clause))) return about('left_graveyard', m[1]!, b, { owner: 'you', cards: 'only' });
  if ((m = /^(.+?) (?:that )?(?:was|were) (?:put into|returned to) your hand from the battlefield$/.exec(clause))) return about('returned_to_hand', m[1]!, b, { owner: 'you', cards: 'never' });
  if ((m = /^(.+?) you(?:'ve| have)? sacrificed$/.exec(clause))) return about('sacrificed', m[1]!, b, { controller: 'you', cards: 'never' });
  if ((m = /^(.+?) (?:that )?(?:(?:was|were) )?sacrificed$/.exec(clause))) return about('sacrificed', m[1]!, b, { cards: 'never' });
  if ((m = /^(.+?) you(?:'ve| have)? created$/.exec(clause))) return about('created', m[1]!, b, { controller: 'you', cards: 'never' });
  return null;
}

/**
 * As a condition: "a creature died this turn", "another Human died under your control this turn", "three or more
 * cards left your graveyard this turn", "you've sacrificed a Food this turn", "no creatures died this turn".
 */
export function happenedCondition(text: string, b: Binder): ConditionNode | null {
  const turn = /^(.+) (this|last) turn$/.exec(text.trim());
  if (!turn) return null;
  // "you've sacrificed a Food" is "a Food you've sacrificed"; "you created a token", "a token you created".
  const did = /^(you(?:'ve| have)?) (sacrificed|created) (.+)$/.exec(turn[1]!);
  const said = did ? `${did[3]} ${did[1]} ${did[2]}` : turn[1]!;
  const q = /^(an?|another|one or more|no|(\w+) or more) (.+)$/i.exec(said);
  if (!q) return null;
  const n = q[2] ? parseAmount(q[2].toLowerCase()) : 1;
  if (typeof n !== 'number') return null;
  // "another Human died": other than this permanent — which is still here, so any Human that died is another. But
  // other than a creature the sentence has just dealt with ("Destroy target creature. If another creature died this
  // turn, …") isn't something the question can say yet: unread.
  if (/^another$/i.test(q[1]!) && b.it && b.it.ref !== 'self') return null;
  const asked = happening(q[3]!, b);
  if (!asked) return null;
  return { type: 'happened', ...asked, ...(q[1]!.toLowerCase() === 'no' ? { max: 0 } : { min: n }), ...(turn[2] === 'last' ? { lastTurn: true } : {}) };
}

/**
 * As a count: "creature that died this turn", "nontoken creatures put into your graveyard from the battlefield this
 * turn", "permanents you've sacrificed this turn", "tokens you created this turn" — in the singular after "for each",
 * in the plural after "the number of".
 */
export function happenedAmount(text: string, b: Binder): AmountExpr | null {
  const turn = /^(.+) (this|last) turn$/.exec(text.trim());
  if (!turn) return null;
  const asked = happening(turn[1]!, b);
  return asked ? { kind: 'happened', ...asked, ...(turn[2] === 'last' ? { lastTurn: true as const } : {}) } : null;
}
