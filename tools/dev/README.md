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
   whose text the engine would play wrongly must stay unread — grading is honest. (A reparse keeps what
   the sandbox found on a card, so the two pools compare like for like; the next sandbox run starts fresh.)
6. **Play the cards.** The sandbox plays every card once on a standard board, the ways the engine offers, and
   says what changed since the pool you started from:
   ```
   git show FETCH_HEAD:checks.json.gz > /tmp/checks.json.gz      # the last run's results (reports branch)
   (cd packages/engine && npx tsx scripts/sandbox.ts /tmp/new.json.gz --jobs 2 \
      --out /tmp/new-checks.json.gz --baseline /tmp/checks.json.gz --report /tmp/changes.md)
   ```
   About a quarter of an hour for the whole pool on two cores; `--top 3000` or `--card "Name" --trace` for less.
   Read `/tmp/changes.md`: **played differently** should be the cards you meant to change and no others; **a
   certain problem that is new** is a bug; **no longer fully automatic** needs a `Regrades: N` line in the commit
   message, or CI fails. A card you made full should show its runs doing what its text says
   (`--card "Name"` prints what each run changed). After the push, read `status.txt` and `changes.md` on the
   `reports` branch: a failed check is an alarm raised once — the next run compares with what that one published.
7. **Fuzz.** `pool.py focus POOL /tmp/new.json.gz /tmp/focus.txt` then
   `tools/dev/fuzz-all.sh /tmp/new.json.gz SEED /tmp/focus.txt` — the pool you just reparsed, played
   as it is. Three runs: two-player games, four-player Commander games, and three-player Commander
   games with decks built from the focus cards. Zero crashes, refused moves and invariants; the
   script exits non-zero otherwise, and says so if a run died without a summary.
8. `pnpm typecheck && pnpm test && pnpm rules:trace` (not `pnpm -s typecheck`: `-s` hides the
   compiler's errors — go by the exit code), add a line to `docs/ARCHITECTURE.md`, commit.

A new parameter on a node (`reparse` says "parameters outside NODE_FIELDS") has to be declared in
`packages/schema/src/node-fields.ts`. Before declaring one that a single card uses, ask whether a filter, an
amount or a condition already says it: those work for every kind of node at once.

## Checking the grades

A card is fully automatic when every line was read **and** the sandbox found no certain problem playing it
(`packages/engine/scripts/lib/sandbox.ts`; the data workflow runs it on every card after each change and
corrects the grades, `CardDef.issues`). The sandbox sees what is grossly wrong — a crash, an action offered and
refused, a card that can't be cast, a spell that does nothing — and, through its fingerprints, any change in
how a card plays. It does not see a card that does something plausible and wrong; that still takes reading:

`pool.py sample POOL 60 SEED [LO HI]` draws random full cards (optionally by rank) with their
compiled abilities, for a reviewer to compare against the Oracle text and test the doubtful ones.
The November 2026 audit did this for 120 cards and found 8 played wrongly; its cases are
`packages/engine/test/audit-a.test.ts` and `audit-b.test.ts`. A card found wrong is fixed or its
line goes back to unread — never left full.
