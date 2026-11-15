/**
 * The replacement and prevention effects on damage about to be dealt (CR 614.1a, 614.1b, 615): each sort is a rule
 * here, and `dealDamage` (combat.ts) puts every damage to them through instead.ts.
 *
 *   redirected       "All damage that would be dealt to you is dealt to enchanted creature instead."
 *   changed          "it deals double that damage instead", "that much damage plus 1"
 *   prevented        a permanent's "Prevent all damage that would be dealt to …", "prevent half that damage", "all but 1"
 *   shielded         a spell's or ability's "Prevent the next 3 damage …", "Prevent all combat damage … this turn"
 *   protected        protection from the source (CR 702.16e)
 *   shield_counter   CR 122.1c: "… instead remove a shield counter from it"
 *
 * CR 616.1: the player dealt the damage, or the controller of the permanent dealt it, orders them. Nobody is asked — it
 * is the order that leaves the least damage, and of those the one that uses up least (a shield counter, what a "prevent
 * the next 3" still had to give); where that is all the same, the order of the rules above. So damage is prevented
 * before it is doubled, and a creature with protection from the source keeps its shield counter.
 *
 * An effect changes nothing as it is put to the damage: what it does besides — the record of what was prevented, a
 * shield used up, "put a +1/+1 counter on that creature for each 1 damage prevented this way" (CR 615.5) — is done once
 * the damage is settled, in the order the effects applied, the follow-ups last.
 */
import type { EffectNode, RedirectDamageNode, StaticPreventionNode } from '@mtg/schema';
import { chars, hasProtectionFrom, hasType, matchesFilter, objectAbilities, staticConditionHolds } from './characteristics.js';
import { fitsDamage } from './damage-filter.js';
import type { Also, Damage, Replacement, Rules } from './instead.js';
import { says } from './instead-moves.js';
import { removeShield } from './permanents.js';
import { playerProtectedFrom } from './player-rules.js';
import { amountEffects } from './quantities.js';
import { runEffect, type EffectContext } from './registry.js';
import type { DamageRecipient, GameEvent, GameObject, GameState, PreventionFollowUp } from './types.js';
import { abilitySources } from './zones.js';

const recipientKey = (to: DamageRecipient): string => (to.kind === 'player' ? to.player : to.object);
const same = (a: DamageRecipient, b: DamageRecipient): boolean => (a.kind === 'player' ? b.kind === 'player' && a.player === b.player : b.kind === 'permanent' && a.object === b.object);

/**
 * Combat damage being dealt at once: the prevention follow-ups already done for it. Undergrowth Champion: "If damage
 * would be dealt to this creature …, prevent that damage and remove a +1/+1 counter" — damage from several sources at
 * once is one event, so one counter (CR 615.5); "If a source would deal damage …" (Nine Lives) is one for each source.
 */
let together: Set<string> | undefined;

/** Runs the dealing of damage that is dealt at once (CR 510.2). */
export function dealtTogether<T>(run: () => T): T {
  const was = together;
  together = new Set();
  try {
    return run();
  } finally {
    together = was;
  }
}

/** The record that damage was prevented. */
const record = (h: Damage, amount: number): Also => ({ key: '', run: (_g, _o, events) => void events.push({ type: 'prevented', source: h.source.id, amount, to: h.to }) });

/**
 * CR 615.5: "Some prevention effects also include an additional effect, which may refer to the amount of damage that was
 * prevented. … the rest of the effect takes place immediately afterward." These never ask anyone anything (the compiler
 * reads only such follow-ups): the amount prevented is the event amount, the source of the damage the event object.
 */
function followUp(g: GameState, then: PreventionFollowUp, amount: number, source: GameObject, to: DamageRecipient, events: GameEvent[]): void {
  const holder = then.source ? g.objects[then.source.id] : undefined;
  const ctx: EffectContext = {
    g,
    controller: then.controller,
    ...(holder ? { source: holder } : {}),
    events,
    targets: then.targets ?? [],
    x: 0,
    memo: {},
    trigger: {
      amount,
      object: then.about === 'recipient' && to.kind === 'permanent' && g.objects[to.object] ? { id: to.object, zcc: g.objects[to.object]!.zcc } : { id: source.id, zcc: source.zcc },
      ...(to.kind === 'player' ? { player: to.player } : {}),
    },
  };
  const list = [...then.effects];
  while (list.length) {
    const r = runEffect(structuredClone(list.shift()!), ctx);
    if (typeof r === 'object' && 'expand' in r) list.unshift(...r.expand);
    ctx.memo = {};
  }
}

/** The damage with some of it prevented: what is left, and the record of it. */
function less(h: Damage, left: number, more: Also[] = []): Damage {
  return { ...h, amount: left, also: [...h.also, ...(h.amount > left ? [record(h, h.amount - left)] : []), ...more] };
}

export const DAMAGE_RULES: Rules<Damage> = {
  /**
   * CR 614.1b: "All damage that would be dealt to you is dealt to enchanted creature instead." — where the damage goes;
   * none if the new recipient isn't there to be dealt damage.
   */
  redirected(g, h) {
    if (h.amount <= 0) return [];
    const out: Replacement<Damage>[] = [];
    const { source, to, combat } = h;
    for (const id of g.zones.battlefield) {
      const holder = g.objects[id]!;
      objectAbilities(g, holder).forEach((a, i) => {
        if (a.kind !== 'static' || a.effect.type !== 'redirect_damage') return;
        const e = a.effect as RedirectDamageNode;
        if (!staticConditionHolds(g, e, holder) || !fitsDamage(g, e.damage, holder, { source, to, combat })) return;
        const attached = holder.attachedTo && g.objects[holder.attachedTo.id]?.zcc === holder.attachedTo.zcc ? g.objects[holder.attachedTo.id] : undefined;
        const there = e.to === 'self' ? holder : attached;
        if (!there || there.zone !== 'battlefield') return;
        const candidate: DamageRecipient = e.to === 'attached_controller' ? { kind: 'player', player: there.controller } : { kind: 'permanent', object: there.id };
        if (candidate.kind === 'permanent' && !['Creature', 'Planeswalker', 'Battle'].some((t) => hasType(g, there, t))) return;
        if (same(candidate, to)) return;
        out.push({ key: `redirect:${id}:${holder.zcc}:${i}`, label: says(g, holder, a.text), apply: (d) => ({ ...d, to: candidate }) });
      });
    }
    return out;
  },

  /** CR 614.1a: "it deals double that damage instead", "it deals that much damage plus 1 instead". */
  changed(g, h) {
    if (h.amount <= 0) return [];
    return amountEffects(g, 'damage', { source: h.source, to: h.to, combat: h.combat }).map((e) => ({ key: `amount:${e.key}`, label: e.label, apply: (d) => ({ ...d, amount: e.change(d.amount) }) }));
  },

  /** CR 615.1a: a static ability that prevents this damage (Dolmen Gate, Glacial Chasm, Fog Bank, Gisela, Temple Altisaur). */
  prevented(g, h) {
    if (h.unpreventable || h.amount <= 0) return [];
    const out: Replacement<Damage>[] = [];
    const { source, to, combat, amount } = h;
    const about = { source, to, combat };
    // Caduceus, Staff of Hermes: equipped creature has "Prevent all damage that would be dealt to this creature." — a
    // granted ability of the creature itself.
    const recipient = to.kind === 'permanent' ? g.objects[to.object] : undefined;
    if (recipient) {
      chars(g, recipient).keywords.forEach((k, ki) => {
        if (k.id !== 'ability') return;
        (k.abilities ?? []).forEach((a, ai) => {
          if (a.kind !== 'static' || a.effect.type !== 'prevent_damage') return;
          if (!fitsDamage(g, (a.effect as StaticPreventionNode).damage, recipient, about)) return;
          out.push({ key: `prevent:own:${recipient.id}:${ki}:${ai}`, label: says(g, recipient, a.text), apply: (d) => less(d, 0) });
        });
      });
    }
    for (const id of abilitySources(g)) {
      const holder = g.objects[id]!;
      objectAbilities(g, holder).forEach((a, i) => {
        if (a.kind !== 'static' || a.effect.type !== 'prevent_damage') return;
        const e = a.effect as StaticPreventionNode;
        // Simultaneous combat damage is one event: Undergrowth Champion's "while it has a +1/+1 counter on it" was true for
        // all of it, though the first counter removed made it false (CR 510.2, 615.5).
        const batch = `${holder.id}:${recipientKey(to)}`;
        const batched = Boolean(e.then && !e.eachSource);
        if (!staticConditionHolds(g, e, holder) && !(batched && together?.has(batch))) return;
        // Callous Giant: "3 or less damage".
        if (e.atMost !== undefined && amount > e.atMost) return;
        // Which damage it is about: its source, who it would be dealt to, in combat or not.
        if (!fitsDamage(g, e.damage, holder, about)) return;
        const key = `prevent:${holder.id}:${holder.zcc}:${i}`;
        const label = says(g, holder, a.text);
        // Temple Altisaur: "prevent all but 1 of that damage".
        if (e.allBut !== undefined) {
          const cap = e.allBut;
          if (amount > cap) out.push({ key, label, apply: (d) => (d.amount > cap ? less(d, cap) : d) });
          return;
        }
        // Gisela: "prevent half that damage, rounded up" — what's left is half, rounded down.
        if (e.half) {
          out.push({ key, label, apply: (d) => less(d, Math.floor(d.amount / 2)) });
          return;
        }
        // Orbs of Warding: "prevent 1 of that damage" — each such effect takes its share (CR 615.7).
        if (e.amount) {
          const n = e.amount;
          out.push({ key, label, apply: (d) => less(d, Math.max(0, d.amount - n)) });
          return;
        }
        // All of it. Vigor: "Put a +1/+1 counter on that creature for each 1 damage prevented this way." (CR 615.5)
        const then = e.then as EffectNode[] | undefined;
        // "remove a +1/+1 counter from this creature": once for all the damage dealt to it at once — unless what it does
        // goes by how much was prevented.
        const once = batched && !JSON.stringify(then).includes('"kind":"event"');
        const holderRef = { id: holder.id, zcc: holder.zcc };
        const controller = holder.controller;
        out.push({
          key,
          label,
          apply: (d) =>
            less(
              d,
              0,
              then
                ? [
                    {
                      key: '',
                      late: true,
                      run: (game, _o, events) => {
                        const again = once && together?.has(batch);
                        if (batched) together?.add(batch);
                        if (!again) followUp(game, { effects: then, controller, source: holderRef, about: 'recipient' }, d.amount, d.source, d.to, events);
                      },
                    },
                  ]
                : [],
            ),
        });
      });
    }
    return out;
  },

  /** CR 615.6–615.7: prevention shields — "Prevent the next 3 damage that would be dealt to any target this turn." */
  shielded(g, h) {
    if (h.unpreventable || h.amount <= 0) return [];
    const out: Replacement<Damage>[] = [];
    const { source, to, combat } = h;
    for (const p of g.prevention) {
      if ((p.turn !== g.turn && p.untilTurnOf === undefined) || (p.combat && !combat)) continue;
      if (!(p.amount === 'all' || p.amount > 0)) continue;
      if (p.to) {
        const hit = p.to.kind === 'player' ? to.kind === 'player' && to.player === p.to.player : p.to.kind === 'object' && to.kind === 'permanent' && to.object === p.to.id && g.objects[p.to.id]?.zcc === p.to.zcc;
        if (!hit) continue;
      }
      if (p.by && !(p.by.kind === 'object' && p.by.id === source.id && p.by.zcc === source.zcc)) continue;
      const fctx = { controller: p.controller ?? source.controller, source: null, anyZone: true };
      if (p.byFilter && !matchesFilter(g, source, p.byFilter, fctx)) continue;
      if (p.toFilter && !(to.kind === 'permanent' && g.objects[to.object] && matchesFilter(g, g.objects[to.object]!, p.toFilter, fctx))) continue;
      out.push({
        key: `shield:${p.id}`,
        label: 'An effect this turn: prevent that damage',
        apply: (d) => {
          // "The next time … would deal damage": all of it, and the shield is gone. CR 615.7: "the next N": that much.
          const used = p.once || p.amount === 'all' ? d.amount : Math.min(p.amount, d.amount);
          const then = p.then;
          return {
            ...less(d, d.amount - used, [
              {
                key: '',
                // What the shield has given is gone from it; with nothing left to give, so is the shield.
                run: (game) => {
                  const shield = game.prevention.find((x) => x.id === p.id);
                  if (!shield) return;
                  if (shield.once) shield.amount = 0;
                  else if (shield.amount !== 'all') shield.amount -= used;
                  if (shield.amount !== 'all' && shield.amount <= 0) game.prevention = game.prevention.filter((x) => x !== shield);
                },
              },
              ...(then && used > 0 ? [{ key: '', late: true as const, run: (game: GameState, _o: GameObject, events: GameEvent[]) => followUp(game, then, used, d.source, d.to, events) }] : []),
            ]),
            spent: d.spent + (p.once ? 1 : p.amount === 'all' ? 0 : used),
          };
        },
      });
    }
    return out;
  },

  /** CR 702.16e, 702.16j: damage from a source the player or permanent has protection from is prevented. */
  protected(g, h) {
    if (h.unpreventable || h.amount <= 0) return [];
    const { source, to } = h;
    if (to.kind === 'player') {
      if (!playerProtectedFrom(g, to.player, source)) return [];
      return [{ key: `protection:${to.player}`, label: 'Protection from its source: the damage is prevented', apply: (d) => less(d, 0) }];
    }
    const o = g.objects[to.object];
    if (!o || o.zone !== 'battlefield' || !hasProtectionFrom(g, o, source)) return [];
    return [{ key: `protection:${o.id}`, label: 'Protection from its source: the damage is prevented', apply: (d) => ({ ...d, amount: 0 }) }];
  },

  /**
   * CR 122.1c: a shield counter is removed instead — a replacement, not prevention: it works even when damage can't be
   * prevented.
   */
  shield_counter(g, h) {
    if (h.amount <= 0 || h.to.kind !== 'permanent') return [];
    const o = g.objects[h.to.object];
    if (!o || o.zone !== 'battlefield' || (o.counters.shield ?? 0) <= 0) return [];
    // (Worth more than anything a turn's prevention has left to give: it stays, and it stands in for destruction too.)
    return [{ key: `shield_counter:${o.id}`, label: 'Its shield counter: remove it instead', apply: (d) => ({ ...d, amount: 0, spent: d.spent + 1000, also: [...d.also, { key: '', run: (_g, _o, events) => void removeShield(o, events) }] }) }];
  },
};

/** CR 616.1: the one dealt the damage orders the effects — taken to be for the least damage, then for the least used up. */
export const leastDamage = (a: Damage | null, b: Damage | null): number => (b?.amount ?? 0) - (a?.amount ?? 0) || (b?.spent ?? 0) - (a?.spent ?? 0);
