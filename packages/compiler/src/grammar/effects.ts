import type { AddManaEffect, EffectNode, FaceDef, ManaSpend, ObjectFilter, Ref, RuleFlag, TargetSpec } from '@mtg/schema';
import { SUBTYPES } from '@mtg/schema';
import { parseManaProduction } from '../rules/mana.js';
import { attempt, type Binder } from './binder.js';
import { bindX, parseCount, parseForEach, scaleBy } from './amounts.js';
import { parseCombatRule } from './combat.js';
import { parseCopyExcept } from './copies.js';
import { parseCondition } from './conditions.js';
import { parseFilter, parseKeywordList, parseObjectRef, parsePlayerRef, parseRecipients } from './nouns.js';
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
  return attempt(b, (b) => {
    const sentences = splitSentences(text);
    if (!sentences) return null;
    const out: EffectNode[] = [];
    // The plain effects of the last sentence, for a following "… instead".
    let previous: EffectNode[] = [];
    for (let i = 0; i < sentences.length; i++) {
      let s = sentences[i]!;
      if (i > 0 && !/ instead$/.test(s)) previous = [];
      // "Then each player draws a card." — "then" only orders what's already in order.
      if (i > 0 && /^Then (?!shuffle)/.test(s)) s = capitalise(s.slice(5));
      // "…, reveal it, and put it into your hand. Then shuffle your library." (CR 702.29e wording).
      if (/^Search /.test(s) && /^Then shuffle(?: your library)?$/.test(sentences[i + 1] ?? '')) {
        s = `${s.replace(/, reveal that card, and put it /, ', reveal it, put it ').replace(/, and put /, ', put ')}, then shuffle`;
        i++;
      }
      // CR 118.12: "You may pay {2}. If you do, …" — an optional cost paid on resolution.
      // Mana the engine can pay as a resolution-time cost (no {X}, snow or Phyrexian symbols), or energy (CR 107.14).
      const pay = /^You may pay ((?:\{(?:\d+|[WUBRGC]|[WUBRG2]\/[WUBRG])\})+|(?:\{E\})+)$/.exec(s);
      const then = sentences[i + 1] ? /^If you do, (.+)$/.exec(sentences[i + 1]!) : null;
      if (pay && then) {
        const inner = parseSentence(capitalise(then[1]!), b);
        if (!inner) return null;
        // CR 702.59a (recover): "… Otherwise, exile this card."
        const otherwise = sentences[i + 2] ? /^(?:Otherwise|If you don't), (.+)$/.exec(sentences[i + 2]!) : null;
        const no = otherwise ? parseSentence(capitalise(otherwise[1]!), b) : null;
        if (otherwise && !no) return null;
        out.push({ type: 'may_pay', cost: pay[1]!, effects: inner, ...(no ? { else: no } : {}) });
        i += otherwise ? 2 : 1;
        continue;
      }
      // CR 500.5: "Until end of turn, you don't lose this mana as steps and phases end."
      const keep = i > 0 ? /^Until end of (turn|combat), you don't lose this mana as steps and phases end$/.exec(s) : null;
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
      const spendOnly = i > 0 ? /^Spend this mana only (.+)$/.exec(s) : null;
      if (spendOnly) {
        const last = out[out.length - 1] as AddManaEffect | undefined;
        const spend = last?.type === 'add_mana' ? parseManaSpend(spendOnly[1]!, b) : null;
        if (!spend) return null;
        last!.spend = spend;
        continue;
      }
      // CR 702.32a (fading): "Remove a fade counter from it. If you can't, sacrifice it."
      const cant = /^If you can't, (.+)$/.exec(s);
      if (cant) {
        const last = out[out.length - 1];
        if (last?.type !== 'remove_counters') return null;
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
      // CR 118.12: "You may sacrifice a creature. If you do, …" — the first part is done only if possible.
      const mayDo = /^You may (.+)$/.exec(s);
      // "You may put two +1/+1 counters on it. If you don't, create two 1/1 … Servo … tokens." (CR 702.123a)
      const youDont = sentences[i + 1] ? /^If you don't, (.+)$/.exec(sentences[i + 1]!) : null;
      if (mayDo && youDont && !/^pay /.test(mayDo[1]!)) {
        const first = parseSentence(capitalise(mayDo[1]!), b);
        const otherwise = first ? parseSentence(capitalise(youDont[1]!), b) : null;
        if (!first || !otherwise) return null;
        out.push({ type: 'may_do', effects: first, then: [], else: otherwise });
        i++;
        continue;
      }
      if (mayDo && then) {
        const first = parseSentence(capitalise(mayDo[1]!), b);
        const rest = first ? parseSentence(capitalise(then[1]!), b) : null;
        if (!first || !rest) return null;
        out.push({ type: 'may_do', effects: first, then: rest });
        i++;
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
      if (theyMay && theyDo && !/^You$/.test(theyMay[1]!)) {
        const who = singlePlayer(theyMay[1]!, b);
        const first = who ? attempt(b, (b) => parseClause(theyMay[2]!, b, who)) : null;
        const rest = first ? parseSentence(capitalise(theyDo[1]!), b) : null;
        if (!who || !first || !rest) return null;
        const declined = /n't, /.test(sentences[i + 1]!);
        out.push({ type: 'may_do', who, effects: first.effects, ...(declined ? { else: rest, then: [] } : { then: rest }) });
        i++;
        continue;
      }
      // "Look at the top five cards of your library. You may reveal a creature card from among them and put it
      // into your hand. Put the rest on the bottom of your library in a random order." — and its relatives.
      // "Look at the top three cards of your library, then put one of those cards into your hand and the rest …"
      const lookThen = /^([Ll]ook at|[Rr]eveal) the top (\w+) cards of your library, then (put (?!them back).+)$/.exec(s);
      if (lookThen) {
        const dig = parseDig(lookThen[2]!, capitalise(lookThen[3]!), sentences[i + 1], b);
        if (!dig) return null;
        if (/^[Rr]eveal/.test(lookThen[1]!)) dig.node.reveal = true;
        out.push(dig.node);
        i += dig.used - 1;
        continue;
      }
      const look = /^([Ll]ook at|[Rr]eveal) the top (\w+) cards of your library$/.exec(s);
      if (look && sentences[i + 1]) {
        const dig = parseDig(look[2]!, sentences[i + 1]!, sentences[i + 2], b);
        if (!dig) return null;
        // Revealed: everyone sees the cards (CR 701.20a).
        if (/^[Rr]eveal/.test(look[1]!)) dig.node.reveal = true;
        out.push(dig.node);
        i += dig.used;
        continue;
      }
      // "Look at the top card of your library. If it's a land card, you may put it onto the battlefield tapped.
      // (Otherwise, put it into your hand.)" — one card, maybe taken.
      const topCard = /^([Ll]ook at|[Rr]eveal) the top card of your library$/.exec(s);
      const ifIts = topCard && sentences[i + 1] ? /^If it's (?:a|an) (.+?) card, (you may )?(?:reveal it and )?put it (onto the battlefield( tapped)?|into your hand|into your graveyard)$/.exec(sentences[i + 1]!) : null;
      if (topCard && ifIts) {
        const pf = parseFilter(`${ifIts[1]} card in your library`, b);
        if (!pf) return null;
        const { zone: _z, owner: _o, ...filter } = pf.filter;
        const otherwise = sentences[i + 2] ? /^(?:Otherwise|If you don't put the card (?:onto the battlefield|into your hand)), put (?:it|that card) (into your hand|into your graveyard|on the bottom of your library)$/.exec(sentences[i + 2]!) : null;
        const to = ifIts[3]!.startsWith('onto') ? 'battlefield' : ifIts[3] === 'into your hand' ? 'hand' : 'graveyard';
        const rest = otherwise ? (otherwise[1] === 'into your hand' ? 'hand' : otherwise[1] === 'into your graveyard' ? 'graveyard' : 'bottom') : 'top';
        out.push({ type: 'dig', amount: 1, take: 1, to, filter, rest, ...(ifIts[2] ? { optional: true } : {}), ...(ifIts[4] ? { tapped: true } : {}), ...(/^[Rr]eveal/.test(topCard[1]!) ? { reveal: true } : {}) });
        i += otherwise ? 2 : 1;
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
            if (/^(?:That player|They|The player) discards? (?:that card|it|those cards)$/.test(next)) then = 'discard';
            else if (/^(?:Exile that card|That player exiles that card)$/.test(next)) then = 'exile';
            else return null;
            used = 3;
          }
          return { node: { type: 'choose_from_hand', who, filter, amount, then, revealHand: true, ...(chooses[1] ? { optional: true } : {}) } as EffectNode, used };
        });
        if (!r) return null;
        out.push(r.node);
        i += r.used - 1;
        continue;
      }
      // "If [condition], [effect]." with an optional "Otherwise, [effect]." (CR 608.2c).
      const iff = /^If ([^,]+), (.+)$/.exec(s);
      const cond = iff && !/^If you do\b/.test(s) ? parseCondition(iff[1]!, b) : null;
      // "If this spell was kicked, that creature gets -5/-5 until end of turn instead." — the earlier
      // sentence's effect, replaced when the condition holds.
      const instead = iff && cond && / instead$/.test(iff[2]!) && !/would/.test(iff[2]!) ? iff[2]!.replace(/ instead$/, '') : null;
      if (instead && previous.length) {
        // New targets would be chosen whether or not the condition holds (Tear Asunder's kicker picks
        // different targets): not this shape.
        const targetsBefore = b.targets.length;
        let yes = parseSentence(capitalise(instead), b);
        if (b.targets.length !== targetsBefore) return null;
        // "If this spell was kicked, it deals 5 damage instead." — the same damage, a new amount.
        // "…, it deals 4 damage to that creature instead." names the same recipient.
        const more = /^(?:it|~) deals (\S+) damage(?: to (?:that creature|that permanent|that player|it|them|each of them))?$/i.exec(instead);
        const n = more ? parseAmount(more[1]!) : null;
        if (!yes && n !== null && previous.every((x) => x.type === 'deal_damage')) yes = previous.map((x) => ({ ...structuredClone(x), amount: n }));
        if (!yes) return null;
        const replaced = out.splice(out.length - previous.length, previous.length);
        out.push({ type: 'if', cond: cond!, effects: yes, else: replaced });
        previous = [];
        continue;
      }
      if (iff && cond) {
        const yes = parseSentence(capitalise(iff[2]!), b);
        if (!yes) return null;
        const node: EffectNode = { type: 'if', cond, effects: yes };
        const otherwise = sentences[i + 1] ? /^Otherwise, (.+)$/.exec(sentences[i + 1]!) : null;
        if (otherwise) {
          const no = parseSentence(capitalise(otherwise[1]!), b);
          if (!no) return null;
          node.else = no;
          i++;
        }
        out.push(node);
        continue;
      }
      // Impulse draw: "Exile the top card of your library. Until the end of your next turn, you may play that card."
      const top = /^[Ee]xile the top (card|(\w+) cards) of your library$/.exec(s);
      const next = sentences[i + 1] ?? '';
      const duringNext = /^During your next turn, you may (play|cast) (?:that card|those cards|them|it)$/.exec(next);
      if (top && duringNext) {
        const amount = top[2] ? parseAmount(top[2]) : 1;
        if (amount === null) return null;
        out.push({ type: 'exile_top', amount, who: { ref: 'you' }, play: { mode: duringNext[1], until: 'during_next_turn' } });
        i++;
        continue;
      }
      const untilPlay =
        /^Until (end of turn|the end of your next turn|your next end step), you may (play|cast) (?:that card|those cards|them|it)$/.exec(next) ??
        /^Until (end of turn|the end of your next turn), you may (cast) spells from among (?:them|those cards)$/.exec(next) ??
        /^Until (end of turn|the end of your next turn), you may (play) lands and cast spells from among (?:them|those cards)$/.exec(next);
      const thisTurn = /^You may (play|cast) (?:that card|those cards|them|it) (this turn|until the end of your next turn|until end of turn)$/.exec(next);
      if (top && (untilPlay || thisTurn)) {
        const amount = top[2] ? parseAmount(top[2]) : 1;
        if (amount === null) return null;
        const until = untilPlay ? (untilPlay[1] !== 'end of turn' ? 'next_turn' : 'eot') : thisTurn![2] === 'until the end of your next turn' ? 'next_turn' : 'eot';
        const mode = (untilPlay ? untilPlay[2] : thisTurn![1]) as 'play' | 'cast';
        out.push({ type: 'exile_top', amount, who: { ref: 'you' }, play: { mode, until } });
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
        const last = out[out.length - 1];
        if (last?.type !== 'counter') return null;
        last.exile = true;
        continue;
      }
      // CR 701.48a: "Learn." — discard a card to draw a card; there are no Lesson cards outside the game here.
      if (s === 'Learn') {
        const r = parseEffectText('You may discard a card. If you do, draw a card.', b);
        if (!r) return null;
        out.push(...r);
        continue;
      }
      // CR 707.10c: "You may choose new targets for the copy."
      if (/^(?:If the spell has any targets, )?[Yy]ou may choose (?:a )?new targets? for (?:the|any of the) cop(?:y|ies)$/.test(s)) {
        const copyIn = (list: EffectNode[]): EffectNode | null => {
          for (const x of [...list].reverse()) {
            if (x.type === 'copy_spell') return x;
            for (const k of ['then', 'effects', 'else']) {
              const found = Array.isArray(x[k]) ? copyIn(x[k] as EffectNode[]) : null;
              if (found) return found;
            }
          }
          return null;
        };
        const last = copyIn(out.slice(-1));
        if (!last) return null;
        last.newTargets = true;
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
      const tokenHas = /^(?:It|They) (?:has|have) (.+)$/.exec(s);
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
      const nextCast = /^When you next cast (?:a|an) (.+?) this turn, (.+)$/.exec(s);
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
      // CR 603.7: a delayed trigger — "Sacrifice it at the beginning of the next end step."
      const delayed =
        /^(.+) at the beginning of the next (end step|turn's upkeep)$/.exec(s) ??
        /^At the beginning of the next (end step|turn's upkeep), (.+)$/.exec(s) ??
        /^(.+) at (end of combat)$/.exec(s) ??
        /^At (end of combat), (.+)$/.exec(s);
      if (delayed) {
        const [what, when] = delayed[0].startsWith('At ') ? [delayed[2]!, delayed[1]!] : [delayed[1]!, delayed[2]!];
        const inner = parseSentence(capitalise(what), b);
        if (!inner) return null;
        // CR 511.2: "at end of combat" — as the end of combat step begins.
        out.push({ type: 'delayed', step: when === 'end step' ? 'end' : when === 'end of combat' ? 'end_of_combat' : 'upkeep', effects: inner });
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
      if (/^(?:It|They) can't be regenerated$/.test(s)) {
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
      const effects = parseSentence(s, b);
      if (!effects) return null;
      out.push(...effects);
      previous = effects;
    }
    return out.length ? out : null;
  });
}

const REST: Record<string, { rest: string; order?: string }> = {
  'into your graveyard': { rest: 'graveyard' },
  'on the bottom of your library in any order': { rest: 'bottom', order: 'any' },
  'on the bottom of your library in a random order': { rest: 'bottom', order: 'random' },
  'on the bottom of your library': { rest: 'bottom', order: 'any' },
  'back on top of your library in any order': { rest: 'top', order: 'any' },
  'on top of your library in any order': { rest: 'top', order: 'any' },
};

/** The sentences after "Look at the top N cards of your library." (CR 701.16 isn't a keyword action: just looking). */
function parseDig(count: string, next: string, after: string | undefined, b: Binder): { node: EffectNode; used: number } | null {
  const amount = parseAmount(count);
  if (typeof amount !== 'number' || amount < 1) return null;
  const restOf = (text: string | undefined) => {
    const m = text ? /^(?:Then )?[Pp]ut the (?:rest|others?)(?: of (?:the cards revealed this way|those cards|the cards))? (.+)$/.exec(text) : null;
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
    if (typeof take !== 'number' || take >= amount) return null;
    const rest = restOf(after);
    return { node: { type: 'dig', amount, take, to: putSome[2], ...(rest ?? { rest: 'top', order: 'same' }) }, used: rest ? 2 : 1 };
  }
  // "Put a land card from among them onto the battlefield and the rest into your graveyard.",
  // "Put up to two creature cards with mana value 3 or less from among them onto the battlefield." + "Put the rest …"
  const putFrom = /^Put (a|an|up to \w+) (.+?) from among (?:them|those cards|the revealed cards) (into your hand|onto the battlefield( tapped)?|into your graveyard)(?: and the (?:rest|others?) (.+))?$/.exec(next);
  if (putFrom) {
    const rest = putFrom[5] ? REST[putFrom[5]] : restOf(after);
    const n = putFrom[1]!.startsWith('up to ') ? parseAmount(putFrom[1]!.slice(6)) : 1;
    const pf = parseFilter(`${putFrom[2]} in your library`, b);
    if (!rest || typeof n !== 'number' || !pf || pf.plural !== n > 1) return null;
    const { zone: _z, owner: _o, ...filter } = pf.filter;
    const to = putFrom[3]!.startsWith('into your hand') ? 'hand' : putFrom[3]!.startsWith('onto') ? 'battlefield' : 'graveyard';
    // "up to N": any number of them; "a land card": one if there is one.
    return {
      node: { type: 'dig', amount, take: n, to, filter, ...(putFrom[1]!.startsWith('up to ') ? { optional: true } : {}), ...rest, ...(putFrom[4] ? { tapped: true } : {}) },
      used: putFrom[5] ? 1 : 2,
    };
  }
  // "You may reveal a creature card from among them and put it into your hand." + "Put the rest …"
  const reveal = /^You may (reveal|put) (a|an|up to \w+) (.+?) from among (?:them|those cards)(?: and put (?:it|them))? (into your hand|onto the battlefield( tapped)?|into your graveyard)$/.exec(next);
  if (reveal) {
    const rest = restOf(after);
    const n = reveal[2]!.startsWith('up to ') ? parseAmount(reveal[2]!.slice(6)) : 1;
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
  const all = /^Put all (.+?) cards? (?:revealed this way|from among them) into your (hand|graveyard) and the (?:rest|others) (.+)$/.exec(next);
  if (all) {
    const rest = REST[all[3]!];
    const pf = parseFilter(`${all[1]} cards in your library`, b);
    if (!rest || !pf) return null;
    const { zone: _z, owner: _o, ...filter } = pf.filter;
    return { node: { type: 'dig', amount, take: amount, to: all[2], filter, all: true, ...rest }, used: 1 };
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

function capitalise(s: string): string {
  return s.replace(/^\w/, (c) => c.toUpperCase());
}

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
function parseCounted(s: string, b: Binder): EffectNode[] | null {
  const at = s.indexOf(' for each ');
  if (at > 0) {
    const tail = s.slice(at + ' for each '.length);
    // "gets +1/+1 for each creature you control until end of turn": the duration stays with the effect.
    const suffix = / until end of turn$/.exec(tail);
    const options: [string, string][] = [[tail, '']];
    if (suffix) options.unshift([tail.slice(0, suffix.index), suffix[0]]);
    for (const [what, rest] of options) {
      const r = attempt(b, (b) => {
        const expr = parseForEach(what, b);
        const inner = expr && parseSentence(s.slice(0, at) + rest, b);
        return inner && expr ? scaleBy(inner, expr) : null;
      });
      if (r) return r;
    }
  }
  // "you gain that much life", "put that many +1/+1 counters on it" — the trigger event's amount.
  if (b.eventAmount && /\bthat (?:much|many)\b/.test(s)) {
    const text = s.replace(/\bthat (?:much|many)\b/g, 'X');
    const r = attempt(b, (b) => {
      const inner = parseSentence(text, b);
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
        const expr = parseCount(what, b);
        const inner = expr && parseSentence(text, b);
        return inner && expr ? bindX(inner, expr) : null;
      });
      if (r) return r;
    }
  }
  return null;
}

function parseSentence(s: string, b: Binder): EffectNode[] | null {
  // CR 611.2b: "Target creature gets +2/+2 for as long as ~ remains tapped", "Gain control of target creature for as long as ~ remains tapped".
  const whileTapped = / for as long as ~ remains tapped$/.exec(s.replace(/\.$/, ''));
  if (whileTapped) {
    const base = s.replace(/\.$/, '').slice(0, whileTapped.index);
    const durable = (r: EffectNode[] | null) => (r && r.every((x) => x.type === 'modify' || x.type === 'gain_control') ? r : null);
    const inner = attempt(b, (b) => durable(parseSentence(`${base} until end of turn`, b))) ?? attempt(b, (b) => durable(parseSentence(base, b)));
    if (inner) return inner.map((x) => ({ ...x, until: 'source_tapped' }));
  }
  // "…, where X is the number of creatures you control." (CR 107.3a: X defined by the text)
  const where = /^(.+), where X is (.+)$/.exec(s);
  if (where) {
    return attempt(b, (b) => {
      const expr = parseCount(where[2]!, b);
      const inner = expr && parseSentence(where[1]!, b);
      return inner && expr ? bindX(inner, expr) : null;
    });
  }
  // CR 118.12a / CR 119.4: "… unless that player pays 3 life" (or "{2} and 2 life").
  const unlessLife = /^(.+) unless (.+?) (?:pays|pay) (?:((?:\{(?:\d+|[WUBRGC])\})+) and )?(\d+) life$/.exec(s);
  if (unlessLife) {
    return attempt(b, (b) => {
      const inner = parseSentence(unlessLife[1]!, b);
      const payer = inner ? parsePlayerRef(unlessLife[2]!, b) : null;
      return inner && payer ? [{ type: 'unless_pays', payer, cost: unlessLife[3] ?? '', life: Number(unlessLife[4]), effects: inner }] : null;
    });
  }
  // "… unless that player discards a card" / "sacrifices a creature".
  const unlessDoes = /^(.+) unless (.+?) (discards|sacrifices) (.+)$/.exec(s);
  if (unlessDoes) {
    const r = attempt(b, (b) => {
      const inner = parseSentence(unlessDoes[1]!, b);
      const payer = inner ? parsePlayerRef(unlessDoes[2]!, b) : null;
      if (!inner || !payer) return null;
      const action = attempt(b, (b) => parseClause(`${unlessDoes[3]} ${unlessDoes[4]}`, b, payer));
      return action ? [{ type: 'unless_does', payer, action: action.effects, effects: inner }] : null;
    });
    if (r) return r;
  }
  // CR 118.12a: "[Do something] unless [a player] pays [cost]."
  const unless = /^(.+) unless (.+?) (?:pays|pay) ((?:\{(?:\d+|[WUBRGC]|[WUBRG2]\/[WUBRG])\})+)$/.exec(s);
  if (unless) {
    return attempt(b, (b) => {
      const inner = parseSentence(unless[1]!, b);
      const payer = inner ? parsePlayerRef(unless[2]!, b) : null;
      return inner && payer ? [{ type: 'unless_pays', payer, cost: unless[3]!, effects: inner }] : null;
    });
  }
  // "Then discard a card unless this spell was cast using teamwork." — a condition, not a choice (CR 608.2c).
  const unlessCond = /^(.+) unless (.+)$/.exec(s);
  if (unlessCond) {
    const r = attempt(b, (b) => {
      const cond = parseCondition(unlessCond[2]!, b);
      const inner = cond ? parseSentence(unlessCond[1]!, b) : null;
      return cond && inner ? [{ type: 'if', cond, effects: [], else: inner }] : null;
    });
    if (r) return r;
  }
  // CR 608.2g: "You may cast it without paying its mana cost" — cast during resolution, timing ignored.
  // CR 305.2: "You may play an additional land this turn."
  const extraLand = /^(You|Each player) may play (an|two) additional lands? this turn$/.exec(s);
  if (extraLand) return [{ type: 'extra_land', who: { ref: extraLand[1] === 'You' ? 'you' : 'players' }, ...(extraLand[2] === 'two' ? { amount: 2 } : {}) }];
  const free = /^[Yy]ou may cast (.+?) without paying (?:its|that spell's|~'s) mana cost$/.exec(s);
  if (free) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(free[1]!.replace(/ from (?:your|a|an opponent's|that player's) graveyard$/, (m) => m), b);
      if (!what || what.plural) return null;
      return [{ type: 'cast_free', what: what.ref }];
    });
    if (r) return r;
  }
  const may = /^[Yy]ou may (.+)$/.exec(s);
  if (may) {
    const inner = attempt(b, (b) => parseSentence(may[1]!, b));
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
      if (becomeCopy[4] && !except) return null;
      const until = becomeCopy[3] || /^[Uu]ntil end of turn, /.test(s) ? 'eot' : undefined;
      return [{ type: 'become_copy', what: what.ref, of: of.ref, ...(until ? { until } : {}), ...(except ? { except } : {}) }];
    });
    if (r) return r;
  }
  // CR 707.10: "Copy target instant or sorcery spell", "copy that spell twice", "copy it for each …",
  // "Copy target activated or triggered ability you control", "copy that ability".
  const copy = /^[Cc]opy (.+?)(?: (twice|three times)| for each (.+))?$/.exec(s);
  if (copy && (!/ ability$/.test(copy[1]!) || /^(?:target .+|that) ability$/.test(copy[1]!))) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(copy[1]!, b);
      if (!what || what.plural) return null;
      // Only spells and abilities: a target on the stack, the spell or ability that triggered it, or this spell.
      const spec = what.ref.ref === 'target' ? b.targets[what.ref.index] : undefined;
      if (spec && spec.what !== 'ability' && spec.filter?.zone !== 'stack') return null;
      if (!['target', 'trigger_object', 'self'].includes(what.ref.ref)) return null;
      const amount = copy[2] ? (copy[2] === 'twice' ? 2 : 3) : copy[3] ? parseForEach(copy[3], b) : 1;
      if (!amount) return null;
      return [{ type: 'copy_spell', what: what.ref, ...(amount !== 1 ? { amount } : {}) }];
    });
    if (r) return r;
  }
  // "Remove a time counter from it" (vanishing, CR 702.63a).
  const remove = /^[Rr]emove (a|an|one|two|three|\d+) (\S+) counters? from (.+)$/.exec(s);
  if (remove) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(remove[3]!, b);
      const amount = parseAmount(remove[1]!);
      return what && !what.plural && typeof amount === 'number' ? [{ type: 'remove_counters', what: what.ref, counter: remove[2]!, amount }] : null;
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
  // "Investigate twice.", "Proliferate twice." — the action, again.
  const again = /^(.+) (twice|three times)$/.exec(s);
  if (again && /^(?:[Ii]nvestigate|[Pp]roliferate|[Pp]opulate|[Ss]cry \w+|[Ss]urveil \w+|[Aa]mass .+|[Bb]olster \w+|[Cc]onnive|[Ee]xplore|[Ii]ncubate \w+)$/.test(again[1]!)) {
    const once = parseSentence(again[1]!, b);
    if (once) return Array.from({ length: again[2] === 'twice' ? 2 : 3 }, () => structuredClone(once)).flat();
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
  const extraTurn = /^(?:(.+?) takes?|[Tt]ake) an extra turn after this one$/.exec(s);
  if (extraTurn) {
    const r = attempt(b, (b) => {
      const who = extraTurn[1] ? parsePlayerRef(extraTurn[1], b) : { ref: 'you' as const };
      return who ? [{ type: 'extra_turn', who }] : null;
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
  if (chooseValue) return [{ type: 'choose_value', choice: chooseValue[1] === 'color' ? 'color' : 'creature_type' }];
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
  // "When this creature dies, put its counters on target creature you control." (its counters as it died)
  const itsCounters = /^[Pp]ut (?:its|~'s) counters on (.+)$/.exec(s);
  if (itsCounters && b.itIsSource) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(itsCounters[1]!, b);
      return what ? [{ type: 'put_counters', what: what.ref }] : null;
    });
    if (r) return r;
  }
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
  // CR 701.30b: "Clash with an opponent."
  if (/^[Cc]lash with an opponent$/.test(s)) return [{ type: 'clash' }];
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
  const endure = /^(.+?) endures (\d+)$/.exec(s);
  if (endure) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(endure[1]!, b);
      const n = Number(endure[2]);
      if (!what || what.plural) return null;
      // CR 701.63b: endure 0 does nothing.
      if (n === 0) return [];
      const token = parseSentence(`Create a ${n}/${n} white Spirit creature token`, b.clone());
      if (!token) return null;
      return [{ type: 'may_do', effects: [{ type: 'add_counters', what: what.ref, counter: '+1/+1', amount: n }], then: [], else: token }];
    });
    if (r) return r;
  }
  // "Look at the top four cards of your library, then put them back in any order."
  const reorder = /^[Ll]ook at the top (\w+) cards of your library(?:,| and) then put them back in any order$/.exec(s);
  if (reorder) {
    const amount = parseAmount(reorder[1]!);
    return typeof amount === 'number' ? [{ type: 'reorder_top', amount }] : null;
  }
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
  const bite = /^(.+?) deals damage equal to (?:its|~'s) power to (.+)$/.exec(s) ?? /^(.+?) deals damage to (itself) equal to its power$/.exec(s);
  // (The source itself dealing the damage is the ordinary case, read elsewhere.)
  const sourceItself = bite && (bite[1] === '~' || (/^it$/i.test(bite[1]!) && (b.it?.ref === 'self' || b.itIsSource)));
  if (bite && !sourceItself) {
    const r = attempt(b, (b) => {
      const from = parseObjectRef(bite[1]!, b);
      if (!from || from.plural) return null;
      const to = bite[2] === 'itself' ? [from.ref] : parseRecipients(bite[2]!, b);
      if (!to) return null;
      return to.map((t) => ({ type: 'deal_damage', amount: { kind: 'stat', stat: 'power', of: from.ref }, to: t, from: from.ref }));
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
  // "Target creature's owner puts it on their choice of the top or bottom of their library."
  const topOrBottom = /^(.+?)'s owner puts it on their choice of the top or bottom of their library$/.exec(s);
  if (topOrBottom) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(topOrBottom[1]!, b);
      return what && !what.plural ? [{ type: 'move', what: what.ref, to: 'library', position: 'choice' }] : null;
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
  // CR 615.12: "Damage can't be prevented this turn."
  if (/^Damage can't be prevented this turn$/.test(s)) return [{ type: 'damage_unpreventable' }];
  // Circle of Protection: "The next time a red source of your choice would deal damage to you this turn, prevent that damage."
  const nextSource = /^The next time (?:a|an) (?:(white|blue|black|red|green|artifact|creature) )?source of your choice would deal damage to you this turn, prevent that damage$/.exec(s);
  if (nextSource) {
    const COLORS: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
    const k = nextSource[1];
    const filter = !k ? {} : COLORS[k] ? { colors: [COLORS[k]] } : { types: [k[0]!.toUpperCase() + k.slice(1)] };
    return [{ type: 'prevent_chosen_source', filter }];
  }
  // CR 701.57a: "discover N".
  const discover = /^[Dd]iscover (\d+)$/.exec(s);
  if (discover) return [{ type: 'discover', n: Number(discover[1]) }];
  // CR 701.40a / 701.58a: "Manifest the top card of your library", "cloak the top two cards of your library".
  const manifest = /^([Mm]anifest|[Cc]loak) the top (card|two cards|three cards) of your library$/.exec(s);
  if (manifest) {
    const amount = manifest[2] === 'card' ? 1 : manifest[2] === 'two cards' ? 2 : 3;
    return [{ type: 'manifest', amount, ...(/^[Cc]loak/.test(manifest[1]!) ? { cloak: true } : {}) }];
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
  const until = /^Until end of turn, (.+?) (gets?|gains?|has|have|can't|becomes?|loses?) (.+)$/.exec(s);
  if (until) return parseSentence(`${until[1]} ${until[2]} ${until[3]} until end of turn`, b);

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
      const l = (shared ? attempt(b, (b) => parseClause(`${left} until end of turn`, b, null)) : null) ?? parseClause(left, b, null);
      if (!l) return null;
      // "Target creature gets +3/+3 until end of turn and must be blocked this turn if able": the object goes on.
      const rest = parseSentenceWithSubject(right, b, l.subject) ?? (!l.subject && b.it ? attempt(b, (b) => parseClause(`it ${right}`, b, null))?.effects ?? null : null);
      return rest ? [...l.effects, ...rest] : null;
    });
    if (r) return r;
  }
  return null;
}

function parseSentenceWithSubject(s: string, b: Binder, subject: Ref | null): EffectNode[] | null {
  const whole = attempt(b, (b) => parseClause(s, b, subject));
  if (whole) return whole.effects;
  const joints = [...s.matchAll(/, then | and then | and |, /g)];
  for (const j of joints) {
    const r = attempt(b, (b) => {
      const l = parseClause(s.slice(0, j.index), b, subject);
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

/** Player verbs: lemma → handler. The subject is the player performing it ("you" when imperative). */
type VerbHandler = (args: string, who: Ref, b: Binder, imperative: boolean) => EffectNode[] | null;

const VERB_FORMS: Record<string, string> = {};
const VERBS: Record<string, VerbHandler> = {
  draw(args, who) {
    const m = /^(\S+) cards?$/.exec(args);
    const amount = m && parseAmount(m[1]!);
    return amount !== null && amount !== undefined ? [{ type: 'draw', amount, who }] : null;
  },
  gain(args, who, b, imperative) {
    // Layer 2 (CR 613.1b): "Gain control of target creature until end of turn."
    const control = /^control of (.+?)( until end of turn)?$/.exec(args);
    if (control) {
      if (!imperative) return null;
      const what = parseObjectRef(control[1]!, b);
      return what ? [{ type: 'gain_control', what: what.ref, ...(control[2] ? { until: 'eot' } : {}) }] : null;
    }
    const m = /^(\S+) life$/.exec(args);
    const amount = m && parseAmount(m[1]!);
    return amount !== null && amount !== undefined ? [{ type: 'gain_life', amount, who }] : null;
  },
  lose(args, who) {
    const m = /^(\S+) life$/.exec(args);
    const amount = m && parseAmount(m[1]!);
    return amount !== null && amount !== undefined ? [{ type: 'lose_life', amount, who }] : null;
  },
  discard(args, who) {
    // "discards their hand" (CR 701.9a: all the cards in it).
    if (/^(?:their|your|his or her) hand$/.test(args)) return [{ type: 'discard', all: true, amount: 0, who }];
    const m = /^(\S+) cards?$/.exec(args);
    const amount = m && parseAmount(m[1]!);
    return amount !== null && amount !== undefined ? [{ type: 'discard', amount, who }] : null;
  },
  mill(args, who) {
    const m = /^(\S+) cards?$/.exec(args);
    const amount = m && parseAmount(m[1]!);
    return amount !== null && amount !== undefined ? [{ type: 'mill', amount, who }] : null;
  },
  scry(args, who) {
    const amount = parseAmount(args);
    return amount !== null && who.ref === 'you' ? [{ type: 'scry', amount }] : null;
  },
  surveil(args, who) {
    const amount = parseAmount(args);
    return amount !== null && who.ref === 'you' ? [{ type: 'surveil', amount }] : null;
  },
  create(args, who, b) {
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
      createdTokens(b);
      return [node];
    }
    // CR 508.4: "… tokens that are tapped and attacking"
    const attackingSuffix = / (?:that are|that's|that is) tapped and attacking$|,? tapped and attacking$/;
    const attacking = attackingSuffix.test(args);
    if (attacking) args = args.replace(attackingSuffix, '');
    const attached = /^(.+?) attached to (.+)$/.exec(args);
    const token = parseTokenPhrase(attached ? attached[1]! : args, b);
    if (!token) return null;
    const node: EffectNode = { type: 'create_token', amount: token.amount, token: token.face, who };
    if (token.tapped) node.tapped = true;
    if (attacking) {
      node.tapped = true;
      node.attacking = true;
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
    // CR 701.21a. "Each opponent sacrifices a creature": each of those players chooses one.
    // "sacrifices a creature of their choice" (the 2024 wording; CR 701.21a: the player chooses either way).
    const choice = /^(a|an|one|two|three|four|five|\d+|another) (.+?)(?: of (?:their|your) choice)?$/.exec(args);
    if (choice) {
      const pf = parseFilter(choice[2]!, b);
      const amount = choice[1] === 'another' ? 1 : parseAmount(choice[1]!);
      // A numeral comes from a keyword definition ("sacrifices N permanents" with N = 1), so either number is fine.
      if (!pf || typeof amount !== 'number' || (pf.plural !== amount > 1 && !/^\d+$/.test(choice[1]!))) return null;
      if (choice[1] === 'another') pf.filter.other = true;
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
    const fromHand = /^(a|an|up to one|up to two) (.+?) from your hand onto the battlefield( tapped)?$/.exec(args);
    if (fromHand) {
      const n = fromHand[1] === 'up to two' ? 2 : 1;
      const pf = parseFilter(`${fromHand[2]} in your hand`, b);
      if (!pf || pf.plural !== n > 1) return null;
      const { zone: _z, owner: _o, ...filter } = pf.filter;
      return [{ type: 'choose_from_hand', who: { ref: 'you' }, filter, amount: n, then: 'battlefield', ...(fromHand[3] ? { tapped: true } : {}), ...(fromHand[1]!.startsWith('up to') ? { optional: true } : {}) }];
    }
    // "Put target creature card from a graveyard onto the battlefield under your control." — "return … to the battlefield".
    const onto = /^(.+?) onto the battlefield( tapped)?( transformed)?( under (?:your|its owner's|their owners'|their owner's) control)?(?: with (?:a|an|one|two|three) \S+ counters? on it)?$/.exec(args);
    if (onto && !/ from your hand/.test(onto[1]!) && / from (?:a|your|an opponent's|target player's) graveyards?$|^target .+ card$/.test(onto[1]!)) {
      const r = attempt(b, (b) => VERBS.return!(args.replace(' onto the battlefield', ' to the battlefield'), who, b, imperative));
      if (r) return r;
    }
    // "Put a number of +1/+1 counters equal to the power of the card you exiled on target creature." (scavenge)
    const counted = /^a number of (\S+) counters equal to (.+?) on (.+)$/.exec(args);
    if (counted) {
      const amount = counted[2] === 'the power of the card you exiled' ? { kind: 'stat', stat: 'power', of: { ref: 'self' } } : parseCount(counted[2]!, b);
      const what = amount ? parseObjectRef(counted[3]!, b) : null;
      return amount && what ? [{ type: 'add_counters', what: what.ref, counter: counted[1]!.replace(/−/g, '-'), amount }] : null;
    }
    const counters = /^(\S+) (\S+) counters? on (.+)$/.exec(args);
    if (counters) {
      const amount = parseAmount(counters[1]!);
      const what = parseObjectRef(counters[3]!, b);
      if (amount === null || !what || !/^[+-]?\w+(?:\/[+-]\d+)?$/.test(counters[2]!)) return null;
      return [{ type: 'add_counters', what: what.ref, counter: counters[2]!.replace(/−/g, '-'), amount }];
    }
    const lib = /^(.+?) on (top|the bottom) of (?:its owner's|their owners'|your) library$/.exec(args);
    if (lib) {
      const what = parseObjectRef(lib[1]!, b);
      return what ? [{ type: 'move', what: what.ref, to: 'library', position: lib[2] === 'top' ? 'top' : 'bottom' }] : null;
    }
    return null;
  },
  destroy: objectVerb('destroy'),
  exile(args, who, b, imperative) {
    // "that player exiles the top card of their library" (ingest), "Exile the top two cards of target player's library".
    const top = /^the top (card|(\w+) cards) of (your|their|(.+?)'s) library$/.exec(args);
    if (top) {
      const amount = top[2] ? parseAmount(top[2]) : 1;
      if (amount === null || amount === undefined) return null;
      let owner: Ref | null = who;
      if (top[4]) owner = imperative ? parsePlayerRef(top[4], b) : null;
      else if ((top[3] === 'your') !== imperative) return null;
      if (!owner) return null;
      // "it", "that card", "those cards" afterward: the exiled cards.
      b.it = { ref: 'created' };
      return [{ type: 'exile_top', amount, who: owner }];
    }
    if (!imperative) return null;
    // CR 610.3: "exile target creature until ~ leaves the battlefield" (Banishing Light).
    const until = / until ~ leaves the battlefield$/.exec(args);
    const what = parseObjectRef(until ? args.slice(0, until.index) : args, b);
    if (!what) return null;
    return [{ type: 'move', what: what.ref, to: 'exile', ...(until ? { until: 'source_leaves' } : {}) }];
  },
  return(args, who, b, imperative) {
    if (!imperative) return null;
    const hand = /^(.+?) to (?:its owner's|their owners'|their owner's|your|its owners') hands?$/.exec(args);
    if (hand) {
      const what = parseObjectRef(hand[1]!, b);
      return what ? [{ type: 'move', what: what.ref, to: 'hand' }] : null;
    }
    const field = /^(.+?) to the battlefield( tapped)?( transformed)?( under (?:your|its owner's|their owners'|their owner's) control)?(?: with (a|an|one|two|three) (\S+) counters? on it)?$/.exec(args);
    if (field) {
      const what = parseObjectRef(field[1]!, b);
      if (!what) return null;
      const node: EffectNode = { type: 'move', what: what.ref, to: 'battlefield' };
      if (field[2]) node.tapped = true;
      // CR 712.14a
      if (field[3]) node.transformed = true;
      if (field[4] === ' under your control') node.under = 'you';
      // CR 122.6: "with a -1/-1 counter on it" — it enters with the counter.
      if (field[5]) node.counters = { [field[6]!.replace(/−/g, '-')]: parseAmount(field[5]!) };
      return [node];
    }
    return null;
  },
  tap: objectVerb('tap'),
  untap(args, who, b, imperative) {
    // "untap up to two lands", "untap up to four target lands" (the latter targets)
    const upTo = imperative ? /^up to (\w+) (?!target )(.+)$/.exec(args) : null;
    if (upTo) {
      const n = parseAmount(upTo[1]!);
      const pf = typeof n === 'number' ? parseFilter(upTo[2]!, b) : null;
      if (!pf || !pf.plural || pf.filter.zone || typeof n !== 'number') return null;
      return [{ type: 'untap_chosen', filter: pf.filter, amount: n }];
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
    if (theirs) args = args.replace(/^their library /, 'your library ').replace(/ into their hand/, ' into your hand').replace(/ into their graveyard/, ' into your graveyard');
    // "your library and/or graveyard", "your graveyard, hand, and/or library": several zones.
    const zonesWord = /^your (library and\/or graveyard|graveyard and\/or library|graveyard, hand, and\/or library|hand, graveyard, and\/or library|library, graveyard, and\/or hand) for /.exec(args);
    const zones = zonesWord ? zonesWord[1]!.split(/,? (?:and\/or )?|, /).filter(Boolean) : null;
    if (zonesWord) {
      args = args.replace(zonesWord[0], 'your library for ').replace(/, reveal it, and put it/, ', reveal it, put it').replace(/ and put (it|them) (?=onto|into)/, ', put $1 ');
      // The shuffle comes in its own sentence ("If you search your library this way, shuffle.").
      if (!/, then shuffle$/.test(args)) args += ', then shuffle';
    }
    const m =
      /^your library for (.+?), (?:reveal (?:it|them|those cards), )?put (?:it|them|that card|those cards) (into your hand|onto the battlefield( tapped)?|into your graveyard), then shuffle$/.exec(args) ??
      /^your library for (.+?), then shuffle and put (?:that card|it) (on top)$/.exec(args);
    if (!m) return null;
    const q = /^(?:(a|an|one)|up to (\w+)|(\w+)) (.+)$/.exec(m[1]!);
    if (!q) return null;
    const amount = q[1] ? 1 : parseAmount(q[2] ?? q[3]!);
    if (typeof amount !== 'number') return null;
    const pf = parseFilter(`${q[4]} in your library`, b);
    if (!pf || pf.plural !== amount > 1) return null;
    const to = m[2]!.startsWith('into your hand') ? 'hand' : m[2]!.startsWith('onto') ? 'battlefield' : m[2] === 'on top' ? 'library' : 'graveyard';
    const node: EffectNode = { type: 'search', filter: pf.filter, amount, to };
    if (zones) node.zones = zones;
    if (theirs) node.who = who;
    if (q[2]) node.upTo = true;
    if (m[3]) node.tapped = true;
    return [node];
  },
  // CR 701.62a: "manifest dread" — "that creature" is the manifested permanent afterward.
  manifest(args, who, b) {
    if (args !== 'dread' || who.ref !== 'you') return null;
    b.it = { ref: 'created' };
    return [{ type: 'manifest', amount: 1, dread: true }];
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
    const m = /^(~|it) to (.+)$/.exec(args);
    if (!m || !imperative || (m[1] === 'it' && b.it?.ref !== 'self')) return null;
    const to = parseObjectRef(m[2]!, b);
    return to && !to.plural ? [{ type: 'attach', what: { ref: 'self' }, to: to.ref }] : null;
  },
};

function objectVerb(type: string): VerbHandler {
  return (args, _who, b, imperative) => {
    if (!imperative) return null;
    const what = parseObjectRef(args, b);
    return what ? [{ type, what: what.ref }] : null;
  };
}

for (const lemma of Object.keys(VERBS)) {
  VERB_FORMS[lemma] = lemma;
  VERB_FORMS[lemma.endsWith('y') ? `${lemma.slice(0, -1)}ies` : `${lemma}s`] = lemma;
}
VERB_FORMS.scries = 'scry';

const VERB_ALT = Object.keys(VERB_FORMS)
  .sort((a, b) => b.length - a.length)
  .join('|');
const IMPERATIVE = new RegExp(`^(${VERB_ALT}) (.+)$`, 'i');
const WITH_SUBJECT = new RegExp(`^(.+?) (${VERB_ALT}) (.+)$`);

/** Replacement and prevention effects created by a resolving spell (CR 614, CR 615). */
function parseReplacement(c: string, b: Binder): EffectNode[] | null {
  // CR 614.1a: "If that creature would die this turn, exile it instead."
  const dies = /^If (.+?) would die this turn, exile it instead$/.exec(c);
  if (dies) {
    // "a creature dealt damage this way": what the spell's damage was dealt to.
    if (/^an? (?:creature|permanent|creature or planeswalker) dealt damage this way$/.test(dies[1]!)) {
      return b.damaged ? [{ type: 'exile_if_dies', what: b.damaged }] : null;
    }
    const what = parseObjectRef(dies[1]!, b);
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
  const all = /^Prevent all (combat )?damage that would be dealt (?:to|by) (.+?) this turn$/.exec(c);
  if (all) {
    const to = parseRecipients(all[2]!, b);
    const by = /dealt by/.test(c);
    return to?.length === 1 ? [{ type: 'prevent', amount: 'all', ...(all[1] ? { combat: true } : {}), [by ? 'by' : 'to']: to[0] }] : null;
  }
  return null;
}

/** Keyword actions that are a whole clause on their own. */
function parseKeywordAction(c: string, b: Binder): EffectNode[] | null {
  // CR 702.112a: "… and it becomes renowned".
  if (/^(?:it|~) becomes renowned$/i.test(c)) return [{ type: 'become_renowned' }];
  // CR 701.16a: "Investigate" means "Create a Clue token."
  if (/^investigate$/i.test(c)) {
    const clue = parseTokenPhrase('a Clue token', b);
    return clue ? [{ type: 'create_token', amount: 1, token: clue.face, who: { ref: 'you' } }] : null;
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
  const explore = /^(.+?) explores$/i.exec(c);
  if (explore) {
    const what = parseObjectRef(explore[1]!, b);
    return what && !what.plural ? [{ type: 'explore', what: what.ref }] : null;
  }
  // CR 107.14 / CR 122.1: "you get {E}{E}", "you get an experience counter" — counters on a player.
  const energy = /^(.+?) gets? ((?:\{E\})+)$/i.exec(c);
  const experience = /^(.+?) gets? (an?|one|two|three) (experience|rad) counters?$/i.exec(c);
  if (energy || experience) {
    const who = parsePlayerRef((energy ?? experience)![1]!, b);
    const amount = energy ? energy[2]!.length / 3 : parseAmount(experience![2]!);
    return who && typeof amount === 'number' ? [{ type: 'get_counters', who, counter: energy ? 'energy' : experience![3]!, amount }] : null;
  }
  // CR 701.34a
  if (/^proliferate$/i.test(c)) return [{ type: 'proliferate' }];
  // CR 701.50a: "~ connives", "target creature you control connives".
  const connive = /^(.+?) connives$/i.exec(c);
  if (connive) {
    const what = parseObjectRef(connive[1]!, b);
    return what && !what.plural ? [{ type: 'connive', what: what.ref }] : null;
  }
  // CR 701.47a: "Amass Orcs 2" (older cards: "Amass 2", Zombies).
  const amass = /^amass(?: (\w+))? (\S+)$/i.exec(c);
  if (amass) {
    const amount = parseAmount(amass[2]!);
    const subtype = amass[1] ? subtypeOf(amass[1]) : 'Zombie';
    return amount !== null && subtype ? [{ type: 'amass', subtype, amount }] : null;
  }
  // "It doesn't untap during its controller's next untap step." (CR 502.3)
  const stay = /^(.+?) (?:doesn't|don't) untap during (?:its controller's|their controllers'|their controller's|your) next untap step$/i.exec(c);
  if (stay) {
    const what = parseObjectRef(stay[1]!, b);
    return what ? [{ type: 'skip_untap', what: what.ref }] : null;
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
  const lock = /^(.+?) (?:doesn't|don't) untap during (?:its|their) controller(?:'s|s') untap steps? for as long as ~ remains tapped$/i.exec(c);
  if (lock) {
    const what = parseObjectRef(lock[1]!, b);
    return what ? [{ type: 'lock_untap', what: what.ref }] : null;
  }
  // CR 702.26: "Target creature phases out.", "All permanents you control phase out."
  const phase = /^(.+?) phases? out$/i.exec(c);
  if (phase) {
    const what = parseObjectRef(phase[1]!, b);
    return what ? [{ type: 'phase_out', what: what.ref }] : null;
  }
  // CR 500.8: "After this phase, there is an additional combat phase (followed by an additional main phase)."
  const extraCombat = /^after this (?:main )?phase, there is an additional combat phase( followed by an additional main phase)?$/i.exec(c);
  if (extraCombat) return [{ type: 'extra_combat', ...(extraCombat[1] ? { main: true } : {}) }];
  // CR 701.54a: "The Ring tempts you."
  if (/^the ring tempts you$/i.test(c)) return [{ type: 'ring_tempts' }];
  // CR 701.27a: transforming turns a double-faced permanent over.
  const transform = /^transform (~|it)$/i.exec(c);
  if (transform && (transform[1] === '~' || b.it?.ref === 'self')) return [{ type: 'transform', what: { ref: 'self' } }];
  // CR 106.4: "Add {R}{R}{R}." as an instruction (rituals, triggered mana); "Add one mana of any color."
  const add = /^add (.+)$/i.exec(c);
  const produced = add ? parseManaProduction(add[1]!) : null;
  if (produced) return [produced];
  return null;
}

const BASIC_LAND_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
const CHOICE_OF: Record<string, 'color' | 'creature_type' | 'land_type'> = { 'color': 'color', 'creature type': 'creature_type', 'basic land type': 'land_type' };

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
  const choice = /^(.+?) becomes? the (color|creature type|basic land type) of your choice$/.exec(body);
  if (choice) {
    return attempt(b, (b) => {
      const what = parseObjectRef(choice[1]!, b);
      if (!what) return null;
      const kind = CHOICE_OF[choice[2]!]!;
      const change = kind === 'color' ? { colors: ['chosen'] } : kind === 'creature_type' ? { creatureTypes: ['chosen'] } : { landTypes: ['chosen'] };
      return [{ type: 'choose_value', choice: kind, scope: 'resolution' }, { type: 'modify', what: what.ref, ...change, until }];
    });
  }
  // "becomes blue", "becomes black and red", "becomes colorless"
  const color = /^(.+?) becomes? ((?:white|blue|black|red|green)(?: and (?:white|blue|black|red|green))?|colorless)$/.exec(body);
  if (color) {
    return attempt(b, (b) => {
      const what = parseObjectRef(color[1]!, b);
      const colors = color[2] === 'colorless' ? [] : color[2]!.split(' and ').map((w) => COLOR_WORDS[w]!);
      return what ? [{ type: 'modify', what: what.ref, colors, until }] : null;
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
  // Layer 7b: "Target creature has base power and toughness 1/1 until end of turn", "… becomes a 0/1 until end of turn".
  const base = /^(.+?) (?:ha(?:s|ve) base power and toughness|becomes? an?) (\d+)\/(\d+) until end of turn$/.exec(c);
  if (base) {
    return attempt(b, (b) => {
      const what = parseObjectRef(base[1]!, b);
      return what ? [{ type: 'modify', what: what.ref, setPower: Number(base[2]), setToughness: Number(base[3]), until: 'eot' }] : null;
    });
  }
  const m = /^(.+?) becomes? an? (?:(\d+|X)\/(\d+|X) )?(.+?)(?: with (.+?))?( that's still an? (?:land|planeswalker|artifact|enchantment))?( in addition to its other types)?( until end of turn)?$/.exec(c);
  if (!m) return null;
  // Without a P/T it keeps its own ("This Vehicle becomes an artifact creature", CR 702.122a).
  if (!m[2] && !/\bcreature$/.test(m[4]!)) return null;
  return attempt(b, (b) => {
    const what = parseObjectRef(m[1]!, b);
    if (!what) return null;
    const words = m[4]!.replace(/ and /g, ' ').split(' ');
    if (words[words.length - 1] !== 'creature') return null;
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
    if (!m[2] && types.includes('Artifact')) node.retainTypes = true;
    if (colors.length) node.colors = colors;
    if (m[6] || m[7]) node.retainTypes = true;
    if (m[5]) {
      const kws = parseKeywordList(m[5], b);
      if (!kws) return null;
      node.keywords = kws;
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

  const imp = IMPERATIVE.exec(c);
  if (imp) {
    const lemma = VERB_FORMS[imp[1]!.toLowerCase()]!;
    const who = inherited ?? { ref: 'you' };
    const imperative = who.ref === 'you';
    // A subjectless verb with a non-"you" subject must agree in form ("draws"), which is fine to skip checking.
    const effects = attempt(b, (b) => VERBS[lemma]!(imp[2]!, who, b, imperative));
    if (effects) return { effects, subject: who };
  }

  const sub = WITH_SUBJECT.exec(c);
  if (sub) {
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

/** "~ deals 3 damage to any target", "… to target creature and 2 damage to its controller". */
function parseDamage(c: string, b: Binder): EffectNode[] | null {
  // CR 601.2d: "~ deals 3 damage divided as you choose among one, two, or three targets."
  const divided = /^(~|[Ii]t) deals (\S+) damage divided as you choose among (any number of|one or two|one, two, or three|up to (\w+)) (targets|target .+)$/.exec(c);
  if (divided) {
    return attempt(b, (b) => {
      if (divided[1] !== '~' && b.it?.ref !== 'self') return null;
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
  const m = /^(~|[Ii]t) deals (\S+) damage to (.+)$/.exec(c);
  if (!m) return null;
  return attempt(b, (b) => {
    if (m[1] !== '~' && b.it?.ref !== 'self' && !(b.itIsSource && b.it?.ref === 'trigger_object')) return null;
    const amount = parseAmount(m[2]!);
    if (amount === null) return null;
    const out: EffectNode[] = [];
    const second = /^(.+?) and (\S+) damage to (.+)$/.exec(m[3]!);
    const first = parseRecipients(second ? second[1]! : m[3]!, b);
    if (!first) return null;
    for (const to of first) out.push({ type: 'deal_damage', amount, to });
    // "If a creature dealt damage this way would die this turn, …"
    if (first.length === 1) b.damaged = first[0]!;
    if (second) {
      const amount2 = parseAmount(second[2]!);
      const rest = amount2 !== null ? parseRecipients(second[3]!, b) : null;
      if (!rest || amount2 === null) return null;
      for (const to of rest) out.push({ type: 'deal_damage', amount: amount2, to });
    }
    return out;
  });
}

/** "Target creature gets +2/+2 and gains trample until end of turn." (CR 611.2a: lasts as stated.) */
function parsePump(c: string, b: Binder): EffectNode[] | null {
  // Without a duration it lasts indefinitely (CR 611.2a): "It gains haste." (unearth).
  const m = /^(.+?) (?:gets?|gains?|has|have) (.+) until end of turn$/.exec(c) ?? /^(.+?) (?:gains?) ((?!control\b).+)$/.exec(c);
  if (!m) return null;
  const until = / until end of turn$/.test(c) ? 'eot' : 'game';
  return attempt(b, (b) => {
    // "Two target creatures each get +1/+1": "each" goes with a plural subject.
    const each = / each$/.test(m[1]!);
    const what = parseObjectRef(m[1]!.replace(/ each$/, ''), b);
    if (!what || (each && !what.plural)) return null;
    const verb = /^(.+?) (gets?|gains?|has|have) /.exec(c)![2]!;
    const parts = `${verb} ${m[2]}`.split(/ and (?=gets? |gains? |has |have )/);
    const node: EffectNode = { type: 'modify', what: what.ref, until };
    for (const part of parts) {
      const pm = /^(gets?|gains?|has|have) (.+)$/.exec(part);
      if (!pm) return null;
      if (/^get/.test(pm[1]!)) {
        // "that creature gets an additional +2/+2" — another pump on top of the first.
        const pt = parsePT(pm[2]!.replace(/^an additional /, ''));
        if (!pt || node.power !== undefined) return null;
        node.power = pt.power;
        node.toughness = pt.toughness;
      } else {
        const kws = parseKeywordList(pm[2]!, b);
        if (!kws || node.keywords) return null;
        node.keywords = kws;
      }
    }
    return [node];
  });
}

const RESTRICTIONS: Record<string, RuleFlag[]> = {
  "can't block": ['cant_block'],
  "can't attack": ['cant_attack'],
  "can't attack or block": ['cant_attack', 'cant_block'],
  "can't be blocked": ['cant_be_blocked'],
};

/** "Target creature can't block this turn." */
function parseRestriction(c: string, b: Binder): EffectNode[] | null {
  // "Target creature must be blocked this turn if able." / "~ can't be blocked by more than one creature this turn."
  const combat = /^(.+?) (must be blocked this turn if able|can't be blocked .+? this turn|can block only .+? this turn)$/.exec(c);
  if (combat) {
    const r = attempt(b, (b) => {
      const rule = parseCombatRule(combat[2]!.replace(' this turn', ''), b);
      const what = rule && parseObjectRef(combat[1]!, b);
      return what && rule ? [{ type: 'modify', what: what.ref, combat: rule, until: 'eot' }] : null;
    });
    if (r) return r;
  }
  // CR 509.1c: "Target creature blocks this turn if able", "Target creature attacks or blocks this turn if able",
  // "Target creature blocks ~ this turn if able", "you may have target creature block it this turn if able".
  const anyBlock = /^(?:[Hh]ave )?(.+?) (blocks?|attacks? or blocks?|attack or block) (?:this turn|this combat|each combat this turn) if able$/.exec(c);
  if (anyBlock) {
    const r = attempt(b, (b) => {
      const what = parseObjectRef(anyBlock[1]!, b);
      const rules = /attack/.test(anyBlock[2]!) ? ['attacks_each_combat', 'blocks_each_combat'] : ['blocks_each_combat'];
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
  const lure = /^All creatures able to block (.+?) this turn do so$/.exec(c);
  if (lure) {
    const what = parseObjectRef(lure[1]!, b);
    return what ? [{ type: 'modify', what: what.ref, combat: { mustBeBlocked: 'all' }, until: 'eot' }] : null;
  }
  const m = /^(.+?) (can't (?:attack or block|attack|block|be blocked)) this turn$/.exec(c);
  if (!m) return null;
  return attempt(b, (b) => {
    const what = parseObjectRef(m[1]!, b);
    return what ? [{ type: 'modify', what: what.ref, rules: RESTRICTIONS[m[2]!]!, until: 'eot' }] : null;
  });
}

/** CR 106.6: "to cast creature spells", "to cast artifact spells or activate abilities of artifacts", "to activate abilities". */
export function parseManaSpend(text: string, b: Binder): ManaSpend | null {
  if (text === 'to activate abilities') return { abilities: {} };
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
