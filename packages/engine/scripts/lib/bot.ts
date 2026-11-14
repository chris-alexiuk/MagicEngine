/**
 * The players the scripts use: they answer every choice the engine asks for.
 *
 * Two kinds. The random one (the fuzz games) makes any legal choice, to reach states nobody would think to test. The
 * constructive one (the card sandbox) makes the same choice every time and prefers the one that makes something happen:
 * yes to "you may", pays what is asked, finds as many as it may — and leaves the card being checked alone when there is
 * another choice, so that what happens to that card is its own doing.
 */
import {
  activatedAbilities,
  attackRestriction,
  attackTax,
  combatLimits,
  mustAttack,
  blockDeclarationProblem,
  blockProblem,
  chars,
  flatten,
  hasKeyword,
  hasRule,
  spellPrograms,
  targetCandidates,
  targetingAs,
  type Action,
  type ChoiceAnswer,
  type GameState,
  type PlayerId,
  type Target,
  type TargetPrompt,
} from '../../src/index.js';
import { defaultCastChoice } from '../../src/legal.js';
import { planAutoTap } from '../../src/autotap.js';
import { parseManaCost } from '../../src/mana.js';
import { controlledByTargetIndex, ownedByTargetIndex, relatedPick, withTargetX } from '../../src/targets.js';

export interface BotOptions {
  /** Where the random bot's choices come from: a number in [0, 1). */
  rnd: () => number;
  /** The same choice every time, and the one that makes something happen (see the top of this file). */
  constructive?: boolean;
  /** Objects a constructive bot chooses last: the card being checked. */
  protect?: () => ReadonlySet<string>;
}

export type Bot = ReturnType<typeof createBot>;

export function createBot(opts: BotOptions) {
  const rnd = opts.rnd;
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const shuffle = <T>(xs: T[]): T[] => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [xs[i], xs[j]] = [xs[j]!, xs[i]!];
    }
    return xs;
  };
  const C = Boolean(opts.constructive);
  const spared = (): ReadonlySet<string> => opts.protect?.() ?? new Set<string>();
  const idOf = (x: unknown): string => (typeof x === 'string' ? x : x && typeof x === 'object' && (x as Target).kind === 'object' ? (x as { object: string }).object : '');
  /** Random: true with probability p. Constructive: always `sure`. */
  const coin = (p: number, sure: boolean): boolean => (C ? sure : rnd() < p);
  /** Random: shuffled. Constructive: as given, with the spared objects last. */
  const order = <T>(xs: T[]): T[] => {
    if (!C) return shuffle(xs);
    const s = spared();
    return s.size ? [...xs.filter((x) => !s.has(idOf(x))), ...xs.filter((x) => s.has(idOf(x)))] : xs;
  };
  /** Random: any of them. Constructive: the first that isn't spared. */
  const one = <T>(xs: readonly T[]): T => (C ? order([...xs])[0]! : pick(xs));
  /** Random: any number from min to max. Constructive: `want`, kept within them. */
  const howMany = (min: number, max: number, want: number): number => (C ? Math.max(min, Math.min(max, want)) : min + Math.floor(rnd() * (max - min + 1)));
  /** Random: in any order (the bots' older way of shuffling, kept so a seed still plays the same games). */
  const mixed = <T>(xs: T[]): T[] => (C ? order(xs) : xs.sort(() => rnd() - 0.5));

  /** The game the bots are looking at (for owners of target candidates). */
  let current: GameState | null = null;
  const ownerOf = (t: Target) => (t.kind === 'object' ? current?.objects[t.object]?.owner : undefined);

  function sample(all: Target[], count: number, upTo: boolean, min = 0, sameOwner?: boolean): Target[] {
    // "from a single graveyard": one owner's cards.
    const owner = sameOwner && all.length ? ownerOf(one(all)) : undefined;
    const candidates = owner ? all.filter((t) => ownerOf(t) === owner) : all;
    const most = Math.min(count, candidates.length);
    const n = upTo ? Math.min(most, howMany(min, most, 2)) : count;
    return order([...candidates]).slice(0, n);
  }

  /** The player a chosen target stands for (the player, or the permanent's controller). */
  function playerOfTarget(t: Target | undefined): string | undefined {
    if (!t || t.kind === 'ability') return undefined;
    if (t.kind === 'player') return t.player;
    const o = current?.objects[t.object];
    return o ? (o.zone === 'battlefield' ? o.controller : o.owner) : undefined;
  }

  /** Only the candidates controlled by the player an earlier target stands for ("… target creature that player controls"). */
  function dependent(candidates: Target[], index: number | undefined, picked: Target[][]): Target[] {
    if (index === undefined) return candidates;
    const who = playerOfTarget(picked[index]?.[0]);
    return candidates.filter((t) => who !== undefined && playerOfTarget(t) === who);
  }

  /** Samples each prompt in order, a dependent one from what the earlier ones picked. */
  function samplePrompts(prompts: TargetPrompt[]): Target[][] {
    const out: Target[][] = [];
    prompts.forEach((pr, i) => {
      // Mutiny: an earlier target whose player has enough for the later ones that depend on it.
      const later = prompts.filter((q) => q.controlledByTarget === i && (q.upTo ? (q.min ?? 0) : q.count) > 0);
      const enough = (t: Target) => later.every((q) => q.candidates.filter((c) => playerOfTarget(c) === playerOfTarget(t) && JSON.stringify(c) !== JSON.stringify(t)).length >= (q.upTo ? (q.min ?? 0) : q.count));
      const own = later.length && pr.candidates.some(enough) ? pr.candidates.filter(enough) : pr.candidates;
      const attachedTo = pr.attachedToTarget !== undefined ? out[pr.attachedToTarget]?.[0] : undefined;
      const onIt = (t: Target) => pr.attachedToTarget === undefined || (t.kind === 'object' && attachedTo?.kind === 'object' && current?.objects[t.object]?.attachedTo?.id === attachedTo.object);
      out.push(samplePrompt({ ...pr, candidates: dependent(own, pr.controlledByTarget, out).filter(onIt) }));
    });
    return out;
  }

  /** A prompt's targets: per-player prompts get one for each player who has a candidate (sometimes fewer, if allowed). */
  function samplePrompt(pr: TargetPrompt): Target[] {
    if (!pr.perPlayer) return sample(pr.candidates, pr.count, pr.upTo, pr.min, pr.sameOwner);
    const whose = (t: Target) => (t.kind === 'object' ? (current?.objects[t.object]?.zone === 'battlefield' ? current.objects[t.object]!.controller : current?.objects[t.object]?.owner) : undefined);
    const groups = new Map<string | undefined, Target[]>();
    for (const t of pr.candidates) groups.set(whose(t), [...(groups.get(whose(t)) ?? []), t]);
    const picks = [...groups.values()].map((ts) => one(ts));
    return picks.filter((_, i) => i < (pr.min ?? 0) || coin(0.8, true));
  }

  /** Re-picks targets at random for a cast/activate action that came with defaults. */
  function randomiseTargets(g: GameState, a: Action): Action {
    // An ability's targets (Shanna: "can't be the target of abilities your opponents control").
    return targetingAs(a.type === 'activate', () => randomiseTargetsNow(g, a));
  }

  function randomiseTargetsNow(g: GameState, a: Action): Action {
    current = g;
    if ((a.type !== 'cast' && a.type !== 'activate') || !a.targets?.length) return a;
    const o = g.objects[a.object]!;
    let specs;
    try {
      if (a.type === 'cast') {
        const face = g.cards[o.card]!.faces[a.face ?? 0]!;
        const programs = spellPrograms(face);
        if (!programs) return a;
        specs = flatten(programs, a.modes).specs;
      } else {
        specs = flatten([activatedAbilities(g, o)[a.ability]!], a.modes).specs;
      }
    } catch {
      return a;
    }
    // Per-player specs ("for each opponent, … target … that player controls") keep the offered choice.
    if (specs.some((s) => s.perPlayer)) return a;
    // "with mana value X or less": the X it's cast or activated with.
    const x = (a as { x?: number }).x ?? 0;
    // Agadeem's Awakening, Run Away Together, Secret Tunnel: related targets (a related set of the random ones, or none).
    const distinct = (spec: (typeof specs)[number], picked: Target[]) => {
      if (!spec.distinctManaValues && !spec.differentControllers && !spec.shareCreatureType && !spec.shareCardType && spec.maxTotalMV === undefined) return picked;
      const pick = relatedPick(g, spec, picked, picked.length);
      return pick.length >= (spec.upTo ? (spec.min ?? 0) : (spec.count ?? 1)) ? pick : relatedPick(g, spec, targetCandidates(g, a.player, spec, o), spec.count ?? 1);
    };
    const out: Target[][] = [];
    let stuck = false;
    withTargetX(x, () => {
      for (const spec of specs!) {
        const attachedIndex = (spec.filter?.attachedToRef as { ref?: string; index?: number } | undefined)?.ref === 'target' ? ((spec.filter!.attachedToRef as { index?: number }).index ?? 0) : undefined;
        const attachedTo = attachedIndex !== undefined ? out[attachedIndex]?.[0] : undefined;
        const candidates = dependent(targetCandidates(g, a.player, spec, o), controlledByTargetIndex(spec.filter) ?? ownedByTargetIndex(spec.filter), out).filter((t) => attachedIndex === undefined || (t.kind === 'object' && attachedTo?.kind === 'object' && g.objects[t.object]?.attachedTo?.id === attachedTo.object));
        // A later target with none left for the earlier ones picked ("another target creature that player controls"): keep the offered choice.
        if (!spec.upTo && candidates.length < (spec.count ?? 1)) stuck = true;
        out.push(distinct(spec, sample(candidates, spec.count ?? 1, Boolean(spec.upTo), spec.upTo ? (spec.min ?? 0) : 0, spec.sameOwner)));
      }
    });
    return stuck ? a : { ...a, targets: out };
  }

  function answerFor(g: GameState): { player: PlayerId; answer: ChoiceAnswer } | null {
    current = g;
    const p = g.pending;
    if (!p) return null;
    const me = p.player;
    const hand = () => [...(g.zones.hand[me] ?? [])];
    switch (p.kind) {
      case 'mulligan':
        return { player: me, answer: { kind: 'mulligan', keep: coin(0.85, true) || g.players[me]!.mulligans >= 2 } };
      case 'bottom_cards':
        return { player: me, answer: { kind: 'bottom_cards', objects: order(hand()).slice(0, p.count) } };
      case 'opening_battlefield': {
        const objects = p.candidates.filter(() => coin(0.8, false));
        const needed = objects.filter((id) => p.exileFor?.includes(id)).length;
        const exile = order(hand().filter((id) => !objects.includes(id))).slice(0, needed);
        return { player: me, answer: { kind: 'opening_battlefield', objects, ...(needed ? { exile } : {}) } };
      }
      case 'dredge':
        return { player: me, answer: { kind: 'dredge', object: coin(0.5, false) && p.candidates.length ? one(p.candidates) : null } };
      case 'untap_limit':
        return { player: me, answer: { kind: 'untap_limit', objects: mixed([...p.candidates]).slice(0, p.n) } };
      case 'keep_tapped':
        return { player: me, answer: { kind: 'keep_tapped', objects: p.candidates.filter(() => coin(0.5, false)) } };
      case 'discard_to_hand_size':
        return { player: me, answer: { kind: 'discard_to_hand_size', objects: order(hand()).slice(0, p.count) } };
      case 'discard':
        return { player: me, answer: { kind: 'discard', objects: order(hand()).slice(0, Math.min(p.count, hand().length)) } };
      case 'legend_rule':
        return { player: me, answer: { kind: 'legend_rule', keep: C ? (p.objects.find((id) => spared().has(id)) ?? p.objects[0]!) : pick(p.objects) } };
      case 'commander_zone':
        return { player: me, answer: { kind: 'commander_zone', move: coin(0.8, true) } };
      case 'manual_resolution':
        return { player: me, answer: { kind: 'manual_resolution', done: true } };
      case 'may':
        return { player: me, answer: { kind: 'may', yes: coin(0.7, true) } };
      case 'cast_free': {
        const choice = coin(0.8, true) ? defaultCastChoice(g, me, p.object) : null;
        return { player: me, answer: choice ? { kind: 'cast_free', cast: true, ...choice } : { kind: 'cast_free', cast: false } };
      }
      case 'copy_targets': {
        // Keep the targets, or pick new ones where there are enough candidates.
        // (The constructive bot aims a copy at the last things it could, so that it and the original do two things.)
        const fresh = p.prompts.map((pr) => (C ? order(pr.candidates.slice().reverse()) : mixed(pr.candidates.slice())).slice(0, pr.count));
        const ok = p.prompts.every((pr, i) => fresh[i]!.length === pr.count || (pr.upTo && fresh[i]!.length <= pr.count));
        // "Change the target": a new one is required.
        if (p.mustChange) return { player: me, answer: { kind: 'copy_targets', targets: fresh } };
        return { player: me, answer: { kind: 'copy_targets', ...(ok && coin(0.5, true) ? { targets: fresh } : {}) } };
      }
      case 'pay':
        // Try to pay half the time; the main loop falls back to declining if it can't be paid.
        // "You may pay {X}": a small X (no more than it allows).
        return { player: me, answer: { kind: 'pay', pay: coin(0.5, true), ...(p.x ? { x: howMany(0, Math.min(p.x.max ?? 4, 4), 2) } : {}) } };
      case 'sacrifice':
        return { player: me, answer: { kind: 'sacrifice', objects: order([...p.candidates]).slice(0, p.count) } };
      case 'search': {
        const n = p.mustFind ? Math.min(p.count, p.candidates.length) : howMany(0, Math.min(p.count, p.candidates.length), p.count);
        let pool = order([...p.candidates]);
        // "that share a land type": the first card's types decide the rest.
        if (p.sameLandType && pool.length) {
          const sub = (id: string) => g.cards[g.objects[id]!.card]!.faces[0]!.subtypes;
          pool = [pool[0]!, ...pool.slice(1).filter((id) => sub(id).some((t) => sub(pool[0]!).includes(t)))];
        }
        // Gifts Ungiven: cards with different names.
        if (p.distinctNames) {
          const seen = new Set<string>();
          pool = pool.filter((id) => {
            const name = g.cards[g.objects[id]!.card]!.name;
            return seen.has(name) ? false : (seen.add(name), true);
          });
        }
        // Krosan Verge: one card for each description.
        if (p.kinds) {
          const used = new Set<number>();
          pool = pool.filter((id) => {
            const k = (p.kinds![id] ?? []).find((x) => !used.has(x));
            return k === undefined ? false : (used.add(k), true);
          });
        }
        // Protean Hulk: keep under the total mana value.
        if (p.totalMV) {
          let left = p.totalMV.max;
          pool = pool.filter((id) => (p.totalMV!.of[id]! <= left ? ((left -= p.totalMV!.of[id]!), true) : false));
        }
        return { player: me, answer: { kind: 'search', objects: pool.slice(0, n) } };
      }
      case 'scry': {
        const xs = order([...p.objects]);
        // "Put them back in any order": all of them on top.
        const k = p.reorder ? xs.length : howMany(0, xs.length, xs.length);
        return { player: me, answer: { kind: 'scry', top: xs.slice(0, k), bottom: xs.slice(k) } };
      }
      case 'surveil': {
        const xs = order([...p.objects]);
        const k = howMany(0, xs.length, xs.length);
        return { player: me, answer: { kind: 'surveil', top: xs.slice(0, k), graveyard: xs.slice(k) } };
      }
      case 'proliferate':
        return { player: me, answer: { kind: 'proliferate', objects: p.objects.filter(() => coin(0.6, true)), players: p.players.filter(() => coin(0.5, true)) } };
      case 'choose_option':
        return { player: me, answer: { kind: 'choose_option', choice: one(p.options) } };
      case 'choose_objects': {
        const n = C ? Math.max(p.min, Math.min(p.max, p.candidates.length, 2)) : p.min + Math.floor(rnd() * (Math.min(p.max, p.candidates.length) - p.min + 1));
        // Sludge Titan: one card for each kind — keep only cards that can stand for a kind not used yet.
        if (p.kinds) {
          const used = new Set<number>();
          const objects: string[] = [];
          for (const id of order([...p.candidates])) {
            if (objects.length >= n) break;
            const k = (p.kinds[id] ?? []).find((x) => !used.has(x));
            if (k === undefined) continue;
            used.add(k);
            objects.push(id);
          }
          return { player: me, answer: { kind: 'choose_objects', objects } };
        }
        // Eerie Ultimatum: different names.
        if (p.distinctNames) {
          const seen = new Set<string>();
          const objects = order([...p.candidates]).filter((id) => {
            const name = g.cards[g.objects[id]!.card]!.name;
            return seen.has(name) ? false : (seen.add(name), true);
          });
          return { player: me, answer: { kind: 'choose_objects', objects: objects.slice(0, Math.max(n, p.min)) } };
        }
        // Lively Dirge: keep under the total mana value.
        if (p.totalMV) {
          let left = p.totalMV.max;
          const objects = order([...p.candidates]).filter((id) => (p.totalMV!.of[id]! <= left ? ((left -= p.totalMV!.of[id]!), true) : false)).slice(0, Math.max(n, p.min));
          return { player: me, answer: { kind: 'choose_objects', objects } };
        }
        return { player: me, answer: { kind: 'choose_objects', objects: order([...p.candidates]).slice(0, n) } };
      }
      case 'as_enters':
        if (p.choice === 'pay_life') return { player: me, answer: { kind: 'as_enters', pay: g.players[me]!.life >= (p.amount ?? 0) && coin(0.6, true) } };
        if (p.choice === 'discard_or_leave') return { player: me, answer: { kind: 'as_enters', reveal: p.candidates?.length && coin(0.8, true) ? one(p.candidates) : null } };
        if (p.choice === 'reveal') return { player: me, answer: { kind: 'as_enters', reveal: p.candidates?.length && coin(0.8, true) ? one(p.candidates) : null } };
        if (p.choice === 'counter') return { player: me, answer: { kind: 'as_enters', pay: coin(0.5, true) } };
        if (p.choice === 'sacrifice_or_leave') return { player: me, answer: { kind: 'as_enters', sacrifice: mixed([...(p.candidates ?? [])]).slice(0, p.amount ?? 1) } };
        if (p.choice === 'devour') return { player: me, answer: { kind: 'as_enters', sacrifice: (p.candidates ?? []).filter(() => coin(0.3, false)) } };
        if (p.choice === 'copy') return { player: me, answer: { kind: 'as_enters', copy: p.candidates?.length && coin(0.9, true) ? one(p.candidates) : null } };
        if (p.choice === 'enchant' && p.candidates?.length) return { player: me, answer: { kind: 'as_enters', attach: one(p.candidates) } };
        // A size or a loyalty set by hand: something small that lives.
        if (p.choice === 'size') return { player: me, answer: { kind: 'as_enters', size: { power: howMany(0, 4, 2), toughness: howMany(1, 4, 2), counters: howMany(0, 2, 0) } } };
        if (p.choice === 'loyalty') return { player: me, answer: { kind: 'as_enters', loyalty: howMany(1, 5, 3) } };
        return { player: me, answer: { kind: 'as_enters', choice: one(p.options ?? []) } };
      case 'declare_attackers': {
        const attacks = p.attackers
          .filter((id) => mustAttack(g, g.objects[id]!) || (C ? spared().has(id) : rnd() < 0.6))
          .flatMap((attacker) => {
            // CR 508.1c: "can't attack unless defending player controls an Island".
            const ok = p.targets.filter((t) => !attackRestriction(g, g.objects[attacker]!, t));
            return ok.length ? [{ attacker, target: one(ok) }] : [];
          });
        // Silent Arbiter / Crawlspace: no more than so many attackers (those that must attack first).
        const limits = combatLimits(g);
        attacks.sort((a, b) => Number(mustAttack(g, g.objects[b.attacker]!)) - Number(mustAttack(g, g.objects[a.attacker]!)));
        for (let i = attacks.length - 1; i >= 0; i--) {
          const t = attacks[i]!.target;
          const atP = t.kind === 'player' ? attacks.filter((x) => x.target.kind === 'player' && x.target.player === t.player).length : 0;
          if (t.kind === 'player' && atP > (limits.attackPlayer[t.player] ?? Infinity)) attacks.splice(i, 1);
        }
        if (attacks.length > limits.attack) attacks.length = limits.attack;
        // CR 506.5: a creature that can't attack alone stays home on its own — or, if it must attack (CR 508.1d), brings a friend.
        if (attacks.length === 1 && hasRule(g, g.objects[attacks[0]!.attacker]!, 'cant_attack_alone')) {
          const friend = mustAttack(g, g.objects[attacks[0]!.attacker]!) ? p.attackers.find((id) => id !== attacks[0]!.attacker && p.targets.some((t) => !attackRestriction(g, g.objects[id]!, t))) : undefined;
          if (friend) attacks.push({ attacker: friend, target: one(p.targets.filter((t) => !attackRestriction(g, g.objects[friend]!, t))) });
          else attacks.length = 0;
        }
        // CR 508.1g: costs to attack (Ghostly Prison) — sometimes pay, otherwise keep those creatures home.
        const tax = attackTax(g, attacks);
        if (tax && (coin(0.3, false) || !planAutoTap(g, me, parseManaCost(tax), 0, attacks.map((a) => a.attacker)))) {
          // A creature that must attack goes after an untaxed target instead, if it has one (CR 508.1d).
          const free = attacks.flatMap((a) => {
            if (!attackTax(g, [a])) return [a];
            const o = g.objects[a.attacker]!;
            const alt = mustAttack(g, o) ? p.targets.find((t) => !attackRestriction(g, o, t) && !attackTax(g, [{ attacker: a.attacker, target: t }])) : undefined;
            return alt ? [{ attacker: a.attacker, target: alt }] : [];
          });
          attacks.length = 0;
          attacks.push(...free);
          if (attacks.length === 1 && hasRule(g, g.objects[attacks[0]!.attacker]!, 'cant_attack_alone')) {
            // It must attack (CR 508.1d): with another creature that can attack at no cost, if there is one.
            const lone = attacks[0]!.attacker;
            const friend = mustAttack(g, g.objects[lone]!) ? p.attackers.find((id) => id !== lone && p.targets.some((t) => !attackRestriction(g, g.objects[id]!, t) && !attackTax(g, [{ attacker: id, target: t }]))) : undefined;
            if (friend) attacks.push({ attacker: friend, target: one(p.targets.filter((t) => !attackRestriction(g, g.objects[friend]!, t) && !attackTax(g, [{ attacker: friend, target: t }]))) });
            else attacks.length = 0;
          }
        }
        // CR 701.43d: exert some of those that can be.
        const exert = attacks.map((a) => a.attacker).filter((id) => p.exertable?.includes(id) && coin(0.6, true));
        // CR 702.154a: enlist a creature that stays home, sometimes.
        const home = (p.enlistable ?? []).filter((id) => !attacks.some((a) => a.attacker === id));
        const enlist = attacks.filter((a) => p.enlisters?.includes(a.attacker) && coin(0.5, true)).slice(0, home.length).map((a, i) => ({ attacker: a.attacker, tap: home[i]! }));
        return { player: me, answer: { kind: 'declare_attackers', attacks, ...(exert.length ? { exert } : {}), ...(enlist.length ? { enlist } : {}) } };
      }
      case 'declare_blockers': {
        const random = () => {
          const blocks: { blocker: string; attacker: string }[] = [];
          for (const blocker of p.blockers) {
            if (coin(0.5, true)) continue;
            const options = p.attackers.filter((a) => !blockProblem(g, g.objects[blocker]!, g.objects[a]!) && !hasKeyword(g, g.objects[a]!, 'menace'));
            if (!options.length) continue;
            const first = one(options);
            blocks.push({ blocker, attacker: first });
            // CR 509.1a: a creature that can block more than one attacker sometimes does.
            const extra = chars(g, g.objects[blocker]!).combat.reduce((n, r) => n + (r.extraBlocks ?? 0), 0);
            for (const other of order(options.filter((a) => a !== first)).slice(0, extra)) if (coin(0.5, false)) blocks.push({ blocker, attacker: other });
          }
          return blocks;
        };
        // Requirements first (CR 509.1c): lures get every creature able to block them; "must be blocked" gets one.
        const forced = () => {
          const must = (a: string, kind: 'one' | 'all') => chars(g, g.objects[a]!).combat.some((r) => r.mustBeBlocked === kind);
          const blocks: { blocker: string; attacker: string }[] = [];
          for (const blocker of p.blockers) {
            const lure = p.attackers.find((a) => must(a, 'all') && !blockProblem(g, g.objects[blocker]!, g.objects[a]!));
            if (lure) blocks.push({ blocker, attacker: lure });
          }
          // "blocks ~ this turn if able", "blocks each combat if able" (requirements on blockers).
          for (const blocker of p.blockers) {
            if (blocks.some((x) => x.blocker === blocker)) continue;
            const o = g.objects[blocker]!;
            const reqs = (o.mustBlock ?? []).filter((m) => m.turn === g.turn);
            const wanted = reqs.flatMap((m) => (m.attacker && p.attackers.includes(m.attacker.id) && !blockProblem(g, o, g.objects[m.attacker.id]!) ? [m.attacker.id] : []));
            const any = hasRule(g, o, 'blocks_each_combat') || reqs.some((m) => !m.attacker);
            const choice = wanted[0] ?? (any ? p.attackers.find((a) => !blockProblem(g, o, g.objects[a]!) && !hasKeyword(g, g.objects[a]!, 'menace')) : undefined);
            if (choice) blocks.push({ blocker, attacker: choice });
            else if (any) {
              // CR 509.1c: a menace attacker can still be blocked with a second creature, which obeys the requirement.
              const menace = p.attackers.find((a) => !blockProblem(g, o, g.objects[a]!));
              const friend = menace ? p.blockers.find((x) => x !== blocker && !blocks.some((y) => y.blocker === x) && !blockProblem(g, g.objects[x]!, g.objects[menace]!)) : undefined;
              if (menace && friend) blocks.push({ blocker, attacker: menace }, { blocker: friend, attacker: menace });
            }
          }
          for (const a of p.attackers.filter((x) => must(x, 'one'))) {
            if (blocks.some((x) => x.attacker === a)) continue;
            const free = p.blockers.find((b) => !blocks.some((x) => x.blocker === b) && !blockProblem(g, g.objects[b]!, g.objects[a]!));
            if (free) blocks.push({ blocker: free, attacker: a });
          }
          return blocks;
        };
        for (let k = 0; k < 12; k++) {
          const blocks = k < 10 ? random() : k === 10 ? forced() : [];
          if (!blockDeclarationProblem(g, me, blocks)) return { player: me, answer: { kind: 'declare_blockers', blocks } };
        }
        return { player: me, answer: { kind: 'declare_blockers', blocks: forced() } };
      }
      case 'assign_combat_damage':
        // CR 510.1c: sometimes all of it past the blockers, as though unblocked.
        return { player: me, answer: { kind: 'assign_combat_damage', assignments: Object.fromEntries(p.choices.map((c) => [c.attacker, c.unblockedTarget && coin(0.5, false) ? [{ to: c.unblockedTarget, amount: c.power }] : c.suggested])) } };
      case 'trigger_targets': {
        if (p.modes) {
          const legal = p.modes.options
            .map((o, i) => ({ i, o }))
            .filter(({ i }) => !p.modes!.used?.includes(i))
            .filter(({ o }) => o.prompts.every((pr) => (pr.upTo ? pr.candidates.length >= (pr.min ?? 0) : pr.candidates.length >= pr.count)));
          const n = Math.max(p.modes.min, Math.min(p.modes.max, p.modes.repeat ? p.modes.max : legal.length, C ? 1 : 1 + Math.floor(rnd() * p.modes.max)));
          const picked = order(legal).slice(0, n);
          // CR 700.2d: the same mode again, if it may be chosen more than once.
          while (p.modes.repeat && picked.length < n && legal.length) picked.push(one(legal));
          const chosen = picked.sort((a, b) => a.i - b.i);
          const targets = chosen.flatMap(({ o }) => samplePrompts(o.prompts));
          return { player: me, answer: { kind: 'trigger_targets', modes: chosen.map((c) => c.i), targets: [...targets, ...samplePrompts(p.prompts)] } };
        }
        return { player: me, answer: { kind: 'trigger_targets', targets: samplePrompts(p.prompts) } };
      }
    }
    return null;
  }

  return { answerFor, randomiseTargets, samplePrompts, pick, shuffle };
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/** What is structurally wrong with this state, if anything: every object in exactly one zone, numbers that are numbers, someone to decide. */
export function checkInvariants(g: GameState): string | null {
  const seen = new Set<string>();
  const where = (id: string, zone: string, owner?: PlayerId): string | null => {
    const o = g.objects[id];
    if (!o) return `${zone} lists missing object ${id}`;
    if (o.zone !== zone) return `${id} is listed in ${zone} but says ${o.zone}`;
    if (owner && o.owner !== owner) return `${id} is in ${owner}'s ${zone} but owned by ${o.owner}`;
    if (seen.has(id)) return `${id} is in two places`;
    seen.add(id);
    return null;
  };
  for (const p of g.order) {
    for (const zone of ['library', 'hand', 'graveyard'] as const) {
      for (const id of g.zones[zone][p] ?? []) {
        const err = where(id, zone, p);
        if (err) return err;
      }
    }
    const ps = g.players[p]!;
    if (!Number.isFinite(ps.life) || Object.values(ps.pool).some((n) => !Number.isInteger(n) || n < 0)) return `bad numbers for ${p}`;
  }
  for (const zone of ['battlefield', 'exile', 'command'] as const) {
    for (const id of g.zones[zone]) {
      const err = where(id, zone);
      if (err) return err;
    }
  }
  // CR 702.26b: phased-out permanents are on the battlefield but kept off its list.
  for (const id of g.phasedOut ?? []) {
    const err = where(id, 'battlefield');
    if (err) return err;
    if (!g.objects[id]!.phasedOut) return `${id} is listed as phased out but isn't`;
  }
  for (const e of g.stack) {
    if (e.kind === 'spell') {
      const err = where(e.object, 'stack');
      if (err) return err;
    }
  }
  // CR 712.4a: the other card of a melded permanent is part of that permanent, on no list of its own.
  for (const o of Object.values(g.objects)) {
    if (!o.meldedInto) continue;
    const a = g.objects[o.meldedInto];
    if (!a || a.zone !== 'battlefield' || o.zone !== 'battlefield' || a.melded?.partner !== o.id) return `${o.id} is melded into ${o.meldedInto}, which isn't melded with it`;
    if (seen.has(o.id)) return `${o.id} is melded but also listed in a zone`;
    seen.add(o.id);
  }
  for (const o of Object.values(g.objects)) if (!seen.has(o.id)) return `${o.id} (${o.card}) is in no zone list (${o.zone})`;
  if (!g.over && !g.pending && g.started && g.priority === null) return 'nobody has priority and nothing is pending';
  return null;
}
