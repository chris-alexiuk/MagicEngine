import { readdirSync, readFileSync } from 'node:fs';
import { CORE_NODES, NODE_FIELDS } from '@mtg/schema';
import { describe, expect, it } from 'vitest';
import { CONDITION_TYPES } from '../src/conditions.js';
import { COST_TYPES } from '../src/payment.js';
import { AMOUNT_KINDS } from '../src/resolve.js';
import { hasEffectHandler, hasStaticHandler, hasTriggerMatcher } from '../src/index.js';

describe('the compiler/engine contract', () => {
  it('has a handler for every node tag the compiler can emit', () => {
    expect(CORE_NODES.effects.filter((t) => !hasEffectHandler(t))).toEqual([]);
    expect(CORE_NODES.statics.filter((t) => !hasStaticHandler(t))).toEqual([]);
    expect(CORE_NODES.triggers.filter((t) => !hasTriggerMatcher(t))).toEqual([]);
    expect(CORE_NODES.costs.filter((t) => !COST_TYPES.includes(t))).toEqual([]);
    expect(CORE_NODES.conditions.filter((t) => !CONDITION_TYPES.includes(t))).toEqual([]);
    expect(CORE_NODES.amounts.filter((t) => !AMOUNT_KINDS.includes(t))).toEqual([]);
  });

  it('gives an object no keyword of its own making that it would not apply', () => {
    // A keyword instance the engine builds itself ("gains haste", a suspected creature's menace, a bestowed Aura's
    // "enchant creature") has no compiled definition with it: it must be one the engine applies by its id.
    const dir = new URL('../src/', import.meta.url);
    const made: string[] = [];
    for (const f of readdirSync(dir).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(new URL(f, dir), 'utf8');
      for (const m of source.matchAll(/keywords(?:\.push\(|: \[)[^\n]*?\{ id: '([a-z_]+)'/g)) made.push(m[1]!);
    }
    expect(made.length).toBeGreaterThan(4);
    expect([...new Set(made)].filter((id) => !(CORE_NODES.keywords as readonly string[]).includes(id))).toEqual([]);
  });

  it('knows every parameter the compiler can put on a node (schema NODE_FIELDS)', () => {
    // A parameter the engine's source never names is one it can't be reading: the card would do less than it says.
    const dir = new URL('../src/', import.meta.url);
    const source = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => readFileSync(new URL(f, dir), 'utf8'))
      .join('\n');
    const names = [...new Set(Object.values(NODE_FIELDS).flat())];
    expect(names.length).toBeGreaterThan(400);
    expect(names.filter((name) => !new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(source))).toEqual([]);
  });
});
