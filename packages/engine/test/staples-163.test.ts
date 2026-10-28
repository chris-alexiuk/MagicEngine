import { describe, expect, it } from 'vitest';
import { chars, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Pest Infestation', type_line: 'Sorcery', mana_cost: '{X}{G}{G}', cmc: 2, colors: ['G'], color_identity: ['G'], oracle_text: 'Destroy up to X target artifacts and/or enchantments. Create twice X 1/1 black and green Pest creature tokens with "When this token dies, you gain 1 life."' }),
  makeCard({ name: 'Rock', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '' }),
  makeCard({ name: 'Glove', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: "Whenever equipped creature attacks, if it's the first combat phase of the turn, untap it. After this phase, there is an additional combat phase.\nEquip {3}" }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Iteration', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Look at the top three cards of your library. Put one of them into your hand, put one of them on the bottom of your library, and exile one of them. You may play the exiled card this turn.' }),
  makeCard({ name: 'Gearhulk', type_line: 'Artifact Creature — Construct', mana_cost: '{0}', power: '5', toughness: '4', oracle_text: 'Menace\nWhen this creature enters, you may destroy another target creature. If a creature is destroyed this way, you gain life equal to its toughness.' }),
  makeCard({ name: 'Wall', type_line: 'Creature — Wall', mana_cost: '{0}', power: '0', toughness: '5', oracle_text: 'Indestructible' }),
  makeCard({ name: 'Mirror', type_line: 'Creature — Shapeshifter', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{X}: Until end of turn, creatures you control have base power and toughness X/X and gain all creature types.' }),
  makeCard({ name: 'Elf Lord', type_line: 'Creature — Elf', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Other Elves you control get +1/+1.' }),
  makeCard({ name: 'Grounds', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Activated abilities of creatures you control cost {2} less to activate. This effect can't reduce the mana in that cost to less than one mana." }),
  makeCard({ name: 'Pinger', type_line: 'Creature — Human', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{3}{R}: This creature deals 1 damage to any target.\n{2}: You gain 1 life.' }),
  makeCard({ name: 'Consultation', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Choose a card name. Exile the top six cards of your library, then reveal cards from the top of your library until you reveal a card with the chosen name. Put that card into your hand and exile all other cards revealed this way.' }),
  makeCard({ name: 'Pact', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Exile the top card of your library. You may put that card into your hand unless it has the same name as another card exiled this way. Repeat this process until you put a card into your hand or you exile two cards with the same name, whichever comes first.' }),
  makeCard({ name: 'Target Card', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw a card.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const toTop = (g: GameState, p: string, id: string) => {
  const lib = g.zones.library[p]!;
  lib.splice(lib.indexOf(id), 1);
  lib.unshift(id);
};

describe('staples (slice 163)', () => {
  it('Pest Infestation: twice X Pests', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const rocks = [0, 1].map(() => give(g, 'bob', 'Rock', 'battlefield'));
    g.players.alice!.pool.G = 2;
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Pest Infestation', 'hand'), x: 2, targets: [rocks.map((object) => ({ kind: 'object' as const, object }))] }));
    for (const id of rocks) expect(g.objects[id]!.zone).toBe('graveyard');
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice')).toHaveLength(4);
  });

  it('Genji Glove: untaps and adds a combat only in the first combat phase', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const glove = give(g, 'alice', 'Glove', 'battlefield');
    g.objects[glove]!.attachedTo = { id: bear, zcc: g.objects[bear]!.zcc };
    g.clock++;
    const life = g.players.bob!.life;
    const attack = () => {
      g = toStep(g, 'beginning_of_combat');
      while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
      g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'bob' } }] } });
      for (let i = 0; i < 40 && g.step !== 'end_of_combat'; i++) {
        if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } } as never);
        else if (g.pending) break;
        else g = act(g, { type: 'pass', player: g.priority! });
      }
    };
    attack();
    expect(g.objects[bear]!.tapped).toBe(false);
    attack();
    // The second combat: no untap, no third combat.
    expect(g.objects[bear]!.tapped).toBe(true);
    expect(g.players.bob!.life).toBe(life - 4);
    g = toStep(g, 'end', 'alice');
    expect(g.turnLog.combatPhases).toBe(2);
  });

  it('Expressive Iteration: one to hand, one to the bottom, one to exile and playable', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [a, b, c] = g.zones.library.alice!.slice(0, 3);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Iteration', 'hand') }));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [b!] } });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [c!] } });
    g = settle(g);
    expect(g.objects[b!]!.zone).toBe('hand');
    expect(g.zones.library.alice!.at(-1)).toBe(c);
    expect(g.objects[a!]!.zone).toBe('exile');
    expect(g.mayPlay?.some((p) => p.object.id === a)).toBe(true);
  });

  it('Noxious Gearhulk: life only if the creature was destroyed', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const wall = give(g, 'bob', 'Wall', 'battlefield');
    const life = g.players.alice!.life;
    const cast = (target: string) => {
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Gearhulk', 'hand') });
      g = settle(g);
      if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: target }]] } });
      g = settle(g);
      if (g.pending?.kind === 'may') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    };
    cast(wall);
    expect(g.objects[wall]!.zone).toBe('battlefield');
    expect(g.players.alice!.life).toBe(life);
    cast(bear);
    expect(g.objects[bear]!.zone).toBe('graveyard');
    expect(g.players.alice!.life).toBe(life + 2);
  });

  it('Mirror Entity: base X/X and every creature type', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mirror = give(g, 'alice', 'Mirror', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    give(g, 'alice', 'Elf Lord', 'battlefield');
    g.players.alice!.pool.C = 4;
    g = settle(act(g, { type: 'activate', player: 'alice', object: mirror, ability: 0, x: 4 }));
    // 4/4, and now an Elf, so the lord's +1/+1 too.
    expect(chars(g, g.objects[bear]!).power).toBe(5);
    expect(chars(g, g.objects[mirror]!).subtypes).toContain('Elf');
  });

  it('Training Grounds: {2} less, never below one mana', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Grounds', 'battlefield');
    const pinger = give(g, 'alice', 'Pinger', 'battlefield');
    g.players.alice!.pool.R = 1;
    g.players.alice!.pool.C = 1;
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'activate', player: 'alice', object: pinger, ability: 0, targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.players.bob!.life).toBe(life - 1);
    expect(g.players.alice!.pool.C).toBe(0);
    // {2} becomes {1}, not {0}.
    g.players.alice!.pool.C = 0;
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === pinger && a.ability === 1)).toBe(false);
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: pinger, ability: 1 }));
    expect(g.players.alice!.pool.C).toBe(0);
  });

  it('Demonic Consultation: six exiled, then until the named card', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const target = give(g, 'alice', 'Target Card', 'library');
    const lib = g.zones.library.alice!;
    lib.splice(lib.indexOf(target), 1);
    lib.splice(8, 0, target);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Consultation', 'hand') }));
    expect(g.pending?.kind).toBe('choose_option');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: 'Target Card' } }));
    expect(g.objects[target]!.zone).toBe('hand');
    expect(g.zones.exile.filter((id) => g.objects[id]!.owner === 'alice')).toHaveLength(8);
    // Another name: the whole library goes.
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Consultation', 'hand') }));
    const options = (g.pending as { options: string[] }).options;
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: options.at(-1)! } }));
    expect(g.zones.library.alice).toHaveLength(0);
  });

  it('Tainted Pact: keep going until you take one or a name repeats', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const t = give(g, 'alice', 'Target Card', 'library');
    toTop(g, 'alice', t);
    const r1 = give(g, 'alice', 'Rock', 'library');
    toTop(g, 'alice', r1);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Pact', 'hand') }));
    expect(g.pending?.kind).toBe('may');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: false } });
    expect(g.pending?.kind).toBe('may');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    expect(g.objects[r1]!.zone).toBe('exile');
    expect(g.objects[t]!.zone).toBe('hand');
    // Two of the same name: it stops.
    const r2 = give(g, 'alice', 'Rock', 'library');
    const r3 = give(g, 'alice', 'Rock', 'library');
    toTop(g, 'alice', r2);
    toTop(g, 'alice', r3);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Pact', 'hand') }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: false } }));
    expect(g.pending).toBeFalsy();
    expect(g.objects[r2]!.zone).toBe('exile');
    expect(g.objects[r3]!.zone).toBe('exile');
  });
});
