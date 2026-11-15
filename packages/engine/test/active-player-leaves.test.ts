import { describe, expect, it } from 'vitest';
import { power } from '../src/index.js';
import { checkRules } from '../scripts/lib/rule-checks.js';
import { act, give, makeCard, passRound, start, toStep } from './helpers.js';

/**
 * CR 800.4: a player who leaves the game during their own turn. The engine ends that turn there (a simplification: by
 * the rules it runs on without an active player) — and a turn that ends, ends: nothing is left attacking or blocking
 * (CR 511.3), damage wears off and "until end of turn" effects end (CR 514.2) before the next player's turn begins.
 */
const CARDS = [makeCard({ name: 'Growth', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Target creature gets +3/+3 until end of turn.' })];

describe('CR 800.4: the active player leaves the game in their combat', () => {
  it('combat is over, damage has worn off and "until end of turn" has ended as the next turn begins', () => {
    let g = toStep(start({ players: 3, extra: CARDS }), 'main1', 'alice');
    const attacker = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    const theirs = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    for (let i = 0; i < 12 && g.pending?.kind !== 'declare_attackers'; i++) g = act(g, { type: 'pass', player: g.priority! });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker, target: { kind: 'player', player: 'bob' } }] } });
    expect(g.step).toBe('declare_attackers');
    expect(Object.keys(g.combat!.attackers)).toEqual([attacker]);

    // Bob's creature grows until end of turn, and has been dealt damage this turn.
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Growth', 'hand'), autoTap: true, targets: [[{ kind: 'object', object: theirs }]] });
    g = passRound(g);
    expect(g.stack).toHaveLength(0);
    expect(power(g, g.objects[theirs]!)).toBe(5);
    g.objects[theirs]!.damage = 1;
    expect([g.step, g.priority]).toEqual(['declare_attackers', 'alice']);

    // Alice is at 0 life as she passes: she has lost before anyone else gets priority (CR 704.5a).
    const before = g;
    g.players.alice!.life = 0;
    g = act(g, { type: 'pass', player: 'alice' });
    expect(g.players.alice!.lost).toBe(true);
    expect(g.over).toBe(false);
    expect([g.active, g.turn]).toEqual(['bob', before.turn + 1]);
    expect(g.combat).toBeNull();
    expect(g.objects[theirs]!.damage).toBe(0);
    expect(power(g, g.objects[theirs]!)).toBe(2);
    expect(checkRules(g, before)).toBeNull();
  });
});
