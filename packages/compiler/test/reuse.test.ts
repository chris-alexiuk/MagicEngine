import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CardDBMeta } from '@mtg/schema';
import { compilerHash, reusableDB } from '../src/reuse.js';

// A build takes the last card DB as it is only when it would make the same one: same two Scryfall files, same compiler.
describe('reusing the last card DB', () => {
  const compiler = compilerHash();
  const key = { oracle: '2026-11-14T10:02:08.197+00:00', printings: '2026-11-14T10:09:41.001+00:00', compiler };
  const saved = (meta: Partial<CardDBMeta>, body = 'the card db') => {
    const dir = mkdtempSync(join(tmpdir(), 'reuse-'));
    writeFileSync(join(dir, 'cards.json.gz'), body);
    const sha256 = createHash('sha256').update('the card db').digest('hex');
    writeFileSync(join(dir, 'cards.meta.json'), JSON.stringify({ schema: 2, builtAt: 'then', cardCount: 1, tokenCount: 0, bytes: 11, sha256, coverage: { full: 1, partial: 0, manual: 0 }, sourceUpdatedAt: key.oracle, printingsUpdatedAt: key.printings, compiler, ...meta }));
    return dir;
  };

  it('the same sources and compiler: reused', async () => {
    expect(await reusableDB(saved({}), key)).toMatchObject({ builtAt: 'then', cardCount: 1 });
  });

  it('newer card data, newer printings, or another compiler: not', async () => {
    expect(await reusableDB(saved({ sourceUpdatedAt: '2026-11-13T10:02:08.197+00:00' }), key)).toBeNull();
    expect(await reusableDB(saved({ printingsUpdatedAt: '2026-11-13T10:09:41.001+00:00' }), key)).toBeNull();
    expect(await reusableDB(saved({ compiler: 'an earlier one' }), key)).toBeNull();
    // A DB built before these were recorded says nothing about them.
    expect(await reusableDB(saved({ compiler: undefined }), key)).toBeNull();
  });

  it('a file that isn\'t the one its meta describes: not', async () => {
    expect(await reusableDB(saved({}, 'something else'), key)).toBeNull();
    expect(await reusableDB(mkdtempSync(join(tmpdir(), 'reuse-')), key)).toBeNull();
  });

  it('the compiler hash is the same from one call to the next', () => {
    expect(compilerHash()).toBe(compiler);
    expect(compiler).toMatch(/^[0-9a-f]{32}$/);
  });
});
