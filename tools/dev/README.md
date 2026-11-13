# Growing card coverage: the slice loop

Coverage grows one "slice" at a time: a handful of cards, the grammar and engine support they need,
tests, and a fuzz run. These scripts are that loop.

**You need a compiled card pool** (`cards.json.gz`). The `Reference data` workflow publishes the
current one to the `reports` branch after every engine or compiler change:

```
git fetch origin reports && git show FETCH_HEAD:cards.json.gz > /tmp/pool.json.gz
```

## One slice

1. **Pick cards.** `tools/dev/pool.py nonfull POOL 1 3000` lists the most-played cards that aren't
   fully automatic, with the lines the compiler couldn't read. `pool.py templates POOL` shows the
   most common unread openings; `pool.py grep POOL 'regex'` finds every card with a wording.
2. **See what the compiler makes of the text.** `tools/dev/probe.sh --card POOL "Card Name"`, or
   `probe.sh "Creature — Elf" "Some rules text."` for a line you're working on.
3. **Teach it.** Grammar in `packages/compiler/src/grammar`, node types in `packages/schema`,
   behaviour in `packages/engine/src`. A node the engine has no handler for fails the tests.
4. **Test with the real text.** `packages/engine/test/helpers.ts` compiles cards from Oracle text
   (`makeCard`), so a test plays the card as written.
5. **Reparse the pool and compare.**
   ```
   (cd packages/compiler && npx tsx scripts/reparse.ts POOL --save /tmp/new.json.gz)
   tools/dev/pool.py gained POOL /tmp/new.json.gz     # what became full — and what stopped being
   tools/dev/pool.py astdiff POOL /tmp/new.json.gz    # full cards whose reading changed: check each
   tools/dev/pool.py lines POOL /tmp/new.json.gz "Card A" "Card B"   # how the new lines were read
   ```
   Every card in `gained` that you didn't write a test for needs its new lines read by eye. A card
   whose text the engine would play wrongly must stay unread — grading is honest.
6. **Fuzz.** `pool.py focus POOL /tmp/new.json.gz /tmp/focus.txt` then
   `tools/dev/fuzz-all.sh /tmp/new.json.gz SEED /tmp/focus.txt` — the pool you just reparsed, played
   as it is. Three runs: two-player games, four-player Commander games, and three-player Commander
   games with decks built from the focus cards. Zero crashes, refused moves and invariants; the
   script exits non-zero otherwise, and says so if a run died without a summary.
7. `pnpm typecheck && pnpm test && pnpm rules:trace` (not `pnpm -s typecheck`: `-s` hides the
   compiler's errors — go by the exit code), add a line to `docs/ARCHITECTURE.md`, commit.

## Checking the grades

`pool.py sample POOL 60 SEED [LO HI]` draws random full cards (optionally by rank) with their
compiled abilities, for a reviewer to compare against the Oracle text and test the doubtful ones.
The November 2026 audit did this for 120 cards and found 8 played wrongly; its cases are
`packages/engine/test/audit-a.test.ts` and `audit-b.test.ts`. A card found wrong is fixed or its
line goes back to unread — never left full.
