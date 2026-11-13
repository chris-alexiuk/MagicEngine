#!/bin/bash
# The fuzz gate a slice must pass before it is committed: random games played only with moves the
# engine lists as legal, checking for crashes, refused moves and broken invariants.
#
#   tools/dev/fuzz-all.sh POOL SEED [FOCUS_FILE] [SNAPSHOT_DIR]
#
#   POOL          a card pool compiled by this checkout (the `--save` of a reparse): it is played as it is
#   SEED          any number; note it in the commit so a failure can be replayed
#   FOCUS_FILE    a file holding a regex of card names (tools/dev/pool.py focus …): a third run
#                 builds its decks from those cards, so the slice's new cards actually get played
#   SNAPSHOT_DIR  where to copy the working tree first (default: a new temp dir), so the tree can
#                 keep changing while the games run; the fuzzed snapshot is what gets committed
#
# Three runs: two-player games, four-player Commander games (commanders, the tax, the command zone),
# and three-player Commander games with decks built from the focus cards. The two broad runs go in
# parallel; the focused run follows. Prints each run's summary lines; exits non-zero on any failure.
set -u
POOL=$(realpath "$1")
SEED=${2:-1}
FOCUS=${3:-}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SNAP=${4:-$(mktemp -d)}
rm -rf "$SNAP" && mkdir -p "$SNAP"
(cd "$ROOT" && tar --exclude=./.git -cf - .) | tar -xf - -C "$SNAP"
echo "snapshot: $SNAP"
cd "$SNAP/packages/engine" || exit 1

# A run that dies without its summary (out of memory, say) must not look like a pass.
run() {
  local out="$1"; shift
  npx tsx scripts/fuzz.ts "$POOL" --as-is "$@" > "$out.log" 2>&1
  grep -E "games,|slowest|crash|rejected|invariant|×|e\.g\.|Error|X:|commander:" "$out.log" > "$out"
  grep -q "games," "$out" || echo "NO SUMMARY — the run died; see $out.log" >> "$out"
}

run "$SNAP/fuzz-2p.txt" --games 150 --seed "${SEED}1" --players 2 --top &
run "$SNAP/fuzz-4p.txt" --games 60 --seed "${SEED}2" --players 4 --format commander --top &
wait
if [ -n "$FOCUS" ]; then run "$SNAP/fuzz-focus.txt" --games 80 --seed "${SEED}3" --players 3 --format commander --focus "$(cat "$FOCUS")"; fi
cat "$SNAP"/fuzz-2p.txt "$SNAP"/fuzz-4p.txt "$SNAP"/fuzz-focus.txt 2>/dev/null
! grep -qE "NO SUMMARY|crash: [1-9]|rejected: [1-9]|invariant: [1-9]" "$SNAP"/fuzz-*.txt
