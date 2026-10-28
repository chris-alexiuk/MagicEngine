import type { AddManaEffect, AmountExpr, EffectNode, FaceDef, ManaSpend, ObjectFilter, Ref, RuleFlag, TargetSpec } from '@mtg/schema';
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
  // Eldritch Evolution: "Search your library for … X or less, where X is …. Put that card onto the battlefield, then
  // shuffle." — the same as one sentence.
  text = text.replace(/(Search your library for [^.]+?)(, where X is [^.]+)?\. Put (?:that card|it) (onto the battlefield(?: tapped)?|into your hand), then shuffle\./, '$1, put it $3, then shuffle$2.');
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
    const out: EffectNode[] = [];
    // The plain effects of the last sentence, for a following "… instead".
    let previous: EffectNode[] = [];
    for (let i = 0; i < sentences.length; i++) {
      let s = sentences[i]!;
      // Temur Battle Rage: "… Ferocious — That creature also gains trample …" — an ability word in mid-text has no rules
      // meaning (CR 207.2c); "also" only says it's in addition.
      if (i > 0) s = s.replace(/^(?!Choose\b)[A-Z][A-Za-z']+(?: [A-Za-z']+){0,2} — (?=[A-Z])/, '');
      s = s.replace(/^((?:That|Those) (?:creature|creatures|permanent|player)|It|They) also (?=[a-z])/, '$1 ');
      // Dawn's Truce: "If the gift was promised, permanents you control also gain indestructible until end of turn."
      s = s.replace(/^(If [^,]+, [^,]*?) also (?=(?:gains?|gets?|deals?|has|have|loses?|draws?|creates?|puts?) )/, '$1 ');
      // Entish Restoration: "If you control a creature with power 4 or greater, instead search …" — the same as "… instead".
      s = s.replace(/^(If [^,]+), instead (.+)$/, '$1, $2 instead');
      if (i > 0 && !/ instead$/.test(s) && !/ instead if /.test(s)) previous = [];
      // "Then each player draws a card." — "then" only orders what's already in order.
      if (i > 0 && /^Then (?!shuffle)/.test(s)) s = capitalise(s.slice(5));
      // Hunter's Insight: "Choose target creature you control. Whenever that creature deals combat damage to a player or
      // planeswalker this turn, draw that many cards."; Massacre Girl: "Whenever a creature dies this turn, …" — a triggered
      // ability for the rest of the turn (CR 603.7).
      const turnTrig = b.env.parseAbilities ? /^(Until end of turn, )?[Ww]henever (.+?)( this turn)?, (.+)$/.exec(s) : null;
      if (turnTrig && (turnTrig[1] || turnTrig[3]) && !/\bthis turn\b/.test(turnTrig[2]!)) {
        // Dalkovan Encampment: "… create two … tokens that are tapped and attacking. Sacrifice them at the beginning of the
        // next end step." — what follows may belong to the ability; only a last sentence is read this way.
        if (i !== sentences.length - 1) return null;
        let cond = turnTrig[2]!;
        let effect = turnTrig[4]!;
        if (b.it?.ref === 'target') {
          cond = cond.replace(/^(?:that creature|that permanent|it)(?= )/, `TARGETREF${b.it.index}`);
          // Jaya, Fiery Negotiator: "Whenever you attack this turn, Jaya deals damage … to that creature." — the target.
          if (!cond.includes('TARGETREF')) effect = effect.replace(/\b(?:that creature|that permanent)\b/g, `TARGETREF${b.it.index}`);
        }
        const r = b.env.parseAbilities!(`Whenever ${cond}, ${effect}.`, b.env.cardName, b.env.typeLine);
        const ability = r.abilities[0];
        if (r.unparsed.length || r.manualKeywords.length || r.abilities.length !== 1 || ability?.kind !== 'triggered' || ability.trigger.type === 'tapped_for_mana') return null;
        if ((cond.includes('TARGETREF') || effect.includes('TARGETREF')) && ability.targets?.length) return null;
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
      // Plaguecrafter: "Each player sacrifices a creature or planeswalker of their choice. Each player who can't discards a card."
      const whoCant = /^Each (?:player|opponent) who can't (.+)$/.exec(s);
      const lastNode = out[out.length - 1];
      if (whoCant && lastNode?.type === 'sacrifice_choice' && (lastNode.who as { ref?: string } | undefined)?.ref === 'players') {
        const then = parseSentence(`You ${whoCant[1]!.replace(/^(\w+?)s\b/, '$1')}`, b);
        if (!then) return null;
        lastNode.cant = then;
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
      if (ifDone && /^Sacrifice /.test(s)) {
        const first = parseSentence(s, b);
        const then = first ? parseSentence(capitalise(ifDone[1]!), b) : null;
        if (!first || !then) return null;
        out.push({ type: 'may_do', effects: first, then, mandatory: true });
        i++;
        continue;
      }
      // CR 603.12: "[Do something]. When you do, [effect]." — the rest of the text is a reflexive triggered ability
      // with its own targets, which triggers only if the action was taken.
      const whenYouDo = sentences[i + 1] ? /^When you do, (.+)$/.exec(sentences[i + 1]!) : null;
      if (whenYouDo) {
        const pay = /^You may pay ((?:\{(?:\d+|X|[WUBRGC]|[WUBRG2]\/[WUBRG])\})+|(?:\{E\})+)$/.exec(s);
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
        const capX = pay && pay[1]!.includes('{X}') ? xCap(rest, b) : null;
        if (capX === undefined) return null;
        const restText = `${rest.join('. ')}.`;
        const inner = parseEffectText(capitalise(restText), rb);
        // "the exiled card" after "you may exile it" isn't something this ability can find; nor can its targets use counts
        // (Sandbender Scavengers: "with mana value less than or equal to this creature's power").
        if (!inner || rb.unsupported || (!pay && JSON.stringify(inner).includes('"exiled_with"'))) return null;
        const ability = { kind: 'triggered', text: `When you do, ${restText}`, trigger: { type: 'reflexive' }, effects: inner, ...(rb.targets.length ? { targets: rb.targets } : {}) };
        const reflexive: EffectNode = { type: 'reflexive', abilities: [ability] };
        if (pay) out.push({ type: 'may_pay', cost: pay[1]!, effects: [reflexive], ...(capX ? { maxX: capX } : {}) });
        else out.push({ type: 'may_do', effects: first, then: [reflexive], ...(may ? {} : { mandatory: true }) });
        break;
      }
      // "…, reveal it, and put it into your hand. Then shuffle your library." (CR 702.29e wording).
      if (/^Search /.test(s) && /^Then shuffle(?: your library)?$/.test(sentences[i + 1] ?? '')) {
        s = `${s.replace(/, reveal that card, and put it /, ', reveal it, put it ').replace(/, and put /, ', put ')}, then shuffle`;
        i++;
      }
      // CR 118.12: "You may pay {2}. If you do, …" — an optional cost paid on resolution.
      // Mana the engine can pay as a resolution-time cost (no {X}, snow or Phyrexian symbols), or energy (CR 107.14).
      // CR 119.4: "You may pay 3 life", Ripples of Undeath: "you may pay {1} and 3 life" — life only if you have that much.
      // "You may pay {X}. If you do, draw X cards." — X chosen as it's paid; ", where X is less than or equal to …" bounds
      // it, ", where X is …" fixes it (Primordial Ooze).
      const payParts = /^(?:Then )?[Yy]ou may pay (?:((?:\{(?:\d+|X|[WUBRGC]|[WUBRG2]\/[WUBRG])\})+|(?:\{E\})+)(?: and (\d+) life)?|(\d+) life)(?:, where X is (less than or equal to )?(.+))?$/.exec(s);
      const pay = payParts ? ([payParts[0], payParts[1] ?? ''] as const) : null;
      const payLife = payParts ? Number(payParts[2] ?? payParts[3] ?? 0) : 0;
      const hasX = Boolean(pay?.[1].includes('{X}'));
      const whereX = payParts?.[5] ? parseCount(payParts[5], b) : null;
      if (payParts && (hasX ? payParts[5] && !whereX : payParts[5])) return null;
      const fixX = whereX && !payParts![4] ? { xIs: whereX } : {};
      const then = sentences[i + 1] ? /^If you do, (.+)$/.exec(sentences[i + 1]!) : null;
      if (pay && then) {
        const inner = parseSentence(capitalise(then[1]!), b);
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
        out.push({ type: 'may_pay', cost: pay[1]!, ...(payLife ? { life: payLife } : {}), ...fixX, ...maxX, effects: inner, ...(no ? { else: no } : {}) });
        i += (otherwise ? 2 : 1) + (cap ? 1 : 0);
        continue;
      }
      // Dance of the Dead: "that player may pay {1}{B}. If the player does, untap that creature." — another player pays.
      const otherPay = /^(That player|Its controller|They) may pay ((?:\{(?:\d+|[WUBRGC]|[WUBRG2]\/[WUBRG])\})+)$/.exec(s);
      const otherDo = otherPay && sentences[i + 1] ? /^If (?:the player|that player|they) (?:does|do), (.+)$/.exec(sentences[i + 1]!) : null;
      if (otherPay && otherDo) {
        const payer = singlePlayer(otherPay[1]!.toLowerCase(), b);
        const inner = payer ? parseSentence(capitalise(otherDo[1]!), b) : null;
        if (!payer || !inner) return null;
        out.push({ type: 'may_pay', cost: otherPay[2]!, payer, effects: inner });
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
        const first = who ? attempt(b, (b) => parseClause(theyMay[2]!, b, who)) : null;
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
      const look = /^([Ll]ook at|[Rr]eveal) the top (\w+) cards of your library(?:, where X is (.+))?$/.exec(s);
      if (look && sentences[i + 1]) {
        const dig = parseDig(look[2]!, sentences[i + 1]!, sentences[i + 2], b);
        if (!dig || !bindDig(dig, look[3])) return null;
        // Revealed: everyone sees the cards (CR 701.20a).
        if (/^[Rr]eveal/.test(look[1]!)) dig.node.reveal = true;
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
      const ifIts = topCard && sentences[i + 1] ? /^If it's (?:a|an) (.+?) card(?: of the chosen type)?, (you may )?(?:reveal it and )?put it (onto the battlefield( tapped)?|into your hand|into your graveyard)$/.exec(sentences[i + 1]!) : null;
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
        const to = ifIts[3]!.startsWith('onto') ? 'battlefield' : ifIts[3] === 'into your hand' ? 'hand' : 'graveyard';
        const rest = otherwise ? (otherwise[1] === 'into your hand' ? 'hand' : otherwise[1] === 'into your graveyard' ? 'graveyard' : 'bottom') : 'top';
        const ifNone: EffectNode[] | null = otherwiseDraw ? [{ type: 'draw', amount: 1, who: { ref: 'you' } }] : otherwiseMay ? [{ type: 'dig', amount: 1, take: 1, to: 'graveyard', rest: 'top', optional: true }] : null;
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
      // "If it's a Spirit, …" after the object was destroyed, exiled or bounced would ask about a card that has left: not
      // read here.
      const MOVES = new Set(['destroy', 'exile', 'move', 'sacrifice', 'bounce', 'return', 'flicker', 'put_into_library', 'shuffle_into_library']);
      // Essence Flux: "Exile target creature you control, then return that card to the battlefield …. If it's a Spirit, …" —
      // back on the battlefield, it's the permanent it became (followed by the resolution, CR 400.7).
      const lastMove = [...out].reverse().find((e) => MOVES.has(e.type));
      const backOnField = lastMove?.type === 'move' && lastMove.to === 'battlefield' && JSON.stringify(lastMove.what) === JSON.stringify(b.it);
      if (/^If (?:it|that creature|that permanent)(?:'s| is) an? /.test(s) && !backOnField && JSON.stringify(out).match(/"type":"(\w+)"/g)?.some((m) => MOVES.has(m.slice(8, -1)))) return null;
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
        const moreTokens = /^create (\w+) of those tokens$/.exec(instead);
        const tokenCount = moreTokens ? parseAmount(moreTokens[1]!) : null;
        if (!yes && tokenCount !== null && previous.length === 1 && previous[0]!.type === 'create_token') yes = [{ ...structuredClone(previous[0]!), amount: tokenCount }];
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
      // Ragavan: "create a Treasure token and exile the top card of that player's library. Until end of turn, you may
      // cast that card." — from another player's library too; the permission is yours.
      // Urza, Lord High Artificer: "Shuffle your library, then exile the top card." — of your library.
      const topAny = /^(?:(.+?)(?: and|, then) )?[Ee]xile the top (card|(\w+) cards)(?: of (your|that player's|target opponent's|target player's|defending player's|each opponent's) library)?$/.exec(s);
      if (topAny && !topAny[4]) topAny[4] = 'your';
      const top = topAny ? [topAny[0], topAny[2], topAny[3]] as const : null;
      let topWho: Ref | null = topAny && topAny[4] !== 'your' ? null : { ref: 'you' };
      let topFirst: EffectNode[] = [];
      if (topAny && (topAny[1] || topAny[4] !== 'your') && /you may (?:play|cast) /i.test(sentences[i + 1] ?? '')) {
        const r = attempt(b, (b) => {
          const first = topAny[1] ? parseSentence(capitalise(topAny[1]), b) : [];
          const who = topAny[4] === 'your' ? { ref: 'you' as const } : topAny[4] === "each opponent's" ? { ref: 'players' as const, who: 'opponents' as const } : parsePlayerRef(topAny[4]!.replace(/'s$/, ''), b);
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
        out.push(...topFirst, { type: 'exile_top', amount, who: topWho, play: { mode: duringNext[1], until: 'during_next_turn' } });
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
        /^Until (end of turn|the end of your next turn), you may (cast) spells from among (?:them|those cards)$/.exec(next) ??
        /^Until (end of turn|the end of your next turn), you may (play) lands and cast spells from among (?:them|those cards)$/.exec(next);
      const thisTurn = /^You may (play|cast) (?:that card|those cards|them|it) (this turn|until the end of your next turn|until end of turn)$/.exec(next.replace(freeSuffix, ''));
      if (top && (untilPlay || thisTurn)) {
        const amount = top[2] ? parseAmount(top[2]) : 1;
        if (amount === null) return null;
        const until = untilPlay ? (untilPlay[1] !== 'end of turn' ? 'next_turn' : 'eot') : thisTurn![2] === 'until the end of your next turn' ? 'next_turn' : 'eot';
        const mode = (untilPlay ? untilPlay[2] : thisTurn![1]) as 'play' | 'cast';
        if (!topWho) return null;
        out.push(...topFirst, { type: 'exile_top', amount, who: topWho, play: { mode, until, ...(free ? { free: true } : {}) } });
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
      // Ram Through: "If the creature you control has trample, excess damage is dealt to that creature's controller
      // instead." — the damage just dealt (CR 120.4a).
      if (/^If the creature you control has trample, excess damage is dealt to that creature's controller instead$/.test(s)) {
        const last = out[out.length - 1];
        if (out.length !== 1 || last?.type !== 'deal_damage' || !last.from) return null;
        last.excessToController = true;
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
      const delayed =
        /^(.+) at the beginning of the next (end step|turn's upkeep)$/.exec(s) ??
        /^At the beginning of the next (end step|turn's upkeep), (.+)$/.exec(s) ??
        /^(.+) at (end of combat)$/.exec(s) ??
        /^At (end of combat), (.+)$/.exec(s);
      if (delayed) {
        const [what, when] = delayed[0].startsWith('At ') ? [delayed[2]!, delayed[1]!] : [delayed[1]!, delayed[2]!];
        const inner = parseSentence(capitalise(what), b);
        if (!inner) return null;
        // Fickle Efreet: "flip a coin at end of combat. If you lose the flip, …" — the flip's outcome waits for it too.
        while (inner.some((n) => n.type === 'flip_coin') && /^If you (?:win|lose) the flip, /.test(sentences[i + 1] ?? '')) {
          const then = parseEffectText(`${sentences[i + 1]!}.`, b);
          if (!then) return null;
          inner.push(...then);
          i++;
        }
        // CR 511.2: "at end of combat" — as the end of combat step begins.
        out.push({ type: 'delayed', step: when === 'end step' ? 'end' : when === 'end of combat' ? 'end_of_combat' : 'upkeep', effects: inner });
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
      if (/^(?:It|They|(?:A|The) (?:creature|permanent) destroyed this way|(?:Creatures|Permanents) destroyed this way) can't be regenerated$/.test(s)) {
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
    }
    return out.length ? out : null;
  });
}

/** "half X", "half their life", "half their library", "half the cards in their hand" — halved, rounded `dir`. */
function parseHalved(text: string, dir: 'up' | 'down', b: Binder): EffectNode[] | null {
  const kinds: string[] = [];
  const t = text
    .replace(/\bhalf X\b/g, () => (kinds.push('x'), 'X'))
    .replace(/\b(loses?) half (?:their|his or her|your) life\b/, (_m, v: string) => (kinds.push('life'), `${v} X life`))
    .replace(/\b(mills?) half (?:their|your) library\b/, (_m, v: string) => (kinds.push('library'), `${v} X cards`))
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
        // The player who loses, mills or discards: one player, counted as they do (CR 608.2h).
        if (!one(e.who)) return out;
        out.amount = kinds[0] === 'life' ? { kind: 'life', who: e.who, half: dir } : { kind: 'cards', zone: kinds[0] === 'library' ? 'library' : 'hand', who: 'you', player: e.who, half: dir };
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

/** The sentences after "Look at the top N cards of your library." (CR 701.16 isn't a keyword action: just looking). */
function parseDig(count: string, next: string, after: string | undefined, b: Binder): { node: EffectNode; used: number } | null {
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
    const pf = parseFilter(`${putFrom[2]} in your library`, b);
    if (!rest || typeof n !== 'number' || !pf || pf.plural !== n > 1) return null;
    const { zone: _z, owner: _o, ...filter } = pf.filter;
    const to = putFrom[3]!.startsWith('into your hand') ? 'hand' : putFrom[3]!.startsWith('onto') ? 'battlefield' : 'graveyard';
    // "up to N": any number of them; "a land card": one if there is one.
    return {
      node: { type: 'dig', amount, take: n, to, filter, ...(putFrom[1]!.startsWith('up to ') || putFrom[1] === 'any number of' ? { optional: true } : {}), ...rest, ...(putFrom[4] ? { tapped: true } : {}) },
      used: putFrom[5] || shuffled ? 1 : 2,
    };
  }
  // "You may reveal a creature card from among them and put it into your hand." + "Put the rest …"
  // Calix: "… and put that card into your hand"; Karumonix: "You may reveal any number of Rat cards from among them and put
  // the revealed cards into your hand."
  const reveal = /^You may (reveal|put) (a|an|up to \w+|any number of) (.+?) from among (?:them|those cards)(?: and put (?:it|them|that card|the revealed cards))? (into your hand|onto the battlefield( tapped)?|into your graveyard)$/.exec(next);
  if (reveal) {
    if (shuffled) return null;
    const rest = restOf(after);
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
              const who = inner?.length === 1 ? (inner[0] as { who?: Ref }).who : undefined;
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
        const expr = parseCount(what, b);
        const inner = expr && parseInner(text, b);
        // "each opponent loses life equal to … that player's …": each of them (below).
        if (inner?.length === 1 && (inner[0] as { who?: Ref }).who?.ref === 'players' && /\b(?:that player|they|their)\b/.test(what)) return null;
        return inner && expr ? bindX(inner, expr) : null;
      });
      if (r) return r;
      // "~ deals damage to target player equal to the number of cards in that player's hand": the count names a
      // player the instruction targets.
      // Peer into the Abyss: "Target player draws cards equal to … cards in their library" — that player's.
      const later = /\bthat (?:player|opponent)\b|\btheir (?:hand|graveyard|library)\b|\bthey (?:control|lost|gained)\b/.test(what)
        ? attempt(b, (b) => {
            const inner = parseInner(text, b);
            // "Each opponent loses life equal to the life that player lost this turn": "that player" is each of them.
            const who = inner?.length === 1 ? (inner[0] as { who?: Ref }).who : undefined;
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
  // Wan Shi Tong: "draw half X cards, rounded down"; Quietus Spike: "that player loses half their life, rounded up";
  // Traumatize: "Target player mills half their library, rounded down."
  const halved = /^(.+), rounded (up|down)$/.exec(s);
  if (halved && /\bhalf\b/.test(halved[1]!)) {
    const r = attempt(b, (b) => parseHalved(halved[1]!, halved[2] as 'up' | 'down', b));
    if (r) return r;
  }
  // Six: "Mill three cards. You may put a land card from among them into your hand." Gyruda: "Put a creature card with
  // an even mana value from among the milled cards onto the battlefield under your control." — the cards milled this way.
  const fromMilled = /^(You may )?(?:[Tt]hen )?[Pp]ut (a|an|up to (?:one|two|three)|any number of) (.+?) from among (them|those cards|the milled cards) (into your hand|onto the battlefield( tapped)?( under your control)?)$/.exec(s);
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
    const optional = Boolean(fromMilled[1]) || n > 1;
    return [{ type: 'put_from_milled', filter, amount: n, to, ...(optional ? { optional: true } : {}), ...(fromMilled[6] ? { tapped: true } : {}) }];
  }
  // Sea Gate Restoration: "You have no maximum hand size for the rest of the game."
  if (/^You have no maximum hand size for the rest of the game$/.test(s)) return [{ type: 'player_effect', who: { ref: 'you' }, rule: 'no_max_hand_size', until: 'game' }];
  // Emergence Zone: "You may cast spells this turn as though they had flash." (CR 702.8a)
  if (/^You may cast spells this turn as though they had flash$/.test(s)) return [{ type: 'player_effect', who: { ref: 'you' }, rule: 'flash' }];
  // Teferi, Time Raveler: "Until your next turn, you may cast sorcery spells as though they had flash." (CR 702.8a)
  const flashUntil = /^Until your next turn, you may cast (sorcery|creature|instant and sorcery|noncreature) spells as though they had flash$/.exec(s);
  if (flashUntil) {
    const pf = parseFilter(`${flashUntil[1]!.replace(' and ', ' or ')} spells`, b);
    if (!pf) return null;
    const { zone: _z, ...filter } = pf.filter;
    return [{ type: 'player_effect', who: { ref: 'you' }, rule: 'flash', until: 'your_next_turn', filter }];
  }
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
      // "… as this ability resolves": effects count as they resolve anyway (CR 608.2h).
      const what = where[2]!.replace(/ as this (?:ability|spell) resolves$/, '');
      // Rush of Blood: "Target creature gets +X/+0 until end of turn, where X is its power." — "its" is what the
      // instruction is about, so that's read first.
      if (perEach(what, where[1]!, b)) return null;
      if (pointsBack(what, where[1]!)) {
        const inner = parseSentence(where[1]!, b);
        const expr = inner && parseCount(what, b);
        return inner && expr ? bindX(inner, expr) : null;
      }
      const expr = parseCount(what, b);
      const inner = expr && parseSentence(where[1]!, b);
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
    return attempt(b, (b) => {
      const before = b.clone();
      const inner = parseSentence(unlessLife[1]!, b);
      const payer = inner ? payerOf(unlessLife[2]!, before, b) : null;
      return inner && payer ? [{ type: 'unless_pays', payer, cost: unlessLife[3] ?? '', life: Number(unlessLife[4]), effects: inner }] : null;
    });
  }
  // "… unless that player discards a card" / "sacrifices a creature"; Tergrid's Lantern: "… unless they sacrifice a
  // nonland permanent of their choice or discard a card" (either); "Each opponent loses 3 life unless that player …"
  // (each of them on their own).
  // Coral Atoll: "sacrifice it unless you return an untapped Island you control to its owner's hand"
  const unlessDoes = /^(.+) unless (that player|they|he or she|its controller|that creature's controller|.+?) (discards?|sacrifices?|returns?) (.+)$/.exec(s);
  if (unlessDoes) {
    const r = attempt(b, (b) => {
      const third = (v: string) => (v.endsWith('s') ? v : `${v}s`);
      const strip = (o: string) => o.replace(/ of their choice$/, '');
      const alt = /^(.+?) or (discards?|sacrifices?|returns?) (.+)$/.exec(unlessDoes[4]!);
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
      const actions = parts.map(([v, o]) =>
        /^returns?$/.test(v) ? (payer.ref === 'you' ? attempt(b, (b) => { const e = parseSentence(`Return ${strip(o)}`, b); return e?.length === 1 && e[0]!.type === 'move_chosen' ? { effects: e } : null; }) : null) : attempt(b, (b) => parseClause(`${third(v)} ${strip(o)}`, b, payer)),
      );
      if (actions.some((a) => !a)) return null;
      return actions.length === 1 ? [{ type: 'unless_does', payer, action: actions[0]!.effects, effects: inner }] : [{ type: 'unless_does', payer, actions: actions.map((a) => a!.effects), effects: inner }];
    });
    if (r) return r;
  }
  // CR 118.12a: "[Do something] unless [a player] pays [cost]."
  const unless = /^(.+) unless (.+?) (?:pays|pay) ((?:\{(?:\d+|X|[WUBRGC]|[WUBRG2]\/[WUBRG])\})+)$/.exec(s);
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
      const inner = cond ? parseSentence(unlessCond[1]!, b) : null;
      return cond && inner ? [{ type: 'if', cond, effects: [], else: inner }] : null;
    });
    if (r) return r;
  }
  // CR 608.2g: "You may cast it without paying its mana cost" — cast during resolution, timing ignored.
  // CR 305.2: "You may play an additional land this turn."
  const extraLand = /^(You|Each player) may play (an|two) additional lands? this turn$/.exec(s);
  if (extraLand) return [{ type: 'extra_land', who: { ref: extraLand[1] === 'You' ? 'you' : 'players' }, ...(extraLand[2] === 'two' ? { amount: 2 } : {}) }];
  // Rishkar's Expertise: "You may cast a spell with mana value 5 or less from your hand without paying its mana cost."
  const fromHand = /^[Yy]ou may cast (?:a|an) (.+? )?spell( with mana value (?:\d+|X) or less)? from your hand without paying its mana cost$/.exec(s);
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
  const castAmong = /^[Yy]ou may cast any number of spells from among (?:those cards|them|the exiled cards) without paying their mana costs$/.exec(s);
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
      // "enters with an additional counter" applies only as a permanent enters as a copy.
      if ((becomeCopy[4] && !except) || except?.entersWith) return null;
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
  // "Discard all the cards in your hand, then draw that many cards", "discard up to two cards, then draw that many cards",
  // Flux: "Each player discards any number of cards, then draws that many cards." (CR 701.9, 121.1)
  // Valakut Awakening: "Put any number of cards from your hand on the bottom of your library, then draw that many cards plus one."
  const bottom = /^Put any number of cards from your hand on the bottom of your library, then draw that many cards( plus one)?$/.exec(s);
  if (bottom) return [{ type: 'wheel', who: { ref: 'you' }, mode: 'any', to: 'bottom', ...(bottom[1] ? { delta: 1 } : {}) }];
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
  const noCounter = /^(?:(.+?) )?[Ss]pells you control can't be countered this turn$/.exec(s);
  if (noCounter) {
    const pf = noCounter[1] ? parseFilter(`${noCounter[1].toLowerCase()} spell`, b) : null;
    if (noCounter[1] && (!pf || pf.plural)) return null;
    const filter = pf ? (({ zone: _z, ...f }) => f)(pf.filter) : null;
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
  const keep = /^(.+?) chooses (?:from among the permanents they control )?(.+?)(?: from among the (nonland )?permanents they control)?,? (?:then|and) sacrifices the rest$/.exec(s);
  if (keep) {
    const r = attempt(b, (b) => {
      const who = parsePlayerRef(keep[1]!, b);
      if (!who) return null;
      const pool: ObjectFilter = keep[3] ? { notTypes: ['Land'] } : {};
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
      return [{ type: 'keep_choose', who, pool: pf.filter, count: n, ...(counted[1] ? { upTo: true } : {}) } as EffectNode];
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
  // Rakdos Charm: "Each creature deals 1 damage to its controller."; Wave of Reckoning: "Each creature deals damage to
  // itself equal to its power."; Lukka: "Each creature you control deals damage equal to its power to each opponent."
  // Each of them is the source of its own damage (CR 120.3), all dealt at once.
  const eachN = /^(each .+?) deals (\S+) damage to (.+)$/i.exec(s);
  const each = bite && /^each /i.test(bite[1]!) ? { subject: bite[1]!, amount: null, to: bite[2]! } : eachN ? { subject: eachN[1]!, amount: eachN[2]!, to: eachN[3]! } : null;
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
  // CR 615.12: "Damage can't be prevented this turn."
  if (/^Damage can't be prevented this turn$/.test(s)) return [{ type: 'damage_unpreventable' }];
  // CR 101.2: "Target player can't cast spells this turn", "Until your next turn, your opponents can't cast …"
  const cantCast = /^(?:(Until your next turn|Until end of turn|This turn), )?(.+?) can't cast (.+?)(?: (this turn|until your next turn))?$/.exec(s);
  if (cantCast && (cantCast[1] ? !cantCast[4] : cantCast[4])) {
    const r = attempt(b, (b) => {
      const who = /^players$/i.test(cantCast[2]!) ? ({ ref: 'players', who: 'each' } as Ref) : parsePlayerRef(cantCast[2]!, b);
      const ban = who ? parseCastBan(cantCast[3]!, b) : null;
      if (!who || !ban || ban.during || ban.fromZones || ban.maxPerTurn) return null;
      const until = /next turn/i.test(cantCast[1] ?? cantCast[4]!) ? 'your_next_turn' : 'eot';
      return [{ type: 'prohibit_casting', who, until, ...(ban.filter ? { filter: ban.filter } : {}) }];
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
  const youAnd = /^You and (target opponent|target player|that player|defending player) each (.+)$/.exec(s);
  if (youAnd) {
    const r = attempt(b, (b) => {
      const other = parsePlayerRef(youAnd[1]!, b);
      const mine = other ? parseClause(youAnd[2]!, b, { ref: 'you' }) : null;
      const theirs = mine && other ? parseClause(youAnd[2]!, b, other) : null;
      return mine && theirs ? [...mine.effects, ...theirs.effects] : null;
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
  const eachCreate = /^For each (.+?), create (a|an|one|two) (.+? tokens?)$/.exec(s);
  if (eachCreate && !/ copy | that player| it\b|them\b|this way/.test(s)) {
    const r = attempt(b, (b) => parseSentence(`Create ${eachCreate[2]} ${eachCreate[3]} for each ${eachCreate[1]}`, b));
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
  const perPlayer = /^[Ff]or each (opponent|player), (.+)$/.exec(s);
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
  // "Choose target creature." — the target, for what follows ("that creature").
  const chooseTarget = /^[Cc]hoose (target .+|up to one target .+)$/.exec(s);
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
  const next = /^[Tt]he next (?:(.+?) )?spell you cast this turn (can't be countered|costs \{(\d+|X)\} less to cast(?:, where X is (.+?)(?: as this ability resolves)?)?)$/.exec(s);
  if (next) {
    let filter: ObjectFilter = {};
    if (next[1]) {
      const pf = parseFilter(`${next[1]} spells`, b);
      if (!pf || pf.filter.zone !== 'stack') return null;
      const { zone: _z, ...rest } = pf.filter;
      filter = rest;
    }
    if (next[2] === "can't be countered") return [{ type: 'next_spell', filter, uncounterable: true }];
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
  const discover = /^[Dd]iscover (\d+)$/.exec(s);
  if (discover) return [{ type: 'discover', n: Number(discover[1]) }];
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
    if (j[0] !== ', then ' || /^\w+s\b/.test(s.slice(j.index! + j[0].length).replace(/^amass\b/, 'amass_'))) continue;
    const r = attempt(b, (b) => {
      const l = parseSentence(s.slice(0, j.index), b);
      const rest = l ? parseSentence(capitalise(s.slice(j.index! + j[0].length)), b) : null;
      return l && rest ? [...l, ...rest] : null;
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
  gain(args, who, b, imperative) {
    // Layer 2 (CR 613.1b): "Gain control of target creature until end of turn."
    const control = /^control of (.+?)( until end of turn)?$/.exec(args);
    if (control) {
      if (!imperative) return null;
      const what = parseObjectRef(control[1]!, b);
      return what ? [{ type: 'gain_control', what: what.ref, ...(control[2] ? { until: 'eot' } : {}) }] : null;
    }
    // Heliod's Intervention: "Target player gains twice X life."
    if (args === 'twice X life') return [{ type: 'gain_life', amount: { kind: 'x', times: 2 }, who }];
    const m = /^(\S+) life$/.exec(args);
    const amount = m && parseAmount(m[1]!);
    return amount !== null && amount !== undefined ? [{ type: 'gain_life', amount, who }] : null;
  },
  lose(args, who) {
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
    // Hellhole Rats: "target player discards a card. ~ deals damage to that player equal to that card's mana value."
    if (amount === 1) b.other = { ref: 'discarded_this_way' };
    return amount !== null && amount !== undefined ? [{ type: 'discard', amount, who }] : null;
  },
  mill(args, who, b) {
    const m = /^(\S+) cards?$/.exec(args);
    const amount = m && parseAmount(m[1]!);
    if (amount === null || amount === undefined) return null;
    b.milled = true;
    return [{ type: 'mill', amount, who }];
  },
  // CR 701.68a: "blight 2", "target opponent blights 2"
  blight(args, who) {
    const amount = parseAmount(args);
    return typeof amount === 'number' ? [{ type: 'blight', amount, who }] : null;
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
      if (except === null || except?.entersWith) return null;
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
      for (const m of args.matchAll(/ and (?=(?:a|an|one|two|three) )/g)) {
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
      return null;
    }
    const node: EffectNode = { type: 'create_token', amount: token.amount, token: token.face, who };
    if (token.tapped) node.tapped = true;
    // CR 107.3: "an X/X … token" — its size is the X of the spell or ability, or the one the text defines.
    if (token.size) node.size = token.size;
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
    const greatest = /^(a|an) (.+?) with the greatest (mana value|power) among (.+?) (?:they|you) control$/.exec(args);
    if (greatest) {
      const pf = parseFilter(greatest[2]!, b);
      const among = pf ? parseFilter(greatest[4]!.replace(/ and /, ' or '), b) : null;
      if (!pf || pf.plural || !among || !among.plural || JSON.stringify(pf.filter) !== JSON.stringify(among.filter)) return null;
      if (pf.filter.types?.includes('Creature')) b.it = { ref: 'sacrificed_this_way' };
      return [{ type: 'sacrifice_choice', who, filter: pf.filter, amount: 1, greatest: greatest[3] === 'power' ? 'power' : 'mana_value' }];
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
    const choice = /^(a|an|one|two|three|four|five|six|seven|eight|nine|ten|thirteen|\d+|another) (.+?)(?: of (?:their|your) choice)?$/.exec(args);
    if (choice) {
      const pf = parseFilter(choice[2]!, b);
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
    const fromHand = /^(a|an|up to one|up to two|any number of) (.+?) from your hand onto the battlefield( tapped)?$/.exec(args);
    if (fromHand) {
      const n = fromHand[1] === 'up to two' ? 2 : fromHand[1] === 'any number of' ? 99 : 1;
      const pf = parseFilter(`${fromHand[2]} in your hand`, b);
      if (!pf || pf.plural !== n > 1) return null;
      const { zone: _z, owner: _o, ...filter } = pf.filter;
      // "That creature gains haste": the one put onto the battlefield.
      if (n === 1) b.it = { ref: 'created' };
      return [{ type: 'choose_from_hand', who: { ref: 'you' }, filter, amount: n, then: 'battlefield', ...(fromHand[3] ? { tapped: true } : {}), ...(/^(?:up to|any number)/.test(fromHand[1]!) ? { optional: true } : {}) }];
    }
    // "Put target creature card from a graveyard onto the battlefield under your control." — "return … to the battlefield".
    // The Darkness Crystal: "Put target creature card exiled with ~ onto the battlefield tapped under your control with two
    // additional +1/+1 counters on it."
    const onto = /^(.+?) onto the battlefield( tapped)?( transformed)?( under (?:your|its owner's|their owners'|their owner's) control)?(?: with (?:a|an|one|two|three) (?:additional )?\S+ counters? on it)?$/.exec(args);
    if (onto && ((!/ from your hand/.test(onto[1]!) && / from (?:a|your|an opponent's|target player's|all) graveyards?$|^target .+ card$|^target .+ card exiled with (?:~|this \w+)$/.test(onto[1]!)) || onto[1] === '~ from your hand' || (onto[1] === 'that card' && b.it?.ref === 'trigger_object'))) {
      const r = attempt(b, (b) => VERBS.return!(args.replace(' onto the battlefield', ' to the battlefield'), who, b, imperative));
      if (r) return r;
    }
    // Approach of the Second Sun: "put ~ into its owner's library seventh from the top" (CR 401.4).
    const nth = /^(.+?) into (?:its|their) owner's library (second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth) from the top$/.exec(args);
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
    const counters = /^(\S+) (\S+) counters? on (.+)$/.exec(args);
    if (counters) {
      const amount = parseAmount(counters[1]!);
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
      return [{ type: 'choose_from_hand', who: { ref: 'you' }, filter, amount: 1, then: 'exile' }];
    }
    // CR 610.3: "exile target creature until ~ leaves the battlefield" (Banishing Light).
    const until = / until ~ leaves the battlefield$/.exec(args);
    const what = parseObjectRef(until ? args.slice(0, until.index) : args, b);
    if (!what) {
      // "Exile target creature and target artifact."
      const list = until ? null : targetList(args, b);
      return list ? list.map((r) => ({ type: 'move', what: r, to: 'exile' })) : null;
    }
    return [{ type: 'move', what: what.ref, to: 'exile', ...(until ? { until: 'source_leaves' } : {}) }];
  },
  return(args, who, b, imperative) {
    // "Each player returns all creature cards from their graveyard to the battlefield": each returns their own,
    // so every such card in every graveyard (under its owner's control, to its owner's hand).
    if (!imperative) {
      const each = who.ref === 'players' && who.who === 'each' && !who.attacking ? /^((?:all|each) .+?) from their graveyards? to (the battlefield|their hands?)$/.exec(args) : null;
      const what = each ? parseObjectRef(`${each[1]} from all graveyards`, b) : null;
      return what && what.ref.ref === 'all' ? [{ type: 'move', what: what.ref, to: each![2] === 'the battlefield' ? 'battlefield' : 'hand' }] : null;
    }
    // Takenuma: "return a creature or planeswalker card from your graveyard to your hand" — chosen as it resolves (no
    // target). Blossoming Tortoise: "… to the battlefield tapped".
    const chosenReturn = /^(a|an|up to (?:one|two|three)) ((?!.*\btarget\b).+? cards?) from your graveyard to (your hand|the battlefield( tapped)?)$/.exec(args);
    if (chosenReturn && who.ref === 'you') {
      const n = chosenReturn[1]!.startsWith('up to ') ? parseAmount(chosenReturn[1]!.slice(6)) : 1;
      const pf = parseFilter(`${chosenReturn[2]} in your graveyard`, b);
      if (typeof n !== 'number' || !pf || pf.plural !== n > 1) return null;
      const { zone: _z, owner: _o, ...filter } = pf.filter;
      // "it" afterwards: the returned card.
      b.it = { ref: 'created' };
      return [{ type: 'return_chosen', filter, amount: n, to: chosenReturn[3] === 'your hand' ? 'hand' : 'battlefield', ...(chosenReturn[4] ? { tapped: true } : {}), ...(chosenReturn[1]!.startsWith('up to ') ? { optional: true } : {}) }];
    }
    const hand = /^(.+?) to (its owner's|their owners'|their owner's|your|its owners') hands?$/.exec(args);
    if (hand) {
      const what = parseObjectRef(hand[1]!, b);
      // "Return target permanent to its owner's hand. Then that player discards a card." — its owner.
      if (what && !what.plural && hand[2] === "its owner's" && !b.player) b.player = { ref: 'owner_of', of: what.ref };
      return what ? [{ type: 'move', what: what.ref, to: 'hand' }] : null;
    }
    // Ojer Taq: "return it to the battlefield tapped and transformed under its owner's control"
    const field = /^(.+?) to the battlefield( tapped)?(?: and)?( transformed)?( under (?:your|its owner's|their owners'|their owner's) control)?(?: with (a|an|one|two|three) (?:additional )?(\S+) counters? on it)?$/.exec(args);
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
    const split = /^your library for (up to two .+?), reveal (?:them|those cards), put one onto the battlefield( tapped)? and the other into your hand, then shuffle$/.exec(args);
    if (split) {
      const pf = parseFilter(`${split[1]!.replace(/^up to two /, '')} in your library`, b);
      if (!pf || !pf.plural) return null;
      return [{ type: 'search', filter: pf.filter, amount: 2, upTo: true, to: 'hand', split: { to: 'battlefield', ...(split[2] ? { tapped: true } : {}) } }];
    }
    // Gamble: "Search your library for a card, put that card into your hand, discard a card at random, then shuffle."
    const gamble = /^your library for a card, put that card into your hand, discard a card at random, then shuffle$/.test(args);
    if (gamble && who.ref === 'you' && !zones) {
      return [
        { type: 'search', filter: { zone: 'library', owner: 'you' }, amount: 1, to: 'hand' },
        { type: 'discard', amount: 1, who: { ref: 'you' }, random: true },
      ];
    }
    const m =
      /^your library for (.+?), (?:reveal (?:it|them|those cards|that card), )?put (?:it|them|that card|those cards) (into your hand|onto the battlefield( tapped)?|into your graveyard), then shuffle$/.exec(args) ??
      /^your library for (.+?), (?:reveal (?:it|that card), )?then shuffle and put (?:that card|it|the card) (on top)$/.exec(args);
    if (!m) return null;
    // Krosan Verge: "a Forest card and a Plains card" — one of each.
    const pair = /^(?:a|an) (.+? card) and (?:a|an) (.+? card)$/.exec(m[1]!);
    if (pair) {
      const fs = [pair[1]!, pair[2]!].map((t) => parseFilter(`${t} in your library`, b));
      if (fs.some((f) => !f || f.plural)) return null;
      const filters = fs.map((f) => (({ zone: _z, owner: _o, ...rest }) => rest)(f!.filter));
      const to = m[2]!.startsWith('into your hand') ? 'hand' : m[2]!.startsWith('onto') ? 'battlefield' : m[2] === 'on top' ? 'library' : 'graveyard';
      if (to === 'library') return null;
      const node: EffectNode = { type: 'search', filter: { zone: 'library', owner: 'you' }, filters, amount: 2, to };
      if (theirs) node.who = who;
      if (m[3]) node.tapped = true;
      return [node];
    }
    const q = /^(?:(a|an|one)|up to (\w+)|(\w+)) (.+)$/.exec(m[1]!);
    if (!q) return null;
    const amount = q[1] ? 1 : parseAmount(q[2] ?? q[3]!);
    if (typeof amount !== 'number') return null;
    // Myriad Landscape: "up to two basic land cards that share a land type"
    const share = / that share a land type$/.test(q[4]!);
    const pf = parseFilter(`${q[4]!.replace(/ that share a land type$/, '')} in your library`, b);
    if (!pf || pf.plural !== amount > 1 || (share && amount < 2)) return null;
    const to = m[2]!.startsWith('into your hand') ? 'hand' : m[2]!.startsWith('onto') ? 'battlefield' : m[2] === 'on top' ? 'library' : 'graveyard';
    const node: EffectNode = { type: 'search', filter: pf.filter, amount, to };
    if (zones) node.zones = zones;
    if (theirs) node.who = who;
    if (q[2]) node.upTo = true;
    if (m[3]) node.tapped = true;
    if (share) node.sameLandType = true;
    return [node];
  },
  // CR 701.62a: "manifest dread" — "that creature" is the manifested permanent afterward.
  manifest(args, who, b) {
    if (args !== 'dread' || who.ref !== 'you') return null;
    b.it = { ref: 'created' };
    return [{ type: 'manifest', amount: 1, dread: true }];
  },
  // CR 115.7a: "Change the target of target spell or ability with a single target." (Bolt Bend, Redirect Lightning)
  change(args, who, b, imperative) {
    const m = imperative ? /^the target of (target .+?) with a single target$/.exec(args) : null;
    if (!m) return null;
    const what = parseObjectRef(m[1]!, b);
    if (!what?.targeted || what.plural || what.ref.ref !== 'target') return null;
    const spec = b.targets[what.ref.index];
    if (!spec || (spec.what !== 'ability' && spec.filter?.zone !== 'stack')) return null;
    spec.singleTarget = true;
    return [{ type: 'retarget', what: what.ref, change: true }];
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
    const both = imperative ? /^(target (?:Aura|Equipment|Aura or Equipment) you control) to (target .+)$/.exec(args) : null;
    if (both) {
      const what = parseObjectRef(both[1]!, b);
      const to = what && !what.plural ? parseObjectRef(both[2]!, b) : null;
      return what && to && !to.plural ? [{ type: 'attach', what: what.ref, to: to.ref }] : null;
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

/** Replacement and prevention effects created by a resolving spell (CR 614, CR 615). */
function parseReplacement(c: string, b: Binder): EffectNode[] | null {
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
  // Obscuring Haze: "Prevent all damage that would be dealt this turn by creatures your opponents control."
  const all = /^Prevent all (combat )?damage that would be dealt (?:to|by) (.+?) this turn$/.exec(c) ?? /^Prevent all (combat )?damage that would be dealt this turn (?:to|by) (.+)$/.exec(c);
  if (all) {
    const to = parseRecipients(all[2]!, b);
    const by = /dealt (?:this turn )?by/.test(c);
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
  // CR 701.65a: "Airbend target nonland permanent", "airbend up to one other target creature or spell".
  const airbend = /^airbend (.+)$/i.exec(c);
  if (airbend) {
    const what = parseObjectRef(airbend[1]!, b);
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
  const explore = /^(.+?) explores$/i.exec(c);
  if (explore) {
    const what = parseObjectRef(explore[1]!, b);
    return what && !what.plural ? [{ type: 'explore', what: what.ref }] : null;
  }
  // CR 107.14 / CR 122.1: "you get {E}{E}", "you get an experience counter" — counters on a player.
  const energy = /^(.+?) gets? ((?:\{E\})+)$/i.exec(c);
  const experience = /^(.+?) gets? (an?|one|two|three|four|five|six|seven|eight|nine|ten) (experience|rad|poison) counters?$/i.exec(c);
  if (energy || experience) {
    const who = parsePlayerRef((energy ?? experience)![1]!, b);
    const amount = energy ? energy[2]!.length / 3 : parseAmount(experience![2]!);
    return who && typeof amount === 'number' ? [{ type: 'get_counters', who, counter: energy ? 'energy' : experience![3]!, amount }] : null;
  }
  // CR 701.34a
  if (/^proliferate$/i.test(c)) return [{ type: 'proliferate' }];
  // CR 701.10e: "double the number of +1/+1 counters on each creature you control", "… each kind of counter on target permanent"
  const dblCounters = /^double the number of (\+1\/\+1 counters|each kind of counter) on (.+)$/i.exec(c);
  if (dblCounters) {
    const what = parseObjectRef(dblCounters[2]!, b);
    return what ? [{ type: 'double_counters', what: what.ref, counter: /^each/.test(dblCounters[1]!) ? 'each' : '+1/+1' }] : null;
  }
  // CR 701.10a/c: "double its power until end of turn", "double the power and toughness of each creature you control until end of turn"
  const dblPT = /^double (?:(its|.+?'s) power( and toughness)?|the power( and toughness)? of (.+?))( until end of turn)?$/i.exec(c);
  if (dblPT) {
    const whoText = dblPT[1] ? (dblPT[1] === 'its' ? 'it' : dblPT[1].replace(/'s$/, '')) : dblPT[4]!;
    const what = parseObjectRef(whoText, b);
    if (!what) return null;
    return [{ type: 'modify', what: what.ref, double: dblPT[2] || dblPT[3] ? 'both' : 'power', until: dblPT[5] ? 'eot' : 'game' }];
  }
  // CR 701.61a
  if (/^forage$/i.test(c)) return [{ type: 'forage' }];
  // CR 701.50a: "~ connives", "target creature you control connives".
  // CR 701.50d: "connives X" (Spymaster's Vault), "connives 2".
  const connive = /^(.+?) connives(?: (X|\d+))?$/i.exec(c);
  if (connive) {
    const what = parseObjectRef(connive[1]!, b);
    const amount = connive[2] ? parseAmount(connive[2]) : null;
    return what && !what.plural ? [{ type: 'connive', what: what.ref, ...(amount !== null && amount !== undefined ? { amount } : {}) }] : null;
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
  // Mana Drain: "add an amount of {C} equal to that spell's mana value".
  const addAmount = add ? /^an amount of (\{[WUBRGC]\}) equal to (.+)$/.exec(add[1]!) : null;
  if (addAmount) {
    const base = parseManaProduction(addAmount[1]!);
    const times = base ? parseCount(addAmount[2]!, b) : null;
    if (base && times) return [{ ...base, times }];
  }
  // Mana Geyser: "Add {R} for each tapped land your opponents control."
  // Culling Ritual: "Add {B} or {G} for each permanent destroyed this way" — any mix of the two.
  const addEach = add ? /^((?:\{[WUBRGC]\})+|\{[WUBRGC]\} or \{[WUBRGC]\}) for each (.+)$/.exec(add[1]!) : null;
  if (addEach) {
    const base = parseManaProduction(addEach[1]!);
    const times = base ? parseForEach(addEach[2]!, b) : null;
    if (base && times) return [{ ...base, times }];
  }
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
  // Liquimetal Torque: "Target nonland permanent becomes an artifact in addition to its other types until end of turn".
  if (!m[2] && !/\bcreature$/.test(m[4]!) && !m[7]) return null;
  return attempt(b, (b) => {
    const what = parseObjectRef(m[1]!, b);
    if (!what) return null;
    const words = m[4]!.replace(/ and /g, ' ').split(' ');
    if (words[words.length - 1] !== 'creature' && !m[7]) return null;
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
      const kws = parseKeywordList(m[5], b, false, true);
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

/** Effects the engine counts separately for each player they're for (Ref 'each_player'). */
const PER_PLAYER = ['lose_life', 'gain_life', 'draw', 'mill'];

/**
 * Archfiend of Despair: "each opponent loses life equal to the life that player lost this turn" — a count that names the
 * players the instruction is for ("they", "their", "that player") means each of them in turn (Ref 'each_player'), for
 * the effects the engine counts that way; null for any other.
 */
function perPlayerCount(inner: EffectNode[], expr: AmountExpr): AmountExpr | null {
  const who = inner.length === 1 ? ((inner[0] as { who?: Ref }).who) : undefined;
  if (!who || who.ref !== 'players') return expr;
  const w = JSON.stringify(who);
  const js = JSON.stringify(expr);
  if (!js.includes(w)) return expr;
  if (!PER_PLAYER.includes(inner[0]!.type)) return null;
  return JSON.parse(js.split(w).join('{"ref":"each_player"}')) as AmountExpr;
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
  // Crackle with Power: "~ deals five times X damage to each of up to X targets."
  const m = /^(~|[Ii]t) deals ((?:twice|(?:three|four|five) times) X|\S+) damage to (.+)$/.exec(c);
  if (!m) return null;
  return attempt(b, (b) => {
    const fromIt = m[1] !== '~' && b.it?.ref === 'trigger_object' && b.itOnField && !b.itIsSource;
    if (m[1] !== '~' && b.it?.ref !== 'self' && !(b.itIsSource && b.it?.ref === 'trigger_object') && !fromIt) return null;
    const timesX = /^(twice|three times|four times|five times) X$/.exec(m[2]!);
    const amount = timesX ? { kind: 'x' as const, times: { twice: 2, 'three times': 3, 'four times': 4, 'five times': 5 }[timesX[1] as 'twice'] } : parseAmount(m[2]!);
    if (amount === null) return null;
    const out: EffectNode[] = [];
    const second = /^(.+?) and (\S+) damage to (.+)$/.exec(m[3]!);
    // Stuffy Doll: "~ deals 1 damage to itself."
    const first = m[3] === 'itself' && m[1] === '~' ? [{ ref: 'self' } as Ref] : parseRecipients(second ? second[1]! : m[3]!, b);
    if (!first) return null;
    for (const to of first) out.push({ type: 'deal_damage', amount, to, ...(fromIt ? { from: { ref: 'trigger_object' } } : {}) });
    // "If a creature dealt damage this way would die this turn, …"
    if (first.length === 1) b.damaged = first[0]!;
    if (second) {
      const amount2 = parseAmount(second[2]!);
      const rest = amount2 !== null ? parseRecipients(second[3]!, b) : null;
      if (!rest || amount2 === null) return null;
      for (const to of rest) out.push({ type: 'deal_damage', amount: amount2, to, ...(fromIt ? { from: { ref: 'trigger_object' } } : {}) });
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
  // Without a duration it lasts indefinitely (CR 611.2a): "It gains haste." (unearth).
  // Elspeth, Storm Slayer: "Those creatures gain flying until your next turn."
  const m = /^(.+?) (?:gets?|gains?|has|have) (.+) until (?:end of turn|your next turn)$/.exec(c) ?? /^(.+?) (?:gains?) ((?!control\b).+)$/.exec(c);
  if (!m) return null;
  const until = / until end of turn$/.test(c) ? 'eot' : / until your next turn$/.test(c) ? 'your_next_turn' : 'game';
  return attempt(b, (b) => {
    // "Two target creatures each get +1/+1": "each" goes with a plural subject.
    const each = / each$/.test(m[1]!);
    const what = parseObjectRef(m[1]!.replace(/ each$/, ''), b);
    if (!what || (each && !what.plural)) return null;
    // An instant or sorcery is never on the battlefield to get anything ("Search … It gains indestructible": the card found).
    if (what.ref.ref === 'self' && /\b(?:Instant|Sorcery)\b/.test(b.env.typeLine)) return null;
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
        const kws = parseKeywordList(pm[2]!, b, false, true);
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
  const lose = /^(.+?) loses? ([a-z ,]+?) until end of turn$/.exec(c);
  if (lose && !/^all abilities$/.test(lose[2]!)) {
    const r = attempt(b, (b) => {
      const kws = parseKeywordList(lose[2]!, b);
      const what = kws && !kws.some((k) => k.text || k.cost || k.n !== undefined) ? parseObjectRef(lose[1]!, b) : null;
      return what && kws ? [{ type: 'modify', what: what.ref, loseKeywords: kws.map((k) => k.id), until: 'eot' }] : null;
    });
    if (r) return r;
  }
  // "Target creature must be blocked this turn if able." / "~ can't be blocked by more than one creature this turn."
  // Gingerbrute: "This creature can't be blocked this turn except by creatures with haste."
  const combat = /^(.+?) (must be blocked this turn if able|can't be blocked .+? this turn|can't be blocked this turn except by .+|can block only .+? this turn)$/.exec(c);
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
  const locked = /^(?:(.+?)'s|[Ii]ts) activated abilities can't be activated (?:this turn|until end of turn)$/.exec(c);
  if (locked) {
    const what = parseObjectRef(locked[1] ?? 'it', b);
    return what ? [{ type: 'modify', what: what.ref, rules: ['cant_activate'], until: 'eot' }] : null;
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
