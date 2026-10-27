import { describe, expect, it } from 'vitest';
import { legalActions, type GameState } from '../src/index.js';
import { faceOf, moveObject } from '../src/zones.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const room = makeCard({
  name: 'Bright Hall // Dark Cellar',
  type_line: 'Enchantment — Room // Enchantment — Room',
  layout: 'split',
  card_faces: [
    { name: 'Bright Hall', type_line: 'Enchantment — Room', mana_cost: '{1}', oracle_text: 'When you unlock this door, you gain 2 life.' },
    { name: 'Dark Cellar', type_line: 'Enchantment — Room', mana_cost: '{2}', oracle_text: 'When you unlock this door, you gain 5 life.\nWhenever you fully unlock a Room, draw a card.' },
  ],
} as never);
const dread = makeCard({
  name: 'Dread Hall // Dread Vault',
  type_line: 'Enchantment — Room // Enchantment — Room',
  layout: 'split',
  card_faces: [
    { name: 'Dread Hall', type_line: 'Enchantment — Room', mana_cost: '{1}', oracle_text: 'When you unlock this door, manifest dread, then put three +1/+1 counters on that creature.' },
    { name: 'Dread Vault', type_line: 'Enchantment — Room', mana_cost: '{1}', oracle_text: 'Spirits you control get +1/+1.' },
  ],
} as never);
const watcher = makeCard({
  name: 'Eerie Watcher',
  type_line: 'Enchantment Creature — Spirit',
  mana_cost: '{0}',
  power: '1',
  toughness: '1',
  oracle_text: 'Eerie — Whenever this creature or another enchantment you control enters and whenever you fully unlock a Room, you gain 1 life.',
});
const key = makeCard({ name: 'Room Key', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}: Add {C}. Spend this mana only to unlock doors.' });
const bear = makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' });
const settle = (g: GameState) => {
  while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
  return g;
};

describe('CR 709.5: Rooms', () => {
  it('cast one door; it enters unlocked (its trigger fires); unlock the other as a special action', () => {
    let g = toStep(start({ extra: [room] }), 'main1');
    const r = give(g, 'alice', 'Bright Hall // Dark Cellar', 'hand');
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 };
    g = settle(act(g, { type: 'cast', player: 'alice', object: r, face: 0 }));
    expect(g.objects[r]!.unlocked).toEqual([true, false]);
    expect(faceOf(g, g.objects[r]!).name).toBe('Bright Hall');
    expect(g.players.alice!.life).toBe(22);
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 };
    expect(legalActions(g, 'alice').some((a) => a.type === 'unlock' && a.object === r && a.half === 1)).toBe(true);
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'unlock', player: 'alice', object: r, half: 1 }));
    expect(g.objects[r]!.unlocked).toEqual([true, true]);
    expect(faceOf(g, g.objects[r]!).name).toBe('Bright Hall // Dark Cellar');
    expect(g.players.alice!.life).toBe(27);
    // "Whenever you fully unlock a Room" — on the door just unlocked.
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('a Room put onto the battlefield without being cast has both doors locked (CR 709.5d); elsewhere it has both halves', () => {
    let g = toStep(start({ extra: [room] }), 'main1');
    const r = give(g, 'alice', 'Bright Hall // Dark Cellar', 'graveyard');
    expect(faceOf(g, g.objects[r]!).name).toBe('Bright Hall');
    moveObject(g, r, 'battlefield', [], { controller: 'alice' });
    expect(g.objects[r]!.unlocked).toEqual([false, false]);
    expect(faceOf(g, g.objects[r]!).name).toBe('');
    expect(faceOf(g, g.objects[r]!).abilities).toEqual([]);
    expect(legalActions(g, 'alice').filter((a) => a.type === 'unlock')).toEqual([]);
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 3 };
    expect(legalActions(g, 'alice').filter((a) => a.type === 'unlock').length).toBe(2);
    moveObject(g, r, 'hand', []);
    expect(g.objects[r]!.unlocked).toBeUndefined();
  });

  it('doors are unlocked only at sorcery timing, with mana that may be spent to unlock doors', () => {
    let g = toStep(start({ extra: [room, key, bear] }), 'main1');
    const r = give(g, 'alice', 'Bright Hall // Dark Cellar', 'hand');
    const k = give(g, 'alice', 'Room Key', 'battlefield');
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 };
    g = settle(act(g, { type: 'cast', player: 'alice', object: r, face: 0 }));
    // The key's mana can't cast a creature, but it can unlock a door.
    const b = give(g, 'alice', 'Bear', 'hand');
    g.cards.Bear!.faces[0]!.manaCost = '{1}';
    g = act(g, { type: 'activate_mana', player: 'alice', object: k, ability: 0 } as never);
    expect(() => act(g, { type: 'cast', player: 'alice', object: b })).toThrow(/mana/);
    g.players.alice!.pool.C = 1;
    expect(() => act(g, { type: 'unlock', player: 'alice', object: r, half: 1 })).not.toThrow();
    g = toStep(g, 'beginning_of_combat');
    g.objects[r]!.unlocked = [true, false];
    g.players.alice!.pool.C = 2;
    expect(() => act(g, { type: 'unlock', player: 'alice', object: r, half: 1 })).toThrow(/main phase/);
  });

  it('manifest dread: one of the top two face down, the other into the graveyard; "that creature" is the manifested one', () => {
    let g = toStep(start({ extra: [dread, watcher] }), 'main1');
    const r = give(g, 'alice', 'Dread Hall // Dread Vault', 'hand');
    give(g, 'alice', 'Eerie Watcher', 'battlefield');
    const top = g.zones.library.alice!.slice(0, 2);
    const life = g.players.alice!.life;
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 };
    g = act(g, { type: 'cast', player: 'alice', object: r, face: 1 });
    g = settle(g);
    // Eerie: the Room (an enchantment) entered.
    expect(g.players.alice!.life).toBe(life + 1);
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 };
    g = act(g, { type: 'unlock', player: 'alice', object: r, half: 0 });
    // The door's trigger and Eerie ("fully unlock a Room") both trigger.
    for (let i = 0; i < 10 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'choose_objects') {
        expect(g.pending.candidates).toEqual(top);
        g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [top[1]!] } });
      } else if (g.pending) throw new Error(`unexpected ${g.pending.kind}`);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.players.alice!.life).toBe(life + 2);
    const m = g.objects[top[1]!]!;
    expect(m.zone).toBe('battlefield');
    expect(m.faceDown).toBe('manifest');
    expect(m.counters['+1/+1']).toBe(3);
    expect(g.objects[top[0]!]!.zone).toBe('graveyard');
  });
});
