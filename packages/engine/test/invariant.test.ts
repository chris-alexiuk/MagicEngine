import { CORE_NODES } from '@mtg/schema';
import { describe, expect, it } from 'vitest';
import { CONDITION_TYPES } from '../src/conditions.js';
import { COST_TYPES } from '../src/payment.js';
import { hasEffectHandler, hasStaticHandler, hasTriggerMatcher } from '../src/index.js';

describe('the compiler/engine contract', () => {
  it('has a handler for every node tag the compiler can emit', () => {
    expect(CORE_NODES.effects.filter((t) => !hasEffectHandler(t))).toEqual([]);
    expect(CORE_NODES.statics.filter((t) => !hasStaticHandler(t))).toEqual([]);
    expect(CORE_NODES.triggers.filter((t) => !hasTriggerMatcher(t))).toEqual([]);
    expect(CORE_NODES.costs.filter((t) => !COST_TYPES.includes(t))).toEqual([]);
    expect(CORE_NODES.conditions.filter((t) => !CONDITION_TYPES.includes(t))).toEqual([]);
  });
});
