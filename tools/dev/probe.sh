#!/bin/bash
# What does the compiler make of a piece of rules text?
#
#   tools/dev/probe.sh "TYPE LINE" "ORACLE TEXT" [NAME]
#   tools/dev/probe.sh Instant "Counter target spell unless its controller pays {1}."
#   tools/dev/probe.sh --card POOL "Card Name"        the real card, face by face
#   tools/dev/probe.sh --if "CONDITION"               the text as an intervening "if"
#
# Prints the lines left unread, then each compiled ability as JSON (source text dropped).
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
show() {
  (cd "$ROOT/packages/compiler" && npx tsx ../engine/scripts/parse-line.ts "$1" "$2" "${3:-Test Card}" 2>/dev/null) | python3 -c "
import json, sys
d = json.load(sys.stdin)
def strip(o):
    if isinstance(o, dict): return {k: strip(v) for k, v in o.items() if k != 'text'}
    if isinstance(o, list): return [strip(x) for x in o]
    return o
print('UNPARSED:', d['unparsed'])
for a in d['abilities']: print(json.dumps(strip(a))[:1500])"
}
case "${1:-}" in
  --card)
    python3 - "$2" "$3" <<'EOF' | while IFS=$'\t' read -r type text name mana; do echo "## $name | $type"; MANA="$mana" show "$type" "$(printf '%b' "$text")" "$name"; done
import gzip, json, sys
for c in json.load(gzip.open(sys.argv[1]))["cards"]:
    if c["name"] == sys.argv[2] or c["name"].startswith(sys.argv[2] + " //"):
        for f in c["faces"]:
            print("\t".join([f["typeLine"], f["oracle"].replace("\\", "\\\\").replace("\n", "\\n"), f["name"], f.get("manaCost") or "{1}"]))
        break
EOF
    ;;
  --if) show Enchantment "At the beginning of your end step, if $2, draw a card." ;;
  *) show "$@" ;;
esac
