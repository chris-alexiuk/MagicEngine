import { describe, expect, it } from 'vitest';
import { buildBoards, checkCard, type CardReport } from '../scripts/lib/sandbox.js';
import { CARDS, makeCard } from './helpers.js';

// The card sandbox (scripts/lib/sandbox.ts): every card played once on a standard board. These are its own tests —
// that it sees what it is there to see, and that the cards the other tests are written with pass it.

const boards = buildBoards();
const check = (fields: Parameters<typeof makeCard>[0]): CardReport => checkCard(makeCard(fields), boards);
const labels = (r: CardReport) => r.runs.map((x) => `${x.label} @${x.board}: ${x.outcome}`);

describe('the boards', () => {
  it('are the situations a card is tried in, each with me to act', () => {
    expect(boards.map((b) => b.name)).toEqual(['main', 'respond', 'mine', 'charging', 'attacking', 'aftermath', 'attacked', 'defending']);
    for (const b of boards) {
      expect(b.g.priority).toBe('p1');
      expect(b.g.pending).toBeNull();
      expect(b.g.stack).toHaveLength(b.stack);
    }
    const at = (name: string) => boards.find((b) => b.name === name)!.g;
    expect([at('main').step, at('main').active]).toEqual(['main1', 'p1']);
    // An opponent's turn, with their spells and an ability to answer; my own turn, with my own spells to copy.
    expect(at('respond').active).toBe('p2');
    expect(at('respond').stack.map((e) => e.kind)).toEqual(['spell', 'spell', 'spell', 'spell', 'ability']);
    expect(at('mine').stack.map((e) => e.controller)).toEqual(['p1', 'p1']);
    // CR 508, 509: my attack before blockers and after them; CR 505: the main phase that follows it.
    expect([at('charging').step, at('attacking').step, at('aftermath').step]).toEqual(['declare_attackers', 'declare_blockers', 'main2']);
    expect(Object.keys(at('attacking').combat?.attackers ?? {})).toHaveLength(3);
    // My Bear (3 power with the Blade) and Drake got through; the Giant killed the Golem that blocked it and was dealt 3.
    expect(at('aftermath').players.p2!.life).toBe(35);
    expect(Object.values(at('aftermath').objects).some((o) => o.card === 'Sandbox Giant' && o.controller === 'p1' && o.damage === 3)).toBe(true);
    // An opponent's attack on me, before and after I block.
    expect([at('attacked').step, at('defending').step]).toEqual(['declare_attackers', 'declare_blockers']);
    expect(at('attacked').active).toBe('p2');
  });
});

describe('what the sandbox reports', () => {
  it('a spell that does what it says: where it was played, how it ended, what changed', () => {
    const r = check({ name: 'Test Shock', type_line: 'Instant', mana_cost: '{R}', oracle_text: 'Test Shock deals 2 damage to target player.' });
    expect(r.issues).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(labels(r)).toEqual(['cast @main: resolved']);
    expect(r.runs[0]!.did).toEqual(['p1.life 40→38']);
  });

  it('a creature and each of its abilities', () => {
    const r = check({ name: 'Test Elf', type_line: 'Creature — Elf Druid', mana_cost: '{G}', power: '1', toughness: '1', oracle_text: '{T}: Add {G}.\n{2}{G}: Test Elf gets +2/+2 until end of turn.' });
    expect(r.issues).toEqual([]);
    expect(labels(r)).toEqual(['cast @main: resolved', 'mana 0 @main: done', 'ability 0 @main: resolved']);
  });

  it('a spell with nothing to answer in my own turn is played where there is', () => {
    const r = check({ name: 'Test Counter', type_line: 'Instant', mana_cost: '{U}{U}', oracle_text: 'Counter target spell.' });
    expect(r.issues).toEqual([]);
    expect(labels(r)).toEqual(['cast @respond: resolved']);
  });

  it('a spell that does nothing in my main phase is tried in combat', () => {
    const r = check({ name: 'Test Recall', type_line: 'Instant', mana_cost: '{U}', oracle_text: "Return all attacking creatures to their owners' hands." });
    expect(r.warnings).toEqual([]);
    expect(labels(r)).toEqual(['cast @charging: resolved']);
  });

  it('each mode of a modal spell', () => {
    const r = check({ name: 'Test Charm', type_line: 'Instant', mana_cost: '{R}', oracle_text: 'Choose one —\n• Test Charm deals 2 damage to target player.\n• Destroy target artifact.' });
    expect(r.issues).toEqual([]);
    expect(labels(r)).toEqual(['cast @main: resolved', 'cast modes 1 @main: resolved']);
  });

  it('CR 704.5f: a creature whose size is in a line the engine cannot read is asked for, and stays (it used to die as it arrived)', () => {
    const r = check({ name: 'Test Blob', type_line: 'Creature — Ooze', mana_cost: '{1}{G}', power: '*', toughness: '*', oracle_text: "Test Blob's power and toughness are each equal to the number of bananas in your pockets." });
    expect(r.issues).toEqual([]);
    expect(r.runs[0]!.zone).toBe('battlefield');
    expect(r.runs[0]!.did).toContain('self: handPT ∅→{"power":2,"toughness":2}');
  });

  it('read in full, a creature that dies as it arrives is something to look at: it may be the board', () => {
    const r = check({ name: 'Test Wisp', type_line: 'Creature — Spirit', mana_cost: '{1}{U}', power: '0', toughness: '0', oracle_text: 'Test Wisp gets +1/+1 for each Equipment attached to it.' });
    expect(r.issues).toEqual([]);
    expect(r.warnings).toEqual(['cast: enters and dies with 0 toughness on this board']);
  });

  it('a creature that leaves by its own doing is no problem', () => {
    const r = check({ name: 'Test Mayfly', type_line: 'Creature — Insect', mana_cost: '{G}', power: '1', toughness: '1', oracle_text: 'When Test Mayfly enters, sacrifice it.' });
    expect(r.issues).toEqual([]);
    expect(r.runs[0]!.zone).toBe('graveyard');
  });

  it('a spell that resolves and changes nothing is something to look at', () => {
    const r = check({ name: 'Test Nothing', type_line: 'Sorcery', mana_cost: '{W}', oracle_text: 'You gain 0 life.' });
    expect(r.issues).toEqual([]);
    expect(r.warnings).toEqual(['cast: resolved and changed nothing']);
  });

  it('"untap target creature" is aimed at a tapped one before it counts as doing nothing', () => {
    const r = check({ name: 'Test Wake', type_line: 'Instant', mana_cost: '{U}', oracle_text: 'Untap target creature.' });
    expect(r.warnings).toEqual([]);
    expect(r.runs[0]!.did).toEqual(['Sandbox Soldier@p1#3: tapped true→false']);
  });

  it('an ability the board has no use for is a note, with what the engine says to it', () => {
    const r = check({ name: 'Test Altar', type_line: 'Artifact', mana_cost: '{1}', oracle_text: '{T}, Sacrifice three Goats: Draw a card.' });
    expect(r.issues).toEqual([]);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatch(/^ability 0: not offered \(/);
  });

  it('a land is played, and tapped for mana', () => {
    const r = check({ name: 'Test Grove', type_line: 'Land', oracle_text: '{T}: Add {G} or {W}.' });
    expect(r.issues).toEqual([]);
    expect(labels(r)).toEqual(['play land @main: played', 'mana 0 @main: done']);
  });

  it('a cost the lands on the board cannot pay is paid from a pool of every color, and noted', () => {
    const r = check({ name: 'Test Wurm', type_line: 'Creature — Wurm', mana_cost: '{G}{G}{G}{G}{G}{G}', power: '6', toughness: '6', oracle_text: '' });
    expect(r.issues).toEqual([]);
    expect(r.notes).toEqual(['costs more mana of one color than the board has lands for']);
    expect(labels(r)).toEqual(['cast @main: resolved']);
  });
});

describe('fingerprints', () => {
  const bolt = (n: number) => check({ name: 'Test Bolt', type_line: 'Instant', mana_cost: '{R}', oracle_text: `Test Bolt deals ${n} damage to any target.` });

  it('are the same every time for the same card and engine', () => {
    expect(bolt(3).fp).toBe(bolt(3).fp);
  });

  it('change when what the card does changes', () => {
    expect(bolt(3).fp).not.toBe(bolt(4).fp);
  });
});

describe('the cards the tests are written with', () => {
  it('have no certain problem in the sandbox', () => {
    const bad = Object.values(CARDS)
      .filter((c) => c.automation === 'full')
      .map((c) => checkCard(c, boards))
      .filter((r) => r.issues.length)
      .map((r) => `${r.name}: ${r.issues.join('; ')}`);
    expect(bad).toEqual([]);
  });
});
