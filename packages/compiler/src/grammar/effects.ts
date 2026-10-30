import type { AddManaEffect, AmountExpr, ConditionNode, EffectNode, FaceDef, ManaSpend, ObjectFilter, Ref, RuleFlag, TargetSpec } from '@mtg/schema';
import { SUBTYPES } from '@mtg/schema';
import { parseManaProduction } from '../rules/mana.js';
import { attempt, bindTargetsX, type Binder } from './binder.js';
import { bindX, parseCount, parseForEach, scaleBy } from './amounts.js';
import { parseCombatRule } from './combat.js';
import { parseCopyExcept } from './copies.js';
import { parseCondition } from './conditions.js';
import { parseFilter, parseKeywordList, parseObjectRef, parsePlayerRef, parseRecipients } from './nouns.js';
import { quotedLivePT } from './quoted.js';
import { addTokenText, parseTokenPhrase } from './tokens.js';
import { COLOR_WORDS, parseAmount, parsePT, subtypeOf, TYPE_NOUNS } from './words.js';

/**
 * Effect text → effect nodes, compositionally:
 *   text      = sentence ( ". " sentence )*
 *   sentence  = clause ( ", then " clause | " and " clause )*   — a later clause may reuse the subject
 *   clause    = [subject] verb arguments
 * Everything is all-or-nothing: if any part doesn't parse, the whole text is rejected.
 */

/** Splits on sentence ends. Quoted abilities aren't supported yet, so text with quotes is rejected. */
export function splitSentences(text: string): string[] | null {
  if (/["“”]/.test(text)) return null;
  const t = text.trim();
  if (!t.endsWith('.')) return null;
  return t
    .slice(0, -1)
    .split(/\.\s+/)
    .map((s) => s.trim());
}

/** Keyword definitions read as one effect each (CR 702.85a cascade). */
const WHOLE_TEXTS: [RegExp, EffectNode[]][] = [
  [
    /^Exile cards from the top of your library until you exile a nonland card whose mana value is less than ~'s mana value\. You may cast that card without paying its mana cost if the resulting spell's mana value is less than ~'s mana value\. Then put all cards exiled this way that weren't cast on the bottom of your library in a random order\.$/,
    [{ type: 'cascade' }],
  ],
];

export function parseEffectText(text: string, b: Binder): EffectNode[] | null {
  for (const [re, effects] of WHOLE_TEXTS) if (re.test(text.trim())) return structuredClone(effects);
  // Elven Farsight: "Scry 3, then you may reveal the top card of your library. If a creature card is revealed this way, draw a
  // card."; Isolated Watchtower: "… If a basic land card is revealed this way, put it onto the battlefield tapped."
  const mayRevealTop = /^(?:(.+?), then y|Y)ou may reveal the top card of your library\. If an? (.+?) card is revealed this way, ([^.]+)\.$/.exec(text.trim());
  if (mayRevealTop) {
    const r = attempt(b, (b) => {
      const before = mayRevealTop[1] ? parseEffectText(`${mayRevealTop[1]}.`, b) : [];
      const pf = before ? parseFilter(`${mayRevealTop[2]} card in your library`, b) : null;
      if (!before || !pf || pf.plural || pf.filter.controller) return null;
      delete pf.filter.zone;
      delete pf.filter.owner;
      const it = b.it;
      b.it = { ref: 'chosen_object' };
      const then = parseEffectText(`${mayRevealTop[3]}.`, b);
      b.it = it;
      if (!then) return null;
      return [...before, { type: 'may_do', effects: [{ type: 'reveal_top_card' }], then: [{ type: 'if', cond: { type: 'is', of: { ref: 'chosen_object' }, filter: pf.filter }, effects: then }] } as EffectNode];
    });
    if (r) return r;
  }
  // Stonehewer Giant: "Search your library for an Equipment card, put it onto the battlefield, attach it to a creature you
  // control, then shuffle." — the creature chosen as it resolves.
  const searchAttach = /^(Search your library for an? [^.]+?), put it onto the battlefield, attach it to (a creature you control), then shuffle\.$/.exec(text.trim());
  if (searchAttach) {
    const r = attempt(b, (b) => {
      const inner = parseEffectText(`${searchAttach[1]}, put it onto the battlefield, then shuffle.`, b);
      const pf = parseFilter(searchAttach[2]!.replace(/^a /, ''), b);
      if (inner?.length !== 1 || inner[0]!.type !== 'search' || !pf || pf.plural) return null;
      return [...inner, { type: 'attach', what: { ref: 'created' }, choose: pf.filter } as EffectNode];
    });
    if (r) return r;
  }
  // Spinner of Souls: "you may reveal cards from the top of your library until you reveal a creature card. Put that card into
  // your hand and the rest on the bottom …" — the whole of it, if you choose to.
  const mayRevealUntil = /^You may (reveal cards from the top of your library until .+)$/s.exec(text.trim());
  if (mayRevealUntil) {
    const inner = attempt(b, (b) => parseEffectText(capitalise(mayRevealUntil[1]!), b));
    if (inner?.length === 1 && inner[0]!.type === 'reveal_until') return [{ type: 'may', effects: inner }];
  }
  // CR 702.60a: ripple N.
  const ripple = /^You may reveal the top (\w+) cards of your library, or, if there are fewer than \1 cards in your library, you may reveal all the cards in your library\. If you reveal cards from your library this way, you may cast any of those cards with the same name as (?:this spell|~) without paying their mana costs, then put all revealed cards not cast this way on the bottom of your library in any order\.$/i.exec(text.trim());
  if (ripple && typeof parseAmount(ripple[1]!) === 'number') return [{ type: 'ripple', n: parseAmount(ripple[1]!) as number }];
  // Expel the Interlopers: "Choose a number between 0 and 10. Destroy all creatures with power greater than or equal to
  // the chosen number."; By Invitation Only: "Choose a number between 0 and 13. Each player sacrifices that many
  // creatures of their choice." — the number chosen as it resolves, read as X.
  const chooseNumber = /^Choose a number between (\d+) and (\d+)\. (.+)$/.exec(text.trim());
  if (chooseNumber && !/\bX\b/.test(chooseNumber[3]!)) {
    const rest = chooseNumber[3]!.replace(/\bthe chosen number\b/g, 'X').replace(/\bthat many\b/g, 'X');
    const inner = rest !== chooseNumber[3] ? parseEffectText(rest, b) : null;
    return inner ? [{ type: 'choose_number', min: Number(chooseNumber[1]), max: Number(chooseNumber[2]), effects: inner }] : null;
  }
  // Iron Lad, Diverging Destiny: "Reveal the top card of your library. If it's an artifact card, draw a card." — the card stays.
  const revealTop = /^Reveal the top card of your library\. If it's an? (.+?) card, ([^.]+)\.$/.exec(text.trim());
  if (revealTop) {
    const r = attempt(b, (b) => {
      const pf = parseFilter(`${revealTop[1]} card in your library`, b);
      if (!pf || pf.plural || pf.filter.controller) return null;
      delete pf.filter.zone;
      delete pf.filter.owner;
      const it = b.it;
      b.it = { ref: 'chosen_object' };
      const then = parseEffectText(`${capitalise(revealTop[2]!)}.`, b);
      b.it = it;
      return then ? [{ type: 'reveal_top_card' }, { type: 'if', cond: { type: 'is', of: { ref: 'chosen_object' }, filter: pf.filter }, effects: then }] : null;
    });
    if (r) return r;
  }
  // Counterbalance: "Whenever an opponent casts a spell, you may reveal the top card of your library. If you do, counter that
  // spell if it has the same mana value as the revealed card."
  if (/^You may reveal the top card of your library\. If you do, counter that spell if it has the same mana value as the revealed card\.$/.test(text.trim()) && b.it?.ref === 'trigger_object') {
    const mv = (of: Ref): AmountExpr => ({ kind: 'stat', stat: 'mana_value', of });
    return [
      {
        type: 'may_do',
        effects: [{ type: 'reveal_top_card' }],
        then: [{ type: 'if', cond: { type: 'amount', amount: mv({ ref: 'trigger_object' }), op: 'eq', n: mv({ ref: 'chosen_object' }) }, effects: [{ type: 'counter', what: { ref: 'trigger_object' } }] }],
      },
    ];
  }
  // Shatterskull Smashing: "~ deals X damage divided as you choose among up to two target creatures and/or planeswalkers. If X
  // is 6 or more, ~ deals twice X damage divided as you choose among them instead." — the total is known as it's cast (CR 601.2d).
  const smash = /^(~ deals X damage divided as you choose among [^.]+)\. If X is (\d+) or more, ~ deals twice X damage divided as you choose among them instead\.$/.exec(text.trim());
  if (smash) {
    const made = parseEffectText(`${smash[1]}.`, b);
    const node = made?.length === 1 && made[0]!.type === 'deal_damage' && made[0]!.amount === 'X' && made[0]!.divided ? made[0]! : null;
    return node ? [{ ...node, amount: { kind: 'x', doubledAtLeast: Number(smash[2]) } }] : null;
  }
  // Comet Storm: "Choose any target, then choose another target for each time this spell was kicked. Comet Storm deals X damage
  // to each of them." — one target, and one more for each kick (CR 601.2c, 702.33c).
  const comet = /^Choose any target, then choose another target for each time (?:this spell|~) was kicked\. (?:~|This spell) deals (X|\d+) damage to each of them\.$/.exec(text.trim());
  if (comet) {
    const to = b.addTarget({ what: 'any', filter: { types: ['Creature', 'Planeswalker', 'Battle'] }, plusKicks: true, text: 'any target' });
    return [{ type: 'deal_damage', amount: comet[1] === 'X' ? 'X' : Number(comet[1]), to }];
  }
  // Scroll Rack: "Exile any number of cards from your hand face down. Put that many cards from the top of your library into your
  // hand. Then look at the exiled cards and put them on top of your library in any order."
  if (/^Exile any number of cards from your hand face down\. Put that many cards from the top of your library into your hand\. Then look at the exiled cards and put them on top of your library in any order\.$/.test(text.trim())) {
    return [{ type: 'scroll_rack' }];
  }
  // Patriarch's Bidding: "Each player chooses a creature type. Each player returns all creature cards of a type chosen this
  // way from their graveyard to the battlefield."
  if (/^Each player chooses a creature type\. Each player returns all creature cards of a type chosen this way from their graveyard to the battlefield\.$/.test(text.trim())) {
    return [
      { type: 'choose_value', choice: 'creature_type', each: true },
      { type: 'move', what: { ref: 'all', filter: { zone: 'graveyard', types: ['Creature'], subtypesChosenThisWay: true } }, to: 'battlefield' },
    ];
  }
  // Ezuri's Predation: "For each creature your opponents control, create a 4/4 green Phyrexian Beast creature token. Each of
  // those tokens fights a different one of those creatures." (CR 701.14)
  const predation = /^(For each creature your opponents control, create an? [^.]+ creature token)\. Each of those tokens fights a different one of those creatures\.$/.exec(text.trim());
  if (predation) {
    const made = parseEffectText(`${predation[1]}.`, b);
    if (made?.length !== 1 || made[0]!.type !== 'create_token') return null;
    return [...made, { type: 'fight_distinct', a: { ref: 'created' }, b: { ref: 'all', filter: { types: ['Creature'], controller: 'opponent' } } }];
  }
  // Eldritch Evolution: "Search your library for … X or less, where X is …. Put that card onto the battlefield, then
  // shuffle." — the same as one sentence.
  // Traverse the Outlands: "… up to X basic land cards, where X is …. Put those cards onto the battlefield tapped, then shuffle."
  text = text.replace(
    /(Search your library for [^.]+?)(, where X is [^.]+)?\. Put (that card|it|those cards|them) (onto the battlefield(?: tapped)?|into your hand), then shuffle\./,
    (_m, search: string, where: string | undefined, it: string, to: string) => `${search}, put ${/^(?:those cards|them)$/.test(it) ? 'them' : 'it'} ${to}, then shuffle${where ?? ''}.`,
  );
  // Increasing Ambition: "Search your library for a card and put that card into your hand. If this spell was cast from a
  // graveyard, instead search your library for two cards and put those cards into your hand. Then shuffle." — each search
  // shuffles (the same instruction, with "instead").
  text = text.replace(
    /^Search your library for ([^.,]+?) and put (that card|those cards) into your hand\. (If [^,]+), instead search your library for ([^.,]+?) and put (that card|those cards) into your hand\. Then shuffle\.$/,
    (_m, one: string, it1: string, cond: string, two: string, it2: string) => `Search your library for ${one}, put ${it1} into your hand, then shuffle. ${cond}, instead search your library for ${two}, put ${it2} into your hand, then shuffle.`,
  );
  // Sword of Sinew and Steel: "destroy up to one target planeswalker and up to one target artifact" — each its own target.
  // Urgent Necropsy: "Destroy up to one target artifact, up to one target creature, … and up to one target planeswalker."
  // Bebop: "you may draw X cards, where X is …. If you do, you lose X life." — both with that X, if you draw.
  text = text.replace(/\b([Yy]ou may draw X cards), (where X is [^.]+)\. If you do, you lose X life\./, '$1 and lose X life, $2.');
  // Pull from the Deep: "Return up to one target instant card and up to one target sorcery card from your graveyard to your
  // hand."; Thwart the Grave: "Return target creature card and up to one target Cleric, … creature card from your graveyard to
  // the battlefield." — each its own target, from the same graveyard.
  text = text.replace(/\b([Rr]eturn) ((?:up to one )?target [^,.]+? card) and ((?:up to one )?target [^.]+? card) from your graveyard (to your hand|to the battlefield)\b/, (_m, r: string, one: string, two: string, to: string) =>
    `${r} ${one} from your graveyard ${to}. Return ${two} from your graveyard ${to}`,
  );
  // Kiora, Master of the Depths: "Untap up to one target creature and up to one target land."
  text = text.replace(/\b([Dd]estroy|[Uu]ntap|[Tt]ap) ((?:up to one target [^,.]+?, )*up to one target [^,.]+?,? and up to one target [^.]+?)\./, (_m, d: string, list: string) =>
    list.split(/,? and |, /).map((one, i) => `${i === 0 ? d : capitalise(d.toLowerCase())} ${one}.`).join(' '),
  );
  // Evolutionary Escalation: "put three +1/+1 counters on target creature you control and three +1/+1 counters on target
  // creature an opponent controls"; Claim the Kingdom: "… and a plan counter on this enchantment" — two placements.
  text = text.replace(
    /\b([Pp])ut ((?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|X) \S+ counters? on [^.]+?) and ((?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|X) \S+ counters? on [^.]+)\./,
    (_m, p: string, one: string, two: string) => `${p}ut ${one}. Put ${two}.`,
  );
  // Su-Chi Cave Guard: "add eight {C}" — the same as "{C}{C}{C}{C}{C}{C}{C}{C}".
  text = text.replace(/\b([Aa]dd) (two|three|four|five|six|seven|eight|nine|ten) (\{[WUBRGC]\})(?=[.,]| and )/g, (_m, a: string, n: string, sym: string) => `${a} ${sym.repeat(parseAmount(n) as number)}`);
  // Viewpoint Synchronization: "Search your library for up to three basic land cards and reveal them. Put two of them onto
  // the battlefield tapped and the other into your hand, then shuffle." — one instruction.
  text = text.replace(/\b(Search your library for up to \w+ [^.]+?) and reveal them\. Put (\w+) of them onto the battlefield( tapped)? and the (other|rest) into your hand, then shuffle\./, '$1, reveal them, put $2 onto the battlefield$3 and the $4 into your hand, then shuffle.');
  // Horrid Shadowspinner: "you may draw cards equal to its power. If you do, discard that many cards." — the same number.
  text = text.replace(/\b([Yy]ou may draw cards equal to ([^.]+))\. If you do, discard that many cards\./, '$1. If you do, discard cards equal to $2.');
  // Marcus, Mutant Mayor: "draw a card if that creature has a +1/+1 counter on it. If it doesn't, put a +1/+1 counter on it."
  text = text.replace(/^([Dd]raw a card) if (that creature has an? \S+ counter on it)\. If it doesn't, ([^.]+)\./, (_m, a: string, c: string, o: string) => `If ${c}, ${a[0]!.toLowerCase()}${a.slice(1)}. Otherwise, ${o}.`);
  // Zurgo Stormrender: "draw a card if it was attacking. Otherwise, each opponent loses 1 life."
  text = text.replace(/^([Dd]raw a card|[^.]+?) if (it was attacking)\. Otherwise, ([^.]+)\./, (_m, a: string, c: string, o: string) => `If ${c}, ${a[0]!.toLowerCase()}${a.slice(1)}. Otherwise, ${o}.`);
  // Eumidian Hatchery: "for each hatchling counter on it, create a 1/1 black Insect creature token with flying".
  // (Only a plain count: "For each opponent, create … attacking that player" and "… a copy of it" are each one in turn.)
  text = text.replace(/^([Ff])or each ([^,.]+), (create [^.]+)\./, (m, _f: string, each: string, make: string) =>
    /\b(?:opponent|player)\b/.test(each) || /\b(?:it|its|that|those|them|they|copy|copies)\b/.test(make) ? m : `C${make.slice(1)} for each ${each}.`,
  );
  // Necron Monolith: "mill three cards. For each creature card milled this way, create a 2/2 … token." — after the mill.
  text = text.replace(/\. For each ([^,.]+ this way), (create [^.]+)\./, (m, each: string, make: string) =>
    /\b(?:it|its|that|those|them|they|copy|copies)\b/.test(make) || /\b(?:damage|life)\b/.test(each) ? m : `. C${make.slice(1)} for each ${each}.`,
  );
  // Once and Future (adamant): "… Put up to one other target card from your graveyard on top of your library. Exile ~. If at
  // least three green mana was spent to cast this spell, instead return those cards to your hand and exile ~." — the
  // second card goes to your hand rather than on top of your library.
  text = text.replace(/^(Return target card from your graveyard to your hand)\. Put (up to one other target card) from your graveyard on top of your library\. Exile ~\. (If at least three green mana was spent to cast (?:this spell|~)), instead return those cards to your hand and exile ~\.$/, '$1. Choose $2 in your graveyard. $3, return that card to your hand. Otherwise, put that card on top of your library. Exile ~.');
  // Hurkyl's Recall: "Return all artifacts target player owns to their hand." — that player's own hand.
  text = text.replace(/\b([Rr]eturn all [^.]+? (?:target player|target opponent) owns) to their hand\./, "$1 to their owner's hand.");
  // Early Harvest: "Target player untaps all basic lands they control."
  text = text.replace(/^(Target player|Target opponent) untaps all ([^.]+?) they control\./, (_m, who: string, what: string) => `Untap all ${what} ${who.toLowerCase()} controls.`);
  // Ashiok, Nightmare Weaver: "Exile all cards from all opponents' hands and graveyards."
  text = text.replace(/^Exile all cards from all opponents' hands and graveyards\.$/, "Exile all cards from all opponents' hands. Exile all cards from all opponents' graveyards.");
  // Foul-Tongue Shriek: "Target opponent loses 1 life for each attacking creature you control. You gain that much life."
  text = text.replace(/\b((?:[Tt]arget (?:player|opponent)|[Ee]ach opponent) loses [^.]*?\blife\b[^.]*?)(?:\. You| and you) gain that much life\./, '$1. You gain life equal to the life lost this way.');
  // Kaya, Orzhov Usurper: "Kaya deals damage to target player equal to the number of cards that player owns in exile and you
  // gain that much life." — that number, however much damage is dealt (2019-01-25 ruling).
  text = text.replace(/\b(deals damage to [^.]+? equal to (the number of [^.]+?)) and you gain that much life\./, '$1. You gain life equal to $2.');
  // Druidic Ritual: "Then return up to one creature card and up to one land card from your graveyard to your hand." — each
  // chosen as it resolves.
  text = text.replace(/\b([Rr]eturn) up to one ((?:(?!target\b)[\w-]+ )+?card) and up to one ((?:(?!target\b)[\w-]+ )+?card) from your graveyard to your hand\./, '$1 up to one $2 from your graveyard to your hand. Return up to one $3 from your graveyard to your hand.');
  // Mogg Infestation: "Destroy all creatures target player controls. For each creature that died this way, that player
  // creates two 1/1 red Goblin creature tokens."
  text = text.replace(/\. For each creature that died this way, (that player|you) (creates? [^.]+)\./, '. $1 $2 for each creature put into a graveyard this way.');
  // Kumena's Awakening: "each player draws a card. If you have the city's blessing, instead only you draw a card."
  text = text.replace(/(\. If [^,.]+), instead only you (\w+)/, '$1, instead you $2');
  // Roalesk, Apex Hybrid: "proliferate, then proliferate again".
  text = text.replace(/\b([Pp])roliferate, then proliferate again\./, '$1roliferate. Proliferate.');
  // Psychic Spiral: "Shuffle all cards from your graveyard into your library. Target player mills that many cards."
  text = text.replace(/^(Shuffle all cards from your graveyard into your library)\. (Target player|Target opponent|Each opponent) mills that many cards\./, '$1. $2 mills a card for each card shuffled into a library this way.');
  // Step Between Worlds: "Each player may shuffle their hand and graveyard into their library. Each player who does draws seven
  // cards." — those who accept do both.
  text = text.replace(/\b(Each (player|opponent) may [^.]+)\. Each \2 who does (\w+) ([^.]+)\./, (m, may: string, _w: string, verb: string, rest: string) => {
    const base = /(?:sh|ch|ss|x)es$/.test(verb) ? verb.slice(0, -2) : /s$/.test(verb) ? verb.slice(0, -1) : null;
    return base && !/\b(?:then|that|this way)\b/.test(may) ? `${may}, then ${base} ${rest}.` : m;
  });
  // The Binding of the Titans: "For each creature card exiled this way, you gain 1 life." — the same as "You gain 1 life for
  // each creature card exiled this way."
  text = text.replace(/(^|\. )For each ([^,.]+ this way), (you gain \w+ life|draw a card|you draw a card|scry 1|put a \+1\/\+1 counter on ~)\./, (_m, lead: string, each: string, act: string) => `${lead}${capitalise(act)} for each ${each}.`);
  // Aclazotz, Deepest Betrayal: "each opponent discards a card. For each opponent who can't, you draw a card."
  text = text.replace(/\b([Ee]ach opponent discards a card)\. For each opponent who can't, ([^.]+)\./, (_m, d: string, then: string) => `${d}. ${then[0]!.toUpperCase()}${then.slice(1)} for each opponent who didn't discard a card this way.`);
  // Godo, Bandit Warlord: "untap it and all Samurai you control" — it, then all of them (untapping twice changes nothing).
  text = text.replace(/\b([Uu])ntap (it|~) and all ([^.]+)\./, (_m, u: string, it: string, rest: string) => `${u}ntap ${it}. Untap all ${rest}.`);
  // Alandra, Sky Dreamer: "Alandra and Drakes you control each get +X/+X until end of turn, where X is …" — it, and the others.
  text = text.replace(/^~ and (\w+) you control each get ([+-]\w+\/[+-]\w+ until end of turn)(, where X is [^.]+)?\.$/, (_m, kind: string, pt: string, where?: string) => `~ gets ${pt}${where ?? ''}. Other ${kind} you control get ${pt}${where ?? ''}.`);
  // Sephiroth, One-Winged Angel: "you may sacrifice any number of other creatures. If you do, draw that many cards." — choosing
  // none is not doing it, and draws none.
  text = text.replace(/\b[Yy]ou may sacrifice any number of ([^.]+)\. If you do, draw that many cards\./, 'sacrifice any number of $1, then draw that many cards.');
  // Sword of Hearth and Home: "exile up to one target creature you own, then search your library for a basic land card. Put
  // both cards onto the battlefield under your control, then shuffle." — the exiled card returns; the land is put there.
  text = text.replace(
    /([Ee]xile up to one target creature you own), then (search your library for a basic land card)\. Put both cards onto the battlefield under your control, then shuffle\./,
    '$1, then return that card to the battlefield under your control. $2, put it onto the battlefield, then shuffle.',
  );
  // Ajani Goldmane: "Create a white Avatar creature token. It has "This token's power and toughness are each equal to your
  // life total."" — the token "with" that ability (CR 111.4).
  text = text.replace(
    /\b([Cc]reates? (?:a|an|one|two|three|four|five|X) [^."]*? creature tokens?)\. (?:It has|They have|Those tokens have) (QUOTED_\d+)\./g,
    (_m, made: string, q: string) => (/ with /.test(made) ? `${made} and ${q}.` : `${made} with ${q}.`),
  );
  // Braids, Arisen Nightmare: "… each opponent may sacrifice a permanent of their choice that shares a card type with it.
  // For each opponent who doesn't, that player loses 2 life and you draw a card." — one instruction.
  text = text.replace(/(each opponent may [^.]+)\. For each opponent who doesn't, ([^.]+)\./, "$1; for each opponent who doesn't, $2.");
  // Fable of the Mirror-Breaker: "You may discard up to two cards. If you do, draw that many cards." — discarding none is
  // not doing it, so it's "Discard up to two cards, then draw that many cards".
  text = text.replace(/\bYou may discard up to (\w+) cards\. If you do, draw that many cards\./, 'Discard up to $1 cards, then draw that many cards.');
  // Odric, Lunarch Marshal: "creatures you control gain first strike until end of turn if a creature you control has first
  // strike. The same is true for flying, deathtouch, …, and vigilance." — one check for each keyword, as it resolves.
  const sameFor = /^([Cc]reatures you control) gain ([a-z ]+) until end of turn if a creature you control has \2\. The same is true for ([a-z ,]+)\.$/.exec(text.trim());
  if (sameFor) {
    const kws = [sameFor[2]!, ...sameFor[3]!.split(/, (?:and )?| and /)];
    text = kws.map((k) => `If you control a creature with ${k}, creatures you control gain ${k} until end of turn.`).join(' ');
  }
  // Liliana's Triumph: "If you control a Liliana planeswalker, each opponent also discards a card." — "also" adds nothing.
  text = text.replace(/(\bIf [^,.]+, (?:each opponent|each player|you|that player|target opponent|target player)) also (?=[a-z])/g, '$1 ');
  // Wheel and Deal: "Any number of target opponents each discard their hands, then draw seven cards."
  text = text.replace(/\b(each|players|opponents) discard their hands\b/g, '$1 discard their hand');
  // Primal Amulet, Treasure Map: "Then if there are four or more charge counters on it, remove those counters and transform
  // it."; Replicating Ring: "if it has eight or more night counters on it, remove all of them and …" — that kind of counter.
  text = text.replace(
    /\b(if (?:there are \w+ or more (\S+) counters on (?:it|~|her|him)|(?:it|~) has \w+ or more (\S+) counters on (?:it|her|him)), (?:you may )?)remove (?:those counters|all of them)(?: from (?:it|~))?/g,
    (_m, head: string, k1?: string, k2?: string) => `${head}remove all ${k1 ?? k2} counters from it`,
  );
  // Turntimber Symbiosis: "You may put a creature card from among them onto the battlefield. If that card has mana value 3
  // or less, it enters with three additional +1/+1 counters on it. Put the rest …" — read as the counters put on it after
  // the rest go to the bottom (nothing happens in between).
  text = text.replace(
    /(You may put an? [^.]+? from among them onto the battlefield\.) If that card has (mana value \d+ or less), it enters with (\w+) additional (\S+) counters on it\. (Put the rest [^.]+\.)/,
    '$1 $5 If that card has $2, put $3 $4 counters on that card.',
  );
  // Forge of Heroes: "Put a +1/+1 counter on it if it's a creature and a loyalty counter on it if it's a planeswalker."
  text = text.replace(/\bPut (a|an|one) (\S+) counter on it if it's an? (creature|planeswalker|artifact|enchantment|land) and (a|an|one) (\S+) counter on it if it's an? (creature|planeswalker|artifact|enchantment|land)\./, "If it's a $3, put $1 $2 counter on it. If it's a $6, put $4 $5 counter on it.");
  // Kwain: "Each player may draw a card, then each player who drew a card this way gains 1 life." — what each who draws
  // does as well.
  text = text.replace(/\b(Each (?:player|opponent)) may (draw a card), then each (?:player|opponent) who drew a card this way (gain|lose|create|put)s\b/, '$1 may $2 and $3');
  // Primal Wellspring: "copy that spell and you may choose new targets for the copy." — two instructions (CR 707.10c).
  text = text.replace(/\b([Cc]opy (?:that spell|it)) and you may choose new targets for the copy\./g, '$1. You may choose new targets for the copy.');
  // The Skullspore Nexus: "create a green Fungus Dinosaur creature token with base power and toughness each equal to …" —
  // an X/X token (its base power and toughness are set as it's created).
  text = text.replace(/\b([Cc])reate an? ((?:[\w-]+ )+?)creature token with base power and toughness each equal to ([^.,]+)\./, '$1reate an X/X $2creature token, where X is $3.');
  // Lantern Flare: "~ deals X damage to target creature or planeswalker and you gain X life. X is the number of creatures
  // you control." — X defined in a sentence of its own.
  text = text.replace(/^([^.]*\bX\b[^.]*)\. X is (the [^.]+)\.$/, '$1, where X is $2.');
  // Unquenchable Fury: "it deals X damage to defending player, where X is the number of cards in their hand" — that player's.
  text = text.replace(/(\bto (defending player|that player), where X is [^.]*?)\btheir (hand|graveyard|library)\b/, "$1$2's $3");
  // Angelic Skirmisher: "choose first strike, vigilance, or lifelink. Creatures you control gain that ability until end of
  // turn." — the same as "gain your choice of …" (CR 608.2d).
  text = text.replace(/^[Cc]hoose ((?:[a-z][a-z ]*, )+)or ([a-z][a-z ]*)\. (.+?) (gains?) that ability until end of turn\.$/, '$3 $4 your choice of $1or $2 until end of turn.');
  // Tempt with Discovery: "Search your library for a land card and put it onto the battlefield. … Then each player who
  // searched a library this way shuffles." — each search, then a shuffle.
  if (/ Then each player who searched a library this way shuffles\.$/.test(text.trim())) {
    text = text.replace(/([Ss]earch (?:your|their) library for [^.]+?) and put it onto the battlefield\./g, '$1, put it onto the battlefield, then shuffle.');
  }
  // Thassa's Oracle: "look at the top X cards of your library, where X is your devotion to blue. Put up to one of them on
  // top of your library and the rest on the bottom of your library in a random order. If X is greater than or equal to
  // the number of cards in your library, you win the game."
  const oracle = /^[Ll]ook at the top X cards of your library, where X is your devotion to (\w+)\. Put up to one of them on top of your library and the rest on the bottom of your library in a random order\. If X is greater than or equal to the number of cards in your library, you win the game\.$/.exec(text.trim());
  if (oracle && COLOR_WORDS[oracle[1]!]) {
    const x = { kind: 'devotion', colors: [COLOR_WORDS[oracle[1]!]] };
    return [
      { type: 'dig', amount: x, take: 1, upTo: true, to: 'top', rest: 'bottom', order: 'random' },
      { type: 'if', cond: { type: 'amount', amount: x, op: 'ge', n: { kind: 'cards', zone: 'library', who: 'you' } }, effects: [{ type: 'game_result', who: { ref: 'you' }, result: 'win' }] },
    ];
  }
  // Sylvan Library (CR 121.1, 119.4)
  if (/^You may draw two additional cards\. If you do, choose two cards in your hand drawn this turn\. For each of those cards, pay 4 life or put the card on top of your library\.$/.test(text.trim())) {
    return [{ type: 'sylvan_library' }];
  }
  // Living Death, Living End, Scrap Mastery: "Each player exiles all creature cards from their graveyard, then sacrifices
  // all creatures they control, then puts all cards they exiled this way onto the battlefield."
  const swap = /^Each player exiles all (creature|artifact) cards from their graveyard, then sacrifices all (?:creatures|artifacts) they control, then puts all cards they exiled this way onto the battlefield\.$/.exec(text.trim());
  if (swap) return [{ type: 'swap_graveyard', cardType: swap[1] === 'creature' ? 'Creature' : 'Artifact' }];
  // Dauthi Voidwalker: the choice and the permission go together.
  const voidPlay = /^Choose an exiled card (an opponent owns|you own) with an? \S+ counter on it\. You may play it this turn without paying its mana cost\.$/.exec(text.trim());
  if (voidPlay) return parseSentence(text.trim().replace(/\.$/, ''), b);
  // Mirror Entity: "Until end of turn, creatures you control have base power and toughness X/X and gain all creature types."
  const mirror = /^Until end of turn, (.+?) have base power and toughness (X|\d+)\/(X|\d+) and gain all creature types\.$/.exec(text.trim());
  if (mirror) {
    const what = attempt(b, (b) => parseObjectRef(mirror[1]!.replace(/^\w/, (c) => c.toLowerCase()), b));
    const p = parseAmount(mirror[2]!);
    const t = parseAmount(mirror[3]!);
    return what && what.plural && p !== null && t !== null ? [{ type: 'modify', what: what.ref, setPower: p, setToughness: t, allCreatureTypes: true, until: 'eot' }] : null;
  }
  // Springheart Nantuko: "you may pay {1}{G} if this permanent is attached to a creature you control. If you do, create a
  // token that's a copy of that creature. If you didn't create a token this way, create a 1/1 green Insect creature token."
  const nantuko = /^[Yy]ou may pay ((?:\{[^}]+\})+) if ~ is attached to a creature you control\. If you do, create a token that's a copy of that creature\. If you didn't create a token this way, (create .+)\.$/.exec(text.trim());
  if (nantuko) {
    const insect = parseSentence(capitalise(nantuko[2]!), b);
    if (!insect) return null;
    return [
      {
        type: 'if',
        cond: { type: 'is', of: { ref: 'attached' }, filter: { controller: 'you', types: ['Creature'] } },
        effects: [{ type: 'may_pay', cost: nantuko[1]!, effects: [{ type: 'create_token', amount: 1, copyOf: { ref: 'attached' }, who: { ref: 'you' } }], else: insect }],
        else: structuredClone(insect),
      },
    ];
  }
  // Tibalt's Trickery: "Counter target spell. Choose 1, 2, or 3 at random. Its controller mills that many cards, then exiles
  // cards from the top of their library until they exile a nonland card with a different name than that spell. They may cast
  // that card without paying its mana cost. Then they put the exiled cards on the bottom of their library in a random order."
  if (/^Counter target spell\. Choose 1, 2, or 3 at random\. Its controller mills that many cards, then exiles cards from the top of their library until they exile a nonland card with a different name than that spell\. They may cast that card without paying its mana cost\. Then they put the exiled cards on the bottom of their library in a random order\.$/.test(text.trim())) {
    const spell = parseObjectRef('target spell', b);
    if (!spell) return null;
    const who: Ref = { ref: 'controller_of', of: spell.ref };
    return [
      { type: 'counter', what: spell.ref },
      { type: 'roll_die', sides: 3, random: true },
      { type: 'mill', amount: { kind: 'die_result' }, who },
      { type: 'reveal_until', who, filter: { notTypes: ['Land'], differentNameAs: spell.ref }, to: 'cast', rest: 'bottom', exile: true },
    ];
  }
  // Intuition: "Search your library for three cards and reveal them. Target opponent chooses one. Put that card into your hand
  // and the rest into your graveyard. Then shuffle." Gifts Ungiven: "… for up to four cards with different names … chooses two
  // of those cards. Put the chosen cards into your graveyard and the rest into your hand."
  const gifts = /^Search your library for (up to )?(\w+) cards( with different names)? and reveal them\. Target opponent chooses (\w+)(?: of (?:them|those cards))?\. Put (?:that card|the chosen cards?) into your (hand|graveyard) and the rest into your (hand|graveyard)\. Then shuffle\.$/.exec(text.trim());
  if (gifts) {
    const n = parseAmount(gifts[2]!);
    const k = parseAmount(gifts[4]!);
    const opp = parsePlayerRef('target opponent', b);
    if (typeof n !== 'number' || typeof k !== 'number' || !opp || k >= n || gifts[5] === gifts[6]) return null;
    return [{ type: 'search', filter: { zone: 'library', owner: 'you' }, amount: n, to: 'hand', ...(gifts[1] ? { upTo: true } : {}), ...(gifts[3] ? { distinctNames: true } : {}), divide: { chooser: opp, count: k, chosenTo: gifts[5], restTo: gifts[6] } }];
  }
  // Final Parting: "Search your library for two cards. Put one into your hand and the other into your graveyard. Then shuffle."
  // Jarad's Orders: "Search your library for up to two creature cards and reveal them. Put one into your hand and the other …"
  const parting = /^Search your library for (up to )?two (.*?)cards( and reveal them)?\. Put one(?: of them)? into your (hand|graveyard) and the other into your (hand|graveyard)\. Then shuffle\.$/.exec(text.trim());
  if (parting && parting[4] !== parting[5]) {
    const pf = parting[2] ? parseFilter(`${parting[2]}cards in your library`, b) : { filter: { zone: 'library' as const, owner: 'you' as const }, plural: true };
    if (!pf || pf.filter.zone !== 'library') return null;
    return [{ type: 'search', filter: pf.filter, amount: 2, to: 'hand', ...(parting[1] ? { upTo: true } : {}), ...(parting[3] ? { reveal: true } : {}), divide: { chooser: { ref: 'you' }, count: 1, chosenTo: parting[4], restTo: parting[5] } }];
  }
  // Mizzix's Mastery: "Exile target card that's an instant or sorcery from your graveyard. For each card exiled this way, copy
  // it, and you may cast the copy without paying its mana cost. Exile ~." — overloaded, "each card" (CR 702.96b).
  const mastery = /^Exile (target|each) card that's an instant or sorcery from your graveyard\. For each card exiled this way, copy it, and you may cast the copy without paying its mana cost\. Exile ~\.$/.exec(text.trim());
  if (mastery) {
    const what = mastery[1] === 'target' ? parseObjectRef('target instant or sorcery card from your graveyard', b) : parseObjectRef('each instant or sorcery card from your graveyard', b);
    if (!what || (mastery[1] === 'target') === what.plural) return null;
    return [
      { type: 'move', what: what.ref, to: 'exile' },
      { type: 'cast_copy_of', what: mastery[1] === 'target' ? what.ref : { ref: 'moved_onto' } },
      { type: 'move', what: { ref: 'self' }, to: 'exile' },
    ];
  }
  // Breach the Multiverse: "For each player, choose a creature or planeswalker card in that player's graveyard. Put those
  // cards onto the battlefield under your control."
  const breach = /^(.*?)For each player, choose (?:a|an) (.+?) card in that player's graveyard\. Put those cards onto the battlefield under your control\.(?: (.+))?$/.exec(text.trim());
  if (breach) {
    const before = breach[1] ? parseEffectText(breach[1].trim(), b) : [];
    const pf = before ? parseFilter(`${breach[2]} card in a graveyard`, b) : null;
    if (!before || !pf || pf.plural) return null;
    const { zone: _z, ...filter } = pf.filter;
    b.it = { ref: 'moved_onto' };
    const after = breach[3] ? parseEffectText(breach[3].replace(/^Then (\w)/, (_m, c: string) => c.toUpperCase()), b) : [];
    if (!after) return null;
    return [...before, { type: 'return_from_each_graveyard', filter }, ...after];
  }
  // Ripples of Potential: "Proliferate, then choose any number of permanents you control that had a counter put on them this
  // way. Those permanents phase out."
  if (/^Proliferate, then choose any number of permanents you control that had a counter put on them this way\. Those permanents phase out\.$/.test(text.trim())) {
    return [{ type: 'proliferate' }, { type: 'phase_out_proliferated' }];
  }
  // Beseech the Mirror: "Search your library for a card, exile it face down, then shuffle. If this spell was bargained, you may
  // cast the exiled card without paying its mana cost if that spell's mana value is 4 or less. Put the exiled card into your
  // hand if it wasn't cast this way."
  const beseech = /^Search your library for a card, exile it face down, then shuffle\. If (.+?), you may cast the exiled card without paying its mana cost if that spell's mana value is (\d+) or less\. Put the exiled card into your hand if it wasn't cast this way\.$/.exec(text.trim());
  if (beseech) {
    const cond = parseCondition(beseech[1]!, b);
    if (!cond) return null;
    return [
      { type: 'search', filter: { zone: 'library', owner: 'you' }, amount: 1, to: 'exile', faceDown: true },
      { type: 'if', cond, effects: [{ type: 'cast_free', what: { ref: 'created' }, maxMV: Number(beseech[2]) }] },
      { type: 'move', what: { ref: 'created' }, to: 'hand' },
    ];
  }
  // Explore the Vastlands: "Each player looks at the top five cards of their library and may reveal a land card and/or an
  // instant or sorcery card from among them. Each player puts the cards they revealed this way into their hand and the rest on
  // the bottom of their library in a random order. Each player gains 3 life." — each of them, in turn order (CR 101.4).
  const vast = /^Each player looks at the top (\w+) cards of their library and may reveal (a|an) (.+?) card and\/or (a|an) (.+?) card from among them\. Each player puts the cards they revealed this way into their hand and the rest on the bottom of their library in a random order\.(?: (.+))?$/.exec(text.trim());
  if (vast) {
    const n = parseAmount(vast[1]!);
    const each = eachOfPair(vast[2]!, `${vast[3]} card and/or ${vast[4]} ${vast[5]} card`, 'library', b);
    const after = vast[6] ? parseEffectText(vast[6], b) : [];
    if (typeof n !== 'number' || !each || !after) return null;
    return [{ type: 'players_do', players: { ref: 'players', who: 'each' }, effects: [{ type: 'dig', amount: n, take: 2, each, to: 'hand', optional: true, reveal: true, rest: 'bottom', order: 'random' }] }, ...after];
  }
  // Hoarding Broodlord: "search your library for a card, exile it face down, then shuffle. For as long as that card remains
  // exiled, you may play it."; Praetor's Grasp: "Search target opponent's library for a card and exile it face down. Then
  // that player shuffles. You may play that card for as long as it remains exiled."
  const broodlord =
    /^[Ss]earch (your|target opponent's) library for a card, exile it face down, then shuffle\. For as long as that card remains exiled, you may play it\.$/.exec(text.trim()) ??
    /^[Ss]earch (your|target opponent's) library for a card and exile it face down\. Then that player shuffles\. You may play that card for as long as it remains exiled\.$/.exec(text.trim());
  if (broodlord) {
    const library = broodlord[1] === 'your' ? null : parsePlayerRef('target opponent', b);
    if (broodlord[1] !== 'your' && !library) return null;
    return [
      { type: 'search', filter: { zone: 'library' }, amount: 1, to: 'exile', faceDown: true, ...(library ? { library } : { filter: { zone: 'library', owner: 'you' } }) },
      { type: 'grant_play', what: { ref: 'created' }, mode: 'play', until: 'exiled' },
    ];
  }
  // Rise of the Witch-king: "Each player sacrifices a creature of their choice. If you sacrificed a creature this way, you may
  // return another permanent card from your graveyard to the battlefield." — not the one sacrificed.
  const witch = /^(Each player sacrifices a creature of their choice\. If you sacrificed a creature this way), you may return another (.+? card) from your graveyard to the battlefield\.$/.exec(text.trim());
  if (witch) {
    const first = parseEffectText(`${witch[1]}, draw a card.`, b);
    const back = parseSentence(`You may return a ${witch[2]} from your graveyard to the battlefield`, b);
    const iff = first?.[1];
    const ret = back?.length === 1 && back[0]!.type === 'may' ? (back[0]!.effects as EffectNode[])[0] : undefined;
    if (!first || first.length !== 2 || iff?.type !== 'if' || ret?.type !== 'return_chosen') return null;
    return [first[0]!, { ...iff, effects: [{ type: 'may', effects: [{ ...ret, notMoved: 'sacrificed' }] }] }];
  }
  // Winds of Abandon (and overloaded): "Exile target creature you don't control. For each creature exiled this way, its
  // controller searches their library for a basic land card. Those players put those cards onto the battlefield tapped, then
  // shuffle."
  const winds = /^Exile (target|each) (creature you don't control|creatures? your opponents control)\. For each creature exiled this way, its controller searches their library for a basic land card\. Those players put those cards onto the battlefield tapped, then shuffle\.$/.exec(text.trim());
  if (winds) {
    const exiled = parseSentence(`Exile ${winds[1]} ${winds[2]}`, b);
    if (!exiled || exiled.length !== 1 || exiled[0]!.type !== 'move') return null;
    return [...exiled, { type: 'search', filter: { zone: 'library', owner: 'you', supertypes: ['Basic'], types: ['Land'] }, amount: 1, to: 'battlefield', tapped: true, forEachMoved: { how: 'exiled', types: ['Creature'] } }];
  }
  // Promise of Loyalty: "Each player puts a vow counter on a creature they control and sacrifices the rest. Each of those
  // creatures can't attack you or planeswalkers you control for as long as it has a vow counter on it."
  const vow = /^Each player puts an? (\S+) counter on (an? .+?) they control and sacrifices the rest\. Each of those creatures can't attack you or planeswalkers you control for as long as it has an? \1 counter on it\.$/.exec(text.trim());
  if (vow) {
    const pf = parseFilter(vow[2]!.replace(/^an? /, ''), b);
    if (!pf || pf.plural || pf.filter.zone || pf.filter.controller || !(pf.filter.types ?? []).includes('Creature')) return null;
    return [
      { type: 'keep_choose', who: { ref: 'players', who: 'each' }, pool: pf.filter, count: 1, keptCounters: { [vow[1]!]: 1 } },
      { type: 'modify', what: { ref: 'created' }, combat: { cantAttackYou: true }, until: 'game', whileCounter: vow[1]! },
    ];
  }
  // Ugin, the Ineffable: "Exile the top card of your library face down and look at it. Create a 2/2 colorless Spirit creature
  // token. When that token leaves the battlefield, put the exiled card into your hand."
  const ugin = /^Exile the top card of your library face down and look at it\. (Create an? [^.]+? token)\. When that token leaves the battlefield, put the exiled card into your hand\.$/.exec(text.trim());
  if (ugin) {
    const made = parseSentence(ugin[1]!, b);
    if (!made || made.length !== 1 || made[0]!.type !== 'create_token' || made[0]!.amount !== 1) return null;
    return [
      { type: 'exile_top', amount: 1, who: { ref: 'you' }, faceDown: true, lookAt: true },
      ...made,
      { type: 'delayed_leave', what: { ref: 'created' }, anyZone: true, effects: [{ type: 'move', what: { ref: 'moved_onto' }, to: 'hand' }] },
    ];
  }
  // Conduit of Worlds: "Choose target nonland permanent card in your graveyard. If you haven't cast a spell this turn, you may
  // cast that card. If you do, you can't cast additional spells this turn." — cast as it resolves, paying its costs (CR 608.2g).
  const conduit = /^Choose (target .+?)\. If (.+?), you may cast that card\. If you do, you can't cast additional spells this turn\.$/.exec(text.trim());
  if (conduit) {
    const what = parseObjectRef(conduit[1]!, b);
    const cond = what && !what.plural ? parseCondition(conduit[2]!, b) : null;
    if (!what || !cond) return null;
    return [{ type: 'if', cond, effects: [{ type: 'cast_paid', what: what.ref, then: [{ type: 'prohibit_casting', who: { ref: 'you' }, until: 'eot' }] }] }];
  }
  // Chocobo Kick: "Target creature you control deals damage equal to its power to target creature an opponent controls. If
  // this spell was kicked, the creature you control deals twice that much damage instead."
  const twiceBite = /^([^.]+ deals damage equal to (?:its|~'s) power to [^.]+)\. If ([^,]+), (?:the creature you control|it|that creature) deals twice that much damage instead\.$/.exec(text.trim());
  if (twiceBite) {
    const made = parseEffectText(`${twiceBite[1]}.`, b);
    const cond = made ? parseCondition(twiceBite[2]!, b) : null;
    if (!made || !cond || !made.every((e) => e.type === 'deal_damage' && (e.amount as { kind?: string }).kind === 'stat')) return null;
    const twice = made.map((e) => ({ ...e, amount: { ...(e.amount as object), times: 2 } }));
    return [{ type: 'if', cond, effects: twice, else: made }];
  }
  // Consult the Star Charts: "Look at the top X cards …. Put one of those cards into your hand. If this spell was kicked, put
  // two of those cards into your hand instead. Put the rest on the bottom of your library in a random order."
  const moreIf = /^(Look at the top [^.]+)\. Put one of those cards into your hand\. If ([^,]+), put two of those cards into your hand instead\. (Put the rest [^.]+\.)$/.exec(text.trim());
  if (moreIf) {
    const cond = parseCondition(moreIf[2]!, b);
    const one = cond ? attempt(b, (b) => parseEffectText(`${moreIf[1]}. Put one of those cards into your hand. ${moreIf[3]}`, b)) : null;
    const two = one ? attempt(b, (b) => parseEffectText(`${moreIf[1]}. Put two of those cards into your hand. ${moreIf[3]}`, b)) : null;
    return cond && one && two ? [{ type: 'if', cond, effects: two, else: one }] : null;
  }
  // Hellkite Courser: "you may put a commander you own from the command zone onto the battlefield. It gains haste. Return it
  // to the command zone at the beginning of the next end step."
  if (/^You may put a commander you own from the command zone onto the battlefield\. It gains haste\. Return it to the command zone at the beginning of the next end step\.$/.test(text.trim())) {
    return [{
      type: 'may_do',
      effects: [
        { type: 'choose_object', filter: { commander: true, zone: 'command', owner: 'you' } },
        { type: 'move', what: { ref: 'chosen_object' }, to: 'battlefield' },
        { type: 'modify', what: { ref: 'moved_onto' }, keywords: [{ id: 'haste' }] },
        { type: 'delayed', step: 'end', effects: [{ type: 'move', what: { ref: 'moved_onto' }, to: 'command' }] },
      ],
    }];
  }
  // Settle the Wreckage: "Exile all attacking creatures target player controls. That player may search their library for
  // that many basic land cards, put those cards onto the battlefield tapped, then shuffle." — one for each exiled.
  const settle = /^(Exile all [^.]+)\. (That player may search their library for) that many ([^.]+, then shuffle)\.$/.exec(text.trim());
  if (settle) {
    const made = parseEffectText(`${settle[1]}. ${settle[2]} up to X ${settle[3]}.`, b);
    if (!made || made.length !== 2 || made[0]!.type !== 'move' || made[0]!.to !== 'exile' || made[1]!.type !== 'may') return null;
    return bindX(made, { kind: 'moved_this_way', how: 'exiled' });
  }
  // Scapeshift: "Sacrifice any number of lands. Search your library for up to that many land cards, put them onto the
  // battlefield tapped, then shuffle."
  const shift = /^Sacrifice any number of (.+?)\. Search your library for up to that many (.+?), put them onto the battlefield( tapped)?, then shuffle\.$/.exec(text.trim());
  if (shift) {
    const sac = parseFilter(shift[1]!, b);
    const find = parseFilter(`${shift[2]} in your library`, b);
    if (!sac || !sac.plural || sac.filter.zone || !find || !find.plural) return null;
    return [
      { type: 'sacrifice_choice', who: { ref: 'you' }, filter: sac.filter, amount: 99, anyNumber: true },
      { type: 'search', filter: find.filter, amount: { kind: 'moved_this_way', how: 'sacrificed' }, upTo: true, to: 'battlefield', ...(shift[3] ? { tapped: true } : {}) },
    ];
  }
  // Ad Nauseam: "… You may repeat this process any number of times."
  const repeatMay = /^(.+?) You may repeat this process any number of times\.$/.exec(text.trim());
  if (repeatMay) {
    const inner = attempt(b, (b) => parseEffectText(repeatMay[1]!, b));
    return inner && !b.targets.length ? [{ type: 'repeat_may', effects: inner }] : null;
  }
  // Demonic Consultation (CR 201.3: any card name may be chosen).
  if (/^Choose a card name\. Exile the top six cards of your library, then reveal cards from the top of your library until you reveal a card with the chosen name\. Put that card into your hand and exile all other cards revealed this way\.$/.test(text.trim())) {
    return [{ type: 'name_and_dig', exileFirst: 6 }];
  }
  // Tainted Pact
  if (/^Exile the top card of your library\. You may put that card into your hand unless it has the same name as another card exiled this way\. Repeat this process until you put a card into your hand or you exile two cards with the same name, whichever comes first\.$/.test(text.trim())) {
    return [{ type: 'tainted_pact' }];
  }
  // Expressive Iteration: "Look at the top three cards of your library. Put one of them into your hand, put one of them on
  // the bottom of your library, and exile one of them. You may play the exiled card this turn."
  if (/^Look at the top three cards of your library\. Put one of them into your hand, put one of them on the bottom of your library, and exile one of them\. You may play the exiled card this turn\.$/.test(text.trim())) {
    return [{ type: 'look_sort', amount: 3, slots: ['hand', 'bottom', 'exile_play'] }];
  }
  // Telling Time: "Look at the top three cards of your library. Put one of those cards into your hand, one on top of your
  // library, and one on the bottom of your library."; Moment of Truth: "… one into your graveyard, and one on the bottom".
  const telling = /^Look at the top three cards of your library\. Put one of those cards into your hand, one (on top of your library|into your graveyard), and one on the bottom of your library\.$/.exec(text.trim());
  if (telling) return [{ type: 'look_sort', amount: 3, slots: ['hand', telling[1] === 'into your graveyard' ? 'graveyard' : 'top', 'bottom'] }];
  // Archdruid's Charm: "Search your library for a creature or land card and reveal it. Put it onto the battlefield tapped if
  // it's a land card. Otherwise, put it into your hand. Then shuffle."
  const landOrHand = /^Search your library for (.+?) and reveal it\. Put it onto the battlefield( tapped)? if it's a land card\. Otherwise, put it into your hand\. Then shuffle\.$/.exec(text.trim());
  if (landOrHand) {
    const r = attempt(b, (b) => parseEffectText(`Search your library for ${landOrHand[1]}, reveal it, put it into your hand, then shuffle.`, b));
    const search = r?.length === 1 && r[0]!.type === 'search' && r[0]!.amount === 1 ? r[0]! : null;
    return search ? [{ ...search, landsTo: 'battlefield', ...(landOrHand[2] ? { landsTapped: true } : {}) }] : null;
  }
  // Torment of Hailfire: "Repeat the following process X times. Each opponent loses 3 life unless …"
  const repeatN = /^Repeat the following process (\w+) times\. ([^.]+\.)$/.exec(text.trim());
  if (repeatN) {
    const times = parseAmount(repeatN[1]!);
    const inner = times === null ? null : attempt(b, (b) => parseEffectText(repeatN[2]!, b));
    return inner && times !== null ? [{ type: 'repeat', times, effects: inner }] : null;
  }
  return attempt(b, (b) => {
    const sentences = splitSentences(text);
    if (!sentences) return null;
    // "…, and you may spend mana as though it were mana of any color to cast that spell" rides on the play permission it
    // follows; one left over (with no permission to ride on) doesn't read.
    // Hostage Taker: "… mana of any type" — colorless costs too.
    // Newer wording (Hostage Taker, 2025): "…, and mana of any type can be spent to cast that spell" — the same permission.
    const ANY_COLOR = /,? and (?:you may spend mana as though it were mana of any (color|type)|mana of any (type) can be spent) to cast (?:that spell|those spells|it|them)$/;
    const anyColorAt = new Map<number, 'color' | 'type'>();
    sentences.forEach((t, k) => {
      const m = ANY_COLOR.exec(t);
      if (!m) return;
      sentences[k] = t.replace(ANY_COLOR, '');
      anyColorAt.set(k, (m[1] ?? m[2]) as 'color' | 'type');
    });
    const anyColor = (k: number) => {
      const how = anyColorAt.get(k);
      if (!how) return {};
      anyColorAt.delete(k);
      return { anyColor: how === 'type' ? ('type' as const) : (true as const) };
    };
    const out: EffectNode[] = [];
    // The plain effects of the last sentence, for a following "… instead".
    let previous: EffectNode[] = [];
    // Teachings of the Archaics: "If …, draw two cards. Draw three cards instead if …" — the guarded effect, replaced inside
    // its own condition.
    let prevIf: (EffectNode & { effects: EffectNode[] }) | null = null;
    for (let i = 0; i < sentences.length; i++) {
      let s = sentences[i]!;
      // Temur Battle Rage: "… Ferocious — That creature also gains trample …" — an ability word in mid-text has no rules
      // meaning (CR 207.2c); "also" only says it's in addition.
      if (i > 0) s = s.replace(/^(?!Choose\b)[A-Z][A-Za-z']+(?: [A-Za-z']+){0,2} — (?=[A-Z])/, '');
      s = s.replace(/^((?:That|Those) (?:creature|creatures|permanent|player)|It|They) also (?=[a-z])/, '$1 ');
      // Electro: "When you do, he deals X damage to target player." — a character card calling itself "he" or "she".
      // Kaito Shizuki: "If Kaito entered this turn, he phases out."
      if (/\b(?:Creature|Planeswalker)\b/.test(b.env.typeLine)) s = s.replace(/^((?:If [^,]+, )?)(?:[Hh]e|[Ss]he) (?=(?:deals|gains|gets|fights|phases|connives|explores)(?: |$))/, '$1~ ');
      // Dawn's Truce: "If the gift was promised, permanents you control also gain indestructible until end of turn."
      s = s.replace(/^(If [^,]+, [^,]*?) also (?=(?:gains?|gets?|deals?|has|have|loses?|draws?|creates?|puts?) )/, '$1 ');
      // Finale of Glory: "If X is 10 or more, also create X 4/4 white Angel creature tokens …"
      s = s.replace(/^(If [^,]+), also (?=(?:gain|get|deal|draw|create|put|return|destroy|exile) )/, '$1, ');
      // Cyclone Summoner: "return all permanents to their owners' hands except for Giants, Wizards, and lands" — the
      // exception belongs to "all permanents".
      s = s.replace(/^([Rr]eturn all .+?) (to their owners' hands) (except for .+)$/, '$1 $3 $2');
      // Entish Restoration: "If you control a creature with power 4 or greater, instead search …" — the same as "… instead".
      s = s.replace(/^(If [^,]+), instead (.+)$/, '$1, $2 instead');
      // Wings of Velis Vel: "Until end of turn, target creature has base power and toughness 4/4, gains all creature types,
      // and gains flying." — a list of three.
      s = s.replace(/^(Until end of turn, .+? ha(?:s|ve) base power and toughness \d+\/\d+), (gains? [^,]+),? and (gains? .+)$/, '$1 and $2 and $3');
      if (i > 0 && !/ instead$/.test(s) && !/ instead if /.test(s) && !/, search your library for .+ instead of one$/.test(s)) previous = [];
      const ifBefore = prevIf;
      prevIf = null;
      // "Then each player draws a card." — "then" only orders what's already in order.
      if (i > 0 && /^Then (?!shuffle)/.test(s)) s = capitalise(s.slice(5));
      // The Chains: "Then that player or that permanent's controller may pay {R}{R}. If the player does, they may copy this
      // spell and may choose a new target for that copy." (Chain of Vapor: "may sacrifice a land of their choice"; Chain of
      // Plasma: "may discard a card"; Chain of Acid: "may copy this spell …" outright.)
      const chainWho = /^(?:that player or that permanent's controller|that (?:permanent|creature|land)'s controller|that player)$/;
      const chainCost = /^(that player or that permanent's controller|that (?:permanent|creature|land)'s controller|that player) may (pay ((?:\{[^}]+\})+)|sacrifice a land of their choice|discard a card)$/i.exec(s.replace(/^Then /, ''));
      const chainNow = /^(that player or that permanent's controller|that (?:permanent|creature|land)'s controller|that player) may copy (?:this spell|~) and may choose a new target for that copy$/i.exec(s.replace(/^Then /, ''));
      const chainNext = chainCost && /^If the player does, they may copy (?:this spell|~) and may choose a new target for that copy$/.test(sentences[i + 1] ?? '');
      if ((chainCost && chainNext) || chainNow) {
        const lower = (chainCost ?? chainNow)![1]!.toLowerCase();
        const target = b.targets.length ? { ref: 'target' as const, index: b.targets.length - 1 } : null;
        if (!target || !chainWho.test(lower) || !/\bSorcery\b|\bInstant\b/.test(b.env.typeLine)) return null;
        const c = chainCost?.[2];
        const cost = !c ? undefined : chainCost![3] ? { mana: chainCost![3] } : /^sacrifice/.test(c) ? { sacrifice: { types: ['Land'] } } : { discard: 1 };
        out.push({ type: 'chain_copy', who: target, ...(cost ? { cost } : {}) });
        if (chainNext) i++;
        continue;
      }
      // Hunter's Insight: "Choose target creature you control. Whenever that creature deals combat damage to a player or
      // planeswalker this turn, draw that many cards."; Massacre Girl: "Whenever a creature dies this turn, …" — a triggered
      // ability for the rest of the turn (CR 603.7).
      // Full Throttle: "At the beginning of each combat this turn, untap all creatures that attacked this turn."
      const stepTrig = b.env.parseAbilities && i === sentences.length - 1 ? /^At the beginning of each combat this turn, (.+)$/.exec(s) : null;
      if (stepTrig) {
        const r = b.env.parseAbilities!(`At the beginning of each combat, ${stepTrig[1]}.`, b.env.cardName, b.env.typeLine);
        const ability = r.abilities[0];
        if (r.unparsed.length || r.manualKeywords.length || r.abilities.length !== 1 || ability?.kind !== 'triggered' || ability.targets?.length) return null;
        out.push({ type: 'turn_trigger', ability });
        previous = [];
        continue;
      }
      // Turn Inside Out: "When it dies this turn, manifest dread." — one object, which dies at most once (CR 603.7c).
      // Devouring Tendrils: "When the permanent you don't control dies this turn, you gain 2 life." — that target.
      const whenIt = b.env.parseAbilities && b.it?.ref === 'target' ? /^When (it|that creature) (dies) this turn, (.+)$/.exec(s) : null;
      const whenThe = b.env.parseAbilities ? /^When the (?:permanent|creature) (you don't control|an opponent controls) dies this turn, (.+)$/.exec(s) : null;
      const theIndex = whenThe ? b.targets.findIndex((t) => t.filter?.controller === (whenThe[1] === 'an opponent controls' ? 'opponent' : 'not_you')) : -1;
      const turnTrig = whenIt
        ? [s, undefined, `${whenIt[1]} ${whenIt[2]}`, ' this turn', whenIt[3]!]
        : whenThe && theIndex >= 0 && b.targets.filter((t) => t.filter?.controller === b.targets[theIndex]!.filter?.controller).length === 1
          ? [s, undefined, `TARGETREF${theIndex} dies`, ' this turn', whenThe[2]!]
          : b.env.parseAbilities ? /^(Until end of turn, )?[Ww]henever (.+?)( this turn)?, (.+)$/.exec(s) : null;
      if (turnTrig && (turnTrig[1] || turnTrig[3]) && !/\bthis turn\b/.test(turnTrig[2]!)) {
        // Dalkovan Encampment: "… create two … tokens that are tapped and attacking. Sacrifice them at the beginning of the
        // next end step." — what follows may belong to the ability; only a last sentence is read this way.
        // Jace Reawakened: "… whenever you cast a spell, copy it. You may choose new targets for the copy." — one ability.
        const newTargets = i === sentences.length - 2 && /^You may choose new targets for (?:the|that) copy$/.test(sentences[i + 1]!);
        if (i !== sentences.length - 1 && !newTargets) return null;
        let cond = turnTrig[2]!;
        let effect = newTargets ? `${turnTrig[4]!}. ${sentences[i + 1]!}` : turnTrig[4]!;
        if (newTargets) i++;
        if (b.player?.ref === 'target' && / to that player$/.test(cond)) cond = cond.replace(/ to that player$/, ` to TARGETPLAYER${b.player.index}`);
        if (b.it?.ref === 'target') {
          cond = cond.replace(/^(?:that creature|that permanent|it)(?= )/, `TARGETREF${b.it.index}`);
          // Jaya, Fiery Negotiator: "Whenever you attack this turn, Jaya deals damage … to that creature." — the target.
          if (!cond.includes('TARGETREF')) effect = effect.replace(/\b(?:that creature|that permanent)\b/g, `TARGETREF${b.it.index}`);
        }
        const r = b.env.parseAbilities!(`Whenever ${cond}, ${effect}.`, b.env.cardName, b.env.typeLine);
        const ability = r.abilities[0];
        if (r.unparsed.length || r.manualKeywords.length || r.abilities.length !== 1 || ability?.kind !== 'triggered' || ability.trigger.type === 'tapped_for_mana') return null;
        if ((cond.includes('TARGETREF') || cond.includes('TARGETPLAYER') || effect.includes('TARGETREF')) && ability.targets?.length) return null;
        out.push({ type: 'turn_trigger', ability });
        previous = [];
        continue;
      }
      // CR 702.34a: "target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback
      // cost is equal to its mana cost." (Snapcaster Mage, Past in Flames)
      const fbGrant = /^(.+?) (?:gains?|has|have) flashback( until end of turn)?$/.exec(s);
      if (fbGrant && sentences[i + 1] && /^The flashback cost is equal to (?:its|that card's|their) mana cost$/.test(sentences[i + 1]!)) {
        const what = parseObjectRef(fbGrant[1]!, b);
        if (!what) return null;
        out.push({ type: 'modify', what: what.ref, until: fbGrant[2] ? 'eot' : 'game', keywords: [{ id: 'flashback', costIsManaCost: true }] });
        i++;
        continue;
      }
      // Tempting offer (an ability word, CR 207.2c): "Each opponent may [do it too]. For each opponent who does, [you do it
      // again]." — each opponent in turn order (CR 101.4) chooses; those who accept do it as though they were you; then you
      // do it once for each.
      const tempt = /^Each opponent may (.+)$/.exec(s);
      const forEachWho = tempt && sentences[i + 1] ? /^For each (?:opponent|player) who (?:does|searches a library this way), (.+)$/.exec(sentences[i + 1]!) : null;
      if (tempt && forEachWho) {
        const asThem = capitalise(tempt[1]!.replace(/\btheir\b/g, 'your').replace(/\bthey (control|own)\b/g, 'you $1'));
        const theirs = parseSentence(asThem, b);
        const mine = theirs && parseSentence(capitalise(forEachWho[1]!), b);
        if (!theirs || !mine || /\b(?:they|them|their)\b/.test(asThem)) return null;
        out.push({ type: 'tempting_offer', theirs, mine });
        i++;
        // "Then each player who searched a library this way shuffles." — searching shuffles anyway.
        if (/^Then each player who searched a library this way shuffles$/.test(sentences[i + 1] ?? '')) i++;
        continue;
      }
      // Minas Morgul: "Put a shadow counter on target creature. For as long as that creature has a shadow counter on it, it's a
      // Wraith in addition to its other types."; Cyclopean Tomb: "That land is a Swamp for as long as it has a mire counter on it."
      const whileCounter =
        /^For as long as (?:that creature|that land|that permanent|it) has an? (\S+) counter on it, (?:it's|it is) (an? .+)$/.exec(s) ??
        (() => {
          const m = /^(?:(?:That creature|That land|That permanent|It) is|It's) (an? .+?) for as long as it has an? (\S+) counter on it$/.exec(s);
          return m ? ([m[0], m[2], m[1]] as unknown as RegExpExecArray) : null;
        })();
      if (whileCounter && b.it && b.it.ref !== 'self') {
        const made = parseSentence(`It becomes ${whileCounter[2]} until end of turn`, b);
        if (!made || made.length !== 1 || made[0]!.type !== 'modify' || made[0]!.until !== 'eot') return null;
        out.push({ ...made[0]!, until: 'game', whileCounter: whileCounter[1]! });
        continue;
      }
      // Plaguecrafter: "Each player sacrifices a creature or planeswalker of their choice. Each player who can't discards a card."
      const whoCant = /^Each (?:player|opponent) who can't (.+)$/.exec(s);
      const lastNode = out[out.length - 1];
      if (whoCant && lastNode?.type === 'sacrifice_choice' && (lastNode.who as { ref?: string } | undefined)?.ref === 'players') {
        const then = parseSentence(`You ${whoCant[1]!.replace(/^(\w+?)s\b/, '$1')}`, b);
        if (!then) return null;
        lastNode.cant = then;
        continue;
      }
      // Wasitora, Nekoru Queen: "that player sacrifices a creature of their choice. If the player can't, you create a 3/3 …"
      // — done by you, once if they had nothing to sacrifice.
      const theyCant = /^If (?:the player|that player|they) can't, (.+)$/.exec(s);
      if (theyCant && lastNode?.type === 'sacrifice_choice' && !lastNode.cant && (lastNode.who as { ref?: string } | undefined)?.ref !== 'players') {
        const then = parseSentence(capitalise(theyCant[1]!), b);
        if (!then) return null;
        lastNode.cantYou = then;
        continue;
      }
      // Liliana, Waker of the Dead: "Each player discards a card. Each opponent who can't loses 3 life." — those who had no
      // card to discard.
      const whoCantLose = /^Each (player|opponent) who can't loses (\d+) life$/.exec(s);
      if (whoCantLose && lastNode?.type === 'discard' && !lastNode.all && (lastNode.who as { ref?: string } | undefined)?.ref === 'players') {
        out.push({ type: 'lose_life', amount: Number(whoCantLose[2]), who: { ref: 'players', who: whoCantLose[1] === 'player' ? 'each' : 'opponents', discardedNone: true } });
        continue;
      }
      // Eldrazi Monument: "sacrifice a creature. If you can't, sacrifice this artifact."
      const youCant = /^If you can't, (.+)$/.exec(s);
      if (youCant && lastNode?.type === 'sacrifice_choice' && (lastNode.who as { ref?: string } | undefined)?.ref === 'you') {
        const then = parseSentence(capitalise(youCant[1]!), b);
        if (!then) return null;
        lastNode.cant = then;
        continue;
      }
      // Victimize: "Sacrifice a creature. If you do, return the chosen cards …" — not optional, but what follows
      // happens only if it was done (CR 608.2c).
      const ifDone = sentences[i + 1] && !/^(?:You may|Pay) /.test(s) ? /^If you do, (.+)$/.exec(sentences[i + 1]!) : null;
      // Gilded Drake: "Exchange control of this creature and up to one target creature an opponent controls. If you don't
      // or can't make an exchange, sacrifice this creature." — the exchange isn't optional (CR 701.12a).
      const noExchange = /^Exchange control of /.test(s) && sentences[i + 1] ? /^If you don't or can't make an exchange, (.+)$/.exec(sentences[i + 1]!) : null;
      if (noExchange) {
        const first = parseSentence(s, b);
        const otherwise = first?.length === 1 && first[0]!.type === 'exchange_control' ? parseSentence(capitalise(noExchange[1]!), b) : null;
        if (!first || !otherwise) return null;
        out.push({ type: 'may_do', effects: first, then: [], else: otherwise, mandatory: true });
        i++;
        continue;
      }
      // Divine Reckoning: "Each player chooses a creature they control. Destroy the rest."
      if (sentences[i + 1] === 'Destroy the rest' && / chooses .+ they control$/.test(s)) {
        const kept = parseSentence(`${s}, then destroys the rest`, b);
        if (!kept) return null;
        out.push(...kept);
        i++;
        continue;
      }
      // CR 608.2b doesn't apply: "This ability still resolves if its target becomes illegal." (Gilded Drake)
      if (s === 'This ability still resolves if its target becomes illegal' && b.targets.length) {
        for (const spec of b.targets) spec.stillResolves = true;
        continue;
      }
      // Volatile Stormdrake: "Exchange control of this creature and target creature …. If you do, …" (CR 701.12a).
      // Liliana, Heretical Healer: "exile ~, then return her to the battlefield transformed …. If you do, create …" — only
      // if she was still there to exile.
      // Shadow of the Goblin: "discard a card. If you do, draw a card." — only with a card to discard.
      // Dawn of a New Age: "remove a hope counter from this enchantment. If you do, draw a card." — only with one there.
      if (ifDone && (/^(?:Sacrifice|Exchange control of|Discard a card$|Remove (?:a|an|one|two|three) \S+ counters? from ~$)/.test(s) || /^[Ee]xile ~, then return (?:it|him|her) to the battlefield transformed /.test(s))) {
        const first = parseSentence(s, b);
        const then = first ? parseSentence(capitalise(ifDone[1]!), b) : null;
        if (!first || !then) return null;
        out.push({ type: 'may_do', effects: first, then, mandatory: true });
        i++;
        continue;
      }
      // CR 603.12: "[Do something]. When you do, [effect]." — the rest of the text is a reflexive triggered ability
      // with its own targets, which triggers only if the action was taken.
      // Glacial Dragonhunt: "Draw a card, then you may discard a card. When you discard a nonland card this way, …"; Evie Frye:
      // "… then discard a card. When you discard a creature card this way, …" — it triggers only for that kind of card.
      const discardKind = sentences[i + 1] ? /^When you discard an? ((?:non)?[a-z]+) card this way, (.+)$/.exec(sentences[i + 1]!) : null;
      const discardFilter = discardKind && /\bdiscard a card$/.test(s) ? parseFilter(`${discardKind[1]} card in your hand`, b.clone()) : null;
      const whenYouDo = sentences[i + 1] ? (/^When you do, (.+)$/.exec(sentences[i + 1]!) ?? (discardFilter && !/\bthat card\b/.test(discardKind![2]!) ? ([sentences[i + 1]!, discardKind![2]!] as unknown as RegExpExecArray) : null)) : null;
      if (whenYouDo) {
        // "Draw a card, then you may discard a card. When you do, …" — only the discard is optional, and what it leads to.
        const thenMay = /^(.+?), then you may (.+)$/.exec(s);
        if (thenMay) {
          const before = parseSentence(capitalise(thenMay[1]!), b);
          if (!before) return null;
          out.push(...before);
          s = `You may ${thenMay[2]}`;
        }
        // Leyline Tyrant: "you may pay any amount of {R}. When you do, it deals that much damage to any target." — X, in red.
        const anyOf = /^You may pay any amount of \{([WUBRGC])\}$/.exec(s);
        if (anyOf) whenYouDo[1] = whenYouDo[1]!.replace(/\bthat much\b/g, 'X');
        const pay = anyOf ? ([s, '{X}'] as const) : /^You may pay ((?:\{(?:\d+|X|[WUBRGC]|[WUBRG2]\/[WUBRG])\})+|(?:\{E\})+)$/.exec(s);
        const may = /^You may (.+)$/.exec(s);
        const first = pay ? [] : parseSentence(capitalise(may ? may[1]! : s), b);
        if (!first) return null;
        const rb = b.clone();
        rb.targets = [];
        rb.damaged = null;
        // The first part's targets aren't this ability's; after an action on some object ("sacrifice another
        // creature"), "that creature" means that object, which this ability can't see — so it doesn't read.
        // Only what a trigger can see survives: the source and what made the outer ability trigger.
        const keepsIt = first.every((x) => ['lose_life', 'gain_life', 'draw', 'mill', 'forage'].includes(x.type));
        if (!keepsIt || !rb.it || !['self', 'trigger_object'].includes(rb.it.ref)) rb.it = null;
        if (rb.player && !['you', 'trigger_player'].includes(rb.player.ref)) rb.player = null;
        // "X can't be greater than …" after what's paid for.
        const rest = [whenYouDo[1]!, ...sentences.slice(i + 2)];
        // Ziatora: "you may sacrifice another creature. When you do, ~ deals damage equal to that creature's power …" — the
        // sacrificed creature, as it last existed (CR 608.2h).
        const sacOne = first.length === 1 && first[0]!.type === 'sacrifice_choice' && first[0]!.amount === 1 && ((first[0]!.filter as ObjectFilter | undefined)?.types ?? []).includes('Creature');
        if (sacOne) for (const [k, r] of rest.entries()) rest[k] = r.replace(/\bthat creature's (power|toughness|mana value)\b/g, "the sacrificed creature's $1");
        const capX = pay && pay[1]!.includes('{X}') ? xCap(rest, b) : null;
        if (capX === undefined) return null;
        const restText = `${rest.join('. ')}.`;
        const inner = parseEffectText(capitalise(restText), rb);
        // "the exiled card" after "you may exile it" isn't something this ability can find; nor can its targets use counts
        // (Sandbender Scavengers: "with mana value less than or equal to this creature's power").
        if (!inner || rb.unsupported || (!pay && JSON.stringify(inner).includes('"exiled_with"'))) return null;
        // Halo Forager: "you may pay {X}. When you do, … target … card with mana value X" — the X paid (bound as it's
        // paid); with nothing paying X, a target "with mana value X" means nothing.
        if (/"n":"X"/.test(JSON.stringify(rb.targets)) && !pay?.[1]!.includes('{X}')) return null;
        const ability = { kind: 'triggered', text: `When you do, ${restText}`, trigger: { type: 'reflexive' }, effects: inner, ...(rb.targets.length ? { targets: rb.targets } : {}) };
        let reflexive: EffectNode = { type: 'reflexive', abilities: [ability] };
        if (discardFilter && !/^When you do, /.test(sentences[i + 1]!)) {
          const { zone: _z, owner: _o, ...kind } = discardFilter.filter;
          reflexive = { type: 'if', cond: { type: 'amount', amount: { kind: 'discarded_this_way', filter: kind }, op: 'ge', n: 1 } as ConditionNode, effects: [reflexive] };
        }
        if (pay) out.push({ type: 'may_pay', cost: pay[1]!, effects: [reflexive], ...(capX ? { maxX: capX } : {}), ...(anyOf ? { xColor: anyOf[1] } : {}) });
        else out.push({ type: 'may_do', effects: first, then: [reflexive], ...(may ? {} : { mandatory: true }) });
        break;
      }
      // "…, reveal it, and put it into your hand. Then shuffle your library." (CR 702.29e wording).
      if (/^Search /.test(s) && /^Then shuffle(?: your library)?$/.test(sentences[i + 1] ?? '')) {
        // Spoils of Victory: "Search your library for a … card and put that card onto the battlefield. Then shuffle."
        s = `${s.replace(/, reveal that card, and put it /, ', reveal it, put it ').replace(/, and put /, ', put ').replace(/ card and put that card (onto|into) /, ' card, put it $1 ')}, then shuffle`;
        i++;
      }
      // Killer Service: "you may pay {2} and sacrifice a token. If you do, create …"; Conspiracy Theorist: "you may pay {1} and
      // discard a card" — the action is part of the cost, offered only when it can be done (CR 118.12).
      const payAnd = /^(?:Then )?[Yy]ou may pay ((?:\{(?:\d+|[WUBRGC]|[WUBRG2]\/[WUBRG])\})+) and ((?:sacrifice|discard|exile) .+)$/.exec(s);
      const payAndDo = payAnd && sentences[i + 1] ? /^If you do, (.+)$/.exec(sentences[i + 1]!) : null;
      if (payAnd && payAndDo) {
        const action = parseSentence(capitalise(payAnd[2]!), b);
        const a = action?.length === 1 ? action[0]! : null;
        const checked =
          a &&
          (a.type === 'sacrifice_choice' ||
            a.type === 'sacrifice' ||
            (a.type === 'discard' && !a.all && !a.random) ||
            (a.type === 'move' && ['self', 'trigger_object', 'target'].includes(String((a.what as { ref?: string } | undefined)?.ref))));
        const inner = checked ? parseSentence(capitalise(payAndDo[1]!), b) : null;
        if (!inner) return null;
        out.push({ type: 'may_pay', cost: payAnd[1]!, with: action!, effects: inner });
        i++;
        continue;
      }
      // Galvanic Discharge: "You get {E}{E}{E}, then you may pay any amount of {E}. ~ deals that much damage to that
      // permanent." — X energy, chosen as it's paid (CR 107.14).
      const anyEnergy = /^(?:(.+?), then )?[Yy]ou may pay any amount of \{E\}$/.exec(s);
      if (anyEnergy && sentences[i + 1] && /\bthat much\b/.test(sentences[i + 1]!)) {
        const before = anyEnergy[1] ? parseSentence(capitalise(anyEnergy[1]), b) : [];
        const inner = before ? parseSentence(capitalise(sentences[i + 1]!.replace(/\bthat much\b/g, 'X')), b) : null;
        if (!before || !inner) return null;
        out.push(...before, { type: 'may_pay', cost: '', energyX: true, effects: inner });
        i++;
        continue;
      }
      // CR 118.12: "You may pay {2}. If you do, …" — an optional cost paid on resolution.
      // Mana the engine can pay as a resolution-time cost (no {X}, snow or Phyrexian symbols), or energy (CR 107.14).
      // CR 119.4: "You may pay 3 life", Ripples of Undeath: "you may pay {1} and 3 life" — life only if you have that much.
      // "You may pay {X}. If you do, draw X cards." — X chosen as it's paid; ", where X is less than or equal to …" bounds
      // it, ", where X is …" fixes it (Primordial Ooze).
      // Mask of Griselbrand: "you may pay X life, where X is its power"; Necrodominance: "you may pay any amount of life".
      const payParts = /^(?:Then )?[Yy]ou may pay (?:((?:\{(?:\d+|X|[WUBRGC]|[WUBRG2]\/[WUBRG])\})+|(?:\{E\})+)(?: and (\d+) life)?|(\d+|X|any amount of) life)(?:, where X is (less than or equal to )?(.+))?$/.exec(s);
      const lifeX = payParts?.[3] === 'X' || payParts?.[3] === 'any amount of';
      if (payParts?.[3] === 'any amount of' && payParts[5]) return null;
      const pay = payParts ? ([payParts[0], payParts[1] ?? ''] as const) : null;
      const payLife = payParts && !lifeX ? Number(payParts[2] ?? payParts[3] ?? 0) : 0;
      const hasX = Boolean(pay?.[1].includes('{X}')) || payParts?.[3] === 'X';
      const whereX = payParts?.[5] ? parseCount(payParts[5], b) : null;
      if (payParts && (hasX ? payParts[5] && !whereX : payParts[5])) return null;
      const fixX = whereX && !payParts![4] ? { xIs: whereX } : {};
      const then = sentences[i + 1] ? /^If you do, (.+)$/.exec(sentences[i + 1]!) : null;
      if (pay && then) {
        // "If you do, draw that many cards" after "any amount of life" — the X paid.
        const inner = parseSentence(capitalise(lifeX ? then[1]!.replace(/\bthat many\b/g, 'X') : then[1]!), b);
        if (!inner) return null;
        // CR 702.59a (recover): "… Otherwise, exile this card."
        const otherwise = sentences[i + 2] ? /^(?:Otherwise|If you don't), (.+)$/.exec(sentences[i + 2]!) : null;
        const no = otherwise ? parseSentence(capitalise(otherwise[1]!), b) : null;
        if (otherwise && !no) return null;
        // Mortarion: "… X can't be greater than the amount of life you lost this turn."
        const after = i + (otherwise ? 3 : 2);
        const cap = hasX && !whereX ? xCap(sentences.slice(after, after + 1), b) : null;
        if (cap === undefined) return null;
        const maxX = whereX && payParts![4] ? { maxX: whereX } : cap ? { maxX: cap } : {};
        if (lifeX && pay[1]) return null;
        out.push({ type: 'may_pay', cost: pay[1]!, ...(payLife ? { life: payLife } : {}), ...(lifeX ? { lifeX: true } : {}), ...fixX, ...maxX, effects: inner, ...(no ? { else: no } : {}) });
        i += (otherwise ? 2 : 1) + (cap ? 1 : 0);
        continue;
      }
      // Dance of the Dead: "that player may pay {1}{B}. If the player does, untap that creature." — another player pays.
      // Gix, Yawgmoth Praetor: "its controller may pay 1 life. If they do, they draw a card." — life too (CR 119.4).
      const otherPay = /^(That player|Its controller|They) may pay ((?:\{(?:\d+|[WUBRGC]|[WUBRG2]\/[WUBRG])\})+|(\d+) life)$/.exec(s);
      const otherDo = otherPay && sentences[i + 1] ? /^If (?:the player|that player|they) (?:does|do), (.+)$/.exec(sentences[i + 1]!) : null;
      if (otherPay && otherDo) {
        const payer = singlePlayer(otherPay[1]!.toLowerCase(), b);
        // "they draw a card": the one who paid.
        const theyDo = /^they (.+)$/.exec(otherDo[1]!);
        const inner = !payer ? null : theyDo ? (attempt(b, (b) => parseClause(theyDo[1]!, b, payer))?.effects ?? null) : parseSentence(capitalise(otherDo[1]!), b);
        if (!payer || !inner) return null;
        out.push({ type: 'may_pay', cost: otherPay[3] ? '' : otherPay[2]!, ...(otherPay[3] ? { life: Number(otherPay[3]) } : {}), payer, effects: inner });
        i++;
        continue;
      }
      // "You may pay {2}. If you don't, blight 2." / "… sacrifice it."
      const payDont = pay && sentences[i + 1] ? /^If you don't, (.+)$/.exec(sentences[i + 1]!) : null;
      if (pay && payDont) {
        // With X, only an X the text fixes means anything here.
        if (hasX && !('xIs' in fixX)) return null;
        const no = parseSentence(capitalise(payDont[1]!), b);
        if (!no) return null;
        out.push({ type: 'may_pay', cost: pay[1]!, ...(payLife ? { life: payLife } : {}), ...fixX, effects: [], else: no });
        i++;
        continue;
      }
      // CR 500.5: "Until end of turn, you don't lose this mana as steps and phases end."
      const keep = i > 0 ? /^Until end of (turn|combat), you don't lose this mana as steps(?: and phases)? end$/.exec(s) : null;
      if (keep) {
        const last = out[out.length - 1] as AddManaEffect | undefined;
        if (last?.type !== 'add_mana') return null;
        last.keep = keep[1] === 'turn' ? 'end_of_turn' : 'end_of_combat';
        continue;
      }
      // "If that spell would be put into its owner's graveyard, exile it instead." after a counterspell or a free cast.
      if (i > 0 && /^If (?:that spell|that card|it) would be put into (?:its owner's|your|a) graveyard(?: this turn)?, exile it instead$/.test(s)) {
        const last = out[out.length - 1];
        if (last?.type === 'counter') last.exile = true;
        else if (last?.type === 'cast_free') last.exileOnLeave = true;
        // Dire Fleet Daredevil: "You may cast it this turn … If that spell would be put into a graveyard, exile it instead."
        else if (last?.type === 'grant_play' && last.mode === 'cast') last.exileOnLeave = true;
        else return null;
        continue;
      }
      // "Reveal cards from the top of your library until you reveal a creature card. Put that card into your hand and the
      // rest on the bottom of your library in a random order."
      const until = /^([Rr]eveal|[Ee]xile) cards from the top of your library until you (?:reveal|exile) (?:a|an) (.+?)$/.exec(s);
      const after = until ? sentences[i + 1] : undefined;
      if (until && after) {
        const pf = parseFilter(`${until[2]} in your library`, b);
        if (!pf || pf.plural || pf.filter.zone !== 'library') return null;
        const { zone: _z, owner: _o, ...filter } = pf.filter;
        const exile = /^[Ee]xile/.test(until[1]!);
        const put = /^(You may put|Put) that card (into your hand|onto the battlefield( tapped)?|into your graveyard)(?: and (?:the rest|all other cards revealed this way) (on the bottom of your library in a random order|into your graveyard)|, then shuffle(?: the rest into your library)?)?$/.exec(after);
        const castIt = exile && /^You may cast (?:that card|it) without paying its mana cost$/.test(after);
        if (put) {
          const to = put[2] === 'into your hand' ? 'hand' : put[2]!.startsWith('onto') ? 'battlefield' : 'graveyard';
          let rest = put[4] === 'into your graveyard' ? 'graveyard' : /shuffle/.test(after) ? 'shuffle' : put[4] ? 'bottom' : null;
          let used = 1;
          if (!rest) {
            const restS = sentences[i + 2] ?? '';
            if (/^Put (?:the rest|all other cards revealed this way) on the bottom of your library in a random order$/.test(restS)) rest = 'bottom';
            else if (/^Put (?:the rest|all other cards revealed this way) into your graveyard$/.test(restS)) rest = 'graveyard';
            else if (/^(?:Then )?[Ss]huffle(?: the rest into your library| your library)?$/.test(restS)) rest = 'shuffle';
            else return null;
            used = 2;
          }
          out.push({ type: 'reveal_until', filter, to, rest, ...(exile ? { exile: true } : {}), ...(put[1] === 'You may put' ? { optional: true } : {}), ...(put[3] ? { tapped: true } : {}) });
          i += used;
          continue;
        }
        if (castIt) {
          // The rest go on the bottom in a random order (if the text says so) — otherwise they stay exiled.
          const restS = sentences[i + 2] ?? '';
          const bottom = /^Put (?:the rest|the exiled cards|all other cards exiled this way)(?: that weren't cast this way)? on the bottom of your library in a random order$/.test(restS);
          out.push({ type: 'reveal_until', filter, to: 'cast', rest: bottom ? 'bottom' : 'exile', exile: true });
          i += bottom ? 2 : 1;
          continue;
        }
        return null;
      }
      // CR 106.6: "Add {R}{R}{R}. Spend this mana only to cast instant or sorcery spells."
      // Karn, Legacy Reforged: "This mana can't be spent to cast nonartifact spells." (Powerstone mana, CR 106.6)
      if (i > 0 && /^This mana can't be spent to cast (?:a )?nonartifact spells?$/.test(s)) {
        const last = out[out.length - 1] as AddManaEffect | undefined;
        if (last?.type !== 'add_mana' || last.spend) return null;
        last.spend = { spells: { types: ['Artifact'] }, abilities: {}, special: ['unlock', 'face_up'], other: true };
        continue;
      }
      // CR 615.5: Inkshield — "For each 1 damage prevented this way, create a 2/1 … Inkling creature token with flying.";
      // Deflecting Palm — "If damage is prevented this way, ~ deals that much damage to that source's controller." Done
      // right after the damage is prevented, with the amount prevented; never with a choice to make.
      const preventedWay = i > 0 ? /^(?:For each 1 damage prevented this way|If damage is prevented this way), (.+)$/.exec(s) : null;
      if (preventedWay) {
        const last = out[out.length - 1];
        if ((last?.type !== 'prevent' && last?.type !== 'prevent_chosen_source') || last.then) return null;
        const pb = b.clone();
        pb.eventAmount = true;
        pb.named = { ...pb.named, "that source's controller": { ref: 'controller_of', of: { ref: 'trigger_object' } } };
        const before = pb.targets.length;
        let inner = parseSentence(capitalise(preventedWay[1]!), pb);
        if (inner && /^For each/.test(s)) inner = scaleBy(inner, { kind: 'event' });
        const SAFE = new Set(['create_token', 'deal_damage', 'gain_life', 'lose_life', 'draw', 'add_counters']);
        if (!inner || pb.targets.length !== before || pb.unsupported || !inner.every((e) => SAFE.has(e.type) && !e.copyOf)) return null;
        last.then = inner;
        continue;
      }
      // Moraug: "… there's an additional combat phase after this phase. At the beginning of that combat, untap all creatures
      // you control." — a delayed trigger for the beginning of that combat phase (CR 500.8, 603.7).
      const thatCombat = i > 0 ? /^At the beginning of that combat, (.+)$/.exec(s) : null;
      if (thatCombat) {
        const last = out[out.length - 1];
        if (last?.type !== 'extra_combat' || last.begin) return null;
        const inner = parseSentence(capitalise(thatCombat[1]!), b);
        if (!inner) return null;
        last.begin = inner;
        continue;
      }
      // Teferi's Time Twist: "Return that card to the battlefield … at the beginning of the next end step. If it enters as a
      // creature, it enters with an additional +1/+1 counter on it." — the return, with the counter if it's a creature.
      const asCreature = i > 0 ? /^If it enters as a creature, it enters with an additional (\S+) counter on it$/.exec(s) : null;
      if (asCreature) {
        const last = out[out.length - 1];
        const ret = last?.type === 'delayed' && (last.effects as EffectNode[]).length === 1 ? (last.effects as EffectNode[])[0] : last;
        if (ret?.type !== 'move' || ret.to !== 'battlefield' || ret.counters) return null;
        ret.counters = { [asCreature[1]!]: 1 };
        ret.countersIfCreature = true;
        continue;
      }
      const spendOnly = i > 0 ? /^Spend this mana only (.+)$/.exec(s) : null;
      if (spendOnly) {
        const last = out[out.length - 1] as AddManaEffect | undefined;
        const spend = last?.type === 'add_mana' ? parseManaSpend(spendOnly[1]!, b) : null;
        if (!spend) return null;
        last!.spend = spend;
        continue;
      }
      // "Put the rest on the bottom of your library in a random order. If you didn't put a card into your hand this
      // way, draw a card." — after a look at the top cards.
      const ifNone = /^If you didn't put (?:a|any) cards? (?:into your hand|onto the battlefield) this way, (.+)$/.exec(s);
      if (ifNone) {
        const last = out[out.length - 1];
        const inner = last?.type === 'dig' && !last.ifNone ? parseSentence(capitalise(ifNone[1]!), b) : null;
        if (!inner) return null;
        last!.ifNone = inner;
        continue;
      }
      // CR 702.32a (fading): "Remove a fade counter from it. If you can't, sacrifice it."
      const cant = /^If you can't, (.+)$/.exec(s);
      if (cant) {
        const last = out[out.length - 1];
        if (last?.type !== 'remove_counters' || last.counter === undefined) return null;
        const inner = parseSentence(capitalise(cant[1]!.replace(/\bthe permanent\b/, '~')), b);
        if (!inner) return null;
        last.ifCant = inner;
        continue;
      }
      // "Cumulative upkeep—Pay 1 life": "You may pay 1 life for each age counter on it. If you don't, sacrifice it."
      const lifeEach = /^(?:Then )?[Yy]ou may pay (\d+) life for each (.+)$/.exec(s);
      const dontLife = sentences[i + 1] ? /^If you don't, (.+)$/.exec(sentences[i + 1]!) : null;
      if (lifeEach && dontLife) {
        const times = parseForEach(lifeEach[2]!, b);
        const otherwise = times ? parseSentence(capitalise(dontLife[1]!), b) : null;
        if (!times || !otherwise) return null;
        out.push({ type: 'may_pay', cost: '', life: Number(lifeEach[1]), times, effects: [], else: otherwise });
        i++;
        continue;
      }
      // CR 702.24a (cumulative upkeep): "You may pay {1} for each age counter on it. If you don't, sacrifice it."
      const payEach = /^(?:Then )?[Yy]ou may pay ((?:\{(?:\d+|[WUBRGC])\})+) for each (.+)$/.exec(s);
      const dont = sentences[i + 1] ? /^If you don't, (.+)$/.exec(sentences[i + 1]!) : null;
      if (payEach && dont) {
        const times = parseForEach(payEach[2]!, b);
        const otherwise = times ? parseSentence(capitalise(dont[1]!), b) : null;
        if (!times || !otherwise) return null;
        out.push({ type: 'may_pay', cost: payEach[1]!, times, effects: [], else: otherwise });
        i++;
        continue;
      }
      // Isochron Scepter: "You may copy the exiled card. If you do, you may cast the copy without paying its mana cost."
      // (CR 707.12: a copy that isn't cast ceases to exist, so the two choices are one.)
      const copyCard = /^You may copy (the exiled card|that card)$/.exec(s);
      if (copyCard && /^If you do, you may cast the copy without paying its mana cost$/.test(sentences[i + 1] ?? '')) {
        const what = parseObjectRef(copyCard[1]!, b);
        if (!what || what.plural) return null;
        out.push({ type: 'cast_copy_of', what: what.ref });
        i++;
        continue;
      }
      // Raff, Weatherlight Stalwart: "you may tap two untapped creatures you control. If you do, draw a card." — only with that
      // many to tap (CR 118.12).
      // Tidal Terror: "you may tap two other untapped creatures you control".
      const tapN = /^You may tap (two|three|four|five) (other )?untapped (.+? you control)$/.exec(s);
      const tapNThen = tapN && sentences[i + 1] ? /^If you do, (.+)$/.exec(sentences[i + 1]!) : null;
      if (tapN && tapNThen) {
        const r = attempt(b, (b) => {
          const pf = parseFilter(tapN[3]!, b);
          if (!pf || !pf.plural || pf.filter.zone) return null;
          if (tapN[2]) pf.filter.other = true;
          const inner = parseSentence(capitalise(tapNThen[1]!), b);
          return inner ? [{ type: 'may_do', effects: [{ type: 'tap_choice', filter: pf.filter, amount: parseAmount(tapN[1]!) as number }], then: inner } as EffectNode] : null;
        });
        if (!r) return null;
        out.push(...r);
        i++;
        continue;
      }
      // Myr Battlesphere: "you may tap X untapped Myr you control. If you do, this creature gets +X/+0 until end of turn and
      // deals X damage to …" — X is how many were tapped.
      const tapX = /^You may tap X untapped (.+? you control)$/.exec(s);
      const tapThen = tapX && sentences[i + 1] ? /^If you do, (.+)$/.exec(sentences[i + 1]!) : null;
      if (tapX && tapThen) {
        const r = attempt(b, (b) => {
          const pf = parseFilter(tapX[1]!, b);
          if (!pf || !(pf.plural || pf.invariant) || pf.filter.zone) return null;
          const inner = parseSentence(capitalise(tapThen[1]!), b);
          return inner ? [{ type: 'tap_choice', filter: pf.filter } as EffectNode, ...bindX(inner, { kind: 'tapped_this_way' })] : null;
        });
        if (!r) return null;
        out.push(...r);
        i++;
        continue;
      }
      // CR 118.12: "You may sacrifice a creature. If you do, …" — the first part is done only if possible.
      const mayDo = /^You may (.+)$/.exec(s);
      // Bloodchief Ascension: "you may have that player lose 2 life. If you do, …" — what they do.
      const mayFirst = (t: string): EffectNode[] | null => {
        if (!/^have /.test(t)) return parseSentence(capitalise(t), b);
        const r = parseSentence(`You may ${t}`, b);
        return r?.length === 1 && r[0]!.type === 'may' ? (r[0]!.effects as EffectNode[]) : null;
      };
      // "You may put two +1/+1 counters on it. If you don't, create two 1/1 … Servo … tokens." (CR 702.123a)
      const youDont = sentences[i + 1] ? /^If you don't, (.+)$/.exec(sentences[i + 1]!) : null;
      if (mayDo && youDont && !/^pay /.test(mayDo[1]!)) {
        const first = mayFirst(mayDo[1]!);
        const otherwise = first ? parseSentence(capitalise(youDont[1]!), b) : null;
        if (!first || !otherwise) return null;
        out.push({ type: 'may_do', effects: first, then: [], else: otherwise });
        i++;
        continue;
      }
      // Forgotten Creation: "you may discard all the cards in your hand. If you do, draw that many cards." — a wheel.
      if (mayDo && then && /^discard all the cards in your hand$/.test(mayDo[1]!) && then[1] === 'draw that many cards') {
        out.push({ type: 'may', effects: [{ type: 'wheel', who: { ref: 'you' }, mode: 'all' }] });
        i++;
        continue;
      }
      if (mayDo && then) {
        const first = mayFirst(mayDo[1]!);
        // Cultivator Colossus: "If you do, draw a card and repeat this process." — the choice comes again (CR 608.2c).
        const repeat = / and repeat this process$/.exec(then[1]!);
        // Redcap Gutter-Dweller: "If you do, put a +1/+1 counter on this creature and exile the top card of your library. You
        // may play that card this turn." — an instruction that takes two sentences, both only if you did.
        let both = 0;
        let rest: EffectNode[] | null = null;
        if (first && !repeat && /\bexile the top /.test(then[1]!) && /^(?:You may (?:play|cast) (?:that card|it|them|those cards)|Until )/.test(sentences[i + 2] ?? '')) {
          rest = attempt(b, (b) => parseEffectText(`${capitalise(then[1]!)}. ${sentences[i + 2]}.`, b));
          if (rest) both = 1;
        }
        if (first && !rest) rest = parseSentence(capitalise(then[1]!.replace(/ and repeat this process$/, '')), b);
        // Astral Slide: "If you do, return that card to the battlefield … at the beginning of the next end step." — a delayed
        // trigger, made only if you did.
        if (first && !rest && !repeat && / at the beginning of the next end step$/.test(then[1]!)) rest = attempt(b, (b) => parseEffectText(`${capitalise(then[1]!)}.`, b));
        if (!first || !rest) return null;
        // Pippin's Bravery: "You may sacrifice a Food. If you do, target creature gets +4/+4 until end of turn. Otherwise,
        // that creature gets +2/+2 until end of turn." (CR 608.2c)
        const otherwiseNext = !both && !repeat ? /^Otherwise, (.+)$/.exec(sentences[i + 2] ?? '') : null;
        const elseFx = otherwiseNext ? parseSentence(capitalise(otherwiseNext[1]!), b) : null;
        if (otherwiseNext && !elseFx) return null;
        out.push({ type: 'may_do', effects: first, then: rest, ...(repeat ? { repeat: true } : {}), ...(elseFx ? { else: elseFx } : {}) });
        i += 1 + both + (elseFx ? 1 : 0);
        continue;
      }
      // Curses: "Create a Gold token. Each opponent attacking that player does the same." — each of
      // those players does it as if they were "you".
      const same = sentences[i + 1] ? /^Each opponent attacking (that player|enchanted player) does the same$/.exec(sentences[i + 1]!) : null;
      if (same) {
        const first = parseSentence(capitalise(s), b);
        const defender = first ? parsePlayerRef(same[1]!, b) : null;
        if (!first || !defender) return null;
        out.push(...first, { type: 'players_do', players: { ref: 'players', who: 'opponents', attacking: defender }, effects: structuredClone(first) });
        i++;
        continue;
      }
      // "That player may discard a card. If they do, they draw a card." — another player chooses.
      const theyMay = /^(.+?) may (.+)$/.exec(s);
      const theyDo = sentences[i + 1] ? /^If (?:they do|the player does|that player does|they don't|the player doesn't|that player doesn't), (.+)$/.exec(sentences[i + 1]!) : null;
      // Smothering Tithe: "that player may pay {2}. If the player doesn't, you create a Treasure token." (CR 118.12)
      const theyPay = theyMay && theyDo && /n't, /.test(sentences[i + 1]!) ? /^pay ((?:\{(?:\d+|[WUBRGC])\})+)$/.exec(theyMay[2]!) : null;
      if (theyPay) {
        const payer = singlePlayer(theyMay![1]!, b) ?? parsePlayerRef(theyMay![1]!, b);
        const rest = payer ? parseSentence(capitalise(theyDo![1]!), b) : null;
        if (!payer || !rest) return null;
        out.push({ type: 'unless_pays', payer, cost: theyPay[1]!, effects: rest });
        i++;
        continue;
      }
      if (theyMay && theyDo && !/^You$/.test(theyMay[1]!)) {
        const who = singlePlayer(theyMay[1]!, b);
        // Combustible Gearhulk: "target opponent may have you draw three cards" — they choose, you do it.
        const haveYou = /^have you (.+)$/.exec(theyMay[2]!);
        const first = who
          ? attempt(b, (b) => {
              if (!haveYou) return parseClause(theyMay[2]!, b, who);
              const effects = parseSentence(`You ${haveYou[1]!}`, b);
              return effects ? { effects } : null;
            })
          : null;
        const rest = first ? parseSentence(capitalise(theyDo[1]!), b) : null;
        if (!who || !first || !rest) return null;
        const declined = /n't, /.test(sentences[i + 1]!);
        out.push({ type: 'may_do', who, effects: first.effects, ...(declined ? { else: rest, then: [] } : { then: rest }) });
        i++;
        continue;
      }
      // CR 700.3: Fact or Fiction — "Reveal the top five cards of your library. An opponent separates those cards into two
      // piles. Put one pile into your hand and the other into your graveyard."; Steam Augury — "Reveal the top five cards
      // of your library and separate them into two piles. An opponent chooses one of those piles. Put that pile into your
      // hand and the other into your graveyard."
      const pileTop = /^Reveal the top (\w+|X plus one) cards of your library( and separate them into two piles)?$/.exec(s);
      if (pileTop) {
        const theySeparate = !pileTop[2] && sentences[i + 1] === 'An opponent separates those cards into two piles';
        const theyChoose = Boolean(pileTop[2]) && sentences[i + 1] === 'An opponent chooses one of those piles';
        const put = sentences[i + 2] ? /^Put (one|that) pile into your hand and the other (into your graveyard|on the bottom of your library in any order)$/.exec(sentences[i + 2]!) : null;
        const amount = pileTop[1] === 'X plus one' ? { kind: 'x' as const, plus: 1 } : parseAmount(pileTop[1]!);
        if ((theySeparate || theyChoose) && put && amount !== null && (put[1] === 'one') === theySeparate) {
          out.push({ type: 'piles', amount, separator: theySeparate ? 'opponent' : 'you', chooser: theySeparate ? 'you' : 'opponent', other: put[2] === 'into your graveyard' ? 'graveyard' : 'bottom' });
          i += 2;
          continue;
        }
      }
      // "Look at the top five cards of your library. You may reveal a creature card from among them and put it
      // into your hand. Put the rest on the bottom of your library in a random order." — and its relatives.
      // "Look at the top three cards of your library, then put one of those cards into your hand and the rest …"
      // Fomori Vault: "Look at the top X cards of your library, where X is the number of artifacts you control."
      const bindDig = (dig: { node: EffectNode } | null, where: string | undefined): boolean => {
        if (!dig || !where) return Boolean(dig);
        const expr = dig.node.amount === 'X' ? parseCount(where.replace(/ as this (?:ability|spell) resolves$/, ''), b) : null;
        if (!expr) return false;
        // Hatchery Spider: "… where X is …. You may put a green permanent card with mana value X or less …" — the same X.
        Object.assign(dig.node, bindX([dig.node], expr)[0]);
        return true;
      };
      const lookThen = /^([Ll]ook at|[Rr]eveal) the top (\w+) cards of your library(?:, where X is ([^,]+))?, then (put (?!them back).+)$/.exec(s);
      if (lookThen) {
        const dig = parseDig(lookThen[2]!, capitalise(lookThen[4]!), sentences[i + 1], b);
        if (!dig || !bindDig(dig, lookThen[3])) return null;
        if (/^[Rr]eveal/.test(lookThen[1]!)) dig.node.reveal = true;
        out.push(dig.node);
        i += dig.used - 1;
        continue;
      }
      // Gishath: "reveal that many cards from the top of your library" — the damage dealt.
      const thatMany = b.eventAmount ? /^([Ll]ook at|[Rr]eveal) that many cards from the top of your library$/.exec(s) : null;
      const look = thatMany ? [s, thatMany[1]!, 'X', undefined] : /^([Ll]ook at|[Rr]eveal) the top (\w+) cards of your library(?:, where X is (.+))?$/.exec(s);
      if (look && sentences[i + 1]) {
        const dig = parseDig(look[2]!, sentences[i + 1]!, sentences[i + 2], b, sentences[i + 3]);
        if (!dig || !bindDig(dig, look[3])) return null;
        if (thatMany) Object.assign(dig.node, bindX([dig.node], { kind: 'event' })[0]);
        // Revealed: everyone sees the cards (CR 701.20a).
        if (/^[Rr]eveal/.test(look[1]!)) dig.node.reveal = true;
        // Turntimber Symbiosis: "that card" afterwards is the one put onto the battlefield.
        if (dig.node.to === 'battlefield' && dig.node.take === 1) b.named = { ...b.named, 'that card': { ref: 'created' } };
        out.push(dig.node);
        i += dig.used;
        continue;
      }
      // Dark Confidant: "Reveal the top card of your library and put that card into your hand. You lose life equal to its
      // mana value." (Augury Adept: "You gain life equal to …")
      if (/^[Rr]eveal the top card of your library and put (?:that card|it) into your hand$/.test(s)) {
        const life = sentences[i + 1] ? /^You (lose|gain) life equal to its mana value$/.exec(sentences[i + 1]!) : null;
        out.push({ type: 'reveal_top', ...(life ? { life: life[1] } : {}) });
        if (life) i += 1;
        // Yuriko: "Each opponent loses life equal to that card's mana value." — the card put into your hand.
        b.it = { ref: 'created' };
        continue;
      }
      // "Look at the top card of your library. If it's a land card, you may put it onto the battlefield tapped.
      // (Otherwise, put it into your hand.)" — one card, maybe taken.
      // Thrasios: "Scry 1, then reveal the top card of your library."
      const thenTop = /^(.+?), then ((?:look at|reveal) the top card of your library)$/.exec(s);
      const topFirstFx = thenTop ? attempt(b, (b) => parseSentence(capitalise(thenTop[1]!), b)) : null;
      const topCard = /^([Ll]ook at|[Rr]eveal) the top card of your library$/.exec(thenTop && topFirstFx ? capitalise(thenTop[2]!) : s);
      // Herald's Horn: "If it's a creature card of the chosen type, you may reveal it and put it into your hand."
      // Momir Vig: "If it's a creature card, put that card into your hand."
      const ifIts = topCard && sentences[i + 1] ? /^If it's (?:a|an) (.+?) card(?: of the chosen type)?, (you may )?(?:reveal it and )?put (?:it|that card) (onto the battlefield( tapped)?|into your hand|into your graveyard)$/.exec(sentences[i + 1]!) : null;
      const ofChosen = Boolean(ifIts && / card of the chosen type, /.test(sentences[i + 1]!));
      // Chaos Warp: "The owner of target permanent shuffles it into their library, then reveals the top card of their
      // library. If it's a permanent card, they put it onto the battlefield."
      const warp = /^(.+?), then reveals the top card of their library$/.exec(s);
      const warpThen = warp && sentences[i + 1] ? /^If it's (?:a|an) (.+?) card, they put it onto the battlefield$/.exec(sentences[i + 1]!) : null;
      if (warp && warpThen) {
        const r = attempt(b, (b) => {
          const first = parseSentence(warp[1]!, b);
          const shuffled = first?.length === 1 && first[0]!.type === 'move' && first[0]!.position === 'shuffle' ? (first[0]!.what as Ref) : null;
          const pf = shuffled ? parseFilter(`${warpThen[1]} card in your library`, b) : null;
          if (!first || !shuffled || !pf) return null;
          const { zone: _z, owner: _o, ...filter } = pf.filter;
          return [...first, { type: 'dig', amount: 1, take: 1, to: 'battlefield', filter, rest: 'top', reveal: true, who: { ref: 'owner_of', of: shuffled } }];
        });
        if (!r) return null;
        out.push(...r);
        i += 1;
        continue;
      }
      // Jace, the Mind Sculptor: "Look at the top card of target player's library. You may put that card on the bottom of that
      // player's library." — kept on top, or not (the controller decides).
      const theirTop = /^Look at the top card of (target player|target opponent)'s library$/.exec(s);
      if (theirTop && sentences[i + 1] && /^You may put that card on the bottom of (?:that player's|their) library$/.test(sentences[i + 1]!)) {
        const r = attempt(b, (b) => {
          const who = parsePlayerRef(theirTop[1]!, b);
          return who ? [{ type: 'dig', amount: 1, take: 1, to: 'top', rest: 'bottom', optional: true, who, chooser: 'you' } as EffectNode] : null;
        });
        if (!r) return null;
        out.push(...r);
        i += 1;
        continue;
      }
      // "Look at the top card of your library. You may put that card into your graveyard." (a one-card surveil)
      const mayPut = topCard && sentences[i + 1] ? /^You may put (?:that card|it) (into your graveyard|into your hand)$/.exec(sentences[i + 1]!) : null;
      if (topCard && mayPut) {
        out.push(...(topFirstFx ?? []), { type: 'dig', amount: 1, take: 1, to: mayPut[1] === 'into your hand' ? 'hand' : 'graveyard', rest: 'top', optional: true, ...(/^[Rr]eveal/.test(topCard[1]!) ? { reveal: true } : {}) });
        i += 1;
        continue;
      }
      if (topCard && ifIts) {
        const pf = parseFilter(`${ifIts[1]} card in your library`, b);
        if (!pf) return null;
        const { zone: _z, owner: _o, ...filter } = pf.filter;
        if (ofChosen) filter.chosenType = true;
        const otherwise = sentences[i + 2] ? /^(?:Otherwise|If you don't put the card (?:onto the battlefield|into your hand)), put (?:it|that card) (into your hand|into your graveyard|on the bottom of your library)$/.exec(sentences[i + 2]!) : null;
        // Thrasios: "Otherwise, draw a card." (the card stays on top); Nylea, Keen-Eyed: "Otherwise, you may put it into
        // your graveyard." — what happens when the card wasn't taken.
        const otherwiseDraw = !otherwise && sentences[i + 2] ? /^Otherwise, draw a card$/.test(sentences[i + 2]!) : false;
        const otherwiseMay = !otherwise && sentences[i + 2] ? /^Otherwise, you may put (?:it|that card) into your graveyard$/.test(sentences[i + 2]!) : false;
        // Lurking Predators: "Otherwise, you may put that card on the bottom of your library." — keep it on top, or not.
        const otherwiseBottom = !otherwise && sentences[i + 2] ? /^Otherwise, you may put (?:it|that card) on the bottom of your library$/.test(sentences[i + 2]!) : false;
        // Aid from the Cowl: "… you may put it onto the battlefield. Otherwise, …" — a permanent card left on top isn't
        // "otherwise".
        if (otherwiseBottom && ifIts[2]) return null;
        const to = ifIts[3]!.startsWith('onto') ? 'battlefield' : ifIts[3] === 'into your hand' ? 'hand' : 'graveyard';
        const rest = otherwise ? (otherwise[1] === 'into your hand' ? 'hand' : otherwise[1] === 'into your graveyard' ? 'graveyard' : 'bottom') : 'top';
        const ifNone: EffectNode[] | null = otherwiseDraw
          ? [{ type: 'draw', amount: 1, who: { ref: 'you' } }]
          : otherwiseMay
            ? [{ type: 'dig', amount: 1, take: 1, to: 'graveyard', rest: 'top', optional: true }]
            : otherwiseBottom
              ? [{ type: 'dig', amount: 1, take: 1, to: 'top', rest: 'bottom', optional: true }]
              : null;
        out.push(...(topFirstFx ?? []), { type: 'dig', amount: 1, take: 1, to, filter, rest, ...(ifIts[2] ? { optional: true } : {}), ...(ifIts[4] ? { tapped: true } : {}), ...(/^[Rr]eveal/.test(topCard[1]!) ? { reveal: true } : {}), ...(ifNone ? { ifNone } : {}) });
        i += otherwise || ifNone ? 2 : 1;
        continue;
      }
      // CR 701.20a: "Target opponent reveals their hand. You choose a nonland card from it. That player discards
      // that card." — the chosen card is discarded (or exiled).
      const reveals = /^(.+?) reveals (?:their|his or her) hand$/.exec(s);
      const chooses = reveals && sentences[i + 1] ? /^You (may )?choose (a|an|one|two) (.+?) from it(?: with mana value (\d+) or (less|greater))?(?: and (exile|discard) (?:that card|it))?$/.exec(sentences[i + 1]!) : null;
      if (reveals && chooses) {
        const r = attempt(b, (b) => {
          const who = parsePlayerRef(reveals[1]!, b);
          const amount = parseAmount(chooses[2]!);
          const pf = who && typeof amount === 'number' ? parseFilter(`${chooses[3]} in your hand`, b) : null;
          if (!who || !pf || typeof amount !== 'number' || pf.plural !== amount > 1) return null;
          const { zone: _z, owner: _o, ...filter } = pf.filter;
          if (chooses[4]) filter.manaValue = { op: chooses[5] === 'less' ? 'le' : 'ge', n: Number(chooses[4]) };
          let then = chooses[6] === 'exile' ? 'exile' : chooses[6] === 'discard' ? 'discard' : null;
          let used = 2;
          if (!then) {
            const next = sentences[i + 2] ?? '';
            // Severance Priest: "You may choose a nonland card from it. If you do, exile that card."
            const ifDo = chooses[1] ? /^If you do, (.+)$/.exec(next)?.[1] : undefined;
            const act = ifDo !== undefined ? capitalise(ifDo) : next;
            if (/^(?:That player|They|The player) discards? (?:that card|it|those cards)$/.test(act)) then = 'discard';
            else if (/^(?:Exile that card|That player exiles that card|Exile it)$/.test(act)) then = 'exile';
            else return null;
            // "… If you don't, …" would need to know which happened.
            if (ifDo !== undefined && /^If you don't, /.test(sentences[i + 3] ?? '')) return null;
            used = 3;
          }
          return { node: { type: 'choose_from_hand', who, filter, amount, then, revealHand: true, ...(chooses[1] ? { optional: true } : {}) } as EffectNode, used };
        });
        if (!r) return null;
        out.push(r.node);
        i += r.used - 1;
        continue;
      }
      // "Add {B}{B}{B}{B}{B} instead if there are seven or more cards in your graveyard." — the same as "If …, … instead".
      const insteadIf = i > 0 ? /^(.+) instead if (.+)$/.exec(s) : null;
      if (insteadIf) s = `If ${insteadIf[2]}, ${insteadIf[1]!.replace(/^\w/, (c) => c.toLowerCase())} instead`;
      // Tribute to the World Tree: "draw a card if its power is 3 or greater. Otherwise, put two +1/+1 counters on it."
      const trailingIf = sentences[i + 1] && /^Otherwise, /.test(sentences[i + 1]!) && !/^If /.test(s) ? /^(.+?) if ([^,]+)$/.exec(s) : null;
      if (trailingIf && parseCondition(trailingIf[2]!, b.clone())) s = `If ${trailingIf[2]}, ${trailingIf[1]!.replace(/^\w/, (c) => c.toLowerCase())}`;
      // Selvala: "its controller may draw a card if its power is greater than each other creature's power." — checked as it
      // resolves, the same as "If …, …" (when the sentence doesn't read as it is).
      // The condition is read after the effect, so "you may destroy target creature if it's tapped" means that creature.
      const lastIf = !trailingIf && !/^If /.test(s) && !/ instead$/.test(s) ? /^(.+?) if ([^,]+)$/.exec(s) : null;
      if (lastIf && !/^(?:able|you do|you don't|they do|they don't|that player does|that player doesn't)$/.test(lastIf[2]!) && !parseSentence(s, b.clone())) {
        const guarded = attempt(b, (b) => {
          const effects = parseSentence(lastIf[1]!, b);
          const cond = effects ? parseCondition(lastIf[2]!, b) : null;
          return effects && cond ? [{ type: 'if', cond, effects } as EffectNode] : null;
        });
        if (guarded) {
          out.push(...guarded);
          previous = guarded;
          continue;
        }
      }
      // Sunpearl Kirin: "return up to one other target nonland permanent you control to its owner's hand. If it was a token,
      // draw a card." — what was returned, as it last was (a token ceases to exist in the hand, CR 111.8).
      const wasToken = /^If it was a token, (.+)$/.exec(s);
      const bounced = out[out.length - 1];
      if (wasToken && bounced?.type === 'move' && bounced.to === 'hand' && (bounced.what as Ref | undefined)?.ref === 'target') {
        const then = parseSentence(capitalise(wasToken[1]!), b);
        if (!then) return null;
        out.push({ type: 'if', cond: { type: 'amount', amount: { kind: 'moved_this_way', how: 'returned', token: true }, op: 'ge', n: 1 } as ConditionNode, effects: then });
        continue;
      }
      // "If it's a Spirit, …" after the object was destroyed, exiled or bounced would ask about a card that has left: not
      // read here.
      const MOVES = new Set(['destroy', 'exile', 'move', 'sacrifice', 'bounce', 'return', 'flicker', 'put_into_library', 'shuffle_into_library']);
      // Essence Flux: "Exile target creature you control, then return that card to the battlefield …. If it's a Spirit, …" —
      // back on the battlefield, it's the permanent it became (followed by the resolution, CR 400.7).
      const lastMove = [...out].reverse().find((e) => MOVES.has(e.type));
      // Currency Converter: "Put a card exiled with this artifact into its owner's graveyard. If it's a land card, …" — the
      // card chosen as it resolves, followed to the graveyard.
      const backOnField =
        lastMove?.type === 'move' &&
        JSON.stringify(lastMove.what) === JSON.stringify(b.it) &&
        (lastMove.to === 'battlefield' || (b.it?.ref === 'chosen_object' && (lastMove.to === 'graveyard' || lastMove.to === 'exile')) ||
          // Cemetery Recruitment: "Return target creature card from your graveyard to your hand. If it's a Zombie card, …" — the
          // card in the hand it went to.
          (lastMove.to === 'hand' && b.it?.ref === 'target' && /^If it's an? [A-Z][\w-]* card, /.test(s)));
      if (/^If (?:it|that creature|that permanent)(?:'s| is) an? /.test(s) && !backOnField && JSON.stringify(out).match(/"type":"(\w+)"/g)?.some((m) => MOVES.has(m.slice(8, -1)))) return null;
      // "If [condition], [effect]." with an optional "Otherwise, [effect]." (CR 608.2c).
      // Splash Portal: "If that creature is a Bird, Frog, Otter, or Rat, draw a card." — a list in the condition.
      const listed = /^If ([^,]+(?:, [A-Z][\w-]*)+,? or [A-Z][\w-]*), (.+)$/.exec(s);
      const listCond = listed ? parseCondition(listed[1]!, b.clone()) : null;
      const iff = listed && listCond ? listed : /^If ([^,]+), (.+)$/.exec(s);
      const cond = iff && !/^If you do\b/.test(s) ? parseCondition(iff[1]!, b) : null;
      // "If this spell was kicked, that creature gets -5/-5 until end of turn instead." — the earlier
      // sentence's effect, replaced when the condition holds.
      const instead = iff && cond && (/ instead$/.test(iff[2]!) || /^search your library for .+ instead of one$/.test(iff[2]!)) && !/would/.test(iff[2]!) ? iff[2]!.replace(/ instead$/, '') : null;
      // Emiel the Blessed: "you may pay {G/W}. If you do, put a +1/+1 counter on it. If it's a Unicorn, put two +1/+1 counters
      // on it instead." — what "if you do" does.
      const doNode = out[out.length - 1];
      const insideDo = !previous.length && (doNode?.type === 'may_pay' || doNode?.type === 'may') && Array.isArray(doNode.effects) && (doNode.effects as EffectNode[]).length ? (doNode.effects as EffectNode[]) : null;
      if (instead && insideDo) previous = [...insideDo];
      const nestIf = instead && !insideDo && !previous.length && ifBefore && out[out.length - 1] === ifBefore ? ifBefore : null;
      if (nestIf) previous = [...nestIf.effects];
      const container = nestIf ? nestIf.effects : insideDo && instead ? insideDo : out;
      if (instead && previous.length) {
        // New targets would be chosen whether or not the condition holds (Tear Asunder's kicker picks
        // different targets): not this shape.
        const targetsBefore = b.targets.length;
        // Delayed Blast Fireball: "it deals 5 damage to each opponent and each creature they control instead" — the spell,
        // as in the sentence before.
        const spellDeals = /^it deals /.test(instead) && previous.every((x) => x.type === 'deal_damage' && !x.from);
        let yes = parseSentence(capitalise(spellDeals ? instead.replace(/^it deals /, '~ deals ') : instead), b);
        if (b.targets.length !== targetsBefore) return null;
        // "If this spell was kicked, it deals 5 damage instead." — the same damage, a new amount.
        // "…, it deals 4 damage to that creature instead." names the same recipient.
        const more = /^(?:it|~) deals (\S+) damage(?: to (?:that creature|that permanent|that player|it|them|each of them))?$/i.exec(instead);
        const n = more ? parseAmount(more[1]!) : null;
        if (!yes && n !== null && previous.every((x) => x.type === 'deal_damage')) yes = previous.map((x) => ({ ...structuredClone(x), amount: n }));
        // Rite of Replication: "If this spell was kicked, create five of those tokens instead." — the same tokens, more of them.
        // The Final Days: "If this spell was cast from a graveyard, instead create X of those tokens, where X is the number of
        // creature cards in your graveyard."
        const moreTokens = /^create (\w+) of those tokens(?:, where X is (.+))?$/.exec(instead);
        const tokenCount = !moreTokens ? null : moreTokens[2] ? (moreTokens[1] === 'X' ? parseCount(moreTokens[2], b.clone()) : null) : parseAmount(moreTokens[1]!);
        if (!yes && tokenCount !== null && previous.length === 1 && previous[0]!.type === 'create_token') yes = [{ ...structuredClone(previous[0]!), amount: tokenCount }];
        // Reclaim the Wastes: "If this spell was kicked, search your library for two basic land cards instead of one." — the
        // same search, for more cards.
        const moreSearch = /^search your library for (two|three) (.+) cards instead of one$/.exec(instead);
        if (!yes && moreSearch && previous.length === 1 && previous[0]!.type === 'search' && previous[0]!.amount === 1) {
          const pf = parseFilter(`${moreSearch[2]} cards in your library`, b.clone());
          if (pf && JSON.stringify(pf.filter) === JSON.stringify(previous[0]!.filter)) yes = [{ ...structuredClone(previous[0]!), amount: moreSearch[1] === 'two' ? 2 : 3 }];
        }
        // Increasing Confusion: "If this spell was cast from a graveyard, that player mills twice that many cards instead."
        if (!yes && /^(?:that player|they|you) mills? twice that many cards$/.test(instead) && previous.length === 1 && previous[0]!.type === 'mill') {
          const was = previous[0]!;
          const amt = was.amount;
          const doubled = typeof amt === 'number' ? amt * 2 : amt === 'X' ? { kind: 'x', times: 2 } : amt && typeof amt === 'object' && (amt as { times?: number }).times === undefined ? { ...(amt as object), times: 2 } : null;
          if (doubled !== null) yes = [{ ...structuredClone(was), amount: doubled as never }];
        }
        if (!yes) return null;
        // Behind the Mask: "… becomes an artifact creature with base power and toughness 4/3. If evidence was collected, it
        // has base power and toughness 1/1 until end of turn instead." — only the numbers are replaced; it still becomes one.
        if (previous.length === 1 && yes.length === 1 && previous[0]!.type === 'modify' && yes[0]!.type === 'modify' && previous[0]!.types && !yes[0]!.types) {
          const was = previous[0]!;
          if (JSON.stringify(was.what) !== JSON.stringify(yes[0]!.what)) return null;
          yes = [{ ...structuredClone(yes[0]!), types: was.types, subtypes: was.subtypes, ...(was.retainTypes ? { retainTypes: true } : {}) }];
        }
        const replaced = container.splice(container.length - previous.length, previous.length);
        container.push({ type: 'if', cond: cond!, effects: yes, else: replaced });
        previous = [];
        continue;
      }
      if (iff && cond) {
        // Wedding Announcement: "create a 1/1 … token. Then if this enchantment has three or more invitation counters on
        // it, transform it." — "it" is what the condition is about, not the token.
        if (/^(?:this (?:enchantment|artifact|creature|permanent|land)|~) (?:has|is) /.test(iff[1]!) && JSON.stringify((cond as { of?: Ref }).of) === '{"ref":"self"}') b.it = { ref: 'self' };
        // Taborax: "If that creature was a Cleric, you may draw a card. If you do, you lose 1 life." — both under the condition.
        if (/^you may /.test(iff[2]!) && /^If you do, /.test(sentences[i + 1] ?? '')) {
          const both = attempt(b, (b) => parseEffectText(`${capitalise(iff[2]!)}. ${sentences[i + 1]}.`, b));
          if (both) {
            out.push({ type: 'if', cond, effects: both });
            i++;
            continue;
          }
        }
        let yes = parseSentence(capitalise(iff[2]!), b);
        // Nissa, Resurgent Animist: "Then if this is the second time …, reveal cards from the top of your library until you
        // reveal an Elf or Elemental card. Put that card into your hand and the rest on the bottom …" — an instruction that
        // takes two sentences, both under the condition.
        // Frenetic Sliver: "If you win the flip, exile this permanent and return it to the battlefield … at the beginning of
        // the next end step." — a sentence only the paragraph rules read (a delayed return).
        if (!yes) yes = attempt(b, (b) => parseEffectText(`${capitalise(iff[2]!)}.`, b));
        if (!yes && sentences[i + 1] && !/^(?:Otherwise|If|Then) /.test(sentences[i + 1]!)) {
          const both = attempt(b, (b) => parseEffectText(`${capitalise(iff[2]!)}. ${sentences[i + 1]}.`, b));
          if (both) {
            out.push({ type: 'if', cond, effects: both });
            i++;
            continue;
          }
        }
        if (!yes) return null;
        // Cemetery Recruitment: the condition is about the card just returned to a hand.
        if (cond.type === 'is' && lastMove?.type === 'move' && lastMove.to === 'hand' && JSON.stringify((cond as { of?: Ref }).of) === JSON.stringify(lastMove.what) && /^If it's an? [A-Z][\w-]* card, /.test(s)) (cond as { toHand?: true }).toHand = true;
        // Currency Converter: "If it's a land card, create a Treasure token. If it's a nonland card, …" — the next "it" is
        // still the card the condition was about, not the token.
        if (cond.type === 'is' && b.it && JSON.stringify((cond as { of?: Ref }).of) === JSON.stringify({ ref: 'chosen_object' })) b.it = { ref: 'chosen_object' };
        const node: EffectNode = { type: 'if', cond, effects: yes };
        const otherwise = sentences[i + 1] ? /^Otherwise, (.+)$/.exec(sentences[i + 1]!) : null;
        if (otherwise) {
          const no = parseSentence(capitalise(otherwise[1]!), b);
          if (!no) return null;
          node.else = no;
          i++;
        } else prevIf = node as EffectNode & { effects: EffectNode[] };
        out.push(node);
        continue;
      }
      // Court of Ardenvale: "return target permanent card … to your hand. If you're the monarch, return that permanent card
      // to the battlefield instead."; Emeria Shepherd: "you may return … to your hand. If that land is a Plains, you may
      // return that nonland permanent card to the battlefield instead."
      const fieldInstead = /^If (.+?), (you may )?return (?:that (?:nonland )?(?:permanent )?card|that creature card|it) to the battlefield instead$/.exec(sentences[i + 1] ?? '');
      if (fieldInstead) {
        const r = attempt(b, (b) => {
          // "that land" — the trigger's, before the sentence names a card.
          const cond = parseCondition(fieldInstead[1]!, b.clone());
          const here = cond ? parseSentence(s, b) : null;
          const inner = here?.length === 1 && here[0]!.type === 'may' ? (here[0]!.effects as EffectNode[]) : here;
          const move = inner?.length === 1 && inner[0]!.type === 'move' && inner[0]!.to === 'hand' ? inner[0]! : null;
          if (!here || !move || !cond || (here[0]!.type === 'may') !== Boolean(fieldInstead[2])) return null;
          const onto: EffectNode = { type: 'move', what: move.what, to: 'battlefield' };
          return [{ type: 'if', cond, effects: fieldInstead[2] ? [{ type: 'may_do', effects: [onto], then: [], else: here }] : [onto], else: here } as EffectNode];
        });
        if (r) {
          out.push(...r);
          i++;
          continue;
        }
      }
      // Impulse draw: "Exile the top card of your library. Until the end of your next turn, you may play that card."
      // Ragavan: "create a Treasure token and exile the top card of that player's library. Until end of turn, you may
      // cast that card." — from another player's library too; the permission is yours.
      // Urza, Lord High Artificer: "Shuffle your library, then exile the top card." — of your library.
      // Fallen Shinobi: "that player exiles the top two cards of their library. Until end of turn, you may play those cards
      // …" — the same as exiling the top two cards of that player's library.
      const theyExile = /^(that player|target player|target opponent|defending player|each opponent|each player) exiles the top (card|\w+ cards) of their library$/i.exec(s);
      const sTop = theyExile && /you may (?:play|cast) /i.test(sentences[i + 1] ?? '') ? `Exile the top ${theyExile[2]} of ${theyExile[1]!.toLowerCase()}'s library` : s;
      // Dream Pillager: "exile that many cards from the top of your library" — how much damage the trigger event was.
      const topThatMany = b.eventAmount ? /^[Ee]xile that many cards from the top of your library$/.test(sTop) : false;
      const topAny = /^(?:(.+?)(?: and|, then) )?[Ee]xile the top (card|(\w+) cards)(?: of (your|that player's|target opponent's|target player's|defending player's|each opponent's|each player's) library)?$/.exec(topThatMany ? 'Exile the top that cards of your library' : sTop);
      if (topAny && !topAny[4]) topAny[4] = 'your';
      const top = topAny ? [topAny[0], topAny[2], topAny[3]] as const : null;
      let topWho: Ref | null = topAny && topAny[4] !== 'your' ? null : { ref: 'you' };
      let topFirst: EffectNode[] = [];
      if (topAny && (topAny[1] || topAny[4] !== 'your') && /you may (?:play|cast) /i.test(sentences[i + 1] ?? '')) {
        const r = attempt(b, (b) => {
          const first = topAny[1] ? parseSentence(capitalise(topAny[1]), b) : [];
          const who =
            topAny[4] === 'your'
              ? { ref: 'you' as const }
              : topAny[4] === "each opponent's" || topAny[4] === "each player's"
                ? { ref: 'players' as const, who: topAny[4] === "each player's" ? ('each' as const) : ('opponents' as const) }
                : parsePlayerRef(topAny[4]!.replace(/'s$/, ''), b);
          return first && who ? { first, who } : null;
        });
        topWho = r?.who ?? null;
        topFirst = r?.first ?? [];
      }
      const next = sentences[i + 1] ?? '';
      const duringNext = /^During your next turn, you may (play|cast) (?:that card|those cards|them|it)$/.exec(next);
      if (top && duringNext) {
        const amount = top[2] ? parseAmount(top[2]) : 1;
        if (amount === null) return null;
        if (!topWho) return null;
        out.push(...topFirst, { type: 'exile_top', amount, who: topWho, play: { mode: duringNext[1], until: 'during_next_turn', ...anyColor(i + 1) } });
        i++;
        continue;
      }
      // Chandra, Torch of Defiance: "Exile the top card of your library. You may cast that card. If you don't, …" — cast now,
      // paying its costs (CR 608.2g).
      const castNow = top && !top[2] && topWho?.ref === 'you' && !topFirst.length ? /^You may cast (?:that card|it)$/.exec(next) : null;
      if (castNow) {
        const dont = sentences[i + 2] ? /^If you don't, (.+)$/.exec(sentences[i + 2]!) : null;
        const no = dont ? parseSentence(capitalise(dont[1]!), b) : null;
        if (dont && !no) return null;
        out.push({ type: 'exile_top', amount: 1, who: { ref: 'you' } }, { type: 'cast_paid', what: { ref: 'created' }, ...(no ? { else: no } : {}) });
        i += dont ? 2 : 1;
        continue;
      }
      // CR 118.9: "Until end of turn, you may play that card without paying its mana cost."
      const freeSuffix = / without paying (?:its|their) mana costs?$/;
      const free = freeSuffix.test(next);
      const untilPlay =
        /^Until (end of turn|the end of your next turn|your next end step), you may (play|cast) (?:that card|those cards|them|it)$/.exec(next.replace(freeSuffix, '')) ??
        /^Until (end of turn|the end of your next turn), you may (cast) spells from among (?:them|those cards|those exiled cards)$/.exec(next) ??
        /^Until (end of turn|the end of your next turn), you may (play) lands and cast spells from among (?:them|those cards)$/.exec(next);
      // Cunning Rhetoric: "You may play that card for as long as it remains exiled" — until it leaves exile (CR 400.7).
      const thisTurn = /^You may (play|cast) (?:that card|those cards|them|it|cards exiled this way) (this turn|until the end of your next turn|until end of turn|until your next end step|for as long as (?:it remains|they remain) exiled)$/.exec(next.replace(freeSuffix, ''));
      if (top && (untilPlay || thisTurn)) {
        const amount = topThatMany ? { kind: 'event' as const } : top[2] ? parseAmount(top[2]) : 1;
        if (amount === null) return null;
        // Wiccan, Inti: "until your next end step" — it ends as that step begins (this turn's, if it's still to come).
        const until = untilPlay
          ? untilPlay[1] === 'your next end step'
            ? 'next_end_step'
            : untilPlay[1] !== 'end of turn'
              ? 'next_turn'
              : 'eot'
          : thisTurn![2] === 'until the end of your next turn'
            ? 'next_turn'
            : thisTurn![2] === 'until your next end step'
              ? 'next_end_step'
              : /^for as long as/.test(thisTurn![2]!)
                ? 'exiled'
                : 'eot';
        const mode = (untilPlay ? untilPlay[2] : thisTurn![1]) as 'play' | 'cast';
        if (!topWho) return null;
        out.push(...topFirst, { type: 'exile_top', amount, who: topWho, play: { mode, until, ...(free ? { free: true } : {}), ...anyColor(i + 1) } });
        i++;
        continue;
      }
      // Twinflame: "Choose any number of target creatures you control. For each of them, create a token that's a copy of
      // that creature, except it has haste." — a copy of each (CR 707.2).
      const chooseMany = /^Choose (any number of target .+)$/.exec(s);
      const copyEach = chooseMany ? /^For each of them, create a token that's a copy of that creature((?:, except .+)?)$/.exec(next) : null;
      if (chooseMany && copyEach) {
        const what = parseObjectRef(chooseMany[1]!, b);
        const made = what?.plural && what.targeted ? parseSentence(`Create a token that's a copy of ~${copyEach[1]}`, b) : null;
        const node = made?.length === 1 && made[0]!.type === 'create_token' && (made[0]!.copyOf as Ref | undefined)?.ref === 'self' ? made[0]! : null;
        if (!node) return null;
        out.push({ ...node, copyOf: what!.ref, copyEach: true });
        i++;
        continue;
      }
      // Solidarity of Heroes: "Choose any number of target creatures. Double the number of +1/+1 counters on each of them." —
      // "them" being those targets.
      if (chooseMany && /\b(?:each of them|them)\b/.test(next)) {
        const r = attempt(b, (b) => {
          const what = parseObjectRef(chooseMany[1]!, b);
          if (!what?.plural || !what.targeted) return null;
          b.named['each of them'] = what.ref;
          b.named['them'] = what.ref;
          const made = parseSentence(next, b);
          return made && JSON.stringify(made).includes(JSON.stringify(what.ref)) ? made : null;
        });
        if (r) {
          out.push(...r);
          i++;
          continue;
        }
      }
      // Hurl Through Hell: "Exile target creature. Until the end of your next turn, you may cast that card." — the card just
      // exiled; "for as long as it remains exiled" (CR 400.7: until it leaves exile).
      const exiledLast = out[out.length - 1];
      const castExiled =
        exiledLast?.type === 'move' && exiledLast.to === 'exile' && (exiledLast.what as Ref | undefined)?.ref === 'target'
          ? /^(?:Until (end of turn|the end of your next turn), )?[Yy]ou may (cast|play) (?:that card|it|the exiled card)(?: (this turn|for as long as it remains exiled|until the end of your next turn))?$/.exec(s)
          : null;
      if (castExiled && (castExiled[1] || castExiled[3])) {
        const until = castExiled[3] === 'for as long as it remains exiled' ? 'exiled' : castExiled[1] === 'the end of your next turn' || castExiled[3] === 'until the end of your next turn' ? 'next_turn' : 'eot';
        out.push({ type: 'grant_play', what: exiledLast!.what, mode: castExiled[2], until, ...anyColor(i) });
        continue;
      }
      // Ugin, Eye of the Storms: "Search your library for any number of colorless nonland cards, exile them, then shuffle. Until
      // end of turn, you may cast those cards without paying their mana costs."; Chandra, Heart of Fire: "You may cast them this
      // turn." — the cards the search exiled.
      const searched = out[out.length - 1];
      const castSearched =
        searched?.type === 'search' && searched.to === 'exile' && !searched.faceDown
          ? /^(?:Until end of turn, you may cast (?:those cards|them|that card|it)( without paying (?:their|its) mana costs?)|You may cast (?:those cards|them|that card|it) this turn( without paying (?:their|its) mana costs?)?)$/.exec(s)
          : null;
      if (castSearched) {
        out.push({ type: 'grant_play', what: { ref: 'created' }, mode: 'cast', until: 'eot', ...(castSearched[1] || castSearched[2] ? { free: true } : {}) });
        continue;
      }
      // Zul Ashur, Lich Lord: "You may cast target Zombie creature card from your graveyard this turn."
      const castTarget = /^You may (cast|play) target (.+? card) from your graveyard this turn$/.exec(s);
      if (castTarget) {
        const what = parseObjectRef(`target ${castTarget[2]} in your graveyard`, b);
        if (!what || what.plural || !what.targeted) return null;
        out.push({ type: 'grant_play', what: what.ref, mode: castTarget[1] });
        continue;
      }
      // Emry, Lurker of the Loch: "Choose target artifact card in your graveyard. You may cast that card this turn."
      const chooseTarget = /^Choose target (.+? card in (?:your|a|an opponent's) graveyard)$/.exec(s);
      const castIt = chooseTarget ? /^You may (cast|play) (?:that card|it) this turn$/.exec(next) : null;
      if (chooseTarget && castIt) {
        const what = parseObjectRef(`target ${chooseTarget[1]}`, b);
        if (!what || what.plural || !what.targeted) return null;
        out.push({ type: 'grant_play', what: what.ref, mode: castIt[1] });
        i++;
        continue;
      }
      // "If you search your library this way, shuffle." — the search above shuffles when it looks there.
      if (/^If you search your library this way, shuffle$/.test(s)) {
        const lastSearch = (list: EffectNode[]): EffectNode | undefined => {
          const x = list[list.length - 1];
          if (!x) return undefined;
          if (x.type === 'search') return x;
          for (const k of ['effects', 'then', 'else']) {
            const inner = Array.isArray(x[k]) ? lastSearch(x[k] as EffectNode[]) : undefined;
            if (inner) return inner;
          }
          return undefined;
        };
        if (!lastSearch(out)?.zones) return null;
        continue;
      }
      // "If that spell is countered this way, exile it instead of putting it into its owner's graveyard." (CR 701.6a)
      if (/^If (?:that spell|it) is countered this way, exile it instead of putting it into its owner's graveyard$/.test(s)) {
        // Syncopate: "Counter target spell unless its controller pays {X}. If that spell is countered this way, exile it …"
        const prev = out[out.length - 1];
        const inner = prev?.type === 'unless_pays' && (prev.effects as EffectNode[] | undefined)?.length === 1 ? (prev.effects as EffectNode[])[0] : undefined;
        const last = inner?.type === 'counter' ? inner : prev;
        if (last?.type !== 'counter') return null;
        last.exile = true;
        continue;
      }
      // Memory Lapse: "… put it on top of its owner's library instead of into that player's graveyard"; Remand: "… into its
      // owner's hand"; Spell Crumple: "… on the bottom of its owner's library" (CR 701.6a).
      const counteredTo = /^If (?:that spell|it) is countered this way, put (?:it|that card) (on top of its owner's library|on the bottom of its owner's library|into its owner's hand) instead of into (?:that player's|its owner's) graveyard$/.exec(s);
      if (counteredTo) {
        const last = out[out.length - 1];
        if (last?.type !== 'counter' || last.exile) return null;
        last.to = counteredTo[1]!.startsWith('on top') ? 'library_top' : counteredTo[1]!.startsWith('on the bottom') ? 'library_bottom' : 'hand';
        continue;
      }
      // CR 701.48a: "Learn." — discard a card to draw a card; there are no Lesson cards outside the game here.
      if (s === 'Learn') {
        const r = parseEffectText('You may discard a card. If you do, draw a card.', b);
        if (!r) return null;
        out.push(...r);
        continue;
      }
      // Ram Through: "If the creature you control has trample, excess damage is dealt to that creature's controller
      // instead." — the damage just dealt (CR 120.4a).
      if (/^If the creature you control has trample, excess damage is dealt to that creature's controller instead$/.test(s)) {
        const last = out[out.length - 1];
        if (out.length !== 1 || last?.type !== 'deal_damage' || !last.from) return null;
        last.excessToController = true;
        continue;
      }
      // Flame Spill: "Excess damage is dealt to that creature's controller instead." — always.
      if (/^Excess damage is dealt to that creature's controller instead$/.test(s)) {
        const last = out[out.length - 1];
        if (out.length !== 1 || last?.type !== 'deal_damage' || (last.to as Ref | undefined)?.ref !== 'target' || last.from) return null;
        last.excessToController = true;
        last.excessAlways = true;
        continue;
      }
      // CR 707.10c: "You may choose new targets for the copy."
      if (/^(?:If the spell has any targets, )?[Yy]ou may choose (?:a )?new targets? for (?:the|any of the) cop(?:y|ies)$/.test(s)) {
        // Increasing Vengeance: "… If this spell was cast from a graveyard, copy that spell twice instead. You may choose new
        // targets for the copies." — whichever copying happens.
        const copiesIn = (list: EffectNode[]): EffectNode[] =>
          list.flatMap((x) => [...(x.type === 'copy_spell' ? [x] : []), ...['then', 'effects', 'else'].flatMap((k) => (Array.isArray(x[k]) ? copiesIn(x[k] as EffectNode[]) : []))]);
        // Narset's Reversal: "Copy target instant or sorcery spell, then return it to its owner's hand. You may choose new
        // targets for the copy." — the latest copy, even with an instruction after it.
        const last = copiesIn(out.slice(-1));
        const copies = last.length ? last : out.length > 1 && out[out.length - 1]!.type === 'move' ? copiesIn(out.slice(-2, -1)) : [];
        if (!copies.length) return null;
        for (const c of copies) c.newTargets = true;
        continue;
      }
      // CR 508.4: "Those tokens enter tapped and attacking." — the tokens just created.
      const entersAttacking = /^(?:It|They|That token|Those tokens|The tokens?) enters? tapped and attacking$/.exec(s);
      const madeNow = out[out.length - 1];
      if (entersAttacking && madeNow?.type === 'create_token') {
        madeNow.tapped = true;
        madeNow.attacking = true;
        continue;
      }
      // "Create a 1/1 Eldrazi Scion creature token. It has "Sacrifice this token: Add {C}."" — the token's own text.
      // Vile Redeemer: "Those tokens have \"Sacrifice this token: Add {C}.\""
      const tokenHas = /^(?:It|They|That token|Those tokens) (?:has|have) (.+)$/.exec(s);
      // The token just created — maybe inside "you may create …" or "If you do, create …".
      const lastToken = (list: EffectNode[]): EffectNode | undefined => {
        const x = list[list.length - 1];
        if (!x) return undefined;
        if (x.type === 'create_token') return x;
        for (const k of ['then', 'effects', 'else']) {
          const inner = Array.isArray(x[k]) ? lastToken(x[k] as EffectNode[]) : undefined;
          if (inner) return inner;
        }
        return undefined;
      };
      const made = tokenHas ? lastToken(out) : undefined;
      if (tokenHas && made?.type === 'create_token' && made.token) {
        const face = addTokenText(made.token as FaceDef, tokenHas[1]!, b);
        if (!face) return null;
        made.token = face;
        continue;
      }
      // CR 603.7: "When you next cast an instant or sorcery spell this turn, copy that spell."
      // Twinferno: "When you cast your next instant or sorcery spell this turn, copy that spell."
      const nextCast = /^When you (?:next cast (?:a|an)|cast your next) (.+?) this turn, (.+)$/.exec(s);
      if (nextCast) {
        const spell = parseFilter(nextCast[1]!, b);
        if (!spell || spell.plural || spell.filter.zone !== 'stack') return null;
        const { zone: _z, ...filter } = spell.filter;
        const inner = attempt(b, (b) => {
          const it = b.it;
          b.it = { ref: 'trigger_object' };
          const r = parseSentence(capitalise(nextCast[2]!), b);
          b.it = it;
          return r;
        });
        if (!inner) return null;
        out.push({ type: 'delayed', on: { who: 'you', filter }, effects: inner });
        continue;
      }
      // CR 603.7: "At the beginning of your next upkeep, pay {3}{U}{U}. If you don't, you lose the game." (the pacts),
      // "At the beginning of your next main phase, add …" (Mana Drain) — a following "If you do/don't" goes with it.
      // Necropotence: "Put that card into your hand at the beginning of your next end step." — the same, at the end.
      const yourNextAfter = /^(.+) at the beginning of your next (upkeep|end step)$/.exec(s);
      const yourNext = /^At the beginning of your next (upkeep|end step|main phase|precombat main phase), (.+)$/.exec(s) ?? (yourNextAfter ? [s, yourNextAfter[2]!, yourNextAfter[1]!] : null);
      if (yourNext) {
        const follow = !yourNextAfter && sentences[i + 1] && /^If you (?:do|don't), /.test(sentences[i + 1]!) ? sentences[i + 1]! : null;
        const inner = parseEffectText(`${capitalise(yourNext[2]!)}.${follow ? ` ${follow}.` : ''}`, b);
        if (!inner || delayedOnZone(inner)) return null;
        const step = yourNext[1] === 'upkeep' ? 'upkeep' : yourNext[1] === 'end step' ? 'end' : yourNext[1] === 'main phase' ? 'main' : 'main1';
        out.push({ type: 'delayed', step, whose: 'you', effects: inner });
        if (follow) i++;
        continue;
      }
      // Phytotitan: "return it to the battlefield tapped under its owner's control at the beginning of their next upkeep" —
      // its owner's next upkeep (CR 603.7).
      const theirNext = /^(.+ under its owner's control) at the beginning of their next upkeep$/.exec(s);
      if (theirNext && b.it && b.it.ref !== 'you') {
        const of = b.it;
        const inner = parseSentence(capitalise(theirNext[1]!), b);
        if (!inner || delayedOnZone(inner)) return null;
        out.push({ type: 'delayed', step: 'upkeep', whose: { ref: 'owner_of', of }, effects: inner });
        continue;
      }
      // "Pay {3}{U}{U}. If you don't, you lose the game." — an instruction to pay; not paying is a choice (CR 118.12).
      const payNow = /^Pay ((?:\{(?:\d+|[WUBRGC]|[WUBRG2]\/[WUBRG])\})+)$/.exec(s);
      const payFollow = payNow && sentences[i + 1] ? /^If you (do|don't), (.+)$/.exec(sentences[i + 1]!) : null;
      if (payNow && payFollow) {
        const then = parseSentence(capitalise(payFollow[2]!), b);
        if (!then) return null;
        out.push({ type: 'may_pay', cost: payNow[1]!, ...(payFollow[1] === 'do' ? { effects: then } : { effects: [], else: then }) });
        i++;
        continue;
      }
      // Final Fortune: "Take an extra turn after this one. At the beginning of that turn's end step, you lose the game."
      const thatTurn = out[out.length - 1]?.type === 'extra_turn' ? /^At the beginning of that turn's end step, (.+)$/.exec(s) : null;
      if (thatTurn) {
        const inner = parseSentence(capitalise(thatTurn[1]!), b);
        if (!inner) return null;
        out.push({ type: 'delayed', step: 'end', laterTurn: true, effects: inner });
        continue;
      }
      // CR 603.7: a delayed trigger — "Sacrifice it at the beginning of the next end step."
      // Thawing Glaciers: "Return this land to its owner's hand at the beginning of the next cleanup step." (CR 514.3a)
      const delayed =
        /^(.+) at the beginning of the next (end step|turn's upkeep|cleanup step)$/.exec(s) ??
        /^At the beginning of the next (end step|turn's upkeep|cleanup step), (.+)$/.exec(s) ??
        /^(.+) at (end of combat)$/.exec(s) ??
        /^At (end of combat), (.+)$/.exec(s);
      if (delayed) {
        const [what, when] = delayed[0].startsWith('At ') ? [delayed[2]!, delayed[1]!] : [delayed[1]!, delayed[2]!];
        const step = when === 'end step' ? 'end' : when === 'end of combat' ? 'end_of_combat' : when === 'cleanup step' ? 'cleanup' : 'upkeep';
        // "Exile target creature you control and return it to the battlefield … at the beginning of the next end step" — the
        // exile is now; only the return waits (CR 603.7).
        const andReturn = !delayed[0].startsWith('At ') ? /^(.+?) and (return (?:it|them|that card|those cards) .+)$/.exec(what) : null;
        if (andReturn) {
          const now = attempt(b, (b) => {
            const first = parseSentence(capitalise(andReturn[1]!), b);
            const later = first ? parseSentence(capitalise(andReturn[2]!), b) : null;
            return first && later ? [...first, { type: 'delayed', step, effects: later } as EffectNode] : null;
          });
          if (!now) return null;
          out.push(...now);
          continue;
        }
        // Berserk: "… destroy that creature if it attacked this turn" — a condition on the delayed effect.
        const inner = parseSentence(capitalise(what), b) ?? (/ if [^,]+$/.test(what) ? attempt(b, (b) => parseEffectText(`${capitalise(what)}.`, b)) : null);
        if (!inner) return null;
        // Fickle Efreet: "flip a coin at end of combat. If you lose the flip, …" — the flip's outcome waits for it too.
        while (inner.some((n) => n.type === 'flip_coin') && /^If you (?:win|lose) the flip, /.test(sentences[i + 1] ?? '')) {
          const then = parseEffectText(`${sentences[i + 1]!}.`, b);
          if (!then) return null;
          inner.push(...then);
          i++;
        }
        // Phelia: "… return that card to the battlefield under its owner's control. If it entered under your control, put a
        // +1/+1 counter on Phelia." — about what the delayed trigger returned.
        if (inner.some((n) => n.type === 'move' && n.to === 'battlefield') && /^If (?:it|that card) entered under your control, /.test(sentences[i + 1] ?? '')) {
          const then = parseEffectText(`${sentences[i + 1]!}.`, b);
          if (!then) return null;
          inner.push(...then);
          i++;
        }
        // CR 511.2: "at end of combat" — as the end of combat step begins.
        out.push({ type: 'delayed', step, effects: inner });
        continue;
      }
      // The Enduring cycle: "Return it to the battlefield under its owner's control. It's an enchantment." (layer 4,
      // CR 205.1a: it's no longer a creature).
      const itsA = /^It's an? (enchantment|artifact|land)$/.exec(s);
      if (itsA) {
        const last = out[out.length - 1];
        if (!last || last.type !== 'move' || last.to !== 'battlefield' || !b.it) return null;
        out.push({ type: 'modify', what: b.it, types: [itsA[1]!.replace(/^\w/, (c) => c.toUpperCase())], subtypes: [], until: 'game' });
        continue;
      }
      // Liliana, Death's Majesty: "Return target creature card from your graveyard to the battlefield. That creature is a
      // black Zombie in addition to its other colors and types." (layers 4 and 5)
      const zombie = /^(?:That creature is|It's|Each of those creatures is) an? (white|blue|black|red|green) ([A-Z][a-z]+) in addition to its other colors and types$/.exec(s);
      if (zombie && (SUBTYPES.creature as readonly string[]).includes(zombie[2]!)) {
        const last = out[out.length - 1];
        if (!last || last.type !== 'move' || last.to !== 'battlefield' || !b.it) return null;
        out.push({ type: 'modify', what: b.it, types: [], subtypes: [zombie[2]!], retainTypes: true, addColors: [COLOR_WORDS[zombie[1]!]!], until: 'game' });
        continue;
      }
      // Portal to Phyrexia: "put target creature card from a graveyard onto the battlefield under your control. It's a
      // Phyrexian in addition to its other types." (layer 4)
      const itsAlso = /^It's an? ([A-Z][a-z]+) in addition to its other types$/.exec(s);
      if (itsAlso && (SUBTYPES.creature as readonly string[]).includes(itsAlso[1]!)) {
        const last = out[out.length - 1];
        if (!last || last.type !== 'move' || last.to !== 'battlefield' || !b.it) return null;
        out.push({ type: 'modify', what: b.it, types: [], subtypes: [itsAlso[1]!], retainTypes: true, until: 'game' });
        continue;
      }
      // CR 608.2c: later text can modify earlier text ("Destroy target creature. It can't be regenerated.").
      // CR 205.1b: "It's still a land." — the earlier "becomes a creature" keeps its other types.
      if (/^(?:It's|They're) still (?:a land|lands|an artifact|artifacts|an enchantment|a planeswalker)$/.test(s)) {
        const last = out[out.length - 1];
        if (!last || last.type !== 'modify' || !last.types) return null;
        last.retainTypes = true;
        continue;
      }
      // Nekrataal: "Destroy target nonartifact, nonblack creature. That creature can't be regenerated."
      if (/^(?:It|They|Those creatures|That creature|(?:A|The) (?:creature|permanent) destroyed this way|(?:Creatures|Permanents) destroyed this way) can't be regenerated$/.test(s)) {
        // The destroy effects of the sentence before ("Destroy target creature and all others with the same name").
        const destroys: EffectNode[] = [];
        const find = (list: EffectNode[]) => {
          for (const x of list) {
            if (x.type === 'destroy') destroys.push(x);
            for (const k of ['effects', 'then', 'else']) if (Array.isArray(x[k])) find(x[k] as EffectNode[]);
          }
        };
        find(previous.length ? previous : out.slice(-1));
        if (!destroys.length) return null;
        for (const d of destroys) d.noRegen = true;
        continue;
      }
      // Hydroid Krasis: "… gain half X life and draw half X cards. Round down each time."
      const roundEach = /\bhalf\b/.test(s) ? /^Round (up|down) each time$/.exec(sentences[i + 1] ?? '') : null;
      if (roundEach) {
        s = `${s}, rounded ${roundEach[1]}`;
        i++;
      }
      const effects = parseSentence(s, b);
      if (!effects) return null;
      out.push(...effects);
      previous = effects;
      // Inspiring Call: "Draw a card for each creature you control with a +1/+1 counter on it. Those creatures gain
      // indestructible …"; Unbreakable Formation: "Creatures you control gain indestructible …. If …, put a +1/+1 counter
      // on each of those creatures" — the creatures this sentence counted or affected (nothing between changes which).
      const following = sentences[i + 1];
      if (following && /\b(?:those creatures|each of those creatures)\b/i.test(following)) {
        const sets = new Set<string>();
        const walk = (v: unknown): void => {
          if (Array.isArray(v)) v.forEach(walk);
          else if (v && typeof v === 'object') {
            const o = v as Record<string, unknown>;
            if ((o.ref === 'all' || o.kind === 'count') && o.filter) sets.add(JSON.stringify(o.filter));
            Object.values(o).forEach(walk);
          }
        };
        walk(effects);
        const filter = sets.size === 1 ? (JSON.parse([...sets][0]!) as ObjectFilter) : null;
        if (filter?.types?.includes('Creature') && (!filter.zone || filter.zone === 'battlefield')) {
          for (const n of ['those creatures', 'each of those creatures']) b.named[n] = { ref: 'all', filter };
        }
      }
      // Fabled Passage: "Search … put it onto the battlefield tapped, then shuffle. Then …, untap that land." — the card found.
      const last = effects[effects.length - 1];
      if (last?.type === 'search' && last.amount === 1 && (!last.who || (last.who as Ref).ref === 'target') && ['battlefield', 'hand', 'exile'].includes(String(last.to))) b.it = { ref: 'created' };
      // "Return all creature cards from your graveyard to the battlefield. They gain haste until end of turn." — the
      // permanents they became (CR 400.7), not cards still in that graveyard.
      const whatAll = last?.type === 'move' && last.to === 'battlefield' ? (last.what as Ref | undefined) : undefined;
      if (whatAll?.ref === 'all' && whatAll.filter?.zone && whatAll.filter.zone !== 'battlefield') b.it = { ref: 'moved_onto' };
    }
    if (anyColorAt.size) return null;
    // Deadly Vanity: "Choose a creature or planeswalker, then destroy all other creatures and planeswalkers." — "other"
    // after the choice is other than the chosen one.
    const chose = out.findIndex((e) => e.type === 'choose_object');
    if (chose >= 0) {
      for (let k = chose + 1; k < out.length; k++) {
        const js = JSON.stringify(out[k]);
        if (js.includes('"other":true')) out[k] = JSON.parse(js.replace(/"other":true/g, '"otherThan":{"ref":"chosen_object"}')) as EffectNode;
      }
    }
    return out.length ? out : null;
  });
}

/** "half X", "half their life", "half their library", "half the cards in their hand" — halved, rounded `dir`. */
function parseHalved(text: string, dir: 'up' | 'down', b: Binder): EffectNode[] | null {
  const kinds: string[] = [];
  let third = false;
  const t = text
    .replace(/\bhalf X\b/g, () => (kinds.push('x'), 'X'))
    .replace(/\b(loses?) half (?:their|his or her|your) life\b/, (_m, v: string) => (kinds.push('life'), `${v} X life`))
    // Dire Fleet Ravager: "each player loses a third of their life, rounded up".
    .replace(/\b(loses?) a third of (?:their|your) life\b/, (_m, v: string) => (kinds.push('life'), (third = true), `${v} X life`))
    .replace(/\b(mills?) half (?:their|your) library\b/, (_m, v: string) => (kinds.push('library'), `${v} X cards`))
    // Ulamog, the Defiler: "target opponent exiles the top half of their library, rounded up".
    .replace(/\b(exiles?) the top half of (their|your) library\b/, (_m, v: string, w: string) => (kinds.push('library'), `${v} the top X cards of ${w} library`))
    .replace(/\b(discards?) half the cards in (?:their|your) hand\b/, (_m, v: string) => (kinds.push('hand'), `${v} X cards`));
  const halfCount = /\bhalf the number of\b/.test(t);
  // Hydroid Krasis: "gain half X life and draw half X cards" — any number of X; one of the others.
  if ((kinds.length === 0 && !halfCount) || (kinds.some((k) => k !== 'x') && kinds.length > 1)) return null;
  // The X these stand for can't also be an X the text uses on its own.
  if (/\bX\b/.test(text.replace(/\bhalf X\b/g, ''))) return null;
  // "half the number of …" is counted with this rounding too (parseCount).
  const before = b.halfDir;
  b.halfDir = dir;
  const effects = parseSentence(t, b);
  b.halfDir = before;
  if (!effects) return null;
  let bound = 0;
  const one = (who: unknown): who is Ref => Boolean(who && typeof who === 'object' && (who as Ref).ref !== 'players' && (who as Ref).ref !== 'all');
  const fix = (list: EffectNode[]): EffectNode[] =>
    list.map((e) => {
      const out: EffectNode = { ...e };
      for (const k of ['effects', 'then', 'else'] as const) if (Array.isArray(e[k])) out[k] = fix(e[k] as EffectNode[]);
      if (out.amount !== 'X') return out;
      if (kinds[0] === 'x') out.amount = { kind: 'x', half: dir };
      else {
        // The player who loses, mills or discards: one player, counted as they do (CR 608.2h). Betor, Kin to All: "each
        // opponent loses half their life" — each their own.
        if (!one(e.who)) {
          if (kinds[0] !== 'life' || e.type !== 'lose_life' || (e.who as Ref | undefined)?.ref !== 'players') return out;
          out.amount = { kind: 'life', who: { ref: 'each_player' }, half: dir, ...(third ? { divisor: 3 } : {}) };
          bound++;
          return out;
        }
        // Singularity Rupture: "any number of target players each mill half their library" — each of them their own.
        const many = (e.who as Ref).ref === 'target' && ((b.targets[(e.who as { index: number }).index]?.count ?? 1) > 1);
        const player: Ref = many && e.type === 'mill' ? { ref: 'each_player' } : (e.who as Ref);
        out.amount = kinds[0] === 'life' ? { kind: 'life', who: e.who, half: dir, ...(third ? { divisor: 3 } : {}) } : { kind: 'cards', zone: kinds[0] === 'library' ? 'library' : 'hand', who: 'you', player, half: dir };
      }
      bound++;
      return out;
    });
  const out = fix(effects);
  return (bound || (kinds.length === 0 && JSON.stringify(out).includes('"half"'))) && !JSON.stringify(out).includes('"X"') ? out : null;
}

const REST: Record<string, { rest: string; order?: string }> = {
  'into your graveyard': { rest: 'graveyard' },
  // Genesis Ultimatum: "… onto the battlefield and the rest into your hand."
  'into your hand': { rest: 'hand' },
  'on the bottom of your library in any order': { rest: 'bottom', order: 'any' },
  'on the bottom of your library in a random order': { rest: 'bottom', order: 'random' },
  // Loot, Exuberant Explorer: "Put the rest on the bottom in a random order."
  'on the bottom in a random order': { rest: 'bottom', order: 'random' },
  'on the bottom in any order': { rest: 'bottom', order: 'any' },
  'on the bottom of your library': { rest: 'bottom', order: 'any' },
  'back on top of your library in any order': { rest: 'top', order: 'any' },
  'on top of your library in any order': { rest: 'top', order: 'any' },
};

/**
 * Sludge Titan, Ojer Kaslem: "a creature card and/or a land card" — up to one of each. Undefined when the phrase isn't
 * that; null when it is but a part doesn't read.
 */
function eachOfPair(many: string, noun: string, zone: 'library' | 'hand', b: Binder): ObjectFilter[] | null | undefined {
  if (many !== 'a' && many !== 'an') return undefined;
  const m = /^(.+? card) and\/or (?:a|an) (.+? card)$/.exec(noun);
  if (!m) return undefined;
  const one = parseFilter(`${m[1]} in your ${zone}`, b);
  const two = one ? parseFilter(`${m[2]} in your ${zone}`, b) : null;
  if (!one || !two || one.plural || two.plural) return null;
  return [one.filter, two.filter].map(({ zone: _z, owner: _o, ...rest }) => rest);
}

/** The sentences after "Look at the top N cards of your library." (CR 701.16 isn't a keyword action: just looking). */
function parseDig(count: string, next: string, after: string | undefined, b: Binder, afterRest?: string): { node: EffectNode; used: number } | null {
  // "Look at the top X cards of your library" — the X paid, or one the text defines (bound by the caller).
  const amount = count === 'X' ? 'X' : parseAmount(count);
  if (amount !== 'X' && (typeof amount !== 'number' || amount < 1)) return null;
  // Famished Worldsire: "Put any number of land cards from among them onto the battlefield tapped, then shuffle."
  const shuffled = /, then shuffle$/.test(next);
  if (shuffled) next = next.replace(/, then shuffle$/, '');
  if (shuffled && !/^Put (?:a|an|up to \w+|any number of) .+ from among /.test(next)) return null;
  const restOf = (text: string | undefined) => {
    // Genesis Wave: "Then put all cards revealed this way that weren't put onto the battlefield into your graveyard."
    const m = text
      ? /^(?:Then )?[Pp]ut the (?:rest|others?)(?: of (?:the cards revealed this way|those cards|the cards))? (.+)$/.exec(text) ??
        /^(?:Then )?[Pp]ut all (?:other )?cards revealed this way that weren't put (?:onto the battlefield|into your hand) (.+)$/.exec(text)
      : null;
    return m ? REST[m[1]!] ?? null : null;
  };
  // "Put two of them into your hand and the rest into your graveyard."
  const put = /^Put (up to )?(\w+)(?: of (?:them|those cards))? into your (hand|graveyard) and the (?:rest|others?) (.+)$/.exec(next);
  if (put) {
    const take = parseAmount(put[2]!);
    const rest = REST[put[4]!];
    if (typeof take !== 'number' || !rest) return null;
    return { node: { type: 'dig', amount, take, to: put[3], ...rest, ...(put[1] ? { upTo: true } : {}) }, used: 1 };
  }
  // "Put one of them into your graveyard." — the other stays on top.
  const putSome = /^Put (\w+) of (?:them|those cards) into your (hand|graveyard)$/.exec(next);
  if (putSome) {
    const take = parseAmount(putSome[1]!);
    if (typeof take !== 'number' || (typeof amount === 'number' && take >= amount)) return null;
    const rest = restOf(after);
    return { node: { type: 'dig', amount, take, to: putSome[2], ...(rest ?? { rest: 'top', order: 'same' }) }, used: rest ? 2 : 1 };
  }
  // "Put a land card from among them onto the battlefield and the rest into your graveyard.",
  // "Put up to two creature cards with mana value 3 or less from among them onto the battlefield." + "Put the rest …"
  const putFrom = /^Put (a|an|up to \w+|any number of) (.+?) from among (?:them|those cards|the revealed cards) (into your hand|onto the battlefield( tapped)?|into your graveyard)(?: and the (?:rest|others?) (.+))?$/.exec(next);
  if (putFrom) {
    const rest = shuffled ? { rest: 'shuffle' } : putFrom[5] ? REST[putFrom[5]] : restOf(after);
    if (shuffled && putFrom[5]) return null;
    const n = putFrom[1] === 'any number of' ? 99 : putFrom[1]!.startsWith('up to ') ? parseAmount(putFrom[1]!.slice(6)) : 1;
    // Michelangelo's Technique: "up to two creature cards with total mana value 6 or less"; Smelting Vat: "… with total mana
    // value less than or equal to the sacrificed artifact's mana value".
    const totalM = / with total mana value (?:(\d+|X) or less|less than or equal to (.+))$/.exec(putFrom[2]!);
    const totalMV = totalM ? (totalM[1] ? parseAmount(totalM[1]) : parseCount(totalM[2]!, b)) : undefined;
    if (totalM && (!totalMV || typeof n !== 'number' || n < 2)) return null;
    const pf = parseFilter(`${totalM ? putFrom[2]!.slice(0, totalM.index) : putFrom[2]} in your library`, b);
    if (!rest || typeof n !== 'number' || !pf || pf.plural !== n > 1) return null;
    const { zone: _z, owner: _o, ...filter } = pf.filter;
    const to = putFrom[3]!.startsWith('into your hand') ? 'hand' : putFrom[3]!.startsWith('onto') ? 'battlefield' : 'graveyard';
    // "up to N": any number of them; "a land card": one if there is one.
    return {
      node: { type: 'dig', amount, take: n, to, filter, ...(putFrom[1]!.startsWith('up to ') || putFrom[1] === 'any number of' ? { optional: true } : {}), ...rest, ...(putFrom[4] ? { tapped: true } : {}), ...(totalMV !== undefined ? { totalMV } : {}) },
      used: putFrom[5] || shuffled ? 1 : 2,
    };
  }
  // "You may reveal a creature card from among them and put it into your hand." + "Put the rest …"
  // Calix: "… and put that card into your hand"; Karumonix: "You may reveal any number of Rat cards from among them and put
  // the revealed cards into your hand."
  const reveal = /^You may (reveal|put) (a|an|up to \w+|any number of) (.+?) from among (?:them|those cards)(?: and put (?:it|them|that card|the revealed cards))? (into your hand|onto the battlefield( tapped)?|into your graveyard)$/.exec(next);
  // Planar Genesis: "You may put a land card from among them onto the battlefield tapped. If you don't, put a card from among
  // them into your hand. Put the rest …"
  if (reveal && after === "If you don't, put a card from among them into your hand" && reveal[1] === 'put' && reveal[2] === 'a') {
    const inner = parseDig(count, next, afterRest, b);
    return inner && inner.used === 2 ? { node: { ...inner.node, orElse: { to: 'hand' } }, used: 3 } : null;
  }
  if (reveal) {
    if (shuffled) return null;
    const rest = restOf(after);
    const each = eachOfPair(reveal[2]!, reveal[3]!, 'library', b);
    if (each === null || (each && !rest)) return null;
    if (each) {
      const to = reveal[4]!.startsWith('into your hand') ? 'hand' : reveal[4]!.startsWith('onto') ? 'battlefield' : 'graveyard';
      return { node: { type: 'dig', amount, take: 2, each, to, optional: true, ...rest!, ...(reveal[1] === 'reveal' ? { reveal: true } : {}), ...(reveal[5] ? { tapped: true } : {}) }, used: 2 };
    }
    const n = reveal[2] === 'any number of' ? 99 : reveal[2]!.startsWith('up to ') ? parseAmount(reveal[2]!.slice(6)) : 1;
    const pf = parseFilter(`${reveal[3]} in your library`, b);
    if (!rest || typeof n !== 'number' || !pf || pf.plural !== n > 1) return null;
    const { zone: _z, owner: _o, ...filter } = pf.filter;
    const to = reveal[4]!.startsWith('into your hand') ? 'hand' : reveal[4]!.startsWith('onto') ? 'battlefield' : 'graveyard';
    return {
      node: { type: 'dig', amount, take: n, to, filter, optional: true, ...rest, ...(reveal[1] === 'reveal' ? { reveal: true } : {}), ...(reveal[5] ? { tapped: true } : {}) },
      used: 2,
    };
  }
  // "Put all creature cards revealed this way into your hand and the rest into your graveyard."
  // Muxus, Goblin Grandee: "Put all Goblin creature cards with mana value 5 or less from among them onto the battlefield and
  // the rest on the bottom of your library in a random order."
  const all = /^Put all (.+?) cards?( with [^,]+?)? (?:revealed this way|from among them) (into your hand|into your graveyard|onto the battlefield( tapped)?) and the (?:rest|others) (.+)$/.exec(next);
  if (all) {
    const rest = REST[all[5]!];
    const pf = parseFilter(`${all[1]} cards${all[2] ?? ''} in your library`, b);
    if (!rest || !pf) return null;
    const { zone: _z, owner: _o, ...filter } = pf.filter;
    const to = all[3] === 'into your hand' ? 'hand' : all[3] === 'into your graveyard' ? 'graveyard' : 'battlefield';
    return { node: { type: 'dig', amount, take: amount, to, filter, all: true, ...rest, ...(all[4] ? { tapped: true } : {}) }, used: 1 };
  }
  // "You may put one of them back on top of your library. Put the rest into your graveyard."
  const back = /^You may put (\w+) of (?:them|those cards) (?:back )?on top of your library$/.exec(next);
  if (back) {
    const take = parseAmount(back[1]!);
    const rest = restOf(after);
    if (typeof take !== 'number' || rest?.rest !== 'graveyard') return null;
    return { node: { type: 'dig', amount, take, to: 'top', optional: true, rest: 'graveyard' }, used: 2 };
  }
  return null;
}

/**
 * Mortarion: "X can't be greater than the amount of life you lost this turn." among the sentences after a "you may pay
 * {X}" — the bound (and the sentence is taken out), null without one, undefined if it doesn't read.
 */
function xCap(list: string[], b: Binder): AmountExpr | null | undefined {
  const at = list.findIndex((t) => /^X can't be greater than /.test(t));
  if (at < 0) return null;
  const expr = parseCount(list[at]!.replace(/^X can't be greater than /, '').replace(/\.$/, ''), b);
  if (!expr) return undefined;
  list.splice(at, 1);
  return expr;
}

function capitalise(s: string): string {
  return s.replace(/^\w/, (c) => c.toUpperCase());
}

/** A count that names something the instruction itself introduces ("its power", "that creature's toughness"). */
const POINTS_BACK = /^(?:its|that (?:creature|permanent|card|spell|land|artifact)'s) (?:power|toughness|mana value)$/;
/** …unless the instruction's subject is the source ("It deals damage equal to its power to target creature"). */
/** Canopy Gargantuan: "on each other creature you control equal to that creature's toughness" — a number for each one. */
const perEach = (what: string, instruction: string, b: Binder) => {
  const noun = /^that (\w+)'s/.exec(what)?.[1];
  // Only when there's nothing earlier it could mean (Rupture's "that creature" is the one it sacrificed).
  return Boolean(noun) && (!b.it || (b.it.ref === 'self' && !b.other)) && new RegExp(`\\beach (?:other )?(?:[\\w-]+ )*?${noun}\\b`, 'i').test(instruction) && !/\btarget\b/i.test(instruction);
};
const pointsBack = (what: string, instruction: string) => {
  const t = instruction.trim();
  // Only an instruction that introduces the thing ("target creature gets …", "sacrifices a creature …"); not one that
  // creates something new ("create X tokens, where X is that spell's mana value").
  return POINTS_BACK.test(what) && !/^(?:it\b|~|this (?:creature|permanent|artifact|enchantment|land|spell)\b)/i.test(t) && !/\bcreates?\b/i.test(t) && /\btarget\b|\bsacrific(?:es?|ed)\b/i.test(t);
};

/** "draws cards equal to …" → "draws X cards" plus what X is (then bound with bindX). */
const EQUAL_TO: [RegExp, (m: RegExpExecArray) => [string, string]][] = [
  [/^(.*?\bdeals?) damage equal to (.+?) to (.+)$/i, (m) => [`${m[1]} X damage to ${m[3]}`, m[2]!]],
  [/^(.*?\bdeals?) damage to (.+?) equal to (.+)$/i, (m) => [`${m[1]} X damage to ${m[2]}`, m[3]!]],
  [/^(.*?\b(?:gains?|loses?)) life equal to (.+)$/i, (m) => [`${m[1]} X life`, m[2]!]],
  [/^(.*?\b(?:draws?|mills?|discards?)) cards equal to (.+)$/i, (m) => [`${m[1]} X cards`, m[2]!]],
  [/^(.*?\bputs?) a number of (\S+) counters on (.+?) equal to (.+)$/i, (m) => [`${m[1]} X ${m[2]} counters on ${m[3]}`, m[4]!]],
  [/^(.*?\bscry) equal to (.+)$/i, (m) => [`${m[1]} X`, m[2]!]],
];

/** Numbers the game counts: "for each …", "equal to …" (CR 608.2h: counted as the effect happens). */
type InnerParse = (s: string, b: Binder) => EffectNode[] | null;

/** What "can't cast" covers (CR 101.2): "noncreature spells", "spells during combat", "more than one spell each turn". */
export interface CastBan {
  filter?: ObjectFilter;
  during?: 'your_turn' | 'combat';
  fromZones?: ('graveyard' | 'library' | 'exile' | 'command')[];
  maxPerTurn?: number;
}

export function parseCastBan(text: string, b: Binder): CastBan | null {
  let t = text.trim();
  const ban: CastBan = {};
  const during = / during (your turn|combat)$/.exec(t);
  if (during) {
    ban.during = during[1] === 'combat' ? 'combat' : 'your_turn';
    t = t.slice(0, during.index);
  }
  // Drannith Magistrate: "from anywhere other than their hands" (the command zone too, CR 903.8).
  const notHand = / from anywhere other than (?:their|your) hands?$/.exec(t);
  if (notHand) {
    ban.fromZones = ['graveyard', 'library', 'exile', 'command'];
    t = t.slice(0, notHand.index);
  }
  const from = / from (?:graveyards|a graveyard|their graveyards|your graveyard)(?: or (libraries|exile))?$/.exec(t);
  if (from) {
    ban.fromZones = ['graveyard', ...(from[1] === 'libraries' ? (['library'] as const) : from[1] === 'exile' ? (['exile'] as const) : [])];
    t = t.slice(0, from.index);
  }
  const more = /^more than one (.*?)spell each turn$/.exec(t);
  if (more) {
    ban.maxPerTurn = 1;
    t = `${more[1]}spells`;
  }
  if (t === 'spells') return ban;
  const head = /^(.+?) spells(.*)$/.exec(t) ?? /^spells( .+)$/.exec(t);
  if (!head) return null;
  const words = t.startsWith('spells') ? '' : head[1]!;
  // "creature or planeswalker spells", "instant or sorcery spells", "blue creature spells", "spells with mana value 3 or less"
  const pf = parseFilter(`${words ? `${words.replace(/ and /g, ' or ')} ` : ''}spells${t.startsWith('spells') ? head[1]! : head[2]!}`, b);
  if (!pf || !pf.plural) return null;
  const { zone: _z, ...filter } = pf.filter;
  if (!Object.keys(filter).length) return null;
  ban.filter = filter;
  return ban;
}

function parseCounted(s: string, b: Binder, parseInner: InnerParse = parseSentence): EffectNode[] | null {
  const at = s.indexOf(' for each ');
  if (at > 0) {
    const tail = s.slice(at + ' for each '.length);
    // "gets +1/+1 for each creature you control until end of turn": the duration stays with the effect.
    const suffix = / until end of turn$/.exec(tail);
    const options: [string, string][] = [[tail, '']];
    if (suffix) options.unshift([tail.slice(0, suffix.index), suffix[0]]);
    // Nissa, Ascended Animist: "… get +1/+1 for each Forest you control and gain trample" — the count ends at "and gain".
    const andGain = / and (?:gains?|has|have) [^]+$/.exec(tail);
    if (andGain && /^[^]* (?:gets?|get) [+-]\d+\/[+-]\d+$/.test(s.slice(0, at))) options.unshift([tail.slice(0, andGain.index), andGain[0]]);
    for (const [what, rest] of options) {
      const r =
        attempt(b, (b) => {
          const expr = parseForEach(what, b);
          const inner = expr && parseInner(s.slice(0, at) + rest, b);
          // "each opponent … for each creature that player controls": "that player" is each of them (below).
          if (inner?.length === 1 && (inner[0] as { who?: Ref }).who?.ref === 'players' && /\b(?:that player|they|their)\b/.test(what)) return null;
          return inner && expr ? scaleBy(inner, expr) : null;
        }) ??
        // "Target player loses 1 life for each artifact that player controls": the count refers back to the subject.
        (/\b(?:that player|they|their)\b/.test(what)
          ? attempt(b, (b) => {
              const inner = parseInner(s.slice(0, at) + rest, b);
              // "Each opponent loses 1 life for each creature that player controls": each of them (perPlayerCount).
              // Price of Progress: "deals damage to each player equal to … that player controls" — each of them too.
              const who = inner?.length === 1 ? ((inner[0] as { who?: Ref }).who ?? (inner[0]!.type === 'deal_damage' ? (inner[0] as { to?: Ref }).to : undefined)) : undefined;
              const saved = b.player;
              if (who?.ref === 'players') b.player = who;
              const counted = inner && parseForEach(what, b);
              b.player = saved;
              const expr = inner && counted ? perPlayerCount(inner, counted) : null;
              return inner && expr ? scaleBy(inner, expr) : null;
            })
          : null);
      if (r) return r;
    }
  }
  // "you gain that much life", "put that many +1/+1 counters on it" — the trigger event's amount.
  if (b.eventAmount && /\bthat (?:much|many)\b/.test(s)) {
    const text = s.replace(/\bthat (?:much|many)\b/g, 'X');
    const r = attempt(b, (b) => {
      const inner = parseInner(text, b);
      return inner ? bindX(inner, { kind: 'event' }) : null;
    });
    if (r) return r;
  }
  if (/ equal to /.test(s)) {
    for (const [re, rewrite] of EQUAL_TO) {
      const m = re.exec(s);
      if (!m) continue;
      const [text, what] = rewrite(m);
      const r = attempt(b, (b) => {
        // "gains life equal to its toughness" — "its" is read after the instruction it's about.
        if (perEach(what, text, b)) return null;
        if (pointsBack(what, text)) {
          const inner = parseInner(text, b);
          const expr = inner && parseCount(what, b);
          return inner && expr ? bindX(inner, expr) : null;
        }
        // Abyssal Hunter: "Tap target creature. ~ deals damage equal to its power to that creature." — "its" is the subject's
        // (the source), not the creature named before.
        // (When "it" is already the source — "When ~ dies, … deals damage equal to its power" — it stays: as it last existed.)
        const sourceSubject = /^~ deals? /.test(text) && /^its (?:power|toughness)$/.test(what) && b.it?.ref !== 'self' && !(b.it?.ref === 'trigger_object' && b.itIsSource);
        const savedIt = b.it;
        if (sourceSubject) b.it = { ref: 'self' };
        const expr = parseCount(what, b);
        if (sourceSubject) b.it = savedIt;
        const inner = expr && parseInner(text, b);
        // "each opponent loses life equal to … that player's …": each of them (below).
        if (inner?.length === 1 && (inner[0] as { who?: Ref }).who?.ref === 'players' && /\b(?:that player|they|their|them)\b/.test(what)) return null;
        return inner && expr ? bindX(inner, expr) : null;
      });
      if (r) return r;
      // "~ deals damage to target player equal to the number of cards in that player's hand": the count names a
      // player the instruction targets.
      // Peer into the Abyss: "Target player draws cards equal to … cards in their library" — that player's.
      // Within Range: "… equal to the number of creatures attacking them".
      const later = /\bthat (?:player|opponent)\b|\btheir (?:hand|graveyard|library)\b|\bthey (?:control|controlled|lost|gained)\b|\battacking them\b/.test(what)
        ? attempt(b, (b) => {
            const inner = parseInner(text, b);
            // "Each opponent loses life equal to the life that player lost this turn": "that player" is each of them.
            const who = inner?.length === 1 ? ((inner[0] as { who?: Ref }).who ?? (inner[0]!.type === 'deal_damage' ? (inner[0] as { to?: Ref }).to : undefined)) : undefined;
            const saved = b.player;
            if (who?.ref === 'players') b.player = who;
            const counted = inner && parseCount(what, b);
            b.player = saved;
            const expr = inner && counted ? perPlayerCount(inner, counted) : null;
            return inner && expr ? bindX(inner, expr) : null;
          })
        : null;
      if (later) return later;
    }
  }
  return null;
}

function parseSentence(s: string, b: Binder): EffectNode[] | null {
  // Hit the Mother Lode: "If the discovered card's mana value is less than 10, create a number of tapped Treasure tokens equal
  // to the difference." — none if nothing was discovered (CR 701.57a).
  const shortfall = /^If the discovered card's mana value is less than (\d+), create a number of (tapped )?Treasure tokens equal to the difference$/.exec(s);
  if (shortfall) {
    const made = parseSentence(`Create ${shortfall[2] ? 'a tapped' : 'a'} Treasure token`, b);
    const node = made?.length === 1 && made[0]!.type === 'create_token' ? made[0]! : null;
    return node ? [{ ...node, amount: { kind: 'discover_shortfall', n: Number(shortfall[1]) } }] : null;
  }
  // Extract from Darkness: "Then you put a creature card from a graveyard onto the battlefield under your control." — any
  // graveyard's, chosen as it resolves.
  // Soul of Windgrace: "you may put a land card from a graveyard onto the battlefield tapped under your control".
  const fromAYard = /^(?:Then )?[Yy]ou (may )?put (?:a|an) (.+? card) from a graveyard onto the battlefield( tapped)? under your control$/.exec(s);
  if (fromAYard) {
    const pf = parseFilter(`${fromAYard[2]} in your graveyard`, b.clone());
    if (pf && !pf.plural) {
      const { zone: _z, owner: _o, ...filter } = pf.filter;
      b.it = { ref: 'chosen_object' };
      const put: EffectNode[] = [
        { type: 'choose_object', filter: { ...filter, zone: 'graveyard' } },
        { type: 'move', what: { ref: 'chosen_object' }, to: 'battlefield', under: 'you', ...(fromAYard[3] ? { tapped: true } : {}) },
      ];
      return fromAYard[1] ? [{ type: 'may_do', effects: put }] : put;
    }
  }
  // Lord of the Void: "exile the top seven cards of that player's library, then put a creature card from among them onto the
  // battlefield under your control".
  const exilePut = /^(.+?), then put (?:a|an) (.+? card) from among them onto the battlefield( tapped)?( under your control)?$/.exec(s);
  if (exilePut) {
    const r = attempt(b, (b) => {
      const first = parseSentence(exilePut[1]!, b);
      const pf = first?.length === 1 && first[0]!.type === 'exile_top' && !first[0]!.play ? parseFilter(`${exilePut[2]} in your graveyard`, b.clone()) : null;
      if (!first || !pf || pf.plural) return null;
      const { zone: _z, owner: _o, ...filter } = pf.filter;
      b.it = { ref: 'chosen_object' };
      return [
        ...first,
        { type: 'choose_object', filter: { ...filter, zone: 'exile' }, among: { ref: 'moved_onto' } },
        { type: 'move', what: { ref: 'chosen_object' }, to: 'battlefield', ...(exilePut[3] ? { tapped: true } : {}), ...(exilePut[4] ? { under: 'you' } : {}) },
      ];
    });
    if (r) return r;
  }
  // Party Thrasher: "exile the top two cards of your library, then choose one of them" — "that card" afterwards.
  const exileChoose = /^[Ee]xile the top (two|three|four|five) cards of your library, then choose one of them$/.exec(s);
  if (exileChoose) {
    b.it = { ref: 'chosen_object' };
    b.named = { ...b.named, 'that card': { ref: 'chosen_object' } };
    return [
      { type: 'exile_top', amount: parseAmount(exileChoose[1]!), who: { ref: 'you' } },
      { type: 'choose_object', filter: {}, among: { ref: 'moved_onto' } },
    ];
  }
  // Ophidian: "this creature assigns no combat damage this turn"; Lim-Dûl's Paladin: "it assigns no combat damage this turn
  // and defending player loses 4 life".
  // CR 701.60: Absolving Lammasu: "all suspected creatures are no longer suspected"; Airtight Alibi: "it's no longer suspected".
  const unsuspect = /^(.+?) (?:is|are) no longer suspected$/.exec(s.replace(/^([Ii]t|[Tt]hey)'(s|re) /, (_m, w: string, v: string) => `${w} ${v === 's' ? 'is' : 'are'} `));
  if (unsuspect) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(unsuspect[1]!, b);
      return what ? [{ type: 'suspect', what: what.ref, off: true }] : null;
    });
    if (r) return r;
  }
  const noDamage = /^(.+?) assigns no combat damage this turn(?: and (.+))?$/.exec(s);
  if (noDamage) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(noDamage[1]!, b);
      if (!what || what.plural) return null;
      const rest = noDamage[2] ? parseSentence(capitalise(noDamage[2]), b) : [];
      return rest ? [{ type: 'modify', what: what.ref, rules: ['assigns_no_combat_damage'], until: 'eot' }, ...rest] : null;
    });
    if (r) return r;
  }
  // Kroxa: "each opponent discards a card, then each opponent who didn't discard a nonland card this way loses 3 life" —
  // each of them on their own.
  const discardOrLose = /^[Ee]ach (opponent|player) discards a card, then each \1 who didn't discard (?:a|an) (.+? card) this way loses (\d+) life$/.exec(s);
  if (discardOrLose) {
    const pf = parseFilter(`${discardOrLose[2]} in your hand`, b.clone());
    if (pf && !pf.plural) {
      const { zone: _z, owner: _o, ...f } = pf.filter;
      if (Object.keys(f).some((k) => k !== 'types' && k !== 'notTypes')) return null;
      const discarded: AmountExpr = { kind: 'moved_this_way', how: 'discarded', yours: true, ...(f.types ? { types: f.types } : {}), ...(f.notTypes ? { notTypes: f.notTypes } : {}) };
      return [{
        type: 'players_do',
        players: { ref: 'players', who: discardOrLose[1] === 'opponent' ? 'opponents' : 'each' },
        effects: [
          { type: 'discard', amount: 1, who: { ref: 'you' } },
          { type: 'if', cond: { type: 'amount', amount: discarded, op: 'ge', n: 1 }, effects: [], else: [{ type: 'lose_life', amount: Number(discardOrLose[3]), who: { ref: 'you' } }] },
        ],
      }];
    }
  }
  // Starfall Invocation: "return a creature card put into your graveyard this way to the battlefield under your control".
  const backThisWay = /^[Rr]eturn (?:a|an) (.+? card) put into your graveyard this way to the battlefield( tapped)?(?: under your control)?$/.exec(s);
  if (backThisWay) {
    const pf = parseFilter(`${backThisWay[1]!} in your graveyard`, b.clone());
    if (pf && !pf.plural && pf.filter.zone === 'graveyard' && !pf.filter.controller) {
      b.it = { ref: 'chosen_object' };
      return [
        { type: 'choose_object', filter: { ...pf.filter, owner: 'you', token: false }, among: { ref: 'graveyard_this_way' } },
        { type: 'move', what: { ref: 'chosen_object' }, to: 'battlefield', ...(backThisWay[2] ? { tapped: true } : {}) },
      ];
    }
  }
  // Maelstrom Pulse: "Destroy target nonland permanent and all other permanents with the same name as that permanent" —
  // every permanent with its name, at once (CR 608.2h: its name as the spell resolves).
  // Echoing Truth: "Return target nonland permanent and all other permanents with the same name as that permanent to their
  // owners' hands"; Bile Blight: "Target creature and all other creatures with the same name as that creature get -3/-3".
  // Homing Lightning: "… to target creature and each other creature with the same name as that creature".
  const andSameName = /^(.*?)\b([Tt]arget [^,]+?) and (?:all other (permanents|creatures)|each other (permanent|creature)) with the same name(?: as that (?:permanent|creature))?\b(.*)$/.exec(s);
  if (andSameName) andSameName.splice(3, 2, andSameName[3] ?? (andSameName[4] ? `${andSameName[4]}s` : undefined)!);
  if (andSameName) {
    const out = attempt(b, (b) => {
      const fx = parseSentence(`${andSameName[1]}${andSameName[2]}${andSameName[4]}`, b);
      const index = b.targets.length - 1;
      if (!fx || index < 0) return null;
      const all: Ref = { ref: 'all', filter: { sameNameAs: { ref: 'target', index }, ...(andSameName[3] === 'creatures' ? { types: ['Creature'] } : {}) } };
      const me = JSON.stringify({ ref: 'target', index });
      // The one effect on the target, and nothing else about it.
      if (JSON.stringify(fx).split(me).length !== 2) return null;
      const swapped = fx.map((e) => {
        const k = ['what', 'to'].find((key) => JSON.stringify(e[key]) === me);
        return k ? { ...e, [k]: all } : e;
      });
      return JSON.stringify(swapped).includes('"ref":"all","filter":{"sameNameAs"') ? swapped : null;
    });
    if (out) return out;
  }
  // Mana Breach: "that player returns a land they control to its owner's hand"; "Each player returns a creature they control
  // to its owner's hand" — each chooses one of their own.
  const theyReturn = /^(.+?) returns? (a|an|one|two) (.+?) (?:they|he or she) controls? to (?:its|their) owners?'s? hands?$/.exec(s);
  if (theyReturn && !/^(?:You|you)$/.test(theyReturn[1]!)) {
    const r = attempt(b, (b) => {
      const who = parsePlayerRef(theyReturn[1]!, b);
      if (!who || who.ref === 'you') return null;
      const inner = parseSentence(`Return ${theyReturn[2]} ${theyReturn[3]} you control to ${theyReturn[2] === 'two' ? "their owners' hands" : "its owner's hand"}`, b);
      return inner?.length === 1 && inner[0]!.type === 'move_chosen' ? [{ type: 'players_do', players: who, effects: inner }] : null;
    });
    if (r) return r;
  }
  // Ominous Cemetery: "Target creature's owner shuffles it into their library."
  const ownerShuffles = /^(Target .+?)'s owner shuffles it into their library$/.exec(s);
  if (ownerShuffles) return parseSentence(`The owner of ${ownerShuffles[1]!.replace(/^T/, 't')} shuffles it into their library`, b);
  // Summon: Fenrir, Chocobo Camp: "When you next cast a creature spell this turn, that creature enters with an additional
  // +1/+1 counter on it" — the spell, as it resolves (CR 614.1c).
  const spellEnters = b.it?.ref === 'trigger_object' ? /^(?:That creature|It) enters with (an|two|three) additional (\S+) counters? on it$/.exec(s) : null;
  if (spellEnters) {
    const n = parseAmount(spellEnters[1] === 'an' ? 'one' : spellEnters[1]!);
    if (typeof n === 'number') return [{ type: 'spell_enter_counters', what: { ref: 'trigger_object' }, counter: spellEnters[2]!, amount: n }];
  }
  // Colossal Grave-Reaver: "Whenever one or more creature cards are put into your graveyard from your library, put one of
  // them onto the battlefield." — one of that batch, still there.
  if (/^[Pp]ut one of them onto the battlefield( tapped)?$/.test(s) && b.named['them']?.ref === 'created') {
    b.it = { ref: 'chosen_object' };
    return [
      { type: 'choose_object', filter: { zone: 'graveyard' }, among: { ref: 'created' } },
      { type: 'move', what: { ref: 'chosen_object' }, to: 'battlefield', ...(/tapped$/.test(s) ? { tapped: true } : {}) },
    ];
  }
  // Oblation: "The owner of target nonland permanent shuffles it into their library, then draws two cards."
  const oblation = /^The owner of (target .+?) shuffles it into their library, then draws (a|one|two|three) cards?$/.exec(s);
  if (oblation) {
    const r = attempt(b, (b) => {
      const first = parseSentence(`The owner of ${oblation[1]} shuffles it into their library`, b);
      const shuffled = first?.length === 1 && first[0]!.type === 'move' && first[0]!.position === 'shuffle' ? (first[0]!.what as Ref) : null;
      const n = parseAmount(oblation[2] === 'a' ? 'one' : oblation[2]!);
      return first && shuffled && typeof n === 'number' ? [...first, { type: 'draw', amount: n, who: { ref: 'owner_of', of: shuffled } }] : null;
    });
    if (r) return r;
  }
  // Exhume: "Each player puts a creature card from their graveyard onto the battlefield" — each chooses their own, and
  // they enter at once under their owners' control.
  // Fall of the Thran: "Each player returns two land cards from their graveyard to the battlefield."
  const exhume = /^[Ee]ach player (?:puts|returns) (a|an|two|three) (.+? cards?(?: with .+?)?) from their graveyard (?:onto|to) the battlefield$/.exec(s);
  if (exhume) {
    const n = /^an?$/.test(exhume[1]!) ? 1 : exhume[1] === 'two' ? 2 : 3;
    const pf = parseFilter(`${exhume[2]} in a graveyard`, b);
    if (!pf || pf.plural !== n > 1) return null;
    const { zone: _z, ...filter } = pf.filter;
    b.it = { ref: 'moved_onto' };
    return [{ type: 'return_from_each_graveyard', filter, ownChoice: true, ...(n > 1 ? { count: n } : {}) }];
  }
  // Gisa, Glorious Resurrector: "put all creature cards exiled with Gisa onto the battlefield under your control".
  const putExiled = /^[Pp]ut (all (?:[a-z]+ )?cards exiled with ~) onto the battlefield under your control$/.exec(s);
  if (putExiled) return parseSentence(`Return ${putExiled[1]} to the battlefield under your control`, b);
  // Elspeth Tirel: "Destroy all other permanents except for lands and tokens"; Slash the Ranks: "Destroy all creatures and
  // planeswalkers except for commanders".
  const exceptKinds = /^(.*?\ball )(other )?(permanents|creatures|creatures and planeswalkers|nonland permanents) except for ((?:lands|tokens|commanders|artifacts|creatures|enchantments)(?: and (?:lands|tokens|commanders|artifacts|creatures|enchantments))?)$/.exec(s);
  if (exceptKinds) {
    const nots = exceptKinds[4]!.split(' and ').map((w) => `non${w.replace(/s$/, '')}`).join(', ');
    return parseSentence(`${exceptKinds[1]}${nots} ${exceptKinds[3]}${exceptKinds[2] ? ' other than ~' : ''}`, b);
  }
  // Whelming Wave: "Return all creatures to their owners' hands except for Krakens, Leviathans, Octopuses, and Serpents."
  const except = /^(.*?\ball )(creatures)\b(.*?) except for ((?:[A-Z][\w-]*, )*(?:and )?[A-Z][\w-]*)$/.exec(s);
  if (except) {
    const subs = except[4]!.split(/, (?:and )?|,? and /).map((w) => subtypeOf(w));
    if (subs.every(Boolean)) return parseSentence(`${except[1]}${subs.map((x) => `non-${x}`).join(', ')} ${except[2]}${except[3]}`, b);
  }
  // Agadeem's Awakening: "Return from your graveyard to the battlefield any number of target creature cards that each have
  // a different mana value X or less."
  const distinctMV = /^Return from your graveyard to the battlefield any number of target (.+?) cards that each have a different mana value (X|\d+) or less$/.exec(s);
  if (distinctMV) {
    const r = attempt(b, (b) => {
      const from = b.targets.length;
      const inner = parseSentence(`Return any number of target ${distinctMV[1]} cards with mana value ${distinctMV[2]} or less from your graveyard to the battlefield`, b);
      const spec = b.targets[from];
      if (!inner || !spec || b.targets.length !== from + 1) return null;
      spec.distinctManaValues = true;
      return inner;
    });
    if (r) return r;
  }
  // Flames of Rebirth: "Return any number of target creature cards with total mana value 6 or less from your graveyard to the
  // battlefield" — the targets together (CR 601.2c).
  const totalMV = /^(.*?\b(?:any number of|up to (?:two|three|four|five|X)) target .+?) with total mana value (\d+|X) or less\b(.*)$/.exec(s);
  if (totalMV) {
    const r = attempt(b, (b) => {
      const from = b.targets.length;
      const inner = parseSentence(`${totalMV[1]}${totalMV[3]}`, b);
      const spec = b.targets[from];
      if (!inner || !spec || b.targets.length !== from + 1 || !(spec.upTo || spec.countX || (spec.count ?? 1) > 1)) return null;
      spec.maxTotalMV = parseAmount(totalMV[2]!) as number | 'X';
      return inner;
    });
    if (r) return r;
  }
  // Vraska, Betrayal's Sting: "If target player has fewer than nine poison counters, they get a number of poison counters
  // equal to the difference." — none if they have that many already.
  const upTo = /^If (target player|target opponent) has fewer than (\w+) poison counters, they get a number of poison counters equal to the difference$/.exec(s);
  if (upTo) {
    const who = parsePlayerRef(upTo[1]!, b);
    const n = parseAmount(upTo[2]!);
    if (who && typeof n === 'number') return [{ type: 'get_counters', who, counter: 'poison', amount: { kind: 'counters', of: who, counter: 'poison', times: -1, plus: n } }];
  }
  // Chainer, Nightmare Adept: "You may cast a creature spell from your graveyard this turn." — one spell.
  const yardSpell = /^[Yy]ou may cast (?:a|an) (.+?) spell from your graveyard this turn$/.exec(s);
  if (yardSpell) {
    const pf = parseFilter(`${yardSpell[1]} card in your graveyard`, b);
    if (pf && !pf.plural && pf.filter.zone === 'graveyard') {
      const { zone: _z, owner: _o, ...filter } = pf.filter;
      return [{ type: 'grant_graveyard_cast', filter }];
    }
  }
  // Ojer Pakpatiq: "Whenever you cast an instant spell from your hand, it gains rebound." (Taigam: "that spell gains
  // rebound") — the spell cast.
  if (/^(?:[Ii]t|[Tt]hat spell) gains rebound$/.test(s) && b.it?.ref === 'trigger_object') return [{ type: 'grant_rebound', what: b.it }];
  // Containment Construct: "If you do, you may play that card this turn." — the card the instruction before moved.
  const playIt = /^[Yy]ou may (play|cast) (that card|it) (this turn|until the end of your next turn)$/.exec(s);
  if (playIt) {
    const what = attempt(b, (b) => {
      const r = parseObjectRef(playIt[2]!, b);
      return r && !r.plural && ['trigger_object', 'target', 'chosen_object', 'milled_this_way'].includes(r.ref.ref) ? r : null;
    });
    if (what) return [{ type: 'grant_play', what: what.ref, mode: playIt[1], ...(playIt[3] === 'this turn' ? {} : { until: 'next_turn' }) }];
  }
  // Braids, Arisen Nightmare (joined above): each opponent may do it; each who doesn't is punished.
  const punisher = /^[Ee]ach opponent may (.+?); for each opponent who doesn't, (.+)$/.exec(s);
  if (punisher) {
    const r = attempt(b, (b) => {
      const asThem = capitalise(
        punisher[1]!
          .replace(/ of their choice\b/g, '')
          .replace(/ that shares a card type with it$/, ' that shares a card type with the sacrificed permanent')
          .replace(/\btheir\b/g, 'your')
          .replace(/\bthey (control|own)\b/g, 'you $1'),
      );
      if (/\b(?:they|them|their)\b/.test(asThem)) return null;
      const theirs = parseSentence(asThem, b);
      if (!theirs) return null;
      const saved = b.player;
      b.player = { ref: 'each_player' };
      const declined = parseSentence(capitalise(punisher[2]!), b);
      b.player = saved;
      return declined ? [{ type: 'opponents_may', effects: theirs, declined }] : null;
    });
    if (r) return r;
  }
  // Will of the Jeskai: "Each player may discard their hand and draw five cards." — each in turn chooses (CR 101.4).
  // Heartwood Storyteller: "each of that player's opponents may draw a card".
  const thatPlayer = b.named['that player'] ?? (b.player?.ref === 'trigger_player' ? b.player : null);
  const eachMay = /^Each (player|opponent) may (.+)$/.exec(s) ?? (thatPlayer ? /^Each of that player's (opponents) may (.+)$/.exec(s) : null);
  if (eachMay) {
    const r = attempt(b, (b) => {
      const asThem = capitalise(eachMay[2]!.replace(/ of their choice\b/g, '').replace(/\btheir\b/g, 'your').replace(/\bthey (control|own)\b/g, 'you $1'));
      // Veteran Explorer: "… search their library for up to two basic land cards, put them onto the battlefield" — the cards.
      if (/\b(?:they|them|their|that player)\b/.test(asThem.replace(/^(Search your library for [^,]+), put them /, '$1, '))) return null;
      const before = b.targets.length;
      const theirs = parseSentence(asThem, b);
      if (!theirs || b.targets.length !== before || JSON.stringify(theirs).includes('"ref":"target"')) return null;
      return [{ type: 'opponents_may', effects: theirs, ...(eachMay[1] === 'player' ? { everyone: true } : {}), ...(eachMay[1] === 'opponents' ? { opponentsOf: thatPlayer! } : {}) }];
    });
    if (r) return r;
  }
  // Imperial Edict: "Target opponent chooses a creature they control. Destroy that creature."; Scrounge: "Target opponent
  // chooses an artifact card in their graveyard. Put that card onto the battlefield under your control." — that player
  // chooses as it resolves (CR 608.2d).
  const theyChoose = /^(Target opponent|Target player) chooses (a|an) (?!card name\b|number\b)(.+?) (they control|in their graveyard)$/.exec(s);
  if (theyChoose) {
    const r = attempt(b, (b) => {
      const chooser = parsePlayerRef(theyChoose[1]!.toLowerCase(), b);
      const pf = chooser ? parseFilter(`${theyChoose[3]} ${theyChoose[4] === 'they control' ? 'you control' : 'in your graveyard'}`, b) : null;
      if (!chooser || !pf || pf.plural || !pf.filter.types?.length) return null;
      b.it = { ref: 'chosen_object' };
      b.player = chooser;
      for (const n of ['that creature', 'that permanent', 'that card', 'that artifact', 'that land']) b.named[n] = { ref: 'chosen_object' };
      return [{ type: 'choose_object', filter: pf.filter, chooser }];
    });
    if (r) return r;
  }
  // Final Showdown: "Choose a creature you control. It gains indestructible until end of turn." — chosen as it resolves,
  // not targeted (CR 608.2c); "it" is that one.
  const chooseOne = /^Choose (a|an|another) (?!target\b)(.+)$/.exec(s);
  if (chooseOne) {
    const r = attempt(b, (b) => {
      const pf = parseFilter(chooseOne[2]!, b);
      if (!pf || pf.plural || pf.filter.zone || !pf.filter.types?.length) return null;
      if (chooseOne[1] === 'another') pf.filter.other = true;
      b.it = { ref: 'chosen_object' };
      for (const n of ['that creature', 'that permanent', 'the chosen creature', 'the chosen permanent']) b.named[n] = { ref: 'chosen_object' };
      return [{ type: 'choose_object', filter: pf.filter }];
    });
    if (r) return r;
  }
  // Baleful Mastery: "an opponent draws a card"; Fateful Handoff: "An opponent gains control of that permanent." — one the
  // controller chooses as it resolves.
  const anOpponent = /^An opponent (?!controls\b|chooses\b|separates\b|may\b)(.+)$/.exec(s);
  if (anOpponent) {
    const r = attempt(b, (b) => {
      const who: Ref = { ref: 'chosen_opponent' };
      const rest = parseSentenceWithSubject(anOpponent[1]!, b, who);
      if (!rest || !JSON.stringify(rest).includes('"chosen_opponent"')) return null;
      b.player = who;
      return [{ type: 'choose_opponent' }, ...rest];
    });
    if (r) return r;
  }
  // Wan Shi Tong: "draw half X cards, rounded down"; Quietus Spike: "that player loses half their life, rounded up";
  // Traumatize: "Target player mills half their library, rounded down."
  const halved = /^(.+), rounded (up|down)$/.exec(s);
  if (halved && /\bhalf\b|\ba third of\b/.test(halved[1]!)) {
    const r = attempt(b, (b) => parseHalved(halved[1]!, halved[2] as 'up' | 'down', b));
    if (r) return r;
  }
  // Six: "Mill three cards. You may put a land card from among them into your hand." Gyruda: "Put a creature card with
  // an even mana value from among the milled cards onto the battlefield under your control." — the cards milled this way.
  // Monster Manual: "then return a creature card milled this way to your hand"; Terra: "Put up to one enchantment card milled
  // this way into your hand"; Wasteful Harvest: "… from among the cards milled this way into your hand".
  const milledText = s
    .replace(/^((?:You may )?(?:[Tt]hen )?)[Rr]eturn (a|an) (.+?) milled this way to your hand$/, '$1Put $2 $3 from among the milled cards into your hand')
    .replace(/ from among the cards milled this way /, ' from among the milled cards ')
    .replace(/^((?:You may )?(?:[Tt]hen )?[Pp]ut (?:a|an|up to (?:one|two|three)|any number of) .+?) milled this way (into your hand)$/, '$1 from among the milled cards $2');
  const fromMilled = /^(You may )?(?:[Tt]hen )?[Pp]ut (a|an|up to (?:one|two|three)|any number of) (.+?) from among (them|those cards|the milled cards) (into your hand|onto the battlefield( tapped)?( under your control)?)$/.exec(milledText);
  if (fromMilled && (b.milled || fromMilled[4] === 'the milled cards')) {
    const many = fromMilled[2]!;
    const to = fromMilled[5]!.startsWith('into') ? 'hand' : 'battlefield';
    const strip = (f: ObjectFilter) => {
      const { zone: _z, owner: _o, ...rest } = f;
      return rest;
    };
    // Sludge Titan: "a creature card and/or a land card" — up to one of each.
    const eachOf = /^(.+? card) and\/or (?:a|an) (.+? card)$/.exec(fromMilled[3]!);
    if (eachOf && (many === 'a' || many === 'an')) {
      const one = parseFilter(`${eachOf[1]} in your library`, b);
      const two = one ? parseFilter(`${eachOf[2]} in your library`, b) : null;
      if (!one || !two || one.plural || two.plural) return null;
      return [{ type: 'put_from_milled', filter: {}, each: [strip(one.filter), strip(two.filter)], amount: 2, to, optional: true, ...(fromMilled[6] ? { tapped: true } : {}) }];
    }
    const n = many === 'any number of' ? 99 : many.startsWith('up to ') ? parseAmount(many.slice(6)) : 1;
    const pf = parseFilter(`${fromMilled[3]} in your library`, b);
    if (typeof n !== 'number' || !pf || pf.plural !== n > 1) return null;
    const filter = strip(pf.filter);
    const optional = Boolean(fromMilled[1]) || n > 1 || many.startsWith('up to ');
    return [{ type: 'put_from_milled', filter, amount: n, to, ...(optional ? { optional: true } : {}), ...(fromMilled[6] ? { tapped: true } : {}) }];
  }
  // Sea Gate Restoration: "You have no maximum hand size for the rest of the game."
  if (/^You have no maximum hand size for the rest of the game$/.test(s)) return [{ type: 'player_effect', who: { ref: 'you' }, rule: 'no_max_hand_size', until: 'game' }];
  // Inspired Idea: "Your maximum hand size is reduced by three for the rest of the game."
  const handLess = /^Your maximum hand size is (reduced|increased) by (one|two|three|four|five|six|seven) for the rest of the game$/.exec(s);
  if (handLess) {
    const n = parseAmount(handLess[2]!) as number;
    return [{ type: 'player_effect', who: { ref: 'you' }, rule: 'hand_size_delta', amount: handLess[1] === 'reduced' ? -n : n, until: 'game' }];
  }
  // Emergence Zone: "You may cast spells this turn as though they had flash." (CR 702.8a)
  if (/^You may cast spells this turn as though they had flash$/.test(s)) return [{ type: 'player_effect', who: { ref: 'you' }, rule: 'flash' }];
  // Blossoming Calm: "You gain hexproof until your next turn."; Everybody Lives!: "Players gain hexproof until end of turn.";
  // Gilded Light: "You gain shroud until end of turn." (CR 702.11c, 702.18)
  const playerWard = /^(You|Players|Each player) gains? (hexproof|shroud) until (end of turn|your next turn)$/.exec(s);
  if (playerWard) return [{ type: 'player_effect', who: playerWard[1] === 'You' ? { ref: 'you' } : { ref: 'players', who: 'each' }, rule: playerWard[2], until: playerWard[3] === 'end of turn' ? 'eot' : 'your_next_turn' }];
  // Roiling Vortex: "Your opponents can't gain life this turn."; Skullcrack: "Players can't gain life this turn." (CR 119.7)
  // Screaming Nemesis: "… they can't gain life for the rest of the game."
  // Stigma Lasher: "Whenever this creature deals damage to a player, that player can't gain life for the rest of the game."
  const noGain = /^(Your opponents|Players|Each opponent|Target player|Target opponent|That player|that player) can't gain life (this turn|for the rest of the game)$/.exec(s);
  if (noGain) {
    const who: Ref | null = noGain[1] === 'Players' ? { ref: 'players', who: 'each' } : /^(?:Your opponents|Each opponent)$/.test(noGain[1]!) ? { ref: 'players', who: 'opponents' } : parsePlayerRef(noGain[1]!.toLowerCase(), b);
    return who ? [{ type: 'player_effect', who, rule: 'cant_gain_life', until: noGain[2] === 'this turn' ? 'eot' : 'game' }] : null;
  }
  // Screaming Nemesis: "If a player is dealt damage this way, they can't gain life for the rest of the game." — the damage's
  // target, if it's a player that was dealt damage.
  if (/^If a player is dealt damage this way, they can't gain life for the rest of the game$/.test(s)) {
    const index = [...b.targets.keys()].reverse().find((i) => b.targets[i]!.what === 'any' || b.targets[i]!.what === 'player');
    if (index === undefined) return null;
    return [{ type: 'if', cond: { type: 'amount', amount: { kind: 'damage_this_way' }, op: 'gt', n: 0 } as ConditionNode, effects: [{ type: 'player_effect', who: { ref: 'target', index }, rule: 'cant_gain_life', until: 'game' }] }];
  }
  // Everybody Lives!: "Players can't lose life this turn and players can't lose the game or win the game this turn.";
  // Courageous Resolve: "you can't lose life this turn, you can't lose the game this turn, and your opponents can't win the
  // game this turn." (CR 119.7, 104.3)
  const noLoss = s.split(/, and |, | and (?=(?:you|players|your opponents) can't)/i);
  if (noLoss.length > 1 || /^(?:You|Players) can't lose life this turn$/.test(s)) {
    const nodes = noLoss.map((c): EffectNode[] | null => {
      const t = c.replace(/^\w/, (x) => x.toLowerCase());
      const players = { ref: 'players', who: 'each' } as Ref;
      if (t === "you can't lose life this turn") return [{ type: 'player_effect', who: { ref: 'you' }, rule: 'cant_lose_life', until: 'eot' }];
      if (t === "players can't lose life this turn") return [{ type: 'player_effect', who: players, rule: 'cant_lose_life', until: 'eot' }];
      if (t === "you can't lose the game this turn") return [{ type: 'player_effect', who: { ref: 'you' }, rule: 'cant_lose', until: 'eot' }];
      if (t === "your opponents can't win the game this turn") return [{ type: 'player_effect', who: { ref: 'you' }, rule: 'opponents_cant_win', until: 'eot' }];
      if (t === "players can't lose the game or win the game this turn") return [{ type: 'player_effect', who: players, rule: 'cant_lose', until: 'eot' }, { type: 'player_effect', who: players, rule: 'opponents_cant_win', until: 'eot' }];
      return null;
    });
    if (nodes.every(Boolean)) return nodes.flat() as EffectNode[];
  }
  // CR 723.1: Time Stop, Sundial of the Infinite: "End the turn."
  if (/^[Ee]nd the turn$/.test(s)) return [{ type: 'end_turn' }];
  // Angel's Grace: "You can't lose the game this turn and your opponents can't win the game this turn."; "Until end of turn,
  // damage that would reduce your life total to less than 1 reduces it to 1 instead."
  if (/^You can't lose the game this turn and your opponents can't win the game this turn$/.test(s)) return [{ type: 'player_effect', who: { ref: 'you' }, rule: 'opponents_cant_win', until: 'eot' }];
  if (/^Until end of turn, damage that would reduce your life total to less than 1 reduces it to 1 instead$/.test(s)) return [{ type: 'player_effect', who: { ref: 'you' }, rule: 'damage_floor', until: 'eot' }];
  // Teferi, Time Raveler: "Until your next turn, you may cast sorcery spells as though they had flash." (CR 702.8a)
  // Winding Canyons: "You may cast creature spells this turn as though they had flash."
  const flashUntil = /^Until (your next turn|end of turn), you may cast (sorcery|creature|instant and sorcery|noncreature) spells as though they had flash$/.exec(s);
  const flashThisTurn = /^You may cast (sorcery|creature|noncreature) spells this turn as though they had flash$/.exec(s);
  if (flashUntil || flashThisTurn) {
    const kind = flashUntil ? flashUntil[2]! : flashThisTurn![1]!;
    const when = flashUntil ? flashUntil[1]! : 'end of turn';
    const pf = parseFilter(`${kind.replace(' and ', ' or ')} spells`, b);
    if (!pf) return null;
    const { zone: _z, ...filter } = pf.filter;
    return [{ type: 'player_effect', who: { ref: 'you' }, rule: 'flash', until: when === 'your next turn' ? 'your_next_turn' : 'eot', filter }];
  }
  // CR 611.2b: "Target creature gets +2/+2 for as long as ~ remains tapped", "Gain control of target creature for as long as ~ remains tapped".
  const whileTapped = / for as long as ~ remains tapped$/.exec(s.replace(/\.$/, ''));
  if (whileTapped) {
    const base = s.replace(/\.$/, '').slice(0, whileTapped.index);
    const durable = (r: EffectNode[] | null) => (r && r.every((x) => x.type === 'modify' || x.type === 'gain_control') ? r : null);
    const inner = attempt(b, (b) => durable(parseSentence(`${base} until end of turn`, b))) ?? attempt(b, (b) => durable(parseSentence(base, b)));
    if (inner) return inner.map((x) => ({ ...x, until: 'source_tapped' }));
  }
  // Palantír of Orthanc: "you mill X cards, where X is the number of influence counters on ~, and that player loses
  // life equal to …" — X belongs to the first instruction; the second follows it.
  const whereAnd = /^(.+?, where X is [^,]+), and ((?:you|that player|they|each opponent|target \w+) .+)$/.exec(s);
  if (whereAnd) {
    const r = attempt(b, (b) => {
      const one = parseSentence(whereAnd[1]!, b);
      const two = one ? parseSentence(capitalise(whereAnd[2]!), b) : null;
      return one && two ? [...one, ...two] : null;
    });
    if (r) return r;
  }
  // Rampant Rejuvenator: "search your library for up to X basic land cards, where X is this creature's power, put them
  // onto the battlefield, then shuffle" — the same as with the definition last.
  const whereMid = /^(.+?), where X is ([^,]+), ((?:put|then|and) .+)$/.exec(s);
  if (whereMid && !/, where X is /.test(whereMid[3]!)) {
    const r = attempt(b, (b) => parseSentence(`${whereMid[1]}, ${whereMid[3]}, where X is ${whereMid[2]}`, b));
    if (r) return r;
  }
  // Lifeblood Hydra: "you gain life and draw cards equal to its power" — the same number for both.
  const gainDraw = /^(.+?) gains? life and draws? cards equal to (.+)$/.exec(s);
  if (gainDraw) {
    const r = attempt(b, (b) => {
      const gain = parseSentence(`${capitalise(gainDraw[1]!)} gain life equal to ${gainDraw[2]}`, b);
      const draw = gain ? parseSentence(`${capitalise(gainDraw[1]!)} draw cards equal to ${gainDraw[2]}`, b) : null;
      return gain && draw ? [...gain, ...draw] : null;
    });
    if (r) return r;
  }
  // "…, where X is the number of creatures you control." (CR 107.3a: X defined by the text)
  const where = /^(.+), where X is (.+)$/.exec(s);
  if (where) {
    return attempt(b, (b) => {
      // "… as this ability resolves": effects count as they resolve anyway (CR 608.2h).
      const what = where[2]!.replace(/ as this (?:ability|spell) resolves$/, '').replace(/ as you activate this ability$/, '');
      // Agility Bobblehead: "Up to X target creatures …, where X is the number of Bobbleheads you control as you activate
      // this ability" — only a target count (counted as targets are chosen) can be counted then.
      const asActivated = what !== where[2]!.replace(/ as this (?:ability|spell) resolves$/, '');
      const onlyCount = (inner: EffectNode[] | null) => !asActivated || (inner !== null && !/"X"|"kind":"x"/.test(JSON.stringify(inner)) && b.targets.some((t) => t.countAmount));
      // Rush of Blood: "Target creature gets +X/+0 until end of turn, where X is its power." — "its" is what the
      // instruction is about, so that's read first.
      if (perEach(what, where[1]!, b)) return null;
      // Pact of the Serpent: "Target player draws X cards and loses X life, where X is the number of creatures they control
      // …" — "they" is that target player, so the instruction is read first.
      const theirs = /\b(?:they|that player)\b/.test(what) && /^[Tt]arget (?:player|opponent)\b/.test(where[1]!.trim());
      if (pointsBack(what, where[1]!) || theirs) {
        const from = b.targets.length;
        const inner = parseSentence(where[1]!, b);
        const expr = inner && parseCount(what, b);
        if (inner && expr) bindTargetsX(b, from, expr);
        if (!onlyCount(inner)) return null;
        return inner && expr ? bindX(inner, expr) : null;
      }
      // Fraying Sanity: "enchanted player mills X cards, where X is the number of cards put into their graveyard …" — "their"
      // is the player the instruction is about.
      const subject = /\btheir\b/.test(what) ? /^(enchanted player|that player|defending player|the chosen player) /i.exec(where[1]!.trim()) : null;
      const about = subject ? parsePlayerRef(subject[1]!, b) : null;
      const keep = b.player;
      if (about) b.player = about;
      const expr = parseCount(what, b);
      b.player = keep;
      const from = b.targets.length;
      const inner = expr && parseSentence(where[1]!, b);
      if (inner && expr) bindTargetsX(b, from, expr);
      if (!onlyCount(inner)) return null;
      return inner && expr ? bindX(inner, expr) : null;
    });
  }
  // Kazuul: "create a 3/3 red Ogre creature token unless that creature's controller pays {3}" — whoever pays, it's never
  // about what the effect would make (that doesn't exist yet): "that creature" is the one named before.
  const payerOf = (text: string, before: Binder, b: Binder): Ref | null => {
    const after = parsePlayerRef(text, b);
    return after && JSON.stringify(after).includes('"ref":"created"') ? parsePlayerRef(text, before) : after;
  };
  // CR 118.12a / CR 119.4: "… unless that player pays 3 life" (or "{2} and 2 life").
  const unlessLife = /^(.+) unless (.+?) (?:pays|pay) (?:((?:\{(?:\d+|[WUBRGC])\})+) and )?(\d+) life$/.exec(s);
  if (unlessLife) {
    const r = attempt(b, (b) => {
      const before = b.clone();
      const inner = parseSentence(unlessLife[1]!, b);
      const payer = inner ? payerOf(unlessLife[2]!, before, b) : null;
      return inner && payer ? [{ type: 'unless_pays', payer, cost: unlessLife[3] ?? '', life: Number(unlessLife[4]), effects: inner }] : null;
    });
    if (r) return r;
  }
  // "… unless that player discards a card" / "sacrifices a creature"; Tergrid's Lantern: "… unless they sacrifice a
  // nonland permanent of their choice or discard a card" (either); "Each opponent loses 3 life unless that player …"
  // (each of them on their own).
  // Coral Atoll: "sacrifice it unless you return an untapped Island you control to its owner's hand"
  const unlessDoes = /^(.+) unless (that player|they|he or she|its controller|that creature's controller|.+?) (discards?|sacrifices?|returns?|taps?) (.+)$/.exec(s);
  if (unlessDoes) {
    const r = attempt(b, (b) => {
      const third = (v: string) => (v.endsWith('s') ? v : `${v}s`);
      const strip = (o: string) => o.replace(/ of their choice$/, '');
      // Indulgent Tormentor: "… unless target opponent sacrifices a creature of their choice or pays 3 life".
      const alt = /^(.+?) or (discards?|sacrifices?|returns?|pays?) (.+)$/.exec(unlessDoes[4]!);
      const parts: [string, string][] = alt ? [[unlessDoes[3]!, alt[1]!], [alt[2]!, alt[3]!]] : [[unlessDoes[3]!, unlessDoes[4]!]];
      // Unnatural Hunger: "unless they sacrifice another creature" means other than the enchanted one, not the Aura.
      if (parts.some(([, o]) => /^another /.test(o)) && /\b(?:Aura|Equipment)\b/.test(b.env.typeLine)) return null;
      // "Each opponent loses 3 life unless that player …": the same thing for each of them.
      const each = /^(each opponent|each player|each other player) (\w+?)s? (.+)$/i.exec(unlessDoes[1]!);
      if (each && /^(?:that player|they|he or she)$/.test(unlessDoes[2]!)) {
        const players = parsePlayerRef(each[1]!.toLowerCase(), b);
        const inner = players ? parseSentence(`You ${each[2]} ${each[3]}`.replace(/^You lose(?:s)? /, 'You lose '), b) : null;
        const actions = inner ? parts.map(([v, o]) => attempt(b, (b) => parseClause(`${v.replace(/s$/, '')} ${strip(o)}`, b, { ref: 'you' }))) : [];
        if (!players || !inner || actions.some((a) => !a)) return null;
        return [{ type: 'unless_does', perPlayer: players, actions: actions.map((a) => a!.effects), effects: inner }];
      }
      const before = b.clone();
      const inner = parseSentence(unlessDoes[1]!, b);
      const payer = inner ? payerOf(unlessDoes[2]!, before, b) : null;
      if (!inner || !payer || payer.ref === 'players') return null;
      // "unless you return an untapped Island you control to its owner's hand" — one you choose (move_chosen).
      // Command Bridge: "sacrifice it unless you tap an untapped permanent you control" — one the payer chooses.
      const tapOne = (o: string) => {
        const m = /^(a|an|one|two|three) untapped (.+? you control)$/.exec(o);
        const pf = m ? parseFilter(m[2]!, b.clone()) : null;
        return m && pf && !pf.filter.zone && payer.ref === 'you' ? { effects: [{ type: 'tap_choice', filter: pf.filter, amount: m[1] === 'an' ? 1 : parseAmount(m[1]!) as number } as EffectNode] } : null;
      };
      const payLife = (o: string) => {
        const m = /^(\d+) life$/.exec(o);
        return m ? { effects: [{ type: 'lose_life', amount: Number(m[1]), who: payer, paid: true } as EffectNode] } : null;
      };
      const actions = parts.map(([v, o]) =>
        /^pays?$/.test(v) ? payLife(o) : /^taps?$/.test(v) ? tapOne(o) : /^returns?$/.test(v) ? (payer.ref === 'you' ? attempt(b, (b) => { const e = parseSentence(`Return ${strip(o)}`, b); return e?.length === 1 && e[0]!.type === 'move_chosen' ? { effects: e } : null; }) : null) : attempt(b, (b) => parseClause(`${third(v)} ${strip(o)}`, b, payer)),
      );
      if (actions.some((a) => !a)) return null;
      return actions.length === 1 ? [{ type: 'unless_does', payer, action: actions[0]!.effects, effects: inner }] : [{ type: 'unless_does', payer, actions: actions.map((a) => a!.effects), effects: inner }];
    });
    if (r) return r;
  }
  // Volatile Stormdrake: "… unless you pay an amount of {E} equal to its mana value" (CR 107.14) — counted as it resolves.
  const unlessEnergy = /^(.+) unless (.+?) (?:pays|pay) an amount of \{E\} equal to (.+)$/.exec(s);
  if (unlessEnergy) {
    const r = attempt(b, (b) => {
      // "you get {E}{E}{E}{E}, then sacrifice that creature unless …" — the choice is about the last part only.
      const then = /^(.+), then (.+)$/.exec(unlessEnergy[1]!);
      const head = then ? parseSentence(then[1]!, b) : [];
      const before = b.clone();
      const inner = head ? parseSentence(capitalise(then ? then[2]! : unlessEnergy[1]!), b) : null;
      const payer = inner ? payerOf(unlessEnergy[2]!, before, b) : null;
      const n = payer && payer.ref !== 'players' ? parseCount(unlessEnergy[3]!, b) : null;
      return head && inner && payer && n ? [...head, { type: 'unless_pays', payer, cost: '', costEnergy: n, effects: inner }] : null;
    });
    if (r) return r;
  }
  // Circular Logic: "Counter target spell unless its controller pays {1} for each card in your graveyard"; Spell Stutter:
  // "{2} plus an additional {1} for each Faerie you control" — generic mana, counted as it resolves.
  const unlessEach = /^(.+) unless (.+?) pays \{(\d+)\}(?: plus an additional \{(\d+)\})? for each (.+)$/.exec(s);
  if (unlessEach) {
    const r = attempt(b, (b) => {
      const before = b.clone();
      const inner = parseSentence(unlessEach[1]!, b);
      const payer = inner ? payerOf(unlessEach[2]!, before, b) : null;
      const per = payer && payer.ref !== 'players' ? parseForEach(unlessEach[5]!, b) : null;
      if (!inner || !payer || !per) return null;
      const each = Number(unlessEach[4] ?? unlessEach[3]);
      const base = unlessEach[4] ? Number(unlessEach[3]) : 0;
      const costX = { ...per, times: (per.times ?? 1) * each, ...(base ? { plus: (per.plus ?? 0) + base } : {}) } as AmountExpr;
      return [{ type: 'unless_pays', payer, cost: '', costX, effects: inner }];
    });
    if (r) return r;
  }
  // CR 118.12a: "[Do something] unless [a player] pays [cost]." — mana, or energy (CR 107.14).
  const unless = /^(.+) unless (.+?) (?:pays|pay) ((?:\{(?:\d+|X|[WUBRGC]|[WUBRG2]\/[WUBRG])\})+|(?:\{E\})+)$/.exec(s);
  if (unless) {
    return attempt(b, (b) => {
      const before = b.clone();
      const inner = parseSentence(unless[1]!, b);
      const payer = inner ? payerOf(unless[2]!, before, b) : null;
      // "unless that player pays {X}, where X is …" (Esper Sentinel): X generic mana, counted as it resolves.
      if (unless[3] === '{X}') return inner && payer ? [{ type: 'unless_pays', payer, cost: '', costX: 'X', effects: inner }] : null;
      if (/\{X\}/.test(unless[3]!)) return null;
      return inner && payer ? [{ type: 'unless_pays', payer, cost: unless[3]!, effects: inner }] : null;
    });
  }
  // "Then discard a card unless this spell was cast using teamwork." — a condition, not a choice (CR 608.2c).
  const unlessCond = /^(.+) unless (.+)$/.exec(s);
  if (unlessCond) {
    const r = attempt(b, (b) => {
      const cond = parseCondition(unlessCond[2]!, b);
      // Katara, Seeking Revenge: "draw a card, then discard a card unless her additional cost was paid" — the last
      // instruction only.
      const cut = unlessCond[1]!.lastIndexOf(', then ');
      const first = cond && cut > 0 ? parseSentence(unlessCond[1]!.slice(0, cut), b) : [];
      const inner = cond && first ? parseSentence(cut > 0 ? capitalise(unlessCond[1]!.slice(cut + 7)) : unlessCond[1]!, b) : null;
      return cond && first && inner ? [...first, { type: 'if', cond, effects: [], else: inner }] : null;
    });
    if (r) return r;
  }
  // CR 608.2g: "You may cast it without paying its mana cost" — cast during resolution, timing ignored.
  // CR 305.2: "You may play an additional land this turn."
  // Summer Bloom: "You may play up to three additional lands this turn." (the same: up to that many more).
  const extraLand = /^(You|Each player) may play (?:up to )?(an|two|three) additional lands? this turn$/.exec(s);
  if (extraLand) return [{ type: 'extra_land', who: { ref: extraLand[1] === 'You' ? 'you' : 'players' }, ...(extraLand[2] !== 'an' ? { amount: extraLand[2] === 'two' ? 2 : 3 } : {}) }];
  // Rishkar's Expertise: "You may cast a spell with mana value 5 or less from your hand without paying its mana cost."
  // Buster Sword: "you may cast a spell from your hand with mana value less than or equal to that damage without paying its
  // mana cost" — the same, with the quality after "from your hand".
  const fromHand =
    /^[Yy]ou may cast (?:a|an) (.+? )?spell( with mana value (?:\d+|X) or less)? from your hand without paying its mana cost$/.exec(s) ??
    /^[Yy]ou may cast (?:a|an) (.+? )?spell from your hand( with mana value (?:\d+ or less|less than or equal to .+?))? without paying its mana cost$/.exec(s);
  if (fromHand) {
    const r = attempt(b, (b) => {
      const noun = `${(fromHand[1] ?? '').trim() ? `${fromHand[1]!.trim()} card` : 'card'}${fromHand[2] ?? ''} in your hand`;
      const pf = parseFilter(noun, b);
      if (!pf || pf.plural) return null;
      const { zone: _z, owner: _o, ...filter } = pf.filter;
      return [{ type: 'cast_from_hand', filter }];
    });
    if (r) return r;
  }
  // Dauthi Voidwalker: "Choose an exiled card an opponent owns with a void counter on it. You may play it this turn
  // without paying its mana cost." (read as one: see the sentence loop)
  const chooseExiled = /^[Cc]hoose an exiled card (an opponent owns|you own) with an? (\S+) counter on it\. You may play it this turn without paying its mana cost$/.exec(s);
  if (chooseExiled) {
    return [{ type: 'play_exiled', filter: { zone: 'exile', owner: chooseExiled[1] === 'you own' ? 'you' : 'opponent', counter: chooseExiled[2]! }, free: true }];
  }
  // Etali, Primal Storm: "you may cast any number of spells from among those cards without paying their mana costs"
  const castAmong = /^[Yy]ou may cast any number of spells from among (?:those cards|them|the exiled cards|the nonland cards exiled this way) without paying their mana costs$/.exec(s);
  if (castAmong && b.it?.ref === 'created') return [{ type: 'cast_among_free', what: { ref: 'created' } }];
  // Hideaway: "You may play the exiled card without paying its mana cost." — a land, too.
  const playFree = /^[Yy]ou may play (the exiled card|that card|it) without paying its mana cost$/.exec(s);
  if (playFree) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(playFree[1]!, b);
      return what && !what.plural ? [{ type: 'play_free', what: what.ref }] : null;
    });
    if (r) return r;
  }
  const free = /^[Yy]ou may cast (.+?) without paying (?:its|that spell's|~'s) mana cost$/.exec(s);
  if (free) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(free[1]!.replace(/ from (?:your|a|an opponent's|that player's) graveyard$/, (m) => m), b);
      if (!what || what.plural) return null;
      // Fierce Guardianship: "If you control a commander, you may cast this spell without paying its mana cost." is an
      // alternative cost (CR 118.9), never something the spell does as it resolves.
      if (what.ref.ref === 'self' && /\b(?:Instant|Sorcery)\b/.test(b.env.typeLine)) return null;
      return [{ type: 'cast_free', what: what.ref }];
    });
    if (r) return r;
  }
  // "You may have it deal damage equal to its power to target creature", "you may have that player lose 1 life":
  // the object or player does it, if you choose.
  const mayHave = /^[Yy]ou may have (.+)$/.exec(s);
  if (mayHave) {
    const words = mayHave[1]!.split(' ');
    for (let i = 1; i < words.length; i++) {
      const verb = HAVE_VERBS[words[i]!];
      if (!verb) continue;
      const sentence = `${capitalise(words.slice(0, i).join(' '))} ${verb} ${words.slice(i + 1).join(' ')}`.trim();
      const r = attempt(b, (b) => parseSentence(sentence, b));
      if (r) return [{ type: 'may', effects: r }];
    }
  }
  const may = /^[Yy]ou may (.+)$/.exec(s);
  if (may) {
    // Tato Farmer: "you may get two rad counters" — "you get …".
    const inner = attempt(b, (b) => parseSentence(may[1]!, b)) ?? (/^get /.test(may[1]!) ? attempt(b, (b) => parseSentence(`You ${may[1]}`, b)) : null);
    return inner ? [{ type: 'may', effects: inner }] : null;
  }
  // CR 707.2: "~ becomes a copy of target creature until end of turn, except it has this ability",
  // "you may have ~ become a copy of that creature", "Until end of turn, ~ becomes a copy of …".
  const becomeCopy =
    /^(?:[Hh]ave )?(.+?) (?:becomes?|become) a copy of (.+?)(?: (until end of turn))?(?:, except (.+))?$/.exec(s) ??
    /^[Uu]ntil end of turn, (.+?) (?:becomes?|become) a copy of (.+?)()(?:, except (.+))?$/.exec(s);
  if (becomeCopy && !/^[Uu]ntil /.test(becomeCopy[1]!)) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(becomeCopy[1]!, b);
      const of = what ? parseObjectRef(becomeCopy[2]!, b) : null;
      if (!what || !of || of.plural) return null;
      const except = becomeCopy[4] ? parseCopyExcept(becomeCopy[4], b) : undefined;
      // "enters with an additional counter" applies only as a permanent enters as a copy.
      if ((becomeCopy[4] && !except) || except?.entersWith) return null;
      const until = becomeCopy[3] || /^[Uu]ntil end of turn, /.test(s) ? 'eot' : undefined;
      return [{ type: 'become_copy', what: what.ref, of: of.ref, ...(until ? { until } : {}), ...(except ? { except } : {}) }];
    });
    if (r) return r;
  }
  // CR 707.10: "Copy target instant or sorcery spell", "copy that spell twice", "copy it for each …",
  // "Copy target activated or triggered ability you control", "copy that ability".
  // Storm of Saruman: "copy it, except the copy isn't legendary" (CR 707.9b).
  const nonlegendary = /, except the copy isn't legendary$/.test(s);
  // Storm King's Thunder: "copy that spell X times" — the X paid for the spell that made the delayed trigger.
  const copy = /^[Cc]opy (.+?)(?: (twice|three times|X times)| for each (.+))?$/.exec(s.replace(/, except the copy isn't legendary$/, ''));
  if (copy && (!/ ability$/.test(copy[1]!) || /^(?:target .+|that) ability$/.test(copy[1]!)) && !(nonlegendary && / ability$/.test(copy[1]!))) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(copy[1]!, b);
      if (!what || what.plural) return null;
      // Only spells and abilities: a target on the stack, the spell or ability that triggered it, or this spell.
      const spec = what.ref.ref === 'target' ? b.targets[what.ref.index] : undefined;
      if (spec && spec.what !== 'ability' && spec.filter?.zone !== 'stack') return null;
      if (!['target', 'trigger_object', 'self'].includes(what.ref.ref)) return null;
      const amount = copy[2] ? (copy[2] === 'twice' ? 2 : copy[2] === 'X times' ? 'X' : 3) : copy[3] ? parseForEach(copy[3], b) : 1;
      if (!amount) return null;
      return [{ type: 'copy_spell', what: what.ref, ...(amount !== 1 ? { amount } : {}), ...(nonlegendary ? { except: { nonlegendary: true } } : {}) }];
    });
    if (r) return r;
  }
  // Glissa Sunslayer: "Remove up to three counters from target permanent" — of any kinds (CR 122.8).
  const removeAny = /^[Rr]emove (up to )?(a|an|one|two|three|four|five|six|X|all) counters? from (.+)$/.exec(s);
  if (removeAny) {
    const r = attempt(b, (b) => {
      const all = removeAny[2] === 'all';
      if (all && removeAny[1]) return null;
      const what = parseObjectRef(removeAny[3]!, b);
      const amount = all ? 'all' : parseAmount(removeAny[2]!);
      if (!what || amount === null || amount === undefined || (what.plural && !all)) return null;
      return [{ type: 'remove_counters', what: what.ref, amount, ...(removeAny[1] ? { upTo: true } : {}) }];
    });
    if (r) return r;
  }
  // Blood Hound: "remove all +1/+1 counters from this creature"; Aurification: "… from all creatures".
  const removeKind = /^[Rr]emove all (\S+) counters from (.+)$/.exec(s);
  if (removeKind && removeKind[1] !== 'the') {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(removeKind[2]!, b);
      return what ? [{ type: 'remove_counters', what: what.ref, counter: removeKind[1]!, amount: 'all' }] : null;
    });
    if (r) return r;
  }
  // "Remove a time counter from it" (vanishing, CR 702.63a).
  // Protean Hydra: "prevent that damage and remove that many +1/+1 counters from it" — the damage prevented.
  const remove = /^[Rr]emove (a|an|one|two|three|\d+|that many) (\S+) counters? from (.+)$/.exec(s);
  if (remove && (remove[1] !== 'that many' || b.eventAmount)) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(remove[3]!, b);
      const amount = remove[1] === 'that many' ? { kind: 'event' as const } : parseAmount(remove[1]!);
      return what && !what.plural && (typeof amount === 'number' || remove[1] === 'that many') ? [{ type: 'remove_counters', what: what.ref, counter: remove[2]!, amount }] : null;
    });
    if (r) return r;
  }
  // CR 731.1: "It becomes night." / "it becomes day"
  const becomes = /^[Ii]t becomes (day|night)$/.exec(s);
  if (becomes) return [{ type: 'day_night', to: becomes[1] }];
  // CR 702.171a (saddle): "This permanent becomes saddled until end of turn."
  // CR 701.15a: "Goad target creature." / "goad it" / "goad each creature target player controls"
  const goad = /^[Gg]oad (.+)$/.exec(s);
  if (goad) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(goad[1]!, b);
      return what ? [{ type: 'goad', what: what.ref }] : null;
    });
    if (r) return r;
  }
  // CR 701.60a: "Suspect target creature.", "suspect it", "suspect enchanted creature".
  const suspect = /^[Ss]uspect (.+)$/.exec(s);
  if (suspect) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(suspect[1]!, b);
      return what ? [{ type: 'suspect', what: what.ref }] : null;
    });
    if (r) return r;
  }
  // "Investigate twice.", "Proliferate twice." — the action, again.
  const again = /^(.+) (twice|three times)$/.exec(s);
  if (again && /^(?:[Ii]nvestigate|[Pp]roliferate|[Pp]opulate|[Ss]cry \w+|[Ss]urveil \w+|[Aa]mass .+|[Bb]olster \w+|[Cc]onnive|[Ee]xplore|[Ii]ncubate \w+)$/.test(again[1]!)) {
    const once = parseSentence(again[1]!, b);
    if (once) return Array.from({ length: again[2] === 'twice' ? 2 : 3 }, () => structuredClone(once)).flat();
  }
  // Wojek Investigator: "investigate once for each opponent who has more cards in hand than you".
  const onceEach = /^([Ii]nvestigate|[Pp]roliferate|[Pp]opulate|[Ee]xplore|[Cc]onnive) once for each (.+)$/.exec(s);
  if (onceEach) {
    const once = parseSentence(onceEach[1]!, b);
    const times = once ? parseForEach(onceEach[2]!, b) : null;
    if (once && times) return [{ type: 'repeat', times, effects: once }];
  }
  // Ethereal Investigator: "investigate X times, where X is the number of opponents you have".
  const xTimes = /^([Ii]nvestigate|[Pp]roliferate|[Pp]opulate|[Ee]xplore|[Cc]onnive) X times$/.exec(s);
  if (xTimes) {
    const once = parseSentence(xTimes[1]!, b);
    if (once) return [{ type: 'repeat', times: 'X', effects: once }];
  }
  // CR 104.2a / 104.3: "You win the game." / "You lose the game." / "Target player loses the game."
  const result = /^(.+?) (wins?|loses?) the game$/.exec(s);
  if (result) {
    const r = attempt(b, (b) => {
      const who = /^you$/i.test(result[1]!) ? { ref: 'you' as const } : parsePlayerRef(result[1]!, b);
      return who ? [{ type: 'game_result', who, result: result[2]!.startsWith('win') ? 'win' : 'lose' }] : null;
    });
    if (r) return r;
  }
  // CR 500.7: "Take an extra turn after this one." / "Target player takes an extra turn after this one."
  // Time Stretch: "Target player takes two extra turns after this one."
  // Ral Zarek: "Take an extra turn after this one for each coin that comes up heads."
  const extraTurn = /^(?:(.+?) takes?|[Tt]ake) (an|two|three) extra turns? after this one(?: for each (.+))?$/.exec(s);
  if (extraTurn && (extraTurn[2] === 'an') === !/turns after/.test(s)) {
    const r = attempt(b, (b) => {
      const who = extraTurn[1] ? parsePlayerRef(extraTurn[1], b) : { ref: 'you' as const };
      const n = extraTurn[2] === 'an' ? 1 : (parseAmount(extraTurn[2]!) as number);
      const each = extraTurn[3] ? parseForEach(extraTurn[3], b) : null;
      if (extraTurn[3] && (!each || n !== 1)) return null;
      return who ? [{ type: 'extra_turn', who, ...(each ? { count: each } : n > 1 ? { count: n } : {}) }] : null;
    });
    if (r) return r;
  }
  // CR 613.4d (layer 7d): "Switch target creature's power and toughness until end of turn."
  const swap = /^[Ss]witch (.+?)'s? power and toughness until end of turn$/.exec(s);
  if (swap) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(swap[1]!.replace(/^this creature$/, '~'), b);
      return what ? [{ type: 'modify', what: what.ref, until: 'eot', switchPT: true }] : null;
    });
    if (r) return r;
  }
  // "Choose a creature type." / "Choose a color." as it resolves: "the chosen type" afterwards.
  const chooseValue = /^[Cc]hoose a (creature type|color)$/.exec(s);
  if (chooseValue) {
    if (chooseValue[1] === 'color') b.choseColor = true;
    return [{ type: 'choose_value', choice: chooseValue[1] === 'color' ? 'color' : 'creature_type' }];
  }
  // CR 701.24a: "Shuffle.", "That player shuffles.", "then shuffle" (after a draw).
  if (/^(?:Then )?[Ss]huffle(?: your library)?$/.test(s)) return [{ type: 'shuffle', who: { ref: 'you' } }];
  const shuffles = /^(.+?) shuffles(?: their library)?$/.exec(s);
  if (shuffles) {
    const r = attempt(b, (b) => {
      const who = parsePlayerRef(shuffles[1]!, b);
      return who ? [{ type: 'shuffle', who }] : null;
    });
    if (r) return r;
  }
  const thenShuffle = /^(.+), then shuffle$/.exec(s);
  if (thenShuffle && !/^[Ss]earch /.test(s)) {
    const r = attempt(b, (b) => {
      const first = parseSentence(thenShuffle[1]!, b);
      return first ? [...first, { type: 'shuffle', who: { ref: 'you' } }] : null;
    });
    if (r) return r;
  }
  // CR 701.30a: "Populate." — a copy of a creature token you control.
  if (/^[Pp]opulate$/.test(s)) return [{ type: 'populate' }];
  // CR 705.1: "Flip a coin."
  if (/^[Ff]lip a coin$/.test(s)) return [{ type: 'flip_coin' }];
  // Ral Zarek: "Flip five coins."
  const flips = /^[Ff]lip (two|three|four|five|six|seven|eight|nine|ten) coins$/.exec(s);
  if (flips) return [{ type: 'flip_coin', times: parseAmount(flips[1]!) as number }];
  if (/^[Ff]lip a coin until you lose a flip$/.test(s)) return [{ type: 'flip_coin', untilLose: true }];
  // Planar Chaos: "that player flips a coin" — they flip, and win or lose it (CR 705.2).
  const theyFlip = /^(that player|target player|target opponent) flips a coin$/i.exec(s);
  if (theyFlip) {
    const r = attempt(b, (b) => {
      const who = parsePlayerRef(theyFlip[1]!.toLowerCase(), b);
      return who && who.ref !== 'players' && who.ref !== 'you' ? [{ type: 'flip_coin', who }] : null;
    });
    if (r) return r;
  }
  // "When this creature dies, put its counters on target creature you control." (its counters as it died)
  const itsCounters = /^[Pp]ut (?:its|~'s) counters on (.+)$/.exec(s);
  if (itsCounters && b.itIsSource) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(itsCounters[1]!, b);
      return what ? [{ type: 'put_counters', what: what.ref }] : null;
    });
    if (r) return r;
  }
  // The Ozolith: "put those counters on ~" — the counters the creature that left had (CR 603.10a).
  if (/^[Pp]ut those counters on (?:~|this \w+)$/.test(s) && b.it?.ref === 'trigger_object') return [{ type: 'put_lki_counters', to: { ref: 'self' } }];
  // The Ozolith: "move all counters from ~ onto target creature"
  const moveAll = /^[Mm]ove all counters from (.+?) onto (.+)$/.exec(s);
  if (moveAll) {
    const r = attempt(b, (b) => {
      const from = parseObjectRef(moveAll[1]!, b);
      const to = from ? parseObjectRef(moveAll[2]!, b) : null;
      return from && to && !from.plural && !to.plural ? [{ type: 'move_counters', from: from.ref, to: to.ref, counter: 'all' }] : null;
    });
    if (r) return r;
  }
  // Nesting Grounds: "Move a counter from target permanent you control onto a second target permanent." — any kind.
  const moveAny = /^[Mm]ove a counter from (target .+?) onto a second (target .+)$/.exec(s);
  if (moveAny) {
    const r = attempt(b, (b) => {
      const from = parseObjectRef(moveAny[1]!, b);
      const to = from ? parseObjectRef(moveAny[2]!, b) : null;
      return from && to && !from.plural && !to.plural && from.targeted && to.targeted ? [{ type: 'move_counters', from: from.ref, to: to.ref, counter: 'any', amount: 1 }] : null;
    });
    if (r) return r;
  }
  // Forgotten Ancient: "move any number of +1/+1 counters from this creature onto other creatures" — one at a time, onto
  // whichever creatures its controller likes.
  const moveSome = /^[Mm]ove any number of (\S+) counters from ~ onto other creatures$/.exec(s);
  if (moveSome) return [{ type: 'move_counters', from: { ref: 'self' }, to: { ref: 'all', filter: { types: ['Creature'], other: true } }, counter: moveSome[1]!.replace(/−/g, '-'), distribute: true }];
  // CR 702.58a (graft): "move a +1/+1 counter from ~ onto that creature"
  const moveCounter = /^[Mm]ove (a|an|one) (\S+) counter from (.+?) onto (.+)$/.exec(s);
  if (moveCounter) {
    const r = attempt(b, (b) => {
      // "onto that creature" refers back past "from ~", so it's read first.
      const to = parseObjectRef(moveCounter[4]!, b);
      const from = to ? parseObjectRef(moveCounter[3]!, b) : null;
      return from && to ? [{ type: 'move_counters', from: from.ref, to: to.ref, counter: moveCounter[2]!.replace(/−/g, '-'), amount: 1 }] : null;
    });
    if (r) return r;
  }
  // Wishclaw Talisman: "An opponent gains control of this artifact." (the controller chooses which); "Target opponent gains
  // control of ~" (Layer 2, CR 613.1b).
  const theyControl = /^(An opponent|Target opponent|Target player|That player) gains control of (.+)$/.exec(s);
  if (theyControl) {
    const r = attempt(b, (b) => {
      const to = theyControl[1] === 'An opponent' ? null : parsePlayerRef(theyControl[1]!, b);
      if (theyControl[1] !== 'An opponent' && !to) return null;
      const what = parseObjectRef(theyControl[2]!, b);
      return what ? [{ type: 'gain_control', what: what.ref, ...(to ? { to } : { toOpponent: true }) }] : null;
    });
    if (r) return r;
  }
  // CR 701.30b: "Clash with an opponent."
  if (/^[Cc]lash with an opponent$/.test(s)) return [{ type: 'clash' }];
  // CR 701.64a: "Harness The Soul Stone."
  if (/^[Hh]arness ~$/.test(s)) return [{ type: 'harness' }];
  // "Discard all the cards in your hand, then draw that many cards", "discard up to two cards, then draw that many cards",
  // Flux: "Each player discards any number of cards, then draws that many cards." (CR 701.9, 121.1)
  // Valakut Awakening: "Put any number of cards from your hand on the bottom of your library, then draw that many cards plus one."
  const bottom = /^Put any number of cards from your hand on the bottom of your library, then draw that many cards( plus one)?$/.exec(s);
  if (bottom) return [{ type: 'wheel', who: { ref: 'you' }, mode: 'any', to: 'bottom', ...(bottom[1] ? { delta: 1 } : {}) }];
  // Winds of Change: "Each player shuffles the cards from their hand into their library, then draws that many cards."
  // Whirlpool Warrior: "shuffle the cards from your hand into your library, then draw that many cards" — you.
  if (/^[Ss]huffle (?:the cards from your hand|your hand) into your library, then draw that many cards$/.test(s)) return [{ type: 'wheel', who: { ref: 'you' }, mode: 'all', to: 'shuffle' }];
  const shuffleWheel = /^(.+?) shuffles? (?:the cards from (?:their|your) hand|(?:their|your) hand) into (?:their|your) library, then draws? that many cards$/.exec(s);
  if (shuffleWheel) {
    const who = attempt(b, (b) => parsePlayerRef(shuffleWheel[1]!, b));
    if (who) return [{ type: 'wheel', who, mode: 'all', to: 'shuffle' }];
  }
  // Curse of the Pierced Heart: "this Aura deals 1 damage to that player or a planeswalker that player controls" — the
  // source's controller picks one as it resolves (CR 608.2d); with no planeswalker there, it's the player.
  const orWalker = /^(.+? deals .+? damage to )(that player|that opponent|defending player|enchanted player)( or a planeswalker )(?:that player|that opponent|they|defending player|enchanted player) controls?$/.exec(s);
  if (orWalker) {
    const r = attempt(b, (b) => {
      const before = b.clone();
      const toPlayer = parseSentence(`${orWalker[1]}${orWalker[2]}`, b);
      const d = toPlayer?.length === 1 && toPlayer[0]!.type === 'deal_damage' ? toPlayer[0]! : null;
      const who = d?.to as Ref | undefined;
      if (!d || !who || /target/.test(JSON.stringify(who))) return null;
      const c = before.clone();
      const choose = parseSentence(`Choose a planeswalker ${orWalker[2]} controls`, c);
      const hit = choose ? parseSentence(`${capitalise(orWalker[1]!)}it`, c) : null;
      if (!choose || !hit || choose.length !== 1 || choose[0]!.type !== 'choose_object' || JSON.stringify(c.targets) !== JSON.stringify(b.targets)) return null;
      const walkers = { kind: 'count', filter: { types: ['Planeswalker'], controlledBy: who } } as AmountExpr;
      return [
        {
          type: 'if',
          cond: { type: 'amount', amount: walkers, op: 'ge', n: 1 },
          effects: [{ type: 'choose_one', labels: [orWalker[2]!, `a planeswalker ${orWalker[2]} controls`], options: [toPlayer!, [...choose, ...hit]] }],
          else: toPlayer!,
        } as EffectNode,
      ];
    });
    if (r) return r;
  }
  // Steel Seraph: "target creature you control gains your choice of flying, vigilance, or lifelink until end of turn" —
  // chosen as it resolves (CR 608.2d); the same object whichever is chosen.
  const choiceOf = /^(.*?\b(?:gains?|has|have)) your choice of ((?:[a-z][\w ]*?, )*[a-z][\w ]*?,? or [a-z][\w ]*?)( until end of turn)?$/.exec(s);
  if (choiceOf) {
    const options = choiceOf[2]!.split(/,? or |, /);
    const r = attempt(b, (b) => {
      const before = b.clone();
      const first = parseSentence(`${choiceOf[1]} ${options[0]}${choiceOf[3] ?? ''}`, b);
      if (!first) return null;
      const rest = options.slice(1).map((o) => {
        const c = before.clone();
        const one = parseSentence(`${choiceOf[1]} ${o}${choiceOf[3] ?? ''}`, c);
        return one && JSON.stringify(c.targets) === JSON.stringify(b.targets) ? one : null;
      });
      return rest.every(Boolean) ? [{ type: 'choose_one', labels: options, options: [first, ...(rest as EffectNode[][])] }] : null;
    });
    if (r) return r;
  }
  // The Third Doctor: "create your choice of a Clue token, a Food token, or a Treasure token"; The Night of the Doctor: "Put
  // your choice of a first strike, vigilance, or lifelink counter on it." — chosen as it resolves (CR 608.2d).
  const makeChoice = /^([Cc]reate) your choice of ((?:an? [A-Z]\w+ token, )+an? [A-Z]\w+ token,? or an? [A-Z]\w+ token)$/.exec(s);
  const counterChoice = /^([Pp]ut) your choice of an? ((?:[a-z ]+?, )+[a-z ]+?,? or [a-z ]+?) counter on (.+)$/.exec(s);
  if (makeChoice || counterChoice) {
    const sentences = makeChoice
      ? makeChoice[2]!.split(/,? or |, /).map((one) => `Create ${one}`)
      : counterChoice![2]!.split(/,? or |, /).map((one) => `Put a${/^[aeiou]/.test(one) ? 'n' : ''} ${one} counter on ${counterChoice![3]}`);
    const labels = makeChoice ? makeChoice[2]!.split(/,? or |, /) : counterChoice![2]!.split(/,? or |, /);
    const r = attempt(b, (b) => {
      const before = b.clone();
      const first = parseSentence(sentences[0]!, b);
      if (!first) return null;
      const rest = sentences.slice(1).map((one) => {
        const c = before.clone();
        const parsed = parseSentence(one, c);
        return parsed && JSON.stringify(c.targets) === JSON.stringify(b.targets) ? parsed : null;
      });
      return rest.every(Boolean) ? [{ type: 'choose_one', labels, options: [first, ...(rest as EffectNode[][])] } as EffectNode] : null;
    });
    if (r) return r;
  }
  // Pemmin's Aura: "Enchanted creature gets +1/-1 or -1/+1 until end of turn." — chosen as it resolves (CR 608.2d).
  const ptOr = /^(.+?) gets? ([+-]\d+\/[+-]\d+) or ([+-]\d+\/[+-]\d+) until end of turn$/.exec(s);
  if (ptOr) {
    const r = attempt(b, (b) => {
      const one = parseSentence(`${ptOr[1]} gets ${ptOr[2]} until end of turn`, b);
      const two = one ? parseSentence(`${/\btarget\b/.test(ptOr[1]!) && b.it ? 'It' : ptOr[1]} gets ${ptOr[3]} until end of turn`, b) : null;
      // The same object both ways (one target, not two).
      return one && two && one.length === 1 && two.length === 1 && JSON.stringify(one[0]!.what) === JSON.stringify(two[0]!.what) && b.targets.length <= 1 ? [{ type: 'choose_one', labels: [ptOr[2]!, ptOr[3]!], options: [one, two] }] : null;
    });
    if (r) return r;
  }
  // Liliana of the Dark Realms: "Target creature gets +X/+X or -X/-X until end of turn, where X is …" — chosen as it
  // resolves.
  const upOrDown = /^(.+?) gets \+X\/\+X or -X\/-X until end of turn(, where X is .+)?$/.exec(s);
  if (upOrDown) {
    const r = attempt(b, (b) => {
      const up = parseSentence(`${upOrDown[1]} gets +X/+X until end of turn${upOrDown[2] ?? ''}`, b);
      const down = up && b.it ? parseSentence(`It gets -X/-X until end of turn${upOrDown[2] ?? ''}`, b) : null;
      return up && down ? [{ type: 'choose_one', labels: ['+X/+X', '-X/-X'], options: [up, down] }] : null;
    });
    if (r) return r;
  }
  // Consuming Aberration: "each opponent reveals cards from the top of their library until they reveal a land card, then
  // puts those cards into their graveyard" — each in turn, as "you".
  const theyReveal = /^(each opponent|each player|target opponent|target player) reveals cards from the top of their library until they reveal (?:a|an) (.+?) card, then puts those cards into their graveyard$/i.exec(s);
  if (theyReveal) {
    const r = attempt(b, (b) => {
      const players = parsePlayerRef(theyReveal[1]!.toLowerCase(), b);
      const pf = parseFilter(`${theyReveal[2]} card in your library`, b.clone());
      if (!players || !pf || pf.plural || pf.filter.zone !== 'library') return null;
      const { zone: _z, owner: _o, ...filter } = pf.filter;
      return [{ type: 'players_do', players, effects: [{ type: 'reveal_until', filter, to: 'graveyard', rest: 'graveyard' }] }];
    });
    if (r) return r;
  }
  // Valakut Exploration: "put them into their owner's graveyard, then this enchantment deals that much damage to each
  // opponent" — one for each card put there.
  const muchMoved = !b.eventAmount ? /^(.+? into their owners?'s? graveyards?), then ~ deals that much damage to (.+)$/.exec(s) : null;
  if (muchMoved) {
    const r = attempt(b, (b) => {
      const moved = parseSentence(capitalise(muchMoved[1]!), b);
      if (!moved || moved.length !== 1 || moved[0]!.type !== 'move' || moved[0]!.to !== 'graveyard') return null;
      const dmg = parseSentence(`~ deals X damage to ${muchMoved[2]}`, b);
      return dmg ? [...moved, ...bindX(dmg, { kind: 'moved_this_way', how: 'graveyard' })] : null;
    });
    if (r) return r;
  }
  // Currency Converter: "Put a card exiled with this artifact into its owner's graveyard." — chosen as it resolves; "it"
  // afterwards is that card.
  if (/^Put a card exiled with ~ into its owner's graveyard$/.test(s)) {
    b.it = { ref: 'chosen_object' };
    return [
      { type: 'choose_object', filter: { zone: 'exile', exiledWithSource: true } },
      { type: 'move', what: { ref: 'chosen_object' }, to: 'graveyard' },
    ];
  }
  // God-Eternal Bontu: "sacrifice any number of other permanents, then draw that many cards".
  const sacDraw = /^[Ss]acrifice (any number of .+?), then draw that many cards$/.exec(s);
  if (sacDraw) {
    const r = attempt(b, (b) => {
      const sac = VERBS.sacrifice!(sacDraw[1]!, { ref: 'you' }, b, true);
      return sac ? [...sac, { type: 'draw', amount: { kind: 'moved_this_way', how: 'sacrificed' }, who: { ref: 'you' } }] : null;
    });
    if (r) return r;
  }
  // Teferi's Puzzle Box: "that player puts the cards in their hand on the bottom of their library in any order, then draws
  // that many cards." — every card, in the order they choose.
  const bottomAll = /^(?:(.+?) puts|Put) (?:all )?the cards in (?:your|their) hand on the bottom of (?:your|their) library in any order, then (?:draws?|draw) that many cards$/.exec(s);
  if (bottomAll) {
    const r = attempt(b, (b) => {
      const who = bottomAll[1] ? parsePlayerRef(bottomAll[1], b) : { ref: 'you' as const };
      return who ? [{ type: 'wheel', who, mode: 'all', to: 'bottom', ordered: true }] : null;
    });
    if (r) return r;
  }
  const wheel = /^(?:(.+?) )?(?:discards?|[Dd]iscard) (all the cards in (?:your|their) hand|any number of cards|up to (\w+) cards), then (?:draws?|draw) that many cards( plus one| minus one)?$/.exec(s);
  if (wheel) {
    const r = attempt(b, (b) => {
      const who = wheel[1] ? parsePlayerRef(wheel[1], b) : { ref: 'you' as const };
      const upTo = wheel[3] ? parseAmount(wheel[3]) : undefined;
      if (!who || (wheel[3] && typeof upTo !== 'number')) return null;
      const mode = wheel[2]!.startsWith('all') ? 'all' : wheel[3] ? 'up_to' : 'any';
      return [{ type: 'wheel', who, mode, ...(typeof upTo === 'number' ? { upTo } : {}), ...(wheel[4] ? { delta: wheel[4] === ' plus one' ? 1 : -1 } : {}) }];
    });
    if (r) return r;
  }
  // Veil of Summer: "Spells you control can't be countered this turn."; "Creature spells you control can't be countered
  // this turn."
  // Domri, Anarch of Bolas: "Creature spells you cast this turn can't be countered." — cast ones (not copies, CR 707.10).
  const noCounter = /^(?:(.+?) )?[Ss]pells you (control can't be countered this turn|cast this turn can't be countered)$/.exec(s);
  if (noCounter) {
    const pf = noCounter[1] ? parseFilter(`${noCounter[1].toLowerCase()} spell`, b) : null;
    if (noCounter[1] && (!pf || pf.plural)) return null;
    const base = pf ? (({ zone: _z, ...f }) => f)(pf.filter) : null;
    const filter = /^cast/.test(noCounter[2]!) ? { ...(base ?? {}), notCopy: true as const } : base;
    return [{ type: 'player_effect', who: { ref: 'you' }, rule: 'spells_uncounterable', until: 'eot', ...(filter ? { filter } : {}) }];
  }
  // Veil of Summer: "You and permanents you control gain hexproof from blue and from black until end of turn."
  const youAndFrom = /^You and (.+?) gain hexproof from (white|blue|black|red|green)(?: and from (white|blue|black|red|green))? until end of turn$/.exec(s);
  if (youAndFrom) {
    const r = attempt(b, (b) => {
      const words = [youAndFrom[2]!, youAndFrom[3]].filter(Boolean) as string[];
      const rest = parseSentence(`${capitalise(youAndFrom[1]!)} gain ${words.map((w) => `hexproof from ${w}`).join(' and ')} until end of turn`, b);
      return rest ? [{ type: 'player_effect', who: { ref: 'you' }, rule: 'hexproof_from', until: 'eot', filter: { colors: words.map((w) => COLOR_WORDS[w]!) } }, ...rest] : null;
    });
    if (r) return r;
  }
  // Cataclysm: "Each player chooses from among the permanents they control an artifact, a creature, an enchantment, and a
  // land, then sacrifices the rest."; Cataclysmic Gearhulk: "… an artifact, a creature, an enchantment, and a planeswalker
  // from among the nonland permanents they control, …"; Liliana: "Each opponent chooses a permanent they control of each
  // permanent type and sacrifices the rest."; Planetary Annihilation: "Each player chooses six lands they control, then
  // sacrifices the rest."
  // Mount Doom: "Choose up to two creatures, then destroy the rest." — any creatures, chosen by you (CR 101.4 isn't needed).
  const chooseDestroy = /^Choose (up to )?(\w+) (.+?),? then destroy the rest$/.exec(s);
  if (chooseDestroy) {
    const r = attempt(b, (b) => {
      const n = chooseDestroy[2] === 'a' || chooseDestroy[2] === 'an' ? 1 : parseAmount(chooseDestroy[2]!);
      const pf = parseFilter(chooseDestroy[3]!, b);
      if (typeof n !== 'number' || !pf || pf.plural !== n > 1 || pf.filter.zone) return null;
      return [{ type: 'keep_choose', who: { ref: 'you' }, pool: pf.filter, count: n, anyController: true, destroy: true, ...(chooseDestroy[1] ? { upTo: true } : {}) } as EffectNode];
    });
    if (r) return r;
  }
  // Divine Reckoning: "Each player chooses a creature they control. Destroy the rest." (read as one: see the sentence loop)
  const keep = /^(.+?) chooses (?:from among the permanents they control )?(.+?)(?: from among the (nonland )?permanents they control)?,? (?:then|and) (sacrifices|destroys) the rest$/.exec(s);
  if (keep) {
    const r = attempt(b, (b) => {
      const who = parsePlayerRef(keep[1]!, b);
      if (!who) return null;
      const pool: ObjectFilter = keep[3] ? { notTypes: ['Land'] } : {};
      if (keep[4] === 'destroys' && !/^(?:up to )?\w+ .+? they control$/.test(keep[2]!)) return null;
      if (keep[2] === 'a permanent they control of each permanent type') {
        return [{ type: 'keep_choose', who, pool, slots: ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'].map((t) => ({ types: [t] })) } as EffectNode];
      }
      const list = /^(?:an? (?:artifact|creature|enchantment|land|planeswalker|battle), )+(?:and )?an? (?:artifact|creature|enchantment|land|planeswalker|battle)$/.test(keep[2]!) ? keep[2]!.split(/, (?:and )?/) : null;
      if (list) return [{ type: 'keep_choose', who, pool, slots: list.map((w) => ({ types: [capitalise(w.replace(/^an? /, ''))] })) } as EffectNode];
      const counted = /^(up to )?(\w+) (.+?) they control$/.exec(keep[2]!);
      if (!counted || keep[3]) return null;
      const n = counted[2] === 'a' || counted[2] === 'an' ? 1 : parseAmount(counted[2]!);
      const pf = parseFilter(counted[3]!, b);
      if (typeof n !== 'number' || !pf || pf.plural !== n > 1 || pf.filter.zone || pf.filter.controller) return null;
      return [{ type: 'keep_choose', who, pool: pf.filter, count: n, ...(counted[1] ? { upTo: true } : {}), ...(keep[4] === 'destroys' ? { destroy: true } : {}) } as EffectNode];
    });
    if (r) return r;
  }
  // Sevinne's Reclamation: "you may copy this spell and may choose a new target for the copy" (CR 707.10c).
  const mayCopy = /^(you may )?copy ~ and may choose (?:a )?new targets? for the copy$/i.exec(s);
  if (mayCopy) {
    const copy: EffectNode = { type: 'copy_spell', what: { ref: 'self' }, newTargets: true };
    return mayCopy[1] ? [{ type: 'may', effects: [copy] }] : [copy];
  }
  // Dawn's Truce: "You and permanents you control gain hexproof until end of turn." (CR 702.11)
  const youAndGain = /^You and (.+?) gain (hexproof|hexproof and indestructible|indestructible and hexproof) until end of turn$/.exec(s);
  if (youAndGain) {
    const r = attempt(b, (b) => {
      const rest = parseSentence(`${capitalise(youAndGain[1]!)} gain ${youAndGain[2]} until end of turn`, b);
      return rest ? [{ type: 'player_effect', who: { ref: 'you' }, rule: 'hexproof' }, ...rest] : null;
    });
    if (r) return r;
  }
  // Homeward Path: "Each player gains control of all creatures they own." (layer 2)
  const ownBack = /^[Ee]ach player gains control of all (.+?) they own$/.exec(s);
  if (ownBack) {
    const r = attempt(b, (b) => {
      const pf = parseFilter(ownBack[1]!, b);
      return pf && pf.plural && !pf.filter.zone ? [{ type: 'gain_control', what: { ref: 'all', filter: pf.filter }, toOwners: true }] : null;
    });
    if (r) return r;
  }
  // Mishra's Bauble: "Look at the top card of target player's library." — nothing changes; the player sees it.
  const lookTop = /^[Ll]ook at the top (card|two cards|three cards) of (target player's|target opponent's|each player's|your) library$/.exec(s);
  if (lookTop && lookTop[2] !== 'each player\'s') {
    const r = attempt(b, (b) => {
      const who = lookTop[2] === 'your' ? ({ ref: 'you' } as Ref) : parsePlayerRef(lookTop[2]!.replace(/'s$/, ''), b);
      return who ? [{ type: 'look_at_top', who, amount: { card: 1, 'two cards': 2, 'three cards': 3 }[lookTop[1]!]! }] : null;
    });
    if (r) return r;
  }
  // "Look at target opponent's hand." / "Target opponent reveals their hand." (CR 701.20a)
  const lookHand = /^[Ll]ook at (.+?)'s? hand$/.exec(s);
  const revealHand = /^(.+?) reveals (?:their|his or her) hand$/.exec(s);
  if (lookHand || revealHand) {
    const r = attempt(b, (b) => {
      const who = parsePlayerRef((lookHand ?? revealHand)![1]!, b);
      return who ? [{ type: 'look_at_hand', who, ...(revealHand ? { reveal: true } : {}) }] : null;
    });
    if (r) return r;
  }
  // "Exile target player's graveyard."
  const exileYard = /^[Ee]xile (target player's|target opponent's|each opponent's|your) graveyard$/.exec(s);
  if (exileYard) return parseSentence(`Exile all cards from ${exileYard[1]} graveyard`, b);
  // Thraben Charm, Stonespeaker Crystal: "Exile any number of target players' graveyards."
  if (/^[Ee]xile any number of target players' graveyards$/.test(s)) {
    const who = b.addTarget({ what: 'player', count: 99, upTo: true, text: "any number of target players" });
    return [{ type: 'move', what: { ref: 'all', filter: { zone: 'graveyard', ownedBy: who } }, to: 'exile' }];
  }
  // "You may tap or untap target creature." / "Tap or untap target permanent."
  const tapOr = /^(You may )?[Tt]ap or untap (.+)$/.exec(s);
  if (tapOr) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(tapOr[2]!, b);
      return what && !what.plural ? [{ type: 'tap_or_untap', what: what.ref, ...(tapOr[1] ? { optional: true } : {}) }] : null;
    });
    if (r) return r;
  }
  // "At the beginning of each player's draw step, that player draws an additional card."
  const additional = /^(.+?) draws? an additional card$/.exec(s);
  if (additional) {
    const r = attempt(b, (b) => {
      const who = /^you$/i.test(additional[1]!) ? { ref: 'you' as const } : parsePlayerRef(additional[1]!, b);
      return who ? [{ type: 'draw', amount: 1, who }] : null;
    });
    if (r) return r;
  }
  // CR 701.39a: "Bolster N"
  const bolster = /^[Bb]olster (\w+)$/.exec(s);
  if (bolster) {
    const amount = parseAmount(bolster[1]!);
    return amount !== null ? [{ type: 'bolster', amount }] : null;
  }
  // CR 701.41a: "Support N" — on a permanent, other target creatures; on an instant or sorcery, any.
  const support = /^[Ss]upport (\w+)$/.exec(s);
  if (support) {
    const n = parseAmount(support[1]!);
    if (typeof n !== 'number' || n < 1) return null;
    const spell = /\b(?:Instant|Sorcery)\b/.test(b.env.typeLine);
    const what = n === 1 ? `up to one ${spell ? '' : 'other '}target creature` : `each of up to ${support[1]} ${spell ? '' : 'other '}target creatures`;
    return parseSentence(`Put a +1/+1 counter on ${what}`, b);
  }
  // CR 701.63a: "it endures N" — its controller creates an N/N white Spirit token unless they put N +1/+1 counters on it.
  // Warden of the Grove: "it endures X, where X is the number of counters on this creature".
  const endure = /^(.+?) endures (\d+|X)$/.exec(s);
  if (endure) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(endure[1]!, b);
      const n = endure[2] === 'X' ? 'X' : Number(endure[2]);
      if (!what || what.plural) return null;
      // CR 701.63b: endure 0 does nothing.
      if (n === 0) return [];
      const token = parseSentence(n === 'X' ? 'Create an X/X white Spirit creature token' : `Create a ${n}/${n} white Spirit creature token`, b.clone());
      if (!token) return null;
      return [{ type: 'may_do', effects: [{ type: 'add_counters', what: what.ref, counter: '+1/+1', amount: n }], then: [], else: token }];
    });
    if (r) return r;
  }
  // "Look at the top four cards of your library, then put them back in any order."
  // Portent, Architects of Will: "… of target player's library, then put them back in any order".
  const reorder = /^[Ll]ook at the top (\w+) cards of (your|target player's|target opponent's) library(?:,| and) then put them back in any order$/.exec(s);
  if (reorder) {
    const amount = parseAmount(reorder[1]!);
    const library = reorder[2] === 'your' ? null : parsePlayerRef(reorder[2]!.replace(/'s$/, ''), b);
    if (reorder[2] !== 'your' && !library) return null;
    if (library) b.player = library;
    // Soothsaying: "{X}: Look at the top X cards of your library, then put them back in any order."
    return typeof amount === 'number' || amount === 'X' ? [{ type: 'reorder_top', amount, ...(library ? { library } : {}) }] : null;
  }
  // Portent: "You may have that player shuffle."
  if (/^You may have that player shuffle$/.test(s) && b.player && b.player.ref === 'target') return [{ type: 'may', effects: [{ type: 'shuffle', who: b.player }] }];
  // CR 701.14a: "Target creature you control fights target creature you don't control." / "… fight each other."
  const fight = /^(.+?) fights (.+)$/.exec(s) ?? /^(.+?) and (.+?) fight each other$/.exec(s);
  if (fight) {
    const r = attempt(b, (b) => {
      const a = parseObjectRef(fight[1]!, b);
      const other = a && !a.plural ? parseObjectRef(fight[2]!, b) : null;
      return a && other && !other.plural ? [{ type: 'fight', a: a.ref, b: other.ref }] : null;
    });
    if (r) return r;
  }
  // "Target creature you control deals damage equal to its power to target creature you don't control." —
  // the creature is the source of the damage (CR 120.3); "… deals damage to itself equal to its power".
  // Polliwallop: "… deals damage equal to twice its power to target creature you don't control".
  const bite = /^(.+?) deals damage equal to (twice )?(?:its|~'s) power to (.+)$/.exec(s) ?? /^(.+?) deals damage to (itself) equal to its power$/.exec(s);
  if (bite && bite.length === 3) bite.splice(2, 0, undefined as unknown as string);
  // (The source itself dealing the damage is the ordinary case, read elsewhere.)
  const sourceItself = bite && (bite[1] === '~' || (/^it$/i.test(bite[1]!) && (b.it?.ref === 'self' || b.itIsSource)));
  if (bite && !sourceItself) {
    const r = attempt(b, (b) => {
      const from = parseObjectRef(bite[1]!, b);
      if (!from || from.plural) return null;
      const to = bite[3] === 'itself' ? [from.ref] : parseRecipients(bite[3]!, b);
      if (!to) return null;
      return to.map((t) => ({ type: 'deal_damage', amount: { kind: 'stat', stat: 'power', of: from.ref, ...(bite[2] ? { times: 2 } : {}) }, to: t, from: from.ref }));
    });
    if (r) return r;
  }
  // Allies at Last: "Up to two target creatures you control each deal damage equal to their power to target creature an
  // opponent controls."; Terrific Team-Up: "They each deal …" — each of them a source of its own damage, all at once (CR 120.3).
  const theyEach = /^(.+?) each deal damage equal to their power to (?!another\b)(.+)$/.exec(s);
  if (theyEach) {
    const r = attempt(b, (b) => {
      const from = parseObjectRef(theyEach[1] === 'They' ? 'they' : theyEach[1]!, b);
      if (!from?.plural || !['target', 'all'].includes(from.ref.ref)) return null;
      const to = parseRecipients(theyEach[2]!, b);
      if (!to || to.length !== 1) return null;
      return [{ type: 'each_deals', from: from.ref, stat: 'power', to: to[0]! } as EffectNode];
    });
    if (r) return r;
  }
  // Rakdos Charm: "Each creature deals 1 damage to its controller."; Wave of Reckoning: "Each creature deals damage to
  // itself equal to its power."; Lukka: "Each creature you control deals damage equal to its power to each opponent."
  // Each of them is the source of its own damage (CR 120.3), all dealt at once.
  const eachN = /^(each .+?) deals (\S+) damage to (.+)$/i.exec(s);
  const each = bite && !bite[2] && /^each /i.test(bite[1]!) ? { subject: bite[1]!, amount: null, to: bite[3]! } : eachN ? { subject: eachN[1]!, amount: eachN[2]!, to: eachN[3]! } : null;
  if (each) {
    const r = attempt(b, (b) => {
      const before = b.it;
      const from = parseObjectRef(each.subject, b);
      if (!from?.plural || from.ref.ref !== 'all') return null;
      b.it = before;
      const amount = each.amount === null ? null : parseAmount(each.amount);
      if (each.amount !== null && typeof amount !== 'number') return null;
      const to = each.to === 'itself' ? 'itself' : each.to === 'its controller' ? 'controller' : parseRecipients(each.to, b);
      if (!to || (Array.isArray(to) && to.length !== 1)) return null;
      return [{ type: 'each_deals', from: from.ref, ...(amount === null ? { stat: 'power' } : { amount }), to: Array.isArray(to) ? to[0]! : to } as EffectNode];
    });
    if (r) return r;
  }
  // "Return a land you control to its owner's hand." — chosen as it resolves, not targeted (CR 608.2d).
  const chosen = /^[Rr]eturn (a|an|another|one|two) (.+?) to (?:its|their) owners?'s? hands?$/.exec(s);
  if (chosen) {
    const r = attempt(b, (b) => {
      const amount = chosen[1] === 'another' ? 1 : parseAmount(chosen[1]!);
      const pf = parseFilter(chosen[2]!, b);
      if (typeof amount !== 'number' || !pf || pf.plural !== amount > 1 || pf.filter.controller !== 'you' || (pf.filter.zone && pf.filter.zone !== 'battlefield')) return null;
      if (chosen[1] === 'another') pf.filter.other = true;
      return [{ type: 'move_chosen', filter: pf.filter, amount, to: 'hand' }];
    });
    if (r) return r;
  }
  // "Target Mount you control becomes saddled until end of turn."
  const saddled = /^(.+?) becomes saddled until end of turn$/.exec(s);
  if (saddled) {
    const what = parseObjectRef(saddled[1]!, b);
    if (what && !what.plural) return [{ type: 'become_saddled', what: what.ref }];
  }
  // CR 702.112a: "it becomes renowned".
  if (/^(?:it|~) becomes renowned$/.test(s)) return [{ type: 'become_renowned' }];
  // CR 722.3a–b: "~ becomes prepared", "Target creature becomes unprepared", "Each creature you control becomes prepared."
  const prep = /^(.+?) becomes? (prepared|unprepared)$/.exec(s);
  if (prep) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(prep[1]!, b);
      return what ? [{ type: prep[2] === 'prepared' ? 'become_prepared' : 'become_unprepared', what: what.ref }] : null;
    });
    if (r) return r;
  }
  // Jace, the Mind Sculptor: "Exile all cards from target player's library" — the whole library.
  const exileLibrary = /^Exile all cards from (target player|target opponent|that player)'s library$/.exec(s);
  if (exileLibrary) {
    const r = attempt(b, (b) => {
      const who = exileLibrary[1] === 'your' ? ({ ref: 'you' } as Ref) : parsePlayerRef(exileLibrary[1]!, b);
      return who ? [{ type: 'exile_top', who, amount: 999 } as EffectNode] : null;
    });
    if (r) return r;
  }
  // Vexing Shusher: "Target spell can't be countered." (for as long as it's that spell, CR 611.2c)
  const spellNoCounter = /^(Target spell|Target creature spell|Target spell you control)(?: or ability)? can't be countered(?: this turn)?$/.exec(s);
  if (spellNoCounter && !/ or ability/.test(s)) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(spellNoCounter[1]!.replace(/^T/, 't'), b);
      return what ? [{ type: 'modify', what: what.ref, rules: ['cant_be_countered'], until: 'eot' } as EffectNode] : null;
    });
    if (r) return r;
  }
  // Vines of Vastwood: "Target creature can't be the target of spells or abilities your opponents control this turn." — this
  // spell's controller's opponents (not hexproof: its own controller may be one of them).
  const shielded = /^(.+?) can't be the targets? of spells or abilities your opponents control this turn$/.exec(s);
  if (shielded) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(shielded[1]!.replace(/^\w/, (c) => c.toLowerCase()), b);
      return what ? [{ type: 'modify', what: what.ref, until: 'eot', keywords: [{ id: 'untargetable_by_opponents' }] } as EffectNode] : null;
    });
    if (r) return r;
  }
  // Derevi, Empyrial Tactician: "{1}{G}{W}{U}: Put Derevi onto the battlefield from the command zone." (it works from there)
  if (/^Put ~ onto the battlefield from the command zone$/.test(s)) {
    b.selfZone = 'command';
    return [{ type: 'move', what: { ref: 'self' }, to: 'battlefield' }];
  }
  // Aetherspouts: "For each attacking creature, its owner puts it on their choice of the top or bottom of their library."
  const eachTopOrBottom = /^For each (.+?), its owner puts it on their choice of the top or bottom of their library$/.exec(s);
  if (eachTopOrBottom) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(`each ${eachTopOrBottom[1]!}`, b);
      return what && what.plural && !what.targeted ? [{ type: 'move', what: what.ref, to: 'library', position: 'choice' }] : null;
    });
    if (r) return r;
  }
  // "Target creature's owner puts it on their choice of the top or bottom of their library."
  // Temporal Cleansing: "The owner of target nonland permanent puts it into their library second from the top or on the
  // bottom."; Wan Shi Tong: "target nonland permanent's owner puts it …".
  const topOrBottom =
    /^(.+?)'s owner puts it on their choice of the top or bottom of their library$/.exec(s) ??
    /^(?:[Tt]he owner of (.+?)|(.+?)'s owner) puts it into their library (second from the top) or on the bottom$/.exec(s);
  if (topOrBottom) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(topOrBottom[1] ?? topOrBottom[2]!, b);
      return what && !what.plural ? [{ type: 'move', what: what.ref, to: 'library', position: 'choice', ...(topOrBottom[3] ? { secondFromTop: true } : {}) }] : null;
    });
    if (r) return r;
  }
  // CR 701.24a: "Each player shuffles their hand and graveyard into their library", "Shuffle your graveyard into your library."
  const shuffleZones = /^(?:(.+?) shuffles|[Ss]huffle) (?:their|your) (hand and graveyard|graveyard and hand|graveyard|hand) into (?:their|your) library(?:, then (?:draws?|draw) (\w+) cards?)?$/.exec(s);
  if (shuffleZones) {
    const r = attempt(b, (b) => {
      const who = shuffleZones[1] ? parsePlayerRef(shuffleZones[1], b) : { ref: 'you' as const };
      if (!who) return null;
      const zones = shuffleZones[2]!.split(' and ');
      const out: EffectNode[] = [{ type: 'shuffle_zones', who, zones }];
      // "…, then draws seven cards" (Timetwister)
      if (shuffleZones[3]) {
        const n = parseAmount(shuffleZones[3]);
        if (typeof n !== 'number') return null;
        out.push({ type: 'draw', who, amount: n });
      }
      return out;
    });
    if (r) return r;
  }
  // Endurance: "up to one target player puts all the cards from their graveyard on the bottom of their library in a random order."
  const yardBottom = /^(.+?) puts? all (?:the )?cards from their graveyard on the bottom of their library in a random order$/.exec(s);
  if (yardBottom) {
    const r = attempt(b, (b) => {
      const who = parsePlayerRef(yardBottom[1]!, b);
      return who ? [{ type: 'move', what: { ref: 'all', filter: { zone: 'graveyard', ownedBy: who } }, to: 'library', position: 'bottom_random' }] : null;
    });
    if (r) return r;
  }
  // Elixir of Immortality: "Shuffle this artifact and your graveyard into their owner's library." — it goes to its
  // owner's library and your graveyard to yours, each shuffled.
  const withYard = /^[Ss]huffle (.+?) and your graveyard into (?:their owner's|your) library$/.exec(s);
  if (withYard) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(withYard[1]!, b);
      if (!what || what.plural || what.ref.ref !== 'self') return null;
      return [
        { type: 'move', what: what.ref, to: 'library', position: 'shuffle' },
        { type: 'shuffle_zones', who: { ref: 'you' }, zones: ['graveyard'] },
      ];
    });
    if (r) return r;
  }
  // "Shuffle ~ into its owner's library", "Its owner shuffles it into their library",
  // "The owner of target permanent shuffles it into their library", "Shuffle that card into your library".
  const shuffleIn =
    /^[Ss]huffle (.+?) into (?:its owner's|their owners'|your) (?:library|libraries)$/.exec(s) ??
    /^(?:[Ii]ts owner|~'s owner) shuffles (it|~|him|her) into their library$/.exec(s);
  const ownerOf = /^[Tt]he owner of (.+?) shuffles it into their library$/.exec(s);
  if (shuffleIn || ownerOf) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef((shuffleIn ?? ownerOf)![1]!, b);
      if (!what) return null;
      // Only cards that are "your" library's: "Shuffle that card into your library."
      return [{ type: 'move', what: what.ref, to: 'library', position: 'shuffle' }];
    });
    if (r) return r;
  }
  // The One Ring: "you gain protection from everything until your next turn"; Teferi's Protection: "Until your next
  // turn, your life total can't change and you gain protection from everything." (CR 702.16j, CR 119.8)
  // Flare of Fortitude: "Until end of turn, your life total can't change, and permanents you control gain hexproof and
  // indestructible." — the duration goes with both parts.
  const lasting = /^(?:(Until your next turn|Until end of turn), )?(you gain protection from everything|your life total can't change)(?: (until your next turn|until end of turn))?(?: and (you gain protection from everything|your life total can't change))?(?:, and (.+))?$/i.exec(s);
  if (lasting && Boolean(lasting[1]) !== Boolean(lasting[3]) && !(lasting[5] && (lasting[3] || lasting[4]))) {
    const rule = (t: string) => (/protection/.test(t) ? 'protection_everything' : 'life_cant_change');
    const nextTurn = /next turn/i.test(lasting[1] ?? lasting[3]!);
    const out: EffectNode[] = [lasting[2]!, lasting[4]].filter(Boolean).map((t) => ({ type: 'player_effect', who: { ref: 'you' }, rule: rule(t!), until: nextTurn ? 'your_next_turn' : 'eot' }));
    if (lasting[5]) {
      const rest = attempt(b, (b) => parseSentence(`${capitalise(lasting[5]!)} ${nextTurn ? 'until your next turn' : 'until end of turn'}`, b));
      if (!rest) return null;
      out.push(...rest);
    }
    return out;
  }
  // Fatal Push: "Destroy that creature if it has mana value 4 or less" (after "instead if …", below the rule above).
  const ifHas = /^(.+) if (it has (?:mana value|power|toughness) \d+ or (?:less|greater))$/.exec(s);
  if (ifHas) {
    const r = attempt(b, (b) => {
      const inner = parseSentence(ifHas[1]!, b);
      const cond = inner && b.it ? parseCondition(ifHas[2]!, b) : null;
      return inner && cond ? [{ type: 'if', cond, effects: inner } as EffectNode] : null;
    });
    if (r) return r;
  }
  // Pyroblast: "Counter target spell if it's blue.", "Destroy target permanent if it's blue." (CR 608.2c)
  const ifIts = /^(.+) if it's (white|blue|black|red|green|(?:a|an) [a-z]+)$/.exec(s);
  if (ifIts) {
    const r = attempt(b, (b) => {
      const inner = parseSentence(ifIts[1]!, b);
      const it = b.it;
      const word = ifIts[2]!.replace(/^(?:a|an) /, '');
      const pf = inner && it ? parseFilter(`${word} ${COLOR_WORDS[word] ? 'permanent' : ''}`.trim(), b) : null;
      if (!inner || !it || !pf || pf.plural) return null;
      return [{ type: 'if', cond: { type: 'is', of: it, filter: pf.filter }, effects: inner }];
    });
    if (r) return r;
  }
  // "Exile all graveyards." — every card in them.
  if (/^[Ee]xile all graveyards$/.test(s)) return parseSentence('Exile all cards from all graveyards', b);
  // Phyrexian Scriptures: "Exile all opponents' graveyards."
  if (/^[Ee]xile all opponents' graveyards$/.test(s)) return parseSentence("Exile each opponent's graveyard", b);
  // CR 615.12: "Damage can't be prevented this turn."
  if (/^Damage can't be prevented this turn$/.test(s)) return [{ type: 'damage_unpreventable' }];
  // CR 101.2: "Target player can't cast spells this turn", "Until your next turn, your opponents can't cast …"
  // Single Combat: "Players can't cast creature or planeswalker spells until the end of your next turn."
  const cantCast = /^(?:(Until your next turn|Until end of turn|This turn|Until the end of your next turn), )?(.+?) can't cast (.+?)(?: (this turn|until your next turn|until the end of your next turn))?$/.exec(s);
  if (cantCast && (cantCast[1] ? !cantCast[4] : cantCast[4])) {
    const r = attempt(b, (b) => {
      const who = /^players$/i.test(cantCast[2]!) ? ({ ref: 'players', who: 'each' } as Ref) : parsePlayerRef(cantCast[2]!, b);
      const ban = who ? parseCastBan(cantCast[3]!, b) : null;
      if (!who || !ban || ban.during || ban.maxPerTurn) return null;
      const when = cantCast[1] ?? cantCast[4]!;
      const until = /end of your next turn/i.test(when) ? 'end_of_your_next_turn' : /next turn/i.test(when) ? 'your_next_turn' : 'eot';
      // Avatar's Wrath: "your opponents can't cast spells from anywhere other than their hands".
      return [{ type: 'prohibit_casting', who, until, ...(ban.filter ? { filter: ban.filter } : {}), ...(ban.fromZones ? { fromZones: ban.fromZones } : {}) }];
    });
    if (r) return r;
  }
  // Brainstorm: "Draw three cards, then put two cards from your hand on top of your library in any order."
  const putBack = /^[Dd]raw (\w+) cards?, then put (\w+) cards? from your hand on top of your library in any order$/.exec(s);
  if (putBack) {
    const draw = parseAmount(putBack[1]!);
    const back = parseAmount(putBack[2]!.replace(/^a$/, 'one'));
    if (typeof draw === 'number' && typeof back === 'number') {
      return [
        { type: 'draw', amount: draw, who: { ref: 'you' } },
        { type: 'choose_from_hand', who: { ref: 'you' }, filter: {}, amount: back, then: 'library_top' },
      ];
    }
  }
  // Fire Prophecy: "put a card from your hand on the bottom of your library".
  if (/^[Pp]ut a card from your hand on the bottom of your library$/.test(s)) return [{ type: 'choose_from_hand', who: { ref: 'you' }, filter: {}, amount: 1, then: 'library_bottom' }];
  // Tireless Provisioner: "create a Food token or a Treasure token" — one of them, chosen as it resolves.
  const tokenOr = /^((?:[Yy]ou )?[Cc]reate) (a|an) ([A-Z]\w+) token or (a|an) ([A-Z]\w+) token$/.exec(s);
  if (tokenOr) {
    const r = attempt(b, (b) => {
      const one = parseSentence(`${tokenOr[1]} ${tokenOr[2]} ${tokenOr[3]} token`, b);
      const two = one ? parseSentence(`${tokenOr[1]} ${tokenOr[4]} ${tokenOr[5]} token`, b) : null;
      return one && two ? [{ type: 'choose_one', labels: [tokenOr[3]!, tokenOr[5]!], options: [one, two] }] : null;
    });
    if (r) return r;
  }
  // Eladamri's Vineyard: "At the beginning of each player's first main phase, that player adds {G}{G}." — into their pool.
  const theyAdd = /^(that player|target player) adds ((?:\{[WUBRGC]\})+)$/i.exec(s);
  if (theyAdd) {
    const r = attempt(b, (b) => {
      const who = parsePlayerRef(theyAdd[1]!, b);
      const add = who ? parseSentence(`Add ${theyAdd[2]}`, b) : null;
      return who && add?.length === 1 && add[0]!.type === 'add_mana' ? [{ type: 'players_do', players: who, effects: add }] : null;
    });
    if (r) return r;
  }
  // Priest of Forgotten Gods: "You add {B}{B} and draw a card." — two instructions.
  const youAdd = /^You add ((?:\{[^}]+\})+) and (draw .+)$/.exec(s);
  if (youAdd) {
    const r = attempt(b, (b) => {
      const add = parseSentence(`Add ${youAdd[1]}`, b);
      const draw = add ? parseSentence(`D${youAdd[2]!.slice(1)}`, b) : null;
      return add && draw ? [...add, ...draw] : null;
    });
    if (r) return r;
  }
  // Priest of Forgotten Gods: "Any number of target players each lose 2 life and sacrifice a creature of their choice."
  const anyEach = /^(Any number of|Two|Three) target (players|opponents) each (.+)$/.exec(s);
  if (anyEach) {
    const r = attempt(b, (b) => {
      const who = parsePlayerRef(`${anyEach[1]!.toLowerCase()} target ${anyEach[2]}`, b);
      return who ? parseSentenceWithSubject(anyEach[3]!, b, who) : null;
    });
    if (r) return r;
  }
  // Loran of the Third Path: "You and target opponent each draw a card."
  // Karazikar: "you and the attacking player each draw a card and lose 1 life" — both instructions, for each of them.
  const youAnd = /^You and (target opponent|target player|that player|defending player|the attacking player|that attacking player) each (.+)$/.exec(s);
  if (youAnd) {
    const r = attempt(b, (b) => {
      const other = parsePlayerRef(youAnd[1]!, b) ?? (b.named[youAnd[1]!] as Ref | undefined) ?? null;
      const both = /^(.+?) and ((?:lose|gain|draw|discard|mill|create|sacrifice)s? .+)$/.exec(youAnd[2]!);
      const parts = parseClause(youAnd[2]!, b.clone(), { ref: 'you' }) || !both ? [youAnd[2]!] : [both[1]!, both[2]!];
      const out: EffectNode[] = [];
      for (const who of [{ ref: 'you' } as Ref, other]) {
        for (const part of parts) {
          const c = who ? parseClause(part, b, who) : null;
          if (!c) return null;
          out.push(...c.effects);
        }
      }
      return out;
    });
    if (r) return r;
  }
  // CR 701.38: "Starting with you, each player votes for sickness or psychosis." Secret council: "Each player
  // secretly votes for truth or consequences, then those votes are revealed."
  const VOTE_WORD = String.raw`[A-Za-z]+(?: (?:of )?[A-Z][a-z]+)*`;
  const vote =
    new RegExp(String.raw`^[Ss]tarting with you, each player votes for (${VOTE_WORD}(?:, ${VOTE_WORD})*,? or ${VOTE_WORD})$`).exec(s) ??
    new RegExp(String.raw`^[Ee]ach player (secretly) votes for (${VOTE_WORD}(?:, ${VOTE_WORD})*,? or ${VOTE_WORD}), then those votes are revealed$`).exec(s);
  // "votes for a nonland permanent you don't control" (CR 701.38b: the choices may be objects)
  const objectVote = /^(?:[Ss]tarting with you, each player|[Ee]ach player (secretly)) votes for (?:a|an) (.+?)(, then those votes are revealed)?$/.exec(s);
  if (objectVote && Boolean(objectVote[1]) === Boolean(objectVote[3])) {
    const object = parseFilter(objectVote[2]!, b);
    if (!object || object.plural || /^(?:player|opponent)/.test(objectVote[2]!)) return null;
    for (const noun of ['permanent', 'card', 'creature', 'artifact', 'enchantment', 'land', 'planeswalker']) b.named[`each ${noun} with the most votes or tied for most votes`] = { ref: 'voted' };
    return [{ type: 'vote', among: object.filter, ...(objectVote[1] ? { secret: true } : {}) }];
  }
  if (vote) {
    const secret = vote.length > 2;
    const options = vote[secret ? 2 : 1]!.split(/,? or |, /);
    b.votes = options;
    return [{ type: 'vote', options, ...(secret ? { secret: true } : {}) }];
  }
  // Curse of the Swine: "For each creature exiled this way, its controller creates a 2/2 green Boar creature token."
  const perMover = /^For each (.+? (?:destroyed|exiled|sacrificed|put into a graveyard) this way), its controller creates (.+)$/.exec(s);
  if (perMover) {
    const each = parseForEach(perMover[1]!, b);
    const made = each && typeof each === 'object' && each.kind === 'moved_this_way' ? parseSentence(`Create ${perMover[2]}`, b) : null;
    if (!made || made.length !== 1 || made[0]!.type !== 'create_token' || made[0]!.amount !== 1 || made[0]!.copyOf) return null;
    const { who: _who, ...node } = made[0]!;
    const e = each as { how: string; types?: string[]; notTypes?: string[] };
    return [{ ...node, type: 'create_token', forEachMoved: { how: e.how, ...(e.types ? { types: e.types } : {}), ...(e.notTypes ? { notTypes: e.notTypes } : {}) } }];
  }
  // Blood Money: "For each nontoken creature destroyed this way, you create a tapped Treasure token."
  const youEach = /^For each (.+? (?:destroyed|exiled|sacrificed|put into a graveyard) this way), you create (a|an|one|two) (.+? tokens?)$/.exec(s);
  if (youEach) {
    const r = attempt(b, (b) => parseSentence(`Create ${youEach[2]} ${youEach[3]} for each ${youEach[1]}`, b));
    if (r) return r;
  }
  // Brass's Bounty: "For each land you control, create a Treasure token." — the same as "Create … for each …".
  // Goblin Traprunner: "For each flip you win, create a 1/1 red Goblin creature token that's tapped and attacking."
  // Turn Stones: "For each opponent, you create a 1/1 … Pest creature token with "When this token dies, you gain 1 life.""
  const eachCreate = /^For each (.+?), (?:you )?create (a|an|one|two) (.+? tokens?(?: that(?:'s| are) tapped and attacking| with QUOTED_\d+)?)$/.exec(s);
  // Seasoned Pyromancer: "For each nonland card discarded this way, create …" — counted by this resolution's discards.
  if (eachCreate && !/ copy | that player| it\b|them\b|this way/.test(s.replace(/ card discarded this way,/, ' card,'))) {
    const r = attempt(b, (b) => parseSentence(`Create ${eachCreate[2]} ${eachCreate[3]} for each ${eachCreate[1]}`, b));
    if (r) return r;
  }
  // Hex Parasite: "For each counter removed this way, ~ gets +1/+0 until end of turn." — "… gets +1/+0 … for each …".
  // Pyretic Charge: "For each card discarded this way, creatures you control get +1/+0 until end of turn."
  const eachGets = /^For each ([^,]+), (~|target creature|it|creatures you control) gets? ([+-]\d+\/[+-]\d+) until end of turn$/.exec(s);
  if (eachGets && !/ it\b|them\b/.test(eachGets[1]!)) {
    const r = attempt(b, (b) => parseSentence(`${eachGets[2]} ${eachGets[2] === 'creatures you control' ? 'get' : 'gets'} ${eachGets[3]} until end of turn for each ${eachGets[1]}`, b));
    if (r) return r;
  }
  // Second Harvest: "For each token you control, create a token that's a copy of that permanent." (CR 707.2)
  const eachCopy = /^For each (.+?), create a token that's a copy of (?:that permanent|that creature|it)$/.exec(s);
  if (eachCopy) {
    const pf = parseFilter(eachCopy[1]!, b);
    if (!pf || pf.plural || pf.filter.zone) return null;
    createdTokens(b);
    return [{ type: 'create_token', amount: 1, copyOf: { ref: 'all', filter: pf.filter }, copyEach: true, who: { ref: 'you' } }];
  }
  // Kambal, Profiteering Mayor: "for each of them, create a tapped token that's a copy of it".
  const eachThem = /^[Ff]or each of them, create a (tapped )?token that's a copy of it$/.exec(s);
  if (eachThem && b.named['them']) {
    createdTokens(b);
    return [{ type: 'create_token', amount: 1, copyOf: b.named['them'], copyEach: true, who: { ref: 'you' }, ...(eachThem[1] ? { tapped: true } : {}) }];
  }
  // Adeline: "for each opponent, create a 1/1 white Human creature token that's tapped and attacking that player or a
  // planeswalker they control" (CR 508.4).
  const eachAttacking = /^[Ff]or each opponent, create (.+?) (?:that's|that is|that are) tapped and attacking that player( or a planeswalker they control)?$/.exec(s);
  if (eachAttacking) {
    const r = attempt(b, (b) => {
      const made = parseSentence(`Create ${eachAttacking[1]} that's tapped and attacking`, b);
      const node = made?.length === 1 && made[0]!.type === 'create_token' && made[0]!.token && made[0]!.attacking ? made[0]! : null;
      if (!node) return null;
      delete node.attacking;
      return [{ ...node, attackingEach: true, ...(eachAttacking[2] ? { orPlaneswalker: true } : {}) }];
    });
    if (r) return r;
  }
  // "For each opponent, exile up to one target creature that player controls": a target for each of them (CR 601.2c).
  // Windgrace's Judgment: "For any number of opponents, destroy target nonland permanent that player controls." — each of
  // them may go without one.
  const anyNumberOf = /^[Ff]or any number of (opponent|player)s, (.+)$/.exec(s);
  const perPlayer = anyNumberOf ? ([anyNumberOf[0], anyNumberOf[1], anyNumberOf[2]] as const) : /^[Ff]or each (opponent|player), (.+)$/.exec(s);
  if (perPlayer && /\bthat (?:player|opponent)(?: controls|'s graveyard)|\bthey control\b/.test(perPlayer[2]!)) {
    const inner = perPlayer[2]!
      .replace(/ (?:that (?:player|opponent) controls|they control)\b/g, '')
      .replace(/ (from|in) that (?:player|opponent)'s graveyard/g, ' $1 a graveyard');
    if (!/\b(?:that player|that opponent|they|their)\b/.test(inner)) {
      const r = attempt(b, (b) => {
        const before = b.targets.length;
        const effects = parseSentence(inner, b);
        if (!effects || b.targets.length !== before + 1) return null;
        const spec = b.targets[before]!;
        if (spec.what !== 'object' || (spec.count ?? 1) !== 1 || spec.filter?.controller || spec.filter?.owner) return null;
        spec.perPlayer = perPlayer[1] === 'opponent' ? 'opponents' : 'each';
        if (anyNumberOf) spec.upTo = true;
        return effects;
      });
      if (r) return r;
    }
  }
  // "For each time vote, take an extra turn after this one." (CR 701.38)
  const eachVote = /^For each (.+?) vote, (.+)$/.exec(s);
  if (eachVote && b.votes.includes(eachVote[1]!)) {
    const option = eachVote[1]!;
    return attempt(b, (b) => {
      const inner = parseSentence(eachVote[2]!, b);
      if (!inner) return null;
      return scaleBy(inner, { kind: 'votes', option }) ?? [{ type: 'repeat', times: { kind: 'votes', option }, effects: inner }];
    });
  }
  // Sandstone Oracle: "Choose an opponent. If that player has more cards in hand than you, …" — chosen as it resolves.
  if (/^[Cc]hoose an opponent$/.test(s)) {
    const who: Ref = { ref: 'chosen_opponent' };
    b.player = who;
    b.named = { ...b.named, 'the chosen player': who, 'that opponent': who };
    return [{ type: 'choose_opponent' }];
  }
  // Tatsunari, Toad Rider: "Tatsunari and target Frog you control can't be blocked this turn except by creatures with flying
  // or reach." — the same for each.
  const andTarget = /^~ and ((?:up to one )?(?:another )?target [^,]+?) (can't be blocked .+|get [+-].+|gain .+)$/.exec(s);
  if (andTarget) {
    const r = attempt(b, (b) => {
      const one = (pred: string) => pred.replace(/^get /, 'gets ').replace(/^gain /, 'gains ');
      const self = parseSentence(`~ ${one(andTarget[2]!)}`, b);
      const other = self ? parseSentence(`${andTarget[1]} ${one(andTarget[2]!)}`, b) : null;
      return self && other ? [...self, ...other] : null;
    });
    if (r) return r;
  }
  // Ignite Memories: "Target player reveals a card at random from their hand. ~ deals damage to that player equal to that
  // card's mana value."
  const revealRandom = /^(.+?) reveals a card at random from their hand$/.exec(s);
  if (revealRandom) {
    const r = attempt(b, (b) => {
      const who = parsePlayerRef(revealRandom[1]!.replace(/^\w/, (x) => x.toLowerCase()), b);
      if (!who) return null;
      b.player = who;
      b.named = { ...b.named, 'that card': { ref: 'chosen_object' }, 'the revealed card': { ref: 'chosen_object' } };
      return [{ type: 'reveal_random', who }];
    });
    if (r) return r;
  }
  // Vial Smasher the Fierce: "choose an opponent at random. … to that player …" (CR 608.2d — nobody chooses).
  if (/^[Cc]hoose an opponent at random$/.test(s)) {
    const who: Ref = { ref: 'chosen_opponent' };
    b.player = who;
    b.named = { ...b.named, 'the chosen player': who, 'that opponent': who, 'that player': who };
    return [{ type: 'choose_opponent', random: true }];
  }
  // The Black Gate: "Choose a player with the most life or tied for most life." — any player, you included.
  if (/^[Cc]hoose a player with the most life or tied for most life$/.test(s)) {
    const who: Ref = { ref: 'chosen_opponent' };
    b.player = who;
    b.named = { ...b.named, 'the chosen player': who, 'that player': who };
    return [{ type: 'choose_opponent', anyPlayer: true, mostLife: true }];
  }
  // Call the Coppercoats: "Choose any number of target opponents." — those players, for what follows.
  const choosePlayers = /^[Cc]hoose ((?:any number of|two|three|up to (?:one|two|three)) target (?:opponents|players))$/.exec(s);
  if (choosePlayers) {
    const r = attempt(b, (b) => {
      const who = parsePlayerRef(choosePlayers[1]!, b);
      if (!who || who.ref !== 'target') return null;
      b.named = { ...b.named, 'those opponents': who, 'those players': who, 'each of them': who };
      return [];
    });
    if (r) return r;
  }
  // Great Train Heist: "Choose target opponent." — the player, for what follows ("that player").
  if (/^[Cc]hoose (?:another )?target (?:opponent|player)$/.test(s)) {
    const r = attempt(b, (b) => {
      const who = parsePlayerRef(s.slice(7), b);
      if (!who) return null;
      b.named = { ...b.named, 'the chosen player': who };
      return [];
    });
    if (r) return r;
  }
  // Tail Swipe, Blizzard Brawl: "Choose target creature you control and target creature you don't control." — the two
  // targets, named for what follows ("the creature you control", "those creatures fight each other").
  const choosePair = /^[Cc]hoose (target creature you control) and (target creature (?:you don't control|an opponent controls))$/.exec(s);
  if (choosePair) {
    const r = attempt(b, (b) => {
      const one = parseObjectRef(choosePair[1]!, b);
      const two = one?.targeted && !one.plural ? parseObjectRef(choosePair[2]!, b) : null;
      if (!one || !two?.targeted || two.plural) return null;
      b.named = { ...b.named, [choosePair[1]!.replace(/^target /, 'the ')]: one.ref, [choosePair[2]!.replace(/^target /, 'the ')]: two.ref };
      b.fightPair = [one.ref, two.ref];
      return [];
    });
    if (r) return r;
  }
  if (/^(?:[Tt]hen )?[Tt]hose creatures fight each other$/.test(s) && b.fightPair) return [{ type: 'fight', a: b.fightPair[0], b: b.fightPair[1] }];
  // "Choose target creature." — the target, for what follows ("that creature").
  const chooseTarget = /^[Cc]hoose ((?:another )?target .+|up to (?:one|two|three|four) (?:other )?target .+)$/.exec(s);
  if (chooseTarget) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(chooseTarget[1]!, b);
      return what?.targeted ? [] : null;
    });
    if (r) return r;
  }
  // CR 706: "Roll a d20", "Roll two d20 and ignore the lower roll"
  const roll = /^[Rr]oll (a|two) d(\d+)( and ignore the lower roll)?$/.exec(s);
  if (roll && (roll[1] === 'a' || roll[3])) return [{ type: 'roll_die', sides: Number(roll[2]), ...(roll[1] === 'two' ? { count: 2, ignoreLower: true } : {}) }];
  // Circle of Protection: "The next time a red source of your choice would deal damage to you this turn, prevent that damage."
  const nextSource = /^The next time (?:a|an) (?:(white|blue|black|red|green|artifact|creature) )?source of your choice would deal damage to you this turn, prevent that damage$/.exec(s);
  if (nextSource) {
    const COLORS: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
    const k = nextSource[1];
    const filter = !k ? {} : COLORS[k] ? { colors: [COLORS[k]] } : { types: [k[0]!.toUpperCase() + k.slice(1)] };
    return [{ type: 'prevent_chosen_source', filter }];
  }
  // Mistrise Village: "The next spell you cast this turn can't be countered."; "The next instant or sorcery spell you cast
  // this turn costs {2} less to cast", "… costs {X} less to cast, where X is the number of Wizards you control".
  // Archway of Innovation: "The next spell you cast this turn has improvise."
  // Quicken: "The next sorcery spell you cast this turn can be cast as though it had flash."
  const next = /^[Tt]he next (?:(.+?) )?spell you cast this turn (can't be countered|can be cast as though it had flash|has (?:improvise|convoke|delve)|costs \{(\d+|X)\} less to cast(?:, where X is (.+?)(?: as this ability resolves)?)?)$/.exec(s);
  if (next) {
    let filter: ObjectFilter = {};
    if (next[1]) {
      const pf = parseFilter(`${next[1]} spells`, b);
      if (!pf || pf.filter.zone !== 'stack') return null;
      const { zone: _z, ...rest } = pf.filter;
      filter = rest;
    }
    if (next[2] === "can't be countered") return [{ type: 'next_spell', filter, uncounterable: true }];
    if (next[2] === 'can be cast as though it had flash') return [{ type: 'next_spell', filter, flash: true }];
    if (/^has /.test(next[2]!)) return [{ type: 'next_spell', filter, keyword: next[2]!.slice(4) }];
    if (next[3] === 'X') {
      // ", where X is …" in the same sentence is bound by the sentence (bindX).
      const x = next[4] ? parseCount(next[4], b) : 'X';
      return x ? [{ type: 'next_spell', filter, reduce: x }] : null;
    }
    return next[4] ? null : [{ type: 'next_spell', filter, reduce: Number(next[3]) }];
  }
  // Command Beacon: "Put your commander into your hand from the command zone." (CR 903.3)
  if (/^(?:Put your commander into your hand from the command zone|Return your commander from the command zone to your hand)$/.test(s)) {
    return [{ type: 'move', what: { ref: 'all', filter: { commander: true, zone: 'command', owner: 'you' } }, to: 'hand' }];
  }
  // CR 701.57a: "discover N".
  // Etali, Primal Conqueror: "each player exiles cards from the top of their library until they exile a nonland card".
  const exileUntil = /^[Ee]ach player exiles cards from the top of their library until they exile a nonland card$/.exec(s);
  if (exileUntil) {
    b.it = { ref: 'created' };
    return [{ type: 'exile_until', who: { ref: 'players', who: 'each' }, filter: { notTypes: ['Land'] } }];
  }
  // CR 119.5: "Your life total becomes 10"; The Endstone: "your life total becomes half your starting life total, rounded
  // up"; Oketra's Last Mercy: "… becomes equal to your starting life total"; Sorin Markov: "Target opponent's life total
  // becomes 10."
  // Resolute Archangel: "if your life total is less than your starting life total, it becomes equal to your starting life
  // total" — "it" is your life total (nothing else becomes a life total).
  if (/^It becomes equal to your starting life total$/.test(s)) return [{ type: 'set_life', who: { ref: 'you' }, value: 'starting' }];
  // Eternity Vessel: "your life total become the number of charge counters on this artifact" (after "you may have").
  const lifeCount = /^Your life total becomes? (the number of .+)$/.exec(s);
  if (lifeCount) {
    const n = attempt(b, (b) => parseCount(lifeCount[1]!, b));
    if (n) return [{ type: 'set_life', who: { ref: 'you' }, amount: n }];
  }
  const lifeBecomes = /^(.+?)(?:'s?)? life totals? becomes? (\d+|half (?:your|their) starting life total, rounded (up|down)|equal to (?:your|their) starting life total)$/.exec(s);
  if (lifeBecomes) {
    const who = attempt(b, (b) => parsePlayerRef(lifeBecomes[1]!.replace(/^Your$|^your$/, 'you').replace(/^Each player$/i, 'each player'), b));
    if (who) {
      const n = Number(lifeBecomes[2]);
      const value = Number.isFinite(n) ? null : lifeBecomes[3] ? (lifeBecomes[3] === 'up' ? 'half_starting_up' : 'half_starting_down') : 'starting';
      return [{ type: 'set_life', who, ...(value ? { value } : { amount: n }) }];
    }
  }
  // Beacon of Immortality: "Double target player's life total." (CR 701.10d: they gain or lose the life needed).
  const doubleLife = /^[Dd]ouble (.+?)(?:'s?)? life total$/.exec(s);
  if (doubleLife) {
    const who = attempt(b, (b) => parsePlayerRef(doubleLife[1]!.replace(/^your$/i, 'you'), b));
    if (who) return [{ type: 'set_life', who, value: 'double' }];
  }
  // Monstrous Vortex: "discover X, where X is that spell's mana value" (the X bound below).
  const discover = /^[Dd]iscover (\d+|X)$/.exec(s);
  if (discover) return [{ type: 'discover', n: discover[1] === 'X' ? 'X' : Number(discover[1]) }];
  // CR 701.40a / 701.58a: "Manifest the top card of your library", "cloak the top two cards of your library".
  const manifest = /^([Mm]anifest|[Cc]loak) the top (card|two cards|three cards) of your library$/.exec(s);
  if (manifest) {
    const amount = manifest[2] === 'card' ? 1 : manifest[2] === 'two cards' ? 2 : 3;
    // Fierce Invocation: "Manifest the top card of your library, then put two +1/+1 counters on it." — the manifested one.
    if (amount === 1) b.it = { ref: 'created' };
    return [{ type: 'manifest', amount, ...(/^[Cc]loak/.test(manifest[1]!) ? { cloak: true } : {}) }];
  }
  // Reality Shift: "Its controller manifests the top card of their library."
  const theyManifest = /^(.+?) manifests the top card of (?:their|his or her) library$/.exec(s);
  if (theyManifest) {
    const who = parsePlayerRef(theyManifest[1]!, b);
    return who ? [{ type: 'manifest', amount: 1, who }] : null;
  }
  // CR 114.1: "You get an emblem with "…"" (planeswalkers' ultimates).
  const emblem = /^[Yy]ou get an emblem with (.+)$/.exec(s);
  if (emblem) {
    const kws = parseKeywordList(emblem[1]!, b, true);
    if (!kws || kws.some((k) => k.id !== 'ability')) return null;
    return [{ type: 'emblem', abilities: kws.flatMap((k) => k.abilities ?? []), text: kws.map((k) => k.text).join('\n') }];
  }
  // "That player may draw a card", "its controller may create a token": another player chooses (CR 603.5).
  const theyMay = /^(.+?) may (.+)$/.exec(s);
  if (theyMay) {
    const r = attempt(b, (b) => {
      const who = singlePlayer(theyMay[1]!, b);
      const inner = who ? parseClause(theyMay[2]!, b, who) : null;
      return who && inner ? [{ type: 'may', who, effects: inner.effects }] : null;
    });
    if (r) return r;
  }
  // Kardur, Doomscourge: "until your next turn, creatures your opponents control attack each combat if able and attack a
  // player other than you if able" — goad's requirements (CR 701.15b), without goading.
  const kardur = /^[Uu]ntil your next turn, (.+?) attacks? each combat if able and attacks? a player other than you if able$/.exec(s);
  if (kardur) {
    const what = parseObjectRef(kardur[1]!, b);
    if (what) return [{ type: 'goad', what: what.ref, quiet: true }];
  }
  const until = /^Until end of turn, (.+?) (gets?|gains?|has|have|can't|becomes?|loses?|assigns?|can attack) (.+)$/.exec(s);
  if (until) return parseSentence(`${until[1]} ${until[2]} ${until[3]} until end of turn`, b);
  // Taunt from the Rampart: "Until your next turn, those creatures can't block."
  const untilNext = /^Until your next turn, ([^,]+?) (gets?|gains?|has|have|can't) (.+)$/.exec(s);
  if (untilNext && !/\b(?:becomes?|is|are)\b/.test(untilNext[1]!)) {
    // Dovin Baan: "Until your next turn, up to one target creature gets -3/-0 and its activated abilities can't be activated."
    // — both last until then.
    const andIts = / and (its|their) activated abilities can't be activated$/.exec(untilNext[3]!);
    // Mu Yanling: "… gets -2/-0 and loses flying." — both until then.
    const andLoses = !andIts ? / and (loses? [a-z ,]+)$/.exec(untilNext[3]!) : null;
    const rest = andIts
      ? `${untilNext[3]!.slice(0, andIts.index)} until your next turn and ${andIts[1]} activated abilities can't be activated`
      : andLoses
        ? `${untilNext[3]!.slice(0, andLoses.index)} until your next turn and ${andLoses[1]}`
        : untilNext[3]!;
    const r = attempt(b, (b) => parseSentence(`${untilNext[1]} ${untilNext[2]} ${rest} until your next turn`, b));
    if (r) return r;
  }


  const whole = attempt(b, (b) => parseClause(s, b, null));
  if (whole) return whole.effects;
  const counted = parseCounted(s, b);
  if (counted) return counted;

  // Try each conjunction as the split point; a clause without a subject reuses the previous one's.
  const joints = [...s.matchAll(/, then | and then | and |, /g)];
  for (const j of joints) {
    const left = s.slice(0, j.index);
    const right = s.slice(j.index! + j[0].length);
    const r = attempt(b, (b) => {
      // "Target creature becomes black and gains fear until end of turn": the duration is both parts'.
      const shared = j[0] === ' and ' && / until end of turn$/.test(s) && !/ until end of turn$/.test(left);
      const l = (shared ? attempt(b, (b) => parseClause(`${left} until end of turn`, b, null)) : null) ?? countedClause(left, b, null);
      if (!l) return null;
      // "Target creature gets +3/+3 until end of turn and must be blocked this turn if able": the object goes on.
      const rest = parseSentenceWithSubject(right, b, l.subject) ?? (!l.subject && b.it ? attempt(b, (b) => parseClause(`it ${right}`, b, null))?.effects ?? null : null);
      return rest ? [...l.effects, ...rest] : null;
    });
    if (r) return r;
  }
  // Narset's Reversal: "Copy target instant or sorcery spell, then return it to its owner's hand." — two instructions
  // in order, where the first is a sentence of its own kind.
  for (const j of joints) {
    // "… shuffles it into their library, then draws two cards": the subject goes on — not this.
    // Karazikar: "tap target creature that player controls and goad it" — an instruction of its own kind after "and".
    // Primal Amulet: "remove those counters and transform it" (read as "remove all charge counters from it and …").
    // Hostile Hostel: "remove those counters, transform it, then untap it".
    const andImperative = (j[0] === ' and ' && /^goad (?:it|them)$/.test(s.slice(j.index! + j[0].length))) || ((j[0] === ' and ' || j[0] === ', ') && /^[Rr]emove all \S+ counters from (?:it|~)$/.test(s.slice(0, j.index)));
    if ((j[0] !== ', then ' && !andImperative) || /^\w+s\b/.test(s.slice(j.index! + j[0].length).replace(/^amass\b/, 'amass_'))) continue;
    const r = attempt(b, (b) => {
      const l = parseSentence(s.slice(0, j.index), b);
      const rest = l ? parseSentence(capitalise(s.slice(j.index! + j[0].length)), b) : null;
      return l && rest ? [...l, ...rest] : null;
    });
    if (r) return r;
  }
  // Finale of Revelation: "shuffle your graveyard into your library, draw X cards, untap up to five lands, and you have no
  // maximum hand size for the rest of the game" — a series of instructions, each a sentence of its own kind.
  const series = s.split(/, (?:and )?/);
  if (series.length >= 3 && /, and [^,]+$/.test(s) && series.slice(1).every((p) => /^(?:you |[a-z]+(?<!s) )/.test(p) && !/^(?:that|those|it|its|this|which|where|then) /.test(p))) {
    const r = attempt(b, (b) => {
      const out: EffectNode[] = [];
      for (const p of series) {
        const e = parseSentence(capitalise(p), b);
        if (!e) return null;
        out.push(...e);
      }
      return out;
    });
    if (r) return r;
  }
  return null;
}

/**
 * A clause of a longer sentence that counts on its own: "… sacrifices a creature for each death vote and
 * discards a card for each taxes vote" (CR 608.2h).
 */
function countedClause(s: string, b: Binder, subject: Ref | null): Clause | null {
  const whole = attempt(b, (b) => parseClause(s, b, subject));
  if (whole || !/ for each | equal to |\bthat (?:much|many)\b/.test(s)) return whole;
  let found: Ref | null = null;
  const effects = attempt(b, (b) =>
    parseCounted(s, b, (t, b) => {
      const c = parseClause(t, b, subject);
      if (c) found = c.subject;
      return c?.effects ?? null;
    }),
  );
  return effects ? { effects, subject: found ?? subject } : null;
}

function parseSentenceWithSubject(s: string, b: Binder, subject: Ref | null): EffectNode[] | null {
  const whole = countedClause(s, b, subject);
  if (whole) return whole.effects;
  // Coveted Jewel: "that player draws three cards and gains control of this artifact" — the same player.
  const gains = subject && (subject.ref === 'trigger_player' || subject.ref === 'target' || subject.ref === 'controller_of') ? /^gains control of (.+)$/.exec(s) : null;
  if (gains) {
    const what = attempt(b, (b) => parseObjectRef(gains[1]!, b));
    if (what && !what.plural) return [{ type: 'gain_control', what: what.ref, to: subject! }];
  }
  // Sword of Light and Shadow: "you gain 3 life and you may return up to one target creature card …" — a choice of its own.
  const youMay = /^you may (.+)$/.exec(s);
  if (youMay) {
    const r = attempt(b, (b) => parseSentence(`You may ${youMay[1]}`, b));
    if (r) return r;
  }
  // Tataru Taru: "you draw a card and target opponent may draw a card" — another player's choice (CR 603.5).
  const theyMay = /^(.+?) may (.+)$/.exec(s);
  if (theyMay && theyMay[1] !== 'you') {
    const r = attempt(b, (b) => {
      const who = singlePlayer(theyMay[1]!, b);
      const inner = who ? parseClause(theyMay[2]!, b, who) : null;
      return who && inner ? [{ type: 'may', who, effects: inner.effects }] : null;
    });
    if (r) return r;
  }
  const joints = [...s.matchAll(/, then | and then |, and | and |, /g)];
  for (const j of joints) {
    const r = attempt(b, (b) => {
      const l = countedClause(s.slice(0, j.index), b, subject);
      if (!l) return null;
      const rest = parseSentenceWithSubject(s.slice(j.index! + j[0].length), b, l.subject);
      return rest ? [...l.effects, ...rest] : null;
    });
    if (r) return r;
  }
  return null;
}

interface Clause {
  effects: EffectNode[];
  /** The player who performs the action, for a following subjectless clause. */
  subject: Ref | null;
}

/** "You may have it deal …": the verbs, as the third person says them. */
const HAVE_VERBS: Record<string, string> = {
  deal: 'deals', fight: 'fights', get: 'gets', lose: 'loses', discard: 'discards', mill: 'mills', gain: 'gains', draw: 'draws',
  sacrifice: 'sacrifices', create: 'creates', shuffle: 'shuffles', become: 'becomes', return: 'returns', put: 'puts', exile: 'exiles',
  exchange: 'exchange',
};

/** Player verbs: lemma → handler. The subject is the player performing it ("you" when imperative). */
type VerbHandler = (args: string, who: Ref, b: Binder, imperative: boolean) => EffectNode[] | null;

const VERB_FORMS: Record<string, string> = {};
const VERBS: Record<string, VerbHandler> = {
  // Guide of Souls: "you gain 1 life and get {E}" — the subject shared (CR 107.14).
  get(args, who) {
    const energy = /^((?:\{E\})+)$/.exec(args);
    return energy && who.ref !== 'players' ? [{ type: 'get_counters', who, counter: 'energy', amount: energy[1]!.length / 3 }] : null;
  },
  draw(args, who) {
    // "draw up to two cards"
    const upTo = /^up to (\w+) cards?$/.exec(args);
    const n = upTo ? parseAmount(upTo[1]!) : null;
    if (upTo) return typeof n === 'number' && n > 0 && who.ref !== 'players' ? [{ type: 'draw', amount: n, who, upTo: true }] : null;
    // Anvil of Bogardan: "that player draws an additional card, then discards a card"
    if (args === 'an additional card') return [{ type: 'draw', amount: 1, who }];
    // Font of Mythos: "that player draws two additional cards".
    const extra = /^(two|three|four) additional cards$/.exec(args);
    if (extra) return [{ type: 'draw', amount: parseAmount(extra[1]!) as number, who }];
    const m = /^(\S+) cards?$/.exec(args);
    const amount = m && parseAmount(m[1]!);
    return amount !== null && amount !== undefined ? [{ type: 'draw', amount, who }] : null;
  },
  exchange(args, who, b, imperative) {
    // CR 701.12a-b: "Exchange control of two target creatures.", "… of this creature and target creature an opponent
    // controls" — two permanents (not spells: Sudden Substitution's spell changes hands differently).
    const control = /^control of (.+)$/.exec(args);
    if (control) {
      if (!imperative) return null;
      const t = control[1]!;
      const onField = (b: Binder, r: Ref) => {
        if (r.ref !== 'target') return r.ref === 'self';
        const spec = b.targets[r.index]!;
        return spec.what === 'object' && !(spec.filter as ObjectFilter | undefined)?.zone;
      };
      const both = attempt(b, (b) => {
        const r = parseObjectRef(t, b);
        if (!r || !r.targeted || r.ref.ref !== 'target' || !onField(b, r.ref)) return null;
        const spec = b.targets[r.ref.index]!;
        return spec.count === 2 && !spec.upTo && !spec.countX && !spec.perPlayer ? [r.ref] : null;
      });
      if (both) return [{ type: 'exchange_control', what: both }];
      for (const m of t.matchAll(/ and /g)) {
        const pair = attempt(b, (b) => {
          const l = parseObjectRef(t.slice(0, m.index), b);
          const r = l ? parseObjectRef(t.slice(m.index + 5), b) : null;
          if (!l || !r || l.plural || r.plural || !(l.targeted || r.targeted) || !onField(b, l.ref) || !onField(b, r.ref)) return null;
          return [l.ref, r.ref];
        });
        if (pair) return [{ type: 'exchange_control', what: pair }];
      }
      return null;
    }
    // CR 701.12c: "Exchange life totals with target opponent." / "Two target players exchange life totals."
    const withPlayer = /^life totals with (.+)$/.exec(args);
    if (withPlayer && who.ref === 'you') {
      const other = parsePlayerRef(withPlayer[1]!, b);
      return other && ['target', 'chosen_player', 'trigger_player'].includes(other.ref) ? [{ type: 'exchange_life', who: [who, other] }] : null;
    }
    if (args === 'life totals' && who.ref === 'target') {
      const spec = b.targets[who.index]!;
      return spec.count === 2 && !spec.upTo && !spec.countX && !spec.min ? [{ type: 'exchange_life', who: [who] }] : null;
    }
    // CR 701.12g: "Exchange your life total with this creature's toughness." — the life total becomes the other value,
    // and a layer 7b effect sets the power or toughness to the old life total.
    const stat = /^(.+?) life total with (~|this creature)'s (power|toughness)$/.exec(args);
    if (stat && imperative) {
      const p = stat[1] === 'your' ? who : /^target (?:player|opponent)'s$/.test(stat[1]!) ? parsePlayerRef(stat[1]!.replace(/'s$/, ''), b) : null;
      return p && p.ref !== 'players' ? [{ type: 'exchange_life_stat', who: p, what: { ref: 'self' }, stat: stat[3]! }] : null;
    }
    return null;
  },
  gain(args, who, b, imperative) {
    // Layer 2 (CR 613.1b): "Gain control of target creature until end of turn."
    // Treasure Nabber: "… until the end of your next turn".
    // Sower of Temptation: "… for as long as this creature remains on the battlefield"; Roil Elemental: "… for as long as
    // you control this creature" (CR 611.2b).
    const control = /^control of (.+?)( until end of turn| until the end of your next turn| for as long as (?:~|this \w+) remains on the battlefield| for as long as you control (?:~|this \w+))?$/.exec(args);
    if (control) {
      if (!imperative) return null;
      const what = parseObjectRef(control[1]!, b);
      const until = control[2] === ' until end of turn' ? 'eot' : /remains on the battlefield$/.test(control[2] ?? '') ? 'source_present' : /you control/.test(control[2] ?? '') ? 'source_controlled' : control[2] ? 'end_of_your_next_turn' : null;
      if (until?.startsWith('source_') && /\b(?:Instant|Sorcery)\b/.test(b.env.typeLine)) return null;
      return what ? [{ type: 'gain_control', what: what.ref, ...(until ? { until } : {}) }] : null;
    }
    // Heliod's Intervention: "Target player gains twice X life."
    if (args === 'twice X life') return [{ type: 'gain_life', amount: { kind: 'x', times: 2 }, who }];
    const m = /^(\S+) life$/.exec(args);
    const amount = m && parseAmount(m[1]!);
    return amount !== null && amount !== undefined ? [{ type: 'gain_life', amount, who }] : null;
  },
  lose(args, who) {
    // Final Act: "Each opponent loses all counters." (CR 122.1: poison, energy, experience, …)
    if (args === 'all counters') return [{ type: 'player_counters_lost', who }];
    // Debt to the Deathless: "Each opponent loses two times X life."
    if (/^(?:twice|two times) X life$/.test(args)) return [{ type: 'lose_life', amount: { kind: 'x', times: 2 }, who }];
    const m = /^(\S+) life$/.exec(args);
    const amount = m && parseAmount(m[1]!);
    return amount !== null && amount !== undefined ? [{ type: 'lose_life', amount, who }] : null;
  },
  discard(args, who, b) {
    // "discards their hand" (CR 701.9a: all the cards in it).
    if (/^(?:their|your|his or her) hand$/.test(args)) return [{ type: 'discard', all: true, amount: 0, who }];
    // CR 701.9b: "discard a card at random"
    const random = /^(\S+) cards? at random$/.exec(args);
    const n = random ? parseAmount(random[1]!) : null;
    if (random) return typeof n === 'number' ? [{ type: 'discard', amount: n, who, random: true }] : null;
    const m = /^(\S+) cards?$/.exec(args);
    const amount = m && parseAmount(m[1]!);
    // Thirst for Knowledge: "unless you discard an artifact card" — a card of that kind.
    const typed = !m ? /^(a|an|one|two|three) (.+? cards?)$/.exec(args) : null;
    if (typed) {
      const k = parseAmount(typed[1]!);
      const pf = typeof k === 'number' ? parseFilter(`${typed[2]} in your graveyard`, b.clone()) : null;
      if (!pf || pf.plural !== (k as number) > 1) return null;
      const { zone: _z, owner: _o, ...filter } = pf.filter;
      return Object.keys(filter).length ? [{ type: 'discard', amount: k, who, filter }] : null;
    }
    // Hellhole Rats: "target player discards a card. ~ deals damage to that player equal to that card's mana value."
    if (amount === 1) b.other = { ref: 'discarded_this_way' };
    // Malcolm: "Draw a card, then discard a card. If …, you may cast the discarded card without paying its mana cost."
    if (amount === 1 && who.ref === 'you') b.named['the discarded card'] = { ref: 'discarded_this_way' };
    return amount !== null && amount !== undefined ? [{ type: 'discard', amount, who }] : null;
  },
  mill(args, who, b) {
    // Maddening Cacophony: "each opponent mills half their library, rounded up" — each of them counts their own.
    const half = /^half (?:their|your|his or her) library, rounded (up|down)$/.exec(args);
    if (half) {
      // Singularity Rupture: "any number of target players each mill half their library" — each of them their own.
      const player: Ref = who.ref === 'players' || who.ref === 'target' ? { ref: 'each_player' } : who;
      b.milled = true;
      return [{ type: 'mill', amount: { kind: 'cards', zone: 'library', who: 'each', player, half: half[1] as 'up' | 'down' }, who }];
    }
    // Riverchurn Monument: "Any number of target players each mill cards equal to the number of cards in their graveyard."
    if (args === 'cards equal to the number of cards in their graveyard' && (who.ref === 'players' || who.ref === 'target')) {
      b.milled = true;
      return [{ type: 'mill', amount: { kind: 'cards', zone: 'graveyard', who: 'each', player: { ref: 'each_player' } }, who }];
    }
    // Drown in Dreams: "Target player mills twice X cards."; Jace, the Perfected Mind: "… mills three times X cards."
    const timesX = /^(twice|three times|four times) X cards$/.exec(args);
    if (timesX) {
      b.milled = true;
      return [{ type: 'mill', amount: { kind: 'x', times: timesX[1] === 'twice' ? 2 : timesX[1] === 'three times' ? 3 : 4 }, who }];
    }
    const m = /^(\S+) cards?$/.exec(args);
    const amount = m && parseAmount(m[1]!);
    if (amount === null || amount === undefined) return null;
    b.milled = true;
    // Tablet of Discovery: "mill a card. You may play that card this turn." — the card milled.
    if (amount === 1 && who.ref === 'you') b.named = { ...b.named, 'that card': { ref: 'milled_this_way' } };
    return [{ type: 'mill', amount, who }];
  },
  // CR 701.68a: "blight 2", "target opponent blights 2"
  blight(args, who) {
    const amount = parseAmount(args);
    return typeof amount === 'number' ? [{ type: 'blight', amount, who }] : null;
  },
  scry(args, who) {
    const amount = parseAmount(args);
    if (amount === null) return null;
    // Kozilek's Command: "Target player scries X, then draws a card." — that player looks and chooses.
    if (who.ref === 'target') return [{ type: 'scry', amount, who }];
    return who.ref === 'you' ? [{ type: 'scry', amount }] : null;
  },
  surveil(args, who) {
    const amount = parseAmount(args);
    return amount !== null && who.ref === 'you' ? [{ type: 'surveil', amount }] : null;
  },
  create(args, who, b) {
    // Sandstorm Crasher: "create a tapped and attacking token that's a copy of target creature you control" (CR 508.4).
    const copyAttacking = /^(a|an|one) tapped and attacking (token (?:that's a copy) of (?!.*\bexcept\b).+)$/.exec(args);
    if (copyAttacking) args = `${copyAttacking[1]} ${copyAttacking[2]}`;
    // Ghalta and Mavren: "Create a tapped and attacking X/X green Dinosaur creature token" — the same as "… token that's tapped
    // and attacking" (CR 508.4).
    const preAttacking = /^(a|an|one|two|three|four|five|X) tapped and attacking (.+)$/.exec(args);
    if (preAttacking && !/ (?:that are|that's|that is) tapped/.test(preAttacking[2]!)) {
      const one = /^(?:a|an|one)$/.test(preAttacking[1]!);
      args = `${preAttacking[1]} ${preAttacking[2]} ${one ? "that's" : 'that are'} tapped and attacking`;
    }
    // Pest Infestation: "Create twice X 1/1 black and green Pest creature tokens …"
    const twiceX = /^twice X (.+)$/.exec(args);
    if (twiceX) {
      const r = attempt(b, (b) => VERBS.create!(`X ${twiceX[1]}`, who, b, true));
      const node = r?.length === 1 && r[0]!.type === 'create_token' && r[0]!.amount === 'X' ? r[0]! : null;
      return node ? [{ ...node, amount: { kind: 'x', times: 2 } }] : null;
    }
    // CR 707.2: "a token that's a copy of target creature you control, except it has haste".
    const copy = /^(a|an|one|two|three|four|five|X|that many) (tapped )?tokens? (?:that's a copy|that are copies) of (.+?)(?:,? except (.+))?$/.exec(args);
    if (copy) {
      const amount = parseAmount(copy[1] === 'an' ? 'a' : copy[1]!);
      if (amount === null || amount === undefined) return null;
      const of = parseObjectRef(copy[3]!, b);
      if (!of || of.plural) return null;
      const except = copy[4] ? parseCopyExcept(copy[4], b) : undefined;
      if (except === null) return null;
      const node: EffectNode = { type: 'create_token', amount, copyOf: of.ref, who };
      if (except) node.except = except;
      if (copy[2]) node.tapped = true;
      if (copyAttacking) {
        node.tapped = true;
        node.attacking = true;
      }
      createdTokens(b);
      return [node];
    }
    // CR 508.4: "… tokens that are tapped and attacking"
    // Soaring Lightbringer: "… token that's tapped and attacking that player" — the player the trigger is about.
    const attackingPlayer = / (?:that are|that's|that is) tapped and attacking that player$/.test(args) ? parsePlayerRef('that player', b) : null;
    if (attackingPlayer) args = args.replace(/ that player$/, '');
    const attackingSuffix = / (?:that are|that's|that is) tapped and attacking$|,? tapped and attacking$/;
    // Brimaz: "… token with vigilance that's attacking" — attacking, but not tapped (CR 508.4).
    const untappedAttacking = !attackingSuffix.test(args) && / (?:that are|that's|that is) attacking$/.test(args);
    if (untappedAttacking) args = args.replace(/ (?:that are|that's|that is) attacking$/, " that's tapped and attacking");
    const attacking = attackingSuffix.test(args);
    if (attacking) args = args.replace(attackingSuffix, '');
    // "a number of Treasure tokens equal to the result", "a number of 1/1 … tokens with flying equal to …"
    const numberOf = /^a number of (.+?) equal to (.+)$/.exec(args);
    if (numberOf) {
      const amount = parseCount(numberOf[2]!, b);
      const many = amount ? parseTokenPhrase(`two ${numberOf[1]}`, b) : null;
      if (!amount || !many) return null;
      createdTokens(b);
      return [{ type: 'create_token', amount, token: many.face, who, ...(many.tapped ? { tapped: true } : {}), ...(many.size ? { size: many.size } : {}) }];
    }
    const attached = /^(.+?) attached to (.+)$/.exec(args);
    const token = parseTokenPhrase(attached ? attached[1]! : args, b);
    if (!token) {
      // Wurmcoil Engine: "a 3/3 … token with deathtouch and a 3/3 … token with lifelink" — two kinds of tokens.
      if (attached || attacking) return null;
      // Farmer Cotton: "X 1/1 white Halfling creature tokens and X Food tokens".
      for (const m of args.matchAll(/ and (?=(?:a|an|one|two|three|X) )/g)) {
        const r = attempt(b, (b) => {
          const one = parseTokenPhrase(args.slice(0, m.index), b);
          const two = one ? parseTokenPhrase(args.slice(m.index! + m[0].length), b) : null;
          if (!one || !two) return null;
          if (one.size || two.size) return null;
          return [one, two].map((t): EffectNode => ({ type: 'create_token', amount: t.amount, token: t.face, who, ...(t.tapped ? { tapped: true } : {}) }));
        });
        if (r) {
          createdTokens(b);
          return r;
        }
      }
      // Triplicate Titan: "a 3/3 … token with flying, a 3/3 … token with vigilance, and a 3/3 … token with lifelink".
      const parts = args.split(/,? and (?=(?:a|an|one|two|three) \d)|, (?=(?:a|an|one|two|three) \d)/);
      if (parts.length >= 3) {
        const r = attempt(b, (b) => {
          const made = parts.map((p) => parseTokenPhrase(p, b));
          if (made.some((t) => !t || t.size)) return null;
          return made.map((t): EffectNode => ({ type: 'create_token', amount: t!.amount, token: t!.face, who, ...(t!.tapped ? { tapped: true } : {}) }));
        });
        if (r) {
          createdTokens(b);
          return r;
        }
      }
      return null;
    }
    const node: EffectNode = { type: 'create_token', amount: token.amount, token: token.face, who };
    if (token.tapped) node.tapped = true;
    // CR 107.3: "an X/X … token" — its size is the X of the spell or ability, or the one the text defines.
    if (token.size) node.size = token.size;
    if (attacking) {
      if (!untappedAttacking) node.tapped = true;
      node.attacking = true;
      if (attackingPlayer) node.attackingPlayer = attackingPlayer;
    }
    createdTokens(b);
    if (attached) {
      const to = parseObjectRef(attached[2]!, b);
      if (!to || to.plural || !token.face.subtypes.includes('Aura')) return null;
      node.attachTo = to.ref;
    }
    return [node];
  },
  sacrifice(args, who, b) {
    // Sporogenic Infection: "a creature of their choice other than enchanted creature".
    args = args.replace(/ of (?:their|your) choice (other than )/, ' $1');
    // All Is Dust: "Each player sacrifices all permanents they control that are one or more colors." — their own.
    const all = /^all (.+?) (?:they|you) control( that .+)?$/.exec(args);
    if (all && (who.ref === 'you' || (who.ref === 'players' && !who.attacking))) {
      const pf = parseFilter(`${all[1]}${all[2] ?? ''}`, b);
      if (!pf || !pf.plural || pf.filter.zone || pf.filter.controller) return null;
      const filter: ObjectFilter = { ...pf.filter, ...(who.ref === 'you' ? { controller: 'you' as const } : who.who === 'opponents' ? { controller: 'opponent' as const } : {}) };
      return [{ type: 'sacrifice', what: { ref: 'all', filter }, byController: true }];
    }
    // Soul Shatter: "Each opponent sacrifices a creature or planeswalker with the greatest mana value among creatures and
    // planeswalkers they control." — the greatest among their own, ties their choice.
    // Crackling Doom: "… among creatures that player controls".
    const greatest = /^(a|an) (.+?) with the greatest (mana value|power) among (.+?) (?:they|you) control$/.exec(args) ?? /^(a|an) (.+?) with the greatest (mana value|power) among (.+?) that player controls$/.exec(args);
    if (greatest) {
      const pf = parseFilter(greatest[2]!, b);
      const among = pf ? parseFilter(greatest[4]!.replace(/ and /, ' or '), b) : null;
      if (!pf || pf.plural || !among || !among.plural || JSON.stringify(pf.filter) !== JSON.stringify(among.filter)) return null;
      if (pf.filter.types?.includes('Creature')) b.it = { ref: 'sacrificed_this_way' };
      return [{ type: 'sacrifice_choice', who, filter: pf.filter, amount: 1, greatest: greatest[3] === 'power' ? 'power' : 'mana_value' }];
    }
    // God-Eternal Bontu: "sacrifice any number of other permanents" — you choose which (Scapeshift's lands too).
    const anyNum = /^any number of (other )?(.+)$/.exec(args);
    if (anyNum) {
      const pf = parseFilter(anyNum[2]!, b);
      if (who.ref !== 'you' || !pf || !pf.plural || pf.filter.zone || pf.filter.controller) return null;
      return [{ type: 'sacrifice_choice', who, filter: { ...pf.filter, ...(anyNum[1] ? { other: true } : {}) }, amount: 99, anyNumber: true }];
    }
    // Phyrexian Obliterator: "sacrifices that many permanents of their choice" — the damage dealt.
    const thatMany = /^that many (.+?)(?: of (?:their|your) choice)?$/.exec(args);
    if (thatMany && b.eventAmount) {
      const pf = parseFilter(thatMany[1]!, b);
      if (!pf || !pf.plural || pf.filter.zone) return null;
      return [{ type: 'sacrifice_choice', who, filter: pf.filter, amount: { kind: 'event' } }];
    }
    // CR 701.21a. "Each opponent sacrifices a creature": each of those players chooses one.
    // "sacrifices a creature of their choice" (the 2024 wording; CR 701.21a: the player chooses either way).
    // By Invitation Only: "Each player sacrifices X creatures of their choice" — X chosen as it resolves.
    const choice = /^(a|an|one|two|three|four|five|six|seven|eight|nine|ten|thirteen|\d+|another|X) (.+?)(?: of (?:their|your) choice)?$/.exec(args);
    if (choice) {
      const pf = parseFilter(choice[2]!, b);
      if (choice[1] === 'X') return pf?.plural && !pf.filter.zone ? [{ type: 'sacrifice_choice', who, filter: pf.filter, amount: 'X' }] : null;
      const amount = choice[1] === 'another' ? 1 : parseAmount(choice[1]!);
      // A numeral comes from a keyword definition ("sacrifices N permanents" with N = 1), so either number is fine.
      if (!pf || typeof amount !== 'number' || (pf.plural !== amount > 1 && !/^\d+$/.test(choice[1]!))) return null;
      if (choice[1] === 'another') pf.filter.other = true;
      // "… sacrifices a creature. You gain life equal to that creature's toughness." — the one sacrificed.
      // Not "sacrifice a Blood token. If you do, it gets +2/+2" — a creature pronoun still means the creature.
      if (amount === 1 && pf.filter.types?.includes('Creature')) b.it = { ref: 'sacrificed_this_way' };
      return [{ type: 'sacrifice_choice', who, filter: pf.filter, amount }];
    }
    // Specific objects: "sacrifice ~", "sacrifice it".
    const what = parseObjectRef(args, b);
    if (!what || what.targeted || what.ref.ref === 'all') return null;
    // "its controller sacrifices it" (evoke, CR 702.74a): the one who controls it does.
    const own = who.ref === 'controller_of' && JSON.stringify(who.of) === JSON.stringify(what.ref);
    if (who.ref !== 'you' && !own) return null;
    return [{ type: 'sacrifice', what: what.ref, ...(own ? { byController: true } : {}) }];
  },
  put(args, who, b, imperative) {
    if (!imperative) return null;
    // "Put a land card from your hand onto the battlefield (tapped)." — chosen as it resolves.
    // Ghalta, Last March of the Ents: "put any number of creature cards from your hand onto the battlefield".
    // Ugin, the Spirit Dragon: "put up to seven permanent cards from your hand onto the battlefield".
    // Kaalia of the Vast: "… onto the battlefield tapped and attacking that opponent" — attacking what the source attacks.
    const fromHand = /^(a|an|up to (?:one|two|three|four|five|six|seven)|any number of) (.+?) from your hand onto the battlefield( tapped)?( and attacking(?: that opponent| that player)?)?$/.exec(args);
    if (fromHand && fromHand[4] && !fromHand[3]) return null;
    // Michelangelo: "you may put a creature card and/or a land card from your hand onto the battlefield".
    const handEach = fromHand ? eachOfPair(fromHand[1]!, fromHand[2]!, 'hand', b) : undefined;
    if (handEach === null) return null;
    if (handEach) return [{ type: 'choose_from_hand', who: { ref: 'you' }, filter: {}, each: handEach, amount: 2, then: 'battlefield', optional: true, ...(fromHand![3] ? { tapped: true } : {}) }];
    if (fromHand) {
      const n = fromHand[1] === 'any number of' ? 99 : /^up to /.test(fromHand[1]!) ? (parseAmount(fromHand[1]!.slice(6)) as number) : 1;
      const pf = parseFilter(`${fromHand[2]} in your hand`, b);
      if (!pf || pf.plural !== n > 1) return null;
      const { zone: _z, owner: _o, ...filter } = pf.filter;
      // "That creature gains haste": the one put onto the battlefield.
      if (n === 1) b.it = { ref: 'created' };
      return [{ type: 'choose_from_hand', who: { ref: 'you' }, filter, amount: n, then: 'battlefield', ...(fromHand[3] ? { tapped: true } : {}), ...(fromHand[4] ? { attacking: / that (?:opponent|player)$/.test(fromHand[4]) ? 'that_player' : true } : {}), ...(/^(?:up to|any number)/.test(fromHand[1]!) ? { optional: true } : {}) }];
    }
    // "Put target creature card from a graveyard onto the battlefield under your control." — "return … to the battlefield".
    // The Darkness Crystal: "Put target creature card exiled with ~ onto the battlefield tapped under your control with two
    // additional +1/+1 counters on it."
    const onto = /^(.+?) onto the battlefield( tapped)?( transformed)?( under (?:your|its owner's|their owners'|their owner's) control)?(?: with (?:a|an|one|two|three) (?:additional )?\S+ counters? on it)?$/.exec(args);
    // Grim Return: "Choose target creature card in a graveyard …. Put that card onto the battlefield under your control." — a
    // target card in a graveyard.
    const itCardTarget = b.it?.ref === 'target' && b.targets[b.it.index]?.filter?.zone === 'graveyard';
    if (onto && ((!/ from your hand/.test(onto[1]!) && / from (?:a|your|an opponent's|target player's|that player's|defending player's|all) graveyards?$|^target .+ card$|^target .+ card in (?:a|your|an opponent's) graveyard$|^target .+ card exiled with (?:~|this \w+)$/.test(onto[1]!)) || onto[1] === '~ from your hand' || (/^(?:it|that card)(?: from (?:a|its owner's|their owner's) graveyard)?$/.test(onto[1]!) && (b.it?.ref === 'trigger_object' || b.it?.ref === 'chosen_object' || itCardTarget)) || (onto[1] === 'them' && Boolean(b.named['them'])))) {
      const r = attempt(b, (b) => VERBS.return!(args.replace(' onto the battlefield', ' to the battlefield'), who, b, imperative));
      if (r) return r;
    }
    // Approach of the Second Sun: "put ~ into its owner's library seventh from the top" (CR 401.4).
    const nth = /^(.+?) into (?:(?:its|their|his|her) owner's|your) library (second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth) from the top$/.exec(args);
    if (nth && imperative) {
      const what = parseObjectRef(nth[1]!, b);
      const n = ['second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'].indexOf(nth[2]!) + 2;
      return what && !what.plural ? [{ type: 'move', what: what.ref, to: 'library', position: n }] : null;
    }
    // Brokers Ascendancy: "put a +1/+1 counter on each creature you control and a loyalty counter on each planeswalker you
    // control" — two placements.
    const twoPlaces = /^((?:a|an|one|two|three) \S+ counters? on each .+?) and ((?:a|an|one|two|three) \S+ counters? on each .+)$/.exec(args);
    if (twoPlaces) {
      const r = attempt(b, (b) => {
        const one = VERBS.put!(twoPlaces[1]!, who, b, imperative);
        const two = one ? VERBS.put!(twoPlaces[2]!, who, b, imperative) : null;
        return one && two ? [...one, ...two] : null;
      });
      if (r) return r;
    }
    // CR 122.1b: "a double strike counter", "a first strike counter" (Avenging Huntbonder) — keyword counters.
    args = args.replace(/\b(first|double) strike (counters?)\b/g, '$1_strike $2');
    // "Put a number of +1/+1 counters equal to the power of the card you exiled on target creature." (scavenge)
    const counted = /^a number of (\S+) counters equal to (.+?) on (.+)$/.exec(args);
    if (counted) {
      const amount = counted[2] === 'the power of the card you exiled' ? { kind: 'stat', stat: 'power', of: { ref: 'self' } } : parseCount(counted[2]!, b);
      const what = amount ? parseObjectRef(counted[3]!, b) : null;
      return amount && what ? [{ type: 'add_counters', what: what.ref, counter: counted[1]!.replace(/−/g, '-'), amount }] : null;
    }
    // Guide of Souls: "put two +1/+1 counters and a flying counter on target attacking creature" — both on it.
    // Gift of the Viper: "a +1/+1 counter, a reach counter, and a deathtouch counter on target creature".
    const threeKinds = /^(a|an|one|two|three) (\S+) counters?, (a|an|one|two|three) (\S+) counters?, and (a|an|one|two|three) (\S+) counters? on (.+)$/.exec(args);
    if (threeKinds) {
      const ns = [threeKinds[1], threeKinds[3], threeKinds[5]].map((x) => parseAmount(x!));
      const what = ns.every((n) => typeof n === 'number') ? parseObjectRef(threeKinds[7]!, b) : null;
      if (!what) return null;
      return [0, 1, 2].map((i) => ({ type: 'add_counters', what: what.ref, counter: threeKinds[2 + i * 2]!.replace(/−/g, '-'), amount: ns[i] as number }));
    }
    const twoKinds = /^(a|an|one|two|three|four|five) (\S+) counters? and (a|an|one|two|three|four|five) (\S+) counters? on (.+)$/.exec(args);
    if (twoKinds) {
      const [n1, n2] = [parseAmount(twoKinds[1]!), parseAmount(twoKinds[3]!)];
      const what = typeof n1 === 'number' && typeof n2 === 'number' ? parseObjectRef(twoKinds[5]!, b) : null;
      if (!what) return null;
      return [
        { type: 'add_counters', what: what.ref, counter: twoKinds[2]!.replace(/−/g, '-'), amount: n1 },
        { type: 'add_counters', what: what.ref, counter: twoKinds[4]!.replace(/−/g, '-'), amount: n2 },
      ];
    }
    // Procrastinate: "Put twice X stun counters on it."
    const counters = /^(twice X|\S+) (\S+) counters? on (.+)$/.exec(args);
    if (counters) {
      const amount = counters[1] === 'twice X' ? { kind: 'x' as const, times: 2 } : parseAmount(counters[1]!);
      if (amount === null || !/^[+-]?\w+(?:\/[+-]\d+)?$/.test(counters[2]!)) return null;
      // Sword of Truth and Justice: "put a +1/+1 counter on a creature you control" — one chosen as it resolves.
      const one = /\btarget\b/.test(counters[3]!) ? null : /^(a|an|another) (.+)$/.exec(counters[3]!);
      if (one) {
        const pf = parseFilter(one[2]!, b);
        if (!pf || pf.plural || pf.filter.zone) return null;
        if (one[1] === 'another') pf.filter.other = true;
        // "It becomes …", "It gains …" after: the one chosen.
        b.it = { ref: 'chosen_object' };
        return [{ type: 'add_counters', choose: pf.filter, counter: counters[2]!.replace(/−/g, '-'), amount }];
      }
      const what = parseObjectRef(counters[3]!, b);
      if (!what) return null;
      return [{ type: 'add_counters', what: what.ref, counter: counters[2]!.replace(/−/g, '-'), amount }];
    }
    // Watcher for Tomorrow: "put the exiled card into its owner's hand"; "put it into its owner's graveyard" (CR 400.3:
    // a card goes to its owner's hand or graveyard).
    const into = /^(.+?) into (?:its owner's|their owners'|their owner's|your) (hand|graveyard)s?$/.exec(args);
    if (into && !/ from /.test(into[1]!)) {
      const r = attempt(b, (b) => {
        const what = parseObjectRef(into[1]!, b);
        return what ? [{ type: 'move', what: what.ref, to: into[2]! }] : null;
      });
      if (r) return r;
    }
    // Bow of Nylea: "Put up to four target cards from your graveyard on the bottom of your library in any order."
    // Terminus: "Put all creatures on the bottom of their owners' libraries."
    const lib = /^(.+?) on (top|the bottom) of (?:its owner's|their owners'|your) (?:library|libraries)( in any order)?$/.exec(args);
    if (lib) {
      const what = parseObjectRef(lib[1]!, b);
      if (lib[3] && (!what?.plural || !/\byour graveyard$/.test(lib[1]!))) return null;
      // Plow Under: "Put two target lands on top of their owners' libraries" — each owner orders theirs (CR 401.4), which
      // isn't asked yet.
      if (/libraries$/.test(args) && lib[2] === 'top') return null;
      return what ? [{ type: 'move', what: what.ref, to: 'library', position: lib[2] === 'top' ? 'top' : 'bottom', ...(lib[3] ? { order: 'any' } : {}) }] : null;
    }
    return null;
  },
  destroy: objectVerb('destroy'),
  exile(args, who, b, imperative) {
    // Rousing Refrain: "Exile ~ with three time counters on it." — with suspend, it's suspended (CR 702.62b).
    const withCounters = imperative && /\b(?:Instant|Sorcery)\b/.test(b.env.typeLine) ? /^~ with (\w+) (time) counters on it$/.exec(args) : null;
    if (withCounters) {
      const n = parseAmount(withCounters[1]!);
      return typeof n === 'number' ? [{ type: 'move', what: { ref: 'self' }, to: 'exile', counters: { [withCounters[2]!]: n } }] : null;
    }
    // Relic of Progenitus: "Target player exiles a card from their graveyard." — that player chooses it.
    const theirYard = !imperative && who.ref !== 'you' ? /^(a|an|one|two|three) (?:(.+?) )?cards? from (?:their|his or her) graveyard$/.exec(args) : null;
    if (theirYard) {
      const amount = parseAmount(theirYard[1] === 'an' ? 'a' : theirYard[1]!);
      const pf = theirYard[2] ? parseFilter(`${theirYard[2]} card in your graveyard`, b.clone()) : null;
      if (typeof amount !== 'number' || (theirYard[2] && (!pf || pf.plural))) return null;
      const { zone: _z, owner: _o, ...filter } = pf?.filter ?? {};
      return [{ type: 'players_do', players: who, effects: [{ type: 'return_chosen', filter, amount, to: 'exile' }] }];
    }
    // Masked Vandal: "you may exile a creature card from your graveyard. If you do, …" — chosen as it resolves (no target).
    const chosenExile = imperative && who.ref === 'you' ? /^(a|an) ((?!.*\btarget\b).+? card) from your graveyard$/.exec(args) : null;
    if (chosenExile) {
      const pf = parseFilter(`${chosenExile[2]} in your graveyard`, b);
      if (!pf || pf.plural) return null;
      const { zone: _z, owner: _o, ...filter } = pf.filter;
      b.it = { ref: 'created' };
      return [{ type: 'return_chosen', filter, amount: 1, to: 'exile' }];
    }
    // "that player exiles the top card of their library" (ingest), "Exile the top two cards of target player's library".
    // Necropotence: "Exile the top card of your library face down." (only you may look at it)
    const top = /^the top (card|(\w+) cards) of (your|their|(.+?)'s) library( face down)?$/.exec(args);
    if (top) {
      const amount = top[2] ? parseAmount(top[2]) : 1;
      if (amount === null || amount === undefined) return null;
      let owner: Ref | null = who;
      if (top[4]) owner = imperative ? parsePlayerRef(top[4], b) : null;
      else if ((top[3] === 'your') !== imperative) return null;
      if (!owner) return null;
      // "it", "that card", "those cards" afterward: the exiled cards.
      b.it = { ref: 'created' };
      return [{ type: 'exile_top', amount, who: owner, ...(top[5] ? { faceDown: true } : {}) }];
    }
    if (!imperative) return null;
    // Imprint (Chrome Mox, Isochron Scepter): "exile a nonartifact, nonland card from your hand" — chosen as it resolves.
    const fromHand = /^(a|an) ((?:.+? )?card\b.*?) from your hand$/.exec(args);
    if (fromHand) {
      const pf = parseFilter(`${fromHand[2]!} in your hand`, b);
      if (!pf || pf.plural) return null;
      const { zone: _z, owner: _o, ...filter } = pf.filter;
      // Kellan Joins Up: "If you do, it becomes plotted." — the exiled card.
      b.it = { ref: 'created' };
      return [{ type: 'choose_from_hand', who: { ref: 'you' }, filter, amount: 1, then: 'exile' }];
    }
    // CR 610.3: "exile target creature until ~ leaves the battlefield" (Banishing Light).
    // Palace Jailer: "… until an opponent becomes the monarch" (CR 610.3, with an event instead of leaving).
    const until = / until (?:~ leaves the battlefield|an opponent becomes the monarch)$/.exec(args);
    const what = parseObjectRef(until ? args.slice(0, until.index) : args, b);
    if (!what) {
      // "Exile target creature and target artifact."
      const list = until ? null : targetList(args, b);
      return list ? list.map((r) => ({ type: 'move', what: r, to: 'exile' })) : null;
    }
    return [{ type: 'move', what: what.ref, to: 'exile', ...(until ? { until: /monarch$/.test(until[0]) ? 'opponent_monarch' : 'source_leaves' } : {}) }];
  },
  return(args, who, b, imperative) {
    // Scrap Trawler: "return to your hand target artifact card in your graveyard with lesser mana value".
    const handFirst = /^to (your|its owner's) hand (.+)$/.exec(args);
    if (handFirst) return VERBS.return!(`${handFirst[2]} to ${handFirst[1]} hand`, who, b, imperative);
    // "Each player returns all creature cards from their graveyard to the battlefield": each returns their own,
    // so every such card in every graveyard (under its owner's control, to its owner's hand).
    if (!imperative) {
      const each = who.ref === 'players' && who.who === 'each' && !who.attacking ? /^((?:all|each) .+?) from their graveyards? to (the battlefield|their hands?)$/.exec(args) : null;
      const what = each ? parseObjectRef(`${each[1]} from all graveyards`, b) : null;
      return what && what.ref.ref === 'all' ? [{ type: 'move', what: what.ref, to: each![2] === 'the battlefield' ? 'battlefield' : 'hand' }] : null;
    }
    // Takenuma: "return a creature or planeswalker card from your graveyard to your hand" — chosen as it resolves (no
    // target). Blossoming Tortoise: "… to the battlefield tapped".
    // Tyvar, Jubilant Brawler: "a creature card with mana value 2 or less".
    // Lively Dirge: "up to two creature cards with total mana value 4 or less"; Technomancer: "any number of artifact creature
    // cards with total mana value 6 or less".
    // Eerie Ultimatum: "any number of permanent cards with different names".
    // Exalted Flamer of Tzeentch: "return an instant or sorcery card at random from your graveyard to your hand"; Moldgraf
    // Monstrosity: "two creature cards at random" — chosen at random, not by the player.
    const atRandom = /^(a|an|two|three) ((?!.*\btarget\b).+? cards?) at random from your graveyard to (your hand|the battlefield)$/.exec(args);
    if (atRandom && who.ref === 'you') {
      const n = /^an?$/.test(atRandom[1]!) ? 1 : parseAmount(atRandom[1]!);
      const pf = parseFilter(`${atRandom[2]} in your graveyard`, b);
      if (typeof n !== 'number' || !pf || pf.plural !== n > 1) return null;
      const { zone: _z, owner: _o, ...filter } = pf.filter;
      b.it = { ref: 'created' };
      return [{ type: 'return_chosen', filter, amount: n, to: atRandom[3] === 'your hand' ? 'hand' : 'battlefield', random: true }];
    }
    const differentNames = / with different names(?= from your graveyard)/.test(args);
    if (differentNames) args = args.replace(/ with different names(?= from your graveyard)/, '');
    if (differentNames && !/^(?:up to (?:two|three)|any number of) /.test(args)) return null;
    const chosenReturn = /^(a|an|up to (?:one|two|three)|any number of) ((?!.*\btarget\b).+? cards?(?: with (?:mana value|power|toughness) (?:(?!total ).)+?)?)(?: with total mana value (\d+|X) or less)? from your graveyard to (your hand|the battlefield( tapped)?)$/.exec(args);
    if (chosenReturn && who.ref === 'you') {
      const any = chosenReturn[1] === 'any number of';
      const n = any ? 2 : chosenReturn[1]!.startsWith('up to ') ? parseAmount(chosenReturn[1]!.slice(6)) : 1;
      const pf = parseFilter(`${chosenReturn[2]} in your graveyard`, b);
      if (typeof n !== 'number' || !pf || pf.plural !== n > 1) return null;
      const { zone: _z, owner: _o, ...filter } = pf.filter;
      const total = chosenReturn[3] ? parseAmount(chosenReturn[3]) : undefined;
      if (total === null) return null;
      // "it" afterwards: the returned card.
      b.it = { ref: 'created' };
      return [{ type: 'return_chosen', filter, amount: any ? 'all' : n, to: chosenReturn[4] === 'your hand' ? 'hand' : 'battlefield', ...(chosenReturn[5] ? { tapped: true } : {}), ...(chosenReturn[1]!.startsWith('up to ') || any ? { optional: true } : {}), ...(total !== undefined ? { totalMV: total } : {}), ...(differentNames ? { distinctNames: true } : {}) }];
    }
    const hand = /^(.+?) to (its owner's|their owners'|their owner's|your|its owners') hands?$/.exec(args);
    if (hand) {
      const what = parseObjectRef(hand[1]!, b);
      // "Return target permanent to its owner's hand. Then that player discards a card." — its owner.
      if (what && !what.plural && hand[2] === "its owner's" && !b.player) b.player = { ref: 'owner_of', of: what.ref };
      return what ? [{ type: 'move', what: what.ref, to: 'hand' }] : null;
    }
    // Mantle of the Ancients: "return any number of target Aura and/or Equipment cards from your graveyard to the battlefield
    // attached to enchanted creature"; Gryff's Boon: "Return this card from your graveyard to the battlefield attached to
    // target creature." (CR 303.4f: an Aura that can't be attached there stays where it is).
    const attachedRet = /^(.+?) to the battlefield attached to (.+)$/.exec(args);
    if (attachedRet) {
      const r = attempt(b, (b) => {
        // Unfinished Business: "… attached to that creature" — the one before, so it's read first.
        const to = parseObjectRef(attachedRet[2]!, b);
        const what = to ? parseObjectRef(attachedRet[1]!, b) : null;
        if (!what || !to || to.plural || to.ref.ref === 'all' || to.ref.ref === 'you') return null;
        return [{ type: 'move', what: what.ref, to: 'battlefield', attachTo: to.ref }];
      });
      if (r) return r;
    }
    // Ojer Taq: "return it to the battlefield tapped and transformed under its owner's control"
    // Alesha, Who Smiles at Death: "… to the battlefield tapped and attacking" (CR 508.4).
    const field = /^(.+?) to the battlefield( tapped)?(?: and)?( attacking)?(?: and)?( transformed)?( under (?:your|its owner's|his owner's|her owner's|their owners'|their owner's) control)?(?: with (a|an|one|two|three) (?:additional )?(\S+) counters?(?: and (a|an|one|two|three) (\S+) counters?)? on (?:it|him|her))?$/.exec(args);
    // (Attacking only as "tapped and attacking", and not with "transformed" too.)
    if (field && (!field[3] || (field[2] && !field[4]))) {
      const what = parseObjectRef(field[1]!, b);
      if (!what) return null;
      const node: EffectNode = { type: 'move', what: what.ref, to: 'battlefield' };
      if (field[2]) node.tapped = true;
      if (field[3]) node.attacking = true;
      // CR 712.14a
      if (field[4]) node.transformed = true;
      if (field[5] === ' under your control') node.under = 'you';
      // CR 122.6: "with a -1/-1 counter on it" — it enters with the counter.
      if (field[6]) node.counters = { [field[7]!.replace(/−/g, '-')]: parseAmount(field[6]!) };
      // Perennation: "with a hexproof counter and an indestructible counter on it".
      if (field[8]) (node.counters as Record<string, unknown>)[field[9]!.replace(/−/g, '-')] = parseAmount(field[8]!);
      return [node];
    }
    return null;
  },
  // Absolving Lammasu: "you gain 3 life and suspect up to one target creature an opponent controls" (CR 701.60a).
  suspect: objectVerb('suspect'),
  // Charismatic Conqueror: "they may tap that permanent" — tapping is the same whoever does it.
  tap: (args, who, b, imperative) => objectVerb('tap')(args, who, b, imperative || (who.ref !== 'players' && /^(?:it|that permanent|that creature)$/.test(args))),
  untap(args, who, b, imperative) {
    // "untap up to two lands", "untap up to four target lands" (the latter targets)
    const upTo = imperative ? /^up to (\w+) (?!target )(.+)$/.exec(args) : null;
    if (upTo) {
      const n = parseAmount(upTo[1]!);
      const pf = typeof n === 'number' ? parseFilter(upTo[2]!, b) : null;
      if (!pf || !pf.plural || pf.filter.zone || typeof n !== 'number') return null;
      return [{ type: 'untap_chosen', filter: pf.filter, amount: n }];
    }
    // White Plume Adventurer: "untap a creature you control" — one you choose (no target).
    const one = imperative ? /^(a|an|one|two) ((?!target )(?:creature|land|permanent|artifact)s? you control)$/.exec(args) : null;
    if (one) {
      const n = /^an?$/.test(one[1]!) ? 1 : parseAmount(one[1]!);
      const pf = typeof n === 'number' ? parseFilter(one[2]!, b) : null;
      if (pf && !pf.filter.zone && typeof n === 'number' && pf.plural === n > 1) return [{ type: 'untap_chosen', filter: pf.filter, amount: n, exactly: true }];
    }
    return objectVerb('untap')(args, who, b, imperative);
  },
  counter: objectVerb('counter'),
  regenerate: objectVerb('regenerate'),
  search(args, who, b, imperative) {
    // "Search target opponent's library for an artifact card and exile it." — you search their library.
    const other = imperative ? /^(target opponent's|target player's|that player's|its controller's|their) library for (.+?) and (exile (?:it|them|that card|those cards)|put (?:it|them|that card) onto the battlefield under your control|put (?:it|them|that card) into (?:its owner's|their owner's|that player's) graveyard)$/.exec(args) : null;
    if (other) {
      return attempt(b, (b) => {
        const owner = other[1] === 'their' ? b.player : parsePlayerRef(other[1]!.replace(/'s$/, ''), b);
        const q = /^(?:(a|an|one)|up to (\w+)|(\w+)) (.+)$/.exec(other[2]!);
        if (!owner || !q) return null;
        const amount = q[1] ? 1 : parseAmount(q[2] ?? q[3]!);
        const pf = typeof amount === 'number' ? parseFilter(`${q[4]} in your library`, b) : null;
        if (!pf || typeof amount !== 'number' || pf.plural !== amount > 1) return null;
        const { owner: _o, ...filter } = pf.filter;
        const to = other[3]!.startsWith('exile') ? 'exile' : other[3]!.includes('battlefield') ? 'battlefield' : 'graveyard';
        return [{ type: 'search', filter, amount, to, library: owner, ...(q[2] ? { upTo: true } : {}) }];
      });
    }
    // CR 701.23: "Search your library for a basic land card, put it onto the battlefield tapped, then shuffle."
    // "Target player may search their library for a card named …, reveal it, put it into their hand, then shuffle."
    const theirs = !imperative && /^their library /.test(args);
    if (!imperative && !theirs) return null;
    if (theirs) {
      args = args.replace(/^their library /, 'your library ').replace(/ into their hand/, ' into your hand').replace(/ into their graveyard/, ' into your graveyard');
      // Field of Ruin: "Each player searches their library for a basic land card, puts it onto the battlefield, then shuffles."
      args = args.replace(/, (?:reveals (it|them|that card|those cards), )?puts (it|them) /, (_m, r?: string, p?: string) => `, ${r ? `reveal ${r}, ` : ''}put ${p} `).replace(/, then shuffles$/, ', then shuffle');
      // Varragoth: "Target player searches their library for a card, then shuffles and puts that card on top."
      args = args.replace(/, then shuffles and puts (that card|it) on top$/, ', then shuffle and put $1 on top');
    }
    // "your library and/or graveyard", "your graveyard, hand, and/or library": several zones.
    const zonesWord = /^your (library and\/or graveyard|graveyard and\/or library|graveyard, hand, and\/or library|hand, graveyard, and\/or library|library, graveyard, and\/or hand) for /.exec(args);
    const zones = zonesWord ? zonesWord[1]!.split(/,? (?:and\/or )?|, /).filter(Boolean) : null;
    if (zonesWord) {
      args = args.replace(zonesWord[0], 'your library for ').replace(/, reveal it, and put it/, ', reveal it, put it').replace(/ and put (it|them) (?=onto|into)/, ', put $1 ');
      // The shuffle comes in its own sentence ("If you search your library this way, shuffle.").
      if (!/, then shuffle$/.test(args)) args += ', then shuffle';
    }
    // Cultivate: "…, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle."
    // Nissa's Pilgrimage: "… and put one onto the battlefield tapped and the rest into your hand"; Viewpoint Synchronization:
    // "up to three basic land cards …. Put two of them onto the battlefield tapped and the other into your hand".
    const split = /^your library for up to (two|three|four) (.+?), reveal (?:them|those cards), (?:and )?put (one|two|three)(?: of them)? onto the battlefield( tapped)? and the (?:other|rest) into your hand, then shuffle$/.exec(args);
    if (split) {
      const amount = parseAmount(split[1]!) as number;
      const onto = parseAmount(split[3]!) as number;
      const pf = onto < amount ? parseFilter(`${split[2]} in your library`, b) : null;
      if (!pf || !pf.plural) return null;
      return [{ type: 'search', filter: pf.filter, amount, upTo: true, to: 'hand', split: { to: 'battlefield', ...(onto > 1 ? { count: onto } : {}), ...(split[4] ? { tapped: true } : {}) } }];
    }
    // Gamble: "Search your library for a card, put that card into your hand, discard a card at random, then shuffle."
    const gamble = /^your library for a card, put that card into your hand, discard a card at random, then shuffle$/.test(args);
    if (gamble && who.ref === 'you' && !zones) {
      return [
        { type: 'search', filter: { zone: 'library', owner: 'you' }, amount: 1, to: 'hand' },
        { type: 'discard', amount: 1, who: { ref: 'you' }, random: true },
      ];
    }
    // Ugin, Eye of the Storms: "Search your library for any number of colorless nonland cards, exile them, then shuffle."
    const exiling = /, exile (?:it|them|that card|those cards)( face down)?, then shuffle$/.exec(args);
    if (exiling) args = `${args.slice(0, exiling.index)}, put them into exile, then shuffle`;
    const m =
      /^your library for (.+?), (?:reveal (?:it|them|those cards|that card), )?put (?:it|them|that card|those cards) (into your hand|onto the battlefield( tapped)?(?: with an additional (\+1\/\+1) counter on it)?|into your graveyard|into exile), then shuffle$/.exec(args) ??
      // Congregation at Dawn: "up to three creature cards, reveal them, then shuffle and put those cards on top in any order"
      // — in the order they're chosen.
      /^your library for (.+?), (?:reveal (?:it|that card|them|those cards), )?then shuffle and put (?:that card|it|the card|those cards|them) (on top)(?: in any order)?$/.exec(args);
    if (!m) return null;
    // Krosan Verge: "a Forest card and a Plains card" — one of each.
    const pair = /^(?:a|an) (.+? card) and (?:a|an) (.+? card)$/.exec(m[1]!);
    if (pair) {
      const fs = [pair[1]!, pair[2]!].map((t) => parseFilter(`${t} in your library`, b));
      if (fs.some((f) => !f || f.plural)) return null;
      const filters = fs.map((f) => (({ zone: _z, owner: _o, ...rest }) => rest)(f!.filter));
      const to = m[2]!.startsWith('into your hand') ? 'hand' : m[2]!.startsWith('onto') ? 'battlefield' : m[2] === 'on top' ? 'library' : m[2] === 'into exile' ? 'exile' : 'graveyard';
      if (to === 'library' || to === 'exile') return null;
      const node: EffectNode = { type: 'search', filter: { zone: 'library', owner: 'you' }, filters, amount: 2, to };
      if (theirs) node.who = who;
      if (m[3]) node.tapped = true;
      return [node];
    }
    // Demonic Counsel: "for any card" is "for a card"; The World Tree: "for any number of God cards" — as many as you like.
    const q = /^(?:(a|an|one|any(?= card\b))|up to (\w+)|(any number of|\w+)) (.+)$/.exec(m[1]!);
    if (!q) return null;
    const anyNumber = q[3] === 'any number of';
    const amount = q[1] ? 1 : anyNumber ? 999 : parseAmount(q[2] ?? q[3]!);
    // "up to X basic land cards, where X is …" (Traverse the Outlands): the sentence binds X.
    if (typeof amount !== 'number' && !(amount === 'X' && q[2])) return null;
    // Tiamat: "up to five Dragon cards not named Tiamat that each have different names".
    const differentNames = / that each have different names$| with different names$/.exec(q[4]!);
    if (differentNames) q[4] = q[4]!.slice(0, differentNames.index);
    // Protean Hulk: "any number of creature cards with total mana value 6 or less".
    const totalMV = / with total mana value (\d+|X) or less$/.exec(q[4]!);
    if (totalMV) q[4] = q[4]!.slice(0, totalMV.index);
    // Myriad Landscape: "up to two basic land cards that share a land type"
    const share = / that share a land type$/.test(q[4]!);
    const pf = parseFilter(`${q[4]!.replace(/ that share a land type$/, '')} in your library`, b);
    if (!pf || pf.plural !== (amount === 'X' || (amount as number) > 1) || (share && (amount === 'X' || (amount as number) < 2))) return null;
    const to = m[2]!.startsWith('into your hand') ? 'hand' : m[2]!.startsWith('onto') ? 'battlefield' : m[2] === 'on top' ? 'library' : m[2] === 'into exile' ? 'exile' : 'graveyard';
    const node: EffectNode = { type: 'search', filter: pf.filter, amount, to };
    if (exiling?.[1]) node.faceDown = true;
    if (to === 'exile') b.it = { ref: 'created' };
    if (zones) node.zones = zones;
    if (theirs) node.who = who;
    if (q[2] || anyNumber) node.upTo = true;
    if (totalMV) node.totalMV = parseAmount(totalMV[1]!) as number | 'X';
    if (differentNames) node.distinctNames = true;
    if (m[3]) node.tapped = true;
    // Neoform: "put that card onto the battlefield with an additional +1/+1 counter on it" (CR 614.1c).
    if (m[4]) {
      if (amount !== 1) return null;
      node.counters = { [m[4]]: 1 };
    }
    if (share) node.sameLandType = true;
    return [node];
  },
  // CR 701.62a: "manifest dread" — "that creature" is the manifested permanent afterward.
  manifest(args, who, b) {
    // Unwanted Remake: "Destroy target creature. Its controller manifests dread." — that player.
    if (args !== 'dread' || !(who.ref === 'you' || who.ref === 'controller_of' || who.ref === 'target')) return null;
    b.it = { ref: 'created' };
    return [{ type: 'manifest', amount: 1, dread: true, ...(who.ref !== 'you' ? { who } : {}) }];
  },
  // CR 115.7a: "Change the target of target spell or ability with a single target." (Bolt Bend, Redirect Lightning)
  change(args, who, b, imperative) {
    // Spellskite: "Change a target of target spell or ability to this creature." (CR 115.7c)
    const one = imperative ? /^a target of (target .+?) to (?:this creature|~)$/.exec(args) : null;
    if (one) {
      const what = parseObjectRef(one[1]!, b);
      if (!what?.targeted || what.plural || what.ref.ref !== 'target') return null;
      const spec = b.targets[what.ref.index];
      if (!spec || (spec.what !== 'ability' && spec.filter?.zone !== 'stack')) return null;
      return [{ type: 'retarget', what: what.ref, change: true, toSelf: true, oneOf: true }];
    }
    // Hydroelectric Specimen: "… with a single target to this creature" — to it, if it's a legal target (CR 115.7a).
    const m = imperative ? /^the target of (target .+?) with a single target( to (?:this creature|~))?$/.exec(args) : null;
    if (!m) return null;
    const what = parseObjectRef(m[1]!, b);
    if (!what?.targeted || what.plural || what.ref.ref !== 'target') return null;
    const spec = b.targets[what.ref.index];
    if (!spec || (spec.what !== 'ability' && spec.filter?.zone !== 'stack')) return null;
    spec.singleTarget = true;
    return [{ type: 'retarget', what: what.ref, change: true, ...(m[2] ? { toSelf: true } : {}) }];
  },
  // "choose target instant or sorcery card in your graveyard, then roll a d20" — the target, for what follows.
  choose(args, who, b, imperative) {
    // CR 115.7d: "You may choose new targets for target spell or ability" (Deflecting Swat).
    const fresh = imperative ? /^new targets for (target .+)$/.exec(args) : null;
    if (fresh) {
      const what = parseObjectRef(fresh[1]!, b);
      return what?.targeted && !what.plural ? [{ type: 'retarget', what: what.ref }] : null;
    }
    if (!imperative || !/^(?:up to (?:one|two|three) |one |two |three )?target /.test(args)) return null;
    const what = parseObjectRef(args, b);
    if (!what?.targeted) return null;
    // Victimize: "… Return the chosen cards to the battlefield tapped."
    const names = what.plural ? ['the chosen cards', 'the chosen creatures', 'the chosen permanents'] : ['the chosen card', 'the chosen creature', 'the chosen permanent'];
    b.named = { ...b.named, ...Object.fromEntries(names.map((n) => [n, what.ref])) };
    return [];
  },
  // CR 601.2d: "Distribute three +1/+1 counters among one, two, or three target creatures (you control)."
  distribute(args, who, b, imperative) {
    const m = imperative ? /^(\w+) (\S+) counters among (any number of|one or two|one, two, or three|up to (\w+)) (target .+)$/.exec(args) : null;
    if (!m) return null;
    const amount = parseAmount(m[1]!);
    const most = m[3] === 'any number of' ? 100 : m[3] === 'one or two' ? 2 : m[3] === 'one, two, or three' ? 3 : parseAmount(m[4]!);
    if (typeof amount !== 'number' || typeof most !== 'number') return null;
    const pf = parseFilter(m[5]!.replace(/^target /, ''), b);
    if (!pf || !pf.plural || pf.filter.zone) return null;
    const what = b.addTarget({ what: 'object', filter: pf.filter, text: m[5]!, count: Math.min(most, amount), upTo: true, min: 1 });
    return [{ type: 'add_counters', what, counter: m[2]!.replace(/−/g, '-'), amount, divided: true }];
  },
  // CR 706: "roll a d4 and create a number of Treasure tokens equal to the result"
  roll(args, who, b, imperative) {
    const m = imperative ? /^a d(\d+)$/.exec(args) : null;
    return m ? [{ type: 'roll_die', sides: Number(m[1]) }] : null;
  },
  // CR 506.4: "Remove target attacking creature from combat", "remove it from combat".
  remove(args, who, b, imperative) {
    const m = imperative ? /^(.+) from combat$/.exec(args) : null;
    const what = m ? parseObjectRef(m[1]!, b) : null;
    return what ? [{ type: 'remove_from_combat', what: what.ref }] : null;
  },
  // CR 702.151a: "Unattach this permanent."
  unattach(args, who, b, imperative) {
    return imperative && args === '~' ? [{ type: 'unattach', what: { ref: 'self' } }] : null;
  },
  attach(args, who, b, imperative) {
    // Codsworth: "Attach target Aura or Equipment you control to target creature you control." (CR 701.3)
    // Blacksmith's Talent: "attach target Equipment you control to up to one target creature you control".
    // Barret: "attach up to one target Equipment you control to target Rebel you control"; Sokka: "… to ~".
    // Magnetic Theft: "Attach target Equipment to target creature." — anyone's (it stays its controller's, CR 301.5c).
    // Cloud, Ex-SOLDIER: "When Cloud enters, attach up to one target Equipment you control to it."
    const both = imperative ? /^((?:up to one )?target (?:Aura|Equipment|Aura or Equipment)(?: you control)?) to ((?:up to one )?target .+|~|it)$/.exec(args) : null;
    if (both) {
      const it = both[2] === 'it' ? b.it : null;
      if (both[2] === 'it' && it?.ref !== 'self' && it?.ref !== 'trigger_object') return null;
      const what = parseObjectRef(both[1]!, b);
      const to = what && !what.plural ? (it ? { ref: it, plural: false } : parseObjectRef(both[2]!, b)) : null;
      return what && to && !to.plural ? [{ type: 'attach', what: what.ref, to: to.ref }] : null;
    }
    // Balan, Wandering Knight: "Attach all Equipment you control to Balan."
    const all = imperative ? /^(all (?:Equipment|Auras) you control) to (~|target creature you control)$/.exec(args) : null;
    if (all) {
      const what = parseObjectRef(all[1]!, b);
      const to = what?.plural ? parseObjectRef(all[2]!, b) : null;
      return what && to && !to.plural ? [{ type: 'attach', what: what.ref, to: to.ref, all: true }] : null;
    }
    const m = /^(~|it|that Equipment) to (.+)$/.exec(args);
    if (!m || !imperative) return null;
    // Sigarda's Aid: "Whenever an Equipment you control enters, you may attach it to target creature you control."
    const what: Ref | null = m[1] === '~' ? { ref: 'self' } : b.it && (b.it.ref === 'self' || b.it.ref === 'trigger_object') ? b.it : null;
    if (!what || (m[1] === 'that Equipment' && what.ref !== 'trigger_object')) return null;
    const to = parseObjectRef(m[2]!, b);
    return to && !to.plural ? [{ type: 'attach', what, to: to.ref }] : null;
  },
};

function objectVerb(type: string): VerbHandler {
  return (args, _who, b, imperative) => {
    if (!imperative) return null;
    const what = parseObjectRef(args, b);
    if (what) return [{ type, what: what.ref }];
    // Decimate: "Destroy target artifact, target creature, target enchantment, and target land." — each its own target.
    const list = targetList(args, b);
    return list ? list.map((r) => ({ type, what: r })) : null;
  };
}

/** "target artifact and target enchantment", "target artifact, target creature, and target land": two or more targets. */
function targetList(args: string, b: Binder): Ref[] | null {
  const parts = args.split(/,? and (?=target )|, (?=target )/);
  if (parts.length < 2 || !parts.every((p) => /^target /.test(p))) return null;
  return attempt(b, (b) => {
    const refs: Ref[] = [];
    for (const p of parts) {
      const r = parseObjectRef(p, b);
      if (!r || r.plural || !r.targeted) return null;
      refs.push(r.ref);
    }
    return refs;
  });
}

for (const lemma of Object.keys(VERBS)) {
  VERB_FORMS[lemma] = lemma;
  VERB_FORMS[lemma.endsWith('y') ? `${lemma.slice(0, -1)}ies` : /(?:ch|sh|s|x)$/.test(lemma) ? `${lemma}es` : `${lemma}s`] = lemma;
}
VERB_FORMS.scries = 'scry';

const VERB_ALT = Object.keys(VERB_FORMS)
  .sort((a, b) => b.length - a.length)
  .join('|');
const IMPERATIVE = new RegExp(`^(${VERB_ALT}) (.+)$`, 'i');
const WITH_SUBJECT = new RegExp(`^(.+?) (${VERB_ALT}) (.+)$`);
/** Feed the Infection: "Each opponent who has three or more poison counters loses 3 life." — past the relative clause's own
 * verbs (and nouns like "counters"), each later verb in turn. */
function relativeSplits(c: string): RegExpExecArray[] {
  if (!/^(?:each|every) (?:opponent|player) who /i.test(c)) return [];
  const out: RegExpExecArray[] = [];
  const re = new RegExp(` (${VERB_ALT}) `, 'g');
  for (let m = re.exec(c); m; m = re.exec(c)) {
    re.lastIndex = m.index + 1;
    const r = new RegExp(`^(.{${m.index}}) (${VERB_ALT}) (.+)$`).exec(c);
    if (r) out.push(r);
  }
  return out;
}

/** Replacement and prevention effects created by a resolving spell (CR 614, CR 615). */
function parseReplacement(c: string, b: Binder): EffectNode[] | null {
  // Incinerate: "A creature dealt damage this way can't be regenerated this turn." (CR 701.19c) — what the damage was
  // dealt to.
  if (/^(?:A creature|Creatures) dealt damage this way can't be regenerated this turn$/.test(c)) {
    return b.damaged ? [{ type: 'modify', what: b.damaged, rules: ['cant_be_regenerated'], until: 'eot' }] : null;
  }
  // CR 614.1a: "If that creature would die this turn, exile it instead."
  const dies = /^If (.+?) would die this turn, exile it instead$/.exec(c);
  if (dies) {
    // "a creature dealt damage this way": what the spell's damage was dealt to.
    if (/^an? (?:creature|permanent|creature or planeswalker) dealt damage this way$/.test(dies[1]!)) {
      return b.damaged ? [{ type: 'exile_if_dies', what: b.damaged }] : null;
    }
    // "If that creature or planeswalker would die this turn" — the object the sentence before was about.
    const what = parseObjectRef(dies[1]!.replace(/^that (creature|permanent) or planeswalker$/, 'that $1'), b);
    return what ? [{ type: 'exile_if_dies', what: what.ref }] : null;
  }
  // CR 702.84a (unearth): "If it would leave the battlefield, exile it instead of putting it anywhere else."
  const leave = /^If (.+?) would leave the battlefield, exile (?:it|them) instead of putting (?:it|them) anywhere else$/.exec(c);
  if (leave) {
    const what = parseObjectRef(leave[1]!, b);
    return what ? [{ type: 'exile_on_leave', what: what.ref }] : null;
  }
  // CR 615.1a: prevention. "Prevent all combat damage that would be dealt this turn."
  if (/^Prevent all combat damage that would be dealt this turn$/.test(c)) return [{ type: 'prevent', amount: 'all', combat: true }];
  const next = /^Prevent the next (\S+) damage that would be dealt to (.+?) this turn$/.exec(c);
  if (next) {
    const amount = parseAmount(next[1]!);
    const to = parseRecipients(next[2]!, b);
    return amount !== null && to?.length === 1 ? [{ type: 'prevent', amount, to: to[0] }] : null;
  }
  // Maze of Ith: "Prevent all combat damage that would be dealt to and dealt by that creature this turn." — two shields.
  const both = /^Prevent all (combat )?damage that would be dealt to and dealt by (.+?) this turn$/.exec(c);
  if (both) {
    const to = parseRecipients(both[2]!, b);
    return to?.length === 1 ? [{ type: 'prevent', amount: 'all', ...(both[1] ? { combat: true } : {}), to: to[0] }, { type: 'prevent', amount: 'all', ...(both[1] ? { combat: true } : {}), by: to[0] }] : null;
  }
  // Heavy Fog: "Prevent all damage that would be dealt to you this turn by attacking creatures." — both.
  const toBy = /^Prevent all (combat )?damage that would be dealt to (.+?) this turn by (.+)$/.exec(c);
  if (toBy) {
    const to = parseRecipients(toBy[2]!, b);
    const by = to ? parseRecipients(toBy[3]!, b) : null;
    if (!to?.length || by?.length !== 1 || by[0]!.ref !== 'all') return null;
    return to.map((t) => ({ type: 'prevent', amount: 'all', ...(toBy[1] ? { combat: true } : {}), to: t, by: by[0]! }));
  }
  // Morningtide's Light: "Until your next turn, prevent all damage that would be dealt to you." — the shield lasts until then.
  const untilNext = /^Until your next turn, prevent all damage that would be dealt to (you|you and permanents you control|you and creatures you control)$/.exec(c);
  if (untilNext) {
    const to = parseRecipients(untilNext[1]!, b);
    return to?.length ? to.map((t) => ({ type: 'prevent', amount: 'all', to: t, until: 'your_next_turn' })) : null;
  }
  // Obscuring Haze: "Prevent all damage that would be dealt this turn by creatures your opponents control."
  // Safe Passage: "Prevent all damage that would be dealt to you and creatures you control this turn." — a shield for each.
  // Haze Frog: "prevent all combat damage that other creatures would deal this turn" — dealt by them.
  c = c.replace(/^([Pp])revent all (combat )?damage that (other creatures|creatures your opponents control|creatures you don't control) would deal this turn$/, (_m, p: string, combat: string | undefined, who: string) => `${p}revent all ${combat ?? ''}damage that would be dealt this turn by ${who}`);
  const all = /^Prevent all (combat )?damage that would be dealt (?:to|by) (.+?) this turn$/.exec(c) ?? /^Prevent all (combat )?damage that would be dealt this turn (?:to|by) (.+)$/.exec(c);
  if (all) {
    const to = parseRecipients(all[2]!, b);
    const by = /dealt (?:this turn )?by/.test(c);
    if (!to?.length || (by && to.length !== 1)) return null;
    return to.map((t) => ({ type: 'prevent', amount: 'all', ...(all[1] ? { combat: true } : {}), [by ? 'by' : 'to']: t }));
  }
  return null;
}

/** Keyword actions that are a whole clause on their own. */
function parseKeywordAction(c: string, b: Binder): EffectNode[] | null {
  // CR 702.112a: "… and it becomes renowned".
  if (/^(?:it|~) becomes renowned$/i.test(c)) return [{ type: 'become_renowned' }];
  // CR 701.53a: "Incubate 4", "incubate X, where X is …"; Excise the Imperfect: "Its controller incubates X".
  const incubate = /^(?:(.+?) )?incubates? (\d+|X)$/i.exec(c);
  if (incubate) {
    const who = incubate[1] ? parsePlayerRef(incubate[1], b) : { ref: 'you' as const };
    const amount = incubate[2] === 'X' ? 'X' : Number(incubate[2]);
    if (who) return [{ type: 'incubate', amount, ...(who.ref === 'you' ? {} : { who }) }];
  }
  // CR 701.16a: "Investigate" means "Create a Clue token."
  if (/^investigate$/i.test(c)) {
    const clue = parseTokenPhrase('a Clue token', b);
    return clue ? [{ type: 'create_token', amount: 1, token: clue.face, who: { ref: 'you' } }] : null;
  }
  // Fateful Absence: "Destroy target creature or planeswalker. Its controller investigates."
  const theyInvestigate = /^(.+?) investigates$/i.exec(c);
  if (theyInvestigate) {
    const who = parsePlayerRef(theyInvestigate[1]!, b);
    const clue = who && who.ref !== 'players' ? parseTokenPhrase('a Clue token', b) : null;
    if (clue) return [{ type: 'create_token', amount: 1, token: clue.face, who }];
  }
  // CR 701.65a: "Airbend target nonland permanent", "airbend up to one other target creature or spell".
  const airbend = /^airbend (.+)$/i.exec(c);
  if (airbend) {
    const it = b.it;
    const what = parseObjectRef(airbend[1]!, b);
    // Avatar's Wrath: "Choose up to one target creature, then airbend all other creatures" — other than that one.
    if (what && what.ref.ref === 'all' && what.ref.filter?.other && it?.ref === 'target') {
      const { other: _o, ...filter } = what.ref.filter;
      return [{ type: 'airbend', what: { ...what.ref, filter: { ...filter, otherThan: it } } }];
    }
    return what ? [{ type: 'airbend', what: what.ref }] : null;
  }
  // CR 701.66a: "Earthbend N" — "Target land you control becomes a 0/0 land creature with haste in addition to its other
  // types. Put N +1/+1 counters on it. When that land dies or is put into exile, return it to the battlefield tapped
  // under your control."
  const earthbend = /^earthbend (\S+)$/i.exec(c);
  if (earthbend) {
    const amount = parseAmount(earthbend[1]!);
    if (amount === null) return null;
    const land = b.addTarget({ what: 'object', filter: { types: ['Land'], controller: 'you' }, text: 'target land you control' });
    return [
      { type: 'modify', what: land, types: ['Creature'], subtypes: [], retainTypes: true, setPower: 0, setToughness: 0, keywords: [{ id: 'haste' }], until: 'game' },
      { type: 'add_counters', what: land, counter: '+1/+1', amount },
      { type: 'delayed_leave', what: land, effects: [{ type: 'move', what: { ref: 'trigger_object' }, to: 'battlefield', tapped: true, under: 'you' }] },
    ];
  }
  // CR 701.37a: "Monstrosity N".
  const monstrosity = /^monstrosity (\S+)$/i.exec(c);
  if (monstrosity) {
    const amount = parseAmount(monstrosity[1]!);
    return amount !== null ? [{ type: 'monstrosity', amount }] : null;
  }
  // CR 701.46a: "Adapt N" means "If this permanent has no +1/+1 counters on it, put N +1/+1 counters on it."
  const adapt = /^adapt (\S+)$/i.exec(c);
  if (adapt) {
    const amount = parseAmount(adapt[1]!);
    if (amount === null || amount === undefined) return null;
    return [
      {
        type: 'if',
        cond: { type: 'counters', of: { ref: 'self' }, counter: '+1/+1', max: 0 },
        effects: [{ type: 'add_counters', what: { ref: 'self' }, counter: '+1/+1', amount }],
      },
    ];
  }
  // CR 701.44a: "~ explores", "target creature you control explores".
  // Over the Edge: "Target creature you control explores, then it explores again."
  const twice = /^(.+?) explores, then it explores again$/i.exec(c);
  if (twice) {
    const what = parseObjectRef(twice[1]!, b);
    return what && !what.plural ? [{ type: 'explore', what: what.ref }, { type: 'explore', what: what.ref }] : null;
  }
  const explore = /^(.+?) explores$/i.exec(c);
  if (explore) {
    const what = parseObjectRef(explore[1]!, b);
    // Hakbal: "each Merfolk creature you control explores" — each in turn.
    return what && (!what.plural || what.ref.ref === 'all') ? [{ type: 'explore', what: what.ref }] : null;
  }
  // CR 107.14 / CR 122.1: "you get {E}{E}", "you get an experience counter" — counters on a player.
  // Aethertide Whale: "you get six {E}"; Robobrain War Mind: "you get an amount of {E} equal to the number of artifact
  // creatures you control".
  const energyWords = /^(.+?) gets? (two|three|four|five|six|seven|eight|nine|ten) \{E\}$/i.exec(c) ?? /^(.+?) gets? an amount of \{E\} equal to (.+)$/i.exec(c);
  if (energyWords) {
    const who = parsePlayerRef(energyWords[1]!, b);
    const n = parseAmount(energyWords[2]!);
    const amount = typeof n === 'number' ? n : who ? parseCount(energyWords[2]!, b) : null;
    return who && amount !== null ? [{ type: 'get_counters', who, counter: 'energy', amount }] : null;
  }
  const energy = /^(.+?) gets? ((?:\{E\})+)$/i.exec(c);
  const experience = /^(.+?) gets? (an?|one|two|three|four|five|six|seven|eight|nine|ten|that many) (experience|rad|poison) counters?$/i.exec(c);
  // Feral Ghoul: "each opponent gets a number of rad counters equal to its power".
  const numberOf = /^(.+?) gets? a number of (experience|rad|poison) counters equal to (.+)$/i.exec(c);
  if (numberOf) {
    const who = parsePlayerRef(numberOf[1]!, b);
    const amount = who ? parseCount(numberOf[3]!, b) : null;
    return who && amount ? [{ type: 'get_counters', who, counter: numberOf[2]!.toLowerCase(), amount }] : null;
  }
  // Peema Trailblazer: "you get that many {E}" — how much damage the trigger event was.
  const thatManyEnergy = /^(.+?) gets? that many \{E\}$/i.exec(c);
  if (thatManyEnergy && b.eventAmount) {
    const who = parsePlayerRef(thatManyEnergy[1]!, b);
    return who ? [{ type: 'get_counters', who, counter: 'energy', amount: { kind: 'event' } }] : null;
  }
  if (energy || experience) {
    const who = parsePlayerRef((energy ?? experience)![1]!, b);
    // Etali, Primal Sickness: "they get that many poison counters" — how much the trigger event was.
    if (experience?.[2] === 'that many' && !b.eventAmount) return null;
    const amount = energy ? energy[2]!.length / 3 : experience![2] === 'that many' ? { kind: 'event' as const } : parseAmount(experience![2]!);
    return who && (typeof amount === 'number' || typeof amount === 'object') && amount !== null ? [{ type: 'get_counters', who, counter: energy ? 'energy' : experience![3]!, amount }] : null;
  }
  // CR 701.34a
  if (/^proliferate$/i.test(c)) return [{ type: 'proliferate' }];
  // CR 701.10e: "double the number of +1/+1 counters on each creature you control", "… each kind of counter on target permanent"
  // Aetheric Amplifier: "Double the number of each kind of counter you have" — counters on a player (CR 122.1).
  if (/^double the number of each kind of counter you have$/i.test(c)) return [{ type: 'double_counters', who: { ref: 'you' }, counter: 'each' }];
  const dblCounters = /^double the number of (\+1\/\+1 counters|each kind of counter) on (.+)$/i.exec(c);
  if (dblCounters) {
    const what = parseObjectRef(dblCounters[2]!, b);
    return what ? [{ type: 'double_counters', what: what.ref, counter: /^each/.test(dblCounters[1]!) ? 'each' : '+1/+1' }] : null;
  }
  // CR 701.10a/c: "double its power until end of turn", "double the power and toughness of each creature you control until end of turn"
  // CR 701.11: Tifa's Limit Break: "Triple target creature's power and toughness until end of turn."
  const dblPT = /^(double|triple) (?:(its|.+?'s) power( and toughness)?|the power( and toughness)? of (.+?))( until end of turn)?$/i.exec(c);
  if (dblPT) {
    const triple = dblPT[1]!.toLowerCase() === 'triple';
    dblPT.splice(1, 1);
    const whoText = dblPT[1] ? (dblPT[1] === 'its' ? 'it' : dblPT[1].replace(/'s$/, '')) : dblPT[4]!;
    const what = parseObjectRef(whoText, b);
    if (!what) return null;
    return [{ type: 'modify', what: what.ref, double: dblPT[2] || dblPT[3] ? 'both' : 'power', ...(triple ? { triple: true } : {}), until: dblPT[5] ? 'eot' : 'game' }];
  }
  // CR 701.61a
  if (/^forage$/i.test(c)) return [{ type: 'forage' }];
  // CR 701.50a: "~ connives", "target creature you control connives".
  // CR 701.50d: "connives X" (Spymaster's Vault), "connives 2".
  const connive = /^(.+?) connives(?: (X|\d+))?$/i.exec(c);
  if (connive) {
    const what = parseObjectRef(connive[1]!, b);
    const amount = connive[2] ? parseAmount(connive[2]) : null;
    // CR 701.50c: several connive one at a time ("Each creature that convoked this spell connives", "Each creature you control
    // connives").
    return what && (!what.plural || ['all', 'convoked'].includes(what.ref.ref)) ? [{ type: 'connive', what: what.ref, ...(amount !== null && amount !== undefined ? { amount } : {}) }] : null;
  }
  // CR 701.47a: "Amass Orcs 2" (older cards: "Amass 2", Zombies).
  const amass = /^amass(?: (\w+))? (\S+)$/i.exec(c);
  if (amass) {
    const amount = parseAmount(amass[2]!);
    const subtype = amass[1] ? subtypeOf(amass[1]) : 'Zombie';
    return amount !== null && subtype ? [{ type: 'amass', subtype, amount }] : null;
  }
  // "It doesn't untap during its controller's next untap step." (CR 502.3)
  // Sleep: "Those creatures don't untap during that player's next untap step"; Sudden Storm: "… their controllers' next
  // untap steps".
  const stay = /^(.+?) (?:doesn't|don't) untap during (?:its controller's|their controllers'|their controller's|that player's|your) next untap steps?$/i.exec(c);
  if (stay) {
    const what = parseObjectRef(stay[1]!, b);
    return what ? [{ type: 'skip_untap', what: what.ref }] : null;
  }
  // CR 614.10: "Target opponent skips their next combat phase", "You skip your next turn", "you skip your next two turns",
  // "each opponent skips their next untap step", "Target player skips their next draw step"; Moment of Silence: "… their
  // next combat phase this turn".
  const skipNext = /^(.+?) skips? (?:their|your|his or her) next (?:(two|three) )?(turns?|untap steps?|draw steps?|combat phases?)( this turn)?$/i.exec(c);
  if (skipNext && (!skipNext[2]) === !/s$/.test(skipNext[3]!) && (!skipNext[4] || /^combat/.test(skipNext[3]!))) {
    const who = parsePlayerRef(skipNext[1]!, b);
    const what = /^turn/.test(skipNext[3]!) ? 'turn' : /^untap/.test(skipNext[3]!) ? 'untap' : /^draw/.test(skipNext[3]!) ? 'draw' : 'combat';
    if (who) return [{ type: 'skip_next', who, what, ...(skipNext[2] ? { amount: parseAmount(skipNext[2]) } : {}), ...(skipNext[4] ? { thisTurn: true } : {}) }];
  }
  // CR 725.1: "you become the monarch", "target player becomes the monarch".
  const monarch = /^(.+?) becomes? the monarch$/i.exec(c);
  if (monarch) {
    const who = parsePlayerRef(monarch[1]!, b);
    return who ? [{ type: 'become_monarch', who }] : null;
  }
  // CR 701.49: "Venture into the dungeon." / "Venture into Undercity."; CR 726: "You take the initiative."
  if (/^venture into the dungeon$/i.test(c)) return [{ type: 'venture' }];
  if (/^venture into undercity$/i.test(c)) return [{ type: 'venture', undercity: true }];
  if (/^you take the initiative$/i.test(c)) return [{ type: 'take_initiative', who: { ref: 'you' } }];
  // CR 709.5f: "Unlock a locked door of target Room you control."
  const unlockDoorText = /^unlock a locked door of (.+)$/i.exec(c);
  if (unlockDoorText) {
    const what = parseObjectRef(unlockDoorText[1]!, b);
    return what ? [{ type: 'unlock', what: what.ref }] : null;
  }
  // "It doesn't untap during its controller's untap step for as long as ~ remains tapped."
  // Icefall Regent: "… for as long as you control this creature"; Time of Ice: "… for as long as you control this Saga";
  // "… for as long as this Equipment remains on the battlefield".
  const lock = /^(.+?) (?:doesn't|don't) untap during (?:its|their) controller(?:'s|s') untap steps? for as long as (?:(?:~|this [a-z]+) remains (tapped|on the battlefield)|you control (?:~|this [a-z]+))$/i.exec(c);
  if (lock) {
    const what = parseObjectRef(lock[1]!, b);
    const kind = lock[2] === 'tapped' ? null : lock[2] ? 'present' : 'controlled';
    return what ? [{ type: 'lock_untap', what: what.ref, ...(kind ? { while: kind } : {}) }] : null;
  }
  // CR 702.26: "Target creature phases out.", "All permanents you control phase out."
  const phase = /^(.+?) phases? out$/i.exec(c);
  if (phase) {
    const what = parseObjectRef(phase[1]!, b);
    return what ? [{ type: 'phase_out', what: what.ref }] : null;
  }
  // CR 500.8: "After this phase, there is an additional combat phase (followed by an additional main phase)."
  c = c.replace(/^there's an additional/i, 'there is an additional');
  const extraCombat =
    /^after this (?:main )?phase, there is an additional combat phase( followed by an additional main phase)?$/i.exec(c) ??
    /^there is an additional combat phase( followed by an additional main phase)? after this (?:main )?phase$/i.exec(c) ??
    // Overpowering Attack: "there is an additional combat phase after this phase, followed by an additional main phase"
    /^there is an additional combat phase after this (?:main )?phase(, followed by an additional main phase)$/i.exec(c);
  if (extraCombat) return [{ type: 'extra_combat', ...(extraCombat[1] ? { main: true } : {}) }];
  // Full Throttle: "After this main phase, there are two additional combat phases." — one after the other.
  const extraCombats = /^after this (?:main )?phase, there are (two|three) additional combat phases$/i.exec(c);
  if (extraCombats) return Array.from({ length: extraCombats[1] === 'two' ? 2 : 3 }, () => ({ type: 'extra_combat' }));
  // CR 701.54a: "The Ring tempts you."
  if (/^the ring tempts you$/i.test(c)) return [{ type: 'ring_tempts' }];
  // Aven Interrupter: "Exile target spell. It becomes plotted." (CR 702.170: cast on a later turn without paying its mana cost.)
  if (/^(?:it|that card) becomes plotted$/i.test(c) && b.it && b.it.ref !== 'self') return [{ type: 'plot', what: b.it }];
  // CR 701.27a: transforming turns a double-faced permanent over.
  const transform = /^transform (~|it|him|her)$/i.exec(c);
  if (transform && (transform[1] !== 'it' || b.it?.ref === 'self')) return [{ type: 'transform', what: { ref: 'self' } }];
  // CR 106.4: "Add {R}{R}{R}." as an instruction (rituals, triggered mana); "Add one mana of any color."
  const add = /^add (.+)$/i.exec(c);
  const produced = add ? parseManaProduction(add[1]!) : null;
  if (produced) return [produced];
  // Klauth: "add X mana in any combination of colors, where X is …" (bound by the sentence); "X mana of any one color".
  // Burnt Offering: "… in any combination of {B} and/or {R}".
  const addX = add ? /^X mana (in any combination of (?:colors|\{([WUBRG])\} and\/or \{([WUBRG])\})|of any one color)$/.exec(add[1]!) : null;
  if (addX) return [addX[1]!.startsWith('in') ? { type: 'add_mana', combination: { amount: 'X', colors: addX[2] ? [addX[2], addX[3]!] : ['W', 'U', 'B', 'R', 'G'] } } : { type: 'add_mana', anyColor: 1, times: 'X' }];
  // Mana Drain: "add an amount of {C} equal to that spell's mana value".
  const addAmount = add ? /^an amount of (\{[WUBRGC]\}) equal to (.+)$/.exec(add[1]!) : null;
  if (addAmount) {
    const base = parseManaProduction(addAmount[1]!);
    const times = base ? parseCount(addAmount[2]!, b) : null;
    if (base && times) return [{ ...base, times }];
  }
  // Fangorn, Tree Shepherd: "Whenever one or more Treefolk you control attack, add twice that much {G}." — the event's count.
  const thatMuch = add && b.eventAmount ? /^(twice )?that much (\{[WUBRGC]\})$/.exec(add[1]!) : null;
  if (thatMuch) {
    const base = parseManaProduction(thatMuch[2]!);
    if (base) return [{ ...base, times: { kind: 'event', ...(thatMuch[1] ? { times: 2 } : {}) } }];
  }
  // Mana Geyser: "Add {R} for each tapped land your opponents control."
  // Culling Ritual: "Add {B} or {G} for each permanent destroyed this way" — any mix of the two.
  // Coalition Relic: "Add one mana of any color for each charge counter removed this way." — each its own color.
  const anyEach = add ? /^one mana of any color for each (.+)$/.exec(add[1]!) : null;
  if (anyEach) {
    const times = parseForEach(anyEach[1]!, b);
    if (times) return [{ type: 'add_mana', combination: { amount: times, colors: ['W', 'U', 'B', 'R', 'G'] } }];
  }
  const addEach = add ? /^((?:\{[WUBRGC]\})+|\{[WUBRGC]\} or \{[WUBRGC]\}) for each (.+)$/.exec(add[1]!) : null;
  if (addEach) {
    const base = parseManaProduction(addEach[1]!);
    const times = base ? parseForEach(addEach[2]!, b) : null;
    if (base && times) return [{ ...base, times }];
  }
  return null;
}

const BASIC_LAND_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
const CHOICE_OF: Record<string, 'color' | 'colors' | 'creature_type' | 'land_type'> = { 'color': 'color', 'color or colors': 'colors', 'creature type': 'creature_type', 'basic land type': 'land_type' };

/**
 * Layers 4–6 (CR 613.1d–f): "Target creature loses all abilities until end of turn", "~ becomes blue until end of turn",
 * "Target creature becomes a Coward until end of turn", "Target land becomes an Island until end of turn" (CR 305.7),
 * "~ becomes the creature type of your choice until end of turn".
 */
function parseLayerChange(c: string, b: Binder): EffectNode[] | null {
  const until = / until end of turn$/.test(c) ? 'eot' : 'game';
  const body = c.replace(/ until end of turn$/, '');
  // "loses all abilities [and has base power and toughness 0/1]"
  const loses = /^(.+?) loses? all abilities(?:,? and (?:has|have) base power and toughness (\d+)\/(\d+))?$/.exec(body);
  if (loses) {
    return attempt(b, (b) => {
      const what = parseObjectRef(loses[1]!, b);
      return what ? [{ type: 'modify', what: what.ref, loseAbilities: true, ...(loses[2] ? { setPower: Number(loses[2]), setToughness: Number(loses[3]) } : {}), until }] : null;
    });
  }
  // "becomes the color of your choice", "… the creature type of your choice", "… the basic land type of your choice"
  // Quickchange: "becomes the color or colors of your choice" — one or more colors.
  const choice = /^(.+?) becomes? the (color or colors|color|creature type|basic land type) of your choice$/.exec(body);
  if (choice) {
    return attempt(b, (b) => {
      const what = parseObjectRef(choice[1]!, b);
      if (!what) return null;
      const kind = CHOICE_OF[choice[2]!]!;
      const change = kind === 'colors' ? { colors: ['chosen_colors'] } : kind === 'color' ? { colors: ['chosen'] } : kind === 'creature_type' ? { creatureTypes: ['chosen'] } : { landTypes: ['chosen'] };
      return [{ type: 'choose_value', choice: kind, scope: 'resolution' }, { type: 'modify', what: what.ref, ...change, until }];
    });
  }
  // "becomes blue", "becomes black and red", "becomes colorless"
  // Tam, Mindful First-Year: "becomes all colors" (CR 105.2).
  const color = /^(.+?) becomes? ((?:white|blue|black|red|green)(?: and (?:white|blue|black|red|green))?|colorless|all colors)$/.exec(body);
  if (color) {
    return attempt(b, (b) => {
      const what = parseObjectRef(color[1]!, b);
      const colors = color[2] === 'colorless' ? [] : color[2] === 'all colors' ? ['W', 'U', 'B', 'R', 'G'] : color[2]!.split(' and ').map((w) => COLOR_WORDS[w]!);
      return what ? [{ type: 'modify', what: what.ref, colors, until }] : null;
    });
  }
  // Allosaurus Shepherd: "becomes a Dinosaur in addition to its other creature types" (CR 205.1b)
  const extraType = /^(.+?) becomes? an? ([A-Z][\w’'-]*) in addition to (?:its|their) other creature types$/.exec(body);
  if (extraType && (SUBTYPES.creature as readonly string[]).includes(extraType[2]!)) {
    return attempt(b, (b) => {
      const what = parseObjectRef(extraType[1]!, b);
      return what ? [{ type: 'modify', what: what.ref, types: [], subtypes: [extraType[2]!], retainTypes: true, until }] : null;
    });
  }
  // "becomes a Coward", "becomes an Island"
  const sub = /^(.+?) becomes? an? ([A-Z][\w’'-]*)$/.exec(body);
  if (sub) {
    const word = sub[2]!;
    const land = BASIC_LAND_TYPES.includes(word);
    if (!land && !(SUBTYPES.creature as readonly string[]).includes(word)) return null;
    return attempt(b, (b) => {
      const what = parseObjectRef(sub[1]!, b);
      return what ? [{ type: 'modify', what: what.ref, ...(land ? { landTypes: [word] } : { creatureTypes: [word] }), until }] : null;
    });
  }
  return null;
}

/**
 * "This land becomes a 3/3 green Elemental creature with trample until end of turn." Layers 4 (types),
 * 5 (colors), 6 (abilities) and 7b (P/T), CR 613.1d–f / 613.4b. Types replace the old ones unless
 * it's "still a land" or "in addition to its other types" (CR 205.1b).
 */
function parseBecomes(c: string, b: Binder): EffectNode[] | null {
  // Tezzeret the Seeker: "Artifacts you control become artifact creatures with base power and toughness 5/5 until end of
  // turn" — the same as "become 5/5 artifact creatures"; one at a time below.
  c = c
    .replace(/^(.+?) (becomes? )an? ((?:[A-Za-z]+ )*?creature) with base power and toughness (\d+)\/(\d+)( until end of turn)?$/, '$1 $2a $4/$5 $3$6')
    .replace(/^(.+?) become ((?:[a-z]+ )*?)creatures with base power and toughness (\d+)\/(\d+)( until end of turn)?$/, '$1 become a $3/$4 $2creature$5')
    .replace(/^(.+?) become (\d+)\/(\d+) ((?:[a-z]+ )*?)creatures( until end of turn)?$/, '$1 become a $2/$3 $4creature$5')
    // Push the Limit: "Vehicles you control become artifact creatures until end of turn." — each keeps its own P/T.
    .replace(/^(.+?) become ((?:[a-z]+ )*?artifact )creatures( until end of turn)?$/, '$1 become a $2creature$3');
  // Turn to Frog: "target creature loses all abilities and becomes a blue Frog with base power and toughness 1/1" — a
  // creature type, not a card type: it keeps its card types and loses its other creature types (CR 205.1b); its color
  // becomes blue (layer 5).
  const frog = /^(.+?) (loses all abilities and )?becomes? an? (?:(white|blue|black|red|green) )?([A-Z][a-z]+) with base power and toughness (\d+)\/(\d+)( until end of turn)?$/.exec(c);
  if (frog && (SUBTYPES.creature as readonly string[]).includes(frog[4]!)) {
    return attempt(b, (b) => {
      const what = parseObjectRef(frog[1]!, b);
      if (!what) return null;
      return [
        {
          type: 'modify',
          what: what.ref,
          creatureTypes: [frog[4]!],
          ...(frog[3] ? { colors: [COLOR_WORDS[frog[3]]!] } : {}),
          ...(frog[2] ? { loseAbilities: true } : {}),
          setPower: Number(frog[5]),
          setToughness: Number(frog[6]),
          until: frog[7] ? 'eot' : 'game',
        },
      ];
    });
  }
  // Jolrael, Mwonvuli Recluse: "Until end of turn, creatures you control have base power and toughness each equal to the
  // number of cards in your hand." — counted as it resolves (CR 608.2h).
  const baseEach = /^(.+?) ha(?:s|ve) base power and toughness each equal to (.+?) until end of turn$/.exec(c);
  if (baseEach) {
    return attempt(b, (b) => {
      const what = parseObjectRef(baseEach[1]!, b);
      const n = what ? parseCount(baseEach[2]!, b) : null;
      return what && n ? [{ type: 'modify', what: what.ref, setPower: n, setToughness: n, until: 'eot' }] : null;
    });
  }
  // PuPu UFO: "Until end of turn, this creature's base power becomes equal to the number of Towns you control."
  const basePower = /^(.+?)'s base power becomes equal to (.+?) until end of turn$/.exec(c);
  if (basePower) {
    return attempt(b, (b) => {
      const what = parseObjectRef(basePower[1]!, b);
      const n = what && !what.plural ? parseCount(basePower[2]!, b) : null;
      return what && n ? [{ type: 'modify', what: what.ref, setPower: n, powerOnly: true, until: 'eot' }] : null;
    });
  }
  // Layer 7b: "Target creature has base power and toughness 1/1 until end of turn", "… becomes a 0/1 until end of turn".
  // Biomass Mutation: "Creatures you control have base power and toughness X/X until end of turn."
  // Mass Diminish: "Until your next turn, creatures target player controls have base power and toughness 1/1."
  const base = /^(.+?) (?:ha(?:s|ve) base power and toughness|becomes? an?) (\d+|X)\/(\d+|X) (until end of turn|until your next turn)$/.exec(c);
  if (base) {
    return attempt(b, (b) => {
      const what = parseObjectRef(base[1]!, b);
      const v = (x: string) => (x === 'X' ? 'X' : Number(x));
      return what ? [{ type: 'modify', what: what.ref, setPower: v(base[2]!), setToughness: v(base[3]!), until: base[4] === 'until your next turn' ? 'your_next_turn' : 'eot' }] : null;
    });
  }
  // Beorn's Hospitality: "… becomes a Bear creature in addition to its other types and gains "This creature's power and
  // toughness are each equal to the number of lands you control."" — the same as "with" it.
  const gainsPT = / in addition to its other types and gains (QUOTED_\d+)( until end of turn)?$/.exec(c);
  if (gainsPT && quotedLivePT(gainsPT[1]!, b)) c = `${c.slice(0, gainsPT.index)} with ${gainsPT[1]} in addition to its other types${gainsPT[2] ?? ''}`;
  // Vraska, Betrayal's Sting: "Target creature becomes a Treasure artifact with "…" and loses all other card types and
  // abilities." (layers 4 and 6: it keeps the ability this gives it).
  const loseAll = / and loses all other card types and abilities$/.exec(c);
  if (loseAll) c = c.slice(0, loseAll.index);
  const m = /^(.+?) becomes? an? (?:(\d+|X)\/(\d+|X) )?(.+?)(?: with (.+?))?( that's still an? (?:land|planeswalker|artifact|enchantment))?( in addition to its other types)?( until end of turn)?$/.exec(c);
  if (!m) return null;
  if (loseAll && (m[6] || m[7])) return null;
  // Without a P/T it keeps its own ("This Vehicle becomes an artifact creature", CR 702.122a).
  // Liquimetal Torque: "Target nonland permanent becomes an artifact in addition to its other types until end of turn".
  if (!m[2] && !/\bcreature$/.test(m[4]!) && !m[7] && !loseAll) return null;
  return attempt(b, (b) => {
    const what = parseObjectRef(m[1]!, b);
    if (!what) return null;
    const words = m[4]!.replace(/ and /g, ' ').split(' ');
    if (words[words.length - 1] !== 'creature' && !m[7] && !loseAll) return null;
    const colors: string[] = [];
    const types: string[] = [];
    const subtypes: string[] = [];
    for (const w of words) {
      if (COLOR_WORDS[w]) colors.push(COLOR_WORDS[w]!);
      else if (TYPE_NOUNS[w] && TYPE_NOUNS[w]!.toLowerCase() === w) types.push(TYPE_NOUNS[w]!);
      else if (subtypeOf(w) === w) subtypes.push(w);
      else return null;
    }
    const pt = (v: string) => (v === 'X' ? 'X' : Number(v));
    const node: EffectNode = { type: 'modify', what: what.ref, types, subtypes, ...(m[2] ? { setPower: pt(m[2]), setToughness: pt(m[3]!) } : {}), until: m[8] ? 'eot' : 'game' };
    // An artifact that becomes an artifact creature is still what it was (CR 205.1b).
    if (!m[2] && types.includes('Artifact') && !loseAll) node.retainTypes = true;
    if (loseAll) node.loseAbilities = true;
    if (colors.length) node.colors = colors;
    if (m[6] || m[7]) node.retainTypes = true;
    // Mutavault: "becomes a 2/2 creature with all creature types until end of turn"
    if (m[5] === 'all creature types') node.subtypes = [...new Set([...(node.subtypes as string[]), ...SUBTYPES.creature])];
    else if (m[5]) {
      // Druid Class: 'with haste and "This creature's power and toughness are each equal to …"' — set as it goes (layer 7b).
      const items = m[5].split(/, (?:and )?| and /);
      const live = items.map((item) => quotedLivePT(item, b));
      const pt = live.find(Boolean);
      if (pt) {
        if (m[2] || live.filter(Boolean).length > 1) return null;
        node.livePower = pt.power as never;
        node.liveToughness = pt.toughness as never;
      }
      const rest = items.filter((_, i) => !live[i]);
      if (rest.length) {
        const kws = parseKeywordList(rest.join(' and '), b, false, true);
        if (!kws) return null;
        node.keywords = kws;
      }
    }
    return [node];
  });
}

/** After "create …": "it", "the token", "those tokens" mean what was just created. */
function createdTokens(b: Binder): void {
  b.it = { ref: 'created' };
  for (const n of ['the token', 'that token', 'the tokens', 'those tokens', 'the copy', 'the token copy']) b.named[n] = { ref: 'created' };
}

/** One player other than "you" who makes a choice: "that player", "target opponent", "its controller". */
function singlePlayer(text: string, b: Binder): Ref | null {
  const who = parsePlayerRef(text, b);
  return who && who.ref !== 'you' && who.ref !== 'players' ? who : null;
}

function parseClause(c: string, b: Binder, inherited: Ref | null): Clause | null {
  // Object-subject clauses first: damage, pumps, restrictions.
  const special = parseDamage(c, b) ?? parsePump(c, b) ?? parseBecomes(c, b) ?? parseLayerChange(c, b) ?? parseRestriction(c, b) ?? parseKeywordAction(c, b) ?? parseReplacement(c, b);
  if (special) return { effects: special, subject: null };

  // Vraska's Fall: "Each opponent sacrifices a creature … and gets a poison counter" — the same players.
  const getsCounter = inherited && inherited.ref !== 'you' ? /^gets? (an?|one|two|three) (poison|experience|rad) counters?$/.exec(c) : null;
  if (getsCounter && inherited) {
    const amount = parseAmount(getsCounter[1]!.replace(/^an$/, 'a'));
    if (typeof amount === 'number') return { effects: [{ type: 'get_counters', who: inherited, counter: getsCounter[2]!, amount }], subject: inherited };
  }

  const imp = IMPERATIVE.exec(c);
  if (imp) {
    const lemma = VERB_FORMS[imp[1]!.toLowerCase()]!;
    const who = inherited ?? { ref: 'you' };
    const imperative = who.ref === 'you';
    // A subjectless verb with a non-"you" subject must agree in form ("draws"), which is fine to skip checking.
    const effects = attempt(b, (b) => VERBS[lemma]!(imp[2]!, who, b, imperative));
    if (effects) return { effects, subject: who };
  }

  for (const sub of [WITH_SUBJECT.exec(c), ...relativeSplits(c)]) {
    if (!sub) continue;
    const r = attempt(b, (b) => {
      const who = parsePlayerRef(sub[1]!, b);
      if (!who) return null;
      const lemma = VERB_FORMS[sub[2]!.toLowerCase()]!;
      const effects = VERBS[lemma]!(sub[3]!, who, b, who.ref === 'you');
      return effects ? { effects, subject: who } : null;
    });
    if (r) return r;
  }
  return null;
}

/** Effects the engine counts separately for each player they're for (Ref 'each_player'). */
const PER_PLAYER = ['lose_life', 'gain_life', 'draw', 'mill', 'deal_damage'];

/**
 * Archfiend of Despair: "each opponent loses life equal to the life that player lost this turn" — a count that names the
 * players the instruction is for ("they", "their", "that player") means each of them in turn (Ref 'each_player'), for
 * the effects the engine counts that way; null for any other.
 */
function perPlayerCount(inner: EffectNode[], expr: AmountExpr): AmountExpr | null {
  const who = inner.length === 1 ? ((inner[0] as { who?: Ref }).who ?? (inner[0]!.type === 'deal_damage' ? (inner[0] as { to?: Ref }).to : undefined)) : undefined;
  if (!who || who.ref !== 'players') return expr;
  const w = JSON.stringify(who);
  const js = JSON.stringify(expr);
  if (!js.includes(w)) return expr;
  if (!PER_PLAYER.includes(inner[0]!.type)) return null;
  return JSON.parse(js.split(w).join('{"ref":"each_player"}')) as AmountExpr;
}

/** "~ deals 3 damage to any target", "… to target creature and 2 damage to its controller". */
function parseDamage(c: string, b: Binder): EffectNode[] | null {
  // Fireball: "~ deals X damage divided evenly, rounded down, among any number of targets." — each gets the same share of
  // the targets chosen as it was cast (an illegal one's share is lost).
  const evenly = /^(?:~|[Ii]t) deals X damage divided evenly, rounded down, among any number of targets$/.exec(c);
  if (evenly && (/^~/.test(c) || b.it?.ref === 'self')) {
    const to = b.addTarget({ what: 'any', filter: { types: ['Creature', 'Planeswalker', 'Battle'] }, text: 'any number of targets', count: 100, upTo: true, min: 1 });
    return [{ type: 'deal_damage', amount: 'X', to, evenly: true }];
  }
  // CR 601.2d: "~ deals 3 damage divided as you choose among one, two, or three targets."
  const divided = /^(~|[Ii]t) deals (\S+) damage divided as you choose among (any number of|one or two|one, two, or three|up to (\w+)) (targets|target .+)$/.exec(c);
  if (divided) {
    return attempt(b, (b) => {
      if (divided[1] !== '~' && b.it?.ref !== 'self' && !(b.itIsSource && b.it?.ref === 'trigger_object')) return null;
      const amount = parseAmount(divided[2]!);
      if (amount === null) return null;
      const most = divided[3] === 'any number of' ? 100 : divided[3] === 'one or two' ? 2 : divided[3] === 'one, two, or three' ? 3 : parseAmount(divided[4]!);
      if (typeof most !== 'number') return null;
      // Each target gets at least 1, so there can't be more targets than damage.
      const count = typeof amount === 'number' ? Math.min(most, amount) : most;
      let spec: TargetSpec;
      if (divided[5] === 'targets') spec = { what: 'any', filter: { types: ['Creature', 'Planeswalker', 'Battle'] }, text: 'any target', count, upTo: true, min: 1 };
      else {
        const what = divided[5]!.replace(/^target /, '');
        const pf = parseFilter(what.replace(/ and\/or /g, ' or '), b);
        if (!pf || !pf.plural) return null;
        spec = { what: 'object', filter: pf.filter, text: divided[5]!, count, upTo: true, min: 1 };
      }
      const to = b.addTarget(spec);
      return [{ type: 'deal_damage', amount, to, divided: true }];
    });
  }
  // Crackle with Power: "~ deals five times X damage to each of up to X targets."
  // Let the Galaxy Burn: "~ deals X plus 2 damage to each creature …".
  // Ingris Stingerquill: "Whenever a creature you control attacks, that creature deals 1 damage to each opponent."
  const m = /^(~|[Ii]t|[Tt]hat creature) deals ((?:twice|(?:three|four|five) times) X|X plus \d+|\S+) damage to (.+)$/.exec(c);
  if (!m) return null;
  return attempt(b, (b) => {
    const fromIt = m[1] !== '~' && b.it?.ref === 'trigger_object' && b.itOnField && !b.itIsSource;
    if (/^that creature$/i.test(m[1]!) && !fromIt) return null;
    // Super State: "Whenever enchanted creature deals combat damage to an opponent, it deals that much damage to each other
    // opponent." — the enchanted creature is the source.
    const fromAttached = m[1] !== '~' && b.it?.ref === 'attached';
    if (m[1] !== '~' && b.it?.ref !== 'self' && !(b.itIsSource && b.it?.ref === 'trigger_object') && !fromIt && !fromAttached) return null;
    const timesX = /^(twice|three times|four times|five times) X$/.exec(m[2]!);
    const plusX = /^X plus (\d+)$/.exec(m[2]!);
    const amount = timesX ? { kind: 'x' as const, times: { twice: 2, 'three times': 3, 'four times': 4, 'five times': 5 }[timesX[1] as 'twice'] } : plusX ? { kind: 'x' as const, plus: Number(plusX[1]) } : parseAmount(m[2]!);
    if (amount === null) return null;
    const out: EffectNode[] = [];
    // Dragonspark Reactor: "… to target player and that much damage to up to one target creature" — the same amount.
    const second = /^(.+?) and (that much|\S+) damage to (.+)$/.exec(m[3]!);
    // Stuffy Doll: "~ deals 1 damage to itself."
    const first = m[3] === 'itself' && m[1] === '~' ? [{ ref: 'self' } as Ref] : parseRecipients(second ? second[1]! : m[3]!, b);
    if (!first) return null;
    for (const to of first) out.push({ type: 'deal_damage', amount, to, ...(fromIt ? { from: { ref: 'trigger_object' } } : fromAttached ? { from: { ref: 'attached' } } : {}) });
    // "If a creature dealt damage this way would die this turn, …"
    if (first.length === 1) b.damaged = first[0]!;
    if (second) {
      const amount2 = second[2] === 'that much' ? amount : parseAmount(second[2]!);
      const rest = amount2 !== null ? parseRecipients(second[3]!, b) : null;
      if (!rest || amount2 === null) return null;
      for (const to of rest) out.push({ type: 'deal_damage', amount: amount2, to, ...(fromIt ? { from: { ref: 'trigger_object' } } : fromAttached ? { from: { ref: 'attached' } } : {}) });
    }
    return out;
  });
}

/**
 * Rally the Ancestors: "Return each creature card … from your graveyard to the battlefield. Exile those creatures at the
 * beginning of your next upkeep." — "those creatures" would be read again later as cards in the graveyard, not the
 * permanents returned; such a delayed effect stays unread.
 */
function delayedOnZone(effects: EffectNode[]): boolean {
  return JSON.stringify(effects).includes('"ref":"all","filter":{"zone":');
}

/** "Target creature gets +2/+2 and gains trample until end of turn." (CR 611.2a: lasts as stated.) */
function parsePump(c: string, b: Binder): EffectNode[] | null {
  // Plagon: "Target creature you control assigns combat damage equal to its toughness rather than its power this turn."
  c = c.replace(/^(.+? assigns? combat damage equal to (?:its|their) toughness rather than (?:its|their) power) this turn$/, '$1 until end of turn');
  // Without a duration it lasts indefinitely (CR 611.2a): "It gains haste." (unearth).
  // Elspeth, Storm Slayer: "Those creatures gain flying until your next turn."
  // Walking Bulwark: "… gains haste, can attack as though it didn't have defender, and assigns combat damage equal to its
  // toughness rather than its power" — rule flags among the grants.
  // Aegis Angel: "another target permanent gains indestructible for as long as you control this creature".
  const whileYours = / for as long as you control (?:~|this (?:creature|artifact|enchantment|permanent))$/.exec(c);
  if (whileYours) {
    const inner = attempt(b, (b) => parsePump(c.slice(0, whileYours.index), b));
    const node = inner?.length === 1 && inner[0]!.type === 'modify' && inner[0]!.until === 'game' ? inner[0]! : null;
    if (node) return [{ ...node, until: 'source_controlled' }];
  }
  // Amoeboid Changeling: "Target creature loses all creature types until end of turn." (layer 4, CR 205.1b)
  const loseAllTypes = /^(.+?) loses all creature types until end of turn$/.exec(c);
  if (loseAllTypes) {
    return attempt(b, (b) => {
      const what = parseObjectRef(loseAllTypes[1]!, b);
      return what && !what.plural ? [{ type: 'modify', what: what.ref, until: 'eot', creatureTypes: [] }] : null;
    });
  }
  const m =
    /^(.+?) (?:gets?|gains?|has|have) (.+) until (?:end of turn|your next turn)$/.exec(c) ??
    /^(.+?) ((?:can attack as though (?:it|they) didn't have defender|assigns? combat damage equal to (?:its|their) toughness rather than (?:its|their) power)(?:,? and .+)?) until end of turn$/.exec(c) ??
    /^(.+?) (?:gains?) ((?!control\b).+)$/.exec(c);
  if (!m) return null;
  const until = / until end of turn$/.test(c) ? 'eot' : / until your next turn$/.test(c) ? 'your_next_turn' : 'game';
  return attempt(b, (b) => {
    // "Two target creatures each get +1/+1": "each" goes with a plural subject.
    const each = / each$/.test(m[1]!);
    const what = parseObjectRef(m[1]!.replace(/ each$/, ''), b);
    if (!what || (each && !what.plural)) return null;
    // An instant or sorcery is never on the battlefield to get anything ("Search … It gains indestructible": the card found).
    if (what.ref.ref === 'self' && /\b(?:Instant|Sorcery)\b/.test(b.env.typeLine)) return null;
    const verb = /^(.+?) (gets?|gains?|has|have) /.exec(c)?.[2] ?? '';
    // Nameless Inversion: "gets +3/-3 and loses all creature types until end of turn" (CR 205.1b, layer 4).
    const loseTypes = / and loses all creature types$/.test(m[2]!);
    const parts = `${verb ? `${verb} ` : ''}${m[2]!.replace(/ and loses all creature types$/, '')}`.split(/,? and (?=gets? |gains? |has |have |can attack as |assigns? combat )|, (?=can attack as |assigns? combat )/);
    const node: EffectNode = { type: 'modify', what: what.ref, until, ...(loseTypes ? { creatureTypes: [] } : {}) };
    for (const part of parts) {
      const flags = PUMP_RULES[part.replace(/\bthey\b/, 'it').replace(/\btheir\b/g, 'its').replace(/^assign /, 'assigns ')];
      if (flags) {
        node.rules = [...((node.rules as RuleFlag[] | undefined) ?? []), ...flags];
        continue;
      }
      const pm = /^(gets?|gains?|has|have) (.+)$/.exec(part);
      if (!pm) return null;
      // Blades of Velis Vel: "each get +2/+0 and gain all creature types until end of turn" (layer 4, CR 205.1b).
      if (/^gains?$/.test(pm[1]!) && pm[2] === 'all creature types') {
        if (node.allCreatureTypes || loseTypes) return null;
        node.allCreatureTypes = true;
        continue;
      }
      if (/^get/.test(pm[1]!)) {
        // "that creature gets an additional +2/+2" — another pump on top of the first.
        const pt = parsePT(pm[2]!.replace(/^an additional /, ''));
        if (!pt || node.power !== undefined) return null;
        node.power = pt.power;
        node.toughness = pt.toughness;
      } else {
        const kws = parseKeywordList(pm[2]!, b, false, true);
        if (!kws || node.keywords) return null;
        node.keywords = kws;
      }
    }
    return [node];
  });
}

/** Rule flags a temporary effect can grant along with keywords (Walking Bulwark). */
const PUMP_RULES: Record<string, RuleFlag[]> = {
  "can attack as though it didn't have defender": ['can_attack_with_defender'],
  // CR 510.1a (Doran, the Siege Tower)
  'assigns combat damage equal to its toughness rather than its power': ['damage_by_toughness'],
};

const RESTRICTIONS: Record<string, RuleFlag[]> = {
  "can't block": ['cant_block'],
  "can't attack": ['cant_attack'],
  "can't attack or block": ['cant_attack', 'cant_block'],
  "can't be blocked": ['cant_be_blocked'],
};

/** "Target creature can't block this turn." */
function parseRestriction(c: string, b: Binder): EffectNode[] | null {
  // Layer 6: "Target creature loses flying until end of turn", "Permanents your opponents control lose hexproof and
  // indestructible until end of turn".
  // Arcane Lighthouse: "… lose hexproof and shroud and can't have hexproof or shroud" — whatever would give it back.
  const loseHave = /^(.+?) loses? ([a-z ,]+?) and can't have(?: or gain)? ([a-z ,]+?) until end of turn$/.exec(c);
  if (loseHave) {
    const r = attempt(b, (b) => {
      const kws = parseKeywordList(loseHave[2]!, b);
      const banned = parseKeywordList(loseHave[3]!.replace(/ or /g, ' and '), b);
      const plain = (k: { text?: string; cost?: string; n?: number }[] | null) => k && !k.some((x) => x.text || x.cost || x.n !== undefined);
      const what = plain(kws) && plain(banned) ? parseObjectRef(loseHave[1]!, b) : null;
      return what && kws && banned ? [{ type: 'modify', what: what.ref, loseKeywords: kws.map((k) => k.id), cantHave: banned.map((k) => k.id), until: 'eot' }] : null;
    });
    if (r) return r;
  }
  // Hammerheim: "Target creature loses all landwalk abilities until end of turn." (CR 702.14)
  const noWalk = /^(.+?) loses? all landwalk abilities until end of turn$/.exec(c);
  if (noWalk) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(noWalk[1]!, b);
      return what ? [{ type: 'modify', what: what.ref, loseKeywords: ['landwalk'], until: 'eot' } as EffectNode] : null;
    });
    if (r) return r;
  }
  // Mu Yanling, Sky Dancer: "Until your next turn, up to one target creature gets -2/-0 and loses flying."
  const lose = /^(.+?) loses? ([a-z ,]+?) (until end of turn|until your next turn)$/.exec(c);
  if (lose && !/^all abilities$/.test(lose[2]!)) {
    const r = attempt(b, (b) => {
      const kws = parseKeywordList(lose[2]!, b);
      const what = kws && !kws.some((k) => k.text || k.cost || k.n !== undefined) ? parseObjectRef(lose[1]!, b) : null;
      return what && kws ? [{ type: 'modify', what: what.ref, loseKeywords: kws.map((k) => k.id), until: lose[3] === 'until your next turn' ? 'your_next_turn' : 'eot' }] : null;
    });
    if (r) return r;
  }
  // "Target creature must be blocked this turn if able." / "~ can't be blocked by more than one creature this turn."
  // Gingerbrute: "This creature can't be blocked this turn except by creatures with haste."
  // Anzrag, the Quake-Mole: "~ must be blocked each combat this turn if able." — in every combat of the turn.
  // Valor Made Real: "Target creature can block any number of creatures this turn."
  const combat = /^(.+?) (must be blocked this turn if able|can't be blocked .+? this turn|can't be blocked this turn except by .+|can block only .+? this turn|can block any number of creatures this turn|can block an additional (?:\w+ )?creatures? (?:each combat )?this turn)$/.exec(c.replace(/ must be blocked each combat this turn if able$/, ' must be blocked this turn if able'));
  if (combat) {
    const r = attempt(b, (b) => {
      const rule = parseCombatRule(combat[2]!.replace(' this turn', ''), b);
      const what = rule && parseObjectRef(combat[1]!, b);
      return what && rule && !rule.goaded ? [{ type: 'modify', what: what.ref, combat: rule, until: 'eot' }] : null;
    });
    if (r) return r;
  }
  // CR 509.1c: "Target creature blocks this turn if able", "Target creature attacks or blocks this turn if able",
  // "Target creature blocks ~ this turn if able", "you may have target creature block it this turn if able".
  const anyBlock = /^(?:[Hh]ave )?(.+?) (blocks?|attacks? or blocks?|attack or block|attacks?) (?:this turn|this combat|each combat this turn) if able$/.exec(c);
  if (anyBlock) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(anyBlock[1]!, b);
      // "Target creature attacks this turn if able" (CR 508.1d)
      const rules = /block/.test(anyBlock[2]!) ? (/attack/.test(anyBlock[2]!) ? ['attacks_each_combat', 'blocks_each_combat'] : ['blocks_each_combat']) : ['attacks_each_combat'];
      return what ? [{ type: 'modify', what: what.ref, rules, until: 'eot' }] : null;
    });
    if (r) return r;
  }
  // CR 509.1b: "Target creature can't block ~ this turn", "… can't block it this turn"
  const cantBlockThat = /^(.+?) can't block (~|it|this creature) this turn$/.exec(c);
  if (cantBlockThat) {
    const r = attempt(b, (b) => {
      const attacker = cantBlockThat[2] === 'it' ? parseObjectRef('it', b) : { ref: { ref: 'self' } as Ref, plural: false };
      const what = attacker ? parseObjectRef(cantBlockThat[1]!, b) : null;
      return what && attacker && !attacker.plural ? [{ type: 'cant_block_attacker', what: what.ref, attacker: attacker.ref }] : null;
    });
    if (r) return r;
  }
  const blockThat = /^(?:[Hh]ave |[Cc]hoose to have )?(.+?) (?:blocks?|block) (~|it|this creature|that creature|target creature|enchanted creature|equipped creature) (?:this turn|this combat) if able$/.exec(c);
  if (blockThat) {
    const r = attempt(b, (b) => {
      // "you may have target creature block it": the target is read first, "it" refers back past it.
      const attacker = blockThat[2] === 'this creature' ? { ref: { ref: 'self' } as Ref, plural: false } : parseObjectRef(blockThat[2]!, b);
      const what = attacker ? parseObjectRef(blockThat[1]!, b) : null;
      if (!what || !attacker || attacker.plural) return null;
      return [{ type: 'must_block', what: what.ref, attacker: attacker.ref }];
    });
    if (r) return r;
  }
  // CR 602.5: "Its activated abilities can't be activated this turn" (Koma), "Target creature's activated abilities
  // can't be activated this turn" — mana abilities too.
  // Dovin Baan: "Until your next turn, … its activated abilities can't be activated."
  const locked = /^(?:(.+?)'s|[Ii]ts) activated abilities can't be activated (this turn|until end of turn|until your next turn)$/.exec(c);
  if (locked) {
    const what = parseObjectRef(locked[1] ?? 'it', b);
    return what ? [{ type: 'modify', what: what.ref, rules: ['cant_activate'], until: locked[2] === 'until your next turn' ? 'your_next_turn' : 'eot' }] : null;
  }
  // Assault Formation: "Target creature with defender can attack this turn as though it didn't have defender." (CR 702.3b)
  const defenderOk = /^(.+?) can attack this turn as though (?:it|they) didn't have defender$/.exec(c);
  if (defenderOk) {
    const what = parseObjectRef(defenderOk[1]!, b);
    return what ? [{ type: 'modify', what: what.ref, rules: ['can_attack_with_defender'], until: 'eot' }] : null;
  }
  const lure = /^All creatures able to block (.+?) this turn do so$/.exec(c);
  if (lure) {
    const what = parseObjectRef(lure[1]!, b);
    return what ? [{ type: 'modify', what: what.ref, combat: { mustBeBlocked: 'all' }, until: 'eot' }] : null;
  }
  // Taunt from the Rampart: "Until your next turn, those creatures can't block."
  const m = /^(.+?) (can't (?:attack or block|attack|block|be blocked)) (this turn|until your next turn)$/.exec(c);
  if (!m) return null;
  return attempt(b, (b) => {
    const what = parseObjectRef(m[1]!, b);
    return what ? [{ type: 'modify', what: what.ref, rules: RESTRICTIONS[m[2]!]!, until: m[3] === 'this turn' ? 'eot' : 'your_next_turn' }] : null;
  });
}

/** CR 106.6: "to cast creature spells", "to cast artifact spells or activate abilities of artifacts", "to activate abilities". */
export function parseManaSpend(text: string, b: Binder): ManaSpend | null {
  if (text === 'to activate abilities') return { abilities: {} };
  // Cavern of Souls, Delighted Halfling: "to cast a creature spell of the chosen type, and that spell can't be countered"
  const rider = /^(.+), and that spell can't be countered$/.exec(text);
  if (rider) {
    const rest = parseManaSpend(rider[1]!, b);
    return rest?.spells && !rest.abilities && !rest.special ? { ...rest, uncounterable: true } : null;
  }
  // "to cast Room spells and unlock doors", "to cast an enchantment spell, unlock a door, or turn a permanent face up"
  const special: ('unlock' | 'face_up')[] = [];
  for (;;) {
    const sp = /(?:,? (?:and|or)|,) (unlock (?:a door|doors)|turn (?:a permanent|permanents) face up)$/.exec(text);
    if (!sp) break;
    special.unshift(/^unlock/.test(sp[1]!) ? 'unlock' : 'face_up');
    text = text.slice(0, sp.index);
  }
  const only = /^to (unlock (?:a door|doors)|turn (?:a permanent|permanents) face up)$/.exec(text);
  if (only) return { special: [/^unlock/.test(only[1]!) ? 'unlock' : 'face_up'] };
  if (special.length) {
    const rest = parseManaSpend(text, b);
    return rest ? { ...rest, special } : null;
  }
  // Secluded Courtyard: "an ability of a creature source of the chosen type"
  text = text.replace(/(an ability of (?:a|an) \w+) source (of the chosen type)$/, '$1 $2');
  // Gwenna: "or activate abilities of creature sources" — of creatures.
  text = text.replace(/ abilities of (creature|artifact|enchantment|land|planeswalker) sources$/, ' abilities of $1s');
  // Shang-Chi, Master of Kung Fu: "Spend this mana only to activate abilities of creature sources." — no spells.
  const abilitiesOnly = /^to activate abilities of (.+)$/.exec(text);
  if (abilitiesOnly) {
    const pf = parseFilter(abilitiesOnly[1]!, b);
    return pf && pf.plural && !pf.filter.zone ? { abilities: pf.filter } : null;
  }
  // Throne of Eldraine: "to cast monocolored spells of that color" — the color chosen for its source.
  text = text.replace(/ spells of that color$/, ' spells of the chosen color');
  const m = /^to cast (.+?)(?:,? or (?:to )?activate (?:abilities of (.+)|an ability of (?:a|an) (.+?)(?: source)?))?$/.exec(text);
  if (!m) return null;
  const what = m[1]!.replace(/^(\w+) and(?:\/or)? (\w+) spells$/, '$1 or $2 spells');
  const spells = /^(?:a |an )?spells?$/.test(what) ? { filter: {} as ObjectFilter } : parseFilter(what.replace(/^(?:a|an) /, ''), b);
  if (!spells || (Object.keys(spells.filter).length && spells.filter.zone !== 'stack')) return null;
  const { zone: _z, ...spellFilter } = spells.filter;
  const out: ManaSpend = { spells: spellFilter };
  const of = m[2] ?? m[3];
  if (of) {
    const pf = parseFilter(of, b);
    if (!pf || pf.filter.zone) return null;
    out.abilities = pf.filter;
  }
  return out;
}
