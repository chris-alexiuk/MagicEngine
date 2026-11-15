import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId, Target } from '../src/index.js';
import { relatedPick } from '../src/index.js';
import { createBot } from '../scripts/lib/bot.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

/**
 * CR 115.3: the targets chosen for one "target" are checked as a whole — "two target creatures controlled by different
 * players", "any number of target permanents with total mana value 6 or less". Not every set of the candidates is a
 * legal choice, so the prompt says how they must be related: a client (the table, the bot of the random games) can
 * then choose a set the engine takes.
 */
const card = (name: string, type_line: string, oracle_text: string, more: Record<string, string | number> = {}) => makeCard({ name, type_line, oracle_text, mana_cost: '{0}', ...more });
const CARDS = [
  // Kitsune, Dragon's Daughter.
  card('Trader', 'Creature — Fox', 'When this creature enters, you may exchange control of two other target creatures controlled by different players.', { power: '2', toughness: '2' }),
  // The Super Hero Civil War, chapter I.
  card('Recruiter', 'Creature — Human', 'When this creature enters, gain control of up to two target creatures with total mana value 6 or less until end of turn.', { power: '1', toughness: '1' }),
  card('Ox', 'Creature — Ox', '', { power: '4', toughness: '4', mana_cost: '{4}', cmc: 4 }),
  card('Cub', 'Creature — Bear', '', { power: '2', toughness: '2', mana_cost: '{2}', cmc: 2 }),
];
const obj = (id: string): Target => ({ kind: 'object', object: id });
const enters = (g: GameState, name: string): GameState => act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), autoTap: true });
/** The spell resolves: its enters trigger asks for targets. */
const asked = (g: GameState) => {
  for (let i = 0; i < 6 && !g.pending; i++) g = passRound(g);
  if (g.pending?.kind !== 'trigger_targets') throw new Error(`expected a trigger's targets to be asked for, got ${g.pending?.kind}`);
  return { g, prompt: g.pending.prompts[0]! };
};
const answer = (g: GameState, player: PlayerId, targets: Target[][]) => ({ type: 'choose' as const, player, answer: { kind: 'trigger_targets' as const, targets } });

describe('CR 115.3: a prompt for targets that must be related says so', () => {
  it('"controlled by different players": the prompt says it, and a related pair is taken', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [a1, a2] = [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'alice', 'Ox', 'battlefield')];
    const b1 = give(g, 'bob', 'Cub', 'battlefield');
    const { g: waiting, prompt } = asked(enters(g, 'Trader'));
    g = waiting;
    expect(prompt).toMatchObject({ count: 2, related: { differentControllers: true } });
    // Two of Alice's own: refused, as the text says.
    expect(illegal(g, answer(g, 'alice', [[obj(a1), obj(a2)]]))).toMatch(/controlled by different players/);
    const pick = relatedPick(g, prompt.related!, prompt.candidates, prompt.count);
    expect(pick).toHaveLength(2);
    expect(pick).toContainEqual(obj(b1));
    g = act(g, answer(g, 'alice', [pick]));
    expect(g.stack).toHaveLength(1);
  });

  it('"with total mana value 6 or less": the number is on the prompt', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [ox1, ox2, cub] = [give(g, 'bob', 'Ox', 'battlefield'), give(g, 'bob', 'Ox', 'battlefield'), give(g, 'bob', 'Cub', 'battlefield')];
    const { g: waiting, prompt } = asked(enters(g, 'Recruiter'));
    g = waiting;
    expect(prompt).toMatchObject({ count: 2, upTo: true, related: { maxTotalMV: 6 } });
    expect(illegal(g, answer(g, 'alice', [[obj(ox1), obj(ox2)]]))).toMatch(/total mana value 6 or less/);
    g = act(g, answer(g, 'alice', [[obj(ox1), obj(cub)]]));
    expect(g.stack).toHaveLength(1);
  });

  it('a prompt for unrelated targets says nothing of the kind', () => {
    let g = toStep(start({ extra: [...CARDS, card('Pinger', 'Creature — Imp', 'When this creature enters, it deals 1 damage to each of up to two target creatures.', { power: '1', toughness: '1' })] }), 'main1', 'alice');
    give(g, 'bob', 'Cub', 'battlefield');
    give(g, 'bob', 'Ox', 'battlefield');
    expect(asked(enters(g, 'Pinger')).prompt.related).toBeUndefined();
  });

  it('the bot of the random games answers such prompts with sets the engine takes', () => {
    for (const name of ['Trader', 'Recruiter']) {
      for (let seed = 1; seed <= 40; seed++) {
        let state = seed;
        const rnd = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
        let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
        for (const n of ['Cub', 'Ox', 'Ox']) give(g, 'alice', n, 'battlefield');
        for (const n of ['Ox', 'Cub', 'Ox']) give(g, 'bob', n, 'battlefield');
        g = asked(enters(g, name)).g;
        const a = createBot({ rnd }).answerFor(g)!;
        expect(() => act(g, { type: 'choose', player: a.player, answer: a.answer })).not.toThrow();
      }
    }
  });
});
